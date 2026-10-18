import type { NextRequest } from "next/server"

import { storeUpload } from "@/server/actions/ui/library-upload"
import { withAgencyApi } from "@/server/http/agency-api"
import { DomainError } from "@/server/kernel/errors"
import { MAX_UPLOAD_BYTES } from "@/server/queries/library"

// Private upload (multipart). Session, membership and files.write are checked
// on the server; type, size, signature and quotas are validated before the
// bytes reach private storage. Cross-origin posts are rejected by the wrapper.
export async function POST(req: NextRequest, { params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params
  return withAgencyApi(req, agencySlug, async (ctx) => {
    const declared = Number(req.headers.get("content-length") ?? 0)
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new DomainError("validation", "Upload rejected: too_large", { rule: "too_large", field: "file" })
    const form = await req.formData().catch(() => null)
    const file = form?.get("file")
    if (!form || !(file instanceof File)) throw new DomainError("validation", "A file is required", { field: "file" })
    const job = String(form.get("job") ?? "") || null
    const logicalId = String(form.get("logicalId") ?? "") || null
    const bytes = new Uint8Array(await file.arrayBuffer())
    const res = await storeUpload(ctx, { name: file.name, bytes, jobId: job, logicalId })
    return { file: res, href: `/a/${ctx.tenant.slug}/library/${res.fileId}` }
  })
}
