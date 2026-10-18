import "server-only"

import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm"
import { z } from "zod"

import { MODULES } from "@/lib/capabilities/catalog.generated"
import { PROVIDERS } from "@/server/adapters/simulated-provider"
import { resolveAgencyContext } from "@/server/auth/context"
import { auditPlatform, type SessionInfo } from "@/server/auth/session"
import { db, type Tx } from "@/server/db/client"
import {
  activationRun,
  activationStep,
  agency,
  configurationRevision,
  connection,
  legalEntity,
  membership,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { DomainError } from "@/server/kernel/errors"
import { privateDisk } from "@/server/storage/private-disk"

import {
  type AgencyRow,
  type AgencyStep,
  type BrandAccessStep,
  type ConnectionsStep,
  insertControlEvent,
  loadOwnedAgency,
  loadOwnedRevision,
  publishDigest,
  validateRevisionTx,
} from "./configuration"

// P04 activation: a persisted, deterministic, resumable run that turns a
// validated configuration into a logical workspace inside the shared app. No
// cloud resource, DNS or external account is provisioned; the custom domain is
// a labelled simulation that advances only through simulateDnsVerification.

export const ACTIVATION_STEPS = [
  "validate",
  "create_workspace",
  "apply_roles",
  "publish_configuration",
  "prepare_storage",
  "enable_capabilities",
  "check_access",
  "ready",
] as const
export type ActivationStepKey = (typeof ACTIVATION_STEPS)[number]

const STALE_STEP_SECONDS = 60

export const DOMAIN_STATES = ["none", "requested", "pending_dns", "verifying", "simulated_ready"] as const
export type DomainState = (typeof DOMAIN_STATES)[number]

/** Thrown by a step; `waiting` marks a missing authorization the user must resolve (→ run state `waiting`). */
class StepError extends Error {
  constructor(
    readonly code: string,
    readonly details: Record<string, unknown> = {},
    readonly waiting = false
  ) {
    super(code)
  }
}

type StepContext = { tx: Tx; tenantId: string; revisionId: string; actor: SessionInfo }
type StepImpl = (c: StepContext) => Promise<Record<string, unknown>>

async function loadState(tx: Tx, tenantId: string, revisionId: string) {
  const [a] = await tx.select().from(agency).where(eq(agency.id, tenantId)).for("update").limit(1)
  const [rev] = await tx.select().from(configurationRevision).where(eq(configurationRevision.id, revisionId)).for("update").limit(1)
  if (!a || !rev) throw new StepError("workspace_missing")
  return { a, rev }
}

const STEP_IMPL: Record<ActivationStepKey, StepImpl> = {
  async validate({ tx, tenantId, revisionId, actor }) {
    const { a, rev } = await loadState(tx, tenantId, revisionId)
    const v = await validateRevisionTx(tx, a, rev)
    if (!v.valid) throw new StepError("configuration_invalid", { blockers: v.blockers })
    // Initial configuration (or a presentation-only change) is approved by its
    // owner at deploy; capability changes of an active agency are blocked by
    // validation and go through decideCapabilityChange (owner ≠ requester).
    await tx
      .update(configurationRevision)
      .set({ state: "approved", approvedBy: actor.user.id, validation: v, updatedAt: new Date(), revision: sql`${configurationRevision.revision} + 1` })
      .where(eq(configurationRevision.id, rev.id))
    return { blockers: 0, warnings: v.warnings.length, enabled: v.summary.catalog.enabled, digest: v.summary.publish.digest }
  },

  async create_workspace({ tx, tenantId, revisionId }) {
    const { a, rev } = await loadState(tx, tenantId, revisionId)
    const recovered = a.status === "ready"
    if (!recovered) await tx.update(agency).set({ status: "activating", updatedAt: new Date() }).where(eq(agency.id, a.id))
    const profile = rev.agencyProfile as AgencyStep
    const [existing] = await tx.select({ id: legalEntity.id }).from(legalEntity).where(eq(legalEntity.tenantId, a.id)).orderBy(asc(legalEntity.createdAt)).limit(1)
    const legalEntityId =
      existing?.id ??
      (
        await tx
          .insert(legalEntity)
          .values({ tenantId: a.id, name: profile.legalEntityName, country: profile.country, currency: profile.baseCurrency, fiscalProfileId: "DEMO_NO_TAX" })
          .returning({ id: legalEntity.id })
      )[0]!.id
    return { workspace: "logical_tenant_in_shared_app", recovered, legalEntityId, legalEntityCreated: !existing, fiscalProfile: "DEMO_NO_TAX" }
  },

  async apply_roles({ tx, tenantId, revisionId, actor }) {
    const { rev } = await loadState(tx, tenantId, revisionId)
    const [m] = await tx.select().from(membership).where(and(eq(membership.tenantId, tenantId), eq(membership.userId, actor.user.id))).limit(1)
    if (!m || !m.active || m.role !== "owner") {
      throw new StepError("owner_membership_missing", { userId: actor.user.id }, true)
    }
    const members = ((rev.brandAccess as Partial<BrandAccessStep>).members ?? []).map((x) => ({
      email: x.email,
      role: x.role,
      // Demo invitation: recorded, never emailed, grants nothing until accepted.
      delivery: "simulated_not_sent",
    }))
    return { owner: { userId: actor.user.id, role: "owner" }, invitations: members, separationOfDuties: true }
  },

  async publish_configuration({ tx, tenantId, revisionId }) {
    const { a, rev } = await loadState(tx, tenantId, revisionId)
    const now = new Date()
    const supersedes = a.publishedConfigRevisionId && a.publishedConfigRevisionId !== rev.id ? a.publishedConfigRevisionId : null
    if (supersedes) {
      await tx.update(configurationRevision).set({ state: "superseded", updatedAt: now, revision: sql`${configurationRevision.revision} + 1` }).where(eq(configurationRevision.id, supersedes))
    }
    await tx
      .update(configurationRevision)
      .set({ state: "provisioning", publishedAt: rev.publishedAt ?? now, updatedAt: now, revision: sql`${configurationRevision.revision} + 1` })
      .where(eq(configurationRevision.id, rev.id))
    const profile = rev.agencyProfile as AgencyStep
    const brand = rev.brandAccess as Partial<BrandAccessStep>
    const domain = brand.customDomain ?? null
    const domainChanged = domain !== a.requestedDomain
    await tx
      .update(agency)
      .set({
        publishedConfigRevisionId: rev.id,
        name: profile.name,
        appName: profile.appName,
        baseCurrency: profile.baseCurrency,
        timezone: profile.timezone,
        ...(a.status === "ready" ? {} : { slug: brand.appSlug! }),
        requestedDomain: domain,
        domainState: domainChanged ? (domain ? "requested" : "none") : a.domainState,
        updatedAt: now,
        revision: sql`${agency.revision} + 1`,
      })
      .where(eq(agency.id, a.id))
    return { revisionNumber: rev.number, digest: publishDigest(a.id, rev), supersedes }
  },

  async prepare_storage({ tenantId }) {
    const ref = await privateDisk.prepareTenant(tenantId).catch((e: NodeJS.ErrnoException) => {
      throw new StepError("storage_unavailable", { errno: e.code ?? "unknown" })
    })
    return { storagePrefix: ref.prefix, adapter: ref.adapter, publicAccess: ref.publicAccess }
  },

  async enable_capabilities({ tx, tenantId, revisionId, actor }) {
    const { rev } = await loadState(tx, tenantId, revisionId)
    const conns = rev.connections as Partial<ConnectionsStep>
    const created: string[] = []
    const blocked: { provider: string; accountAlias: string; state: string }[] = []
    for (const acc of conns.accounts ?? []) {
      const [existing] = await tx
        .select()
        .from(connection)
        .where(and(eq(connection.tenantId, tenantId), eq(connection.provider, acc.provider), eq(connection.accountAlias, acc.accountAlias)))
        .limit(1)
      if (existing) {
        // Never silently restore a revoked authorization: the user resolves it in Connections.
        if (existing.state !== "connected_demo") blocked.push({ provider: acc.provider, accountAlias: acc.accountAlias, state: existing.state })
        continue
      }
      await tx.insert(connection).values({
        tenantId,
        provider: acc.provider,
        category: PROVIDERS[acc.provider]!.category,
        mode: "simulated",
        accountAlias: acc.accountAlias,
        scopes: acc.scopes,
        state: "connected_demo",
        ownerUserId: actor.user.id,
      })
      created.push(`${acc.provider}:${acc.accountAlias}`)
    }
    if (blocked.length) throw new StepError("connection_authorization_missing", { waitingFor: "connections", connections: blocked }, true)
    const enabled = new Set(rev.enabledCapabilities)
    return {
      enabled: enabled.size,
      modules: MODULES.filter((m) => m.skillIds.some((s) => enabled.has(s))).length,
      connectionsCreated: created,
      connectionMode: conns.mode ?? "simulated",
      simulated: true,
    }
  },

  async check_access({ tx, tenantId, revisionId, actor }) {
    const { a, rev } = await loadState(tx, tenantId, revisionId)
    // Real server-side resolution with the activating owner's identity.
    const ctx = await resolveAgencyContext(actor, a.slug, { allowNotReady: true })
    if (!ctx || ctx.role !== "owner" || ctx.tenant.publishedConfigRevisionId !== rev.id) {
      throw new StepError("access_check_failed", { slug: a.slug }, true)
    }
    return { path: `/a/${a.slug}`, role: ctx.role, enabledCapabilities: ctx.enabledCapabilities.size }
  },

  async ready({ tx, tenantId, revisionId }) {
    const { a, rev } = await loadState(tx, tenantId, revisionId)
    const now = new Date()
    await tx.update(configurationRevision).set({ state: "ready", updatedAt: now, revision: sql`${configurationRevision.revision} + 1` }).where(eq(configurationRevision.id, rev.id))
    await tx.update(agency).set({ status: "ready", updatedAt: now }).where(eq(agency.id, a.id))
    return {
      path: `/a/${a.slug}`,
      appName: a.appName,
      domain: { requested: a.requestedDomain, state: a.domainState, simulated: true },
      domainPending: a.requestedDomain !== null && a.domainState !== "simulated_ready",
      externalProvisioning: false,
    }
  },
}

// ── Run driver ──

async function setRun(tenantId: string, runId: string, set: Partial<typeof activationRun.$inferInsert>) {
  await withTenant(tenantId, (tx) => tx.update(activationRun).set(set).where(eq(activationRun.id, runId)))
}

/** Executes pending/failed steps in order. Each step commits its effect and its `succeeded` mark together. */
async function advanceRun(tenantId: string, runId: string, actor: SessionInfo): Promise<void> {
  const steps = await withTenant(tenantId, (tx) => tx.select().from(activationStep).where(eq(activationStep.runId, runId)).orderBy(asc(activationStep.seq)))
  const [run] = await withTenant(tenantId, (tx) => tx.select().from(activationRun).where(eq(activationRun.id, runId)).limit(1))
  if (!run) throw new DomainError("not_found", "Activation not found")
  for (const step of steps) {
    if (step.state === "succeeded" || step.state === "simulated") continue
    // Claim the step: a concurrent driver (double click, second tab) stops here.
    // A step left `running` by an interrupted request is reclaimable after
    // STALE_STEP_SECONDS; step effects are idempotent and commit atomically.
    const claimed = await withTenant(tenantId, (tx) =>
      tx
        .update(activationStep)
        .set({ state: "running", startedAt: new Date(), finishedAt: null, error: null })
        .where(
          and(
            eq(activationStep.id, step.id),
            or(
              inArray(activationStep.state, ["pending", "failed"]),
              and(eq(activationStep.state, "running"), lt(activationStep.startedAt, new Date(Date.now() - STALE_STEP_SECONDS * 1000)))
            )
          )
        )
        .returning({ id: activationStep.id })
    )
    if (!claimed[0]) return
    await setRun(tenantId, runId, { state: "running", startedAt: run.startedAt ?? new Date(), finishedAt: null })
    try {
      await withTenant(tenantId, async (tx) => {
        const detail = await STEP_IMPL[step.stepKey as ActivationStepKey]({ tx, tenantId, revisionId: run.configurationRevisionId, actor })
        await tx.update(activationStep).set({ state: "succeeded", detail, finishedAt: new Date() }).where(eq(activationStep.id, step.id))
      })
    } catch (e) {
      const err = e instanceof StepError ? e : new StepError("step_failed", { message: e instanceof Error ? e.message : String(e) })
      const now = new Date()
      await withTenant(tenantId, async (tx) => {
        await tx.update(activationStep).set({ state: "failed", error: err.code, detail: err.details, finishedAt: now }).where(eq(activationStep.id, step.id))
        await tx.update(activationRun).set({ state: err.waiting ? "waiting" : "failed", finishedAt: now }).where(eq(activationRun.id, runId))
        const [a] = await tx.select({ status: agency.status }).from(agency).where(eq(agency.id, tenantId)).limit(1)
        if (a && a.status !== "ready") await tx.update(agency).set({ status: "blocked", updatedAt: now }).where(eq(agency.id, tenantId))
        await tx
          .update(configurationRevision)
          .set({ state: "blocked", updatedAt: now })
          .where(and(eq(configurationRevision.id, run.configurationRevisionId), inArray(configurationRevision.state, ["validating", "approved", "provisioning"])))
        await insertControlEvent(tx, tenantId, actor.user.id, {
          eventType: "activation.step_failed",
          aggregateType: "activation_run",
          aggregateId: runId,
          payload: { step: step.stepKey, code: err.code, waiting: err.waiting },
        })
      })
      return
    }
  }
  await withTenant(tenantId, async (tx) => {
    await tx.update(activationRun).set({ state: "succeeded", finishedAt: new Date() }).where(eq(activationRun.id, runId))
    await insertControlEvent(tx, tenantId, actor.user.id, {
      eventType: "activation.succeeded",
      aggregateType: "activation_run",
      aggregateId: runId,
      payload: { revisionId: run.configurationRevisionId },
    })
  })
  await auditPlatform({ eventType: "control.agency_activated", actorUserId: actor.user.id, tenantId, payload: { runId } })
}

// ── Public services ──

export type ActivationRunView = {
  runId: string
  state: "queued" | "running" | "succeeded" | "failed" | "waiting" | string
  agency: { id: string; slug: string; name: string; appName: string; status: string; domain: { requested: string | null; state: string; simulated: true } }
  revision: { id: string; number: number; state: string }
  steps: { key: ActivationStepKey; seq: number; state: string; startedAt: string | null; finishedAt: string | null; detail: Record<string, unknown>; error: string | null }[]
  /** Set when succeeded: the real workspace path (and whether the domain simulation is still pending). */
  result: { path: string; domainPending: boolean } | null
  /** Set while waiting: what the user must resolve before retrying ("connections" | "access"). */
  waitingFor: string | null
  canRetry: boolean
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

async function runView(tenantId: string, runId: string): Promise<ActivationRunView> {
  return withTenant(tenantId, async (tx) => {
    const [run] = await tx.select().from(activationRun).where(eq(activationRun.id, runId)).limit(1)
    if (!run) throw new DomainError("not_found", "Activation not found")
    const [a] = await tx.select().from(agency).where(eq(agency.id, tenantId)).limit(1)
    const [rev] = await tx.select().from(configurationRevision).where(eq(configurationRevision.id, run.configurationRevisionId)).limit(1)
    const steps = await tx.select().from(activationStep).where(eq(activationStep.runId, runId)).orderBy(asc(activationStep.seq))
    const failed = steps.find((s) => s.state === "failed")
    return {
      runId: run.id,
      state: run.state,
      agency: { id: a!.id, slug: a!.slug, name: a!.name, appName: a!.appName, status: a!.status, domain: { requested: a!.requestedDomain, state: a!.domainState, simulated: true } },
      revision: { id: rev!.id, number: rev!.number, state: rev!.state },
      steps: steps.map((s) => ({
        key: s.stepKey as ActivationStepKey,
        seq: s.seq,
        state: s.state,
        startedAt: s.startedAt?.toISOString() ?? null,
        finishedAt: s.finishedAt?.toISOString() ?? null,
        detail: s.detail as Record<string, unknown>,
        error: s.error,
      })),
      result: run.state === "succeeded" ? { path: `/a/${a!.slug}`, domainPending: a!.requestedDomain !== null && a!.domainState !== "simulated_ready" } : null,
      waitingFor: run.state === "waiting" ? (((failed?.detail as { waitingFor?: string }) ?? {}).waitingFor ?? "access") : null,
      canRetry: run.state === "failed" || run.state === "waiting",
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    }
  })
}

const IdempotencyKey = z.string().min(8).max(200).regex(/^[A-Za-z0-9_.:-]+$/)

/**
 * "Deploy demo agency": validates, persists an activation run with the eight
 * steps and executes them. Idempotent: the same key — or any second start for
 * the same configuration revision — returns the existing run (and resumes it
 * if it was interrupted), never a second workspace.
 */
export async function startActivation(session: SessionInfo, draftId: string, idempotencyKey: string): Promise<ActivationRunView> {
  if (!IdempotencyKey.safeParse(idempotencyKey).success) throw new DomainError("validation", "Invalid idempotency key", { field: "idempotencyKey" })
  const { agency: a, rev } = await loadOwnedRevision(session, draftId)
  const [existing] = await withTenant(a.id, (tx) =>
    tx
      .select()
      .from(activationRun)
      .where(eq(activationRun.configurationRevisionId, rev.id))
      .orderBy(desc(activationRun.createdAt))
      .limit(1)
  )
  if (existing) {
    if (existing.state === "queued" || existing.state === "running") await advanceRun(a.id, existing.id, session)
    return runView(a.id, existing.id)
  }
  if (rev.state !== "draft") throw new DomainError("blocked_by_rule", "This configuration is not a deployable draft", { rule: "draft_not_deployable", state: rev.state })
  const validation = await withTenant(a.id, (tx) => validateRevisionTx(tx, a, rev))
  if (!validation.valid) {
    throw new DomainError("blocked_by_rule", "The configuration has blocking issues", { rule: "configuration_invalid", blockers: validation.blockers })
  }
  const runId = await withTenant(a.id, async (tx) => {
    const inserted = await tx
      .insert(activationRun)
      .values({ tenantId: a.id, configurationRevisionId: rev.id, state: "queued", idempotencyKey, createdBy: session.user.id })
      .onConflictDoNothing()
      .returning({ id: activationRun.id })
    if (!inserted[0]) {
      const [same] = await tx.select({ id: activationRun.id }).from(activationRun).where(and(eq(activationRun.tenantId, a.id), eq(activationRun.idempotencyKey, idempotencyKey))).limit(1)
      return { id: same!.id, created: false }
    }
    await tx.insert(activationStep).values(ACTIVATION_STEPS.map((stepKey, i) => ({ tenantId: a.id, runId: inserted[0]!.id, seq: i + 1, stepKey })))
    await tx.update(configurationRevision).set({ state: "validating", updatedAt: new Date() }).where(eq(configurationRevision.id, rev.id))
    await insertControlEvent(tx, a.id, session.user.id, {
      eventType: "activation.started",
      aggregateType: "activation_run",
      aggregateId: inserted[0].id,
      payload: { revisionId: rev.id, number: rev.number },
    })
    return { id: inserted[0].id, created: true }
  })
  if (runId.created) await advanceRun(a.id, runId.id, session)
  return runView(a.id, runId.id)
}

async function locateRun(session: SessionInfo, runId: string) {
  if (session.user.kind !== "agency") throw new DomainError("forbidden", "The control plane requires an agency identity")
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new DomainError("not_found", "Activation not found")
  const ms = await db()
    .select({ tenantId: membership.tenantId, role: membership.role })
    .from(membership)
    .where(and(eq(membership.userId, session.user.id), eq(membership.active, true)))
  for (const m of ms) {
    const [run] = await withTenant(m.tenantId, (tx) => tx.select({ id: activationRun.id }).from(activationRun).where(eq(activationRun.id, runId)).limit(1))
    if (run) return { tenantId: m.tenantId, role: m.role }
  }
  throw new DomainError("not_found", "Activation not found")
}

/** P04: persisted run + steps (any member of the agency may view; survives refresh). */
export async function getActivationRun(session: SessionInfo, runId: string): Promise<ActivationRunView> {
  const { tenantId } = await locateRun(session, runId)
  return runView(tenantId, runId)
}

/**
 * "Retry failed step": resumes a failed/waiting run from the failed step
 * (completed steps are not repeated). Owner only.
 */
export async function retryFailedStep(session: SessionInfo, runId: string): Promise<ActivationRunView> {
  const { tenantId, role } = await locateRun(session, runId)
  if (role !== "owner") throw new DomainError("forbidden", "Only an owner can resume an activation")
  const reopened = await withTenant(tenantId, async (tx) => {
    const [run] = await tx.select().from(activationRun).where(eq(activationRun.id, runId)).for("update").limit(1)
    if (!run || (run.state !== "failed" && run.state !== "waiting")) return false
    await tx.update(activationRun).set({ state: "running", finishedAt: null }).where(eq(activationRun.id, runId))
    const [a] = await tx.select({ status: agency.status }).from(agency).where(eq(agency.id, tenantId)).limit(1)
    if (a?.status === "blocked") await tx.update(agency).set({ status: "activating", updatedAt: new Date() }).where(eq(agency.id, tenantId))
    const published = await tx
      .select({ id: activationStep.id })
      .from(activationStep)
      .where(and(eq(activationStep.runId, runId), eq(activationStep.stepKey, "publish_configuration"), eq(activationStep.state, "succeeded")))
    await tx
      .update(configurationRevision)
      .set({ state: published.length ? "provisioning" : "validating", updatedAt: new Date() })
      .where(and(eq(configurationRevision.id, run.configurationRevisionId), eq(configurationRevision.state, "blocked")))
    await insertControlEvent(tx, tenantId, session.user.id, { eventType: "activation.retried", aggregateType: "activation_run", aggregateId: runId, payload: {} })
    return true
  })
  if (!reopened) throw new DomainError("blocked_by_rule", "Only a failed or waiting activation can be retried", { rule: "not_retryable" })
  await advanceRun(tenantId, runId, session)
  return runView(tenantId, runId)
}

const NEXT_DOMAIN_STATE: Partial<Record<DomainState, DomainState>> = {
  requested: "pending_dns",
  pending_dns: "verifying",
  verifying: "simulated_ready",
}

/**
 * "Simulate DNS verification": advances the requested `.example` domain one
 * state (Requested → Pending DNS → Verifying → Simulated ready). Fixture-driven;
 * no DNS lookup is made. `expectedState` makes a double click harmless.
 */
export async function simulateDnsVerification(
  session: SessionInfo,
  agencyId: string,
  expectedState: DomainState
): Promise<{ domain: string; previous: DomainState; state: DomainState; simulated: true; realDnsChecked: false }> {
  const owned = await loadOwnedAgency(session, agencyId)
  return withTenant(owned.id, async (tx) => {
    const [a] = (await tx.select().from(agency).where(eq(agency.id, owned.id)).for("update").limit(1)) as AgencyRow[]
    if (!a!.requestedDomain) throw new DomainError("blocked_by_rule", "No custom domain requested", { rule: "no_domain_requested" })
    if (a!.status !== "ready") throw new DomainError("blocked_by_rule", "Activate the workspace first", { rule: "workspace_not_ready" })
    const current = a!.domainState as DomainState
    if (current !== expectedState) {
      throw new DomainError("revision_conflict", "The domain state changed", { aggregate: "agency_domain", expectedState, currentState: current })
    }
    const next = NEXT_DOMAIN_STATE[current]
    if (!next) throw new DomainError("blocked_by_rule", "Domain simulation already complete", { rule: "domain_simulation_complete", state: current })
    await tx.update(agency).set({ domainState: next, updatedAt: new Date(), revision: sql`${agency.revision} + 1` }).where(eq(agency.id, a!.id))
    await insertControlEvent(tx, a!.id, session.user.id, {
      eventType: "domain.simulation_advanced",
      aggregateType: "agency",
      aggregateId: a!.id,
      payload: { domain: a!.requestedDomain, from: current, to: next, simulated: true },
    })
    await auditPlatform({ eventType: "control.domain_simulated", actorUserId: session.user.id, tenantId: a!.id, payload: { from: current, to: next } }, tx)
    return { domain: a!.requestedDomain!, previous: current, state: next, simulated: true as const, realDnsChecked: false as const }
  })
}
