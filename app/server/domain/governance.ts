import "server-only"

import { and, count, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { parseDecimalToMinor } from "@/lib/money"
import { ROLE_PERMISSIONS, ROLES, type Permission, type Role } from "@/lib/policy"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import { appUser, memberAccess, membership } from "@/server/db/schema"
import { createProposal, invalidatePendingApprovals, registerApprovalPolicy, requestApproval } from "@/server/kernel/approvals"
import { defineCommand, type CommandMeta, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

// ── agency-access-governance: proposeAccessChange ──
// A role/scope change is a proposal bound to the member's access revision and
// approved by an owner who is neither the requester nor the proposal creator
// (the owner is not an implicit exception). Members never request their own
// change. Applying it updates the membership role server-side.

export const ACCESS_CHANGE_POLICY = registerApprovalPolicy({ id: "access-change-v1", revision: 1 })

// Permission pairs that need separation of duties when held by one role.
const SOD_PAIRS: readonly [Permission, Permission][] = [
  ["budget.propose", "approvals.decide"],
  ["payables.manage", "payments.execute"],
  ["ledger.post", "period.close"],
  ["config.manage", "approvals.decide"],
]

function sodConflicts(role: Role) {
  const perms = new Set(ROLE_PERMISSIONS[role])
  return SOD_PAIRS.filter(([a, b]) => perms.has(a) && perms.has(b)).map(([a, b]) => ({
    permissions: [a, b],
    mitigation: "requester_and_proposal_creator_cannot_approve",
  }))
}

export const ProposeAccessChangeInput = z
  .object({
    member: z.string().uuid(),
    proposedRole: z.enum(ROLES),
    effectiveScope: z.enum(["agency_wide", "assigned_jobs"]),
    expenseApprovalCap: z.string().trim().min(1).max(24).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()

async function lockAccess(tx: Tx, tenantId: string, userId: string, role: string) {
  await tx.insert(memberAccess).values({ tenantId, userId, role }).onConflictDoNothing()
  const [row] = await tx
    .select()
    .from(memberAccess)
    .where(and(eq(memberAccess.tenantId, tenantId), eq(memberAccess.userId, userId)))
    .for("update")
    .limit(1)
  return row!
}

async function activeMembership(tx: Tx, tenantId: string, userId: string) {
  const [m] = await tx
    .select({ id: membership.id, role: membership.role, name: appUser.displayName })
    .from(membership)
    .innerJoin(appUser, eq(appUser.id, membership.userId))
    .where(and(eq(membership.tenantId, tenantId), eq(membership.userId, userId), eq(membership.active, true)))
    .limit(1)
  return m ?? null
}

async function activeOwners(tx: Tx, tenantId: string) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(membership)
    .where(and(eq(membership.tenantId, tenantId), eq(membership.role, "owner"), eq(membership.active, true)))
  return n
}

export const proposeAccessChange = defineCommand({
  type: "access.proposeChange",
  skillId: "agency-access-governance",
  permission: "access.request",
  input: ProposeAccessChangeInput,
  handler: async (tx, ctx, input, meta: CommandMeta) => {
    // Only members of THIS agency; another agency's user is simply not found.
    const m = await activeMembership(tx, ctx.tenant.id, input.member)
    if (!m) throw new DomainError("not_found", "Member not found", { field: "member" })
    if (input.member === ctx.user.id) {
      throw new DomainError("blocked_by_rule", "Members cannot request a change to their own access", { rule: "self_role_change" })
    }
    const currency = ctx.tenant.baseCurrency
    let capMinor: bigint | null = null
    if (input.expenseApprovalCap) {
      try {
        capMinor = parseDecimalToMinor(input.expenseApprovalCap, currency)
      } catch {
        throw new DomainError("validation", "Invalid expense approval cap", { field: "expenseApprovalCap" })
      }
      if (capMinor < 0n) throw new DomainError("validation", "Invalid expense approval cap", { field: "expenseApprovalCap" })
    }
    const access = await lockAccess(tx, ctx.tenant.id, input.member, m.role)
    const fromRole = m.role as Role
    if (fromRole === input.proposedRole && access.effectiveScope === input.effectiveScope && access.expenseApprovalCapMinor === capMinor) {
      throw new DomainError("validation", "The proposed access equals the current access", { field: "proposedRole" })
    }
    if (fromRole === "owner" && input.proposedRole !== "owner" && (await activeOwners(tx, ctx.tenant.id)) <= 1) {
      throw new DomainError("blocked_by_rule", "The agency must keep at least one owner", { rule: "last_owner" })
    }
    await invalidatePendingApprovals(tx, ctx.tenant.id, "member_access", access.id)

    const before = new Set(ROLE_PERMISSIONS[fromRole] ?? [])
    const after = new Set(ROLE_PERMISSIONS[input.proposedRole])
    const added = [...after].filter((p) => !before.has(p))
    const removed = [...before].filter((p) => !after.has(p))
    const conflicts = sodConflicts(input.proposedRole)
    const payload = {
      action: "access.role_change",
      memberAccessId: access.id,
      memberAccessRevision: access.revision,
      memberUserId: input.member,
      fromRole,
      toRole: input.proposedRole,
      fromScope: access.effectiveScope,
      toScope: input.effectiveScope,
      expenseApprovalCapMinor: capMinor,
      currency,
    }
    const proposal = await createProposal(
      tx,
      ctx,
      {
        actionType: "access.role_change",
        skillId: "agency-access-governance",
        aggregateType: "member_access",
        aggregateId: access.id,
        baseRevision: access.revision,
        payload,
        diff: {
          role: { before: fromRole, after: input.proposedRole },
          scope: { before: access.effectiveScope, after: input.effectiveScope },
          expenseApprovalCapMinor: { before: access.expenseApprovalCapMinor, after: capMinor },
        },
        impact: { permissionsAdded: added, permissionsRemoved: removed, sodConflicts: conflicts, reason: input.reason },
        origin: meta.origin,
      },
      "awaiting_approval"
    )
    const eligibleRoles = ["owner"] as const
    const { approval, events } = await requestApproval(tx, ctx, proposal, {
      policyId: ACCESS_CHANGE_POLICY.id,
      policyRevision: ACCESS_CHANGE_POLICY.revision,
      eligibleRoles,
      title: `Access change: ${m.name} → ${input.proposedRole}`,
      currency: capMinor !== null ? currency : null,
      amountMinor: capMinor,
      destination: `member:${input.member}`,
      expiresInHours: 72,
    })
    const members = await tx
      .select({ userId: membership.userId, role: membership.role, name: appUser.displayName })
      .from(membership)
      .innerJoin(appUser, eq(appUser.id, membership.userId))
      .where(and(eq(membership.tenantId, ctx.tenant.id), eq(membership.active, true)))
    return {
      result: {
        proposalId: proposal.id,
        approvalId: approval.id,
        payloadDigest: proposal.payloadDigest,
        access_matrix: members
          .sort((a, b) => (a.name < b.name ? -1 : 1))
          .map((x) => ({ userId: x.userId, name: x.name, role: x.role, permissions: (ROLE_PERMISSIONS[x.role as Role] ?? []).length })),
        capability_register: { memberUserId: input.member, permissionsAdded: added, permissionsRemoved: removed },
        sod_conflicts: conflicts,
        access_change_requests: [
          { proposalId: proposal.id, approvalId: approval.id, payloadDigest: proposal.payloadDigest, eligibleRoles, requestedBy: ctx.user.id, state: approval.state },
        ],
        config_change_requests: { applicable: false, reason: "role_change_only" },
        offboarding_plan:
          input.proposedRole === "viewer" && fromRole !== "viewer"
            ? { applicable: true, steps: ["reassign_open_approvals", "review_owned_jobs"] }
            : { applicable: false, reason: "not_a_downgrade_to_viewer" },
        audit_evidence_pack: {
          policyId: ACCESS_CHANGE_POLICY.id,
          policyRevision: ACCESS_CHANGE_POLICY.revision,
          memberAccessRevision: access.revision,
          events: ["access.change_proposed", "approval.requested"],
        },
      },
      events: [
        {
          eventType: "access.change_proposed",
          aggregateType: "member_access",
          aggregateId: access.id,
          aggregateRevision: access.revision,
          payload: { ...payload, proposalId: proposal.id, approvalId: approval.id, reason: input.reason },
        },
        ...events,
      ],
    }
  },
})

type AccessPayload = {
  memberAccessId: string
  memberAccessRevision: number
  memberUserId: string
  fromRole: string
  toRole: Role
  toScope: string
  expenseApprovalCapMinor: string | null
  currency: string
}

/** Approval executor for access.role_change. */
export async function applyAccessChange(
  tx: Tx,
  ctx: AgencyContext,
  payload: AccessPayload,
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const m = await activeMembership(tx, ctx.tenant.id, payload.memberUserId)
  const access = await lockAccess(tx, ctx.tenant.id, payload.memberUserId, m?.role ?? payload.fromRole)
  if (!m || m.role !== payload.fromRole || access.id !== payload.memberAccessId || access.revision !== payload.memberAccessRevision) {
    return { ok: false, code: "approval_stale", details: { reason: "member_access_changed" } }
  }
  if (payload.fromRole === "owner" && payload.toRole !== "owner" && (await activeOwners(tx, ctx.tenant.id)) <= 1) {
    return { ok: false, code: "blocked_by_rule", details: { rule: "last_owner" } }
  }
  if (mode === "check") return { ok: true, events: [] }
  await tx
    .update(membership)
    .set({ role: payload.toRole })
    .where(and(eq(membership.tenantId, ctx.tenant.id), eq(membership.userId, payload.memberUserId)))
  const [row] = await tx
    .update(memberAccess)
    .set({
      role: payload.toRole,
      effectiveScope: payload.toScope,
      expenseApprovalCapMinor: payload.expenseApprovalCapMinor === null ? null : BigInt(payload.expenseApprovalCapMinor),
      currency: payload.expenseApprovalCapMinor === null ? null : payload.currency,
      updatedBy: ctx.user.id,
      updatedAt: new Date(),
      revision: sql`${memberAccess.revision} + 1`,
    })
    .where(eq(memberAccess.id, access.id))
    .returning()
  return {
    ok: true,
    events: [
      {
        eventType: "access.role_changed",
        aggregateType: "member_access",
        aggregateId: access.id,
        aggregateRevision: row!.revision,
        payload: { memberUserId: payload.memberUserId, fromRole: payload.fromRole, toRole: payload.toRole, scope: payload.toScope },
      },
    ],
  }
}
