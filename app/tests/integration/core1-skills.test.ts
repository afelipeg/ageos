// @vitest-environment node
// Core-1 skills ERP-01..ERP-10: fixtures run like the QA harness (positive
// persists and is re-runnable; negative blocked by its rule with no side
// effect) plus the scenario rules behind each contract.
import { and, eq, sql } from "drizzle-orm"

import { CAPABILITY_CONTRACTS } from "@/lib/capabilities/catalog.generated"
import { resolveAgencyContext, type AgencyContext } from "@/server/auth/context"
import { FIXTURES } from "@/server/capabilities/registry"
import { runCapability } from "@/server/capabilities/runner"
import * as s from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { decideApprovalCommand, executeApprovedCommand, listApprovals } from "@/server/domain/approvals"
import { assertBillingReady, evaluateBillingReadiness } from "@/server/domain/billing-requirements"
import { proposeFeeAmendment, recordClientAuthority, recordCostEstimate, reserveBudget } from "@/server/domain/budget"
import { createClientIntake } from "@/server/domain/clients"
import { assertConnectionActive, configureDemoConnection } from "@/server/domain/connections"
import { registerEvidence, reviewEvidence } from "@/server/domain/evidence"
import { proposeAccessChange } from "@/server/domain/governance"
import { getJobRevision, openOrCloseJob } from "@/server/domain/jobs"
import { upsertMasterRecord } from "@/server/domain/master-data"
import { saveRateCardAgreement } from "@/server/domain/media-buying"
import { submitTimesheet } from "@/server/domain/timesheets"
import { recomputeJobReadiness, recordReadinessCheckpoint } from "@/server/domain/orchestrator"
import { computeProfitability, loadJobFinancials } from "@/server/domain/profitability"
import { currentAggregateRevision, invalidatePendingApprovals } from "@/server/kernel/approvals"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo, sessionFor } from "./helpers"

const SKILLS = [
  "agency-orchestrator",
  "agency-integrations",
  "agency-access-governance",
  "agency-master-data",
  "agency-onboarding",
  "agency-job-lifecycle",
  "agency-contract-po",
  "agency-budget-control",
  "agency-fee-contracts",
  "agency-billing-requirements",
] as const

const AURORA = id("job_demo_aurora")
const LAB = id("job_demo_lab")
const actor = (k: string) => ctxFor(k)
const code = (c: string, rule?: string) => (e: unknown) => e instanceof DomainError && e.code === c && (!rule || e.details.rule === rule)

// Tables a blocked command must not touch (runs/steps record the attempt).
const WATCHED = [
  s.businessEvent,
  s.idempotencyRecord,
  s.actionProposal,
  s.approvalRequest,
  s.contract,
  s.budgetReservation,
  s.budgetRevision,
  s.client,
  s.brief,
  s.job,
  s.supplier,
  s.evidence,
  s.connection,
  s.memberAccess,
  s.masterExternalRef,
  s.readinessCheckpoint,
  s.feeSchedule,
  s.billingReadiness,
] as const

async function snapshot(ctx: AgencyContext) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const out: number[] = []
    for (const t of WATCHED) out.push((await tx.select({ n: sql<number>`count(*)::int` }).from(t))[0]!.n)
    return out
  })
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe.each(SKILLS)("%s fixtures (QA harness contract)", (skillId) => {
  const contract = CAPABILITY_CONTRACTS.find((c) => c.skillId === skillId)!

  it("positive succeeds, returns every repository output and is re-runnable", async () => {
    const fx = FIXTURES[skillId]!
    for (let run = 0; run < 2; run++) {
      const p = await fx.positive(actor)
      const ctx = await actor(p.actorKey)
      const out = await runCapability(ctx, skillId, p.input, { origin: "ui", idempotencyKey: key(`${skillId}-pos-${run}`), expectedRevision: p.expectedRevision })
      expect(out.state, JSON.stringify(out.error)).toBe("succeeded")
      for (const k of contract.repositoryOutputs) expect(out.output, `${skillId} output ${k}`).toHaveProperty(k)
      await p.verify?.(out.output, ctx)
      const [row] = await withTenant(ctx.tenant.id, (tx) => tx.select().from(s.workflowRun).where(eq(s.workflowRun.id, out.runId)))
      expect(row!.state).toBe("succeeded")
    }
  })

  it("negative is blocked by its rule with no side effect", async () => {
    const n = await FIXTURES[skillId]!.negative(actor)
    const ctx = await actor(n.actorKey)
    const before = await snapshot(ctx)
    const out = await runCapability(ctx, skillId, n.input, { origin: "ui", idempotencyKey: key(`${skillId}-neg`), expectedRevision: n.expectedRevision })
    expect(out.state).toBe("blocked")
    expect(out.error?.code).toBe(n.expectCode)
    if (n.expectRule) expect(out.error?.details.rule).toBe(n.expectRule)
    expect(await snapshot(ctx)).toEqual(before)
  })
})

describe("ERP-01 orchestrator", () => {
  it("recomputing the same state reuses the persisted checkpoint", async () => {
    const ctx = await actor("user_demo_operator")
    const run = async (label: string) =>
      executeCommand(ctx, recordReadinessCheckpoint, { idempotencyKey: key(label), payload: { job: LAB }, origin: "ui", expectedRevision: await getJobRevision(ctx, LAB) })
    const a = await run("cp-a")
    const b = await run("cp-b")
    expect(b.result.checkpointId).toBe(a.result.checkpointId)
    expect(b.result.checkpointReused).toBe(true)
  })

  it("a newer plan revision awaiting approval blocks the dependent media purchase", async () => {
    const ctx = await actor("user_demo_operator")
    expect((await recomputeJobReadiness(ctx, { job: AURORA })).dependency_graph.find((n) => n.key === "media_plan")!.status).toBe("done")
    await ownerDb().insert(s.mediaPlanRevision).values({
      tenantId: ctx.tenant.id,
      jobId: AURORA,
      number: 2,
      state: "submitted",
      totalMinor: 3000000n,
      currency: "USD",
      objective: "Reallocation pending approval",
    })
    try {
      const r = await recomputeJobReadiness(ctx, { job: AURORA })
      const plan = r.dependency_graph.find((n) => n.key === "media_plan")!
      expect(plan).toMatchObject({ status: "blocked", detail: { code: "plan_revision_outdated", approvedRevision: 1, pendingRevision: 2 } })
      expect(r.dependency_graph.find((n) => n.key === "media_buying")!.status).toBe("blocked")
    } finally {
      await ownerDb().delete(s.mediaPlanRevision).where(and(eq(s.mediaPlanRevision.jobId, AURORA), eq(s.mediaPlanRevision.number, 2)))
    }
  })
})

describe("ERP-02 integrations", () => {
  it("revoking one account blocks only actions that depend on it", async () => {
    const owner = await actor("user_demo_owner")
    await executeCommand(owner, configureDemoConnection, { idempotencyKey: key("conn-lab"), payload: { action: "connect", provider: "tiktok_ads", accountAlias: "demo_lab_tiktok" }, origin: "ui" })
    await executeCommand(owner, configureDemoConnection, { idempotencyKey: key("conn-revoke"), payload: { action: "revoke", provider: "tiktok_ads", accountAlias: "demo_lab_tiktok" }, origin: "ui" })
    await expect(assertConnectionActive(owner, "tiktok_ads", "demo_lab_tiktok")).rejects.toSatisfy(code("connection_revoked"))
    await expect(assertConnectionActive(owner, "tiktok_ads", "demo_tiktok_aurora")).resolves.toBeUndefined()
    // The alias of one provider never resolves under another provider.
    await expect(
      executeCommand(owner, configureDemoConnection, { idempotencyKey: key("conn-cross"), payload: { action: "test", provider: "google_ads", accountAlias: "demo_meta_aurora" }, origin: "ui" })
    ).rejects.toSatisfy(code("not_found"))
  })
})

describe("ERP-03 access governance", () => {
  it("an owner other than the requester approves and the role changes server-side", async () => {
    const operator = await actor("user_demo_operator")
    const res = await executeCommand(operator, proposeAccessChange, {
      idempotencyKey: key("acc"),
      payload: { member: id("user_demo_lab_member"), proposedRole: "producer", effectiveScope: "assigned_jobs", reason: "Joins production" },
      origin: "ui",
    })
    const decide = async (userKey: string) =>
      executeCommand(await actor(userKey), decideApprovalCommand, {
        idempotencyKey: key(`acc-${userKey}`),
        payload: { approvalId: res.result.approvalId, decision: "approve", reviewedDigest: res.result.payloadDigest },
        origin: "ui",
      })
    await expect(decide("user_demo_finance")).rejects.toSatisfy(code("approver_not_eligible"))
    await expect(decide("user_demo_operator")).rejects.toSatisfy(code("forbidden"))
    const ok = await decide("user_demo_owner")
    expect(ok.result).toMatchObject({ outcome: "approved", executed: true })
    const member = await resolveAgencyContext(await sessionFor("user_demo_lab_member"), "rayo-de-sol")
    expect(member?.role).toBe("producer")
    expect(member?.permissions.has("production.manage")).toBe(true)
  })

  it("the owner cannot approve a change they requested; other agencies' users are not found", async () => {
    const owner = await actor("user_demo_owner")
    const res = await executeCommand(owner, proposeAccessChange, {
      idempotencyKey: key("acc-owner"),
      payload: { member: id("user_demo_lab_member"), proposedRole: "viewer", effectiveScope: "agency_wide", reason: "Back to viewer" },
      origin: "ui",
    })
    await expect(
      executeCommand(owner, decideApprovalCommand, {
        idempotencyKey: key("acc-owner-self"),
        payload: { approvalId: res.result.approvalId, decision: "approve", reviewedDigest: res.result.payloadDigest },
        origin: "ui",
      })
    ).rejects.toSatisfy(code("self_approval"))
    await expect(
      executeCommand(owner, proposeAccessChange, {
        idempotencyKey: key("acc-cross"),
        payload: { member: id("user_demo_norte_owner"), proposedRole: "viewer", effectiveScope: "agency_wide", reason: "Cross-tenant attempt" },
        origin: "ui",
      })
    ).rejects.toSatisfy(code("not_found"))
  })
})

describe("ERP-04 master data", () => {
  it("a probable duplicate becomes a merge proposal; approval maps it without a second record", async () => {
    const operator = await actor("user_demo_operator")
    const before = (await withTenant(operator.tenant.id, (tx) => tx.select().from(s.supplier))).length
    const res = await executeCommand(operator, upsertMasterRecord, {
      idempotencyKey: key("md-dup"),
      payload: { recordType: "supplier", code: "LMN", legalName: "Lumen Production Demo, Inc.", externalMapping: "demo_ledger:LMN-01" },
      origin: "ui",
    })
    expect(res.result.outcome).toBe("merge_proposed")
    const approval = res.result.provisional_approval_requests[0]!
    const decided = await executeCommand(await actor("user_demo_finance"), decideApprovalCommand, {
      idempotencyKey: key("md-merge"),
      payload: { approvalId: approval.approvalId, decision: "approve", reviewedDigest: approval.payloadDigest },
      origin: "ui",
    })
    expect(decided.result).toMatchObject({ outcome: "approved", executed: true })
    expect((await withTenant(operator.tenant.id, (tx) => tx.select().from(s.supplier))).length).toBe(before)
    // The mapped external id now resolves straight to the one master.
    const again = await executeCommand(operator, upsertMasterRecord, {
      idempotencyKey: key("md-again"),
      payload: { recordType: "supplier", code: "LUM", legalName: "Lumen Production Demo", externalMapping: "demo_ledger:LMN-01" },
      origin: "ui",
    })
    expect(again.result.recordId).toBe(id("supplier_demo_lumen"))
  })
})

describe("ERP-05 onboarding", () => {
  it("creates a new client once; the same identity resolves to it; a twin name or conflicting identity is blocked", async () => {
    const operator = await actor("user_demo_operator")
    const payload = { clientName: "Nimbus Water Co", clientCode: "NWC", productCode: "NW", billingCurrency: "USD", country: "US", briefTitle: "Nimbus launch", briefSummary: "Fictional water brand launch brief." }
    const a = await executeCommand(operator, createClientIntake, { idempotencyKey: key("ob-a"), payload, origin: "ui" })
    const b = await executeCommand(operator, createClientIntake, { idempotencyKey: key("ob-b"), payload, origin: "ui" })
    expect(a.result.duplicateAvoided).toBe(false)
    expect(b.result).toMatchObject({ clientId: a.result.clientId, briefId: a.result.briefId, duplicateAvoided: true, briefReused: true })
    await expect(
      executeCommand(operator, createClientIntake, { idempotencyKey: key("ob-c"), payload: { ...payload, clientCode: "NWX" }, origin: "ui" })
    ).rejects.toSatisfy(code("blocked_by_rule", "duplicate_client_name"))
    await expect(
      executeCommand(operator, createClientIntake, { idempotencyKey: key("ob-d"), payload: { ...payload, clientName: "Other Legal Name SA" }, origin: "ui" })
    ).rejects.toSatisfy(code("blocked_by_rule", "conflicting_client_identity"))
    const rows = await withTenant(operator.tenant.id, (tx) => tx.select().from(s.client).where(eq(s.client.code, "NWC")))
    expect(rows).toHaveLength(1)
  })
})

describe("ERP-08 budget control", () => {
  it("two concurrent USD 700 reservations against a fresh USD 1,000 authority: one succeeds; a stale revision conflicts", async () => {
    const pos = await FIXTURES["agency-budget-control"]!.positive(actor)
    const jobId = pos.input.job as string
    const ctx = await actor("user_demo_operator")
    // The fixture prepared a fresh authority of 1,000 with nothing reserved.
    const attempt = (label: string) =>
      executeCommand(ctx, reserveBudget, { idempotencyKey: key(label), payload: { job: jobId, budgetScope: "client_commercial_authority", amount: "700.00", purpose: "Concurrent" }, origin: "ui" })
    const results = await Promise.allSettled([attempt("c1"), attempt("c2")])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult
    expect(failed.reason).toSatisfy(code("blocked_by_rule", "budget_available"))
    await expect(
      executeCommand(ctx, reserveBudget, {
        idempotencyKey: key("stale"),
        payload: { job: jobId, budgetScope: "client_commercial_authority", amount: "1.00", purpose: "Stale" },
        origin: "ui",
        expectedRevision: (await getJobRevision(ctx, jobId)) + 1,
      })
    ).rejects.toSatisfy(code("revision_conflict"))
  })
})

describe("ERP-09 fee contracts · Aurora scope change (J04 path)", () => {
  it("fee 20k→23k: schedule + approved hours only; executes after reviewed PO r2 authorizes 53,000", async () => {
    const operator = await actor("user_demo_operator")
    const finance = await actor("user_demo_finance")
    const owner = await actor("user_demo_owner")
    await executeCommand(operator, recordCostEstimate, {
      idempotencyKey: key("j04-est"),
      payload: { job: AURORA, laborMinutes: 8400, hourlyCost: "50.00", productionVendorAmount: "5500.00", expenseAmount: "500.00", reason: "Scope change adds 40 hours" },
      origin: "ui",
      expectedRevision: await getJobRevision(operator, AURORA),
    })
    const fee = await executeCommand(operator, proposeFeeAmendment, {
      idempotencyKey: key("j04-fee"),
      payload: { job: AURORA, newAgencyFee: "23000.00", reason: "Price the 40 extra hours" },
      origin: "ui",
      expectedRevision: await getJobRevision(operator, AURORA),
    })
    expect(fee.result.marginAfterBps).toBe(4348)
    expect(fee.result.instalment_schedule.lines).toEqual([
      { instalmentNumber: 1, month: "2027-03", share: "media", amountMinor: "1150000" },
      { instalmentNumber: 1, month: "2027-03", share: "production", amountMinor: "1150000" },
    ])
    expect(fee.result.hourly_settlement).toMatchObject({ totalHoursHundredths: "0", unusedHoursHundredths: "14000", totalBillableMinor: "2300000" })
    const decided = await executeCommand(finance, decideApprovalCommand, {
      idempotencyKey: key("j04-fee-approve"),
      payload: { approvalId: fee.result.approvalId, decision: "approve", reviewedDigest: fee.result.payloadDigest },
      origin: "ui",
    })
    expect(decided.result).toMatchObject({ outcome: "approved", executed: false, blockedCode: "client_authority_missing" })

    // Client authority r2: reviewed evidence (owner), then internal approval.
    await executeCommand(owner, reviewEvidence, {
      idempotencyKey: key("j04-review"),
      payload: { evidence: id("ev:evidence_demo_po_r2"), decision: "reviewed", reason: "Signed PO r2 for 53,000" },
      origin: "ui",
    })
    const po = await executeCommand(operator, recordClientAuthority, {
      idempotencyKey: key("j04-po"),
      payload: { job: AURORA, reference: "PO-AUR-2027-01", amount: "53000.00", evidenceId: id("ev:evidence_demo_po_r2") },
      origin: "ui",
    })
    expect((await executeCommand(owner, decideApprovalCommand, {
      idempotencyKey: key("j04-po-approve"),
      payload: { approvalId: po.result.approvalId, decision: "approve", reviewedDigest: po.result.payloadDigest },
      origin: "ui",
    })).result).toMatchObject({ outcome: "approved", executed: true })

    const applied = await executeCommand(operator, executeApprovedCommand, { idempotencyKey: key("j04-apply"), payload: { approvalId: fee.result.approvalId }, origin: "ui" })
    expect(applied.result.executed).toBe(true)
    const p = await withTenant(operator.tenant.id, async (tx) => computeProfitability(await loadJobFinancials(tx, operator.tenant.id, AURORA), "forecast", "rayo-de-sol"))
    expect(p).toMatchObject({ agencyFeeMinor: 2300000n, marginMinor: 1000000n, marginBps: 4348, managedMediaMinor: 3000000n })
    const [sched] = await withTenant(operator.tenant.id, (tx) => tx.select().from(s.feeSchedule).where(eq(s.feeSchedule.id, fee.result.fee_contract_draft.feeScheduleId)))
    expect(sched!.state).toBe("approved")
  })
})

describe("ERP-10 billing requirements", () => {
  it("rejecting the acceptance evidence afterwards blocks invoice preparation server-side", async () => {
    const operator = await actor("user_demo_operator")
    const job = id("job_demo_lab_billing")
    await executeCommand(operator, evaluateBillingReadiness, {
      idempotencyKey: key("br-ok"),
      payload: { job, deliverableAccepted: true, poNumber: "PO-LAB-BILL-01", acceptanceEvidence: id("ev:evidence_demo_c1_lab_acceptance") },
      origin: "ui",
    })
    await expect(withTenant(operator.tenant.id, (tx) => assertBillingReady(tx, operator.tenant.id, job))).resolves.toMatchObject({ readinessId: expect.any(String) })
    await executeCommand(await actor("user_demo_owner"), reviewEvidence, {
      idempotencyKey: key("br-reject"),
      payload: { evidence: id("ev:evidence_demo_c1_lab_acceptance"), decision: "rejected", reason: "Client withdrew acceptance" },
      origin: "ui",
    })
    await expect(withTenant(operator.tenant.id, (tx) => assertBillingReady(tx, operator.tenant.id, job))).rejects.toSatisfy(
      code("blocked_by_rule", "billing_requirements_invalid")
    )
  })
})

describe("evidence review separation of duties", () => {
  it("an owner who registered evidence cannot review it; finance can", async () => {
    const owner = await actor("user_demo_owner")
    const reg = await executeCommand(owner, registerEvidence, {
      idempotencyKey: key("ev-reg"),
      payload: { file: id("evidence_demo_po_r2"), kind: "client_po", title: "Re-registered PO r2", job: AURORA },
      origin: "ui",
    })
    await expect(
      executeCommand(owner, reviewEvidence, { idempotencyKey: key("ev-self"), payload: { evidence: reg.result.evidenceId, decision: "reviewed", reason: "Self review" }, origin: "ui" })
    ).rejects.toSatisfy(code("self_approval"))
    const ok = await executeCommand(await actor("user_demo_finance"), reviewEvidence, {
      idempotencyKey: key("ev-fin"),
      payload: { evidence: reg.result.evidenceId, decision: "reviewed", reason: "Finance review" },
      origin: "ui",
    })
    expect(ok.result.reviewState).toBe("reviewed")
  })
})

describe("job lifecycle keeps demo-lab out of primary KPIs", () => {
  it("jobs opened for the demo-lab client inherit its reporting group", async () => {
    const ctx = await actor("user_demo_operator")
    const res = await executeCommand(ctx, openOrCloseJob, {
      idempotencyKey: key("lab-open"),
      payload: { action: "open", client: id("client_demo_lab"), jobName: "Lab reporting group", jobType: "A", billingCode: "F", period: "2027-03" },
      origin: "ui",
    })
    const [j] = await withTenant(ctx.tenant.id, (tx) => tx.select().from(s.job).where(eq(s.job.id, res.result.jobId)))
    expect(j!.reportingGroup).toBe("demo-lab")
  })
})

describe("kernel services requested by Core-2", () => {
  it("a new cost estimate keeps the production vendor of the superseded one", async () => {
    const operator = await actor("user_demo_operator")
    const res = await executeCommand(operator, recordCostEstimate, {
      idempotencyKey: key("est-vendor"),
      payload: { job: AURORA, laborMinutes: 8400, hourlyCost: "50.00", productionVendorAmount: "5600.00", expenseAmount: "500.00", reason: "Vendor quote revised" },
      origin: "ui",
      expectedRevision: await getJobRevision(operator, AURORA),
    })
    const lines = await withTenant(operator.tenant.id, (tx) => tx.select().from(s.costEstimateLine).where(eq(s.costEstimateLine.estimateId, res.result.estimateId)))
    expect(lines.find((l) => l.lineType === "production")!.supplierId).toBe(id("supplier_demo_lumen"))
  })

  it("rate_card and timesheet approvals resolve their aggregate revision; invalidation can target action types", async () => {
    const operator = await actor("user_demo_operator")
    const [ts] = await ownerDb().select().from(s.timesheet).where(eq(s.timesheet.fixtureKey, "time_lab_fee_submitted"))
    const rev = await withTenant(operator.tenant.id, (tx) => currentAggregateRevision(tx, operator.tenant.id, "timesheet", ts!.id))
    expect(rev).toBe(ts!.revision)
    await expect(withTenant(operator.tenant.id, (tx) => currentAggregateRevision(tx, operator.tenant.id, "rate_card", ts!.id))).resolves.toBeNull()

    const fee = await executeCommand(operator, proposeFeeAmendment, {
      idempotencyKey: key("filter-fee"),
      payload: { job: id("job_demo_lab_fee"), newAgencyFee: "1300.00", reason: "Filter probe" },
      origin: "ui",
      expectedRevision: await getJobRevision(operator, id("job_demo_lab_fee")),
    })
    const n0 = await withTenant(operator.tenant.id, (tx) => invalidatePendingApprovals(tx, operator.tenant.id, "job", id("job_demo_lab_fee"), { actionTypes: ["media.plan_approval"] }))
    expect(n0).toBe(0)
    const n1 = await withTenant(operator.tenant.id, (tx) => invalidatePendingApprovals(tx, operator.tenant.id, "job", id("job_demo_lab_fee"), { actionTypes: ["budget.fee_amendment"] }))
    expect(n1).toBe(1)
    const [a] = await ownerDb().select().from(s.approvalRequest).where(eq(s.approvalRequest.id, fee.result.approvalId))
    expect(a!.state).toBe("stale")
  })
})

describe("kernel decisions use the policy's decide permission (time.approve) and reject hooks", () => {
  const LAB_OPS = id("job_demo_lab_ops")
  const submit = async (label: string) =>
    executeCommand(await actor("user_demo_producer"), submitTimesheet, {
      idempotencyKey: key(`ts-${label}`),
      payload: { job: LAB_OPS, taskTitle: `Inbox decision ${label}`, member: id("user_demo_producer"), workDate: "2027-03-18", minutes: 120, hourlyCost: "50.00" },
      origin: "ui",
    })
  const decide = async (userKey: string, approvalId: string, digest: string, decision: "approve" | "reject", reason?: string) =>
    executeCommand(await actor(userKey), decideApprovalCommand, {
      idempotencyKey: key(`inbox-${userKey}-${decision}`),
      payload: { approvalId, decision, reviewedDigest: digest, ...(reason ? { reason } : {}) },
      origin: "ui",
    })

  it("an account manager approves hours from the approvals inbox; finance and the worker cannot", async () => {
    const ts = await submit("approve")
    const operator = await actor("user_demo_operator")
    const inbox = await listApprovals(operator, { state: "awaiting_approval" })
    expect(inbox.find((a) => a.id === ts.result.approvalId)?.canDecide).toBe(true)
    await expect(decide("user_demo_finance", ts.result.approvalId, ts.result.payloadDigest, "approve")).rejects.toSatisfy(code("forbidden"))
    await expect(decide("user_demo_producer", ts.result.approvalId, ts.result.payloadDigest, "approve")).rejects.toSatisfy(code("forbidden"))
    const done = await decide("user_demo_operator", ts.result.approvalId, ts.result.payloadDigest, "approve")
    expect(done.result).toMatchObject({ outcome: "approved", executed: true })
    const [row] = await ownerDb().select().from(s.timesheet).where(eq(s.timesheet.id, ts.result.timesheetId))
    expect(row!.state).toBe("approved")
  })

  it("the author of an entry cannot approve it from the inbox even with time.approve (owner not exempt)", async () => {
    const owner = await actor("user_demo_owner")
    const ts = await executeCommand(owner, submitTimesheet, {
      idempotencyKey: key("ts-owner"),
      payload: { job: LAB_OPS, taskTitle: "Owner-logged entry", member: id("user_demo_producer"), workDate: "2027-03-18", minutes: 60, hourlyCost: "50.00" },
      origin: "ui",
    })
    expect((await listApprovals(owner, { state: "awaiting_approval" })).find((a) => a.id === ts.result.approvalId)?.canDecide).toBe(false)
    await expect(decide("user_demo_owner", ts.result.approvalId, ts.result.payloadDigest, "approve")).rejects.toSatisfy(code("self_approval"))
  })

  it("the worker whose hours they are cannot approve them, even when someone else logged them", async () => {
    const owner = await actor("user_demo_owner")
    const ts = await executeCommand(owner, submitTimesheet, {
      idempotencyKey: key("ts-for-operator"),
      payload: { job: LAB_OPS, taskTitle: "Hours of the account manager", member: id("user_demo_operator"), workDate: "2027-03-18", minutes: 60, hourlyCost: "50.00" },
      origin: "ui",
    })
    const operator = await actor("user_demo_operator")
    expect((await listApprovals(operator, { state: "awaiting_approval" })).find((a) => a.id === ts.result.approvalId)?.canDecide).toBe(false)
    await expect(decide("user_demo_operator", ts.result.approvalId, ts.result.payloadDigest, "approve")).rejects.toSatisfy(code("self_approval"))
  })

  it("an inbox rejection marks the timesheet rejected with the reason, once", async () => {
    const ts = await submit("reject")
    const res = await decide("user_demo_operator", ts.result.approvalId, ts.result.payloadDigest, "reject", "Logged on the wrong job")
    expect(res.result.outcome).toBe("rejected")
    const [row] = await ownerDb().select().from(s.timesheet).where(eq(s.timesheet.id, ts.result.timesheetId))
    expect(row).toMatchObject({ state: "rejected", decisionReason: "Logged on the wrong job" })
    const events = await ownerDb().select().from(s.businessEvent).where(and(eq(s.businessEvent.aggregateId, ts.result.timesheetId), eq(s.businessEvent.eventType, "timesheet.rejected")))
    expect(events).toHaveLength(1)
  })

  it("an inbox rejection marks the rate card rejected with the reason", async () => {
    const operator = await actor("user_demo_operator")
    const card = await executeCommand(operator, saveRateCardAgreement, {
      idempotencyKey: key("rc"),
      payload: { supplier: id("supplier_demo_meta_ads"), medium: "digital", validFrom: "2027-03-01", validTo: "2027-12-31", grossRate: "12.00", firstDiscountBps: 1000 },
      origin: "ui",
    })
    const res = await decide("user_demo_finance", card.result.approvalId, card.result.payloadDigest, "reject", "Rate above the agreed cap")
    expect(res.result.outcome).toBe("rejected")
    const [row] = await ownerDb().select().from(s.rateCard).where(eq(s.rateCard.id, card.result.rateCardId))
    expect(row).toMatchObject({ state: "rejected", decisionReason: "Rate above the agreed cap" })
  })
})
