import "server-only"

import { and, desc, eq, inArray } from "drizzle-orm"

import type { Localized } from "@/lib/capabilities/types"
import type { AgencyContext } from "@/server/auth/context"
import { appUser, attentionItem, job, membership, workflowRun } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { getCapability } from "@/server/capabilities/registry"
import { listApprovals } from "@/server/domain/approvals"

import { isUuid, iso } from "./shared"

// Inbox: one projection over three persisted sources — rule-driven attention
// items, approval requests and blocked capability runs. Opening an item goes
// to its evidence (the CTA, the approval or the run), never to an empty chat.

/**
 * Assign / snooze / resolve commands for attention items belong to the
 * attention domain service (Core-1). Until it exposes them, the inbox shows
 * the actions disabled with that reason instead of faking a result.
 */
export const INBOX_COMMANDS_AVAILABLE = false

export const INBOX_VIEWS = ["for-me", "approvals", "blocked", "all"] as const
export type InboxView = (typeof INBOX_VIEWS)[number]

export type InboxItem = {
  key: string
  source: "attention" | "approval" | "run"
  id: string
  title: Localized | string
  moduleKey: string | null
  jobId: string | null
  jobLabel: string | null
  state: string
  severity: string
  ownerId: string | null
  ownerName: string | null
  createdAt: string
  dueAt: string | null
  snoozedUntil: string | null
  href: string
  ctaLabel: Localized | null
  forMe: boolean
  blocked: boolean
  revision: number | null
}

export async function getInbox(ctx: AgencyContext, params: { view: InboxView; job?: string; owner?: string; module?: string }) {
  const base = `/a/${ctx.tenant.slug}`
  const approvals = await listApprovals(ctx)
  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const items = await tx.select().from(attentionItem).where(eq(attentionItem.tenantId, ctx.tenant.id)).orderBy(desc(attentionItem.updatedAt)).limit(200)
    const runs = await tx
      .select()
      .from(workflowRun)
      .where(and(eq(workflowRun.tenantId, ctx.tenant.id), inArray(workflowRun.state, ["blocked", "outcome_unknown", "awaiting_approval"])))
      .orderBy(desc(workflowRun.startedAt))
      .limit(50)
    const jobIds = [...new Set([...items.map((i) => i.jobId), ...runs.map((r) => r.jobId)].filter((v): v is string => !!v))]
    const jobs = jobIds.length ? await tx.select({ id: job.id, name: job.name, ref: job.displayReference }).from(job).where(and(eq(job.tenantId, ctx.tenant.id), inArray(job.id, jobIds))) : []
    const members = await tx
      .select({ id: appUser.id, name: appUser.displayName, role: membership.role })
      .from(membership)
      .innerJoin(appUser, eq(appUser.id, membership.userId))
      .where(and(eq(membership.tenantId, ctx.tenant.id), eq(membership.active, true)))
    return { items, runs, jobs, members }
  })
  const jobLabel = (id: string | null) => {
    const j = id ? data.jobs.find((x) => x.id === id) : null
    return j ? `${j.ref} · ${j.name}` : null
  }
  const nameOf = (id: string | null) => (id ? (data.members.find((m) => m.id === id)?.name ?? null) : null)

  const all: InboxItem[] = [
    ...data.items.map((i) => ({
      key: `attention:${i.id}`,
      source: "attention" as const,
      id: i.id,
      title: i.title as Localized,
      moduleKey: i.moduleKey,
      jobId: i.jobId,
      jobLabel: jobLabel(i.jobId),
      state: i.state,
      severity: i.severity,
      ownerId: i.assigneeUserId,
      ownerName: nameOf(i.assigneeUserId),
      createdAt: i.createdAt.toISOString(),
      dueAt: iso(i.dueAt),
      snoozedUntil: iso(i.snoozedUntil),
      href: i.ctaHref.startsWith(`${base}/`) ? i.ctaHref : base,
      ctaLabel: i.ctaLabel as Localized,
      forMe: i.assigneeUserId === ctx.user.id || (!i.assigneeUserId && ctx.role === "owner"),
      blocked: i.kind === "blocked",
      revision: i.revision,
    })),
    ...approvals
      .filter((a) => a.state === "awaiting_approval" || a.state === "approved")
      .map((a) => ({
        key: `approval:${a.id}`,
        source: "approval" as const,
        id: a.id,
        title: a.title,
        moduleKey: null,
        jobId: a.aggregateType === "job" ? a.aggregateId : null,
        jobLabel: a.aggregateType === "job" ? jobLabel(a.aggregateId) : null,
        state: a.state,
        severity: "approval",
        ownerId: null,
        ownerName: a.eligibleRoles.join(", "),
        createdAt: a.createdAt,
        dueAt: null,
        snoozedUntil: null,
        href: `${base}/approvals/${a.id}`,
        ctaLabel: null,
        forMe: a.canDecide,
        blocked: false,
        revision: null,
      })),
    ...data.runs.map((r) => {
      const cap = getCapability(r.skillId)
      return {
        key: `run:${r.id}`,
        source: "run" as const,
        id: r.id,
        title: cap?.contract.label ?? r.skillId,
        moduleKey: cap?.contract.moduleKey ?? null,
        jobId: r.jobId,
        jobLabel: jobLabel(r.jobId),
        state: r.state,
        severity: r.state === "outcome_unknown" ? "attention" : "blocked",
        ownerId: r.actorUserId,
        ownerName: nameOf(r.actorUserId),
        createdAt: r.startedAt.toISOString(),
        dueAt: null,
        snoozedUntil: null,
        href: `${base}/runs/${r.id}`,
        ctaLabel: null,
        forMe: r.actorUserId === ctx.user.id,
        blocked: true,
        revision: null,
      }
    }),
  ]

  const open = (i: InboxItem) => i.source !== "attention" || i.state !== "resolved"
  const inView = (i: InboxItem, v: InboxView) =>
    v === "all" ? true : v === "for-me" ? i.forMe && open(i) : v === "approvals" ? i.source === "approval" : i.blocked && open(i)
  const counts = Object.fromEntries(INBOX_VIEWS.map((v) => [v, all.filter((i) => inView(i, v)).length])) as Record<InboxView, number>
  const jobFilter = params.job && isUuid(params.job) ? params.job : undefined
  const owner = params.owner && isUuid(params.owner) ? params.owner : undefined
  const rows = all
    .filter((i) => inView(i, params.view))
    .filter((i) => !jobFilter || i.jobId === jobFilter)
    .filter((i) => !owner || i.ownerId === owner)
    .filter((i) => !params.module || i.moduleKey === params.module)
    .sort((a, b) => sevRank(a) - sevRank(b) || b.createdAt.localeCompare(a.createdAt))

  return {
    rows,
    counts,
    members: data.members,
    jobs: data.jobs.map((j) => ({ id: j.id, label: `${j.ref} · ${j.name}` })),
    filters: { job: jobFilter ?? null, owner: owner ?? null, module: params.module ?? null },
  }
}

function sevRank(i: InboxItem) {
  if (i.source === "attention" && i.state === "resolved") return 9
  return i.severity === "blocked" ? 0 : i.severity === "approval" ? 1 : i.severity === "attention" ? 2 : 3
}
