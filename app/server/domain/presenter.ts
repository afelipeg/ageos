import "server-only"

import { and, desc, eq, like, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { z } from "zod"

import { BUSINESS_AS_OF, DEMO_SEED_VERSION } from "@/lib/demo"
import { fixtureUuid } from "@/lib/fixture-ids"
import { auditPlatform, createSession, revokeSession, type SessionInfo } from "@/server/auth/session"
import { db } from "@/server/db/client"
import * as schema from "@/server/db/schema"
import { agency, appUser, demoRun } from "@/server/db/schema"
import { env, isDemoMode } from "@/server/env"
import { DomainError } from "@/server/kernel/errors"
import { DEMO_USERS, PLATFORM_USERS, SEED_MODES, seedDemo, type SeedMode } from "@/server/seed/demo-seed"

// Presenter tools (/demo/presenter). Only a session opened with the server-held
// access code (presenterUserId set) in demo mode may use them. Persona switch
// is limited to the synthetic fixture identities. Reset/checkpoint loads are
// the ONLY place the running app uses the schema-owner connection
// (DATABASE_URL_MIGRATIONS), and only while AGEOS_DEMO_MODE=true: the scoped
// reset deletes demo-tenant rows under RLS-bypassing ownership, so it cannot
// run as the application role. Every action is audited in platform_audit_event,
// which the reset never deletes.

export type PersonaKey = (typeof DEMO_USERS)[number]["key"] | (typeof PLATFORM_USERS)[number]["key"]

export type Persona = {
  key: PersonaKey
  name: string
  kind: "agency" | "platform"
  role: string
  tenantSlug: string | null
  /** Where the persona lands after switching. */
  home: string
}

const TENANT_SLUG: Record<string, string> = {
  [fixtureUuid("tenant_demo_rayo")]: "rayo-de-sol",
  [fixtureUuid("tenant_demo_norte")]: "norte-studio",
}

/** The synthetic personas a presenter may act as (never arbitrary users). */
export const PERSONAS: readonly Persona[] = [
  ...DEMO_USERS.map((u) => ({ key: u.key, name: u.name, kind: "agency" as const, role: u.role, tenantSlug: TENANT_SLUG[u.tenant]!, home: `/a/${TENANT_SLUG[u.tenant]}` })),
  ...PLATFORM_USERS.map((u) => ({ key: u.key, name: u.name, kind: "platform" as const, role: u.role, tenantSlug: null, home: "/ops" })),
]

export const DEMO_RESET_LOCK_KEY = 4_242_000_001
export const MAX_CLOCK_ADVANCE_DAYS = 90

/** Throws unless this is an authorized presenter session in demo mode. */
export function assertPresenter(session: SessionInfo): string {
  if (!isDemoMode() || !session.presenter || !session.presenterUserId) {
    throw new DomainError("forbidden", "Presenter tools are available only to the authorized presenter in demo mode")
  }
  return session.presenterUserId
}

/** Presenter launcher: personas with the one currently active. */
export function listPersonas(session: SessionInfo): (Persona & { current: boolean })[] {
  assertPresenter(session)
  return PERSONAS.map((p) => ({ ...p, current: fixtureUuid(p.key) === session.user.id }))
}

/**
 * Opens a NEW session as a synthetic persona (cookie rotation: the old session
 * is revoked) keeping the real presenter as `presenterUserId`. Audited.
 * The caller (server action) sets the returned token as the session cookie.
 */
export async function switchPersona(session: SessionInfo, personaKey: string): Promise<{ token: string; expiresAt: Date; persona: Persona }> {
  const presenter = assertPresenter(session)
  const persona = PERSONAS.find((p) => p.key === personaKey)
  if (!persona) throw new DomainError("forbidden", "Not a demo persona", { personaKey })
  const userId = fixtureUuid(persona.key)
  const [u] = await db().select({ id: appUser.id, demoPersona: appUser.demoPersona }).from(appUser).where(eq(appUser.id, userId)).limit(1)
  if (!u?.demoPersona) throw new DomainError("forbidden", "Not a demo persona", { personaKey })
  const { token, expiresAt } = await createSession({ userId, presenterUserId: presenter })
  await revokeSession(session.sessionId)
  await auditPlatform({ eventType: "presenter.persona_switched", actorUserId: presenter, payload: { from: session.user.id, to: userId, personaKey: persona.key } })
  return { token, expiresAt, persona }
}

// ── Reset and checkpoints (owner connection, exclusive) ──

async function withOwnerLock<T>(fn: (ownerDb: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): Promise<T> {
  const url = env().DATABASE_URL_MIGRATIONS
  if (!isDemoMode() || !url) {
    throw new DomainError("forbidden", "Demo reset is disabled (requires AGEOS_DEMO_MODE=true and the owner connection)")
  }
  // One dedicated connection: the session-level advisory lock and every reset
  // statement run on it, and closing it releases the lock even on failure.
  const sqlc = postgres(url, { max: 1, onnotice: () => {} })
  try {
    const [row] = await sqlc<{ locked: boolean }[]>`select pg_try_advisory_lock(${DEMO_RESET_LOCK_KEY}) as locked`
    if (!row?.locked) throw new DomainError("blocked_by_rule", "Another demo reset is running", { rule: "reset_in_progress" })
    try {
      return await fn(drizzle(sqlc, { schema }))
    } finally {
      await sqlc`select pg_advisory_unlock(${DEMO_RESET_LOCK_KEY})`
    }
  } finally {
    await sqlc.end()
  }
}

export type ResetResult = { demoRunId: string; checkpoint: SeedMode; tenantsReset: number; tenantSlug: string }

/**
 * Rebuilds the demo run that owns `tenantSlug` (demo tenants only) at a
 * checkpoint. The demo fixture is one run: Rayo de Sol + its isolation tenant
 * Norte Studio + agencies created during the run (demo marker); non-demo
 * tenants, other uploads and the platform audit stream are never touched.
 * `confirm` must equal the tenant slug. Refuses while another reset runs.
 */
export async function resetDemoTenant(
  session: SessionInfo,
  tenantSlug: string,
  opts: { confirm: string; checkpoint?: SeedMode }
): Promise<ResetResult> {
  const presenter = assertPresenter(session)
  const checkpoint = opts.checkpoint ?? "ready_for_scope_review"
  if (!SEED_MODES.includes(checkpoint)) throw new DomainError("validation", "Unknown checkpoint", { field: "checkpoint" })
  const [target] = await db()
    .select({ id: agency.id, slug: agency.slug })
    .from(agency)
    .where(and(eq(agency.slug, tenantSlug), like(agency.demoSeedVersion, `${DEMO_SEED_VERSION}%`)))
    .limit(1)
  if (!target) throw new DomainError("not_found", "Not a demo tenant", { tenantSlug })
  if (opts.confirm !== tenantSlug) {
    throw new DomainError("validation", "Type the tenant slug to confirm the reset", { issues: [{ path: "confirm", code: "confirmation_required" }] })
  }
  await auditPlatform({ eventType: "presenter.demo_reset_requested", actorUserId: presenter, tenantId: target.id, payload: { tenantSlug, checkpoint } })
  const res = await withOwnerLock((ownerDb) =>
    seedDemo(ownerDb, { storageDir: env().AGEOS_STORAGE_DIR, reset: true, mode: checkpoint, actor: presenter })
  )
  if (!res.seeded) throw new DomainError("internal", "Demo seed did not run")
  // Outside the reset set: survives this and every later reset.
  await auditPlatform({
    eventType: "presenter.demo_reset",
    actorUserId: presenter,
    tenantId: target.id,
    payload: { tenantSlug, checkpoint, demoRunId: res.demoRunId, tenantsReset: res.tenantsReset, skippedExtensions: res.skippedExtensions },
  })
  return { demoRunId: res.demoRunId, checkpoint, tenantsReset: res.tenantsReset, tenantSlug }
}

/**
 * Loads a prepared checkpoint of the Rayo de Sol demo run:
 * `from_intake` (configured agency + masters; financial entities arise via
 * commands) or `ready_for_scope_review` (approved plan, 100h forecast).
 * `confirm` must equal the checkpoint id.
 */
export async function loadCheckpoint(session: SessionInfo, checkpoint: SeedMode, opts: { confirm: string }): Promise<ResetResult> {
  assertPresenter(session)
  if (!SEED_MODES.includes(checkpoint)) throw new DomainError("validation", "Unknown checkpoint", { field: "checkpoint" })
  if (opts.confirm !== checkpoint) {
    throw new DomainError("validation", "Type the checkpoint id to confirm", { issues: [{ path: "confirm", code: "confirmation_required" }] })
  }
  return resetDemoTenant(session, "rayo-de-sol", { confirm: "rayo-de-sol", checkpoint })
}

// ── Fixed business clock ──

export type DemoClock = {
  demoRunId: string | null
  checkpoint: string | null
  /** Business "today" of the demo (YYYY-MM-DD). Audit timestamps stay real. */
  businessDate: string
  baseDate: string
  advancedDays: number
  startedAt: string | null
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** Current demo run and its fixed business date (BUSINESS_AS_OF unless the presenter advanced it). */
export async function getDemoClock(): Promise<DemoClock> {
  const [run] = await db().select().from(demoRun).where(eq(demoRun.state, "active")).orderBy(desc(demoRun.startedAt)).limit(1)
  const businessDate = run?.businessDate ?? BUSINESS_AS_OF
  return {
    demoRunId: run?.id ?? null,
    checkpoint: run?.checkpoint ?? null,
    businessDate,
    baseDate: BUSINESS_AS_OF,
    advancedDays: daysBetween(BUSINESS_AS_OF, businessDate),
    startedAt: run?.startedAt.toISOString() ?? null,
  }
}

/** Server-side business date for domain code that honors presenter clock advances. */
export async function getBusinessDate(): Promise<string> {
  return (await getDemoClock()).businessDate
}

export const AdvanceClockInput = z
  .object({
    days: z.number().int().min(1).max(31),
    reason: z.string().trim().min(3).max(200),
    /** The business date the presenter saw (double click → conflict, not two advances). */
    expectedBusinessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()

/** Presenter-authorized, audited forward move of the business clock (never ages real records). */
export async function advanceBusinessClock(session: SessionInfo, input: z.input<typeof AdvanceClockInput>): Promise<DemoClock> {
  const presenter = assertPresenter(session)
  const parsed = AdvanceClockInput.safeParse(input)
  if (!parsed.success) throw new DomainError("validation", "Invalid clock advance", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) })
  const clock = await getDemoClock()
  if (!clock.demoRunId) throw new DomainError("blocked_by_rule", "No active demo run", { rule: "no_demo_run" })
  if (clock.advancedDays + parsed.data.days > MAX_CLOCK_ADVANCE_DAYS) {
    throw new DomainError("blocked_by_rule", "Clock advance limit reached", { rule: "clock_advance_limit", maxDays: MAX_CLOCK_ADVANCE_DAYS })
  }
  const next = new Date(Date.parse(`${parsed.data.expectedBusinessDate}T00:00:00Z`) + parsed.data.days * 86_400_000).toISOString().slice(0, 10)
  const rows = await db()
    .update(demoRun)
    .set({ businessDate: next, revision: sql`${demoRun.revision} + 1` })
    .where(and(eq(demoRun.id, clock.demoRunId), eq(demoRun.state, "active"), eq(demoRun.businessDate, parsed.data.expectedBusinessDate)))
    .returning({ id: demoRun.id })
  if (!rows[0]) {
    throw new DomainError("revision_conflict", "The business date changed", { aggregate: "demo_clock", expected: parsed.data.expectedBusinessDate, current: clock.businessDate })
  }
  await auditPlatform({
    eventType: "presenter.clock_advanced",
    actorUserId: presenter,
    payload: { demoRunId: clock.demoRunId, from: parsed.data.expectedBusinessDate, to: next, days: parsed.data.days, reason: parsed.data.reason },
  })
  return getDemoClock()
}
