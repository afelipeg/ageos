import "server-only"

import { and, asc, eq, ilike } from "drizzle-orm"

import { MARGIN_FLOOR_BPS } from "@/lib/demo"
import { marginDashboardView } from "@/lib/assistant/openui-compose"
import type { MessagePart, SourceRefView } from "@/lib/assistant/types"
import type { AgencyContext } from "@/server/auth/context"
import { job } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { DomainError } from "@/server/kernel/errors"

import { text } from "./scenario-types"

// Helpers shared by the featured scenarios and the ERP skill scenarios.

export async function findJobByName(ctx: AgencyContext, prefix: string) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ id: job.id })
      .from(job)
      .where(and(eq(job.tenantId, ctx.tenant.id), ilike(job.name, `${prefix}%`), eq(job.reportingGroup, "primary")))
      .orderBy(asc(job.createdAt))
      .limit(1)
    return row?.id ?? null
  })
}

export async function authorizedJob(ctx: AgencyContext, jobId: string | null) {
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) return null
  return withTenant(ctx.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ id: job.id, name: job.name, jobNumber: job.jobNumber, displayReference: job.displayReference, revision: job.revision, currency: job.currency })
      .from(job)
      .where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, jobId)))
      .limit(1)
    return row ?? null
  })
}

export type ProfitOutput = {
  jobId: string
  jobRevision: number
  basis: string
  asOf: string
  currency: string
  agencyFeeMinor: string
  managedMediaMinor: string
  agencyCost: { laborMinutes: number; laborMinor: string; productionMinor: string; expenseMinor: string; totalMinor: string }
  marginMinor: string
  marginBps: number | null
  definition: string
  sources: SourceRefView[]
}

/** Margin card + dashboard + sources from a profitability output (shared with ERP-39). */
export async function marginParts(ctx: AgencyContext, skillId: string, p: ProfitOutput): Promise<MessagePart[]> {
  const j = await authorizedJob(ctx, p.jobId)
  if (!j) throw new DomainError("not_found", "Job no longer available")
  const href = `/a/${ctx.tenant.slug}/jobs/${j.id}`
  const below = p.marginBps !== null && p.marginBps < MARGIN_FLOOR_BPS
  const refs: SourceRefView[] = [
    { recordType: "job", recordId: j.id, revision: j.revision, label: `${j.displayReference} · ${j.jobNumber}`, href, asOf: p.asOf, basis: p.basis, currency: p.currency },
    ...(p.sources ?? []),
  ]
  return [
    {
      type: "margin_result",
      job: { id: j.id, name: j.name, jobNumber: j.jobNumber, displayReference: j.displayReference, href },
      basis: p.basis,
      asOf: p.asOf,
      currency: p.currency,
      agencyFeeMinor: p.agencyFeeMinor,
      agencyCostMinor: p.agencyCost.totalMinor,
      managedMediaMinor: p.managedMediaMinor,
      marginMinor: p.marginMinor,
      marginBps: p.marginBps,
      laborMinutes: p.agencyCost.laborMinutes,
      definition: p.definition,
      jobRevision: p.jobRevision,
    },
    marginDashboardView({
      skillId,
      job: { name: j.name, displayReference: j.displayReference, jobNumber: j.jobNumber, revision: p.jobRevision },
      profit: p,
      floorBps: MARGIN_FLOOR_BPS,
      sources: refs,
    }),
    text(below ? "assistant.margin.belowFloor" : "assistant.margin.aboveFloor", { job: j.name, floor: "40%" }),
    { type: "sources", refs },
  ]
}

/** Only the business rule id travels to the browser (never internal details). */
export function ruleDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined
  const out: Record<string, unknown> = {}
  for (const k of ["rule", "permission", "field", "reason", "skillId"]) if (typeof details[k] === "string") out[k] = details[k]
  return Object.keys(out).length ? out : undefined
}

