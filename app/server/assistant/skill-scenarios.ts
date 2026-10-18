import "server-only"

import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { parseFieldReply, REF_FIELD_TYPES, stringDefault, toHandlerInput, type RefOption } from "@/lib/assistant/field-input"
import { capabilityResultView } from "@/lib/assistant/openui-compose"
import type { Localized, MessagePart, SourceRefView } from "@/lib/assistant/types"
import { CAPABILITY_CONTRACTS } from "@/lib/capabilities/catalog.generated"
import { GOVERNANCE } from "@/lib/capabilities/governance"
import { INPUT_FIELDS } from "@/lib/capabilities/input-fields"
import type { CapabilityContract, FieldSpec } from "@/lib/capabilities/types"
import { fmtMoney } from "@/lib/format"
import { parseDecimalToMinor } from "@/lib/money"
import type { Permission } from "@/lib/policy"
import type { AgencyContext } from "@/server/auth/context"
import { FIXTURES, HANDLERS } from "@/server/capabilities/registry"
import { runCapability, type RunOutcome } from "@/server/capabilities/runner"
import { actionProposal, approvalRequest } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { loadReferenceOptions, type RefOptions } from "@/server/domain/references"
import { digestOf } from "@/server/kernel/approvals"
import { toJsonSafe } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { assistantBusinessDate } from "./clock"
import { authorizedJob, marginParts, ruleDetails, type ProfitOutput } from "./scenario-helpers"
import { text, type DelegationRecord, type Scenario, type ScenarioStep, type StepRuntime, type ToolCallRecord } from "./scenario-types"

// One scripted scenario per catalog skill (ERP-01..ERP-42, demo-scenarios-v1.json).
// The scenario never computes business results itself: it clarifies missing
// parameters against the workbench field contract, shows a typed proposal for
// commands (confirmation ≠ approval), then delegates to the catalog specialist
// which runs the real handler through runCapability. A skill without a handler
// answers its honest "registered" state.

export const SKILL_SCENARIO_VERSION = "2.0.0"

/** Skills whose featured scenario already owns the ERP entry (aliases move there). */
export const FEATURED_OWNERS: Record<string, string> = { "agency-job-lifecycle": "S-JOB-CREATE" }

const CONTEXT_JOB = "_contextJob"

export function erpIdOf(skillId: string): string {
  const i = CAPABILITY_CONTRACTS.findIndex((c) => c.skillId === skillId)
  if (i < 0) throw new Error(`unknown skill ${skillId}`)
  return `ERP-${String(i + 1).padStart(2, "0")}`
}

/** EN/ES aliases: the demo-scenarios `assistant_entry` texts plus business labels. */
export function skillAliases(c: CapabilityContract): { en: string[]; es: string[] } {
  const erp = erpIdOf(c.skillId)
  return {
    en: [
      `Run demo: ${c.skillId}`,
      `Run demo: ${c.label.en}`,
      `Run demo: ${erp}`,
      c.label.en,
      c.primaryAction.en,
      c.skillId,
      erp,
      `erp ${erp.slice(4)}`,
    ],
    es: [`Ejecuta demo: ${c.skillId}`, `Ejecuta demo: ${c.label.es}`, `Ejecuta demo: ${erp}`, c.label.es, c.primaryAction.es],
  }
}

const pickL = (v: Localized | { en: string; es: string }, ctx: AgencyContext) => (ctx.user.locale === "es" ? v.es : v.en)

/**
 * Fixture defaults without side effects: the positive fixture builder runs
 * with a permission-less copy of the actor's context, so any domain command it
 * would use to prepare preconditions is refused by executeCommand. Builders
 * that only read current state return their input; others fall back.
 */
async function fixtureDefaults(ctx: AgencyContext, skillId: string): Promise<Record<string, unknown> | null> {
  const fx = FIXTURES[skillId]
  if (!fx) return null
  const sandbox: AgencyContext = { ...ctx, permissions: new Set<Permission>() }
  try {
    const res = await Promise.race([
      fx.positive(async () => sandbox),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ])
    return res && typeof res.input === "object" ? res.input : null
  } catch {
    return null
  }
}

function optionsFor(field: FieldSpec, refs: RefOptions, ctx: AgencyContext): RefOption[] {
  if (field.type === "enum") return (field.options ?? []).map((o) => ({ value: o.value, label: pickL(o.label, ctx) }))
  // Evidence shows kind · review state: only reviewed evidence can back client authority (checked by the handler).
  if (field.type === "evidence") return (refs.evidence ?? []).slice(0, 20).map((o) => ({ value: o.value, label: o.detail ? `${o.label} · ${o.detail}` : o.label }))
  if (REF_FIELD_TYPES.has(field.type)) return (refs[field.type] ?? []).slice(0, 20).map((o) => ({ value: o.value, label: o.label }))
  return []
}

async function refsFor(ctx: AgencyContext, fields: readonly FieldSpec[]) {
  const types = [...new Set(fields.filter((f) => REF_FIELD_TYPES.has(f.type)).map((f) => f.type))]
  return types.length ? loadReferenceOptions(ctx, types) : ({} as RefOptions)
}

/** Context job (explicit) > fixture value > field example (required scalars only). Refs must be authorized. */
async function resolveDefaults(ctx: AgencyContext, skillId: string, fields: readonly FieldSpec[], contextJob: string | null) {
  const loaded = await fixtureDefaults(ctx, skillId)
  // Fixture values are a coherent set for the fixture's own record (often the
  // demo-lab job): never mix them with a different job taken from context.
  const fixtureJob = typeof loaded?.job === "string" ? loaded.job : null
  const fixture = loaded && (!contextJob || !fixtureJob || fixtureJob === contextJob) ? loaded : null
  const refs = await refsFor(ctx, fields)
  const values: Record<string, string> = {}
  const origin: Record<string, "context" | "fixture" | "example"> = {}
  for (const f of fields) {
    let v: string | null = null
    let src: "context" | "fixture" | "example" = "example"
    if (f.type === "job" && f.required && contextJob) {
      v = contextJob
      src = "context"
    }
    if (v === null && fixture && fixture[f.key] !== undefined) {
      v = stringDefault(f, fixture[f.key])
      src = "fixture"
    }
    if (v === null && f.required && !REF_FIELD_TYPES.has(f.type) && f.example !== undefined) {
      v = stringDefault(f, f.example)
      src = "example"
    }
    if (v === null) continue
    if (REF_FIELD_TYPES.has(f.type)) {
      if (!(refs[f.type] ?? []).some((o) => o.value === v)) continue
    } else {
      // Defaults pass the same parser a typed reply would.
      const parsed = parseFieldReply(f, v, [])
      if (!parsed.ok) continue
      v = parsed.value
    }
    values[f.key] = v
    origin[f.key] = src
  }
  return { values, origin }
}

function recordCurrency(ctx: AgencyContext, params: Record<string, string>, jobCurrency: string | null) {
  if (params.currency && /^[A-Z]{3}$/.test(params.currency)) return params.currency
  if (params.billingCurrency && /^[A-Z]{3}$/.test(params.billingCurrency)) return params.billingCurrency
  return jobCurrency ?? ctx.tenant.baseCurrency
}

function displayValue(ctx: AgencyContext, f: FieldSpec, v: string, refs: RefOptions, currency: string): string {
  if (f.type === "enum") {
    const o = f.options?.find((x) => x.value === v)
    return o ? pickL(o.label, ctx) : v
  }
  if (REF_FIELD_TYPES.has(f.type)) return refs[f.type]?.find((o) => o.value === v)?.label ?? v
  if (f.type === "money") {
    try {
      return fmtMoney(parseDecimalToMinor(v, currency), currency, ctx.user.locale)
    } catch {
      return `${v} ${currency}`
    }
  }
  if (f.type === "boolean") return v === "true" ? (ctx.user.locale === "es" ? "Sí" : "Yes") : "No"
  if (f.type === "minutes") return `${v} min`
  if (f.type === "bps") return `${v} bps`
  return v
}

function summarize(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 77)}…` : v
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v)
  if (Array.isArray(v)) return `[${v.length}]`
  return `{${Object.keys(v as object).length}}`
}

function outputSummary(contract: CapabilityContract, output: unknown) {
  if (!output || typeof output !== "object") return []
  const o = output as Record<string, unknown>
  const keys = [...contract.repositoryOutputs.filter((k) => k in o), ...Object.keys(o).filter((k) => !contract.repositoryOutputs.includes(k))]
  return keys.slice(0, 10).map((k) => ({ key: k, summary: summarize(o[k]) }))
}

function outputSources(ctx: AgencyContext, output: unknown, businessDate: string): SourceRefView[] {
  const raw = (output as { sources?: unknown } | null)?.sources
  if (!Array.isArray(raw)) return []
  const base = `/a/${ctx.tenant.slug}/`
  return raw
    .filter((s): s is SourceRefView => Boolean(s) && typeof s === "object" && typeof (s as SourceRefView).recordId === "string" && typeof (s as SourceRefView).href === "string")
    .filter((s) => s.href.startsWith(base))
    .slice(0, 20)
    .map((s) => ({ recordType: String(s.recordType), recordId: s.recordId, revision: typeof s.revision === "number" ? s.revision : null, label: String(s.label).slice(0, 120), href: s.href, asOf: String(s.asOf ?? businessDate), basis: s.basis ?? null, currency: s.currency ?? null }))
}

const SERIES_KIND: Record<string, "actual" | "forecast" | "simulated"> = {
  "agency-cash-forecast": "forecast",
  "agency-revenue-budget": "forecast",
}

async function resultParts(rt: StepRuntime, contract: CapabilityContract, outcome: RunOutcome): Promise<MessagePart[]> {
  const { ctx } = rt
  const parts: MessagePart[] = [
    {
      type: "capability_result",
      skillId: contract.skillId,
      label: contract.label,
      state: outcome.state,
      runHref: `/a/${ctx.tenant.slug}/runs/${outcome.runId}`,
      replayed: outcome.replayed,
      outputs: outputSummary(contract, outcome.output),
    },
  ]
  const out = (outcome.output ?? null) as Record<string, unknown> | null
  const approvalId = typeof out?.approvalId === "string" && /^[0-9a-f-]{36}$/i.test(out.approvalId) ? out.approvalId : null
  if (approvalId) {
    const [a] = await withTenant(ctx.tenant.id, (tx) =>
      tx
        .select({ id: approvalRequest.id, state: approvalRequest.state, eligibleRoles: approvalRequest.eligibleRoles, title: approvalRequest.title, proposalId: approvalRequest.proposalId })
        .from(approvalRequest)
        .where(and(eq(approvalRequest.tenantId, ctx.tenant.id), eq(approvalRequest.id, approvalId)))
        .limit(1)
    )
    if (a) {
      parts.push({
        type: "approval_request",
        approvalId: a.id,
        proposalId: a.proposalId,
        skillId: contract.skillId,
        title: { en: a.title, es: a.title },
        state: a.state,
        eligibleRoles: a.eligibleRoles,
        href: `/a/${ctx.tenant.slug}/approvals/${a.id}`,
      })
      parts.push(text("assistant.skill.approvalCreated"))
    }
  }
  if (contract.skillId === "agency-profitability" && out && typeof out.marginMinor === "string") {
    parts.push(...(await marginParts(ctx, contract.skillId, out as unknown as ProfitOutput)))
    return parts
  }
  const businessDate = await assistantBusinessDate()
  const view = capabilityResultView({
    skillId: contract.skillId,
    label: contract.label,
    output: out,
    asOf: typeof out?.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(out.asOf) ? out.asOf : businessDate,
    defaultCurrency: null,
    seriesKind: SERIES_KIND[contract.skillId] ?? "actual",
  })
  if (view) parts.push(view)
  const sources = outputSources(ctx, out, businessDate)
  if (sources.length) parts.push({ type: "sources", refs: sources })
  parts.push(text("assistant.skill.done", { skillEn: contract.label.en, skillEs: contract.label.es }))
  return parts
}

function buildSkillScenario(contract: CapabilityContract): Scenario {
  const skillId = contract.skillId
  const g = GOVERNANCE[skillId]!
  const fields = INPUT_FIELDS[skillId] ?? []
  const erp = erpIdOf(skillId)
  const handler = HANDLERS[skillId]
  const isQuery = (handler?.kind ?? g.handlerKind) === "query"
  const specialist = contract.specialistKey
  const readPermissions: Permission[] = isQuery ? [...new Set([g.viewPermission, g.executePermission])] : [g.viewPermission]
  const workbenchHref = (ctx: AgencyContext) => `/a/${ctx.tenant.slug}/modules/${contract.moduleKey}/workflows/${skillId}`

  const check: ScenarioStep = {
    id: "check_capability",
    type: "query",
    label: { en: "Check the capability and resolve defaults", es: "Revisar la capacidad y resolver valores" },
    run: async (rt) => {
      const { ctx } = rt
      if (!HANDLERS[skillId]) {
        return {
          kind: "blocked",
          code: "capability_pending",
          parts: [
            { type: "capability_status", skillId, label: contract.label, status: "registered", actionId: contract.actionId, workbenchHref: workbenchHref(ctx) },
            text("assistant.skill.pending"),
          ],
        }
      }
      if (!g.mandatory && !ctx.enabledCapabilities.has(skillId)) {
        return {
          kind: "blocked",
          code: "capability_disabled",
          parts: [{ type: "capability_status", skillId, label: contract.label, status: "disabled", actionId: contract.actionId, workbenchHref: workbenchHref(ctx) }],
        }
      }
      const defaults = await resolveDefaults(ctx, skillId, fields, rt.state.params[CONTEXT_JOB] ?? null)
      return { kind: "continue", save: { defaults } }
    },
  }

  const asks: ScenarioStep[] = fields.map((f) => ({
    id: `ask_${f.key}`,
    type: "request_input",
    field: f.key,
    label: { en: `Ask for ${f.label.en}`, es: `Pedir ${f.label.es}` },
    run: async (rt) => {
      if (rt.state.params[f.key] !== undefined) return { kind: "continue" }
      const d = (rt.state.results.defaults as { values?: Record<string, string> } | undefined)?.values?.[f.key]
      if (d !== undefined) return { kind: "continue", params: { [f.key]: d } }
      if (!f.required) return { kind: "continue" }
      const refs = await refsFor(rt.ctx, [f])
      const options = optionsFor(f, refs, rt.ctx)
      const freeText = f.type !== "enum" && !REF_FIELD_TYPES.has(f.type) && f.type !== "boolean"
      return {
        kind: "wait_input",
        field: f.key,
        parts: [
          text(freeText ? "assistant.skill.askFree" : "assistant.skill.askChoice"),
          {
            type: "input_request",
            field: f.key,
            label: f.label,
            options: f.type === "boolean" ? [{ value: "true", label: rt.ctx.user.locale === "es" ? "Sí" : "Yes" }, { value: "false", label: "No" }] : options,
            runId: rt.runId,
            fieldType: f.type,
            help: f.help,
            freeText,
          },
        ],
      }
    },
    acceptInput: async (rt, reply) => {
      const refs = await refsFor(rt.ctx, [f])
      const parsed = parseFieldReply(f, reply, optionsFor(f, refs, rt.ctx))
      if (!parsed.ok) return { ok: false, parts: [text(`assistant.skill.reply.${parsed.reason}`)] }
      return { ok: true, value: parsed.value }
    },
  }))

  const prepare: ScenarioStep = {
    id: "prepare_proposal",
    type: "prepare_action",
    label: { en: "Prepare the exact proposal", es: "Preparar la propuesta exacta" },
    run: async (rt) => {
      if (isQuery) return { kind: "continue" }
      const { ctx } = rt
      const params = rt.state.params
      const input = toHandlerInput(fields, params)
      const h = HANDLERS[skillId]
      const revisionOf = h && h.kind === "command" ? (h.revisionOf ?? null) : null
      const j = params.job ? await authorizedJob(ctx, params.job) : null
      if (params.job && !j) throw new DomainError("not_found", "Job not available")
      const expectedRevision = revisionOf === "job" ? (j?.revision ?? null) : null
      const payload = { skillId, input, expectedRevision }
      const digest = digestOf(payload)
      const refs = await refsFor(ctx, fields)
      const currency = recordCurrency(ctx, params, j?.currency ?? null)
      const rows = fields
        .filter((f) => params[f.key] !== undefined)
        .map((f) => ({ label: f.label, before: null, after: displayValue(ctx, f, params[f.key]!, refs, currency) }))
      const approval = g.approval.mode === "approval"
      const [p] = await withTenant(ctx.tenant.id, (tx) =>
        tx
          .insert(actionProposal)
          .values({
            tenantId: ctx.tenant.id,
            actionType: `assistant.capability:${skillId}`,
            skillId,
            aggregateType: j ? "job" : "capability",
            aggregateId: j?.id ?? null,
            baseRevision: j?.revision ?? null,
            payload: toJsonSafe(payload) as object,
            payloadDigest: digest,
            diff: toJsonSafe(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, { before: null, after: v }]))) as object,
            impact: { approvalMode: g.approval.mode, eligibleRoles: g.approval.eligibleRoles ?? [] },
            state: "awaiting_confirmation",
            origin: "assistant_scripted",
            conversationId: rt.conversationId,
            runId: rt.runId,
            createdBy: ctx.user.id,
          })
          .returning()
      )
      const impact: { label: Localized; value: string }[] = [{ label: { en: "Policy", es: "Política" }, value: pickL(g.approval.note, ctx) }]
      if (approval) impact.push({ label: { en: "Eligible approvers", es: "Aprobadores elegibles" }, value: (g.approval.eligibleRoles ?? []).join(", ") })
      if (expectedRevision !== null && j) impact.push({ label: { en: "Job revision bound", es: "Revisión del trabajo" }, value: `${j.displayReference} · r${expectedRevision}` })
      return {
        kind: "wait_confirmation",
        proposalId: p!.id,
        digest,
        parts: [
          {
            type: "proposal",
            proposalId: p!.id,
            digest,
            state: "awaiting_confirmation",
            title: { en: `${contract.primaryAction.en} · ${erp}`, es: `${contract.primaryAction.es} · ${erp}` },
            rows,
            impact,
            requires: approval ? "approval" : "confirmation",
            skillId,
          },
          text(approval ? "assistant.skill.confirmThenApproval" : "assistant.skill.confirmToRun"),
        ],
      }
    },
  }

  const delegate: ScenarioStep = {
    id: "delegate_specialist",
    type: "scripted_delegation",
    label: { en: `Delegate to ${specialist}`, es: `Delegar en ${specialist}` },
    run: async (rt) => {
      const { ctx } = rt
      let input: Record<string, unknown>
      let idempotencyKey: string
      let expectedRevision: number | undefined
      let proposalId: string | null = null
      if (isQuery) {
        input = toHandlerInput(fields, rt.state.params)
        idempotencyKey = `assistant:${rt.runId}:${skillId}`
      } else {
        const [p] = await withTenant(ctx.tenant.id, (tx) =>
          tx.select().from(actionProposal).where(and(eq(actionProposal.tenantId, ctx.tenant.id), eq(actionProposal.id, rt.state.proposalId ?? "00000000-0000-0000-0000-000000000000"))).limit(1)
        )
        if (!p || (p.state !== "confirmed" && p.state !== "executed")) {
          return { kind: "blocked", code: "approval_required", parts: [{ type: "blocked", code: "approval_required", message: { en: "The proposal is not confirmed.", es: "La propuesta no está confirmada." } }] }
        }
        // The executed payload is the stored one, re-checked against its digest.
        if (digestOf(p.payload) !== p.payloadDigest) {
          return { kind: "blocked", code: "approval_stale", parts: [{ type: "blocked", code: "approval_stale", message: { en: "The stored proposal no longer matches its digest.", es: "La propuesta guardada ya no coincide con su huella." } }] }
        }
        const payload = z.object({ skillId: z.literal(skillId), input: z.record(z.string(), z.unknown()), expectedRevision: z.number().int().nullable() }).parse(p.payload)
        input = payload.input
        expectedRevision = payload.expectedRevision ?? undefined
        idempotencyKey = `proposal:${p.id}`
        proposalId = p.id
      }
      const outcome = await runCapability(ctx, skillId, input, { origin: "assistant_scripted", idempotencyKey, expectedRevision, correlationId: rt.runId })
      if (proposalId) {
        await withTenant(ctx.tenant.id, (tx) =>
          tx
            .update(actionProposal)
            .set({ state: outcome.state === "succeeded" ? "executed" : "blocked", executedCommandId: outcome.runId, updatedAt: new Date() })
            .where(and(eq(actionProposal.tenantId, ctx.tenant.id), eq(actionProposal.id, proposalId)))
        )
      }
      const delegation: DelegationRecord = {
        subagentKey: specialist,
        skillIds: [skillId],
        objective: `${contract.actionId} via ${skillId}`,
        childWorkflowRunId: outcome.runId,
        state: outcome.state,
        result: outcome.output ?? outcome.error,
      }
      const toolCall: ToolCallRecord = {
        callId: "delegate_specialist",
        toolFamily: isQuery ? "query_records" : g.approval.mode === "approval" ? "request_approval" : "save_confirmed_draft",
        skillId,
        handler: contract.actionId,
        input,
        status: outcome.state === "succeeded" ? "succeeded" : outcome.state === "blocked" ? "blocked" : "failed",
        result: outcome.output ?? outcome.error,
        proposalId,
      }
      const base: MessagePart[] = [
        {
          type: "delegation",
          subagentKey: specialist,
          skillIds: [skillId],
          objective: { en: `${contract.primaryAction.en} (${contract.actionId})`, es: `${contract.primaryAction.es} (${contract.actionId})` },
          state: outcome.state,
          runHref: `/a/${ctx.tenant.slug}/runs/${outcome.runId}`,
        },
      ]
      if (outcome.state !== "succeeded") {
        const code = outcome.error?.code ?? "blocked_by_rule"
        return {
          kind: "blocked",
          code,
          delegation,
          toolCall,
          parts: [
            ...base,
            { type: "blocked", code, message: { en: outcome.error?.message ?? "Blocked", es: outcome.error?.message ?? "Bloqueado" }, details: ruleDetails(outcome.error?.details) },
          ],
        }
      }
      return { kind: "complete", delegation, toolCall, parts: [...base, ...(await resultParts(rt, contract, outcome))] }
    },
  }

  return {
    id: erp,
    version: SKILL_SCENARIO_VERSION,
    title: { en: `${contract.label.en} (${erp})`, es: `${contract.label.es} (${erp})` },
    skillIds: ["agency-orchestrator", skillId].filter((v, i, a) => a.indexOf(v) === i),
    aliases: skillAliases(contract),
    presets: [
      {
        presetId: `preset.skill.${skillId}`,
        label: { en: `Run demo: ${contract.label.en}`, es: `Ejecuta demo: ${contract.label.es}` },
        description: contract.primaryAction,
        group: contract.moduleKey,
        featured: skillId === "agency-fee-contracts",
        scenarioId: erp,
      },
    ],
    requiredPermission: g.executePermission,
    readPermissions,
    parameterSchema: z.object(Object.fromEntries(fields.map((f) => [f.key, z.string().optional()]))).strict(),
    allowedContext: ["job", "module", "none"],
    init: async (ctx, hint) => {
      const j = await authorizedJob(ctx, hint.recordJobId)
      const params: Record<string, string> = {}
      if (j) params[CONTEXT_JOB] = j.id
      return params
    },
    steps: [check, ...asks, prepare, delegate],
  }
}

export const SKILL_SCENARIOS: readonly Scenario[] = CAPABILITY_CONTRACTS.filter((c) => !FEATURED_OWNERS[c.skillId]).map(buildSkillScenario)

/** Aliases a featured scenario takes over for its skill (e.g. ERP-06 → S-JOB-CREATE). */
export function featuredSkillAliases(skillId: string) {
  const c = CAPABILITY_CONTRACTS.find((x) => x.skillId === skillId)
  return c ? skillAliases(c) : { en: [], es: [] }
}
