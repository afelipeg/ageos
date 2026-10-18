import "server-only"

import { and, asc, desc, eq } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import {
  accountingPeriod,
  campaign,
  clientInvoice,
  clientInvoiceLine,
  collection,
  depreciationEntry,
  expense,
  fixedAsset,
  journalEntry,
  journalLine,
  mediaPlanRevision,
  oohFace,
  oohReservation,
  payment,
  paymentBatch,
  productionDeliverable,
  purchaseOrder,
  rateCard,
  supplier,
  supplierInvoice,
} from "@/server/db/schema"

import { f, jobLink, type Loaded, type RecordLink } from "./record-helpers"
import { iso, minorStr, userNames } from "./shared"

// Record detail for the production, media, payables, billing and ledger
// records (Core-2 / Core-3 tables). Same contract as records.ts: tenant
// scoped reads, exact minor units, navigable relations, owning workflow.

export const EXTENDED_RECORD_TYPES = [
  "deliverable",
  "campaign",
  "rate-card",
  "ooh-reservation",
  "supplier-bill",
  "expense",
  "payment-run",
  "client-invoice",
  "receipt",
  "journal",
  "fixed-asset",
  "period-close",
] as const

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v))

export async function loadExtended(tx: Tx, ctx: AgencyContext, type: string, id: string): Promise<Loaded | null> {
  const t = ctx.tenant.id
  const base = `/a/${ctx.tenant.slug}`
  const rec = (rt: string, rid: string) => `${base}/records/${rt}/${rid}`
  const link = (labelKey: string, label: string, href: string): RecordLink => ({ labelKey, label, href })

  switch (type) {
    case "deliverable": {
      const [d] = await tx.select().from(productionDeliverable).where(and(eq(productionDeliverable.tenantId, t), eq(productionDeliverable.id, id))).limit(1)
      if (!d) return null
      const sibs = await tx.select({ id: productionDeliverable.id, version: productionDeliverable.version, state: productionDeliverable.state }).from(productionDeliverable).where(and(eq(productionDeliverable.tenantId, t), eq(productionDeliverable.jobId, d.jobId), eq(productionDeliverable.name, d.name))).orderBy(desc(productionDeliverable.version))
      return {
        title: `${d.name} v${d.version}`,
        subtitle: d.qualityResult ?? "",
        state: d.state,
        revision: d.revision,
        synthetic: true,
        fields: [
          f("version", d.version, "number"),
          f("deliveryDate", d.deliveryDate, "date"),
          f("qualityResult", d.qualityResult, "mono"),
          f("qcNotes", d.qcNotes),
          f("rightsCleared", d.rightsCleared ? "yes" : "no", "state"),
          f("rightsBasis", d.rightsBasis),
          f("findings", json(d.findings), "mono"),
        ],
        relations: [
          ...(await jobLink(tx, ctx, d.jobId, "production")),
          ...(d.productionOrderId ? [link("records.links.order", d.productionOrderId.slice(0, 8), rec("purchase-order", d.productionOrderId))] : []),
          ...(d.deliveryId ? [link("records.links.delivery", d.deliveryId.slice(0, 8), rec("delivery", d.deliveryId))] : []),
        ],
        siblings: sibs.map((s) => ({ id: s.id, label: `v${s.version}`, state: s.state, current: s.id === d.id, href: rec("deliverable", s.id) })),
        lines: null,
        owningSkill: { moduleKey: "work-production", skillId: "agency-production" },
        jobId: d.jobId,
        fileIds: [d.assetFileId],
      }
    }
    case "campaign": {
      const [c] = await tx.select().from(campaign).where(and(eq(campaign.tenantId, t), eq(campaign.id, id))).limit(1)
      if (!c) return null
      const [plan] = c.planRevisionId ? await tx.select({ id: mediaPlanRevision.id, number: mediaPlanRevision.number }).from(mediaPlanRevision).where(and(eq(mediaPlanRevision.tenantId, t), eq(mediaPlanRevision.id, c.planRevisionId))).limit(1) : []
      return {
        title: c.name,
        subtitle: `${c.provider} · ${c.accountAlias}`,
        state: c.state,
        revision: c.revision,
        synthetic: true,
        fields: [
          f("provider", c.provider, "mono"),
          f("account", c.accountAlias, "mono"),
          f("budget", minorStr(c.budgetMinor), "money", c.currency),
          f("receipt", c.receiptId, "mono"),
          f("externalId", c.externalId, "mono"),
          f("lastError", c.lastError),
          f("preflight", json(c.preflight), "mono"),
          f("createdAt", iso(c.createdAt), "timestamp"),
        ],
        relations: [
          ...(await jobLink(tx, ctx, c.jobId, "media")),
          ...(plan ? [link("records.links.plan", `r${plan.number}`, rec("media-plan", plan.id))] : []),
          ...(c.connectionId ? [link("records.links.connection", c.accountAlias, `${base}/connections/${c.connectionId}`)] : []),
          ...(c.approvalId ? [link("records.links.approval", c.approvalId.slice(0, 8), `${base}/approvals/${c.approvalId}`)] : []),
        ],
        siblings: [],
        lines: null,
        owningSkill: { moduleKey: "media-buying", skillId: "agency-campaign-activation" },
        jobId: c.jobId,
        fileIds: [c.creativeFileId],
        commands: [
          {
            command: "media.reconcileCampaignActivation",
            titleKey: "records.commands.reconcileCampaign",
            helpKey: "records.commands.reconcileCampaignHelp",
            fixed: { campaign: c.id },
            fields: [],
            buttons: [{ label: "records.commands.reconcile", variant: "outline" }],
          },
        ],
      }
    }
    case "rate-card": {
      const [r] = await tx.select().from(rateCard).where(and(eq(rateCard.tenantId, t), eq(rateCard.id, id))).limit(1)
      if (!r) return null
      const [s] = r.supplierId ? await tx.select({ id: supplier.id, name: supplier.name }).from(supplier).where(and(eq(supplier.tenantId, t), eq(supplier.id, r.supplierId))).limit(1) : []
      const names = await userNames(tx, [r.approvedBy])
      return {
        title: `${r.medium} · r${r.number}`,
        subtitle: s?.name ?? "",
        state: r.state,
        revision: r.revision,
        synthetic: true,
        fields: [
          f("medium", r.medium),
          f("validFrom", r.validFrom, "date"),
          f("validTo", r.validTo, "date"),
          f("grossRate", minorStr(r.grossRateMinor), "money", r.currency),
          f("discountsBps", r.discountsBps.length ? r.discountsBps.map((d) => `${(d / 100).toFixed(2)} %`).join(" + ") : null),
          f("netRate", minorStr(r.netRateMinor), "money", r.currency),
          f("approvedBy", r.approvedBy ? (names.get(r.approvedBy) ?? null) : null),
          f("reason", r.decisionReason),
        ],
        relations: s ? [link("records.links.supplier", s.name, rec("supplier", s.id))] : [],
        siblings: [],
        lines: null,
        owningSkill: { moduleKey: "media-buying", skillId: "agency-rate-cards-contracts" },
        jobId: null,
        commands:
          r.state === "submitted" || r.state === "awaiting_approval" || r.state === "draft"
            ? [
                {
                  command: "media.decideRateCard",
                  titleKey: "records.commands.decideRateCard",
                  helpKey: "records.commands.decideRateCardHelp",
                  fixed: { rateCard: r.id, revision: r.revision },
                  fields: [{ key: "reason", type: "textarea", label: "records.commands.reason" }],
                  buttons: [
                    { label: "records.commands.approve", patch: { decision: "approve" }, requires: [] },
                    { label: "records.commands.reject", patch: { decision: "reject" }, variant: "outline", requires: ["reason"] },
                  ],
                },
              ]
            : [],
      }
    }
    case "ooh-reservation": {
      const [r] = await tx.select().from(oohReservation).where(and(eq(oohReservation.tenantId, t), eq(oohReservation.id, id))).limit(1)
      if (!r) return null
      const [face] = await tx.select().from(oohFace).where(and(eq(oohFace.tenantId, t), eq(oohFace.id, r.faceId))).limit(1)
      return {
        title: face ? `${face.faceKey} · ${face.site}` : r.id.slice(0, 8),
        subtitle: face?.format ?? "",
        state: r.state,
        revision: r.revision,
        synthetic: face?.synthetic ?? true,
        fields: [f("startDate", r.startDate, "date"), f("endDate", r.endDate, "date"), f("site", face?.site ?? null), f("format", face?.format ?? null)],
        relations: await jobLink(tx, ctx, r.jobId, "media"),
        siblings: [],
        lines: null,
        owningSkill: { moduleKey: "media-buying", skillId: "agency-ooh-inventory" },
        jobId: r.jobId,
      }
    }
    case "supplier-bill": {
      const [b] = await tx.select().from(supplierInvoice).where(and(eq(supplierInvoice.tenantId, t), eq(supplierInvoice.id, id))).limit(1)
      if (!b) return null
      const [s] = await tx.select({ id: supplier.id, name: supplier.name }).from(supplier).where(and(eq(supplier.tenantId, t), eq(supplier.id, b.supplierId))).limit(1)
      const [o] = b.orderId ? await tx.select({ id: purchaseOrder.id, reference: purchaseOrder.reference }).from(purchaseOrder).where(and(eq(purchaseOrder.tenantId, t), eq(purchaseOrder.id, b.orderId))).limit(1) : []
      return {
        title: b.invoiceNumber,
        subtitle: s?.name ?? "",
        state: b.state,
        revision: b.revision,
        synthetic: true,
        fields: [
          f("costCategory", b.costCategory),
          f("invoiceDate", b.invoiceDate, "date"),
          f("dueDate", b.dueDate, "date"),
          f("period", b.period, "mono"),
          f("amount", minorStr(b.amountMinor), "money", b.currency),
          f("tax", minorStr(b.taxMinor), "money", b.currency),
          f("paid", minorStr(b.paidMinor), "money", b.currency),
          f("holdReasons", b.holdReasons.length ? b.holdReasons.join(", ") : null),
          f("matchResult", json(b.matchResult), "mono"),
        ],
        relations: [
          ...(s ? [link("records.links.supplier", s.name, rec("supplier", s.id))] : []),
          ...(o ? [link("records.links.order", o.reference, rec("purchase-order", o.id))] : []),
          ...(await jobLink(tx, ctx, b.jobId, "finance")),
          ...(b.approvalId ? [link("records.links.approval", b.approvalId.slice(0, 8), `${base}/approvals/${b.approvalId}`)] : []),
          ...(b.reclassJournalId ? [link("records.links.journal", b.reclassJournalId.slice(0, 8), rec("journal", b.reclassJournalId))] : []),
        ],
        siblings: [],
        lines: null,
        owningSkill: { moduleKey: "suppliers-payments", skillId: "agency-payables" },
        jobId: b.jobId,
        fileIds: [b.fileId],
      }
    }
    case "expense": {
      const [e] = await tx.select().from(expense).where(and(eq(expense.tenantId, t), eq(expense.id, id))).limit(1)
      if (!e) return null
      const names = await userNames(tx, [e.claimantUserId, e.approvedBy])
      return {
        title: e.description || e.category,
        subtitle: e.category,
        state: e.state,
        revision: e.revision,
        synthetic: true,
        fields: [
          f("person", e.claimantUserId ? (names.get(e.claimantUserId) ?? null) : null),
          f("expenseDate", e.expenseDate, "date"),
          f("amount", minorStr(e.amountMinor), "money", e.currency),
          f("receiptCheck", e.receiptCheck, "mono"),
          f("receiptCheckDetail", json(e.receiptCheckDetail), "mono"),
          f("approvedBy", e.approvedBy ? (names.get(e.approvedBy) ?? null) : null),
        ],
        relations: [
          ...(await jobLink(tx, ctx, e.jobId, "finance")),
          ...(e.approvalId ? [link("records.links.approval", e.approvalId.slice(0, 8), `${base}/approvals/${e.approvalId}`)] : []),
        ],
        siblings: [],
        lines: null,
        owningSkill: { moduleKey: "suppliers-payments", skillId: "agency-expenses" },
        jobId: e.jobId,
        fileIds: [e.receiptFileId],
      }
    }
    case "payment-run": {
      const [b] = await tx.select().from(paymentBatch).where(and(eq(paymentBatch.tenantId, t), eq(paymentBatch.id, id))).limit(1)
      if (!b) return null
      const lines = await tx.select().from(payment).where(and(eq(payment.tenantId, t), eq(payment.batchId, b.id))).orderBy(asc(payment.seq))
      const names = await userNames(tx, [b.preparedBy, b.approvedBy])
      return {
        title: b.reference,
        subtitle: b.paymentMethod,
        state: b.state,
        revision: b.revision,
        synthetic: true,
        fields: [
          f("paymentDate", b.paymentDate, "date"),
          f("dueThrough", b.dueThrough, "date"),
          f("total", minorStr(b.totalMinor), "money", b.currency),
          f("preparedBy", b.preparedBy ? (names.get(b.preparedBy) ?? null) : null),
          f("approvedBy", b.approvedBy ? (names.get(b.approvedBy) ?? null) : null),
          f("blockedReason", b.blockedReason),
        ],
        relations: [
          ...(await jobLink(tx, ctx, b.jobId, "finance")),
          ...(b.approvalId ? [link("records.links.approval", b.approvalId.slice(0, 8), `${base}/approvals/${b.approvalId}`)] : []),
          ...(b.proposalId ? [link("records.links.proposal", b.proposalId.slice(0, 8), rec("proposal", b.proposalId))] : []),
        ],
        siblings: [],
        lines: {
          columns: [
            { id: "seq", header: "records.fields.number", kind: "number" },
            { id: "payee", header: "records.fields.payee", kind: "text" },
            { id: "amountMinor", header: "records.fields.amount", kind: "money", align: "end" },
            { id: "receiptId", header: "records.fields.receipt", kind: "mono" },
            { id: "state", header: "records.fields.state", kind: "state", labelPrefix: "records.state" },
          ],
          rows: lines.map((p) => ({ id: p.id, seq: p.seq, payee: p.payee, amountMinor: minorStr(p.amountMinor), currency: p.currency, receiptId: p.receiptId ?? "—", state: p.state })),
        },
        owningSkill: { moduleKey: "suppliers-payments", skillId: "agency-payment-run" },
        jobId: b.jobId,
        eventIds: [b.id, ...lines.map((p) => p.id)],
        commands: lines.length
          ? [
              {
                command: "payments.executePayment",
                titleKey: "records.commands.executePayment",
                helpKey: "records.commands.executePaymentHelp",
                fixed: {},
                fields: [{ key: "paymentId", type: "select", label: "records.commands.payment", required: true, options: lines.map((p) => ({ value: p.id, label: `#${p.seq} · ${p.payee} · ${p.state}` })) }],
                buttons: [{ label: "records.commands.execute" }],
              },
              {
                command: "payments.reconcilePayment",
                titleKey: "records.commands.reconcilePayment",
                helpKey: "records.commands.reconcilePaymentHelp",
                fixed: {},
                fields: [{ key: "paymentId", type: "select", label: "records.commands.payment", required: true, options: lines.map((p) => ({ value: p.id, label: `#${p.seq} · ${p.payee} · ${p.state}` })) }],
                buttons: [{ label: "records.commands.reconcile", variant: "outline" }],
              },
            ]
          : [],
      }
    }
    case "client-invoice": {
      const [inv] = await tx.select().from(clientInvoice).where(and(eq(clientInvoice.tenantId, t), eq(clientInvoice.id, id))).limit(1)
      if (!inv) return null
      const lines = await tx.select().from(clientInvoiceLine).where(and(eq(clientInvoiceLine.tenantId, t), eq(clientInvoiceLine.invoiceId, inv.id))).orderBy(asc(clientInvoiceLine.lineNo))
      return {
        title: inv.number ?? inv.id.slice(0, 8),
        subtitle: inv.label ?? "",
        state: inv.state,
        revision: inv.revision,
        synthetic: true,
        fields: [
          f("invoiceDate", inv.invoiceDate, "date"),
          f("dueDate", inv.dueDate, "date"),
          f("period", inv.period, "mono"),
          f("fee", minorStr(inv.feeMinor), "money", inv.currency),
          f("mediaRecovery", minorStr(inv.mediaRecoveryMinor), "money", inv.currency),
          f("net", minorStr(inv.netMinor), "money", inv.currency),
          f("tax", minorStr(inv.taxMinor), "money", inv.currency),
          f("gross", minorStr(inv.grossMinor), "money", inv.currency),
          f("collected", minorStr(inv.collectedMinor), "money", inv.currency),
          f("taxProfile", inv.taxProfile, "mono"),
          f("poNumber", inv.poNumber, "mono"),
          f("notes", inv.notes),
        ],
        relations: [
          ...(await jobLink(tx, ctx, inv.jobId, "finance")),
          ...(inv.approvalId ? [link("records.links.approval", inv.approvalId.slice(0, 8), `${base}/approvals/${inv.approvalId}`)] : []),
          ...(inv.journalEntryId ? [link("records.links.journal", inv.journalEntryId.slice(0, 8), rec("journal", inv.journalEntryId))] : []),
        ],
        siblings: [],
        lines: {
          columns: [
            { id: "lineNo", header: "records.fields.number", kind: "number" },
            { id: "description", header: "records.fields.description", kind: "text" },
            { id: "treatment", header: "records.fields.treatment", kind: "mono" },
            { id: "amountMinor", header: "records.fields.amount", kind: "money", align: "end" },
          ],
          rows: lines.map((l) => ({ id: l.id, lineNo: l.lineNo, description: l.description, treatment: `${l.lineType} · ${l.treatment}`, amountMinor: minorStr(l.amountMinor), currency: l.currency })),
        },
        owningSkill: { moduleKey: "billing-collections", skillId: "agency-client-billing" },
        jobId: inv.jobId,
        fileIds: [inv.documentFileId],
      }
    }
    case "receipt": {
      const [c] = await tx.select().from(collection).where(and(eq(collection.tenantId, t), eq(collection.id, id))).limit(1)
      if (!c) return null
      return {
        title: c.providerReceiptId ?? c.id.slice(0, 8),
        subtitle: c.provider ?? "",
        state: null,
        revision: null,
        synthetic: true,
        fields: [
          f("receiptDate", c.receiptDate, "date"),
          f("amount", minorStr(c.amountMinor), "money", c.currency),
          f("allocated", minorStr(c.allocatedMinor), "money", c.currency),
          f("provider", c.provider, "mono"),
        ],
        relations: c.journalEntryId ? [link("records.links.journal", c.journalEntryId.slice(0, 8), rec("journal", c.journalEntryId))] : [],
        siblings: [],
        lines: null,
        owningSkill: { moduleKey: "billing-collections", skillId: "agency-collections" },
        jobId: null,
      }
    }
    case "journal": {
      const [j] = await tx.select().from(journalEntry).where(and(eq(journalEntry.tenantId, t), eq(journalEntry.id, id))).limit(1)
      if (!j) return null
      const lines = await tx.select().from(journalLine).where(and(eq(journalLine.tenantId, t), eq(journalLine.entryId, j.id))).orderBy(asc(journalLine.lineNo))
      const names = await userNames(tx, [j.preparedBy, j.approvedBy])
      return {
        title: j.entryKey,
        subtitle: j.memo ?? "",
        state: j.state,
        revision: null,
        synthetic: true,
        fields: [
          f("ruleKey", j.ruleKey, "mono"),
          f("period", j.period, "mono"),
          f("businessDate", j.businessDate, "date"),
          f("currency", j.currency, "mono"),
          f("ledgerLabel", j.ledgerLabel),
          f("source", `${j.sourceType}${j.sourceId ? ` · ${j.sourceId.slice(0, 8)}` : ""}`, "mono"),
          f("preparedBy", j.preparedBy ? (names.get(j.preparedBy) ?? null) : null),
          f("approvedBy", j.approvedBy ? (names.get(j.approvedBy) ?? null) : null),
          f("postedAt", iso(j.postedAt), "timestamp"),
        ],
        relations: [
          ...(await jobLink(tx, ctx, j.jobId, "finance")),
          ...(j.reversesId ? [link("records.links.reverses", j.reversesId.slice(0, 8), rec("journal", j.reversesId))] : []),
          ...(j.approvalId ? [link("records.links.approval", j.approvalId.slice(0, 8), `${base}/approvals/${j.approvalId}`)] : []),
        ],
        siblings: [],
        lines: {
          columns: [
            { id: "lineNo", header: "records.fields.number", kind: "number" },
            { id: "accountCode", header: "records.fields.account", kind: "mono" },
            { id: "debitMinor", header: "records.fields.debit", kind: "money", align: "end" },
            { id: "creditMinor", header: "records.fields.credit", kind: "money", align: "end" },
          ],
          rows: lines.map((l) => ({ id: l.id, lineNo: l.lineNo, accountCode: l.accountCode, debitMinor: minorStr(l.debitMinor), creditMinor: minorStr(l.creditMinor), currency: l.currency })),
        },
        owningSkill: { moduleKey: "accounting-close", skillId: "agency-general-ledger" },
        jobId: j.jobId,
      }
    }
    case "fixed-asset": {
      const [a] = await tx.select().from(fixedAsset).where(and(eq(fixedAsset.tenantId, t), eq(fixedAsset.id, id))).limit(1)
      if (!a) return null
      const dep = await tx.select().from(depreciationEntry).where(and(eq(depreciationEntry.tenantId, t), eq(depreciationEntry.assetId, a.id))).orderBy(asc(depreciationEntry.month))
      return {
        title: a.name,
        subtitle: a.method,
        state: a.state,
        revision: a.revision,
        synthetic: true,
        fields: [
          f("cost", minorStr(a.costMinor), "money", a.currency),
          f("residual", minorStr(a.residualMinor), "money", a.currency),
          f("lifeMonths", a.lifeMonths, "number"),
          f("startDate", a.startDate, "date"),
          f("method", a.method, "mono"),
        ],
        relations: await jobLink(tx, ctx, a.jobId, "finance"),
        siblings: [],
        lines: {
          columns: [
            { id: "month", header: "records.fields.period", kind: "mono" },
            { id: "chargeMinor", header: "records.fields.charge", kind: "money", align: "end" },
            { id: "accumulatedMinor", header: "records.fields.accumulated", kind: "money", align: "end" },
            { id: "netBookMinor", header: "records.fields.netBook", kind: "money", align: "end" },
            { id: "state", header: "records.fields.state", kind: "state", labelPrefix: "records.state" },
          ],
          rows: dep.map((d) => ({ id: d.id, month: d.month, chargeMinor: minorStr(d.chargeMinor), accumulatedMinor: minorStr(d.accumulatedMinor), netBookMinor: minorStr(d.netBookMinor), currency: a.currency, state: d.state })),
        },
        owningSkill: { moduleKey: "accounting-close", skillId: "agency-fixed-assets" },
        jobId: a.jobId,
      }
    }
    case "period-close": {
      const [p] = await tx.select().from(accountingPeriod).where(and(eq(accountingPeriod.tenantId, t), eq(accountingPeriod.id, id))).limit(1)
      if (!p) return null
      const names = await userNames(tx, [p.closedBy, p.reopenedBy])
      return {
        title: p.period,
        subtitle: "",
        state: p.state,
        revision: p.revision,
        synthetic: true,
        fields: [
          f("closedBy", p.closedBy ? (names.get(p.closedBy) ?? null) : null),
          f("closedAt", iso(p.closedAt), "timestamp"),
          f("reopenReason", p.reopenReason),
          f("reopenedBy", p.reopenedBy ? (names.get(p.reopenedBy) ?? null) : null),
          f("reopenedAt", iso(p.reopenedAt), "timestamp"),
          f("closeSnapshot", json(p.closeSnapshot), "mono"),
        ],
        relations: [],
        siblings: [],
        lines: null,
        owningSkill: { moduleKey: "accounting-close", skillId: "agency-period-close" },
        jobId: null,
      }
    }
    default:
      return null
  }
}
