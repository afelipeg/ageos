// @vitest-environment node
import { and, eq, like } from "drizzle-orm"

import { runCapability } from "@/server/capabilities/runner"
import { budgetReservation, costEstimate, job, workflowRun } from "@/server/db/schema"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo } from "./helpers"
import { diffSnapshots, setMembershipRole, settleBlocked, snapshotDb } from "./qa-helpers"

// Audit regressions B02 (runner replay ignores payload/revision/permission)
// and B03 (concurrent first submissions leak a unique-violation error).
// Contract: same key + same request replays; a different request under the
// same key is `idempotency_conflict` with no data change; replay re-checks
// the actor's current permission; a double submit is one logical execution.

const LAB = id("job_demo_lab")

const reserve = (amount: string, purpose: string) => ({
  job: LAB,
  budgetScope: "client_commercial_authority",
  amount,
  purpose,
})

async function reservationsLike(prefix: string) {
  return ownerDb()
    .select()
    .from(budgetReservation)
    .where(and(eq(budgetReservation.jobId, LAB), like(budgetReservation.purpose, `${prefix}%`)))
}

async function labRevision() {
  const [j] = await ownerDb().select({ revision: job.revision }).from(job).where(eq(job.id, LAB))
  return j!.revision
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await setMembershipRole("user_demo_operator", "tenant_demo_rayo", "account_manager")
  await closeOwnerDb()
})

describe("B02 · runner replay compares the full request", () => {
  it("same key + same payload replays the first result without a second effect", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const k = key("b02-same")
    const first = await runCapability(ctx, "agency-budget-control", reserve("10.00", "B02 same A"), { origin: "ui", idempotencyKey: k })
    expect(first.state).toBe("succeeded")
    const again = await runCapability(ctx, "agency-budget-control", reserve("10.00", "B02 same A"), { origin: "ui", idempotencyKey: k })
    expect(again).toMatchObject({ state: "succeeded", replayed: true, runId: first.runId })
    expect(again.output).toEqual(first.output)
    expect(await reservationsLike("B02 same")).toHaveLength(1)
  })

  it("same key + different payload is an idempotency_conflict, never the earlier success", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const k = key("b02-diff")
    const first = await runCapability(ctx, "agency-budget-control", reserve("10.00", "B02 diff A"), { origin: "ui", idempotencyKey: k })
    expect(first.state).toBe("succeeded")
    const before = await snapshotDb()
    const second = await settleBlocked(
      runCapability(ctx, "agency-budget-control", reserve("20.00", "B02 diff B"), { origin: "ui", idempotencyKey: k })
    )
    expect(second.ok, "a different payload under a used key must not report success").toBe(false)
    if (!second.ok) expect(second.error.code).toBe("idempotency_conflict")
    expect(diffSnapshots(before, await snapshotDb())).toEqual([])
    const rows = await reservationsLike("B02 diff")
    expect(rows.map((r) => r.amountMinor)).toEqual([1000n])
  })

  it("same key + same payload but a different expectedRevision is a conflict", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const k = key("b02-rev")
    const rev = await labRevision()
    const input = { job: LAB, laborMinutes: 600, hourlyCost: "50.00", productionVendorAmount: "0.00", expenseAmount: "0.00", reason: "B02 revision probe" }
    const first = await runCapability(ctx, "agency-production-estimating", input, { origin: "ui", idempotencyKey: k, expectedRevision: rev })
    expect(first.state).toBe("succeeded")
    const estimatesBefore = await ownerDb().select().from(costEstimate).where(eq(costEstimate.jobId, LAB))
    const second = await settleBlocked(
      runCapability(ctx, "agency-production-estimating", input, { origin: "ui", idempotencyKey: k, expectedRevision: rev + 1 })
    )
    expect(second.ok, "a request with another expected revision is a different request").toBe(false)
    if (!second.ok) expect(second.error.code).toBe("idempotency_conflict")
    expect(await ownerDb().select().from(costEstimate).where(eq(costEstimate.jobId, LAB))).toHaveLength(estimatesBefore.length)
  })

  it("replay re-checks the actor's current execute permission", async () => {
    const k = key("b02-perm")
    const input = reserve("10.00", "B02 perm A")
    const asOperator = await ctxFor("user_demo_operator")
    const first = await runCapability(asOperator, "agency-budget-control", input, { origin: "ui", idempotencyKey: k })
    expect(first.state).toBe("succeeded")
    // viewer keeps workspace.view (the capability's view permission) but loses budget.propose.
    await setMembershipRole("user_demo_operator", "tenant_demo_rayo", "viewer")
    try {
      const demoted = await ctxFor("user_demo_operator")
      expect(demoted.permissions.has("budget.propose")).toBe(false)
      const replay = await settleBlocked(runCapability(demoted, "agency-budget-control", input, { origin: "ui", idempotencyKey: k }))
      expect(replay.ok, "a demoted actor must not receive the stored result").toBe(false)
      if (!replay.ok) expect(replay.error.code).toBe("forbidden")
    } finally {
      await setMembershipRole("user_demo_operator", "tenant_demo_rayo", "account_manager")
    }
  })
})

describe("B03 · concurrent double submit is one logical execution", () => {
  it("two simultaneous first submissions of a command: one effect, consistent answers, no raw SQL error", async () => {
    const ctx = await ctxFor("user_demo_operator")
    for (let attempt = 0; attempt < 5; attempt++) {
      const k = key(`b03-cmd-${attempt}`)
      const purpose = `B03 double ${attempt}`
      const results = await Promise.allSettled([
        runCapability(ctx, "agency-budget-control", reserve("1.00", purpose), { origin: "ui", idempotencyKey: k }),
        runCapability(ctx, "agency-budget-control", reserve("1.00", purpose), { origin: "ui", idempotencyKey: k }),
      ])
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
      expect(
        rejected.map((r) => String((r.reason as Error)?.message ?? r.reason)),
        "no exception (e.g. unique violation) may reach the caller"
      ).toEqual([])
      const values = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof runCapability>>>).value)
      expect(values.every((v) => v.state === "succeeded")).toBe(true)
      expect(new Set(values.map((v) => v.runId)).size).toBe(1)
      expect(values[0]!.output).toEqual(values[1]!.output)
      expect(await reservationsLike(purpose)).toHaveLength(1)
      const runs = await ownerDb()
        .select()
        .from(workflowRun)
        .where(and(eq(workflowRun.tenantId, ctx.tenant.id), eq(workflowRun.idempotencyKey, k)))
      expect(runs).toHaveLength(1)
    }
  })

  it("two simultaneous first submissions of a query share one persisted run", async () => {
    const ctx = await ctxFor("user_demo_owner")
    for (let attempt = 0; attempt < 5; attempt++) {
      const k = key(`b03-query-${attempt}`)
      const input = { job: id("job_demo_aurora"), basis: "forecast" }
      const results = await Promise.allSettled([
        runCapability(ctx, "agency-profitability", input, { origin: "ui", idempotencyKey: k }),
        runCapability(ctx, "agency-profitability", input, { origin: "ui", idempotencyKey: k }),
      ])
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
      expect(rejected.map((r) => String((r.reason as Error)?.message ?? r.reason))).toEqual([])
      const runs = await ownerDb()
        .select()
        .from(workflowRun)
        .where(and(eq(workflowRun.tenantId, ctx.tenant.id), eq(workflowRun.idempotencyKey, k)))
      expect(runs).toHaveLength(1)
    }
  })
})
