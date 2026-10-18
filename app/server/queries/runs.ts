import "server-only"

import { and, asc, count, desc, eq, inArray, or, type SQL } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { actionProposal, appUser, approvalRequest, businessEvent, job, workflowRun, workflowRunStep } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { getCapability } from "@/server/capabilities/registry"

import { isUuid, iso } from "./shared"

// Execution history of capability runs (workflow_run + workflow_run_step),
// exactly as the runner persisted it. No step, timing or reasoning is added
// here; the UI only translates stable state codes.

export const RUN_STATES = ["all", "succeeded", "blocked", "failed", "awaiting_approval", "outcome_unknown", "executing"] as const
export type RunStateFilter = (typeof RUN_STATES)[number]

export async function listRunsView(ctx: AgencyContext, params: { state: RunStateFilter; skill?: string; job?: string; page: number; pageSize?: number }) {
  const pageSize = params.pageSize ?? 25
  return withTenant(ctx.tenant.id, async (tx) => {
    const conds: SQL[] = [eq(workflowRun.tenantId, ctx.tenant.id)]
    if (params.state !== "all") conds.push(eq(workflowRun.state, params.state))
    if (params.skill && getCapability(params.skill)) conds.push(eq(workflowRun.skillId, params.skill))
    if (params.job && isUuid(params.job)) conds.push(eq(workflowRun.jobId, params.job))
    const where = and(...conds)
    const [{ total }] = await tx.select({ total: count() }).from(workflowRun).where(where)
    const rows = await tx
      .select({ run: workflowRun, actor: appUser.displayName, jobName: job.name, jobRef: job.displayReference })
      .from(workflowRun)
      .leftJoin(appUser, eq(appUser.id, workflowRun.actorUserId))
      .leftJoin(job, and(eq(job.tenantId, workflowRun.tenantId), eq(job.id, workflowRun.jobId)))
      .where(where)
      .orderBy(desc(workflowRun.startedAt))
      .limit(pageSize)
      .offset((params.page - 1) * pageSize)
    const byState = await tx
      .select({ state: workflowRun.state, n: count() })
      .from(workflowRun)
      .where(eq(workflowRun.tenantId, ctx.tenant.id))
      .groupBy(workflowRun.state)
    const counts: Record<string, number> = { all: byState.reduce((s, r) => s + Number(r.n), 0) }
    for (const r of byState) counts[r.state] = Number(r.n)
    return {
      total: Number(total),
      counts,
      pageSize,
      rows: rows.map((r) => {
        const cap = getCapability(r.run.skillId)
        return {
          id: r.run.id,
          skillId: r.run.skillId,
          label: cap?.contract.label ?? { en: r.run.skillId, es: r.run.skillId },
          moduleKey: cap?.contract.moduleKey ?? null,
          state: r.run.state,
          origin: r.run.origin,
          actor: r.actor,
          jobId: r.run.jobId,
          jobName: r.jobName,
          jobRef: r.jobRef,
          startedAt: r.run.startedAt.toISOString(),
          finishedAt: iso(r.run.finishedAt),
          handlerVersion: r.run.handlerVersion,
        }
      }),
    }
  })
}

export async function getRunDetail(ctx: AgencyContext, runId: string) {
  if (!isUuid(runId)) return null
  return withTenant(ctx.tenant.id, async (tx) => {
    const [r] = await tx
      .select({ run: workflowRun, actor: appUser.displayName })
      .from(workflowRun)
      .leftJoin(appUser, eq(appUser.id, workflowRun.actorUserId))
      .where(and(eq(workflowRun.tenantId, ctx.tenant.id), eq(workflowRun.id, runId)))
      .limit(1)
    if (!r) return null
    const steps = await tx
      .select()
      .from(workflowRunStep)
      .where(and(eq(workflowRunStep.tenantId, ctx.tenant.id), eq(workflowRunStep.runId, runId)))
      .orderBy(asc(workflowRunStep.seq))
    const [j] = r.run.jobId
      ? await tx.select({ id: job.id, name: job.name, ref: job.displayReference, number: job.jobNumber }).from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, r.run.jobId))).limit(1)
      : []
    const events = await tx
      .select({
        id: businessEvent.id,
        eventType: businessEvent.eventType,
        aggregateType: businessEvent.aggregateType,
        aggregateId: businessEvent.aggregateId,
        aggregateRevision: businessEvent.aggregateRevision,
        commandType: businessEvent.commandType,
        origin: businessEvent.origin,
        recordedAt: businessEvent.recordedAt,
      })
      .from(businessEvent)
      .where(and(eq(businessEvent.tenantId, ctx.tenant.id), eq(businessEvent.correlationId, runId)))
      .orderBy(asc(businessEvent.seq))
    const out = (r.run.output ?? null) as { result?: Record<string, unknown> | null; error?: { code: string; message: string; details: Record<string, unknown> } | null } | null
    const approvalIds = new Set<string>()
    const result = out?.result && typeof out.result === "object" ? out.result : null
    if (result && typeof result.approvalId === "string" && isUuid(result.approvalId)) approvalIds.add(result.approvalId)
    const proposals = await tx
      .select({ id: actionProposal.id })
      .from(actionProposal)
      .where(and(eq(actionProposal.tenantId, ctx.tenant.id), eq(actionProposal.runId, runId)))
    const approvalConds: SQL[] = []
    if (approvalIds.size) approvalConds.push(inArray(approvalRequest.id, [...approvalIds]))
    if (proposals.length) approvalConds.push(inArray(approvalRequest.proposalId, proposals.map((p) => p.id)))
    const approvals = approvalConds.length
      ? await tx
          .select({ id: approvalRequest.id, title: approvalRequest.title, state: approvalRequest.state })
          .from(approvalRequest)
          .where(and(eq(approvalRequest.tenantId, ctx.tenant.id), approvalConds.length === 1 ? approvalConds[0]! : or(...approvalConds)!))
      : []
    const cap = getCapability(r.run.skillId)
    return {
      run: {
        id: r.run.id,
        skillId: r.run.skillId,
        state: r.run.state,
        origin: r.run.origin,
        actor: r.actor,
        handlerVersion: r.run.handlerVersion,
        idempotencyKey: r.run.idempotencyKey,
        startedAt: r.run.startedAt.toISOString(),
        finishedAt: iso(r.run.finishedAt),
        input: r.run.input as Record<string, unknown>,
        result,
        error: out?.error ?? null,
      },
      capability: cap ? { label: cap.contract.label, moduleKey: cap.contract.moduleKey, actionId: cap.contract.actionId, repositoryOutputs: cap.contract.repositoryOutputs, status: cap.status } : null,
      steps: steps.map((s) => ({ id: s.id, seq: s.seq, key: s.stepKey, state: s.state, detail: s.detail as Record<string, unknown>, startedAt: s.startedAt.toISOString(), finishedAt: iso(s.finishedAt) })),
      job: j ?? null,
      events: events.map((e) => ({ ...e, recordedAt: e.recordedAt.toISOString() })),
      approvals,
    }
  })
}
