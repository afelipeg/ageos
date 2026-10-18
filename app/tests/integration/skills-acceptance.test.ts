// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { and, eq, sql } from "drizzle-orm"

import { CAPABILITY_CONTRACTS } from "@/lib/capabilities/catalog.generated"
import { INPUT_FIELDS } from "@/lib/capabilities/input-fields"
import type { AgencyContext } from "@/server/auth/context"
import { FIXTURES, HANDLER_VERSION, HANDLERS } from "@/server/capabilities/registry"
import { runCapability, type RunOutcome } from "@/server/capabilities/runner"
import type { CapabilityFixture } from "@/server/capabilities/types"
import { businessEvent, idempotencyRecord, workflowRun, workflowRunStep } from "@/server/db/schema"

import { closeOwnerDb, key, ownerDb, resetDemo } from "./helpers"
import { ctxForActor, diffSnapshots, eventCounts, settleBlocked, snapshotDb } from "./qa-helpers"

// ERP-01..ERP-42 acceptance harness (J10). For every catalog skill with a
// handler AND fixtures it runs the positive case (succeeded, every
// repositoryOutputs key present, fixture verify, persisted run + events) and
// the negative case (blocked by expectCode/expectRule with no side effect in
// any table), each on a freshly seeded tenant and again as a re-run.
// Skills without handler or fixtures are recorded as `pending`, never passed.
// Results are written to evidence/skill-verification.json, from which the
// registry derives `scenario_verified`.

type CaseResult = "passed" | "failed" | "pending" | "not_run"
type SkillRecord = {
  positive: CaseResult
  negative: CaseResult
  replay: CaseResult
  handlerVersion: string | null
  handlerKind: "command" | "query" | null
  ranAt: string | null
  notes: string[]
}

const RESULTS = new Map<string, SkillRecord>()
const EVIDENCE_DIR = path.resolve(process.cwd(), "evidence")

function record(skillId: string): SkillRecord {
  let r = RESULTS.get(skillId)
  if (!r) {
    const h = HANDLERS[skillId]
    r = {
      positive: "not_run",
      negative: "not_run",
      replay: "not_run",
      handlerVersion: h ? HANDLER_VERSION : null,
      handlerKind: h?.kind ?? null,
      ranAt: null,
      notes: [],
    }
    RESULTS.set(skillId, r)
  }
  return r
}

const actorCtx = (k: string) => ctxForActor(k)

async function persistedRun(runId: string) {
  const [run] = await ownerDb().select().from(workflowRun).where(eq(workflowRun.id, runId))
  const steps = await ownerDb().select().from(workflowRunStep).where(eq(workflowRunStep.runId, runId))
  const events = await ownerDb().select().from(businessEvent).where(eq(businessEvent.correlationId, runId))
  return { run, steps, events }
}

async function runPositive(skillId: string, fixture: CapabilityFixture, label: string) {
  const contract = CAPABILITY_CONTRACTS.find((c) => c.skillId === skillId)!
  const handler = HANDLERS[skillId]!
  const fx = await fixture.positive(actorCtx)
  const ctx: AgencyContext = await actorCtx(fx.actorKey)
  const idem = key(`acc-${skillId}-${label}`)
  const declared = new Set((INPUT_FIELDS[skillId] ?? []).map((f) => f.key))
  const undeclared = Object.keys(fx.input).filter((k) => !declared.has(k))
  expect(undeclared, `positive input uses keys the workbench/assistant cannot send: ${undeclared.join(", ")}`).toEqual([])

  const outcome: RunOutcome = await runCapability(ctx, skillId, fx.input, {
    origin: "ui",
    idempotencyKey: idem,
    expectedRevision: fx.expectedRevision,
  })
  expect(outcome.error, `positive ${label} blocked: ${JSON.stringify(outcome.error)}`).toBeNull()
  expect(outcome.state).toBe("succeeded")
  expect(outcome.replayed).toBe(false)

  const out = outcome.output
  expect(out !== null && typeof out === "object", "output must be an object").toBe(true)
  const missing = contract.repositoryOutputs.filter((k) => !(k in (out as Record<string, unknown>)))
  expect(missing, `output is missing repositoryOutputs keys: ${missing.join(", ")}`).toEqual([])

  if (fx.verify) await fx.verify(out, ctx)

  const { run, steps, events } = await persistedRun(outcome.runId)
  expect(run, "workflow_run persisted").toBeDefined()
  expect(run!.state).toBe("succeeded")
  expect(run!.skillId).toBe(skillId)
  expect(run!.handlerVersion).toBe(HANDLER_VERSION)
  expect(run!.actorUserId).toBe(ctx.user.id)
  expect(run!.tenantId).toBe(ctx.tenant.id)
  expect((run!.output as { result: unknown }).result).toEqual(out)
  expect(steps.length).toBeGreaterThan(0)
  if (handler.kind === "command") {
    expect(events.length, "a command run must persist business events correlated to its run").toBeGreaterThan(0)
    expect(events.every((e) => e.tenantId === ctx.tenant.id && e.actorUserId === ctx.user.id)).toBe(true)
    const idemRows = await ownerDb()
      .select()
      .from(idempotencyRecord)
      .where(and(eq(idempotencyRecord.tenantId, ctx.tenant.id), eq(idempotencyRecord.idempotencyKey, `${skillId}:${idem}`)))
    expect(idemRows).toHaveLength(1)
  }
  return { ctx, fx, idem, outcome, events: events.length }
}

async function runNegative(skillId: string, fixture: CapabilityFixture, label: string) {
  const fx = await fixture.negative(actorCtx)
  const ctx = await actorCtx(fx.actorKey)
  const before = await snapshotDb()
  const beforeEvents = await eventCounts()
  const settled = await settleBlocked(
    runCapability(ctx, skillId, fx.input, { origin: "ui", idempotencyKey: key(`neg-${skillId}-${label}`), expectedRevision: fx.expectedRevision })
  )
  const after = await snapshotDb()
  const afterEvents = await eventCounts()
  expect(settled.ok, `negative ${label} unexpectedly succeeded`).toBe(false)
  if (settled.ok) return
  const err = settled.error
  expect(err.code, `negative ${label}: expected ${fx.expectCode}, got ${err.code} (${err.message})`).toBe(fx.expectCode)
  if (fx.expectRule) expect(err.details.rule, `negative ${label}: rule`).toBe(fx.expectRule)
  expect(err.message.trim().length, "blocked result carries a useful message").toBeGreaterThan(0)
  const changed = diffSnapshots(before, after)
  expect(changed, `negative ${label} left side effects: ${changed.join("; ")}`).toEqual([])
  const eventDelta = [...afterEvents].filter(([t, n]) => (beforeEvents.get(t) ?? 0) !== n).map(([t]) => t)
  expect(eventDelta, `negative ${label} emitted business events`).toEqual([])
  return err
}

beforeAll(() => {
  for (const c of CAPABILITY_CONTRACTS) record(c.skillId)
})

afterAll(async () => {
  const [{ name: database }] = (await ownerDb().execute(sql`select current_database() as name`)) as unknown as { name: string }[]
  await closeOwnerDb()
  const skills: Record<string, Omit<SkillRecord, "handlerKind"> & { handlerKind: string | null }> = {}
  let complete = true
  for (const c of CAPABILITY_CONTRACTS) {
    const r = record(c.skillId)
    if (r.positive === "not_run" || r.negative === "not_run") complete = false
    skills[c.skillId] = r
  }
  const doc = {
    generatedAt: new Date().toISOString(),
    handlerVersion: HANDLER_VERSION,
    harness: "tests/integration/skills-acceptance.test.ts",
    database,
    summary: {
      skills: CAPABILITY_CONTRACTS.length,
      positivePassed: Object.values(skills).filter((s) => s.positive === "passed").length,
      negativePassed: Object.values(skills).filter((s) => s.negative === "passed").length,
      pending: Object.values(skills).filter((s) => s.positive === "pending").length,
      failed: Object.values(skills).filter((s) => s.positive === "failed" || s.negative === "failed").length,
    },
    skills,
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  // A filtered run (-t) must not overwrite the full acceptance record.
  const file = complete ? "skill-verification.json" : "skill-verification.partial.json"
  writeFileSync(path.join(EVIDENCE_DIR, file), JSON.stringify(doc, null, 2) + "\n")
})

describe("acceptance harness covers the canonical catalog", () => {
  it("has exactly 42 unique skill ids", () => {
    const ids = CAPABILITY_CONTRACTS.map((c) => c.skillId)
    expect(ids).toHaveLength(42)
    expect(new Set(ids).size).toBe(42)
  })

  it("every handler input schema has exactly the declared workbench input fields", () => {
    const mismatches: string[] = []
    for (const [skillId, h] of Object.entries(HANDLERS)) {
      if (!h) continue
      const schema = (h.kind === "command" ? h.command.input : h.input) as unknown as { shape?: Record<string, unknown> }
      const keys = Object.keys(schema.shape ?? {}).sort()
      const declared = (INPUT_FIELDS[skillId] ?? []).map((f) => f.key).sort()
      if (JSON.stringify(keys) !== JSON.stringify(declared)) mismatches.push(`${skillId}: schema [${keys}] vs input-fields [${declared}]`)
    }
    expect(mismatches).toEqual([])
  })
})

for (const contract of CAPABILITY_CONTRACTS) {
  const skillId = contract.skillId
  const handler = HANDLERS[skillId]
  const fixture = FIXTURES[skillId]

  if (!handler || !fixture) {
    const r = record(skillId)
    r.positive = "pending"
    r.negative = "pending"
    r.replay = "pending"
    r.notes.push(!handler ? "no handler registered (status: registered)" : "handler present but no acceptance fixtures")
    describe(`${skillId} (${contract.acceptance.testId})`, () => {
      it.todo(`positive: ${contract.acceptance.positive} — pending: ${r.notes[0]}`)
      it.todo(`negative: ${contract.acceptance.negative} — pending: ${r.notes[0]}`)
    })
    continue
  }

  describe(`${skillId} (${contract.acceptance.testId})`, () => {
    let first: Awaited<ReturnType<typeof runPositive>> | null = null

    it(`positive on a fresh seed and as a re-run: ${contract.acceptance.positive}`, async () => {
      const r = record(skillId)
      r.ranAt = new Date().toISOString()
      try {
        await resetDemo()
        first = await runPositive(skillId, fixture, "fresh")
        await runPositive(skillId, fixture, "rerun")
        r.positive = "passed"
      } catch (e) {
        r.positive = "failed"
        r.notes.push(`positive: ${(e as Error).message.split("\n")[0]}`)
        throw e
      }
    })

    it("replays the same key + payload without a second effect", async () => {
      const r = record(skillId)
      if (!first) {
        r.replay = "failed"
        r.notes.push("replay: positive did not complete")
        throw new Error("positive did not complete")
      }
      try {
        const before = await snapshotDb()
        const again = await runCapability(first.ctx, skillId, first.fx.input, {
          origin: "ui",
          idempotencyKey: first.idem,
          expectedRevision: first.fx.expectedRevision,
        })
        expect(again.replayed).toBe(true)
        expect(again.runId).toBe(first.outcome.runId)
        expect(again.state).toBe("succeeded")
        expect(again.output).toEqual(first.outcome.output)
        expect(diffSnapshots(before, await snapshotDb())).toEqual([])
        r.replay = "passed"
      } catch (e) {
        r.replay = "failed"
        r.notes.push(`replay: ${(e as Error).message.split("\n")[0]}`)
        throw e
      }
    })

    it(`negative on a fresh seed and as a re-run: ${contract.acceptance.negative}`, async () => {
      const r = record(skillId)
      try {
        await resetDemo()
        const err = await runNegative(skillId, fixture, "fresh")
        await runNegative(skillId, fixture, "rerun")
        r.negative = "passed"
        if (err) r.notes.push(`negative blocked: ${err.code}${err.details.rule ? ` / ${String(err.details.rule)}` : ""}${err.thrown ? " (thrown before run)" : ""}`)
      } catch (e) {
        r.negative = "failed"
        r.notes.push(`negative: ${(e as Error).message.split("\n")[0]}`)
        throw e
      }
    })
  })
}

describe("harness self-check", () => {
  it("never records a pending skill as passed", () => {
    for (const [id, r] of RESULTS) {
      if (!HANDLERS[id] || !FIXTURES[id]) {
        expect(r.positive).toBe("pending")
        expect(r.negative).toBe("pending")
      }
    }
  })

  it("the test database is not the dev database", async () => {
    const [{ name }] = (await ownerDb().execute(sql`select current_database() as name`)) as unknown as { name: string }[]
    expect(name).toMatch(/^ageos_test(_[a-z0-9]+)?$/)
  })
})
