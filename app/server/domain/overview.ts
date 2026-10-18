import "server-only"

import { and, desc, eq, inArray } from "drizzle-orm"

import { divHalfUp } from "@/lib/money"
import type { AgencyContext } from "@/server/auth/context"
import { approvalRequest, attentionItem, businessEvent, job, appUser } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

import { getBusinessDate } from "./presenter"
import { computeProfitability, loadJobFinancials } from "./profitability"

// Overview KPIs share the definitions used by the dossier and reports:
// - active jobs: state in (open, in_progress) in the primary reporting group;
// - pending approvals: approval requests awaiting a decision;
// - pending billing: approved client billable (fee + managed media) of active
//   primary jobs not yet covered by issued demo invoices (billing handlers
//   arrive in instruction 2, so issued = 0 and the KPI says so);
// - projected margin: Σ(fee − forecast cost) / Σ fee over active primary jobs,
//   computed per job with the margin calculator, single currency only.

export async function getOverview(ctx: AgencyContext) {
  const asOf = await getBusinessDate()
  return withTenant(ctx.tenant.id, async (tx) => {
    const jobs = await tx
      .select()
      .from(job)
      .where(and(eq(job.tenantId, ctx.tenant.id), eq(job.reportingGroup, "primary")))
      .orderBy(desc(job.updatedAt))
    const active = jobs.filter((j) => j.state === "open" || j.state === "in_progress")
    const currencies = [...new Set(active.map((j) => j.currency))]
    const currency = currencies.length === 1 ? currencies[0]! : ctx.tenant.baseCurrency

    let feeSum = 0n
    let marginSum = 0n
    let billable = 0n
    const perJob = []
    for (const j of jobs) {
      const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
      const p = computeProfitability(fin, "forecast", ctx.tenant.slug)
      perJob.push({ job: j, p })
      if (active.includes(j) && j.currency === currency) {
        feeSum += p.agencyFeeMinor
        marginSum += p.marginMinor
        billable += p.agencyFeeMinor + p.managedMediaMinor
      }
    }
    const pendingApprovals = await tx
      .select({ id: approvalRequest.id })
      .from(approvalRequest)
      .where(and(eq(approvalRequest.tenantId, ctx.tenant.id), eq(approvalRequest.state, "awaiting_approval")))
    const attention = await tx
      .select({ item: attentionItem, jobName: job.name, jobRef: job.displayReference })
      .from(attentionItem)
      .leftJoin(job, and(eq(job.tenantId, attentionItem.tenantId), eq(job.id, attentionItem.jobId)))
      .where(and(eq(attentionItem.tenantId, ctx.tenant.id), inArray(attentionItem.state, ["open", "snoozed"])))
      .orderBy(desc(attentionItem.updatedAt))
    const activity = await tx
      .select({
        id: businessEvent.id,
        eventType: businessEvent.eventType,
        origin: businessEvent.origin,
        recordedAt: businessEvent.recordedAt,
        jobId: businessEvent.jobId,
        actor: appUser.displayName,
      })
      .from(businessEvent)
      .leftJoin(appUser, eq(appUser.id, businessEvent.actorUserId))
      .where(eq(businessEvent.tenantId, ctx.tenant.id))
      .orderBy(desc(businessEvent.seq))
      .limit(8)

    return {
      asOf,
      currency,
      mixedCurrencies: currencies.length > 1,
      kpis: {
        activeJobs: active.length,
        pendingApprovals: pendingApprovals.length,
        pendingBillingMinor: billable.toString(),
        issuedInvoicesMinor: "0",
        projectedMarginBps: feeSum === 0n ? null : Number(divHalfUp(marginSum * 10000n, feeSum)),
        projectedMarginMinor: marginSum.toString(),
      },
      attention: attention.map((a) => ({
        id: a.item.id,
        title: a.item.title as { en: string; es: string },
        severity: a.item.severity,
        kind: a.item.kind,
        state: a.item.state,
        effect: a.item.effect as Record<string, unknown>,
        ctaHref: a.item.ctaHref,
        ctaLabel: a.item.ctaLabel as { en: string; es: string },
        jobName: a.jobName,
        jobRef: a.jobRef,
        updatedAt: a.item.updatedAt.toISOString(),
      })),
      recentJobs: perJob.slice(0, 6).map(({ job: j, p }) => ({
        id: j.id,
        name: j.name,
        jobNumber: j.jobNumber,
        displayReference: j.displayReference,
        state: j.state,
        currency: j.currency,
        agencyFeeMinor: p.agencyFeeMinor.toString(),
        marginBps: p.marginBps,
        updatedAt: j.updatedAt.toISOString(),
      })),
      activity: activity.map((e) => ({ ...e, recordedAt: e.recordedAt.toISOString() })),
    }
  })
}
