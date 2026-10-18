import "server-only"

import { and, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { parseCsv } from "@/lib/csv"
import { divHalfUp } from "@/lib/money"
import type { AgencyContext } from "@/server/auth/context"
import { SIMULATED_LABEL, executeAds, reconcileAds, requireActiveConnection, simulatedExternalId } from "@/server/adapters/ads"
import { rdiv } from "@/server/calculators/shared"
import type { Tx } from "@/server/db/client"
import { campaign, fileObject, placementSpec, usageRight } from "@/server/db/schema"
import { createProposal, registerApprovalPolicy, requestApproval } from "@/server/kernel/approvals"
import { defineCommand, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"
import { privateDisk } from "@/server/storage/private-disk"

import { lockJob } from "./budget"
import { getBusinessDate } from "./presenter"
import {
  IsoDate,
  PLAN_APPROVERS,
  Uuid,
  applyLineChange,
  approvedPlan,
  assertJobOpen,
  blocked,
  committedByLineKey,
  creativeSpecCheck,
  none,
  proposePlanRevision,
  taxonomyName,
  toDraft,
} from "./media-planning"

// Campaign activation and optimization (M05, Core-2). Activation is always a
// simulated provider effect after an exact-payload approval; the result reads
// "Simulated activation", never "Live on <provider>". Optimization only
// proposes a plan revision: no spend changes until that revision is approved.

export const CAMPAIGN_ACTION = "campaign.activate"
export const CAMPAIGN_POLICY = registerApprovalPolicy({ id: "campaign-activation-v1", revision: 1 })

async function fileOf(tx: Tx, tenantId: string, id: string, field: string) {
  const [f] = await tx.select().from(fileObject).where(and(eq(fileObject.tenantId, tenantId), eq(fileObject.id, id))).limit(1)
  if (!f) throw new DomainError("not_found", "File not found", { field })
  return f
}

/** Valid usage right for a file on a date; `null` when no rights record exists. */
export async function rightsFor(tx: Tx, tenantId: string, fileId: string, onDate: string) {
  const rights = await tx.select().from(usageRight).where(and(eq(usageRight.tenantId, tenantId), eq(usageRight.fileId, fileId)))
  if (!rights.length) return { state: "no_record" as const, rights }
  const valid = rights.find((r) => r.validFrom <= onDate && r.validTo >= onDate)
  return valid ? { state: "valid" as const, right: valid, rights } : { state: "expired" as const, rights }
}

// ── agency-campaign-activation: activateDemoCampaign ──
export const ActivateCampaignInput = z
  .object({
    job: Uuid,
    connection: Uuid,
    planRevision: z.number().int().min(1).max(99),
    creativeFile: Uuid,
    rightsCleared: z.boolean(),
    landingUrl: z.string().trim().max(200).optional(),
    conversionEvent: z.string().trim().regex(/^[a-z0-9_]{2,80}$/).optional(),
  })
  .strict()

export const activateDemoCampaign = defineCommand({
  type: "media.activateDemoCampaign",
  skillId: "agency-campaign-activation",
  permission: "media.buy",
  input: ActivateCampaignInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertJobOpen(j)
    const plan = await approvedPlan(tx, ctx.tenant.id, j.id)
    const { connection: c, check } = await requireActiveConnection(tx, ctx.tenant.id, input.connection)
    const creative = await fileOf(tx, ctx.tenant.id, input.creativeFile, "creativeFile")
    const preflight: { check: string; passed: boolean; detail: Record<string, unknown> }[] = []
    const rev = plan.revisions.find((r) => r.number === input.planRevision)
    preflight.push({
      check: "plan_revision_approved",
      passed: !!rev && rev.state === "approved",
      detail: { planRevision: input.planRevision, state: rev?.state ?? null, currentApprovedRevision: plan.revision?.number ?? null },
    })
    const line = plan.lines.find((l) => l.provider === c.provider && l.accountAlias === c.accountAlias)
    preflight.push({ check: "account_mapped", passed: !!line, detail: { provider: c.provider, accountAlias: c.accountAlias, simulatedAccount: true } })
    preflight.push({ check: "connection_active", passed: check.active, detail: { state: check.state, missingScopes: check.missingScopes } })
    const flightStart = line?.startDate ?? (await getBusinessDate())
    const rights = await rightsFor(tx, ctx.tenant.id, creative.id, flightStart)
    preflight.push({
      check: "rights_cleared",
      passed: input.rightsCleared && rights.state !== "expired",
      detail: { attested: input.rightsCleared, record: rights.state, validTo: rights.state === "valid" ? rights.right.validTo : null },
    })
    let spec: typeof placementSpec.$inferSelect | undefined
    if (line) {
      ;[spec] = await tx
        .select()
        .from(placementSpec)
        .where(and(eq(placementSpec.tenantId, ctx.tenant.id), eq(placementSpec.provider, line.provider), eq(placementSpec.placement, line.placement)))
        .orderBy(desc(placementSpec.version))
        .limit(1)
    }
    const creativeCheck = spec ? creativeSpecCheck(creative, spec) : null
    preflight.push({ check: "creative_spec", passed: !!creativeCheck?.passed, detail: creativeCheck ?? { reason: "No synthetic ad spec for the placement" } })
    if (input.landingUrl !== undefined) {
      let ok = false
      try {
        ok = new URL(input.landingUrl).protocol === "https:"
      } catch {
        ok = false
      }
      preflight.push({ check: "landing_url", passed: ok, detail: { landingUrl: input.landingUrl } })
    }
    const failed = preflight.filter((p) => !p.passed)
    if (failed.length) {
      if (failed.some((f) => f.check === "connection_active")) {
        throw new DomainError("connection_revoked", "The simulated connection is revoked or missing scopes", { rule: "connection_revoked", preflight })
      }
      blocked(failed[0]!.check === "plan_revision_approved" ? "plan_revision_not_approved" : failed[0]!.check, "Activation preflight failed", { preflight })
    }
    const l = line!
    const r = rev!
    const { committed } = await committedByLineKey(tx, ctx.tenant.id, j.id)
    const name = taxonomyName(j, c.provider, l.placement, input.conversionEvent ? "conv" : "launch")
    const [row] = await tx
      .insert(campaign)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        planRevisionId: r.id,
        planLineId: l.id,
        connectionId: c.id,
        provider: c.provider,
        accountAlias: c.accountAlias,
        name,
        budgetMinor: l.amountMinor,
        currency: l.currency,
        creativeFileId: creative.id,
        state: "awaiting_approval",
        preflight,
        createdBy: ctx.user.id,
      })
      .returning()
    const payload = {
      action: CAMPAIGN_ACTION,
      actionId: crypto.randomUUID(),
      jobId: j.id,
      jobRevision: j.revision,
      campaignId: row!.id,
      campaignRevision: row!.revision,
      planRevisionId: r.id,
      planRevisionNumber: r.number,
      planLineId: l.id,
      lineKey: l.lineKey,
      connectionId: c.id,
      provider: c.provider,
      accountAlias: c.accountAlias,
      name,
      budgetMinor: l.amountMinor.toString(),
      currency: l.currency,
      creativeFileId: creative.id,
      creativeSha256: creative.sha256,
      landingUrl: input.landingUrl ?? null,
      conversionEvent: input.conversionEvent ?? null,
      flight: { start: l.startDate, end: l.endDate },
    }
    const proposal = await createProposal(
      tx,
      ctx,
      {
        actionType: CAMPAIGN_ACTION,
        skillId: "agency-campaign-activation",
        aggregateType: "job",
        aggregateId: j.id,
        baseRevision: j.revision,
        payload,
        diff: { campaign: { before: null, after: { name, budgetMinor: l.amountMinor, state: "active_simulated" } } },
        impact: { simulation: true, label: SIMULATED_LABEL.en, committedOnLineMinor: committed.get(l.lineKey) ?? 0n },
        origin: meta.origin,
      },
      "awaiting_approval"
    )
    const { approval, events } = await requestApproval(tx, ctx, proposal, {
      policyId: CAMPAIGN_POLICY.id,
      policyRevision: CAMPAIGN_POLICY.revision,
      eligibleRoles: PLAN_APPROVERS,
      title: `Simulate activation ${name}`,
      amountMinor: l.amountMinor,
      currency: l.currency,
      destination: `${c.provider}:${c.accountAlias}`,
      expiresInHours: 24 * 7,
    })
    await tx.update(campaign).set({ approvalId: approval.id }).where(eq(campaign.id, row!.id))
    return {
      result: {
        campaignId: row!.id,
        proposalId: proposal.id,
        approvalId: approval.id,
        payloadDigest: proposal.payloadDigest,
        label: SIMULATED_LABEL,
        activation_proposal: { campaignId: row!.id, state: "awaiting_approval", budgetMinor: l.amountMinor.toString(), currency: l.currency, planRevisionNumber: r.number, lineKey: l.lineKey, simulatedAccount: c.accountAlias, eligibleRoles: PLAN_APPROVERS },
        taxonomy_names: [{ lineKey: l.lineKey, name }],
        preflight_results: preflight,
        external_ids: none("Assigned by the simulated provider after the approved activation."),
        readback_report: none("Read back after the simulated activation executes."),
        execution_receipts: none("No execution yet; the activation awaits approval."),
        uncertain_actions: none("No uncertain simulated operations."),
      },
      events: [
        { eventType: "campaign.activation_proposed", aggregateType: "campaign", aggregateId: row!.id, jobId: j.id, payload: { ...payload, proposalId: proposal.id, approvalId: approval.id } },
        ...events.map((e) => ({ ...e, jobId: j.id })),
      ] as EmittedEvent[],
    }
  },
})

type CampaignPayload = {
  actionId: string
  jobId: string
  campaignId: string
  campaignRevision: number
  planRevisionId: string
  planLineId: string
  lineKey: string
  connectionId: string
  provider: string
  accountAlias: string
  budgetMinor: string
  currency: string
  name: string
  creativeSha256: string
  flight: { start: string; end: string }
}

/** Approval executor for `campaign.activate`. */
export async function applyCampaignActivation(
  tx: Tx,
  ctx: AgencyContext,
  raw: Record<string, unknown>,
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const p = raw as unknown as CampaignPayload
  const [row] = await tx
    .select()
    .from(campaign)
    .where(and(eq(campaign.tenantId, ctx.tenant.id), eq(campaign.id, p.campaignId)))
    .for("update")
    .limit(1)
  if (!row || row.state !== "awaiting_approval" || row.revision !== p.campaignRevision) {
    return { ok: false, code: "approval_stale", details: { campaignId: p.campaignId, state: row?.state ?? null } }
  }
  const plan = await approvedPlan(tx, ctx.tenant.id, p.jobId)
  const line = plan.lines.find((l) => l.lineKey === p.lineKey)
  if (plan.revision?.id !== p.planRevisionId || !line || line.amountMinor.toString() !== p.budgetMinor) {
    return { ok: false, code: "approval_stale", details: { reason: "plan_or_budget_changed", currentApprovedRevision: plan.revision?.number ?? null } }
  }
  const { connection: c, check } = await requireActiveConnection(tx, ctx.tenant.id, p.connectionId)
  if (c.accountAlias !== p.accountAlias || c.provider !== p.provider) return { ok: false, code: "approval_stale", details: { reason: "account_changed" } }
  if (!check.active) return { ok: false, code: "connection_revoked", details: { ...check } }
  if (mode === "check") return { ok: true, events: [] }

  const res = await executeAds(tx, {
    tenantId: ctx.tenant.id,
    connection: c,
    operationType: CAMPAIGN_ACTION,
    approvedActionId: p.actionId,
    payload: { name: p.name, budgetMinor: p.budgetMinor, currency: p.currency, flight: p.flight, creativeSha256: p.creativeSha256 },
  })
  const update =
    res.state === "succeeded"
      ? { state: "active_simulated", receiptId: res.receiptId, externalId: simulatedExternalId(res.receiptId), lastError: null }
      : res.state === "outcome_unknown"
        ? { state: "outcome_unknown", receiptId: null, externalId: null, lastError: null }
        : { state: "failed", receiptId: null, externalId: null, lastError: res.error }
  await tx
    .update(campaign)
    .set({ ...update, adapterOperationId: res.operationId, updatedAt: new Date(), revision: sql`${campaign.revision} + 1` })
    .where(eq(campaign.id, row.id))
  return {
    ok: true,
    events: [
      {
        eventType: `campaign.activation_${update.state}`,
        aggregateType: "campaign",
        aggregateId: row.id,
        jobId: p.jobId,
        payload: {
          label: res.state === "succeeded" ? SIMULATED_LABEL.en : null,
          operationId: res.operationId,
          receiptId: update.receiptId,
          externalId: update.externalId,
          failureMode: res.failureMode,
          connectionRevoked: res.state === "failed" || res.state === "rate_limited" ? res.connectionRevoked : false,
          simulation: true,
        },
      },
    ],
  }
}

export const ReconcileCampaignInput = z.object({ campaign: Uuid }).strict()

export const reconcileCampaignActivation = defineCommand({
  type: "media.reconcileCampaignActivation",
  skillId: "agency-campaign-activation",
  permission: "media.buy",
  input: ReconcileCampaignInput,
  handler: async (tx, ctx, input) => {
    const [row] = await tx
      .select()
      .from(campaign)
      .where(and(eq(campaign.tenantId, ctx.tenant.id), eq(campaign.id, input.campaign)))
      .for("update")
      .limit(1)
    if (!row) throw new DomainError("not_found", "Campaign not found")
    if (row.state !== "outcome_unknown" || !row.adapterOperationId) blocked("nothing_to_reconcile", "The campaign has no uncertain activation", { state: row.state })
    const res = await reconcileAds(tx, ctx.tenant.id, row.adapterOperationId)
    const next =
      res.state === "succeeded"
        ? { state: "active_simulated", receiptId: res.receiptId, externalId: simulatedExternalId(res.receiptId), lastError: null }
        : { state: "failed", receiptId: null, externalId: null, lastError: "no_effect_confirmed" }
    await tx.update(campaign).set({ ...next, updatedAt: new Date(), revision: sql`${campaign.revision} + 1` }).where(eq(campaign.id, row.id))
    return {
      result: { campaignId: row.id, outcome: res.state, state: next.state, receiptId: next.receiptId, externalId: next.externalId, effectCount: res.effectCount, label: res.state === "succeeded" ? SIMULATED_LABEL : null },
      events: [{ eventType: "campaign.activation_reconciled", aggregateType: "campaign", aggregateId: row.id, jobId: row.jobId, payload: { outcome: res.state, receiptId: next.receiptId, effectCount: res.effectCount } }],
    }
  },
})

// ── agency-campaign-optimization: proposeCampaignOptimization ──
export const OptimizationInput = z
  .object({
    job: Uuid,
    objective: z.enum(["reach", "conversions", "cost_efficiency"]),
    metricsFile: Uuid,
    metricsAsOf: IsoDate,
    maxShiftBps: z.number().int().min(0).max(10000),
  })
  .strict()

const STALE_AFTER_DAYS = 7
const METRIC_HEADERS = ["date", "line_key", "currency", "spend_minor", "impressions", "clicks", "conversions"]

type MetricRow = { date: string; lineKey: string; currency: string; spend: bigint; impressions: bigint; clicks: bigint; conversions: bigint }

export async function readMetricsFile(tx: Tx, tenantId: string, fileId: string) {
  const f = await fileOf(tx, tenantId, fileId, "metricsFile")
  if (f.format !== "csv") throw new DomainError("validation", "Synthetic metrics must be a CSV file", { field: "metricsFile" })
  const text = new TextDecoder().decode(await privateDisk.get(tenantId, f.storageKey))
  const { headers, rows } = parseCsv(text, ",")
  if (headers.join(",") !== METRIC_HEADERS.join(",")) {
    throw new DomainError("validation", "Unexpected metrics columns", { field: "metricsFile", expected: METRIC_HEADERS, found: headers })
  }
  const int = (v: string, field: string, row: number) => {
    if (!/^\d{1,15}$/.test(v)) throw new DomainError("validation", `Invalid ${field} on row ${row}`, { field: "metricsFile", row })
    return BigInt(v)
  }
  const data: MetricRow[] = rows.map((r, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r[0] ?? "")) throw new DomainError("validation", `Invalid date on row ${i + 2}`, { field: "metricsFile", row: i + 2 })
    return { date: r[0]!, lineKey: r[1]!, currency: r[2]!, spend: int(r[3]!, "spend_minor", i + 2), impressions: int(r[4]!, "impressions", i + 2), clicks: int(r[5]!, "clicks", i + 2), conversions: int(r[6]!, "conversions", i + 2) }
  })
  return { file: f, rows: data }
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export const proposeCampaignOptimization = defineCommand({
  type: "media.proposeCampaignOptimization",
  skillId: "agency-campaign-optimization",
  permission: "media.buy",
  input: OptimizationInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertJobOpen(j)
    const { file, rows } = await readMetricsFile(tx, ctx.tenant.id, input.metricsFile)
    if (file.jobId !== j.id) blocked("metrics_file_job_mismatch", "The metrics file belongs to another job", { fileJobId: file.jobId })
    if (!rows.length) blocked("no_metrics", "The metrics file has no rows")
    const lastDate = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0]!.date)
    const effectiveAsOf = lastDate < input.metricsAsOf ? lastDate : input.metricsAsOf
    const businessAsOf = await getBusinessDate()
    const ageDays = dayDiff(effectiveAsOf, businessAsOf)
    if (ageDays > STALE_AFTER_DAYS) {
      blocked("stale_metrics_source", "Stale metrics cannot justify a budget increase", { effectiveAsOf, businessAsOf, ageDays, maxAgeDays: STALE_AFTER_DAYS })
    }
    const plan = await approvedPlan(tx, ctx.tenant.id, j.id)
    if (!plan.revision) blocked("plan_revision_not_approved", "The job has no approved media plan")
    const byLine = new Map<string, { spend: bigint; impressions: bigint; clicks: bigint; conversions: bigint; days: number; currency: string }>()
    const exceptions: Record<string, unknown>[] = []
    for (const r of rows) {
      if (r.date > effectiveAsOf) continue
      if (!plan.lines.some((l) => l.lineKey === r.lineKey)) {
        exceptions.push({ code: "line_not_in_plan", lineKey: r.lineKey, date: r.date })
        continue
      }
      if (r.currency !== j.currency) {
        exceptions.push({ code: "currency_mismatch", lineKey: r.lineKey, currency: r.currency })
        continue
      }
      const t = byLine.get(r.lineKey) ?? { spend: 0n, impressions: 0n, clicks: 0n, conversions: 0n, days: 0, currency: r.currency }
      t.spend += r.spend
      t.impressions += r.impressions
      t.clicks += r.clicks
      t.conversions += r.conversions
      t.days += 1
      byLine.set(r.lineKey, t)
    }
    const metricOf = (t: { spend: bigint; impressions: bigint; clicks: bigint; conversions: bigint }) =>
      input.objective === "conversions"
        ? t.conversions ? divHalfUp(t.spend, t.conversions) : null
        : input.objective === "reach"
          ? t.impressions ? divHalfUp(t.spend * 1000n, t.impressions) : null
          : t.clicks ? divHalfUp(t.spend, t.clicks) : null
    const metricName = input.objective === "conversions" ? "cpa_minor" : input.objective === "reach" ? "cpm_minor" : "cpc_minor"
    const diagnostic = [...byLine.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([lineKey, t]) => ({
        lineKey,
        days: t.days,
        spendMinor: t.spend.toString(),
        impressions: t.impressions.toString(),
        clicks: t.clicks.toString(),
        conversions: t.conversions.toString(),
        ctrBps: t.impressions ? Number(divHalfUp(t.clicks * 10000n, t.impressions)) : null,
        metric: metricName,
        valueMinor: metricOf(t),
      }))
    const comparable = diagnostic.filter((d) => d.valueMinor !== null) as (typeof diagnostic[number] & { valueMinor: bigint })[]
    if (comparable.length < 2) blocked("insufficient_comparable_lines", "At least two lines with the objective metric are needed", { metric: metricName })
    const sorted = [...comparable].sort((a, b) => (a.valueMinor === b.valueMinor ? (a.lineKey < b.lineKey ? -1 : 1) : a.valueMinor < b.valueMinor ? -1 : 1))
    const best = sorted[0]!
    const worst = sorted[sorted.length - 1]!
    if (best.valueMinor === worst.valueMinor) blocked("no_performance_gap", "Lines perform equally on the objective metric", { metric: metricName })
    const from = plan.lines.find((l) => l.lineKey === worst.lineKey)!
    const to = plan.lines.find((l) => l.lineKey === best.lineKey)!
    const { committed } = await committedByLineKey(tx, ctx.tenant.id, j.id)
    const ceiling = rdiv(from.amountMinor * BigInt(input.maxShiftBps), 10000n)
    const releasable = from.amountMinor - (committed.get(from.lineKey) ?? 0n)
    const shift = ceiling < releasable ? ceiling : releasable
    if (shift <= 0n) blocked("below_commitment", "The source line has no uncommitted budget to move", { lineKey: from.lineKey })
    const lines = applyLineChange(plan.lines.map(toDraft), from.channel, from.amountMinor - shift, to.channel)
    const mean = comparable.reduce((s, d) => s + d.valueMinor, 0n) / BigInt(comparable.length)
    const res = await proposePlanRevision(tx, ctx, meta, {
      job: j,
      base: plan,
      lines,
      objective: plan.revision.objective,
      reason: `Optimization (${metricName}): move ${shift} minor units from ${from.lineKey} to ${to.lineKey}`,
      reasonCategory: "market_change",
      source: "optimization",
      skillId: "agency-campaign-optimization",
      impact: { metricsFileId: file.id, metricsSha256: file.sha256, effectiveAsOf, metric: metricName },
    })
    return {
      result: {
        planRevisionId: res.revision.id,
        number: res.revision.number,
        proposalId: res.proposal.id,
        approvalId: res.approval.id,
        payloadDigest: res.proposal.payloadDigest,
        diagnostic: diagnostic.map((d) => ({ ...d, valueMinor: d.valueMinor?.toString() ?? null })),
        objective_deviation: comparable.map((d) => ({ lineKey: d.lineKey, metric: metricName, valueMinor: d.valueMinor.toString(), meanMinor: mean.toString(), deviationBps: mean ? Number(divHalfUp((d.valueMinor - mean) * 10000n, mean)) : null })),
        optimization_proposal: { fromLine: from.lineKey, toLine: to.lineKey, shiftMinor: shift.toString(), currency: j.currency, planRevisionNumber: res.revision.number, state: "pending_approval", eligibleRoles: PLAN_APPROVERS },
        experiment_plan: { design: "holdout_split", lines: [from.lineKey, to.lineKey], durationDays: 7, successMetric: metricName, note: "Deterministic suggestion from synthetic metrics; not a guaranteed result." },
        constraint_check: {
          maxShiftBps: input.maxShiftBps,
          ceilingMinor: ceiling.toString(),
          committedOnSourceMinor: (committed.get(from.lineKey) ?? 0n).toString(),
          shiftMinor: shift.toString(),
          totalUnchanged: res.diff.currencyDeltas.every((d) => d.deltaMinor === 0n),
          freshness: { effectiveAsOf, ageDays, maxAgeDays: STALE_AFTER_DAYS, fresh: true },
          dataExceptions: exceptions,
        },
        verified_change_receipts: none("A proposal executes no spend change; it waits for plan approval."),
      },
      events: res.events,
    }
  },
})
