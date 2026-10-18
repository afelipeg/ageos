import type { NextRequest } from "next/server"
import { z } from "zod"

import { assistantDriver } from "@/server/assistant/driver"
import { assistantView } from "@/server/assistant/view"
import { readJson, withAgencyApi } from "@/server/http/agency-api"

export async function POST(req: NextRequest, { params }: { params: Promise<{ agencySlug: string; runId: string }> }) {
  const { agencySlug, runId } = await params
  return withAgencyApi(req, agencySlug, async (ctx) => {
    const body = z.object({ conversationId: z.string().uuid() }).strict().parse(await readJson(req))
    const { conversationId } = await assistantDriver.cancel(ctx, { conversationId: body.conversationId, runId })
    return assistantView(ctx, conversationId)
  })
}
