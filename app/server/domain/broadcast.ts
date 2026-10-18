import "server-only"

import { and, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { parseCsv } from "@/lib/csv"
import { audienceMetrics, broadcastSpotPlan, discountCascade, mediaLineCost, spotMatch, type Daypart } from "@/server/calculators/planning"
import type { Tx } from "@/server/db/client"
import { broadcastReconciliation, broadcastSchedule, broadcastSpot, broadcastStation, fileObject, makeGood, purchaseOrder } from "@/server/db/schema"
import { defineCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"
import { privateDisk } from "@/server/storage/private-disk"

import { lockJob } from "./budget"
import { rateBasis } from "./media-buying"
import { ACTIVE_ORDER_STATES, Decimal, IsoDate, Uuid, approvedPlan, assertDates, assertJobOpen, blocked, none, parseMoney } from "./media-planning"

// TV/radio planning and transmission control (Core-2). Stations, dayparts and
// ratings are synthetic demo data; every output that uses them says so.

type StationDayparts = { universe: number; sourceKey: string; items: (Daypart & { ratingHundredths: number })[] }
const AIR_TIME_TOLERANCE_MINUTES = 10

async function stationByName(tx: Tx, tenantId: string, name: string) {
  const [s] = await tx
    .select()
    .from(broadcastStation)
    .where(and(eq(broadcastStation.tenantId, tenantId), sql`lower(${broadcastStation.name}) = lower(${name.trim()})`))
    .limit(1)
  if (!s) blocked("unknown_station", "The station is not a registered fictitious demo station", { station: name })
  return s
}

// ── agency-tv-radio-planning: buildBroadcastSchedule ──
export const BroadcastScheduleInput = z
  .object({
    job: Uuid,
    medium: z.enum(["radio", "tv"]),
    station: z.string().trim().min(2).max(120),
    spotCount: z.number().int().min(1).max(500),
    spotDurationSeconds: z.number().int().min(5).max(120),
    unitCost: Decimal,
    flightStart: IsoDate,
    flightEnd: IsoDate,
  })
  .strict()

export const buildBroadcastSchedule = defineCommand({
  type: "media.buildBroadcastSchedule",
  skillId: "agency-tv-radio-planning",
  permission: "media.plan",
  input: BroadcastScheduleInput,
  handler: async (tx, ctx, input) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertJobOpen(j)
    assertDates(input.flightStart, input.flightEnd)
    const st = await stationByName(tx, ctx.tenant.id, input.station)
    if (st.medium !== input.medium) blocked("medium_mismatch", "The station broadcasts on another medium", { stationMedium: st.medium })
    if (!st.acceptedDurations.includes(input.spotDurationSeconds)) {
      blocked("unsupported_duration", "The station does not accept this creative duration", { durationSeconds: input.spotDurationSeconds, acceptedDurations: st.acceptedDurations })
    }
    const dp = st.dayparts as StationDayparts
    const unitCostMinor = parseMoney(input.unitCost, j.currency, "unitCost", { positive: true })
    const spots = broadcastSpotPlan({ stationCode: st.code, spotCount: input.spotCount, durationSeconds: input.spotDurationSeconds, flightStart: input.flightStart, flightEnd: input.flightEnd, dayparts: dp.items })
    if (new Set(spots.map((s) => s.spotId)).size !== spots.length) blocked("duplicate_spot_id", "Spot ids must be unique")
    const gross = mediaLineCost({ currency: j.currency, calcType: "per_unit", rateMinor: unitCostMinor, measure: 1, spots: input.spotCount, volume: 0n, packageMinor: 0n })
    const exceptions: Record<string, unknown>[] = []
    const basis = st.supplierId ? await rateBasis(tx, ctx.tenant.id, st.supplierId, input.medium, input.flightStart, input.flightEnd) : null
    const card = basis?.valid ?? null
    if (basis && basis.approved.length && !card) exceptions.push({ code: "rate_card_not_valid_for_flight" })
    if (card && card.grossRateMinor !== unitCostMinor) exceptions.push({ code: "unit_cost_differs_from_rate_card", rateCardGrossMinor: card.grossRateMinor.toString() })
    const priced = discountCascade({ currency: j.currency, grossMinor: gross.grossMinor, mode: "compound", discountsBps: card?.discountsBps ?? [], surcharges: [], feeBase: "none", feeBps: 0, feeDiscountBps: 0 })
    const ratingOf = new Map(dp.items.map((d) => [d.code, d.ratingHundredths]))
    const evaluation = audienceMetrics({ currency: j.currency, netCostMinor: priced.netMinor, universe: BigInt(dp.universe), spots: spots.map((s) => ({ spotId: s.spotId, ratingHundredths: ratingOf.get(s.daypart) ?? 0 })), reachHundredths: null })
    const plan = await approvedPlan(tx, ctx.tenant.id, j.id)
    const line = plan.lines.find((l) => l.channel === input.medium && l.placement.toLowerCase() === st.name.toLowerCase()) ?? null
    if (line && line.amountMinor !== priced.netMinor) exceptions.push({ code: "schedule_differs_from_plan_line", lineMinor: line.amountMinor.toString(), scheduleNetMinor: priced.netMinor.toString() })
    const [order] = line
      ? await tx
          .select({ id: purchaseOrder.id, state: purchaseOrder.state, reference: purchaseOrder.reference })
          .from(purchaseOrder)
          .where(and(eq(purchaseOrder.tenantId, ctx.tenant.id), eq(purchaseOrder.jobId, j.id), eq(purchaseOrder.kind, "media"), eq(purchaseOrder.planLineId, line.id)))
          .orderBy(desc(purchaseOrder.createdAt))
          .limit(1)
      : []
    const [schedule] = await tx
      .insert(broadcastSchedule)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        stationId: st.id,
        planLineId: line?.id ?? null,
        medium: input.medium,
        spotCount: input.spotCount,
        durationSeconds: input.spotDurationSeconds,
        unitCostMinor,
        grossMinor: gross.grossMinor,
        netMinor: priced.netMinor,
        currency: j.currency,
        flightStart: input.flightStart,
        flightEnd: input.flightEnd,
        timezone: st.timezone,
        state: "confirmed",
        detail: { rateCardId: card?.id ?? null, orderId: order && ACTIVE_ORDER_STATES.includes(order.state) ? order.id : null, synthetic: true },
        createdBy: ctx.user.id,
      })
      .returning()
    await tx.insert(broadcastSpot).values(
      spots.map((s) => ({ tenantId: ctx.tenant.id, scheduleId: schedule!.id, spotKey: s.spotId, airDate: s.airDate, daypart: s.daypart, windowStart: s.windowStart, windowEnd: s.windowEnd, materialId: s.materialId, durationSeconds: s.durationSeconds }))
    )
    const materialId = spots[0]!.materialId
    return {
      result: {
        scheduleId: schedule!.id,
        broadcast_schedule: { scheduleId: schedule!.id, station: st.name, stationCode: st.code, medium: input.medium, timezone: st.timezone, flightStart: input.flightStart, flightEnd: input.flightEnd, spotCount: input.spotCount, durationSeconds: input.spotDurationSeconds, grossMinor: gross.grossMinor.toString(), netMinor: priced.netMinor.toString(), currency: j.currency, planLineKey: line?.lineKey ?? null, synthetic: true },
        spot_register: spots.map((s) => ({ spotId: s.spotId, airDate: s.airDate, daypart: s.daypart, window: `${s.windowStart}-${s.windowEnd}`, timezone: st.timezone, materialId: s.materialId })),
        rate_basis: { unitCostMinor: unitCostMinor.toString(), formula: gross.formula, rateCardId: card?.id ?? null, rateCardNumber: card?.number ?? null, steps: priced.steps.map((x) => ({ discountBps: x.discountBps, amountMinor: x.amountMinor.toString(), runningMinor: x.runningMinor.toString() })), netMinor: priced.netMinor.toString(), exceptions },
        material_distribution: [{ materialId, durationSeconds: input.spotDurationSeconds, durationValidated: true, acceptedDurations: st.acceptedDurations, spots: spots.length }],
        traffic_instructions: [{ station: st.name, materialId, timezone: st.timezone, rotation: spots.map((s) => s.spotId), note: "Air times are local to the station time zone." }],
        evaluation_report: {
          label: "Synthetic demo audience",
          sourceKey: dp.sourceKey,
          universe: dp.universe,
          trpHundredths: evaluation.trpHundredths,
          impressions: evaluation.impressions.toString(),
          cprMinor: evaluation.cprMinor?.toString() ?? null,
          cpmMinor: evaluation.cpmMinor?.toString() ?? null,
          reach: "not_estimated",
          synthetic: true,
        },
      },
      events: [
        {
          eventType: "broadcast.schedule_built",
          aggregateType: "broadcast_schedule",
          aggregateId: schedule!.id,
          jobId: j.id,
          payload: { station: st.code, spotCount: input.spotCount, durationSeconds: input.spotDurationSeconds, grossMinor: gross.grossMinor, netMinor: priced.netMinor, currency: j.currency },
        },
      ],
    }
  },
})

// ── agency-transmission-control: reconcileBroadcastDelivery ──
export const TransmissionInput = z
  .object({
    job: Uuid,
    station: z.string().trim().min(2).max(120),
    orderedSpots: z.number().int().min(1).max(500),
    monitoringFile: Uuid,
    toleranceSpots: z.number().int().min(0).max(50),
    requestMakeGood: z.boolean().optional(),
  })
  .strict()

const EMISSION_HEADERS = ["event_id", "station_code", "air_date", "air_time", "material_id"]

export async function readEmissions(tx: Tx, tenantId: string, fileId: string) {
  const [f] = await tx.select().from(fileObject).where(and(eq(fileObject.tenantId, tenantId), eq(fileObject.id, fileId))).limit(1)
  if (!f) throw new DomainError("not_found", "Monitoring file not found", { field: "monitoringFile" })
  if (f.format !== "csv") throw new DomainError("validation", "Emission records must be a CSV file", { field: "monitoringFile" })
  const { headers, rows } = parseCsv(new TextDecoder().decode(await privateDisk.get(tenantId, f.storageKey)), ",")
  if (headers.join(",") !== EMISSION_HEADERS.join(",")) {
    throw new DomainError("validation", "Unexpected emission columns", { field: "monitoringFile", expected: EMISSION_HEADERS, found: headers })
  }
  const seen = new Map<string, string>()
  const unique: { eventId: string; stationId: string; airDate: string; airTime: string; materialId: string }[] = []
  const duplicates: string[] = []
  rows.forEach((r, i) => {
    const [eventId, stationId, airDate, airTime, materialId] = r
    if (!eventId || !stationId || !/^\d{4}-\d{2}-\d{2}$/.test(airDate ?? "") || !/^\d{2}:\d{2}$/.test(airTime ?? "") || !materialId) {
      throw new DomainError("validation", `Invalid emission record on row ${i + 2}`, { field: "monitoringFile", row: i + 2 })
    }
    const content = r.join(",")
    const prior = seen.get(eventId)
    if (prior !== undefined) {
      if (prior !== content) throw new DomainError("validation", `Conflicting duplicate of ${eventId}`, { field: "monitoringFile", rule: "conflicting_emission_record", eventId })
      duplicates.push(eventId)
      return
    }
    seen.set(eventId, content)
    unique.push({ eventId, stationId, airDate: airDate!, airTime: airTime!, materialId })
  })
  return { file: f, unique, duplicates, rawCount: rows.length }
}

export const reconcileBroadcastDelivery = defineCommand({
  type: "media.reconcileBroadcastDelivery",
  skillId: "agency-transmission-control",
  permission: "media.buy",
  input: TransmissionInput,
  handler: async (tx, ctx, input) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    const st = await stationByName(tx, ctx.tenant.id, input.station)
    const schedules = await tx
      .select()
      .from(broadcastSchedule)
      .where(and(eq(broadcastSchedule.tenantId, ctx.tenant.id), eq(broadcastSchedule.jobId, j.id), eq(broadcastSchedule.stationId, st.id)))
      .orderBy(desc(broadcastSchedule.createdAt))
    if (!schedules.length) blocked("no_broadcast_schedule", "The job has no schedule for this station", { station: st.name })
    const schedule = schedules.find((s) => s.spotCount === input.orderedSpots)
    if (!schedule) blocked("ordered_spots_mismatch", "No schedule for this station has that number of ordered spots", { orderedSpots: input.orderedSpots, scheduled: schedules.map((s) => s.spotCount) })
    const spots = await tx.select().from(broadcastSpot).where(and(eq(broadcastSpot.tenantId, ctx.tenant.id), eq(broadcastSpot.scheduleId, schedule.id)))
    spots.sort((a, b) => (a.spotKey < b.spotKey ? -1 : 1))
    const em = await readEmissions(tx, ctx.tenant.id, input.monitoringFile)
    const match = spotMatch({
      toleranceMinutes: AIR_TIME_TOLERANCE_MINUTES,
      matchMaterial: true,
      ordered: spots.map((s) => ({ spotId: s.spotKey, stationId: st.code, airDate: s.airDate, windowStart: s.windowStart, windowEnd: s.windowEnd, materialId: s.materialId })),
      aired: em.unique,
    })
    const missing = match.orderedNotAired
    if (missing.length > input.toleranceSpots && !input.requestMakeGood) {
      blocked("missing_spots_require_makegood", "Missing spots exceed the tolerance; request a make-good instead of closing as delivered", {
        missingSpots: missing,
        toleranceSpots: input.toleranceSpots,
        matchedSpots: match.matches.length,
        duplicateRecords: em.duplicates.length,
      })
    }
    const materialExceptions = em.unique
      .filter((e) => match.airedNotOrdered.includes(e.eventId) && e.stationId === st.code && spots.some((s) => s.airDate === e.airDate) && !spots.some((s) => s.materialId === e.materialId))
      .map((e) => ({ eventId: e.eventId, materialId: e.materialId, expected: spots[0]?.materialId ?? null }))
    const status = missing.length <= input.toleranceSpots && !match.ambiguous.length ? "ready_to_close" : "awaiting_makegood"
    const [rec] = await tx
      .insert(broadcastReconciliation)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        scheduleId: schedule.id,
        monitoringFileId: em.file.id,
        monitoringSha256: em.file.sha256,
        orderedSpots: spots.length,
        matchedSpots: match.matches.length,
        missingSpots: missing.length,
        duplicateRecords: em.duplicates.length,
        extraRecords: match.airedNotOrdered.length,
        toleranceSpots: input.toleranceSpots,
        status,
        result: { matches: match.matches, ambiguous: match.ambiguous, orderedNotAired: missing, airedNotOrdered: match.airedNotOrdered, duplicates: em.duplicates },
        createdBy: ctx.user.id,
      })
      .returning()
    const makeGoods = input.requestMakeGood && missing.length
      ? await tx
          .insert(makeGood)
          .values(missing.map((k) => ({ tenantId: ctx.tenant.id, reconciliationId: rec!.id, spotKey: k, originalAirDate: spots.find((s) => s.spotKey === k)!.airDate, state: "requested", cashCostChangeMinor: 0n, currency: schedule.currency })))
          .returning()
      : []
    const orderId = (schedule.detail as { orderId?: string | null }).orderId ?? null
    const [order] = orderId
      ? await tx.select().from(purchaseOrder).where(and(eq(purchaseOrder.tenantId, ctx.tenant.id), eq(purchaseOrder.id, orderId))).limit(1)
      : []
    const perSpotNet = schedule.netMinor / BigInt(schedule.spotCount)
    return {
      result: {
        reconciliationId: rec!.id,
        status,
        emission_match: { ordered: spots.length, matched: match.matches.length, matches: match.matches, ambiguous: match.ambiguous, toleranceMinutes: AIR_TIME_TOLERANCE_MINUTES, monitoringSha256: em.file.sha256, synthetic: true },
        missing_or_extra_insertions: { missing, extra: match.airedNotOrdered, duplicates: em.duplicates, rawRecords: em.rawCount, uniqueRecords: em.unique.length },
        material_exceptions: materialExceptions.length ? materialExceptions : none("Every aired record used the scheduled material."),
        makegood_register: makeGoods.length
          ? makeGoods.map((m) => ({ makeGoodId: m.id, spotId: m.spotKey, originalAirDate: m.originalAirDate, state: m.state, cashCostChangeMinor: "0", currency: m.currency }))
          : none(missing.length ? "Make-good not requested." : "No missing spots."),
        close_readiness: { status, missingSpots: missing.length, toleranceSpots: input.toleranceSpots, missingMarkedDelivered: false },
        postbuy_report: { scheduledSpots: spots.length, airedSpots: match.matches.length, deliveryBps: Math.round((match.matches.length * 10000) / spots.length), label: "Synthetic monitoring data" },
        finance_handoff: order
          ? { orderId: order.id, reference: order.reference, orderMinor: order.amountMinor.toString(), deliverableValueMinor: (perSpotNet * BigInt(match.matches.length)).toString(), cashCostChangeMinor: "0", currency: order.currency, note: "Delivery acceptance is a separate decision; missing spots are not delivered." }
          : none("No media order is linked to this schedule."),
      },
      events: [
        {
          eventType: "broadcast.delivery_reconciled",
          aggregateType: "broadcast_schedule",
          aggregateId: schedule.id,
          jobId: j.id,
          payload: { reconciliationId: rec!.id, matched: match.matches.length, missing: missing.length, duplicates: em.duplicates.length, makeGoods: makeGoods.length, cashCostChangeMinor: 0 },
        },
      ],
    }
  },
})
