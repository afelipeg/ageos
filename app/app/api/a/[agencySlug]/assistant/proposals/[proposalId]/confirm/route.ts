import type { NextRequest } from "next/server"
import { z } from "zod"

import { assistantDriver } from "@/server/assistant/driver"
import { assistantView } from "@/server/assistant/view"
import { readJson, withAgencyApi } from "@/server/http/agency-api"

const Body = z.object({ conversationId: z.string().uuid(), digest: z.string(), clientMessageId: z.string().uuid() }).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ agencySlug: string; proposalId: string }> }) {
  const { agencySlug, proposalId } = await params
  return withAgencyApi(req, agencySlug, async (ctx) => {
    const body = Body.parse(await readJson(req))
    const { conversationId } = await assistantDriver.confirm(ctx, { ...body, proposalId })
    return assistantView(ctx, conversationId)
  })
}
