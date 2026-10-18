import "server-only"

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm"
import { z } from "zod"

import { margin } from "@/server/calculators"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import {
  budgetRevision,
  budgetReservation,
  client,
  contract,
  costEstimate,
  costEstimateLine,
  delivery,
  evidence,
  expense,
  fileObject,
  job,
  journalEntry,
  journalLine,
  purchaseOrder,
  recognitionRecord,
  supplierInvoice,
  timesheet,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { getBusinessDate } from "@/server/domain/presenter"
import { DomainError } from "@/server/kernel/errors"

// One metric definition shared by Overview, the job dossier, reports and the
// assistant (contract 03 §6 and fixtures money_policy):
//   net agency revenue = approved agency fee (managed media is pass-through and
//   excluded); agency cost = current cost estimate (forecast), recognized
//   actuals (incurred: recognition records of the Demo ledger) or posted
//   journals (posted); margin_bps = HALF_UP((revenue − cost) × 10000 / revenue).
// The three bases are never added together.

export type Basis = "forecast" | "incurred" | "posted"

export type SourceRef = {
  recordType: string
  recordId: string
  revision: number | null
  label: string
  href: string
  asOf: string
  basis?: Basis
  currency?: string
}

export async function loadJobFinancials(tx: Tx, tenantId: string, jobId: string) {
  const [j] = await tx
    .select()
    .from(job)
    .where(and(eq(job.tenantId, tenantId), eq(job.id, jobId)))
    .limit(1)
  if (!j) throw new DomainError("not_found", "Job not found")

  const budgets = await tx
    .select()
    .from(budgetRevision)
    .where(and(eq(budgetRevision.tenantId, tenantId), eq(budgetRevision.jobId, jobId)))
    .orderBy(desc(budgetRevision.number))
  const approvedBudget = budgets.find((b) => b.state === "approved") ?? null

  const estimates = await tx
    .select()
    .from(costEstimate)
    .where(and(eq(costEstimate.tenantId, tenantId), eq(costEstimate.jobId, jobId)))
    .orderBy(desc(costEstimate.number))
  const currentEstimate = estimates.find((e) => e.state === "current") ?? null
  const estimateLines = estimates.length
    ? await tx
        .select()
        .from(costEstimateLine)
        .where(
          and(
            eq(costEstimateLine.tenantId, tenantId),
            inArray(
              costEstimateLine.estimateId,
              estimates.map((e) => e.id)
            )
          )
        )
    : []

  const contracts = await tx
    .select()
    .from(contract)
    .where(and(eq(contract.tenantId, tenantId), eq(contract.jobId, jobId)))
    .orderBy(desc(contract.revisionNumber), asc(contract.reference), asc(contract.id))
  const { approvedAuthority, authorities, excludedAuthorities } = effectiveAuthority(contracts, j.currency)

  const reservations = await tx
    .select()
    .from(budgetReservation)
    .where(and(eq(budgetReservation.tenantId, tenantId), eq(budgetReservation.jobId, jobId)))

  const timesheets = await tx
    .select()
    .from(timesheet)
    .where(and(eq(timesheet.tenantId, tenantId), eq(timesheet.jobId, jobId)))

  // Actuals (Core-3): recognized amounts, posted journal lines and the
  // subledger states that gate recognition.
  const recognitions = await tx
    .select()
    .from(recognitionRecord)
    .where(and(eq(recognitionRecord.tenantId, tenantId), eq(recognitionRecord.jobId, jobId)))
  const postedLines = await tx
    .select({ accountCode: journalLine.accountCode, debitMinor: journalLine.debitMinor, creditMinor: journalLine.creditMinor, entryId: journalLine.entryId, ruleKey: journalEntry.ruleKey })
    .from(journalLine)
    .innerJoin(journalEntry, and(eq(journalEntry.tenantId, journalLine.tenantId), eq(journalEntry.id, journalLine.entryId)))
    .where(and(eq(journalLine.tenantId, tenantId), eq(journalLine.jobId, jobId), eq(journalEntry.state, "posted")))
  const expenses = await tx.select().from(expense).where(and(eq(expense.tenantId, tenantId), eq(expense.jobId, jobId)))
  const supplierInvoices = await tx.select().from(supplierInvoice).where(and(eq(supplierInvoice.tenantId, tenantId), eq(supplierInvoice.jobId, jobId)))
  const acceptedDeliveries = await tx
    .select({ id: delivery.id, kind: purchaseOrder.kind, acceptedMinor: delivery.acceptedMinor })
    .from(delivery)
    .innerJoin(purchaseOrder, and(eq(purchaseOrder.tenantId, delivery.tenantId), eq(purchaseOrder.id, delivery.orderId)))
    .where(and(eq(delivery.tenantId, tenantId), eq(purchaseOrder.jobId, jobId), eq(delivery.state, "accepted")))
  const [acc] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(evidence)
    .leftJoin(fileObject, and(eq(fileObject.tenantId, evidence.tenantId), eq(fileObject.id, evidence.fileId)))
    .where(and(eq(evidence.tenantId, tenantId), eq(evidence.kind, "acceptance"), or(eq(evidence.jobId, jobId), eq(fileObject.jobId, jobId)), sql`${evidence.reviewState} <> 'rejected'`))

  return {
    businessDate: await getBusinessDate(),
    job: j,
    budgets,
    approvedBudget,
    estimates,
    currentEstimate,
    estimateLines,
    contracts,
    approvedAuthority,
    authorities,
    excludedAuthorities,
    reservations,
    timesheets,
    recognitions,
    postedLines,
    expenses,
    supplierInvoices,
    acceptedDeliveries,
    acceptanceEvidenceCount: acc?.n ?? 0,
  }
}

export type JobFinancials = Awaited<ReturnType<typeof loadJobFinancials>>

type ContractRow = typeof contract.$inferSelect

/**
 * Client commercial authority of a job (03 §5/§6.4), deterministic:
 * - per reference, only the approved revision with the highest revision
 *   number counts (an amendment supersedes, never adds);
 * - distinct references (several client POs on one job) add up, in the job
 *   currency only — another currency is excluded and reported, never converted;
 * - `approvedAuthority` keeps the row shape for existing readers: its
 *   `amountMinor` is the summed authority, and id/reference/evidence are those
 *   of the most recently approved effective revision (ties: revision number,
 *   reference, id).
 */
export function effectiveAuthority(contracts: ContractRow[], currency: string) {
  const byReference = new Map<string, ContractRow>()
  for (const c of contracts) {
    if (c.state !== "approved") continue
    const prev = byReference.get(c.reference)
    if (!prev || c.revisionNumber > prev.revisionNumber || (c.revisionNumber === prev.revisionNumber && c.id < prev.id)) byReference.set(c.reference, c)
  }
  const effective = [...byReference.values()]
  const authorities = effective.filter((c) => c.currency === currency)
  const excludedAuthorities = effective.filter((c) => c.currency !== currency)
  const order = (a: ContractRow, b: ContractRow) =>
    (b.approvedAt?.getTime() ?? 0) - (a.approvedAt?.getTime() ?? 0) ||
    b.revisionNumber - a.revisionNumber ||
    a.reference.localeCompare(b.reference) ||
    a.id.localeCompare(b.id)
  authorities.sort(order)
  const primary = authorities[0] ?? null
  const approvedAuthority = primary ? { ...primary, amountMinor: authorities.reduce((s, c) => s + c.amountMinor, 0n) } : null
  return { approvedAuthority, authorities, excludedAuthorities }
}

export function estimateTotals(fin: JobFinancials, estimateId: string | null) {
  const lines = fin.estimateLines.filter((l) => l.estimateId === estimateId)
  const by = (t: string) =>
    lines.filter((l) => l.lineType === t).reduce((s, l) => s + l.amountMinor, 0n)
  const laborMinutes = lines
    .filter((l) => l.lineType === "labor")
    .reduce((s, l) => s + (l.minutes ?? 0), 0)
  return {
    laborMinutes,
    laborMinor: by("labor"),
    productionMinor: by("production"),
    expenseMinor: by("expense"),
    totalMinor: by("labor") + by("production") + by("expense"),
  }
}

export function computeProfitability(fin: JobFinancials, basis: Basis, slug: string) {
  const currency = fin.job.currency
  const asOf = fin.businessDate
  const sources: SourceRef[] = []
  const jobHref = `/a/${slug}/jobs/${fin.job.id}`

  if (basis === "forecast") {
    const fee = fin.approvedBudget?.agencyFeeMinor ?? 0n
    const media = fin.approvedBudget?.managedMediaMinor ?? 0n
    const cost = estimateTotals(fin, fin.currentEstimate?.id ?? null)
    const m = margin({
      currency,
      agencyRevenueMinor: fee,
      agencyCostMinor: cost.totalMinor,
      managedSpendMinor: media,
    })
    if (fin.approvedBudget) {
      sources.push({
        recordType: "budget_revision",
        recordId: fin.approvedBudget.id,
        revision: fin.approvedBudget.number,
        label: `Budget r${fin.approvedBudget.number} (approved)`,
        href: `${jobHref}?tab=scope`,
        asOf,
        basis,
        currency,
      })
    }
    if (fin.currentEstimate) {
      sources.push({
        recordType: "cost_estimate",
        recordId: fin.currentEstimate.id,
        revision: fin.currentEstimate.number,
        label: `Cost estimate r${fin.currentEstimate.number} (current)`,
        href: `${jobHref}?tab=production`,
        asOf,
        basis,
        currency,
      })
    }
    return {
      jobId: fin.job.id,
      jobRevision: fin.job.revision,
      basis,
      asOf,
      currency,
      agencyFeeMinor: fee,
      managedMediaMinor: media,
      agencyCost: cost,
      marginMinor: m.marginMinor,
      marginBps: m.marginBps,
      definition: "margin = (approved agency fee − current cost estimate) / approved agency fee; managed media excluded (pass-through)",
      unmetRequirements: [] as string[],
      sources,
    }
  }

  const unmetRequirements = actualsGaps(fin)
  const recognized = (c: string) => fin.recognitions.filter((r) => r.category === c).reduce((s, r) => s + r.amountMinor, 0n)
  const posted = (account: string) => fin.postedLines.filter((l) => l.accountCode === account).reduce((s, l) => s + l.debitMinor - l.creditMinor, 0n)
  const incurred = basis === "incurred"
  const fee = incurred ? recognized("fee") : -posted("agency_fee_revenue")
  const labor = incurred ? recognized("labor") : posted("labor_expense")
  const production = incurred ? recognized("production") : posted("production_expense")
  const expenseMinor = incurred ? recognized("expense") : posted("direct_expense")
  const media = incurred ? recognized("media") : fin.postedLines.filter((l) => l.accountCode === "media_recovery_asset").reduce((s, l) => s + l.debitMinor, 0n)
  const total = labor + production + expenseMinor
  const m = margin({ currency, agencyRevenueMinor: fee, agencyCostMinor: total, managedSpendMinor: media })
  const entryIds = [...new Set(fin.recognitions.map((r) => r.journalEntryId))]
  for (const id of entryIds) {
    sources.push({ recordType: "journal_entry", recordId: id, revision: null, label: "Demo ledger recognition", href: `/a/${slug}/modules/accounting-close/workflows/agency-general-ledger`, asOf, basis, currency })
  }
  return {
    jobId: fin.job.id,
    jobRevision: fin.job.revision,
    basis,
    asOf,
    currency,
    agencyFeeMinor: fee,
    managedMediaMinor: media,
    agencyCost: {
      laborMinutes: fin.timesheets.filter((t) => t.state === "approved" || t.state === "locked").reduce((s, t) => s + t.minutes, 0),
      laborMinor: labor,
      productionMinor: production,
      expenseMinor,
      totalMinor: total,
    },
    marginMinor: m.marginMinor,
    marginBps: m.marginBps,
    definition: incurred
      ? "incurred = recognized fee − recognized agency cost (Demo ledger recognition records); nothing is recognized before accepted delivery; managed media excluded"
      : "posted = agency_fee_revenue − (labor + production + direct expense) posted in the Demo ledger; managed media is a pass-through balance",
    unmetRequirements,
    sources,
  }
}

/** Requirements of the realized basis that are not met yet (fixtures `final_recognized.requires`). */
export function actualsGaps(fin: JobFinancials) {
  const gaps: string[] = []
  const recognizedSources = new Set(fin.recognitions.map((r) => r.sourceId))
  const feeRecognized = fin.recognitions.some((r) => r.category === "fee")
  if (!feeRecognized && fin.acceptanceEvidenceCount === 0) gaps.push("accepted_service_delivery")
  const approvedHours = fin.timesheets.filter((t) => t.state === "approved" || t.state === "locked")
  if (!approvedHours.length || fin.timesheets.some((t) => t.state === "submitted" || t.state === "draft")) gaps.push("approved_timesheets")
  const estExpense = fin.estimateLines.filter((l) => l.estimateId === fin.currentEstimate?.id && l.lineType === "expense").reduce((s, l) => s + l.amountMinor, 0n)
  const approvedExpense = fin.expenses.filter((e) => e.state === "approved" || e.state === "reimbursed")
  if ((estExpense > 0n && !approvedExpense.length) || fin.expenses.some((e) => e.state === "awaiting_approval" || e.state === "manual_review")) gaps.push("approved_expense")
  const estProduction = fin.estimateLines.filter((l) => l.estimateId === fin.currentEstimate?.id && l.lineType === "production").reduce((s, l) => s + l.amountMinor, 0n)
  const productionMatched = fin.supplierInvoices.some((i) => i.costCategory === "production" && ["matched", "payable", "paid"].includes(i.state))
  if (fin.supplierInvoices.some((i) => i.state === "validation_hold") || (estProduction > 0n && !productionMatched)) gaps.push("matched_supplier_costs")
  const pending =
    approvedHours.some((t) => !recognizedSources.has(t.id)) ||
    approvedExpense.some((e) => !recognizedSources.has(e.id)) ||
    fin.acceptedDeliveries.some((d) => !recognizedSources.has(d.id)) ||
    (fin.approvedBudget !== null && !recognizedSources.has(fin.approvedBudget.id) && fin.approvedBudget.agencyFeeMinor > fin.recognitions.filter((r) => r.category === "fee").reduce((s, r) => s + r.amountMinor, 0n))
  if (!fin.recognitions.length || pending) gaps.push("recognition_policy_applied")
  return gaps
}

export type Profitability = ReturnType<typeof computeProfitability>

/** Available balance per budget scope (contract 03 §6.4). */
export function budgetAvailability(fin: JobFinancials) {
  const currency = fin.job.currency
  const authorized: Record<string, bigint> = {
    client_commercial_authority: fin.approvedAuthority?.amountMinor ?? 0n,
    managed_media_authority: fin.approvedBudget?.managedMediaMinor ?? 0n,
    agency_cost_authority: estimateTotals(fin, fin.currentEstimate?.id ?? null).totalMinor,
  }
  return Object.entries(authorized).map(([scope, authorizedMinor]) => {
    const rs = fin.reservations.filter((r) => r.budgetScope === scope)
    const reservedMinor = rs.filter((r) => r.state === "reserved").reduce((s, r) => s + r.amountMinor, 0n)
    const committedMinor = rs.filter((r) => r.state === "committed").reduce((s, r) => s + r.amountMinor, 0n)
    const consumedMinor = rs.filter((r) => r.state === "consumed").reduce((s, r) => s + r.amountMinor, 0n)
    return {
      scope,
      currency,
      authorizedMinor,
      spentMinor: consumedMinor,
      openCommitmentsMinor: committedMinor,
      reservationsMinor: reservedMinor,
      availableMinor: authorizedMinor - consumedMinor - committedMinor - reservedMinor,
    }
  })
}

// ── agency-profitability: calculateJobProfitability (query handler) ──
export const ProfitabilityInput = z
  .object({ job: z.string().uuid(), basis: z.enum(["forecast", "incurred", "posted"]) })
  .strict()

export async function calculateJobProfitability(ctx: AgencyContext, input: z.infer<typeof ProfitabilityInput>) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const fin = await loadJobFinancials(tx, ctx.tenant.id, input.job)
    const p = computeProfitability(fin, input.basis, ctx.tenant.slug)
    const forecast = computeProfitability(fin, "forecast", ctx.tenant.slug)
    const [c] = await tx.select().from(client).where(and(eq(client.tenantId, ctx.tenant.id), eq(client.id, fin.job.clientId))).limit(1)
    const clientJobs = await tx.select().from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.clientId, fin.job.clientId), eq(job.reportingGroup, fin.job.reportingGroup)))
    let cFee = 0n
    let cCost = 0n
    for (const cj of clientJobs) {
      const cp = cj.id === fin.job.id ? p : computeProfitability(await loadJobFinancials(tx, ctx.tenant.id, cj.id), input.basis, ctx.tenant.slug)
      cFee += cp.agencyFeeMinor
      cCost += cp.agencyCost.totalMinor
    }
    const cm = margin({ currency: p.currency, agencyRevenueMinor: cFee, agencyCostMinor: cCost, managedSpendMinor: 0n })
    return {
      ...p,
      job_pnl: { revenueMinor: p.agencyFeeMinor, laborMinor: p.agencyCost.laborMinor, productionMinor: p.agencyCost.productionMinor, expenseMinor: p.agencyCost.expenseMinor, costMinor: p.agencyCost.totalMinor, marginMinor: p.marginMinor, marginBps: p.marginBps, basis: p.basis, currency: p.currency },
      client_profitability: { clientId: c?.id ?? null, clientName: c?.name ?? null, jobs: clientJobs.length, revenueMinor: cFee, costMinor: cCost, marginMinor: cm.marginMinor, marginBps: cm.marginBps, reportingGroup: fin.job.reportingGroup },
      overhead_allocation: { items: [], reason: "No overhead allocation policy is configured; margins are direct contribution only." },
      margin_bridge:
        input.basis === "forecast"
          ? { from: null, to: { revenueMinor: p.agencyFeeMinor, costMinor: p.agencyCost.totalMinor, marginBps: p.marginBps } }
          : { from: { basis: "forecast", revenueMinor: forecast.agencyFeeMinor, costMinor: forecast.agencyCost.totalMinor, marginBps: forecast.marginBps }, to: { basis: input.basis, revenueMinor: p.agencyFeeMinor, costMinor: p.agencyCost.totalMinor, marginBps: p.marginBps }, revenueDeltaMinor: p.agencyFeeMinor - forecast.agencyFeeMinor, costDeltaMinor: p.agencyCost.totalMinor - forecast.agencyCost.totalMinor },
      managed_spend: { managedMediaMinor: p.managedMediaMinor, currency: p.currency, treatment: "demo_agent_passthrough_excluded_from_agency_margin" },
      completeness_gaps: input.basis === "forecast" ? [] : p.unmetRequirements,
    }
  })
}
