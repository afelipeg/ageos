import "server-only"

import { and, eq, inArray, notInArray } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import { cashProjection } from "@/server/calculators/finance"
import type { Tx } from "@/server/db/client"
import { bankAccount, budgetRevision, clientInvoice, expense, job, payment, paymentBatch, supplierInvoice } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

import { cashPosition } from "./cash"
import { blocked, Decimal, IsoDate, moneyInput } from "./ledger"

// Cash forecast (M09). Opening = confirmed demo-bank cash at the cut-off (a
// forecast never counts as cash). Reserved payments are confirmed outflows;
// open receivables and payables are probable and dated by their terms;
// approved-but-unbilled work is undated pipeline, never in the cash table.
// One currency per forecast: no implicit FX. A collected invoice appears
// once — as bank cash — never again as a receivable.

export const CalculateCashScenarioInput = z
  .object({
    openingCash: Decimal,
    currency: z.enum(["USD", "CAD", "MXN"]),
    asOfDate: IsoDate,
    horizonDays: z.number().int().min(7).max(365),
    scenario: z.enum(["base", "downside"]),
    collectionDelayDays: z.number().int().min(0).max(120).optional().nullable(),
  })
  .strict()

type Input = z.infer<typeof CalculateCashScenarioInput>

async function buildItems(tx: Tx, tenantId: string, input: Input, scenario: "base" | "downside") {
  const primaryJobs = await tx.select().from(job).where(and(eq(job.tenantId, tenantId), eq(job.reportingGroup, "primary"), eq(job.currency, input.currency)))
  const jobIds = primaryJobs.map((j) => j.id)
  const items: Parameters<typeof cashProjection>[0]["items"] = []
  if (!jobIds.length) return { items, undated: [], exposure: [] }
  const delay = scenario === "downside" ? (input.collectionDelayDays ?? 30) : 0
  const probability = scenario === "downside" ? 7500 : 10000

  const ar = await tx.select().from(clientInvoice).where(and(eq(clientInvoice.tenantId, tenantId), inArray(clientInvoice.jobId, jobIds), inArray(clientInvoice.state, ["issued_demo", "partially_collected"])))
  for (const inv of ar) {
    const open = inv.grossMinor - inv.collectedMinor
    if (open > 0n) items.push({ itemId: `ar_${inv.number}`, currency: inv.currency, direction: "in", amountMinor: open, baseDate: inv.dueDate, termDays: 0, delayDays: delay, status: "expected", probabilityBps: probability })
  }
  // Reserved / unknown payments: funds already held → confirmed outflows.
  const live = await tx
    .select({ p: payment, paymentDate: paymentBatch.paymentDate })
    .from(payment)
    .innerJoin(paymentBatch, and(eq(paymentBatch.tenantId, payment.tenantId), eq(paymentBatch.id, payment.batchId)))
    .where(and(eq(payment.tenantId, tenantId), inArray(payment.jobId, jobIds), inArray(payment.state, ["reserved", "outcome_unknown", "failed_retryable", "pending_approval"])))
  const inPayment = new Set(live.map((l) => `${l.p.sourceType}:${l.p.sourceId}`))
  const exposure: { kind: string; reference: string; amountMinor: bigint; dueDate: string | null; status: string }[] = []
  for (const { p, paymentDate } of live) {
    if (p.currency !== input.currency) continue
    const reserved = p.state !== "pending_approval"
    items.push({ itemId: `pay_${p.id}`, currency: p.currency, direction: "out", amountMinor: p.amountMinor, baseDate: paymentDate, termDays: 0, delayDays: 0, status: reserved ? "confirmed" : "expected", probabilityBps: 10000 })
    exposure.push({ kind: p.category, reference: p.payee, amountMinor: p.amountMinor, dueDate: paymentDate, status: p.state })
  }
  const ap = await tx.select().from(supplierInvoice).where(and(eq(supplierInvoice.tenantId, tenantId), inArray(supplierInvoice.jobId, jobIds), inArray(supplierInvoice.state, ["matched", "payable"])))
  for (const inv of ap) {
    if (inPayment.has(`supplier_invoice:${inv.id}`)) continue
    const open = inv.amountMinor - inv.paidMinor
    items.push({ itemId: `ap_${inv.id}`, currency: inv.currency, direction: "out", amountMinor: open, baseDate: inv.dueDate ?? input.asOfDate, termDays: 0, delayDays: 0, status: "expected", probabilityBps: 10000 })
    exposure.push({ kind: inv.costCategory, reference: inv.invoiceNumber, amountMinor: open, dueDate: inv.dueDate, status: inv.state })
  }
  const exps = await tx.select().from(expense).where(and(eq(expense.tenantId, tenantId), inArray(expense.jobId, jobIds), eq(expense.state, "approved")))
  for (const e of exps) {
    if (inPayment.has(`expense:${e.id}`)) continue
    items.push({ itemId: `exp_${e.id}`, currency: e.currency, direction: "out", amountMinor: e.amountMinor, baseDate: input.asOfDate, termDays: 0, delayDays: 0, status: "expected", probabilityBps: 10000 })
    exposure.push({ kind: "expense", reference: e.category, amountMinor: e.amountMinor, dueDate: null, status: e.state })
  }
  // Undated pipeline: approved fee/media not yet invoiced (never cash).
  const undated: { jobId: string; reference: string; feeMinor: bigint; mediaMinor: bigint }[] = []
  for (const j of primaryJobs) {
    const [b] = await tx.select().from(budgetRevision).where(and(eq(budgetRevision.tenantId, tenantId), eq(budgetRevision.jobId, j.id), eq(budgetRevision.state, "approved"))).limit(1)
    if (!b) continue
    const invs = await tx.select().from(clientInvoice).where(and(eq(clientInvoice.tenantId, tenantId), eq(clientInvoice.jobId, j.id), notInArray(clientInvoice.state, ["cancelled", "requirements_checked"])))
    const fee = b.agencyFeeMinor - invs.reduce((a, i) => a + i.feeMinor, 0n)
    const media = b.managedMediaMinor - invs.reduce((a, i) => a + i.mediaRecoveryMinor, 0n)
    if (fee > 0n || media > 0n) undated.push({ jobId: j.id, reference: j.displayReference, feeMinor: fee > 0n ? fee : 0n, mediaMinor: media > 0n ? media : 0n })
  }
  return { items, undated, exposure }
}

export async function calculateCashScenario(ctx: AgencyContext, input: Input) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const opening = moneyInput(input.openingCash, input.currency, "openingCash", { allowZero: true })
    const accounts = await tx.select().from(bankAccount).where(and(eq(bankAccount.tenantId, ctx.tenant.id), eq(bankAccount.currency, input.currency), eq(bankAccount.reportingGroup, "primary")))
    if (!accounts.length) blocked("currency_not_held", "No demo bank account in this currency; FX is never applied implicitly", { currency: input.currency })
    let confirmed = 0n
    let holds = 0n
    for (const a of accounts) {
      const pos = await cashPosition(tx, ctx.tenant.id, a.id, input.asOfDate)
      confirmed += pos.confirmedMinor
      holds += pos.activeHoldsMinor
    }
    if (opening !== confirmed) {
      blocked("opening_cash_not_confirmed", "Opening cash must equal the confirmed bank balance at the cut-off; receivables and forecasts are not cash", { confirmedMinor: confirmed.toString(), enteredMinor: opening.toString(), currency: input.currency })
    }
    const weekly = input.horizonDays <= 91
    const periods = Math.min(26, Math.max(1, Math.ceil(input.horizonDays / (weekly ? 7 : 30))))
    const run = async (scenario: "base" | "downside") => {
      const built = await buildItems(tx, ctx.tenant.id, input, scenario)
      const projection = cashProjection({ asOf: input.asOfDate, granularity: weekly ? "week" : "month", periods, holidays: [], openingBalances: [{ currency: input.currency, amountMinor: confirmed }], items: built.items })
      return { ...built, projection }
    }
    const chosen = await run(input.scenario)
    const base = input.scenario === "base" ? chosen : await run("base")
    const downside = input.scenario === "downside" ? chosen : await run("downside")
    const cur = chosen.projection.currencies.find((c) => c.currency === input.currency)!
    const sum = (dir: "in" | "out", status: "confirmed" | "expected") => chosen.items.filter((i) => i.direction === dir && i.status === status).reduce((a, i) => a + i.amountMinor, 0n)
    return {
      asOf: input.asOfDate,
      currency: input.currency,
      basis: "confirmed_bank_plus_dated_forecast",
      scenario: input.scenario,
      assumptions: { collectionDelayDays: input.scenario === "downside" ? (input.collectionDelayDays ?? 30) : 0, collectionProbabilityBps: input.scenario === "downside" ? 7500 : 10000, granularity: weekly ? "week" : "month", periods, fx: "none (single currency)" },
      cash_forecast: chosen.projection,
      currency_buckets: [
        { currency: input.currency, confirmedCashMinor: confirmed, activeHoldsMinor: holds, availableMinor: confirmed - holds, probableInflowsMinor: sum("in", "expected"), confirmedOutflowsMinor: sum("out", "confirmed"), probableOutflowsMinor: sum("out", "expected"), undatedPipelineMinor: chosen.undated.reduce((a, u) => a + u.feeMinor + u.mediaMinor, 0n) },
      ],
      undated_pipeline: chosen.undated,
      collection_scenarios: [base, downside].map((r, i) => {
        const c = r.projection.currencies.find((x) => x.currency === input.currency)!
        return { scenario: i === 0 ? "base" : "downside", closingMinor: c.periods.at(-1)?.closingMinor ?? confirmed, minimumClosingMinor: c.minimumClosingMinor, minimumPeriodStart: c.minimumPeriodStart }
      }),
      supplier_exposure: chosen.exposure,
      liquidity_gaps: cur.periods.filter((p) => p.closingMinor < 0n).map((p) => ({ periodStart: p.periodStart, closingMinor: p.closingMinor })),
    }
  })
}
