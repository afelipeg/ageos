// @vitest-environment node
// Core-1: inbox commands (assign / snooze / resolve) and configuration change
// proposals for brand and demo plan of an active agency (proposal + digest +
// approval by an owner other than the proposer).
import { eq, sql } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import * as s from "@/server/db/schema"
import { assignInboxItem, resolveInboxItem, snoozeInboxItem } from "@/server/domain/attention"
import { recordCostEstimate } from "@/server/domain/budget"
import { decideCapabilityChange, DEMO_PLANS, listConfigurationRevisions, proposeBrandChange, proposePlanChange } from "@/server/domain/configuration"
import { getJobRevision } from "@/server/domain/jobs"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo } from "./helpers"

const AURORA = id("job_demo_aurora")
const RAYO = id("tenant_demo_rayo")
const code = (c: string, rule?: string) => (e: unknown) => e instanceof DomainError && e.code === c && (!rule || e.details.rule === rule)

// Rows a blocked command must not change (counts + item revisions).
async function footprint() {
  const n = async (t: typeof s.businessEvent | typeof s.idempotencyRecord | typeof s.configurationRevision) =>
    (await ownerDb().select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.tenantId, RAYO)))[0]!.n
  const items = await ownerDb().select({ id: s.attentionItem.id, revision: s.attentionItem.revision, state: s.attentionItem.state }).from(s.attentionItem).where(eq(s.attentionItem.tenantId, RAYO))
  return { events: await n(s.businessEvent), idem: await n(s.idempotencyRecord), revisions: await n(s.configurationRevision), items: items.sort((a, b) => a.id.localeCompare(b.id)) }
}

async function item(itemId: string) {
  return (await ownerDb().select().from(s.attentionItem).where(eq(s.attentionItem.id, itemId)))[0]!
}

async function publishedNumber(ctx: AgencyContext) {
  return (await listConfigurationRevisions(ctx)).find((r) => r.published)!.number
}

let marginItem = ""
const manual: Record<"attention" | "blocked" | "approval", string> = { attention: "", blocked: "", approval: "" }

beforeAll(async () => {
  await resetDemo()
  // A real rule-driven item: the 40h scope change takes Aurora below the floor.
  const operator = await ctxFor("user_demo_operator")
  await executeCommand(operator, recordCostEstimate, {
    idempotencyKey: key("inbox-est"),
    payload: { job: AURORA, laborMinutes: 8400, hourlyCost: "50.00", productionVendorAmount: "5500.00", expenseAmount: "500.00", reason: "Scope change adds 40 hours" },
    origin: "ui",
    expectedRevision: await getJobRevision(operator, AURORA),
  })
  marginItem = (await ownerDb().select().from(s.attentionItem).where(eq(s.attentionItem.ruleId, "margin-floor-v1")))[0]!.id
  // Items raised by other modules' rules (test setup through the owner role).
  for (const kind of ["attention", "blocked", "approval"] as const) {
    const [row] = await ownerDb()
      .insert(s.attentionItem)
      .values({
        tenantId: RAYO,
        ruleId: `test-${kind}-v1`,
        subjectKey: `test:${kind}`,
        jobId: AURORA,
        moduleKey: "profitability",
        kind,
        severity: kind === "blocked" ? "blocked" : "attention",
        title: { en: `Test ${kind}`, es: `Prueba ${kind}` },
        effect: {},
        ctaHref: "/a/rayo-de-sol/jobs",
        ctaLabel: { en: "Open", es: "Abrir" },
      })
      .returning()
    manual[kind] = row!.id
  }
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("inbox · assign", () => {
  it("a manager assigns an item; the same request replays without a second change", async () => {
    const operator = await ctxFor("user_demo_operator")
    const k = key("assign")
    const env = { idempotencyKey: k, payload: { item: marginItem, assignee: id("user_demo_finance") }, origin: "ui" as const, expectedRevision: (await item(marginItem)).revision }
    const a = await executeCommand(operator, assignInboxItem, env)
    const b = await executeCommand(operator, assignInboxItem, env)
    expect(a.result).toMatchObject({ assigneeUserId: id("user_demo_finance"), revision: 2 })
    expect(b.replayed).toBe(true)
    expect(b.result).toEqual(a.result)
    expect((await item(marginItem)).revision).toBe(2)
  })

  it("a producer cannot assign; another agency's member and a stale revision are refused; nothing changes", async () => {
    const before = await footprint()
    const rev = (await item(marginItem)).revision
    await expect(
      executeCommand(await ctxFor("user_demo_producer"), assignInboxItem, { idempotencyKey: key("assign-prod"), payload: { item: marginItem, assignee: id("user_demo_owner") }, origin: "ui", expectedRevision: rev })
    ).rejects.toSatisfy(code("forbidden"))
    const operator = await ctxFor("user_demo_operator")
    await expect(
      executeCommand(operator, assignInboxItem, { idempotencyKey: key("assign-norte"), payload: { item: marginItem, assignee: id("user_demo_norte_owner") }, origin: "ui", expectedRevision: rev })
    ).rejects.toSatisfy(code("not_found"))
    await expect(
      executeCommand(operator, assignInboxItem, { idempotencyKey: key("assign-stale"), payload: { item: marginItem, assignee: id("user_demo_owner") }, origin: "ui", expectedRevision: rev - 1 })
    ).rejects.toSatisfy(code("revision_conflict"))
    expect(await footprint()).toEqual(before)
  })
})

describe("inbox · snooze", () => {
  it("the assignee snoozes until a later business date; the condition is not cleared", async () => {
    const finance = await ctxFor("user_demo_finance")
    const res = await executeCommand(finance, snoozeInboxItem, { idempotencyKey: key("snooze"), payload: { item: marginItem, until: "2027-03-20" }, origin: "ui", expectedRevision: (await item(marginItem)).revision })
    expect(res.result).toMatchObject({ state: "snoozed", snoozedUntil: "2027-03-20", conditionCleared: false })
  })

  it("a past date or a non-manager who is not the assignee is refused without side effects", async () => {
    const before = await footprint()
    const rev = (await item(marginItem)).revision
    await expect(
      executeCommand(await ctxFor("user_demo_finance"), snoozeInboxItem, { idempotencyKey: key("snooze-past"), payload: { item: marginItem, until: "2027-03-10" }, origin: "ui", expectedRevision: rev })
    ).rejects.toSatisfy(code("validation"))
    await expect(
      executeCommand(await ctxFor("user_demo_viewer"), snoozeInboxItem, { idempotencyKey: key("snooze-viewer"), payload: { item: marginItem, until: "2027-03-20" }, origin: "ui", expectedRevision: rev })
    ).rejects.toSatisfy(code("forbidden"))
    expect(await footprint()).toEqual(before)
  })
})

describe("inbox · resolve", () => {
  it("is refused while the margin is still below the floor, for approvals, and for flow-owned blockers", async () => {
    const operator = await ctxFor("user_demo_operator")
    const before = await footprint()
    const resolve = async (itemId: string, label: string) =>
      executeCommand(operator, resolveInboxItem, { idempotencyKey: key(label), payload: { item: itemId, note: "Handled" }, origin: "ui", expectedRevision: (await item(itemId)).revision })
    await expect(resolve(marginItem, "res-margin")).rejects.toSatisfy(code("blocked_by_rule", "condition_still_present"))
    await expect(resolve(manual.approval, "res-approval")).rejects.toSatisfy(code("blocked_by_rule", "approval_resolves_by_decision"))
    await expect(resolve(manual.blocked, "res-blocked")).rejects.toSatisfy(code("blocked_by_rule", "condition_owned_by_flow"))
    expect(await footprint()).toEqual(before)
  })

  it("an acknowledged attention item resolves once; the replay returns the same result", async () => {
    const operator = await ctxFor("user_demo_operator")
    const env = { idempotencyKey: key("res-ok"), payload: { item: manual.attention, note: "Reviewed with the client" }, origin: "ui" as const, expectedRevision: (await item(manual.attention)).revision }
    const a = await executeCommand(operator, resolveInboxItem, env)
    const b = await executeCommand(operator, resolveInboxItem, env)
    expect(a.result).toMatchObject({ state: "resolved", verifiedByRule: false })
    expect(b).toMatchObject({ replayed: true, result: a.result })
    await expect(
      executeCommand(operator, resolveInboxItem, { idempotencyKey: key("res-again"), payload: { item: manual.attention, note: "Again" }, origin: "ui", expectedRevision: (await item(manual.attention)).revision })
    ).rejects.toSatisfy(code("blocked_by_rule", "item_resolved"))
  })
})

describe("settings · brand change of an active agency", () => {
  it("an account manager proposes; the owner approves the exact digest and the brand is published", async () => {
    const operator = await ctxFor("user_demo_operator")
    const input = { accent: "#1D4ED8", logoText: "SR", reason: "Refresh for the spring launch", idempotencyKey: key("brand"), expectedRevision: await publishedNumber(operator) }
    const p = await proposeBrandChange(operator, input)
    const again = await proposeBrandChange(operator, input)
    expect(p.result).toMatchObject({ state: "awaiting_approval", eligibleRoles: ["owner"] })
    expect(again).toMatchObject({ replayed: true, result: p.result })
    await expect(
      decideCapabilityChange(await ctxFor("user_demo_finance"), { revisionId: p.result.revisionId, decision: "approve", reviewedDigest: p.result.payloadDigest, idempotencyKey: key("brand-fin") })
    ).rejects.toSatisfy(code("forbidden"))
    const owner = await ctxFor("user_demo_owner")
    const d = await decideCapabilityChange(owner, { revisionId: p.result.revisionId, decision: "approve", reviewedDigest: p.result.payloadDigest, idempotencyKey: key("brand-ok") })
    expect(d.result).toMatchObject({ outcome: "published", published: true })
    expect((await ctxFor("user_demo_owner")).branding).toEqual({ accent: "#1d4ed8", logoText: "SR" })
  })

  it("the owner's own proposal cannot be approved by the owner; low contrast, finance and stale revisions are refused", async () => {
    const owner = await ctxFor("user_demo_owner")
    const rev = await publishedNumber(owner)
    const own = await proposeBrandChange(owner, { accent: "#0f766e", logoText: "ES", reason: "Owner change", idempotencyKey: key("brand-own"), expectedRevision: rev })
    await expect(
      decideCapabilityChange(owner, { revisionId: own.result.revisionId, decision: "approve", reviewedDigest: own.result.payloadDigest, idempotencyKey: key("brand-self") })
    ).rejects.toSatisfy(code("self_approval"))
    const before = await footprint()
    const operator = await ctxFor("user_demo_operator")
    await expect(proposeBrandChange(operator, { accent: "#ffff00", logoText: "SR", reason: "Too light", idempotencyKey: key("brand-contrast"), expectedRevision: rev })).rejects.toSatisfy(
      code("blocked_by_rule", "contrast_below_4_5")
    )
    await expect(proposeBrandChange(await ctxFor("user_demo_finance"), { accent: "#7c3aed", logoText: "SR", reason: "Finance", idempotencyKey: key("brand-finance"), expectedRevision: rev })).rejects.toSatisfy(code("forbidden"))
    await expect(proposeBrandChange(operator, { accent: "#7c3aed", logoText: "SR", reason: "Stale", idempotencyKey: key("brand-stale"), expectedRevision: rev - 1 })).rejects.toSatisfy(code("revision_conflict"))
    expect(await footprint()).toEqual(before)
  })
})

describe("settings · demo plan change", () => {
  it("an account manager proposes demo_plus from the catalog; the owner approves and the limits are published", async () => {
    const operator = await ctxFor("user_demo_operator")
    const input = { plan: "demo_plus", reason: "More files for the launch", idempotencyKey: key("plan"), expectedRevision: await publishedNumber(operator) }
    const p = await proposePlanChange(operator, input)
    expect((await proposePlanChange(operator, input)).replayed).toBe(true)
    expect(p.result.diff).toMatchObject({ kind: "plan", plan: { before: "demo_standard", after: "demo_plus" }, billing: "none_demo_only", impact: { filesDeleted: 0 } })
    const d = await decideCapabilityChange(await ctxFor("user_demo_owner"), { revisionId: p.result.revisionId, decision: "approve", reviewedDigest: p.result.payloadDigest, idempotencyKey: key("plan-ok") })
    expect(d.result.published).toBe(true)
    const [a] = await ownerDb().select().from(s.agency).where(eq(s.agency.id, RAYO))
    const [cfg] = await ownerDb().select().from(s.configurationRevision).where(eq(s.configurationRevision.id, a!.publishedConfigRevisionId!))
    expect(cfg!.limits).toEqual({ ...DEMO_PLANS.demo_plus, plan: "demo_plus", demo: true })
    // Plans keep every capability; only limits change.
    const owner = await ctxFor("user_demo_owner")
    expect(owner.enabledCapabilities.size).toBe(42)
  })

  it("an unknown plan, the current plan and a viewer are refused; a change based on an older revision goes stale", async () => {
    const operator = await ctxFor("user_demo_operator")
    const rev = await publishedNumber(operator)
    const before = await footprint()
    await expect(proposePlanChange(operator, { plan: "enterprise", reason: "Not in catalog", idempotencyKey: key("plan-unknown"), expectedRevision: rev })).rejects.toSatisfy(code("validation"))
    await expect(proposePlanChange(operator, { plan: "demo_plus", reason: "Same plan", idempotencyKey: key("plan-same"), expectedRevision: rev })).rejects.toSatisfy(code("validation"))
    await expect(proposePlanChange(await ctxFor("user_demo_viewer"), { plan: "demo_lite", reason: "Viewer", idempotencyKey: key("plan-viewer"), expectedRevision: rev })).rejects.toSatisfy(code("forbidden"))
    expect(await footprint()).toEqual(before)
    const lite = await proposePlanChange(operator, { plan: "demo_lite", reason: "Smaller", idempotencyKey: key("plan-lite"), expectedRevision: rev })
    const brand = await proposeBrandChange(operator, { accent: "#be123c", logoText: "SR", reason: "Meanwhile", idempotencyKey: key("plan-brand"), expectedRevision: rev })
    const owner = await ctxFor("user_demo_owner")
    await decideCapabilityChange(owner, { revisionId: brand.result.revisionId, decision: "approve", reviewedDigest: brand.result.payloadDigest, idempotencyKey: key("plan-brand-ok") })
    const stale = await decideCapabilityChange(owner, { revisionId: lite.result.revisionId, decision: "approve", reviewedDigest: lite.result.payloadDigest, idempotencyKey: key("plan-stale") })
    expect(stale.result).toMatchObject({ outcome: "stale", published: false })
  })
})
