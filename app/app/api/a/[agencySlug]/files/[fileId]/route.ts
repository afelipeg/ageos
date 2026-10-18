import { NextResponse, type NextRequest } from "next/server"
import { and, eq } from "drizzle-orm"

import { agencyContextForApi } from "@/server/auth/request"
import { businessEvent, fileObject } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { privateDisk } from "@/server/storage/private-disk"

// Authorized private download. Every request re-checks session, membership,
// permission and tenant ownership of the file; a file id from another agency
// returns 404 (RLS hides the row).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ agencySlug: string; fileId: string }> }) {
  const { agencySlug, fileId } = await params
  const ctx = await agencyContextForApi(agencySlug)
  if (!ctx || !ctx.permissions.has("files.read") || !/^[0-9a-f-]{36}$/i.test(fileId)) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 })
  }
  const file = await withTenant(ctx.tenant.id, async (tx) => {
    const [f] = await tx.select().from(fileObject).where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.id, fileId))).limit(1)
    if (!f) return null
    if (f.visibility === "restricted" && !["owner", "finance_approver"].includes(ctx.role)) return null
    await tx.insert(businessEvent).values({
      tenantId: ctx.tenant.id,
      eventType: "file.downloaded",
      aggregateType: "file",
      aggregateId: f.id,
      actorUserId: ctx.user.id,
      origin: "ui",
      jobId: f.jobId,
      payload: { name: f.originalName, version: f.version },
    })
    return f
  })
  if (!file) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 })
  const bytes = await privateDisk.get(ctx.tenant.id, file.storageKey)
  const safeName = file.originalName.replace(/[^A-Za-z0-9._-]/g, "_")
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${safeName}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  })
}
