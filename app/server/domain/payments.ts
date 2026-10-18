import "server-only"

import { and, asc, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm"
import { z } from "zod"

import { csvSafeCell, parseCsv } from "@/lib/csv"
import { demoBankEffects, executeDemoPayment, markDirectiveConsumed, reconcileDemoPayment, takePaymentDirective } from "@/server/adapters/payments"
import type { AgencyContext } from "@/server/auth/context"
import { aging, paymentTerms, withholding } from "@/server/calculators/finance"
import type { Tx } from "@/server/db/client"
import {
  adapterOperation,
  appUser,
  bankStatementImport,
  bankStatementLine,
  bankTransaction,
  demoProviderEffect,
  expense,
  job,
  journalEntry,
  journalLine,
  payment,
  paymentBatch,
  paymentHold,
  recognitionRecord,
  supplier,
  supplierInvoice,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { defineCommand, toJsonSafe, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import {
  assertConnected,
  bankAccountById,
  bankAccountByConnection,
  cashPosition,
  lockBankAccount,
  readTenantFile,
  recordBankTransaction,
  storeGeneratedFile,
  type BankAccountRow,
} from "./cash"
import {
  approvalIsLive,
  approvalStateOf,
  assertPeriodOpen,
  blocked,
  Decimal,
  IsoDate,
  moneyInput,
  periodOf,
  postJournals,
  requestFinanceApproval,
} from "./ledger"

// Payment runs (agency-payment-run) and bank settlement (agency-cash-settlement).
// A batch pays exact, already-recognized liabilities (supplier AP, expense
// reimbursements, payroll) — paying never creates cost. Finance approves the
// exact batch; approval then reserves funds atomically (row lock on the bank
// account; available = confirmed − active holds; no overdraft). Each payment
// is a simulated provider effect executed once per approved action id; an
// unknown outcome keeps its hold until reconciliation settles it exactly once.

export const PAYMENT_BATCH_POLICY = "payment-batch-v1"
const CATEGORY_RANK: Record<string, number> = { media: 0, production: 1, expense: 2, payroll: 3 }
const LIVE_PAYMENT_EXCLUDED = ["failed", "cancelled"]

type Candidate = {
  sourceType: "supplier_invoice" | "expense" | "payroll"
  sourceId: string
  category: "media" | "production" | "expense" | "payroll"
  jobId: string
  payee: string
  amountMinor: bigint
  dueDate: string | null
  createdAt: Date
}

/** Batches whose approval died (rejected/stale/expired) release their items. */
async function cancelDeadBatches(tx: Tx, tenantId: string) {
  const pending = await tx.select().from(paymentBatch).where(and(eq(paymentBatch.tenantId, tenantId), eq(paymentBatch.state, "awaiting_approval")))
  for (const b of pending) {
    if (approvalIsLive(await approvalStateOf(tx, tenantId, b.approvalId))) continue
    await tx.update(paymentBatch).set({ state: "cancelled", updatedAt: new Date(), revision: sql`${paymentBatch.revision} + 1` }).where(eq(paymentBatch.id, b.id))
    await tx.update(payment).set({ state: "cancelled", updatedAt: new Date() }).where(and(eq(payment.tenantId, tenantId), eq(payment.batchId, b.id)))
  }
}

async function liveSourceIds(tx: Tx, tenantId: string) {
  const rows = await tx
    .select({ sourceType: payment.sourceType, sourceId: payment.sourceId })
    .from(payment)
    .where(and(eq(payment.tenantId, tenantId), notInArray(payment.state, LIVE_PAYMENT_EXCLUDED)))
  return new Set(rows.map((r) => `${r.sourceType}:${r.sourceId}`))
}

/** Recognized liabilities due for payment from one bank account. */
export async function eligibleLiabilities(tx: Tx, tenantId: string, account: BankAccountRow, dueThrough: string): Promise<{ items: Candidate[]; held: { invoiceId: string; invoiceNumber: string; amountMinor: bigint; reasons: string[] }[] }> {
  const live = await liveSourceIds(tx, tenantId)
  const inGroup = and(eq(job.tenantId, tenantId), eq(job.currency, account.currency), eq(job.reportingGroup, account.reportingGroup))
  const items: Candidate[] = []

  const invoices = await tx
    .select({ inv: supplierInvoice, supplierName: supplier.name })
    .from(supplierInvoice)
    .innerJoin(job, and(eq(job.tenantId, supplierInvoice.tenantId), eq(job.id, supplierInvoice.jobId)))
    .innerJoin(supplier, and(eq(supplier.tenantId, supplierInvoice.tenantId), eq(supplier.id, supplierInvoice.supplierId)))
    .where(and(inGroup, eq(supplierInvoice.state, "payable"), sql`${supplierInvoice.reclassJournalId} is not null`, or(isNull(supplierInvoice.dueDate), lte(supplierInvoice.dueDate, dueThrough))))
  for (const { inv, supplierName } of invoices) {
    const open = inv.amountMinor - inv.paidMinor
    if (open <= 0n || live.has(`supplier_invoice:${inv.id}`)) continue
    items.push({ sourceType: "supplier_invoice", sourceId: inv.id, category: inv.costCategory === "media" ? "media" : "production", jobId: inv.jobId, payee: supplierName, amountMinor: open, dueDate: inv.dueDate, createdAt: inv.createdAt })
  }

  const exps = await tx
    .select({ e: expense, claimant: appUser.displayName })
    .from(expense)
    .innerJoin(job, and(eq(job.tenantId, expense.tenantId), eq(job.id, expense.jobId)))
    .innerJoin(appUser, eq(appUser.id, expense.claimantUserId))
    .innerJoin(recognitionRecord, and(eq(recognitionRecord.tenantId, expense.tenantId), eq(recognitionRecord.category, "expense"), eq(recognitionRecord.sourceId, expense.id)))
    .where(and(inGroup, eq(expense.state, "approved"), lte(expense.expenseDate, dueThrough)))
  for (const { e, claimant } of exps) {
    if (live.has(`expense:${e.id}`)) continue
    items.push({ sourceType: "expense", sourceId: e.id, category: "expense", jobId: e.jobId, payee: `${claimant} (reimbursement)`, amountMinor: e.amountMinor, dueDate: e.expenseDate, createdAt: e.createdAt })
  }

  // Payroll: one settlement per labor recognition journal (already a cost).
  const labor = await tx
    .select({ entry: journalEntry, credit: sql<string>`sum(${journalLine.creditMinor})` })
    .from(journalEntry)
    .innerJoin(job, and(eq(job.tenantId, journalEntry.tenantId), eq(job.id, journalEntry.jobId)))
    .innerJoin(journalLine, and(eq(journalLine.tenantId, journalEntry.tenantId), eq(journalLine.entryId, journalEntry.id), eq(journalLine.accountCode, "payroll_payable")))
    .where(and(inGroup, eq(journalEntry.ruleKey, "journal_labor"), eq(journalEntry.state, "posted"), lte(journalEntry.businessDate, dueThrough)))
    .groupBy(journalEntry.id)
  for (const { entry, credit } of labor) {
    if (live.has(`payroll:${entry.id}`)) continue
    const paid = await tx
      .select({ id: payment.id })
      .from(payment)
      .where(and(eq(payment.tenantId, tenantId), eq(payment.sourceType, "payroll"), eq(payment.sourceId, entry.id), eq(payment.state, "succeeded")))
      .limit(1)
    if (paid.length) continue
    items.push({ sourceType: "payroll", sourceId: entry.id, category: "payroll", jobId: entry.jobId!, payee: "Payroll (demo staff)", amountMinor: BigInt(credit ?? "0"), dueDate: entry.businessDate, createdAt: entry.postedAt })
  }
  items.sort((a, b) => CATEGORY_RANK[a.category]! - CATEGORY_RANK[b.category]! || a.createdAt.getTime() - b.createdAt.getTime())

  const holds = await tx
    .select({ inv: supplierInvoice })
    .from(supplierInvoice)
    .innerJoin(job, and(eq(job.tenantId, supplierInvoice.tenantId), eq(job.id, supplierInvoice.jobId)))
    .where(and(inGroup, eq(supplierInvoice.state, "validation_hold")))
  return { items, held: holds.map(({ inv }) => ({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, amountMinor: inv.amountMinor, reasons: inv.holdReasons })) }
}

function paymentOrderSummary(items: Candidate[], currency: string, asOf: string) {
  const terms = items.map((i) => ({ sourceId: i.sourceId, ...paymentTerms({ baseDate: i.dueDate ?? asOf, termDays: 0, rule: "net_days", delayDays: 0, holidays: [], weekendRoll: true }) }))
  const agingReport = aging({ asOf, bucketLimitsDays: [30, 60, 90], items: items.map((i, n) => ({ docId: `item${n + 1}`, currency, dueDate: i.dueDate ?? asOf, openMinor: i.amountMinor })) })
  return { terms, agingReport }
}

// ── agency-payment-run: executeDemoPaymentBatch (propose → finance approval → reserve) ──

export const ExecuteDemoPaymentBatchInput = z
  .object({
    connection: z.string().uuid(),
    paymentDate: IsoDate,
    dueThrough: IsoDate,
    paymentMethod: z.enum(["bank_transfer", "check"]),
    batchAmount: Decimal,
  })
  .strict()

export const proposePaymentBatch = defineCommand({
  type: "payments.proposeBatch",
  skillId: "agency-payment-run",
  // Prepared by AP (payables.manage, e.g. the owner); approved by finance
  // (never the preparer); payments executed by finance (payments.execute).
  permission: "payables.manage",
  input: ExecuteDemoPaymentBatchInput,
  handler: async (tx, ctx, input, meta) => {
    const { account, conn } = await bankAccountByConnection(tx, ctx.tenant.id, input.connection)
    assertConnected(conn)
    await assertPeriodOpen(tx, ctx.tenant.id, periodOf(input.paymentDate))
    const requested = moneyInput(input.batchAmount, account.currency, "batchAmount")
    await cancelDeadBatches(tx, ctx.tenant.id)
    const { items, held } = await eligibleLiabilities(tx, ctx.tenant.id, account, input.dueThrough)
    if (!items.length) blocked("nothing_due", "No recognized liability is due for payment from this account", { dueThrough: input.dueThrough, held })
    const total = items.reduce((a, i) => a + i.amountMinor, 0n)
    if (total !== requested) {
      blocked("batch_total_mismatch", "The batch total must equal the exact eligible amounts", { computedTotalMinor: total, requestedMinor: requested, currency: account.currency, items: items.map((i) => ({ category: i.category, amountMinor: i.amountMinor })) })
    }
    // Funds preview: confirmed cash − active holds; receivables never count.
    const pos = await cashPosition(tx, ctx.tenant.id, account.id)
    if (pos.availableMinor < total) {
      throw new DomainError("insufficient_funds", "Available cash does not cover the batch; nothing was sent", {
        rule: "insufficient_funds",
        availableMinor: pos.availableMinor.toString(),
        confirmedMinor: pos.confirmedMinor.toString(),
        activeHoldsMinor: pos.activeHoldsMinor.toString(),
        requestedMinor: total.toString(),
        currency: account.currency,
        overdraftAllowed: false,
      })
    }
    const jobs = [...new Set(items.map((i) => i.jobId))]
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(paymentBatch).where(eq(paymentBatch.tenantId, ctx.tenant.id))
    const reference = `DEMO-PAY-${String((count?.n ?? 0) + 1).padStart(4, "0")}`
    const [batch] = await tx
      .insert(paymentBatch)
      .values({
        tenantId: ctx.tenant.id,
        reference,
        bankAccountId: account.id,
        paymentDate: input.paymentDate,
        dueThrough: input.dueThrough,
        paymentMethod: input.paymentMethod,
        totalMinor: total,
        currency: account.currency,
        jobId: jobs.length === 1 ? jobs[0]! : null,
        state: "awaiting_approval",
        preparedBy: ctx.user.id,
      })
      .returning()
    const rows = await tx
      .insert(payment)
      .values(items.map((i, n) => ({ tenantId: ctx.tenant.id, batchId: batch!.id, seq: n + 1, sourceType: i.sourceType, sourceId: i.sourceId, category: i.category, jobId: i.jobId, payee: i.payee, amountMinor: i.amountMinor, currency: account.currency, state: "pending_approval" })))
      .returning()
    let anchorJob: { id: string; revision: number } | null = null
    if (jobs.length === 1) {
      const [j] = await tx.select({ id: job.id, revision: job.revision }).from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, jobs[0]!))).limit(1)
      anchorJob = j ?? null
    }
    const payload = {
      action: "payments.batch",
      batchId: batch!.id,
      batchRevision: batch!.revision,
      reference,
      bankAccountId: account.id,
      accountAlias: conn.accountAlias,
      paymentDate: input.paymentDate,
      paymentMethod: input.paymentMethod,
      totalMinor: total,
      currency: account.currency,
      payments: rows.map((p) => ({ paymentId: p.id, sourceType: p.sourceType, sourceId: p.sourceId, category: p.category, payee: p.payee, amountMinor: p.amountMinor })),
    }
    const appr = await requestFinanceApproval(tx, ctx, {
      actionType: "payments.batch",
      skillId: "agency-payment-run",
      job: anchorJob,
      aggregate: { type: "payment_batch", id: batch!.id, revision: batch!.revision },
      payload,
      impact: { totalMinor: total, currency: account.currency, availableBeforeMinor: pos.availableMinor, availableAfterHoldMinor: pos.availableMinor - total },
      title: `Payment batch ${reference}`,
      amountMinor: total,
      currency: account.currency,
      destination: `demo_bank:${conn.accountAlias}`,
      policyId: PAYMENT_BATCH_POLICY,
      origin: meta.origin,
    })
    await tx.update(paymentBatch).set({ approvalId: appr.approval.id, proposalId: appr.proposal.id }).where(eq(paymentBatch.id, batch!.id))
    const summary = paymentOrderSummary(items, account.currency, input.paymentDate)
    return {
      result: {
        batchId: batch!.id,
        reference,
        state: "awaiting_approval",
        ...appr.approvalSummary,
        payment_list_proposal: { totalMinor: total, currency: account.currency, items: rows.map((p) => ({ paymentId: p.id, seq: p.seq, category: p.category, payee: p.payee, amountMinor: p.amountMinor, sourceType: p.sourceType, sourceId: p.sourceId })) },
        payment_orders_draft: rows.map((p) => ({ paymentId: p.id, method: input.paymentMethod, date: input.paymentDate, amountMinor: p.amountMinor, currency: p.currency, label: "Simulate payment" })),
        withholding_schedule: rows.map((p) => ({ paymentId: p.id, ...withholding({ currency: account.currency, method: "per_payment", paymentBaseMinor: p.amountMinor, accumulatedBaseMinor: 0n, accumulatedWithheldMinor: 0n, nonTaxableMinimumMinor: 0n, rateBps: 0, minimumWithholdingMinor: 0n }), profile: "DEMO_NO_TAX (synthetic; no withholding)" })),
        release_proposal: { fundsHold: { onApproval: true, amountMinor: total, availableBeforeMinor: pos.availableMinor, availableAfterHoldMinor: pos.availableMinor - total }, invoicesOnHold: held },
        bank_file_request: { format: "simulated", sent: false, note: "No bank file is produced; each payment is a simulated demo-bank effect with a sim_* receipt." },
        approval_requests: [appr.approvalSummary],
        terms: summary.terms,
        aging: summary.agingReport,
      },
      events: [
        { eventType: "payments.batch_proposed", aggregateType: "payment_batch", aggregateId: batch!.id, jobId: anchorJob?.id ?? null, payload: { reference, totalMinor: total, currency: account.currency, items: rows.length } },
        ...appr.events,
      ],
    }
  },
})

type ExecResult = { ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }

/** Executor: re-validates the exact batch and reserves funds atomically. */
export async function applyPaymentBatchApproval(
  tx: Tx,
  ctx: AgencyContext,
  payload: { batchId: string; batchRevision: number; totalMinor: string; payments: { paymentId: string; sourceType: string; sourceId: string; amountMinor: string }[] },
  mode: "check" | "apply"
): Promise<ExecResult> {
  const [batch] = await tx.select().from(paymentBatch).where(and(eq(paymentBatch.tenantId, ctx.tenant.id), eq(paymentBatch.id, payload.batchId))).for("update").limit(1)
  if (!batch || batch.revision !== payload.batchRevision || batch.state !== "awaiting_approval") return { ok: false, code: "approval_stale", details: { batchId: payload.batchId } }
  const { account, conn } = await bankAccountById(tx, ctx.tenant.id, batch.bankAccountId)
  if (conn.state !== "connected_demo") return { ok: false, code: "connection_revoked", details: { connectionId: conn.id } }
  const rows = await tx.select().from(payment).where(and(eq(payment.tenantId, ctx.tenant.id), eq(payment.batchId, batch.id))).orderBy(asc(payment.seq))
  const same = rows.length === payload.payments.length && rows.every((r, i) => r.id === payload.payments[i]!.paymentId && r.amountMinor.toString() === payload.payments[i]!.amountMinor && r.state === "pending_approval")
  if (!same) return { ok: false, code: "approval_stale", details: { reason: "batch_items_changed" } }
  // One lock per tenant+entity+account+currency serializes reservations.
  await lockBankAccount(tx, ctx.tenant.id, account.id)
  const pos = await cashPosition(tx, ctx.tenant.id, account.id)
  if (pos.availableMinor < batch.totalMinor) {
    return { ok: false, code: "insufficient_funds", details: { rule: "insufficient_funds", availableMinor: pos.availableMinor.toString(), requestedMinor: batch.totalMinor.toString(), currency: batch.currency } }
  }
  if (mode === "check") return { ok: true, events: [] }
  await tx.insert(paymentHold).values(rows.map((r) => ({ tenantId: ctx.tenant.id, bankAccountId: account.id, paymentId: r.id, amountMinor: r.amountMinor, currency: r.currency, state: "active" })))
  await tx.update(payment).set({ state: "reserved", updatedAt: new Date(), revision: sql`${payment.revision} + 1` }).where(and(eq(payment.tenantId, ctx.tenant.id), eq(payment.batchId, batch.id)))
  await tx.update(paymentBatch).set({ state: "reserved", approvedBy: ctx.user.id, updatedAt: new Date(), revision: sql`${paymentBatch.revision} + 1` }).where(eq(paymentBatch.id, batch.id))
  const after = await cashPosition(tx, ctx.tenant.id, account.id)
  return {
    ok: true,
    events: [
      {
        eventType: "payments.funds_reserved",
        aggregateType: "payment_batch",
        aggregateId: batch.id,
        jobId: batch.jobId,
        payload: { totalMinor: batch.totalMinor, currency: batch.currency, confirmedMinor: after.confirmedMinor, activeHoldsMinor: after.activeHoldsMinor, availableMinor: after.availableMinor },
      },
    ],
  }
}

const PAYMENT_RULE: Record<string, { rule: string; debit: string; memo: string }> = {
  media: { rule: "journal_media_payment", debit: "ap_media", memo: "Media supplier paid (settles payable; no new cost)" },
  production: { rule: "journal_production_payment", debit: "ap_production", memo: "Production supplier paid (settles payable; no new cost)" },
  expense: { rule: "journal_expense_reimbursement", debit: "expense_payable", memo: "Expense reimbursed (settles the recognized expense)" },
  payroll: { rule: "journal_payroll_settlement", debit: "payroll_payable", memo: "Payroll settled (labor already recognized)" },
}

/** Applies a confirmed payment exactly once: bank debit + journal + hold consumed. */
async function settlePayment(tx: Tx, ctx: AgencyContext, p: typeof payment.$inferSelect, account: BankAccountRow, receiptId: string, businessDate: string, statementLineId: string | null) {
  await assertPeriodOpen(tx, ctx.tenant.id, periodOf(businessDate))
  const bank = await recordBankTransaction(tx, ctx, {
    bankAccountId: account.id,
    direction: "out",
    amountMinor: p.amountMinor,
    currency: p.currency,
    businessDate,
    kind: "payment",
    providerReceiptId: receiptId,
    sourceType: "payment",
    sourceId: p.id,
    detail: { payee: p.payee, category: p.category },
    statementLineId,
  })
  const r = PAYMENT_RULE[p.category]!
  const posted = await postJournals(tx, ctx, [
    {
      entryKey: `payment:${p.id}`,
      ruleKey: r.rule,
      sourceType: "payment",
      sourceId: p.id,
      jobId: p.jobId,
      businessDate,
      currency: p.currency,
      memo: r.memo,
      reportingGroup: account.reportingGroup,
      lines: [
        { account: r.debit, side: "debit", amountMinor: p.amountMinor },
        { account: "cash", side: "credit", amountMinor: p.amountMinor },
      ],
    },
  ])
  const entry = posted.entries.find((e) => e.entryKey === `payment:${p.id}`)
  await tx
    .update(payment)
    .set({ state: "succeeded", receiptId, bankTransactionId: bank.transaction.id, journalEntryId: entry?.id ?? p.journalEntryId, businessDate, updatedAt: new Date(), revision: sql`${payment.revision} + 1` })
    .where(eq(payment.id, p.id))
  await tx.update(paymentHold).set({ state: "consumed", updatedAt: new Date() }).where(and(eq(paymentHold.tenantId, ctx.tenant.id), eq(paymentHold.paymentId, p.id)))
  if (p.sourceType === "supplier_invoice") {
    const [inv] = await tx
      .update(supplierInvoice)
      .set({ paidMinor: sql`${supplierInvoice.paidMinor} + ${p.amountMinor}`, updatedAt: new Date(), revision: sql`${supplierInvoice.revision} + 1` })
      .where(eq(supplierInvoice.id, p.sourceId))
      .returning()
    if (inv && inv.paidMinor >= inv.amountMinor) await tx.update(supplierInvoice).set({ state: "paid" }).where(eq(supplierInvoice.id, inv.id))
  } else if (p.sourceType === "expense") {
    await tx.update(expense).set({ state: "reimbursed", updatedAt: new Date(), revision: sql`${expense.revision} + 1` }).where(eq(expense.id, p.sourceId))
  }
  const remaining = await tx
    .select({ id: payment.id })
    .from(payment)
    .where(and(eq(payment.tenantId, ctx.tenant.id), eq(payment.batchId, p.batchId), notInArray(payment.state, ["succeeded", "failed", "cancelled"])))
  await tx
    .update(paymentBatch)
    .set({ state: remaining.length ? "executing" : "executed", updatedAt: new Date(), revision: sql`${paymentBatch.revision} + 1` })
    .where(eq(paymentBatch.id, p.batchId))
  const pos = await cashPosition(tx, ctx.tenant.id, account.id)
  return {
    cash: pos,
    events: [
      { eventType: "payments.payment_settled", aggregateType: "payment", aggregateId: p.id, jobId: p.jobId, payload: { receiptId, amountMinor: p.amountMinor, currency: p.currency, category: p.category, confirmedMinor: pos.confirmedMinor, simulation: true }, businessEffectiveAt: new Date(`${businessDate}T12:00:00Z`) },
      ...posted.events,
    ] as EmittedEvent[],
  }
}

async function lockPayment(tx: Tx, tenantId: string, paymentId: string) {
  const [p] = await tx.select().from(payment).where(and(eq(payment.tenantId, tenantId), eq(payment.id, paymentId))).for("update").limit(1)
  if (!p) throw new DomainError("not_found", "Payment not found")
  const [batch] = await tx.select().from(paymentBatch).where(and(eq(paymentBatch.tenantId, tenantId), eq(paymentBatch.id, p.batchId))).limit(1)
  return { p, batch: batch! }
}

// ── Simulate payment (one approved payment at a time) ──

export const ExecuteBatchPaymentInput = z
  .object({
    paymentId: z.string().uuid(),
    businessDate: IsoDate.optional(),
  })
  .strict()

export const executeBatchPayment = defineCommand({
  type: "payments.executePayment",
  skillId: "agency-payment-run",
  permission: "payments.execute",
  input: ExecuteBatchPaymentInput,
  handler: async (tx, ctx, input) => {
    const { p, batch } = await lockPayment(tx, ctx.tenant.id, input.paymentId)
    if (p.state === "succeeded") {
      return { result: { paymentId: p.id, state: p.state, receiptId: p.receiptId, replayed: true, simulation: true }, events: [] }
    }
    if (p.state === "outcome_unknown") blocked("outcome_unknown_reconcile_first", "The outcome is unknown; reconcile with the provider before any retry (never resent blindly)", { paymentId: p.id })
    if (!["reserved", "failed_retryable"].includes(p.state) || !["reserved", "executing"].includes(batch.state)) {
      blocked("payment_not_reserved", "Only approved payments with reserved funds can be executed", { paymentState: p.state, batchState: batch.state })
    }
    const [hold] = await tx.select().from(paymentHold).where(and(eq(paymentHold.tenantId, ctx.tenant.id), eq(paymentHold.paymentId, p.id), eq(paymentHold.state, "active"))).limit(1)
    if (!hold) blocked("funds_not_reserved", "No active funds hold for this payment", { paymentId: p.id })
    const { account, conn } = await bankAccountById(tx, ctx.tenant.id, batch.bankAccountId)
    assertConnected(conn)
    const businessDate = input.businessDate ?? batch.paymentDate
    await assertPeriodOpen(tx, ctx.tenant.id, periodOf(businessDate))
    // The fictional provider's behaviour comes only from a presenter-queued
    // directive (queuePaymentSimulationOutcome); otherwise success.
    const directive = await takePaymentDirective(tx, ctx.tenant.id)
    const mode = directive?.failureMode ?? "success"
    const res = await executeDemoPayment(tx, {
      tenantId: ctx.tenant.id,
      connection: conn,
      approvedActionId: `${batch.approvalId}:${p.id}`,
      payment: { paymentId: p.id, amountMinor: p.amountMinor, currency: p.currency, payee: p.payee, sourceType: p.sourceType, sourceId: p.sourceId },
      businessDate,
      failureMode: mode,
    })
    if (directive) await markDirectiveConsumed(tx, directive.id, res.operationId)
    const base = { attempts: sql`${payment.attempts} + 1`, adapterOperationId: res.operationId, updatedAt: new Date() }
    const audit: EmittedEvent = { eventType: "payments.simulation_executed", aggregateType: "payment", aggregateId: p.id, jobId: p.jobId, payload: { simulationMode: mode, directiveId: directive?.id ?? null, adapterState: res.state, operationId: res.operationId, simulation: true } }
    if (res.state === "succeeded") {
      await tx.update(payment).set(base).where(eq(payment.id, p.id))
      const settled = await settlePayment(tx, ctx, p, account, res.receiptId, businessDate, null)
      return { result: { paymentId: p.id, state: "succeeded", receiptId: res.receiptId, replayed: res.replayed, cash: settled.cash, simulation: true }, events: [audit, ...settled.events] }
    }
    if (res.state === "outcome_unknown") {
      await tx.update(payment).set({ ...base, state: "outcome_unknown", lastError: "timeout_after_effect", businessDate }).where(eq(payment.id, p.id))
      await tx.update(paymentBatch).set({ state: "executing", updatedAt: new Date(), revision: sql`${paymentBatch.revision} + 1` }).where(eq(paymentBatch.id, batch.id))
      const pos = await cashPosition(tx, ctx.tenant.id, account.id)
      return {
        result: { paymentId: p.id, state: "outcome_unknown", receiptId: null, nextStep: "Reconcile with the provider; the funds hold stays until then.", cash: pos, simulation: true },
        events: [audit, { eventType: "payments.outcome_unknown", aggregateType: "payment", aggregateId: p.id, jobId: p.jobId, payload: { rule: "unknown-outcome-v1", operationId: res.operationId, amountMinor: p.amountMinor } }],
      }
    }
    // No effect happened. Retryable failures keep the hold; others release it.
    const retryable = res.retryable
    await tx.update(payment).set({ ...base, state: retryable ? "failed_retryable" : "failed", lastError: res.error }).where(eq(payment.id, p.id))
    if (!retryable) await tx.update(paymentHold).set({ state: "released", updatedAt: new Date() }).where(eq(paymentHold.id, hold.id))
    const pos = await cashPosition(tx, ctx.tenant.id, account.id)
    return {
      result: { paymentId: p.id, state: retryable ? "failed_retryable" : "failed", error: res.error, connectionRevoked: res.connectionRevoked, cash: pos, simulation: true, nextStep: retryable ? "Retry with the same approved action (same idempotency key)." : "Resolve the cause; the liability returns to the next payment run." },
      events: [audit, { eventType: "payments.payment_failed", aggregateType: "payment", aggregateId: p.id, jobId: p.jobId, payload: { error: res.error, retryable, holdReleased: !retryable } }],
    }
  },
})

export const ReconcileBatchPaymentInput = z.object({ paymentId: z.string().uuid() }).strict()

export const reconcileBatchPayment = defineCommand({
  type: "payments.reconcilePayment",
  skillId: "agency-payment-run",
  permission: "payments.execute",
  input: ReconcileBatchPaymentInput,
  handler: async (tx, ctx, input) => {
    const { p, batch } = await lockPayment(tx, ctx.tenant.id, input.paymentId)
    if (p.state === "succeeded") return { result: { paymentId: p.id, state: "succeeded", receiptId: p.receiptId, replayed: true, effectCount: 1 }, events: [] }
    if (p.state !== "outcome_unknown" || !p.adapterOperationId) blocked("nothing_to_reconcile", "Only a payment with an unknown outcome is reconciled", { state: p.state })
    const { account } = await bankAccountById(tx, ctx.tenant.id, batch.bankAccountId)
    const rec = await reconcileDemoPayment(tx, ctx.tenant.id, p.adapterOperationId)
    if (rec.state === "succeeded") {
      const settled = await settlePayment(tx, ctx, p, account, rec.receiptId, p.businessDate ?? batch.paymentDate, null)
      return {
        result: { paymentId: p.id, state: "succeeded", receiptId: rec.receiptId, effectCount: rec.effectCount, cash: settled.cash },
        events: [{ eventType: "payments.outcome_reconciled", aggregateType: "payment", aggregateId: p.id, jobId: p.jobId, payload: { receiptId: rec.receiptId, effectCount: rec.effectCount } }, ...settled.events],
      }
    }
    await tx.update(payment).set({ state: "failed", lastError: "no_effect_confirmed", updatedAt: new Date() }).where(eq(payment.id, p.id))
    await tx.update(paymentHold).set({ state: "released", updatedAt: new Date() }).where(and(eq(paymentHold.tenantId, ctx.tenant.id), eq(paymentHold.paymentId, p.id)))
    return {
      result: { paymentId: p.id, state: "failed", receiptId: null, effectCount: 0 },
      events: [{ eventType: "payments.outcome_reconciled", aggregateType: "payment", aggregateId: p.id, jobId: p.jobId, payload: { effectCount: 0, holdReleased: true } }],
    }
  },
})

// ── Demo bank statement (provider export) ──

const STATEMENT_HEADERS = ["line_id", "business_date", "direction", "amount_minor", "currency", "reference", "description"]

export const ExportDemoBankStatementInput = z.object({ connection: z.string().uuid(), statementDate: IsoDate }).strict()

/** The fictional bank's own statement: movements not yet imported. */
export const exportDemoBankStatement = defineCommand({
  type: "cash.exportDemoBankStatement",
  skillId: "agency-cash-settlement",
  permission: "payables.manage",
  input: ExportDemoBankStatementInput,
  handler: async (tx, ctx, input) => {
    const { account, conn } = await bankAccountByConnection(tx, ctx.tenant.id, input.connection)
    const imported = await tx.select({ lineId: bankStatementLine.lineId }).from(bankStatementLine).where(and(eq(bankStatementLine.tenantId, ctx.tenant.id), eq(bankStatementLine.bankAccountId, account.id)))
    const done = new Set(imported.map((r) => r.lineId))
    const recorded = await tx
      .select()
      .from(bankTransaction)
      .where(and(eq(bankTransaction.tenantId, ctx.tenant.id), eq(bankTransaction.bankAccountId, account.id), lte(bankTransaction.businessDate, input.statementDate)))
      .orderBy(asc(bankTransaction.businessDate), asc(bankTransaction.createdAt))
    const lines = recorded
      .filter((t) => t.kind !== "opening")
      .map((t) => ({ lineId: `bl_${t.providerReceiptId}`, businessDate: t.businessDate, direction: t.direction, amountMinor: t.amountMinor, currency: t.currency, reference: t.providerReceiptId, description: t.kind === "collection" ? "Incoming transfer" : "Outgoing transfer" }))
    for (const e of await demoBankEffects(tx, ctx.tenant.id, conn.accountAlias)) {
      if (lines.some((l) => l.reference === e.receiptId) || e.businessDate > input.statementDate) continue
      lines.push({ lineId: `bl_${e.receiptId}`, businessDate: e.businessDate, direction: e.direction, amountMinor: e.amountMinor, currency: e.currency, reference: e.receiptId, description: e.description })
    }
    const fresh = lines.filter((l) => !done.has(l.lineId)).sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    const opening = recorded.filter((t) => t.kind === "opening").reduce((a, t) => a + t.amountMinor, 0n)
    const bankBalance = opening + lines.reduce((a, l) => a + (l.direction === "in" ? l.amountMinor : -l.amountMinor), 0n)
    const csv = [STATEMENT_HEADERS.join(";"), ...fresh.map((l) => [l.lineId, l.businessDate, l.direction, l.amountMinor.toString(), l.currency, l.reference, l.description].map(csvSafeCell).join(";"))].join("\n") + "\n"
    const file = await storeGeneratedFile(tx, ctx, { name: `demo-bank-statement-${conn.accountAlias}-${input.statementDate}.csv`, format: "csv", bytes: new TextEncoder().encode(csv), label: "Simulated demo bank statement — synthetic" })
    return {
      result: { fileId: file.id, lines: fresh.length, closingBalanceMinor: bankBalance, currency: account.currency, simulation: true },
      events: [{ eventType: "cash.statement_exported", aggregateType: "bank_account", aggregateId: account.id, payload: { fileId: file.id, lines: fresh.length, simulation: true } }],
    }
  },
})

// ── agency-cash-settlement: reconcileBankTransaction ──

export const ReconcileBankStatementInput = z
  .object({
    connection: z.string().uuid(),
    statementFile: z.string().uuid(),
    statementDate: IsoDate,
    closingBalance: z.string().trim().regex(/^-?\d{1,15}(\.\d{1,2})?$/),
  })
  .strict()

export const reconcileBankStatement = defineCommand({
  type: "cash.reconcileBankStatement",
  skillId: "agency-cash-settlement",
  permission: "payables.manage",
  input: ReconcileBankStatementInput,
  handler: async (tx, ctx, input) => {
    const { account } = await bankAccountByConnection(tx, ctx.tenant.id, input.connection)
    const { file, bytes } = await readTenantFile(tx, ctx.tenant.id, input.statementFile)
    if (file.format !== "csv") blocked("statement_format", "The bank statement must be a CSV file", { format: file.format })
    const parsed = parseCsv(new TextDecoder().decode(bytes), ";")
    if (STATEMENT_HEADERS.some((h, i) => parsed.headers[i] !== h)) blocked("statement_format", "Unexpected statement columns", { expected: STATEMENT_HEADERS, found: parsed.headers })
    const negative = input.closingBalance.startsWith("-")
    const closingAbs = moneyInput(input.closingBalance.replace(/^-/, ""), account.currency, "closingBalance", { allowZero: true })
    const closingMinor = negative ? -closingAbs : closingAbs
    const lines = parsed.rows.map((r, i) => {
      const [lineId, businessDate, direction, amount, currency, reference, description] = r
      if (!lineId || !businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || (direction !== "in" && direction !== "out") || !/^\d{1,18}$/.test(amount ?? "") || currency !== account.currency || !reference) {
        throw new DomainError("validation", "Invalid statement line", { row: i + 2 })
      }
      return { lineId, businessDate, direction, amountMinor: BigInt(amount!), reference, description: description ?? "" }
    })
    // A bank line id applies once: duplicates in the file or already imported are rejected.
    const ids = lines.map((l) => l.lineId)
    const dupInFile = ids.filter((v, i) => ids.indexOf(v) !== i)
    const already = ids.length
      ? await tx.select({ lineId: bankStatementLine.lineId }).from(bankStatementLine).where(and(eq(bankStatementLine.tenantId, ctx.tenant.id), eq(bankStatementLine.bankAccountId, account.id), inArray(bankStatementLine.lineId, ids)))
      : []
    if (dupInFile.length || already.length) blocked("duplicate_bank_transaction", "These bank line ids were already applied; repeating a statement never moves cash twice", { lineIds: [...new Set([...dupInFile, ...already.map((a) => a.lineId)])] })

    const recorded = await tx.select().from(bankTransaction).where(and(eq(bankTransaction.tenantId, ctx.tenant.id), eq(bankTransaction.bankAccountId, account.id)))
    const effects = await demoBankEffects(tx, ctx.tenant.id, (await bankAccountById(tx, ctx.tenant.id, account.id)).conn.accountAlias)
    type Outcome = { lineId: string; outcome: "matched" | "settled" | "unapplied" | "bank_charge"; amountMinor: bigint; direction: string; reference: string; businessDate: string; paymentId?: string; bankTransactionId?: string | null }
    const plan: Outcome[] = []
    for (const l of lines) {
      const existing = recorded.find((t) => t.providerReceiptId === l.reference)
      if (existing) {
        if (existing.amountMinor !== l.amountMinor || existing.direction !== l.direction) blocked("allocation_mismatch", "The bank line differs from the recorded movement", { lineId: l.lineId })
        plan.push({ ...l, outcome: "matched", bankTransactionId: existing.id })
        continue
      }
      const effect = effects.find((e) => e.receiptId === l.reference)
      if (effect && l.direction === "out") {
        const match = await paymentForReceipt(tx, ctx.tenant.id, l.reference)
        if (match && match.state === "outcome_unknown") {
          if (l.amountMinor < match.amountMinor) blocked("allocation_exceeds_transaction", "The liability exceeds the bank line amount", { lineId: l.lineId, lineMinor: l.amountMinor.toString(), liabilityMinor: match.amountMinor.toString() })
          if (l.amountMinor !== match.amountMinor) blocked("allocation_mismatch", "The bank line differs from the payment amount", { lineId: l.lineId })
          plan.push({ ...l, outcome: "settled", paymentId: match.id })
          continue
        }
      }
      plan.push({ ...l, outcome: l.direction === "in" ? "unapplied" : "bank_charge" })
    }

    const [imp] = await tx
      .insert(bankStatementImport)
      .values({ tenantId: ctx.tenant.id, bankAccountId: account.id, fileId: file.id, fileSha256: file.sha256, statementDate: input.statementDate, closingBalanceMinor: closingMinor, bookBalanceMinor: 0n, differenceMinor: 0n, currency: account.currency, createdBy: ctx.user.id })
      .returning()
    const events: EmittedEvent[] = []
    for (const o of plan) {
      let bankTransactionId = o.bankTransactionId ?? null
      if (o.outcome === "settled") {
        const { p } = await lockPayment(tx, ctx.tenant.id, o.paymentId!)
        const settled = await settlePayment(tx, ctx, p, account, o.reference, p.businessDate ?? o.businessDate, o.lineId)
        events.push({ eventType: "cash.statement_settled_payment", aggregateType: "payment", aggregateId: p.id, jobId: p.jobId, payload: { lineId: o.lineId, receiptId: o.reference } }, ...settled.events)
        const [bt] = await tx.select({ id: bankTransaction.id }).from(bankTransaction).where(and(eq(bankTransaction.tenantId, ctx.tenant.id), eq(bankTransaction.bankAccountId, account.id), eq(bankTransaction.providerReceiptId, o.reference))).limit(1)
        bankTransactionId = bt?.id ?? null
      }
      await tx.insert(bankStatementLine).values({ tenantId: ctx.tenant.id, bankAccountId: account.id, importId: imp!.id, lineId: o.lineId, businessDate: o.businessDate, direction: o.direction, amountMinor: o.amountMinor, reference: o.reference, outcome: o.outcome, bankTransactionId })
    }
    const pos = await cashPosition(tx, ctx.tenant.id, account.id, input.statementDate)
    const difference = closingMinor - pos.confirmedMinor
    const report = {
      statementDate: input.statementDate,
      currency: account.currency,
      statementClosingMinor: closingMinor,
      bookBalanceMinor: pos.confirmedMinor,
      differenceMinor: difference,
      reconciled: difference === 0n && plan.every((o) => o.outcome === "matched" || o.outcome === "settled"),
      lines: plan.map((o) => ({ lineId: o.lineId, outcome: o.outcome, amountMinor: o.amountMinor, direction: o.direction, reference: o.reference })),
    }
    await tx.update(bankStatementImport).set({ bookBalanceMinor: pos.confirmedMinor, differenceMinor: difference, result: toJsonSafe(report) as object }).where(eq(bankStatementImport.id, imp!.id))
    events.push({ eventType: "cash.statement_reconciled", aggregateType: "bank_account", aggregateId: account.id, payload: { importId: imp!.id, lines: plan.length, differenceMinor: difference, settled: plan.filter((o) => o.outcome === "settled").length } })
    return {
      result: {
        importId: imp!.id,
        deposit_proposals: plan.filter((o) => o.outcome === "unapplied").map((o) => ({ lineId: o.lineId, amountMinor: o.amountMinor, reference: o.reference, proposal: "Identify the payer, then allocate through agency-collections (not counted as AR settlement until allocated)." })),
        bank_charge_entries: plan.filter((o) => o.outcome === "bank_charge").map((o) => ({ lineId: o.lineId, amountMinor: o.amountMinor, reference: o.reference, proposal: "Review as a bank charge journal (not posted automatically)." })),
        reconciliation_report: report,
        cheque_actions: { items: [], reason: "The simulated demo bank has no cheques." },
        card_statement_match: { items: [], reason: "No card statements in the demo bank." },
        availability_snapshot: { ...pos, basis: "confirmed_demo_bank", asOf: input.statementDate },
        unapplied_cash: { totalMinor: plan.filter((o) => o.outcome === "unapplied").reduce((a, o) => a + o.amountMinor, 0n), currency: account.currency },
      },
      events,
    }
  },
})

async function paymentForReceipt(tx: Tx, tenantId: string, receiptId: string) {
  // Receipt → provider effect → adapter operation → the unknown payment.
  const [row] = await tx
    .select({ p: payment })
    .from(demoProviderEffect)
    .innerJoin(adapterOperation, and(eq(adapterOperation.tenantId, demoProviderEffect.tenantId), eq(adapterOperation.provider, demoProviderEffect.provider), eq(adapterOperation.idempotencyKey, demoProviderEffect.idempotencyKey)))
    .innerJoin(payment, and(eq(payment.tenantId, adapterOperation.tenantId), eq(payment.adapterOperationId, adapterOperation.id)))
    .where(and(eq(demoProviderEffect.tenantId, tenantId), eq(demoProviderEffect.receiptId, receiptId)))
    .limit(1)
  return row?.p ?? null
}

// ── Queries ──

export async function previewPaymentRun(ctx: AgencyContext, input: { connection: string; dueThrough: string }) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const { account } = await bankAccountByConnection(tx, ctx.tenant.id, input.connection)
    const { items, held } = await eligibleLiabilities(tx, ctx.tenant.id, account, input.dueThrough)
    const pos = await cashPosition(tx, ctx.tenant.id, account.id)
    const total = items.reduce((a, i) => a + i.amountMinor, 0n)
    return { currency: account.currency, items, held, totalMinor: total, ...pos, sufficient: pos.availableMinor >= total, overdraftAllowed: false }
  })
}

export async function listPaymentBatches(ctx: AgencyContext) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const batches = await tx.select().from(paymentBatch).where(eq(paymentBatch.tenantId, ctx.tenant.id)).orderBy(asc(paymentBatch.createdAt))
    const payments = batches.length ? await tx.select().from(payment).where(and(eq(payment.tenantId, ctx.tenant.id), inArray(payment.batchId, batches.map((b) => b.id)))).orderBy(asc(payment.seq)) : []
    return batches.map((b) => ({ ...b, payments: payments.filter((p) => p.batchId === b.id) }))
  })
}
