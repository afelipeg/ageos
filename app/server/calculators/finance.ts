// Finance calculators (Core-3) ported from agency_tools.py; parity vectors in tests/fixtures/core3-finance-vectors.json
import { z } from "zod"

import { largestRemainder, rdiv } from "./shared"

const MAX_AMOUNT = 9_007_199_254_740_991n

const Currency = z.string().regex(/^[A-Z]{3}$/)
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)
const DateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const Minor = z.bigint().nonnegative().max(MAX_AMOUNT)
const SignedMinor = z.bigint().min(-MAX_AMOUNT).max(MAX_AMOUNT)
const RateMicro = z.bigint().min(1n).max(MAX_AMOUNT)
const Bps = z.number().int().min(0).max(10000)
const Holidays = z.array(DateText).max(400)

const max = (a: bigint, b: bigint) => (a > b ? a : b)
const min = (a: bigint, b: bigint) => (a < b ? a : b)

// ── UTC-only calendar helpers (days since 1970-01-01; Python date range 0001-01-01..9999-12-31) ──
const MS_PER_DAY = 86_400_000
const RANGE_ERROR = "date or amount outside the supported range"

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const daysInMonth = (y: number, m: number) => (m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31)

function toDays(y: number, m: number, d: number) {
  const t = new Date(0)
  t.setUTCFullYear(y, m - 1, d)
  return Math.round(t.getTime() / MS_PER_DAY)
}

const MIN_DAY = toDays(1, 1, 1)
const MAX_DAY = toDays(9999, 12, 31)

function fromDays(n: number) {
  const t = new Date(n * MS_PER_DAY)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/** Source `_d`: strict calendar-date parse. */
function parseDate(text: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) throw new Error("invalid calendar date")
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new Error("invalid calendar date")
  return toDays(y, m, d)
}

function addDays(day: number, delta: number) {
  const result = day + delta
  if (result < MIN_DAY || result > MAX_DAY) throw new Error(RANGE_ERROR)
  return result
}

/** Monday=0 .. Sunday=6 (1970-01-01 was a Thursday). */
const weekday = (day: number) => (((day + 3) % 7) + 7) % 7

function isoDate(day: number) {
  const { y, m, d } = fromDays(day)
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

function monthEnd(day: number) {
  const { y, m } = fromDays(day)
  const next = addDays(toDays(y, m, 28), 4)
  return addDays(next, -fromDays(next).d)
}

function addMonths(month: string, offset: number) {
  const [y, m] = month.split("-").map(Number)
  const index = y! * 12 + (m! - 1) + offset
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`
}

/** Source `_business_roll`: advance past weekends (optional) and holidays. */
function businessRoll(day: number, holidays: string[], weekendRoll = true) {
  const blocked = new Set(holidays.map(parseDate))
  let rolled = 0
  while ((weekendRoll && weekday(day) >= 5) || blocked.has(day)) {
    day = addDays(day, 1)
    rolled += 1
    if (rolled > 31) throw new Error("holiday calendar blocks more than 31 consecutive days")
  }
  return { day, rolled }
}

/** Source validates each output amount within ±MAX_AMOUNT (`$ .path: outside allowed integer range`). */
function assertAmountRange(value: unknown, path: string) {
  if (typeof value === "bigint") {
    if (value > MAX_AMOUNT || value < -MAX_AMOUNT) throw new Error(`${path}: outside allowed integer range`)
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertAmountRange(v, `${path}[${i}]`))
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertAmountRange(v, `${path}.${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`)
  }
}

function checked<T>(result: T): T {
  assertAmountRange(result, "$ ")
  return result
}

// ── aging ──
export const AgingInput = z
  .object({
    asOf: DateText,
    bucketLimitsDays: z.array(z.number().int().min(1).max(3650)).max(10),
    items: z.array(z.object({ docId: Id, currency: Currency, dueDate: DateText, openMinor: SignedMinor }).strict()).max(20000),
  })
  .strict()

export function aging(input: z.infer<typeof AgingInput>) {
  const a = AgingInput.parse(input)
  const limits = a.bucketLimitsDays
  if (limits.some((limit, i) => i > 0 && limit <= limits[i - 1]!)) throw new Error("bucket limits must strictly ascend")
  const asOf = parseDate(a.asOf)
  const byCurrency = new Map<string, { notDue: bigint; buckets: bigint[]; weighted: bigint; overdue: bigint; positive: bigint }>()
  const seen = new Set<string>()
  for (const item of a.items) {
    if (seen.has(item.docId)) throw new Error("duplicate doc_id")
    seen.add(item.docId)
    let c = byCurrency.get(item.currency)
    if (!c) {
      c = { notDue: 0n, buckets: limits.map(() => 0n).concat(0n), weighted: 0n, overdue: 0n, positive: 0n }
      byCurrency.set(item.currency, c)
    }
    const days = asOf - parseDate(item.dueDate)
    if (days <= 0) {
      c.notDue += item.openMinor
      continue
    }
    const found = limits.findIndex((limit) => days <= limit)
    c.buckets[found === -1 ? limits.length : found]! += item.openMinor
    c.overdue += item.openMinor
    if (item.openMinor > 0n) {
      c.weighted += item.openMinor * BigInt(days)
      c.positive += item.openMinor
    }
  }
  const currencies = [...byCurrency.keys()].sort().map((currency) => {
    const c = byCurrency.get(currency)!
    let lower = 1
    const buckets = c.buckets.map((amountMinor, i) => {
      const upper = i < limits.length ? limits[i]! : null
      const bucket = { fromDays: lower, toDays: upper, amountMinor }
      lower = (upper ?? 0) + 1
      return bucket
    })
    return {
      currency,
      notDueMinor: c.notDue,
      totalMinor: c.notDue + c.overdue,
      buckets,
      weightedDaysOverdue: c.positive > 0n ? Number(rdiv(c.weighted, c.positive)) : null,
    }
  })
  return checked({ asOf: a.asOf, currencies })
}

// ── withholding ──
export const WithholdingInput = z
  .object({
    currency: Currency,
    method: z.enum(["per_payment", "cumulative_period"]),
    paymentBaseMinor: Minor,
    accumulatedBaseMinor: Minor,
    accumulatedWithheldMinor: Minor,
    nonTaxableMinimumMinor: Minor,
    rateBps: Bps,
    minimumWithholdingMinor: Minor,
  })
  .strict()

export function withholding(input: z.infer<typeof WithholdingInput>) {
  const a = WithholdingInput.parse(input)
  let taxable: bigint
  let amount: bigint
  if (a.method === "per_payment") {
    taxable = max(a.paymentBaseMinor - a.nonTaxableMinimumMinor, 0n)
    amount = rdiv(taxable * BigInt(a.rateBps), 10000n)
  } else {
    taxable = max(a.accumulatedBaseMinor + a.paymentBaseMinor - a.nonTaxableMinimumMinor, 0n)
    amount = max(rdiv(taxable * BigInt(a.rateBps), 10000n) - a.accumulatedWithheldMinor, 0n)
  }
  const below = amount > 0n && amount < a.minimumWithholdingMinor
  return checked({ currency: a.currency, taxableBaseMinor: taxable, withholdingMinor: below ? 0n : amount, belowMinimum: below })
}

// ── payment_terms ──
export const PaymentTermsInput = z
  .object({
    baseDate: DateText,
    termDays: z.number().int().min(0).max(3650),
    rule: z.enum(["net_days", "end_of_month_then_days", "next_fortnight"]),
    delayDays: z.number().int().min(0).max(365),
    holidays: Holidays,
    weekendRoll: z.boolean(),
  })
  .strict()

export function paymentTerms(input: z.infer<typeof PaymentTermsInput>) {
  const a = PaymentTermsInput.parse(input)
  const base = parseDate(a.baseDate)
  let due: number
  if (a.rule === "net_days") {
    due = addDays(base, a.termDays)
  } else if (a.rule === "end_of_month_then_days") {
    due = addDays(monthEnd(base), a.termDays)
  } else {
    const { y, m, d } = fromDays(base)
    due = addDays(d <= 15 ? toDays(y, m, 15) : monthEnd(base), a.termDays)
  }
  const rolledDue = businessRoll(due, a.holidays, a.weekendRoll)
  const expected = businessRoll(addDays(rolledDue.day, a.delayDays), a.holidays, a.weekendRoll)
  return {
    dueDate: isoDate(rolledDue.day),
    expectedDate: isoDate(expected.day),
    dueRolledDays: rolledDue.rolled,
    expectedRolledDays: expected.rolled,
  }
}

// ── fx_revaluation ──
export const FxRevaluationInput = z
  .object({
    localCurrency: Currency,
    localExponent: z.number().int().min(0).max(6),
    closingRates: z.array(z.object({ currency: Currency, rateMicro: RateMicro }).strict()).max(100),
    items: z
      .array(
        z
          .object({
            docId: Id,
            side: z.enum(["asset", "liability"]),
            currency: Currency,
            exponent: z.number().int().min(0).max(6),
            openMinor: Minor,
            bookRateMicro: RateMicro,
          })
          .strict(),
      )
      .max(5000),
  })
  .strict()

function toLocal(amount: bigint, exponent: number, rateMicro: bigint, localExponent: number) {
  return rdiv(amount * rateMicro * 10n ** BigInt(localExponent), 10n ** BigInt(exponent) * 1_000_000n)
}

export function fxRevaluation(input: z.infer<typeof FxRevaluationInput>) {
  const a = FxRevaluationInput.parse(input)
  const rates = new Map<string, bigint>()
  for (const r of a.closingRates) {
    if (rates.has(r.currency)) throw new Error("duplicate closing rate")
    rates.set(r.currency, r.rateMicro)
  }
  const items: { docId: string; bookLocalMinor: bigint; closingLocalMinor: bigint; gainLossMinor: bigint }[] = []
  let gain = 0n
  let loss = 0n
  const seen = new Set<string>()
  for (const item of a.items) {
    if (seen.has(item.docId)) throw new Error("duplicate doc_id")
    seen.add(item.docId)
    if (item.currency === a.localCurrency) throw new Error("local-currency items are not revalued")
    const closingRate = rates.get(item.currency)
    if (closingRate === undefined) throw new Error("missing closing rate for an item currency")
    const book = toLocal(item.openMinor, item.exponent, item.bookRateMicro, a.localExponent)
    const closing = toLocal(item.openMinor, item.exponent, closingRate, a.localExponent)
    const delta = item.side === "asset" ? closing - book : book - closing
    gain += max(delta, 0n)
    loss += max(-delta, 0n)
    items.push({ docId: item.docId, bookLocalMinor: book, closingLocalMinor: closing, gainLossMinor: delta })
  }
  return checked({ localCurrency: a.localCurrency, items, gainMinor: gain, lossMinor: loss, netMinor: gain - loss })
}

// ── journal_check ──
export const JournalCheckInput = z
  .object({
    entryId: Id,
    postingDate: DateText,
    lockedPeriods: z.array(Month).max(240),
    lines: z
      .array(
        z
          .object({
            lineId: Id,
            accountId: Id,
            currency: Currency,
            debitMinor: Minor,
            creditMinor: Minor,
            requiredDimensionsPresent: z.boolean(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict()

type JournalReason = "both_sides" | "zero_line" | "missing_dimension" | "unbalanced_currency" | "locked_period" | "duplicate_line_id" | "no_lines"

export function journalCheck(input: z.infer<typeof JournalCheckInput>) {
  const a = JournalCheckInput.parse(input)
  const errors: { lineId: string | null; reason: JournalReason }[] = []
  const totals = new Map<string, [bigint, bigint]>()
  const seen = new Set<string>()
  const period = a.postingDate.slice(0, 7)
  if (a.lines.length === 0) errors.push({ lineId: null, reason: "no_lines" })
  if (a.lockedPeriods.includes(period)) errors.push({ lineId: null, reason: "locked_period" })
  for (const line of a.lines) {
    if (seen.has(line.lineId)) errors.push({ lineId: line.lineId, reason: "duplicate_line_id" })
    seen.add(line.lineId)
    if (line.debitMinor !== 0n && line.creditMinor !== 0n) errors.push({ lineId: line.lineId, reason: "both_sides" })
    if (line.debitMinor === 0n && line.creditMinor === 0n) errors.push({ lineId: line.lineId, reason: "zero_line" })
    if (!line.requiredDimensionsPresent) errors.push({ lineId: line.lineId, reason: "missing_dimension" })
    let t = totals.get(line.currency)
    if (!t) {
      t = [0n, 0n]
      totals.set(line.currency, t)
    }
    t[0] += line.debitMinor
    t[1] += line.creditMinor
  }
  const currencies = [...totals.keys()].sort().map((currency) => {
    const [debit, credit] = totals.get(currency)!
    if (debit !== credit) errors.push({ lineId: null, reason: "unbalanced_currency" })
    return { currency, debitMinor: debit, creditMinor: credit, differenceMinor: debit - credit }
  })
  return checked({ entryId: a.entryId, status: errors.length > 0 ? "invalid" : "valid", currencies, errors })
}

// ── depreciation_schedule ──
export const DepreciationScheduleInput = z
  .object({
    currency: Currency,
    costMinor: Minor,
    residualMinor: Minor,
    lifeMonths: z.number().int().min(1).max(600),
    acquisitionDate: DateText,
    firstMonthRule: z.enum(["acquisition_month", "following_month"]),
  })
  .strict()

export function depreciationSchedule(input: z.infer<typeof DepreciationScheduleInput>) {
  const a = DepreciationScheduleInput.parse(input)
  if (a.residualMinor > a.costMinor) throw new Error("residual exceeds cost")
  const depreciable = a.costMinor - a.residualMinor
  const acquired = fromDays(parseDate(a.acquisitionDate))
  let first = `${String(acquired.y).padStart(4, "0")}-${String(acquired.m).padStart(2, "0")}`
  if (a.firstMonthRule === "following_month") first = addMonths(first, 1)
  const n = a.lifeMonths
  const charges = depreciable !== 0n ? largestRemainder(depreciable, Array<bigint>(n).fill(1n)) : Array<bigint>(n).fill(0n)
  let accumulated = 0n
  const months = charges.map((chargeMinor, i) => {
    accumulated += chargeMinor
    return { month: addMonths(first, i), chargeMinor, accumulatedMinor: accumulated, netBookMinor: a.costMinor - accumulated }
  })
  // Source validates its output months against ^\d{4}-(0[1-9]|1[0-2])$ (year 10000 overflows).
  const lastMonth = months[months.length - 1]!.month
  if (!Month.safeParse(first).success) throw new Error("$ .first_month: invalid string")
  if (!Month.safeParse(lastMonth).success) throw new Error("$ .last_month: invalid string")
  const bad = months.findIndex((m) => !Month.safeParse(m.month).success)
  if (bad !== -1) throw new Error(`$ .months[${bad}].month: invalid string`)
  return checked({ currency: a.currency, depreciableMinor: depreciable, firstMonth: first, lastMonth, months })
}

// ── cash_projection ──
export const CashProjectionInput = z
  .object({
    asOf: DateText,
    granularity: z.enum(["week", "month"]),
    periods: z.number().int().min(1).max(26),
    holidays: Holidays,
    openingBalances: z.array(z.object({ currency: Currency, amountMinor: SignedMinor }).strict()).max(50),
    items: z
      .array(
        z
          .object({
            itemId: Id,
            currency: Currency,
            direction: z.enum(["in", "out"]),
            amountMinor: Minor,
            baseDate: DateText,
            termDays: z.number().int().min(0).max(3650),
            delayDays: z.number().int().min(0).max(365),
            status: z.enum(["confirmed", "expected"]),
            probabilityBps: Bps,
          })
          .strict(),
      )
      .max(20000),
  })
  .strict()

function periodStarts(asOf: number, granularity: "week" | "month", periods: number) {
  if (granularity === "week") {
    const start = addDays(asOf, -weekday(asOf))
    return Array.from({ length: periods }, (_, i) => addDays(start, 7 * i))
  }
  const { y, m } = fromDays(asOf)
  const first = isoDate(toDays(y, m, 1)).slice(0, 7)
  return Array.from({ length: periods }, (_, i) => parseDate(`${addMonths(first, i)}-01`))
}

export function cashProjection(input: z.infer<typeof CashProjectionInput>) {
  const a = CashProjectionInput.parse(input)
  const asOf = parseDate(a.asOf)
  const starts = periodStarts(asOf, a.granularity, a.periods)
  const last = starts[starts.length - 1]!
  const horizonEnd = a.granularity === "month" ? parseDate(`${addMonths(isoDate(last).slice(0, 7), 1)}-01`) : addDays(last, 7)
  const opening = new Map<string, bigint>()
  for (const b of a.openingBalances) {
    if (opening.has(b.currency)) throw new Error("duplicate opening balance currency")
    opening.set(b.currency, b.amountMinor)
  }
  type Bucket = { periods: [bigint, bigint, bigint, bigint][]; overdue: [bigint, bigint]; beyond: [bigint, bigint] }
  const data = new Map<string, Bucket>()
  const bucket = (currency: string) => {
    let c = data.get(currency)
    if (!c) {
      c = { periods: starts.map((): [bigint, bigint, bigint, bigint] => [0n, 0n, 0n, 0n]), overdue: [0n, 0n], beyond: [0n, 0n] }
      data.set(currency, c)
    }
    return c
  }
  const seen = new Set<string>()
  for (const item of a.items) {
    if (seen.has(item.itemId)) throw new Error("duplicate item_id")
    seen.add(item.itemId)
    if (item.status === "confirmed" && item.probabilityBps !== 10000) throw new Error("confirmed items must carry probability_bps 10000")
    const amount = item.status === "confirmed" ? item.amountMinor : rdiv(item.amountMinor * BigInt(item.probabilityBps), 10000n)
    let { day: when } = businessRoll(addDays(parseDate(item.baseDate), item.termDays + item.delayDays), a.holidays)
    const c = bucket(item.currency)
    const side = item.direction === "in" ? 0 : 1
    if (when < asOf) {
      c.overdue[side] += amount
      when = asOf
    }
    if (when >= horizonEnd) {
      c.beyond[side] += amount
      continue
    }
    let index = 0
    starts.forEach((s, i) => {
      if (s <= when) index = i
    })
    const column = (item.status === "confirmed" ? 0 : 1) + (side === 0 ? 0 : 2)
    c.periods[index]![column] += amount
  }
  const currencies = [...new Set([...data.keys(), ...opening.keys()])].sort().map((currency) => {
    const c = bucket(currency)
    const openingMinor = opening.get(currency) ?? 0n
    let balance = openingMinor
    let minimum = 0n
    let minimumStart = starts[0]!
    const periods = starts.map((start, i) => {
      const [ic, ie, oc, oe] = c.periods[i]!
      balance += ic + ie - oc - oe
      if (i === 0 || balance < minimum) {
        minimum = balance
        minimumStart = start
      }
      return { periodStart: isoDate(start), inConfirmedMinor: ic, inExpectedMinor: ie, outConfirmedMinor: oc, outExpectedMinor: oe, closingMinor: balance }
    })
    return {
      currency,
      openingMinor,
      overdueInMinor: c.overdue[0],
      overdueOutMinor: c.overdue[1],
      beyondHorizonInMinor: c.beyond[0],
      beyondHorizonOutMinor: c.beyond[1],
      periods,
      minimumClosingMinor: minimum,
      minimumPeriodStart: isoDate(minimumStart),
    }
  })
  return checked({ asOf: a.asOf, granularity: a.granularity, currencies })
}

// ── tiered_commission ──
export const TieredCommissionInput = z
  .object({
    currency: Currency,
    method: z.enum(["flat", "value_scale", "slab", "marginal", "stepped"]),
    baseMinor: Minor,
    reductionBps: Bps,
    deductionsMinor: Minor,
    flatBps: Bps,
    brackets: z.array(z.object({ fromMinor: Minor, bps: Bps, amountMinor: Minor }).strict()).max(20),
    capMinor: Minor.nullable(),
    priorAdjustedBaseMinor: Minor.nullable(),
    clientShareMode: z.enum(["none", "total", "percent", "fixed"]),
    clientShareBps: Bps,
    clientShareFixedMinor: Minor,
  })
  .strict()

type Bracket = { fromMinor: bigint; bps: number; amountMinor: bigint }

/** Source `_tier_value`: returns the commission and the matched bracket index. Brackets ascend by fromMinor. */
function tierValue(method: string, base: bigint, flatBps: number, brackets: Bracket[]): { value: bigint; idx: number | null } {
  if (method === "flat") return { value: rdiv(base * BigInt(flatBps), 10000n), idx: null }
  let idx: number | null = null
  for (let i = 0; i < brackets.length; i++) {
    if (base >= brackets[i]!.fromMinor) idx = i
  }
  if (method === "value_scale") return { value: idx === null ? 0n : brackets[idx]!.amountMinor, idx }
  if (method === "slab") return { value: idx === null ? 0n : rdiv(base * BigInt(brackets[idx]!.bps), 10000n), idx }
  if (idx === null) return { value: 0n, idx }
  if (method === "marginal") {
    // Reference behaviour: once the first threshold is reached, the first bracket is measured from zero.
    let total = 0n
    brackets.forEach((b, i) => {
      const lower = i === 0 ? 0n : b.fromMinor
      const top = i + 1 < brackets.length ? min(base, brackets[i + 1]!.fromMinor) : base
      if (top > lower) total += (top - lower) * BigInt(b.bps)
    })
    return { value: rdiv(total, 10000n), idx }
  }
  // stepped: base * first rate plus each later threshold's rate increment on the base above it.
  let total = base * BigInt(brackets[0]!.bps)
  for (let i = 1; i < brackets.length; i++) {
    if (base > brackets[i]!.fromMinor) total += (base - brackets[i]!.fromMinor) * BigInt(brackets[i]!.bps - brackets[i - 1]!.bps)
  }
  return { value: rdiv(total, 10000n), idx }
}

export function tieredCommission(input: z.infer<typeof TieredCommissionInput>) {
  const a = TieredCommissionInput.parse(input)
  const { method, brackets } = a
  if (method === "flat" && brackets.length > 0) throw new Error("flat method takes no brackets")
  if (method !== "flat") {
    if (brackets.length === 0) throw new Error("tier methods require brackets")
    if (brackets.some((b, i) => i > 0 && b.fromMinor <= brackets[i - 1]!.fromMinor)) throw new Error("brackets must strictly ascend by from_minor")
  }
  const adjusted = (base: bigint) => max(rdiv(base * BigInt(10000 - a.reductionBps), 10000n) - a.deductionsMinor, 0n)
  const capped = (value: bigint): [bigint, boolean] => (a.capMinor !== null && value > a.capMinor ? [a.capMinor, true] : [value, false])
  const current = adjusted(a.baseMinor)
  const tier = tierValue(method, current, a.flatBps, brackets)
  const [commission, capApplied] = capped(tier.value)
  let prior = 0n
  if (a.priorAdjustedBaseMinor !== null) prior = capped(tierValue(method, a.priorAdjustedBaseMinor, a.flatBps, brackets).value)[0]
  const period = commission - prior
  // Client rebates are computed on positive period commission only; a negative period is an agency-side reversal.
  let rebate: bigint
  if (a.clientShareMode === "none" || period <= 0n) rebate = 0n
  else if (a.clientShareMode === "total") rebate = period
  else if (a.clientShareMode === "percent") rebate = rdiv(period * BigInt(a.clientShareBps), 10000n)
  else rebate = min(a.clientShareFixedMinor, period)
  return checked({
    currency: a.currency,
    adjustedBaseMinor: current,
    commissionMinor: commission,
    capApplied,
    priorCommissionMinor: prior,
    periodCommissionMinor: period,
    clientRebateMinor: rebate,
    agencyRetainedMinor: period - rebate,
    bracketIndex: tier.idx,
  })
}

// ── flat_rebate ──
export const FlatRebateInput = z
  .object({
    currency: Currency,
    eligibleMinor: Minor,
    rateBps: Bps,
    clientShareBps: Bps,
  })
  .strict()

export function flatRebate(input: z.infer<typeof FlatRebateInput>) {
  const a = FlatRebateInput.parse(input)
  const rebate = rdiv(a.eligibleMinor * BigInt(a.rateBps), 10000n)
  const client = rdiv(rebate * BigInt(a.clientShareBps), 10000n)
  return checked({ currency: a.currency, rebateMinor: rebate, clientReturnMinor: client, agencyRetainedMinor: rebate - client })
}

// ── invoice_check ──
export const InvoiceCheckInput = z
  .object({
    currency: Currency,
    lines: z.array(z.object({ lineId: Id, netMinor: Minor, vatBps: Bps }).strict()).max(500),
    perceptionsMinor: Minor,
    otherChargesMinor: Minor,
    withholdingsNettedMinor: Minor,
    declaredTotalMinor: Minor,
    roundingToleranceMinor: z.bigint().min(0n).max(10000n),
  })
  .strict()

export function invoiceCheck(input: z.infer<typeof InvoiceCheckInput>) {
  const a = InvoiceCheckInput.parse(input)
  const ids = a.lines.map((l) => l.lineId)
  if (new Set(ids).size !== ids.length) throw new Error("duplicate line_id")
  const byRate = new Map<number, [bigint, bigint]>()
  for (const line of a.lines) {
    let r = byRate.get(line.vatBps)
    if (!r) {
      r = [0n, 0n]
      byRate.set(line.vatBps, r)
    }
    r[0] += line.netMinor
    r[1] += rdiv(line.netMinor * BigInt(line.vatBps), 10000n)
  }
  const rates = [...byRate.keys()].sort((x, y) => x - y)
  const net = rates.reduce((s, k) => s + byRate.get(k)![0], 0n)
  const vat = rates.reduce((s, k) => s + byRate.get(k)![1], 0n)
  const computed = net + vat + a.perceptionsMinor + a.otherChargesMinor - a.withholdingsNettedMinor
  const diff = a.declaredTotalMinor - computed
  const absDiff = diff < 0n ? -diff : diff
  const status = diff === 0n ? "matched" : absDiff <= a.roundingToleranceMinor ? "rounding_adjustment" : "mismatch"
  return checked({
    currency: a.currency,
    netMinor: net,
    vatMinor: vat,
    computedTotalMinor: computed,
    differenceMinor: diff,
    status,
    vatByRate: rates.map((vatBps) => ({ vatBps, netMinor: byRate.get(vatBps)![0], vatMinor: byRate.get(vatBps)![1] })),
  })
}
