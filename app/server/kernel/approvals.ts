import "server-only"

import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"

import { GOVERNANCE } from "@/lib/capabilities/governance"
import type { Permission, Role } from "@/lib/policy"
import type { AgencyContext } from "@/server/auth/context"
import { payloadDigest } from "@/server/calculators"
import type { Tx } from "@/server/db/client"
import { getDemoClock } from "@/server/domain/presenter"
import {
  actionProposal,
  agency,
  approvalDecision,
  approvalRequest,
  client,
  configurationRevision,
  contract,
  job,
  memberAccess,
  rateCard,
  supplier,
  timesheet,
} from "@/server/db/schema"

import { toJsonSafe, type CommandOrigin, type EmittedEvent } from "./commands"
import { DomainError } from "./errors"

// Approvals bind an exact payload digest + aggregate revision + policy
// revision. A digest proves equality, never authority: eligibility and
// separation of duties are checked here, on the server, for every decision.

type RevisionResolver = (tx: Tx, tenantId: string, id: string) => Promise<number | null>

type Revisioned = typeof job | typeof contract | typeof client | typeof supplier | typeof memberAccess | typeof rateCard | typeof timesheet

const byRevision = (table: Revisioned): RevisionResolver =>
  async (tx, tenantId, id) => {
    const rows = await tx
      .select({ revision: table.revision })
      .from(table)
      .where(and(eq(table.tenantId, tenantId), eq(table.id, id)))
      .limit(1)
    return rows[0]?.revision ?? null
  }

/** Current revision of an aggregate, used to detect stale approvals. */
const AGGREGATE_REVISION: Record<string, RevisionResolver> = {
  job: byRevision(job),
  contract: byRevision(contract),
  client: byRevision(client),
  supplier: byRevision(supplier),
  member_access: byRevision(memberAccess),
  // Core-2 approvals (rate card versions, submitted hours).
  rate_card: byRevision(rateCard),
  timesheet: byRevision(timesheet),
}

/**
 * Lets other modules declare how to read the revision of an aggregate their
 * approvals bind to (e.g. purchase_order, client_invoice). Idempotent per type.
 */
export function registerAggregateRevision(aggregateType: string, resolver: RevisionResolver) {
  const existing = AGGREGATE_REVISION[aggregateType]
  if (existing && existing !== resolver) throw new Error(`Aggregate revision resolver for ${aggregateType} already registered`)
  AGGREGATE_REVISION[aggregateType] = resolver
}

export async function currentAggregateRevision(
  tx: Tx,
  tenantId: string,
  aggregateType: string,
  aggregateId: string
): Promise<number | null> {
  const resolver = AGGREGATE_REVISION[aggregateType]
  if (!resolver) throw new Error(`No revision resolver for ${aggregateType}`)
  return resolver(tx, tenantId, aggregateId)
}

// Code-defined approval policies: current revision (an approval requested
// under another revision is stale at execution time), the permission needed to
// decide (default approvals.decide; e.g. time.approve for hours) and, when the
// policy needs it, extra people who may never decide (e.g. the worker whose
// hours are approved) on top of the requester and the proposal creator.
type ApprovalPolicyDef = {
  id: string
  revision: number
  decidePermission?: Permission
  excludedDeciders?: (tx: Tx, tenantId: string, approval: typeof approvalRequest.$inferSelect) => Promise<(string | null)[]>
}

const POLICIES = new Map<string, ApprovalPolicyDef>()

export function registerApprovalPolicy<P extends ApprovalPolicyDef>(policy: P): P {
  const existing = POLICIES.get(policy.id)
  if (existing && existing.revision !== policy.revision) {
    throw new Error(`Approval policy ${policy.id} registered with revisions ${existing.revision} and ${policy.revision}`)
  }
  POLICIES.set(policy.id, policy)
  return policy
}

/** Permission an actor needs to decide approvals of this policy. */
export function decidePermissionOf(policyId: string): Permission {
  return POLICIES.get(policyId)?.decidePermission ?? "approvals.decide"
}

/** Users who may never decide this approval (requester, creator, policy extras). */
export async function excludedDecidersOf(
  tx: Tx,
  tenantId: string,
  approval: typeof approvalRequest.$inferSelect,
  proposalCreatedBy: string | null
): Promise<Set<string>> {
  const extra = (await POLICIES.get(approval.policyId)?.excludedDeciders?.(tx, tenantId, approval)) ?? []
  return new Set([approval.requestedBy, proposalCreatedBy, ...extra].filter((x): x is string => !!x))
}

/**
 * "Now" for approval validity on the demo business clock: real time shifted
 * by the days the presenter advanced the business date, so an approval also
 * expires when the demo clock moves past it.
 */
export async function approvalNow(): Promise<Date> {
  const clock = await getDemoClock()
  return new Date(Date.now() + clock.advancedDays * 86_400_000)
}

/** Digest of the agency's published approval policy (configuration). */
export async function approvalPolicySnapshot(tx: Tx, tenantId: string): Promise<string> {
  const [a] = await tx.select({ cfg: agency.publishedConfigRevisionId }).from(agency).where(eq(agency.id, tenantId)).limit(1)
  let policy: unknown = null
  if (a?.cfg) {
    const [c] = await tx
      .select({ approvalPolicy: configurationRevision.approvalPolicy })
      .from(configurationRevision)
      .where(and(eq(configurationRevision.tenantId, tenantId), eq(configurationRevision.id, a.cfg)))
      .limit(1)
    policy = c?.approvalPolicy ?? null
  }
  return digestOf({ approvalPolicy: policy })
}

export type ProposalInput = {
  actionType: string
  skillId: string | null
  aggregateType: string
  aggregateId: string
  baseRevision: number
  payload: Record<string, unknown>
  diff: Record<string, unknown>
  impact: Record<string, unknown>
  origin: CommandOrigin
  conversationId?: string | null
  runId?: string | null
}

export type ApprovalSpec = {
  policyId: string
  policyRevision: number
  eligibleRoles: readonly Role[]
  title: string
  amountMinor?: bigint | null
  currency?: string | null
  destination?: string | null
  expiresInHours?: number
}

export function digestOf(payload: unknown): string {
  return payloadDigest(toJsonSafe(payload)).sha256
}

export async function createProposal(
  tx: Tx,
  ctx: AgencyContext,
  input: ProposalInput,
  state: "draft" | "awaiting_confirmation" | "awaiting_approval"
) {
  const digest = digestOf(input.payload)
  const [row] = await tx
    .insert(actionProposal)
    .values({
      tenantId: ctx.tenant.id,
      actionType: input.actionType,
      skillId: input.skillId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      baseRevision: input.baseRevision,
      payload: toJsonSafe(input.payload) as object,
      payloadDigest: digest,
      diff: toJsonSafe(input.diff) as object,
      impact: toJsonSafe(input.impact) as object,
      state,
      origin: input.origin,
      conversationId: input.conversationId ?? null,
      runId: input.runId ?? null,
      createdBy: ctx.user.id,
    })
    .returning()
  return row!
}

export async function requestApproval(
  tx: Tx,
  ctx: AgencyContext,
  proposal: typeof actionProposal.$inferSelect,
  spec: ApprovalSpec
): Promise<{ approval: typeof approvalRequest.$inferSelect; events: EmittedEvent[] }> {
  const registered = POLICIES.get(spec.policyId)?.revision
  if (registered !== undefined && registered !== spec.policyRevision) {
    throw new Error(`Approval requested under ${spec.policyId} r${spec.policyRevision}; current is r${registered}`)
  }
  const policySnapshotDigest = await approvalPolicySnapshot(tx, ctx.tenant.id)
  const now = await approvalNow()
  const [approval] = await tx
    .insert(approvalRequest)
    .values({
      tenantId: ctx.tenant.id,
      proposalId: proposal.id,
      actionType: proposal.actionType,
      aggregateType: proposal.aggregateType,
      aggregateId: proposal.aggregateId!,
      aggregateRevision: proposal.baseRevision!,
      payloadDigest: proposal.payloadDigest,
      amountMinor: spec.amountMinor ?? null,
      currency: spec.currency ?? null,
      destination: spec.destination ?? null,
      policyId: spec.policyId,
      policyRevision: spec.policyRevision,
      policySnapshotDigest,
      eligibleRoles: [...spec.eligibleRoles],
      requestedBy: ctx.user.id,
      title: spec.title,
      expiresAt: spec.expiresInHours
        ? new Date(now.getTime() + spec.expiresInHours * 3600 * 1000)
        : null,
    })
    .returning()
  await tx
    .update(actionProposal)
    .set({ state: "awaiting_approval", updatedAt: new Date(), revision: sql`${actionProposal.revision} + 1` })
    .where(eq(actionProposal.id, proposal.id))
  return {
    approval: approval!,
    events: [
      {
        eventType: "approval.requested",
        aggregateType: proposal.aggregateType,
        aggregateId: proposal.aggregateId,
        aggregateRevision: proposal.baseRevision,
        payload: {
          approvalId: approval!.id,
          proposalId: proposal.id,
          actionType: proposal.actionType,
          payloadDigest: proposal.payloadDigest,
          eligibleRoles: spec.eligibleRoles,
        },
      },
    ],
  }
}

export type DecisionInput = {
  approvalId: string
  decision: "approve" | "reject" | "request_changes"
  reason?: string | null
  /** Digest shown to the approver; the click binds exactly this payload. */
  reviewedDigest: string
}

export async function decideApproval(tx: Tx, ctx: AgencyContext, input: DecisionInput) {
  const rows = await tx
    .select()
    .from(approvalRequest)
    .where(and(eq(approvalRequest.tenantId, ctx.tenant.id), eq(approvalRequest.id, input.approvalId)))
    .for("update")
    .limit(1)
  const approval = rows[0]
  if (!approval) throw new DomainError("not_found", "Approval not found")
  // The policy names the permission to decide (approvals.decide unless the
  // policy says otherwise, e.g. time.approve); the role must also be eligible.
  const permission = decidePermissionOf(approval.policyId)
  if (!ctx.permissions.has(permission)) {
    throw new DomainError("forbidden", `Role ${ctx.role} cannot decide this approval`, { permission })
  }
  if (!approval.eligibleRoles.includes(ctx.role)) {
    throw new DomainError("approver_not_eligible", "Your role cannot decide this approval", {
      eligibleRoles: approval.eligibleRoles,
      role: ctx.role,
    })
  }
  if (approval.state !== "awaiting_approval") {
    throw new DomainError("blocked_by_rule", "Approval is no longer pending", {
      state: approval.state,
    })
  }
  const [proposal] = await tx
    .select()
    .from(actionProposal)
    .where(and(eq(actionProposal.tenantId, ctx.tenant.id), eq(actionProposal.id, approval.proposalId)))
    .limit(1)
  if (!proposal) throw new DomainError("not_found", "Proposal not found")
  if ((await excludedDecidersOf(tx, ctx.tenant.id, approval, proposal.createdBy)).has(ctx.user.id)) {
    throw new DomainError("self_approval", "The requester cannot approve their own change")
  }

  const events: EmittedEvent[] = []
  // Freshness: target revision unchanged, payload digest unchanged, and the
  // approver reviewed this exact digest.
  const current = await currentAggregateRevision(
    tx,
    ctx.tenant.id,
    approval.aggregateType,
    approval.aggregateId
  )
  const recomputed = digestOf(proposal.payload)
  const registeredPolicy = POLICIES.get(approval.policyId)?.revision
  const stale =
    current !== approval.aggregateRevision ||
    recomputed !== approval.payloadDigest ||
    input.reviewedDigest !== approval.payloadDigest ||
    (approval.expiresAt !== null && approval.expiresAt.getTime() < (await approvalNow()).getTime()) ||
    (registeredPolicy !== undefined && registeredPolicy !== approval.policyRevision) ||
    approval.policySnapshotDigest !== (await approvalPolicySnapshot(tx, ctx.tenant.id))
  if (stale) {
    await tx
      .update(approvalRequest)
      .set({ state: "stale", revision: sql`${approvalRequest.revision} + 1` })
      .where(eq(approvalRequest.id, approval.id))
    await tx
      .update(actionProposal)
      .set({ state: "stale", updatedAt: new Date() })
      .where(eq(actionProposal.id, proposal.id))
    // Returned (not thrown) so the stale mark commits with this transaction.
    return { outcome: "stale" as const, approval, proposal, events }
  }

  const nextState =
    input.decision === "approve"
      ? "approved"
      : input.decision === "reject"
        ? "rejected"
        : "changes_requested"
  if (input.decision !== "approve" && !input.reason?.trim()) {
    throw new DomainError("validation", "A reason is required", { field: "reason" })
  }
  await tx.insert(approvalDecision).values({
    tenantId: ctx.tenant.id,
    approvalId: approval.id,
    decision: input.decision,
    actorUserId: ctx.user.id,
    reason: input.reason ?? null,
    payloadDigest: approval.payloadDigest,
  })
  const [updated] = await tx
    .update(approvalRequest)
    .set({
      state: nextState,
      decidedBy: ctx.user.id,
      decidedAt: new Date(),
      decisionReason: input.reason ?? null,
      revision: sql`${approvalRequest.revision} + 1`,
    })
    .where(eq(approvalRequest.id, approval.id))
    .returning()
  await tx
    .update(actionProposal)
    .set({
      state: nextState === "approved" ? "approved" : nextState === "rejected" ? "rejected" : "draft",
      updatedAt: new Date(),
    })
    .where(eq(actionProposal.id, proposal.id))
  events.push({
    eventType: `approval.${nextState}`,
    aggregateType: approval.aggregateType,
    aggregateId: approval.aggregateId,
    aggregateRevision: approval.aggregateRevision,
    payload: {
      approvalId: approval.id,
      proposalId: proposal.id,
      payloadDigest: approval.payloadDigest,
      reason: input.reason ?? null,
    },
  })
  return { outcome: nextState, approval: updated!, proposal, events }
}

export type ExecutionGate =
  | { ok: true }
  | {
      ok: false
      code: "approval_required" | "approval_expired" | "approval_stale" | "capability_disabled" | "forbidden"
      details: Record<string, unknown>
    }

/**
 * The one gate an approved action passes immediately before it is consumed
 * (B07): still approved, not expired, capability enabled for the agency now,
 * actor permission now, same approval policy (code revision + the agency's
 * published policy), same aggregate revision and same payload digest.
 * Expiry and staleness are terminal: they need a new proposal and approval.
 */
export async function checkApprovalExecutable(
  tx: Tx,
  ctx: AgencyContext,
  approval: typeof approvalRequest.$inferSelect,
  proposal: typeof actionProposal.$inferSelect,
  opts: { skillId: string | null; permission: Permission | null }
): Promise<ExecutionGate> {
  if (approval.state !== "approved") {
    return { ok: false, code: "approval_required", details: { state: approval.state } }
  }
  if (approval.expiresAt !== null && approval.expiresAt.getTime() <= (await approvalNow()).getTime()) {
    return { ok: false, code: "approval_expired", details: { expiresAt: approval.expiresAt.toISOString() } }
  }
  if (opts.skillId && !GOVERNANCE[opts.skillId]?.mandatory && !ctx.enabledCapabilities.has(opts.skillId)) {
    return { ok: false, code: "capability_disabled", details: { skillId: opts.skillId } }
  }
  if (opts.permission && !ctx.permissions.has(opts.permission)) {
    return { ok: false, code: "forbidden", details: { permission: opts.permission } }
  }
  const registered = POLICIES.get(approval.policyId)?.revision
  if (registered !== undefined && registered !== approval.policyRevision) {
    return { ok: false, code: "approval_stale", details: { reason: "policy_revision_changed", policyId: approval.policyId } }
  }
  if (approval.policySnapshotDigest !== (await approvalPolicySnapshot(tx, ctx.tenant.id))) {
    return { ok: false, code: "approval_stale", details: { reason: "approval_policy_changed", policyId: approval.policyId } }
  }
  const current = await currentAggregateRevision(tx, ctx.tenant.id, approval.aggregateType, approval.aggregateId)
  if (current !== approval.aggregateRevision) {
    return {
      ok: false,
      code: "approval_stale",
      details: { reason: "aggregate_revision_changed", approvedRevision: approval.aggregateRevision, currentRevision: current },
    }
  }
  if (digestOf(proposal.payload) !== approval.payloadDigest) {
    return { ok: false, code: "approval_stale", details: { reason: "payload_changed" } }
  }
  return { ok: true }
}

/** Terminal invalidation of an approval and its proposal (expired | stale). */
export async function invalidateApproval(
  tx: Tx,
  tenantId: string,
  approval: typeof approvalRequest.$inferSelect,
  state: "expired" | "stale"
) {
  await tx
    .update(approvalRequest)
    .set({ state, revision: sql`${approvalRequest.revision} + 1` })
    .where(and(eq(approvalRequest.tenantId, tenantId), eq(approvalRequest.id, approval.id)))
  await tx
    .update(actionProposal)
    .set({ state, updatedAt: new Date() })
    .where(and(eq(actionProposal.tenantId, tenantId), eq(actionProposal.id, approval.proposalId)))
}

/** Single-use consumption of an approved request before executing its action. */
export async function consumeApproval(tx: Tx, tenantId: string, approvalId: string, digest: string) {
  const now = await approvalNow()
  const [row] = await tx
    .update(approvalRequest)
    .set({ state: "consumed", consumedAt: new Date(), revision: sql`${approvalRequest.revision} + 1` })
    .where(
      and(
        eq(approvalRequest.tenantId, tenantId),
        eq(approvalRequest.id, approvalId),
        eq(approvalRequest.state, "approved"),
        eq(approvalRequest.payloadDigest, digest),
        or(isNull(approvalRequest.expiresAt), gt(approvalRequest.expiresAt, now))
      )
    )
    .returning()
  if (!row) throw new DomainError("approval_required", "No valid approval for this exact payload")
  return row
}

/**
 * Marks pending approvals of an aggregate stale after a material change.
 * `actionTypes` limits it to those actions (e.g. only plan approvals of a job).
 */
export async function invalidatePendingApprovals(
  tx: Tx,
  tenantId: string,
  aggregateType: string,
  aggregateId: string,
  opts: { actionTypes?: readonly string[] } = {}
): Promise<number> {
  const rows = await tx
    .update(approvalRequest)
    .set({ state: "stale", revision: sql`${approvalRequest.revision} + 1` })
    .where(
      and(
        eq(approvalRequest.tenantId, tenantId),
        eq(approvalRequest.aggregateType, aggregateType),
        eq(approvalRequest.aggregateId, aggregateId),
        eq(approvalRequest.state, "awaiting_approval"),
        opts.actionTypes?.length ? inArray(approvalRequest.actionType, [...opts.actionTypes]) : undefined
      )
    )
    .returning({ id: approvalRequest.id, proposalId: approvalRequest.proposalId })
  for (const r of rows) {
    await tx
      .update(actionProposal)
      .set({ state: "stale", updatedAt: new Date() })
      .where(and(eq(actionProposal.tenantId, tenantId), eq(actionProposal.id, r.proposalId)))
  }
  return rows.length
}
