// @vitest-environment node
// Core-2 journeys on a fresh seed: Aurora plan reallocation r2 → simulated
// orders (success / timeout_after_effect / permission_revoked) → delivery →
// activation; Lumen production order + delivery (J05); hours approval;
// secondary demo-lab cases (radio make-good, concurrent OOH overlap).
import { and, eq } from "drizzle-orm"

import { queueSimulationOutcome } from "@/server/adapters/ads"
import { approvalRequest, budgetReservation, campaign, connection, demoProviderEffect, mediaPlanRevision, purchaseOrder } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { decideApprovalCommand } from "@/server/domain/approvals"
import { activateDemoCampaign } from "@/server/domain/campaigns"
import { acceptMediaDelivery, issueMediaOrder, reconcileMediaOrderSubmission } from "@/server/domain/media-buying"
import { approvedPlan, proposePlanRevisionChange, saveMediaPlanRevision } from "@/server/domain/media-planning"
import { reserveOOHFace } from "@/server/domain/ooh"
import { issueProductionOrder, reviewProductionDelivery } from "@/server/domain/production"
import { budgetAvailability, loadJobFinancials } from "@/server/domain/profitability"
import { decideTimesheet, submitTimesheet } from "@/server/domain/timesheets"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, id, key, resetDemo } from "./helpers"

const AURORA = id("job_demo_aurora")
const LAB = id("job_demo_lab_ops")

async function expectBlocked(p: Promise<unknown>, code: string, rule?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code && (rule === undefined || e.details.rule === rule))
}

async function tx<T>(fn: Parameters<typeof withTenant<T>>[1]) {
  const ctx = await ctxFor("user_demo_owner")
  return withTenant(ctx.tenant.id, fn)
}

async function connId(alias: string) {
  return tx(async (t) => (await t.select().from(connection).where(eq(connection.accountAlias, alias)))[0]!.id)
}

async function approve(approvalId: string, digest: string, as = "user_demo_finance") {
  return executeCommand(await ctxFor(as), decideApprovalCommand, { idempotencyKey: key("decide"), origin: "ui", payload: { approvalId, decision: "approve", reviewedDigest: digest } })
}

async function mediaAvailable(jobId: string) {
  return tx(async (t) => budgetAvailability(await loadJobFinancials(t, (await ctxFor("user_demo_owner")).tenant.id, jobId)).find((s) => s.scope === "managed_media_authority")!)
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("J03 Aurora: plan revision → simulated orders → delivery → activation", () => {
  let orderOnR1: { approvalId: string; payloadDigest: string }

  it("seeded r1: six lines sum to 30,000 and belong to the Aurora job", async () => {
    const plan = await tx(async (t) => approvedPlan(t, (await ctxFor("user_demo_owner")).tenant.id, AURORA))
    expect(plan.revision?.number).toBe(1)
    expect(plan.lines).toHaveLength(6)
    expect(plan.lines.reduce((s, l) => s + l.amountMinor, 0n)).toBe(3000000n)
    expect(plan.revision?.jobId).toBe(AURORA)
  })

  it("a plan above the managed media authority cannot advance", async () => {
    await expectBlocked(
      executeCommand(await ctxFor("user_demo_operator"), saveMediaPlanRevision, { idempotencyKey: key("over"), origin: "ui", payload: { job: AURORA, channel: "meta", placement: "Demo Feed", plannedAmount: "15000.00", flightStart: "2027-03-16", flightEnd: "2027-03-31" } }),
      "blocked_by_rule",
      "exceeds_managed_media_authority"
    )
  })

  it("an order requested on r1 before the reallocation is pending", async () => {
    const res = await executeCommand(await ctxFor("user_demo_operator"), issueMediaOrder, {
      idempotencyKey: key("order-r1"),
      origin: "ui",
      payload: { job: AURORA, supplier: id("supplier_demo_meta_ads"), channel: "meta", planRevision: 1, orderAmount: "10000.00", connection: await connId("demo_meta_aurora") },
    })
    orderOnR1 = res.result
  })

  it("reallocation r2 (meta 9,000, google 9,000) keeps 30,000, needs a new approval and SoD", async () => {
    const operator = await ctxFor("user_demo_operator")
    const res = await executeCommand(operator, proposePlanRevisionChange, {
      idempotencyKey: key("r2"),
      origin: "ui",
      payload: { job: AURORA, baseRevision: 1, channel: "meta", newAmount: "9000.00", offsetChannel: "google", reasonCategory: "market_change", reason: "Move 1,000 from Meta to Google search based on early results." },
    })
    expect(res.result.number).toBe(2)
    expect(res.result.proposed_revision.totalMinor).toBe("3000000")
    expect(res.result.line_diff.lines).toEqual([
      { lineKey: "line_google", beforeMinor: "800000", afterMinor: "900000" },
      { lineKey: "line_meta", beforeMinor: "1000000", afterMinor: "900000" },
    ])
    await expectBlocked(approve(res.result.approvalId, res.result.payloadDigest, "user_demo_operator"), "forbidden")
    await expectBlocked(approve(res.result.approvalId, res.result.payloadDigest, "user_demo_producer"), "forbidden")
    const decided = await approve(res.result.approvalId, res.result.payloadDigest)
    expect(decided.result).toMatchObject({ outcome: "approved", executed: true })
    const plan = await tx(async (t) => approvedPlan(t, operator.tenant.id, AURORA))
    expect(plan.revision?.number).toBe(2)
    expect(plan.revisions.find((r) => r.number === 1)?.state).toBe("superseded")
    expect(plan.lines.find((l) => l.lineKey === "line_meta")?.amountMinor).toBe(900000n)
    expect(plan.lines.find((l) => l.lineKey === "line_google")?.amountMinor).toBe(900000n)
  })

  it("the r1 order approval is stale and cannot be executed", async () => {
    const state = await tx(async (t) => (await t.select().from(approvalRequest).where(eq(approvalRequest.id, orderOnR1.approvalId)))[0]!.state)
    expect(state).toBe("stale")
    await expectBlocked(approve(orderOnR1.approvalId, orderOnR1.payloadDigest), "blocked_by_rule")
    await expectBlocked(
      executeCommand(await ctxFor("user_demo_operator"), issueMediaOrder, { idempotencyKey: key("order-old"), origin: "ui", payload: { job: AURORA, supplier: id("supplier_demo_meta_ads"), channel: "meta", planRevision: 1, orderAmount: "100.00", connection: await connId("demo_meta_aurora") } }),
      "blocked_by_rule",
      "plan_revision_not_approved"
    )
  })

  let metaOrderId = ""
  it("meta order from the exact approved r2 ids: one order, one commitment, sim_* receipt", async () => {
    const operator = await ctxFor("user_demo_operator")
    const k = key("order-meta")
    const payload = { job: AURORA, supplier: id("supplier_demo_meta_ads"), channel: "meta", planRevision: 2, orderAmount: "9000.00", poNumber: "PO-AUR-2027-01", connection: await connId("demo_meta_aurora") }
    const res = await executeCommand(operator, issueMediaOrder, { idempotencyKey: k, origin: "ui", payload })
    const again = await executeCommand(operator, issueMediaOrder, { idempotencyKey: k, origin: "ui", payload })
    expect(again.replayed).toBe(true)
    expect(again.result.orderId).toBe(res.result.orderId)
    const decided = await approve(res.result.approvalId, res.result.payloadDigest)
    expect(decided.result).toMatchObject({ outcome: "approved", executed: true })
    metaOrderId = res.result.orderId
    await tx(async (t) => {
      const [o] = await t.select().from(purchaseOrder).where(eq(purchaseOrder.id, metaOrderId))
      expect(o!.state).toBe("acknowledged")
      expect(o!.receiptId).toMatch(/^sim_meta_ads_/)
      expect(o!.planRevisionNumber).toBe("2")
      const commitments = await t.select().from(budgetReservation).where(eq(budgetReservation.purpose, `media_order:${o!.reference}`))
      expect(commitments.map((c) => [c.state, c.amountMinor])).toEqual([["committed", 900000n]])
    })
    await expectBlocked(
      executeCommand(operator, issueMediaOrder, { idempotencyKey: key("order-meta-2"), origin: "ui", payload: { ...payload, orderAmount: "1.00" } }),
      "blocked_by_rule",
      "exceeds_plan_line"
    )
  })

  it("a changed account invalidates the order", async () => {
    await expectBlocked(
      executeCommand(await ctxFor("user_demo_operator"), issueMediaOrder, { idempotencyKey: key("order-acct"), origin: "ui", payload: { job: AURORA, supplier: id("supplier_demo_meta_ads"), channel: "meta", planRevision: 2, orderAmount: "100.00", connection: await connId("demo_google_aurora") } }),
      "blocked_by_rule",
      "account_mismatch"
    )
  })

  it("timeout_after_effect: outcome unknown, reconcile returns the existing receipt (one effect)", async () => {
    const operator = await ctxFor("user_demo_operator")
    await executeCommand(await ctxFor("user_demo_owner"), queueSimulationOutcome, { idempotencyKey: key("sim"), origin: "presenter", payload: { provider: "google_ads", operationType: "media_order.submit", failureMode: "timeout_after_effect" } })
    const res = await executeCommand(operator, issueMediaOrder, { idempotencyKey: key("order-google"), origin: "ui", payload: { job: AURORA, supplier: id("supplier_demo_google_ads"), channel: "google", planRevision: 2, orderAmount: "9000.00", connection: await connId("demo_google_aurora") } })
    expect((await approve(res.result.approvalId, res.result.payloadDigest)).result.executed).toBe(true)
    const before = await tx(async (t) => (await t.select().from(purchaseOrder).where(eq(purchaseOrder.id, res.result.orderId)))[0]!)
    expect(before.state).toBe("approved")
    expect(before.receiptId).toBeNull()
    expect((before.detail as { submission: { state: string } }).submission.state).toBe("outcome_unknown")
    const rec = await executeCommand(operator, reconcileMediaOrderSubmission, { idempotencyKey: key("reconcile"), origin: "ui", payload: { order: res.result.orderId } })
    expect(rec.result.outcome).toBe("succeeded")
    expect(rec.result.effectCount).toBe(1)
    const effects = await tx(async (t) => t.select().from(demoProviderEffect).where(and(eq(demoProviderEffect.provider, "google_ads"), eq(demoProviderEffect.receiptId, rec.result.receiptId!))))
    expect(effects).toHaveLength(1)
    const after = await tx(async (t) => (await t.select().from(purchaseOrder).where(eq(purchaseOrder.id, res.result.orderId)))[0]!)
    expect(after.state).toBe("acknowledged")
  })

  it("permission_revoked: the connection is revoked, only dependent actions are blocked", async () => {
    const operator = await ctxFor("user_demo_operator")
    await executeCommand(await ctxFor("user_demo_owner"), queueSimulationOutcome, { idempotencyKey: key("sim2"), origin: "presenter", payload: { provider: "tiktok_ads", operationType: "media_order.submit", failureMode: "permission_revoked" } })
    const tiktok = await connId("demo_tiktok_aurora")
    const res = await executeCommand(operator, issueMediaOrder, { idempotencyKey: key("order-tiktok"), origin: "ui", payload: { job: AURORA, supplier: id("supplier_demo_tiktok_ads"), channel: "tiktok", planRevision: 2, orderAmount: "4000.00", connection: tiktok } })
    expect((await approve(res.result.approvalId, res.result.payloadDigest)).result.executed).toBe(true)
    await tx(async (t) => {
      const [o] = await t.select().from(purchaseOrder).where(eq(purchaseOrder.id, res.result.orderId))
      expect((o!.detail as { submission: { state: string } }).submission.state).toBe("failed")
      expect(o!.receiptId).toBeNull()
      const [c] = await t.select().from(connection).where(eq(connection.id, tiktok))
      expect(c!.state).toBe("revoked")
    })
    await expectBlocked(
      executeCommand(operator, issueMediaOrder, { idempotencyKey: key("order-tiktok-2"), origin: "ui", payload: { job: AURORA, supplier: id("supplier_demo_tiktok_ads"), channel: "tiktok", planRevision: 2, orderAmount: "1.00", connection: tiktok } }),
      "connection_revoked"
    )
  })

  it("accepted delivery consumes the commitment once (order → delivery is one cost)", async () => {
    const before = await mediaAvailable(AURORA)
    const res = await executeCommand(await ctxFor("user_demo_operator"), acceptMediaDelivery, { idempotencyKey: key("deliver"), origin: "ui", payload: { order: metaOrderId, acceptedAmount: "9000.00", businessDate: "2027-03-31" } })
    expect(res.result.orderState).toBe("delivered")
    const after = await mediaAvailable(AURORA)
    expect(after.availableMinor).toBe(before.availableMinor)
    expect(after.spentMinor - before.spentMinor).toBe(900000n)
    expect(before.openCommitmentsMinor - after.openCommitmentsMinor).toBe(900000n)
    await expectBlocked(
      executeCommand(await ctxFor("user_demo_operator"), acceptMediaDelivery, { idempotencyKey: key("deliver-2"), origin: "ui", payload: { order: metaOrderId, acceptedAmount: "1.00", businessDate: "2027-03-31" } }),
      "blocked_by_rule",
      "order_not_deliverable"
    )
  })

  it("simulated activation on r2 records one effect; r1 is a stale plan revision", async () => {
    const operator = await ctxFor("user_demo_operator")
    const base = { job: AURORA, connection: await connId("demo_meta_aurora"), creativeFile: id("file_demo_aurora_creative_feed"), rightsCleared: true, landingUrl: "https://aurora.example/spring" }
    await expectBlocked(executeCommand(operator, activateDemoCampaign, { idempotencyKey: key("act-r1"), origin: "ui", payload: { ...base, planRevision: 1 } }), "blocked_by_rule", "plan_revision_not_approved")
    const res = await executeCommand(operator, activateDemoCampaign, { idempotencyKey: key("act"), origin: "ui", payload: { ...base, planRevision: 2 } })
    expect(res.result.label.en).toBe("Simulated activation")
    expect(JSON.stringify(res.result)).not.toMatch(/Live on/i)
    expect((await approve(res.result.approvalId, res.result.payloadDigest)).result.executed).toBe(true)
    await tx(async (t) => {
      const [c] = await t.select().from(campaign).where(eq(campaign.id, res.result.campaignId))
      expect(c!.state).toBe("active_simulated")
      expect(c!.budgetMinor).toBe(900000n)
      expect(c!.externalId).toMatch(/^sim_ext_/)
    })
  })
})

describe("J05 production order and delivery (Lumen 5,500)", () => {
  it("issues the production order against agency cost authority and accepts its delivery on release", async () => {
    const operator = await ctxFor("user_demo_operator")
    const order = await executeCommand(operator, issueProductionOrder, { idempotencyKey: key("prod-order"), origin: "ui", payload: { job: AURORA, supplier: id("supplier_demo_lumen"), amount: "5500.00", deliverable: "Aurora spring hero film" } })
    expect(order.result.state).toBe("approved")
    await expectBlocked(
      executeCommand(operator, issueProductionOrder, { idempotencyKey: key("prod-order-2"), origin: "ui", payload: { job: AURORA, supplier: id("supplier_demo_lumen"), amount: "1.00", deliverable: "Extra" } }),
      "blocked_by_rule",
      "exceeds_production_estimate"
    )
    await expectBlocked(
      executeCommand(operator, reviewProductionDelivery, { idempotencyKey: key("qa-fail"), origin: "ui", payload: { job: AURORA, deliverable: "Aurora spring hero film", deliveryDate: "2027-03-22", assetFile: id("file_demo_aurora_hero_asset"), rightsCleared: true, qualityResult: "failed" } }),
      "blocked_by_rule",
      "qa_failed"
    )
    const review = await executeCommand(operator, reviewProductionDelivery, { idempotencyKey: key("qa-pass"), origin: "ui", payload: { job: AURORA, deliverable: "Aurora spring hero film", deliveryDate: "2027-03-22", assetFile: id("file_demo_aurora_hero_asset"), rightsCleared: true, qualityResult: "passed" } })
    const rel = review.result.release_candidates[0]!
    expect(rel.delivery).toMatchObject({ acceptedMinor: "550000", orderState: "delivered" })
    await tx(async (t) => {
      const commitments = await t.select().from(budgetReservation).where(eq(budgetReservation.purpose, `production_order:${order.result.reference}`))
      expect(commitments.map((c) => [c.state, c.amountMinor])).toEqual([["consumed", 550000n]])
    })
  })
})

describe("J02 hours: submit → manager approval; duplicates and rejected hours excluded", () => {
  it("100h + 40h approved at 50 value 7,000 once; self-approval and duplicates blocked", async () => {
    const producer = await ctxFor("user_demo_producer")
    const operator = await ctxFor("user_demo_operator")
    const submit = (minutes: number, task: string, k = key("ts")) =>
      executeCommand(producer, submitTimesheet, { idempotencyKey: k, origin: "ui", payload: { job: AURORA, taskTitle: task, member: id("user_demo_producer"), workDate: "2027-03-18", minutes, hourlyCost: "50.00" } })
    const base = await submit(6000, "Aurora base production hours")
    const scope = await submit(2400, "Scope change creative rework")
    await expectBlocked(submit(2400, "Scope change creative rework"), "blocked_by_rule", "duplicate_timesheet")
    const onBehalf = await executeCommand(operator, submitTimesheet, { idempotencyKey: key("ts-op"), origin: "ui", payload: { job: AURORA, taskTitle: "Duplicate import to reject", member: id("user_demo_producer"), workDate: "2027-03-19", minutes: 600, hourlyCost: "50.00", notes: "Logged by the account manager" } })
    await expectBlocked(executeCommand(operator, decideTimesheet, { idempotencyKey: key("self"), origin: "ui", payload: { timesheet: onBehalf.result.timesheetId, revision: 1, decision: "approve" } }), "self_approval")
    const finance = await ctxFor("user_demo_finance")
    await expectBlocked(executeCommand(finance, decideTimesheet, { idempotencyKey: key("fin"), origin: "ui", payload: { timesheet: base.result.timesheetId, revision: 1, decision: "approve" } }), "forbidden")
    const owner = await ctxFor("user_demo_owner")
    const rejected = await executeCommand(owner, decideTimesheet, { idempotencyKey: key("rej"), origin: "ui", payload: { timesheet: onBehalf.result.timesheetId, revision: 1, decision: "reject", reason: "Imported twice" } })
    expect(rejected.result).toMatchObject({ outcome: "rejected", state: "rejected" })
    let valuation: unknown = null
    for (const t of [base, scope]) {
      valuation = (await executeCommand(operator, decideTimesheet, { idempotencyKey: key("ap"), origin: "ui", payload: { timesheet: t.result.timesheetId, revision: t.result.revision, decision: "approve" } })).result.hour_valuation
    }
    expect(valuation).toMatchObject({ approvedMinutes: 8400, approvedValueMinor: "700000", rejectedExcludedMinutes: 600 })
    const fin = await withTenant(owner.tenant.id, (t) => loadJobFinancials(t, owner.tenant.id, AURORA))
    expect(fin.timesheets.filter((t) => t.state === "approved").reduce((s, t) => s + t.minutes, 0)).toBe(8400)
    expect(fin.timesheets.find((t) => t.id === onBehalf.result.timesheetId)?.decisionReason).toBe("Imported twice")
    const approvals = await withTenant(owner.tenant.id, (t) => t.select().from(approvalRequest).where(eq(approvalRequest.aggregateType, "timesheet")))
    expect(approvals.find((a) => a.id === base.result.approvalId)?.state).toBe("consumed")
    expect(approvals.find((a) => a.id === onBehalf.result.approvalId)?.state).toBe("rejected")
    await expectBlocked(
      executeCommand(operator, decideTimesheet, { idempotencyKey: key("again"), origin: "ui", payload: { timesheet: base.result.timesheetId, revision: 2, decision: "approve" } }),
      "blocked_by_rule",
      "timesheet_not_pending"
    )
    await expectBlocked(
      executeCommand(producer, submitTimesheet, { idempotencyKey: key("closed"), origin: "ui", payload: { job: AURORA, taskTitle: "Late entry", member: id("user_demo_producer"), workDate: "2026-12-15", minutes: 60, hourlyCost: "50.00" } }),
      "blocked_by_rule",
      "period_not_open"
    )
  })
})

describe("secondary demo-lab cases", () => {
  it("ooh_overlap: two concurrent reservations of face_demo_a 2027-03-10..24 → exactly one success", async () => {
    const operator = await ctxFor("user_demo_operator")
    const attempt = () =>
      executeCommand(operator, reserveOOHFace, { idempotencyKey: key("ooh"), origin: "ui", payload: { job: LAB, action: "reserve", face: "face_demo_a", startDate: "2027-03-10", endDate: "2027-03-24", operator: id("supplier_demo_ooh_operator") } })
    const results = await Promise.allSettled([attempt(), attempt()])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult
    expect((failed.reason as DomainError).details.rule).toBe("face_overlap")
  })

  it("an expired rate card cannot price a new order", async () => {
    const plan = await tx(async (t) => (await t.select().from(mediaPlanRevision).where(and(eq(mediaPlanRevision.jobId, LAB), eq(mediaPlanRevision.state, "approved"))))[0]!)
    await expectBlocked(
      executeCommand(await ctxFor("user_demo_operator"), issueMediaOrder, { idempotencyKey: key("expired"), origin: "ui", payload: { job: LAB, supplier: id("supplier_demo_billboard_co"), channel: "ooh", planRevision: plan.number, orderAmount: "100.00" } }),
      "blocked_by_rule",
      "rate_card_expired"
    )
  })
})
