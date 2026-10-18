// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"

import { and, eq, sql } from "drizzle-orm"
import { vi } from "vitest"

import { buildPayload, initialValues, missingRequired } from "@/components/workbench/form-values"
import { prefillFromParams } from "@/components/workbench/prefill"
import { journeyApprovalIds, journeyOutputValue, journeyRunOrder, journeyStepHref, type Journey, type JourneyOutcome, type JourneyStep, type ParamSource, type RuntimeParam } from "@/lib/demo/journeys"
import { fixtureUuid } from "@/lib/fixture-ids"
import { decideApprovalAction, executeApprovedAction, runCapabilityAction } from "@/server/actions/capabilities"
import { decideCapabilityChangeAction, proposeCapabilityChangeAction } from "@/server/actions/ui/configuration"
import { reviewEvidenceAction } from "@/server/actions/ui/evidence"
import { linkFileToJobAction } from "@/server/actions/ui/library"
import { previewPaymentRunAction } from "@/server/actions/ui/payments"
import { queueSimulationOutcomeAction } from "@/server/actions/ui/presenter"
import { runRecordCommandAction, type RecordCommand } from "@/server/actions/ui/record-commands"
import { SESSION_COOKIE, createSession } from "@/server/auth/session"
import { getCapability, HANDLERS } from "@/server/capabilities/registry"
import * as s from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { bankAccountByConnection, cashPosition } from "@/server/domain/cash"
import { listConfigurationRevisions } from "@/server/domain/configuration"
import { journalsWithLines } from "@/server/domain/ledger"
import { computeProfitability, estimateTotals, loadJobFinancials } from "@/server/domain/profitability"
import { loadReferenceOptions } from "@/server/domain/references"
import { getApprovalView } from "@/server/queries/approvals"
import { getRecordDetail } from "@/server/queries/records"
import { seedDemo } from "@/server/seed/demo-seed"

import { closeOwnerDb, ctxFor, id, key, ownerDb } from "./helpers"

// Pre-browser proof that the J01–J10 catalog (lib/demo/journeys.ts) is
// coherent with the product: every workbench run, record command, connection
// action, approval decision, evidence review, library link, presenter control,
// payment preview and capability change runs IN ORDER as its persona through
// the same server action its screen calls. Workbench inputs resolve exactly
// like the page resolves `f.<field>` links (prefillFromParams → initialValues
// → client-side Required → buildPayload). Order and checkpoints follow the
// browser journey: journeyRunOrder() (J04 → J03 → J05 → J06 share one demo
// run); a journey resets to its entry checkpoint unless it continues another.
// Assistant, control-plane, ops and read-only steps are skipped with a reason.

const jar = new Map<string, string>()
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath }))

const SLUG = "rayo-de-sol"
// Same capability the browser journey proposes to disable (no enabled capability depends on it).
const CAP_CHANGE_SKILL = "agency-ooh-inventory"
const RECORD_COMMANDS = new Set<string>([
  "time.decideTimesheet",
  "media.acceptDelivery",
  "production.issueProductionOrder",
  "payments.executePayment",
  "payments.reconcilePayment",
  "cash.exportDemoBankStatement",
] satisfies RecordCommand[])

type Fixtures = {
  financial_checkpoints: { id: string; agency_fee_minor: number; managed_media_minor: number; labor_minutes: number; margin_bps: number; client_authority_minor: number; agency_cost_minor: number }[]
  final_cash: { closing_minor: number }
  expected_final_demo_journals: unknown[]
}
const FX = JSON.parse(readFileSync(path.resolve(process.cwd(), "../demo-fixtures.json"), "utf8")) as Fixtures
const checkpoint = (name: string) => FX.financial_checkpoints.find((c) => c.id === name)!

type Actual = { kind: "succeeded" | "pending_approval"; approvals: string[]; output: Record<string, unknown> } | { kind: "blocked"; code: string; rule: string | null; message: string }
type Result = { status: "passed" | "failed" | "skipped"; detail: string }
type StepResult = Result & { step: string; actor: string; performs: string }
type RunState = { runtime: Partial<Record<RuntimeParam, string>>; approvalIds: string[]; skippedAssistant: boolean; capabilityRevisionId?: string }

const summary: Record<string, { executed: number; passed: number; failed: number; skipped: number }> = {}
const lines: string[] = []

async function signInAs(userKey: string, presenter = false) {
  jar.clear()
  const { token } = await createSession({ userId: id(userKey), presenterUserId: presenter ? id(userKey) : null })
  jar.set(SESSION_COOKIE, token)
}

async function reset(mode: "ready_for_scope_review" | "from_intake") {
  await seedDemo(ownerDb(), { storageDir: process.env.AGEOS_STORAGE_DIR!, reset: true, mode })
}

const value = (src: ParamSource, state: RunState) => ("literal" in src ? src.literal : "fixture" in src ? fixtureUuid(src.fixture) : state.runtime[src.runtime])
const routeParam = (st: JourneyStep, name: string, state: RunState) => {
  const src = (st.surface.params ?? {})[name]
  return src ? value(src, state) : undefined
}
function stepInputs(st: JourneyStep, state: RunState) {
  const out: Record<string, string> = {}
  const missing: string[] = []
  for (const [k, src] of Object.entries(st.inputs ?? {})) {
    const v = value(src, state)
    if (v === undefined) missing.push(k)
    else out[k] = v
  }
  return { out, missing }
}

function fromAction(res: { ok: true; data: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }): Actual {
  if (!res.ok) return { kind: "blocked", code: res.error.code, rule: (res.error.details?.rule as string | undefined) ?? null, message: res.error.message }
  const output = (res.data ?? {}) as Record<string, unknown>
  const approvals = [...journeyApprovalIds(output)]
  return { kind: approvals.length ? "pending_approval" : "succeeded", approvals, output }
}

function fromRun(res: Awaited<ReturnType<typeof runCapabilityAction>>): Actual {
  if (!res.ok) return fromAction(res)
  if (res.data.state !== "succeeded" || res.data.error) {
    const e = res.data.error
    return { kind: "blocked", code: e?.code ?? res.data.state, rule: (e?.details?.rule as string | undefined) ?? null, message: e?.message ?? "" }
  }
  return fromAction({ ok: true, data: res.data.output })
}

const describeActual = (a: Actual) => (a.kind === "blocked" ? `blocked ${a.code}${a.rule ? `/${a.rule}` : ""}: ${a.message}` : a.kind)
const matches = (expected: JourneyOutcome | undefined, a: Actual) =>
  expected === undefined ? a.kind !== "blocked" : typeof expected === "object" ? a.kind === "blocked" && (a.rule === expected.blocked || a.code === expected.blocked) : a.kind === expected
const expectedText = (o: JourneyOutcome | undefined) => (o === undefined ? "persisted" : typeof o === "object" ? `blocked ${o.blocked}` : o)

/** Applies captures and collects approvals of a persisted outcome; then compares it with the step's expectation. */
function settle(st: JourneyStep, state: RunState, actual: Actual, note = "", extra = ""): Result {
  const lost: string[] = []
  if (actual.kind !== "blocked") {
    state.approvalIds.push(...actual.approvals.filter((a) => !state.approvalIds.includes(a)))
    for (const [k, p] of Object.entries(st.captures ?? {})) {
      const v = journeyOutputValue(actual.output, p)
      if (typeof v === "string" && v) state.runtime[k as RuntimeParam] = v
      else lost.push(`${k} ← ${p}`)
    }
  }
  const ok = matches(st.outcome, actual) && !lost.length
  return { status: ok ? "passed" : "failed", detail: `${matches(st.outcome, actual) ? "" : `expected ${expectedText(st.outcome)}, got `}${describeActual(actual)}${extra}${lost.length ? ` [capture missing: ${lost.join(", ")}]` : ""}${note}` }
}

/** One capability run from a workbench link, exactly as the page + form would submit it. */
async function workbench(st: JourneyStep, state: RunState): Promise<Result> {
  const skillId = routeParam(st, "skillId", state)!
  const href = journeyStepHref(st, { fixtureId: fixtureUuid, runtime: state.runtime })!
  const params = Object.fromEntries(new URL(href, "http://journey.local").searchParams)
  const cap = getCapability(skillId)!
  const ctx = await ctxFor(st.actor)
  const refs = await loadReferenceOptions(ctx, [...new Set(cap.inputFields.map((f) => f.type))])
  const prefill = prefillFromParams(cap.inputFields, refs, params, fixtureUuid)
  const unresolved = Object.keys(st.inputs ?? {}).filter((k) => !(k in prefill))
  const values = initialValues(cap.inputFields, prefill)
  const missing = missingRequired(cap.inputFields, values)
  const note = unresolved.length ? ` [inputs not prefilled: ${unresolved.join(", ")}]` : ""
  if (missing.length) return { status: "failed", detail: `stops at client-side Required: ${missing.join(", ")}${note}` }
  const handler = HANDLERS[skillId]
  const revisionOf = handler?.kind === "command" ? handler.revisionOf : undefined
  const expectedRevision = revisionOf === "job" ? refs.job?.find((o) => o.value === values.job)?.revision : undefined
  await signInAs(st.actor)
  const res = await runCapabilityAction({ agencySlug: SLUG, skillId, payload: buildPayload(cap.inputFields, values), idempotencyKey: key(`journey:${st.id}`), expectedRevision })
  const actual = fromRun(res)
  // Same ids the workbench "Next action" links expose.
  if (actual.kind !== "blocked") {
    if (typeof actual.output.clientId === "string") state.runtime.clientId = actual.output.clientId
    if (typeof actual.output.jobId === "string") state.runtime.jobId = actual.output.jobId
  }
  return settle(st, state, actual, note)
}

/** Record-level commands (record page, module desk, connection page): the screen's fixed values + the step's fields + the first button. */
async function recordCommand(st: JourneyStep, state: RunState): Promise<Result> {
  const { out: inputs, missing } = stepInputs(st, state)
  if (missing.length) return { status: "failed", detail: `runtime input missing: ${missing.join(", ")}` }
  const ctx = await ctxFor(st.actor)
  let payload: Record<string, unknown> = { ...inputs }
  if (st.surface.kind === "route" && st.surface.routeId === "business-record") {
    const recordType = routeParam(st, "recordType", state)!
    const recordId = routeParam(st, "recordId", state)
    if (!recordId) return { status: "failed", detail: "record id from an earlier step is missing" }
    const detail = await getRecordDetail(ctx, recordType, recordId)
    const cmd = detail?.commands.find((c) => c.command === st.performs)
    if (!cmd) return { status: "failed", detail: `the ${recordType} record offers no ${st.performs} (state ${detail?.state ?? "not found"})` }
    const defaults = Object.fromEntries(cmd.fields.filter((f) => f.defaultValue).map((f) => [f.key, f.defaultValue!]))
    payload = { ...cmd.fixed, ...defaults, ...inputs, ...(cmd.buttons[0]?.patch ?? {}) }
  } else if (st.surface.kind === "route" && st.surface.routeId === "connection-detail") {
    payload = { connection: routeParam(st, "connectionId", state), ...inputs }
  }
  await signInAs(st.actor)
  const res = await runRecordCommandAction({ agencySlug: SLUG, command: st.performs as RecordCommand, payload, idempotencyKey: key(`journey:${st.id}`) })
  const actual = res.ok ? fromAction({ ok: true, data: res.data.result }) : fromAction(res)
  const state_ = actual.kind !== "blocked" && typeof actual.output.state === "string" ? ` (state ${actual.output.state})` : ""
  return settle(st, state, actual, "", state_)
}

/** Connection detail actions (J08.3 revoke / J08.7 restore) call the same capability. */
async function connectionAction(st: JourneyStep, state: RunState): Promise<Result> {
  const owner = await ctxFor(st.actor)
  const [conn] = await ownerDb()
    .select()
    .from(s.connection)
    .where(and(eq(s.connection.tenantId, owner.tenant.id), eq(s.connection.provider, "meta_ads"), eq(s.connection.accountAlias, "demo_meta_aurora")))
  state.runtime.connectionId = conn!.id
  await signInAs(st.actor)
  const action = /Revoke/.test(st.label.en) ? "revoke" : "restore"
  const actual = fromRun(await runCapabilityAction({ agencySlug: SLUG, skillId: "agency-integrations", payload: { action, provider: conn!.provider, accountAlias: conn!.accountAlias }, idempotencyKey: key(`journey:${st.id}`) }))
  return { status: actual.kind !== "blocked" ? "passed" : "failed", detail: `${action}: ${describeActual(actual)}` }
}

/**
 * Approval detail: approve each pending approval the actor may decide, then
 * apply approved ones (two passes, like the screen). Latest request first, so
 * a client authority is approved before the amendment it backs.
 */
async function approvals(st: JourneyStep, state: RunState): Promise<Result> {
  if (!state.approvalIds.length) {
    if (state.skippedAssistant) return { status: "skipped", detail: "the approval is requested by a skipped assistant step" }
    return { status: "failed", detail: "no earlier step requested an approval" }
  }
  await signInAs(st.actor)
  const notes: string[] = []
  const decided = new Set<string>()
  let failed = false
  for (let pass = 0; pass < 2; pass++) {
    for (const approvalId of [...state.approvalIds].reverse()) {
      const v = await getApprovalView(await ctxFor(st.actor), approvalId)
      if (!v) continue
      if (v.viewer.canDecide) {
        const res = await decideApprovalAction({ agencySlug: SLUG, approvalId, decision: "approve", reviewedDigest: v.approval.payloadDigest, idempotencyKey: key(`journey:${st.id}:decide`) })
        const r = res.ok ? (res.data as { outcome: string; executed: boolean; blockedCode: string | null }) : null
        if (!res.ok) failed = true
        decided.add(approvalId)
        notes.push(`${v.approval.actionType}: ${res.ok ? `${r!.outcome}${r!.executed ? " + executed" : r!.blockedCode ? ` (held: ${r!.blockedCode})` : ""}` : `error ${res.error.code}: ${res.error.message}`}`)
      } else if (v.viewer.canExecute) {
        const res = await executeApprovedAction({ agencySlug: SLUG, approvalId, idempotencyKey: key(`journey:${st.id}:execute`) })
        const r = res.ok ? (res.data as { executed: boolean; blockedCode: string | null }) : null
        if (!res.ok || !r!.executed) failed = true
        notes.push(`${v.approval.actionType}: ${res.ok ? (r!.executed ? "applied" : `not applied (${r!.blockedCode})`) : `error ${res.error.code}`}`)
      }
    }
  }
  const final = await Promise.all(state.approvalIds.map(async (a) => getApprovalView(await ctxFor(st.actor), a)))
  const mine = final.filter((v) => v && decided.has(v.approval.id))
  const states = mine.map((v) => `${v!.approval.actionType}=${v!.approval.state}`).join(", ")
  if (!notes.length) return { status: "failed", detail: `the actor could decide none of the pending approvals (${final.map((v) => `${v?.approval.actionType}=${v?.approval.state}`).join(", ")})` }
  // What this actor approved must have taken effect (not left approved-but-held).
  const held = mine.filter((v) => v!.approval.state === "approved").map((v) => v!.approval.actionType)
  if (held.length) failed = true
  return { status: failed ? "failed" : "passed", detail: `${notes.join("; ")} → ${states}${held.length ? ` [approved but not applied: ${held.join(", ")}]` : ""}` }
}

/** Record screen evidence review. */
async function evidenceReview(st: JourneyStep, state: RunState): Promise<Result> {
  const evidenceId = routeParam(st, "recordId", state)!
  await signInAs(st.actor)
  const res = await reviewEvidenceAction({ agencySlug: SLUG, evidenceId, decision: "reviewed", reason: `${st.id}: reviewed against the signed synthetic document`, idempotencyKey: key(`journey:${st.id}`) })
  return res.ok && res.data.reviewState === "reviewed" ? { status: "passed", detail: `evidence reviewed (stale approvals: ${res.data.staleApprovals})` } : { status: "failed", detail: res.ok ? `review state ${res.data.reviewState}` : `${res.error.code}: ${res.error.message}` }
}

/** Library file detail: link the document to a job (evidence follows it). */
async function fileLink(st: JourneyStep, state: RunState): Promise<Result> {
  const fileId = routeParam(st, "fileId", state)
  if (!fileId) return { status: "skipped", detail: "the file comes from the skipped upload step (library suite + browser journey)" }
  const { out, missing } = stepInputs(st, state)
  if (missing.length || !out.job) return { status: "failed", detail: `runtime input missing: ${missing.join(", ") || "job"}` }
  await signInAs(st.actor)
  const res = await linkFileToJobAction({ agencySlug: SLUG, fileId, jobId: out.job })
  return res.ok ? { status: "passed", detail: `linked (changed: ${res.data.changed})` } : { status: "failed", detail: `${res.error.code}: ${res.error.message}` }
}

/** Presenter controls: queue the next simulated outcome (presenter session). */
async function presenterQueue(st: JourneyStep, state: RunState): Promise<Result> {
  const { out } = stepInputs(st, state)
  await signInAs(st.actor, true)
  const res = await queueSimulationOutcomeAction({ agencySlug: SLUG, provider: out.provider as "demo_bank", operationType: out.operationType as "payment.execute", failureMode: out.failureMode as "timeout_after_effect", idempotencyKey: key(`journey:${st.id}`) })
  return res.ok ? { status: "passed", detail: `queued ${out.failureMode}` } : { status: "failed", detail: `${res.error.code}: ${res.error.message}` }
}

/** Module desk payment preview (read-only). */
async function paymentPreview(st: JourneyStep, state: RunState): Promise<Result> {
  const { out } = stepInputs(st, state)
  await signInAs(st.actor)
  const res = await previewPaymentRunAction({ agencySlug: SLUG, connection: out.connection!, dueThrough: out.dueThrough! })
  if (!res.ok) return { status: "failed", detail: `${res.error.code}: ${res.error.message}` }
  const d = res.data as { totalMinor?: string; items?: { category: string; amountMinor: string }[] }
  return { status: "passed", detail: `eligible ${d.totalMinor} (${(d.items ?? []).map((i) => `${i.category} ${i.amountMinor}`).join(", ")})` }
}

/** Catalog capability change (J01.10 propose / J01.11 decide). */
async function capabilityChange(st: JourneyStep, state: RunState): Promise<Result> {
  const ctx = await ctxFor(st.actor)
  await signInAs(st.actor)
  if (st.performs === "proposeCapabilityChange") {
    const published = (await listConfigurationRevisions(ctx)).find((r) => r.published)!
    const res = await proposeCapabilityChangeAction({ agencySlug: SLUG, enable: [], disable: [CAP_CHANGE_SKILL], reason: "No OOH inventory this quarter", expectedRevision: published.number, idempotencyKey: key(`journey:${st.id}`) })
    if (!res.ok) return { status: "failed", detail: `${res.error.code}: ${res.error.message}` }
    state.capabilityRevisionId = res.data.revisionId
    const mine = (await listConfigurationRevisions(ctx)).find((r) => r.id === res.data.revisionId)!
    return mine.state === "awaiting_approval" && !mine.canDecide ? { status: "passed", detail: `r${res.data.number} awaiting another owner (requester cannot decide)` } : { status: "failed", detail: `state ${mine.state}, canDecide ${mine.canDecide}` }
  }
  const rev = (await listConfigurationRevisions(ctx)).find((r) => r.id === state.capabilityRevisionId)
  if (!rev?.payloadDigest) return { status: "failed", detail: "no pending capability change from the previous step" }
  const res = await decideCapabilityChangeAction({ agencySlug: SLUG, revisionId: rev.id, decision: "approve", reviewedDigest: rev.payloadDigest, idempotencyKey: key(`journey:${st.id}`) })
  if (!res.ok) return { status: "failed", detail: `${res.error.code}: ${res.error.message}` }
  const enabled = (await ctxFor(st.actor)).enabledCapabilities.has(CAP_CHANGE_SKILL)
  return res.data.outcome === "published" && !enabled ? { status: "passed", detail: `published; ${CAP_CHANGE_SKILL} disabled` } : { status: "failed", detail: `outcome ${res.data.outcome}, still enabled ${enabled}` }
}

function skipReason(st: JourneyStep): string {
  if (st.surface.kind === "assistant") return "assistant step (scripted driver; assistant suites + browser journey)"
  const r = st.surface.routeId
  if (/^404/.test(st.expected.en)) return "cross-tenant 404 (isolation-governance + browser journey)"
  if (r.startsWith("control-") || r === "setup-wizard" || r === "activation") return "control-plane step (platform-configuration + browser journey)"
  if (r.startsWith("platform-")) return "platform operations step (platform-ops + browser journey)"
  if (r === "library") return "library upload (isolation-governance + browser journey)"
  return "navigation / read step"
}

async function runStep(st: JourneyStep, state: RunState): Promise<Result> {
  if (st.surface.kind === "assistant") {
    state.skippedAssistant = true
    return { status: "skipped", detail: skipReason(st) }
  }
  const r = st.surface.routeId
  if (r === "workflow-workbench") return workbench(st, state)
  if (RECORD_COMMANDS.has(st.performs)) return recordCommand(st, state)
  if (r === "connection-detail" && st.performs === "agency-integrations") return connectionAction(st, state)
  if (st.performs === "decideApprovalCommand") return approvals(st, state)
  if (st.performs === "reviewEvidence") return evidenceReview(st, state)
  if (st.performs === "linkFileToJob") return fileLink(st, state)
  if (st.performs === "queueSimulationOutcome") return presenterQueue(st, state)
  if (st.performs === "previewPaymentRun") return paymentPreview(st, state)
  if (st.performs === "proposeCapabilityChange" || st.performs === "decideCapabilityChange") return capabilityChange(st, state)
  return { status: "skipped", detail: skipReason(st) }
}

// ── journey end states (demo-fixtures.json) ──

async function jobFigures(jobId: string, basis: "forecast" | "incurred") {
  const owner = await ctxFor("user_demo_owner")
  return withTenant(owner.tenant.id, async (tx) => {
    const fin = await loadJobFinancials(tx, owner.tenant.id, jobId)
    return { fin, p: computeProfitability(fin, basis, SLUG), est: estimateTotals(fin, fin.currentEstimate?.id ?? null) }
  })
}

async function operatingCash() {
  const owner = await ctxFor("user_demo_owner")
  return withTenant(owner.tenant.id, async (tx) => {
    const { account } = await bankAccountByConnection(tx, owner.tenant.id, id("connection_rayo_operating_demo"))
    const cash = await cashPosition(tx, owner.tenant.id, account.id)
    const [ar] = await tx
      .select({ v: sql<string>`coalesce(sum(${s.clientInvoice.grossMinor} - ${s.clientInvoice.collectedMinor}), 0)` })
      .from(s.clientInvoice)
      .where(and(eq(s.clientInvoice.tenantId, owner.tenant.id), eq(s.clientInvoice.jobId, id("job_demo_aurora"))))
    return { confirmed: cash.confirmedMinor, holds: cash.activeHoldsMinor, ar: BigInt(ar?.v ?? "0") }
  })
}

const END_STATES: Partial<Record<string, (state: RunState) => Promise<string[]>>> = {
  // J02 ends where ready_for_scope_review starts (initial_plan).
  J02: async (state) => {
    if (!state.runtime.jobId) return ["no job was opened"]
    const c = checkpoint("initial_plan")
    const { fin, p, est } = await jobFigures(state.runtime.jobId, "forecast")
    const got = {
      jobState: fin.job.state,
      authorityMinor: fin.approvedAuthority?.amountMinor ?? null,
      budget: fin.approvedBudget ? [fin.approvedBudget.agencyFeeMinor, fin.approvedBudget.managedMediaMinor] : null,
      laborMinutes: est.laborMinutes,
      agencyCostMinor: est.totalMinor,
      marginBps: p.marginBps,
    }
    const want = { authorityMinor: BigInt(c.client_authority_minor), budget: [BigInt(c.agency_fee_minor), BigInt(c.managed_media_minor)], laborMinutes: c.labor_minutes, agencyCostMinor: BigInt(c.agency_cost_minor), marginBps: c.margin_bps }
    const bad: string[] = []
    if (!["open", "in_progress"].includes(fin.job.state)) bad.push(`job state ${fin.job.state}`)
    if (got.authorityMinor !== want.authorityMinor) bad.push(`approved authority ${got.authorityMinor} ≠ ${want.authorityMinor}`)
    if (String(got.budget) !== String(want.budget)) bad.push(`approved budget fee/media ${got.budget} ≠ ${want.budget}`)
    if (got.laborMinutes !== want.laborMinutes) bad.push(`forecast labor ${got.laborMinutes} min ≠ ${want.laborMinutes}`)
    if (got.agencyCostMinor !== want.agencyCostMinor) bad.push(`forecast cost ${got.agencyCostMinor} ≠ ${want.agencyCostMinor}`)
    if (got.marginBps !== want.marginBps) bad.push(`forecast margin ${got.marginBps} bps ≠ ${want.marginBps}`)
    return bad
  },
  J04: async () => {
    const c = checkpoint("approved_amendment")
    const { p } = await jobFigures(id("job_demo_aurora"), "forecast")
    return p.agencyFeeMinor === BigInt(c.agency_fee_minor) && p.marginBps === c.margin_bps ? [] : [`forecast fee ${p.agencyFeeMinor} / margin ${p.marginBps} bps ≠ ${c.agency_fee_minor} / ${c.margin_bps}`]
  },
  // cash 10k + 53k − 43k = 20k, receivable 0, no hold left.
  J05: async () => {
    const pos = await operatingCash()
    const want = BigInt(FX.final_cash.closing_minor)
    return pos.confirmed === want && pos.ar === 0n && pos.holds === 0n ? [] : [`operating cash ${pos.confirmed} (holds ${pos.holds}), Aurora receivable ${pos.ar} ≠ ${want} / 0 / 0`]
  },
  // 15 primary journals, each balanced; March 2027 closed.
  J06: async () => {
    const owner = await ctxFor("user_demo_owner")
    const journals = await withTenant(owner.tenant.id, (tx) => journalsWithLines(tx, owner.tenant.id, { excludeGroups: ["demo-lab"] }))
    const unbalanced = journals.filter((j) => j.lines.reduce((a, l) => a + l.debitMinor - l.creditMinor, 0n) !== 0n).length
    const [period] = await ownerDb().select().from(s.accountingPeriod).where(and(eq(s.accountingPeriod.tenantId, owner.tenant.id), eq(s.accountingPeriod.period, "2027-03")))
    const bad: string[] = []
    if (journals.length !== FX.expected_final_demo_journals.length || unbalanced) bad.push(`${journals.length} primary journals (${unbalanced} unbalanced) ≠ ${FX.expected_final_demo_journals.length}`)
    if (period?.state !== "closed") bad.push(`period 2027-03 is ${period?.state}`)
    return bad
  },
}

beforeAll(async () => {
  await reset("ready_for_scope_review")
}, 120_000)

afterAll(async () => {
  const rows = Object.entries(summary).map(([journey, r]) => ({ journey, ...r }))
  console.log(`\n[journeys-runner] per journey\n${JSON.stringify(rows)}\n${lines.join("\n")}`)
  await closeOwnerDb()
})

describe("workbench prefill from journey links", () => {
  it("keeps only this tenant's references, valid choices and the skill's own fields", async () => {
    const cap = getCapability("agency-contract-po")!
    const ctx = await ctxFor("user_demo_operator")
    const refs = await loadReferenceOptions(ctx, [...new Set(cap.inputFields.map((f) => f.type))])
    const prefill = (p: Record<string, string>) => prefillFromParams(cap.inputFields, refs, p, fixtureUuid)
    expect(prefill({ "f.job": "fixture:job_demo_aurora", "f.amount": "53000.00", "f.billingRoute": "holder_client", "f.unknownField": "x" })).toEqual({ job: id("job_demo_aurora"), amount: "53000.00", billingRoute: "holder_client" })
    // Another agency's job (fixture key or raw id), an unknown enum and a fixture key on a plain field are dropped; "" clears an example.
    expect(prefill({ "f.job": "fixture:job_demo_norte" })).toEqual({})
    expect(prefill({ "f.job": id("job_demo_norte"), "f.billingRoute": "someone_else", "f.reference": "fixture:job_demo_aurora" })).toEqual({})
    expect(prefill({ "f.validTo": "" })).toEqual({ validTo: "" })
  })
})

describe("J01–J10 journey steps through the screens' server actions (run order)", () => {
  for (const j of journeyRunOrder() as readonly Journey[]) {
    it(`${j.id} ${j.name.en}`, async () => {
      if (j.entryCheckpoint && j.continues.length === 0) await reset(j.entryCheckpoint)
      const state: RunState = { runtime: {}, approvalIds: [], skippedAssistant: false }
      const results: StepResult[] = []
      for (const st of j.steps) {
        const r = await runStep(st, state).catch((e: unknown): Result => ({ status: "failed", detail: `threw ${(e as Error).message.split("\n")[0]}` }))
        results.push({ step: st.id, actor: st.actor, performs: st.performs, ...r })
      }
      const end = END_STATES[j.id] ? await END_STATES[j.id]!(state).catch((e: unknown) => [`end-state check threw ${(e as Error).message}`]) : []
      const executed = results.filter((r) => r.status !== "skipped")
      const failures = [...results.filter((r) => r.status === "failed").map((r) => `${r.step} [${r.actor}] ${r.performs}: ${r.detail}`), ...end.map((e) => `${j.id} end state: ${e}`)]
      summary[j.id] = { executed: executed.length, passed: executed.filter((r) => r.status === "passed").length, failed: executed.filter((r) => r.status === "failed").length, skipped: results.length - executed.length }
      for (const r of results) lines.push(`[journeys-runner] ${r.step} ${r.status.toUpperCase()} [${r.actor}] ${r.performs}: ${r.detail}`)
      for (const e of end) lines.push(`[journeys-runner] ${j.id} END-STATE FAILED ${e}`)
      if (END_STATES[j.id] && !end.length) lines.push(`[journeys-runner] ${j.id} END-STATE PASSED`)
      expect(failures, `${j.id}: ${failures.length} failure(s)`).toEqual([])
    }, 300_000)
  }
})
