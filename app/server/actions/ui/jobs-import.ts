"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { agencyContextForApi } from "@/server/auth/request"
import { applyJobImport, previewJobImport, type JobImportPreview, type JobImportResult } from "@/server/domain/job-import"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

// Jobs desk import: preview (read-only validation of an uploaded CSV against
// the agency's published jobs import profile) and "Apply valid rows". The
// idempotency key is derived on the server from file id + profile revision;
// the browser never chooses it. Role, capability and tenant come from the
// session.

const Preview = z.object({ agencySlug: z.string().min(2).max(63), fileId: z.string().uuid() })
const Apply = Preview.extend({ profileRevision: z.number().int().min(1) })

export async function previewJobImportAction(input: z.infer<typeof Preview>): Promise<{ ok: true; data: JobImportPreview } | Failure> {
  try {
    const p = Preview.parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    return { ok: true, data: await previewJobImport(ctx, p.fileId) }
  } catch (e) {
    return toFailure(e)
  }
}

export async function applyValidJobImportAction(input: z.infer<typeof Apply>): Promise<{ ok: true; data: { result: JobImportResult; replayed: boolean } } | Failure> {
  try {
    const p = Apply.parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    const res = await applyJobImport(ctx, p.fileId, p.profileRevision)
    revalidatePath(`/a/${ctx.tenant.slug}/jobs`)
    return { ok: true, data: { result: res.result, replayed: res.replayed } }
  } catch (e) {
    return toFailure(e)
  }
}
