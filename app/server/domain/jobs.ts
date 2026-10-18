import "server-only"

import { and, asc, count, desc, eq, ilike, inArray, max, notInArray, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import { jobNumber } from "@/server/calculators"
import type { Tx } from "@/server/db/client"
import {
  appUser,
  approvalRequest,
  attentionItem,
  brief,
  budgetReservation,
  businessEvent,
  client,
  displayReferenceCounter,
  fileObject,
  job,
  mediaPlanLine,
  mediaPlanRevision,
  purchaseOrder,
  timesheet,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { defineCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import {
  budgetAvailability,
  computeProfitability,
  estimateTotals,
  loadJobFinancials,
} from "./profitability"

const Uuid = z.string().uuid()
export const isUuid = (v: string) => Uuid.safeParse(v).success

// ── Jobs list (Jobs desk, Overview, search) ──

export const JobListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  state: z.enum(["draft", "open", "in_progress", "ready_to_close", "closed"]).optional(),
  client: Uuid.optional(),
  sort: z.enum(["updated", "name", "job_number", "margin"]).default("updated"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
  group: z.enum(["primary", "all"]).default("all"),
})
export type JobListQuery = z.infer<typeof JobListQuery>

export async function listJobs(ctx: AgencyContext, rawQuery: Partial<Record<string, string>>) {
  const query = JobListQuery.parse(rawQuery)
  return withTenant(ctx.tenant.id, async (tx) => {
    const conds: SQL[] = [eq(job.tenantId, ctx.tenant.id)]
    if (query.q) {
      // Parameterized ILIKE on allowlisted columns only; % and _ escaped.
      const term = `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
      conds.push(
        or(
          ilike(job.name, term),
          ilike(job.jobNumber, term),
          ilike(job.displayReference, term),
          ilike(client.name, term)
        )!
      )
    }
    if (query.state) conds.push(eq(job.state, query.state))
    if (query.client) conds.push(eq(job.clientId, query.client))
    if (query.group === "primary") conds.push(eq(job.reportingGroup, "primary"))
    const where = and(...conds)

    const [{ total }] = await tx
      .select({ total: count() })
      .from(job)
      .innerJoin(client, and(eq(client.tenantId, job.tenantId), eq(client.id, job.clientId)))
      .where(where)

    const orderCol =
      query.sort === "name" ? job.name : query.sort === "job_number" ? job.jobNumber : job.updatedAt
    const rows = await tx
      .select({
        id: job.id,
        jobNumber: job.jobNumber,
        displayReference: job.displayReference,
        name: job.name,
        state: job.state,
        currency: job.currency,
        reportingGroup: job.reportingGroup,
        updatedAt: job.updatedAt,
        revision: job.revision,
        clientId: client.id,
        clientName: client.name,
        ownerName: appUser.displayName,
      })
      .from(job)
      .innerJoin(client, and(eq(client.tenantId, job.tenantId), eq(client.id, job.clientId)))
      .leftJoin(appUser, eq(appUser.id, job.ownerUserId))
      .where(where)
      .orderBy(query.dir === "asc" ? asc(orderCol) : desc(orderCol), asc(job.id))
      .limit(query.sort === "margin" ? 1000 : query.pageSize)
      .offset(query.sort === "margin" ? 0 : (query.page - 1) * query.pageSize)

    // Projected margin uses the same definition as the dossier and reports.
    const enriched = []
    for (const r of rows) {
      const fin = await loadJobFinancials(tx, ctx.tenant.id, r.id)
      const p = computeProfitability(fin, "forecast", ctx.tenant.slug)
      const openAttention = await tx
        .select({ ctaLabel: attentionItem.ctaLabel, ctaHref: attentionItem.ctaHref })
        .from(attentionItem)
        .where(and(eq(attentionItem.tenantId, ctx.tenant.id), eq(attentionItem.jobId, r.id), eq(attentionItem.state, "open")))
        .limit(1)
      enriched.push({
        ...r,
        updatedAt: r.updatedAt.toISOString(),
        agencyFeeMinor: p.agencyFeeMinor.toString(),
        managedMediaMinor: p.managedMediaMinor.toString(),
        marginBps: p.marginBps,
        nextAction: openAttention[0]
          ? { label: openAttention[0].ctaLabel as { en: string; es: string }, href: openAttention[0].ctaHref }
          : null,
      })
    }
    let items = enriched
    if (query.sort === "margin") {
      items = [...enriched].sort((a, b) => {
        const d = (a.marginBps ?? -1e9) - (b.marginBps ?? -1e9)
        return query.dir === "asc" ? d : -d
      })
      items = items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
    }
    return { query, total, items }
  })
}

// ── Job dossier ──

export async function getJobDossier(ctx: AgencyContext, jobId: string) {
  if (!isUuid(jobId)) return null
  return withTenant(ctx.tenant.id, async (tx) => {
    const fin = await loadJobFinancials(tx, ctx.tenant.id, jobId).catch((e) => {
      if (e instanceof DomainError && e.code === "not_found") return null
      throw e
    })
    if (!fin) return null
    const [c] = await tx
      .select()
      .from(client)
      .where(and(eq(client.tenantId, ctx.tenant.id), eq(client.id, fin.job.clientId)))
      .limit(1)
    const [owner] = fin.job.ownerUserId
      ? await tx.select({ name: appUser.displayName }).from(appUser).where(eq(appUser.id, fin.job.ownerUserId))
      : []
    const briefs = await tx
      .select()
      .from(brief)
      .where(and(eq(brief.tenantId, ctx.tenant.id), eq(brief.clientId, fin.job.clientId)))
    const plans = await tx
      .select()
      .from(mediaPlanRevision)
      .where(and(eq(mediaPlanRevision.tenantId, ctx.tenant.id), eq(mediaPlanRevision.jobId, jobId)))
      .orderBy(desc(mediaPlanRevision.number))
    const planLines = plans.length
      ? await tx
          .select()
          .from(mediaPlanLine)
          .where(
            and(
              eq(mediaPlanLine.tenantId, ctx.tenant.id),
              inArray(
                mediaPlanLine.planRevisionId,
                plans.map((p) => p.id)
              )
            )
          )
      : []
    const approvals = await tx
      .select()
      .from(approvalRequest)
      .where(and(eq(approvalRequest.tenantId, ctx.tenant.id), eq(approvalRequest.aggregateId, jobId)))
      .orderBy(desc(approvalRequest.createdAt))
    const attention = await tx
      .select()
      .from(attentionItem)
      .where(and(eq(attentionItem.tenantId, ctx.tenant.id), eq(attentionItem.jobId, jobId)))
    const files = await tx
      .select()
      .from(fileObject)
      .where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.jobId, jobId)))
      .orderBy(desc(fileObject.createdAt))
    const events = await tx
      .select({
        id: businessEvent.id,
        seq: businessEvent.seq,
        eventType: businessEvent.eventType,
        origin: businessEvent.origin,
        commandType: businessEvent.commandType,
        aggregateType: businessEvent.aggregateType,
        aggregateRevision: businessEvent.aggregateRevision,
        payload: businessEvent.payload,
        recordedAt: businessEvent.recordedAt,
        actor: appUser.displayName,
      })
      .from(businessEvent)
      .leftJoin(appUser, eq(appUser.id, businessEvent.actorUserId))
      .where(and(eq(businessEvent.tenantId, ctx.tenant.id), eq(businessEvent.jobId, jobId)))
      .orderBy(desc(businessEvent.seq))
      .limit(100)

    const forecast = computeProfitability(fin, "forecast", ctx.tenant.slug)
    const incurred = computeProfitability(fin, "incurred", ctx.tenant.slug)
    return {
      job: { ...fin.job, ownerName: owner?.name ?? null },
      client: c ?? null,
      briefs,
      budgets: fin.budgets,
      contracts: fin.contracts,
      approvedAuthority: fin.approvedAuthority,
      estimates: fin.estimates.map((e) => ({ ...e, totals: estimateTotals(fin, e.id) })),
      estimateLines: fin.estimateLines,
      currentEstimate: fin.currentEstimate,
      availability: budgetAvailability(fin),
      reservations: fin.reservations,
      timesheets: fin.timesheets,
      plans,
      planLines,
      approvals,
      attention,
      files,
      events,
      forecast,
      incurred,
    }
  })
}

export type JobDossier = NonNullable<Awaited<ReturnType<typeof getJobDossier>>>

// ── agency-job-lifecycle: openOrCloseJob ──

export const OpenOrCloseJobInput = z
  .object({
    action: z.enum(["open", "request_close"]),
    client: Uuid.optional(),
    jobName: z.string().trim().min(3).max(160).optional(),
    jobType: z.enum(["A", "C", "P", "N"]).optional(),
    billingCode: z.enum(["F", "0", "?"]).optional(),
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    job: Uuid.optional(),
    closeReason: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.action === "open") {
      for (const k of ["client", "jobName", "jobType", "billingCode", "period"] as const) {
        if (!v[k]) ctx.addIssue({ code: "custom", path: [k], message: "Required to open a job" })
      }
    } else {
      if (!v.job) ctx.addIssue({ code: "custom", path: ["job"], message: "Required to close a job" })
      if (!v.closeReason) ctx.addIssue({ code: "custom", path: ["closeReason"], message: "A reason is required" })
    }
  })

function referencePrefix(agencyName: string): string {
  const letters = agencyName
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .replace(/[^A-Z0-9]/g, "")
  return (letters || "JOB").slice(0, 4)
}

export const openOrCloseJob = defineCommand({
  type: "jobs.openOrClose",
  skillId: "agency-job-lifecycle",
  permission: "jobs.manage",
  input: OpenOrCloseJobInput,
  handler: async (tx, ctx, input, meta) => {
    if (input.action === "open") return openJob(tx, ctx, input as Required<Pick<typeof input, "client" | "jobName" | "jobType" | "billingCode" | "period">>)
    return requestClose(tx, ctx, input.job!, input.closeReason!, meta.expectedRevision)
  },
})

/**
 * Next friendly reference number for the agency/year, atomically (B09). The
 * counter row serializes concurrent opens across different clients; it never
 * goes below the highest numeric reference already used that year.
 */
async function nextDisplayNumber(tx: Tx, tenantId: string, year: number): Promise<number> {
  const maxUsed = sql<number>`(select coalesce(max((regexp_match(${job.displayReference}, '-([0-9]{3,})$'))[1]::int), 0) from ${job} where ${job.tenantId} = ${tenantId} and ${job.year} = ${year})`
  const [row] = await tx
    .insert(displayReferenceCounter)
    .values({ tenantId, year, lastValue: sql`${maxUsed} + 1` })
    .onConflictDoUpdate({
      target: [displayReferenceCounter.tenantId, displayReferenceCounter.year],
      set: { lastValue: sql`greatest(${displayReferenceCounter.lastValue}, ${maxUsed}) + 1`, updatedAt: new Date() },
    })
    .returning({ value: displayReferenceCounter.lastValue })
  return row!.value
}

const NO_MOVE = { applicable: false, reason: "no_move_or_substitution_requested" } as const

async function inactiveJobs(tx: Tx, tenantId: string, clientId: string) {
  return tx
    .select({ id: job.id, jobNumber: job.jobNumber, displayReference: job.displayReference, state: job.state })
    .from(job)
    .where(and(eq(job.tenantId, tenantId), eq(job.clientId, clientId), inArray(job.state, ["ready_to_close", "closed"])))
    .orderBy(asc(job.displayReference))
}

async function openJob(
  tx: Tx,
  ctx: AgencyContext,
  input: { client: string; jobName: string; jobType: string; billingCode: string; period: string }
) {
  // Lock the client row to serialize sequence assignment for its job numbers.
  const [c] = await tx
    .select()
    .from(client)
    .where(and(eq(client.tenantId, ctx.tenant.id), eq(client.id, input.client)))
    .for("update")
    .limit(1)
  if (!c) throw new DomainError("not_found", "Client not found", { field: "client" })
  if (c.state !== "active") throw new DomainError("blocked_by_rule", "Client is archived", { rule: "client_active" })
  const year = Number(input.period.slice(0, 4))
  const [seqRow] = await tx
    .select({ max: max(job.sequence) })
    .from(job)
    .where(and(eq(job.tenantId, ctx.tenant.id), eq(job.clientId, c.id), eq(job.year, year)))
  const sequence = (seqRow?.max ?? 0) + 1
  if (sequence > 9999) throw new DomainError("blocked_by_rule", "No job sequence left for this client and year", { rule: "job_sequence_exhausted" })
  const jn = jobNumber({
    clientCode: c.code,
    productCode: c.productCode,
    year,
    jobType: input.jobType,
    billingCode: input.billingCode,
    sequence,
  })
  const displayReference = `${referencePrefix(ctx.tenant.name)}-${year}-${String(await nextDisplayNumber(tx, ctx.tenant.id, year)).padStart(3, "0")}`
  const [row] = await tx
    .insert(job)
    .values({
      tenantId: ctx.tenant.id,
      clientId: c.id,
      name: input.jobName,
      jobNumber: jn.code,
      displayReference,
      jobType: input.jobType,
      billingCode: input.billingCode,
      year,
      sequence,
      state: "open",
      ownerUserId: ctx.user.id,
      period: input.period,
      currency: c.billingCurrency,
      services: [],
      reportingGroup: c.reportingGroup,
      createdBy: ctx.user.id,
      updatedBy: ctx.user.id,
    })
    .returning()
  return {
    result: {
      action: "open" as const,
      jobId: row!.id,
      jobNumber: row!.jobNumber,
      displayReference: row!.displayReference,
      warnings: jn.warnings,
      state: row!.state,
      job_proposal: {
        jobId: row!.id,
        clientId: c.id,
        name: row!.name,
        period: row!.period,
        jobType: row!.jobType,
        billingCode: row!.billingCode,
        currency: row!.currency,
        reportingGroup: row!.reportingGroup,
        state: row!.state,
      },
      // The canonical JobNumber comes from the job_number calculator; the
      // display reference is only a friendly alias.
      job_code_check: {
        jobNumber: jn.code,
        displayReference,
        sequence,
        salesAllowed: jn.salesAllowed,
        mediaAllowed: jn.mediaAllowed,
        clientApprovalAllowed: jn.clientApprovalAllowed,
        warnings: jn.warnings,
      },
      move_or_substitution_plan: NO_MOVE,
      close_readiness: { applicable: false, reason: "job_just_opened" },
      inactive_job_list: await inactiveJobs(tx, ctx.tenant.id, c.id),
      job_audit_note: { eventType: "job.opened", actorUserId: ctx.user.id, clientCode: c.code },
    },
    events: [
      {
        eventType: "job.opened",
        aggregateType: "job",
        aggregateId: row!.id,
        aggregateRevision: row!.revision,
        jobId: row!.id,
        payload: { jobNumber: row!.jobNumber, displayReference, clientId: c.id, warnings: jn.warnings },
      },
    ],
  }
}

async function requestClose(tx: Tx, ctx: AgencyContext, jobId: string, reason: string, expectedRevision?: number) {
  const [j] = await tx
    .select()
    .from(job)
    .where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, jobId)))
    .for("update")
    .limit(1)
  if (!j) throw new DomainError("not_found", "Job not found", { field: "job" })
  if (expectedRevision !== undefined && expectedRevision !== j.revision) {
    throw new DomainError("revision_conflict", "This record changed", { currentRevision: j.revision })
  }
  if (j.state === "ready_to_close" || j.state === "closed") {
    throw new DomainError("blocked_by_rule", "The job is already closing or closed", { rule: "job_not_open", state: j.state })
  }
  const blockers: { code: string; count: number }[] = []
  const [{ pendingApprovals }] = await tx
    .select({ pendingApprovals: count() })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.tenantId, ctx.tenant.id),
        eq(approvalRequest.aggregateId, jobId),
        inArray(approvalRequest.state, ["awaiting_approval", "approved"])
      )
    )
  if (pendingApprovals) blockers.push({ code: "pending_approvals", count: pendingApprovals })
  const [{ openReservations }] = await tx
    .select({ openReservations: count() })
    .from(budgetReservation)
    .where(
      and(
        eq(budgetReservation.tenantId, ctx.tenant.id),
        eq(budgetReservation.jobId, jobId),
        inArray(budgetReservation.state, ["reserved", "committed"])
      )
    )
  if (openReservations) blockers.push({ code: "open_commitments", count: openReservations })
  // Orders not yet reconciled or cancelled still commit money (order backbone).
  const [{ openOrders }] = await tx
    .select({ openOrders: count() })
    .from(purchaseOrder)
    .where(
      and(
        eq(purchaseOrder.tenantId, ctx.tenant.id),
        eq(purchaseOrder.jobId, jobId),
        notInArray(purchaseOrder.state, ["reconciled", "cancelled"])
      )
    )
  if (openOrders) blockers.push({ code: "open_orders", count: openOrders })
  const [{ unresolvedHours }] = await tx
    .select({ unresolvedHours: count() })
    .from(timesheet)
    .where(
      and(
        eq(timesheet.tenantId, ctx.tenant.id),
        eq(timesheet.jobId, jobId),
        inArray(timesheet.state, ["draft", "submitted"])
      )
    )
  if (unresolvedHours) blockers.push({ code: "unresolved_hours", count: unresolvedHours })
  // Supplier-invoice reconciliation and client collection checks belong to the
  // finance modules; until they expose a close check they are reported as
  // unverified instead of being assumed clean.
  const unverified = ["supplier_invoices_reconciled", "client_invoices_collected"]
  const closeReadiness = { ready: blockers.length === 0, blockers, unverified }

  if (blockers.length) {
    throw new DomainError("blocked_by_rule", "The job cannot be closed yet", {
      rule: "job_close_gate",
      blockers,
      unverified,
      close_readiness: closeReadiness,
    })
  }
  const [row] = await tx
    .update(job)
    .set({ state: "ready_to_close", closeReason: reason, revision: sql`${job.revision} + 1`, updatedAt: new Date(), updatedBy: ctx.user.id })
    .where(eq(job.id, j.id))
    .returning()
  return {
    result: {
      action: "request_close" as const,
      jobId: j.id,
      jobNumber: j.jobNumber,
      displayReference: j.displayReference,
      warnings: [] as string[],
      state: row!.state,
      unverified,
      job_proposal: { applicable: false, reason: "close_request" },
      job_code_check: { jobNumber: j.jobNumber, displayReference: j.displayReference },
      move_or_substitution_plan: NO_MOVE,
      close_readiness: closeReadiness,
      inactive_job_list: await inactiveJobs(tx, ctx.tenant.id, j.clientId),
      job_audit_note: { eventType: "job.close_requested", actorUserId: ctx.user.id, reason },
    },
    events: [
      {
        eventType: "job.close_requested",
        aggregateType: "job",
        aggregateId: j.id,
        aggregateRevision: row!.revision,
        jobId: j.id,
        payload: { reason, unverified },
      },
    ],
  }
}

// ── Clients (for selectors) ──

export async function listClients(ctx: AgencyContext) {
  return withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({
        id: client.id,
        name: client.name,
        code: client.code,
        productCode: client.productCode,
        billingCurrency: client.billingCurrency,
        country: client.country,
        state: client.state,
        updatedAt: client.updatedAt,
      })
      .from(client)
      .where(eq(client.tenantId, ctx.tenant.id))
      .orderBy(asc(client.name))
  )
}

/** Current revision of a job (fixtures and forms that bind expectedRevision). */
export async function getJobRevision(ctx: AgencyContext, jobId: string): Promise<number> {
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx.select({ revision: job.revision }).from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, jobId))).limit(1)
  )
  if (!rows[0]) throw new DomainError("not_found", "Job not found", { field: "job" })
  return rows[0].revision
}
