import { z } from "zod"

// Shared calculators (coordinator-owned) ported from the source ERP
// agency_tools.py (allocate, installment_schedule, credit_exposure). Pure,
// strict inputs, exact integer arithmetic. Parity vectors in
// tests/unit/calculators-shared.test.ts were produced by the Python source.

const Currency = z.string().regex(/^[A-Z]{3}$/)
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)
const Minor = z.bigint().nonnegative()

/** Round half away from zero for signed division by a positive denominator (source `rdiv`). */
export function rdiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive")
  const sign = numerator < 0n ? -1n : 1n
  const abs = numerator < 0n ? -numerator : numerator
  return sign * ((abs + denominator / 2n) / denominator)
}

/** Largest-remainder split that conserves the total exactly; ties by index. */
export function largestRemainder(amount: bigint, weights: bigint[]): bigint[] {
  const total = weights.reduce((s, w) => s + w, 0n)
  if (total <= 0n) throw new Error("weights must sum to a positive number")
  const sign = amount < 0n ? -1n : 1n
  const magnitude = amount < 0n ? -amount : amount
  const floors = weights.map((w) => (magnitude * w) / total)
  const order = weights
    .map((w, i) => ({ i, rem: (magnitude * w) % total }))
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1))
  let missing = magnitude - floors.reduce((s, f) => s + f, 0n)
  for (const { i } of order) {
    if (missing <= 0n) break
    floors[i] = floors[i]! + 1n
    missing -= 1n
  }
  return floors.map((f) => sign * f)
}

export const AllocateInput = z
  .object({
    currency: Currency,
    amountMinor: z.bigint(),
    weights: z.array(z.object({ targetId: Id, weight: z.bigint().nonnegative().max(1_000_000_000n) }).strict()).max(1000),
  })
  .strict()

export function allocate(input: z.infer<typeof AllocateInput>) {
  const a = AllocateInput.parse(input)
  const ids = a.weights.map((w) => w.targetId)
  if (new Set(ids).size !== ids.length) throw new Error("duplicate target_id")
  const shares = largestRemainder(a.amountMinor, a.weights.map((w) => w.weight))
  return {
    currency: a.currency,
    allocations: ids.map((targetId, i) => ({ targetId, amountMinor: shares[i]! })),
    totalMinor: shares.reduce((s, x) => s + x, 0n),
  }
}

function addMonths(month: string, offset: number) {
  const [y, m] = month.split("-").map(Number)
  const index = y! * 12 + (m! - 1) + offset
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`
}

export const InstallmentScheduleInput = z
  .object({
    currency: Currency,
    grossMinor: Minor,
    advanceBps: z.number().int().min(0).max(10000),
    installments: z.number().int().min(1).max(120),
    startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  })
  .strict()

export function installmentSchedule(input: z.infer<typeof InstallmentScheduleInput>) {
  const a = InstallmentScheduleInput.parse(input)
  const advance = rdiv(a.grossMinor * BigInt(a.advanceBps), 10000n)
  const rest = a.grossMinor - advance
  const n = BigInt(a.installments)
  const each = rest / n
  const schedule = Array.from({ length: a.installments }, (_, i) => ({ number: i + 1, month: addMonths(a.startMonth, i), amountMinor: each }))
  schedule[schedule.length - 1]!.amountMinor += rest - each * n
  return { currency: a.currency, advanceMinor: advance, installments: schedule, totalMinor: advance + rest }
}

export const CreditExposureInput = z
  .object({
    currency: Currency,
    creditLimitMinor: Minor,
    arOpenMinor: Minor,
    approvedUnbilledMinor: Minor,
    requestedMinor: Minor,
  })
  .strict()

export function creditExposure(input: z.infer<typeof CreditExposureInput>) {
  const a = CreditExposureInput.parse(input)
  const exposure = a.arOpenMinor + a.approvedUnbilledMinor + a.requestedMinor
  const within = exposure <= a.creditLimitMinor
  return {
    currency: a.currency,
    exposureAfterMinor: exposure,
    headroomMinor: a.creditLimitMinor - exposure,
    withinLimit: within,
    requiresOverrideApproval: !within,
  }
}
