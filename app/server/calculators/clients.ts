import { z } from "zod"

import { largestRemainder, rdiv } from "./shared"

// Core-1 calculators ported from the source ERP agency_tools.py
// (`_hourly_fee_settlement`). Pure, strict input, exact integer arithmetic.
// Parity vectors in tests/integration/core1-calculators.test.ts were produced
// by the Python source with `python3 -I`.

const Currency = z.string().regex(/^[A-Z]{3}$/)
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)
const Minor = z.bigint().nonnegative()

export const HourlyFeeSettlementInput = z
  .object({
    currency: Currency,
    instalmentMinor: Minor,
    coveredHoursHundredths: z.bigint().min(1n).max(100_000_000n),
    hours: z
      .array(
        z
          .object({
            personId: Id,
            approvedHoursHundredths: z.bigint().nonnegative().max(100_000_000n),
            clientRateMinor: Minor,
          })
          .strict()
      )
      .max(500),
    overagePolicy: z.enum(["bill_at_client_rate", "absorb"]),
  })
  .strict()

/**
 * Monthly hourly-fee settlement: implied rate = instalment / covered hours;
 * hours above the covered quota are spread pro rata (largest remainder) and
 * valued at each person's client rate, or absorbed. Callers pass APPROVED
 * hours only: draft, submitted or rejected hours are never billable.
 */
export function hourlyFeeSettlement(input: z.infer<typeof HourlyFeeSettlementInput>) {
  const a = HourlyFeeSettlementInput.parse(input)
  const ids = a.hours.map((h) => h.personId)
  if (new Set(ids).size !== ids.length) throw new Error("duplicate person_id")
  const covered = a.coveredHoursHundredths
  const total = a.hours.reduce((s, h) => s + h.approvedHoursHundredths, 0n)
  const overage = total > covered ? total - covered : 0n
  let overageMinor = 0n
  let perPerson: { personId: string; overageHoursHundredths: bigint; overageMinor: bigint }[]
  if (overage > 0n && total > 0n) {
    const shares = largestRemainder(
      overage,
      a.hours.map((h) => h.approvedHoursHundredths)
    )
    perPerson = a.hours.map((h, i) => {
      const share = shares[i]!
      const charge = a.overagePolicy === "bill_at_client_rate" ? rdiv(share * h.clientRateMinor, 100n) : 0n
      overageMinor += charge
      return { personId: h.personId, overageHoursHundredths: share, overageMinor: charge }
    })
  } else {
    perPerson = a.hours.map((h) => ({ personId: h.personId, overageHoursHundredths: 0n, overageMinor: 0n }))
  }
  return {
    currency: a.currency,
    impliedRateMinor: rdiv(a.instalmentMinor * 100n, covered),
    totalHoursHundredths: total,
    overageHoursHundredths: overage,
    unusedHoursHundredths: covered > total ? covered - total : 0n,
    overageMinor,
    totalBillableMinor: a.instalmentMinor + overageMinor,
    perPerson,
  }
}
