import "server-only"

import { and, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { divHalfUp } from "@/lib/money"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import { accountingPeriod, appUser, approvalRequest, membership, timesheet } from "@/server/db/schema"
import { createProposal, registerApprovalPolicy, requestApproval } from "@/server/kernel/approvals"
import { defineCommand, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { lockJob } from "./budget"
import { Decimal, IsoDate, Uuid, assertJobOpen, blocked, none, parseMoney } from "./media-planning"

// Timesheets (M03, Core-2): submit → kernel approval (aggregate `timesheet`)
// by a manager other than the author and the worker. Only approved hours are
// valued as labor cost; a rejected or duplicate entry never reaches billable
// or valued totals.

export const TIMESHEET_ACTION = "timesheet.approve"
// Hours are decided with time.approve (account managers included), never by
// the requester, the proposal creator, the entry's author or the worker.
export const TIMESHEET_POLICY = registerApprovalPolicy({
  id: "timesheet-approval-v1",
  revision: 1,
  decidePermission: "time.approve",
  excludedDeciders: async (tx, tenantId, approval) => {
    const [t] = await tx
      .select({ userId: timesheet.userId, createdBy: timesheet.createdBy })
      .from(timesheet)
      .where(and(eq(timesheet.tenantId, tenantId), eq(timesheet.id, approval.aggregateId)))
      .limit(1)
    return t ? [t.userId, t.createdBy] : []
  },
})
/** Roles with `time.approve`. The owner can also decide from the approvals inbox. */
export const TIMESHEET_APPROVERS = ["owner", "account_manager"] as const

const COUNTED = ["submitted", "approved", "locked"]
export const valueOf = (minutes: number, hourlyCostMinor: bigint) => divHalfUp(BigInt(minutes) * hourlyCostMinor, 60n)

async function jobTimesheets(tx: Tx, tenantId: string, jobId: string) {
  return tx.select().from(timesheet).where(and(eq(timesheet.tenantId, tenantId), eq(timesheet.jobId, jobId)))
}

function summarize(rows: (typeof timesheet.$inferSelect)[], currency: string) {
  const sumMin = (xs: typeof rows) => xs.reduce((s, t) => s + t.minutes, 0)
  const sumVal = (xs: typeof rows) => xs.reduce((s, t) => s + valueOf(t.minutes, t.hourlyCostMinor), 0n)
  const approved = rows.filter((t) => t.state === "approved" || t.state === "locked")
  const submitted = rows.filter((t) => t.state === "submitted")
  const rejected = rows.filter((t) => t.state === "rejected")
  return {
    currency,
    approvedMinutes: sumMin(approved),
    approvedValueMinor: sumVal(approved).toString(),
    pendingMinutes: sumMin(submitted),
    pendingValueMinor: sumVal(submitted).toString(),
    rejectedExcludedMinutes: sumMin(rejected),
    basis: "approved_hours_only",
  }
}

// ── agency-tasks-timesheets: submitTimesheet ──
export const SubmitTimesheetInput = z
  .object({
    job: Uuid,
    taskTitle: z.string().trim().min(2).max(160),
    member: Uuid,
    workDate: IsoDate,
    minutes: z.number().int().min(1).max(600000),
    hourlyCost: Decimal,
    notes: z.string().trim().max(500).optional(),
  })
  .strict()

export const submitTimesheet = defineCommand({
  type: "time.submitTimesheet",
  skillId: "agency-tasks-timesheets",
  permission: "time.log",
  input: SubmitTimesheetInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertJobOpen(j)
    const [m] = await tx
      .select({ userId: membership.userId, role: membership.role, name: appUser.displayName })
      .from(membership)
      .innerJoin(appUser, eq(appUser.id, membership.userId))
      .where(and(eq(membership.tenantId, ctx.tenant.id), eq(membership.userId, input.member), eq(membership.active, true)))
      .limit(1)
    if (!m) throw new DomainError("not_found", "Person not found in this agency", { field: "member" })
    if (input.member !== ctx.user.id && !ctx.permissions.has("time.approve")) {
      throw new DomainError("forbidden", "Only a manager can log time for another person", { permission: "time.approve" })
    }
    // Accounting periods (Core-3) gate time entry: closed or missing → blocked.
    const period = input.workDate.slice(0, 7)
    const [p] = await tx
      .select({ state: accountingPeriod.state })
      .from(accountingPeriod)
      .where(and(eq(accountingPeriod.tenantId, ctx.tenant.id), eq(accountingPeriod.period, period)))
      .limit(1)
    if (!p) blocked("period_not_open", "The accounting period of this date is not open", { workDate: input.workDate, period })
    if (p.state !== "open") blocked("period_closed", "Time cannot be logged in a closed period", { workDate: input.workDate, period, state: p.state })
    const hourly = parseMoney(input.hourlyCost, j.currency, "hourlyCost", { positive: true })
    const existing = await jobTimesheets(tx, ctx.tenant.id, j.id)
    const duplicate = existing.find(
      (t) =>
        COUNTED.includes(t.state) &&
        t.userId === input.member &&
        t.workDate === input.workDate &&
        t.minutes === input.minutes &&
        t.taskLabel.trim().toLowerCase() === input.taskTitle.toLowerCase()
    )
    if (duplicate) {
      blocked("duplicate_timesheet", "The same hours were already submitted for this person, task and date", { timesheetId: duplicate.id, state: duplicate.state })
    }
    const [row] = await tx
      .insert(timesheet)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        userId: input.member,
        taskLabel: input.taskTitle,
        workDate: input.workDate,
        minutes: input.minutes,
        hourlyCostMinor: hourly,
        currency: j.currency,
        state: "submitted",
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning()
    const valueMinor = valueOf(input.minutes, hourly)
    const payload = {
      action: TIMESHEET_ACTION,
      timesheetId: row!.id,
      timesheetRevision: row!.revision,
      jobId: j.id,
      member: input.member,
      workDate: input.workDate,
      minutes: input.minutes,
      hourlyCostMinor: hourly.toString(),
      valueMinor: valueMinor.toString(),
      currency: j.currency,
    }
    const proposal = await createProposal(
      tx,
      ctx,
      {
        actionType: TIMESHEET_ACTION,
        skillId: "agency-tasks-timesheets",
        aggregateType: "timesheet",
        aggregateId: row!.id,
        baseRevision: row!.revision,
        payload,
        diff: { state: { before: "submitted", after: "approved" } },
        impact: { laborValueMinor: valueMinor, currency: j.currency, basis: "approved_hours_only" },
        origin: meta.origin,
      },
      "awaiting_approval"
    )
    const { approval, events } = await requestApproval(tx, ctx, proposal, {
      policyId: TIMESHEET_POLICY.id,
      policyRevision: TIMESHEET_POLICY.revision,
      eligibleRoles: TIMESHEET_APPROVERS,
      title: `Hours ${m.name} · ${input.taskTitle}`,
      amountMinor: valueMinor,
      currency: j.currency,
      destination: `job:${j.jobNumber}`,
      expiresInHours: 24 * 30,
    })
    const rows = [...existing, row!]
    const queue = rows.filter((t) => t.state === "submitted")
    const memberRows = rows.filter((t) => t.userId === input.member && COUNTED.includes(t.state))
    return {
      result: {
        timesheetId: row!.id,
        state: row!.state,
        revision: row!.revision,
        valueMinor: valueMinor.toString(),
        currency: j.currency,
        proposalId: proposal.id,
        approvalId: approval.id,
        payloadDigest: proposal.payloadDigest,
        approval: { approvalId: approval.id, eligibleRoles: TIMESHEET_APPROVERS, excludes: ["author", "worker"] },
        task_actions: [{ task: input.taskTitle, member: m.name, action: "await_manager_approval", approvalId: approval.id }],
        task_delay_report: none("Tasks in the demo model have no due dates to compare."),
        timesheet_validation: { period, periodOpen: true, duplicate: false, member: m.name, minutes: input.minutes, hourlyCostMinor: hourly.toString(), notes: input.notes ?? null },
        hour_approval_queue: queue.map((t) => ({ timesheetId: t.id, task: t.taskLabel, workDate: t.workDate, minutes: t.minutes, valueMinor: valueOf(t.minutes, t.hourlyCostMinor).toString(), approvalId: t.id === row!.id ? approval.id : null })),
        hour_valuation: summarize(rows, j.currency),
        chargeability_report: [{ member: m.name, jobMinutes: memberRows.reduce((s, t) => s + t.minutes, 0), billable: j.reportingGroup === "primary", reportingGroup: j.reportingGroup }],
        timesheet_close_proposal: { period, pendingApprovals: queue.length, readyToLock: false, reason: "Submitted hours await approval." },
      },
      events: [
        {
          eventType: "timesheet.submitted",
          aggregateType: "timesheet",
          aggregateId: row!.id,
          aggregateRevision: row!.revision,
          jobId: j.id,
          payload: { member: input.member, task: input.taskTitle, workDate: input.workDate, minutes: input.minutes, hourlyCostMinor: hourly, notes: input.notes ?? null, approvalId: approval.id },
        },
        ...events.map((e) => ({ ...e, jobId: j.id })),
      ] as EmittedEvent[],
    }
  },
})

// ── Approval executor for `timesheet.approve` (kernel decision or deferred) ──
export async function applyTimesheetApproval(
  tx: Tx,
  ctx: AgencyContext,
  raw: Record<string, unknown>,
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const p = raw as { timesheetId: string; timesheetRevision: number }
  const [t] = await tx
    .select()
    .from(timesheet)
    .where(and(eq(timesheet.tenantId, ctx.tenant.id), eq(timesheet.id, p.timesheetId)))
    .for("update")
    .limit(1)
  if (!t || t.state !== "submitted" || t.revision !== p.timesheetRevision) {
    return { ok: false, code: "approval_stale", details: { timesheetId: p.timesheetId, state: t?.state ?? null } }
  }
  // The kernel excludes the requester; the worker is excluded here.
  if (t.userId === ctx.user.id || t.createdBy === ctx.user.id) return { ok: false, code: "self_approval", details: { rule: "approver_is_worker_or_author" } }
  if (mode === "check") return { ok: true, events: [] }
  const [u] = await tx
    .update(timesheet)
    .set({ state: "approved", approvedBy: ctx.user.id, updatedBy: ctx.user.id, revision: sql`${timesheet.revision} + 1` })
    .where(eq(timesheet.id, t.id))
    .returning()
  const valued = valueOf(t.minutes, t.hourlyCostMinor)
  return {
    ok: true,
    events: [
      {
        eventType: "timesheet.approved",
        aggregateType: "timesheet",
        aggregateId: t.id,
        aggregateRevision: u!.revision,
        jobId: t.jobId,
        payload: { minutes: t.minutes, valuedMinor: valued, currency: t.currency },
      },
    ],
  }
}

/**
 * Reject hook of `timesheet.approve` (runs inside the kernel decision): the
 * entry becomes rejected with the reason and is never valued. Idempotent: a
 * no-op once the entry is no longer the submitted revision that was proposed.
 */
export async function rejectTimesheet(tx: Tx, ctx: AgencyContext, raw: Record<string, unknown>, reason: string): Promise<{ events: EmittedEvent[] }> {
  const p = raw as { timesheetId: string; timesheetRevision: number }
  const [t] = await tx
    .select()
    .from(timesheet)
    .where(and(eq(timesheet.tenantId, ctx.tenant.id), eq(timesheet.id, p.timesheetId)))
    .for("update")
    .limit(1)
  if (!t || t.state !== "submitted" || t.revision !== p.timesheetRevision) return { events: [] }
  const [u] = await tx
    .update(timesheet)
    .set({ state: "rejected", decisionReason: reason, updatedBy: ctx.user.id, revision: sql`${timesheet.revision} + 1` })
    .where(eq(timesheet.id, t.id))
    .returning()
  return {
    events: [
      { eventType: "timesheet.rejected", aggregateType: "timesheet", aggregateId: t.id, aggregateRevision: u!.revision, jobId: t.jobId, payload: { minutes: t.minutes, reason } },
    ],
  }
}

// ── Hours queue decision from the timesheet view ──
// Thin wrapper over the kernel decision (approvals.decide command handler):
// policy permission time.approve, eligible roles, separation of duties
// (requester, creator, author, worker), freshness and the execution gate all
// live in the kernel. This only locates the pending approval of the entry.
export const DecideTimesheetInput = z
  .object({
    timesheet: Uuid,
    revision: z.number().int().min(1),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()

export const decideTimesheet = defineCommand({
  type: "time.decideTimesheet",
  skillId: "agency-tasks-timesheets",
  permission: "time.approve",
  input: DecideTimesheetInput,
  handler: async (tx, ctx, input, meta) => {
    const tenantId = ctx.tenant.id
    const [t] = await tx
      .select()
      .from(timesheet)
      .where(and(eq(timesheet.tenantId, tenantId), eq(timesheet.id, input.timesheet)))
      .for("update")
      .limit(1)
    if (!t) throw new DomainError("not_found", "Timesheet not found")
    if (t.revision !== input.revision) throw new DomainError("revision_conflict", "This timesheet changed", { expectedRevision: input.revision, currentRevision: t.revision })
    if (t.state !== "submitted") blocked("timesheet_not_pending", "Only submitted hours can be decided", { state: t.state })
    const [approval] = await tx
      .select()
      .from(approvalRequest)
      .where(
        and(
          eq(approvalRequest.tenantId, tenantId),
          eq(approvalRequest.aggregateType, "timesheet"),
          eq(approvalRequest.aggregateId, t.id),
          eq(approvalRequest.actionType, TIMESHEET_ACTION),
          eq(approvalRequest.state, "awaiting_approval")
        )
      )
      .orderBy(desc(approvalRequest.createdAt))
      .limit(1)
    if (!approval) blocked("approval_not_pending", "These hours have no pending approval", { timesheetId: t.id })
    const { decideApprovalCommand } = await import("./approvals")
    const decided = await decideApprovalCommand.handler(
      tx,
      ctx,
      { approvalId: approval.id, decision: input.decision, reason: input.reason ?? null, reviewedDigest: approval.payloadDigest },
      meta
    )
    // An approval reason is kept on the entry too (rejections record it in the hook).
    if (decided.result.executed && input.reason) await tx.update(timesheet).set({ decisionReason: input.reason }).where(eq(timesheet.id, t.id))
    const rows = await jobTimesheets(tx, tenantId, t.jobId)
    const now = rows.find((r) => r.id === t.id)!
    return {
      result: {
        timesheetId: t.id,
        approvalId: approval.id,
        outcome: decided.result.outcome as string,
        executed: decided.result.executed,
        blockedCode: decided.result.blockedCode,
        state: now.state,
        revision: now.revision,
        valuedMinor: (now.state === "approved" ? valueOf(t.minutes, t.hourlyCostMinor) : 0n).toString(),
        currency: t.currency,
        hour_valuation: summarize(rows, t.currency),
        hour_approval_queue: rows.filter((r) => r.state === "submitted").map((r) => ({ timesheetId: r.id, task: r.taskLabel, minutes: r.minutes })) as unknown[],
      },
      events: decided.events.map((e) => ({ ...e, jobId: e.jobId ?? t.jobId })),
    }
  },
})
