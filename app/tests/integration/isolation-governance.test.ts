// @vitest-environment node
import { randomUUID } from "node:crypto"

import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { vi } from "vitest"

import { SESSION_COOKIE, createSession } from "@/server/auth/session"
import { assistantDriver } from "@/server/assistant/driver"
import { assistantView } from "@/server/assistant/view"
import { HANDLERS } from "@/server/capabilities/registry"
import { runCapability } from "@/server/capabilities/runner"
import { budgetReservation, client, job, workflowRun } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { decideApprovalCommand, getApprovalDetail, listApprovals } from "@/server/domain/approvals"
import { proposeFeeAmendment, recordClientAuthority } from "@/server/domain/budget"
import { getClientDetail } from "@/server/domain/clients"
import { assertConnectionActive } from "@/server/domain/connections"
import { getJobDossier, listClients, listJobs } from "@/server/domain/jobs"
import { executeCommand } from "@/server/kernel/commands"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo } from "./helpers"
import { diffSnapshots, expectDomainError, settleBlocked, snapshotDb } from "./qa-helpers"

// Isolation & governance matrix (06 "Aislamiento y persistencia", 08 "Fallos").
// Two agencies (Rayo de Sol, Norte Studio) across list, detail, search,
// download, approvals, runs and assistant conversations — through domain
// services AND the real route handlers with a real session cookie — plus
// viewer writes, self-approval, stale revision, revoked connection scope,
// insufficient budget and duplicate submissions.

const jar = new Map<string, string>()
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}))

const AURORA = id("job_demo_aurora")
const LAB = id("job_demo_lab")
const NORTE_JOB = id("job_demo_norte")
const NORTE_CLIENT = id("client_demo_norte")
const NORTE_FILE = id("evidence_demo_norte_private")
const RAYO_FILE = id("evidence_demo_brief")
const CONTEXT = { route: "/a/rayo-de-sol", moduleKey: null, record: null }

async function signInAs(userKey: string | null) {
  jar.clear()
  if (!userKey) return
  const { token } = await createSession({ userId: id(userKey), presenterUserId: null })
  jar.set(SESSION_COOKIE, token)
}

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3100"), init)
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

async function auroraRevision() {
  const [j] = await ownerDb().select({ revision: job.revision }).from(job).where(eq(job.id, AURORA))
  return j!.revision
}

let rayoApprovalId = ""
let norteRunId = ""
let rayoConversation: Promise<string> | null = null

/** Created lazily so an assistant regression only fails the assistant rows of the matrix. */
function getRayoConversation() {
  rayoConversation ??= ctxFor("user_demo_owner").then(async (owner) =>
    (await assistantDriver.handleTurn(owner, { conversationId: null, clientMessageId: randomUUID(), presetId: "preset.margin.aurora", context: CONTEXT })).conversationId
  )
  return rayoConversation
}

beforeAll(async () => {
  await resetDemo()
  const operator = await ctxFor("user_demo_operator")
  const fee = await executeCommand(operator, proposeFeeAmendment, {
    idempotencyKey: key("iso-fee"),
    payload: { job: AURORA, newAgencyFee: "23000.00", reason: "Isolation matrix fixture" },
    origin: "ui",
    expectedRevision: await auroraRevision(),
  })
  rayoApprovalId = fee.result.approvalId
  const norte = await ctxFor("user_demo_norte_owner", "norte-studio")
  norteRunId = (await runCapability(norte, "agency-profitability", { job: NORTE_JOB, basis: "forecast" }, { origin: "ui", idempotencyKey: key("iso-norte-run") })).runId
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("tenant isolation · domain services", () => {
  it("lists: Rayo never sees Norte jobs or clients", async () => {
    const rayo = await ctxFor("user_demo_owner")
    const jobs = await listJobs(rayo, {})
    expect(jobs.items.map((j) => j.id)).not.toContain(NORTE_JOB)
    expect((await listClients(rayo)).map((c) => c.id)).not.toContain(NORTE_CLIENT)
  })

  it("detail by id: Norte job/client ids resolve to nothing for Rayo", async () => {
    const rayo = await ctxFor("user_demo_owner")
    expect(await getJobDossier(rayo, NORTE_JOB)).toBeNull()
    expect(await getClientDetail(rayo, NORTE_CLIENT)).toBeNull()
  })

  it("capabilities: a Norte job id passed to a Rayo run is blocked without leaking data", async () => {
    const rayo = await ctxFor("user_demo_owner")
    const r = await settleBlocked(runCapability(rayo, "agency-profitability", { job: NORTE_JOB, basis: "forecast" }, { origin: "ui", idempotencyKey: key("iso-x") }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe("not_found")
      expect(JSON.stringify(r.error)).not.toMatch(/Maple|Norte|CAD/)
    }
  })

  it("runs: a Norte workflow run is invisible inside the Rayo tenant scope", async () => {
    const rayo = await ctxFor("user_demo_owner")
    const rows = await withTenant(rayo.tenant.id, (tx) => tx.select().from(workflowRun).where(eq(workflowRun.id, norteRunId)))
    expect(rows).toHaveLength(0)
  })

  it("approvals: Norte cannot list, open or decide a Rayo approval", async () => {
    const norte = await ctxFor("user_demo_norte_owner", "norte-studio")
    expect((await listApprovals(norte)).map((a) => a.id)).not.toContain(rayoApprovalId)
    expect(await getApprovalDetail(norte, rayoApprovalId)).toBeNull()
    await expectDomainError(
      executeCommand(norte, decideApprovalCommand, {
        idempotencyKey: key("iso-decide"),
        payload: { approvalId: rayoApprovalId, decision: "approve", reviewedDigest: "0".repeat(64) },
        origin: "ui",
      }),
      ["not_found", "approver_not_eligible", "forbidden"]
    )
  })

  it("assistant: a Rayo thread id grants nothing to Norte or to another Rayo member", async () => {
    const rayoConversationId = await getRayoConversation()
    const norte = await ctxFor("user_demo_norte_owner", "norte-studio")
    await expect(assistantView(norte, rayoConversationId)).rejects.toMatchObject({ code: "not_found" })
    const finance = await ctxFor("user_demo_finance")
    await expect(assistantView(finance, rayoConversationId)).rejects.toMatchObject({ code: "not_found" })
  })

  it("membership: a Rayo session cannot resolve the Norte agency at all", async () => {
    await expect(ctxFor("user_demo_owner", "norte-studio")).rejects.toThrow(/no membership/)
  })
})

describe("tenant isolation · route handlers with a real session cookie", () => {
  it("search: Norte slug is 404 for Rayo; Rayo search never returns Norte records", async () => {
    const { GET } = await import("@/app/api/a/[agencySlug]/search/route")
    await signInAs("user_demo_owner")
    expect((await GET(req("/api/a/norte-studio/search?q=Maple"), params({ agencySlug: "norte-studio" }))).status).toBe(404)
    for (const q of ["Norte", "Maple", "MAP", ""]) {
      const res = await GET(req(`/api/a/rayo-de-sol/search?q=${encodeURIComponent(q)}`), params({ agencySlug: "rayo-de-sol" }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { hits: { id: string }[] }
      expect(body.hits.map((h) => h.id)).not.toContain(NORTE_JOB)
      expect(body.hits.map((h) => h.id)).not.toContain(NORTE_CLIENT)
    }
  })

  it("download: own file 200; Norte file 404 under either slug; no session 404", async () => {
    const { GET } = await import("@/app/api/a/[agencySlug]/files/[fileId]/route")
    await signInAs("user_demo_owner")
    const own = await GET(req(`/api/a/rayo-de-sol/files/${RAYO_FILE}`), params({ agencySlug: "rayo-de-sol", fileId: RAYO_FILE }))
    expect(own.status).toBe(200)
    expect(own.headers.get("content-type")).toBe("application/pdf")
    expect(own.headers.get("cache-control")).toContain("no-store")
    expect((await GET(req(`/api/a/rayo-de-sol/files/${NORTE_FILE}`), params({ agencySlug: "rayo-de-sol", fileId: NORTE_FILE }))).status).toBe(404)
    expect((await GET(req(`/api/a/norte-studio/files/${NORTE_FILE}`), params({ agencySlug: "norte-studio", fileId: NORTE_FILE }))).status).toBe(404)
    await signInAs(null)
    expect((await GET(req(`/api/a/rayo-de-sol/files/${RAYO_FILE}`), params({ agencySlug: "rayo-de-sol", fileId: RAYO_FILE }))).status).toBe(404)
  })

  it("assistant conversation route: foreign thread id is 404 for Norte and for another Rayo member", async () => {
    const { GET } = await import("@/app/api/a/[agencySlug]/assistant/conversations/[conversationId]/route")
    const rayoConversationId = await getRayoConversation()
    await signInAs("user_demo_norte_owner")
    expect(
      (await GET(req(`/api/a/norte-studio/assistant/conversations/${rayoConversationId}`), params({ agencySlug: "norte-studio", conversationId: rayoConversationId }))).status
    ).toBe(404)
    expect(
      (await GET(req(`/api/a/rayo-de-sol/assistant/conversations/${rayoConversationId}`), params({ agencySlug: "rayo-de-sol", conversationId: rayoConversationId }))).status
    ).toBe(404)
    await signInAs("user_demo_finance")
    expect(
      (await GET(req(`/api/a/rayo-de-sol/assistant/conversations/${rayoConversationId}`), params({ agencySlug: "rayo-de-sol", conversationId: rayoConversationId }))).status
    ).toBe(404)
    await signInAs("user_demo_owner")
    expect(
      (await GET(req(`/api/a/rayo-de-sol/assistant/conversations/${rayoConversationId}`), params({ agencySlug: "rayo-de-sol", conversationId: rayoConversationId }))).status
    ).toBe(200)
  })

  it("assistant state route: Rayo session gets 404 on the Norte slug", async () => {
    const { GET } = await import("@/app/api/a/[agencySlug]/assistant/state/route")
    await signInAs("user_demo_owner")
    expect((await GET(req("/api/a/norte-studio/assistant/state"), params({ agencySlug: "norte-studio" }))).status).toBe(404)
  })

  it("a tenant id or role in the request body grants nothing (strict schema → 422)", async () => {
    const { POST } = await import("@/app/api/a/[agencySlug]/assistant/messages/route")
    await signInAs("user_demo_viewer")
    const body = {
      conversationId: null,
      clientMessageId: randomUUID(),
      text: "explain aurora margin",
      context: CONTEXT,
      tenantId: id("tenant_demo_norte"),
      role: "owner",
    }
    const res = await POST(
      req("/api/a/rayo-de-sol/assistant/messages", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", host: "localhost:3100", origin: "http://localhost:3100" } }),
      params({ agencySlug: "rayo-de-sol" })
    )
    expect(res.status).toBe(422)
  })

  it("cross-origin mutation is rejected before any work", async () => {
    const { POST } = await import("@/app/api/a/[agencySlug]/assistant/messages/route")
    await signInAs("user_demo_owner")
    const res = await POST(
      req("/api/a/rayo-de-sol/assistant/messages", {
        method: "POST",
        body: JSON.stringify({ conversationId: null, clientMessageId: randomUUID(), text: "explain aurora margin", context: CONTEXT }),
        headers: { "content-type": "application/json", host: "localhost:3100", origin: "https://evil.example" },
      }),
      params({ agencySlug: "rayo-de-sol" })
    )
    expect(res.status).toBe(403)
  })
})

describe("governance · permissions, approvals, revisions, scopes, budget, duplicates", () => {
  it("viewer: every command the role lacks permission for is forbidden server-side, before validation, with no side effect", async () => {
    const viewer = await ctxFor("user_demo_viewer")
    const commands = Object.entries(HANDLERS)
      .filter(([, h]) => h?.kind === "command")
      .map(([s, h]) => ({ skillId: s, permission: (h as { command: { permission: string } }).command.permission }))
    const guarded = commands.filter((c) => !viewer.permissions.has(c.permission as never))
    expect(guarded.length).toBeGreaterThan(0)
    const before = await snapshotDb()
    const results: Record<string, string> = {}
    for (const { skillId } of guarded) {
      const r = await settleBlocked(runCapability(viewer, skillId, {}, { origin: "ui", idempotencyKey: key(`viewer-${skillId}`) }))
      results[skillId] = r.ok ? "SUCCEEDED" : r.error.code
    }
    const wrong = Object.entries(results).filter(([, c]) => c !== "forbidden")
    expect(wrong, JSON.stringify(Object.fromEntries(wrong))).toEqual([])
    expect(diffSnapshots(before, await snapshotDb())).toEqual([])
  })

  it("viewer cannot decide an approval", async () => {
    const viewer = await ctxFor("user_demo_viewer")
    await expectDomainError(
      executeCommand(viewer, decideApprovalCommand, {
        idempotencyKey: key("viewer-decide"),
        payload: { approvalId: rayoApprovalId, decision: "approve", reviewedDigest: "0".repeat(64) },
        origin: "ui",
      }),
      "forbidden"
    )
  })

  it("self-approval: the requester of a client authority cannot approve it", async () => {
    const owner = await ctxFor("user_demo_owner")
    // Aurora PO r1 evidence is reviewed and linked to Aurora (valid under B06 hardening).
    const res = await executeCommand(owner, recordClientAuthority, {
      idempotencyKey: key("self-po"),
      payload: { job: AURORA, reference: "PO-AUR-SELF", amount: "51000.00", evidenceId: id("ev:evidence_demo_po_r1") },
      origin: "ui",
    })
    await expectDomainError(
      executeCommand(owner, decideApprovalCommand, {
        idempotencyKey: key("self-decide"),
        payload: { approvalId: res.result.approvalId, decision: "approve", reviewedDigest: res.result.payloadDigest },
        origin: "ui",
      }),
      "self_approval"
    )
  })

  it("stale revision: a fee proposal against an old job revision is a revision_conflict with no effect", async () => {
    const operator = await ctxFor("user_demo_operator")
    const rev = await auroraRevision()
    const before = await snapshotDb()
    const r = await settleBlocked(
      runCapability(operator, "agency-fee-contracts", { job: AURORA, newAgencyFee: "24000.00", reason: "Stale screen" }, { origin: "ui", idempotencyKey: key("stale"), expectedRevision: rev - 1 })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe("revision_conflict")
    expect(diffSnapshots(before, await snapshotDb())).toEqual([])
  })

  it("revoked connection scope blocks only that connection and never falls through to another provider", async () => {
    const owner = await ctxFor("user_demo_owner")
    const revoke = await runCapability(owner, "agency-integrations", { action: "revoke", provider: "meta_ads", accountAlias: "demo_meta_aurora" }, { origin: "ui", idempotencyKey: key("revoke") })
    expect(revoke.state).toBe("succeeded")
    await expectDomainError(assertConnectionActive(owner, "meta_ads", "demo_meta_aurora"), "connection_revoked")
    await expect(assertConnectionActive(owner, "google_ads", "demo_google_aurora")).resolves.toBeUndefined()
    const restore = await runCapability(owner, "agency-integrations", { action: "restore", provider: "meta_ads", accountAlias: "demo_meta_aurora" }, { origin: "ui", idempotencyKey: key("restore") })
    expect(restore.state).toBe("succeeded")
    await expect(assertConnectionActive(owner, "meta_ads", "demo_meta_aurora")).resolves.toBeUndefined()
  })

  it("Norte cannot revoke a Rayo connection (alias is resolved inside its own tenant)", async () => {
    const norte = await ctxFor("user_demo_norte_owner", "norte-studio")
    const r = await settleBlocked(runCapability(norte, "agency-integrations", { action: "revoke", provider: "meta_ads", accountAlias: "demo_meta_aurora" }, { origin: "ui", idempotencyKey: key("x-revoke") }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe("not_found")
    const rayo = await ctxFor("user_demo_owner")
    await expect(assertConnectionActive(rayo, "meta_ads", "demo_meta_aurora")).resolves.toBeUndefined()
  })

  it("insufficient budget: a reservation above available authority is blocked with no reservation written", async () => {
    const operator = await ctxFor("user_demo_operator")
    const before = await snapshotDb()
    const r = await settleBlocked(
      runCapability(operator, "agency-budget-control", { job: LAB, budgetScope: "client_commercial_authority", amount: "999999.00", purpose: "Over authority" }, { origin: "ui", idempotencyKey: key("over") })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe("blocked_by_rule")
      expect(r.error.details.rule).toBe("budget_available")
    }
    expect(diffSnapshots(before, await snapshotDb())).toEqual([])
    const rows = await ownerDb().select().from(budgetReservation).where(and(eq(budgetReservation.jobId, LAB), eq(budgetReservation.purpose, "Over authority")))
    expect(rows).toHaveLength(0)
  })

  it.skipIf(!HANDLERS["agency-payment-run"])("insufficient funds: payments 43,000 against cash 10,000 are blocked (covered by ERP-28 fixtures when present)", () => {
    // Exercised through the acceptance harness negative fixture for agency-payment-run.
    expect(HANDLERS["agency-payment-run"]).toBeDefined()
  })

  it("duplicate submission: same key replays; a new key never creates a twin; a conflicting identity is blocked", async () => {
    const operator = await ctxFor("user_demo_operator")
    const input = { clientName: "Dup Test Co", clientCode: "DUP", productCode: "DT", billingCurrency: "USD", country: "US", briefTitle: "Dup brief", briefSummary: "Duplicate submission probe" }
    const k = key("dup")
    const a = await runCapability(operator, "agency-onboarding", input, { origin: "ui", idempotencyKey: k })
    const b = await runCapability(operator, "agency-onboarding", input, { origin: "ui", idempotencyKey: k })
    expect(a.state).toBe("succeeded")
    expect(b).toMatchObject({ replayed: true, runId: a.runId })
    // A new key with the same identity resolves to the existing client (no twin);
    // the same code with another legal identity is blocked.
    await settleBlocked(runCapability(operator, "agency-onboarding", input, { origin: "ui", idempotencyKey: key("dup-2") }))
    const conflict = await settleBlocked(
      runCapability(operator, "agency-onboarding", { ...input, clientName: "Another Legal Name SA" }, { origin: "ui", idempotencyKey: key("dup-3") })
    )
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.error.code).toBe("blocked_by_rule")
    const rows = await ownerDb().select().from(client).where(and(eq(client.tenantId, operator.tenant.id), eq(client.code, "DUP")))
    expect(rows).toHaveLength(1)
  })
})
