// @vitest-environment node
import { vi } from "vitest"

import { runCapabilityAction } from "@/server/actions/capabilities"
import { decideCapabilityChangeAction, proposeCapabilityChangeAction } from "@/server/actions/ui/configuration"
import { reviewEvidenceAction } from "@/server/actions/ui/evidence"
import { SESSION_COOKIE, createSession } from "@/server/auth/session"
import { listConfigurationRevisions } from "@/server/domain/configuration"

import { closeOwnerDb, ctxFor, id, key, resetDemo } from "./helpers"

// J01.10/J01.11 and J04.5/J04.6 through the exact server actions their screens
// call (catalog CapabilityChangeDialog / PendingCapabilityChange, record-detail
// EvidenceReview, workflow workbench), each persona with a real session cookie.

const jar = new Map<string, string>()
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}))
// revalidatePath needs a Next request store; record the calls instead.
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath }))

const SLUG = "rayo-de-sol"
const OOH = "agency-ooh-inventory"

async function signInAs(userKey: string) {
  jar.clear()
  const { token } = await createSession({ userId: id(userKey), presenterUserId: null })
  jar.set(SESSION_COOKIE, token)
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("J01.10/J01.11 capability change through the catalog actions (D18)", () => {
  it("an account manager proposes; the requester cannot decide; another owner approves the exact digest and publishes", async () => {
    const before = (await listConfigurationRevisions(await ctxFor("user_demo_owner"))).find((r) => r.published)!

    await signInAs("user_demo_operator")
    const mandatory = await proposeCapabilityChangeAction({ agencySlug: SLUG, enable: [], disable: ["agency-access-governance"], reason: "Try a mandatory control", expectedRevision: before.number, idempotencyKey: key("ui-cap-mandatory") })
    expect(mandatory).toMatchObject({ ok: false, error: { code: "blocked_by_rule", details: { rule: "mandatory_capability" } } })
    const proposed = await proposeCapabilityChangeAction({ agencySlug: SLUG, enable: [], disable: [OOH], reason: "No OOH inventory this quarter", expectedRevision: before.number, idempotencyKey: key("ui-cap-propose") })
    if (!proposed.ok) throw new Error(`propose failed: ${proposed.error.code}`)
    expect(proposed.data.number).toBeGreaterThan(before.number)
    expect(revalidatePath).toHaveBeenCalledWith(`/a/${SLUG}`, "layout")

    // What the catalog renders for each persona (digest + canDecide).
    const asOperator = (await listConfigurationRevisions(await ctxFor("user_demo_operator"))).find((r) => r.id === proposed.data.revisionId)!
    const asOwner = (await listConfigurationRevisions(await ctxFor("user_demo_owner"))).find((r) => r.id === proposed.data.revisionId)!
    expect(asOperator).toMatchObject({ state: "awaiting_approval", canDecide: false, diff: { enabled: [], disabled: [OOH] } })
    expect(asOwner.canDecide).toBe(true)
    expect(asOwner.payloadDigest).toMatch(/^[0-9a-f]{64}$/)

    const selfDecide = await decideCapabilityChangeAction({ agencySlug: SLUG, revisionId: proposed.data.revisionId, decision: "approve", reviewedDigest: asOwner.payloadDigest!, idempotencyKey: key("ui-cap-self") })
    expect(selfDecide).toMatchObject({ ok: false, error: { code: "forbidden" } })

    await signInAs("user_demo_owner")
    const decided = await decideCapabilityChangeAction({ agencySlug: SLUG, revisionId: proposed.data.revisionId, decision: "approve", reviewedDigest: asOwner.payloadDigest!, idempotencyKey: key("ui-cap-approve") })
    expect(decided).toEqual({ ok: true, data: { outcome: "published" } })

    const owner = await ctxFor("user_demo_owner")
    expect(owner.enabledCapabilities.has(OOH)).toBe(false)
    const revs = await listConfigurationRevisions(owner)
    expect(revs.find((r) => r.id === proposed.data.revisionId)).toMatchObject({ state: "ready", published: true })
    expect(revs.find((r) => r.id === before.id)?.state).toBe("superseded") // history kept

    // An owner who proposes cannot approve their own change either.
    const own = await proposeCapabilityChangeAction({ agencySlug: SLUG, enable: [OOH], disable: [], reason: "Re-enable OOH inventory", expectedRevision: proposed.data.number, idempotencyKey: key("ui-cap-own") })
    if (!own.ok) throw new Error(`propose failed: ${own.error.code}`)
    const ownDigest = (await listConfigurationRevisions(owner)).find((r) => r.id === own.data.revisionId)!.payloadDigest!
    const ownDecide = await decideCapabilityChangeAction({ agencySlug: SLUG, revisionId: own.data.revisionId, decision: "approve", reviewedDigest: ownDigest, idempotencyKey: key("ui-cap-own-decide") })
    expect(ownDecide).toMatchObject({ ok: false, error: { code: "self_approval" } })
  })
})

describe("J04.5/J04.6 PO r2 evidence review before recording the client authority (B06)", () => {
  it("the operator's PO is blocked until a non-submitter reviews the evidence on the record screen", async () => {
    const po = { job: id("job_demo_aurora"), reference: "PO-AUR-2027-01", amount: "53000.00", evidenceId: id("ev:evidence_demo_po_r2") }
    const review = { agencySlug: SLUG, evidenceId: id("ev:evidence_demo_po_r2"), decision: "reviewed" as const, reason: "Signed client PO r2 matches USD 53,000" }

    await signInAs("user_demo_operator")
    const blocked = await runCapabilityAction({ agencySlug: SLUG, skillId: "agency-contract-po", payload: po, idempotencyKey: key("ui-po-blocked") })
    if (!blocked.ok) throw new Error(`run failed: ${blocked.error.code}`)
    expect(blocked.data).toMatchObject({ state: "blocked", error: { code: "blocked_by_rule", details: { rule: "evidence_not_reviewed" } } })
    const selfReview = await reviewEvidenceAction({ ...review, idempotencyKey: key("ui-ev-self") })
    expect(selfReview.ok).toBe(false)
    expect(["forbidden", "self_approval"]).toContain(!selfReview.ok && selfReview.error.code)

    await signInAs("user_demo_owner")
    const reviewed = await reviewEvidenceAction({ ...review, idempotencyKey: key("ui-ev-owner") })
    expect(reviewed).toMatchObject({ ok: true, data: { reviewState: "reviewed" } })

    await signInAs("user_demo_operator")
    const recorded = await runCapabilityAction({ agencySlug: SLUG, skillId: "agency-contract-po", payload: po, idempotencyKey: key("ui-po-recorded") })
    if (!recorded.ok) throw new Error(`run failed: ${recorded.error.code}`)
    expect(recorded.data.state).toBe("succeeded")
    expect((recorded.data.output as { approval: { state: string } }).approval.state).toBe("awaiting_approval")
  })
})
