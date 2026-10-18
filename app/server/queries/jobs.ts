import "server-only"

import { and, desc, eq } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { clientInvoice, payment, supplier, supplierInvoice } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { jobCloseFinanceChecks } from "@/server/domain/close"

import { isUuid, minorStr } from "./shared"

// Dossier finance projections: the job's client invoices, supplier bills and
// payments, and the finance gates for closing it (from the close service).
export async function getJobFinance(ctx: AgencyContext, jobId: string) {
  if (!isUuid(jobId)) return null
  return withTenant(ctx.tenant.id, async (tx) => {
    const t = ctx.tenant.id
    const invoices = await tx.select().from(clientInvoice).where(and(eq(clientInvoice.tenantId, t), eq(clientInvoice.jobId, jobId))).orderBy(desc(clientInvoice.createdAt))
    const bills = await tx
      .select({ b: supplierInvoice, supplierName: supplier.name })
      .from(supplierInvoice)
      .leftJoin(supplier, and(eq(supplier.tenantId, supplierInvoice.tenantId), eq(supplier.id, supplierInvoice.supplierId)))
      .where(and(eq(supplierInvoice.tenantId, t), eq(supplierInvoice.jobId, jobId)))
      .orderBy(desc(supplierInvoice.createdAt))
    const payments = await tx.select().from(payment).where(and(eq(payment.tenantId, t), eq(payment.jobId, jobId))).orderBy(desc(payment.createdAt))
    const checks = await jobCloseFinanceChecks(tx, t, jobId)
    return {
      invoices: invoices.map((i) => ({ id: i.id, number: i.number ?? i.id.slice(0, 8), state: i.state, feeMinor: minorStr(i.feeMinor), mediaRecoveryMinor: minorStr(i.mediaRecoveryMinor), grossMinor: minorStr(i.grossMinor), collectedMinor: minorStr(i.collectedMinor), currency: i.currency, dueDate: i.dueDate })),
      bills: bills.map(({ b, supplierName }) => ({ id: b.id, invoiceNumber: b.invoiceNumber, supplierName: supplierName ?? "—", state: b.state, amountMinor: minorStr(b.amountMinor), paidMinor: minorStr(b.paidMinor), currency: b.currency, dueDate: b.dueDate })),
      payments: payments.map((p) => ({ id: p.id, batchId: p.batchId, payee: p.payee, state: p.state, amountMinor: minorStr(p.amountMinor), currency: p.currency, receiptId: p.receiptId })),
      checks,
    }
  })
}
