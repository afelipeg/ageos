import "server-only"

import { and, asc, desc, eq } from "drizzle-orm"

import type { FieldType } from "@/lib/capabilities/types"
import type { AgencyContext } from "@/server/auth/context"
import { appUser, client, connection, evidence, fileObject, job, membership, supplier, workflowRun } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

// Authorized option lists for reference fields (job, client, ...). Values are
// tenant-scoped ids; the server re-resolves them inside the tenant on submit.

export type RefOption = { value: string; label: string; detail?: string; revision?: number }
export type RefOptions = Partial<Record<FieldType, RefOption[]>>

export async function loadReferenceOptions(ctx: AgencyContext, types: FieldType[]): Promise<RefOptions> {
  const need = new Set(types)
  return withTenant(ctx.tenant.id, async (tx) => {
    const out: RefOptions = {}
    if (need.has("job")) {
      const rows = await tx
        .select({ id: job.id, name: job.name, ref: job.displayReference, number: job.jobNumber, revision: job.revision })
        .from(job)
        .where(eq(job.tenantId, ctx.tenant.id))
        .orderBy(asc(job.displayReference))
      out.job = rows.map((r) => ({ value: r.id, label: `${r.ref} · ${r.name}`, detail: r.number, revision: r.revision }))
    }
    if (need.has("client")) {
      const rows = await tx.select({ id: client.id, name: client.name, code: client.code }).from(client).where(and(eq(client.tenantId, ctx.tenant.id), eq(client.state, "active"))).orderBy(asc(client.name))
      out.client = rows.map((r) => ({ value: r.id, label: r.name, detail: r.code }))
    }
    if (need.has("supplier")) {
      const rows = await tx.select({ id: supplier.id, name: supplier.name }).from(supplier).where(eq(supplier.tenantId, ctx.tenant.id)).orderBy(asc(supplier.name))
      out.supplier = rows.map((r) => ({ value: r.id, label: r.name }))
    }
    if (need.has("connection")) {
      const rows = await tx.select({ id: connection.id, provider: connection.provider, alias: connection.accountAlias, state: connection.state }).from(connection).where(eq(connection.tenantId, ctx.tenant.id)).orderBy(asc(connection.provider))
      out.connection = rows.map((r) => ({ value: r.id, label: `${r.provider} · ${r.alias}`, detail: r.state }))
    }
    if (need.has("file")) {
      const rows = await tx.select({ id: fileObject.id, name: fileObject.originalName, version: fileObject.version }).from(fileObject).where(eq(fileObject.tenantId, ctx.tenant.id)).orderBy(desc(fileObject.createdAt))
      out.file = rows.map((r) => ({ value: r.id, label: r.name, detail: `v${r.version}` }))
    }
    if (need.has("evidence")) {
      // Value is the evidence id; the detail shows kind and review state so a
      // reviewer can tell reviewed evidence from received documents.
      const rows = await tx
        .select({ id: evidence.id, title: evidence.title, kind: evidence.kind, review: evidence.reviewState, revision: evidence.revision })
        .from(evidence)
        .where(eq(evidence.tenantId, ctx.tenant.id))
        .orderBy(desc(evidence.createdAt))
      out.evidence = rows.map((r) => ({ value: r.id, label: r.title, detail: `${r.kind} · ${r.review}`, revision: r.revision }))
    }
    if (need.has("member")) {
      const rows = await tx
        .select({ id: appUser.id, name: appUser.displayName, role: membership.role })
        .from(membership)
        .innerJoin(appUser, eq(appUser.id, membership.userId))
        .where(and(eq(membership.tenantId, ctx.tenant.id), eq(membership.active, true)))
      out.member = rows.map((r) => ({ value: r.id, label: r.name, detail: r.role }))
    }
    return out
  })
}

export async function recentRuns(ctx: AgencyContext, skillId: string | null, limit = 10) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const rows = await tx
      .select({ run: workflowRun, actor: appUser.displayName })
      .from(workflowRun)
      .leftJoin(appUser, eq(appUser.id, workflowRun.actorUserId))
      .where(skillId ? and(eq(workflowRun.tenantId, ctx.tenant.id), eq(workflowRun.skillId, skillId)) : eq(workflowRun.tenantId, ctx.tenant.id))
      .orderBy(desc(workflowRun.startedAt))
      .limit(limit)
    return rows.map((r) => ({
      id: r.run.id,
      skillId: r.run.skillId,
      state: r.run.state,
      origin: r.run.origin,
      actor: r.actor,
      startedAt: r.run.startedAt.toISOString(),
      finishedAt: r.run.finishedAt?.toISOString() ?? null,
      jobId: r.run.jobId,
    }))
  })
}
