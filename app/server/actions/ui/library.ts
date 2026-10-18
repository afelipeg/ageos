"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { agencyContextForApi } from "@/server/auth/request"
import { businessEvent, fileObject, job } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { linkEvidenceToJob } from "@/server/domain/evidence"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"
import { canSeeFile } from "@/server/queries/library"

// Links every version of a private document to one job of the same agency
// (or unlinks it). Tenant, membership, files.write and visibility are checked
// on the server; the change is audited with the previous and new job.

const Input = z.object({
  agencySlug: z.string().min(2).max(63),
  fileId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
})

export async function linkFileToJobAction(input: z.infer<typeof Input>): Promise<{ ok: true; data: { jobId: string | null; changed: boolean } } | Failure> {
  try {
    const p = Input.parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    if (!ctx.permissions.has("files.write")) throw new DomainError("forbidden", "Your role cannot change documents", { permission: "files.write" })
    const res = await withTenant(ctx.tenant.id, async (tx) => {
      const [f] = await tx.select().from(fileObject).where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.id, p.fileId))).for("update").limit(1)
      if (!f || !canSeeFile(ctx, f.visibility)) throw new DomainError("not_found", "File not found")
      let target: { jobId: string; clientId: string } | null = null
      if (p.jobId) {
        const [j] = await tx.select({ id: job.id, clientId: job.clientId }).from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, p.jobId))).limit(1)
        if (!j) throw new DomainError("not_found", "Job not found", { field: "job" })
        target = { jobId: j.id, clientId: j.clientId }
      }
      if (f.jobId === p.jobId) return { jobId: f.jobId, changed: false }
      await tx.update(fileObject).set({ jobId: p.jobId }).where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.logicalId, f.logicalId)))
      // Evidence wrapping this document follows the link (Core-1 rule).
      const { linked } = await linkEvidenceToJob(tx, ctx.tenant.id, f.logicalId, target)
      await tx.insert(businessEvent).values({
        tenantId: ctx.tenant.id,
        eventType: "file.linked_to_job",
        aggregateType: "file",
        aggregateId: f.id,
        aggregateRevision: f.version,
        actorUserId: ctx.user.id,
        origin: "ui",
        jobId: p.jobId ?? f.jobId,
        payload: { logicalId: f.logicalId, fromJobId: f.jobId, toJobId: p.jobId, evidenceLinked: linked },
      })
      return { jobId: p.jobId, changed: true }
    })
    revalidatePath(`/a/${ctx.tenant.slug}/library`, "layout")
    return { ok: true, data: res }
  } catch (e) {
    return toFailure(e)
  }
}
