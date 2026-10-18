import { describe, expect, it } from "vitest"

import { allocate, creditExposure, installmentSchedule, largestRemainder, rdiv } from "@/server/calculators/shared"

import vectors from "../fixtures/calculators-shared-vectors.json"

// Vectors are raw JSON from the Python source (snake_case, number minor units).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
type V = { tool: string; input: Record<string, Json>; output: Record<string, Json> }

// Parity: every vector was produced by the source agency_tools.py (python3 -I).
const big = (v: unknown) => BigInt(v as number)

describe("shared calculators parity with agency_tools.py", () => {
  for (const [i, v] of (vectors as V[]).entries()) {
    it(`${v.tool} #${i}`, () => {
      const a = v.input
      const o = v.output
      if (v.tool === "allocate") {
        const r = allocate({
          currency: a.currency,
          amountMinor: big(a.amount_minor),
          weights: a.weights.map((w: Json) => ({ targetId: w.target_id, weight: big(w.weight) })),
        })
        expect(r.allocations.map((x) => [x.targetId, x.amountMinor])).toEqual(o.allocations.map((x: Json) => [x.target_id, big(x.amount_minor)]))
        expect(r.totalMinor).toBe(big(o.total_minor))
      } else if (v.tool === "installment_schedule") {
        const r = installmentSchedule({
          currency: a.currency,
          grossMinor: big(a.gross_minor),
          advanceBps: a.advance_bps,
          installments: a.installments,
          startMonth: a.start_month,
        })
        expect(r.advanceMinor).toBe(big(o.advance_minor))
        expect(r.installments.map((x) => [x.number, x.month, x.amountMinor])).toEqual(o.installments.map((x: Json) => [x.number, x.month, big(x.amount_minor)]))
        expect(r.totalMinor).toBe(big(o.total_minor))
      } else if (v.tool === "credit_exposure") {
        const r = creditExposure({
          currency: a.currency,
          creditLimitMinor: big(a.credit_limit_minor),
          arOpenMinor: big(a.ar_open_minor),
          approvedUnbilledMinor: big(a.approved_unbilled_minor),
          requestedMinor: big(a.requested_minor),
        })
        expect(r.exposureAfterMinor).toBe(big(o.exposure_after_minor))
        expect(r.headroomMinor).toBe(big(o.headroom_minor))
        expect(r.withinLimit).toBe(o.within_limit)
        expect(r.requiresOverrideApproval).toBe(o.requires_override_approval)
      } else {
        throw new Error(`unexpected tool ${v.tool}`)
      }
    })
  }

  it("rdiv rounds half away from zero", () => {
    expect(rdiv(5n, 2n)).toBe(3n)
    expect(rdiv(-5n, 2n)).toBe(-3n)
    expect(rdiv(4n, 3n)).toBe(1n)
  })

  it("largestRemainder conserves the total and rejects zero weights", () => {
    const parts = largestRemainder(10n, [1n, 1n, 1n])
    expect(parts.reduce((s, x) => s + x, 0n)).toBe(10n)
    expect(() => largestRemainder(10n, [0n, 0n])).toThrow()
  })

  it("allocate rejects duplicate targets and unknown keys", () => {
    expect(() => allocate({ currency: "USD", amountMinor: 10n, weights: [{ targetId: "a", weight: 1n }, { targetId: "a", weight: 1n }] })).toThrow(/duplicate/)
    expect(() => allocate({ currency: "USD", amountMinor: 10n, weights: [], extra: 1 } as never)).toThrow()
  })
})
