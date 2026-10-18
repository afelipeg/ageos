// @vitest-environment node
// Core-3 invariants beyond the fixtures: uncertain receipt extraction goes to
// manual review; two concurrent fund reservations never spend the same cash;
// a change after an approval request makes the approval stale; a revoked
// demo-bank connection blocks the dependent payment.
import { and, eq } from "drizzle-orm"

// Registry first: it loads every module's handlers before this file uses them.
import "@/server/capabilities/registry"

import { labRecognizedExpense, labRefs } from "@/server/capabilities/handlers/suppliers-payments"
import * as s from "@/server/db/schema"
import { decideApprovalCommand } from "@/server/domain/approvals"
import { postDemoJournal } from "@/server/domain/ledger"
import { approveSupplierInvoice, reconcileDeliveryInvoice, submitExpense } from "@/server/domain/payables"
import { queuePaymentSimulationOutcome } from "@/server/adapters/payments"
import { executeBatchPayment, proposePaymentBatch } from "@/server/domain/payments"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, key, ownerDb, resetDemo } from "./helpers"

beforeEach(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("expenses", () => {
  it("an unreadable receipt is held for manual review and requests no approval", async () => {
    const producer = await ctxFor("user_demo_producer")
    const refs = await labRefs(producer)
    const res = await executeCommand(producer, submitExpense, {
      idempotencyKey: key("blurry"),
      payload: { job: refs.labJob, claimant: refs.producer, receipt: refs.blurryReceipt, expenseDate: "2027-03-12", amount: "25.00", category: "travel" },
      origin: "ui",
    })
    expect(res.result.state).toBe("manual_review")
    expect(res.result.sheet_review.reasons).toEqual(expect.arrayContaining(["low_extraction_confidence", "amount_not_readable"]))
    expect(res.result.approval_requests).toEqual([])
  })
})

describe("treasury", () => {
  it("two concurrent batch approvals cannot reserve the same cash: one reserves, one is blocked", async () => {
    const refs = await labRefs(await ctxFor("user_demo_finance"))
    // Test setup: USD 30.00 confirmed in the empty lab account.
    const [acct] = await ownerDb().select().from(s.bankAccount).where(eq(s.bankAccount.connectionId, refs.labEmptyBank))
    await ownerDb().insert(s.bankTransaction).values({ tenantId: acct!.tenantId, bankAccountId: acct!.id, direction: "in", amountMinor: 3000n, currency: "USD", businessDate: "2027-03-01", kind: "opening", provider: "demo_bank", providerReceiptId: "sim_test_funding_30" })
    const ownerP = await ctxFor("user_demo_owner")
    const batchFor = async (label: string) => {
      await labRecognizedExpense(ctxFor)
      const r = await executeCommand(ownerP, proposePaymentBatch, {
        idempotencyKey: key(label),
        payload: { connection: refs.labEmptyBank, paymentDate: "2027-03-20", dueThrough: "2027-03-31", paymentMethod: "bank_transfer", batchAmount: "25.00" },
        origin: "ui",
      })
      return r.result
    }
    const a = await batchFor("batch-a")
    const b = await batchFor("batch-b")
    const financeA = await ctxFor("user_demo_finance")
    const decide = (x: { approvalId: string; payloadDigest: string }, label: string) =>
      executeCommand(financeA, decideApprovalCommand, { idempotencyKey: key(label), payload: { approvalId: x.approvalId, decision: "approve", reviewedDigest: x.payloadDigest }, origin: "ui" })
    const [ra, rb] = await Promise.all([decide(a, "decide-a"), decide(b, "decide-b")])
    const outcomes = [ra.result, rb.result].map((r) => (r.executed ? "reserved" : r.blockedCode)).sort()
    expect(outcomes).toEqual(["insufficient_funds", "reserved"])
    const holds = await ownerDb().select().from(s.paymentHold).where(and(eq(s.paymentHold.bankAccountId, acct!.id), eq(s.paymentHold.state, "active")))
    expect(holds.reduce((t, h) => t + h.amountMinor, 0n)).toBe(2500n)
  })

  it("a revoked demo-bank connection blocks the dependent payment only", async () => {
    await labRecognizedExpense(ctxFor)
    const finance = await ctxFor("user_demo_finance")
    const owner = await ctxFor("user_demo_owner")
    const refs = await labRefs(finance)
    const batch = await executeCommand(owner, proposePaymentBatch, {
      idempotencyKey: key("revoke"),
      payload: { connection: refs.labBank, paymentDate: "2027-03-20", dueThrough: "2027-03-31", paymentMethod: "bank_transfer", batchAmount: "25.00" },
      origin: "ui",
    })
    await executeCommand(finance, decideApprovalCommand, { idempotencyKey: key("revoke-ok"), payload: { approvalId: batch.result.approvalId, decision: "approve", reviewedDigest: batch.result.payloadDigest }, origin: "ui" })
    const paymentId = (batch.result.payment_list_proposal.items as { paymentId: string }[])[0]!.paymentId
    await executeCommand(owner, queuePaymentSimulationOutcome, { idempotencyKey: key("revoke-queue"), payload: { failureMode: "permission_revoked" }, origin: "ui" })
    const res = await executeCommand(finance, executeBatchPayment, { idempotencyKey: key("revoke-pay"), payload: { paymentId }, origin: "ui" })
    expect(res.result).toMatchObject({ state: "failed", connectionRevoked: true })
    await expect(executeCommand(finance, executeBatchPayment, { idempotencyKey: key("revoke-pay-2"), payload: { paymentId }, origin: "ui" })).rejects.toSatisfy(
      (e: unknown) => e instanceof DomainError && e.code === "blocked_by_rule"
    )
    const [conn] = await ownerDb().select().from(s.connection).where(eq(s.connection.id, refs.labBank))
    expect(conn!.state).toBe("revoked")
    const effects = await ownerDb().select().from(s.demoProviderEffect).where(eq(s.demoProviderEffect.tenantId, finance.tenant.id))
    expect(effects).toHaveLength(0)
  })
})

describe("approvals", () => {
  it("re-matching the invoice after the registration request makes that approval stale", async () => {
    const owner = await ctxFor("user_demo_owner")
    const refs = await labRefs(owner)
    const recon = { job: refs.labJob, supplier: refs.labVendor, invoiceNumber: "LAB-STALE-1", invoiceAmount: "1000.00", tolerance: "0.00" }
    await executeCommand(owner, reconcileDeliveryInvoice, { idempotencyKey: key("st-recon"), payload: recon, origin: "ui" })
    const reg = await executeCommand(owner, approveSupplierInvoice, {
      idempotencyKey: key("st-reg"),
      payload: { supplier: refs.labVendor, job: refs.labJob, invoiceNumber: "LAB-STALE-1", invoiceDate: "2027-03-12", invoiceAmount: "1000.00", period: "2027-03" },
      origin: "ui",
    })
    const appr = reg.result.registration_proposal!.approval as { approvalId: string; payloadDigest: string }
    // The approval is now live: a correction is refused instead of silently changing the payload.
    await expect(executeCommand(owner, reconcileDeliveryInvoice, { idempotencyKey: key("st-recon2"), payload: { ...recon, invoiceAmount: "990.00" }, origin: "ui" })).rejects.toSatisfy(
      (e: unknown) => e instanceof DomainError && e.details.rule === "invoice_locked"
    )
    // A material change to the invoice row (test setup: revision bump) stales the pending approval.
    await ownerDb().update(s.supplierInvoice).set({ revision: 99 }).where(eq(s.supplierInvoice.invoiceNumber, "LAB-STALE-1"))
    const decided = await executeCommand(await ctxFor("user_demo_finance"), decideApprovalCommand, { idempotencyKey: key("st-decide"), payload: { approvalId: appr.approvalId, decision: "approve", reviewedDigest: appr.payloadDigest }, origin: "ui" })
    expect(decided.result.outcome).toBe("stale")
    const [inv] = await ownerDb().select().from(s.supplierInvoice).where(eq(s.supplierInvoice.invoiceNumber, "LAB-STALE-1"))
    expect(inv!.state).toBe("matched")
  })
})

describe("separation of duties (owner prepares, finance approves and executes)", () => {
  it("the owner cannot approve a journal it prepared nor any finance journal; finance cannot prepare-and-approve", async () => {
    const owner = await ctxFor("user_demo_owner")
    const finance = await ctxFor("user_demo_finance")
    const refs = await labRefs(owner)
    const journal = { job: refs.labJob, period: "2027-03", businessDate: "2027-03-20", debitAccount: "production_expense", debitAmount: "5.00", creditAccount: "accrued_production", creditAmount: "5.00", memo: "SoD check" }
    const prepared = await executeCommand(owner, postDemoJournal, { idempotencyKey: key("sod-j"), payload: journal, origin: "ui" })
    const decide = (ctx: typeof owner, a: { approvalId: string; payloadDigest: string }, label: string) =>
      executeCommand(ctx, decideApprovalCommand, { idempotencyKey: key(label), payload: { approvalId: a.approvalId, decision: "approve", reviewedDigest: a.payloadDigest }, origin: "ui" })
    await expect(decide(owner, prepared.result, "sod-owner")).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === "approver_not_eligible")
    // Finance may prepare (ledger.prepare) but never approves its own preparation.
    const own = await executeCommand(finance, postDemoJournal, { idempotencyKey: key("sod-fj"), payload: { ...journal, memo: "Finance own" }, origin: "ui" })
    await expect(decide(finance, own.result, "sod-self")).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === "self_approval")
    expect((await decide(finance, prepared.result, "sod-fin")).result).toMatchObject({ outcome: "approved", executed: true })
  })

  it("the owner can neither post to the ledger nor execute payments directly", async () => {
    const owner = await ctxFor("user_demo_owner")
    expect(owner.permissions.has("ledger.post")).toBe(false)
    expect(owner.permissions.has("payments.execute")).toBe(false)
    expect(owner.permissions.has("ledger.prepare")).toBe(true)
    await expect(executeCommand(owner, executeBatchPayment, { idempotencyKey: key("sod-pay"), payload: { paymentId: crypto.randomUUID() }, origin: "ui" })).rejects.toSatisfy(
      (e: unknown) => e instanceof DomainError && e.code === "forbidden"
    )
  })
})
