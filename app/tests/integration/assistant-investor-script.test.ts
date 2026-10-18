// @vitest-environment node
import { and, eq, sql } from "drizzle-orm"

import type { MessagePart } from "@/lib/assistant/types"
import { resolveAgencyContext, type AgencyContext } from "@/server/auth/context"
import { createSession, loadSession, type SessionInfo } from "@/server/auth/session"
import { assistantDriver } from "@/server/assistant/driver"
import { loadSampleScopeRequest } from "@/server/assistant/presenter-scope"
import { matchScenarios } from "@/server/assistant/scenarios"
import { assistantView } from "@/server/assistant/view"
import { actionProposal, approvalRequest, assistantRun, assistantToolCall, businessEvent, costEstimate, platformAuditEvent, workflowRun } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { decideApprovalCommand } from "@/server/domain/approvals"
import { computeProfitability, loadJobFinancials } from "@/server/domain/profitability"
import { executeCommand } from "@/server/kernel/commands"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo } from "./helpers"

// Investor script, 90-second walkthrough (05-guion-demo-inversionistas.md):
// 25–40 s attention on the job, 40–58 s margin change + fee adjustment for
// review, the presenter's "Load sample scope request", plus the 07 tool
// attach_authorized_file. Every figure is read from the ERP.

const AURORA = id("job_demo_aurora")
const SLUG = "rayo-de-sol"

const hint = (ctx: AgencyContext, record: string | null = AURORA) => ({
  route: record ? `/a/${ctx.tenant.slug}/jobs/${record}` : `/a/${ctx.tenant.slug}`,
  moduleKey: null,
  record: record ? { type: "job" as const, id: record } : null,
})
const say = (ctx: AgencyContext, text: string, record: string | null = AURORA, conversationId: string | null = null) =>
  assistantDriver.handleTurn(ctx, { conversationId, clientMessageId: crypto.randomUUID(), text, context: hint(ctx, record) })
const partsOf = async (ctx: AgencyContext, conversationId: string) => (await assistantView(ctx, conversationId)).messages.flatMap((m) => m.parts)
const ofType = <T extends MessagePart["type"]>(parts: MessagePart[], type: T) => parts.filter((p): p is Extract<MessagePart, { type: T }> => p.type === type)

async function presenter(): Promise<{ session: SessionInfo; ctx: AgencyContext }> {
  // Opened like the access-code sign-in: the presenter acts as the operator persona.
  const { token } = await createSession({ userId: id("user_demo_operator"), presenterUserId: id("user_demo_owner") })
  const session = (await loadSession(token))!
  const ctx = (await resolveAgencyContext(session, SLUG))!
  return { session, ctx }
}

async function counts(ctx: AgencyContext) {
  return withTenant(ctx.tenant.id, async (tx) => ({
    estimates: (await tx.select({ n: sql<number>`count(*)::int` }).from(costEstimate).where(eq(costEstimate.jobId, AURORA)))[0]!.n,
    events: (await tx.select({ n: sql<number>`count(*)::int` }).from(businessEvent))[0]!.n,
    runs: (await tx.select({ n: sql<number>`count(*)::int` }).from(workflowRun))[0]!.n,
  }))
}

async function marginBps(ctx: AgencyContext) {
  return withTenant(ctx.tenant.id, async (tx) => computeProfitability(await loadJobFinancials(tx, ctx.tenant.id, AURORA), "forecast", SLUG).marginBps)
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("before the scope change", () => {
  it("prompt 2 says the change is not loaded and offers the presenter tool only to the presenter; nothing is prepared", async () => {
    const { ctx: p } = await presenter()
    const asPresenter = await say(p, "Explain the margin change and prepare the fee adjustment for review")
    const pp = await partsOf(p, asPresenter.conversationId)
    expect(ofType(pp, "text").map((x) => x.template)).toContain("assistant.marginChange.notLoaded")
    expect(ofType(pp, "suggestions")[0]!.items.map((s) => s.presetId)).toEqual(["preset.presenter.scope_request"])

    const operator = await ctxFor("user_demo_operator")
    const plain = await say(operator, "Explain the margin change and prepare the fee adjustment for review")
    const op = await partsOf(operator, plain.conversationId)
    expect(ofType(op, "text").map((x) => x.template)).toEqual(expect.arrayContaining(["assistant.marginChange.notLoaded", "assistant.marginChange.askPresenter"]))
    expect(ofType(op, "suggestions")).toHaveLength(0)
    const proposals = await withTenant(operator.tenant.id, (tx) => tx.select().from(actionProposal).where(eq(actionProposal.conversationId, plain.conversationId)))
    expect(proposals).toHaveLength(0)
    expect(await marginBps(operator)).toBe(4500)
  })

  it("non-presenters cannot load the sample scope request (assistant and domain) and never see it offered", async () => {
    const operator = await ctxFor("user_demo_operator")
    const before = await counts(operator)
    expect(assistantDriver.suggestions(operator).some((s) => s.presenterOnly)).toBe(false)
    const { conversationId } = await say(operator, "Load sample scope request")
    expect(ofType(await partsOf(operator, conversationId), "blocked")[0]).toMatchObject({ code: "forbidden" })
    const ordinary = (await loadSession((await createSession({ userId: id("user_demo_owner"), presenterUserId: null })).token))!
    await expect(loadSampleScopeRequest(ordinary)).rejects.toMatchObject({ code: "forbidden" })
    expect((await counts(operator)).estimates).toBe(before.estimates)
  })
})

describe("Load sample scope request (presenter)", () => {
  it("records the 40-hour scope change through the real J04.2 command; the dossier reads 35.0%; a replay has no second effect", async () => {
    const { session, ctx } = await presenter()
    expect(assistantDriver.suggestions(ctx).map((s) => s.presetId)).toContain("preset.presenter.scope_request")
    const before = await counts(ctx)
    const res = await loadSampleScopeRequest(session)
    expect(res).toMatchObject({ state: "loaded", laborMinutesBefore: 6000, laborMinutesAfter: 8400, costBeforeMinor: "1100000", costAfterMinor: "1300000", marginBpsBefore: 4500, marginBpsAfter: 3500 })
    expect(await marginBps(ctx)).toBe(3500)
    const after = await counts(ctx)
    expect(after.estimates).toBe(before.estimates + 1)
    const [run] = await withTenant(ctx.tenant.id, (tx) => tx.select().from(workflowRun).where(eq(workflowRun.id, res.runId!)))
    expect(run).toMatchObject({ skillId: "agency-production-estimating", origin: "presenter", state: "succeeded", actorUserId: id("user_demo_operator") })
    const audit = await ownerDb().select().from(platformAuditEvent).where(eq(platformAuditEvent.eventType, "presenter.sample_scope_request"))
    expect(audit.at(-1)).toMatchObject({ actorUserId: id("user_demo_owner") })

    const again = await loadSampleScopeRequest(session)
    expect(again.state).toBe("replayed")
    expect(again.runId).toBe(res.runId)
    // Same through the assistant's presenter suggestion: a receipt, no second estimate.
    const viaAssistant = await assistantDriver.handleTurn(ctx, { conversationId: null, clientMessageId: crypto.randomUUID(), presetId: "preset.presenter.scope_request", context: hint(ctx) })
    const parts = await partsOf(ctx, viaAssistant.conversationId)
    expect(ofType(parts, "receipt")[0]).toMatchObject({ replayed: true })
    expect((await counts(ctx)).estimates).toBe(after.estimates)
    expect(await marginBps(ctx)).toBe(3500)
  })
})

describe("25–40 s · What needs attention on this job?", () => {
  it.each([
    ["EN", "What needs attention on this job?"],
    ["ES", "¿Qué necesita atención en este trabajo?"],
  ])("%s: lists the job's authorized attention with record references, read-only", async (_l, prompt) => {
    const operator = await ctxFor("user_demo_operator")
    const before = await counts(operator)
    const { conversationId } = await say(operator, prompt)
    const parts = await partsOf(operator, conversationId)
    const attention = ofType(parts, "attention_items")[0]!
    expect(attention.job.id).toBe(AURORA)
    const floor = attention.items.find((i) => i.source === "attention" && i.title.en.startsWith("Projected margin below"))
    expect(floor).toBeDefined()
    expect(floor!.href.startsWith(`/a/${SLUG}/`)).toBe(true)
    expect(ofType(parts, "sources")[0]!.refs[0]).toMatchObject({ recordType: "job", recordId: AURORA })
    expect(ofType(parts, "text")[0]).toMatchObject({ template: "assistant.attention.summary" })
    const [run] = await withTenant(operator.tenant.id, (tx) => tx.select().from(assistantRun).where(eq(assistantRun.conversationId, conversationId)))
    expect(run).toMatchObject({ scenarioId: "S-JOB-ATTENTION", status: "completed" })
    // Read-only: no business event and no capability run was created.
    const after = await counts(operator)
    expect(after.events).toBe(before.events)
    expect(after.runs).toBe(before.runs)
  })

  it("without a job in context it asks to open one and runs nothing", async () => {
    const operator = await ctxFor("user_demo_operator")
    const { conversationId } = await say(operator, "What needs attention on this job?", null)
    expect(ofType(await partsOf(operator, conversationId), "text")[0]!.template).toBe("assistant.needsJobContext")
  })
})

describe("40–58 s · Explain the margin change and prepare the fee adjustment for review", () => {
  it("ES prompt selects the same scenario", () => {
    expect(matchScenarios("Explica el cambio de margen y prepara el ajuste de honorarios para revisión")[0]?.id).toBe("S-MARGIN-CHANGE-FEE")
    expect(matchScenarios("Explain the margin change and prepare the fee adjustment for review")[0]?.id).toBe("S-MARGIN-CHANGE-FEE")
  })

  it("a viewer is blocked before anything is prepared", async () => {
    const viewer = await ctxFor("user_demo_viewer")
    const { conversationId } = await say(viewer, "Explain the margin change and prepare the fee adjustment for review")
    expect(ofType(await partsOf(viewer, conversationId), "blocked")[0]).toMatchObject({ code: "forbidden", details: { permission: "budget.propose" } })
    expect(await withTenant(viewer.tenant.id, (tx) => tx.select().from(actionProposal).where(eq(actionProposal.conversationId, conversationId)))).toHaveLength(0)
  })

  it("explains 45.0% → 35.0% from 40 h / USD 2,000 (Forecast, sources) and prepares — never approves — the USD 3,000 fee amendment", async () => {
    const operator = await ctxFor("user_demo_operator")
    const { conversationId } = await say(operator, "Explain the margin change and prepare the fee adjustment for review")
    const parts = await partsOf(operator, conversationId)
    const explained = ofType(parts, "text").find((p) => p.template === "assistant.marginChange.explained")!
    expect(explained.params).toMatchObject({ hours: "40 h", cost: "USD 2,000.00", before: "45.0%", after: "35.0%" })
    const view = ofType(parts, "openui_view").find((v) => v.template === "margin_change")!
    expect(view.source).toContain('"basis": "forecast"')
    expect(ofType(parts, "sources")[0]!.refs.map((r) => r.recordType)).toEqual(["job", "budget_revision", "cost_estimate", "cost_estimate"])
    expect(ofType(parts, "text").map((p) => p.template)).toContain("assistant.marginChange.preparing")

    const proposal = ofType(parts, "proposal")[0]!
    expect(proposal.requires).toBe("approval")
    expect(proposal.rows.find((r) => r.label.en === "New agency fee")).toMatchObject({ before: "USD 20,000.00", after: "USD 23,000.00" })
    expect(proposal.impact.find((i) => i.label.en === "Fee change")?.value).toBe("+USD 3,000.00")
    expect(proposal.impact.find((i) => i.label.en === "Projected margin (Forecast)")?.value).toBe("35.0% → 43.5%")
    // A proposal only: no financial effect before confirmation.
    expect(await marginBps(operator)).toBe(3500)

    await assistantDriver.confirm(operator, { conversationId, proposalId: proposal.proposalId, digest: proposal.digest, clientMessageId: crypto.randomUUID() })
    const approval = ofType(await partsOf(operator, conversationId), "approval_request")[0]!
    expect(approval.state).toBe("awaiting_approval")
    // Still no financial effect: it waits for finance; the requester cannot approve it.
    expect(await marginBps(operator)).toBe(3500)
    const [req] = await withTenant(operator.tenant.id, (tx) => tx.select().from(approvalRequest).where(and(eq(approvalRequest.id, approval.approvalId))))
    expect(req!.amountMinor).toBe(300000n)
    await expect(
      executeCommand(operator, decideApprovalCommand, { idempotencyKey: key("self-approve"), payload: { approvalId: approval.approvalId, decision: "approve", reviewedDigest: req!.payloadDigest }, origin: "ui" })
    ).rejects.toMatchObject({ code: "forbidden" })
  })
})

describe("attach_authorized_file", () => {
  it("attaches an authorized library file of the same agency as a source, without interrupting the active run", async () => {
    const operator = await ctxFor("user_demo_operator")
    const { conversationId } = await assistantDriver.handleTurn(operator, { conversationId: null, clientMessageId: crypto.randomUUID(), presetId: "preset.job.create", context: hint(operator, null) })
    const fileId = id("evidence_demo_po_r2")
    await assistantDriver.attachFile(operator, { conversationId, fileId, clientMessageId: crypto.randomUUID() })
    const v = await assistantView(operator, conversationId)
    const ref = ofType(v.messages.flatMap((m) => m.parts), "sources").flatMap((s) => s.refs).find((r) => r.recordType === "file")!
    expect(ref).toMatchObject({ recordId: fileId, href: `/a/${SLUG}/library/${fileId}` })
    expect(v.conversation!.activeRun).toMatchObject({ scenarioId: "S-JOB-CREATE", status: "waiting_input" })
    const calls = await withTenant(operator.tenant.id, (tx) => tx.select().from(assistantToolCall).where(eq(assistantToolCall.toolFamily, "attach_authorized_file")))
    expect(calls.length).toBeGreaterThan(0)
  })

  it("never attaches a foreign or unknown file (uniform not_found)", async () => {
    const operator = await ctxFor("user_demo_operator")
    const { conversationId } = await say(operator, "What needs attention on this job?")
    await expect(assistantDriver.attachFile(operator, { conversationId, fileId: id("evidence_demo_norte_private"), clientMessageId: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" })
    await expect(assistantDriver.attachFile(operator, { conversationId, fileId: "11111111-2222-4333-8444-555555555555", clientMessageId: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" })
    const parts = await partsOf(operator, conversationId)
    expect(ofType(parts, "sources").flatMap((s) => s.refs).some((r) => r.recordType === "file")).toBe(false)
  })
})
