import type { NextRequest } from "next/server"

import { assistantDriver, TurnSchema } from "@/server/assistant/driver"
import { assistantView } from "@/server/assistant/view"
import { readJson, withAgencyApi } from "@/server/http/agency-api"

export async function POST(req: NextRequest, { params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params
  return withAgencyApi(req, agencySlug, async (ctx) => {
    const input = TurnSchema.parse(await readJson(req))
    const { conversationId } = await assistantDriver.handleTurn(ctx, input)
    return assistantView(ctx, conversationId)
  })
}
