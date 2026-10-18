// @vitest-environment node
// Core-2 acceptance fixtures (ERP-11..ERP-25): every positive persists and
// returns all repositoryOutputs keys; every negative is blocked by its rule
// with no new business events. Each fixture runs twice to prove it is
// re-runnable on the same tenant.
import { and, eq, sql } from "drizzle-orm"

import { CAPABILITY_CONTRACTS } from "@/lib/capabilities/catalog.generated"
import { FIXTURES, HANDLERS } from "@/server/capabilities/registry"
import { runCapability } from "@/server/capabilities/runner"
import { businessEvent } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

import { closeOwnerDb, ctxFor, key, resetDemo } from "./helpers"

const CORE2 = [
  "agency-tasks-timesheets",
  "agency-production-estimating",
  "agency-production",
  "agency-media-ranking",
  "agency-media-planning",
  "agency-tv-radio-planning",
  "agency-ooh-planning",
  "agency-digital-planning",
  "agency-plan-changes",
  "agency-rate-cards-contracts",
  "agency-media-buying",
  "agency-campaign-activation",
  "agency-campaign-optimization",
  "agency-transmission-control",
  "agency-ooh-inventory",
]

async function eventCount(tenantId: string) {
  return withTenant(tenantId, async (tx) => (await tx.select({ n: sql<number>`count(*)::int` }).from(businessEvent).where(and(eq(businessEvent.tenantId, tenantId))))[0]!.n)
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("Core-2 handlers and fixtures are registered", () => {
  it("all 15 skills have a handler and positive/negative fixtures", () => {
    for (const skillId of CORE2) {
      expect(HANDLERS[skillId], skillId).toBeDefined()
      expect(FIXTURES[skillId]?.positive, skillId).toBeTypeOf("function")
      expect(FIXTURES[skillId]?.negative, skillId).toBeTypeOf("function")
    }
  })
})

describe.each([1, 2])("fixture run %i", (round) => {
  it.each(CORE2)("%s positive persists with every repository output", async (skillId) => {
    const fx = FIXTURES[skillId]!
    const pos = await fx.positive(ctxFor)
    const actor = await ctxFor(pos.actorKey)
    const out = await runCapability(actor, skillId, pos.input, { origin: "ui", idempotencyKey: key(`${skillId}-pos-${round}`), expectedRevision: pos.expectedRevision })
    expect(out.error, JSON.stringify(out.error)).toBeNull()
    expect(out.state).toBe("succeeded")
    const contract = CAPABILITY_CONTRACTS.find((c) => c.skillId === skillId)!
    for (const k of contract.repositoryOutputs) expect(out.output, `${skillId}.${k}`).toHaveProperty(k)
    await pos.verify?.(out.output, actor)
  })

  it.each(CORE2)("%s negative is blocked by its rule without side effects", async (skillId) => {
    const fx = FIXTURES[skillId]!
    const neg = await fx.negative(ctxFor)
    const actor = await ctxFor(neg.actorKey)
    const before = await eventCount(actor.tenant.id)
    const out = await runCapability(actor, skillId, neg.input, { origin: "ui", idempotencyKey: key(`${skillId}-neg-${round}`), expectedRevision: neg.expectedRevision })
    expect(out.state, JSON.stringify(out.output)).toBe("blocked")
    expect(out.error?.code).toBe(neg.expectCode)
    if (neg.expectRule) expect(out.error?.details.rule).toBe(neg.expectRule)
    expect(await eventCount(actor.tenant.id)).toBe(before)
  })
})
