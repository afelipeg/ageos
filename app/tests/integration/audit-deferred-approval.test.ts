// @vitest-environment node
import { eq } from "drizzle-orm"

import { agency, approvalRequest, configurationRevision, job } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { decideApprovalCommand, executeApprovedCommand } from "@/server/domain/approvals"
import { proposeFeeAmendment, recordClientAuthority } from "@/server/domain/budget"
import { reviewEvidence } from "@/server/domain/evidence"
import { computeProfitability, loadJobFinancials } from "@/server/domain/profitability"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo } from "./helpers"
import { setMembershipRole } from "./qa-helpers"

// Audit regression B07: an approval that was granted but could not execute
// (client authority missing) is executed later only if, at that moment, it is
// still unexpired, its capability is still enabled, the executor still has
// permission and the payload/revision still match. Otherwise nothing changes.

const AURORA = id("job_demo_aurora")
const RAYO = id("tenant_demo_rayo")

async function auroraFeeMinor() {
  const ctx = await ctxFor("user_demo_owner")
  return withTenant(ctx.tenant.id, async (tx) =>
    computeProfitability(await loadJobFinancials(tx, ctx.tenant.id, AURORA), "forecast", ctx.tenant.slug)
  ).then((p) => p.agencyFeeMinor)
}

async function auroraRevision() {
  const [j] = await ownerDb().select({ revision: job.revision }).from(job).where(eq(job.id, AURORA))
  return j!.revision
}

/** Fee amendment approved by finance but held: client authority 53,000 missing. */
async function approvedButHeldAmendment() {
  const operator = await ctxFor("user_demo_operator")
  const res = await executeCommand(operator, proposeFeeAmendment, {
    idempotencyKey: key("b07-fee"),
    payload: { job: AURORA, newAgencyFee: "23000.00", reason: "Price the 40 extra hours" },
    origin: "ui",
    expectedRevision: await auroraRevision(),
  })
  const finance = await ctxFor("user_demo_finance")
  const decided = await executeCommand(finance, decideApprovalCommand, {
    idempotencyKey: key("b07-decide"),
    payload: { approvalId: res.result.approvalId, decision: "approve", reviewedDigest: res.result.payloadDigest },
    origin: "ui",
  })
  expect(decided.result, "precondition: approved but held for client authority").toMatchObject({
    outcome: "approved",
    executed: false,
    blockedCode: "client_authority_missing",
  })
  return res.result.approvalId
}

/** Supplies the separately reviewed client authority (PO r2, 53,000). */
async function supplyClientAuthority() {
  const owner = await ctxFor("user_demo_owner")
  await executeCommand(owner, reviewEvidence, {
    idempotencyKey: key("b07-review"),
    payload: { evidence: id("ev:evidence_demo_po_r2"), decision: "reviewed", reason: "Client PO r2 checked for the amendment" },
    origin: "ui",
  })
  const operator = await ctxFor("user_demo_operator")
  const po = await executeCommand(operator, recordClientAuthority, {
    idempotencyKey: key("b07-po2"),
    payload: { job: AURORA, reference: "PO-AUR-2027-01", amount: "53000.00", evidenceId: id("ev:evidence_demo_po_r2") },
    origin: "ui",
  })
  const decided = await executeCommand(owner, decideApprovalCommand, {
    idempotencyKey: key("b07-po2-approve"),
    payload: { approvalId: po.result.approvalId, decision: "approve", reviewedDigest: po.result.payloadDigest },
    origin: "ui",
  })
  expect(decided.result, "precondition: client authority is now effective").toMatchObject({ outcome: "approved", executed: true })
}

async function executeLater() {
  const operator = await ctxFor("user_demo_operator")
  return (approvalId: string) =>
    executeCommand(operator, executeApprovedCommand, { idempotencyKey: key("b07-exec"), payload: { approvalId }, origin: "ui" })
}

/** The deferred execution must not apply: thrown block or executed=false. */
async function expectNotExecuted(p: Promise<{ result: { executed: boolean; blockedCode: string | null } }>, codes: string[]) {
  let code: string | null = null
  try {
    const r = await p
    expect(r.result.executed, "deferred execution must not apply").toBe(false)
    code = r.result.blockedCode
  } catch (e) {
    if (!(e instanceof DomainError)) throw e
    code = e.code
  }
  expect(codes, `blocked with ${code}`).toContain(code)
  expect(await auroraFeeMinor()).toBe(2000000n)
}

async function setFeeContractsEnabled(enabled: boolean) {
  const [a] = await ownerDb().select().from(agency).where(eq(agency.id, RAYO))
  const [cfg] = await ownerDb().select().from(configurationRevision).where(eq(configurationRevision.id, a!.publishedConfigRevisionId!))
  const set = new Set(cfg!.enabledCapabilities)
  if (enabled) set.add("agency-fee-contracts")
  else set.delete("agency-fee-contracts")
  await ownerDb().update(configurationRevision).set({ enabledCapabilities: [...set] }).where(eq(configurationRevision.id, cfg!.id))
}

afterAll(async () => {
  await setFeeContractsEnabled(true)
  await setMembershipRole("user_demo_operator", "tenant_demo_rayo", "account_manager")
  await closeOwnerDb()
})

describe("B07 · deferred approvals are re-validated at execution time", () => {
  beforeEach(async () => {
    await resetDemo()
  })

  it("control: a still-valid held approval executes once the client authority exists", async () => {
    const approvalId = await approvedButHeldAmendment()
    await supplyClientAuthority()
    const run = await executeLater()
    const r = await run(approvalId)
    expect(r.result.executed).toBe(true)
    expect(await auroraFeeMinor()).toBe(2300000n)
  })

  it("an approval that expired while held cannot be consumed later", async () => {
    const approvalId = await approvedButHeldAmendment()
    await ownerDb().update(approvalRequest).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(approvalRequest.id, approvalId))
    await supplyClientAuthority()
    const run = await executeLater()
    await expectNotExecuted(run(approvalId), ["approval_stale", "approval_required", "blocked_by_rule", "approval_expired", "expired"])
    const [a] = await ownerDb().select().from(approvalRequest).where(eq(approvalRequest.id, approvalId))
    expect(a!.state).not.toBe("consumed")
  })

  it("an approval whose capability was disabled meanwhile cannot be executed", async () => {
    const approvalId = await approvedButHeldAmendment()
    await supplyClientAuthority()
    await setFeeContractsEnabled(false)
    try {
      const run = await executeLater()
      await expectNotExecuted(run(approvalId), ["capability_disabled"])
    } finally {
      await setFeeContractsEnabled(true)
    }
  })

  it("an executor who lost the permission meanwhile cannot execute", async () => {
    const approvalId = await approvedButHeldAmendment()
    await supplyClientAuthority()
    await setMembershipRole("user_demo_operator", "tenant_demo_rayo", "viewer")
    try {
      const run = await executeLater()
      await expectNotExecuted(run(approvalId), ["forbidden"])
    } finally {
      await setMembershipRole("user_demo_operator", "tenant_demo_rayo", "account_manager")
    }
  })

  it("a material change to the job after approval invalidates the held approval", async () => {
    const approvalId = await approvedButHeldAmendment()
    // A new cost estimate bumps the job revision the approval was bound to.
    const { recordCostEstimate } = await import("@/server/domain/budget")
    const operator = await ctxFor("user_demo_operator")
    await executeCommand(operator, recordCostEstimate, {
      idempotencyKey: key("b07-change"),
      payload: { job: AURORA, laborMinutes: 8400, hourlyCost: "50.00", productionVendorAmount: "5600.00", expenseAmount: "500.00", reason: "Vendor quote changed" },
      origin: "ui",
      expectedRevision: await auroraRevision(),
    })
    await supplyClientAuthority()
    const run = await executeLater()
    await expectNotExecuted(run(approvalId), ["approval_stale", "approval_required", "blocked_by_rule"])
  })
})
