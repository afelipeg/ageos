import "server-only"

import { and, desc, eq, inArray } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { fileObject } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { getClientDetail } from "@/server/domain/clients"

import { iso, userNames } from "./shared"

// Client record: the domain detail (client, jobs, contracts, briefs) plus the
// private files of its jobs, filtered by the same visibility rule as downloads.
export async function getClientRecord(ctx: AgencyContext, clientId: string) {
  const detail = await getClientDetail(ctx, clientId)
  if (!detail) return null
  const jobIds = detail.jobs.map((j) => j.id)
  const extra = await withTenant(ctx.tenant.id, async (tx) => {
    const files = jobIds.length
      ? await tx
          .select()
          .from(fileObject)
          .where(and(eq(fileObject.tenantId, ctx.tenant.id), inArray(fileObject.jobId, jobIds)))
          .orderBy(desc(fileObject.createdAt))
      : []
    const owners = await userNames(tx, [detail.client.ownerUserId])
    return { files, ownerName: detail.client.ownerUserId ? (owners.get(detail.client.ownerUserId) ?? null) : null }
  })
  return {
    ...detail,
    ownerName: extra.ownerName,
    files: extra.files
      .filter((f) => f.visibility !== "restricted" || ["owner", "finance_approver"].includes(ctx.role))
      .map((f) => ({
        id: f.id,
        originalName: f.originalName,
        format: f.format,
        version: f.version,
        extractionStatus: f.extractionStatus,
        jobId: f.jobId,
        createdAt: iso(f.createdAt),
      })),
  }
}
