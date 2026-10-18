import "server-only"

import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"

import type { AssistantContextHint, MessagePart, SuggestionView } from "@/lib/assistant/types"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import {
  actionProposal,
  assistantContextSnapshot,
  assistantConversation,
  assistantDelegation,
  assistantMessage,
  assistantRun,
  assistantSourceReference,
  assistantToolCall,
  job,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { env } from "@/server/env"
import { currentAggregateRevision } from "@/server/kernel/approvals"
import { toJsonSafe } from "@/server/kernel/commands"
import { DomainError, isDomainError } from "@/server/kernel/errors"

import {
  allSuggestions,
  CONFIRM_ALIASES,
  matchScenarios,
  normalizeAlias,
  scenarioById,
  scenarioForPreset,
  SCENARIO_CATALOG_VERSION,
  SCENARIOS,
  type Scenario,
  type ScenarioState,
  type StepResult,
  type DelegationRecord,
  type ToolCallRecord,
} from "./scenarios"
import { assistantBusinessDate } from "./clock"
import {
  activeRun,
  addRunEvent,
  appendMessage,
  createConversation,
  getOwnedConversation,
  isLeaseLive,
  recentUserTurns,
} from "./store"

// AgeOS's own assistant runtime contract. The scripted driver is the only
// implementation in this build; a future live driver (Eve / AI SDK) must
// implement the same interface and reuse the same tools, commands, approvals
// and persistence — permissions and calculations never move into a prompt.
//
// Execution model (B04/B05):
// - A run advances only while it is `running` AND the worker holds its lease
//   (state.lease, compare-and-set under a row lock with a state revision).
// - Before each step the worker re-reads the run: Stop/interruption ends the
//   loop before any new step starts.
// - After each step the worker checkpoints (stepIndex, params, results,
//   proposal, message parts, tool calls, delegations, sources) in one
//   transaction that re-checks status and lease. If Stop arrived during the
//   step, the committed effect stays recorded and visible; nothing else runs.
// - A crash between a committed effect and its checkpoint leaves a `running`
//   run with an expired lease. `resume` (authenticated) re-claims it and
//   re-runs from the last checkpoint; every effect uses a stable idempotency
//   key (proposal id / run id), so the command replays instead of repeating.

export type TurnInput = {
  conversationId: string | null
  clientMessageId: string
  text?: string
  presetId?: string
  context: AssistantContextHint
}

export interface AssistantDriver {
  readonly mode: "scripted"
  readonly catalogVersion: string
  suggestions(ctx: AgencyContext): SuggestionView[]
  handleTurn(ctx: AgencyContext, input: TurnInput): Promise<{ conversationId: string }>
  confirm(ctx: AgencyContext, input: { conversationId: string; proposalId: string; digest: string; clientMessageId: string }): Promise<{ conversationId: string }>
  cancel(ctx: AgencyContext, input: { conversationId: string; runId: string }): Promise<{ conversationId: string }>
  /** Reconciles a `running` run whose worker vanished, from its last checkpoint. */
  resume(ctx: AgencyContext, input: { conversationId: string; runId: string }): Promise<{ conversationId: string; resumed: boolean }>
}

export type DriverOptions = {
  registry?: readonly Scenario[]
  leaseMs?: number
  now?: () => Date
  /** Test seam: runs after a step's effects and before its checkpoint (a throw simulates a crash). */
  hooks?: { afterStep?: (info: { runId: string; stepId: string; stepIndex: number }) => Promise<void> | void }
}

export const TurnSchema = z
  .object({
    conversationId: z.string().uuid().nullable(),
    clientMessageId: z.string().uuid(),
    text: z.string().trim().max(500).optional(),
    presetId: z.string().max(80).optional(),
    context: z
      .object({
        route: z.string().max(300),
        moduleKey: z.string().max(60).nullable(),
        record: z.object({ type: z.literal("job"), id: z.string().max(64) }).nullable(),
      })
      .strict(),
  })
  .strict()
  .refine((v) => Boolean(v.text?.length) !== Boolean(v.presetId), { message: "Send either text or a preset" })

const t = (template: string, params?: Record<string, string | number | null>): MessagePart => ({ type: "text", template, params })

const SUPPORTED_HEADING = {
  en: "This demo supports the scenarios below",
  es: "Esta demo admite los siguientes recorridos",
}

type RunRow = typeof assistantRun.$inferSelect
type StepOutcome = Awaited<ReturnType<Scenario["steps"][number]["run"]>>

class ScriptedAssistantDriver implements AssistantDriver {
  readonly mode = "scripted" as const
  readonly catalogVersion = SCENARIO_CATALOG_VERSION
  private readonly registry: readonly Scenario[]
  private readonly leaseMs: number
  private readonly now: () => Date
  private readonly hooks: NonNullable<DriverOptions["hooks"]>

  constructor(opts: DriverOptions = {}) {
    this.registry = opts.registry ?? SCENARIOS
    this.leaseMs = opts.leaseMs ?? 30_000
    this.now = opts.now ?? (() => new Date())
    this.hooks = opts.hooks ?? {}
  }

  suggestions(): SuggestionView[] {
    return allSuggestions(this.registry)
  }

  private suggestionsPart(): MessagePart {
    return { type: "suggestions", heading: SUPPORTED_HEADING, items: allSuggestions(this.registry) }
  }

  async handleTurn(ctx: AgencyContext, raw: TurnInput) {
    if (!ctx.permissions.has("assistant.use")) throw new DomainError("forbidden", "Assistant not available for this role")
    const input = TurnSchema.parse(raw)

    // 1) Persist the user turn once (dedupe on client message id).
    const turn = await withTenant(ctx.tenant.id, async (tx) => {
      const recent = await recentUserTurns(tx, ctx, 60_000)
      if (recent >= env().AGEOS_ASSISTANT_MAX_REQUESTS_PER_MINUTE) throw new DomainError("rate_limited", "Too many assistant requests")
      const conv = input.conversationId
        ? await getOwnedConversation(tx, ctx, input.conversationId)
        : await createConversation(tx, ctx, input.presetId ? "Demo scenario" : (input.text ?? "Conversation").slice(0, 60))
      const [dup] = await tx
        .select({ id: assistantMessage.id })
        .from(assistantMessage)
        .where(and(eq(assistantMessage.tenantId, ctx.tenant.id), eq(assistantMessage.conversationId, conv.id), eq(assistantMessage.clientMessageId, input.clientMessageId)))
        .limit(1)
      const run = await activeRun(tx, ctx.tenant.id, conv.id)
      if (dup) return { conversationId: conv.id, duplicate: true as const, run }
      const presetScenario = input.presetId ? scenarioForPreset(input.presetId, this.registry) : null
      const preset = presetScenario?.presets.find((p) => p.presetId === input.presetId)
      const userText = input.text ?? (preset ? preset.label[ctx.user.locale] : input.presetId!)
      await appendMessage(tx, ctx, { conversationId: conv.id, role: "user", parts: [{ type: "user_text", text: userText }], clientMessageId: input.clientMessageId })
      return { conversationId: conv.id, duplicate: false as const, run, presetScenario, userText }
    })
    // A retried request (same client message id) never re-runs the turn; it
    // only reconciles a run whose worker vanished.
    if (turn.duplicate) {
      if (turn.run && this.isStale(turn.run)) await this.advance(ctx, turn.conversationId, turn.run.id)
      return { conversationId: turn.conversationId }
    }

    const { conversationId, presetScenario, userText } = turn
    let run = turn.run
    if (run && this.isStale(run)) {
      await this.advance(ctx, conversationId, run.id)
      run = await withTenant(ctx.tenant.id, (tx) => activeRun(tx, ctx.tenant.id, conversationId))
    }
    const normalized = normalizeAlias(userText)

    // 2) A waiting run consumes the reply (input or confirmation alias).
    if (run && !presetScenario) {
      if (run.status === "waiting_input") return this.feedInput(ctx, conversationId, run.id, userText)
      if (run.status === "waiting_confirmation" && CONFIRM_ALIASES.includes(normalized)) {
        const st = run.state as ScenarioState
        if (st.proposalId && st.digest) return this.confirm(ctx, { conversationId, proposalId: st.proposalId, digest: st.digest, clientMessageId: crypto.randomUUID() })
      }
    }

    // 3) Otherwise select a scenario by preset or exact alias.
    const matches = presetScenario ? [presetScenario] : matchScenarios(userText, this.registry)
    if (matches.length !== 1) {
      await withTenant(ctx.tenant.id, (tx) =>
        appendMessage(tx, ctx, {
          conversationId,
          role: "assistant",
          parts: [t(matches.length > 1 ? "assistant.ambiguous" : "assistant.unsupported"), matches.length > 1 ? { type: "suggestions", heading: SUPPORTED_HEADING, items: matches.flatMap((m) => m.presets) } : this.suggestionsPart()],
        })
      )
      return { conversationId }
    }
    return this.start(ctx, conversationId, matches[0]!, input.context, normalized, run?.id ?? null)
  }

  private isStale(run: RunRow) {
    return run.status === "running" && !isLeaseLive((run.state as ScenarioState).lease, this.now())
  }

  private async start(ctx: AgencyContext, conversationId: string, scenario: Scenario, hint: AssistantContextHint, normalized: string, interruptRunId: string | null) {
    // Permission is checked before anything is prepared (server-side block).
    if (!ctx.permissions.has(scenario.requiredPermission)) {
      await withTenant(ctx.tenant.id, (tx) =>
        appendMessage(tx, ctx, {
          conversationId,
          role: "assistant",
          parts: [
            { type: "blocked", code: "forbidden", message: { en: "Your role cannot run this scenario. Nothing was prepared or changed.", es: "Su rol no puede ejecutar este recorrido. No se preparó ni cambió nada." }, details: { permission: scenario.requiredPermission, role: ctx.role } },
          ],
        })
      )
      return { conversationId }
    }
    let params: Record<string, string>
    try {
      params = await scenario.init(ctx, { recordJobId: hint.record?.type === "job" ? hint.record.id : null, text: normalized })
    } catch (e) {
      if (!isDomainError(e)) throw e
      await withTenant(ctx.tenant.id, (tx) =>
        appendMessage(tx, ctx, { conversationId, role: "assistant", parts: [t("assistant.needsJobContext"), this.suggestionsPart()] })
      )
      return { conversationId }
    }

    // The context snapshot records the demo business clock (presenter may advance it).
    const businessDate = await assistantBusinessDate()
    const runId = await withTenant(ctx.tenant.id, async (tx) => {
      if (interruptRunId) await this.stopRun(tx, ctx, interruptRunId, "interrupted")
      const state: ScenarioState = { params, results: {}, stepIndex: 0, rev: 0, lease: null, messageId: null }
      const [r] = await tx
        .insert(assistantRun)
        .values({
          tenantId: ctx.tenant.id,
          conversationId,
          scenarioId: scenario.id,
          scenarioVersion: scenario.version,
          status: "running",
          state,
          actorUserId: ctx.user.id,
        })
        .returning()
      // Snapshot the authorized context: later navigation never retargets it.
      const jobId = params.job ?? params._contextJob ?? null
      const [j] = jobId ? await tx.select({ revision: job.revision }).from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, jobId))).limit(1) : []
      await tx.insert(assistantContextSnapshot).values({
        tenantId: ctx.tenant.id,
        runId: r!.id,
        route: hint.route.slice(0, 300),
        moduleKey: hint.moduleKey,
        entityType: jobId ? "job" : null,
        entityId: jobId,
        entityRevision: j?.revision ?? null,
        filters: {},
        locale: ctx.user.locale,
        asOf: businessDate,
      })
      await addRunEvent(tx, ctx.tenant.id, r!.id, { stepId: "start", stepType: "start", outcome: "started", detail: { scenarioId: scenario.id, version: scenario.version, catalog: SCENARIO_CATALOG_VERSION } })
      return r!.id
    })
    await this.advance(ctx, conversationId, runId)
    return { conversationId }
  }

  /** Stops an active run (Stop or interruption). Committed effects keep their results. */
  private async stopRun(tx: Tx, ctx: AgencyContext, runId: string, status: "cancelled" | "interrupted") {
    const [run] = await tx.select().from(assistantRun).where(and(eq(assistantRun.tenantId, ctx.tenant.id), eq(assistantRun.id, runId))).for("update").limit(1)
    if (!run) return null
    const st = run.state as ScenarioState
    await tx
      .update(assistantRun)
      .set({ status, cancelRequestedAt: this.now(), completedAt: this.now(), state: toJsonSafe({ ...st, lease: null, rev: (st.rev ?? 0) + 1 }) as object })
      .where(eq(assistantRun.id, run.id))
    await tx
      .update(actionProposal)
      .set({ state: "cancelled", updatedAt: this.now() })
      .where(and(eq(actionProposal.tenantId, ctx.tenant.id), eq(actionProposal.runId, run.id), eq(actionProposal.state, "awaiting_confirmation")))
    await addRunEvent(tx, ctx.tenant.id, run.id, { stepId: run.currentStep ?? "run", stepType: status === "cancelled" ? "cancel" : "interrupt", outcome: status })
    return run
  }

  private async feedInput(ctx: AgencyContext, conversationId: string, runId: string, reply: string) {
    const run = await this.loadRun(ctx, runId)
    const scenario = scenarioById(run.scenarioId, run.scenarioVersion, this.registry)
    const state = run.state as ScenarioState
    const step = scenario?.steps[state.stepIndex]
    if (!scenario || !step?.acceptInput) return { conversationId }
    const accepted = await step.acceptInput({ ctx, runId, conversationId, state }, reply)
    if (!accepted.ok) {
      await withTenant(ctx.tenant.id, (tx) => appendMessage(tx, ctx, { conversationId, role: "assistant", parts: accepted.parts, runId }))
      return { conversationId }
    }
    const field = step.field ?? null
    const moved = await withTenant(ctx.tenant.id, async (tx) => {
      // CAS: the run must still be waiting on this very step and revision.
      const [cur] = await tx.select().from(assistantRun).where(and(eq(assistantRun.tenantId, ctx.tenant.id), eq(assistantRun.id, runId))).for("update").limit(1)
      const cs = cur?.state as ScenarioState | undefined
      if (!cur || cur.status !== "waiting_input" || cs?.stepIndex !== state.stepIndex || (cs.rev ?? 0) !== (state.rev ?? 0)) return false
      const next: ScenarioState = { ...cs, params: field ? { ...cs.params, [field]: accepted.value } : cs.params, stepIndex: cs.stepIndex + 1, rev: (cs.rev ?? 0) + 1, lease: null, messageId: null }
      await tx.update(assistantRun).set({ status: "running", state: toJsonSafe(next) as object }).where(eq(assistantRun.id, runId))
      await addRunEvent(tx, ctx.tenant.id, runId, { stepId: step.id, stepType: step.type, outcome: "succeeded", detail: { field } })
      return true
    })
    if (moved) await this.advance(ctx, conversationId, runId)
    return { conversationId }
  }

  async confirm(ctx: AgencyContext, input: { conversationId: string; proposalId: string; digest: string; clientMessageId: string }) {
    const parsed = z.object({ conversationId: z.string().uuid(), proposalId: z.string().uuid(), digest: z.string().regex(/^[0-9a-f]{64}$/), clientMessageId: z.string().uuid() }).parse(input)
    const confirmed = await withTenant(ctx.tenant.id, async (tx) => {
      await getOwnedConversation(tx, ctx, parsed.conversationId)
      const run = await activeRun(tx, ctx.tenant.id, parsed.conversationId)
      const st = run?.state as ScenarioState | undefined
      if (!run || run.status !== "waiting_confirmation" || st?.proposalId !== parsed.proposalId) {
        throw new DomainError("blocked_by_rule", "There is no pending confirmation for this proposal", { rule: "current_proposal" })
      }
      // Bound to the aggregate revision the proposal was computed against: a
      // material change since then makes it stale (persisted), never executed.
      const [pending] = await tx
        .select()
        .from(actionProposal)
        .where(and(eq(actionProposal.tenantId, ctx.tenant.id), eq(actionProposal.id, parsed.proposalId)))
        .for("update")
        .limit(1)
      if (pending?.state === "awaiting_confirmation" && pending.aggregateId && pending.baseRevision !== null) {
        const current = await currentAggregateRevision(tx, ctx.tenant.id, pending.aggregateType, pending.aggregateId)
        if (current !== pending.baseRevision) {
          await tx.update(actionProposal).set({ state: "stale", updatedAt: this.now() }).where(eq(actionProposal.id, pending.id))
          await addRunEvent(tx, ctx.tenant.id, run.id, { stepId: "confirm", stepType: "confirm", outcome: "stale", detail: { proposalId: pending.id, baseRevision: pending.baseRevision, currentRevision: current } })
          return { stale: true as const }
        }
      }
      // Bound to the exact proposal id + digest. Only one click can win.
      const [p] = await tx
        .update(actionProposal)
        .set({ state: "confirmed", confirmedBy: ctx.user.id, confirmedAt: this.now(), updatedAt: this.now() })
        .where(
          and(
            eq(actionProposal.tenantId, ctx.tenant.id),
            eq(actionProposal.id, parsed.proposalId),
            eq(actionProposal.payloadDigest, parsed.digest),
            eq(actionProposal.state, "awaiting_confirmation"),
            eq(actionProposal.createdBy, ctx.user.id)
          )
        )
        .returning()
      if (!p) throw new DomainError("approval_stale", "The proposal changed or was already confirmed")
      await appendMessage(tx, ctx, { conversationId: parsed.conversationId, role: "user", parts: [{ type: "user_text", text: ctx.user.locale === "es" ? "Confirmo esta propuesta" : "Confirm this proposal" }], clientMessageId: parsed.clientMessageId, runId: run.id })
      const next: ScenarioState = { ...st, stepIndex: st.stepIndex + 1, rev: (st.rev ?? 0) + 1, lease: null, messageId: null }
      await tx.update(assistantRun).set({ status: "running", state: toJsonSafe(next) as object }).where(eq(assistantRun.id, run.id))
      await addRunEvent(tx, ctx.tenant.id, run.id, { stepId: "confirm", stepType: "confirm", outcome: "succeeded", detail: { proposalId: p.id, digest: p.payloadDigest } })
      return { stale: false as const, runId: run.id }
    })
    if (confirmed.stale) {
      throw new DomainError("approval_stale", "The record changed after this proposal was prepared; prepare it again", { rule: "aggregate_revision_changed" })
    }
    await this.advance(ctx, parsed.conversationId, confirmed.runId)
    return { conversationId: parsed.conversationId }
  }

  async cancel(ctx: AgencyContext, input: { conversationId: string; runId: string }) {
    const parsed = z.object({ conversationId: z.string().uuid(), runId: z.string().uuid() }).parse(input)
    await withTenant(ctx.tenant.id, async (tx) => {
      await getOwnedConversation(tx, ctx, parsed.conversationId)
      const run = await activeRun(tx, ctx.tenant.id, parsed.conversationId)
      if (!run || run.id !== parsed.runId) return
      // Stop prevents new steps; committed commands keep their results.
      await this.stopRun(tx, ctx, run.id, "cancelled")
      await appendMessage(tx, ctx, { conversationId: parsed.conversationId, role: "assistant", parts: [t("assistant.cancelled")], runId: run.id })
    })
    return { conversationId: parsed.conversationId }
  }

  async resume(ctx: AgencyContext, input: { conversationId: string; runId: string }) {
    const parsed = z.object({ conversationId: z.string().uuid(), runId: z.string().uuid() }).parse(input)
    const run = await withTenant(ctx.tenant.id, async (tx) => {
      await getOwnedConversation(tx, ctx, parsed.conversationId)
      const [r] = await tx
        .select()
        .from(assistantRun)
        .where(and(eq(assistantRun.tenantId, ctx.tenant.id), eq(assistantRun.id, parsed.runId), eq(assistantRun.conversationId, parsed.conversationId), eq(assistantRun.actorUserId, ctx.user.id)))
        .limit(1)
      return r ?? null
    })
    if (!run) throw new DomainError("not_found", "Run not found")
    if (!this.isStale(run)) return { conversationId: parsed.conversationId, resumed: false }
    const resumed = await this.advance(ctx, parsed.conversationId, run.id)
    return { conversationId: parsed.conversationId, resumed }
  }

  private async loadRun(ctx: AgencyContext, runId: string) {
    const [run] = await withTenant(ctx.tenant.id, (tx) => tx.select().from(assistantRun).where(and(eq(assistantRun.tenantId, ctx.tenant.id), eq(assistantRun.id, runId))).limit(1))
    if (!run) throw new DomainError("not_found", "Run not found")
    return run
  }

  /** Claims the run lease (CAS under a row lock). Null when not running or owned by a live worker. */
  private async claim(ctx: AgencyContext, runId: string, owner: string): Promise<RunRow | null> {
    return withTenant(ctx.tenant.id, async (tx) => {
      const [run] = await tx.select().from(assistantRun).where(and(eq(assistantRun.tenantId, ctx.tenant.id), eq(assistantRun.id, runId))).for("update").limit(1)
      if (!run || run.status !== "running") return null
      const st = run.state as ScenarioState
      if (isLeaseLive(st.lease, this.now())) return null
      const next: ScenarioState = { ...st, rev: (st.rev ?? 0) + 1, lease: { owner, until: new Date(this.now().getTime() + this.leaseMs).toISOString() } }
      const [updated] = await tx.update(assistantRun).set({ state: toJsonSafe(next) as object }).where(eq(assistantRun.id, runId)).returning()
      if (st.lease) await addRunEvent(tx, ctx.tenant.id, runId, { stepId: run.currentStep ?? "run", stepType: "resume", outcome: "reclaimed", detail: { stepIndex: st.stepIndex } })
      return updated!
    })
  }

  /** True while the run is still `running` under this worker's lease. */
  private async stillOwned(ctx: AgencyContext, runId: string, owner: string) {
    const [run] = await withTenant(ctx.tenant.id, (tx) =>
      tx.select({ status: assistantRun.status, state: assistantRun.state }).from(assistantRun).where(and(eq(assistantRun.tenantId, ctx.tenant.id), eq(assistantRun.id, runId))).limit(1)
    )
    return Boolean(run && run.status === "running" && (run.state as ScenarioState).lease?.owner === owner)
  }

  /** Executes steps until the scenario waits, blocks, completes or is stopped. Returns false if it could not claim the run. */
  private async advance(ctx: AgencyContext, conversationId: string, runId: string): Promise<boolean> {
    const owner = crypto.randomUUID()
    const claimed = await this.claim(ctx, runId, owner)
    if (!claimed) return false
    const scenario = scenarioById(claimed.scenarioId, claimed.scenarioVersion, this.registry)
    if (!scenario) {
      await this.checkpoint(ctx, conversationId, runId, owner, null, {
        status: "failed",
        state: claimed.state as ScenarioState,
        parts: [{ type: "blocked", code: "internal", message: { en: "This scenario version is no longer available.", es: "Esta versión del recorrido ya no está disponible." } }],
      })
      return true
    }
    let state = claimed.state as ScenarioState
    const max = env().AGEOS_ASSISTANT_MAX_STEPS
    let executed = 0

    while (state.stepIndex < scenario.steps.length) {
      if (executed >= max) {
        // Step budget for this request: release the lease; the client resumes.
        await this.checkpoint(ctx, conversationId, runId, owner, null, { status: "running", state, parts: [], releaseLease: true, event: { stepId: "budget", stepType: "status", outcome: "step_budget_reached" } })
        return true
      }
      // Stop / interruption / takeover is checked before every new step.
      if (!(await this.stillOwned(ctx, runId, owner))) return true
      const step = scenario.steps[state.stepIndex]!
      executed++
      if (step.type === "prepare_action") {
        // One live proposal per run: a re-run step supersedes an earlier one.
        await withTenant(ctx.tenant.id, (tx) =>
          tx.update(actionProposal).set({ state: "stale", updatedAt: this.now() }).where(and(eq(actionProposal.tenantId, ctx.tenant.id), eq(actionProposal.runId, runId), eq(actionProposal.state, "awaiting_confirmation")))
        )
      }
      let result: StepOutcome
      try {
        result = await step.run({ ctx, runId, conversationId, state })
      } catch (e) {
        const code = isDomainError(e) ? e.code : "internal"
        if (!isDomainError(e)) console.error("[ageos] assistant step failed", step.id, e)
        const status = isDomainError(e) ? "blocked" : "failed"
        await this.checkpoint(ctx, conversationId, runId, owner, step, {
          status,
          state,
          parts: [{ type: "blocked", code, message: { en: isDomainError(e) ? e.message : "Unexpected error", es: isDomainError(e) ? e.message : "Error inesperado" } }],
          event: { stepId: step.id, stepType: step.type, outcome: status },
        })
        return true
      }
      await this.hooks.afterStep?.({ runId, stepId: step.id, stepIndex: state.stepIndex })

      const next = nextState(state, result)
      const status = result.kind === "continue" ? "running" : result.kind === "wait_input" ? "waiting_input" : result.kind === "wait_confirmation" ? "waiting_confirmation" : result.kind === "blocked" ? "blocked" : "completed"
      const finalStatus = status === "running" && next.stepIndex >= scenario.steps.length ? "completed" : status
      const kept = await this.checkpoint(ctx, conversationId, runId, owner, step, {
        status: finalStatus,
        state: next,
        parts: result.parts ?? [],
        result,
        event: { stepId: step.id, stepType: step.type, outcome: result.kind === "continue" || result.kind === "complete" ? "succeeded" : result.kind === "blocked" ? "blocked" : "waiting" },
      })
      if (!kept || finalStatus !== "running") return true
      state = kept
    }
    return true
  }

  /**
   * Persists one step atomically under the run lock. Returns the new state when
   * the run continues, or null when it stopped (completed/waiting/blocked, or
   * Stop/interruption arrived meanwhile — then the step's committed effect is
   * still recorded, but the run status is left as the user set it).
   */
  private async checkpoint(
    ctx: AgencyContext,
    conversationId: string,
    runId: string,
    owner: string,
    step: Scenario["steps"][number] | null,
    w: {
      status: string
      state: ScenarioState
      parts: MessagePart[]
      result?: StepOutcome
      releaseLease?: boolean
      event?: { stepId: string; stepType: string; outcome: string }
    }
  ): Promise<ScenarioState | null> {
    return withTenant(ctx.tenant.id, async (tx) => {
      const [cur] = await tx.select().from(assistantRun).where(and(eq(assistantRun.tenantId, ctx.tenant.id), eq(assistantRun.id, runId))).for("update").limit(1)
      if (!cur) return null
      const cs = cur.state as ScenarioState
      // Another worker took over after our lease expired: it replays this step
      // with the same idempotency keys, so this result is simply dropped.
      if (cs.lease?.owner !== owner && cur.status === "running") return null
      const stopped = cur.status !== "running"
      const hadEffect = Boolean(w.result?.delegation || w.result?.toolCall)
      if (stopped && !hadEffect) return null

      const parts = stopped ? [...w.parts, t("assistant.committedBeforeStop")] : w.parts
      let messageId = cs.messageId ?? null
      if (parts.length) messageId = await this.appendRunParts(tx, ctx, conversationId, runId, messageId, parts)
      if (w.result) await this.recordStep(tx, ctx, runId, w.result)
      if (w.event) await addRunEvent(tx, ctx.tenant.id, runId, stopped ? { ...w.event, outcome: `${w.event.outcome}_after_${cur.status}` } : w.event)

      if (stopped) {
        // Keep cancelled/interrupted; only clear our lease.
        await tx.update(assistantRun).set({ state: toJsonSafe({ ...cs, lease: null, messageId, rev: (cs.rev ?? 0) + 1 }) as object }).where(eq(assistantRun.id, runId))
        return null
      }
      const terminal = ["completed", "blocked", "failed"].includes(w.status)
      const waiting = w.status === "waiting_input" || w.status === "waiting_confirmation"
      const lease = terminal || waiting || w.releaseLease ? null : { owner, until: new Date(this.now().getTime() + this.leaseMs).toISOString() }
      const next: ScenarioState = { ...w.state, lease, messageId, rev: (cs.rev ?? 0) + 1 }
      await tx
        .update(assistantRun)
        .set({ status: w.status, state: toJsonSafe(next) as object, currentStep: step?.id ?? cur.currentStep, completedAt: terminal ? this.now() : null })
        .where(eq(assistantRun.id, runId))
      return w.status === "running" && !w.releaseLease ? next : null
    })
  }

  /** Appends parts to this advance's assistant message (one bubble per turn), plus source references. */
  private async appendRunParts(tx: Tx, ctx: AgencyContext, conversationId: string, runId: string, messageId: string | null, parts: MessagePart[]) {
    let id = messageId
    if (id) {
      const res = await tx
        .update(assistantMessage)
        .set({ parts: sql`${assistantMessage.parts} || ${JSON.stringify(toJsonSafe(parts))}::jsonb` })
        .where(and(eq(assistantMessage.tenantId, ctx.tenant.id), eq(assistantMessage.id, id)))
        .returning({ id: assistantMessage.id })
      if (!res[0]) id = null
      else await tx.update(assistantConversation).set({ updatedAt: this.now() }).where(eq(assistantConversation.id, conversationId))
    }
    if (!id) id = (await appendMessage(tx, ctx, { conversationId, role: "assistant", parts, runId })).id
    for (const s of parts.flatMap((p) => (p.type === "sources" ? p.refs : []))) {
      if (!/^[0-9a-f-]{36}$/i.test(s.recordId)) continue
      await tx.insert(assistantSourceReference).values({
        tenantId: ctx.tenant.id,
        runId,
        messageId: id,
        recordType: s.recordType,
        recordId: s.recordId,
        recordRevision: s.revision,
        asOf: s.asOf,
        basis: s.basis ?? null,
        currency: s.currency ?? null,
        href: s.href,
        label: s.label,
      })
    }
    return id
  }

  private async recordStep(tx: Tx, ctx: AgencyContext, runId: string, result: StepResult & { delegation?: DelegationRecord; toolCall?: ToolCallRecord }) {
    if (result.toolCall) {
      await tx
        .insert(assistantToolCall)
        .values({
          tenantId: ctx.tenant.id,
          runId,
          callId: result.toolCall.callId,
          toolFamily: result.toolCall.toolFamily,
          skillId: result.toolCall.skillId,
          handler: result.toolCall.handler,
          handlerVersion: "chassis-2",
          input: toJsonSafe(result.toolCall.input) as object,
          proposalId: result.toolCall.proposalId ?? null,
          status: result.toolCall.status,
          result: toJsonSafe(result.toolCall.result) as object,
        })
        .onConflictDoNothing()
    }
    if (result.delegation) {
      await tx.insert(assistantDelegation).values({
        tenantId: ctx.tenant.id,
        parentRunId: runId,
        childWorkflowRunId: result.delegation.childWorkflowRunId,
        subagentKey: result.delegation.subagentKey,
        skillIds: result.delegation.skillIds,
        objective: result.delegation.objective,
        // Delegation never elevates: the specialist runs with the human's permissions.
        effectivePermissions: [...ctx.permissions],
        simulation: "scripted_simulation",
        state: result.delegation.state,
        result: toJsonSafe(result.delegation.result) as object,
      })
    }
  }
}

function nextState(state: ScenarioState, result: StepOutcome): ScenarioState {
  switch (result.kind) {
    case "continue":
      return { ...state, results: { ...state.results, ...(result.save ?? {}) }, params: { ...state.params, ...(result.params ?? {}) }, stepIndex: state.stepIndex + 1 }
    case "wait_confirmation":
      return { ...state, proposalId: result.proposalId, digest: result.digest }
    case "complete":
      return { ...state, stepIndex: state.stepIndex + 1 }
    default:
      return state
  }
}

export function createScriptedDriver(opts: DriverOptions = {}): AssistantDriver {
  return new ScriptedAssistantDriver(opts)
}

export const assistantDriver: AssistantDriver = createScriptedDriver()
