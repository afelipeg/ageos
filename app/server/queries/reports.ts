import "server-only"

import { and, eq } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { managementReport } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

import { isUuid } from "./shared"

// Persisted management report (agency-management-reporting output) exactly
// as stored: cut-off, definitions, source manifest and totals.
export async function getManagementReport(ctx: AgencyContext, reportId: string) {
  if (!isUuid(reportId) || !ctx.permissions.has("reports.view")) return null
  const [r] = await withTenant(ctx.tenant.id, (tx) =>
    tx.select().from(managementReport).where(and(eq(managementReport.tenantId, ctx.tenant.id), eq(managementReport.id, reportId))).limit(1)
  )
  if (!r) return null
  return {
    id: r.id,
    title: r.title,
    period: r.period,
    basis: r.basis,
    currency: r.currency,
    cutOff: r.cutOff,
    snapshotSeq: r.snapshotSeq,
    definitions: r.definitions,
    sources: r.sources,
    totals: r.totals,
    content: r.content,
    exportFileId: r.exportFileId,
    synthetic: r.synthetic,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
  }
}
