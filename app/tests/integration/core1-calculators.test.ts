// @vitest-environment node
// Parity of Core-1 calculators with the source ERP (agency_tools.py
// _hourly_fee_settlement). Vectors produced by the Python source with
// `python3 -I` (scratchpad core1-scripts/hourly_vectors.py); no DB needed.
import { hourlyFeeSettlement } from "@/server/calculators/clients"

type PyHours = { person_id: string; approved_hours_hundredths: number; client_rate_minor: number }
type PyIn = { currency: string; instalment_minor: number; covered_hours_hundredths: number; hours: PyHours[]; overage_policy: "bill_at_client_rate" | "absorb" }
type PyOut = {
  currency: string
  implied_rate_minor: number
  total_hours_hundredths: number
  overage_hours_hundredths: number
  unused_hours_hundredths: number
  overage_minor: number
  total_billable_minor: number
  per_person: { person_id: string; overage_hours_hundredths: number; overage_minor: number }[]
}

const VECTORS = [{"input": {"currency": "MXN", "instalment_minor": 5000000, "covered_hours_hundredths": 10000, "hours": [{"person_id": "C-01", "approved_hours_hundredths": 7000, "client_rate_minor": 60000}, {"person_id": "C-02", "approved_hours_hundredths": 4200, "client_rate_minor": 45000}], "overage_policy": "bill_at_client_rate"}, "output": {"currency": "MXN", "implied_rate_minor": 50000, "total_hours_hundredths": 11200, "overage_hours_hundredths": 1200, "unused_hours_hundredths": 0, "overage_minor": 652500, "total_billable_minor": 5652500, "per_person": [{"person_id": "C-01", "overage_hours_hundredths": 750, "overage_minor": 450000}, {"person_id": "C-02", "overage_hours_hundredths": 450, "overage_minor": 202500}]}}, {"input": {"currency": "USD", "instalment_minor": 100000, "covered_hours_hundredths": 1000, "hours": [{"person_id": "a", "approved_hours_hundredths": 1200, "client_rate_minor": 0}], "overage_policy": "absorb"}, "output": {"currency": "USD", "implied_rate_minor": 10000, "total_hours_hundredths": 1200, "overage_hours_hundredths": 200, "unused_hours_hundredths": 0, "overage_minor": 0, "total_billable_minor": 100000, "per_person": [{"person_id": "a", "overage_hours_hundredths": 200, "overage_minor": 0}]}}, {"input": {"currency": "USD", "instalment_minor": 2300000, "covered_hours_hundredths": 14000, "hours": [], "overage_policy": "absorb"}, "output": {"currency": "USD", "implied_rate_minor": 16429, "total_hours_hundredths": 0, "overage_hours_hundredths": 0, "unused_hours_hundredths": 14000, "overage_minor": 0, "total_billable_minor": 2300000, "per_person": []}}, {"input": {"currency": "USD", "instalment_minor": 99999, "covered_hours_hundredths": 333, "hours": [{"person_id": "p1", "approved_hours_hundredths": 111, "client_rate_minor": 12345}, {"person_id": "p2", "approved_hours_hundredths": 111, "client_rate_minor": 6789}, {"person_id": "p3", "approved_hours_hundredths": 112, "client_rate_minor": 1}], "overage_policy": "bill_at_client_rate"}, "output": {"currency": "USD", "implied_rate_minor": 30030, "total_hours_hundredths": 334, "overage_hours_hundredths": 1, "unused_hours_hundredths": 0, "overage_minor": 0, "total_billable_minor": 99999, "per_person": [{"person_id": "p1", "overage_hours_hundredths": 0, "overage_minor": 0}, {"person_id": "p2", "overage_hours_hundredths": 0, "overage_minor": 0}, {"person_id": "p3", "overage_hours_hundredths": 1, "overage_minor": 0}]}}, {"input": {"currency": "USD", "instalment_minor": 1, "covered_hours_hundredths": 3, "hours": [{"person_id": "x", "approved_hours_hundredths": 5, "client_rate_minor": 150}, {"person_id": "y", "approved_hours_hundredths": 5, "client_rate_minor": 250}], "overage_policy": "bill_at_client_rate"}, "output": {"currency": "USD", "implied_rate_minor": 33, "total_hours_hundredths": 10, "overage_hours_hundredths": 7, "unused_hours_hundredths": 0, "overage_minor": 14, "total_billable_minor": 15, "per_person": [{"person_id": "x", "overage_hours_hundredths": 4, "overage_minor": 6}, {"person_id": "y", "overage_hours_hundredths": 3, "overage_minor": 8}]}}, {"error": "duplicate person_id"}] as ({ input: PyIn; output: PyOut } | { error: string })[]

const toTs = (a: PyIn) => ({
  currency: a.currency,
  instalmentMinor: BigInt(a.instalment_minor),
  coveredHoursHundredths: BigInt(a.covered_hours_hundredths),
  hours: a.hours.map((h) => ({ personId: h.person_id, approvedHoursHundredths: BigInt(h.approved_hours_hundredths), clientRateMinor: BigInt(h.client_rate_minor) })),
  overagePolicy: a.overage_policy,
})

const toPy = (r: ReturnType<typeof hourlyFeeSettlement>): PyOut => ({
  currency: r.currency,
  implied_rate_minor: Number(r.impliedRateMinor),
  total_hours_hundredths: Number(r.totalHoursHundredths),
  overage_hours_hundredths: Number(r.overageHoursHundredths),
  unused_hours_hundredths: Number(r.unusedHoursHundredths),
  overage_minor: Number(r.overageMinor),
  total_billable_minor: Number(r.totalBillableMinor),
  per_person: r.perPerson.map((p) => ({ person_id: p.personId, overage_hours_hundredths: Number(p.overageHoursHundredths), overage_minor: Number(p.overageMinor) })),
})

describe("hourly_fee_settlement parity with the source ERP", () => {
  const cases = VECTORS.filter((v): v is { input: PyIn; output: PyOut } => "input" in v)
  it.each(cases.map((c, i) => [i, c] as const))("vector %i", (_i, c) => {
    expect(toPy(hourlyFeeSettlement(toTs(c.input)))).toEqual(c.output)
  })

  it("rejects duplicate people like the source", () => {
    const err = VECTORS.find((v): v is { error: string } => "error" in v)!
    expect(() =>
      hourlyFeeSettlement({
        currency: "USD",
        instalmentMinor: 1n,
        coveredHoursHundredths: 1n,
        hours: [
          { personId: "a", approvedHoursHundredths: 1n, clientRateMinor: 1n },
          { personId: "a", approvedHoursHundredths: 1n, clientRateMinor: 1n },
        ],
        overagePolicy: "absorb",
      })
    ).toThrow(err.error)
  })

  it("rejects unknown keys and zero covered hours (strict input)", () => {
    expect(() => hourlyFeeSettlement({ ...toTs((cases[0]!).input), extra: 1 } as never)).toThrow()
    expect(() => hourlyFeeSettlement({ ...toTs((cases[0]!).input), coveredHoursHundredths: 0n })).toThrow()
  })
})
