// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  aging,
  cashProjection,
  depreciationSchedule,
  flatRebate,
  fxRevaluation,
  invoiceCheck,
  journalCheck,
  paymentTerms,
  tieredCommission,
  withholding,
} from "@/server/calculators/finance"

import vectors from "../fixtures/core3-finance-vectors.json"

type V = { tool: string; input: Record<string, unknown>; output?: Record<string, unknown>; error?: string; schema?: boolean }

// Parity: every vector was produced by the source agency_tools.py (python3 -I).
// Vectors use the source snake_case/number shape; convert to the camelCase/bigint API and back.
const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const BIGINT_KEYS = new Set(["rateMicro", "bookRateMicro"])

function toTs(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((x) => toTs(x, key))
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), toTs(v, camel(k))]))
  if (typeof value === "number" && (key.endsWith("Minor") || BIGINT_KEYS.has(key))) return BigInt(value)
  return value
}

function fromTs(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value)
  if (Array.isArray(value)) return value.map(fromTs)
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [snake(k), fromTs(v)]))
  return value
}

const tools: Record<string, (input: never) => unknown> = {
  aging,
  withholding,
  payment_terms: paymentTerms,
  fx_revaluation: fxRevaluation,
  journal_check: journalCheck,
  depreciation_schedule: depreciationSchedule,
  cash_projection: cashProjection,
  tiered_commission: tieredCommission,
  flat_rebate: flatRebate,
  invoice_check: invoiceCheck,
}
const call = (tool: string, input: unknown) => (tools[tool] as (i: unknown) => unknown)(toTs(input))

describe("core-3 finance calculators parity with agency_tools.py", () => {
  for (const [i, v] of (vectors as unknown as V[]).entries()) {
    it(`${v.tool} #${i}${v.error === undefined ? "" : " (error)"}`, () => {
      if (v.error === undefined) {
        expect(fromTs(call(v.tool, v.input))).toEqual(v.output)
      } else if (v.schema) {
        expect(() => call(v.tool, v.input)).toThrow()
      } else {
        expect(() => call(v.tool, v.input)).toThrow(new Error(v.error))
      }
    })
  }

  it("has at least three vectors per calculator", () => {
    const counts = new Map<string, number>()
    for (const v of vectors as unknown as V[]) counts.set(v.tool, (counts.get(v.tool) ?? 0) + 1)
    expect([...counts.keys()].sort()).toEqual(Object.keys(tools).sort())
    for (const n of counts.values()) expect(n).toBeGreaterThanOrEqual(3)
  })
})

describe("aging", () => {
  const base = { asOf: "2027-03-15", bucketLimitsDays: [30, 60, 90] }

  it("puts an invoice 42 days overdue in the 31-60 bucket", () => {
    const r = aging({ ...base, items: [{ docId: "INV-001", currency: "USD", dueDate: "2027-02-01", openMinor: 25000n }] })
    expect(r.currencies).toHaveLength(1)
    const usd = r.currencies[0]!
    expect(usd.weightedDaysOverdue).toBe(42)
    expect(usd.totalMinor).toBe(25000n)
    expect(usd.notDueMinor).toBe(0n)
    expect(usd.buckets).toEqual([
      { fromDays: 1, toDays: 30, amountMinor: 0n },
      { fromDays: 31, toDays: 60, amountMinor: 25000n },
      { fromDays: 61, toDays: 90, amountMinor: 0n },
      { fromDays: 91, toDays: null, amountMinor: 0n },
    ])
  })

  it("splits multi-currency items, keeps not-due separate and sorts currencies", () => {
    const r = aging({
      ...base,
      items: [
        { docId: "e-1", currency: "EUR", dueDate: "2027-02-01", openMinor: 12000n },
        { docId: "u-1", currency: "USD", dueDate: "2027-03-15", openMinor: 10000n },
        { docId: "u-2", currency: "USD", dueDate: "2026-12-14", openMinor: 8000n },
        { docId: "g-1", currency: "GBP", dueDate: "2027-01-01", openMinor: -500n },
      ],
    })
    expect(r.currencies.map((c) => c.currency)).toEqual(["EUR", "GBP", "USD"])
    const [eur, gbp, usd] = r.currencies
    expect(eur!.buckets[1]!.amountMinor).toBe(12000n)
    expect(gbp!.weightedDaysOverdue).toBeNull()
    expect(usd!.notDueMinor).toBe(10000n)
    expect(usd!.buckets[3]!.amountMinor).toBe(8000n)
    expect(usd!.totalMinor).toBe(18000n)
  })

  it("rejects non-ascending limits, duplicate documents and impossible dates", () => {
    const item = { docId: "a", currency: "USD", dueDate: "2027-02-01", openMinor: 1n }
    expect(() => aging({ ...base, bucketLimitsDays: [30, 30, 90], items: [item] })).toThrow("bucket limits must strictly ascend")
    expect(() => aging({ ...base, items: [item, item] })).toThrow("duplicate doc_id")
    expect(() => aging({ ...base, items: [{ ...item, dueDate: "2027-02-30" }] })).toThrow("invalid calendar date")
  })
})

describe("withholding", () => {
  const base = {
    currency: "USD",
    method: "per_payment" as const,
    paymentBaseMinor: 0n,
    accumulatedBaseMinor: 0n,
    accumulatedWithheldMinor: 0n,
    nonTaxableMinimumMinor: 0n,
    rateBps: 0,
    minimumWithholdingMinor: 0n,
  }

  it("per_payment withholds on the base above the non-taxable minimum", () => {
    expect(withholding({ ...base, paymentBaseMinor: 1_000_000n, nonTaxableMinimumMinor: 100_000n, rateBps: 200 })).toEqual({
      currency: "USD",
      taxableBaseMinor: 900_000n,
      withholdingMinor: 18_000n,
      belowMinimum: false,
    })
  })

  it("cumulative_period nets what was already withheld in the period", () => {
    const r = withholding({
      ...base,
      method: "cumulative_period",
      paymentBaseMinor: 300_000n,
      accumulatedBaseMinor: 500_000n,
      accumulatedWithheldMinor: 5_000n,
      nonTaxableMinimumMinor: 100_000n,
      rateBps: 300,
    })
    expect(r.taxableBaseMinor).toBe(700_000n)
    expect(r.withholdingMinor).toBe(16_000n)
    expect(r.belowMinimum).toBe(false)
  })

  it("zeroes an amount below the minimum withholding and flags it", () => {
    const r = withholding({ ...base, paymentBaseMinor: 20_000n, rateBps: 200, minimumWithholdingMinor: 500n })
    expect(r).toEqual({ currency: "USD", taxableBaseMinor: 20_000n, withholdingMinor: 0n, belowMinimum: true })
  })
})

describe("payment_terms", () => {
  const base = { baseDate: "2027-03-10", termDays: 30, rule: "net_days" as const, delayDays: 0, holidays: [] as string[], weekendRoll: true }

  it("net_days landing on a Saturday rolls to Monday", () => {
    expect(paymentTerms({ ...base, baseDate: "2027-03-12", termDays: 1 })).toEqual({
      dueDate: "2027-03-15",
      expectedDate: "2027-03-15",
      dueRolledDays: 2,
      expectedRolledDays: 0,
    })
    expect(paymentTerms({ ...base, baseDate: "2027-03-12", termDays: 1, weekendRoll: false }).dueDate).toBe("2027-03-13")
  })

  it("end_of_month_then_days counts from the month end", () => {
    const r = paymentTerms({ ...base, baseDate: "2027-02-10", rule: "end_of_month_then_days" })
    expect(r.dueDate).toBe("2027-03-30")
  })

  it("next_fortnight anchors on the 15th or the month end", () => {
    expect(paymentTerms({ ...base, baseDate: "2027-03-10", termDays: 10, rule: "next_fortnight" }).dueDate).toBe("2027-03-25")
    expect(paymentTerms({ ...base, baseDate: "2027-03-20", termDays: 15, rule: "next_fortnight" }).dueDate).toBe("2027-04-15")
  })

  it("rolls past consecutive holidays after the weekend and applies the delay", () => {
    const r = paymentTerms({ ...base, baseDate: "2027-03-01", termDays: 14, holidays: ["2027-03-15", "2027-03-16", "2027-03-17"] })
    expect(r.dueDate).toBe("2027-03-18")
    expect(r.dueRolledDays).toBe(3)
    const delayed = paymentTerms({ ...base, baseDate: "2027-03-05", termDays: 7, delayDays: 3, holidays: ["2027-03-15"] })
    expect(delayed.dueDate).toBe("2027-03-12")
    expect(delayed.expectedDate).toBe("2027-03-16")
  })

  it("rejects an invalid calendar date and an unbounded holiday calendar", () => {
    expect(() => paymentTerms({ ...base, baseDate: "2027-02-30" })).toThrow("invalid calendar date")
    const holidays = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2027, 2, 15 + i)).toISOString().slice(0, 10))
    expect(() => paymentTerms({ ...base, baseDate: "2027-03-15", termDays: 0, holidays })).toThrow("holiday calendar blocks more than 31 consecutive days")
  })
})

describe("fx_revaluation", () => {
  it("books a loss on a liability when the foreign currency strengthens", () => {
    const r = fxRevaluation({
      localCurrency: "USD",
      localExponent: 2,
      closingRates: [{ currency: "CAD", rateMicro: 780000n }],
      items: [{ docId: "DOC-1", side: "liability", currency: "CAD", exponent: 2, openMinor: 100000n, bookRateMicro: 750000n }],
    })
    expect(r.items).toEqual([{ docId: "DOC-1", bookLocalMinor: 75000n, closingLocalMinor: 78000n, gainLossMinor: -3000n }])
    expect(r.gainMinor).toBe(0n)
    expect(r.lossMinor).toBe(3000n)
    expect(r.netMinor).toBe(-3000n)
  })

  it("rejects duplicate rates, local-currency items and missing rates", () => {
    const item = { docId: "d", side: "asset" as const, currency: "CAD", exponent: 2, openMinor: 1n, bookRateMicro: 780000n }
    const rates = [{ currency: "CAD", rateMicro: 780000n }]
    const input = { localCurrency: "USD", localExponent: 2, closingRates: rates, items: [item] }
    expect(() => fxRevaluation({ ...input, closingRates: [...rates, ...rates] })).toThrow("duplicate closing rate")
    expect(() => fxRevaluation({ ...input, items: [{ ...item, currency: "USD" }] })).toThrow("local-currency items are not revalued")
    expect(() => fxRevaluation({ ...input, items: [{ ...item, currency: "MXN" }] })).toThrow("missing closing rate for an item currency")
  })
})

describe("journal_check", () => {
  const line = (lineId: string, debitMinor: bigint, creditMinor: bigint) => ({
    lineId,
    accountId: "1100",
    currency: "USD",
    debitMinor,
    creditMinor,
    requiredDimensionsPresent: true,
  })
  const entry = (lines: ReturnType<typeof line>[], lockedPeriods: string[] = []) => ({ entryId: "JE-1", postingDate: "2027-03-15", lockedPeriods, lines })
  const reasons = (r: ReturnType<typeof journalCheck>) => r.errors.map((e) => e.reason)

  it("accepts a balanced two-line entry", () => {
    const r = journalCheck(entry([line("l1", 10000n, 0n), line("l2", 0n, 10000n)]))
    expect(r.status).toBe("valid")
    expect(r.errors).toEqual([])
    expect(r.currencies).toEqual([{ currency: "USD", debitMinor: 10000n, creditMinor: 10000n, differenceMinor: 0n }])
  })

  it("flags an unbalanced currency (10000 vs 9000)", () => {
    const r = journalCheck(entry([line("l1", 10000n, 0n), line("l2", 0n, 9000n)]))
    expect(r.status).toBe("invalid")
    expect(r.errors).toEqual([{ lineId: null, reason: "unbalanced_currency" }])
    expect(r.currencies[0]!.differenceMinor).toBe(1000n)
  })

  it("flags a locked period, both sides, zero line, duplicate id and no lines", () => {
    const ok = [line("l1", 10000n, 0n), line("l2", 0n, 10000n)]
    expect(reasons(journalCheck(entry(ok, ["2027-03"])))).toEqual(["locked_period"])
    expect(journalCheck(entry([line("l1", 10000n, 500n), line("l2", 0n, 9500n)])).errors).toEqual([{ lineId: "l1", reason: "both_sides" }])
    expect(journalCheck(entry([...ok, line("l3", 0n, 0n)])).errors).toEqual([{ lineId: "l3", reason: "zero_line" }])
    expect(journalCheck(entry([line("l1", 10000n, 0n), line("l1", 0n, 10000n)])).errors).toEqual([{ lineId: "l1", reason: "duplicate_line_id" }])
    expect(journalCheck(entry([])).errors).toEqual([{ lineId: null, reason: "no_lines" }])
  })
})

describe("depreciation_schedule", () => {
  const base = {
    currency: "USD",
    costMinor: 120000n,
    residualMinor: 0n,
    lifeMonths: 12,
    acquisitionDate: "2027-03-01",
    firstMonthRule: "acquisition_month" as const,
  }

  it("charges 10000 per month for 120000 over 12 months", () => {
    const r = depreciationSchedule(base)
    expect(r.depreciableMinor).toBe(120000n)
    expect(r.firstMonth).toBe("2027-03")
    expect(r.lastMonth).toBe("2028-02")
    expect(r.months).toHaveLength(12)
    expect(r.months.every((m) => m.chargeMinor === 10000n)).toBe(true)
    expect(r.months[11]).toEqual({ month: "2028-02", chargeMinor: 10000n, accumulatedMinor: 120000n, netBookMinor: 0n })
  })

  it("gives the remainder to the earliest months and conserves the total", () => {
    const r = depreciationSchedule({ ...base, costMinor: 100001n, lifeMonths: 7 })
    expect(r.months.map((m) => m.chargeMinor)).toEqual([14286n, 14286n, 14286n, 14286n, 14286n, 14286n, 14285n])
    expect(r.months[6]!.accumulatedMinor).toBe(100001n)
  })

  it("following_month starts the month after acquisition", () => {
    const r = depreciationSchedule({ ...base, acquisitionDate: "2027-11-15", firstMonthRule: "following_month", lifeMonths: 3 })
    expect(r.months.map((m) => m.month)).toEqual(["2027-12", "2028-01", "2028-02"])
  })

  it("rejects residual above cost and impossible dates", () => {
    expect(() => depreciationSchedule({ ...base, costMinor: 1000n, residualMinor: 1001n })).toThrow("residual exceeds cost")
    expect(() => depreciationSchedule({ ...base, acquisitionDate: "2027-02-30" })).toThrow("invalid calendar date")
  })
})

describe("cash_projection", () => {
  const item = (itemId: string, direction: "in" | "out", amountMinor: bigint, baseDate: string, over: Record<string, unknown> = {}) => ({
    itemId,
    currency: "USD",
    direction,
    amountMinor,
    baseDate,
    termDays: 0,
    delayDays: 0,
    status: "confirmed" as const,
    probabilityBps: 10000,
    ...over,
  })

  it("projects confirmed, expected, overdue and beyond-horizon items by month", () => {
    const r = cashProjection({
      asOf: "2027-03-15",
      granularity: "month",
      periods: 3,
      holidays: [],
      openingBalances: [{ currency: "USD", amountMinor: 1_000_000n }],
      items: [
        item("in-1", "in", 4_000_000n, "2027-03-10", { termDays: 15 }),
        item("in-2", "in", 2_000_000n, "2027-04-01", { termDays: 30, delayDays: 5, status: "expected", probabilityBps: 5000 }),
        item("out-1", "out", 1_500_000n, "2027-03-20", { termDays: 10 }),
        item("in-overdue", "in", 300_000n, "2027-02-01", { termDays: 30 }),
        item("out-beyond", "out", 700_000n, "2027-06-15", { termDays: 30 }),
      ],
    })
    expect(r.currencies).toHaveLength(1)
    const usd = r.currencies[0]!
    expect(usd.openingMinor).toBe(1_000_000n)
    expect(usd.overdueInMinor).toBe(300_000n)
    expect(usd.beyondHorizonOutMinor).toBe(700_000n)
    expect(usd.periods.map((p) => p.periodStart)).toEqual(["2027-03-01", "2027-04-01", "2027-05-01"])
    expect(usd.periods[0]).toEqual({
      periodStart: "2027-03-01",
      inConfirmedMinor: 4_300_000n,
      inExpectedMinor: 0n,
      outConfirmedMinor: 1_500_000n,
      outExpectedMinor: 0n,
      closingMinor: 3_800_000n,
    })
    expect(usd.periods[2]!.inExpectedMinor).toBe(1_000_000n)
    expect(usd.periods[2]!.closingMinor).toBe(4_800_000n)
    expect(usd.minimumClosingMinor).toBe(3_800_000n)
    expect(usd.minimumPeriodStart).toBe("2027-03-01")
  })

  it("week granularity starts on Monday and rolls a Saturday item to the next week", () => {
    const r = cashProjection({
      asOf: "2027-03-17",
      granularity: "week",
      periods: 2,
      holidays: [],
      openingBalances: [{ currency: "USD", amountMinor: 5000n }],
      items: [item("w-1", "out", 1000n, "2027-03-20")],
    })
    const usd = r.currencies[0]!
    expect(usd.periods.map((p) => p.periodStart)).toEqual(["2027-03-15", "2027-03-22"])
    expect(usd.periods[0]!.closingMinor).toBe(5000n)
    expect(usd.periods[1]!.outConfirmedMinor).toBe(1000n)
    expect(usd.periods[1]!.closingMinor).toBe(4000n)
    expect(usd.minimumClosingMinor).toBe(4000n)
  })

  it("rejects a confirmed item with probability other than 10000 and duplicate ids", () => {
    const input = { asOf: "2027-03-15", granularity: "month" as const, periods: 1, holidays: [], openingBalances: [] }
    expect(() => cashProjection({ ...input, items: [item("c", "in", 100n, "2027-03-20", { probabilityBps: 5000 })] })).toThrow(
      "confirmed items must carry probability_bps 10000",
    )
    expect(() => cashProjection({ ...input, items: [item("d", "in", 1n, "2027-03-20"), item("d", "out", 2n, "2027-03-21")] })).toThrow("duplicate item_id")
  })
})

describe("tiered_commission", () => {
  const base = {
    currency: "USD",
    method: "flat" as const,
    baseMinor: 0n,
    reductionBps: 0,
    deductionsMinor: 0n,
    flatBps: 0,
    brackets: [] as { fromMinor: bigint; bps: number; amountMinor: bigint }[],
    capMinor: null as bigint | null,
    priorAdjustedBaseMinor: null as bigint | null,
    clientShareMode: "none" as "none" | "total" | "percent" | "fixed",
    clientShareBps: 0,
    clientShareFixedMinor: 0n,
  }
  const bracket = (fromMinor: bigint, bps: number, amountMinor = 0n) => ({ fromMinor, bps, amountMinor })

  it("flat applies the rate to the adjusted base", () => {
    const r = tieredCommission({ ...base, baseMinor: 1_000_000n, flatBps: 250 })
    expect(r.commissionMinor).toBe(25_000n)
    expect(r.bracketIndex).toBeNull()
    expect(tieredCommission({ ...base, baseMinor: 1_000_000n, flatBps: 250, reductionBps: 1000, deductionsMinor: 5000n }).adjustedBaseMinor).toBe(895_000n)
  })

  it("value_scale, slab, marginal and stepped pick the matched bracket", () => {
    const vs = [bracket(500_000n, 0, 10_000n), bracket(1_000_000n, 0, 25_000n), bracket(2_000_000n, 0, 60_000n)]
    expect(tieredCommission({ ...base, method: "value_scale", brackets: vs, baseMinor: 1_500_000n })).toMatchObject({ commissionMinor: 25_000n, bracketIndex: 1 })
    expect(tieredCommission({ ...base, method: "value_scale", brackets: vs, baseMinor: 100n })).toMatchObject({ commissionMinor: 0n, bracketIndex: null })
    const slab = [bracket(100_000n, 100), bracket(500_000n, 150), bracket(1_000_000n, 200)]
    expect(tieredCommission({ ...base, method: "slab", brackets: slab, baseMinor: 600_000n })).toMatchObject({ commissionMinor: 9_000n, bracketIndex: 1 })
    const marginal = [bracket(100_000n, 100), bracket(500_000n, 200), bracket(1_000_000n, 300)]
    expect(tieredCommission({ ...base, method: "marginal", brackets: marginal, baseMinor: 750_000n })).toMatchObject({ commissionMinor: 10_000n, bracketIndex: 1 })
    const stepped = [bracket(100_000n, 100), bracket(500_000n, 250), bracket(1_000_000n, 400)]
    expect(tieredCommission({ ...base, method: "stepped", brackets: stepped, baseMinor: 1_200_000n })).toMatchObject({ commissionMinor: 25_500n, bracketIndex: 2 })
  })

  it("caps the commission and reports it", () => {
    const r = tieredCommission({ ...base, baseMinor: 10_000_000n, flatBps: 500, capMinor: 300_000n })
    expect(r.commissionMinor).toBe(300_000n)
    expect(r.capApplied).toBe(true)
  })

  it("subtracts the prior-period commission and splits it with the client", () => {
    const percent = tieredCommission({
      ...base,
      baseMinor: 1_000_000n,
      flatBps: 250,
      priorAdjustedBaseMinor: 400_000n,
      clientShareMode: "percent",
      clientShareBps: 5000,
    })
    expect(percent).toMatchObject({ priorCommissionMinor: 10_000n, periodCommissionMinor: 15_000n, clientRebateMinor: 7_500n, agencyRetainedMinor: 7_500n })
    const fixed = tieredCommission({ ...base, baseMinor: 100_000n, flatBps: 1000, priorAdjustedBaseMinor: 20_000n, clientShareMode: "fixed", clientShareFixedMinor: 5000n })
    expect(fixed).toMatchObject({ periodCommissionMinor: 8_000n, clientRebateMinor: 5_000n, agencyRetainedMinor: 3_000n })
    const total = tieredCommission({ ...base, baseMinor: 100_000n, flatBps: 1000, clientShareMode: "total" })
    expect(total).toMatchObject({ periodCommissionMinor: 10_000n, clientRebateMinor: 10_000n, agencyRetainedMinor: 0n })
  })

  it("rejects flat with brackets, tier methods without brackets and unsorted brackets", () => {
    expect(() => tieredCommission({ ...base, baseMinor: 1n, flatBps: 1, brackets: [bracket(1n, 1)] })).toThrow("flat method takes no brackets")
    expect(() => tieredCommission({ ...base, method: "slab", baseMinor: 1n })).toThrow("tier methods require brackets")
    expect(() => tieredCommission({ ...base, method: "slab", baseMinor: 1n, brackets: [bracket(500_000n, 100), bracket(100_000n, 200)] })).toThrow(
      "brackets must strictly ascend by from_minor",
    )
  })
})

describe("flat_rebate", () => {
  it("splits a 2% rebate on 1,000,000 with a 50% client share", () => {
    expect(flatRebate({ currency: "USD", eligibleMinor: 1_000_000n, rateBps: 200, clientShareBps: 5000 })).toEqual({
      currency: "USD",
      rebateMinor: 20_000n,
      clientReturnMinor: 10_000n,
      agencyRetainedMinor: 10_000n,
    })
  })

  it("rejects unknown keys and out-of-range rates", () => {
    expect(() => flatRebate({ currency: "USD", eligibleMinor: 1n, rateBps: 1, clientShareBps: 1, extra: 1 } as never)).toThrow()
    expect(() => flatRebate({ currency: "USD", eligibleMinor: 1n, rateBps: 10001, clientShareBps: 1 })).toThrow()
  })
})

describe("invoice_check", () => {
  const base = { currency: "USD", perceptionsMinor: 0n, otherChargesMinor: 0n, withholdingsNettedMinor: 0n, roundingToleranceMinor: 0n }

  it("matches net 10000 + VAT 500 bps to a declared 10500", () => {
    const r = invoiceCheck({ ...base, lines: [{ lineId: "l1", netMinor: 10000n, vatBps: 500 }], declaredTotalMinor: 10500n })
    expect(r).toMatchObject({ netMinor: 10000n, vatMinor: 500n, computedTotalMinor: 10500n, differenceMinor: 0n, status: "matched" })
    expect(r.vatByRate).toEqual([{ vatBps: 500, netMinor: 10000n, vatMinor: 500n }])
  })

  it("reports a mismatch beyond the tolerance", () => {
    const r = invoiceCheck({ ...base, roundingToleranceMinor: 10n, lines: [{ lineId: "l1", netMinor: 10000n, vatBps: 500 }], declaredTotalMinor: 10700n })
    expect(r.status).toBe("mismatch")
    expect(r.differenceMinor).toBe(200n)
  })

  it("reports a rounding adjustment within the tolerance, grouped and sorted by rate", () => {
    const r = invoiceCheck({
      ...base,
      roundingToleranceMinor: 5n,
      lines: [
        { lineId: "l1", netMinor: 3333n, vatBps: 2100 },
        { lineId: "l2", netMinor: 1111n, vatBps: 1050 },
        { lineId: "l3", netMinor: 2000n, vatBps: 0 },
      ],
      declaredTotalMinor: 7263n,
    })
    expect(r.computedTotalMinor).toBe(7261n)
    expect(r.differenceMinor).toBe(2n)
    expect(r.status).toBe("rounding_adjustment")
    expect(r.vatByRate.map((x) => x.vatBps)).toEqual([0, 1050, 2100])
  })

  it("rejects a duplicate line_id", () => {
    const lines = [
      { lineId: "dup", netMinor: 100n, vatBps: 0 },
      { lineId: "dup", netMinor: 200n, vatBps: 0 },
    ]
    expect(() => invoiceCheck({ ...base, lines, declaredTotalMinor: 300n })).toThrow("duplicate line_id")
  })
})
