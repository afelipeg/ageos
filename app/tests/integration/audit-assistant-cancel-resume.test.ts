// @vitest-environment node
import { randomUUID } from "node:crypto"

import { and, desc, eq, inArray, like } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { assistantDriver, createScriptedDriver } from "@/server/assistant/driver"
import { SCENARIOS, type ScenarioStep } from "@/server/assistant/scenarios"
import { actionProposal, assistantMessage, assistantRun, job } from "@/server/db/schema"

import { closeOwnerDb, ctxFor, ownerDb, resetDemo } from "./helpers"
import { barrier, waitFor } from "./qa-helpers"

// Audit regressions B04 (Stop/interrupt does not stop an in-flight advance;
// a stale advance overwrites cancelled/interrupted) and B05 (no per-step
// checkpoint or durable resume after a crash between commit and response).
// The barrier wraps a scenario step in memory only (no implementation file is
// edited) to hold the driver between steps deterministically.

const CONTEXT = { route: "/a/rayo-de-sol", moduleKey: null, record: null }

function scenario(id: string) {
  const s = SCENARIOS.find((x) => x.id === id)
  if (!s) throw new Error(`scenario ${id} not found (catalog changed?)`)
  return s
}

function hold(step: ScenarioStep) {
  const original = step.run
  const entered = barrier()
  const gate = barrier()
  step.run = async (rt) => {
    entered.release()
    await gate.wait
    return original(rt)
  }
  return { entered: entered.wait, release: gate.release, restore: () => (step.run = original) }
}

/** Waits until the held step is entered, failing fast if the turn ends first. */
async function enteredOrFail(entered: Promise<void>, pending: Promise<unknown>) {
  await Promise.race([
    entered,
    pending.then(
      () => Promise.reject(new Error("the turn finished before the held step ran (scenario changed?)")),
      (e: unknown) => Promise.reject(new Error(`the turn failed before the held step ran: ${String((e as Error)?.message ?? e)}`))
    ),
  ])
}

async function latestRun(ctx: AgencyContext, scenarioId: string) {
  const [r] = await ownerDb()
    .select()
    .from(assistantRun)
    .where(and(eq(assistantRun.actorUserId, ctx.user.id), eq(assistantRun.scenarioId, scenarioId)))
    .orderBy(desc(assistantRun.startedAt))
    .limit(1)
  return r ?? null
}

async function runById(runId: string) {
  const [r] = await ownerDb().select().from(assistantRun).where(eq(assistantRun.id, runId))
  return r!
}

async function partsOfRun(runId: string) {
  const rows = await ownerDb().select().from(assistantMessage).where(eq(assistantMessage.runId, runId))
  return rows.flatMap((m) => m.parts as { type: string }[])
}

const turn = (ctx: AgencyContext, conversationId: string | null, body: { presetId?: string; text?: string }) =>
  assistantDriver.handleTurn(ctx, { conversationId, clientMessageId: randomUUID(), context: CONTEXT, ...body })

/** Drives S-JOB-CREATE to its confirmation card; returns ids. */
async function jobProposal(ctx: AgencyContext, name: string) {
  const { conversationId } = await turn(ctx, null, { presetId: "preset.job.create" })
  await turn(ctx, conversationId, { text: "Aurora Beverages" })
  await turn(ctx, conversationId, { text: name })
  const run = (await latestRun(ctx, "S-JOB-CREATE"))!
  expect(run.status, "precondition: waiting for confirmation").toBe("waiting_confirmation")
  const st = run.state as { proposalId: string; digest: string }
  return { conversationId, runId: run.id, proposalId: st.proposalId, digest: st.digest }
}

async function jobsNamed(name: string) {
  return ownerDb().select().from(job).where(like(job.name, name))
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("B04 · Stop and interruption are honored by an in-flight run", () => {
  it("Stop during a step prevents the following step and the final state stays cancelled", async () => {
    const ctx = await ctxFor("user_demo_owner")
    const margin = scenario("S-MARGIN-EXPLAIN")
    const h = hold(margin.steps[0]!)
    try {
      const pending = turn(ctx, null, { presetId: "preset.margin.aurora" })
      await enteredOrFail(h.entered, pending)
      const run = await waitFor(() => latestRun(ctx, "S-MARGIN-EXPLAIN"))
      await assistantDriver.cancel(ctx, { conversationId: run.conversationId, runId: run.id })
      h.release()
      await pending.catch(() => undefined)
      const final = await runById(run.id)
      expect(final.status, "a stale advance must not overwrite cancelled").toBe("cancelled")
      const parts = await partsOfRun(run.id)
      expect(parts.filter((p) => p.type === "margin_result"), "no step after Stop may publish results").toEqual([])
    } finally {
      h.restore()
    }
  })

  it("a new scenario interrupting a running one keeps the old run interrupted", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const margin = scenario("S-MARGIN-EXPLAIN")
    const h = hold(margin.steps[0]!)
    try {
      const pending = turn(ctx, null, { presetId: "preset.margin.aurora" })
      await enteredOrFail(h.entered, pending)
      const old = await waitFor(() => latestRun(ctx, "S-MARGIN-EXPLAIN"))
      h.restore() // the interrupting scenario must not be held
      await turn(ctx, old.conversationId, { presetId: "preset.job.create" })
      expect((await runById(old.id)).status).toBe("interrupted")
      h.release()
      await pending.catch(() => undefined)
      expect((await runById(old.id)).status, "the old advance must not overwrite interrupted").toBe("interrupted")
      expect((await partsOfRun(old.id)).filter((p) => p.type === "margin_result")).toEqual([])
    } finally {
      h.restore()
    }
  })

  it("two concurrent confirmations of one proposal create exactly one job", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const name = `B04 double confirm ${Date.now()}`
    const p = await jobProposal(ctx, name)
    const results = await Promise.allSettled([
      assistantDriver.confirm(ctx, { conversationId: p.conversationId, proposalId: p.proposalId, digest: p.digest, clientMessageId: randomUUID() }),
      assistantDriver.confirm(ctx, { conversationId: p.conversationId, proposalId: p.proposalId, digest: p.digest, clientMessageId: randomUUID() }),
    ])
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1)
    expect(await jobsNamed(name)).toHaveLength(1)
    const [prop] = await ownerDb().select().from(actionProposal).where(eq(actionProposal.id, p.proposalId))
    expect(prop!.state).toBe("executed")
  })
})

describe("B05 · crash after commit and before the response is recoverable without duplicates", () => {
  // The driver's own test seams: an injectable clock (lease expiry) and an
  // afterStep hook that runs after a step's effects and before its checkpoint
  // — a throw there is a process crash between commit and response.
  const LEASE_MS = 5_000
  function crashingDriver(clock: { t: number }, crashOn: { stepId: string | null }) {
    return createScriptedDriver({
      leaseMs: LEASE_MS,
      now: () => new Date(clock.t),
      hooks: {
        afterStep: ({ stepId }) => {
          if (crashOn.stepId === stepId) {
            crashOn.stepId = null
            throw new Error("simulated crash after commit")
          }
        },
      },
    })
  }

  async function crashAfterJobCommand(name: string) {
    const ctx = await ctxFor("user_demo_operator")
    const clock = { t: Date.now() }
    const crash = { stepId: null as string | null }
    const driver = crashingDriver(clock, crash)
    const { conversationId } = await driver.handleTurn(ctx, { conversationId: null, clientMessageId: randomUUID(), context: CONTEXT, presetId: "preset.job.create" })
    await driver.handleTurn(ctx, { conversationId, clientMessageId: randomUUID(), context: CONTEXT, text: "Aurora Beverages" })
    await driver.handleTurn(ctx, { conversationId, clientMessageId: randomUUID(), context: CONTEXT, text: name })
    const run = (await latestRun(ctx, "S-JOB-CREATE"))!
    expect(run.status, "precondition: waiting for confirmation").toBe("waiting_confirmation")
    const st = run.state as { proposalId: string; digest: string }
    crash.stepId = "delegate_create"
    await expect(
      driver.confirm(ctx, { conversationId, proposalId: st.proposalId, digest: st.digest, clientMessageId: randomUUID() })
    ).rejects.toThrow(/simulated crash/)
    expect(await jobsNamed(name), "the job command committed before the crash").toHaveLength(1)
    return { ctx, clock, driver, conversationId, runId: run.id, proposalId: st.proposalId, digest: st.digest }
  }

  it("a retried confirmation after the committed command never opens a second job", async () => {
    const name = `B05 retry ${Date.now()}`
    const c = await crashAfterJobCommand(name)
    await c.driver.confirm(c.ctx, { conversationId: c.conversationId, proposalId: c.proposalId, digest: c.digest, clientMessageId: randomUUID() }).catch(() => undefined)
    expect(await jobsNamed(name), "retry must not duplicate the committed effect").toHaveLength(1)
  })

  it("resume is refused while the crashed worker's lease is live (no second worker)", async () => {
    const name = `B05 live lease ${Date.now()}`
    const c = await crashAfterJobCommand(name)
    const res = await c.driver.resume(c.ctx, { conversationId: c.conversationId, runId: c.runId })
    expect(res.resumed).toBe(false)
    expect((await runById(c.runId)).status).toBe("running")
  })

  it("after the lease expires, an authenticated resume completes the run with one job and a receipt", async () => {
    const name = `B05 resume ${Date.now()}`
    const c = await crashAfterJobCommand(name)
    c.clock.t += LEASE_MS + 1_000
    const res = await c.driver.resume(c.ctx, { conversationId: c.conversationId, runId: c.runId })
    expect(res.resumed).toBe(true)
    expect((await runById(c.runId)).status).toBe("completed")
    expect(await jobsNamed(name), "resume replays the command instead of repeating it").toHaveLength(1)
    expect((await partsOfRun(c.runId)).some((x) => x.type === "receipt")).toBe(true)
  })

  it("another user cannot resume someone else's run", async () => {
    const name = `B05 foreign ${Date.now()}`
    const c = await crashAfterJobCommand(name)
    c.clock.t += LEASE_MS + 1_000
    const other = await ctxFor("user_demo_owner")
    await expect(c.driver.resume(other, { conversationId: c.conversationId, runId: c.runId })).rejects.toMatchObject({ code: "not_found" })
    expect(await jobsNamed(name)).toHaveLength(1)
  })

  it("no run is left 'running' once its scenario finished", async () => {
    const ctx = await ctxFor("user_demo_owner")
    const { conversationId } = await turn(ctx, null, { presetId: "preset.margin.aurora" })
    const rows = await ownerDb()
      .select()
      .from(assistantRun)
      .where(and(eq(assistantRun.conversationId, conversationId), inArray(assistantRun.status, ["running", "queued"])))
    expect(rows).toEqual([])
  })
})
