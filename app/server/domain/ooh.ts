import "server-only"

import { and, asc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { discountCascade, mediaLineCost } from "@/server/calculators/planning"
import { allocate } from "@/server/calculators/shared"
import type { Tx } from "@/server/db/client"
import { oohFace, oohPlan, oohReservation, purchaseOrder } from "@/server/db/schema"
import { defineCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { lockJob } from "./budget"
import { getBusinessDate } from "./presenter"
import { rateBasis } from "./media-buying"
import { ACTIVE_ORDER_STATES, Decimal, IsoDate, Uuid, approvedPlan, assertDates, assertJobOpen, blocked, none, parseMoney } from "./media-planning"

// Out-of-home planning and inventory (Core-2). Sites and faces are fictitious
// demo inventory. Planning never reserves; reservation locks the face row so
// two overlapping requests for the same face have exactly one winner.

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart

async function reservedOverlaps(tx: Tx, tenantId: string, faceId: string, start: string, end: string) {
  const rows = await tx
    .select()
    .from(oohReservation)
    .where(and(eq(oohReservation.tenantId, tenantId), eq(oohReservation.faceId, faceId), eq(oohReservation.state, "reserved")))
  return rows.filter((r) => overlaps(r.startDate, r.endDate, start, end))
}

/** Calendar-day weights per month of a flight, for an exact monthly split. */
function monthWeights(start: string, end: string) {
  const weights = new Map<string, bigint>()
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    const m = new Date(t).toISOString().slice(0, 7)
    weights.set(m, (weights.get(m) ?? 0n) + 1n)
  }
  return [...weights.entries()].map(([month, weight]) => ({ targetId: month, weight }))
}

const evidenceFor = (format: string) => (format === "digital" ? "proof_of_play" : "photo")

// ── agency-ooh-planning: proposeOOHPlan ──
export const OohPlanInput = z
  .object({
    job: Uuid,
    site: z.string().trim().min(2).max(120),
    faces: z.number().int().min(1).max(50),
    unitRate: Decimal,
    flightStart: IsoDate,
    flightEnd: IsoDate,
    evidenceType: z.enum(["photo", "proof_of_play"]).optional(),
  })
  .strict()

export const proposeOOHPlan = defineCommand({
  type: "media.proposeOOHPlan",
  skillId: "agency-ooh-planning",
  permission: "media.plan",
  input: OohPlanInput,
  handler: async (tx, ctx, input) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertJobOpen(j)
    assertDates(input.flightStart, input.flightEnd)
    const faces = await tx
      .select()
      .from(oohFace)
      .where(and(eq(oohFace.tenantId, ctx.tenant.id), sql`lower(${oohFace.site}) = lower(${input.site})`))
      .orderBy(asc(oohFace.faceKey))
    if (!faces.length) blocked("unknown_site", "The site is not in the demo OOH inventory", { site: input.site })
    const availability = await Promise.all(
      faces.map(async (f) => ({ face: f, conflicts: await reservedOverlaps(tx, ctx.tenant.id, f.id, input.flightStart, input.flightEnd) }))
    )
    const available = availability.filter((a) => !a.conflicts.length)
    if (available.length < input.faces) {
      blocked("faces_unavailable", "Not enough faces are free for these dates (exclusive reservations overlap)", {
        requestedFaces: input.faces,
        availableFaces: available.map((a) => a.face.faceKey),
        conflicts: availability.filter((a) => a.conflicts.length).map((a) => ({ face: a.face.faceKey, reservations: a.conflicts.map((c) => ({ start: c.startDate, end: c.endDate, jobId: c.jobId === j.id ? c.jobId : "other_job" })) })),
      })
    }
    const chosen = available.slice(0, input.faces).map((a) => a.face)
    const unitRateMinor = parseMoney(input.unitRate, j.currency, "unitRate", { positive: true })
    const gross = mediaLineCost({ currency: j.currency, calcType: "per_unit", rateMinor: unitRateMinor, measure: 1, spots: input.faces, volume: 0n, packageMinor: 0n })
    const exceptions: Record<string, unknown>[] = []
    const basis = await rateBasis(tx, ctx.tenant.id, chosen[0]!.operatorId, "ooh", input.flightStart, input.flightEnd)
    if (basis.approved.length && !basis.valid) {
      exceptions.push({ code: "rate_card_expired", cards: basis.approved.map((c) => ({ number: c.number, validTo: c.validTo })), effect: "planning only; buying is blocked until renewed" })
    }
    const priced = discountCascade({ currency: j.currency, grossMinor: gross.grossMinor, mode: "compound", discountsBps: basis.valid?.discountsBps ?? [], surcharges: [], feeBase: "none", feeBps: 0, feeDiscountBps: 0 })
    const schedule = allocate({ currency: j.currency, amountMinor: priced.netMinor, weights: monthWeights(input.flightStart, input.flightEnd) })
    const evidence = chosen.map((f) => {
      const required = evidenceFor(f.format)
      if (input.evidenceType && input.evidenceType !== required) exceptions.push({ code: "evidence_type_overridden", face: f.faceKey, requested: input.evidenceType, required })
      return { face: f.faceKey, format: f.format, required }
    })
    const proposals = chosen.map((f) => ({ faceId: f.id, faceKey: f.faceKey, startDate: input.flightStart, endDate: input.flightEnd, state: "proposed_not_reserved" }))
    const [plan] = await tx
      .insert(oohPlan)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        site: faces[0]!.site,
        faces: input.faces,
        unitRateMinor,
        totalMinor: priced.netMinor,
        currency: j.currency,
        flightStart: input.flightStart,
        flightEnd: input.flightEnd,
        evidenceType: input.evidenceType ?? evidence[0]!.required,
        state: "proposed",
        bookingProposals: proposals,
        createdBy: ctx.user.id,
      })
      .returning()
    return {
      result: {
        oohPlanId: plan!.id,
        totalMinor: priced.netMinor.toString(),
        currency: j.currency,
        site_plan: { oohPlanId: plan!.id, site: faces[0]!.site, faces: chosen.map((f) => ({ faceKey: f.faceKey, format: f.format })), flightStart: input.flightStart, flightEnd: input.flightEnd, synthetic: true },
        ooh_line_pricing: { unitRateMinor: unitRateMinor.toString(), faces: input.faces, formula: gross.formula, grossMinor: gross.grossMinor.toString(), netMinor: priced.netMinor.toString(), rateCardId: basis.valid?.id ?? null, currency: j.currency },
        cost_schedule: schedule.allocations.map((a) => ({ month: a.targetId, amountMinor: a.amountMinor.toString() })),
        evidence_requirements: evidence,
        booking_proposals: proposals,
        exceptions: exceptions.length ? exceptions : none("No pricing or evidence exceptions."),
      },
      events: [
        {
          eventType: "ooh.plan_proposed",
          aggregateType: "ooh_plan",
          aggregateId: plan!.id,
          jobId: j.id,
          payload: { site: faces[0]!.site, faces: chosen.map((f) => f.faceKey), totalMinor: priced.netMinor, currency: j.currency, reserved: false },
        },
      ],
    }
  },
})

// ── agency-ooh-inventory: reserveOOHFace ──
export const OohInventoryInput = z
  .object({
    job: Uuid,
    action: z.enum(["check", "reserve"]),
    face: z.string().trim().min(2).max(80),
    startDate: IsoDate,
    endDate: IsoDate,
    operator: Uuid,
  })
  .strict()

export const reserveOOHFace = defineCommand({
  type: "media.reserveOOHFace",
  skillId: "agency-ooh-inventory",
  permission: "media.buy",
  input: OohInventoryInput,
  handler: async (tx, ctx, input) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertJobOpen(j)
    assertDates(input.startDate, input.endDate, "endDate")
    // Row lock on the face serializes concurrent reservations of it.
    const [face] = await tx
      .select()
      .from(oohFace)
      .where(and(eq(oohFace.tenantId, ctx.tenant.id), eq(oohFace.faceKey, input.face)))
      .for("update")
      .limit(1)
    if (!face) throw new DomainError("not_found", "Face not found", { field: "face" })
    if (face.operatorId !== input.operator) blocked("operator_mismatch", "The face belongs to another operator", { face: face.faceKey })
    const conflicts = await reservedOverlaps(tx, ctx.tenant.id, face.id, input.startDate, input.endDate)
    const plan = await approvedPlan(tx, ctx.tenant.id, j.id)
    const line = plan.lines.find((l) => l.channel === "ooh") ?? null
    const basis = await rateBasis(tx, ctx.tenant.id, face.operatorId, "ooh", input.startDate, input.endDate)
    const exceptions: Record<string, unknown>[] = []
    if (basis.approved.length && !basis.valid) exceptions.push({ code: "rate_card_expired", cards: basis.approved.map((c) => ({ number: c.number, validTo: c.validTo })) })
    const availability = {
      face: face.faceKey,
      site: face.site,
      format: face.format,
      window: { start: input.startDate, end: input.endDate },
      available: conflicts.length === 0,
      conflicts: conflicts.map((c) => ({ start: c.startDate, end: c.endDate, sameJob: c.jobId === j.id })),
      faceRevision: face.revision,
      asOf: await getBusinessDate(),
      synthetic: true,
    }
    const orders = line
      ? (
          await tx
            .select({ id: purchaseOrder.id, reference: purchaseOrder.reference, state: purchaseOrder.state, amountMinor: purchaseOrder.amountMinor })
            .from(purchaseOrder)
            .where(and(eq(purchaseOrder.tenantId, ctx.tenant.id), eq(purchaseOrder.jobId, j.id), eq(purchaseOrder.planLineId, line.id)))
        ).filter((o) => ACTIVE_ORDER_STATES.includes(o.state))
      : []
    const perFace = line && line.unitCostMinor !== null ? line.unitCostMinor : null
    const outputs = {
      ooh_orders: orders.length ? orders.map((o) => ({ orderId: o.id, reference: o.reference, state: o.state, amountMinor: o.amountMinor.toString() })) : none("Issue the OOH plan line through media buying."),
      monthly_suborders:
        perFace !== null
          ? allocate({ currency: j.currency, amountMinor: perFace, weights: monthWeights(input.startDate, input.endDate) }).allocations.map((a) => ({ month: a.targetId, amountMinor: a.amountMinor.toString() }))
          : none("The plan line has no per-face rate to split."),
      face_motif_assignments: none("Motifs are assigned when the creative is posted."),
      posting_batches: none("No posting batch before the reservation is confirmed by the operator."),
      agreement_balances: basis.valid
        ? [{ rateCardId: basis.valid.id, number: basis.valid.number, validTo: basis.valid.validTo, netRateMinor: basis.valid.netRateMinor.toString() }]
        : none("No valid OOH rate agreement for these dates."),
      inventory_exceptions: exceptions.length ? exceptions : none("No inventory exceptions."),
    }
    if (input.action === "check") {
      return { result: { action: "check", availability_report: availability, reservations: none("Check only; nothing reserved."), ...outputs }, events: [] }
    }
    if (conflicts.length) {
      blocked("face_overlap", "The face already has an overlapping exclusive reservation", { face: face.faceKey, conflicts: availability.conflicts })
    }
    const [res] = await tx
      .insert(oohReservation)
      .values({ tenantId: ctx.tenant.id, faceId: face.id, jobId: j.id, planLineId: line?.id ?? null, startDate: input.startDate, endDate: input.endDate, state: "reserved", createdBy: ctx.user.id })
      .returning()
    const [f2] = await tx.update(oohFace).set({ revision: sql`${oohFace.revision} + 1` }).where(eq(oohFace.id, face.id)).returning({ revision: oohFace.revision })
    return {
      result: {
        action: "reserve",
        reservationId: res!.id,
        availability_report: { ...availability, available: false, faceRevision: f2!.revision },
        reservations: [{ reservationId: res!.id, face: face.faceKey, startDate: input.startDate, endDate: input.endDate, state: res!.state, planLineKey: line?.lineKey ?? null }],
        ...outputs,
      },
      events: [
        {
          eventType: "ooh.face_reserved",
          aggregateType: "ooh_face",
          aggregateId: face.id,
          aggregateRevision: f2!.revision,
          jobId: j.id,
          payload: { reservationId: res!.id, face: face.faceKey, startDate: input.startDate, endDate: input.endDate, planLineId: line?.id ?? null },
        },
      ],
    }
  },
})
