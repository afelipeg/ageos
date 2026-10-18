// @vitest-environment node
import { and, count, eq, inArray, like } from "drizzle-orm"
import postgres from "postgres"

import { createSession, loadSession, type SessionInfo } from "@/server/auth/session"
import * as schema from "@/server/db/schema"
import { createAgencyDraft } from "@/server/domain/configuration"
import {
  advanceBusinessClock,
  DEMO_RESET_LOCK_KEY,
  getDemoClock,
  listPersonas,
  loadCheckpoint,
  PERSONAS,
  resetDemoTenant,
  switchPersona,
} from "@/server/domain/presenter"
import { DomainError } from "@/server/kernel/errors"
import { seedModeFromArgv } from "@/server/seed/demo-seed"

import { closeOwnerDb, id, key, ownerDb, resetDemo, sessionFor } from "./helpers"

async function expectError(p: Promise<unknown> | (() => unknown), code: string, rule?: string) {
  const run = typeof p === "function" ? Promise.resolve().then(p) : p
  await expect(run).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code && (rule === undefined || e.details.rule === rule))
}

/** A real presenter session: opened like the access-code sign-in (presenterUserId = owner). */
async function presenterSession(): Promise<{ session: SessionInfo; token: string }> {
  const owner = id("user_demo_owner")
  const { token } = await createSession({ userId: owner, presenterUserId: owner })
  const session = await loadSession(token)
  if (!session) throw new Error("no session")
  return { session, token }
}

async function auditCount(eventType: string) {
  const [r] = await ownerDb().select({ n: count() }).from(schema.platformAuditEvent).where(eq(schema.platformAuditEvent.eventType, eventType))
  return r!.n
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("presenter guard", () => {
  it("ordinary sessions (even the owner without the access code) cannot use presenter tools", async () => {
    const owner = await sessionFor("user_demo_owner")
    expect(owner.presenter).toBe(false)
    await expectError(() => listPersonas(owner), "forbidden")
    await expectError(switchPersona(owner, "user_demo_finance"), "forbidden")
    await expectError(resetDemoTenant(owner, "rayo-de-sol", { confirm: "rayo-de-sol" }), "forbidden")
    await expectError(advanceBusinessClock(owner, { days: 1, reason: "Try", expectedBusinessDate: "2027-03-15" }), "forbidden")
  })
})

describe("persona switch", () => {
  it("rotates the session cookie to a synthetic persona and audits it", async () => {
    const { session, token } = await presenterSession()
    expect(session.presenter).toBe(true)
    expect(listPersonas(session).find((p) => p.current)?.key).toBe("user_demo_owner")
    expect(PERSONAS.map((p) => p.key)).toEqual([
      "user_demo_owner",
      "user_demo_operator",
      "user_demo_finance",
      "user_demo_producer",
      "user_demo_viewer",
      "user_demo_norte_owner",
      "user_demo_platform_operator",
      "user_demo_platform_admin",
    ])
    await expectError(switchPersona(session, "user_not_a_persona"), "forbidden")
    const before = await auditCount("presenter.persona_switched")
    const res = await switchPersona(session, "user_demo_finance")
    expect(res.persona.home).toBe("/a/rayo-de-sol")
    expect(await loadSession(token)).toBeNull() // old cookie revoked
    const next = await loadSession(res.token)
    expect(next?.user.id).toBe(id("user_demo_finance"))
    expect(next?.presenter).toBe(true)
    expect(next?.presenterUserId).toBe(id("user_demo_owner"))
    const platform = await switchPersona(next!, "user_demo_platform_admin")
    expect(platform.persona).toMatchObject({ kind: "platform", home: "/ops" })
    const admin = await loadSession(platform.token)
    expect(admin?.user.kind).toBe("platform")
    expect(await auditCount("presenter.persona_switched")).toBe(before + 2)
  })
})

describe("demo reset and checkpoints", () => {
  it("requires typed confirmation, refuses non-demo tenants and concurrent resets", async () => {
    const { session } = await presenterSession()
    await expectError(resetDemoTenant(session, "rayo-de-sol", { confirm: "yes" }), "validation")
    const realId = id(`test:real-agency:${Date.now()}`)
    await ownerDb().insert(schema.agency).values({ id: realId, slug: `real-${Date.now().toString(36)}`, name: "Real", appName: "Real", status: "ready", baseCurrency: "USD", timezone: "UTC" })
    const [real] = await ownerDb().select().from(schema.agency).where(eq(schema.agency.id, realId))
    await expectError(resetDemoTenant(session, real!.slug, { confirm: real!.slug }), "not_found")
    const lock = postgres(process.env.DATABASE_URL_MIGRATIONS!, { max: 1, onnotice: () => {} })
    try {
      await lock`select pg_advisory_lock(${DEMO_RESET_LOCK_KEY})`
      await expectError(resetDemoTenant(session, "rayo-de-sol", { confirm: "rayo-de-sol" }), "blocked_by_rule", "reset_in_progress")
    } finally {
      await lock`select pg_advisory_unlock(${DEMO_RESET_LOCK_KEY})`
      await lock.end()
    }
  })

  it("resets only the demo run (demo-created agencies removed, real tenants and audit kept) with a new demo_run_id", async () => {
    const { session } = await presenterSession()
    const owner = await sessionFor("user_demo_owner")
    const draft = await createAgencyDraft(owner, { idempotencyKey: key("reset-draft") })
    const realId = id(`test:real-kept:${Date.now()}`)
    await ownerDb().insert(schema.agency).values({ id: realId, slug: `kept-${Date.now().toString(36)}`, name: "Kept", appName: "Kept", status: "ready", baseCurrency: "USD", timezone: "UTC" })
    const clockBefore = await getDemoClock()
    const auditBefore = await auditCount("presenter.demo_reset")
    const res = await resetDemoTenant(session, "rayo-de-sol", { confirm: "rayo-de-sol" })
    expect(res.checkpoint).toBe("ready_for_scope_review")
    expect(res.demoRunId).not.toBe(clockBefore.demoRunId)
    const agencies = await ownerDb().select({ id: schema.agency.id }).from(schema.agency).where(inArray(schema.agency.id, [draft.agencyId, realId]))
    expect(agencies.map((a) => a.id)).toEqual([realId])
    expect(await auditCount("presenter.demo_reset")).toBe(auditBefore + 1)
    const [requested] = await ownerDb()
      .select({ n: count() })
      .from(schema.platformAuditEvent)
      .where(and(eq(schema.platformAuditEvent.eventType, "presenter.demo_reset_requested"), eq(schema.platformAuditEvent.tenantId, id("tenant_demo_rayo"))))
    expect(requested!.n).toBeGreaterThan(0) // pre-reset audit survived the reset
    const clock = await getDemoClock()
    expect(clock).toMatchObject({ demoRunId: res.demoRunId, checkpoint: "ready_for_scope_review", businessDate: "2027-03-15" })
    const [ended] = await ownerDb().select().from(schema.demoRun).where(eq(schema.demoRun.id, clockBefore.demoRunId!))
    expect(ended!.state).toBe("ended")
  })

  it("from_intake keeps the configured agency and masters; Aurora entities arise via commands", async () => {
    const { session } = await presenterSession()
    await expectError(loadCheckpoint(session, "from_intake", { confirm: "rayo-de-sol" }), "validation")
    const res = await loadCheckpoint(session, "from_intake", { confirm: "from_intake" })
    expect(res.checkpoint).toBe("from_intake")
    const db = ownerDb()
    const jobs = await db.select({ key: schema.job.fixtureKey }).from(schema.job).where(inArray(schema.job.tenantId, [id("tenant_demo_rayo"), id("tenant_demo_norte")]))
    expect(jobs.map((j) => j.key).sort()).toEqual(expect.not.arrayContaining(["job_demo_aurora"]))
    expect(jobs.map((j) => j.key)).toEqual(expect.arrayContaining(["job_demo_lab", "job_demo_norte"]))
    const [aurora] = await db.select({ n: count() }).from(schema.client).where(eq(schema.client.id, id("client_demo_aurora")))
    expect(aurora!.n).toBe(0)
    const [contracts] = await db.select({ n: count() }).from(schema.contract).where(eq(schema.contract.id, id("contract_aurora_po_r1")))
    expect(contracts!.n).toBe(0)
    const [rayo] = await db.select().from(schema.agency).where(eq(schema.agency.id, id("tenant_demo_rayo")))
    expect(rayo).toMatchObject({ status: "ready", publishedConfigRevisionId: id("config_rayo_r1") })
    const [supplier] = await db.select({ n: count() }).from(schema.supplier).where(eq(schema.supplier.id, id("supplier_demo_lumen")))
    expect(supplier!.n).toBe(1)
    const [incident] = await db.select().from(schema.platformIncident).where(eq(schema.platformIncident.id, id("ops_csv_delimiter_mismatch")))
    expect(incident!.state).toBe("detected")
    const [brief] = await db.select().from(schema.fileObject).where(eq(schema.fileObject.id, id("evidence_demo_brief")))
    expect(brief!.jobId).toBeNull() // document available for intake, not pre-linked
    expect((await getDemoClock()).checkpoint).toBe("from_intake")
    const seedEvents = await db
      .select({ n: count() })
      .from(schema.businessEvent)
      .where(and(eq(schema.businessEvent.tenantId, id("tenant_demo_rayo")), like(schema.businessEvent.eventType, "budget.%")))
    expect(seedEvents[0]!.n).toBe(0)

    const back = await loadCheckpoint(session, "ready_for_scope_review", { confirm: "ready_for_scope_review" })
    expect(back.checkpoint).toBe("ready_for_scope_review")
    const [job] = await db.select().from(schema.job).where(eq(schema.job.id, id("job_demo_aurora")))
    expect(job!.jobNumber).toBe("AURSL7AF0001")
  })

  it("seed scripts accept --mode", () => {
    expect(seedModeFromArgv(["--reset"])).toBe("ready_for_scope_review")
    expect(seedModeFromArgv(["--reset", "--mode=from_intake"])).toBe("from_intake")
    expect(() => seedModeFromArgv(["--mode=final"])).toThrow()
  })
})

describe("fixed business clock", () => {
  it("advances only forward, presenter-authorized, audited and optimistic; reset restores it", async () => {
    const { session } = await presenterSession()
    const start = await getDemoClock()
    expect(start.businessDate).toBe("2027-03-15")
    const before = await auditCount("presenter.clock_advanced")
    const next = await advanceBusinessClock(session, { days: 3, reason: "Show aging", expectedBusinessDate: "2027-03-15" })
    expect(next).toMatchObject({ businessDate: "2027-03-18", advancedDays: 3, demoRunId: start.demoRunId })
    await expectError(advanceBusinessClock(session, { days: 3, reason: "Double click", expectedBusinessDate: "2027-03-15" }), "revision_conflict")
    await expectError(advanceBusinessClock(session, { days: 0, reason: "Zero", expectedBusinessDate: "2027-03-18" }), "validation")
    expect(await auditCount("presenter.clock_advanced")).toBe(before + 1)
    await resetDemoTenant(session, "rayo-de-sol", { confirm: "rayo-de-sol" })
    expect((await getDemoClock()).businessDate).toBe("2027-03-15")
  })
})
