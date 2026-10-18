import type { NextRequest } from "next/server"
import { z } from "zod"

import { assistantView } from "@/server/assistant/view"
import { withAgencyApi } from "@/server/http/agency-api"

export async function GET(req: NextRequest, { params }: { params: Promise<{ agencySlug: string; conversationId: string }> }) {
  const { agencySlug, conversationId } = await params
  return withAgencyApi(req, agencySlug, (ctx) =>
    assistantView(ctx, z.string().uuid().parse(conversationId))
  )
}
