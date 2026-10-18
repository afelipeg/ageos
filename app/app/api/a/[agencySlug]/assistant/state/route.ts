import type { NextRequest } from "next/server"
import { z } from "zod"

import { assistantView } from "@/server/assistant/view"
import { withAgencyApi } from "@/server/http/agency-api"

/**
 * Current assistant state. `?thread=<id>` selects an owned conversation; an id
 * that is malformed, foreign or from another agency gets the same not_found
 * as a missing one — never a fallback to another thread.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params
  const thread = req.nextUrl.searchParams.get("thread")
  return withAgencyApi(req, agencySlug, (ctx) => {
    if (thread === null) return assistantView(ctx, null)
    const id = z.string().uuid().safeParse(thread)
    return assistantView(ctx, id.success ? id.data : "00000000-0000-0000-0000-000000000000")
  })
}
