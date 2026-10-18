// @vitest-environment node
import vectors from "@/tests/fixtures/digest-vectors.json"
import { canonicalJson, CanonicalJsonError } from "@/lib/canonical-json"
import {
  add,
  CurrencyMismatchError,
  divHalfUp,
  formatBps,
  formatMoney,
  money,
  parseDecimalToMinor,
  ratioBps,
} from "@/lib/money"
import { budgetCheck, jobNumber, margin, payloadDigest, reconcile } from "@/server/calculators"

describe("exact money", () => {
  it("parses decimals into minor units without floats", () => {
    expect(parseDecimalToMinor("23000", "USD")).toBe(2300000n)
    expect(parseDecimalToMinor("23,000.50", "USD")).toBe(2300050n)
    expect(parseDecimalToMinor("0.1", "USD")).toBe(10n)
    expect(() => parseDecimalToMinor("1.005", "USD")).toThrow()
    expect(() => parseDecimalToMinor("1e3", "USD")).toThrow()
  })

  it("never adds different currencies", () => {
    expect(add(money(100n, "USD"), money(5n, "USD")).amountMinor).toBe(105n)
    expect(() => add(money(100n, "USD"), money(5n, "CAD"))).toThrow(CurrencyMismatchError)
  })

  it("rounds HALF_UP and formats bps and money exactly", () => {
    expect(divHalfUp(5n, 2n)).toBe(3n)
    expect(divHalfUp(-5n, 2n)).toBe(-3n)
    expect(ratioBps(1000000n, 2300000n)).toBe(4348)
    expect(formatBps(4348, "en")).toBe("43.5%")
    // Spanish UI targets es-MX, which uses a decimal point.
    expect(formatBps(3500, "es")).toBe("35.0%")
    expect(formatMoney(5300000n, "USD", "en")).toBe("USD 53,000.00")
    expect(formatMoney("123456789012345678", "USD", "en")).toBe("USD 1,234,567,890,123,456.78")
  })
})

describe("payload_digest parity with python-json-sorted-v1", () => {
  it.each(vectors.vectors.map((v) => [v.canonical, v] as const))("%s", (_label, v) => {
    expect(canonicalJson(v.input)).toBe(v.canonical)
    expect(payloadDigest(v.input).sha256).toBe(v.sha256)
  })

  it("rejects floats and non-finite numbers instead of diverging from Python", () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow(CanonicalJsonError)
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(CanonicalJsonError)
    expect(payloadDigest({ a: 1 }).authorizesExecution).toBe(false)
  })
})

describe("calculators", () => {
  it("margin reproduces the Aurora checkpoints", () => {
    const m = (fee: bigint, cost: bigint) =>
      margin({ currency: "USD", agencyRevenueMinor: fee, agencyCostMinor: cost, managedSpendMinor: 3000000n })
    expect(m(2000000n, 1100000n).marginBps).toBe(4500)
    expect(m(2000000n, 1300000n).marginBps).toBe(3500)
    expect(m(2300000n, 1300000n)).toMatchObject({ marginMinor: 1000000n, marginBps: 4348 })
    expect(m(0n, 0n).marginBps).toBeNull()
  })

  it("job_number composes the canonical code separate from the friendly alias", () => {
    expect(jobNumber({ clientCode: "AUR", productCode: "SL", year: 2027, jobType: "A", billingCode: "F", sequence: 1 }).code).toBe("AURSL7AF0001")
    expect(jobNumber({ clientCode: "AUR", productCode: "SL", year: 2027, jobType: "N", billingCode: "F", sequence: 2 }).warnings).toContain("typology_forbids_sales")
  })

  it("budget_check and reconcile follow the source contract", () => {
    expect(budgetCheck({ currency: "USD", authorizedMinor: 100000n, spentMinor: 0n, openCommitmentsMinor: 0n, reservationsMinor: 70000n, requestedMinor: 70000n })).toMatchObject({ withinBudget: false, availableMinor: 30000n })
    expect(reconcile({ currency: "USD", orderedMinor: 550000n, deliveredMinor: 550000n, invoicedMinor: 600000n, toleranceMinor: 0n })).toMatchObject({ status: "hold", discrepancyMinor: 50000n, payableCandidateMinor: 550000n })
  })
})
