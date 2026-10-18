import "server-only"

import { and, asc, desc, eq } from "drizzle-orm"

import type { GridColumn, GridRow } from "@/components/app/record-grid"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import {
  accountingPeriod,
  broadcastSchedule,
  broadcastStation,
  campaign,
  client,
  clientInvoice,
  collection,
  evidence,
  expense,
  fixedAsset,
  job,
  journalEntry,
  managementReport,
  oohFace,
  oohReservation,
  paymentBatch,
  productionDeliverable,
  rateCard,
  revenueBudgetVersion,
  supplier,
  supplierInvoice,
} from "@/server/db/schema"

import { iso, minorStr } from "./shared"

// Desk views over the production, media, payables, billing, ledger and
// planning records of the Core-2 / Core-3 services. Same contract as the base
// views in modules.ts: tenant-scoped reads, exact minor units, rows open the
// authorized record.

export type ExtraViewDef = {
  key: string
  columns: GridColumn[]
  createSkill?: string
  load: (tx: Tx, ctx: AgencyContext) => Promise<GridRow[]>
}

const base = (ctx: AgencyContext) => `/a/${ctx.tenant.slug}`
const rec = (ctx: AgencyContext, type: string, id: string) => `${base(ctx)}/records/${type}/${id}`

async function jobs(tx: Tx, ctx: AgencyContext) {
  const rows = await tx.select({ id: job.id, name: job.name, ref: job.displayReference }).from(job).where(eq(job.tenantId, ctx.tenant.id))
  return new Map(rows.map((r) => [r.id, r]))
}
async function suppliers(tx: Tx, ctx: AgencyContext) {
  const rows = await tx.select({ id: supplier.id, name: supplier.name }).from(supplier).where(eq(supplier.tenantId, ctx.tenant.id))
  return new Map(rows.map((r) => [r.id, r.name]))
}
const jobCol: GridColumn = { id: "jobName", header: "modules.columns.job", kind: "link", hrefKey: "jobHref", subKey: "jobRef" }
function jobCells(ctx: AgencyContext, m: Map<string, { id: string; name: string; ref: string }>, id: string | null, tab = "") {
  const j = id ? m.get(id) : undefined
  return { jobName: j?.name ?? "—", jobRef: j?.ref ?? "", jobHref: j ? `${base(ctx)}/jobs/${j.id}${tab ? `?tab=${tab}` : ""}` : `${base(ctx)}/jobs` }
}

export const EXTRA_VIEWS: Record<string, ExtraViewDef[]> = {
  "clients-contracts": [
    {
      key: "evidence",
      createSkill: "agency-contract-po",
      columns: [
        { id: "title", header: "modules.columns.name", kind: "link", hrefKey: "href", subKey: "kind" },
        { id: "reviewState", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
        { id: "createdAt", header: "modules.columns.created", kind: "timestamp" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(evidence).where(eq(evidence.tenantId, ctx.tenant.id)).orderBy(desc(evidence.createdAt))
        return rows.map((e) => ({ id: e.id, title: e.title, kind: e.kind, reviewState: e.reviewState, createdAt: iso(e.createdAt), href: rec(ctx, "evidence", e.id) }))
      },
    },
  ],
  "work-production": [
    {
      key: "deliverables",
      createSkill: "agency-production",
      columns: [
        { id: "label", header: "modules.columns.deliverable", kind: "link", hrefKey: "href", subKey: "quality" },
        jobCol,
        { id: "deliveryDate", header: "modules.columns.date", kind: "date" },
        { id: "rights", header: "modules.columns.rights", kind: "state", labelPrefix: "records.state" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(productionDeliverable).where(eq(productionDeliverable.tenantId, ctx.tenant.id)).orderBy(desc(productionDeliverable.createdAt))
        const j = await jobs(tx, ctx)
        return rows.map((d) => ({ id: d.id, label: `${d.name} v${d.version}`, quality: d.qualityResult ?? "", ...jobCells(ctx, j, d.jobId, "production"), deliveryDate: d.deliveryDate, rights: d.rightsCleared ? "yes" : "no", state: d.state, href: rec(ctx, "deliverable", d.id) }))
      },
    },
  ],
  "media-planning": [
    {
      key: "broadcast",
      createSkill: "agency-tv-radio-planning",
      columns: [
        { id: "station", header: "modules.columns.station", kind: "text", subKey: "medium" },
        jobCol,
        { id: "spots", header: "modules.columns.spots", kind: "number", align: "end" },
        { id: "netMinor", header: "modules.columns.net", kind: "money", align: "end" },
        { id: "flight", header: "modules.columns.dates", kind: "text" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx
          .select({ s: broadcastSchedule, station: broadcastStation.name })
          .from(broadcastSchedule)
          .leftJoin(broadcastStation, and(eq(broadcastStation.tenantId, broadcastSchedule.tenantId), eq(broadcastStation.id, broadcastSchedule.stationId)))
          .where(eq(broadcastSchedule.tenantId, ctx.tenant.id))
          .orderBy(desc(broadcastSchedule.createdAt))
        const j = await jobs(tx, ctx)
        return rows.map(({ s, station }) => ({ id: s.id, station: station ?? "—", medium: `${s.medium} · ${s.durationSeconds}s · ${s.timezone}`, ...jobCells(ctx, j, s.jobId, "media"), spots: s.spotCount, netMinor: minorStr(s.netMinor), currency: s.currency, flight: `${s.flightStart} → ${s.flightEnd}`, state: s.state }))
      },
    },
  ],
  "media-buying": [
    {
      key: "campaigns",
      createSkill: "agency-campaign-activation",
      columns: [
        { id: "name", header: "modules.columns.campaign", kind: "link", hrefKey: "href", subKey: "account" },
        jobCol,
        { id: "budgetMinor", header: "modules.columns.budget", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(campaign).where(eq(campaign.tenantId, ctx.tenant.id)).orderBy(desc(campaign.createdAt))
        const j = await jobs(tx, ctx)
        return rows.map((c) => ({ id: c.id, name: c.name, account: `${c.provider} · ${c.accountAlias}`, ...jobCells(ctx, j, c.jobId, "media"), budgetMinor: minorStr(c.budgetMinor), currency: c.currency, state: c.state, href: rec(ctx, "campaign", c.id) }))
      },
    },
    {
      key: "rate-cards",
      createSkill: "agency-rate-cards-contracts",
      columns: [
        { id: "label", header: "modules.columns.rateCard", kind: "link", hrefKey: "href", subKey: "supplierName" },
        { id: "validity", header: "modules.columns.validity", kind: "text" },
        { id: "netRateMinor", header: "modules.columns.netRate", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(rateCard).where(eq(rateCard.tenantId, ctx.tenant.id)).orderBy(desc(rateCard.createdAt))
        const s = await suppliers(tx, ctx)
        return rows.map((r) => ({ id: r.id, label: `${r.medium} · r${r.number}`, supplierName: r.supplierId ? (s.get(r.supplierId) ?? "—") : "—", validity: `${r.validFrom} → ${r.validTo}`, netRateMinor: minorStr(r.netRateMinor), currency: r.currency, state: r.state, href: rec(ctx, "rate-card", r.id) }))
      },
    },
    {
      key: "ooh-reservations",
      createSkill: "agency-ooh-inventory",
      columns: [
        { id: "face", header: "modules.columns.face", kind: "link", hrefKey: "href", subKey: "site" },
        jobCol,
        { id: "dates", header: "modules.columns.dates", kind: "text" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx
          .select({ r: oohReservation, faceKey: oohFace.faceKey, site: oohFace.site, format: oohFace.format })
          .from(oohReservation)
          .leftJoin(oohFace, and(eq(oohFace.tenantId, oohReservation.tenantId), eq(oohFace.id, oohReservation.faceId)))
          .where(eq(oohReservation.tenantId, ctx.tenant.id))
          .orderBy(desc(oohReservation.startDate))
        const j = await jobs(tx, ctx)
        return rows.map(({ r, faceKey, site, format }) => ({ id: r.id, face: faceKey ?? "—", site: `${site ?? ""} · ${format ?? ""}`, ...jobCells(ctx, j, r.jobId, "media"), dates: `${r.startDate} → ${r.endDate}`, state: r.state, href: rec(ctx, "ooh-reservation", r.id) }))
      },
    },
  ],
  "suppliers-payments": [
    {
      key: "supplier-bills",
      createSkill: "agency-payables",
      columns: [
        { id: "invoiceNumber", header: "modules.columns.invoice", kind: "link", hrefKey: "href", subKey: "supplierName" },
        jobCol,
        { id: "dueDate", header: "modules.columns.due", kind: "date" },
        { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "paidMinor", header: "modules.columns.paid", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(supplierInvoice).where(eq(supplierInvoice.tenantId, ctx.tenant.id)).orderBy(desc(supplierInvoice.createdAt))
        const s = await suppliers(tx, ctx)
        const j = await jobs(tx, ctx)
        return rows.map((b) => ({ id: b.id, invoiceNumber: b.invoiceNumber, supplierName: s.get(b.supplierId) ?? "—", ...jobCells(ctx, j, b.jobId, "finance"), dueDate: b.dueDate, amountMinor: minorStr(b.amountMinor), paidMinor: minorStr(b.paidMinor), currency: b.currency, state: b.state, href: rec(ctx, "supplier-bill", b.id) }))
      },
    },
    {
      key: "payment-runs",
      createSkill: "agency-payment-run",
      columns: [
        { id: "reference", header: "modules.columns.reference", kind: "link", hrefKey: "href", subKey: "method" },
        { id: "paymentDate", header: "modules.columns.date", kind: "date" },
        { id: "totalMinor", header: "modules.columns.total", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(paymentBatch).where(eq(paymentBatch.tenantId, ctx.tenant.id)).orderBy(desc(paymentBatch.createdAt))
        return rows.map((b) => ({ id: b.id, reference: b.reference, method: b.paymentMethod, paymentDate: b.paymentDate, totalMinor: minorStr(b.totalMinor), currency: b.currency, state: b.state, href: rec(ctx, "payment-run", b.id) }))
      },
    },
    {
      key: "expenses",
      createSkill: "agency-expenses",
      columns: [
        { id: "description", header: "modules.columns.expense", kind: "link", hrefKey: "href", subKey: "category" },
        jobCol,
        { id: "expenseDate", header: "modules.columns.date", kind: "date" },
        { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(expense).where(eq(expense.tenantId, ctx.tenant.id)).orderBy(desc(expense.createdAt))
        const j = await jobs(tx, ctx)
        return rows.map((e) => ({ id: e.id, description: e.description || e.category, category: e.category, ...jobCells(ctx, j, e.jobId, "finance"), expenseDate: e.expenseDate, amountMinor: minorStr(e.amountMinor), currency: e.currency, state: e.state, href: rec(ctx, "expense", e.id) }))
      },
    },
  ],
  "billing-collections": [
    {
      key: "invoices",
      createSkill: "agency-client-billing",
      columns: [
        { id: "number", header: "modules.columns.invoice", kind: "link", hrefKey: "href", subKey: "clientName" },
        jobCol,
        { id: "dueDate", header: "modules.columns.due", kind: "date" },
        { id: "feeMinor", header: "modules.columns.fee", kind: "money", align: "end" },
        { id: "mediaRecoveryMinor", header: "modules.columns.managedMedia", kind: "money", align: "end" },
        { id: "grossMinor", header: "modules.columns.gross", kind: "money", align: "end" },
        { id: "collectedMinor", header: "modules.columns.collected", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(clientInvoice).where(eq(clientInvoice.tenantId, ctx.tenant.id)).orderBy(desc(clientInvoice.createdAt))
        const clients = new Map((await tx.select({ id: client.id, name: client.name }).from(client).where(eq(client.tenantId, ctx.tenant.id))).map((c) => [c.id, c.name]))
        const j = await jobs(tx, ctx)
        return rows.map((i) => ({ id: i.id, number: i.number ?? i.id.slice(0, 8), clientName: clients.get(i.clientId) ?? "—", ...jobCells(ctx, j, i.jobId, "finance"), dueDate: i.dueDate, feeMinor: minorStr(i.feeMinor), mediaRecoveryMinor: minorStr(i.mediaRecoveryMinor), grossMinor: minorStr(i.grossMinor), collectedMinor: minorStr(i.collectedMinor), currency: i.currency, state: i.state, href: rec(ctx, "client-invoice", i.id) }))
      },
    },
    {
      key: "receipts",
      createSkill: "agency-collections",
      columns: [
        { id: "reference", header: "modules.columns.reference", kind: "link", hrefKey: "href", subKey: "provider" },
        { id: "receiptDate", header: "modules.columns.date", kind: "date" },
        { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "allocatedMinor", header: "modules.columns.allocated", kind: "money", align: "end" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(collection).where(eq(collection.tenantId, ctx.tenant.id)).orderBy(desc(collection.receiptDate))
        return rows.map((c) => ({ id: c.id, reference: c.providerReceiptId ?? c.id.slice(0, 8), provider: c.provider ?? "", receiptDate: c.receiptDate, amountMinor: minorStr(c.amountMinor), allocatedMinor: minorStr(c.allocatedMinor), currency: c.currency, href: rec(ctx, "receipt", c.id) }))
      },
    },
  ],
  "accounting-close": [
    {
      key: "journals",
      createSkill: "agency-general-ledger",
      columns: [
        { id: "entryKey", header: "modules.columns.entry", kind: "link", hrefKey: "href", subKey: "memo" },
        { id: "period", header: "modules.columns.period", kind: "mono" },
        { id: "businessDate", header: "modules.columns.date", kind: "date" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(journalEntry).where(eq(journalEntry.tenantId, ctx.tenant.id)).orderBy(desc(journalEntry.seq)).limit(500)
        return rows.map((j) => ({ id: j.id, entryKey: j.entryKey, memo: j.memo ?? j.ruleKey, period: j.period, businessDate: j.businessDate, state: j.state, href: rec(ctx, "journal", j.id) }))
      },
    },
    {
      key: "periods",
      createSkill: "agency-period-close",
      columns: [
        { id: "period", header: "modules.columns.period", kind: "link", hrefKey: "href" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
        { id: "closedAt", header: "modules.columns.closed", kind: "timestamp" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(accountingPeriod).where(eq(accountingPeriod.tenantId, ctx.tenant.id)).orderBy(desc(accountingPeriod.period))
        return rows.map((p) => ({ id: p.id, period: p.period, state: p.state, closedAt: iso(p.closedAt), href: rec(ctx, "period-close", p.id) }))
      },
    },
    {
      key: "fixed-assets",
      createSkill: "agency-fixed-assets",
      columns: [
        { id: "name", header: "modules.columns.name", kind: "link", hrefKey: "href", subKey: "method" },
        { id: "startDate", header: "modules.columns.date", kind: "date" },
        { id: "costMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(fixedAsset).where(eq(fixedAsset.tenantId, ctx.tenant.id)).orderBy(asc(fixedAsset.name))
        return rows.map((a) => ({ id: a.id, name: a.name, method: `${a.method} · ${a.lifeMonths}m`, startDate: a.startDate, costMinor: minorStr(a.costMinor), currency: a.currency, state: a.state, href: rec(ctx, "fixed-asset", a.id) }))
      },
    },
  ],
  profitability: [
    {
      key: "revenue-budgets",
      createSkill: "agency-revenue-budget",
      columns: [
        { id: "scenario", header: "modules.columns.scenario", kind: "text", subKey: "range" },
        { id: "version", header: "modules.columns.revision", kind: "number", align: "end" },
        { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(revenueBudgetVersion).where(eq(revenueBudgetVersion.tenantId, ctx.tenant.id)).orderBy(desc(revenueBudgetVersion.createdAt))
        return rows.map((r) => ({ id: r.id, scenario: r.scenarioName, range: `${r.periodFrom} → ${r.periodTo} · ${r.allocationDriver}`, version: r.versionNumber, amountMinor: minorStr(r.amountMinor), currency: r.currency, state: r.state }))
      },
    },
    {
      key: "management-reports",
      createSkill: "agency-management-reporting",
      columns: [
        { id: "title", header: "modules.columns.report", kind: "link", hrefKey: "href", subKey: "basis" },
        { id: "period", header: "modules.columns.period", kind: "mono" },
        { id: "cutOff", header: "modules.columns.cutOff", kind: "date" },
        { id: "createdAt", header: "modules.columns.created", kind: "timestamp" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(managementReport).where(eq(managementReport.tenantId, ctx.tenant.id)).orderBy(desc(managementReport.createdAt))
        return rows.map((r) => ({ id: r.id, title: r.title, basis: `${r.basis} · ${r.currency}`, period: r.period, cutOff: r.cutOff, createdAt: iso(r.createdAt), href: `${base(ctx)}/reports/${r.id}` }))
      },
    },
  ],
}

/** Desk view order per module (first = default view). */
export const VIEW_ORDER: Record<string, string[]> = {
  setup: ["configuration", "team", "master-data"],
  "clients-contracts": ["clients", "contracts", "budgets", "evidence"],
  "work-production": ["timesheets", "estimates", "deliverables", "production-orders"],
  "media-planning": ["plans", "plan-lines", "broadcast"],
  "media-buying": ["media-orders", "campaigns", "rate-cards", "ooh-reservations", "deliveries", "accounts"],
  "suppliers-payments": ["orders", "supplier-bills", "payment-runs", "expenses", "deliveries", "suppliers"],
  "billing-collections": ["invoices", "receipts", "billable-jobs", "client-authority"],
  "accounting-close": ["journals", "periods", "fixed-assets", "entities", "commitments"],
  profitability: ["margin", "losing-margin", "revenue-budgets", "management-reports"],
}
