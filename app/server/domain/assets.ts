import "server-only"

import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import { depreciationSchedule } from "@/server/calculators/finance"
import type { Tx } from "@/server/db/client"
import { accountingAdjustment, depreciationEntry, fixedAsset } from "@/server/db/schema"
import { defineCommand, toJsonSafe, type EmittedEvent } from "@/server/kernel/commands"

import { periodEnd } from "./accruals"
import { assertPeriodOpen, blocked, Decimal, getPeriod, IsoDate, loadJob, moneyInput, postJournals, requestFinanceApproval } from "./ledger"

// Fixed assets (M08): register an asset, persist its straight-line schedule
// (depreciation_schedule calculator, exact totals) and propose the first
// month's depreciation journal for finance review. A month posts once.

export const DEPRECIATION_POLICY = "depreciation-v1"

export const CalculateAssetDepreciationInput = z
  .object({
    assetName: z.string().trim().min(2).max(120),
    cost: Decimal,
    residualValue: Decimal,
    usefulLifeMonths: z.number().int().min(1).max(600),
    startDate: IsoDate,
    method: z.enum(["straight_line", "declining_balance"]),
    job: z.string().uuid().optional().nullable(),
  })
  .strict()

export const calculateAssetDepreciation = defineCommand({
  type: "assets.registerAndSchedule",
  skillId: "agency-fixed-assets",
  // Prepared with ledger.prepare (e.g. the owner); reviewed by finance, never the preparer.
  permission: "ledger.prepare",
  input: CalculateAssetDepreciationInput,
  handler: async (tx, ctx, input, meta) => {
    if (input.method !== "straight_line") blocked("unsupported_method", "Only straight-line depreciation is supported by the demo calculator", { method: input.method })
    const j = input.job ? await loadJob(tx, ctx.tenant.id, input.job) : null
    const currency = j?.currency ?? ctx.tenant.baseCurrency
    const cost = moneyInput(input.cost, currency, "cost")
    const residual = moneyInput(input.residualValue, currency, "residualValue", { allowZero: true })
    if (residual > cost) blocked("residual_exceeds_cost", "Depreciation beyond the depreciable base is not allowed (residual exceeds cost)", { costMinor: cost.toString(), residualMinor: residual.toString() })
    const [existing] = await tx.select().from(fixedAsset).where(and(eq(fixedAsset.tenantId, ctx.tenant.id), eq(fixedAsset.name, input.assetName))).limit(1)
    if (existing) blocked("duplicate_depreciation_month", "This asset is already registered; its months cannot be scheduled twice", { assetId: existing.id })
    const schedule = depreciationSchedule({ currency, costMinor: cost, residualMinor: residual, lifeMonths: input.usefulLifeMonths, acquisitionDate: input.startDate, firstMonthRule: "acquisition_month" })
    const first = schedule.months[0]!
    await assertPeriodOpen(tx, ctx.tenant.id, first.month)
    const reportingGroup = j?.reportingGroup ?? "primary"
    const [asset] = await tx
      .insert(fixedAsset)
      .values({ tenantId: ctx.tenant.id, name: input.assetName, jobId: j?.id ?? null, costMinor: cost, residualMinor: residual, currency, lifeMonths: input.usefulLifeMonths, startDate: input.startDate, method: input.method, reportingGroup, createdBy: ctx.user.id })
      .returning()
    await tx.insert(depreciationEntry).values(schedule.months.map((m) => ({ tenantId: ctx.tenant.id, assetId: asset!.id, month: m.month, chargeMinor: m.chargeMinor, accumulatedMinor: m.accumulatedMinor, netBookMinor: m.netBookMinor, state: "scheduled" })))
    const lines = [
      { account: "depreciation_expense", side: "debit" as const, amountMinor: first.chargeMinor },
      { account: "accumulated_depreciation", side: "credit" as const, amountMinor: first.chargeMinor },
    ]
    const businessDate = periodEnd(first.month)
    const [adj] = await tx
      .insert(accountingAdjustment)
      .values({ tenantId: ctx.tenant.id, kind: "depreciation", jobId: j?.id ?? null, period: first.month, businessDate, currency, inputs: toJsonSafe(input) as object, result: toJsonSafe({ month: first }) as object, journalPlan: toJsonSafe(lines) as object, state: "awaiting_approval", reportingGroup, preparedBy: ctx.user.id })
      .returning()
    await tx.update(depreciationEntry).set({ state: "proposed", adjustmentId: adj!.id }).where(and(eq(depreciationEntry.tenantId, ctx.tenant.id), eq(depreciationEntry.assetId, asset!.id), eq(depreciationEntry.month, first.month)))
    const appr = await requestFinanceApproval(tx, ctx, {
      actionType: "assets.depreciation",
      skillId: "agency-fixed-assets",
      job: j ? { id: j.id, revision: j.revision } : null,
      aggregate: { type: "fixed_asset", id: asset!.id, revision: asset!.revision },
      payload: { action: "assets.depreciation", assetId: asset!.id, assetRevision: asset!.revision, adjustmentId: adj!.id, month: first.month, businessDate, currency, chargeMinor: first.chargeMinor, jobId: j?.id ?? null },
      impact: { chargeMinor: first.chargeMinor, currency, month: first.month },
      title: `Depreciation ${input.assetName} · ${first.month}`,
      amountMinor: first.chargeMinor,
      currency,
      destination: "Demo ledger — synthetic, non-fiscal",
      policyId: DEPRECIATION_POLICY,
      origin: meta.origin,
    })
    await tx.update(accountingAdjustment).set({ approvalId: appr.approval.id }).where(eq(accountingAdjustment.id, adj!.id))
    return {
      result: {
        assetId: asset!.id,
        ...appr.approvalSummary,
        asset_register_changes: [{ action: "register", assetId: asset!.id, name: input.assetName, costMinor: cost, residualMinor: residual, lifeMonths: input.usefulLifeMonths, startDate: input.startDate, method: input.method, currency, reportingGroup }],
        depreciation_run_proposal: { month: first.month, chargeMinor: first.chargeMinor, journal: lines, state: "awaiting_approval" },
        disposal_proposal: { items: [], reason: "Newly registered asset; no disposal." },
        fixed_asset_annex: schedule,
      },
      events: [
        { eventType: "assets.registered", aggregateType: "fixed_asset", aggregateId: asset!.id, jobId: j?.id ?? null, payload: { costMinor: cost, lifeMonths: input.usefulLifeMonths, monthlyMinor: first.chargeMinor, currency } },
        ...appr.events,
      ],
    }
  },
})

export async function applyDepreciation(
  tx: Tx,
  ctx: AgencyContext,
  payload: { assetId: string; assetRevision: number; adjustmentId: string; month: string; businessDate: string; currency: string; chargeMinor: string; jobId: string | null },
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const [asset] = await tx.select().from(fixedAsset).where(and(eq(fixedAsset.tenantId, ctx.tenant.id), eq(fixedAsset.id, payload.assetId))).limit(1)
  const [entry] = await tx.select().from(depreciationEntry).where(and(eq(depreciationEntry.tenantId, ctx.tenant.id), eq(depreciationEntry.assetId, payload.assetId), eq(depreciationEntry.month, payload.month))).for("update").limit(1)
  if (!asset || asset.revision !== payload.assetRevision || !entry || entry.state !== "proposed") return { ok: false, code: "approval_stale", details: { assetId: payload.assetId, month: payload.month } }
  const p = await getPeriod(tx, ctx.tenant.id, payload.month)
  if (!p || p.state !== "open") return { ok: false, code: "period_closed", details: { period: payload.month } }
  if (mode === "check") return { ok: true, events: [] }
  const charge = BigInt(payload.chargeMinor)
  const posted = await postJournals(
    tx,
    ctx,
    [{ entryKey: `depreciation:${asset.id}:${payload.month}`, ruleKey: "depreciation", sourceType: "fixed_asset", sourceId: asset.id, jobId: payload.jobId, businessDate: payload.businessDate, currency: payload.currency, memo: `Depreciation ${asset.name} ${payload.month}`, reportingGroup: asset.reportingGroup, lines: [{ account: "depreciation_expense", side: "debit", amountMinor: charge }, { account: "accumulated_depreciation", side: "credit", amountMinor: charge }] }],
    { approvedBy: ctx.user.id }
  )
  await tx.update(depreciationEntry).set({ state: "posted", journalEntryId: posted.entries.find((e) => e.ruleKey === "depreciation")?.id ?? null }).where(eq(depreciationEntry.id, entry.id))
  await tx.update(accountingAdjustment).set({ state: "posted", approvedBy: ctx.user.id, journalEntryIds: posted.entries.map((e) => e.id), revision: sql`${accountingAdjustment.revision} + 1`, updatedAt: new Date() }).where(eq(accountingAdjustment.id, payload.adjustmentId))
  return { ok: true, events: posted.events }
}
