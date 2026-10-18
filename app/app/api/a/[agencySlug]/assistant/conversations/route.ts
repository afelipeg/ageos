import type { NextRequest } from "next/server"

import { createConversation } from "@/server/assistant/store"
import { assistantView } from "@/server/assistant/view"
import { withTenant } from "@/server/db/tenant"
import { withAgencyApi } from "@/server/http/agency-api"

/** New conversation: starts an empty thread; never resets ERP records. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params
  return withAgencyApi(req, agencySlug, async (ctx) => {
    const conv = await withTenant(ctx.tenant.id, (tx) => createConversation(tx, ctx, ctx.user.locale === "es" ? "Nueva conversación" : "New conversation"))
    return assistantView(ctx, conv.id)
  })
}
