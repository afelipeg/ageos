import "server-only"

import { and, asc, desc, eq, inArray } from "drizzle-orm"

import type { GridColumn, GridRow } from "@/components/app/record-grid"
import { MARGIN_FLOOR_BPS } from "@/lib/demo"
import { ROLE_PERMISSIONS, type Role } from "@/lib/policy"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import {
  appUser,
  budgetRevision,
  client,
  configurationRevision,
  connection,
  contract,
  costEstimate,
  delivery,
  job,
  legalEntity,
  mediaPlanLine,
  mediaPlanRevision,
  membership,
  purchaseOrder,
  supplier,
  timesheet,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { computeProfitability, estimateTotals, loadJobFinancials } from "@/server/domain/profitability"

import { getCatalog, moduleDefinition, type CatalogEntry } from "./catalog"
import { EXTRA_VIEWS, VIEW_ORDER } from "./modules-ops"
import { iso, matchesTerm, minorStr, userNames } from "./shared"

// Module desks: one read-only projection per canonical module, built from the
// same tables the dossier, workbenches and assistant use. Each desk exposes a
// small allowlist of views (?view=); rows link to the authorized record detail.
// Columns are serializable specs rendered by the shared RecordGrid.

export type DeskView = {
  key: string
  /** i18n key under modules.views.* */
  labelKey: string
  descriptionKey: string
  columns: GridColumn[]
  rows: GridRow[]
  /** Capability that creates records of this view (link to its workbench). */
  createSkill?: string
  rowHrefKey?: string
}

type ViewDef = {
  key: string
  columns: GridColumn[]
  createSkill?: string
  load: (tx: Tx, ctx: AgencyContext) => Promise<GridRow[]>
}

const base = (ctx: AgencyContext) => `/a/${ctx.tenant.slug}`
const rec = (ctx: AgencyContext, type: string, id: string) => `${base(ctx)}/records/${type}/${id}`

async function jobIndex(tx: Tx, ctx: AgencyContext) {
  const rows = await tx
    .select({ id: job.id, name: job.name, ref: job.displayReference, number: job.jobNumber, currency: job.currency, clientId: job.clientId, state: job.state, reportingGroup: job.reportingGroup })
    .from(job)
    .where(eq(job.tenantId, ctx.tenant.id))
  return new Map(rows.map((r) => [r.id, r]))
}

async function clientIndex(tx: Tx, ctx: AgencyContext) {
  const rows = await tx.select({ id: client.id, name: client.name, code: client.code }).from(client).where(eq(client.tenantId, ctx.tenant.id))
  return new Map(rows.map((r) => [r.id, r]))
}

async function supplierIndex(tx: Tx, ctx: AgencyContext) {
  const rows = await tx.select({ id: supplier.id, name: supplier.name }).from(supplier).where(eq(supplier.tenantId, ctx.tenant.id))
  return new Map(rows.map((r) => [r.id, r]))
}

const jobCols: GridColumn[] = [{ id: "jobName", header: "modules.columns.job", kind: "link", hrefKey: "jobHref", subKey: "jobRef" }]

// ── View definitions per module ──

const VIEWS: Record<string, ViewDef[]> = {
  setup: [
    {
      key: "configuration",
      columns: [
        { id: "label", header: "modules.columns.revision", kind: "link", hrefKey: "href", subKey: "schemaVersion" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
        { id: "enabledCount", header: "modules.columns.enabledCapabilities", kind: "number", align: "end" },
        { id: "published", header: "modules.columns.published", kind: "state", labelPrefix: "modules.published" },
        { id: "updatedAt", header: "modules.columns.updated", kind: "timestamp" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx
          .select()
          .from(configurationRevision)
          .where(eq(configurationRevision.tenantId, ctx.tenant.id))
          .orderBy(desc(configurationRevision.number))
        return rows.map((r) => ({
          id: r.id,
          label: `r${r.number}`,
          schemaVersion: r.schemaVersion,
          state: r.state,
          enabledCount: r.enabledCapabilities.length,
          published: r.id === ctx.tenant.publishedConfigRevisionId ? "yes" : "no",
          updatedAt: iso(r.updatedAt),
          href: rec(ctx, "configuration-revision", r.id),
        }))
      },
    },
    {
      key: "team",
      createSkill: "agency-access-governance",
      columns: [
        { id: "name", header: "modules.columns.member", kind: "text", subKey: "email" },
        { id: "role", header: "modules.columns.role", kind: "state", labelPrefix: "header.roles" },
        { id: "permissionCount", header: "modules.columns.permissions", kind: "number", align: "end" },
        { id: "status", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx
          .select({ id: membership.id, role: membership.role, active: membership.active, name: appUser.displayName, email: appUser.email })
          .from(membership)
          .innerJoin(appUser, eq(appUser.id, membership.userId))
          .where(eq(membership.tenantId, ctx.tenant.id))
          .orderBy(asc(appUser.displayName))
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role,
          permissionCount: (ROLE_PERMISSIONS[r.role as Role] ?? []).length,
          status: r.active ? "active" : "archived",
        }))
      },
    },
    {
      key: "master-data",
      createSkill: "agency-master-data",
      columns: [
        { id: "name", header: "modules.columns.name", kind: "link", hrefKey: "href" },
        { id: "kind", header: "modules.columns.kind", kind: "state", labelPrefix: "modules.kinds" },
        { id: "code", header: "modules.columns.code", kind: "mono" },
        { id: "country", header: "modules.columns.country", kind: "text" },
        { id: "currencyCode", header: "modules.columns.currency", kind: "mono" },
      ],
      load: async (tx, ctx) => {
        const clients = await tx.select().from(client).where(eq(client.tenantId, ctx.tenant.id)).orderBy(asc(client.name))
        const suppliers = await tx.select().from(supplier).where(eq(supplier.tenantId, ctx.tenant.id)).orderBy(asc(supplier.name))
        const entities = await tx.select().from(legalEntity).where(eq(legalEntity.tenantId, ctx.tenant.id)).orderBy(asc(legalEntity.name))
        return [
          ...clients.map((c) => ({ id: `client:${c.id}`, name: c.name, kind: "client", code: c.code, country: c.country, currencyCode: c.billingCurrency, href: `${base(ctx)}/clients/${c.id}` })),
          ...suppliers.map((s) => ({ id: `supplier:${s.id}`, name: s.name, kind: "supplier", code: "—", country: s.country, currencyCode: s.currency, href: rec(ctx, "supplier", s.id) })),
          ...entities.map((e) => ({ id: `entity:${e.id}`, name: e.name, kind: "legal_entity", code: e.fiscalProfileId, country: e.country, currencyCode: e.currency, href: rec(ctx, "legal-entity", e.id) })),
        ]
      },
    },
  ],
  "clients-contracts": [
    {
      key: "clients",
      createSkill: "agency-onboarding",
      columns: [
        { id: "name", header: "modules.columns.client", kind: "link", hrefKey: "href", subKey: "code" },
        { id: "country", header: "modules.columns.country", kind: "text" },
        { id: "creditLimitMinor", header: "modules.columns.creditLimit", kind: "money", align: "end" },
        { id: "jobCount", header: "modules.columns.jobs", kind: "number", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const clients = await tx.select().from(client).where(eq(client.tenantId, ctx.tenant.id)).orderBy(asc(client.name))
        const jobs = await tx.select({ clientId: job.clientId }).from(job).where(eq(job.tenantId, ctx.tenant.id))
        return clients.map((c) => ({
          id: c.id,
          name: c.name,
          code: `${c.code}-${c.productCode} · ${c.billingCurrency}`,
          country: c.country,
          creditLimitMinor: minorStr(c.creditLimitMinor),
          currency: c.billingCurrency,
          jobCount: jobs.filter((j) => j.clientId === c.id).length,
          state: c.state,
          href: `${base(ctx)}/clients/${c.id}`,
        }))
      },
    },
    {
      key: "contracts",
      createSkill: "agency-contract-po",
      columns: [
        { id: "reference", header: "modules.columns.reference", kind: "link", hrefKey: "href" },
        { id: "kind", header: "modules.columns.kind", kind: "state", labelPrefix: "modules.kinds" },
        ...jobCols,
        { id: "revisionNumber", header: "modules.columns.revision", kind: "number", align: "end" },
        { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(contract).where(eq(contract.tenantId, ctx.tenant.id)).orderBy(desc(contract.createdAt))
        const jobs = await jobIndex(tx, ctx)
        return rows.map((c) => {
          const j = c.jobId ? jobs.get(c.jobId) : undefined
          return {
            id: c.id,
            reference: c.reference,
            kind: c.kind,
            jobName: j?.name ?? "—",
            jobRef: j?.ref ?? "",
            jobHref: j ? `${base(ctx)}/jobs/${j.id}` : `${base(ctx)}/jobs`,
            revisionNumber: c.revisionNumber,
            amountMinor: minorStr(c.amountMinor),
            currency: c.currency,
            state: c.state,
            href: rec(ctx, "contract", c.id),
          }
        })
      },
    },
    {
      key: "budgets",
      createSkill: "agency-fee-contracts",
      columns: [
        { id: "label", header: "modules.columns.revision", kind: "link", hrefKey: "href" },
        ...jobCols,
        { id: "agencyFeeMinor", header: "modules.columns.fee", kind: "money", align: "end" },
        { id: "managedMediaMinor", header: "modules.columns.managedMedia", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(budgetRevision).where(eq(budgetRevision.tenantId, ctx.tenant.id)).orderBy(desc(budgetRevision.createdAt))
        const jobs = await jobIndex(tx, ctx)
        return rows.map((b) => {
          const j = jobs.get(b.jobId)
          return {
            id: b.id,
            label: `r${b.number}`,
            jobName: j?.name ?? "—",
            jobRef: j?.ref ?? "",
            jobHref: j ? `${base(ctx)}/jobs/${j.id}` : `${base(ctx)}/jobs`,
            agencyFeeMinor: minorStr(b.agencyFeeMinor),
            managedMediaMinor: minorStr(b.managedMediaMinor),
            currency: b.currency,
            state: b.state,
            href: rec(ctx, "budget-revision", b.id),
          }
        })
      },
    },
  ],
  "work-production": [
    {
      key: "timesheets",
      createSkill: "agency-tasks-timesheets",
      columns: [
        { id: "taskLabel", header: "modules.columns.task", kind: "link", hrefKey: "href", subKey: "person" },
        ...jobCols,
        { id: "workDate", header: "modules.columns.date", kind: "date" },
        { id: "hours", header: "modules.columns.hours", kind: "text", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(timesheet).where(eq(timesheet.tenantId, ctx.tenant.id)).orderBy(desc(timesheet.workDate))
        const jobs = await jobIndex(tx, ctx)
        const names = await userNames(tx, rows.map((r) => r.userId))
        return rows.map((t) => {
          const j = jobs.get(t.jobId)
          return {
            id: t.id,
            taskLabel: t.taskLabel,
            person: t.userId ? (names.get(t.userId) ?? "—") : "—",
            jobName: j?.name ?? "—",
            jobRef: j?.ref ?? "",
            jobHref: j ? `${base(ctx)}/jobs/${j.id}?tab=production` : `${base(ctx)}/jobs`,
            workDate: t.workDate,
            hours: `${(t.minutes / 60).toFixed(t.minutes % 60 === 0 ? 0 : 1)} h`,
            state: t.state,
            href: rec(ctx, "timesheet", t.id),
          }
        })
      },
    },
    {
      key: "estimates",
      createSkill: "agency-production-estimating",
      columns: [
        { id: "label", header: "modules.columns.revision", kind: "link", hrefKey: "href", subKey: "reason" },
        ...jobCols,
        { id: "totalMinor", header: "modules.columns.total", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
        { id: "createdAt", header: "modules.columns.created", kind: "timestamp" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(costEstimate).where(eq(costEstimate.tenantId, ctx.tenant.id)).orderBy(desc(costEstimate.createdAt))
        const jobs = await jobIndex(tx, ctx)
        const out: GridRow[] = []
        // Totals come from the profitability domain (same as the dossier).
        const finByJob = new Map<string, Awaited<ReturnType<typeof loadJobFinancials>>>()
        for (const e of rows) {
          if (!finByJob.has(e.jobId)) finByJob.set(e.jobId, await loadJobFinancials(tx, ctx.tenant.id, e.jobId))
          const fin = finByJob.get(e.jobId)!
          const j = jobs.get(e.jobId)
          out.push({
            id: e.id,
            label: `r${e.number}`,
            reason: e.reason ?? "",
            jobName: j?.name ?? "—",
            jobRef: j?.ref ?? "",
            jobHref: j ? `${base(ctx)}/jobs/${j.id}?tab=production` : `${base(ctx)}/jobs`,
            totalMinor: minorStr(estimateTotals(fin, e.id).totalMinor),
            currency: e.currency,
            state: e.state,
            createdAt: iso(e.createdAt),
            href: rec(ctx, "estimate", e.id),
          })
        }
        return out
      },
    },
    {
      key: "production-orders",
      createSkill: "agency-production",
      columns: [
        { id: "reference", header: "modules.columns.reference", kind: "link", hrefKey: "href", subKey: "supplierName" },
        ...jobCols,
        { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: (tx, ctx) => ordersView(tx, ctx, "production"),
    },
  ],
  "media-planning": [
    {
      key: "plans",
      createSkill: "agency-media-planning",
      columns: [
        { id: "label", header: "modules.columns.revision", kind: "link", hrefKey: "href", subKey: "objective" },
        ...jobCols,
        { id: "lineCount", header: "modules.columns.lines", kind: "number", align: "end" },
        { id: "totalMinor", header: "modules.columns.total", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const plans = await tx.select().from(mediaPlanRevision).where(eq(mediaPlanRevision.tenantId, ctx.tenant.id)).orderBy(desc(mediaPlanRevision.createdAt))
        const lines = plans.length
          ? await tx.select({ planRevisionId: mediaPlanLine.planRevisionId }).from(mediaPlanLine).where(and(eq(mediaPlanLine.tenantId, ctx.tenant.id), inArray(mediaPlanLine.planRevisionId, plans.map((p) => p.id))))
          : []
        const jobs = await jobIndex(tx, ctx)
        return plans.map((p) => {
          const j = jobs.get(p.jobId)
          return {
            id: p.id,
            label: `r${p.number}`,
            objective: p.objective,
            jobName: j?.name ?? "—",
            jobRef: j?.ref ?? "",
            jobHref: j ? `${base(ctx)}/jobs/${j.id}?tab=media` : `${base(ctx)}/jobs`,
            lineCount: lines.filter((l) => l.planRevisionId === p.id).length,
            totalMinor: minorStr(p.totalMinor),
            currency: p.currency,
            state: p.state,
            href: rec(ctx, "media-plan", p.id),
          }
        })
      },
    },
    {
      key: "plan-lines",
      createSkill: "agency-plan-changes",
      columns: [
        { id: "placement", header: "modules.columns.placement", kind: "link", hrefKey: "href", subKey: "channel" },
        { id: "provider", header: "modules.columns.provider", kind: "mono", subKey: "account" },
        { id: "dates", header: "modules.columns.dates", kind: "text" },
        { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "simulation", header: "modules.columns.source", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx
          .select({ line: mediaPlanLine, planNumber: mediaPlanRevision.number })
          .from(mediaPlanLine)
          .innerJoin(mediaPlanRevision, and(eq(mediaPlanRevision.tenantId, mediaPlanLine.tenantId), eq(mediaPlanRevision.id, mediaPlanLine.planRevisionId)))
          .where(eq(mediaPlanLine.tenantId, ctx.tenant.id))
          .orderBy(desc(mediaPlanRevision.number), asc(mediaPlanLine.lineKey))
        return rows.map(({ line: l, planNumber }) => ({
          id: l.id,
          placement: l.placement,
          channel: `${l.channel} · r${planNumber} · ${l.lineKey}`,
          provider: l.provider,
          account: l.accountAlias ?? "",
          dates: `${l.startDate} → ${l.endDate}`,
          amountMinor: minorStr(l.amountMinor),
          currency: l.currency,
          simulation: l.simulation,
          href: rec(ctx, "media-plan", l.planRevisionId),
        }))
      },
    },
  ],
  "media-buying": [
    {
      key: "media-orders",
      createSkill: "agency-media-buying",
      columns: [
        { id: "reference", header: "modules.columns.reference", kind: "link", hrefKey: "href", subKey: "account" },
        ...jobCols,
        { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: (tx, ctx) => ordersView(tx, ctx, "media"),
    },
    {
      key: "deliveries",
      createSkill: "agency-transmission-control",
      columns: [
        { id: "label", header: "modules.columns.delivery", kind: "link", hrefKey: "href", subKey: "orderRef" },
        { id: "businessDate", header: "modules.columns.date", kind: "date" },
        { id: "acceptedMinor", header: "modules.columns.accepted", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: (tx, ctx) => deliveriesView(tx, ctx, "media"),
    },
    {
      key: "accounts",
      createSkill: "agency-integrations",
      columns: [
        { id: "provider", header: "modules.columns.provider", kind: "link", hrefKey: "href", subKey: "account" },
        { id: "category", header: "modules.columns.category", kind: "text" },
        { id: "scopes", header: "modules.columns.scopes", kind: "tags" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(connection).where(eq(connection.tenantId, ctx.tenant.id)).orderBy(asc(connection.provider))
        return rows
          .filter((c) => c.category === "ads")
          .map((c) => ({ id: c.id, provider: c.provider, account: c.accountAlias, category: c.category, scopes: c.scopes, state: c.state, href: `${base(ctx)}/connections/${c.id}` }))
      },
    },
  ],
  "suppliers-payments": [
    {
      key: "suppliers",
      createSkill: "agency-master-data",
      columns: [
        { id: "name", header: "modules.columns.supplier", kind: "link", hrefKey: "href" },
        { id: "country", header: "modules.columns.country", kind: "text" },
        { id: "currencyCode", header: "modules.columns.currency", kind: "mono" },
        { id: "orderCount", header: "modules.columns.orders", kind: "number", align: "end" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(supplier).where(eq(supplier.tenantId, ctx.tenant.id)).orderBy(asc(supplier.name))
        const orders = await tx.select({ supplierId: purchaseOrder.supplierId }).from(purchaseOrder).where(eq(purchaseOrder.tenantId, ctx.tenant.id))
        return rows.map((s) => ({
          id: s.id,
          name: s.name,
          country: s.country,
          currencyCode: s.currency,
          orderCount: orders.filter((o) => o.supplierId === s.id).length,
          href: rec(ctx, "supplier", s.id),
        }))
      },
    },
    {
      key: "orders",
      createSkill: "agency-delivery-reconciliation",
      columns: [
        { id: "reference", header: "modules.columns.reference", kind: "link", hrefKey: "href", subKey: "supplierName" },
        { id: "kind", header: "modules.columns.kind", kind: "state", labelPrefix: "modules.kinds" },
        ...jobCols,
        { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: (tx, ctx) => ordersView(tx, ctx, null),
    },
    {
      key: "deliveries",
      createSkill: "agency-delivery-reconciliation",
      columns: [
        { id: "label", header: "modules.columns.delivery", kind: "link", hrefKey: "href", subKey: "orderRef" },
        { id: "businessDate", header: "modules.columns.date", kind: "date" },
        { id: "acceptedMinor", header: "modules.columns.accepted", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: (tx, ctx) => deliveriesView(tx, ctx, null),
    },
  ],
  "billing-collections": [
    {
      key: "billable-jobs",
      createSkill: "agency-client-billing",
      columns: [
        { id: "jobName", header: "modules.columns.job", kind: "link", hrefKey: "jobHref", subKey: "jobRef" },
        { id: "clientName", header: "modules.columns.client", kind: "text" },
        { id: "agencyFeeMinor", header: "modules.columns.fee", kind: "money", align: "end" },
        { id: "managedMediaMinor", header: "modules.columns.managedMedia", kind: "money", align: "end" },
        { id: "authorityMinor", header: "modules.columns.clientAuthority", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const jobs = await tx.select().from(job).where(eq(job.tenantId, ctx.tenant.id)).orderBy(asc(job.displayReference))
        const clients = await clientIndex(tx, ctx)
        const out: GridRow[] = []
        for (const j of jobs) {
          const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
          out.push({
            id: j.id,
            jobName: j.name,
            jobRef: `${j.displayReference} · ${j.jobNumber}`,
            jobHref: `${base(ctx)}/jobs/${j.id}?tab=finance`,
            clientName: clients.get(j.clientId)?.name ?? "—",
            agencyFeeMinor: minorStr(fin.approvedBudget?.agencyFeeMinor ?? null),
            managedMediaMinor: minorStr(fin.approvedBudget?.managedMediaMinor ?? null),
            authorityMinor: minorStr(fin.approvedAuthority?.amountMinor ?? null),
            currency: j.currency,
            state: j.state,
          })
        }
        return out
      },
    },
    {
      key: "client-authority",
      createSkill: "agency-billing-requirements",
      columns: [
        { id: "reference", header: "modules.columns.reference", kind: "link", hrefKey: "href", subKey: "kindLabel" },
        ...jobCols,
        { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "validity", header: "modules.columns.validity", kind: "text" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(contract).where(and(eq(contract.tenantId, ctx.tenant.id), eq(contract.kind, "client_po"))).orderBy(desc(contract.createdAt))
        const jobs = await jobIndex(tx, ctx)
        return rows.map((c) => {
          const j = c.jobId ? jobs.get(c.jobId) : undefined
          return {
            id: c.id,
            reference: c.reference,
            kindLabel: `r${c.revisionNumber}`,
            jobName: j?.name ?? "—",
            jobRef: j?.ref ?? "",
            jobHref: j ? `${base(ctx)}/jobs/${j.id}?tab=scope` : `${base(ctx)}/jobs`,
            amountMinor: minorStr(c.amountMinor),
            currency: c.currency,
            validity: c.validFrom || c.validTo ? `${c.validFrom ?? "…"} → ${c.validTo ?? "…"}` : "—",
            state: c.state,
            href: rec(ctx, "contract", c.id),
          }
        })
      },
    },
  ],
  "accounting-close": [
    {
      key: "entities",
      createSkill: "agency-general-ledger",
      columns: [
        { id: "name", header: "modules.columns.entity", kind: "link", hrefKey: "href" },
        { id: "country", header: "modules.columns.country", kind: "text" },
        { id: "currencyCode", header: "modules.columns.currency", kind: "mono" },
        { id: "fiscalProfileId", header: "modules.columns.fiscalProfile", kind: "mono" },
      ],
      load: async (tx, ctx) => {
        const rows = await tx.select().from(legalEntity).where(eq(legalEntity.tenantId, ctx.tenant.id)).orderBy(asc(legalEntity.name))
        return rows.map((e) => ({ id: e.id, name: e.name, country: e.country, currencyCode: e.currency, fiscalProfileId: e.fiscalProfileId, href: rec(ctx, "legal-entity", e.id) }))
      },
    },
    {
      key: "commitments",
      createSkill: "agency-accruals-revaluation",
      columns: [
        { id: "reference", header: "modules.columns.reference", kind: "link", hrefKey: "href", subKey: "supplierName" },
        { id: "kind", header: "modules.columns.kind", kind: "state", labelPrefix: "modules.kinds" },
        ...jobCols,
        { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
        { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
      ],
      load: (tx, ctx) => ordersView(tx, ctx, null),
    },
  ],
  profitability: [
    {
      key: "margin",
      createSkill: "agency-profitability",
      columns: [
        { id: "jobName", header: "modules.columns.job", kind: "link", hrefKey: "jobHref", subKey: "jobRef" },
        { id: "clientName", header: "modules.columns.client", kind: "text" },
        { id: "agencyFeeMinor", header: "modules.columns.fee", kind: "money", align: "end" },
        { id: "costMinor", header: "modules.columns.projectedCost", kind: "money", align: "end" },
        { id: "marginMinor", header: "modules.columns.margin", kind: "money", align: "end" },
        { id: "marginBps", header: "modules.columns.marginPct", kind: "bps", align: "end" },
        { id: "managedMediaMinor", header: "modules.columns.managedMedia", kind: "money", align: "end" },
      ],
      load: (tx, ctx) => marginRows(tx, ctx, false),
    },
    {
      key: "losing-margin",
      createSkill: "agency-profitability",
      columns: [
        { id: "jobName", header: "modules.columns.job", kind: "link", hrefKey: "jobHref", subKey: "jobRef" },
        { id: "clientName", header: "modules.columns.client", kind: "text" },
        { id: "marginBps", header: "modules.columns.marginPct", kind: "bps", align: "end" },
        { id: "floorBps", header: "modules.columns.floor", kind: "bps", align: "end" },
        { id: "marginMinor", header: "modules.columns.margin", kind: "money", align: "end" },
      ],
      load: (tx, ctx) => marginRows(tx, ctx, true),
    },
  ],
}

async function ordersView(tx: Tx, ctx: AgencyContext, kind: "production" | "media" | null): Promise<GridRow[]> {
  const where = kind ? and(eq(purchaseOrder.tenantId, ctx.tenant.id), eq(purchaseOrder.kind, kind)) : eq(purchaseOrder.tenantId, ctx.tenant.id)
  const rows = await tx.select().from(purchaseOrder).where(where).orderBy(desc(purchaseOrder.createdAt))
  const jobs = await jobIndex(tx, ctx)
  const suppliers = await supplierIndex(tx, ctx)
  return rows.map((o) => {
    const j = jobs.get(o.jobId)
    return {
      id: o.id,
      reference: o.reference,
      kind: o.kind,
      supplierName: o.supplierId ? (suppliers.get(o.supplierId)?.name ?? "—") : o.provider ? `${o.provider}` : "—",
      account: o.accountAlias ? `${o.provider ?? ""} · ${o.accountAlias}` : (o.provider ?? ""),
      jobName: j?.name ?? "—",
      jobRef: j?.ref ?? "",
      jobHref: j ? `${base(ctx)}/jobs/${j.id}` : `${base(ctx)}/jobs`,
      amountMinor: minorStr(o.amountMinor),
      currency: o.currency,
      state: o.state,
      href: rec(ctx, "purchase-order", o.id),
    }
  })
}

async function deliveriesView(tx: Tx, ctx: AgencyContext, kind: "production" | "media" | null): Promise<GridRow[]> {
  const rows = await tx
    .select({ d: delivery, ref: purchaseOrder.reference, kind: purchaseOrder.kind })
    .from(delivery)
    .innerJoin(purchaseOrder, and(eq(purchaseOrder.tenantId, delivery.tenantId), eq(purchaseOrder.id, delivery.orderId)))
    .where(kind ? and(eq(delivery.tenantId, ctx.tenant.id), eq(purchaseOrder.kind, kind)) : eq(delivery.tenantId, ctx.tenant.id))
    .orderBy(desc(delivery.businessDate))
  return rows.map(({ d, ref, kind: k }) => ({
    id: d.id,
    label: `${ref} · ${d.businessDate}`,
    orderRef: `${ref} · ${k}`,
    businessDate: d.businessDate,
    acceptedMinor: minorStr(d.acceptedMinor),
    currency: d.currency,
    state: d.state,
    href: rec(ctx, "delivery", d.id),
  }))
}

async function marginRows(tx: Tx, ctx: AgencyContext, onlyLosing: boolean): Promise<GridRow[]> {
  const jobs = await tx.select().from(job).where(eq(job.tenantId, ctx.tenant.id)).orderBy(asc(job.displayReference))
  const clients = await clientIndex(tx, ctx)
  const out: GridRow[] = []
  for (const j of jobs) {
    const p = computeProfitability(await loadJobFinancials(tx, ctx.tenant.id, j.id), "forecast", ctx.tenant.slug)
    const losing = p.marginBps !== null && p.marginBps < MARGIN_FLOOR_BPS
    if (onlyLosing && !losing) continue
    out.push({
      id: j.id,
      jobName: j.name,
      jobRef: `${j.displayReference} · ${j.jobNumber}${j.reportingGroup !== "primary" ? ` · ${j.reportingGroup}` : ""}`,
      jobHref: `${base(ctx)}/jobs/${j.id}?tab=finance`,
      clientName: clients.get(j.clientId)?.name ?? "—",
      agencyFeeMinor: minorStr(p.agencyFeeMinor),
      costMinor: minorStr(p.agencyCost.totalMinor),
      marginMinor: minorStr(p.marginMinor),
      marginBps: p.marginBps,
      floorBps: MARGIN_FLOOR_BPS,
      managedMediaMinor: minorStr(p.managedMediaMinor),
      currency: p.currency,
    })
  }
  return out
}

function viewsOf(moduleKey: string): ViewDef[] {
  const all = [...(VIEWS[moduleKey] ?? []), ...(EXTRA_VIEWS[moduleKey] ?? [])]
  const order = VIEW_ORDER[moduleKey]
  if (!order) return all
  return order.map((k) => all.find((v) => v.key === k)).filter((v): v is ViewDef => Boolean(v))
}

export const DESK_MODULE_KEYS = Object.keys(VIEWS)

export function deskViewKeys(moduleKey: string): string[] {
  return viewsOf(moduleKey).map((v) => v.key)
}

export type ModuleDesk = {
  module: NonNullable<ReturnType<typeof moduleDefinition>>
  views: { key: string; labelKey: string }[]
  active: DeskView
  capabilities: CatalogEntry[]
  q: string
  page: number
  pageSize: number
  totalRows: number
}

export async function getModuleDesk(
  ctx: AgencyContext,
  moduleKey: string,
  params: { view?: string; q?: string; page?: number; pageSize?: number }
): Promise<ModuleDesk | null> {
  const moduleDef = moduleDefinition(moduleKey)
  const defs = viewsOf(moduleKey)
  if (!moduleDef || !defs.length) return null
  const def = defs.find((v) => v.key === params.view) ?? defs[0]!
  const q = (params.q ?? "").trim().slice(0, 80)
  const pageSize = params.pageSize ?? 20
  const allRows = await withTenant(ctx.tenant.id, (tx) => def.load(tx, ctx))
  const filtered = q ? allRows.filter((r) => matchesTerm(r, q)) : allRows
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(Math.max(1, params.page ?? 1), pages)
  const capabilities = getCatalog(ctx).modules.find((m) => m.key === moduleKey)?.capabilities ?? []
  return {
    module: moduleDef,
    views: defs.map((v) => ({ key: v.key, labelKey: `modules.views.${v.key}` })),
    active: {
      key: def.key,
      labelKey: `modules.views.${def.key}`,
      descriptionKey: `modules.viewHelp.${def.key}`,
      columns: def.columns,
      rows: filtered.slice((page - 1) * pageSize, page * pageSize),
      createSkill: def.createSkill,
      rowHrefKey: def.columns[0]?.hrefKey,
    },
    capabilities,
    q,
    page,
    pageSize,
    totalRows: filtered.length,
  }
}
