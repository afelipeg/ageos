import "server-only"

import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm"
import { z } from "zod"

import { divHalfUp } from "@/lib/money"
import type { AgencyContext } from "@/server/auth/context"
import { fxRevaluation } from "@/server/calculators/finance"
import type { Tx } from "@/server/db/client"
import {
  accountingAdjustment,
  budgetRevision,
  delivery,
  evidence,
  expense,
  fileObject,
  fxRate,
  purchaseOrder,
  recognitionRecord,
  supplierInvoice,
  timesheet,
} from "@/server/db/schema"
import { getBusinessDate } from "@/server/domain/presenter"
import { defineCommand, toJsonSafe, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import {
  assertPeriodOpen,
  blocked,
  Decimal,
  getPeriod,
  loadJob,
  moneyInput,
  Month,
  periodOf,
  postJournals,
  requestFinanceApproval,
  type PlannedJournal,
} from "./ledger"
import { markReclassified, planInvoiceReclass } from "./payables"

// Recognition & accrual run (journal_policy): accepted service recognizes the
// fee; approved hours, approved expenses and accepted deliveries recognize
// cost (or the pass-through media recoverable); an approved supplier invoice
// reclassifies the accrual to payables once the delivery is recognized. Each
// source record is recognized exactly once (recognition_record unique key).
// FX revaluation uses dated, sourced rates and proposes a reversal.

export function periodEnd(period: string) {
  const [y, m] = period.split("-").map(Number)
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate()
  return `${period}-${String(last).padStart(2, "0")}`
}

export function previousPeriod(period: string) {
  const [y, m] = period.split("-").map(Number)
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`
}

function nextPeriodStart(period: string) {
  const [y, m] = period.split("-").map(Number)
  const ny = m === 12 ? y! + 1 : y!
  const nm = m === 12 ? 1 : m! + 1
  return `${ny}-${String(nm).padStart(2, "0")}-01`
}

export type RecognitionItem = { category: "labor" | "production" | "expense" | "media" | "fee"; sourceType: "timesheet" | "delivery" | "expense" | "budget_revision"; sourceId: string; amountMinor: bigint; businessDate: string | null }

/** Acceptance evidence filed for the job (linked on the evidence or its file). */
export async function acceptanceEvidence(tx: Tx, tenantId: string, jobId: string) {
  return tx
    .select({ id: evidence.id, title: evidence.title, reviewState: evidence.reviewState, fileId: evidence.fileId })
    .from(evidence)
    .leftJoin(fileObject, and(eq(fileObject.tenantId, evidence.tenantId), eq(fileObject.id, evidence.fileId)))
    .where(and(eq(evidence.tenantId, tenantId), eq(evidence.kind, "acceptance"), or(eq(evidence.jobId, jobId), eq(fileObject.jobId, jobId)), sql`${evidence.reviewState} <> 'rejected'`))
}

async function recognizedSet(tx: Tx, tenantId: string, jobId: string) {
  const rows = await tx.select().from(recognitionRecord).where(and(eq(recognitionRecord.tenantId, tenantId), eq(recognitionRecord.jobId, jobId)))
  return { rows, has: (category: string, sourceId: string) => rows.some((r) => r.category === category && r.sourceId === sourceId) }
}

/** What is due for recognition on a job up to the end of `period`. */
export async function planRecognition(tx: Tx, tenantId: string, jobId: string, period: string) {
  const end = periodEnd(period)
  const recognized = await recognizedSet(tx, tenantId, jobId)
  const items: RecognitionItem[] = []
  const unmet: string[] = []

  const hours = await tx
    .select()
    .from(timesheet)
    .where(and(eq(timesheet.tenantId, tenantId), eq(timesheet.jobId, jobId), inArray(timesheet.state, ["approved", "locked"]), lte(timesheet.workDate, end)))
    .orderBy(asc(timesheet.workDate), asc(timesheet.createdAt))
  for (const t of hours) {
    if (!recognized.has("labor", t.id)) items.push({ category: "labor", sourceType: "timesheet", sourceId: t.id, amountMinor: divHalfUp(BigInt(t.minutes) * t.hourlyCostMinor, 60n), businessDate: t.workDate })
  }

  const accepted = await tx
    .select({ d: delivery, kind: purchaseOrder.kind })
    .from(delivery)
    .innerJoin(purchaseOrder, and(eq(purchaseOrder.tenantId, delivery.tenantId), eq(purchaseOrder.id, delivery.orderId)))
    .where(and(eq(delivery.tenantId, tenantId), eq(purchaseOrder.jobId, jobId), eq(delivery.state, "accepted"), lte(delivery.businessDate, end)))
    .orderBy(asc(delivery.businessDate), asc(delivery.createdAt))
  for (const { d, kind } of accepted) {
    const category = kind === "media" ? "media" : "production"
    if (!recognized.has(category, d.id)) items.push({ category, sourceType: "delivery", sourceId: d.id, amountMinor: d.acceptedMinor, businessDate: d.businessDate })
  }

  const expenses = await tx
    .select()
    .from(expense)
    .where(and(eq(expense.tenantId, tenantId), eq(expense.jobId, jobId), inArray(expense.state, ["approved", "reimbursed"]), lte(expense.expenseDate, end)))
    .orderBy(asc(expense.expenseDate), asc(expense.createdAt))
  for (const e of expenses) {
    if (!recognized.has("expense", e.id)) items.push({ category: "expense", sourceType: "expense", sourceId: e.id, amountMinor: e.amountMinor, businessDate: e.expenseDate })
  }

  const [budget] = await tx
    .select()
    .from(budgetRevision)
    .where(and(eq(budgetRevision.tenantId, tenantId), eq(budgetRevision.jobId, jobId), eq(budgetRevision.state, "approved")))
    .orderBy(desc(budgetRevision.number))
    .limit(1)
  const feeRecognized = recognized.rows.filter((r) => r.category === "fee").reduce((a, r) => a + r.amountMinor, 0n)
  const acceptance = await acceptanceEvidence(tx, tenantId, jobId)
  if (budget && budget.agencyFeeMinor > feeRecognized) {
    if (acceptance.length === 0) unmet.push("accepted_service_delivery")
    else if (!recognized.has("fee", budget.id)) items.push({ category: "fee", sourceType: "budget_revision", sourceId: budget.id, amountMinor: budget.agencyFeeMinor - feeRecognized, businessDate: null })
  }
  const pendingInvoices = await tx
    .select({ id: supplierInvoice.id, invoiceNumber: supplierInvoice.invoiceNumber, amountMinor: supplierInvoice.amountMinor, category: supplierInvoice.costCategory, state: supplierInvoice.state, period: supplierInvoice.period })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.tenantId, tenantId), eq(supplierInvoice.jobId, jobId), eq(supplierInvoice.state, "payable"), sql`${supplierInvoice.reclassJournalId} is null`))
  return { items, unmet, acceptance, feeRecognizedMinor: feeRecognized, pendingInvoiceReclass: pendingInvoices, end }
}

const ORDER: RecognitionItem["category"][] = ["labor", "production", "expense", "media", "fee"]
const RULE: Record<RecognitionItem["category"], { rule: string; debit: string; credit: string; memo: string }> = {
  labor: { rule: "journal_labor", debit: "labor_expense", credit: "payroll_payable", memo: "Approved hours recognized as labor cost" },
  production: { rule: "journal_production_delivery", debit: "production_expense", credit: "accrued_production", memo: "Accepted production delivery recognized (accrual)" },
  expense: { rule: "journal_expense", debit: "direct_expense", credit: "expense_payable", memo: "Approved job expense recognized" },
  media: { rule: "journal_media_delivery", debit: "media_recovery_asset", credit: "accrued_media", memo: "Accepted media delivery: pass-through recoverable (excluded from agency revenue)" },
  fee: { rule: "journal_fee_acceptance", debit: "unbilled_fee_asset", credit: "agency_fee_revenue", memo: "Agency fee recognized on accepted service" },
}

function summarize(items: RecognitionItem[]) {
  return ORDER.map((category) => ({ category, amountMinor: items.filter((i) => i.category === category).reduce((a, i) => a + i.amountMinor, 0n), sources: items.filter((i) => i.category === category).map((i) => i.sourceId) })).filter((c) => c.sources.length)
}

// ── agency-accruals-revaluation: proposeAccrualOrFXAdjustment ──

export const RECOGNITION_POLICY = "recognition-run-v1"
export const FX_POLICY = "fx-revaluation-v1"

export const ProposeAccrualOrFxInput = z
  .object({
    adjustmentType: z.enum(["accrual", "fx_revaluation"]),
    job: z.string().uuid().optional().nullable(),
    period: Month,
    amount: Decimal.optional().nullable(),
    foreignCurrency: z.enum(["USD", "CAD", "MXN"]).optional().nullable(),
    balanceSide: z.enum(["payable", "receivable"]).optional().nullable(),
    previousRate: z.string().trim().regex(/^\d{1,6}(\.\d{1,6})?$/).optional().nullable(),
    closingRate: z.string().trim().regex(/^\d{1,6}(\.\d{1,6})?$/).optional().nullable(),
  })
  .strict()

function rateToMicro(text: string) {
  const [w, f = ""] = text.split(".")
  return BigInt(w!) * 1_000_000n + BigInt(f.padEnd(6, "0"))
}

export const proposeAccrualOrFx = defineCommand({
  type: "accounting.proposeAdjustment",
  skillId: "agency-accruals-revaluation",
  // Prepared with ledger.prepare (e.g. the owner); approved by finance, never the preparer.
  permission: "ledger.prepare",
  input: ProposeAccrualOrFxInput,
  handler: async (tx, ctx, input, meta) => {
    await assertPeriodOpen(tx, ctx.tenant.id, input.period)
    const j = input.job ? await loadJob(tx, ctx.tenant.id, input.job) : null
    const empty = (reason: string) => ({ items: [], reason })

    if (input.adjustmentType === "accrual") {
      if (!j) throw new DomainError("validation", "A job is required for the recognition run", { field: "job" })
      const plan = await planRecognition(tx, ctx.tenant.id, j.id, input.period)
      if (!plan.items.length && !plan.pendingInvoiceReclass.length) {
        blocked("nothing_to_recognize", "Nothing accepted or approved is pending recognition on this job", { unmet: plan.unmet })
      }
      if (input.amount) {
        const control = moneyInput(input.amount, j.currency, "amount")
        const costTotal = plan.items.filter((i) => i.category !== "fee" && i.category !== "media").reduce((a, i) => a + i.amountMinor, 0n)
        if (control !== costTotal) blocked("control_total_mismatch", "Control total differs from the agency cost to recognize", { expectedMinor: costTotal, enteredMinor: control })
      }
      // Recognized when the last underlying fact happened (never before the
      // business clock), inside the period.
      const today = await getBusinessDate()
      const latest = plan.items.reduce((m, i) => (i.businessDate && i.businessDate > m ? i.businessDate : m), today)
      const businessDate = periodOf(latest) === input.period ? latest : latest < input.period ? `${input.period}-01` : periodEnd(input.period)
      const summary = summarize(plan.items)
      const [adj] = await tx
        .insert(accountingAdjustment)
        .values({
          tenantId: ctx.tenant.id,
          kind: "recognition",
          jobId: j.id,
          period: input.period,
          businessDate,
          currency: j.currency,
          inputs: toJsonSafe(input) as object,
          result: toJsonSafe({ summary, unmet: plan.unmet, pendingInvoiceReclass: plan.pendingInvoiceReclass }) as object,
          journalPlan: toJsonSafe(summary.map((c) => ({ ruleKey: RULE[c.category].rule, debit: RULE[c.category].debit, credit: RULE[c.category].credit, amountMinor: c.amountMinor }))) as object,
          state: "awaiting_approval",
          reportingGroup: j.reportingGroup,
          preparedBy: ctx.user.id,
        })
        .returning()
      const payload = {
        action: "accounting.recognition_run",
        adjustmentId: adj!.id,
        adjustmentRevision: adj!.revision,
        jobId: j.id,
        period: input.period,
        businessDate,
        currency: j.currency,
        items: plan.items.map((i) => ({ category: i.category, sourceType: i.sourceType, sourceId: i.sourceId, amountMinor: i.amountMinor.toString() })),
      }
      const appr = await requestFinanceApproval(tx, ctx, {
        actionType: "accounting.recognition_run",
        skillId: "agency-accruals-revaluation",
        job: { id: j.id, revision: j.revision },
        aggregate: { type: "accounting_adjustment", id: adj!.id, revision: adj!.revision },
        payload,
        impact: { summary, currency: j.currency },
        title: `Recognition run ${j.displayReference} · ${input.period}`,
        amountMinor: summary.reduce((a, c) => a + c.amountMinor, 0n),
        currency: j.currency,
        destination: "Demo ledger — synthetic, non-fiscal",
        policyId: RECOGNITION_POLICY,
        origin: meta.origin,
      })
      await tx.update(accountingAdjustment).set({ approvalId: appr.approval.id }).where(eq(accountingAdjustment.id, adj!.id))
      const pick = (c: RecognitionItem["category"]) => summary.find((s) => s.category === c) ?? null
      return {
        result: {
          adjustmentId: adj!.id,
          kind: "recognition",
          ...appr.approvalSummary,
          fx_revaluation_proposal: empty("Not an FX revaluation run."),
          gross_income_provision_proposal: pick("fee") ? { ...pick("fee"), journal: RULE.fee } : { items: [], reason: plan.unmet.includes("accepted_service_delivery") ? "Fee waits for accepted service evidence." : "Fee already recognized." },
          wip_reclass_proposal: { items: plan.pendingInvoiceReclass, note: "Approved supplier invoices reclassify accrual → payable after delivery recognition." },
          expense_provision_proposal: { items: summary.filter((s) => s.category !== "fee").map((s) => ({ ...s, journal: RULE[s.category] })) },
          overcommission_provision_proposal: empty("No overcommission agreement applies to this job."),
          ot_close_proposal: empty("Job close is handled by agency-job-lifecycle once billing and collections finish."),
          ic_reclass_proposal: empty("Single legal entity; no intercompany reclass."),
          close_job_checklist: { unmetRequirements: plan.unmet, acceptanceEvidence: plan.acceptance },
        },
        events: [
          { eventType: "accounting.recognition_proposed", aggregateType: "accounting_adjustment", aggregateId: adj!.id, jobId: j.id, payload: { period: input.period, summary } },
          ...appr.events,
        ],
      }
    }

    // FX revaluation of a foreign-currency balance, dated at period end.
    const businessDate = periodEnd(input.period)
    const localCurrency = j?.currency ?? ctx.tenant.baseCurrency
    if (!input.foreignCurrency) throw new DomainError("validation", "Foreign currency is required", { field: "foreignCurrency" })
    if (!input.amount) throw new DomainError("validation", "Balance amount is required", { field: "amount" })
    if (input.foreignCurrency === localCurrency) blocked("same_currency", "Local-currency balances are not revalued", { currency: localCurrency })
    const openMinor = moneyInput(input.amount, input.foreignCurrency, "amount")
    const prevEnd = periodEnd(previousPeriod(input.period))
    const lookup = async (onOrBefore: string, after: string | null) => {
      const conds = [eq(fxRate.tenantId, ctx.tenant.id), eq(fxRate.baseCurrency, input.foreignCurrency!), eq(fxRate.quoteCurrency, localCurrency), lte(fxRate.rateDate, onOrBefore)]
      if (after) conds.push(sql`${fxRate.rateDate} > ${after}`)
      const [r] = await tx.select().from(fxRate).where(and(...conds)).orderBy(desc(fxRate.rateDate)).limit(1)
      return r ?? null
    }
    const end = periodEnd(input.period)
    const prevRow = input.previousRate ? null : await lookup(prevEnd, null)
    const closeRow = input.closingRate ? null : await lookup(end, prevEnd)
    const previous = input.previousRate ? { rateMicro: rateToMicro(input.previousRate), rateDate: prevEnd, source: "Entered by preparer" } : prevRow
    const closing = input.closingRate ? { rateMicro: rateToMicro(input.closingRate), rateDate: end, source: "Entered by preparer" } : closeRow
    if (!previous || !closing || previous.rateMicro <= 0n || closing.rateMicro <= 0n) {
      blocked("fx_rate_missing", "Both a dated book rate and a dated closing rate are required", { currency: input.foreignCurrency, bookRateFound: !!previous, closingRateFound: !!closing })
    }
    const side = input.balanceSide === "receivable" ? "asset" : "liability"
    const calc = fxRevaluation({
      localCurrency,
      localExponent: 2,
      closingRates: [{ currency: input.foreignCurrency, rateMicro: closing.rateMicro }],
      items: [{ docId: "balance", side, currency: input.foreignCurrency, exponent: 2, openMinor, bookRateMicro: previous.rateMicro }],
    })
    const delta = calc.items[0]!.gainLossMinor
    if (delta === 0n) blocked("no_fx_difference", "Rates produce no revaluation difference", { calc: toJsonSafe(calc) })
    const balanceAccount = side === "liability" ? "ap_fx_revaluation" : "accounts_receivable"
    const lines =
      delta < 0n
        ? [
            { account: "fx_loss", side: "debit" as const, amountMinor: -delta },
            { account: balanceAccount, side: "credit" as const, amountMinor: -delta },
          ]
        : [
            { account: balanceAccount, side: "debit" as const, amountMinor: delta },
            { account: "fx_gain", side: "credit" as const, amountMinor: delta },
          ]
    const reversalDate = nextPeriodStart(input.period)
    const reportingGroup = j?.reportingGroup ?? "primary"
    const rates = { previous: { rate: previous.rateMicro, rateDate: previous.rateDate, source: previous.source }, closing: { rate: closing.rateMicro, rateDate: closing.rateDate, source: closing.source }, precision: "micro (6 decimals)" }
    const [adj] = await tx
      .insert(accountingAdjustment)
      .values({
        tenantId: ctx.tenant.id,
        kind: "fx_revaluation",
        jobId: j?.id ?? null,
        period: input.period,
        businessDate,
        currency: localCurrency,
        inputs: toJsonSafe(input) as object,
        result: toJsonSafe({ calc, rates }) as object,
        journalPlan: toJsonSafe(lines) as object,
        state: "awaiting_approval",
        reportingGroup,
        reversalDate,
        preparedBy: ctx.user.id,
      })
      .returning()
    const payload = { action: "accounting.fx_revaluation", adjustmentId: adj!.id, adjustmentRevision: adj!.revision, jobId: j?.id ?? null, period: input.period, businessDate, currency: localCurrency, lines, rates, reversalDate }
    const appr = await requestFinanceApproval(tx, ctx, {
      actionType: "accounting.fx_revaluation",
      skillId: "agency-accruals-revaluation",
      job: j ? { id: j.id, revision: j.revision } : null,
      aggregate: { type: "accounting_adjustment", id: adj!.id, revision: adj!.revision },
      payload,
      impact: { gainLossMinor: delta, currency: localCurrency },
      title: `FX revaluation ${input.foreignCurrency}→${localCurrency} · ${input.period}`,
      amountMinor: delta < 0n ? -delta : delta,
      currency: localCurrency,
      destination: "Demo ledger — synthetic, non-fiscal",
      policyId: FX_POLICY,
      origin: meta.origin,
    })
    await tx.update(accountingAdjustment).set({ approvalId: appr.approval.id }).where(eq(accountingAdjustment.id, adj!.id))
    return {
      result: {
        adjustmentId: adj!.id,
        kind: "fx_revaluation",
        ...appr.approvalSummary,
        fx_revaluation_proposal: { calc, rates, journal: lines, reversal: { date: reversalDate, lines: lines.map((l) => ({ ...l, side: l.side === "debit" ? "credit" : "debit" })) }, reportingGroup },
        gross_income_provision_proposal: empty("FX run: no fee recognition."),
        wip_reclass_proposal: empty("FX run: no WIP reclass."),
        expense_provision_proposal: empty("FX run: no cost accrual."),
        overcommission_provision_proposal: empty("No overcommission agreement applies."),
        ot_close_proposal: empty("Not a job close."),
        ic_reclass_proposal: empty("Single legal entity; no intercompany reclass."),
        close_job_checklist: empty("Not a job close."),
      },
      events: [
        { eventType: "accounting.fx_revaluation_proposed", aggregateType: "accounting_adjustment", aggregateId: adj!.id, jobId: j?.id ?? null, payload: { period: input.period, gainLossMinor: delta, currency: localCurrency } },
        ...appr.events,
      ],
    }
  },
})

type ExecResult = { ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }

async function lockAdjustment(tx: Tx, tenantId: string, id: string, revision: number) {
  const [adj] = await tx
    .select()
    .from(accountingAdjustment)
    .where(and(eq(accountingAdjustment.tenantId, tenantId), eq(accountingAdjustment.id, id)))
    .for("update")
    .limit(1)
  if (!adj || adj.revision !== revision || adj.state !== "awaiting_approval") return null
  return adj
}

export async function applyRecognitionRun(
  tx: Tx,
  ctx: AgencyContext,
  payload: { adjustmentId: string; adjustmentRevision: number; jobId: string; period: string; businessDate: string; currency: string; items: { category: RecognitionItem["category"]; sourceType: RecognitionItem["sourceType"]; sourceId: string; amountMinor: string }[] },
  mode: "check" | "apply"
): Promise<ExecResult> {
  const adj = await lockAdjustment(tx, ctx.tenant.id, payload.adjustmentId, payload.adjustmentRevision)
  if (!adj) return { ok: false, code: "approval_stale", details: { adjustmentId: payload.adjustmentId } }
  const p = await getPeriod(tx, ctx.tenant.id, payload.period)
  if (!p || p.state !== "open") return { ok: false, code: "period_closed", details: { period: payload.period } }
  const current = await planRecognition(tx, ctx.tenant.id, payload.jobId, payload.period)
  const key = (i: { category: string; sourceId: string; amountMinor: bigint | string }) => `${i.category}:${i.sourceId}:${i.amountMinor.toString()}`
  const approved = new Set(payload.items.map(key))
  const stillDue = payload.items.every((i) => current.items.some((c) => key(c) === key(i)))
  if (!stillDue) return { ok: false, code: "approval_stale", details: { reason: "recognition_sources_changed" } }
  if (mode === "check") return { ok: true, events: [] }

  const j = await loadJob(tx, ctx.tenant.id, payload.jobId)
  const items = current.items.filter((c) => approved.has(key(c)))
  const events: EmittedEvent[] = []
  const entryIds: string[] = []
  const approval = { approvalId: adj.approvalId, approvedBy: ctx.user.id, preparedBy: adj.preparedBy }
  const postCategory = async (category: RecognitionItem["category"]) => {
    const its = items.filter((i) => i.category === category)
    if (!its.length) return
    const total = its.reduce((a, i) => a + i.amountMinor, 0n)
    const r = RULE[category]
    const plan: PlannedJournal = {
      entryKey: `recognition:${category}:${adj.id}`,
      ruleKey: r.rule,
      sourceType: "accounting_adjustment",
      sourceId: adj.id,
      jobId: j.id,
      businessDate: payload.businessDate,
      currency: j.currency,
      memo: r.memo,
      reportingGroup: j.reportingGroup,
      lines: [
        { account: r.debit, side: "debit", amountMinor: total },
        { account: r.credit, side: "credit", amountMinor: total },
      ],
    }
    const posted = await postJournals(tx, ctx, [plan], approval)
    const entry = posted.entries.find((e) => e.entryKey === plan.entryKey)!
    await tx.insert(recognitionRecord).values(
      its.map((i) => ({ tenantId: ctx.tenant.id, jobId: j.id, category: i.category, sourceType: i.sourceType, sourceId: i.sourceId, amountMinor: i.amountMinor, currency: j.currency, journalEntryId: entry.id, adjustmentId: adj.id, period: payload.period }))
    )
    entryIds.push(...posted.entries.map((e) => e.id))
    events.push(...posted.events)
  }
  const reclass = async (category: "production" | "media") => {
    const invoices = await tx
      .select()
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.tenantId, ctx.tenant.id), eq(supplierInvoice.jobId, j.id), eq(supplierInvoice.costCategory, category), eq(supplierInvoice.state, "payable"), sql`${supplierInvoice.reclassJournalId} is null`))
      .orderBy(asc(supplierInvoice.createdAt))
    for (const inv of invoices) {
      const plan = await planInvoiceReclass(tx, ctx.tenant.id, inv, j.reportingGroup)
      if (!plan) continue
      const posted = await postJournals(tx, ctx, [plan], { approvalId: inv.approvalId, approvedBy: inv.approvedBy, preparedBy: inv.preparedBy })
      const entry = posted.entries.find((e) => e.entryKey === plan.entryKey)
      if (entry) await markReclassified(tx, inv.id, entry.id)
      entryIds.push(...posted.entries.map((e) => e.id))
      events.push(...posted.events)
    }
  }
  // Canonical order per cost item (demo-fixtures expected_final_demo_journals).
  await postCategory("labor")
  await postCategory("production")
  await reclass("production")
  await postCategory("expense")
  await postCategory("media")
  await reclass("media")
  await postCategory("fee")
  await tx
    .update(accountingAdjustment)
    .set({ state: "posted", approvedBy: ctx.user.id, journalEntryIds: entryIds, revision: sql`${accountingAdjustment.revision} + 1`, updatedAt: new Date() })
    .where(eq(accountingAdjustment.id, adj.id))
  events.push({ eventType: "accounting.recognition_posted", aggregateType: "accounting_adjustment", aggregateId: adj.id, jobId: j.id, payload: { journals: entryIds.length, period: payload.period } })
  return { ok: true, events }
}

export async function applyFxRevaluation(
  tx: Tx,
  ctx: AgencyContext,
  payload: { adjustmentId: string; adjustmentRevision: number; jobId: string | null; period: string; businessDate: string; currency: string; lines: { account: string; side: "debit" | "credit"; amountMinor: string }[] },
  mode: "check" | "apply"
): Promise<ExecResult> {
  const adj = await lockAdjustment(tx, ctx.tenant.id, payload.adjustmentId, payload.adjustmentRevision)
  if (!adj) return { ok: false, code: "approval_stale", details: { adjustmentId: payload.adjustmentId } }
  const p = await getPeriod(tx, ctx.tenant.id, payload.period)
  if (!p || p.state !== "open") return { ok: false, code: "period_closed", details: { period: payload.period } }
  if (mode === "check") return { ok: true, events: [] }
  const posted = await postJournals(
    tx,
    ctx,
    [
      {
        entryKey: `fx_revaluation:${adj.id}`,
        ruleKey: "fx_revaluation",
        sourceType: "accounting_adjustment",
        sourceId: adj.id,
        jobId: payload.jobId,
        businessDate: payload.businessDate,
        currency: payload.currency,
        memo: "FX revaluation of a foreign-currency balance (reverses next period)",
        reportingGroup: adj.reportingGroup,
        lines: payload.lines.map((l) => ({ account: l.account, side: l.side, amountMinor: BigInt(l.amountMinor) })),
      },
    ],
    { approvalId: adj.approvalId, approvedBy: ctx.user.id, preparedBy: adj.preparedBy }
  )
  await tx
    .update(accountingAdjustment)
    .set({ state: "posted", approvedBy: ctx.user.id, journalEntryIds: posted.entries.map((e) => e.id), revision: sql`${accountingAdjustment.revision} + 1`, updatedAt: new Date() })
    .where(eq(accountingAdjustment.id, adj.id))
  return { ok: true, events: posted.events }
}
