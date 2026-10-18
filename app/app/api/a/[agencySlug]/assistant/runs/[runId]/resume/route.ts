import type { NextRequest } from "next/server"
import { z } from "zod"

import { assistantDriver } from "@/server/assistant/driver"
import { assistantView } from "@/server/assistant/view"
import { readJson, withAgencyApi } from "@/server/http/agency-api"

/**
 * Reconciles a run left `running` without a live worker (lost response, crash
 * or step budget). Owner-only; continues from the last checkpoint with the
 * same idempotency keys, so committed effects are replayed, never repeated.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ agencySlug: string; runId: string }> }) {
  const { agencySlug, runId } = await params
  return withAgencyApi(req, agencySlug, async (ctx) => {
    const body = z.object({ conversationId: z.string().uuid() }).strict().parse(await readJson(req))
    const { conversationId } = await assistantDriver.resume(ctx, { conversationId: body.conversationId, runId: z.string().uuid().parse(runId) })
    return assistantView(ctx, conversationId)
  })
}
