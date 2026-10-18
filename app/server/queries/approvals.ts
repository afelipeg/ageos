import "server-only"

import { and, desc, eq, gt, inArray, ne } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { actionProposal, appUser, approvalRequest, businessEvent, evidence, job, membership } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { getApprovalDetail, listApprovals } from "@/server/domain/approvals"

import { isUuid } from "./shared"

// Approval projections. Decisions and eligibility are computed by the domain
// (getApprovalDetail / listApprovals); this layer only adds navigable context:
// eligible people, the newer request that superseded an outdated one, the
// job, evidence referenced by the payload and the audit trail.

export const APPROVAL_FILTERS = ["awaiting_approval", "approved", "changes_requested", "rejected", "stale", "expired", "consumed", "all"] as const
export type ApprovalFilter = (typeof APPROVAL_FILTERS)[number]

export async function listApprovalsView(ctx: AgencyContext, filter: ApprovalFilter) {
  const all = await listApprovals(ctx)
  const counts = Object.fromEntries(APPROVAL_FILTERS.map((f) => [f, f === "all" ? all.length : all.filter((a) => a.state === f).length])) as Record<ApprovalFilter, number>
  const rows = filter === "all" ? all : all.filter((a) => a.state === filter)
  return { rows, counts }
}

export async function getApprovalView(ctx: AgencyContext, approvalId: string) {
  if (!isUuid(approvalId)) return null
  const detail = await getApprovalDetail(ctx, approvalId)
  if (!detail) return null
  const a = detail.approval
  const extra = await withTenant(ctx.tenant.id, async (tx) => {
    const eligiblePeople = a.eligibleRoles.length
      ? await tx
          .select({ id: appUser.id, name: appUser.displayName, role: membership.role })
          .from(membership)
          .innerJoin(appUser, eq(appUser.id, membership.userId))
          .where(and(eq(membership.tenantId, ctx.tenant.id), eq(membership.active, true), inArray(membership.role, a.eligibleRoles)))
      : []
    const [newer] = await tx
      .select({ id: approvalRequest.id, title: approvalRequest.title, state: approvalRequest.state })
      .from(approvalRequest)
      .where(
        and(
          eq(approvalRequest.tenantId, ctx.tenant.id),
          eq(approvalRequest.aggregateType, a.aggregateType),
          eq(approvalRequest.aggregateId, a.aggregateId),
          ne(approvalRequest.id, a.id),
          gt(approvalRequest.createdAt, new Date(a.createdAt))
        )
      )
      .orderBy(desc(approvalRequest.createdAt))
      .limit(1)
    const [j] =
      a.aggregateType === "job"
        ? await tx.select({ id: job.id, name: job.name, ref: job.displayReference, revision: job.revision }).from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, a.aggregateId))).limit(1)
        : []
    const payload = detail.proposal?.payload ?? {}
    const evidenceIds = Object.entries(payload)
      .filter(([k, v]) => /evidence/i.test(k) && typeof v === "string" && isUuid(v))
      .map(([, v]) => v as string)
    const ev = evidenceIds.length
      ? await tx.select({ id: evidence.id, title: evidence.title, kind: evidence.kind, reviewState: evidence.reviewState, fileId: evidence.fileId }).from(evidence).where(and(eq(evidence.tenantId, ctx.tenant.id), inArray(evidence.id, evidenceIds)))
      : []
    const [proposalRow] = detail.proposal
      ? await tx.select({ runId: actionProposal.runId, skillId: actionProposal.skillId }).from(actionProposal).where(and(eq(actionProposal.tenantId, ctx.tenant.id), eq(actionProposal.id, detail.proposal.id))).limit(1)
      : []
    const events = await tx
      .select({ id: businessEvent.id, eventType: businessEvent.eventType, origin: businessEvent.origin, recordedAt: businessEvent.recordedAt, actor: appUser.displayName, payload: businessEvent.payload })
      .from(businessEvent)
      .leftJoin(appUser, eq(appUser.id, businessEvent.actorUserId))
      .where(and(eq(businessEvent.tenantId, ctx.tenant.id), eq(businessEvent.aggregateId, a.aggregateId)))
      .orderBy(desc(businessEvent.seq))
      .limit(80)
    const related = events.filter((e) => {
      const p = e.payload as Record<string, unknown>
      return p.approvalId === a.id || p.proposalId === a.proposalId
    })
    return {
      eligiblePeople: eligiblePeople.map((p) => ({ ...p, isRequester: p.id === a.requestedBy })),
      newer: newer ?? null,
      job: j ?? null,
      evidence: ev,
      runId: proposalRow?.runId ?? null,
      skillId: proposalRow?.skillId ?? null,
      events: related.map((e) => ({ id: e.id, eventType: e.eventType, origin: e.origin, actor: e.actor, recordedAt: e.recordedAt.toISOString() })),
    }
  })
  return { ...detail, ...extra }
}
