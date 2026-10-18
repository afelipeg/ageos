import "server-only"

import type { AgencyContext } from "@/server/auth/context"

import { assistantDriver } from "./driver"
import { scenarioById } from "./scenarios"
import { conversationView } from "./store"

/**
 * The one projection every assistant route returns (re-authorized per read).
 * `viewerId` lets the client key drafts and selection by agency + user.
 */
export async function assistantView(ctx: AgencyContext, conversationId: string | null) {
  const view = await conversationView(ctx, conversationId, assistantDriver.suggestions(ctx), (id, version) => scenarioById(id, version) ?? scenarioById(id))
  return { ...view, viewerId: ctx.user.id }
}
