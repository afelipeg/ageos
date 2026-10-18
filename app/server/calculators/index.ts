import { createHash } from "node:crypto"

import { z } from "zod"

import { CANONICALIZATION, canonicalJson } from "@/lib/canonical-json"
import { divHalfUp } from "@/lib/money"

// Deterministic calculators ported from the source ERP contract
// (agency_tools.py, commit d73539e6). Pure functions: no clock, DB or network.
// Each validates its input strictly (unknown keys rejected) like the source.
// CALCULATORS lists the 26 calculator ids the catalog contracts reference.
// 25 exist in the pinned source registry and are ported (PORTED_CALCULATORS)
// with parity tests. `approval_route` has no source implementation; AgeOS
// implements it as kernel approval policies (server/kernel/approvals.ts:
// eligible roles, decide permission, excluded deciders). See DECISIONS.md D23.

const Currency = z.string().regex(/^[A-Z]{3}$/)
const Minor = z.bigint().nonnegative()

// ── margin ──
// Deviation from source (documented in DECISIONS.md): the source floors
// margin_bps (`margin*10000//revenue` → 4347 for 10,000/23,000). AgeOS applies
// HALF_UP per contract 03 §6.9 and demo-fixtures (4348). Display is 43.5% in both.
export const MarginInput = z
  .object({
    currency: Currency,
    agencyRevenueMinor: z.bigint(),
    agencyCostMinor: z.bigint(),
    managedSpendMinor: Minor,
  })
  .strict()

export function margin(input: z.infer<typeof MarginInput>) {
  const a = MarginInput.parse(input)
  const marginMinor = a.agencyRevenueMinor - a.agencyCostMinor
  return {
    currency: a.currency,
    marginMinor,
    marginBps:
      a.agencyRevenueMinor === 0n
        ? null
        : Number(divHalfUp(marginMinor * 10000n, a.agencyRevenueMinor)),
    managedSpendMinor: a.managedSpendMinor,
  }
}

// ── job_number ──
export const JobNumberInput = z
  .object({
    clientCode: z.string().regex(/^[A-Z0-9]{3}$/),
    productCode: z.string().regex(/^[A-Z0-9]{2}$/),
    year: z.number().int().min(2000).max(2999),
    jobType: z.string().regex(/^[A-Z]$/),
    billingCode: z.string().regex(/^[A-Z0-9*?]$/),
    sequence: z.number().int().min(1).max(9999),
  })
  .strict()

export function jobNumber(input: z.infer<typeof JobNumberInput>) {
  const a = JobNumberInput.parse(input)
  const code = `${a.clientCode}${a.productCode}${a.year % 10}${a.jobType}${a.billingCode}${String(a.sequence).padStart(4, "0")}`
  const warnings: string[] = []
  const salesForbidden = ["N", "S", "W"].includes(a.jobType)
  if (salesForbidden && ["F", "*", "?"].includes(a.billingCode)) warnings.push("typology_forbids_sales")
  if (a.billingCode === "0") warnings.push("non_billable_job")
  if (a.billingCode === "?") warnings.push("billing_client_pending")
  if (a.billingCode === "*") warnings.push("split_billing_needs_percentages")
  return {
    code,
    salesAllowed: !salesForbidden && a.billingCode !== "0",
    mediaAllowed: a.jobType !== "C",
    clientApprovalAllowed: a.billingCode !== "?",
    warnings,
  }
}

// ── budget_check ──
export const BudgetCheckInput = z
  .object({
    currency: Currency,
    authorizedMinor: Minor,
    spentMinor: Minor,
    openCommitmentsMinor: Minor,
    reservationsMinor: Minor,
    requestedMinor: Minor,
  })
  .strict()

export function budgetCheck(input: z.infer<typeof BudgetCheckInput>) {
  const a = BudgetCheckInput.parse(input)
  const available = a.authorizedMinor - a.spentMinor - a.openCommitmentsMinor - a.reservationsMinor
  return {
    currency: a.currency,
    availableMinor: available,
    afterRequestMinor: available - a.requestedMinor,
    withinBudget: a.requestedMinor <= available,
    // The calculator never reserves: the command handler does, transactionally.
    atomicReservationRequired: true as const,
  }
}

// ── reconcile (three-way: order / delivery / invoice) ──
export const ReconcileInput = z
  .object({
    currency: Currency,
    orderedMinor: Minor,
    deliveredMinor: Minor,
    invoicedMinor: Minor,
    toleranceMinor: Minor,
  })
  .strict()

export function reconcile(input: z.infer<typeof ReconcileInput>) {
  const a = ReconcileInput.parse(input)
  const discrepancy = a.invoicedMinor - a.deliveredMinor
  const abs = discrepancy < 0n ? -discrepancy : discrepancy
  const reasons: string[] = []
  if (abs > a.toleranceMinor) reasons.push("invoice_delivery_mismatch")
  if (a.deliveredMinor > a.orderedMinor + a.toleranceMinor) reasons.push("delivery_exceeds_order")
  if (a.orderedMinor - a.deliveredMinor > a.toleranceMinor) reasons.push("short_delivery")
  if (a.invoicedMinor > a.orderedMinor + a.toleranceMinor) reasons.push("invoice_exceeds_order")
  const min = [a.orderedMinor, a.deliveredMinor, a.invoicedMinor].reduce((m, v) => (v < m ? v : m))
  return {
    currency: a.currency,
    discrepancyMinor: discrepancy,
    payableCandidateMinor: min,
    status: reasons.length ? ("hold" as const) : ("matched" as const),
    reasons,
  }
}

// ── payload_digest ──
// The digest binds content; it never authenticates an approver.
export function payloadDigest(payload: unknown) {
  const canonical = canonicalJson(payload)
  return {
    sha256: createHash("sha256").update(canonical, "utf8").digest("hex"),
    canonicalization: CANONICALIZATION,
    authorizesExecution: false as const,
  }
}

export const CALCULATORS = [
  "aging",
  "allocate",
  "approval_route",
  "audience_metrics",
  "budget_check",
  "cash_projection",
  "credit_exposure",
  "depreciation_schedule",
  "discount_cascade",
  "estimate_totals",
  "flat_rebate",
  "fx_revaluation",
  "hourly_fee_settlement",
  "installment_schedule",
  "invoice_check",
  "job_number",
  "journal_check",
  "margin",
  "media_line_cost",
  "payload_digest",
  "payment_terms",
  "plan_diff",
  "reconcile",
  "spot_match",
  "tiered_commission",
  "withholding",
] as const

export type CalculatorId = (typeof CALCULATORS)[number]

/** Calculators ported to TypeScript in this chassis, with parity tests. */
export const PORTED_CALCULATORS: ReadonlySet<CalculatorId> = new Set<CalculatorId>([
  "margin",
  "job_number",
  "budget_check",
  "reconcile",
  "payload_digest",
  "allocate",
  "installment_schedule",
  "credit_exposure",
  // server/calculators/planning.ts (Core-2)
  "media_line_cost",
  "discount_cascade",
  "audience_metrics",
  "plan_diff",
  "estimate_totals",
  "spot_match",
  // server/calculators/clients.ts (Core-1)
  "hourly_fee_settlement",
  // server/calculators/finance.ts (Core-3)
  "aging",
  "withholding",
  "payment_terms",
  "fx_revaluation",
  "journal_check",
  "depreciation_schedule",
  "cash_projection",
  "tiered_commission",
  "flat_rebate",
  "invoice_check",
])

export * from "./clients"
export * from "./finance"
export * from "./planning"
export * from "./shared"
