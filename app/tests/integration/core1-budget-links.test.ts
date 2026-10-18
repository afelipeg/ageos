// @vitest-environment node
// Core-1: initial budget of a new job (from_intake path) through the
// fee-contracts command, and evidence links that follow a document linked to
// a job through the library action the screen calls.
import { eq, inArray, sql } from "drizzle-orm"
import { vi } from "vitest"

import { linkFileToJobAction } from "@/server/actions/ui/library"
import { SESSION_COOKIE, createSession } from "@/server/auth/session"
import * as s from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { decideApprovalCommand } from "@/server/domain/approvals"
import { proposeFeeAmendment, recordClientAuthority, reserveBudget } from "@/server/domain/budget"
import { createClientIntake } from "@/server/domain/clients"
import { getJobRevision, openOrCloseJob } from "@/server/domain/jobs"
import { loadJobFinancials } from "@/server/domain/profitability"
import { executeCommand } from "@/server/kernel/commands"
import { seedDemo } from "@/server/seed/demo-seed"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo } from "./helpers"

const jar = new Map<string, string>()
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath }))

const SLUG = "rayo-de-sol"
const RAYO = id("tenant_demo_rayo")
const code = (c: string, rule?: string) => (e: unknown) => e instanceof DomainError && e.code === c && (!rule || e.details.rule === rule)

async function signInAs(userKey: string) {
  jar.clear()
  const { token } = await createSession({ userId: id(userKey), presenterUserId: null })
  jar.set(SESSION_COOKIE, token)
}

async function openJob(clientKey: string, name: string) {
  const res = await executeCommand(await ctxFor("user_demo_operator"), openOrCloseJob, {
    idempotencyKey: key(`open-${name.replace(/[^A-Za-z0-9]/g, "-")}`),
    payload: { action: "open", client: id(clientKey), jobName: name, jobType: "A", billingCode: "F", period: "2027-03" },
    origin: "ui",
  })
  return res.result.jobId
}

async function approvedPo(jobId: string, evidenceKey: string, amount: string, label: string) {
  const po = await executeCommand(await ctxFor("user_demo_operator"), recordClientAuthority, {
    idempotencyKey: key(`po-${label}`),
    payload: { job: jobId, reference: `PO-${label.toUpperCase()}`, amount, validFrom: "2027-03-01", validTo: "2027-12-31", evidenceId: id(evidenceKey) },
    origin: "ui",
  })
  const d = await executeCommand(await ctxFor("user_demo_owner"), decideApprovalCommand, {
    idempotencyKey: key(`po-${label}-ok`),
    payload: { approvalId: po.result.approvalId, decision: "approve", reviewedDigest: po.result.payloadDigest },
    origin: "ui",
  })
  expect(d.result).toMatchObject({ outcome: "approved", executed: true })
}

async function footprint() {
  const n = async (t: typeof s.budgetRevision | typeof s.businessEvent | typeof s.idempotencyRecord | typeof s.approvalRequest) =>
    (await ownerDb().select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.tenantId, RAYO)))[0]!.n
  return [await n(s.budgetRevision), await n(s.businessEvent), await n(s.idempotencyRecord), await n(s.approvalRequest)]
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("initial budget of a new job (agency-fee-contracts)", () => {
  it("fee 400 + media 600 from a USD 1,000 PO: finance approves (not the proposer, not the owner); replay is idempotent", async () => {
    const jobId = await openJob("client_demo_lab", "Lab initial budget")
    await approvedPo(jobId, "ev:evidence_demo_c1_lab_po", "1000.00", "lab-initial")
    const operator = await ctxFor("user_demo_operator")
    const env = { idempotencyKey: key("initial"), payload: { job: jobId, newAgencyFee: "400.00", reason: "Initial approved scope" }, origin: "ui" as const, expectedRevision: await getJobRevision(operator, jobId) }
    const p = await executeCommand(operator, proposeFeeAmendment, env)
    const again = await executeCommand(operator, proposeFeeAmendment, env)
    expect(p.result.fee_contract_draft).toMatchObject({ kind: "initial_budget", toAgencyFeeMinor: "40000", managedMediaMinor: "60000", budgetRevisionNumber: 1 })
    expect(again).toMatchObject({ replayed: true, result: p.result })
    const decide = async (userKey: string) =>
      executeCommand(await ctxFor(userKey), decideApprovalCommand, {
        idempotencyKey: key(`initial-${userKey}`),
        payload: { approvalId: p.result.approvalId, decision: "approve", reviewedDigest: p.result.payloadDigest },
        origin: "ui",
      })
    await expect(decide("user_demo_operator")).rejects.toSatisfy(code("forbidden"))
    await expect(decide("user_demo_owner")).rejects.toSatisfy(code("approver_not_eligible"))
    expect((await decide("user_demo_finance")).result).toMatchObject({ outcome: "approved", executed: true })
    const fin = await withTenant(RAYO, (tx) => loadJobFinancials(tx, RAYO, jobId))
    expect(fin.approvedBudget).toMatchObject({ number: 1, agencyFeeMinor: 40000n, managedMediaMinor: 60000n })
  })

  it("without an approved PO, or with a fee above it, nothing is created", async () => {
    const operator = await ctxFor("user_demo_operator")
    const bare = await openJob("client_demo_lab", "Lab without PO")
    const withPo = await openJob("client_demo_lab", "Lab small PO")
    await approvedPo(withPo, "ev:evidence_demo_c1_lab_po", "1000.00", "lab-small")
    const before = await footprint()
    await expect(
      executeCommand(operator, proposeFeeAmendment, { idempotencyKey: key("initial-bare"), payload: { job: bare, newAgencyFee: "400.00", reason: "No PO" }, origin: "ui", expectedRevision: await getJobRevision(operator, bare) })
    ).rejects.toSatisfy(code("blocked_by_rule", "client_authority_required"))
    await expect(
      executeCommand(operator, proposeFeeAmendment, { idempotencyKey: key("initial-over"), payload: { job: withPo, newAgencyFee: "1500.00", reason: "Too high" }, origin: "ui", expectedRevision: await getJobRevision(operator, withPo) })
    ).rejects.toSatisfy(code("blocked_by_rule", "fee_exceeds_authority"))
    expect(await footprint()).toEqual(before)
  })
})

describe("evidence follows a document linked to a job (library action)", () => {
  const ev = async (key_: string) => (await ownerDb().select().from(s.evidence).where(eq(s.evidence.id, id(key_))))[0]!

  it("unreviewed evidence moves with the document; reviewed evidence keeps its links", async () => {
    await signInAs("user_demo_operator")
    const lab = id("job_demo_lab")
    const r2 = await linkFileToJobAction({ agencySlug: SLUG, fileId: id("evidence_demo_po_r2"), jobId: lab })
    expect(r2).toMatchObject({ ok: true, data: { changed: true } })
    expect(await ev("ev:evidence_demo_po_r2")).toMatchObject({ jobId: lab, clientId: id("client_demo_lab"), reviewState: "received" })
    const r1 = await linkFileToJobAction({ agencySlug: SLUG, fileId: id("evidence_demo_po_r1"), jobId: lab })
    expect(r1.ok).toBe(true)
    expect(await ev("ev:evidence_demo_po_r1")).toMatchObject({ jobId: id("job_demo_aurora"), clientId: id("client_demo_aurora"), reviewState: "reviewed" })
  })

  it("from_intake: a reviewed PO without links gets its first job link once, then supports the client PO; it never moves again", async () => {
    // from_intake state: the reviewed PO r1 sits in the library, unlinked.
    await ownerDb().update(s.evidence).set({ jobId: null, clientId: null }).where(eq(s.evidence.id, id("ev:evidence_demo_po_r1")))
    await ownerDb().update(s.fileObject).set({ jobId: null }).where(inArray(s.fileObject.id, [id("evidence_demo_po_r1")]))
    const jobId = await openJob("client_demo_aurora", "Aurora intake job")
    await signInAs("user_demo_operator")
    expect((await linkFileToJobAction({ agencySlug: SLUG, fileId: id("evidence_demo_po_r1"), jobId })).ok).toBe(true)
    expect(await ev("ev:evidence_demo_po_r1")).toMatchObject({ jobId, clientId: id("client_demo_aurora"), reviewState: "reviewed" })
    const po = await executeCommand(await ctxFor("user_demo_operator"), recordClientAuthority, {
      idempotencyKey: key("intake-po"),
      payload: { job: jobId, reference: "PO-AUR-INTAKE-01", amount: "50000.00", validFrom: "2027-03-01", validTo: "2027-06-30", evidenceId: id("ev:evidence_demo_po_r1") },
      origin: "ui",
    })
    expect(po.result.commercial_terms.amountMinor).toBe("5000000")
    expect((await linkFileToJobAction({ agencySlug: SLUG, fileId: id("evidence_demo_po_r1"), jobId: id("job_demo_lab") })).ok).toBe(true)
    expect(await ev("ev:evidence_demo_po_r1")).toMatchObject({ jobId, clientId: id("client_demo_aurora") })
  })
})

describe("from_intake J02 path with the two missing steps (link PO document, initial budget)", () => {
  it("intake → open job → link PO r1 → PO 50,000 → initial budget 20,000 + 30,000 → managed media reservation 30,000", async () => {
    await seedDemo(ownerDb(), { storageDir: process.env.AGEOS_STORAGE_DIR!, reset: true, mode: "from_intake" })
    const operator = await ctxFor("user_demo_operator")
    const intake = await executeCommand(operator, createClientIntake, {
      idempotencyKey: key("j02-intake"),
      payload: { clientName: "Aurora Beverages", clientCode: "AUR", productCode: "SL", billingCurrency: "USD", country: "US", creditLimit: "60000.00", briefTitle: "Aurora Spring Launch brief", briefSummary: "Launch the fictional Aurora sparkling line in spring 2027 across digital, CTV, radio and OOH." },
      origin: "ui",
    })
    const opened = await executeCommand(operator, openOrCloseJob, {
      idempotencyKey: key("j02-open"),
      payload: { action: "open", client: intake.result.clientId, jobName: "Aurora Spring Launch", jobType: "A", billingCode: "F", period: "2027-03" },
      origin: "ui",
    })
    const jobId = opened.result.jobId
    expect(opened.result.jobNumber).toBe("AURSL7AF0001")
    await signInAs("user_demo_operator")
    expect((await linkFileToJobAction({ agencySlug: SLUG, fileId: id("evidence_demo_po_r1"), jobId })).ok).toBe(true)
    await approvedPo(jobId, "ev:evidence_demo_po_r1", "50000.00", "aur-2027-01")
    const budget = await executeCommand(operator, proposeFeeAmendment, {
      idempotencyKey: key("j02-budget"),
      payload: { job: jobId, newAgencyFee: "20000.00", reason: "Initial approved scope" },
      origin: "ui",
      expectedRevision: await getJobRevision(operator, jobId),
    })
    expect(budget.result.fee_contract_draft).toMatchObject({ kind: "initial_budget", toAgencyFeeMinor: "2000000", managedMediaMinor: "3000000" })
    const approved = await executeCommand(await ctxFor("user_demo_finance"), decideApprovalCommand, {
      idempotencyKey: key("j02-budget-ok"),
      payload: { approvalId: budget.result.approvalId, decision: "approve", reviewedDigest: budget.result.payloadDigest },
      origin: "ui",
    })
    expect(approved.result).toMatchObject({ outcome: "approved", executed: true })
    const reserve = await executeCommand(operator, reserveBudget, {
      idempotencyKey: key("j02-reserve"),
      payload: { job: jobId, budgetScope: "managed_media_authority", amount: "30000.00", purpose: "Reserve managed media for the spring launch" },
      origin: "ui",
    })
    expect(reserve.result.availableAfterMinor).toBe("0")
  })
})
