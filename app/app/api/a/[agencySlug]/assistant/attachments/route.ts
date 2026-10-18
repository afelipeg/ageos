import type { NextRequest } from "next/server"
import { z } from "zod"

import { assistantDriver } from "@/server/assistant/driver"
import { assistantView } from "@/server/assistant/view"
import { readJson, withAgencyApi } from "@/server/http/agency-api"

const Body = z.object({ conversationId: z.string().uuid().nullable(), fileId: z.string().uuid(), clientMessageId: z.string().uuid() }).strict()

/** attach_authorized_file: cites a library file the viewer may read (same agency); never uploads. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params
  return withAgencyApi(req, agencySlug, async (ctx) => {
    const body = Body.parse(await readJson(req))
    const { conversationId } = await assistantDriver.attachFile(ctx, body)
    return assistantView(ctx, conversationId)
  })
}
