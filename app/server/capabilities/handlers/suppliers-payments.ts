// Capability handlers for module "suppliers-payments". Owner: Core-3.
// Skills: agency-delivery-reconciliation, agency-payables, agency-payment-run, agency-cash-settlement, agency-expenses
// A skill missing from `handlers` is "registered" only (no fake success).
import "server-only"

import { and, eq } from "drizzle-orm"

import { minorToDecimalString } from "@/lib/money"
import { queuePaymentSimulationOutcome } from "@/server/adapters/payments"
import type { AgencyContext } from "@/server/auth/context"
import { appUser, bankTransaction, connection, demoProviderEffect, evidence, expense, fileObject, job, payment, supplier } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { proposeAccrualOrFx } from "@/server/domain/accruals"
import { decideApprovalCommand } from "@/server/domain/approvals"
import { bankAccountByConnection, cashPosition } from "@/server/domain/cash"
import { applyExpenseApproval, applySupplierInvoiceRegistration, approveSupplierInvoice, reconcileDeliveryInvoice, submitExpense } from "@/server/domain/payables"
import {
  applyPaymentBatchApproval,
  executeBatchPayment,
  exportDemoBankStatement,
  previewPaymentRun,
  proposePaymentBatch,
  reconcileBankStatement,
} from "@/server/domain/payments"
import { executeCommand, type CommandDefinition } from "@/server/kernel/commands"
import { isDomainError } from "@/server/kernel/errors"
import type { ModuleCapabilities } from "../types"

// ── Shared fixture helpers (Core-3 modules) ──
// Fixtures run on job_demo_lab (reporting group demo-lab) with the lab bank
// account, so Aurora figures never move. Every precondition goes through a
// domain command with a unique idempotency key: re-runnable on one database.

export type FixtureCtx = (actorKey: string) => Promise<AgencyContext>
export type Out = Record<string, unknown>

let seq = 0
export const runTag = (label: string) => `c3-${label}-${Date.now().toString(36)}-${(seq++).toString(36)}`

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`fixture verify failed: ${message}`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cmd<R>(ctx: AgencyContext, def: CommandDefinition<any, R>, payload: Record<string, unknown>, label: string, expectedRevision?: number) {
  return (await executeCommand(ctx, def, { idempotencyKey: runTag(label), payload, origin: "system", expectedRevision })).result
}

/** Runs a precondition that may legitimately be blocked on a re-run. */
export async function tolerate<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch (e) {
    if (isDomainError(e)) return null
    throw e
  }
}

export async function approveAs(c: FixtureCtx, approval: { approvalId: string; payloadDigest: string }, actorKey = "user_demo_finance") {
  const res = await cmd(await c(actorKey), decideApprovalCommand, { approvalId: approval.approvalId, decision: "approve", reviewedDigest: approval.payloadDigest }, "approve")
  check(res.outcome === "approved" && res.executed, `approval executed (got ${res.outcome}/${res.blockedCode ?? "-"})`)
  return res
}

export async function labRefs(ctx: AgencyContext) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const t = ctx.tenant.id
    const jobId = async (key: string) => (await tx.select({ id: job.id }).from(job).where(and(eq(job.tenantId, t), eq(job.fixtureKey, key))).limit(1))[0]!.id
    const supplierId = async (key: string) => (await tx.select({ id: supplier.id }).from(supplier).where(and(eq(supplier.tenantId, t), eq(supplier.fixtureKey, key))).limit(1))[0]!.id
    const conn = async (alias: string) => (await tx.select({ id: connection.id }).from(connection).where(and(eq(connection.tenantId, t), eq(connection.provider, "demo_bank"), eq(connection.accountAlias, alias))).limit(1))[0]!.id
    const file = async (key: string) => (await tx.select({ id: fileObject.id }).from(fileObject).where(and(eq(fileObject.tenantId, t), eq(fileObject.fixtureKey, key))).limit(1))[0]!.id
    const ev = async (key: string) => (await tx.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.tenantId, t), eq(evidence.fixtureKey, key))).limit(1))[0]!.id
    const [producer] = await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.fixtureKey, "user_demo_producer")).limit(1)
    return {
      labJob: await jobId("job_demo_lab"),
      auroraJob: await jobId("job_demo_aurora"),
      labVendor: await supplierId("supplier_demo_lab_vendor"),
      lumen: await supplierId("supplier_demo_lumen"),
      labBank: await conn("rayo_lab_demo"),
      labEmptyBank: await conn("rayo_lab_empty_demo"),
      operatingBank: await conn("rayo_operating_demo"),
      labReceipt: await file("file_demo_lab_expense_receipt"),
      blurryReceipt: await file("file_demo_lab_blurry_receipt"),
      labPoEvidence: await ev("evidence_demo_lab_po"),
      labAcceptanceEvidence: await ev("evidence_demo_lab_acceptance"),
      producer: producer!.id,
    }
  })
}

/** Lab recognition run (owner prepares, finance approves); a no-op when nothing is due. */
export async function ensureLabRecognition(c: FixtureCtx) {
  const owner = await c("user_demo_owner")
  const refs = await labRefs(owner)
  const res = await tolerate(cmd(owner, proposeAccrualOrFx, { adjustmentType: "accrual", job: refs.labJob, period: "2027-03" }, "lab-recognition"))
  if (res) await approveAs(c, res as { approvalId: string; payloadDigest: string })
}

/** Presenter control (audited): the next simulated demo-bank payment gets this outcome. */
export async function queuePaymentOutcome(c: FixtureCtx, failureMode: "timeout_after_effect" | "permission_revoked" | "timeout_before_effect" | "rate_limited" | "permanent_failure" | "validation_error") {
  await cmd(await c("user_demo_owner"), queuePaymentSimulationOutcome, { failureMode }, "queue-outcome")
}

/** An approved lab expense of USD 25.00 (seeded receipt), recognized into the Demo ledger. */
export async function labRecognizedExpense(c: FixtureCtx) {
  const producer = await c("user_demo_producer")
  const refs = await labRefs(producer)
  const submitted = await cmd(producer, submitExpense, { job: refs.labJob, claimant: refs.producer, receipt: refs.labReceipt, expenseDate: "2027-03-12", amount: "25.00", category: "travel", description: "Lab taxi (fixture)" }, "lab-expense")
  const appr = submitted.approval_requests[0] as { approvalId: string; payloadDigest: string }
  await approveAs(c, appr)
  await ensureLabRecognition(c)
  return submitted.expenseId
}

/** The owner proposes, finance approves (funds reserved) every recognized lab liability due. */
export async function labReservedBatch(c: FixtureCtx) {
  const owner = await c("user_demo_owner")
  const refs = await labRefs(owner)
  const preview = await previewPaymentRun(owner, { connection: refs.labBank, dueThrough: "2027-03-31" })
  const batch = await cmd(owner, proposePaymentBatch, { connection: refs.labBank, paymentDate: "2027-03-20", dueThrough: "2027-03-31", paymentMethod: "bank_transfer", batchAmount: minorToDecimalString(preview.totalMinor, preview.currency) }, "lab-batch")
  await approveAs(c, batch as { approvalId: string; payloadDigest: string })
  return batch
}

const LAB_INVOICE = "LAB-SUP-RECON"

export const capabilities: ModuleCapabilities = {
  handlers: {
    "agency-delivery-reconciliation": { kind: "command", command: reconcileDeliveryInvoice },
    "agency-payables": { kind: "command", command: approveSupplierInvoice },
    "agency-payment-run": { kind: "command", command: proposePaymentBatch },
    "agency-cash-settlement": { kind: "command", command: reconcileBankStatement },
    "agency-expenses": { kind: "command", command: submitExpense },
  },
  fixtures: {
    // ERP-26: the lab invoice first arrives above the accepted delivery (held),
    // then the corrected amount matches the same cost item (no new cost).
    // Negative: no order from that supplier → nothing to match.
    "agency-delivery-reconciliation": {
      positive: async (c) => {
        const owner = await c("user_demo_owner")
        const refs = await labRefs(owner)
        await tolerate(cmd(owner, reconcileDeliveryInvoice, { job: refs.labJob, supplier: refs.labVendor, invoiceNumber: LAB_INVOICE, invoiceAmount: "1200.00", tolerance: "0.00" }, "recon-bad"))
        return {
          actorKey: "user_demo_owner",
          input: { job: refs.labJob, supplier: refs.labVendor, invoiceNumber: LAB_INVOICE, invoiceAmount: "1000.00", tolerance: "0.00" },
          verify: async (output) => {
            const o = output as Out
            const m = o.match_result as { status: string; paymentHold: boolean }
            check(m.status === "matched" && !m.paymentHold, "corrected invoice matches")
            check((o.payable_candidate as { amountMinor: string }).amountMinor === "100000", "payable candidate 1,000.00")
            check(Array.isArray(o.evidence_links) && (o.evidence_links as unknown[]).length >= 2, "order and delivery evidence linked")
          },
        }
      },
      negative: async (c) => {
        const refs = await labRefs(await c("user_demo_owner"))
        return {
          actorKey: "user_demo_owner",
          input: { job: refs.labJob, supplier: refs.lumen, invoiceNumber: "LAB-NO-ORDER-1", invoiceAmount: "6000.00", tolerance: "0.00" },
          expectCode: "blocked_by_rule",
          expectRule: "no_order_for_supplier",
        }
      },
    },
    // ERP-27: the reconciled lab invoice is registered for finance approval
    // (preparer ≠ approver). Negative: same supplier|number|currency with
    // different content is held, never a second payable.
    "agency-payables": {
      positive: async (c) => {
        const owner = await c("user_demo_owner")
        const refs = await labRefs(owner)
        await tolerate(cmd(owner, reconcileDeliveryInvoice, { job: refs.labJob, supplier: refs.labVendor, invoiceNumber: LAB_INVOICE, invoiceAmount: "1000.00", tolerance: "0.00" }, "recon-ok"))
        return {
          actorKey: "user_demo_owner",
          input: { supplier: refs.labVendor, job: refs.labJob, invoiceNumber: LAB_INVOICE, invoiceDate: "2027-03-12", dueDate: "2027-04-11", invoiceAmount: "1000.00", period: "2027-03" },
          verify: async (output) => {
            const o = output as Out
            check(["registered_existing", "same_document"].includes((o.duplicate_check as { status: string }).status), "one document, never duplicated")
            check(o.registration_proposal !== null, "registration proposal for finance")
            check((o.holds as unknown[]).length === 0, "no hold on a matched invoice")
          },
        }
      },
      negative: async (c) => {
        const owner = await c("user_demo_owner")
        const refs = await labRefs(owner)
        await tolerate(cmd(owner, reconcileDeliveryInvoice, { job: refs.labJob, supplier: refs.labVendor, invoiceNumber: LAB_INVOICE, invoiceAmount: "1000.00", tolerance: "0.00" }, "recon-ok"))
        return {
          actorKey: "user_demo_owner",
          input: { supplier: refs.labVendor, job: refs.labJob, invoiceNumber: LAB_INVOICE, invoiceDate: "2027-03-12", dueDate: "2027-04-11", invoiceAmount: "1100.00", period: "2027-03" },
          expectCode: "blocked_by_rule",
          expectRule: "duplicate_supplier_invoice",
        }
      },
    },
    // ERP-28: the owner batches a recognized lab liability with its exact
    // amount, finance approves independently (funds reserved atomically) and
    // executes each simulated payment once. Negative: a batch from the empty
    // lab account is blocked for insufficient funds with no provider effect.
    "agency-payment-run": {
      positive: async (c) => {
        await labRecognizedExpense(c)
        const owner0 = await c("user_demo_owner")
        const refs = await labRefs(owner0)
        const preview = await previewPaymentRun(owner0, { connection: refs.labBank, dueThrough: "2027-03-31" })
        return {
          actorKey: "user_demo_owner",
          input: { connection: refs.labBank, paymentDate: "2027-03-20", dueThrough: "2027-03-31", paymentMethod: "bank_transfer", batchAmount: minorToDecimalString(preview.totalMinor, preview.currency) },
          verify: async (output) => {
            const o = output as Out
            const finance = await c("user_demo_finance")
            const before = await withTenant(finance.tenant.id, async (tx) => {
              const { account } = await bankAccountByConnection(tx, finance.tenant.id, refs.labBank)
              return { id: account.id, pos: await cashPosition(tx, finance.tenant.id, account.id) }
            })
            await approveAs(c, o as unknown as { approvalId: string; payloadDigest: string })
            const reserved = await withTenant(finance.tenant.id, (tx) => cashPosition(tx, finance.tenant.id, before.id))
            const total = BigInt((o.payment_list_proposal as { totalMinor: string }).totalMinor)
            check(reserved.availableMinor === before.pos.availableMinor - total, "funds reserved atomically on approval")
            for (const p of (o.payment_list_proposal as { items: { paymentId: string }[] }).items) {
              const r = await cmd(finance, executeBatchPayment, { paymentId: p.paymentId }, "pay")
              check(r.state === "succeeded" && String(r.receiptId).startsWith("sim_"), "simulated payment with sim_ receipt")
              const again = await cmd(finance, executeBatchPayment, { paymentId: p.paymentId }, "pay-again")
              check(again.replayed === true, "re-executing does not pay twice")
            }
            const after = await withTenant(finance.tenant.id, (tx) => cashPosition(tx, finance.tenant.id, before.id))
            check(after.confirmedMinor === before.pos.confirmedMinor - total && after.activeHoldsMinor === before.pos.activeHoldsMinor, "cash moved once by the batch total")
          },
        }
      },
      negative: async (c) => {
        await labRecognizedExpense(c)
        const owner = await c("user_demo_owner")
        const refs = await labRefs(owner)
        const preview = await previewPaymentRun(owner, { connection: refs.labEmptyBank, dueThrough: "2027-03-31" })
        return {
          actorKey: "user_demo_owner",
          input: { connection: refs.labEmptyBank, paymentDate: "2027-03-20", dueThrough: "2027-03-31", paymentMethod: "bank_transfer", batchAmount: minorToDecimalString(preview.totalMinor, preview.currency) },
          expectCode: "insufficient_funds",
          expectRule: "insufficient_funds",
        }
      },
    },
    // ERP-29: a payment whose provider response timed out after the effect is
    // cleared by the demo bank's own statement line — one bank debit settles
    // one liability, no new expense. Negative: importing the same statement
    // lines again is rejected (a bank line applies once).
    "agency-cash-settlement": {
      positive: async (c) => {
        await labRecognizedExpense(c)
        const batch = await labReservedBatch(c)
        const finance = await c("user_demo_finance")
        const items = (batch.payment_list_proposal as { items: { paymentId: string }[] }).items
        const unknownId = items[0]!.paymentId
        await queuePaymentOutcome(c, "timeout_after_effect")
        const first = await cmd(finance, executeBatchPayment, { paymentId: unknownId }, "pay-unknown")
        check(first.state === "outcome_unknown", "timeout after effect leaves the outcome unknown")
        for (const p of items.slice(1)) await cmd(finance, executeBatchPayment, { paymentId: p.paymentId }, "pay")
        const owner = await c("user_demo_owner")
        const refs = await labRefs(owner)
        const statement = await cmd(owner, exportDemoBankStatement, { connection: refs.labBank, statementDate: "2027-03-31" }, "statement")
        return {
          actorKey: "user_demo_owner",
          input: { connection: refs.labBank, statementFile: statement.fileId, statementDate: "2027-03-31", closingBalance: minorToDecimalString(BigInt(statement.closingBalanceMinor), "USD") },
          verify: async (output, ctx) => {
            const o = output as Out
            const report = o.reconciliation_report as { lines: { outcome: string }[]; differenceMinor: string }
            check(report.lines.some((l) => l.outcome === "settled"), "statement line settled the unknown payment")
            check(report.differenceMinor === "0", "statement and book balances agree")
            const state = await withTenant(ctx.tenant.id, async (tx) => {
              const [p] = await tx.select().from(payment).where(eq(payment.id, unknownId)).limit(1)
              const effects = await tx.select().from(demoProviderEffect).where(eq(demoProviderEffect.receiptId, p!.receiptId ?? "none"))
              const moves = await tx.select().from(bankTransaction).where(eq(bankTransaction.providerReceiptId, p!.receiptId ?? "none"))
              return { p: p!, effects: effects.length, moves: moves.length }
            })
            check(state.p.state === "succeeded" && state.effects === 1 && state.moves === 1, "one effect, one bank debit")
          },
        }
      },
      negative: async (c) => {
        await labRecognizedExpense(c)
        const batch = await labReservedBatch(c)
        const finance = await c("user_demo_finance")
        for (const p of (batch.payment_list_proposal as { items: { paymentId: string }[] }).items) await cmd(finance, executeBatchPayment, { paymentId: p.paymentId }, "pay")
        const owner = await c("user_demo_owner")
        const refs = await labRefs(owner)
        const statement = await cmd(owner, exportDemoBankStatement, { connection: refs.labBank, statementDate: "2027-03-31" }, "statement")
        const input = { connection: refs.labBank, statementFile: statement.fileId, statementDate: "2027-03-31", closingBalance: minorToDecimalString(BigInt(statement.closingBalanceMinor), "USD") }
        await cmd(owner, reconcileBankStatement, input, "statement-import")
        return { actorKey: "user_demo_owner", input, expectCode: "blocked_by_rule", expectRule: "duplicate_bank_transaction" }
      },
    },
    // ERP-30: a lab expense with a matching receipt goes to finance (approver ≠
    // submitter). Negative: a receipt that is not an agency file blocks.
    "agency-expenses": {
      positive: async (c) => {
        const refs = await labRefs(await c("user_demo_producer"))
        return {
          actorKey: "user_demo_producer",
          input: { job: refs.labJob, claimant: refs.producer, receipt: refs.labReceipt, expenseDate: "2027-03-12", amount: "25.00", category: "travel", description: "Lab taxi" },
          verify: async (output) => {
            const o = output as Out
            check(o.state === "awaiting_approval" && (o.sheet_review as { status: string }).status === "verified", "receipt verified")
            const appr = (o.approval_requests as { approvalId: string; payloadDigest: string }[])[0]!
            await approveAs(c, appr)
            const finance = await c("user_demo_finance")
            const [row] = await withTenant(finance.tenant.id, (tx) => tx.select().from(expense).where(eq(expense.id, String(o.expenseId))).limit(1))
            check(row?.state === "approved" && row.approvedBy !== row.submittedBy, "approved by someone other than the submitter")
          },
        }
      },
      negative: async (c) => {
        const refs = await labRefs(await c("user_demo_producer"))
        return {
          actorKey: "user_demo_producer",
          input: { job: refs.labJob, claimant: refs.producer, receipt: crypto.randomUUID(), expenseDate: "2027-03-12", amount: "25.00", category: "travel" },
          expectCode: "blocked_by_rule",
          expectRule: "receipt_missing",
        }
      },
    },
  },
  executors: {
    "payables.register_invoice": {
      permission: "payables.manage",
      skillId: "agency-payables",
      run: (tx, ctx, payload, mode) => applySupplierInvoiceRegistration(tx, ctx, payload as Parameters<typeof applySupplierInvoiceRegistration>[2], mode),
    },
    "payments.batch": {
      permission: "payments.execute",
      skillId: "agency-payment-run",
      run: (tx, ctx, payload, mode) => applyPaymentBatchApproval(tx, ctx, payload as Parameters<typeof applyPaymentBatchApproval>[2], mode),
    },
    "expense.approve": {
      permission: "payables.manage",
      skillId: "agency-expenses",
      run: (tx, ctx, payload, mode) => applyExpenseApproval(tx, ctx, payload as Parameters<typeof applyExpenseApproval>[2], mode),
    },
  },
}
