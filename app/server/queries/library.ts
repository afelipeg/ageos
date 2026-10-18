import "server-only"

import { and, asc, desc, eq, sql } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import { appUser, businessEvent, configurationRevision, fileObject, job } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

import { isUuid, iso, userNames } from "./shared"

// Private library projections. Every row is tenant-scoped; restricted files
// are visible only to the roles the download route allows. Extraction status
// is reported exactly as stored: "stored" never means "analyzed".

export const FILE_FORMATS = ["pdf", "docx", "xlsx", "csv"] as const
export type FileFormat = (typeof FILE_FORMATS)[number]
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const FALLBACK_LIMITS = { storageMb: 100, filesPerJob: 50 }

export function canSeeFile(ctx: AgencyContext, visibility: string) {
  return visibility !== "restricted" || ["owner", "finance_approver"].includes(ctx.role)
}

/** Demo limits from the published configuration (sample quotas, never prices). */
export async function libraryLimits(tx: Tx, ctx: AgencyContext) {
  const limits = { ...FALLBACK_LIMITS }
  if (ctx.tenant.publishedConfigRevisionId) {
    const [cfg] = await tx
      .select({ limits: configurationRevision.limits })
      .from(configurationRevision)
      .where(and(eq(configurationRevision.tenantId, ctx.tenant.id), eq(configurationRevision.id, ctx.tenant.publishedConfigRevisionId)))
      .limit(1)
    const l = (cfg?.limits ?? {}) as { storageMb?: unknown; filesPerJob?: unknown }
    if (typeof l.storageMb === "number" && l.storageMb > 0) limits.storageMb = l.storageMb
    if (typeof l.filesPerJob === "number" && l.filesPerJob > 0) limits.filesPerJob = l.filesPerJob
  }
  const [{ bytes, files }] = await tx
    .select({ bytes: sql<string>`coalesce(sum(${fileObject.sizeBytes}), 0)`, files: sql<string>`count(*)` })
    .from(fileObject)
    .where(eq(fileObject.tenantId, ctx.tenant.id))
  return { ...limits, usedBytes: Number(bytes), fileCount: Number(files) }
}

export async function listLibrary(ctx: AgencyContext, params: { job?: string; format?: string; status?: string; q?: string }) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const rows = await tx
      .select({ f: fileObject, jobName: job.name, jobRef: job.displayReference })
      .from(fileObject)
      .leftJoin(job, and(eq(job.tenantId, fileObject.tenantId), eq(job.id, fileObject.jobId)))
      .where(eq(fileObject.tenantId, ctx.tenant.id))
      .orderBy(desc(fileObject.createdAt))
    const visible = rows.filter((r) => canSeeFile(ctx, r.f.visibility))
    // One row per logical document: its latest version plus the version count.
    const latest = new Map<string, (typeof visible)[number] & { versions: number }>()
    for (const r of visible) {
      const cur = latest.get(r.f.logicalId)
      if (!cur) latest.set(r.f.logicalId, { ...r, versions: 1 })
      else {
        cur.versions += 1
        if (r.f.version > cur.f.version) latest.set(r.f.logicalId, { ...r, versions: cur.versions })
      }
    }
    const names = await userNames(tx, [...latest.values()].map((r) => r.f.uploadedBy))
    const jobs = await tx.select({ id: job.id, name: job.name, ref: job.displayReference }).from(job).where(eq(job.tenantId, ctx.tenant.id)).orderBy(asc(job.displayReference))
    const q = (params.q ?? "").trim().toLowerCase()
    const all = [...latest.values()].map((r) => ({
      id: r.f.id,
      logicalId: r.f.logicalId,
      originalName: r.f.originalName,
      format: r.f.format,
      sizeBytes: r.f.sizeBytes,
      version: r.f.version,
      versions: r.versions,
      extractionStatus: r.f.extractionStatus,
      synthetic: r.f.synthetic,
      visibility: r.f.visibility,
      jobId: r.f.jobId,
      jobLabel: r.jobRef ? `${r.jobRef} · ${r.jobName}` : null,
      uploadedBy: r.f.uploadedBy ? (names.get(r.f.uploadedBy) ?? null) : null,
      createdAt: r.f.createdAt.toISOString(),
    }))
    const filtered = all
      .filter((r) => !params.job || (params.job === "none" ? !r.jobId : r.jobId === params.job))
      .filter((r) => !params.format || r.format === params.format)
      .filter((r) => !params.status || r.extractionStatus === params.status)
      .filter((r) => !q || r.originalName.toLowerCase().includes(q) || (r.jobLabel ?? "").toLowerCase().includes(q))
    const limits = await libraryLimits(tx, ctx)
    return { rows: filtered, total: all.length, jobs: jobs.map((j) => ({ id: j.id, label: `${j.ref} · ${j.name}` })), limits }
  })
}

export async function getFileView(ctx: AgencyContext, fileId: string) {
  if (!isUuid(fileId)) return null
  return withTenant(ctx.tenant.id, async (tx) => {
    const [f] = await tx.select().from(fileObject).where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.id, fileId))).limit(1)
    if (!f || !canSeeFile(ctx, f.visibility)) return null
    const versions = await tx
      .select()
      .from(fileObject)
      .where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.logicalId, f.logicalId)))
      .orderBy(desc(fileObject.version))
    const names = await userNames(tx, versions.map((v) => v.uploadedBy))
    const [j] = f.jobId ? await tx.select({ id: job.id, name: job.name, ref: job.displayReference }).from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, f.jobId))).limit(1) : []
    const events = await tx
      .select({ id: businessEvent.id, eventType: businessEvent.eventType, origin: businessEvent.origin, recordedAt: businessEvent.recordedAt, actor: appUser.displayName, payload: businessEvent.payload, aggregateId: businessEvent.aggregateId })
      .from(businessEvent)
      .leftJoin(appUser, eq(appUser.id, businessEvent.actorUserId))
      .where(and(eq(businessEvent.tenantId, ctx.tenant.id), eq(businessEvent.aggregateType, "file")))
      .orderBy(desc(businessEvent.seq))
      .limit(200)
    const ids = new Set(versions.map((v) => v.id))
    const jobs = await tx.select({ id: job.id, name: job.name, ref: job.displayReference }).from(job).where(eq(job.tenantId, ctx.tenant.id)).orderBy(asc(job.displayReference))
    return {
      file: {
        id: f.id,
        logicalId: f.logicalId,
        originalName: f.originalName,
        format: f.format,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        sha256: f.sha256,
        version: f.version,
        extractionStatus: f.extractionStatus,
        extraction: (f.extraction ?? null) as Record<string, unknown> | null,
        synthetic: f.synthetic,
        visibility: f.visibility,
        fixtureKey: f.fixtureKey,
        uploadedBy: f.uploadedBy ? (names.get(f.uploadedBy) ?? null) : null,
        createdAt: f.createdAt.toISOString(),
      },
      latestId: versions[0]?.id ?? f.id,
      versions: versions.map((v) => ({ id: v.id, version: v.version, sizeBytes: v.sizeBytes, sha256: v.sha256, extractionStatus: v.extractionStatus, uploadedBy: v.uploadedBy ? (names.get(v.uploadedBy) ?? null) : null, createdAt: iso(v.createdAt)! })),
      job: j ?? null,
      jobs: jobs.map((x) => ({ id: x.id, label: `${x.ref} · ${x.name}` })),
      events: events.filter((e) => e.aggregateId && ids.has(e.aggregateId)).map((e) => ({ id: e.id, eventType: e.eventType, origin: e.origin, actor: e.actor, recordedAt: e.recordedAt.toISOString(), payload: e.payload as Record<string, unknown> })),
    }
  })
}
