import "server-only"

import { and, asc, desc, eq, ne, sql } from "drizzle-orm"

import type { GridColumn, GridRow } from "@/components/app/record-grid"
import { BUSINESS_PERIOD, MARGIN_FLOOR_BPS } from "@/lib/demo"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import { businessEvent, client, fileObject, job } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { listApprovals } from "@/server/domain/approvals"
import { getBusinessDate } from "@/server/domain/presenter"
import { budgetAvailability, computeProfitability, loadJobFinancials } from "@/server/domain/profitability"

import { isUuid, minorStr } from "./shared"

// Explore your operation: a closed catalog of NAMED, parameterized, read-only
// questions over the canonical services. There is no free-text SQL; every
// parameter is validated against an allowlist and every result lists its
// sources, definition and data cutoff. Reports reuse the same questions.

export type QuestionParam =
  | { key: "floorBps"; type: "bps"; default: number; min: number; max: number }
  | { key: "client"; type: "client" }
  | { key: "job"; type: "job" }
  | { key: "period"; type: "period"; default: { from: string; to: string } }

export type QuestionResult = {
  columns: GridColumn[]
  rows: GridRow[]
  sources: { label: string; href: string }[]
  definitionKey: string
  basis: "forecast" | "incurred" | "events" | "records"
}

type Question = {
  key: string
  params: QuestionParam[]
  run: (tx: Tx, ctx: AgencyContext, p: ResolvedParams) => Promise<QuestionResult>
}

export type ResolvedParams = { floorBps: number; client: string | null; job: string | null; from: string; to: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function resolveParams(raw: Record<string, string | undefined>): ResolvedParams {
  const floor = Number(raw.floorBps)
  const from = raw.from && DATE.test(raw.from) ? raw.from : BUSINESS_PERIOD.start
  const to = raw.to && DATE.test(raw.to) && raw.to >= from ? raw.to : BUSINESS_PERIOD.end
  return {
    floorBps: Number.isInteger(floor) && floor >= 0 && floor <= 9000 ? floor : MARGIN_FLOOR_BPS,
    client: isUuid(raw.client) ? raw.client : null,
    job: isUuid(raw.job) ? raw.job : null,
    from,
    to,
  }
}

const base = (ctx: AgencyContext) => `/a/${ctx.tenant.slug}`

async function marginRows(tx: Tx, ctx: AgencyContext, p: ResolvedParams, onlyBelow: boolean) {
  const conds = [eq(job.tenantId, ctx.tenant.id)]
  if (p.client) conds.push(eq(job.clientId, p.client))
  const jobs = await tx
    .select({ id: job.id, name: job.name, ref: job.displayReference, number: job.jobNumber, clientName: client.name, group: job.reportingGroup })
    .from(job)
    .innerJoin(client, and(eq(client.tenantId, job.tenantId), eq(client.id, job.clientId)))
    .where(and(...conds))
    .orderBy(asc(job.displayReference))
  const rows: GridRow[] = []
  const sources: QuestionResult["sources"] = []
  for (const j of jobs) {
    const pr = computeProfitability(await loadJobFinancials(tx, ctx.tenant.id, j.id), "forecast", ctx.tenant.slug)
    const below = pr.marginBps !== null && pr.marginBps < p.floorBps
    if (onlyBelow && !below) continue
    rows.push({
      id: j.id,
      jobName: j.name,
      jobRef: `${j.ref} · ${j.number}${j.group !== "primary" ? ` · ${j.group}` : ""}`,
      href: `${base(ctx)}/jobs/${j.id}?tab=finance`,
      clientName: j.clientName,
      agencyFeeMinor: minorStr(pr.agencyFeeMinor),
      costMinor: minorStr(pr.agencyCost.totalMinor),
      marginMinor: minorStr(pr.marginMinor),
      marginBps: pr.marginBps,
      floorBps: p.floorBps,
      managedMediaMinor: minorStr(pr.managedMediaMinor),
      currency: pr.currency,
      status: below ? "below_floor" : "at_or_above",
    })
    for (const s of pr.sources) sources.push({ label: `${j.ref} · ${s.label}`, href: s.href })
  }
  return { rows, sources }
}

const MARGIN_COLUMNS: GridColumn[] = [
  { id: "jobName", header: "explore.columns.job", kind: "link", hrefKey: "href", subKey: "jobRef" },
  { id: "clientName", header: "explore.columns.client", kind: "text" },
  { id: "agencyFeeMinor", header: "explore.columns.fee", kind: "money", align: "end" },
  { id: "costMinor", header: "explore.columns.cost", kind: "money", align: "end" },
  { id: "marginMinor", header: "explore.columns.margin", kind: "money", align: "end" },
  { id: "marginBps", header: "explore.columns.marginPct", kind: "bps", align: "end" },
  { id: "status", header: "explore.columns.status", kind: "state", labelPrefix: "explore.status" },
]

export const QUESTIONS: Question[] = [
  {
    key: "jobs-losing-margin",
    params: [{ key: "floorBps", type: "bps", default: MARGIN_FLOOR_BPS, min: 0, max: 9000 }, { key: "client", type: "client" }],
    run: async (tx, ctx, p) => {
      const { rows, sources } = await marginRows(tx, ctx, p, true)
      return { columns: MARGIN_COLUMNS, rows, sources, definitionKey: "explore.definitions.margin", basis: "forecast" }
    },
  },
  {
    key: "margin-by-job",
    params: [{ key: "client", type: "client" }],
    run: async (tx, ctx, p) => {
      const { rows, sources } = await marginRows(tx, ctx, { ...p, floorBps: p.floorBps }, false)
      return {
        columns: [...MARGIN_COLUMNS.slice(0, 6), { id: "managedMediaMinor", header: "explore.columns.managedMedia", kind: "money", align: "end" }],
        rows,
        sources,
        definitionKey: "explore.definitions.margin",
        basis: "forecast",
      }
    },
  },
  {
    key: "client-authority-coverage",
    params: [{ key: "job", type: "job" }],
    run: async (tx, ctx, p) => {
      const jobs = await tx
        .select({ id: job.id, name: job.name, ref: job.displayReference })
        .from(job)
        .where(p.job ? and(eq(job.tenantId, ctx.tenant.id), eq(job.id, p.job)) : eq(job.tenantId, ctx.tenant.id))
        .orderBy(asc(job.displayReference))
      const rows: GridRow[] = []
      const sources: QuestionResult["sources"] = []
      for (const j of jobs) {
        const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
        for (const a of budgetAvailability(fin)) {
          rows.push({
            id: `${j.id}:${a.scope}`,
            jobName: j.name,
            jobRef: j.ref,
            href: `${base(ctx)}/jobs/${j.id}?tab=scope`,
            scope: a.scope,
            authorizedMinor: minorStr(a.authorizedMinor),
            reservedMinor: minorStr(a.reservationsMinor),
            committedMinor: minorStr(a.openCommitmentsMinor),
            spentMinor: minorStr(a.spentMinor),
            availableMinor: minorStr(a.availableMinor),
            currency: a.currency,
          })
        }
        if (fin.approvedAuthority) sources.push({ label: `${j.ref} · ${fin.approvedAuthority.reference} r${fin.approvedAuthority.revisionNumber}`, href: `${base(ctx)}/records/contract/${fin.approvedAuthority.id}` })
        if (fin.approvedBudget) sources.push({ label: `${j.ref} · Budget r${fin.approvedBudget.number}`, href: `${base(ctx)}/records/budget-revision/${fin.approvedBudget.id}` })
      }
      return {
        columns: [
          { id: "jobName", header: "explore.columns.job", kind: "link", hrefKey: "href", subKey: "jobRef" },
          { id: "scope", header: "explore.columns.scope", kind: "state", labelPrefix: "records.scope" },
          { id: "authorizedMinor", header: "explore.columns.authorized", kind: "money", align: "end" },
          { id: "reservedMinor", header: "explore.columns.reserved", kind: "money", align: "end" },
          { id: "committedMinor", header: "explore.columns.committed", kind: "money", align: "end" },
          { id: "spentMinor", header: "explore.columns.spent", kind: "money", align: "end" },
          { id: "availableMinor", header: "explore.columns.available", kind: "money", align: "end" },
        ],
        rows,
        sources,
        definitionKey: "explore.definitions.availability",
        basis: "records",
      }
    },
  },
  {
    key: "pending-approvals",
    params: [],
    run: async (_tx, ctx) => {
      const all = (await listApprovals(ctx)).filter((a) => a.state === "awaiting_approval")
      return {
        columns: [
          { id: "title", header: "explore.columns.approval", kind: "link", hrefKey: "href", subKey: "actionType" },
          { id: "amountMinor", header: "explore.columns.amount", kind: "money", align: "end" },
          { id: "requestedBy", header: "explore.columns.requester", kind: "text" },
          { id: "createdAt", header: "explore.columns.created", kind: "timestamp" },
        ],
        rows: all.map((a) => ({ id: a.id, title: a.title, actionType: a.actionType, amountMinor: a.amountMinor, currency: a.currency ?? ctx.tenant.baseCurrency, requestedBy: a.requestedBy ?? "—", createdAt: a.createdAt, href: `${base(ctx)}/approvals/${a.id}` })),
        sources: all.map((a) => ({ label: a.title, href: `${base(ctx)}/approvals/${a.id}` })),
        definitionKey: "explore.definitions.approvals",
        basis: "records",
      }
    },
  },
  {
    key: "activity-in-period",
    params: [{ key: "period", type: "period", default: { from: BUSINESS_PERIOD.start, to: BUSINESS_PERIOD.end } }],
    run: async (tx, ctx, p) => {
      // Business-effective date when the event carries one; otherwise the recorded time.
      const at = sql`coalesce(${businessEvent.businessEffectiveAt}, ${businessEvent.recordedAt})`
      const rows = await tx
        .select({ eventType: businessEvent.eventType, n: sql<string>`count(*)` })
        .from(businessEvent)
        .where(and(eq(businessEvent.tenantId, ctx.tenant.id), sql`${at} >= ${`${p.from}T00:00:00Z`}::timestamptz`, sql`${at} <= ${`${p.to}T23:59:59Z`}::timestamptz`, ne(businessEvent.origin, "seed")))
        .groupBy(businessEvent.eventType)
        .orderBy(desc(sql`count(*)`))
      return {
        columns: [
          { id: "eventType", header: "explore.columns.event", kind: "mono" },
          { id: "n", header: "explore.columns.count", kind: "number", align: "end" },
        ],
        rows: rows.map((r) => ({ id: r.eventType, eventType: r.eventType, n: Number(r.n) })),
        sources: [{ label: "business_event", href: `${base(ctx)}/settings/audit` }],
        definitionKey: "explore.definitions.activity",
        basis: "events",
      }
    },
  },
  {
    key: "files-not-analyzed",
    params: [{ key: "job", type: "job" }],
    run: async (tx, ctx, p) => {
      const conds = [eq(fileObject.tenantId, ctx.tenant.id), ne(fileObject.extractionStatus, "analyzed")]
      if (p.job) conds.push(eq(fileObject.jobId, p.job))
      const rows = await tx.select().from(fileObject).where(and(...conds)).orderBy(desc(fileObject.createdAt))
      const visible = rows.filter((f) => f.visibility !== "restricted" || ["owner", "finance_approver"].includes(ctx.role))
      return {
        columns: [
          { id: "originalName", header: "explore.columns.file", kind: "link", hrefKey: "href" },
          { id: "format", header: "explore.columns.format", kind: "mono" },
          { id: "extractionStatus", header: "explore.columns.status", kind: "state", labelPrefix: "records.state" },
          { id: "createdAt", header: "explore.columns.created", kind: "timestamp" },
        ],
        rows: visible.map((f) => ({ id: f.id, originalName: f.originalName, format: f.format.toUpperCase(), extractionStatus: f.extractionStatus, createdAt: f.createdAt.toISOString(), href: `${base(ctx)}/library/${f.id}` })),
        sources: [{ label: "file_object", href: `${base(ctx)}/library` }],
        definitionKey: "explore.definitions.files",
        basis: "records",
      }
    },
  },
]

export function getQuestion(key: string | undefined) {
  return QUESTIONS.find((q) => q.key === key) ?? null
}

export async function runQuestion(ctx: AgencyContext, key: string, raw: Record<string, string | undefined>) {
  const q = getQuestion(key)
  if (!q) return null
  const params = resolveParams(raw)
  const result = await withTenant(ctx.tenant.id, (tx) => q.run(tx, ctx, params))
  // Demo business date (data cutoff) and the real execution time are shown separately.
  return { question: q, params, result, asOf: await getBusinessDate(), executedAt: new Date().toISOString() }
}

export async function questionOptions(ctx: AgencyContext) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const clients = await tx.select({ id: client.id, name: client.name }).from(client).where(eq(client.tenantId, ctx.tenant.id)).orderBy(asc(client.name))
    const jobs = await tx.select({ id: job.id, name: job.name, ref: job.displayReference }).from(job).where(eq(job.tenantId, ctx.tenant.id)).orderBy(asc(job.displayReference))
    return { clients: clients.map((c) => ({ value: c.id, label: c.name })), jobs: jobs.map((j) => ({ value: j.id, label: `${j.ref} · ${j.name}` })) }
  })
}
