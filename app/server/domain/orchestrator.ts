import "server-only"

import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { BUSINESS_PERIOD, MARGIN_FLOOR_BPS } from "@/lib/demo"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import { approvalRequest, mediaPlanRevision, readinessCheckpoint } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { digestOf } from "@/server/kernel/approvals"
import { assertRevision, defineCommand, toJsonSafe } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { getBusinessDate } from "./presenter"
import { computeProfitability, loadJobFinancials } from "./profitability"

// ── agency-orchestrator: recomputeJobReadiness ──
// Deterministic readiness over persisted revisions. It derives next steps and
// blockers and persists a checkpoint; it never executes downstream actions.

export const ReadinessInput = z.object({ job: z.string().uuid() }).strict()

type NodeStatus = "done" | "pending" | "blocked"

async function computeReadiness(tx: Tx, tenantId: string, jobId: string, asOf: string) {
  const fin = await loadJobFinancials(tx, tenantId, jobId)
  const plans = await tx
    .select()
    .from(mediaPlanRevision)
    .where(and(eq(mediaPlanRevision.tenantId, tenantId), eq(mediaPlanRevision.jobId, fin.job.id)))
  const approvals = await tx
    .select()
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.tenantId, tenantId),
        eq(approvalRequest.aggregateId, fin.job.id),
        inArray(approvalRequest.state, ["awaiting_approval", "approved", "stale"])
      )
    )
  const profit = computeProfitability(fin, "forecast", "")
  const approvedPlan = plans.filter((p) => p.state === "approved").sort((a, b) => b.number - a.number)[0] ?? null
  // A newer plan revision awaiting decision makes the approved one outdated:
  // purchases that depend on the plan wait for it (never buy from r1 while r2
  // is pending).
  const pendingPlan =
    plans.filter((p) => (p.state === "draft" || p.state === "submitted") && p.number > (approvedPlan?.number ?? 0)).sort((a, b) => b.number - a.number)[0] ??
    null
  const marginOk = profit.marginBps !== null && profit.marginBps >= MARGIN_FLOOR_BPS
  const billable = (fin.approvedBudget?.agencyFeeMinor ?? 0n) + (fin.approvedBudget?.managedMediaMinor ?? 0n)
  const authorityOk = (fin.approvedAuthority?.amountMinor ?? 0n) >= billable && billable > 0n

  const node = (key: string, status: NodeStatus, dependsOn: string[], detail: Record<string, unknown> = {}) => ({ key, status, dependsOn, detail })
  const planStatus: NodeStatus = pendingPlan && approvedPlan ? "blocked" : approvedPlan ? "done" : "pending"
  const graph = [
    node("client_authority", fin.approvedAuthority ? (authorityOk ? "done" : "blocked") : "pending", [], {
      approvedMinor: (fin.approvedAuthority?.amountMinor ?? 0n).toString(),
      requiredMinor: billable.toString(),
    }),
    node("approved_budget", fin.approvedBudget ? "done" : "pending", ["client_authority"]),
    node("cost_estimate", fin.currentEstimate ? "done" : "pending", ["approved_budget"]),
    node("media_plan", planStatus, ["approved_budget"], {
      approvedRevision: approvedPlan?.number ?? null,
      pendingRevision: pendingPlan?.number ?? null,
      ...(planStatus === "blocked" ? { code: "plan_revision_outdated" } : {}),
    }),
    node("margin_floor", marginOk ? "done" : "blocked", ["cost_estimate", "approved_budget"], {
      marginBps: profit.marginBps,
      floorBps: MARGIN_FLOOR_BPS,
    }),
    node("media_buying", planStatus === "done" && marginOk ? "pending" : "blocked", ["media_plan", "margin_floor"], {
      planRevision: planStatus === "done" ? approvedPlan!.number : null,
    }),
  ]
  const blockers = [
    ...graph.filter((n) => n.status === "blocked").map((n) => ({ code: `${n.key}_blocked`, node: n.key, ...(n.detail.code ? { reason: n.detail.code } : {}) })),
    ...approvals.filter((a) => a.state === "stale").map((a) => ({ code: "stale_approval", approvalId: a.id })),
  ]
  const nextStage = graph.find((n) => n.status === "blocked")?.key ?? graph.find((n) => n.status === "pending")?.key ?? "complete"
  const checkpoints = graph.filter((n) => n.status === "done").map((n) => n.key)
  return {
    job_state: fin.job.state,
    dependency_graph: graph,
    period_gate_status: {
      period: BUSINESS_PERIOD.label,
      state: "open",
      note: "Accounting period state is owned by agency-period-close; this checkpoint reads the demo period as open.",
    },
    task_assignments: [
      { task: "job_owner", userId: fin.job.ownerUserId },
      ...approvals
        .filter((a) => a.state === "awaiting_approval")
        .map((a) => ({ task: `approve:${a.actionType}`, eligibleRoles: a.eligibleRoles, approvalId: a.id })),
    ],
    blockers,
    approval_requests: approvals.map((a) => ({ id: a.id, state: a.state, actionType: a.actionType, title: a.title })),
    checkpoints,
    next_stage: nextStage,
    as_of: asOf,
    job_revision: fin.job.revision,
    approved_plan_revision: approvedPlan?.number ?? null,
    margin_bps: profit.marginBps,
  }
}

/** Read-only readiness (job dossier, assistant). */
export async function recomputeJobReadiness(ctx: AgencyContext, input: z.infer<typeof ReadinessInput>) {
  const asOf = await getBusinessDate()
  return withTenant(ctx.tenant.id, (tx) => computeReadiness(tx, ctx.tenant.id, input.job, asOf))
}

/**
 * Capability action: recompute and persist a checkpoint bound to the job
 * revision the user saw. An outdated revision is a conflict; the same state
 * recomputed again resolves to the same checkpoint row (no duplicate).
 */
export const recordReadinessCheckpoint = defineCommand({
  type: "orchestrator.recordCheckpoint",
  skillId: "agency-orchestrator",
  // Persisting a checkpoint is a write: job managers only (viewers read).
  permission: "jobs.manage",
  input: ReadinessInput,
  handler: async (tx, ctx, input, meta) => {
    const readiness = await computeReadiness(tx, ctx.tenant.id, input.job, await getBusinessDate()).catch((e) => {
      if (e instanceof DomainError && e.code === "not_found") throw new DomainError("not_found", "Job not found", { field: "job" })
      throw e
    })
    try {
      assertRevision(readiness.job_revision, meta.expectedRevision, "job")
    } catch (e) {
      if (e instanceof DomainError && e.code === "revision_conflict") {
        throw new DomainError("revision_conflict", "The readiness was requested for an outdated job revision", {
          ...e.details,
          rule: "outdated_revision",
        })
      }
      throw e
    }
    // The business clock is not part of the derived state.
    const digest = digestOf({ ...readiness, as_of: null })
    const [inserted] = await tx
      .insert(readinessCheckpoint)
      .values({
        tenantId: ctx.tenant.id,
        jobId: input.job,
        jobRevision: readiness.job_revision,
        approvedPlanRevision: readiness.approved_plan_revision,
        digest,
        nextStage: readiness.next_stage,
        blockers: toJsonSafe(readiness.blockers) as object,
        snapshot: toJsonSafe(readiness) as object,
        createdBy: ctx.user.id,
      })
      .onConflictDoNothing()
      .returning()
    const [row] = inserted
      ? [inserted]
      : await tx
          .select()
          .from(readinessCheckpoint)
          .where(and(eq(readinessCheckpoint.tenantId, ctx.tenant.id), eq(readinessCheckpoint.jobId, input.job), eq(readinessCheckpoint.digest, digest)))
          .limit(1)
    return {
      result: { ...readiness, checkpointId: row!.id, checkpointReused: !inserted, checkpointDigest: digest },
      // Audit trail of every recompute; a reused checkpoint is confirmed, not duplicated.
      events: [
        {
          eventType: inserted ? "orchestrator.checkpoint_recorded" : "orchestrator.checkpoint_confirmed",
          aggregateType: "job",
          aggregateId: input.job,
          aggregateRevision: readiness.job_revision,
          jobId: input.job,
          payload: { checkpointId: row!.id, nextStage: readiness.next_stage, blockers: readiness.blockers.length, digest },
        },
      ],
    }
  },
})
