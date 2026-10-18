import "server-only"

import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import { creditExposure } from "@/server/calculators"
import { aging, withholding } from "@/server/calculators/finance"
import type { Tx } from "@/server/db/client"
import { client, clientInvoice, collection, collectionAllocation } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { defineCommand, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { bankAccountForJob, cashPosition, recordBankTransaction } from "./cash"
import { assertPeriodOpen, blocked, Decimal, IsoDate, loadJob, moneyInput, periodOf, postJournals } from "./ledger"

// Collections (M07). A cash receipt is unique per bank account + provider
// receipt id; its allocation to an invoice is a separate linked record that
// never exceeds the receipt nor the invoice outstanding. Repeating a receipt
// returns the earlier result without a second cash credit or AR reduction.

const OPEN_STATES = ["issued_demo", "partially_collected"] as const

export async function receivablesAging(tx: Tx, tenantId: string, asOf: string, filter: { jobId?: string; clientId?: string } = {}) {
  const conds = [eq(clientInvoice.tenantId, tenantId), inArray(clientInvoice.state, [...OPEN_STATES])]
  if (filter.jobId) conds.push(eq(clientInvoice.jobId, filter.jobId))
  if (filter.clientId) conds.push(eq(clientInvoice.clientId, filter.clientId))
  const open = await tx.select().from(clientInvoice).where(and(...conds)).orderBy(asc(clientInvoice.dueDate))
  const report = aging({
    asOf,
    bucketLimitsDays: [30, 60, 90],
    items: open.map((i) => ({ docId: i.number ?? i.id, currency: i.currency, dueDate: i.dueDate, openMinor: i.grossMinor - i.collectedMinor })),
  })
  return { open, report }
}

// ── agency-collections: allocateCollection ──

export const AllocateCollectionInput = z
  .object({
    job: z.string().uuid(),
    invoiceNumber: z.string().trim().min(2).max(60),
    receiptAmount: Decimal,
    receiptDate: IsoDate,
    receiptReference: z.string().trim().regex(/^[A-Za-z0-9_.:-]{4,80}$/),
  })
  .strict()

export const allocateCollection = defineCommand({
  type: "collections.receiveAndAllocate",
  skillId: "agency-collections",
  permission: "billing.manage",
  input: AllocateCollectionInput,
  handler: async (tx, ctx, input) => {
    const j = await loadJob(tx, ctx.tenant.id, input.job)
    const [inv] = await tx
      .select()
      .from(clientInvoice)
      .where(and(eq(clientInvoice.tenantId, ctx.tenant.id), eq(clientInvoice.number, input.invoiceNumber.trim().toUpperCase()), eq(clientInvoice.jobId, j.id)))
      .for("update")
      .limit(1)
    if (!inv) throw new DomainError("not_found", "Invoice not found on this job", { field: "invoiceNumber" })
    const currency = inv.currency
    const amountMinor = moneyInput(input.receiptAmount, currency, "receiptAmount")
    const { account } = await bankAccountForJob(tx, ctx.tenant.id, j)

    // Unique provider receipt: a repeat returns the prior result, never a second credit.
    const [prior] = await tx
      .select()
      .from(collection)
      .where(and(eq(collection.tenantId, ctx.tenant.id), eq(collection.bankAccountId, account.id), eq(collection.providerReceiptId, input.receiptReference)))
      .limit(1)
    if (prior) {
      const allocs = await tx.select().from(collectionAllocation).where(and(eq(collectionAllocation.tenantId, ctx.tenant.id), eq(collectionAllocation.collectionId, prior.id)))
      if (prior.amountMinor !== amountMinor || !allocs.some((a) => a.invoiceId === inv.id)) {
        blocked("receipt_reference_conflict", "This receipt reference was already applied with different data", { receiptReference: input.receiptReference })
      }
      return {
        result: await output(tx, ctx, inv.id, prior.id, input.receiptDate, true),
        events: [{ eventType: "collections.duplicate_receipt_ignored", aggregateType: "client_invoice", aggregateId: inv.id, jobId: j.id, payload: { receiptReference: input.receiptReference, cashCredited: false } }],
      }
    }
    if (!OPEN_STATES.includes(inv.state as (typeof OPEN_STATES)[number])) blocked("invoice_not_open", "The invoice is not open for collection", { state: inv.state })
    const outstanding = inv.grossMinor - inv.collectedMinor
    if (amountMinor > outstanding) {
      blocked("allocation_exceeds_outstanding", "The allocation would exceed the invoice outstanding", { outstandingMinor: outstanding.toString(), receiptMinor: amountMinor.toString(), currency })
    }
    await assertPeriodOpen(tx, ctx.tenant.id, periodOf(input.receiptDate))
    const bank = await recordBankTransaction(tx, ctx, {
      bankAccountId: account.id,
      direction: "in",
      amountMinor,
      currency,
      businessDate: input.receiptDate,
      kind: "collection",
      providerReceiptId: input.receiptReference,
      sourceType: "client_invoice",
      sourceId: inv.id,
      detail: { invoiceNumber: inv.number },
    })
    const [col] = await tx
      .insert(collection)
      .values({ tenantId: ctx.tenant.id, bankAccountId: account.id, provider: "demo_bank", providerReceiptId: input.receiptReference, amountMinor, currency, receiptDate: input.receiptDate, bankTransactionId: bank.transaction.id, allocatedMinor: amountMinor, createdBy: ctx.user.id })
      .returning()
    await tx.insert(collectionAllocation).values({ tenantId: ctx.tenant.id, collectionId: col!.id, invoiceId: inv.id, amountMinor, currency })
    const collected = inv.collectedMinor + amountMinor
    await tx
      .update(clientInvoice)
      .set({ collectedMinor: collected, state: collected >= inv.grossMinor ? "collected" : "partially_collected", updatedAt: new Date(), revision: sql`${clientInvoice.revision} + 1` })
      .where(eq(clientInvoice.id, inv.id))
    const posted = await postJournals(tx, ctx, [
      {
        entryKey: `collection:${col!.id}`,
        ruleKey: "journal_collection",
        sourceType: "collection",
        sourceId: col!.id,
        jobId: j.id,
        businessDate: input.receiptDate,
        currency,
        memo: `Collection ${input.receiptReference} applied to ${inv.number}`,
        reportingGroup: account.reportingGroup,
        lines: [
          { account: "cash", side: "debit", amountMinor },
          { account: "accounts_receivable", side: "credit", amountMinor },
        ],
      },
    ])
    const entry = posted.entries.find((e) => e.entryKey === `collection:${col!.id}`)
    if (entry) await tx.update(collection).set({ journalEntryId: entry.id }).where(eq(collection.id, col!.id))
    const events: EmittedEvent[] = [
      { eventType: "collections.receipt_applied", aggregateType: "client_invoice", aggregateId: inv.id, jobId: j.id, payload: { receiptReference: input.receiptReference, amountMinor, currency, outstandingAfterMinor: inv.grossMinor - collected }, businessEffectiveAt: new Date(`${input.receiptDate}T12:00:00Z`) },
      ...posted.events,
    ]
    return { result: await output(tx, ctx, inv.id, col!.id, input.receiptDate, false), events }
  },
})

async function output(tx: Tx, ctx: AgencyContext, invoiceId: string, collectionId: string, asOf: string, duplicate: boolean) {
  const [inv] = await tx.select().from(clientInvoice).where(eq(clientInvoice.id, invoiceId)).limit(1)
  const [col] = await tx.select().from(collection).where(eq(collection.id, collectionId)).limit(1)
  const allocs = await tx.select().from(collectionAllocation).where(and(eq(collectionAllocation.tenantId, ctx.tenant.id), eq(collectionAllocation.collectionId, collectionId)))
  const [c] = await tx.select().from(client).where(and(eq(client.tenantId, ctx.tenant.id), eq(client.id, inv!.clientId))).limit(1)
  const { open, report } = await receivablesAging(tx, ctx.tenant.id, asOf, { clientId: inv!.clientId })
  const arOpen = open.filter((o) => o.currency === inv!.currency).reduce((a, o) => a + (o.grossMinor - o.collectedMinor), 0n)
  const pos = await cashPosition(tx, ctx.tenant.id, col!.bankAccountId)
  return {
    invoiceId: inv!.id,
    invoiceNumber: inv!.number,
    duplicateReceipt: duplicate,
    outstandingMinor: inv!.grossMinor - inv!.collectedMinor,
    cash: { ...pos, basis: "confirmed_demo_bank" },
    receipt_proposal: { collectionId: col!.id, provider: col!.provider, providerReceiptId: col!.providerReceiptId, amountMinor: col!.amountMinor, currency: col!.currency, receiptDate: col!.receiptDate, simulation: true },
    application_plan: allocs.map((a) => ({ invoiceId: a.invoiceId, amountMinor: a.amountMinor, currency: a.currency })),
    withholding_certificates: [{ ...withholding({ currency: col!.currency, method: "per_payment", paymentBaseMinor: col!.amountMinor, accumulatedBaseMinor: 0n, accumulatedWithheldMinor: 0n, nonTaxableMinimumMinor: 0n, rateBps: 0, minimumWithholdingMinor: 0n }), profile: "DEMO_NO_TAX (synthetic; no withholding certificate)" }],
    advance_applications: { items: [], reason: "No client advances on record." },
    aging_report: report,
    credit_exposure: c ? creditExposure({ currency: inv!.currency, creditLimitMinor: c.creditLimitMinor, arOpenMinor: arOpen, approvedUnbilledMinor: 0n, requestedMinor: 0n }) : null,
    followup_worklist: open
      .filter((o) => o.dueDate < asOf)
      .map((o) => ({ invoiceId: o.id, number: o.number, dueDate: o.dueDate, outstandingMinor: o.grossMinor - o.collectedMinor, action: "Draft reminder (not sent; demo)" })),
  }
}

// ── Queries ──

export async function getReceivablesAging(ctx: AgencyContext, input: { asOf: string; includeDemoLab?: boolean }) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const { open, report } = await receivablesAging(tx, ctx.tenant.id, input.asOf)
    return { asOf: input.asOf, basis: "issued_demo_invoices", open, report }
  })
}

export async function listCollections(ctx: AgencyContext) {
  return withTenant(ctx.tenant.id, (tx) => tx.select().from(collection).where(eq(collection.tenantId, ctx.tenant.id)).orderBy(asc(collection.receiptDate)))
}
