import "server-only"

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { parseDecimalToMinor } from "@/lib/money"
import type { AgencyContext } from "@/server/auth/context"
import { connectionCheck } from "@/server/adapters/ads"
import { audienceMetrics, mediaLineCost, planDiff, type PlanDiffLine } from "@/server/calculators/planning"
import type { Tx } from "@/server/db/client"
import {
  audienceEstimate,
  audienceSource,
  campaign,
  client,
  connection,
  fileObject,
  job,
  mediaPlanLine,
  mediaPlanRevision,
  placementSpec,
  purchaseOrder,
  rateCard,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { createProposal, digestOf, invalidatePendingApprovals, registerApprovalPolicy, requestApproval } from "@/server/kernel/approvals"
import { defineCommand, type CommandMeta, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { lockJob } from "./budget"
import { getBusinessDate } from "./presenter"
import { budgetAvailability, loadJobFinancials } from "./profitability"

// Media planning (M04, Core-2): ranking over synthetic versioned sources,
// versioned plan revisions with approval, digital preflight and plan changes.
// Also hosts the small helpers shared by the Core-2 domain files.

// ── Core-2 shared helpers ──

export const Uuid = z.string().uuid()
export const Decimal = z.string().trim().min(1).max(24)
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const PLAN_APPROVERS = ["owner", "finance_approver"] as const
export const ACTIVE_ORDER_STATES = ["approved", "submitted", "acknowledged", "partially_delivered", "delivered", "reconciled"]

export type JobRow = typeof job.$inferSelect
export type PlanLineRow = typeof mediaPlanLine.$inferSelect
export type PlanRevisionRow = typeof mediaPlanRevision.$inferSelect

export function parseMoney(value: string, currency: string, field: string, opts: { positive?: boolean } = {}): bigint {
  let minor: bigint
  try {
    minor = parseDecimalToMinor(value, currency)
  } catch {
    throw new DomainError("validation", `Invalid amount for ${field}`, { field })
  }
  if (minor < 0n || (opts.positive && minor === 0n)) {
    throw new DomainError("validation", `Amount for ${field} must be ${opts.positive ? "positive" : "zero or more"}`, { field })
  }
  return minor
}

export function assertDates(start: string, end: string, field = "flightEnd") {
  if (end < start) throw new DomainError("validation", "The end date precedes the start date", { field })
}

export function assertJobOpen(j: JobRow) {
  if (j.state === "closed" || j.state === "draft") {
    throw new DomainError("blocked_by_rule", "The job is not open", { rule: "job_not_open", state: j.state })
  }
}

export function blocked(rule: string, message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError("blocked_by_rule", message, { rule, ...details })
}

/** Explicitly empty repository output (contract: never invented prose). */
export const none = (reason: string) => ({ items: [] as unknown[], reason })

export const CHANNEL_PROVIDER: Record<string, string> = {
  meta: "meta_ads",
  google: "google_ads",
  tiktok: "tiktok_ads",
  ctv: "dv360_demo",
  radio: "offline_file_demo",
  ooh: "offline_file_demo",
}
export const DIGITAL_PROVIDERS = new Set(["meta_ads", "google_ads", "tiktok_ads", "dv360_demo"])

export async function bumpJobRevision(tx: Tx, tenantId: string, jobId: string, actor: string) {
  const [row] = await tx
    .update(job)
    .set({ revision: sql`${job.revision} + 1`, updatedAt: new Date(), updatedBy: actor })
    .where(and(eq(job.tenantId, tenantId), eq(job.id, jobId)))
    .returning({ revision: job.revision })
  return row!.revision
}

export async function planRevisionsOf(tx: Tx, tenantId: string, jobId: string) {
  return tx
    .select()
    .from(mediaPlanRevision)
    .where(and(eq(mediaPlanRevision.tenantId, tenantId), eq(mediaPlanRevision.jobId, jobId)))
    .orderBy(desc(mediaPlanRevision.number))
}

export async function linesOf(tx: Tx, tenantId: string, revisionId: string) {
  const rows = await tx
    .select()
    .from(mediaPlanLine)
    .where(and(eq(mediaPlanLine.tenantId, tenantId), eq(mediaPlanLine.planRevisionId, revisionId)))
  return rows.sort((a, b) => (a.lineKey < b.lineKey ? -1 : a.lineKey > b.lineKey ? 1 : 0))
}

export async function approvedPlan(tx: Tx, tenantId: string, jobId: string) {
  const revisions = await planRevisionsOf(tx, tenantId, jobId)
  const revision = revisions.find((r) => r.state === "approved") ?? null
  return { revision, lines: revision ? await linesOf(tx, tenantId, revision.id) : [], revisions }
}

/** Committed media authority per plan line key (active media orders of the job). */
export async function committedByLineKey(tx: Tx, tenantId: string, jobId: string) {
  const rows = await tx
    .select({ lineKey: mediaPlanLine.lineKey, amountMinor: purchaseOrder.amountMinor, state: purchaseOrder.state, orderId: purchaseOrder.id, receiptId: purchaseOrder.receiptId, reference: purchaseOrder.reference })
    .from(purchaseOrder)
    .innerJoin(mediaPlanLine, and(eq(mediaPlanLine.tenantId, purchaseOrder.tenantId), eq(mediaPlanLine.id, purchaseOrder.planLineId)))
    .where(and(eq(purchaseOrder.tenantId, tenantId), eq(purchaseOrder.jobId, jobId), eq(purchaseOrder.kind, "media")))
  const active = rows.filter((r) => ACTIVE_ORDER_STATES.includes(r.state))
  const committed = new Map<string, bigint>()
  for (const r of active) committed.set(r.lineKey, (committed.get(r.lineKey) ?? 0n) + r.amountMinor)
  return { committed, orders: active }
}

export type LineDraft = {
  lineKey: string
  channel: string
  placement: string
  provider: string
  accountAlias: string | null
  quantity: number | null
  unitCostMinor: bigint | null
  amountMinor: bigint
  currency: string
  startDate: string
  endDate: string
  audience: string | null
}

export const toDraft = (l: PlanLineRow): LineDraft => ({
  lineKey: l.lineKey,
  channel: l.channel,
  placement: l.placement,
  provider: l.provider,
  accountAlias: l.accountAlias,
  quantity: l.quantity,
  unitCostMinor: l.unitCostMinor,
  amountMinor: l.amountMinor,
  currency: l.currency,
  startDate: l.startDate,
  endDate: l.endDate,
  audience: l.audience,
})

const diffLine = (l: LineDraft, committed: Map<string, bigint>): PlanDiffLine => ({
  lineId: l.lineKey,
  accountId: l.accountAlias ?? "none",
  supplierId: l.provider,
  channel: l.channel,
  currency: l.currency,
  amountMinor: l.amountMinor,
  committedMinor: committed.get(l.lineKey) ?? 0n,
  startDate: l.startDate,
  endDate: l.endDate,
})

export function lineWire(l: LineDraft) {
  return {
    lineKey: l.lineKey,
    channel: l.channel,
    placement: l.placement,
    provider: l.provider,
    accountAlias: l.accountAlias,
    quantity: l.quantity,
    unitCostMinor: l.unitCostMinor?.toString() ?? null,
    amountMinor: l.amountMinor.toString(),
    currency: l.currency,
    startDate: l.startDate,
    endDate: l.endDate,
    audience: l.audience,
    simulation: true,
  }
}

export function itemPricing(lines: LineDraft[]) {
  return lines.map((l) => {
    const priced =
      l.quantity && l.unitCostMinor !== null
        ? mediaLineCost({ currency: l.currency, calcType: "per_unit", rateMinor: l.unitCostMinor, measure: 1, spots: l.quantity, volume: 0n, packageMinor: 0n })
        : mediaLineCost({ currency: l.currency, calcType: "package", rateMinor: 0n, measure: 0, spots: 0, volume: 0n, packageMinor: l.amountMinor })
    return {
      lineKey: l.lineKey,
      channel: l.channel,
      formula: priced.formula,
      quantity: l.quantity,
      unitCostMinor: l.unitCostMinor?.toString() ?? null,
      grossMinor: priced.grossMinor.toString(),
      amountMinor: l.amountMinor.toString(),
      consistent: priced.grossMinor === l.amountMinor,
      currency: l.currency,
    }
  })
}

const sumLines = (lines: LineDraft[]) => lines.reduce((s, l) => s + l.amountMinor, 0n)

export const PLAN_POLICY = registerApprovalPolicy({ id: "media-plan-revision-v1", revision: 1 })
export const PLAN_ACTION = "media_plan.approve_revision"
/** Pending approvals that a newly approved plan revision makes obsolete. */
export const PLAN_DEPENDENT_ACTIONS = [PLAN_ACTION, "media_order.issue", "campaign.activate"]

/**
 * Persists a submitted plan revision built from `lines` and requests its
 * approval. The approved base revision stays approved until the new one is
 * approved; pending plan proposals for the job become stale.
 */
export async function proposePlanRevision(
  tx: Tx,
  ctx: AgencyContext,
  meta: CommandMeta,
  args: {
    job: JobRow
    base: { revision: PlanRevisionRow | null; lines: PlanLineRow[] }
    lines: LineDraft[]
    objective: string
    reason: string
    reasonCategory: string | null
    source: "plan_save" | "plan_change" | "optimization"
    skillId: string
    impact?: Record<string, unknown>
  }
) {
  const j = args.job
  const currency = j.currency
  if (args.lines.some((l) => l.currency !== currency)) {
    throw new DomainError("validation", "Plan lines must use the job currency", { rule: "single_currency", currency })
  }
  for (const l of args.lines) assertDates(l.startDate, l.endDate)
  const { committed, orders } = await committedByLineKey(tx, ctx.tenant.id, j.id)
  const before = args.base.lines.map(toDraft)
  const diff = planDiff({ before: before.map((l) => diffLine(l, committed)), after: args.lines.map((l) => diffLine(l, committed)) })
  if (diff.blockers.length) {
    blocked(diff.blockers[0]!.reason, "The change would reduce or rewrite committed media authority", {
      blockers: diff.blockers,
      committed: Object.fromEntries([...committed].map(([k, v]) => [k, v.toString()])),
    })
  }
  const audienceChanged = args.lines.some((l) => (before.find((b) => b.lineKey === l.lineKey)?.audience ?? null) !== l.audience)
  if (!diff.requiresHostApproval && !audienceChanged) throw new DomainError("validation", "The revision has no changes", { rule: "no_changes" })

  const total = sumLines(args.lines)
  const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
  const media = budgetAvailability(fin).find((s) => s.scope === "managed_media_authority")!
  if (total > media.authorizedMinor) {
    blocked("exceeds_managed_media_authority", "The plan exceeds the approved managed media budget", {
      totalMinor: total.toString(),
      authorizedMinor: media.authorizedMinor.toString(),
      currency,
    })
  }
  const fee = fin.approvedBudget?.agencyFeeMinor ?? 0n
  const authority = fin.approvedAuthority?.amountMinor ?? 0n
  if (fee + total > authority) {
    blocked("exceeds_client_authority", "Fee plus media exceeds the client's approved PO authority", {
      requiredMinor: (fee + total).toString(),
      clientAuthorityMinor: authority.toString(),
      currency,
    })
  }

  const staled = await invalidatePendingApprovals(tx, ctx.tenant.id, "job", j.id, { actionTypes: [PLAN_ACTION] })
  const pending = (await planRevisionsOf(tx, ctx.tenant.id, j.id)).filter((r) => r.state === "submitted")
  for (const p of pending) {
    await tx
      .update(mediaPlanRevision)
      .set({ state: "superseded", revision: sql`${mediaPlanRevision.revision} + 1`, updatedBy: ctx.user.id })
      .where(eq(mediaPlanRevision.id, p.id))
  }
  const revisions = await planRevisionsOf(tx, ctx.tenant.id, j.id)
  const number = (revisions[0]?.number ?? 0) + 1
  const [rev] = await tx
    .insert(mediaPlanRevision)
    .values({
      tenantId: ctx.tenant.id,
      jobId: j.id,
      number,
      state: "submitted",
      totalMinor: total,
      currency,
      objective: args.objective,
      createdBy: ctx.user.id,
      updatedBy: ctx.user.id,
    })
    .returning()
  const inserted = await tx
    .insert(mediaPlanLine)
    .values(
      args.lines.map((l) => ({
        tenantId: ctx.tenant.id,
        planRevisionId: rev!.id,
        lineKey: l.lineKey,
        channel: l.channel,
        placement: l.placement,
        provider: l.provider,
        accountAlias: l.accountAlias,
        quantity: l.quantity,
        unitCostMinor: l.unitCostMinor,
        amountMinor: l.amountMinor,
        currency,
        startDate: l.startDate,
        endDate: l.endDate,
        audience: l.audience,
      }))
    )
    .returning()

  const actionId = crypto.randomUUID()
  const payload = {
    action: PLAN_ACTION,
    actionId,
    source: args.source,
    jobId: j.id,
    jobRevision: j.revision,
    planRevisionId: rev!.id,
    planRevisionNumber: number,
    baseRevisionId: args.base.revision?.id ?? null,
    baseRevisionNumber: args.base.revision?.number ?? null,
    totalMinor: total.toString(),
    currency,
    lines: args.lines.map(lineWire),
  }
  const lineChanges = [...diff.added, ...diff.changed, ...diff.removed].map((k) => ({
    lineKey: k,
    beforeMinor: before.find((l) => l.lineKey === k)?.amountMinor.toString() ?? null,
    afterMinor: args.lines.find((l) => l.lineKey === k)?.amountMinor.toString() ?? null,
  }))
  const proposal = await createProposal(
    tx,
    ctx,
    {
      actionType: PLAN_ACTION,
      skillId: args.skillId,
      aggregateType: "job",
      aggregateId: j.id,
      baseRevision: j.revision,
      payload,
      diff: { lines: lineChanges, currencyDeltas: diff.currencyDeltas },
      impact: {
        totalBeforeMinor: sumLines(before).toString(),
        totalAfterMinor: total.toString(),
        managedMediaAuthorityMinor: media.authorizedMinor.toString(),
        clientAuthority: { approvedMinor: authority.toString(), requiredMinor: (fee + total).toString() },
        reason: args.reason,
        reasonCategory: args.reasonCategory,
        ...(args.impact ?? {}),
      },
      origin: meta.origin,
    },
    "awaiting_approval"
  )
  const { approval, events } = await requestApproval(tx, ctx, proposal, {
    policyId: PLAN_POLICY.id,
    policyRevision: PLAN_POLICY.revision,
    eligibleRoles: PLAN_APPROVERS,
    title: `Media plan ${j.displayReference} r${number}`,
    amountMinor: total,
    currency,
    destination: `job:${j.jobNumber}`,
    expiresInHours: 24 * 14,
  })
  return {
    revision: rev!,
    lines: inserted,
    diff,
    before,
    committed,
    orders,
    proposal,
    approval,
    staled,
    total,
    media,
    events: [
      {
        eventType: "media_plan.revision_submitted",
        aggregateType: "job",
        aggregateId: j.id,
        aggregateRevision: j.revision,
        jobId: j.id,
        payload: {
          planRevisionId: rev!.id,
          number,
          baseRevisionNumber: args.base.revision?.number ?? null,
          source: args.source,
          totalMinor: total,
          lines: lineChanges,
          reason: args.reason,
          proposalId: proposal.id,
          approvalId: approval.id,
          staleApprovals: staled,
        },
      },
      ...events.map((e) => ({ ...e, jobId: j.id })),
    ] as EmittedEvent[],
  }
}

/** Approval executor for `media_plan.approve_revision`. */
export async function applyPlanRevision(
  tx: Tx,
  ctx: AgencyContext,
  payload: Record<string, unknown>,
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const p = payload as { jobId: string; jobRevision: number; planRevisionId: string; baseRevisionId: string | null; lines: ReturnType<typeof lineWire>[] }
  const j = await lockJob(tx, ctx.tenant.id, p.jobId)
  if (j.revision !== p.jobRevision) return { ok: false, code: "approval_stale", details: { jobRevision: j.revision, approvedRevision: p.jobRevision } }
  const plan = await approvedPlan(tx, ctx.tenant.id, j.id)
  const target = plan.revisions.find((r) => r.id === p.planRevisionId)
  if (!target || target.state !== "submitted" || (plan.revision?.id ?? null) !== p.baseRevisionId) {
    return { ok: false, code: "approval_stale", details: { planRevisionId: p.planRevisionId, state: target?.state ?? null } }
  }
  const { committed } = await committedByLineKey(tx, ctx.tenant.id, j.id)
  const below = p.lines.filter((l) => BigInt(l.amountMinor) < (committed.get(l.lineKey) ?? 0n)).map((l) => l.lineKey)
  if (below.length) return { ok: false, code: "below_commitment", details: { lines: below } }
  if (mode === "check") return { ok: true, events: [] }

  if (plan.revision) {
    await tx
      .update(mediaPlanRevision)
      .set({ state: "superseded", revision: sql`${mediaPlanRevision.revision} + 1`, updatedBy: ctx.user.id })
      .where(eq(mediaPlanRevision.id, plan.revision.id))
  }
  await tx
    .update(mediaPlanRevision)
    .set({ state: "approved", approvedBy: ctx.user.id, revision: sql`${mediaPlanRevision.revision} + 1`, updatedBy: ctx.user.id })
    .where(eq(mediaPlanRevision.id, target.id))
  const jobRevision = await bumpJobRevision(tx, ctx.tenant.id, j.id, ctx.user.id)
  const staled = await invalidatePendingApprovals(tx, ctx.tenant.id, "job", j.id, { actionTypes: PLAN_DEPENDENT_ACTIONS })
  return {
    ok: true,
    events: [
      {
        eventType: "media_plan.approved",
        aggregateType: "job",
        aggregateId: j.id,
        aggregateRevision: jobRevision,
        jobId: j.id,
        payload: {
          planRevisionId: target.id,
          number: target.number,
          supersededRevisionId: plan.revision?.id ?? null,
          totalMinor: target.totalMinor,
          staleApprovals: staled,
        },
      },
    ],
  }
}

function planOutputs(j: JobRow, lines: LineDraft[], revision: PlanRevisionRow, approval: { proposalId: string; approvalId: string; payloadDigest: string }) {
  const byChannel: Record<string, string> = {}
  for (const l of lines) byChannel[l.channel] = ((BigInt(byChannel[l.channel] ?? "0")) + l.amountMinor).toString()
  return {
    media_plan: {
      planRevisionId: revision.id,
      number: revision.number,
      state: revision.state,
      jobId: j.id,
      jobReference: j.displayReference,
      lines: lines.map(lineWire),
    },
    schedule_register: [...lines]
      .sort((a, b) => (a.startDate === b.startDate ? (a.lineKey < b.lineKey ? -1 : 1) : a.startDate < b.startDate ? -1 : 1))
      .map((l) => ({ lineKey: l.lineKey, channel: l.channel, placement: l.placement, startDate: l.startDate, endDate: l.endDate })),
    item_pricing: itemPricing(lines),
    plan_totals: { currency: j.currency, totalMinor: sumLines(lines).toString(), byChannel },
    approval_payload: { ...approval, eligibleRoles: PLAN_APPROVERS, policyId: PLAN_POLICY.id },
  }
}

// ── agency-media-planning: saveMediaPlanRevision ──
export const SaveMediaPlanInput = z
  .object({
    job: Uuid,
    channel: z.enum(["meta", "google", "tiktok", "ctv", "radio", "ooh"]),
    placement: z.string().trim().min(2).max(120),
    plannedAmount: Decimal,
    flightStart: IsoDate,
    flightEnd: IsoDate,
    audience: z.string().trim().min(2).max(160).optional(),
  })
  .strict()

export const saveMediaPlanRevision = defineCommand({
  type: "media.saveMediaPlanRevision",
  skillId: "agency-media-planning",
  permission: "media.plan",
  input: SaveMediaPlanInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertJobOpen(j)
    assertDates(input.flightStart, input.flightEnd)
    const amountMinor = parseMoney(input.plannedAmount, j.currency, "plannedAmount", { positive: true })
    const base = await approvedPlan(tx, ctx.tenant.id, j.id)
    const lines = base.lines.map(toDraft)
    const existing = lines.find((l) => l.channel === input.channel)
    const provider = CHANNEL_PROVIDER[input.channel]!
    if (existing) {
      Object.assign(existing, {
        placement: input.placement,
        amountMinor,
        startDate: input.flightStart,
        endDate: input.flightEnd,
        audience: input.audience ?? existing.audience,
        // Unit pricing no longer explains a changed amount: keep it only when it still multiplies out.
        ...(existing.quantity && existing.unitCostMinor !== null && existing.unitCostMinor * BigInt(existing.quantity) !== amountMinor
          ? { quantity: null, unitCostMinor: null }
          : {}),
      })
    } else {
      lines.push({
        lineKey: `line_${input.channel}`,
        channel: input.channel,
        placement: input.placement,
        provider,
        accountAlias: null,
        quantity: null,
        unitCostMinor: null,
        amountMinor,
        currency: j.currency,
        startDate: input.flightStart,
        endDate: input.flightEnd,
        audience: input.audience ?? null,
      })
    }
    const res = await proposePlanRevision(tx, ctx, meta, {
      job: j,
      base,
      lines,
      objective: base.revision?.objective ?? "Media plan",
      reason: `Plan line ${input.channel} saved`,
      reasonCategory: null,
      source: "plan_save",
      skillId: "agency-media-planning",
      impact: { audience: input.audience ?? null },
    })
    const outputs = planOutputs(j, lines, res.revision, {
      proposalId: res.proposal.id,
      approvalId: res.approval.id,
      payloadDigest: res.proposal.payloadDigest,
    })
    return {
      result: {
        planRevisionId: res.revision.id,
        number: res.revision.number,
        totalMinor: res.total.toString(),
        currency: j.currency,
        proposalId: res.proposal.id,
        approvalId: res.approval.id,
        payloadDigest: res.proposal.payloadDigest,
        ...outputs,
        objective_summary: {
          objective: res.revision.objective,
          audience: input.audience ?? null,
          note: "Planning targets are not guaranteed results.",
        },
        billing_release: {
          state: "pending_plan_approval",
          managedMediaMinor: res.total.toString(),
          currency: j.currency,
          basis: "pass_through_media_recovery",
        },
      },
      events: res.events,
    }
  },
})

// ── agency-plan-changes: proposePlanRevisionChange ──
const CHANNELS = ["meta", "google", "tiktok", "ctv", "radio", "ooh"] as const
export const PlanChangeInput = z
  .object({
    job: Uuid,
    baseRevision: z.number().int().min(1).max(99),
    channel: z.enum(CHANNELS),
    newAmount: Decimal,
    offsetChannel: z.enum(CHANNELS).optional(),
    reasonCategory: z.enum(["client_request", "market_change", "supplier_change", "correction"]),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict()

/** Builds the revised lines for a single-line change with an optional offset line. */
export function applyLineChange(lines: LineDraft[], channel: string, newAmountMinor: bigint, offsetChannel?: string) {
  const next = lines.map((l) => ({ ...l }))
  const target = next.find((l) => l.channel === channel)
  if (!target) blocked("plan_line_not_found", `The plan has no ${channel} line`, { channel })
  const delta = newAmountMinor - target.amountMinor
  target.amountMinor = newAmountMinor
  if (target.quantity && target.unitCostMinor !== null && target.unitCostMinor * BigInt(target.quantity) !== newAmountMinor) {
    target.quantity = null
    target.unitCostMinor = null
  }
  if (offsetChannel) {
    if (offsetChannel === channel) throw new DomainError("validation", "The offset line must differ from the changed line", { field: "offsetChannel" })
    const offset = next.find((l) => l.channel === offsetChannel)
    if (!offset) blocked("plan_line_not_found", `The plan has no ${offsetChannel} line`, { channel: offsetChannel })
    offset.amountMinor -= delta
    if (offset.amountMinor < 0n) throw new DomainError("validation", "The offset line cannot go below zero", { field: "offsetChannel" })
    if (offset.quantity && offset.unitCostMinor !== null && offset.unitCostMinor * BigInt(offset.quantity) !== offset.amountMinor) {
      offset.quantity = null
      offset.unitCostMinor = null
    }
  }
  return next
}

export const proposePlanRevisionChange = defineCommand({
  type: "media.proposePlanRevisionChange",
  skillId: "agency-plan-changes",
  permission: "media.plan",
  input: PlanChangeInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertJobOpen(j)
    const base = await approvedPlan(tx, ctx.tenant.id, j.id)
    if (!base.revision || base.revision.number !== input.baseRevision) {
      blocked("base_revision_not_current", "Only the current approved plan revision can be changed", {
        baseRevision: input.baseRevision,
        currentApprovedRevision: base.revision?.number ?? null,
      })
    }
    const newAmount = parseMoney(input.newAmount, j.currency, "newAmount")
    const lines = applyLineChange(base.lines.map(toDraft), input.channel, newAmount, input.offsetChannel)
    const res = await proposePlanRevision(tx, ctx, meta, {
      job: j,
      base,
      lines,
      objective: base.revision.objective,
      reason: input.reason,
      reasonCategory: input.reasonCategory,
      source: "plan_change",
      skillId: "agency-plan-changes",
    })
    const changed = new Set([...res.diff.changed, ...res.diff.added, ...res.diff.removed])
    const campaigns = await tx
      .select({ id: campaign.id, state: campaign.state, planLineId: campaign.planLineId })
      .from(campaign)
      .where(and(eq(campaign.tenantId, ctx.tenant.id), eq(campaign.jobId, j.id)))
    const baseLineKey = new Map(base.lines.map((l) => [l.id, l.lineKey]))
    const affectedCampaigns = campaigns.filter((c) => changed.has(baseLineKey.get(c.planLineId) ?? "") && c.state === "active_simulated")
    const ordersOnChanged = res.orders.filter((o) => changed.has(o.lineKey))
    const view = (ls: LineDraft[]) => ls.map(lineWire)
    return {
      result: {
        planRevisionId: res.revision.id,
        number: res.revision.number,
        proposalId: res.proposal.id,
        approvalId: res.approval.id,
        payloadDigest: res.proposal.payloadDigest,
        baseline_revision: { planRevisionId: base.revision.id, number: base.revision.number, state: base.revision.state, totalMinor: base.revision.totalMinor.toString(), lines: view(res.before) },
        proposed_revision: { planRevisionId: res.revision.id, number: res.revision.number, state: res.revision.state, totalMinor: res.total.toString(), lines: view(lines) },
        line_diff: {
          added: res.diff.added,
          removed: res.diff.removed,
          changed: res.diff.changed,
          unchanged: res.diff.unchanged,
          lines: [...changed].map((k) => ({
            lineKey: k,
            beforeMinor: res.before.find((l) => l.lineKey === k)?.amountMinor.toString() ?? null,
            afterMinor: lines.find((l) => l.lineKey === k)?.amountMinor.toString() ?? null,
          })),
        },
        lock_report: lines.map((l) => ({
          lineKey: l.lineKey,
          committedMinor: (res.committed.get(l.lineKey) ?? 0n).toString(),
          amountMinor: l.amountMinor.toString(),
          locked: (res.committed.get(l.lineKey) ?? 0n) > 0n,
        })),
        currency_deltas: res.diff.currencyDeltas.map((d) => ({ currency: d.currency, beforeMinor: d.beforeMinor.toString(), afterMinor: d.afterMinor.toString(), deltaMinor: d.deltaMinor.toString() })),
        order_version_actions: ordersOnChanged.length
          ? ordersOnChanged.map((o) => ({ orderId: o.orderId, reference: o.reference, lineKey: o.lineKey, action: "review_order_version_after_approval" }))
          : none("No issued media orders on the changed lines."),
        approval_pack: {
          proposalId: res.proposal.id,
          approvalId: res.approval.id,
          payloadDigest: res.proposal.payloadDigest,
          eligibleRoles: PLAN_APPROVERS,
          priorApproval: `r${base.revision.number} stays approved until r${res.revision.number} is approved; it is not valid for the changed lines.`,
          stalePlanApprovals: res.staled,
        },
        verified_receipts: ordersOnChanged.filter((o) => o.receiptId).length
          ? ordersOnChanged.filter((o) => o.receiptId).map((o) => ({ orderId: o.orderId, receiptId: o.receiptId, simulation: true }))
          : none("No simulated receipts exist for the changed lines."),
        blocked_actions: affectedCampaigns.length
          ? affectedCampaigns.map((c) => ({ campaignId: c.id, action: "campaign_budget_change", requires: "new_activation_approval" }))
          : none("No active simulated campaigns depend on the changed lines."),
      },
      events: res.events,
    }
  },
})

// ── agency-media-ranking: rankMediaOptions (query) ──
export const RankMediaInput = z
  .object({
    job: Uuid,
    objective: z.enum(["awareness", "reach", "conversions"]),
    market: z.enum(["US", "CA", "MX", "CO"]),
    targetAudience: z.string().trim().min(2).max(160),
    flightStart: IsoDate,
    flightEnd: IsoDate,
    reachWeightBps: z.number().int().min(0).max(10000),
    audienceSource: Uuid.optional(),
  })
  .strict()

const FRESHNESS_DAYS = 120

export function audienceBaseOf(target: string) {
  const m = /(\d{2})\s*[-–]\s*(\d{2})/.exec(target)
  return m ? `persons_${m[1]}_${m[2]}` : "persons_all"
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export async function rankMediaOptions(ctx: AgencyContext, input: z.infer<typeof RankMediaInput>) {
  assertDates(input.flightStart, input.flightEnd)
  return withTenant(ctx.tenant.id, async (tx) => {
    const [j] = await tx.select().from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, input.job))).limit(1)
    if (!j) throw new DomainError("not_found", "Job not found")
    let sources = await tx
      .select()
      .from(audienceSource)
      .where(and(eq(audienceSource.tenantId, ctx.tenant.id), eq(audienceSource.geography, input.market)))
    let file: typeof fileObject.$inferSelect | null = null
    if (input.audienceSource) {
      ;[file] = await tx
        .select()
        .from(fileObject)
        .where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.id, input.audienceSource)))
        .limit(1)
      if (!file) throw new DomainError("not_found", "Audience source file not found", { field: "audienceSource" })
      sources = sources.filter((s) => s.fileId === file!.id)
      if (!sources.length) blocked("audience_source_not_registered", "The file is not a registered synthetic audience source", { fileId: file.id })
    }
    sources.sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0))
    const base = audienceBaseOf(input.targetAudience)
    const exceptions: { sourceKey: string; version: string; reasons: string[] }[] = []
    const usable = sources.filter((s) => {
      const reasons: string[] = []
      if (s.licenseStatus !== "licensed_demo") reasons.push(`license_${s.licenseStatus}`)
      if (daysBetween(s.asOf, input.flightStart) > FRESHNESS_DAYS) reasons.push("stale_source")
      if (s.audienceBase !== base) reasons.push("incomparable_audience_base")
      if (reasons.length) exceptions.push({ sourceKey: s.sourceKey, version: s.version, reasons })
      return reasons.length === 0
    })
    if (!usable.length) {
      blocked("no_comparable_sources", "No licensed, fresh and comparable synthetic audience source for this market", {
        market: input.market,
        audienceBase: base,
        exceptions,
      })
    }
    const estimates = await tx
      .select()
      .from(audienceEstimate)
      .where(and(eq(audienceEstimate.tenantId, ctx.tenant.id), inArray(audienceEstimate.sourceId, usable.map((s) => s.id))))
    const cards = await tx.select().from(rateCard).where(and(eq(rateCard.tenantId, ctx.tenant.id), eq(rateCard.state, "approved")))
    const rows = estimates
      .filter((e) => e.currency === j.currency)
      .map((e) => {
        const ratings = e.spotRatings as { spotId: string; ratingHundredths: number }[]
        const m = audienceMetrics({ currency: e.currency, netCostMinor: e.netCostMinor, universe: e.universe, spots: ratings, reachHundredths: e.reachHundredths })
        return { e, m, source: usable.find((s) => s.id === e.sourceId)! }
      })
    const maxReach = rows.reduce((mx, r) => Math.max(mx, r.e.reachHundredths ?? 0), 0)
    const minCpm = rows.reduce<bigint | null>((mn, r) => (r.m.cpmMinor === null ? mn : mn === null || r.m.cpmMinor < mn ? r.m.cpmMinor : mn), null)
    const w = BigInt(input.reachWeightBps)
    const scored = rows.map((r) => {
      const reachBps = maxReach ? BigInt(Math.round(((r.e.reachHundredths ?? 0) * 10000) / maxReach)) : 0n
      const costBps = r.m.cpmMinor && minCpm ? (minCpm * 10000n + r.m.cpmMinor / 2n) / r.m.cpmMinor : 0n
      const score = (w * reachBps + (10000n - w) * costBps + 5000n) / 10000n
      return { ...r, reachBps, costBps, score }
    })
    scored.sort((a, b) => (a.score === b.score ? (a.e.vehicleKey < b.e.vehicleKey ? -1 : 1) : a.score > b.score ? -1 : 1))
    const manifest = usable.map((s) => ({
      sourceKey: s.sourceKey,
      version: s.version,
      asOf: s.asOf,
      geography: s.geography,
      channel: s.channel,
      methodology: s.methodology,
      licenseStatus: s.licenseStatus,
      audienceBase: s.audienceBase,
      audienceLabel: s.audienceLabel,
      synthetic: s.synthetic,
    }))
    const spec = {
      objective: input.objective,
      market: input.market,
      audienceBase: base,
      flightStart: input.flightStart,
      flightEnd: input.flightEnd,
      reachWeightBps: input.reachWeightBps,
      costWeightBps: 10000 - input.reachWeightBps,
      formula: "score_bps = HALF_UP((reach_weight × reach_index + cost_weight × cpm_index) / 10000); reach_index = reach / max_reach; cpm_index = min_cpm / cpm",
      freshnessDays: FRESHNESS_DAYS,
      dedupNote: "Reach is not deduplicated across vehicles; impressions are additive under one cut, unique people are not.",
    }
    const candidates = scored.map((r, i) => ({
      rank: i + 1,
      vehicleKey: r.e.vehicleKey,
      vehicleLabel: r.e.vehicleLabel,
      channel: r.e.channel,
      sourceKey: r.source.sourceKey,
      sourceVersion: r.source.version,
      scoreBps: Number(r.score),
      reachHundredths: r.e.reachHundredths,
      trpHundredths: r.m.trpHundredths,
      impressions: r.m.impressions.toString(),
      cpmMinor: r.m.cpmMinor?.toString() ?? null,
      cprMinor: r.m.cprMinor?.toString() ?? null,
      frequencyHundredths: r.m.frequencyHundredths,
      netCostMinor: r.e.netCostMinor.toString(),
      currency: r.e.currency,
      synthetic: true,
    }))
    const inheritance = scored
      .map((r) => ({ r, card: cards.find((c) => c.supplierId === r.e.supplierId && c.validFrom <= input.flightStart && c.validTo >= input.flightEnd) }))
      .filter((x) => x.card)
    return {
      asOf: await getBusinessDate(),
      basis: "synthetic_audience_sources",
      currency: j.currency,
      simulation: true,
      manifestDigest: digestOf({ spec, manifest, candidates }),
      rating_book_manifest: manifest,
      ranking_spec: spec,
      candidate_table: candidates,
      data_quality_exceptions: exceptions.length ? exceptions : none("All market sources are licensed, fresh and comparable."),
      commercial_inheritance: inheritance.length
        ? inheritance.map(({ r, card }) => ({ vehicleKey: r.e.vehicleKey, rateCardId: card!.id, rateCardNumber: card!.number, netRateMinor: card!.netRateMinor.toString() }))
        : none("No approved rate card covers the ranked vehicles for this flight."),
      planning_handoff: candidates.slice(0, 3).map((c) => ({ vehicleKey: c.vehicleKey, channel: c.channel, suggestedNetCostMinor: c.netCostMinor, sourceKey: c.sourceKey })),
    }
  })
}

// ── agency-digital-planning: validateDigitalPlan (query, preflight) ──
export const DigitalPlanInput = z
  .object({
    job: Uuid,
    connection: Uuid,
    objective: z.enum(["awareness", "traffic", "conversions"]),
    budget: Decimal,
    placement: z.string().trim().min(2).max(120),
    conversionEvent: z.string().trim().regex(/^[a-z0-9_]{2,80}$/).optional(),
    creativeFile: Uuid.optional(),
  })
  .strict()

type Extraction = { fields?: { width?: number; height?: number; durationSeconds?: number } }

export function creativeSpecCheck(file: typeof fileObject.$inferSelect, spec: typeof placementSpec.$inferSelect) {
  const ex = ((file.extraction ?? {}) as Extraction).fields ?? {}
  const findings: string[] = []
  if (!spec.allowedFormats.includes(file.format)) findings.push("format_not_allowed")
  if (file.sizeBytes > spec.maxSizeBytes) findings.push("file_too_large")
  if (ex.width === undefined || ex.height === undefined) findings.push("dimensions_unknown")
  else {
    const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
    const d = g(ex.width, ex.height)
    if (!spec.aspectRatios.includes(`${ex.width / d}:${ex.height / d}`)) findings.push("aspect_ratio_not_allowed")
    if (ex.width < spec.minWidth) findings.push("width_below_minimum")
  }
  if (spec.maxDurationSeconds !== null && (ex.durationSeconds ?? 0) > spec.maxDurationSeconds) findings.push("duration_above_maximum")
  return {
    fileId: file.id,
    specVersion: spec.version,
    specSource: spec.source,
    extraction: file.extractionStatus === "prepared_demo_extraction" ? "Prepared demo extraction" : file.extractionStatus,
    measured: ex,
    findings,
    passed: findings.length === 0,
  }
}

export function taxonomyName(j: JobRow, provider: string, placement: string, objective: string) {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "")
  return [j.jobNumber, clean(provider.replace(/_ads$|_demo$/, "")), clean(placement), clean(objective)].join("_")
}

export async function validateDigitalPlan(ctx: AgencyContext, input: z.infer<typeof DigitalPlanInput>) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const [j] = await tx.select().from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, input.job))).limit(1)
    if (!j) throw new DomainError("not_found", "Job not found")
    const budgetMinor = parseMoney(input.budget, j.currency, "budget", { positive: true })
    const [c] = await tx.select().from(connection).where(and(eq(connection.tenantId, ctx.tenant.id), eq(connection.id, input.connection))).limit(1)
    if (!c) throw new DomainError("not_found", "Connection not found", { field: "connection" })
    const plan = await approvedPlan(tx, ctx.tenant.id, j.id)
    const line = plan.lines.find((l) => l.provider === c.provider && l.accountAlias === c.accountAlias)
    if (!line) {
      blocked("account_unmapped", "The ad account is not mapped to a line of the job's approved plan", {
        provider: c.provider,
        accountAlias: c.accountAlias,
        mappedAccounts: plan.lines.filter((l) => l.accountAlias).map((l) => ({ lineKey: l.lineKey, provider: l.provider, accountAlias: l.accountAlias })),
      })
    }
    const specs = await tx
      .select()
      .from(placementSpec)
      .where(and(eq(placementSpec.tenantId, ctx.tenant.id), eq(placementSpec.provider, c.provider), eq(placementSpec.placement, input.placement)))
      .orderBy(desc(placementSpec.version))
    const spec = specs[0]
    if (!spec) blocked("invalid_placement_spec", "No synthetic ad spec exists for this placement on the provider", { provider: c.provider, placement: input.placement })
    if (input.objective === "conversions" && !input.conversionEvent) {
      throw new DomainError("validation", "A conversion objective needs a conversion event", { field: "conversionEvent" })
    }
    let creative: ReturnType<typeof creativeSpecCheck> | null = null
    if (input.creativeFile) {
      const [f] = await tx.select().from(fileObject).where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.id, input.creativeFile))).limit(1)
      if (!f) throw new DomainError("not_found", "Creative file not found", { field: "creativeFile" })
      creative = creativeSpecCheck(f, spec)
      if (!creative.passed) blocked("invalid_placement_spec", "The creative does not meet the placement spec", { creative })
    }
    const conn = connectionCheck(c)
    const [cl] = await tx.select().from(client).where(and(eq(client.tenantId, ctx.tenant.id), eq(client.id, j.clientId))).limit(1)
    const digitalLines = plan.lines.filter((l) => DIGITAL_PROVIDERS.has(l.provider))
    const taxonomy = taxonomyName(j, c.provider, input.placement, input.objective)
    return {
      asOf: await getBusinessDate(),
      basis: "approved_plan",
      currency: j.currency,
      simulation: true,
      preflight: {
        accountMapped: true,
        connection: conn,
        placementSpec: { provider: spec.provider, placement: spec.placement, version: spec.version, source: spec.source, synthetic: spec.synthetic },
        creative: creative ?? { passed: null, reason: "No creative file supplied; checked at activation." },
        budgetWithinLine: budgetMinor <= line.amountMinor,
        note: "Preflight validates compatibility; objectives are planning targets, not guaranteed results.",
      },
      digital_plan: {
        planRevisionNumber: plan.revision?.number ?? null,
        client: cl?.name ?? null,
        lines: digitalLines.map((l) => ({ lineKey: l.lineKey, planLineId: l.id, channel: l.channel, placement: l.placement, provider: l.provider, accountAlias: l.accountAlias, simulatedAccount: true, amountMinor: l.amountMinor.toString() })),
      },
      taxonomy_strings: [{ lineKey: line.lineKey, name: taxonomy, conversionEvent: input.conversionEvent ?? null }],
      adserver_costs: none("The demo profile has no third-party ad-serving fees."),
      actuals_snapshot: none("No synthetic delivery metrics are linked to this line yet."),
      invoice_match_register: none("No provider invoices exist at the planning stage."),
      order_adjustment_proposal:
        budgetMinor === line.amountMinor
          ? none("The budget equals the approved line amount.")
          : [{ lineKey: line.lineKey, approvedMinor: line.amountMinor.toString(), requestedMinor: budgetMinor.toString(), action: budgetMinor > line.amountMinor ? "plan_change_required" : "within_line" }],
    }
  })
}
