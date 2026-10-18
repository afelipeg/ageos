import "server-only"

import { and, asc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import { allocate } from "@/server/calculators"
import { flatRebate, tieredCommission } from "@/server/calculators/finance"
import type { Tx } from "@/server/db/client"
import { accountingAdjustment, rebateAgreement, rebateCalculation } from "@/server/db/schema"
import { defineCommand, toJsonSafe, type EmittedEvent } from "@/server/kernel/commands"

import { periodEnd } from "./accruals"
import { assertPeriodOpen, blocked, Decimal, getPeriod, loadJob, moneyInput, Month, postJournals, requestFinanceApproval } from "./ledger"
import { loadSupplier } from "./payables"

// Supplier rebates (M07, demo-lab). The agreement fixes method, rate, client
// share and eligibility dates; a period outside them is excluded. The result
// is a provision proposal approved by finance (rebate receivable → client
// share payable + agency rebate income). Aurora carries no rebate agreement.

export const REBATE_POLICY = "rebate-provision-v1"

export const CalculateRebateInput = z
  .object({
    job: z.string().uuid(),
    supplier: z.string().uuid(),
    period: Month,
    eligibleBase: Decimal,
    rebateRateBps: z.number().int().min(0).max(10000),
    clientShareBps: z.number().int().min(0).max(10000),
  })
  .strict()

export const calculateRebateSettlement = defineCommand({
  type: "rebates.calculateSettlement",
  skillId: "agency-rebates",
  permission: "billing.manage",
  input: CalculateRebateInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await loadJob(tx, ctx.tenant.id, input.job)
    const s = await loadSupplier(tx, ctx.tenant.id, input.supplier)
    const base = moneyInput(input.eligibleBase, j.currency, "eligibleBase")
    const agreements = await tx.select().from(rebateAgreement).where(and(eq(rebateAgreement.tenantId, ctx.tenant.id), eq(rebateAgreement.supplierId, s.id))).orderBy(asc(rebateAgreement.validFrom))
    if (!agreements.length) blocked("no_rebate_agreement", "No rebate agreement with this supplier", { supplierId: s.id })
    const start = `${input.period}-01`
    const end = periodEnd(input.period)
    const agreement = agreements.find((a) => a.validFrom <= start && a.validTo >= end)
    if (!agreement) {
      blocked("outside_eligibility", "The period is outside the agreement eligibility dates; the base is excluded", { period: input.period, agreements: agreements.map((a) => ({ id: a.id, validFrom: a.validFrom, validTo: a.validTo })) })
    }
    await assertPeriodOpen(tx, ctx.tenant.id, input.period)
    if (agreement.currency !== j.currency) blocked("currency_mismatch", "Agreement and job currencies differ", { agreementCurrency: agreement.currency, jobCurrency: j.currency })
    if (agreement.method === "flat" && (agreement.rateBps !== input.rebateRateBps || agreement.clientShareBps !== input.clientShareBps)) {
      blocked("terms_differ_from_agreement", "Rate or client share differ from the agreement", { agreementRateBps: agreement.rateBps, agreementClientShareBps: agreement.clientShareBps })
    }
    const calc =
      agreement.method === "flat"
        ? (() => {
            const r = flatRebate({ currency: j.currency, eligibleMinor: base, rateBps: agreement.rateBps, clientShareBps: agreement.clientShareBps })
            return { method: "flat" as const, rebateMinor: r.rebateMinor, clientReturnMinor: r.clientReturnMinor, agencyRetainedMinor: r.agencyRetainedMinor, detail: r }
          })()
        : (() => {
            const brackets = (agreement.brackets as { fromMinor: string; bps: number }[]).map((b) => ({ fromMinor: BigInt(b.fromMinor), bps: b.bps, amountMinor: 0n }))
            const r = tieredCommission({ currency: j.currency, method: "slab", baseMinor: base, reductionBps: 0, deductionsMinor: 0n, flatBps: 0, brackets, capMinor: null, priorAdjustedBaseMinor: null, clientShareMode: "percent", clientShareBps: agreement.clientShareBps, clientShareFixedMinor: 0n })
            return { method: "tiered" as const, rebateMinor: r.commissionMinor, clientReturnMinor: r.clientRebateMinor, agencyRetainedMinor: r.agencyRetainedMinor, detail: r }
          })()
    if (calc.rebateMinor === 0n) blocked("no_rebate_due", "The eligible base earns no rebate under the agreement", { method: calc.method })
    const split = allocate({ currency: j.currency, amountMinor: calc.rebateMinor, weights: [{ targetId: "client_share", weight: calc.clientReturnMinor }, { targetId: "agency_retained", weight: calc.agencyRetainedMinor }].filter((w) => w.weight > 0n) })
    const lines = [
      { account: "rebate_receivable", side: "debit" as const, amountMinor: calc.rebateMinor },
      ...(calc.clientReturnMinor > 0n ? [{ account: "rebate_payable_client", side: "credit" as const, amountMinor: calc.clientReturnMinor }] : []),
      ...(calc.agencyRetainedMinor > 0n ? [{ account: "rebate_income", side: "credit" as const, amountMinor: calc.agencyRetainedMinor }] : []),
    ]
    const [adj] = await tx
      .insert(accountingAdjustment)
      .values({ tenantId: ctx.tenant.id, kind: "rebate_provision", jobId: j.id, period: input.period, businessDate: end, currency: j.currency, inputs: toJsonSafe(input) as object, result: toJsonSafe(calc) as object, journalPlan: toJsonSafe(lines) as object, state: "awaiting_approval", reportingGroup: j.reportingGroup, preparedBy: ctx.user.id })
      .returning()
    const [row] = await tx
      .insert(rebateCalculation)
      .values({ tenantId: ctx.tenant.id, agreementId: agreement.id, jobId: j.id, period: input.period, eligibleBaseMinor: base, rebateMinor: calc.rebateMinor, clientReturnMinor: calc.clientReturnMinor, agencyRetainedMinor: calc.agencyRetainedMinor, currency: j.currency, result: toJsonSafe(calc) as object, state: "awaiting_approval", adjustmentId: adj!.id, createdBy: ctx.user.id })
      .returning()
    const appr = await requestFinanceApproval(tx, ctx, {
      actionType: "rebates.provision",
      skillId: "agency-rebates",
      job: { id: j.id, revision: j.revision },
      aggregate: { type: "rebate_calculation", id: row!.id, revision: row!.revision },
      payload: { action: "rebates.provision", calculationId: row!.id, calculationRevision: row!.revision, adjustmentId: adj!.id, adjustmentRevision: adj!.revision, jobId: j.id, period: input.period, businessDate: end, currency: j.currency, lines },
      impact: { rebateMinor: calc.rebateMinor, clientReturnMinor: calc.clientReturnMinor, agencyRetainedMinor: calc.agencyRetainedMinor, currency: j.currency },
      title: `Rebate provision ${s.name} · ${input.period}`,
      amountMinor: calc.rebateMinor,
      currency: j.currency,
      destination: `supplier:${s.fixtureKey ?? s.id}`,
      policyId: REBATE_POLICY,
      origin: meta.origin,
    })
    await tx.update(accountingAdjustment).set({ approvalId: appr.approval.id }).where(eq(accountingAdjustment.id, adj!.id))
    const pending = await tx.select().from(rebateCalculation).where(and(eq(rebateCalculation.tenantId, ctx.tenant.id), eq(rebateCalculation.agreementId, agreement.id), eq(rebateCalculation.state, "awaiting_approval"))).orderBy(asc(rebateCalculation.createdAt))
    return {
      result: {
        calculationId: row!.id,
        ...appr.approvalSummary,
        eligible_base: { eligibleMinor: base, currency: j.currency, period: input.period, agreement: { id: agreement.id, name: agreement.name, validFrom: agreement.validFrom, validTo: agreement.validTo, method: agreement.method }, exclusions: agreement.exclusions },
        rebate_calculation: calc,
        pending_register: pending.map((p) => ({ calculationId: p.id, period: p.period, rebateMinor: p.rebateMinor, state: p.state })),
        provision_proposal: { lines, reportingGroup: j.reportingGroup, state: "awaiting_approval" },
        client_rebates: { clientReturnMinor: calc.clientReturnMinor, split },
        rebate_exceptions: [],
      },
      events: [
        { eventType: "rebates.calculated", aggregateType: "rebate_calculation", aggregateId: row!.id, jobId: j.id, payload: { rebateMinor: calc.rebateMinor, clientReturnMinor: calc.clientReturnMinor, currency: j.currency } },
        ...appr.events,
      ],
    }
  },
})

export async function applyRebateProvision(
  tx: Tx,
  ctx: AgencyContext,
  payload: { calculationId: string; calculationRevision: number; adjustmentId: string; jobId: string; period: string; businessDate: string; currency: string; lines: { account: string; side: "debit" | "credit"; amountMinor: string }[] },
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const [row] = await tx.select().from(rebateCalculation).where(and(eq(rebateCalculation.tenantId, ctx.tenant.id), eq(rebateCalculation.id, payload.calculationId))).for("update").limit(1)
  if (!row || row.revision !== payload.calculationRevision || row.state !== "awaiting_approval") return { ok: false, code: "approval_stale", details: { calculationId: payload.calculationId } }
  const p = await getPeriod(tx, ctx.tenant.id, payload.period)
  if (!p || p.state !== "open") return { ok: false, code: "period_closed", details: { period: payload.period } }
  if (mode === "check") return { ok: true, events: [] }
  const j = await loadJob(tx, ctx.tenant.id, payload.jobId)
  const posted = await postJournals(
    tx,
    ctx,
    [{ entryKey: `rebate:${row.id}`, ruleKey: "rebate_provision", sourceType: "rebate_calculation", sourceId: row.id, jobId: j.id, businessDate: payload.businessDate, currency: payload.currency, memo: "Supplier rebate provision (client share + agency retention)", reportingGroup: j.reportingGroup, lines: payload.lines.map((l) => ({ account: l.account, side: l.side, amountMinor: BigInt(l.amountMinor) })) }],
    { approvedBy: ctx.user.id }
  )
  await tx.update(rebateCalculation).set({ state: "provisioned", revision: sql`${rebateCalculation.revision} + 1` }).where(eq(rebateCalculation.id, row.id))
  await tx.update(accountingAdjustment).set({ state: "posted", approvedBy: ctx.user.id, journalEntryIds: posted.entries.map((e) => e.id), revision: sql`${accountingAdjustment.revision} + 1`, updatedAt: new Date() }).where(eq(accountingAdjustment.id, payload.adjustmentId))
  return { ok: true, events: posted.events }
}
