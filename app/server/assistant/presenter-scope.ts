import "server-only"

import { and, eq, gt, isNull } from "drizzle-orm"

import { fixtureUuid } from "@/lib/fixture-ids"
import { divHalfUp, minorToDecimalString } from "@/lib/money"
import { resolveAgencyContext, type AgencyContext } from "@/server/auth/context"
import { auditPlatform, type SessionInfo } from "@/server/auth/session"
import { runCapability } from "@/server/capabilities/runner"
import { db } from "@/server/db/client"
import { appSession, appUser, job, workflowRun } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { assertPresenter, getDemoClock } from "@/server/domain/presenter"
import { computeProfitability, estimateTotals, loadJobFinancials } from "@/server/domain/profitability"
import { isDemoMode } from "@/server/env"
import { DomainError } from "@/server/kernel/errors"

// Presenter demo tool "Load sample scope request" (investor script, 05 §90 s).
// Introduces the 40-hour scope change on Aurora through the REAL command of
// journey step J04.2 (agency-production-estimating → createProductionEstimate,
// the same command the workbench uses), as the J04.2 actor (the synthetic
// operator persona), audited with the real presenter. Idempotent per demo run:
// a replay returns the first result and never records a second estimate.
// Figures: demo-fixtures.json financial_checkpoints initial_plan (100 h) →
// unpriced_scope_change (140 h); production and expense lines are kept as the
// current estimate has them.

export const SAMPLE_SCOPE = {
  tenantSlug: "rayo-de-sol",
  jobFixture: "job_demo_aurora",
  actorFixture: "user_demo_operator",
  skillId: "agency-production-estimating",
  addedMinutes: 2400,
  reason: "Sample scope change (demo): the client requests 40 additional hours of creative rework",
} as const

export type SampleScopeResult = {
  state: "loaded" | "replayed" | "already_loaded"
  runId: string | null
  jobId: string
  jobLabel: string
  currency: string
  estimateNumber: number | null
  laborMinutesBefore: number
  laborMinutesAfter: number
  costBeforeMinor: string
  costAfterMinor: string
  marginBpsBefore: number | null
  marginBpsAfter: number | null
}

/** Re-reads the session behind an agency context (presenter flag is authoritative only from the DB). */
export async function presenterSessionFor(ctx: AgencyContext): Promise<SessionInfo> {
  const [row] = await db()
    .select({ sessionId: appSession.id, presenterUserId: appSession.presenterUserId })
    .from(appSession)
    .where(and(eq(appSession.id, ctx.sessionId), isNull(appSession.revokedAt), gt(appSession.expiresAt, new Date())))
    .limit(1)
  return {
    sessionId: ctx.sessionId,
    user: ctx.user,
    presenterUserId: row?.presenterUserId ?? null,
    presenter: Boolean(row?.presenterUserId) && isDemoMode(),
  }
}

async function journeyActorContext(session: SessionInfo, presenterUserId: string): Promise<AgencyContext> {
  const [u] = await db().select().from(appUser).where(eq(appUser.id, fixtureUuid(SAMPLE_SCOPE.actorFixture))).limit(1)
  if (!u?.demoPersona) throw new DomainError("forbidden", "The journey actor is not a demo persona")
  const actor: SessionInfo = {
    sessionId: session.sessionId,
    presenter: true,
    presenterUserId,
    user: { id: u.id, fixtureKey: u.fixtureKey, displayName: u.displayName, email: u.email, locale: u.locale === "es" ? "es" : "en", kind: u.kind, platformRole: u.platformRole, demoPersona: u.demoPersona },
  }
  const ctx = await resolveAgencyContext(actor, SAMPLE_SCOPE.tenantSlug)
  if (!ctx) throw new DomainError("not_found", "Demo agency not available")
  return ctx
}

export async function loadSampleScopeRequest(session: SessionInfo): Promise<SampleScopeResult> {
  const presenter = assertPresenter(session)
  const ctx = await journeyActorContext(session, presenter)
  const jobId = fixtureUuid(SAMPLE_SCOPE.jobFixture)
  const clock = await getDemoClock()
  const idempotencyKey = `presenter.sample-scope:${clock.demoRunId ?? "no-run"}:${jobId}`

  const before = await withTenant(ctx.tenant.id, async (tx) => {
    const fin = await loadJobFinancials(tx, ctx.tenant.id, jobId)
    const [prior] = await tx
      .select({ id: workflowRun.id, state: workflowRun.state })
      .from(workflowRun)
      .where(and(eq(workflowRun.tenantId, ctx.tenant.id), eq(workflowRun.skillId, SAMPLE_SCOPE.skillId), eq(workflowRun.idempotencyKey, idempotencyKey)))
      .limit(1)
    const [j] = await tx.select({ revision: job.revision, ref: job.displayReference, name: job.name }).from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, jobId))).limit(1)
    return { fin, prior: prior ?? null, job: j! }
  })
  const fin = before.fin
  const current = estimateTotals(fin, fin.currentEstimate?.id ?? null)
  const previousEstimate = fin.estimates.find((e) => e.id !== fin.currentEstimate?.id && e.number < (fin.currentEstimate?.number ?? 0)) ?? null
  const previous = previousEstimate ? estimateTotals(fin, previousEstimate.id) : null
  const marginNow = computeProfitability(fin, "forecast", ctx.tenant.slug).marginBps
  const summary = (state: SampleScopeResult["state"], runId: string | null, b: { minutes: number; cost: bigint; bps: number | null }): SampleScopeResult => ({
    state,
    runId,
    jobId,
    jobLabel: `${before.job.ref} · ${before.job.name}`,
    currency: fin.job.currency,
    estimateNumber: fin.currentEstimate?.number ?? null,
    laborMinutesBefore: b.minutes,
    laborMinutesAfter: current.laborMinutes,
    costBeforeMinor: b.cost.toString(),
    costAfterMinor: current.totalMinor.toString(),
    marginBpsBefore: b.bps,
    marginBpsAfter: marginNow,
  })

  // Replay of this demo run's action: report the first result, no new effect.
  if (before.prior) {
    await auditPlatform({ eventType: "presenter.sample_scope_request_replayed", actorUserId: presenter, tenantId: ctx.tenant.id, payload: { jobId, idempotencyKey, runId: before.prior.id } })
    return summary("replayed", before.prior.id, { minutes: previous?.laborMinutes ?? current.laborMinutes, cost: previous?.totalMinor ?? current.totalMinor, bps: null })
  }
  // The scope change was already recorded another way (workbench): never add it twice.
  if (previous && current.laborMinutes - previous.laborMinutes >= SAMPLE_SCOPE.addedMinutes) {
    return summary("already_loaded", null, { minutes: previous.laborMinutes, cost: previous.totalMinor, bps: null })
  }

  const laborLine = fin.estimateLines.find((l) => l.estimateId === fin.currentEstimate?.id && l.lineType === "labor")
  const hourlyMinor = laborLine?.hourlyCostMinor ?? (current.laborMinutes > 0 ? divHalfUp(current.laborMinor * 60n, BigInt(current.laborMinutes)) : 0n)
  const c = fin.job.currency
  const input = {
    job: jobId,
    laborMinutes: current.laborMinutes + SAMPLE_SCOPE.addedMinutes,
    hourlyCost: minorToDecimalString(hourlyMinor, c),
    productionVendorAmount: minorToDecimalString(current.productionMinor, c),
    expenseAmount: minorToDecimalString(current.expenseMinor, c),
    reason: SAMPLE_SCOPE.reason,
  }
  const outcome = await runCapability(ctx, SAMPLE_SCOPE.skillId, input, { origin: "presenter", idempotencyKey, expectedRevision: before.job.revision })
  if (outcome.state !== "succeeded") {
    throw new DomainError((outcome.error?.code as "blocked_by_rule") ?? "blocked_by_rule", outcome.error?.message ?? "The sample scope change was not recorded", outcome.error?.details ?? {})
  }
  await auditPlatform({ eventType: "presenter.sample_scope_request", actorUserId: presenter, tenantId: ctx.tenant.id, payload: { jobId, idempotencyKey, runId: outcome.runId, demoRunId: clock.demoRunId, addedMinutes: SAMPLE_SCOPE.addedMinutes } })

  const after = await withTenant(ctx.tenant.id, (tx) => loadJobFinancials(tx, ctx.tenant.id, jobId))
  const totals = estimateTotals(after, after.currentEstimate?.id ?? null)
  return {
    state: "loaded",
    runId: outcome.runId,
    jobId,
    jobLabel: `${before.job.ref} · ${before.job.name}`,
    currency: c,
    estimateNumber: after.currentEstimate?.number ?? null,
    laborMinutesBefore: current.laborMinutes,
    laborMinutesAfter: totals.laborMinutes,
    costBeforeMinor: current.totalMinor.toString(),
    costAfterMinor: totals.totalMinor.toString(),
    marginBpsBefore: marginNow,
    marginBpsAfter: computeProfitability(after, "forecast", ctx.tenant.slug).marginBps,
  }
}
