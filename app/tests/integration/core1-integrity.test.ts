// @vitest-environment node
// Core-1 regressions for audit findings B02, B03, B07, B09
// (../.validation/auditoria-chasis-2026-10-17/backend-review.md).
import { and, eq, sql } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { runCapability } from "@/server/capabilities/runner"
import { approvalRequest, budgetReservation, configurationRevision, demoRun, job, workflowRun } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { decideApprovalCommand, executeApprovedCommand } from "@/server/domain/approvals"
import { proposeFeeAmendment, recordClientAuthority, recordCostEstimate } from "@/server/domain/budget"
import { openOrCloseJob } from "@/server/domain/jobs"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo } from "./helpers"

const LAB = id("job_demo_lab")
const AURORA_CLIENT = id("client_demo_aurora")
const LAB_CLIENT = id("client_demo_lab")

const isCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code

async function reservations(ctx: AgencyContext, jobId: string) {
  return withTenant(ctx.tenant.id, (tx) => tx.select().from(budgetReservation).where(eq(budgetReservation.jobId, jobId)))
}

async function jobRevision(ctx: AgencyContext, jobId: string) {
  return withTenant(ctx.tenant.id, async (tx) => (await tx.select().from(job).where(eq(job.id, jobId)))[0]!.revision)
}

const without = (ctx: AgencyContext, patch: { permission?: string; capability?: string }): AgencyContext => ({
  ...ctx,
  permissions: new Set([...ctx.permissions].filter((p) => p !== patch.permission)),
  enabledCapabilities: new Set([...ctx.enabledCapabilities].filter((c) => c !== patch.capability)),
})

const reserve = (amount: string, purpose = "Integrity regression") => ({
  job: LAB,
  budgetScope: "client_commercial_authority",
  amount,
  purpose,
})

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("B02 · runner replay binds the exact request and current authorization", () => {
  it("same key + same request replays the stored result without a second effect", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const k = key("b02-same")
    const first = await runCapability(ctx, "agency-budget-control", reserve("1.00"), { origin: "ui", idempotencyKey: k })
    const again = await runCapability(ctx, "agency-budget-control", reserve("1.00"), { origin: "ui", idempotencyKey: k })
    expect(first.state).toBe("succeeded")
    expect(again).toMatchObject({ runId: first.runId, state: "succeeded", replayed: true })
    expect(again.output).toEqual(first.output)
    expect((await reservations(ctx, LAB)).filter((r) => r.purpose === "Integrity regression")).toHaveLength(1)
  })

  it("same key + different input is an idempotency conflict and changes nothing", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const k = key("b02-diff")
    await runCapability(ctx, "agency-budget-control", reserve("2.00", "B02 payload A"), { origin: "ui", idempotencyKey: k })
    const before = await reservations(ctx, LAB)
    await expect(
      runCapability(ctx, "agency-budget-control", reserve("3.00", "B02 payload A"), { origin: "ui", idempotencyKey: k })
    ).rejects.toSatisfy(isCode("idempotency_conflict"))
    expect(await reservations(ctx, LAB)).toHaveLength(before.length)
  })

  it("same key + different expectedRevision is a conflict", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const k = key("b02-rev")
    const rev = await jobRevision(ctx, LAB)
    await runCapability(ctx, "agency-budget-control", reserve("1.50", "B02 revision"), { origin: "ui", idempotencyKey: k, expectedRevision: rev })
    await expect(
      runCapability(ctx, "agency-budget-control", reserve("1.50", "B02 revision"), { origin: "ui", idempotencyKey: k, expectedRevision: rev + 7 })
    ).rejects.toSatisfy(isCode("idempotency_conflict"))
  })

  it("another actor reusing the key gets a conflict, not the first actor's result", async () => {
    const operator = await ctxFor("user_demo_operator")
    const owner = await ctxFor("user_demo_owner")
    const k = key("b02-actor")
    await runCapability(operator, "agency-budget-control", reserve("1.25", "B02 actor"), { origin: "ui", idempotencyKey: k })
    await expect(
      runCapability(owner, "agency-budget-control", reserve("1.25", "B02 actor"), { origin: "ui", idempotencyKey: k })
    ).rejects.toSatisfy(isCode("idempotency_conflict"))
  })

  it("a replay re-checks the current execute permission and capability enablement", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const k = key("b02-perm")
    const input = reserve("1.10", "B02 permission")
    expect((await runCapability(ctx, "agency-budget-control", input, { origin: "ui", idempotencyKey: k })).state).toBe("succeeded")
    await expect(
      runCapability(without(ctx, { permission: "budget.propose" }), "agency-budget-control", input, { origin: "ui", idempotencyKey: k })
    ).rejects.toSatisfy(isCode("forbidden"))
    await expect(
      runCapability(without(ctx, { capability: "agency-budget-control" }), "agency-budget-control", input, { origin: "ui", idempotencyKey: k })
    ).rejects.toSatisfy(isCode("capability_disabled"))
  })
})

describe("B03 · concurrent double submit is one logical execution", () => {
  it("two simultaneous runs with the same new key → one run, one effect, coherent answers", async () => {
    const ctx = await ctxFor("user_demo_operator")
    for (let attempt = 0; attempt < 3; attempt++) {
      const k = key(`b03-${attempt}`)
      const purpose = `B03 double submit ${attempt}`
      const results = await Promise.allSettled([
        runCapability(ctx, "agency-budget-control", reserve("1.05", purpose), { origin: "ui", idempotencyKey: k }),
        runCapability(ctx, "agency-budget-control", reserve("1.05", purpose), { origin: "ui", idempotencyKey: k }),
      ])
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"])
      const [a, b] = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof runCapability>>>).value)
      expect(a!.runId).toBe(b!.runId)
      expect(a!.state).toBe("succeeded")
      expect(b!.state).toBe("succeeded")
      expect(a!.output).toEqual(b!.output)
      expect((await reservations(ctx, LAB)).filter((r) => r.purpose === purpose)).toHaveLength(1)
      const runs = await withTenant(ctx.tenant.id, (tx) =>
        tx.select().from(workflowRun).where(and(eq(workflowRun.skillId, "agency-budget-control"), eq(workflowRun.idempotencyKey, k)))
      )
      expect(runs).toHaveLength(1)
    }
  })
})

describe("B07 · deferred approvals pass one gate immediately before consumption", () => {
  // LAB: fee 1,000 with client authority 1,000. A fee of 1,500 needs 1,500 of
  // authority, so finance's approval is recorded but its execution is blocked.
  // Each case asks for a higher fee than the current authority, then raises
  // the authority so only the gate under test can still block execution.
  let nextFee = 1000
  async function approvedButBlockedAmendment(label: string) {
    const operator = await ctxFor("user_demo_operator")
    const finance = await ctxFor("user_demo_finance")
    nextFee += 500
    const fee = `${nextFee}.00`
    const res = await executeCommand(operator, proposeFeeAmendment, {
      idempotencyKey: key(`b07-${label}`),
      payload: { job: LAB, newAgencyFee: fee, reason: `B07 ${label}` },
      origin: "ui",
      expectedRevision: await jobRevision(operator, LAB),
    })
    const decided = await executeCommand(finance, decideApprovalCommand, {
      idempotencyKey: key(`b07-${label}-decide`),
      payload: { approvalId: res.result.approvalId, decision: "approve", reviewedDigest: res.result.payloadDigest },
      origin: "ui",
    })
    expect(decided.result).toMatchObject({ outcome: "approved", executed: false, blockedCode: "client_authority_missing" })
    await raiseLabAuthority(fee, label)
    return { operator, finance, approvalId: res.result.approvalId }
  }

  async function raiseLabAuthority(amount: string, label: string) {
    const operator = await ctxFor("user_demo_operator")
    const owner = await ctxFor("user_demo_owner")
    const po = await executeCommand(operator, recordClientAuthority, {
      idempotencyKey: key(`b07-${label}-po`),
      payload: { job: LAB, reference: "PO-LAB-2027-01", amount, evidenceId: id("ev:evidence_demo_c1_lab_po") },
      origin: "ui",
    })
    const approved = await executeCommand(owner, decideApprovalCommand, {
      idempotencyKey: key(`b07-${label}-po-approve`),
      payload: { approvalId: po.result.approvalId, decision: "approve", reviewedDigest: po.result.payloadDigest },
      origin: "ui",
    })
    expect(approved.result).toMatchObject({ outcome: "approved", executed: true })
  }

  async function approvalState(ctx: AgencyContext, approvalId: string) {
    return withTenant(ctx.tenant.id, async (tx) => (await tx.select().from(approvalRequest).where(eq(approvalRequest.id, approvalId)))[0]!.state)
  }

  it("an approval that expired after a blocked execution cannot be consumed later", async () => {
    const { operator, approvalId } = await approvedButBlockedAmendment("expired")
    await ownerDb().update(approvalRequest).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(approvalRequest.id, approvalId))
    const res = await executeCommand(operator, executeApprovedCommand, { idempotencyKey: key("b07-exp-run"), payload: { approvalId }, origin: "ui" })
    expect(res.result).toMatchObject({ executed: false, blockedCode: "approval_expired" })
    expect(await approvalState(operator, approvalId)).toBe("expired")
    await expect(
      executeCommand(operator, executeApprovedCommand, { idempotencyKey: key("b07-exp-run-2"), payload: { approvalId }, origin: "ui" })
    ).rejects.toSatisfy(isCode("approval_required"))
  })

  it("disabling the capability between approval and execution blocks consumption", async () => {
    const { operator, approvalId } = await approvedButBlockedAmendment("disabled")
    const res = await executeCommand(without(operator, { capability: "agency-fee-contracts" }), executeApprovedCommand, {
      idempotencyKey: key("b07-dis-run"),
      payload: { approvalId },
      origin: "ui",
    })
    expect(res.result).toMatchObject({ executed: false, blockedCode: "capability_disabled" })
    expect(await approvalState(operator, approvalId)).toBe("approved")
  })

  it("an actor without the executor permission cannot execute", async () => {
    const { approvalId } = await approvedButBlockedAmendment("permission")
    const producer = await ctxFor("user_demo_producer")
    await expect(
      executeCommand(producer, executeApprovedCommand, { idempotencyKey: key("b07-perm-run"), payload: { approvalId }, origin: "ui" })
    ).rejects.toSatisfy(isCode("forbidden"))
  })

  it("a changed approval policy makes the pending execution stale", async () => {
    const { operator, approvalId } = await approvedButBlockedAmendment("policy")
    const [cfg] = await ownerDb().select().from(configurationRevision).where(eq(configurationRevision.id, operator.tenant.publishedConfigRevisionId!))
    await ownerDb()
      .update(configurationRevision)
      .set({ approvalPolicy: { ...(cfg!.approvalPolicy as object), feeAmendment: "owner" } })
      .where(eq(configurationRevision.id, cfg!.id))
    try {
      const res = await executeCommand(operator, executeApprovedCommand, { idempotencyKey: key("b07-pol-run"), payload: { approvalId }, origin: "ui" })
      expect(res.result).toMatchObject({ executed: false, blockedCode: "approval_stale" })
      expect(await approvalState(operator, approvalId)).toBe("stale")
    } finally {
      await ownerDb().update(configurationRevision).set({ approvalPolicy: cfg!.approvalPolicy }).where(eq(configurationRevision.id, cfg!.id))
    }
  })

  it("a material aggregate change after approval makes it stale", async () => {
    const { operator, approvalId } = await approvedButBlockedAmendment("revision")
    await executeCommand(operator, recordCostEstimate, {
      idempotencyKey: key("b07-rev-est"),
      payload: { job: LAB, laborMinutes: 60, hourlyCost: "10.00", productionVendorAmount: "0.00", expenseAmount: "0.00", reason: "Lab estimate" },
      origin: "ui",
      expectedRevision: await jobRevision(operator, LAB),
    })
    const res = await executeCommand(operator, executeApprovedCommand, { idempotencyKey: key("b07-rev-run"), payload: { approvalId }, origin: "ui" })
    expect(res.result).toMatchObject({ executed: false, blockedCode: "approval_stale" })
    expect(await approvalState(operator, approvalId)).toBe("stale")
  })
})

describe("business clock (presenter can advance the demo date)", () => {
  async function withAdvancedClock<T>(businessDate: string, fn: () => Promise<T>) {
    const [run] = await ownerDb()
      .insert(demoRun)
      .values({ seedVersion: "core1-test", checkpoint: "ready_for_scope_review", state: "active", businessDate, tenantIds: [id("tenant_demo_rayo")], startedAt: new Date(Date.now() + 60_000) })
      .returning()
    try {
      return await fn()
    } finally {
      await ownerDb().update(demoRun).set({ state: "ended", endedAt: new Date() }).where(eq(demoRun.id, run!.id))
    }
  }

  it("an approval expires when the business date moves past it, even if wall-clock time has not", async () => {
    const operator = await ctxFor("user_demo_operator")
    const finance = await ctxFor("user_demo_finance")
    const res = await executeCommand(operator, proposeFeeAmendment, {
      idempotencyKey: key("clock-fee"),
      payload: { job: LAB, newAgencyFee: "990.00", reason: "Clock expiry probe" },
      origin: "ui",
      expectedRevision: await jobRevision(operator, LAB),
    })
    // Fee approvals live 14 days; the presenter moves the demo 31 days ahead.
    const decided = await withAdvancedClock("2027-04-15", () =>
      executeCommand(finance, decideApprovalCommand, {
        idempotencyKey: key("clock-decide"),
        payload: { approvalId: res.result.approvalId, decision: "approve", reviewedDigest: res.result.payloadDigest },
        origin: "ui",
      })
    )
    expect(decided.result.outcome).toBe("stale")
  })

  it("a PO valid today becomes expired for new authority once the business date passes its end", async () => {
    const operator = await ctxFor("user_demo_operator")
    const payload = { job: LAB, reference: key("PO-CLOCK").replace(/[^A-Za-z0-9-]/g, "-").slice(0, 40), amount: "5000.00", validFrom: "2027-03-01", validTo: "2027-03-31", evidenceId: id("ev:evidence_demo_c1_lab_po") }
    await expect(
      withAdvancedClock("2027-04-15", () => executeCommand(operator, recordClientAuthority, { idempotencyKey: key("clock-po"), payload, origin: "ui" }))
    ).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === "blocked_by_rule" && e.details.rule === "po_expired")
    const ok = await executeCommand(operator, recordClientAuthority, { idempotencyKey: key("clock-po-ok"), payload, origin: "ui" })
    expect(ok.result.commercial_terms.validTo).toBe("2027-03-31")
  })
})

describe("B09 · display references are unique under concurrent opens", () => {
  it("opening jobs for two different clients at the same time yields two unique references", async () => {
    const ctx = await ctxFor("user_demo_operator")
    for (let attempt = 0; attempt < 3; attempt++) {
      const open = (client: string, name: string) =>
        executeCommand(ctx, openOrCloseJob, {
          idempotencyKey: key(`b09-${attempt}-${name}`),
          payload: { action: "open", client, jobName: `${name} concurrency ${attempt}`, jobType: "A", billingCode: "F", period: "2027-04" },
          origin: "ui",
        })
      const results = await Promise.allSettled([open(AURORA_CLIENT, "Aurora"), open(LAB_CLIENT, "Lab")])
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"])
      const refs = results.map((r) => (r as PromiseFulfilledResult<{ result: { displayReference: string } }>).value.result.displayReference)
      expect(new Set(refs).size).toBe(2)
    }
    const [{ n }] = await withTenant(ctx.tenant.id, (tx) =>
      tx.select({ n: sql<number>`count(distinct ${job.displayReference})::int` }).from(job).where(eq(job.year, 2027))
    )
    const [{ total }] = await withTenant(ctx.tenant.id, (tx) =>
      tx.select({ total: sql<number>`count(*)::int` }).from(job).where(eq(job.year, 2027))
    )
    expect(n).toBe(total)
  })
})
