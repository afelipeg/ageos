import type { NextRequest } from "next/server"
import { desc, eq } from "drizzle-orm"

import { fileObject } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { withAgencyApi } from "@/server/http/agency-api"
import { DomainError } from "@/server/kernel/errors"
import { canSeeFile } from "@/server/queries/library"

/** Library files the viewer may attach: this agency only, library visibility rule applied. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params
  return withAgencyApi(req, agencySlug, async (ctx) => {
    if (!ctx.permissions.has("files.read")) throw new DomainError("forbidden", "Your role cannot read library files", { permission: "files.read" })
    const rows = await withTenant(ctx.tenant.id, (tx) =>
      tx
        .select({ id: fileObject.id, name: fileObject.originalName, version: fileObject.version, format: fileObject.format, visibility: fileObject.visibility })
        .from(fileObject)
        .where(eq(fileObject.tenantId, ctx.tenant.id))
        .orderBy(desc(fileObject.createdAt))
        .limit(50)
    )
    return { files: rows.filter((r) => canSeeFile(ctx, r.visibility)).map((r) => ({ id: r.id, name: r.name, version: r.version, format: r.format })) }
  })
}
