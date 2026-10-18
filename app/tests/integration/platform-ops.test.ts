// @vitest-environment node
import { createHash } from "node:crypto"

import { and, count, eq } from "drizzle-orm"

import { resolveAgencyContext } from "@/server/auth/context"
import { isPlatformSession, type SessionInfo } from "@/server/auth/session"
import * as schema from "@/server/db/schema"
import {
  applyPlatformChange,
  decidePlatformChange,
  getIncident,
  getPlatformChange,
  investigate,
  listIncidents,
  proposeDelimiterChange,
  verifyPlatformChange,
} from "@/server/domain/ops"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, id, key, ownerDb, resetDemo, sessionFor } from "./helpers"

const INCIDENT = id("ops_csv_delimiter_mismatch")
const PROFILE = id("import_profile_demo_media_orders")
const RAYO = id("tenant_demo_rayo")
const NORTE = id("tenant_demo_norte")
const SAMPLE = "order_id;channel;amount_minor;currency;job_reference;service_date\nDEMO-ORD-01;meta;1000000;USD;AURSL7AF0001;2027-03-20\n"
const EXPECTED = ["order_id", "channel", "amount_minor", "currency", "job_reference", "service_date"]

async function expectError(p: Promise<unknown>, code: string, rule?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code && (rule === undefined || e.details.rule === rule))
}

async function businessCounts() {
  const db = ownerDb()
  const [po] = await db.select({ n: count() }).from(schema.purchaseOrder).where(eq(schema.purchaseOrder.tenantId, RAYO))
  const [ev] = await db.select({ n: count() }).from(schema.businessEvent).where(eq(schema.businessEvent.tenantId, RAYO))
  const [adapter] = await db.select({ n: count() }).from(schema.adapterOperation).where(eq(schema.adapterOperation.tenantId, RAYO))
  const [cfg] = await db.select({ n: count() }).from(schema.configurationRevision).where(eq(schema.configurationRevision.tenantId, RAYO))
  return { po: po!.n, events: ev!.n, adapter: adapter!.n, config: cfg!.n }
}

let operator: SessionInfo
let admin: SessionInfo

beforeAll(async () => {
  await resetDemo()
  operator = await sessionFor("user_demo_platform_operator")
  admin = await sessionFor("user_demo_platform_admin")
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("platform sessions", () => {
  it("agency identities never hold platform roles; platform identities get no agency access", async () => {
    const owner = await sessionFor("user_demo_owner")
    expect(isPlatformSession(owner)).toBe(false)
    expect(isPlatformSession(operator)).toBe(true)
    await expectError(listIncidents(owner), "forbidden")
    await expectError(getIncident(owner, INCIDENT), "forbidden")
    expect(await resolveAgencyContext(operator, "rayo-de-sol")).toBeNull()
    expect(await resolveAgencyContext(admin, "rayo-de-sol")).toBeNull()
  })
})

describe("J09 ops_csv_delimiter_mismatch circuit", () => {
  let before: Awaited<ReturnType<typeof businessCounts>>

  it("shows evidence from the real parser: 1 column instead of 6 on the stored bytes", async () => {
    before = await businessCounts()
    const list = await listIncidents(operator)
    expect(list.incidents.map((i) => i.incidentKey)).toContain("ops_csv_delimiter_mismatch")
    expect(list.tenants.map((t) => t.slug)).toEqual(expect.arrayContaining(["norte-studio", "rayo-de-sol"]))
    const inc = await getIncident(operator, INCIDENT)
    expect(inc.state).toBe("detected")
    expect(inc.file.name).toBe("demo-media-orders.csv")
    expect(inc.file.sha256).toBe(createHash("sha256").update(SAMPLE).digest("hex"))
    expect(inc.file.sameBytesAsDetected).toBe(true)
    expect(inc.profile).toMatchObject({ delimiter: ",", profileRevision: 1, expectedHeaders: EXPECTED, allowlisted: true })
    expect(inc.current).toMatchObject({ parser: "lib/csv.parseCsv", observedColumns: 1, matchesExpected: false })
  })

  it("cannot propose before investigating; investigation diagnoses ';' deterministically", async () => {
    await expectError(
      proposeDelimiterChange(operator, { incidentId: INCIDENT, delimiter: ";", expectedProfileRevision: 1, reason: "Expected six columns", idempotencyKey: key("p") }),
      "blocked_by_rule",
      "incident_not_investigating"
    )
    const res = await investigate(operator, INCIDENT)
    expect(res.state).toBe("investigating")
    const diagnosis = res.evidence.diagnosis as { recommendedDelimiter: string; candidates: { delimiter: string; columns: number }[] }
    expect(diagnosis.recommendedDelimiter).toBe(";")
    expect(diagnosis.candidates.find((c) => c.delimiter === ",")?.columns).toBe(1)
    expect(diagnosis.candidates.find((c) => c.delimiter === ";")?.columns).toBe(6)
  })

  it("only a typed allowed delimiter, only by an operator, only on the current revision", async () => {
    await expectError(
      proposeDelimiterChange(operator, { incidentId: INCIDENT, delimiter: "x" as ";", expectedProfileRevision: 1, reason: "Bad", idempotencyKey: key("p") }),
      "validation"
    )
    await expectError(
      proposeDelimiterChange(admin, { incidentId: INCIDENT, delimiter: ";", expectedProfileRevision: 1, reason: "Admin", idempotencyKey: key("p") }),
      "forbidden"
    )
    await expectError(
      proposeDelimiterChange(operator, { incidentId: INCIDENT, delimiter: ";", expectedProfileRevision: 2, reason: "Stale", idempotencyKey: key("p") }),
      "revision_conflict"
    )
    await expectError(
      proposeDelimiterChange(operator, { incidentId: INCIDENT, delimiter: ",", expectedProfileRevision: 1, reason: "Same", idempotencyKey: key("p") }),
      "validation"
    )
  })

  it("an approval that does not bind the exact digest goes stale and keeps the incident open", async () => {
    const c1 = await proposeDelimiterChange(operator, { incidentId: INCIDENT, delimiter: ";", expectedProfileRevision: 1, reason: "Expected six columns; current delimiter produces one", idempotencyKey: key("p") })
    const res = await decidePlatformChange(admin, { changeId: c1.changeId, decision: "approve", reviewedDigest: "0".repeat(64) })
    expect(res.outcome).toBe("stale")
    expect((await getPlatformChange(admin, c1.changeId)).state).toBe("stale")
    expect((await getIncident(operator, INCIDENT)).state).toBe("investigating")
  })

  it("an approved change becomes stale if the profile revision moved before apply", async () => {
    const c2 = await proposeDelimiterChange(operator, { incidentId: INCIDENT, delimiter: ";", expectedProfileRevision: 1, reason: "Expected six columns; current delimiter produces one", idempotencyKey: key("p") })
    await decidePlatformChange(admin, { changeId: c2.changeId, decision: "approve", reviewedDigest: c2.payloadDigest })
    const where = eq(schema.importProfile.id, PROFILE)
    await ownerDb().update(schema.importProfile).set({ profileRevision: 7 }).where(where)
    try {
      await expectError(applyPlatformChange(operator, { changeId: c2.changeId, idempotencyKey: key("apply") }), "approval_stale")
      expect((await getPlatformChange(admin, c2.changeId)).state).toBe("stale")
      const [p] = await ownerDb().select().from(schema.importProfile).where(where)
      expect(p!.delimiter).toBe(",")
    } finally {
      await ownerDb().update(schema.importProfile).set({ profileRevision: 1 }).where(where)
    }
  })

  let changeId = ""
  let digest = ""

  it("proposal is idempotent; apply without approval and self-approval are refused", async () => {
    const k = key("p")
    const input = { incidentId: INCIDENT, delimiter: ";" as const, expectedProfileRevision: 1, reason: "Expected six columns; current delimiter produces one", idempotencyKey: k }
    const c = await proposeDelimiterChange(operator, input)
    const again = await proposeDelimiterChange(operator, input)
    expect(again).toMatchObject({ changeId: c.changeId, replayed: true })
    await expectError(proposeDelimiterChange(operator, { ...input, reason: "Different payload" }), "idempotency_conflict")
    expect(c.payload).toEqual({ profile_id: "import_profile_demo_media_orders", expected_revision: 1, delimiter: ";", reason: input.reason })
    expect((await getIncident(operator, INCIDENT)).state).toBe("awaiting_approval")
    changeId = c.changeId
    digest = c.payloadDigest
    await expectError(applyPlatformChange(operator, { changeId, idempotencyKey: key("apply") }), "approval_required")
    await expectError(decidePlatformChange(operator, { changeId, decision: "approve", reviewedDigest: digest }), "self_approval")
    expect((await getPlatformChange(admin, changeId)).canDecide).toBe(true)
  })

  it("a different admin approves; apply twice with the same key keeps a single change (revision 2)", async () => {
    const decided = await decidePlatformChange(admin, { changeId, decision: "approve", reviewedDigest: digest })
    expect(decided.outcome).toBe("approved")
    expect((await getIncident(operator, INCIDENT)).state).toBe("approved")
    const k = key("apply")
    const first = await applyPlatformChange(operator, { changeId, idempotencyKey: k })
    const second = await applyPlatformChange(operator, { changeId, idempotencyKey: k })
    expect(first).toMatchObject({ profileRevision: 2, replayed: false })
    expect(second).toMatchObject({ profileRevision: 2, replayed: true })
    expect(second.diff).toEqual(first.diff)
    await expectError(applyPlatformChange(admin, { changeId, idempotencyKey: key("apply-other") }), "blocked_by_rule", "already_applied")
    const [p] = await ownerDb().select().from(schema.importProfile).where(eq(schema.importProfile.id, PROFILE))
    expect(p).toMatchObject({ delimiter: ";", profileRevision: 2 })
    const revisions = await ownerDb().select().from(schema.importProfileRevision).where(eq(schema.importProfileRevision.profileId, PROFILE))
    expect(revisions.map((r) => [r.profileRevision, r.delimiter])).toEqual([
      [1, ","],
      [2, ";"],
    ])
    expect(first.diff).toEqual({ field: "delimiter", before: { delimiter: ",", profileRevision: 1 }, after: { delimiter: ";", profileRevision: 2 } })
  })

  it("verification re-parses the same bytes: 6 columns + 1 row, incident resolved, nothing imported", async () => {
    const v = await verifyPlatformChange(admin, { changeId })
    expect(v.passed).toBe(true)
    expect(v.sameFile).toBe(true)
    expect(v.before).toEqual({ delimiter: ",", observedColumns: 1 })
    expect(v.after).toMatchObject({ observedColumns: 6, dataRows: 1, observedHeaders: EXPECTED, matchesExpected: true })
    expect(v.ordersImported).toBe(0)
    const again = await verifyPlatformChange(operator, { changeId })
    expect(again.passed).toBe(true)
    const inc = await getIncident(operator, INCIDENT)
    expect(inc.state).toBe("resolved")
    expect(inc.current.observedColumns).toBe(6)
    const transitions = inc.audit.filter((a) => a.eventType === "ops.incident.transition").map((a) => a.payload.to)
    // Full circuit is audited in order (stale attempts reopened it to investigating along the way).
    expect(transitions.slice(-6)).toEqual(["proposed", "awaiting_approval", "approved", "applying", "verifying", "resolved"])
    expect(transitions[0]).toBe("investigating")
    expect(inc.audit.some((a) => a.eventType === "ops.change.applied")).toBe(true)
    // No orders, spend, adapter calls or configuration edits came out of the parser fix.
    expect(await businessCounts()).toEqual(before)
  })

  it("rejects changes to a profile outside the allowlist (foreign profile)", async () => {
    const db = ownerDb()
    const foreignProfile = id(`test:norte_profile:${Date.now()}`)
    const foreignIncident = id(`test:norte_incident:${Date.now()}`)
    await db.insert(schema.importProfile).values({ id: foreignProfile, tenantId: NORTE, profileKey: `norte_orders_${Date.now()}`, delimiter: ",", expectedHeaders: EXPECTED, profileRevision: 1 })
    await db.insert(schema.platformIncident).values({ id: foreignIncident, tenantId: NORTE, incidentKey: `norte_${Date.now()}`, state: "investigating", title: { en: "x", es: "x" }, profileId: foreignProfile, evidence: {} })
    await expectError(
      proposeDelimiterChange(operator, { incidentId: foreignIncident, delimiter: ";", expectedProfileRevision: 1, reason: "Not allowed", idempotencyKey: key("p") }),
      "blocked_by_rule",
      "profile_not_allowlisted"
    )
    const [changes] = await db.select({ n: count() }).from(schema.platformChange).where(and(eq(schema.platformChange.tenantId, NORTE)))
    expect(changes!.n).toBe(0)
  })
})
