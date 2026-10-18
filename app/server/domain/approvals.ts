import "server-only"

import { and, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import {
  actionProposal,
  appUser,
  approvalDecision,
  approvalRequest,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import {
  checkApprovalExecutable,
  consumeApproval,
  currentAggregateRevision,
  decideApproval,
  decidePermissionOf,
  excludedDecidersOf,
  invalidateApproval,
} from "@/server/kernel/approvals"
import { defineCommand, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { EXECUTORS } from "@/server/capabilities/registry"

// Executors (registered per module in server/capabilities/handlers/*) apply an
// approved proposal through the owning domain function. `check` evaluates
// preconditions without side effects; `apply` mutates. Both the decision path
// (approver applies right away) and the deferred path (executeApproved) pass
// the same kernel gate immediately before consuming the approval (B07).

async function executeApproved(
  tx: Tx,
  ctx: AgencyContext,
  approval: typeof approvalRequest.$inferSelect,
  proposal: typeof actionProposal.$inferSelect,
  path: "decision" | "deferred"
) {
  const executor = EXECUTORS[approval.actionType]
  if (!executor) return { executed: false, code: "no_executor" as string, details: {} as Record<string, unknown>, events: [] as EmittedEvent[] }
  // On the decision path the eligible approver applies; deferred execution
  // needs the executor permission of the current actor.
  const gate = await checkApprovalExecutable(tx, ctx, approval, proposal, {
    skillId: executor.skillId ?? proposal.skillId,
    permission: path === "deferred" ? executor.permission : null,
  })
  if (!gate.ok) {
    if (gate.code === "approval_expired") await invalidateApproval(tx, ctx.tenant.id, approval, "expired")
    if (gate.code === "approval_stale") await invalidateApproval(tx, ctx.tenant.id, approval, "stale")
    return { executed: false, code: gate.code as string, details: gate.details, events: [] }
  }
  const payload = proposal.payload as Record<string, unknown>
  const pre = await executor.run(tx, ctx, payload, "check")
  if (!pre.ok) {
    if (pre.code === "approval_stale") await invalidateApproval(tx, ctx.tenant.id, approval, "stale")
    return { executed: false, code: pre.code, details: pre.details, events: [] }
  }
  await consumeApproval(tx, ctx.tenant.id, approval.id, approval.payloadDigest)
  const done = await executor.run(tx, ctx, payload, "apply")
  if (!done.ok) throw new DomainError("blocked_by_rule", done.code, done.details)
  await tx
    .update(actionProposal)
    .set({ state: "executed", updatedAt: new Date() })
    .where(eq(actionProposal.id, proposal.id))
  return { executed: true, code: null, details: {}, events: done.events }
}

export const DecideApprovalInput = z
  .object({
    approvalId: z.string().uuid(),
    decision: z.enum(["approve", "reject", "request_changes"]),
    reason: z.string().trim().max(1000).optional().nullable(),
    reviewedDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

type DecideResult = {
  outcome: string
  executed: boolean
  blockedCode: string | null
  blockedDetails: Record<string, unknown>
}

// Command access is workspace-level: the kernel decision checks the permission
// the approval's policy requires (approvals.decide, time.approve, …), the
// eligible roles and separation of duties.
export const decideApprovalCommand = defineCommand({
  type: "approvals.decide",
  skillId: null,
  permission: "workspace.view",
  input: DecideApprovalInput,
  handler: async (tx, ctx, input): Promise<{ result: DecideResult; events: EmittedEvent[] }> => {
    const res = await decideApproval(tx, ctx, input)
    if (res.outcome === "stale") {
      return {
        result: { outcome: "stale", executed: false, blockedCode: "approval_stale", blockedDetails: {} },
        events: [
          {
            eventType: "approval.stale",
            aggregateType: res.approval.aggregateType,
            aggregateId: res.approval.aggregateId,
            payload: { approvalId: res.approval.id, reason: "revision_or_payload_changed" },
          },
        ],
      }
    }
    const events = [...res.events]
    let execution: { executed: boolean; code: string | null; details: Record<string, unknown> } = {
      executed: false,
      code: null,
      details: {},
    }
    if (res.outcome === "rejected") {
      // The owning module records the rejection on its aggregate (same tx).
      const reject = EXECUTORS[res.approval.actionType]?.reject
      if (reject) events.push(...(await reject(tx, ctx, res.proposal.payload as Record<string, unknown>, input.reason ?? "")).events)
    }
    if (res.outcome === "approved") {
      const exec = await executeApproved(tx, ctx, res.approval, res.proposal, "decision")
      execution = { executed: exec.executed, code: exec.code, details: exec.details }
      events.push(...exec.events)
      if (!exec.executed && exec.code) {
        events.push({
          eventType: "approval.execution_blocked",
          aggregateType: res.approval.aggregateType,
          aggregateId: res.approval.aggregateId,
          payload: { approvalId: res.approval.id, code: exec.code, details: exec.details },
        })
      }
    }
    return {
      result: {
        outcome: res.outcome,
        executed: execution.executed,
        blockedCode: execution.code,
        blockedDetails: execution.details,
      },
      events,
    }
  },
})

export const ExecuteApprovedInput = z.object({ approvalId: z.string().uuid() }).strict()

// The command itself only needs workspace access; the executor's own
// permission (budget.propose, payments.execute, …) is checked below and again
// by the gate right before consumption.
export const executeApprovedCommand = defineCommand({
  type: "approvals.executeApproved",
  skillId: null,
  permission: "workspace.view",
  input: ExecuteApprovedInput,
  handler: async (tx, ctx, input) => {
    const [approval] = await tx
      .select()
      .from(approvalRequest)
      .where(and(eq(approvalRequest.tenantId, ctx.tenant.id), eq(approvalRequest.id, input.approvalId)))
      .for("update")
      .limit(1)
    if (!approval) throw new DomainError("not_found", "Approval not found")
    if (approval.state !== "approved") {
      throw new DomainError("approval_required", "Only an approved, unconsumed request can be executed", {
        state: approval.state,
      })
    }
    const executor = EXECUTORS[approval.actionType]
    if (!executor) throw new DomainError("not_found", "No executor for this action", { actionType: approval.actionType })
    if (!ctx.permissions.has(executor.permission)) {
      throw new DomainError("forbidden", "Your role cannot execute this action", { permission: executor.permission })
    }
    const [proposal] = await tx
      .select()
      .from(actionProposal)
      .where(and(eq(actionProposal.tenantId, ctx.tenant.id), eq(actionProposal.id, approval.proposalId)))
      .limit(1)
    if (!proposal) throw new DomainError("not_found", "Proposal not found")
    const exec = await executeApproved(tx, ctx, approval, proposal, "deferred")
    if (!exec.executed) {
      return {
        result: { executed: false, blockedCode: exec.code, blockedDetails: exec.details },
        events: [
          {
            eventType: "approval.execution_blocked",
            aggregateType: approval.aggregateType,
            aggregateId: approval.aggregateId,
            payload: { approvalId: approval.id, code: exec.code, details: exec.details },
          },
        ],
      }
    }
    return { result: { executed: true, blockedCode: null, blockedDetails: {} }, events: exec.events }
  },
})

// ── Queries ──

export async function listApprovals(ctx: AgencyContext, filter: { state?: string } = {}) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const where = filter.state
      ? and(eq(approvalRequest.tenantId, ctx.tenant.id), eq(approvalRequest.state, filter.state))
      : eq(approvalRequest.tenantId, ctx.tenant.id)
    const rows = await tx.select().from(approvalRequest).where(where).orderBy(desc(approvalRequest.createdAt)).limit(200)
    const userIds = [...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy].filter(Boolean) as string[]))]
    const users = userIds.length
      ? await tx.select({ id: appUser.id, name: appUser.displayName }).from(appUser).where(inArray(appUser.id, userIds))
      : []
    const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? null
    const pending = rows.filter((r) => r.state === "awaiting_approval")
    const creators = pending.length
      ? await tx
          .select({ id: actionProposal.id, createdBy: actionProposal.createdBy })
          .from(actionProposal)
          .where(and(eq(actionProposal.tenantId, ctx.tenant.id), inArray(actionProposal.id, pending.map((r) => r.proposalId))))
      : []
    const decidable = new Set<string>()
    for (const r of pending) {
      if (!ctx.permissions.has(decidePermissionOf(r.policyId)) || !r.eligibleRoles.includes(ctx.role)) continue
      const excluded = await excludedDecidersOf(tx, ctx.tenant.id, r, creators.find((c) => c.id === r.proposalId)?.createdBy ?? null)
      if (!excluded.has(ctx.user.id)) decidable.add(r.id)
    }
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      actionType: r.actionType,
      state: r.state,
      amountMinor: r.amountMinor?.toString() ?? null,
      currency: r.currency,
      eligibleRoles: r.eligibleRoles,
      requestedBy: nameOf(r.requestedBy),
      decidedBy: nameOf(r.decidedBy),
      aggregateType: r.aggregateType,
      aggregateId: r.aggregateId,
      createdAt: r.createdAt.toISOString(),
      canDecide: decidable.has(r.id),
    }))
  })
}

export async function getApprovalDetail(ctx: AgencyContext, approvalId: string) {
  if (!z.string().uuid().safeParse(approvalId).success) return null
  return withTenant(ctx.tenant.id, async (tx) => {
    const [a] = await tx
      .select()
      .from(approvalRequest)
      .where(and(eq(approvalRequest.tenantId, ctx.tenant.id), eq(approvalRequest.id, approvalId)))
      .limit(1)
    if (!a) return null
    const [p] = await tx
      .select()
      .from(actionProposal)
      .where(and(eq(actionProposal.tenantId, ctx.tenant.id), eq(actionProposal.id, a.proposalId)))
      .limit(1)
    const decisions = await tx
      .select({
        id: approvalDecision.id,
        decision: approvalDecision.decision,
        reason: approvalDecision.reason,
        createdAt: approvalDecision.createdAt,
        actor: appUser.displayName,
      })
      .from(approvalDecision)
      .innerJoin(appUser, eq(appUser.id, approvalDecision.actorUserId))
      .where(and(eq(approvalDecision.tenantId, ctx.tenant.id), eq(approvalDecision.approvalId, a.id)))
    const people = await tx
      .select({ id: appUser.id, name: appUser.displayName })
      .from(appUser)
      .where(inArray(appUser.id, [a.requestedBy, ...(p ? [p.createdBy] : [])]))
    const currentRevision = await currentAggregateRevision(tx, ctx.tenant.id, a.aggregateType, a.aggregateId)
    const isRequester = (await excludedDecidersOf(tx, ctx.tenant.id, a, p?.createdBy ?? null)).has(ctx.user.id)
    const eligible = ctx.permissions.has(decidePermissionOf(a.policyId)) && a.eligibleRoles.includes(ctx.role)
    const outdated = a.state === "awaiting_approval" && currentRevision !== a.aggregateRevision
    return {
      approval: {
        ...a,
        amountMinor: a.amountMinor?.toString() ?? null,
        createdAt: a.createdAt.toISOString(),
        decidedAt: a.decidedAt?.toISOString() ?? null,
        expiresAt: a.expiresAt?.toISOString() ?? null,
        consumedAt: a.consumedAt?.toISOString() ?? null,
      },
      proposal: p
        ? {
            id: p.id,
            payload: p.payload as Record<string, unknown>,
            diff: p.diff as Record<string, unknown>,
            impact: p.impact as Record<string, unknown>,
            state: p.state,
            origin: p.origin,
            createdAt: p.createdAt.toISOString(),
          }
        : null,
      decisions: decisions.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
      requesterName: people.find((u) => u.id === a.requestedBy)?.name ?? null,
      currentRevision,
      outdated,
      viewer: {
        isRequester,
        eligible,
        canDecide: a.state === "awaiting_approval" && eligible && !isRequester && !outdated,
        canExecute:
          a.state === "approved" &&
          !!EXECUTORS[a.actionType] &&
          ctx.permissions.has(EXECUTORS[a.actionType]!.permission),
      },
    }
  })
}
