// @vitest-environment node
import { randomUUID } from "node:crypto"

import type { AgencyContext } from "@/server/auth/context"
import { assistantDriver } from "@/server/assistant/driver"
import { assistantView } from "@/server/assistant/view"

import { closeOwnerDb, ctxFor, resetDemo } from "./helpers"
import { setMembershipRole } from "./qa-helpers"

// Audit regression B08 (07 §A15): persisted assistant answers are
// re-authorized on read (server/assistant/view.ts, the projection every
// assistant route returns). After the owner of a thread loses `reports.view`,
// reloading the thread must not resend the margin figures or their sources;
// restoring the permission shows them again.

const CONTEXT = { route: "/a/rayo-de-sol", moduleKey: null, record: null }

function marginParts(view: Awaited<ReturnType<typeof assistantView>>) {
  return view.messages.flatMap((m) => m.parts).filter((p) => p.type === "margin_result")
}

async function askMargin(ctx: AgencyContext) {
  const { conversationId } = await assistantDriver.handleTurn(ctx, {
    conversationId: null,
    clientMessageId: randomUUID(),
    presetId: "preset.margin.aurora",
    context: CONTEXT,
  })
  return conversationId
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await setMembershipRole("user_demo_viewer", "tenant_demo_rayo", "viewer")
  await closeOwnerDb()
})

describe("B08 · revoked permission hides persisted assistant results", () => {
  it("margin figures disappear from history after reports.view is revoked and return when restored", async () => {
    const viewer = await ctxFor("user_demo_viewer")
    expect(viewer.permissions.has("reports.view")).toBe(true)
    const conversationId = await askMargin(viewer)
    const before = await assistantView(viewer, conversationId)
    const [margin] = marginParts(before) as { agencyFeeMinor: string; marginMinor: string }[]
    expect(margin, "precondition: the viewer received a margin answer").toBeDefined()
    const fee = margin!.agencyFeeMinor
    const marginMinor = margin!.marginMinor

    // producer keeps assistant.use but has no reports.view.
    await setMembershipRole("user_demo_viewer", "tenant_demo_rayo", "producer")
    try {
      const demoted = await ctxFor("user_demo_viewer")
      expect(demoted.permissions.has("reports.view")).toBe(false)
      expect(demoted.permissions.has("assistant.use")).toBe(true)
      const after = await assistantView(demoted, conversationId)
      expect(marginParts(after), "margin_result parts must not be resent").toEqual([])
      const serialized = JSON.stringify(after)
      expect(serialized).not.toContain(`"${fee}"`)
      expect(serialized).not.toContain(`"${marginMinor}"`)
      const sources = after.messages.flatMap((m) => m.parts).filter((p) => p.type === "sources")
      expect(sources, "restricted source references must not be resent").toEqual([])
      const restricted = after.messages.flatMap((m) => m.parts).filter((p) => p.type === "restricted")
      expect(restricted.length, "a restricted marker replaces the hidden content").toBeGreaterThan(0)
    } finally {
      await setMembershipRole("user_demo_viewer", "tenant_demo_rayo", "viewer")
    }

    const restored = await assistantView(await ctxFor("user_demo_viewer"), conversationId)
    expect(marginParts(restored)).toHaveLength(1)
  })

  it("the thread stays owner-scoped: another member of the same agency cannot open it", async () => {
    const viewer = await ctxFor("user_demo_viewer")
    const conversationId = await askMargin(viewer)
    const finance = await ctxFor("user_demo_finance")
    await expect(assistantView(finance, conversationId)).rejects.toMatchObject({ code: "not_found" })
  })
})
