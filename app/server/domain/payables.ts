import "server-only"

import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import { budgetCheck, reconcile } from "@/server/calculators"
import { invoiceCheck } from "@/server/calculators/finance"
import type { Tx } from "@/server/db/client"
import {
  costEstimate,
  costEstimateLine,
  delivery,
  expense,
  fileObject,
  membership,
  purchaseOrder,
  recognitionRecord,
  supplier,
  supplierInvoice,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { getBusinessDate } from "@/server/domain/presenter"
import { defineCommand, toJsonSafe, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import {
  approvalIsLive,
  approvalStateOf,
  assertPeriodOpen,
  blocked,
  Decimal,
  getPeriod,
  IsoDate,
  loadJob,
  moneyInput,
  Month,
  periodOf,
  postJournals,
  requestFinanceApproval,
  type PlannedJournal,
} from "./ledger"

// Suppliers & payables (M06). One cost moves order → delivery → supplier
// invoice → payment; the supplier invoice never adds cost. Three-way match
// (reconcile calculator) compares the invoice with what remains uninvoiced of
// the order and of the accepted deliveries; anything outside tolerance is held
// and cannot be registered nor paid until corrected.

const Uuid = z.string().uuid()

export type SupplierRow = typeof supplier.$inferSelect
export type SupplierInvoiceRow = typeof supplierInvoice.$inferSelect

const CONSUMING_STATES = ["matched", "payable", "paid"] as const

export function isMediaNetwork(s: SupplierRow) {
  return (s.externalIds as Record<string, unknown> | null)?.ageosRole === "managed_media_network"
}

export async function loadSupplier(tx: Tx, tenantId: string, id: string) {
  const [s] = await tx.select().from(supplier).where(and(eq(supplier.tenantId, tenantId), eq(supplier.id, id))).limit(1)
  if (!s) throw new DomainError("not_found", "Supplier not found")
  return s
}

export function duplicateKeyOf(s: SupplierRow, invoiceNumber: string, currency: string) {
  return `${s.fixtureKey ?? s.id}|${invoiceNumber.trim().toUpperCase()}|${currency}`
}

/** Orders + accepted deliveries a supplier invoice is matched against. */
export async function costScope(tx: Tx, tenantId: string, jobId: string, s: SupplierRow) {
  const media = isMediaNetwork(s)
  const live = notInArray(purchaseOrder.state, ["draft", "cancelled"])
  const orders = await tx
    .select()
    .from(purchaseOrder)
    .where(
      media
        ? and(eq(purchaseOrder.tenantId, tenantId), eq(purchaseOrder.jobId, jobId), eq(purchaseOrder.kind, "media"), live)
        : and(eq(purchaseOrder.tenantId, tenantId), eq(purchaseOrder.jobId, jobId), eq(purchaseOrder.supplierId, s.id), live)
    )
    .orderBy(asc(purchaseOrder.createdAt))
  const deliveries = orders.length
    ? await tx
        .select()
        .from(delivery)
        .where(and(eq(delivery.tenantId, tenantId), inArray(delivery.orderId, orders.map((o) => o.id)), eq(delivery.state, "accepted")))
        .orderBy(asc(delivery.businessDate))
    : []
  const category: "media" | "production" = media || (orders.length > 0 && orders.every((o) => o.kind === "media")) ? "media" : "production"
  return {
    category,
    orders,
    deliveries,
    orderedMinor: orders.reduce((a, o) => a + o.amountMinor, 0n),
    deliveredMinor: deliveries.reduce((a, d) => a + d.acceptedMinor, 0n),
  }
}

/**
 * Amount of the same cost already claimed by other live invoices. Media can be
 * invoiced either per media supplier or by the consolidated managed-media
 * network statement of the job — never both: the network statement consumes
 * every media invoice of the job, and a supplier media invoice is blocked once
 * a network statement covers the job.
 */
async function consumedByOthers(tx: Tx, tenantId: string, jobId: string, s: SupplierRow, category: string, excludeId: string | null) {
  const rows = await tx
    .select({ id: supplierInvoice.id, amount: supplierInvoice.amountMinor, supplierId: supplierInvoice.supplierId })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.tenantId, tenantId), eq(supplierInvoice.jobId, jobId), eq(supplierInvoice.costCategory, category), inArray(supplierInvoice.state, [...CONSUMING_STATES])))
  const others = rows.filter((r) => r.id !== excludeId)
  if (category === "media" && !isMediaNetwork(s)) {
    const network = others.length ? await tx.select().from(supplier).where(and(eq(supplier.tenantId, tenantId), inArray(supplier.id, others.map((o) => o.supplierId)))) : []
    if (network.some(isMediaNetwork)) blocked("media_billed_by_network", "The consolidated media network statement already covers this job's media", { jobId })
    return others.filter((r) => r.supplierId === s.id).reduce((a, r) => a + r.amount, 0n)
  }
  if (category === "media") return others.reduce((a, r) => a + r.amount, 0n)
  return others.filter((r) => r.supplierId === s.id).reduce((a, r) => a + r.amount, 0n)
}

export async function threeWayMatch(
  tx: Tx,
  tenantId: string,
  args: { jobId: string; supplier: SupplierRow; currency: string; amountMinor: bigint; toleranceMinor: bigint; excludeInvoiceId: string | null }
) {
  const scope = await costScope(tx, tenantId, args.jobId, args.supplier)
  const consumed = await consumedByOthers(tx, tenantId, args.jobId, args.supplier, scope.category, args.excludeInvoiceId)
  const clamp = (v: bigint) => (v < 0n ? 0n : v)
  const result = reconcile({
    currency: args.currency,
    orderedMinor: clamp(scope.orderedMinor - consumed),
    deliveredMinor: clamp(scope.deliveredMinor - consumed),
    invoicedMinor: args.amountMinor,
    toleranceMinor: args.toleranceMinor,
  })
  return { scope, consumedMinor: consumed, result }
}

function evidenceLinks(slug: string, jobId: string, scope: Awaited<ReturnType<typeof costScope>>, inv: SupplierInvoiceRow | null) {
  return [
    ...scope.orders.map((o) => ({ recordType: "purchase_order", recordId: o.id, label: `Order ${o.reference}`, amountMinor: o.amountMinor, href: `/a/${slug}/jobs/${jobId}?tab=suppliers` })),
    ...scope.deliveries.map((d) => ({ recordType: "delivery", recordId: d.id, label: `Accepted delivery ${d.businessDate}`, amountMinor: d.acceptedMinor, href: `/a/${slug}/jobs/${jobId}?tab=suppliers` })),
    ...(inv ? [{ recordType: "supplier_invoice", recordId: inv.id, label: `Supplier invoice ${inv.invoiceNumber} r${inv.documentRevision}`, amountMinor: inv.amountMinor, href: `/a/${slug}/modules/suppliers-payments` }] : []),
    ...(inv?.fileId ? [{ recordType: "file", recordId: inv.fileId, label: "Invoice file", amountMinor: null, href: `/a/${slug}/library/${inv.fileId}` }] : []),
  ]
}

async function assertFile(tx: Tx, tenantId: string, fileId: string | null | undefined) {
  if (!fileId) return null
  const [f] = await tx.select({ id: fileObject.id }).from(fileObject).where(and(eq(fileObject.tenantId, tenantId), eq(fileObject.id, fileId))).limit(1)
  if (!f) throw new DomainError("not_found", "File not found", { field: "invoiceFile" })
  return f.id
}

async function lockInvoiceByKey(tx: Tx, tenantId: string, key: string) {
  const [row] = await tx
    .select()
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.tenantId, tenantId), eq(supplierInvoice.duplicateKey, key)))
    .for("update")
    .limit(1)
  return row ?? null
}

// ── agency-delivery-reconciliation: reconcileDeliveryInvoice ──

export const ReconcileDeliveryInvoiceInput = z
  .object({
    job: Uuid,
    supplier: Uuid,
    invoiceNumber: z.string().trim().min(2).max(60),
    invoiceAmount: Decimal,
    tolerance: Decimal,
    invoiceFile: Uuid.optional().nullable(),
  })
  .strict()

export const reconcileDeliveryInvoice = defineCommand({
  type: "payables.reconcileDeliveryInvoice",
  skillId: "agency-delivery-reconciliation",
  permission: "payables.manage",
  input: ReconcileDeliveryInvoiceInput,
  handler: async (tx, ctx, input) => {
    const j = await loadJob(tx, ctx.tenant.id, input.job)
    const s = await loadSupplier(tx, ctx.tenant.id, input.supplier)
    const currency = j.currency
    if (s.currency !== currency) blocked("currency_mismatch", "Supplier and job currencies differ", { supplierCurrency: s.currency, jobCurrency: currency })
    const amountMinor = moneyInput(input.invoiceAmount, currency, "invoiceAmount")
    const toleranceMinor = moneyInput(input.tolerance, currency, "tolerance", { allowZero: true })
    const fileId = await assertFile(tx, ctx.tenant.id, input.invoiceFile)
    const scopeProbe = await costScope(tx, ctx.tenant.id, j.id, s)
    if (!scopeProbe.orders.length) blocked("no_order_for_supplier", "No order from this supplier on the job; nothing to match", { supplierId: s.id, jobId: j.id })

    const key = duplicateKeyOf(s, input.invoiceNumber, currency)
    let inv = await lockInvoiceByKey(tx, ctx.tenant.id, key)
    const events: EmittedEvent[] = []
    let action: "recorded" | "corrected" | "rematched" | "unchanged_registered"
    if (inv && (inv.state === "payable" || inv.state === "paid" || approvalIsLive(await approvalStateOf(tx, ctx.tenant.id, inv.approvalId)))) {
      if (inv.amountMinor !== amountMinor) {
        blocked("invoice_locked", "The invoice is registered or awaiting approval; a correction needs a credit note", { invoiceId: inv.id, state: inv.state })
      }
      action = "unchanged_registered"
      events.push({ eventType: "supplier_invoice.match_confirmed", aggregateType: "supplier_invoice", aggregateId: inv.id, jobId: j.id, payload: { state: inv.state, amountMinor, currency, rule: "three-way-match-v1" } })
    } else {
      const m = await threeWayMatch(tx, ctx.tenant.id, { jobId: j.id, supplier: s, currency, amountMinor, toleranceMinor, excludeInvoiceId: inv?.id ?? null })
      const state = m.result.status === "matched" ? "matched" : "validation_hold"
      const matchResult = toJsonSafe({ ...m.result, toleranceMinor, consumedByOtherInvoicesMinor: m.consumedMinor, orderedMinor: m.scope.orderedMinor, deliveredMinor: m.scope.deliveredMinor, rule: "three-way-match-v1" }) as object
      if (!inv) {
        const today = await getBusinessDate()
        const period = periodOf(today)
        await assertPeriodOpen(tx, ctx.tenant.id, period)
        ;[inv] = await tx
          .insert(supplierInvoice)
          .values({
            tenantId: ctx.tenant.id,
            supplierId: s.id,
            jobId: j.id,
            costCategory: m.scope.category,
            orderId: m.scope.orders.length === 1 ? m.scope.orders[0]!.id : null,
            invoiceNumber: input.invoiceNumber.trim().toUpperCase(),
            duplicateKey: key,
            currency,
            invoiceDate: today,
            period,
            amountMinor,
            state,
            matchResult,
            holdReasons: m.result.reasons,
            fileId,
            receivedBy: ctx.user.id,
          })
          .returning()
        action = "recorded"
        events.push({ eventType: "supplier_invoice.received", aggregateType: "supplier_invoice", aggregateId: inv!.id, jobId: j.id, payload: { duplicateKey: key, amountMinor, currency } })
      } else {
        await assertPeriodOpen(tx, ctx.tenant.id, inv.period)
        const corrected = inv.amountMinor !== amountMinor
        const history = corrected
          ? [...((inv.history as unknown[]) ?? []), { documentRevision: inv.documentRevision, amountMinor: inv.amountMinor.toString(), state: inv.state, replacedAt: new Date().toISOString(), replacedBy: ctx.user.id }]
          : (inv.history as unknown[])
        ;[inv] = await tx
          .update(supplierInvoice)
          .set({
            amountMinor,
            state,
            matchResult,
            holdReasons: m.result.reasons,
            documentRevision: corrected ? inv.documentRevision + 1 : inv.documentRevision,
            history,
            fileId: fileId ?? inv.fileId,
            updatedAt: new Date(),
            revision: sql`${supplierInvoice.revision} + 1`,
          })
          .where(eq(supplierInvoice.id, inv.id))
          .returning()
        action = corrected ? "corrected" : "rematched"
        if (corrected) {
          events.push({ eventType: "supplier_invoice.corrected", aggregateType: "supplier_invoice", aggregateId: inv!.id, jobId: j.id, payload: { documentRevision: inv!.documentRevision, amountMinor, currency, previousAmountMinor: (history.at(-1) as { amountMinor: string }).amountMinor } })
        }
      }
      events.push({
        eventType: state === "matched" ? "supplier_invoice.matched" : "supplier_invoice.held",
        aggregateType: "supplier_invoice",
        aggregateId: inv!.id,
        jobId: j.id,
        payload: { rule: "three-way-match-v1", status: m.result.status, reasons: m.result.reasons, discrepancyMinor: m.result.discrepancyMinor, currency },
      })
    }
    const scope = await costScope(tx, ctx.tenant.id, j.id, s)
    const mr = inv!.matchResult as Record<string, unknown>
    const held = inv!.state === "validation_hold"
    return {
      result: {
        invoiceId: inv!.id,
        state: inv!.state,
        action,
        match_result: {
          rule: "three-way-match-v1",
          status: held ? "hold" : "matched",
          currency,
          orderedMinor: scope.orderedMinor,
          deliveredMinor: scope.deliveredMinor,
          invoicedMinor: inv!.amountMinor,
          documentRevision: inv!.documentRevision,
          paymentHold: held,
        },
        discrepancies: held
          ? [{ reasons: inv!.holdReasons, discrepancyMinor: mr.discrepancyMinor, currency, correctionRequest: { to: s.name, message: "Please issue a corrected invoice matching the accepted delivery (simulated request; nothing is sent)." } }]
          : [],
        evidence_links: evidenceLinks(ctx.tenant.slug, j.id, scope, inv!),
        payable_candidate: held ? null : { invoiceId: inv!.id, amountMinor: mr.payableCandidateMinor ?? inv!.amountMinor, currency, nextStep: "Register the payable (agency-payables) for finance approval." },
        writeoff_proposals: { items: [], reason: held ? "Difference exceeds tolerance; the supplier must correct the invoice. No write-off is proposed." : "No difference to write off." },
        costNote: "Cost is recognized once from the accepted delivery; the supplier invoice only reclassifies the liability.",
      },
      events,
    }
  },
})

// ── agency-payables: approveSupplierInvoice (receive → duplicate check → match → finance approval) ──

export const SUPPLIER_INVOICE_POLICY = "supplier-invoice-v1"

export const ApproveSupplierInvoiceInput = z
  .object({
    supplier: Uuid,
    job: Uuid,
    invoiceNumber: z.string().trim().min(2).max(60),
    invoiceDate: IsoDate,
    dueDate: IsoDate.optional().nullable(),
    invoiceAmount: Decimal,
    period: Month,
    invoiceFile: Uuid.optional().nullable(),
  })
  .strict()

export const approveSupplierInvoice = defineCommand({
  type: "payables.receiveSupplierInvoice",
  skillId: "agency-payables",
  permission: "payables.manage",
  input: ApproveSupplierInvoiceInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await loadJob(tx, ctx.tenant.id, input.job)
    const s = await loadSupplier(tx, ctx.tenant.id, input.supplier)
    const currency = j.currency
    if (s.currency !== currency) blocked("currency_mismatch", "Supplier and job currencies differ", { supplierCurrency: s.currency, jobCurrency: currency })
    const amountMinor = moneyInput(input.invoiceAmount, currency, "invoiceAmount")
    if (input.dueDate && input.dueDate < input.invoiceDate) throw new DomainError("validation", "Due date precedes invoice date", { field: "dueDate" })
    await assertPeriodOpen(tx, ctx.tenant.id, input.period)
    const fileId = await assertFile(tx, ctx.tenant.id, input.invoiceFile)
    const key = duplicateKeyOf(s, input.invoiceNumber, currency)
    const number = input.invoiceNumber.trim().toUpperCase()
    const normalized = { supplierId: s.id, supplierName: s.name, jobId: j.id, invoiceNumber: number, currency, invoiceDate: input.invoiceDate, dueDate: input.dueDate ?? null, period: input.period, netMinor: amountMinor, taxMinor: 0n, totalMinor: amountMinor }
    const check = invoiceCheck({ currency, lines: [{ lineId: "net", netMinor: amountMinor, vatBps: 0 }], perceptionsMinor: 0n, otherChargesMinor: 0n, withholdingsNettedMinor: 0n, declaredTotalMinor: amountMinor, roundingToleranceMinor: 0n })

    let inv = await lockInvoiceByKey(tx, ctx.tenant.id, key)
    const events: EmittedEvent[] = []
    let duplicate: { status: "new" | "same_document" | "registered_existing"; key: string; existingInvoiceId: string | null }
    const identical = (r: SupplierInvoiceRow) => r.amountMinor === amountMinor && r.invoiceDate === input.invoiceDate && r.period === input.period && (r.dueDate ?? null) === (input.dueDate ?? null)
    if (inv) {
      const live = approvalIsLive(await approvalStateOf(tx, ctx.tenant.id, inv.approvalId))
      const registeredOrPending = inv.state === "payable" || inv.state === "paid" || live
      if (identical(inv)) {
        // The same document again: return it, never a second payable.
        duplicate = { status: "same_document", key, existingInvoiceId: inv.id }
        return {
          result: await payablesOutput(tx, ctx, inv, s, duplicate, normalized, check, null),
          events: [{ eventType: "supplier_invoice.resubmission_recognized", aggregateType: "supplier_invoice", aggregateId: inv.id, jobId: j.id, payload: { duplicateKey: key, state: inv.state, rule: "supplier|number|currency" } }],
        }
      }
      if (inv.state === "validation_hold" && inv.amountMinor === amountMinor) {
        blocked("three_way_mismatch", "The invoice is held by the three-way match; it cannot be registered or paid until the discrepancy is resolved", {
          invoiceId: inv.id,
          holdReasons: inv.holdReasons,
          match: inv.matchResult,
        })
      }
      if (registeredOrPending || inv.amountMinor !== amountMinor || inv.state !== "matched") {
        blocked("duplicate_supplier_invoice", "An invoice with this supplier, number and currency already exists with different content; it is held, not duplicated", {
          duplicateKey: key,
          existingInvoiceId: inv.id,
          existingState: inv.state,
        })
      }
      // Reconciled document now formally received: normalize its dates.
      ;[inv] = await tx
        .update(supplierInvoice)
        .set({ invoiceDate: input.invoiceDate, dueDate: input.dueDate ?? null, period: input.period, fileId: fileId ?? inv.fileId, updatedAt: new Date(), revision: sql`${supplierInvoice.revision} + 1` })
        .where(eq(supplierInvoice.id, inv.id))
        .returning()
      duplicate = { status: "registered_existing", key, existingInvoiceId: inv!.id }
    } else {
      duplicate = { status: "new", key, existingInvoiceId: null }
    }
    const m = await threeWayMatch(tx, ctx.tenant.id, { jobId: j.id, supplier: s, currency, amountMinor, toleranceMinor: 0n, excludeInvoiceId: inv?.id ?? null })
    if (!m.scope.orders.length) blocked("no_order_for_supplier", "No order from this supplier on the job", { supplierId: s.id, jobId: j.id })
    const state = m.result.status === "matched" ? "matched" : "validation_hold"
    const matchResult = toJsonSafe({ ...m.result, toleranceMinor: 0n, consumedByOtherInvoicesMinor: m.consumedMinor, orderedMinor: m.scope.orderedMinor, deliveredMinor: m.scope.deliveredMinor, rule: "three-way-match-v1" }) as object
    if (!inv) {
      ;[inv] = await tx
        .insert(supplierInvoice)
        .values({
          tenantId: ctx.tenant.id,
          supplierId: s.id,
          jobId: j.id,
          costCategory: m.scope.category,
          orderId: m.scope.orders.length === 1 ? m.scope.orders[0]!.id : null,
          invoiceNumber: number,
          duplicateKey: key,
          currency,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate ?? null,
          period: input.period,
          amountMinor,
          state,
          matchResult,
          holdReasons: m.result.reasons,
          fileId,
          receivedBy: ctx.user.id,
        })
        .returning()
      events.push({ eventType: "supplier_invoice.received", aggregateType: "supplier_invoice", aggregateId: inv!.id, jobId: j.id, payload: { duplicateKey: key, amountMinor, currency } })
    } else if (state !== inv.state) {
      ;[inv] = await tx
        .update(supplierInvoice)
        .set({ state, matchResult, holdReasons: m.result.reasons, updatedAt: new Date(), revision: sql`${supplierInvoice.revision} + 1` })
        .where(eq(supplierInvoice.id, inv.id))
        .returning()
    }
    if (state !== "matched") {
      events.push({ eventType: "supplier_invoice.held", aggregateType: "supplier_invoice", aggregateId: inv!.id, jobId: j.id, payload: { rule: "three-way-match-v1", reasons: m.result.reasons, discrepancyMinor: m.result.discrepancyMinor } })
      return { result: await payablesOutput(tx, ctx, inv!, s, duplicate, normalized, check, null), events }
    }

    const payload = {
      action: "payables.register_invoice",
      invoiceId: inv!.id,
      invoiceRevision: inv!.revision,
      jobId: j.id,
      supplierId: s.id,
      duplicateKey: key,
      category: inv!.costCategory,
      amountMinor,
      currency,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? null,
      period: input.period,
    }
    const appr = await requestFinanceApproval(tx, ctx, {
      actionType: "payables.register_invoice",
      skillId: "agency-payables",
      job: { id: j.id, revision: j.revision },
      aggregate: { type: "supplier_invoice", id: inv!.id, revision: inv!.revision },
      payload,
      impact: { payableMinor: amountMinor, currency, costNote: "Reclassifies the liability recognized at delivery; adds no cost." },
      title: `Supplier invoice ${number} · ${s.name}`,
      amountMinor,
      currency,
      destination: `supplier:${s.fixtureKey ?? s.id}`,
      policyId: SUPPLIER_INVOICE_POLICY,
      origin: meta.origin,
    })
    ;[inv] = await tx.update(supplierInvoice).set({ approvalId: appr.approval.id, preparedBy: ctx.user.id }).where(eq(supplierInvoice.id, inv!.id)).returning()
    events.push({ eventType: "supplier_invoice.registration_proposed", aggregateType: "supplier_invoice", aggregateId: inv!.id, jobId: j.id, payload: { approvalId: appr.approval.id, amountMinor, currency } }, ...appr.events)
    return { result: await payablesOutput(tx, ctx, inv!, s, duplicate, normalized, check, appr.approvalSummary), events }
  },
})

async function payablesOutput(
  tx: Tx,
  ctx: AgencyContext,
  inv: SupplierInvoiceRow,
  s: SupplierRow,
  duplicate: { status: string; key: string; existingInvoiceId: string | null },
  normalized: Record<string, unknown>,
  check: ReturnType<typeof invoiceCheck>,
  approval: Record<string, unknown> | null
) {
  const approvalState = await approvalStateOf(tx, ctx.tenant.id, inv.approvalId)
  return {
    invoiceId: inv.id,
    state: inv.state,
    reception_log: { receivedAt: inv.createdAt.toISOString(), receivedBy: inv.receivedBy, documentRevision: inv.documentRevision, history: inv.history, fileId: inv.fileId },
    duplicate_check: { key: duplicate.key, status: duplicate.status, existingInvoiceId: duplicate.existingInvoiceId, rule: "supplier|number|currency" },
    normalized_invoice: { ...normalized, invoiceCheck: check, costCategory: inv.costCategory },
    registration_proposal:
      inv.state === "matched" || inv.state === "payable" || inv.state === "paid"
        ? { approval: approval ?? (inv.approvalId ? { approvalId: inv.approvalId, state: approvalState } : null), eligibleRoles: ["finance_approver"], separationOfDuties: true }
        : null,
    holds: inv.state === "validation_hold" ? [{ rule: "three-way-match-v1", reasons: inv.holdReasons, match: inv.matchResult }] : [],
    posting_receipt: inv.reclassJournalId
      ? { journalEntryId: inv.reclassJournalId, ledger: "Demo ledger — synthetic, non-fiscal" }
      : { journalEntryId: null, reason: inv.state === "payable" ? "Reclassification posts when the delivery cost is recognized." : "Posts after finance approval." },
    supplier: { id: s.id, name: s.name },
  }
}

/**
 * Reclassification of an approved invoice: accrued → AP for the part covered
 * by recognized delivery cost; a difference inside tolerance adjusts cost
 * (production) or the recoverable media balance (pass-through media).
 */
export async function planInvoiceReclass(tx: Tx, tenantId: string, inv: SupplierInvoiceRow, reportingGroup: string): Promise<PlannedJournal | null> {
  if (inv.state !== "payable" || inv.reclassJournalId) return null
  const [rec] = await tx
    .select({ v: sql<string>`coalesce(sum(${recognitionRecord.amountMinor}), 0)` })
    .from(recognitionRecord)
    .where(and(eq(recognitionRecord.tenantId, tenantId), eq(recognitionRecord.jobId, inv.jobId), eq(recognitionRecord.category, inv.costCategory)))
  const [reclassed] = await tx
    .select({ v: sql<string>`coalesce(sum(${supplierInvoice.amountMinor}), 0)` })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.tenantId, tenantId), eq(supplierInvoice.jobId, inv.jobId), eq(supplierInvoice.costCategory, inv.costCategory), sql`${supplierInvoice.reclassJournalId} is not null`))
  const accrued = BigInt(rec?.v ?? "0") - BigInt(reclassed?.v ?? "0")
  if (accrued <= 0n) return null
  const media = inv.costCategory === "media"
  const accruedAccount = media ? "accrued_media" : "accrued_production"
  const apAccount = media ? "ap_media" : "ap_production"
  const covered = inv.amountMinor <= accrued ? inv.amountMinor : accrued
  const lines: PlannedJournal["lines"] = [{ account: accruedAccount, side: "debit", amountMinor: covered }]
  if (inv.amountMinor > covered) lines.push({ account: media ? "media_recovery_asset" : "production_expense", side: "debit", amountMinor: inv.amountMinor - covered })
  lines.push({ account: apAccount, side: "credit", amountMinor: inv.amountMinor })
  return {
    entryKey: `supplier_invoice:${inv.id}`,
    ruleKey: media ? "journal_media_invoice" : "journal_production_invoice",
    sourceType: "supplier_invoice",
    sourceId: inv.id,
    jobId: inv.jobId,
    businessDate: inv.invoiceDate,
    currency: inv.currency,
    memo: `${media ? "Media" : "Production"} supplier invoice ${inv.invoiceNumber} reclassifies accrued cost to payables`,
    reportingGroup,
    lines,
  }
}

export async function markReclassified(tx: Tx, invoiceId: string, journalId: string) {
  await tx.update(supplierInvoice).set({ reclassJournalId: journalId, updatedAt: new Date() }).where(eq(supplierInvoice.id, invoiceId))
}

export async function applySupplierInvoiceRegistration(
  tx: Tx,
  ctx: AgencyContext,
  payload: { invoiceId: string; invoiceRevision: number; period: string },
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const [inv] = await tx
    .select()
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.tenantId, ctx.tenant.id), eq(supplierInvoice.id, payload.invoiceId)))
    .for("update")
    .limit(1)
  if (!inv || inv.revision !== payload.invoiceRevision || inv.state !== "matched") {
    return { ok: false, code: "approval_stale", details: { invoiceId: payload.invoiceId, state: inv?.state ?? null } }
  }
  const p = await getPeriod(tx, ctx.tenant.id, payload.period)
  if (!p || p.state !== "open") return { ok: false, code: "period_closed", details: { period: payload.period } }
  if (mode === "check") return { ok: true, events: [] }
  const [updated] = await tx
    .update(supplierInvoice)
    .set({ state: "payable", approvedBy: ctx.user.id, updatedAt: new Date(), revision: sql`${supplierInvoice.revision} + 1` })
    .where(eq(supplierInvoice.id, inv.id))
    .returning()
  const j = await loadJob(tx, ctx.tenant.id, inv.jobId)
  const events: EmittedEvent[] = [
    { eventType: "supplier_invoice.registered", aggregateType: "supplier_invoice", aggregateId: inv.id, jobId: inv.jobId, payload: { amountMinor: inv.amountMinor, currency: inv.currency, approvedBy: ctx.user.id } },
  ]
  const plan = await planInvoiceReclass(tx, ctx.tenant.id, updated!, j.reportingGroup)
  if (plan) {
    const posted = await postJournals(tx, ctx, [plan], { approvalId: inv.approvalId, approvedBy: ctx.user.id, preparedBy: inv.preparedBy })
    const entry = posted.entries.find((e) => e.entryKey === plan.entryKey)
    if (entry) await markReclassified(tx, inv.id, entry.id)
    events.push(...posted.events)
  }
  return { ok: true, events }
}

// ── agency-expenses: submitAndApproveExpense ──

export const EXPENSE_POLICY = "expense-v1"

export const SubmitExpenseInput = z
  .object({
    job: Uuid,
    claimant: Uuid,
    receipt: Uuid,
    expenseDate: IsoDate,
    amount: Decimal,
    category: z.enum(["travel", "meals", "production_supplies", "software", "other"]),
    description: z.string().trim().max(200).optional().nullable(),
  })
  .strict()

export const submitExpense = defineCommand({
  type: "expenses.submit",
  skillId: "agency-expenses",
  permission: "time.log",
  input: SubmitExpenseInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await loadJob(tx, ctx.tenant.id, input.job)
    const currency = j.currency
    const amountMinor = moneyInput(input.amount, currency, "amount")
    const [member] = await tx
      .select()
      .from(membership)
      .where(and(eq(membership.tenantId, ctx.tenant.id), eq(membership.userId, input.claimant), eq(membership.active, true)))
      .limit(1)
    if (!member) throw new DomainError("not_found", "Claimant is not a member of this agency", { field: "claimant" })
    const [file] = await tx
      .select()
      .from(fileObject)
      .where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.id, input.receipt)))
      .limit(1)
    if (!file) blocked("receipt_missing", "A receipt file from this agency is required before approval", { field: "receipt" })
    const period = periodOf(input.expenseDate)
    await assertPeriodOpen(tx, ctx.tenant.id, period)

    // Prepared demo extraction is compared, never trusted blindly.
    const fields = ((file.extraction as { fields?: Record<string, unknown> } | null)?.fields ?? {}) as Record<string, unknown>
    const reasons: string[] = []
    if (!["prepared_demo_extraction", "analyzed"].includes(file.extractionStatus)) reasons.push("receipt_not_extracted")
    if (fields.confidence === "low") reasons.push("low_extraction_confidence")
    let extractedMinor: bigint | null = null
    try {
      extractedMinor = typeof fields.amount === "string" ? moneyInput(fields.amount, currency, "receipt.amount") : null
    } catch {
      extractedMinor = null
    }
    if (extractedMinor === null) reasons.push("amount_not_readable")
    else if (extractedMinor !== amountMinor) reasons.push("amount_mismatch")
    if (typeof fields.date === "string" && fields.date !== input.expenseDate) reasons.push("date_mismatch")
    if (fields.currency && fields.currency !== currency) reasons.push("currency_mismatch")
    const verified = reasons.length === 0
    const receiptCheck = { status: verified ? "verified" : "manual_review", reasons, extractedAmountMinor: extractedMinor, label: "Prepared demo extraction — reviewed against the claim" }

    const [row] = await tx
      .insert(expense)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        claimantUserId: input.claimant,
        receiptFileId: file.id,
        expenseDate: input.expenseDate,
        period,
        amountMinor,
        currency,
        category: input.category,
        description: input.description ?? null,
        receiptCheck: receiptCheck.status,
        receiptCheckDetail: toJsonSafe(receiptCheck) as object,
        state: verified ? "awaiting_approval" : "manual_review",
        submittedBy: ctx.user.id,
      })
      .returning()

    // Budget check against the expense line of the current estimate.
    const [est] = await tx
      .select()
      .from(costEstimate)
      .where(and(eq(costEstimate.tenantId, ctx.tenant.id), eq(costEstimate.jobId, j.id), eq(costEstimate.state, "current")))
      .orderBy(desc(costEstimate.number))
      .limit(1)
    const estLines = est
      ? await tx.select().from(costEstimateLine).where(and(eq(costEstimateLine.tenantId, ctx.tenant.id), eq(costEstimateLine.estimateId, est.id), eq(costEstimateLine.lineType, "expense")))
      : []
    const approved = await tx
      .select({ v: sql<string>`coalesce(sum(${expense.amountMinor}), 0)` })
      .from(expense)
      .where(and(eq(expense.tenantId, ctx.tenant.id), eq(expense.jobId, j.id), inArray(expense.state, ["approved", "reimbursed"])))
    const budget = budgetCheck({
      currency,
      authorizedMinor: estLines.reduce((a, l) => a + l.amountMinor, 0n),
      spentMinor: BigInt(approved[0]?.v ?? "0"),
      openCommitmentsMinor: 0n,
      reservationsMinor: 0n,
      requestedMinor: amountMinor,
    })

    const events: EmittedEvent[] = [
      { eventType: verified ? "expense.submitted" : "expense.manual_review", aggregateType: "expense", aggregateId: row!.id, jobId: j.id, payload: { amountMinor, currency, receiptCheck: receiptCheck.status, reasons } },
    ]
    let approval: Record<string, unknown> | null = null
    if (verified) {
      const appr = await requestFinanceApproval(tx, ctx, {
        actionType: "expense.approve",
        skillId: "agency-expenses",
        job: { id: j.id, revision: j.revision },
        aggregate: { type: "expense", id: row!.id, revision: row!.revision },
        payload: { action: "expense.approve", expenseId: row!.id, expenseRevision: row!.revision, jobId: j.id, claimantUserId: input.claimant, amountMinor, currency, period },
        impact: { costMinor: amountMinor, currency, note: "Recognized once as job cost; the reimbursement later only settles the payable." },
        title: `Expense ${input.category} · ${j.displayReference}`,
        amountMinor,
        currency,
        destination: `claimant:${input.claimant}`,
        policyId: EXPENSE_POLICY,
        origin: meta.origin,
      })
      await tx.update(expense).set({ approvalId: appr.approval.id }).where(eq(expense.id, row!.id))
      approval = appr.approvalSummary
      events.push(...appr.events)
    }
    return {
      result: {
        expenseId: row!.id,
        state: row!.state,
        expense_request_drafts: [{ expenseId: row!.id, jobId: j.id, claimantUserId: input.claimant, expenseDate: input.expenseDate, amountMinor, currency, category: input.category, description: input.description ?? null }],
        contract_schedule: { items: [], reason: "One-off expense; no contract installment schedule applies." },
        sheet_review: receiptCheck,
        settlement_proposal: verified
          ? { method: "reimbursement via payment run", state: "after approval and recognition", note: "The reimbursement settles expense_payable; it never adds a second expense." }
          : { method: null, state: "blocked_manual_review", note: "Receipt needs human review before approval." },
        deferral_schedule: { items: [], reason: "Expense is recognized in its own period; no deferral." },
        budget_check_result: budget,
        approval_requests: approval ? [approval] : [],
      },
      events,
    }
  },
})

export async function applyExpenseApproval(
  tx: Tx,
  ctx: AgencyContext,
  payload: { expenseId: string; expenseRevision: number; claimantUserId: string; period: string },
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const [row] = await tx.select().from(expense).where(and(eq(expense.tenantId, ctx.tenant.id), eq(expense.id, payload.expenseId))).for("update").limit(1)
  if (!row || row.revision !== payload.expenseRevision || row.state !== "awaiting_approval") {
    return { ok: false, code: "approval_stale", details: { expenseId: payload.expenseId } }
  }
  if (row.claimantUserId === ctx.user.id || row.submittedBy === ctx.user.id) {
    return { ok: false, code: "self_approval", details: { rule: "approver_differs_from_claimant" } }
  }
  const p = await getPeriod(tx, ctx.tenant.id, payload.period)
  if (!p || p.state !== "open") return { ok: false, code: "period_closed", details: { period: payload.period } }
  if (mode === "check") return { ok: true, events: [] }
  await tx
    .update(expense)
    .set({ state: "approved", approvedBy: ctx.user.id, updatedAt: new Date(), revision: sql`${expense.revision} + 1` })
    .where(eq(expense.id, row.id))
  return {
    ok: true,
    events: [{ eventType: "expense.approved", aggregateType: "expense", aggregateId: row.id, jobId: row.jobId, payload: { amountMinor: row.amountMinor, currency: row.currency, approvedBy: ctx.user.id } }],
  }
}

// ── Queries ──

export async function listSupplierInvoices(ctx: AgencyContext, filter: { jobId?: string } = {}) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const conds = [eq(supplierInvoice.tenantId, ctx.tenant.id)]
    if (filter.jobId) conds.push(eq(supplierInvoice.jobId, filter.jobId))
    return tx.select().from(supplierInvoice).where(and(...conds)).orderBy(asc(supplierInvoice.createdAt))
  })
}

export async function getThreeWayMatch(ctx: AgencyContext, args: { jobId: string; supplierId: string }) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const s = await loadSupplier(tx, ctx.tenant.id, args.supplierId)
    const scope = await costScope(tx, ctx.tenant.id, args.jobId, s)
    const invoices = await tx
      .select()
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.tenantId, ctx.tenant.id), eq(supplierInvoice.jobId, args.jobId), eq(supplierInvoice.supplierId, s.id)))
    return { supplier: { id: s.id, name: s.name }, category: scope.category, orderedMinor: scope.orderedMinor, deliveredMinor: scope.deliveredMinor, orders: scope.orders, deliveries: scope.deliveries, invoices }
  })
}

export async function listExpenses(ctx: AgencyContext, filter: { jobId?: string } = {}) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const conds = [eq(expense.tenantId, ctx.tenant.id)]
    if (filter.jobId) conds.push(eq(expense.jobId, filter.jobId))
    return tx.select().from(expense).where(and(...conds)).orderBy(asc(expense.createdAt))
  })
}
