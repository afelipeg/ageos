// @vitest-environment node
import { randomUUID } from "node:crypto"

import { and, eq } from "drizzle-orm"

import { approvalRequest, contract, evidence, fileObject } from "@/server/db/schema"
import { recordClientAuthority } from "@/server/domain/budget"
import { decideApprovalCommand } from "@/server/domain/approvals"
import { reviewEvidence } from "@/server/domain/evidence"
import { executeCommand } from "@/server/kernel/commands"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo } from "./helpers"
import { diffSnapshots, expectDomainError, snapshotDb } from "./qa-helpers"

// Audit regression B06: a client PO can only become commercial authority when
// its evidence exists, belongs to this agency, is reviewed, is linked to the
// client/job and has not changed since review. Every blocked attempt leaves
// no contract, proposal or approval behind. Accepted block codes are the
// contract's rule codes (blocked_by_rule | not_found | validation).

const AURORA = id("job_demo_aurora")
const LAB = id("job_demo_lab")
const BLOCK = ["blocked_by_rule", "not_found", "validation"]

async function attempt(evidenceId: string, label: string, jobId = AURORA) {
  const ctx = await ctxFor("user_demo_operator")
  return executeCommand(ctx, recordClientAuthority, {
    idempotencyKey: key(`b06-${label}`),
    payload: { job: jobId, reference: `PO-B06-${label.toUpperCase()}`, amount: "53000.00", evidenceId },
    origin: "ui",
  })
}

async function expectBlockedWithoutEffects(p: () => Promise<unknown>) {
  const before = await snapshotDb()
  await expectDomainError(p(), BLOCK)
  expect(diffSnapshots(before, await snapshotDb())).toEqual([])
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("B06 · PO evidence must be real, own, reviewed and unchanged", () => {
  it("rejects a random UUID that is not an evidence record", async () => {
    await expectBlockedWithoutEffects(() => attempt(randomUUID(), "random"))
  })

  it("rejects another agency's evidence id (Norte private brief)", async () => {
    await expectBlockedWithoutEffects(() => attempt(id("ev:evidence_demo_norte_private"), "foreign"))
  })

  it("rejects a file id passed where an evidence id is required", async () => {
    await expectBlockedWithoutEffects(() => attempt(id("evidence_demo_po_r1"), "fileid"))
  })

  it("rejects evidence that is not a client PO (the creative brief)", async () => {
    await expectBlockedWithoutEffects(() => attempt(id("ev:evidence_demo_brief"), "brief"))
  })

  it("rejects evidence linked to another job (Aurora PO used for the demo-lab job)", async () => {
    await expectBlockedWithoutEffects(() => attempt(id("ev:evidence_demo_po_r1"), "otherjob", LAB))
  })

  it("rejects unreviewed evidence (received, not reviewed)", async () => {
    const [ev] = await ownerDb().select().from(evidence).where(eq(evidence.id, id("ev:evidence_demo_po_r2")))
    expect(ev?.reviewState, "seed precondition: PO r2 starts unreviewed").not.toBe("reviewed")
    await expectBlockedWithoutEffects(() => attempt(id("ev:evidence_demo_po_r2"), "unreviewed"))
  })

  it("an approval cannot make authority effective if the evidence file changed after review", async () => {
    // PO r2 is reviewed by the owner and accepted for the proposal...
    await executeCommand(await ctxFor("user_demo_owner"), reviewEvidence, {
      idempotencyKey: key("b06-review"),
      payload: { evidence: id("ev:evidence_demo_po_r2"), decision: "reviewed", reason: "Checked before the tamper probe" },
      origin: "ui",
    })
    const res = await attempt(id("ev:evidence_demo_po_r2"), "tamper")
    // ...then its stored file is replaced (new content hash) before the decision.
    await ownerDb()
      .update(fileObject)
      .set({ sha256: "f".repeat(64) })
      .where(eq(fileObject.id, id("evidence_demo_po_r2")))
    const owner = await ctxFor("user_demo_owner")
    const decision = await executeCommand(owner, decideApprovalCommand, {
      idempotencyKey: key("b06-tamper-approve"),
      payload: { approvalId: res.result.approvalId, decision: "approve", reviewedDigest: res.result.payloadDigest },
      origin: "ui",
    }).catch((e: unknown) => e)
    const [c] = await ownerDb().select().from(contract).where(eq(contract.id, res.result.contractId))
    expect(c?.state, `authority must not be approved on changed evidence (decision: ${JSON.stringify(decision)})`).not.toBe("approved")
    const [a] = await ownerDb()
      .select()
      .from(approvalRequest)
      .where(and(eq(approvalRequest.id, res.result.approvalId)))
    expect(["approved", "consumed"]).not.toContain(a?.state)
  })
})
