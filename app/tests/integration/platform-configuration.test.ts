// @vitest-environment node
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { and, eq, like } from "drizzle-orm"

import { resolveAgencyContext } from "@/server/auth/context"
import type { SessionInfo } from "@/server/auth/session"
import * as schema from "@/server/db/schema"
import { retryFailedStep, simulateDnsVerification, startActivation } from "@/server/domain/activation"
import {
  createAgencyDraft,
  decideCapabilityChange,
  getCapabilityCatalog,
  getDraft,
  listConfigurationRevisions,
  listControlAgencies,
  profileCapabilities,
  profileDefaults,
  proposeCapabilityChange,
  saveSetupStep,
  validateConfiguration,
} from "@/server/domain/configuration"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo, sessionFor } from "./helpers"

async function expectError(p: Promise<unknown>, code: string, rule?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => {
    if (!(e instanceof DomainError) || e.code !== code) return false
    return rule === undefined || e.details.rule === rule || JSON.stringify(e.details).includes(rule)
  })
}

const ts = Date.now().toString(36)

const agencyStep = (n: string) => ({
  name: `Agencia ${n}`,
  appName: `App ${n}`,
  country: "MX" as const,
  legalEntityName: `Agencia ${n} Demo Entity`,
  baseCurrency: "MXN" as const,
  timezone: "America/Mexico_City" as const,
  services: ["creative", "media"] as ("creative" | "media")[],
})

const brandStep = (slug: string, domain: string | null = null) => ({
  logoText: "AG",
  accent: "#1d4ed8",
  appSlug: slug,
  members: [{ name: "Demo Finance", email: "finance@agencia.example", role: "finance_approver" as const }],
  customDomain: domain,
})

/** Saves steps 1–5 with valid data; returns the draft revision after Review. */
async function fillDraft(s: SessionInfo, draftId: string, slug: string, domain: string | null = null) {
  let rev = (await getDraft(s, draftId)).revision.revision
  rev = (await saveSetupStep(s, draftId, 1, agencyStep(slug), rev)).revision
  rev = (await saveSetupStep(s, draftId, 2, profileDefaults("full_service"), rev)).revision
  rev = (await saveSetupStep(s, draftId, 3, { mode: "simulated", accounts: [{ provider: "meta_ads", accountAlias: `${slug.replace(/-/g, "_")}_meta`, scopes: ["ads.read", "ads.manage"] }] }, rev)).revision
  rev = (await saveSetupStep(s, draftId, 4, brandStep(slug, domain), rev)).revision
  const review = await saveSetupStep(s, draftId, 5, {}, rev)
  expect(review.validation?.valid).toBe(true)
  return review.revision
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("capability catalog and profiles", () => {
  it("always lists 42 capabilities; profiles prefill dependency-consistent sets", () => {
    expect(getCapabilityCatalog([])).toHaveLength(42)
    expect(profileCapabilities("full_service")).toHaveLength(42)
    const media = profileCapabilities("media")
    expect(media).toHaveLength(39)
    expect(media).not.toContain("agency-production")
    const production = profileCapabilities("production")
    expect(production).not.toContain("agency-media-planning")
    expect(production).not.toContain("agency-rebates") // depends on rate cards (media buying)
    expect(production).toContain("agency-orchestrator")
    expect(production).toContain("agency-access-governance")
    const catalog = getCapabilityCatalog(production)
    expect(catalog).toHaveLength(42)
    expect(catalog.filter((c) => c.enabled)).toHaveLength(production.length)
  })
})

describe("J01 build and activate an agency", () => {
  const slug = `j01-${ts}`
  let s: SessionInfo
  let draftId = ""
  let agencyId = ""

  beforeAll(async () => {
    s = await sessionFor("user_demo_owner")
  })

  it("creates exactly one tenant per idempotency key (refresh / double submit)", async () => {
    const k = key("draft")
    const [a, b] = await Promise.all([createAgencyDraft(s, { idempotencyKey: k }), createAgencyDraft(s, { idempotencyKey: k })])
    expect(a.draftId).toBe(b.draftId)
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1)
    const again = await createAgencyDraft(s, { idempotencyKey: k })
    expect(again).toMatchObject({ draftId: a.draftId, created: false })
    const rows = await ownerDb().select().from(schema.agency).where(eq(schema.agency.createIdempotencyKey, `${s.user.id}:${k}`))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe("draft")
    expect(rows[0]!.demoSeedVersion).toMatch(/^ageos-demo-2027-aurora-v1/)
    draftId = a.draftId
    agencyId = a.agencyId
    const draft = await getDraft(s, draftId)
    expect(draft.nextStep).toBe("agency")
    expect(draft.catalog).toHaveLength(42)
  })

  it("validates each step on the server and keeps the optimistic revision", async () => {
    const r0 = (await getDraft(s, draftId)).revision.revision
    await expectError(saveSetupStep(s, draftId, 1, { ...agencyStep(slug), country: "AR" }, r0), "validation")
    const r1 = (await saveSetupStep(s, draftId, 1, agencyStep(slug), r0)).revision
    await expectError(saveSetupStep(s, draftId, 1, agencyStep(slug), r0), "revision_conflict")

    const ops = profileDefaults("full_service")
    await expectError(
      saveSetupStep(s, draftId, 2, { ...ops, enabledCapabilities: ops.enabledCapabilities.filter((x) => x !== "agency-access-governance") }, r1),
      "blocked_by_rule",
      "mandatory_capability"
    )
    await expectError(
      saveSetupStep(s, draftId, 2, { ...ops, enabledCapabilities: ops.enabledCapabilities.filter((x) => x !== "agency-production-estimating") }, r1),
      "blocked_by_rule",
      "dependency_missing"
    )
    const r2 = (await saveSetupStep(s, draftId, 2, ops, r1)).revision

    await expectError(
      saveSetupStep(s, draftId, 3, { mode: "simulated", accounts: [{ provider: "meta_ads", accountAlias: "j01_meta", scopes: ["payments.initiate"] }] }, r2),
      "validation",
      "scope_not_offered"
    )
    const r3 = (await saveSetupStep(s, draftId, 3, { mode: "simulated", accounts: [{ provider: "meta_ads", accountAlias: "j01_meta", scopes: ["ads.read", "ads.manage"] }] }, r2)).revision

    await expectError(saveSetupStep(s, draftId, 4, { ...brandStep(slug), accent: "#fbbf24" }, r3), "validation", "contrast_below_4_5")
    await expectError(saveSetupStep(s, draftId, 4, brandStep(slug, "estudio.agencia.com"), r3), "validation", "domain_must_end_with_example")
    await expectError(saveSetupStep(s, draftId, 4, brandStep("rayo-de-sol"), r3), "validation", "slug_taken")
    const r4 = (await saveSetupStep(s, draftId, 4, brandStep(slug, `estudio.${slug}.example`), r3)).revision

    // Refresh: the draft is persisted and resumes at Review.
    const draft = await getDraft(s, draftId)
    expect(draft.revision.revision).toBe(r4)
    expect(draft.nextStep).toBe("review")
    expect(draft.sections.brandAccess.appSlug).toBe(slug)
    const v = await validateConfiguration(s, draftId)
    expect(v.valid).toBe(true)
    expect(v.summary.catalog).toMatchObject({ modules: 9, skills: 42, enabled: 42 })
    expect(v.summary.publish.revisionNumber).toBe(1)
    const review = await saveSetupStep(s, draftId, 5, {}, r4)
    expect(review.lastCompletedStep).toBe(5)
  })

  it("only an owner of the draft can read it; platform identities cannot use the control plane", async () => {
    await expectError(getDraft(await sessionFor("user_demo_operator"), draftId), "not_found")
    await expectError(listControlAgencies(await sessionFor("user_demo_platform_operator")), "forbidden")
  })

  it("activates with eight persisted steps; /a/<slug> opens; re-deploy returns the same run", async () => {
    const before = await resolveAgencyContext(s, slug)
    expect(before).toBeNull() // not ready yet
    const run = await startActivation(s, draftId, key("deploy"))
    expect(run.state).toBe("succeeded")
    expect(run.steps.map((x) => x.key)).toEqual([
      "validate",
      "create_workspace",
      "apply_roles",
      "publish_configuration",
      "prepare_storage",
      "enable_capabilities",
      "check_access",
      "ready",
    ])
    expect(run.steps.every((x) => x.state === "succeeded" && x.startedAt && x.finishedAt)).toBe(true)
    expect(run.result).toEqual({ path: `/a/${slug}`, domainPending: true })
    const again = await startActivation(s, draftId, key("deploy-again"))
    expect(again.runId).toBe(run.runId)

    const ctx = await resolveAgencyContext(s, slug)
    expect(ctx?.role).toBe("owner")
    expect(ctx?.tenant.appName).toBe(`App ${slug}`)
    expect(ctx?.enabledCapabilities.size).toBe(42)
    expect(ctx?.branding.accent).toBe("#1d4ed8")
    const conns = await ownerDb().select().from(schema.connection).where(eq(schema.connection.tenantId, agencyId))
    expect(conns.map((c) => [c.provider, c.state])).toEqual([["meta_ads", "connected_demo"]])
    const runs = await ownerDb().select().from(schema.activationRun).where(eq(schema.activationRun.tenantId, agencyId))
    expect(runs).toHaveLength(1)
    await expectError(saveSetupStep(s, draftId, 1, agencyStep(slug), (await getDraft(s, draftId)).revision.revision), "blocked_by_rule", "draft_not_editable")

    const listed = (await listControlAgencies(s)).find((x) => x.agencyId === agencyId)
    expect(listed).toMatchObject({ status: "ready", canOpenWorkspace: true, demoPath: `/a/${slug}`, latestActivation: { runId: run.runId, state: "succeeded" } })
  })

  it("custom domain stays simulated: Requested → Pending DNS → Verifying → Simulated ready", async () => {
    const states: string[] = []
    let current = "requested" as "requested" | "pending_dns" | "verifying" | "simulated_ready"
    for (let i = 0; i < 3; i++) {
      const r = await simulateDnsVerification(s, agencyId, current)
      expect(r).toMatchObject({ simulated: true, realDnsChecked: false })
      states.push(r.state)
      current = r.state as typeof current
    }
    expect(states).toEqual(["pending_dns", "verifying", "simulated_ready"])
    await expectError(simulateDnsVerification(s, agencyId, "simulated_ready"), "blocked_by_rule", "domain_simulation_complete")
    await expectError(simulateDnsVerification(s, agencyId, "requested"), "revision_conflict")
  })
})

describe("activation failure, waiting and resume", () => {
  it("a failed step blocks the agency; retry resumes from that step without repeating earlier ones", async () => {
    const s = await sessionFor("user_demo_owner")
    const slug = `j01-retry-${ts}`
    const d = await createAgencyDraft(s, { idempotencyKey: key("retry") })
    await fillDraft(s, d.draftId, slug)
    // Real failure: a regular file occupies the tenant's private storage prefix.
    const blocker = path.resolve(process.env.AGEOS_STORAGE_DIR!, d.agencyId)
    await mkdir(path.dirname(blocker), { recursive: true })
    await writeFile(blocker, "not a directory")
    try {
      const failed = await startActivation(s, d.draftId, key("deploy"))
      expect(failed.state).toBe("failed")
      expect(failed.canRetry).toBe(true)
      const step = failed.steps.find((x) => x.key === "prepare_storage")!
      expect(step.state).toBe("failed")
      expect(step.error).toBe("storage_unavailable")
      expect(failed.steps.slice(0, 4).every((x) => x.state === "succeeded")).toBe(true)
      expect(failed.agency.status).toBe("blocked")
      expect(await resolveAgencyContext(s, slug)).toBeNull()
      const validateStartedAt = failed.steps[0]!.startedAt
      await rm(blocker)
      const resumed = await retryFailedStep(s, failed.runId)
      expect(resumed.state).toBe("succeeded")
      expect(resumed.steps[0]!.startedAt).toBe(validateStartedAt)
      expect(resumed.agency.status).toBe("ready")
      expect(await resolveAgencyContext(s, slug)).not.toBeNull()
      await expectError(retryFailedStep(s, failed.runId), "blocked_by_rule", "not_retryable")
    } finally {
      await rm(blocker, { force: true, recursive: true })
    }
  })

  it("re-deploying the prepared Rayo draft waits for a revoked connection, then publishes r2", async () => {
    const s = await sessionFor("user_demo_owner")
    const draftId = id("config_rayo_r2_draft")
    const draft = await getDraft(s, draftId)
    expect(draft.agency).toMatchObject({ slug: "rayo-de-sol", existing: true })
    expect(draft.nextStep).toBe("review")
    await saveSetupStep(s, draftId, 5, {}, draft.revision.revision)
    const meta = and(eq(schema.connection.tenantId, id("tenant_demo_rayo")), eq(schema.connection.accountAlias, "demo_meta_aurora"))
    await ownerDb().update(schema.connection).set({ state: "revoked" }).where(meta)
    const waiting = await startActivation(s, draftId, key("redeploy"))
    expect(waiting.state).toBe("waiting")
    expect(waiting.waitingFor).toBe("connections")
    expect(waiting.agency.status).toBe("ready") // the live workspace keeps working
    const [revoked] = await ownerDb().select().from(schema.connection).where(meta)
    expect(revoked!.state).toBe("revoked") // never silently restored
    await ownerDb().update(schema.connection).set({ state: "connected_demo" }).where(meta)
    const done = await retryFailedStep(s, waiting.runId)
    expect(done.state).toBe("succeeded")
    expect(done.result?.path).toBe("/a/rayo-de-sol")
    const ctx = await ctxFor("user_demo_owner")
    expect(ctx.tenant.publishedConfigRevisionId).toBe(draftId)
    const revs = await listConfigurationRevisions(ctx)
    expect(revs.find((r) => r.number === 1)?.state).toBe("superseded")
    expect(revs.find((r) => r.number === 2)).toMatchObject({ state: "ready", published: true })
  })
})

describe("capability change on an existing agency (owner approval, SoD)", () => {
  async function publishedNumber() {
    const ctx = await ctxFor("user_demo_owner")
    return (await listConfigurationRevisions(ctx)).find((r) => r.published)!.number
  }

  it("blocks mandatory and dependency violations", async () => {
    const op = await ctxFor("user_demo_operator")
    const n = await publishedNumber()
    await expectError(proposeCapabilityChange(op, { disable: ["agency-access-governance"], reason: "Try", idempotencyKey: key("cap"), expectedRevision: n }), "blocked_by_rule", "mandatory_capability")
    await expectError(proposeCapabilityChange(op, { disable: ["agency-media-planning"], reason: "Try", idempotencyKey: key("cap"), expectedRevision: n }), "blocked_by_rule", "dependency_required")
    await expectError(proposeCapabilityChange(op, { disable: ["agency-ooh-inventory"], reason: "Try", idempotencyKey: key("cap"), expectedRevision: n - 1 }), "revision_conflict")
    await expectError(proposeCapabilityChange(await ctxFor("user_demo_viewer"), { disable: ["agency-ooh-inventory"], reason: "Try", idempotencyKey: key("cap"), expectedRevision: n }), "forbidden")
  })

  it("requester cannot approve; another owner approves the exact digest and publishes; stale siblings are refused", async () => {
    const n = await publishedNumber()
    const owner = await ctxFor("user_demo_owner")
    const self = await proposeCapabilityChange(owner, { disable: ["agency-transmission-control"], reason: "Owner self", idempotencyKey: key("cap"), expectedRevision: n })
    await expectError(
      decideCapabilityChange(owner, { revisionId: self.result.revisionId, decision: "approve", reviewedDigest: self.result.payloadDigest, idempotencyKey: key("dec") }),
      "self_approval"
    )
    const op = await ctxFor("user_demo_operator")
    const a = await proposeCapabilityChange(op, { disable: ["agency-ooh-inventory"], reason: "No OOH inventory this quarter", idempotencyKey: key("cap"), expectedRevision: n })
    const b = await proposeCapabilityChange(op, { disable: ["agency-fixed-assets"], reason: "Sibling change", idempotencyKey: key("cap"), expectedRevision: n })
    expect(a.result.diff).toEqual({ enabled: [], disabled: ["agency-ooh-inventory"] })
    await expectError(
      decideCapabilityChange(op, { revisionId: a.result.revisionId, decision: "approve", reviewedDigest: a.result.payloadDigest, idempotencyKey: key("dec") }),
      "forbidden"
    )
    const decided = await decideCapabilityChange(owner, { revisionId: a.result.revisionId, decision: "approve", reviewedDigest: a.result.payloadDigest, idempotencyKey: key("dec") })
    expect(decided.result).toEqual({ outcome: "published", published: true })
    const after = await ctxFor("user_demo_owner")
    expect(after.enabledCapabilities.has("agency-ooh-inventory")).toBe(false)
    expect(after.enabledCapabilities.size).toBe(41)
    const stale = await decideCapabilityChange(owner, { revisionId: b.result.revisionId, decision: "approve", reviewedDigest: b.result.payloadDigest, idempotencyKey: key("dec") })
    expect(stale.result.outcome).toBe("stale")
    const revs = await listConfigurationRevisions(after)
    expect(revs.find((r) => r.id === b.result.revisionId)?.state).toBe("stale")
    expect(revs.find((r) => r.number === n)?.state).toBe("superseded") // history kept
    // The prepared wizard draft cannot silently re-enable it: capability diffs need approval.
    const events = await ownerDb()
      .select()
      .from(schema.businessEvent)
      .where(and(eq(schema.businessEvent.tenantId, after.tenant.id), like(schema.businessEvent.eventType, "configuration.change_%")))
    expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["configuration.change_proposed", "configuration.change_published", "configuration.change_stale"]))
  })
})
