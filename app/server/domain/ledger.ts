import "server-only"

import { and, asc, eq, inArray, lte, ne, sql } from "drizzle-orm"
import { z } from "zod"

import type { Role } from "@/lib/policy"
import { parseDecimalToMinor } from "@/lib/money"
import type { AgencyContext } from "@/server/auth/context"
import { journalCheck } from "@/server/calculators/finance"
import type { Tx } from "@/server/db/client"
import {
  accountingAdjustment,
  accountingPeriod,
  approvalRequest,
  bankAccount,
  bankTransaction,
  clientInvoice,
  expense,
  fixedAsset,
  job,
  journalEntry,
  journalLine,
  ledgerAccount,
  paymentBatch,
  rebateCalculation,
  revenueBudgetVersion,
  supplierInvoice,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { createProposal, registerAggregateRevision, registerApprovalPolicy, requestApproval } from "@/server/kernel/approvals"
import { defineCommand, toJsonSafe, type CommandOrigin, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

// Demo ledger (contract 03 §4/§6, demo-fixtures journal_policy). Every journal
// is checked with the journal_check calculator, posts once per business fact
// (unique entry_key) and only into an open period. Subledger facts post
// through this module; nothing writes journal rows elsewhere.

export const DEMO_LEDGER_LABEL = "Demo ledger — synthetic, non-fiscal"

export type Side = "debit" | "credit"
export type PlannedLine = { account: string; side: Side; amountMinor: bigint }
export type PlannedJournal = {
  entryKey: string
  ruleKey: string
  sourceType: string
  sourceId: string | null
  jobId: string | null
  businessDate: string
  currency: string
  memo: string
  reportingGroup: string
  lines: PlannedLine[]
}

export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const Decimal = z.string().trim().min(1).max(24)

export function periodOf(date: string) {
  return date.slice(0, 7)
}

/** Parses a decimal money string; negative amounts are rejected. */
export function moneyInput(value: string, currency: string, field: string, opts: { allowZero?: boolean } = {}): bigint {
  let minor: bigint
  try {
    minor = parseDecimalToMinor(value, currency)
  } catch {
    throw new DomainError("validation", `Invalid amount for ${field}`, { field })
  }
  if (minor < 0n || (!opts.allowZero && minor === 0n)) {
    throw new DomainError("validation", `Amount for ${field} must be positive`, { field })
  }
  return minor
}

export function blocked(rule: string, message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError("blocked_by_rule", message, { rule, ...details })
}

// ── Periods ──

export async function getPeriod(tx: Tx, tenantId: string, period: string) {
  const [p] = await tx
    .select()
    .from(accountingPeriod)
    .where(and(eq(accountingPeriod.tenantId, tenantId), eq(accountingPeriod.period, period)))
    .limit(1)
  return p ?? null
}

/** Blocks any write dated in a closed (or unconfigured) period. */
export async function assertPeriodOpen(tx: Tx, tenantId: string, period: string) {
  const p = await getPeriod(tx, tenantId, period)
  if (!p) blocked("period_not_configured", `Accounting period ${period} is not configured`, { period })
  if (p.state !== "open") blocked("period_closed", `Accounting period ${period} is closed`, { period })
  return p
}

// ── Posting ──

async function insertJournal(
  tx: Tx,
  ctx: AgencyContext,
  j: PlannedJournal,
  approval: { approvalId: string | null; approvedBy: string | null; preparedBy: string | null }
) {
  const period = periodOf(j.businessDate)
  await assertPeriodOpen(tx, ctx.tenant.id, period)
  const [existing] = await tx
    .select()
    .from(journalEntry)
    .where(and(eq(journalEntry.tenantId, ctx.tenant.id), eq(journalEntry.entryKey, j.entryKey)))
    .limit(1)
  if (existing) return { entry: existing, posted: false }

  const check = journalCheck({
    entryId: j.ruleKey,
    postingDate: j.businessDate,
    lockedPeriods: [],
    lines: j.lines.map((l, i) => ({
      lineId: `l${i + 1}`,
      accountId: l.account,
      currency: j.currency,
      debitMinor: l.side === "debit" ? l.amountMinor : 0n,
      creditMinor: l.side === "credit" ? l.amountMinor : 0n,
      requiredDimensionsPresent: true,
    })),
  })
  if (check.status !== "valid") {
    blocked("journal_unbalanced", "The journal does not pass journal_check", toJsonSafe({ journalCheck: check }) as Record<string, unknown>)
  }
  const codes = [...new Set(j.lines.map((l) => l.account))]
  const known = await tx
    .select({ code: ledgerAccount.code })
    .from(ledgerAccount)
    .where(and(eq(ledgerAccount.tenantId, ctx.tenant.id), inArray(ledgerAccount.code, codes)))
  const missing = codes.filter((c) => !known.some((k) => k.code === c))
  if (missing.length) blocked("unknown_account", "Unknown ledger account", { accounts: missing })

  const [entry] = await tx
    .insert(journalEntry)
    .values({
      tenantId: ctx.tenant.id,
      entryKey: j.entryKey,
      ruleKey: j.ruleKey,
      sourceType: j.sourceType,
      sourceId: j.sourceId,
      jobId: j.jobId,
      period,
      businessDate: j.businessDate,
      currency: j.currency,
      memo: j.memo,
      ledgerLabel: DEMO_LEDGER_LABEL,
      reportingGroup: j.reportingGroup,
      preparedBy: approval.preparedBy ?? ctx.user.id,
      approvedBy: approval.approvedBy,
      approvalId: approval.approvalId,
    })
    .onConflictDoNothing()
    .returning()
  if (!entry) {
    const [again] = await tx
      .select()
      .from(journalEntry)
      .where(and(eq(journalEntry.tenantId, ctx.tenant.id), eq(journalEntry.entryKey, j.entryKey)))
      .limit(1)
    return { entry: again!, posted: false }
  }
  await tx.insert(journalLine).values(
    j.lines.map((l, i) => ({
      tenantId: ctx.tenant.id,
      entryId: entry.id,
      lineNo: i + 1,
      accountCode: l.account,
      debitMinor: l.side === "debit" ? l.amountMinor : 0n,
      creditMinor: l.side === "credit" ? l.amountMinor : 0n,
      currency: j.currency,
      jobId: j.jobId,
    }))
  )
  return { entry, posted: true }
}

/**
 * The opening balance of each simulated bank account is a confirmed bank
 * entry (seeded); its journal posts the first time the ledger is used.
 */
export async function ensureOpeningJournals(tx: Tx, ctx: AgencyContext) {
  const rows = await tx
    .select({ t: bankTransaction, group: bankAccount.reportingGroup })
    .from(bankTransaction)
    .innerJoin(bankAccount, and(eq(bankAccount.tenantId, bankTransaction.tenantId), eq(bankAccount.id, bankTransaction.bankAccountId)))
    .where(and(eq(bankTransaction.tenantId, ctx.tenant.id), eq(bankTransaction.kind, "opening")))
    .orderBy(asc(bankTransaction.createdAt))
  const posted: (typeof journalEntry.$inferSelect)[] = []
  for (const { t, group } of rows) {
    const p = await getPeriod(tx, ctx.tenant.id, periodOf(t.businessDate))
    if (!p || p.state !== "open") continue
    const res = await insertJournal(
      tx,
      ctx,
      {
        entryKey: `opening:${t.id}`,
        ruleKey: "journal_opening",
        sourceType: "bank_transaction",
        sourceId: t.id,
        jobId: null,
        businessDate: t.businessDate,
        currency: t.currency,
        memo: "Opening balance of the simulated bank account",
        reportingGroup: group,
        lines: [
          { account: "cash", side: "debit", amountMinor: t.amountMinor },
          { account: "opening_equity", side: "credit", amountMinor: t.amountMinor },
        ],
      },
      { approvalId: null, approvedBy: null, preparedBy: null }
    )
    if (res.posted) posted.push(res.entry)
  }
  return posted
}

export type PostedJournal = typeof journalEntry.$inferSelect

/** Posts planned journals in order (opening balances first). Idempotent. */
export async function postJournals(
  tx: Tx,
  ctx: AgencyContext,
  journals: PlannedJournal[],
  approval: { approvalId?: string | null; approvedBy?: string | null; preparedBy?: string | null } = {}
): Promise<{ entries: PostedJournal[]; events: EmittedEvent[] }> {
  const opening = await ensureOpeningJournals(tx, ctx)
  const entries: PostedJournal[] = [...opening]
  for (const j of journals) {
    const res = await insertJournal(tx, ctx, j, {
      approvalId: approval.approvalId ?? null,
      approvedBy: approval.approvedBy ?? null,
      preparedBy: approval.preparedBy ?? null,
    })
    if (res.posted) entries.push(res.entry)
  }
  return {
    entries,
    events: entries.map((e) => ({
      eventType: "ledger.journal_posted",
      aggregateType: "journal_entry",
      aggregateId: e.id,
      jobId: e.jobId,
      payload: { ruleKey: e.ruleKey, entryKey: e.entryKey, period: e.period, currency: e.currency, ledger: DEMO_LEDGER_LABEL },
      businessEffectiveAt: new Date(`${e.businessDate}T12:00:00Z`),
    })),
  }
}

export async function reportingGroupOfJob(tx: Tx, tenantId: string, jobId: string | null) {
  if (!jobId) return "primary"
  const [j] = await tx
    .select({ group: job.reportingGroup })
    .from(job)
    .where(and(eq(job.tenantId, tenantId), eq(job.id, jobId)))
    .limit(1)
  if (!j) throw new DomainError("not_found", "Job not found")
  return j.group
}

// ── Reads ──

export async function journalsWithLines(tx: Tx, tenantId: string, filter: { jobId?: string; excludeGroups?: string[]; period?: string; throughPeriod?: string } = {}) {
  const conds = [eq(journalEntry.tenantId, tenantId), eq(journalEntry.state, "posted")]
  if (filter.jobId) conds.push(eq(journalEntry.jobId, filter.jobId))
  if (filter.period) conds.push(eq(journalEntry.period, filter.period))
  if (filter.throughPeriod) conds.push(lte(journalEntry.period, filter.throughPeriod))
  for (const g of filter.excludeGroups ?? []) conds.push(ne(journalEntry.reportingGroup, g))
  const entries = await tx.select().from(journalEntry).where(and(...conds)).orderBy(asc(journalEntry.seq))
  const lines = entries.length
    ? await tx
        .select()
        .from(journalLine)
        .where(and(eq(journalLine.tenantId, tenantId), inArray(journalLine.entryId, entries.map((e) => e.id))))
        .orderBy(asc(journalLine.lineNo))
    : []
  return entries.map((e) => ({ ...e, lines: lines.filter((l) => l.entryId === e.id) }))
}

const REVENUE_EXPENSE = new Set(["revenue", "expense"])

/** Trial balance (debit positive, credit negative) per currency. */
export async function trialBalance(tx: Tx, tenantId: string, filter: { period?: string; throughPeriod?: string; excludeGroups?: string[]; jobId?: string } = {}) {
  const journals = await journalsWithLines(tx, tenantId, filter)
  const accounts = await tx.select().from(ledgerAccount).where(eq(ledgerAccount.tenantId, tenantId))
  const typeOf = new Map(accounts.map((a) => [a.code, a.accountType]))
  const byCurrency = new Map<string, Map<string, bigint>>()
  for (const j of journals) {
    const m = byCurrency.get(j.currency) ?? new Map<string, bigint>()
    for (const l of j.lines) m.set(l.accountCode, (m.get(l.accountCode) ?? 0n) + l.debitMinor - l.creditMinor)
    byCurrency.set(j.currency, m)
  }
  return {
    ledger: DEMO_LEDGER_LABEL,
    journalCount: journals.length,
    currencies: [...byCurrency.entries()].map(([currency, m]) => {
      const balances = Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)))
      const sumMinor = [...m.values()].reduce((s, v) => s + v, 0n)
      const pnl = [...m.entries()].filter(([code]) => REVENUE_EXPENSE.has(typeOf.get(code) ?? "")).reduce((s, [, v]) => s + v, 0n)
      return { currency, balances, sumMinor, netProfitMinor: -pnl }
    }),
  }
}

/** Sum of (debit − credit) of one account for a job (posted journals). */
export async function accountBalance(tx: Tx, tenantId: string, account: string, filter: { jobId?: string; bankGroup?: string } = {}) {
  const conds = [eq(journalLine.tenantId, tenantId), eq(journalLine.accountCode, account), eq(journalEntry.state, "posted")]
  if (filter.jobId) conds.push(eq(journalLine.jobId, filter.jobId))
  const [row] = await tx
    .select({ v: sql<string>`coalesce(sum(${journalLine.debitMinor} - ${journalLine.creditMinor}), 0)` })
    .from(journalLine)
    .innerJoin(journalEntry, and(eq(journalEntry.tenantId, journalLine.tenantId), eq(journalEntry.id, journalLine.entryId)))
    .where(and(...conds))
  return BigInt(row?.v ?? "0")
}

export async function loadJob(tx: Tx, tenantId: string, jobId: string) {
  const [j] = await tx.select().from(job).where(and(eq(job.tenantId, tenantId), eq(job.id, jobId))).limit(1)
  if (!j) throw new DomainError("not_found", "Job not found")
  return j
}

// ── Approvals shared by the finance modules ──

/** Live state of an approval request (null when none). */
export async function approvalStateOf(tx: Tx, tenantId: string, approvalId: string | null) {
  if (!approvalId) return null
  const [a] = await tx
    .select({ state: approvalRequest.state })
    .from(approvalRequest)
    .where(and(eq(approvalRequest.tenantId, tenantId), eq(approvalRequest.id, approvalId)))
    .limit(1)
  return a?.state ?? null
}

/** True while an approval can still lead to execution. */
export function approvalIsLive(state: string | null) {
  return state === "awaiting_approval" || state === "approved"
}

export type FinanceApprovalSpec = {
  actionType: string
  skillId: string
  /** Job the action belongs to (context only; approvals bind the aggregate below). */
  job: { id: string; revision: number } | null
  /** Finance aggregate the approval binds to (exact record revision). */
  aggregate: { type: FinanceAggregate; id: string; revision: number }
  payload: Record<string, unknown>
  diff?: Record<string, unknown>
  impact?: Record<string, unknown>
  title: string
  amountMinor?: bigint | null
  currency?: string | null
  destination?: string | null
  policyId: string
  eligibleRoles?: readonly Role[]
  origin: CommandOrigin
}

/**
 * Finance approvals bind the finance record itself (supplier invoice, batch,
 * adjustment…), not the job: an unrelated job change neither stales them nor
 * shows up as a pending job amendment. The record revision is in the payload
 * and re-checked by each executor.
 */
export async function requestFinanceApproval(tx: Tx, ctx: AgencyContext, spec: FinanceApprovalSpec) {
  const proposal = await createProposal(
    tx,
    ctx,
    {
      actionType: spec.actionType,
      skillId: spec.skillId,
      aggregateType: spec.aggregate.type,
      aggregateId: spec.aggregate.id,
      baseRevision: spec.aggregate.revision,
      payload: spec.payload,
      diff: spec.diff ?? {},
      impact: { ...(spec.impact ?? {}), jobId: spec.job?.id ?? null },
      origin: spec.origin,
    },
    "awaiting_approval"
  )
  const { approval, events } = await requestApproval(tx, ctx, proposal, {
    policyId: spec.policyId,
    policyRevision: FINANCE_POLICY_REVISION,
    eligibleRoles: spec.eligibleRoles ?? ["finance_approver"],
    title: spec.title,
    amountMinor: spec.amountMinor ?? null,
    currency: spec.currency ?? null,
    destination: spec.destination ?? null,
    expiresInHours: 24 * 14,
  })
  return {
    proposal,
    approval,
    events: events.map((e) => ({ ...e, jobId: spec.job?.id ?? null })),
    approvalSummary: { proposalId: proposal.id, approvalId: approval.id, payloadDigest: proposal.payloadDigest, eligibleRoles: approval.eligibleRoles, approvalState: approval.state },
  }
}

export const FINANCE_POLICY_REVISION = 1
export const FINANCE_POLICIES = [
  "supplier-invoice-v1",
  "payment-batch-v1",
  "expense-v1",
  "client-invoice-v1",
  "rebate-provision-v1",
  "manual-journal-v1",
  "recognition-run-v1",
  "fx-revaluation-v1",
  "depreciation-v1",
  "revenue-budget-lock-v1",
  "period-close-v1",
] as const

const byRevision =
  (table: typeof accountingPeriod | typeof paymentBatch | typeof accountingAdjustment | typeof fixedAsset | typeof revenueBudgetVersion | typeof supplierInvoice | typeof expense | typeof clientInvoice | typeof rebateCalculation) =>
  async (tx: Tx, tenantId: string, id: string) =>
    (await tx.select({ r: table.revision }).from(table).where(and(eq(table.tenantId, tenantId), eq(table.id, id))).limit(1))[0]?.r ?? null

/** Revision resolvers of the finance aggregates approvals bind to. */
export const FINANCE_AGGREGATE_REVISIONS = {
  accounting_period: byRevision(accountingPeriod),
  payment_batch: byRevision(paymentBatch),
  accounting_adjustment: byRevision(accountingAdjustment),
  fixed_asset: byRevision(fixedAsset),
  revenue_budget_version: byRevision(revenueBudgetVersion),
  supplier_invoice: byRevision(supplierInvoice),
  expense: byRevision(expense),
  client_invoice: byRevision(clientInvoice),
  rebate_calculation: byRevision(rebateCalculation),
}
export type FinanceAggregate = keyof typeof FINANCE_AGGREGATE_REVISIONS

// Registered at module load. After a hot reload of this module the kernel
// keeps the first (equivalent) resolver and rejects the new instance.
for (const [type, resolver] of Object.entries(FINANCE_AGGREGATE_REVISIONS)) {
  try {
    registerAggregateRevision(type, resolver)
  } catch {
    // already registered by an earlier load of this module
  }
}
for (const id of FINANCE_POLICIES) registerApprovalPolicy({ id, revision: FINANCE_POLICY_REVISION })

// ── agency-general-ledger: postDemoJournal (manual journal proposal) ──

export const MANUAL_JOURNAL_POLICY = "manual-journal-v1"

export const PostDemoJournalInput = z
  .object({
    job: z.string().uuid().optional().nullable(),
    period: Month,
    businessDate: IsoDate,
    debitAccount: z.string().regex(/^[a-z_]{2,40}$/),
    debitAmount: Decimal,
    creditAccount: z.string().regex(/^[a-z_]{2,40}$/),
    creditAmount: Decimal,
    memo: z.string().trim().min(3).max(200),
  })
  .strict()

export const postDemoJournal = defineCommand({
  type: "ledger.proposeManualJournal",
  skillId: "agency-general-ledger",
  // Prepared by the close team (ledger.prepare, e.g. the owner); approved by
  // finance (never the preparer); posting runs under the approver.
  permission: "ledger.prepare",
  input: PostDemoJournalInput,
  handler: async (tx, ctx, input, meta) => {
    if (periodOf(input.businessDate) !== input.period) {
      throw new DomainError("validation", "The entry date is outside the period", { field: "businessDate" })
    }
    await assertPeriodOpen(tx, ctx.tenant.id, input.period)
    let anchorJob: { id: string; revision: number; currency: string; reportingGroup: string } | null = null
    if (input.job) {
      const [j] = await tx.select().from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, input.job))).limit(1)
      if (!j) throw new DomainError("not_found", "Job not found")
      anchorJob = { id: j.id, revision: j.revision, currency: j.currency, reportingGroup: j.reportingGroup }
    }
    const currency = anchorJob?.currency ?? ctx.tenant.baseCurrency
    const debit = moneyInput(input.debitAmount, currency, "debitAmount")
    const credit = moneyInput(input.creditAmount, currency, "creditAmount")
    const lines: PlannedLine[] = [
      { account: input.debitAccount, side: "debit", amountMinor: debit },
      { account: input.creditAccount, side: "credit", amountMinor: credit },
    ]
    const check = journalCheck({
      entryId: "manual",
      postingDate: input.businessDate,
      lockedPeriods: [],
      lines: lines.map((l, i) => ({
        lineId: `l${i + 1}`,
        accountId: l.account,
        currency,
        debitMinor: l.side === "debit" ? l.amountMinor : 0n,
        creditMinor: l.side === "credit" ? l.amountMinor : 0n,
        requiredDimensionsPresent: true,
      })),
    })
    if (check.status !== "valid") {
      blocked("journal_unbalanced", "Debits and credits must balance", toJsonSafe({ journalCheck: check }) as Record<string, unknown>)
    }
    const codes = [input.debitAccount, input.creditAccount]
    const known = await tx.select({ code: ledgerAccount.code }).from(ledgerAccount).where(and(eq(ledgerAccount.tenantId, ctx.tenant.id), inArray(ledgerAccount.code, codes)))
    const missing = codes.filter((c) => !known.some((k) => k.code === c))
    if (missing.length) blocked("unknown_account", "Unknown ledger account", { accounts: missing })

    const reportingGroup = anchorJob?.reportingGroup ?? "primary"
    const [adj] = await tx
      .insert(accountingAdjustment)
      .values({
        tenantId: ctx.tenant.id,
        kind: "manual_journal",
        jobId: anchorJob?.id ?? null,
        period: input.period,
        businessDate: input.businessDate,
        currency,
        inputs: toJsonSafe(input) as object,
        result: toJsonSafe({ journalCheck: check }) as object,
        journalPlan: toJsonSafe(lines) as object,
        state: "awaiting_approval",
        reportingGroup,
        preparedBy: ctx.user.id,
      })
      .returning()
    const payload = {
      action: "ledger.manual_journal",
      adjustmentId: adj!.id,
      adjustmentRevision: adj!.revision,
      jobId: anchorJob?.id ?? null,
      jobRevision: anchorJob?.revision ?? null,
      period: input.period,
      businessDate: input.businessDate,
      currency,
      lines,
      memo: input.memo,
    }
    const appr = await requestFinanceApproval(tx, ctx, {
      actionType: "ledger.manual_journal",
      skillId: "agency-general-ledger",
      job: anchorJob ? { id: anchorJob.id, revision: anchorJob.revision } : null,
      aggregate: { type: "accounting_adjustment", id: adj!.id, revision: adj!.revision },
      payload,
      impact: { debitMinor: debit, creditMinor: credit, currency },
      title: `Demo journal: ${input.memo}`,
      amountMinor: debit,
      currency,
      destination: DEMO_LEDGER_LABEL,
      policyId: MANUAL_JOURNAL_POLICY,
      origin: meta.origin,
    })
    await tx.update(accountingAdjustment).set({ approvalId: appr.approval.id }).where(eq(accountingAdjustment.id, adj!.id))
    const tb = await trialBalance(tx, ctx.tenant.id, { period: input.period, excludeGroups: reportingGroup === "primary" ? ["demo-lab"] : [] })
    return {
      result: {
        adjustmentId: adj!.id,
        ...appr.approvalSummary,
        journal_entry_proposal: { ledger: DEMO_LEDGER_LABEL, period: input.period, businessDate: input.businessDate, currency, memo: input.memo, lines, reportingGroup, state: "awaiting_approval" },
        journal_check_report: check,
        coa_change_proposal: { items: [], reason: "Both accounts exist in the demo chart of accounts; no change proposed." },
        opening_balance_reconciliation: { currencies: tb.currencies.map((c) => ({ currency: c.currency, openingEquityMinor: c.balances["opening_equity"] ?? 0n, cashMinor: c.balances["cash"] ?? 0n })) },
        integration_difference_report: { items: [], reason: "Demo ledger is internal; no external accounting system is connected (simulated)." },
      },
      events: [
        { eventType: "ledger.manual_journal.proposed", aggregateType: "accounting_adjustment", aggregateId: adj!.id, jobId: anchorJob?.id ?? null, payload: { period: input.period, debitMinor: debit, currency } },
        ...appr.events,
      ],
    }
  },
})

export async function applyManualJournal(
  tx: Tx,
  ctx: AgencyContext,
  payload: { adjustmentId: string; adjustmentRevision: number; jobId: string | null; jobRevision: number | null; businessDate: string; currency: string; memo: string; lines: { account: string; side: Side; amountMinor: string }[] },
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const [adj] = await tx
    .select()
    .from(accountingAdjustment)
    .where(and(eq(accountingAdjustment.tenantId, ctx.tenant.id), eq(accountingAdjustment.id, payload.adjustmentId)))
    .for("update")
    .limit(1)
  if (!adj || adj.revision !== payload.adjustmentRevision || adj.state !== "awaiting_approval") {
    return { ok: false, code: "approval_stale", details: { adjustmentId: payload.adjustmentId } }
  }
  const p = await getPeriod(tx, ctx.tenant.id, periodOf(payload.businessDate))
  if (!p || p.state !== "open") return { ok: false, code: "period_closed", details: { period: periodOf(payload.businessDate) } }
  if (mode === "check") return { ok: true, events: [] }
  const res = await postJournals(
    tx,
    ctx,
    [
      {
        entryKey: `manual:${adj.id}`,
        ruleKey: "manual",
        sourceType: "accounting_adjustment",
        sourceId: adj.id,
        jobId: payload.jobId,
        businessDate: payload.businessDate,
        currency: payload.currency,
        memo: payload.memo,
        reportingGroup: adj.reportingGroup,
        lines: payload.lines.map((l) => ({ account: l.account, side: l.side, amountMinor: BigInt(l.amountMinor) })),
      },
    ],
    { approvalId: adj.approvalId, approvedBy: ctx.user.id, preparedBy: adj.preparedBy }
  )
  await tx
    .update(accountingAdjustment)
    .set({ state: "posted", approvedBy: ctx.user.id, journalEntryIds: res.entries.map((e) => e.id), revision: sql`${accountingAdjustment.revision} + 1`, updatedAt: new Date() })
    .where(eq(accountingAdjustment.id, adj.id))
  return { ok: true, events: res.events }
}

// ── Queries ──

export async function getTrialBalance(ctx: AgencyContext, filter: { period?: string; includeDemoLab?: boolean } = {}) {
  return withTenant(ctx.tenant.id, (tx) =>
    trialBalance(tx, ctx.tenant.id, { period: filter.period, excludeGroups: filter.includeDemoLab ? [] : ["demo-lab"] })
  )
}

export async function listJournals(ctx: AgencyContext, filter: { jobId?: string; period?: string; includeDemoLab?: boolean } = {}) {
  return withTenant(ctx.tenant.id, (tx) =>
    journalsWithLines(tx, ctx.tenant.id, { jobId: filter.jobId, period: filter.period, excludeGroups: filter.includeDemoLab ? [] : ["demo-lab"] })
  )
}
