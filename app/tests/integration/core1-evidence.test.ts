// @vitest-environment node
// Core-1 regression for audit finding B06: client PO authority requires real,
// reviewed, same-tenant evidence linked to the job/client, pinned by hash.
import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"

import { approvalRequest, contract, evidence, fileObject } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { decideApprovalCommand } from "@/server/domain/approvals"
import { recordClientAuthority } from "@/server/domain/budget"
import { listEvidence, reviewEvidence } from "@/server/domain/evidence"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo } from "./helpers"

const AURORA = id("job_demo_aurora")
const LAB = id("job_demo_lab")

const blockedBy = (rule: string) => (e: unknown) => e instanceof DomainError && e.code === "blocked_by_rule" && e.details.rule === rule

async function record(evidenceRef: string, label: string, job = AURORA, amount = "53000.00") {
  const operator = await ctxFor("user_demo_operator")
  return executeCommand(operator, recordClientAuthority, {
    idempotencyKey: key(`b06-${label}`),
    payload: { job, reference: `PO-B06-${label}`, amount, validFrom: "2027-03-01", validTo: "2027-06-30", evidenceId: evidenceRef },
    origin: "ui",
  })
}

async function approve(userKey: string, res: { result: { approvalId: string; payloadDigest: string } }, label: string) {
  return executeCommand(await ctxFor(userKey), decideApprovalCommand, {
    idempotencyKey: key(`b06-${label}-approve`),
    payload: { approvalId: res.result.approvalId, decision: "approve", reviewedDigest: res.result.payloadDigest },
    origin: "ui",
  })
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("B06 · client PO authority evidence", () => {
  it("rejects a random UUID and a bare file id: only evidence records count", async () => {
    await expect(record(randomUUID(), "random")).rejects.toSatisfy(blockedBy("evidence_not_found"))
    await expect(record(id("evidence_demo_po_r1"), "file-id")).rejects.toSatisfy(blockedBy("evidence_not_found"))
  })

  it("rejects evidence that belongs to another agency (RLS: not even visible)", async () => {
    await expect(record(id("ev:evidence_demo_norte_private"), "foreign")).rejects.toSatisfy(blockedBy("evidence_not_found"))
  })

  it("rejects client PO evidence of another client and evidence of another kind", async () => {
    await expect(record(id("ev:evidence_demo_po_r1"), "other-client", LAB, "1000.00")).rejects.toSatisfy(blockedBy("evidence_client_mismatch"))
    await expect(record(id("ev:evidence_demo_brief"), "wrong-kind")).rejects.toSatisfy(blockedBy("evidence_kind_mismatch"))
  })

  it("rejects client PO evidence that has not been reviewed", async () => {
    await expect(record(id("ev:evidence_demo_po_r2"), "unreviewed")).rejects.toSatisfy(blockedBy("evidence_not_reviewed"))
  })

  it("the database refuses a contract pointing at evidence that does not exist", async () => {
    const owner = await ctxFor("user_demo_owner")
    await expect(
      withTenant(owner.tenant.id, (tx) =>
        tx.insert(contract).values({
          tenantId: owner.tenant.id,
          clientId: id("client_demo_aurora"),
          jobId: AURORA,
          kind: "client_po",
          reference: "PO-FK-PROBE",
          revisionNumber: 1,
          amountMinor: 1n,
          currency: "USD",
          evidenceId: randomUUID(),
        })
      )
    ).rejects.toSatisfy((e: unknown) => /foreign key/.test(String((e as { cause?: Error }).cause?.message)))
  })

  it("the submitter cannot review their own evidence; another reviewer can, and the PO then applies", async () => {
    const operator = await ctxFor("user_demo_operator")
    const owner = await ctxFor("user_demo_owner")
    await expect(
      executeCommand(operator, reviewEvidence, {
        idempotencyKey: key("b06-self-review"),
        payload: { evidence: id("ev:evidence_demo_po_r2"), decision: "reviewed", reason: "Looks fine" },
        origin: "ui",
      })
    ).rejects.toSatisfy((e: unknown) => e instanceof DomainError && ["forbidden", "self_approval"].includes(e.code))
    const reviewed = await executeCommand(owner, reviewEvidence, {
      idempotencyKey: key("b06-review"),
      payload: { evidence: id("ev:evidence_demo_po_r2"), decision: "reviewed", reason: "Client PO r2 matches 53,000" },
      origin: "ui",
    })
    expect(reviewed.result.reviewState).toBe("reviewed")
    const listed = (await listEvidence(owner, { job: AURORA })).find((e) => e.id === id("ev:evidence_demo_po_r2"))
    expect(listed?.reviewCurrent).toBe(true)

    const res = await record(id("ev:evidence_demo_po_r2"), "reviewed")
    const decided = await approve("user_demo_finance", res, "reviewed")
    expect(decided.result).toMatchObject({ outcome: "approved", executed: true })
    const [c] = await ownerDb().select().from(contract).where(eq(contract.id, res.result.contractId))
    expect(c!.state).toBe("approved")
    expect(c!.evidenceId).toBe(id("ev:evidence_demo_po_r2"))
  })

  it("does not apply authority when the evidence file changed after the proposal", async () => {
    const res = await record(id("ev:evidence_demo_po_r1"), "tampered")
    const [file] = await ownerDb().select().from(fileObject).where(eq(fileObject.id, id("evidence_demo_po_r1")))
    await ownerDb().update(fileObject).set({ sha256: "f".repeat(64) }).where(eq(fileObject.id, file!.id))
    try {
      const decided = await approve("user_demo_owner", res, "tampered")
      expect(decided.result).toMatchObject({ executed: false, blockedCode: "approval_stale" })
      const [c] = await ownerDb().select().from(contract).where(eq(contract.id, res.result.contractId))
      expect(c!.state).toBe("submitted")
      const [a] = await ownerDb().select().from(approvalRequest).where(eq(approvalRequest.id, res.result.approvalId))
      expect(a!.state).toBe("stale")
    } finally {
      await ownerDb().update(fileObject).set({ sha256: file!.sha256 }).where(eq(fileObject.id, file!.id))
    }
  })

  it("a newer version of the reviewed document blocks new authority until it is reviewed", async () => {
    const [file] = await ownerDb().select().from(fileObject).where(eq(fileObject.id, id("evidence_demo_po_r1")))
    const v2 = randomUUID()
    await ownerDb()
      .insert(fileObject)
      .values({ ...file!, id: v2, version: 2, sha256: "e".repeat(64), storageKey: `${file!.tenantId}/${v2}`, fixtureKey: null, createdAt: new Date() })
    try {
      await expect(record(id("ev:evidence_demo_po_r1"), "superseded")).rejects.toSatisfy(blockedBy("evidence_superseded"))
    } finally {
      await ownerDb().delete(fileObject).where(eq(fileObject.id, v2))
    }
  })

  it("seeded evidence is linked to its job and client and pins the reviewed hash", async () => {
    const [ev] = await ownerDb().select().from(evidence).where(eq(evidence.id, id("ev:evidence_demo_po_r1")))
    const [file] = await ownerDb().select().from(fileObject).where(eq(fileObject.id, id("evidence_demo_po_r1")))
    expect(ev).toMatchObject({ jobId: AURORA, clientId: id("client_demo_aurora"), reviewState: "reviewed", reviewedFileSha256: file!.sha256, reviewedFileVersion: 1 })
  })
})
