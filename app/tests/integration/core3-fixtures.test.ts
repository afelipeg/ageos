// @vitest-environment node
// Core-3 acceptance fixtures (ERP-26..ERP-42), run like the QA harness:
// positive succeeds with every repositoryOutputs key, persists a workflow run
// and correlated events, passes its verify, and runs again on the same tenant;
// negative is blocked by its code/rule with no change in any table, also twice.
import { and, eq } from "drizzle-orm"

import { CAPABILITY_CONTRACTS } from "@/lib/capabilities/catalog.generated"
import { INPUT_FIELDS } from "@/lib/capabilities/input-fields"
import { FIXTURES, HANDLERS } from "@/server/capabilities/registry"
import { runCapability } from "@/server/capabilities/runner"
import { businessEvent } from "@/server/db/schema"

import { closeOwnerDb, ctxFor, key, ownerDb, resetDemo } from "./helpers"
import { diffSnapshots, settleBlocked, snapshotDb } from "./qa-helpers"

const CORE3 = [
  "agency-delivery-reconciliation",
  "agency-payables",
  "agency-payment-run",
  "agency-cash-settlement",
  "agency-expenses",
  "agency-client-billing",
  "agency-collections",
  "agency-rebates",
  "agency-tax-compliance",
  "agency-general-ledger",
  "agency-accruals-revaluation",
  "agency-fixed-assets",
  "agency-period-close",
  "agency-profitability",
  "agency-revenue-budget",
  "agency-cash-forecast",
  "agency-management-reporting",
]

const only = process.env.CORE3_SKILL ? CORE3.filter((s) => s === process.env.CORE3_SKILL) : CORE3

afterAll(async () => {
  await closeOwnerDb()
})

describe("Core-3 handlers, fixtures and input contracts", () => {
  it("all 17 skills have a handler and positive/negative fixtures", () => {
    for (const skillId of CORE3) {
      expect(HANDLERS[skillId], skillId).toBeDefined()
      expect(FIXTURES[skillId]?.positive, skillId).toBeTypeOf("function")
      expect(FIXTURES[skillId]?.negative, skillId).toBeTypeOf("function")
    }
  })

  it("each handler input schema has exactly the declared input fields", () => {
    for (const skillId of CORE3) {
      const h = HANDLERS[skillId]!
      const schema = (h.kind === "command" ? h.command.input : h.input) as unknown as { shape: Record<string, unknown> }
      expect(Object.keys(schema.shape).sort(), skillId).toEqual((INPUT_FIELDS[skillId] ?? []).map((f) => f.key).sort())
    }
  })
})

async function runPositive(skillId: string, label: string) {
  const fx = await FIXTURES[skillId]!.positive(ctxFor)
  const actor = await ctxFor(fx.actorKey)
  const out = await runCapability(actor, skillId, fx.input, { origin: "ui", idempotencyKey: key(`${skillId}-pos-${label}`), expectedRevision: fx.expectedRevision })
  expect(out.error, `${skillId} positive ${label}: ${JSON.stringify(out.error)}`).toBeNull()
  expect(out.state).toBe("succeeded")
  const contract = CAPABILITY_CONTRACTS.find((c) => c.skillId === skillId)!
  for (const k of contract.repositoryOutputs) expect(out.output, `${skillId}.${k}`).toHaveProperty(k)
  if (HANDLERS[skillId]!.kind === "command") {
    const events = await ownerDb().select().from(businessEvent).where(and(eq(businessEvent.correlationId, out.runId), eq(businessEvent.tenantId, actor.tenant.id)))
    expect(events.length, `${skillId} persisted correlated events`).toBeGreaterThan(0)
  }
  await fx.verify?.(out.output, actor)
}

async function runNegative(skillId: string, label: string) {
  const fx = await FIXTURES[skillId]!.negative(ctxFor)
  const actor = await ctxFor(fx.actorKey)
  const before = await snapshotDb()
  const settled = await settleBlocked(runCapability(actor, skillId, fx.input, { origin: "ui", idempotencyKey: key(`${skillId}-neg-${label}`), expectedRevision: fx.expectedRevision }))
  const after = await snapshotDb()
  expect(settled.ok, `${skillId} negative ${label} unexpectedly succeeded`).toBe(false)
  if (settled.ok) return
  expect(settled.error.code, `${skillId} negative ${label}: ${settled.error.message} ${JSON.stringify(settled.error.details)}`).toBe(fx.expectCode)
  if (fx.expectRule) expect(settled.error.details.rule, `${skillId} negative ${label} rule`).toBe(fx.expectRule)
  expect(diffSnapshots(before, after), `${skillId} negative ${label} side effects`).toEqual([])
}

describe.each(only)("%s", (skillId) => {
  it("positive on a fresh seed and as a re-run", async () => {
    await resetDemo()
    await runPositive(skillId, "fresh")
    await runPositive(skillId, "rerun")
  }, 120_000)

  it("negative on a fresh seed and as a re-run", async () => {
    await resetDemo()
    await runNegative(skillId, "fresh")
    await runNegative(skillId, "rerun")
  }, 120_000)
})
