import { z } from "zod"

import { rdiv } from "./shared"

// Planning/buying calculators (Core-2) ported from the source ERP
// agency_tools.py (media_line_cost, discount_cascade, audience_metrics,
// plan_diff, estimate_totals, spot_match). Pure: no clock, DB or network.
// Inputs are strict (unknown keys rejected), money is bigint minor units and
// keys are camelCase versions of the source snake_case contract. Parity
// vectors produced by the Python source: tests/integration/core2-calculators.test.ts.

const MAX_AMOUNT = 9_007_199_254_740_991n
const Currency = z.string().regex(/^[A-Z]{3}$/)
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const Minor = z.bigint().nonnegative().max(MAX_AMOUNT)
const Bps = z.number().int().min(0).max(10000)
const Count = (max: number) => z.number().int().min(0).max(max)

function overflow(...values: bigint[]) {
  if (values.some((v) => v > MAX_AMOUNT)) throw new Error("amount overflow")
}

function calendarDate(text: string): number {
  const d = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) throw new Error("invalid calendar date")
  return d.getTime()
}

// ── media_line_cost ──
export const MediaLineCostInput = z
  .object({
    currency: Currency,
    calcType: z.enum(["per_second", "per_unit", "per_thousand", "per_action", "package"]),
    rateMinor: Minor,
    measure: Count(1_000_000),
    spots: Count(1_000_000),
    volume: Minor,
    packageMinor: Minor,
  })
  .strict()

export function mediaLineCost(input: z.infer<typeof MediaLineCostInput>) {
  const a = MediaLineCostInput.parse(input)
  if (a.calcType === "package") return { currency: a.currency, grossMinor: a.packageMinor, formula: "package_amount" }
  if (a.packageMinor !== 0n) throw new Error("package_minor must be 0 unless calc_type is package")
  let grossMinor: bigint
  let formula: string
  if (a.calcType === "per_second") {
    grossMinor = a.rateMinor * BigInt(a.measure) * BigInt(a.spots)
    formula = "rate_per_second * duration_seconds * spots"
  } else if (a.calcType === "per_unit") {
    grossMinor = a.rateMinor * BigInt(a.measure) * BigInt(a.spots)
    formula = "rate_per_unit * measure_units * spots"
  } else if (a.calcType === "per_thousand") {
    grossMinor = rdiv(a.rateMinor * a.volume, 1000n)
    formula = "rate * volume / 1000"
  } else {
    grossMinor = a.rateMinor * a.volume
    formula = "rate * actions"
  }
  overflow(grossMinor)
  return { currency: a.currency, grossMinor, formula }
}

// ── discount_cascade ──
export const DiscountCascadeInput = z
  .object({
    currency: Currency,
    grossMinor: Minor,
    mode: z.enum(["compound", "additive"]),
    discountsBps: z.array(Bps).max(8),
    surcharges: z
      .array(z.object({ kind: z.enum(["percent", "amount"]), value: Minor, accumulative: z.boolean() }).strict())
      .max(8),
    feeBase: z.enum(["none", "net", "gross", "gross_after_first_discount"]),
    feeBps: Bps,
    feeDiscountBps: Bps,
  })
  .strict()

export function discountCascade(input: z.infer<typeof DiscountCascadeInput>) {
  const a = DiscountCascadeInput.parse(input)
  const gross = a.grossMinor
  let running = gross
  for (const s of a.surcharges) {
    if (s.kind === "amount") running += s.value
    else {
      if (s.value > 10000n) throw new Error("percent surcharge above 10000 bps")
      running += rdiv((s.accumulative ? running : gross) * s.value, 10000n)
    }
  }
  const surcharged = running
  overflow(surcharged)
  const steps: { discountBps: number; amountMinor: bigint; runningMinor: bigint }[] = []
  let firstAfter: bigint | null = null
  if (a.mode === "additive") {
    const totalBps = a.discountsBps.reduce((s, d) => s + d, 0)
    if (totalBps > 10000) throw new Error("additive discounts exceed 100%")
    const target = rdiv(surcharged * BigInt(totalBps), 10000n)
    let taken = 0n
    a.discountsBps.forEach((d, i) => {
      let amount = i === a.discountsBps.length - 1 ? target - taken : rdiv(surcharged * BigInt(d), 10000n)
      const cap = surcharged - taken
      amount = amount > cap ? cap : amount
      amount = amount < 0n ? 0n : amount
      taken += amount
      running = surcharged - taken
      steps.push({ discountBps: d, amountMinor: amount, runningMinor: running })
      if (firstAfter === null) firstAfter = running
    })
  } else {
    for (const d of a.discountsBps) {
      const amount = rdiv(running * BigInt(d), 10000n)
      running -= amount
      steps.push({ discountBps: d, amountMinor: amount, runningMinor: running })
      if (firstAfter === null) firstAfter = running
    }
  }
  const net = running > 0n ? running : 0n
  const base =
    a.feeBase === "none" ? 0n : a.feeBase === "net" ? net : a.feeBase === "gross" ? surcharged : (firstAfter ?? surcharged)
  const fee =
    a.feeBase === "none" ? 0n : rdiv(rdiv(base * BigInt(a.feeBps), 10000n) * BigInt(10000 - a.feeDiscountBps), 10000n)
  return {
    currency: a.currency,
    surchargedGrossMinor: surcharged,
    steps,
    netMinor: net,
    feeMinor: fee,
    clientTotalMinor: net + fee,
    rounding: "half_up_each_step" as const,
  }
}

// ── audience_metrics ──
export const AudienceMetricsInput = z
  .object({
    currency: Currency,
    netCostMinor: Minor,
    universe: z.bigint().min(1n).max(10_000_000_000n),
    spots: z.array(z.object({ spotId: Id, ratingHundredths: Bps }).strict()).max(5000),
    reachHundredths: z.number().int().min(1).max(10000).nullable(),
  })
  .strict()

export function audienceMetrics(input: z.infer<typeof AudienceMetricsInput>) {
  const a = AudienceMetricsInput.parse(input)
  const seen = new Set<string>()
  let trp = 0n
  let impressions = 0n
  for (const s of a.spots) {
    if (seen.has(s.spotId)) throw new Error("duplicate spot_id")
    seen.add(s.spotId)
    trp += BigInt(s.ratingHundredths)
    impressions += rdiv(a.universe * BigInt(s.ratingHundredths), 10000n)
  }
  const n = BigInt(a.spots.length)
  return {
    currency: a.currency,
    trpHundredths: Number(trp),
    impressions,
    averageRatingHundredths: n ? Number(rdiv(trp, n)) : null,
    cprMinor: trp ? rdiv(a.netCostMinor * 100n, trp) : null,
    cpmMinor: impressions ? rdiv(a.netCostMinor * 1000n, impressions) : null,
    frequencyHundredths: a.reachHundredths && trp ? Number(rdiv(trp * 100n, BigInt(a.reachHundredths))) : null,
  }
}

// ── plan_diff ──
const PlanLine = z
  .object({
    lineId: Id,
    accountId: Id,
    supplierId: Id,
    channel: Id,
    currency: Currency,
    amountMinor: Minor,
    committedMinor: Minor,
    startDate: IsoDate,
    endDate: IsoDate,
  })
  .strict()
export type PlanDiffLine = z.infer<typeof PlanLine>

export const PlanDiffInput = z.object({ before: z.array(PlanLine).max(1000), after: z.array(PlanLine).max(1000) }).strict()

export type PlanDiffBlocker = {
  lineId: string
  reason: "commitment_removed" | "below_commitment" | "commitment_rewritten" | "committed_dimensions_changed"
}

const sameLine = (x: PlanDiffLine, y: PlanDiffLine) =>
  (Object.keys(x) as (keyof PlanDiffLine)[]).every((k) => x[k] === y[k])

export function planDiff(input: z.infer<typeof PlanDiffInput>) {
  const a = PlanDiffInput.parse(input)
  for (const label of ["before", "after"] as const) {
    const seen = new Set<string>()
    for (const line of a[label]) {
      if (seen.has(line.lineId)) throw new Error(`${label}: duplicate line_id`)
      seen.add(line.lineId)
      if (calendarDate(line.endDate) < calendarDate(line.startDate)) throw new Error("end_date precedes start_date")
      if (label === "before" && line.amountMinor < line.committedMinor) {
        throw new Error("before amount is below authoritative commitment")
      }
    }
  }
  const before = new Map(a.before.map((x) => [x.lineId, x]))
  const after = new Map(a.after.map((x) => [x.lineId, x]))
  const sort = (xs: string[]) => [...xs].sort()
  const added = sort([...after.keys()].filter((k) => !before.has(k)))
  const removed = sort([...before.keys()].filter((k) => !after.has(k)))
  const common = [...before.keys()].filter((k) => after.has(k))
  const changed = sort(common.filter((k) => !sameLine(before.get(k)!, after.get(k)!)))
  const unchanged = sort(common.filter((k) => sameLine(before.get(k)!, after.get(k)!)))
  const blockers: PlanDiffBlocker[] = []
  for (const k of removed) if (before.get(k)!.committedMinor) blockers.push({ lineId: k, reason: "commitment_removed" })
  for (const [k, next] of after) {
    const old = before.get(k)
    if (next.amountMinor < next.committedMinor) blockers.push({ lineId: k, reason: "below_commitment" })
    if ((!old && next.committedMinor !== 0n) || (old && next.committedMinor !== old.committedMinor)) {
      blockers.push({ lineId: k, reason: "commitment_rewritten" })
    }
    if (
      old &&
      old.committedMinor &&
      (["accountId", "supplierId", "channel", "currency", "startDate", "endDate"] as const).some((f) => old[f] !== next[f])
    ) {
      blockers.push({ lineId: k, reason: "committed_dimensions_changed" })
    }
  }
  const currencies = [...new Set([...a.before, ...a.after].map((x) => x.currency))].sort()
  const currencyDeltas = currencies.map((currency) => {
    const total = (xs: PlanDiffLine[]) => xs.filter((x) => x.currency === currency).reduce((s, x) => s + x.amountMinor, 0n)
    const beforeMinor = total(a.before)
    const afterMinor = total(a.after)
    return { currency, beforeMinor, afterMinor, deltaMinor: afterMinor - beforeMinor }
  })
  return {
    added,
    removed,
    changed,
    unchanged,
    currencyDeltas,
    blockers,
    status: blockers.length ? ("blocked" as const) : ("draft" as const),
    requiresHostApproval: Boolean(added.length || removed.length || changed.length),
  }
}

// ── estimate_totals ──
export const EstimateTotalsInput = z
  .object({
    agencyServiceBps: Bps,
    agencyServiceDiscountBps: Bps,
    lines: z
      .array(
        z
          .object({
            lineId: Id,
            kind: z.enum(["indirect", "direct", "internal", "cost_rendering"]),
            currency: Currency,
            unitPriceMinor: Minor,
            unitCostMinor: Minor,
            quantity: Count(1_000_000),
            days: z.number().int().min(1).max(3660),
            discountBps: Bps,
            serviceEligible: z.boolean(),
            supplierCommissionMode: z.enum(["none", "fixed", "percent"]),
            supplierCommissionValue: Minor,
          })
          .strict()
      )
      .max(500),
  })
  .strict()

type CurrencyTotal = {
  currency: string
  saleMinor: bigint
  costMinor: bigint
  serviceMinor: bigint
  supplierCommissionMinor: bigint
  grossIncomeMinor: bigint
}

export function estimateTotalsCalc(input: z.infer<typeof EstimateTotalsInput>) {
  const a = EstimateTotalsInput.parse(input)
  const lines: {
    lineId: string
    currency: string
    saleMinor: bigint
    costMinor: bigint
    serviceMinor: bigint
    supplierCommissionMinor: bigint
    marginMinor: bigint
  }[] = []
  const totals = new Map<string, CurrencyTotal>()
  const blockers: { lineId: string; reason: "direct_sale_differs_from_cost" | "commission_on_internal_line" | "duplicate_line_id" }[] = []
  const seen = new Set<string>()
  for (const line of a.lines) {
    if (seen.has(line.lineId)) {
      blockers.push({ lineId: line.lineId, reason: "duplicate_line_id" })
      continue
    }
    seen.add(line.lineId)
    const units = BigInt(line.quantity * line.days)
    const sale = rdiv(line.unitPriceMinor * units * BigInt(10000 - line.discountBps), 10000n)
    const cost = line.unitCostMinor * units
    if (line.kind === "direct" && sale !== cost) blockers.push({ lineId: line.lineId, reason: "direct_sale_differs_from_cost" })
    const service = line.serviceEligible
      ? rdiv(rdiv(sale * BigInt(a.agencyServiceBps), 10000n) * BigInt(10000 - a.agencyServiceDiscountBps), 10000n)
      : 0n
    const mode = line.supplierCommissionMode
    const value = line.supplierCommissionValue
    if (mode !== "none" && line.kind === "internal") blockers.push({ lineId: line.lineId, reason: "commission_on_internal_line" })
    const commission = mode === "fixed" ? value : mode === "percent" ? rdiv(cost * value, 10000n) : 0n
    if (mode === "percent" && value > 10000n) throw new Error("supplier commission percent above 10000 bps")
    // Direct lines are billed by the supplier to the client: agency income is service + commission only.
    const marginMinor = line.kind === "direct" ? service + commission : sale - cost + service + commission
    overflow(sale, cost, service, commission)
    lines.push({
      lineId: line.lineId,
      currency: line.currency,
      saleMinor: sale,
      costMinor: cost,
      serviceMinor: service,
      supplierCommissionMinor: commission,
      marginMinor,
    })
    const t = totals.get(line.currency) ?? {
      currency: line.currency,
      saleMinor: 0n,
      costMinor: 0n,
      serviceMinor: 0n,
      supplierCommissionMinor: 0n,
      grossIncomeMinor: 0n,
    }
    t.saleMinor += sale
    t.costMinor += cost
    t.serviceMinor += service
    t.supplierCommissionMinor += commission
    t.grossIncomeMinor += marginMinor
    totals.set(line.currency, t)
  }
  const currencyTotals = [...totals.keys()].sort().map((c) => totals.get(c)!)
  const invoiceGroups = currencyTotals.filter((t) => t.saleMinor || t.serviceMinor).length
  return { lines, currencyTotals, invoiceGroups, blockers }
}

// ── spot_match ──
export const SpotMatchInput = z
  .object({
    toleranceMinutes: z.number().int().min(0).max(120),
    matchMaterial: z.boolean(),
    ordered: z
      .array(
        z
          .object({ spotId: Id, stationId: Id, airDate: IsoDate, windowStart: Hhmm, windowEnd: Hhmm, materialId: Id })
          .strict()
      )
      .max(5000),
    aired: z
      .array(z.object({ eventId: Id, stationId: Id, airDate: IsoDate, airTime: Hhmm, materialId: Id }).strict())
      .max(20000),
  })
  .strict()

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":")
  return Number(h) * 60 + Number(m)
}

export function spotMatch(input: z.infer<typeof SpotMatchInput>) {
  const a = SpotMatchInput.parse(input)
  for (const [ids, key] of [
    [a.ordered.map((x) => x.spotId), "spot_id"],
    [a.aired.map((x) => x.eventId), "event_id"],
  ] as const) {
    if (new Set(ids).size !== ids.length) throw new Error(`duplicate ${key}`)
  }
  type Kind = "exact" | "tolerance"
  const candidates = new Map<string, [string, Kind][]>()
  for (const spot of a.ordered) {
    const start = minutesOf(spot.windowStart)
    const end = minutesOf(spot.windowEnd)
    if (end < start) throw new Error("window_end precedes window_start; split windows that cross midnight")
    const found: [string, Kind][] = []
    for (const event of a.aired) {
      if (event.stationId !== spot.stationId || event.airDate !== spot.airDate) continue
      if (a.matchMaterial && event.materialId !== spot.materialId) continue
      const t = minutesOf(event.airTime)
      if (start <= t && t <= end) found.push([event.eventId, "exact"])
      else if (end < t && t <= end + a.toleranceMinutes) found.push([event.eventId, "tolerance"])
    }
    candidates.set(spot.spotId, found)
  }
  // Order-independent assignment (source semantics): exact first, then exact
  // or tolerance; a pair is assigned only when both sides are uncontested.
  const matches = new Map<string, [string, Kind]>()
  const used = new Set<string>()
  const spotIds = [...candidates.keys()].sort()
  for (const allowed of [["exact"], ["exact", "tolerance"]] as Kind[][]) {
    let changed = true
    while (changed) {
      changed = false
      const openClaims = new Map<string, Set<string>>()
      for (const [spotId, found] of candidates) {
        if (matches.has(spotId)) continue
        for (const [eventId, kind] of found) {
          if (!used.has(eventId) && allowed.includes(kind)) {
            if (!openClaims.has(eventId)) openClaims.set(eventId, new Set())
            openClaims.get(eventId)!.add(spotId)
          }
        }
      }
      for (const spotId of spotIds) {
        if (matches.has(spotId)) continue
        const options = candidates.get(spotId)!.filter(([e, k]) => !used.has(e) && allowed.includes(k))
        const claim = options.length === 1 ? openClaims.get(options[0]![0]) : undefined
        if (options.length === 1 && claim && claim.size === 1 && claim.has(spotId)) {
          matches.set(spotId, options[0]!)
          used.add(options[0]![0])
          changed = true
        }
      }
    }
  }
  const ambiguous: { spotId: string; candidateEventIds: string[] }[] = []
  const orderedNotAired: string[] = []
  for (const spot of a.ordered) {
    if (matches.has(spot.spotId)) continue
    const open = candidates.get(spot.spotId)!.filter(([e]) => !used.has(e)).map(([e]) => e)
    if (open.length) ambiguous.push({ spotId: spot.spotId, candidateEventIds: [...open].sort() })
    else orderedNotAired.push(spot.spotId)
  }
  const claimed = new Set([...used, ...ambiguous.flatMap((x) => x.candidateEventIds)])
  return {
    matches: a.ordered
      .filter((s) => matches.has(s.spotId))
      .map((s) => ({ spotId: s.spotId, eventId: matches.get(s.spotId)![0], kind: matches.get(s.spotId)![1] })),
    ambiguous,
    orderedNotAired,
    airedNotOrdered: a.aired.filter((e) => !claimed.has(e.eventId)).map((e) => e.eventId),
  }
}

// ── broadcast spot plan (deterministic helper, not a source calculator) ──
// Spreads `spotCount` spots evenly over the flight days and alternates the
// station dayparts, so the same inputs always produce the same spot register.
export type Daypart = { code: string; start: string; end: string }

export function broadcastSpotPlan(input: {
  stationCode: string
  spotCount: number
  durationSeconds: number
  flightStart: string
  flightEnd: string
  dayparts: Daypart[]
}) {
  const start = calendarDate(input.flightStart)
  const end = calendarDate(input.flightEnd)
  if (end < start) throw new Error("flight end precedes flight start")
  if (!input.dayparts.length) throw new Error("station has no dayparts")
  const days = Math.round((end - start) / 86_400_000) + 1
  const materialId = `mat_${input.stationCode.toLowerCase()}_${input.durationSeconds}s`
  return Array.from({ length: input.spotCount }, (_, k) => {
    const dayIndex = Math.floor((k * days) / input.spotCount)
    const airDate = new Date(start + dayIndex * 86_400_000).toISOString().slice(0, 10)
    const dp = input.dayparts[k % input.dayparts.length]!
    return {
      spotId: `S${String(k + 1).padStart(3, "0")}`,
      stationId: input.stationCode,
      airDate,
      daypart: dp.code,
      windowStart: dp.start,
      windowEnd: dp.end,
      materialId,
      durationSeconds: input.durationSeconds,
    }
  })
}
