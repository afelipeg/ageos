import "server-only"

import { and, eq, inArray, lte, sql } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import { journalCheck } from "@/server/calculators/finance"
import type { Tx } from "@/server/db/client"
import { accountingPeriod, approvalRequest, bankAccount, clientInvoice, job, payment, paymentBatch, supplierInvoice } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { defineCommand, toJsonSafe, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { periodEnd, planRecognition } from "./accruals"
import { cashPosition } from "./cash"
import { blocked, DEMO_LEDGER_LABEL, getPeriod, journalsWithLines, Month, requestFinanceApproval, trialBalance } from "./ledger"

// Period close (M08) of the internal Demo ledger: a checklist of real,
// navigable blockers; closing locks every write dated in the period
// (assertPeriodOpen); reopening needs period.close, a reason and leaves an
// event. Nothing is closed in an external accounting system.

const FINANCE_ACTIONS = ["payables.register_invoice", "payments.batch", "expense.approve", "billing.issue_invoice", "accounting.recognition_run", "accounting.fx_revaluation", "ledger.manual_journal", "assets.depreciation", "rebates.provision"]

type ChecklistItem = { id: string; status: "pass" | "blocked" | "warning"; count: number; items: { recordType: string; recordId: string; label: string; href: string }[] }

export async function closeChecklist(tx: Tx, ctx: AgencyContext, period: string): Promise<ChecklistItem[]> {
  const slug = ctx.tenant.slug
  const end = periodEnd(period)
  const item = (id: string, kind: "blocked" | "warning", items: ChecklistItem["items"]): ChecklistItem => ({ id, status: items.length ? kind : "pass", count: items.length, items })

  const held = await tx.select().from(supplierInvoice).where(and(eq(supplierInvoice.tenantId, ctx.tenant.id), eq(supplierInvoice.period, period), eq(supplierInvoice.state, "validation_hold")))
  const journals = await journalsWithLines(tx, ctx.tenant.id, { period })
  const unbalanced = journals.filter(
    (j) =>
      journalCheck({
        entryId: "check",
        postingDate: j.businessDate,
        lockedPeriods: [],
        lines: j.lines.map((l, i) => ({ lineId: `l${i + 1}`, accountId: l.accountCode, currency: l.currency, debitMinor: l.debitMinor, creditMinor: l.creditMinor, requiredDimensionsPresent: true })),
      }).status !== "valid"
  )
  const tb = await trialBalance(tx, ctx.tenant.id, { period })
  const tbIssues = tb.currencies.filter((c) => c.sumMinor !== 0n)
  const inflight = await tx
    .select({ p: payment, paymentDate: paymentBatch.paymentDate })
    .from(payment)
    .innerJoin(paymentBatch, and(eq(paymentBatch.tenantId, payment.tenantId), eq(paymentBatch.id, payment.batchId)))
    .where(and(eq(payment.tenantId, ctx.tenant.id), inArray(payment.state, ["reserved", "outcome_unknown", "failed_retryable"])))
  const inflightInPeriod = inflight.filter((r) => (r.p.businessDate ?? r.paymentDate) <= end).map((r) => r.p)
  const jobs = await tx.select().from(job).where(eq(job.tenantId, ctx.tenant.id))
  const unrecognized: ChecklistItem["items"] = []
  for (const j of jobs) {
    const plan = await planRecognition(tx, ctx.tenant.id, j.id, period)
    // The fee is due in the job's own period; dated items by their date.
    const due = plan.items.filter((i) => i.category !== "fee" || j.period <= period)
    const reclass = plan.pendingInvoiceReclass.filter((r) => r.period <= period)
    if (due.length || reclass.length) {
      unrecognized.push({ recordType: "job", recordId: j.id, label: `${j.displayReference}: ${due.length + reclass.length} item(s) to recognize`, href: `/a/${slug}/modules/accounting-close/workflows/agency-accruals-revaluation?job=${j.id}` })
    }
  }
  const pendingApprovals = await tx
    .select()
    .from(approvalRequest)
    .where(and(eq(approvalRequest.tenantId, ctx.tenant.id), eq(approvalRequest.state, "awaiting_approval"), inArray(approvalRequest.actionType, FINANCE_ACTIONS), lte(approvalRequest.createdAt, sql`now()`)))

  return [
    item("unmatched_supplier_invoice", "blocked", held.map((h) => ({ recordType: "supplier_invoice", recordId: h.id, label: `${h.invoiceNumber} held: ${h.holdReasons.join(", ")}`, href: `/a/${slug}/modules/suppliers-payments/workflows/agency-delivery-reconciliation` }))),
    item("unbalanced_journal", "blocked", [
      ...unbalanced.map((j) => ({ recordType: "journal_entry", recordId: j.id, label: `${j.ruleKey} does not balance`, href: `/a/${slug}/modules/accounting-close/workflows/agency-general-ledger` })),
      ...tbIssues.map((c) => ({ recordType: "trial_balance", recordId: period, label: `Trial balance ${c.currency} sums ${c.sumMinor.toString()}`, href: `/a/${slug}/modules/accounting-close/workflows/agency-general-ledger` })),
    ]),
    item("unreconciled_payments", "blocked", inflightInPeriod.map((p) => ({ recordType: "payment", recordId: p.id, label: `${p.payee}: ${p.state}`, href: `/a/${slug}/modules/suppliers-payments/workflows/agency-payment-run` }))),
    item("unrecognized_items", "blocked", unrecognized),
    item("pending_finance_approvals", "warning", pendingApprovals.map((a) => ({ recordType: "approval_request", recordId: a.id, label: a.title, href: `/a/${slug}/approvals/${a.id}` }))),
  ]
}

// ── agency-period-close: closeAccountingPeriod ──

export const CloseAccountingPeriodInput = z
  .object({
    period: Month,
    action: z.enum(["check_readiness", "close", "reopen"]),
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .strict()

export const PERIOD_CLOSE_POLICY = "period-close-v1"

function blockersError(blockers: ChecklistItem[]): never {
  throw new DomainError("blocked_by_rule", "The close checklist has blockers", toJsonSafe({ rule: blockers[0]!.id, blockers: blockers.map((b) => ({ id: b.id, count: b.count, items: b.items })) }) as Record<string, unknown>)
}

/**
 * close / reopen are proposals: the actor must have period.close and give a
 * reason; the change applies only when owner or finance OTHER than the
 * proposer approves the exact payload (executor `close.period_action`).
 * check_readiness only records the checklist.
 */
export const closeAccountingPeriod = defineCommand({
  type: "close.periodAction",
  skillId: "agency-period-close",
  permission: "period.close",
  input: CloseAccountingPeriodInput,
  handler: async (tx, ctx, input, meta) => {
    const [p] = await tx
      .select()
      .from(accountingPeriod)
      .where(and(eq(accountingPeriod.tenantId, ctx.tenant.id), eq(accountingPeriod.period, input.period)))
      .for("update")
      .limit(1)
    if (!p) blocked("period_not_configured", `Accounting period ${input.period} is not configured`, { period: input.period })
    const events: EmittedEvent[] = []
    const checklist = await closeChecklist(tx, ctx, input.period)
    const blockers = checklist.filter((c) => c.status === "blocked")
    const tb = await trialBalance(tx, ctx.tenant.id, { period: input.period })
    let approval: Awaited<ReturnType<typeof requestFinanceApproval>>["approvalSummary"] | null = null
    if (input.action === "close" || input.action === "reopen") {
      if (input.action === "close") {
        if (p.state !== "open") blocked("period_not_open", "The period is already closed", { period: input.period })
        if (blockers.length) blockersError(blockers)
      } else if (p.state !== "closed") {
        blocked("period_not_closed", "Only a closed period can be reopened", { period: input.period, state: p.state })
      }
      const reason = input.reason?.trim() ?? ""
      if (reason.length < 10) blocked(`${input.action}_reason_required`, `${input.action === "close" ? "Closing" : "Reopening"} needs a reason of at least 10 characters`, { field: "reason" })
      const appr = await requestFinanceApproval(tx, ctx, {
        actionType: "close.period_action",
        skillId: "agency-period-close",
        job: null,
        aggregate: { type: "accounting_period", id: p.id, revision: p.revision },
        payload: { action: "close.period_action", periodAction: input.action, periodId: p.id, periodRevision: p.revision, period: input.period, reason },
        impact: { period: input.period, from: p.state, to: input.action === "close" ? "closed" : "open", locksWrites: input.action === "close" },
        title: `${input.action === "close" ? "Close" : "Reopen"} period ${input.period}`,
        destination: DEMO_LEDGER_LABEL,
        policyId: PERIOD_CLOSE_POLICY,
        eligibleRoles: ["owner", "finance_approver"],
        origin: meta.origin,
      })
      approval = appr.approvalSummary
      events.push({ eventType: `period.${input.action}_proposed`, aggregateType: "accounting_period", aggregateId: p.id, payload: { period: input.period, reason, approvalId: appr.approval.id } }, ...appr.events)
    } else {
      events.push({ eventType: "period.readiness_checked", aggregateType: "accounting_period", aggregateId: p.id, payload: { period: input.period, blockers: blockers.map((b) => b.id) } })
    }
    const banks = await tx.select().from(bankAccount).where(eq(bankAccount.tenantId, ctx.tenant.id))
    const positions = []
    for (const b of banks) positions.push({ bankAccountId: b.id, name: b.name, currency: b.currency, reportingGroup: b.reportingGroup, ...(await cashPosition(tx, ctx.tenant.id, b.id, periodEnd(input.period))) })
    const clearing = ["payroll_payable", "accrued_production", "accrued_media", "expense_payable", "ap_production", "ap_media", "unbilled_fee_asset", "media_recovery_asset", "accounts_receivable"]
    return {
      result: {
        period: input.period,
        state: p.state,
        ledger: DEMO_LEDGER_LABEL,
        proposalId: approval?.proposalId ?? null,
        approvalId: approval?.approvalId ?? null,
        payloadDigest: approval?.payloadDigest ?? null,
        pendingApproval: approval !== null,
        close_checklist: checklist,
        close_job_status: checklist.find((c) => c.id === "unrecognized_items")!.items,
        post_close_reconciliations: { trialBalance: tb, bankPositions: positions },
        unresolved_balances: tb.currencies.map((c) => ({ currency: c.currency, balances: Object.fromEntries(Object.entries(c.balances).filter(([k, v]) => clearing.includes(k) && v !== 0n)) })),
        lock_proposal: { period: input.period, locksWrites: true, appliesTo: "every posting, invoice, payment and collection dated in the period", state: p.state, approval: input.action === "close" ? approval : null },
        reopen_plan: { requires: ["period.close permission", "reason (≥ 10 characters)", "approval by owner or finance other than the proposer", "audit event"], approval: input.action === "reopen" ? approval : null, lastReopen: p.reopenReason ? { reason: p.reopenReason, at: p.reopenedAt?.toISOString() ?? null } : null },
        adjustment_plan: { items: blockers.flatMap((b) => b.items.map((i) => ({ blocker: b.id, ...i }))) },
      },
      events,
    }
  },
})

export async function applyPeriodAction(
  tx: Tx,
  ctx: AgencyContext,
  payload: { periodAction: "close" | "reopen"; periodId: string; periodRevision: number; period: string; reason: string },
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const [p] = await tx.select().from(accountingPeriod).where(and(eq(accountingPeriod.tenantId, ctx.tenant.id), eq(accountingPeriod.id, payload.periodId))).for("update").limit(1)
  if (!p || p.revision !== payload.periodRevision) return { ok: false, code: "approval_stale", details: { period: payload.period } }
  if (payload.periodAction === "close") {
    if (p.state !== "open") return { ok: false, code: "period_not_open", details: { period: payload.period } }
    const blockers = (await closeChecklist(tx, ctx, payload.period)).filter((c) => c.status === "blocked")
    if (blockers.length) return { ok: false, code: blockers[0]!.id, details: toJsonSafe({ rule: blockers[0]!.id, blockers: blockers.map((b) => ({ id: b.id, count: b.count })) }) as Record<string, unknown> }
  } else if (p.state !== "closed") {
    return { ok: false, code: "period_not_closed", details: { period: payload.period } }
  }
  if (mode === "check") return { ok: true, events: [] }
  if (payload.periodAction === "close") {
    const checklist = await closeChecklist(tx, ctx, payload.period)
    const tb = await trialBalance(tx, ctx.tenant.id, { period: payload.period })
    await tx
      .update(accountingPeriod)
      .set({ state: "closed", closedBy: ctx.user.id, closedAt: new Date(), closeSnapshot: toJsonSafe({ trialBalance: tb, checklist, reason: payload.reason }) as object, updatedAt: new Date(), revision: sql`${accountingPeriod.revision} + 1` })
      .where(eq(accountingPeriod.id, p.id))
    return { ok: true, events: [{ eventType: "period.closed", aggregateType: "accounting_period", aggregateId: p.id, payload: { period: payload.period, reason: payload.reason, approvedBy: ctx.user.id, ledger: DEMO_LEDGER_LABEL, journals: tb.journalCount } }] }
  }
  await tx
    .update(accountingPeriod)
    .set({ state: "open", reopenReason: payload.reason, reopenedBy: ctx.user.id, reopenedAt: new Date(), updatedAt: new Date(), revision: sql`${accountingPeriod.revision} + 1` })
    .where(eq(accountingPeriod.id, p.id))
  return { ok: true, events: [{ eventType: "period.reopened", aggregateType: "accounting_period", aggregateId: p.id, payload: { period: payload.period, reason: payload.reason, approvedBy: ctx.user.id, ledger: DEMO_LEDGER_LABEL } }] }
}

export type JobFinanceCheck = { id: "supplier_invoices_settled" | "collections_complete" | "payments_reconciled" | "recognition_complete"; ok: boolean; count: number; items: { recordType: string; recordId: string; label: string; state: string }[] }

/**
 * Finance gates for closing a job (agency-job-lifecycle, Core-1): supplier
 * invoices paid (none held, matched or payable), client invoices collected,
 * no payment in flight or with an unknown outcome, nothing left to recognize.
 */
export async function jobCloseFinanceChecks(tx: Tx, tenantId: string, jobId: string): Promise<JobFinanceCheck[]> {
  const [j] = await tx.select().from(job).where(and(eq(job.tenantId, tenantId), eq(job.id, jobId))).limit(1)
  if (!j) return []
  const invoices = await tx.select().from(supplierInvoice).where(and(eq(supplierInvoice.tenantId, tenantId), eq(supplierInvoice.jobId, jobId), inArray(supplierInvoice.state, ["validation_hold", "matched", "payable"])))
  const receivables = await tx.select().from(clientInvoice).where(and(eq(clientInvoice.tenantId, tenantId), eq(clientInvoice.jobId, jobId), inArray(clientInvoice.state, ["requirements_checked", "issued_demo", "partially_collected"])))
  const payments = await tx.select().from(payment).where(and(eq(payment.tenantId, tenantId), eq(payment.jobId, jobId), inArray(payment.state, ["pending_approval", "reserved", "outcome_unknown", "failed_retryable"])))
  const plan = await planRecognition(tx, tenantId, jobId, "9999-12")
  const toCheck = <T,>(id: JobFinanceCheck["id"], rows: T[], map: (r: T) => JobFinanceCheck["items"][number]): JobFinanceCheck => ({ id, ok: rows.length === 0, count: rows.length, items: rows.map(map) })
  return [
    toCheck("supplier_invoices_settled", invoices, (i) => ({ recordType: "supplier_invoice", recordId: i.id, label: i.invoiceNumber, state: i.state })),
    toCheck("collections_complete", receivables, (i) => ({ recordType: "client_invoice", recordId: i.id, label: i.number ?? "draft", state: i.state })),
    toCheck("payments_reconciled", payments, (p) => ({ recordType: "payment", recordId: p.id, label: p.payee, state: p.state })),
    toCheck("recognition_complete", [...plan.items.map((i) => ({ id: i.sourceId, label: `${i.category} ${i.sourceType}` })), ...plan.pendingInvoiceReclass.map((r) => ({ id: r.id, label: `invoice ${r.invoiceNumber} reclass` }))], (r) => ({ recordType: "recognition", recordId: r.id, label: r.label, state: "pending" })),
  ]
}

export async function getCloseReadiness(ctx: AgencyContext, period: string) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const p = await getPeriod(tx, ctx.tenant.id, period)
    if (!p) return null
    return { period, state: p.state, checklist: await closeChecklist(tx, ctx, period) }
  })
}
