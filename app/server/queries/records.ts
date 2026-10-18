import "server-only"

import { and, asc, desc, eq, inArray, or } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import {
  actionProposal,
  appUser,
  approvalRequest,
  budgetRevision,
  businessEvent,
  configurationRevision,
  contract,
  costEstimate,
  costEstimateLine,
  delivery,
  evidence,
  fileObject,
  legalEntity,
  mediaPlanLine,
  mediaPlanRevision,
  purchaseOrder,
  supplier,
  timesheet,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { getBusinessDate } from "@/server/domain/presenter"
import { estimateTotals, loadJobFinancials } from "@/server/domain/profitability"

import { f, jobLink, type Loaded, type RecordDetail } from "./record-helpers"
import { EXTENDED_RECORD_TYPES, loadExtended } from "./records-ops"
import { isUuid, iso, minorStr, userNames } from "./shared"

export type { RecordDetail, RecordField, RecordLines, RecordLink } from "./record-helpers"

// Generic authorized business-record detail (/records/:recordType/:recordId).
// Every lookup is tenant-scoped inside withTenant (RLS + explicit tenant
// filter); an id from another agency resolves to null → 404, never to a
// different record. Amounts pass through as exact minor units.

/** Record types resolved by this chassis (URL slug → loader). */
export const RECORD_TYPES = [
  "contract",
  "budget-revision",
  "estimate",
  "timesheet",
  "media-plan",
  "purchase-order",
  "media-order",
  "delivery",
  "evidence",
  "proposal",
  "supplier",
  "legal-entity",
  "configuration-revision",
  ...EXTENDED_RECORD_TYPES,
] as const

/** Declared in the route contract but not resolvable yet (none left once every backend module exposes its records). */
export const PENDING_RECORD_TYPES: readonly string[] = []

async function eventsFor(tx: Tx, ctx: AgencyContext, ids: string[]) {
  if (!ids.length) return []
  const rows = await tx
    .select({
      id: businessEvent.id,
      eventType: businessEvent.eventType,
      origin: businessEvent.origin,
      recordedAt: businessEvent.recordedAt,
      revision: businessEvent.aggregateRevision,
      commandType: businessEvent.commandType,
      actor: appUser.displayName,
    })
    .from(businessEvent)
    .leftJoin(appUser, eq(appUser.id, businessEvent.actorUserId))
    .where(and(eq(businessEvent.tenantId, ctx.tenant.id), inArray(businessEvent.aggregateId, ids)))
    .orderBy(desc(businessEvent.seq))
    .limit(60)
  return rows.map((r) => ({ ...r, recordedAt: r.recordedAt.toISOString() }))
}

async function filesFor(tx: Tx, ctx: AgencyContext, fileIds: (string | null | undefined)[], jobId: string | null) {
  const ids = fileIds.filter((v): v is string => typeof v === "string")
  const conds = []
  if (ids.length) conds.push(inArray(fileObject.id, ids))
  if (jobId) conds.push(eq(fileObject.jobId, jobId))
  if (!conds.length) return []
  const rows = await tx
    .select()
    .from(fileObject)
    .where(and(eq(fileObject.tenantId, ctx.tenant.id), conds.length === 1 ? conds[0]! : or(...conds)!))
    .orderBy(desc(fileObject.createdAt))
    .limit(20)
  return rows
    .filter((r) => r.visibility !== "restricted" || ["owner", "finance_approver"].includes(ctx.role))
    .map((r) => ({ id: r.id, name: r.originalName, version: r.version, format: r.format, href: `/a/${ctx.tenant.slug}/library/${r.id}` }))
}

async function load(tx: Tx, ctx: AgencyContext, type: string, id: string): Promise<Loaded | null> {
  const t = ctx.tenant.id
  const base = `/a/${ctx.tenant.slug}`
  const rec = (rt: string, rid: string) => `${base}/records/${rt}/${rid}`
  switch (type) {
    case "contract": {
      const [c] = await tx.select().from(contract).where(and(eq(contract.tenantId, t), eq(contract.id, id))).limit(1)
      if (!c) return null
      const sibs = await tx.select().from(contract).where(and(eq(contract.tenantId, t), eq(contract.clientId, c.clientId), eq(contract.reference, c.reference))).orderBy(desc(contract.revisionNumber))
      const names = await userNames(tx, [c.approvedBy, c.createdBy])
      const [ev] = c.evidenceId ? await tx.select().from(evidence).where(and(eq(evidence.tenantId, t), eq(evidence.id, c.evidenceId))).limit(1) : []
      return {
        title: c.reference,
        subtitle: `r${c.revisionNumber} · ${c.kind}`,
        state: c.state,
        revision: c.revision,
        synthetic: true,
        fields: [
          f("kind", c.kind, "state"),
          f("reference", c.reference, "mono"),
          f("revisionNumber", c.revisionNumber, "number"),
          f("amount", minorStr(c.amountMinor), "money", c.currency),
          f("validFrom", c.validFrom, "date"),
          f("validTo", c.validTo, "date"),
          f("approvedBy", c.approvedBy ? (names.get(c.approvedBy) ?? null) : null),
          f("createdAt", iso(c.createdAt), "timestamp"),
        ],
        relations: [
          ...(await jobLink(tx, ctx, c.jobId, "scope")),
          ...(ev ? [{ labelKey: "records.links.evidence", label: ev.title, href: rec("evidence", ev.id) }] : []),
          ...(c.supersedesId ? [{ labelKey: "records.links.supersedes", label: "←", href: rec("contract", c.supersedesId) }] : []),
        ],
        siblings: sibs.map((s) => ({ id: s.id, label: `r${s.revisionNumber}`, state: s.state, current: s.id === c.id, href: rec("contract", s.id) })),
        lines: null,
        owningSkill: { moduleKey: "clients-contracts", skillId: "agency-contract-po" },
        jobId: c.jobId,
        fileIds: [ev?.fileId ?? null],
      }
    }
    case "budget-revision": {
      const [b] = await tx.select().from(budgetRevision).where(and(eq(budgetRevision.tenantId, t), eq(budgetRevision.id, id))).limit(1)
      if (!b) return null
      const sibs = await tx.select().from(budgetRevision).where(and(eq(budgetRevision.tenantId, t), eq(budgetRevision.jobId, b.jobId))).orderBy(desc(budgetRevision.number))
      const names = await userNames(tx, [b.approvedBy])
      return {
        title: `Budget r${b.number}`,
        subtitle: b.reason ?? "",
        state: b.state,
        revision: b.revision,
        synthetic: true,
        fields: [
          f("number", b.number, "number"),
          f("agencyFee", minorStr(b.agencyFeeMinor), "money", b.currency),
          f("managedMedia", minorStr(b.managedMediaMinor), "money", b.currency),
          f("reason", b.reason),
          f("approvedBy", b.approvedBy ? (names.get(b.approvedBy) ?? null) : null),
          f("createdAt", iso(b.createdAt), "timestamp"),
        ],
        relations: [
          ...(await jobLink(tx, ctx, b.jobId, "scope")),
          ...(b.supersedesId ? [{ labelKey: "records.links.supersedes", label: "←", href: rec("budget-revision", b.supersedesId) }] : []),
        ],
        siblings: sibs.map((s) => ({ id: s.id, label: `r${s.number}`, state: s.state, current: s.id === b.id, href: rec("budget-revision", s.id) })),
        lines: null,
        owningSkill: { moduleKey: "clients-contracts", skillId: "agency-fee-contracts" },
        jobId: b.jobId,
      }
    }
    case "estimate": {
      const [e] = await tx.select().from(costEstimate).where(and(eq(costEstimate.tenantId, t), eq(costEstimate.id, id))).limit(1)
      if (!e) return null
      const fin = await loadJobFinancials(tx, t, e.jobId)
      const totals = estimateTotals(fin, e.id)
      const lines = await tx.select().from(costEstimateLine).where(and(eq(costEstimateLine.tenantId, t), eq(costEstimateLine.estimateId, e.id))).orderBy(asc(costEstimateLine.lineType))
      return {
        title: `Cost estimate r${e.number}`,
        subtitle: e.reason ?? "",
        state: e.state,
        revision: e.revision,
        synthetic: true,
        fields: [
          f("number", e.number, "number"),
          f("laborHours", Number((totals.laborMinutes / 60).toFixed(2)), "number"),
          f("labor", minorStr(totals.laborMinor), "money", e.currency),
          f("production", minorStr(totals.productionMinor), "money", e.currency),
          f("expense", minorStr(totals.expenseMinor), "money", e.currency),
          f("total", minorStr(totals.totalMinor), "money", e.currency),
          f("createdAt", iso(e.createdAt), "timestamp"),
        ],
        relations: await jobLink(tx, ctx, e.jobId, "production"),
        siblings: fin.estimates.map((s) => ({ id: s.id, label: `r${s.number}`, state: s.state, current: s.id === e.id, href: rec("estimate", s.id) })),
        lines: {
          columns: [
            { id: "lineType", header: "records.fields.lineType", kind: "state", labelPrefix: "records.lineType" },
            { id: "description", header: "records.fields.description", kind: "text" },
            { id: "hours", header: "records.fields.laborHours", kind: "number", align: "end" },
            { id: "amountMinor", header: "records.fields.amount", kind: "money", align: "end" },
          ],
          rows: lines.map((l) => ({ id: l.id, lineType: l.lineType, description: l.description, hours: l.minutes ? Number((l.minutes / 60).toFixed(2)) : null, amountMinor: minorStr(l.amountMinor), currency: l.currency })),
        },
        owningSkill: { moduleKey: "work-production", skillId: "agency-production-estimating" },
        jobId: e.jobId,
      }
    }
    case "timesheet": {
      const [ts] = await tx.select().from(timesheet).where(and(eq(timesheet.tenantId, t), eq(timesheet.id, id))).limit(1)
      if (!ts) return null
      const names = await userNames(tx, [ts.userId, ts.approvedBy])
      return {
        title: ts.taskLabel,
        subtitle: ts.workDate,
        state: ts.state,
        revision: ts.revision,
        synthetic: true,
        fields: [
          f("person", ts.userId ? (names.get(ts.userId) ?? null) : null),
          f("workDate", ts.workDate, "date"),
          f("laborHours", Number((ts.minutes / 60).toFixed(2)), "number"),
          f("hourlyCost", minorStr(ts.hourlyCostMinor), "money", ts.currency),
          f("approvedBy", ts.approvedBy ? (names.get(ts.approvedBy) ?? null) : null),
        ],
        relations: await jobLink(tx, ctx, ts.jobId, "production"),
        siblings: [],
        lines: null,
        owningSkill: { moduleKey: "work-production", skillId: "agency-tasks-timesheets" },
        jobId: ts.jobId,
        commands:
          ts.state === "submitted"
            ? [
                {
                  command: "time.decideTimesheet",
                  titleKey: "records.commands.decideTimesheet",
                  helpKey: "records.commands.decideTimesheetHelp",
                  fixed: { timesheet: ts.id, revision: ts.revision },
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
    case "media-plan": {
      const [p] = await tx.select().from(mediaPlanRevision).where(and(eq(mediaPlanRevision.tenantId, t), eq(mediaPlanRevision.id, id))).limit(1)
      if (!p) return null
      const sibs = await tx.select().from(mediaPlanRevision).where(and(eq(mediaPlanRevision.tenantId, t), eq(mediaPlanRevision.jobId, p.jobId))).orderBy(desc(mediaPlanRevision.number))
      const lines = await tx.select().from(mediaPlanLine).where(and(eq(mediaPlanLine.tenantId, t), eq(mediaPlanLine.planRevisionId, p.id))).orderBy(asc(mediaPlanLine.lineKey))
      const names = await userNames(tx, [p.approvedBy])
      return {
        title: `Media plan r${p.number}`,
        subtitle: p.objective,
        state: p.state,
        revision: p.revision,
        synthetic: true,
        fields: [
          f("number", p.number, "number"),
          f("objective", p.objective),
          f("total", minorStr(p.totalMinor), "money", p.currency),
          f("approvedBy", p.approvedBy ? (names.get(p.approvedBy) ?? null) : null),
          f("createdAt", iso(p.createdAt), "timestamp"),
        ],
        relations: await jobLink(tx, ctx, p.jobId, "media"),
        siblings: sibs.map((s) => ({ id: s.id, label: `r${s.number}`, state: s.state, current: s.id === p.id, href: rec("media-plan", s.id) })),
        lines: {
          columns: [
            { id: "lineKey", header: "records.fields.lineKey", kind: "mono" },
            { id: "placement", header: "records.fields.placement", kind: "text" },
            { id: "provider", header: "records.fields.provider", kind: "mono" },
            { id: "startDate", header: "records.fields.startDate", kind: "date" },
            { id: "endDate", header: "records.fields.endDate", kind: "date" },
            { id: "amountMinor", header: "records.fields.amount", kind: "money", align: "end" },
            { id: "simulation", header: "records.fields.source", kind: "state", labelPrefix: "records.state" },
          ],
          rows: lines.map((l) => ({ id: l.id, lineKey: l.lineKey, placement: `${l.channel} · ${l.placement}`, provider: l.accountAlias ? `${l.provider} · ${l.accountAlias}` : l.provider, startDate: l.startDate, endDate: l.endDate, amountMinor: minorStr(l.amountMinor), currency: l.currency, simulation: l.simulation })),
        },
        owningSkill: { moduleKey: "media-planning", skillId: "agency-plan-changes" },
        jobId: p.jobId,
      }
    }
    case "purchase-order":
    case "media-order": {
      const [o] = await tx.select().from(purchaseOrder).where(and(eq(purchaseOrder.tenantId, t), eq(purchaseOrder.id, id))).limit(1)
      if (!o) return null
      if (type === "media-order" && o.kind !== "media") return null
      const [s] = o.supplierId ? await tx.select().from(supplier).where(and(eq(supplier.tenantId, t), eq(supplier.id, o.supplierId))).limit(1) : []
      const dels = await tx.select().from(delivery).where(and(eq(delivery.tenantId, t), eq(delivery.orderId, o.id))).orderBy(desc(delivery.businessDate))
      const bizDate = await getBusinessDate()
      return {
        title: o.reference,
        subtitle: o.kind,
        state: o.state,
        revision: o.revision,
        synthetic: true,
        fields: [
          f("kind", o.kind, "state"),
          f("amount", minorStr(o.amountMinor), "money", o.currency),
          f("provider", o.provider, "mono"),
          f("account", o.accountAlias, "mono"),
          f("planRevision", o.planRevisionNumber, "mono"),
          f("receipt", o.receiptId, "mono"),
          f("createdAt", iso(o.createdAt), "timestamp"),
        ],
        relations: [
          ...(await jobLink(tx, ctx, o.jobId, o.kind === "media" ? "media" : "production")),
          ...(s ? [{ labelKey: "records.links.supplier", label: s.name, href: rec("supplier", s.id) }] : []),
          ...(o.approvalId ? [{ labelKey: "records.links.approval", label: o.approvalId.slice(0, 8), href: `${base}/approvals/${o.approvalId}` }] : []),
        ],
        siblings: [],
        lines: {
          columns: [
            { id: "businessDate", header: "records.fields.businessDate", kind: "date" },
            { id: "acceptedMinor", header: "records.fields.accepted", kind: "money", align: "end" },
            { id: "state", header: "records.fields.state", kind: "state", labelPrefix: "records.state" },
          ],
          rows: dels.map((d) => ({ id: d.id, businessDate: d.businessDate, acceptedMinor: minorStr(d.acceptedMinor), currency: d.currency, state: d.state, href: rec("delivery", d.id) })),
        },
        owningSkill: o.kind === "media" ? { moduleKey: "media-buying", skillId: "agency-media-buying" } : { moduleKey: "work-production", skillId: "agency-production" },
        jobId: o.jobId,
        commands:
          o.kind === "media"
            ? [
                {
                  command: "media.acceptDelivery",
                  titleKey: "records.commands.acceptDelivery",
                  helpKey: "records.commands.acceptDeliveryHelp",
                  fixed: { order: o.id },
                  fields: [
                    { key: "acceptedAmount", type: "decimal", label: "records.commands.acceptedAmount", currency: o.currency, required: true },
                    { key: "businessDate", type: "date", label: "records.commands.businessDate", required: true, defaultValue: bizDate },
                    { key: "note", type: "textarea", label: "records.commands.note" },
                  ],
                  buttons: [{ label: "records.commands.accept" }],
                },
                {
                  command: "media.reconcileMediaOrderSubmission",
                  titleKey: "records.commands.reconcileOrder",
                  helpKey: "records.commands.reconcileOrderHelp",
                  fixed: { order: o.id },
                  fields: [],
                  buttons: [{ label: "records.commands.reconcile", variant: "outline" }],
                },
              ]
            : [],
        eventIds: [o.id, ...dels.map((d) => d.id)],
      }
    }
    case "delivery": {
      const [d] = await tx.select().from(delivery).where(and(eq(delivery.tenantId, t), eq(delivery.id, id))).limit(1)
      if (!d) return null
      const [o] = await tx.select().from(purchaseOrder).where(and(eq(purchaseOrder.tenantId, t), eq(purchaseOrder.id, d.orderId))).limit(1)
      const [ev] = d.evidenceId ? await tx.select().from(evidence).where(and(eq(evidence.tenantId, t), eq(evidence.id, d.evidenceId))).limit(1) : []
      const names = await userNames(tx, [d.acceptedBy])
      return {
        title: `${o?.reference ?? "—"} · ${d.businessDate}`,
        subtitle: o?.kind ?? "",
        state: d.state,
        revision: d.revision,
        synthetic: true,
        fields: [
          f("businessDate", d.businessDate, "date"),
          f("accepted", minorStr(d.acceptedMinor), "money", d.currency),
          f("acceptedBy", d.acceptedBy ? (names.get(d.acceptedBy) ?? null) : null),
        ],
        relations: [
          ...(o ? [{ labelKey: "records.links.order", label: o.reference, href: rec("purchase-order", o.id) }] : []),
          ...(await jobLink(tx, ctx, o?.jobId ?? null)),
          ...(ev ? [{ labelKey: "records.links.evidence", label: ev.title, href: rec("evidence", ev.id) }] : []),
        ],
        siblings: [],
        lines: null,
        owningSkill: { moduleKey: "suppliers-payments", skillId: "agency-delivery-reconciliation" },
        jobId: o?.jobId ?? null,
        fileIds: [ev?.fileId ?? null],
      }
    }
    case "evidence": {
      const [e] = await tx.select().from(evidence).where(and(eq(evidence.tenantId, t), eq(evidence.id, id))).limit(1)
      if (!e) return null
      const names = await userNames(tx, [e.reviewedBy, e.submittedBy])
      const [ef] = e.fileId ? await tx.select({ sha256: fileObject.sha256, version: fileObject.version }).from(fileObject).where(and(eq(fileObject.tenantId, t), eq(fileObject.id, e.fileId))).limit(1) : []
      const reviewCurrent = e.reviewState === "reviewed" && !!ef && e.reviewedFileSha256 === ef.sha256 && e.reviewedFileVersion === ef.version
      const usedBy = await tx.select({ id: contract.id, reference: contract.reference, revisionNumber: contract.revisionNumber, jobId: contract.jobId }).from(contract).where(and(eq(contract.tenantId, t), eq(contract.evidenceId, e.id)))
      return {
        title: e.title,
        subtitle: e.kind,
        state: e.reviewState,
        revision: null,
        synthetic: e.synthetic,
        fields: [
          f("kind", e.kind, "mono"),
          f("reviewState", e.reviewState, "state"),
          f("reviewedBy", e.reviewedBy ? (names.get(e.reviewedBy) ?? null) : null),
          f("reviewedAt", iso(e.reviewedAt), "timestamp"),
          f("reviewReason", e.reviewReason),
          f("reviewCurrent", e.reviewState === "reviewed" ? (reviewCurrent ? "yes" : "no") : null, "state"),
          f("submittedBy", e.submittedBy ? (names.get(e.submittedBy) ?? null) : null),
          f("fixtureKey", e.fixtureKey, "mono"),
          f("createdAt", iso(e.createdAt), "timestamp"),
        ],
        relations: [
          ...usedBy.map((c) => ({ labelKey: "records.links.contract", label: `${c.reference} r${c.revisionNumber}`, href: rec("contract", c.id) })),
          ...(await jobLink(tx, ctx, usedBy[0]?.jobId ?? null, "scope")),
        ],
        siblings: [],
        lines: null,
        owningSkill: { moduleKey: "clients-contracts", skillId: "agency-contract-po" },
        jobId: e.jobId ?? null,
        fileIds: [e.fileId],
        reviewer: { submittedBy: e.submittedBy },
      }
    }
    case "proposal": {
      const [p] = await tx.select().from(actionProposal).where(and(eq(actionProposal.tenantId, t), eq(actionProposal.id, id))).limit(1)
      if (!p) return null
      const approvals = await tx.select({ id: approvalRequest.id, state: approvalRequest.state, title: approvalRequest.title }).from(approvalRequest).where(and(eq(approvalRequest.tenantId, t), eq(approvalRequest.proposalId, p.id)))
      const names = await userNames(tx, [p.createdBy, p.confirmedBy])
      const jobId = p.aggregateType === "job" ? p.aggregateId : null
      return {
        title: p.actionType,
        subtitle: p.skillId ?? "",
        state: p.state,
        revision: p.revision,
        synthetic: false,
        fields: [
          f("actionType", p.actionType, "mono"),
          f("skillId", p.skillId, "mono"),
          f("aggregate", `${p.aggregateType}${p.baseRevision ? ` · r${p.baseRevision}` : ""}`, "mono"),
          f("payloadDigest", p.payloadDigest, "mono"),
          f("origin", p.origin, "state"),
          f("createdBy", names.get(p.createdBy) ?? null),
          f("createdAt", iso(p.createdAt), "timestamp"),
        ],
        relations: [
          ...approvals.map((a) => ({ labelKey: "records.links.approval", label: a.title, href: `${base}/approvals/${a.id}` })),
          ...(await jobLink(tx, ctx, jobId, "finance")),
          ...(p.runId ? [{ labelKey: "records.links.run", label: p.runId.slice(0, 8), href: `${base}/runs/${p.runId}` }] : []),
        ],
        siblings: [],
        lines: null,
        owningSkill: null,
        jobId,
        eventIds: [p.id, ...(p.aggregateId ? [p.aggregateId] : [])],
      }
    }
    case "supplier": {
      const [s] = await tx.select().from(supplier).where(and(eq(supplier.tenantId, t), eq(supplier.id, id))).limit(1)
      if (!s) return null
      const orders = await tx.select().from(purchaseOrder).where(and(eq(purchaseOrder.tenantId, t), eq(purchaseOrder.supplierId, s.id))).orderBy(desc(purchaseOrder.createdAt))
      return {
        title: s.name,
        subtitle: `${s.country} · ${s.currency}`,
        state: null,
        revision: null,
        synthetic: true,
        fields: [f("country", s.country), f("currency", s.currency, "mono"), f("externalIds", JSON.stringify(s.externalIds), "mono"), f("createdAt", iso(s.createdAt), "timestamp")],
        relations: [],
        siblings: [],
        lines: {
          columns: [
            { id: "reference", header: "records.fields.reference", kind: "mono" },
            { id: "kind", header: "records.fields.kind", kind: "state", labelPrefix: "modules.kinds" },
            { id: "amountMinor", header: "records.fields.amount", kind: "money", align: "end" },
            { id: "state", header: "records.fields.state", kind: "state", labelPrefix: "records.state" },
          ],
          rows: orders.map((o) => ({ id: o.id, reference: o.reference, kind: o.kind, amountMinor: minorStr(o.amountMinor), currency: o.currency, state: o.state, href: rec("purchase-order", o.id) })),
        },
        owningSkill: { moduleKey: "setup", skillId: "agency-master-data" },
        jobId: null,
      }
    }
    case "legal-entity": {
      const [e] = await tx.select().from(legalEntity).where(and(eq(legalEntity.tenantId, t), eq(legalEntity.id, id))).limit(1)
      if (!e) return null
      return {
        title: e.name,
        subtitle: `${e.country} · ${e.currency}`,
        state: null,
        revision: null,
        synthetic: true,
        fields: [f("country", e.country), f("currency", e.currency, "mono"), f("fiscalProfile", e.fiscalProfileId, "mono"), f("createdAt", iso(e.createdAt), "timestamp")],
        relations: [],
        siblings: [],
        lines: null,
        owningSkill: { moduleKey: "accounting-close", skillId: "agency-general-ledger" },
        jobId: null,
      }
    }
    case "configuration-revision": {
      const [c] = await tx.select().from(configurationRevision).where(and(eq(configurationRevision.tenantId, t), eq(configurationRevision.id, id))).limit(1)
      if (!c) return null
      const sibs = await tx.select({ id: configurationRevision.id, number: configurationRevision.number, state: configurationRevision.state }).from(configurationRevision).where(eq(configurationRevision.tenantId, t)).orderBy(desc(configurationRevision.number))
      const names = await userNames(tx, [c.createdBy, c.approvedBy])
      return {
        title: `Configuration r${c.number}`,
        subtitle: c.schemaVersion,
        state: c.state,
        revision: c.revision,
        synthetic: true,
        fields: [
          f("number", c.number, "number"),
          f("published", c.id === ctx.tenant.publishedConfigRevisionId ? "yes" : "no", "state"),
          f("enabledCapabilities", c.enabledCapabilities.length, "number"),
          f("lastCompletedStep", c.lastCompletedStep, "number"),
          f("createdBy", c.createdBy ? (names.get(c.createdBy) ?? null) : null),
          f("approvedBy", c.approvedBy ? (names.get(c.approvedBy) ?? null) : null),
          f("publishedAt", iso(c.publishedAt), "timestamp"),
        ],
        relations: [{ labelKey: "records.links.settings", label: ctx.tenant.appName, href: `${base}/settings/brand` }],
        siblings: sibs.map((s) => ({ id: s.id, label: `r${s.number}`, state: s.state, current: s.id === c.id, href: rec("configuration-revision", s.id) })),
        lines: {
          columns: [{ id: "skillId", header: "records.fields.skillId", kind: "mono" }],
          rows: c.enabledCapabilities.map((s) => ({ id: s, skillId: s })),
        },
        owningSkill: { moduleKey: "setup", skillId: "agency-access-governance" },
        jobId: null,
      }
    }
    default:
      return loadExtended(tx, ctx, type, id)
  }
}

export async function getRecordDetail(ctx: AgencyContext, recordType: string, recordId: string): Promise<RecordDetail | null> {
  if (!(RECORD_TYPES as readonly string[]).includes(recordType) || !isUuid(recordId)) return null
  return withTenant(ctx.tenant.id, async (tx) => {
    const r = await load(tx, ctx, recordType, recordId)
    if (!r) return null
    const { eventIds, fileIds, reviewer, commands, ...rest } = r
    const events = await eventsFor(tx, ctx, eventIds ?? [recordId])
    const files = await filesFor(tx, ctx, fileIds ?? [], r.jobId)
    return { ...rest, reviewer: reviewer ?? null, commands: commands ?? [], type: recordType, id: recordId, events, files }
  })
}
