import "server-only"

import { and, asc, count, eq, max } from "drizzle-orm"
import { z } from "zod"

import type { MessagePart, SuggestionView } from "@/lib/assistant/types"
import { jobNumber } from "@/server/calculators"
import { runCapability } from "@/server/capabilities/runner"
import { actionProposal, client, job } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { createProposal } from "@/server/kernel/approvals"
import { DomainError } from "@/server/kernel/errors"

import { INVESTOR_SCENARIOS } from "./investor-scenarios"
import { authorizedJob, findJobByName, marginParts, ruleDetails, type ProfitOutput } from "./scenario-helpers"
import { normalizeAlias, text, type DelegationRecord, type Scenario, type ToolCallRecord } from "./scenario-types"
import { featuredSkillAliases, SKILL_SCENARIOS } from "./skill-scenarios"

export * from "./scenario-types"

// Versioned scripted scenario registry for AgeOS Assistant (agency-orchestrator
// / coordinador). Featured journeys (margin, job creation) plus one generic
// scenario per catalog skill (ERP-01..ERP-42, ./skill-scenarios). Wording is
// hardcoded; every figure, state and reference comes from server handlers.

export const SCENARIO_CATALOG_VERSION = "erp-42@2.1.0"

// ── S-MARGIN-EXPLAIN: query through a scripted delegation to `rentabilidad` ──

const marginScenario: Scenario = {
  id: "S-MARGIN-EXPLAIN",
  version: "2.0.0",
  title: { en: "Explain a job's projected margin", es: "Explicar el margen proyectado de un trabajo" },
  skillIds: ["agency-orchestrator", "agency-profitability"],
  aliases: {
    en: ["explain aurora margin", "explain the aurora margin", "what is the aurora margin", "aurora margin", "explain this job margin", "explain this job's margin", "explain margin"],
    es: ["explica el margen de aurora", "explicar el margen de aurora", "cual es el margen de aurora", "margen de aurora", "explica el margen de este trabajo", "explica el margen"],
  },
  presets: [
    {
      presetId: "preset.margin.aurora",
      label: { en: "Explain Aurora margin", es: "Explica el margen de Aurora" },
      description: { en: "Profitability query with dashboard and sources", es: "Consulta de rentabilidad con tablero y fuentes" },
      featured: true,
      group: null,
      scenarioId: "S-MARGIN-EXPLAIN",
    },
  ],
  requiredPermission: "reports.view",
  readPermissions: ["reports.view"],
  parameterSchema: z.object({ job: z.string().uuid() }).strict(),
  allowedContext: ["job", "none"],
  init: async (ctx, hint) => {
    const fromContext = await authorizedJob(ctx, hint.recordJobId)
    const mentionsAurora = /aurora/.test(hint.text)
    const jobId = mentionsAurora ? await findJobByName(ctx, "Aurora") : fromContext?.id ?? null
    if (!jobId) throw new DomainError("not_found", "No job in context", { reason: "job_required" })
    return { job: jobId }
  },
  steps: [
    {
      id: "delegate_profitability",
      type: "scripted_delegation",
      label: { en: "Profitability specialist computes the margin", es: "El especialista de rentabilidad calcula el margen" },
      run: async (rt) => {
        // Fresh query per run: the answer always reflects the current checkpoint.
        const outcome = await runCapability(
          rt.ctx,
          "agency-profitability",
          { job: rt.state.params.job!, basis: "forecast" },
          { origin: "assistant_scripted", idempotencyKey: `assistant:${rt.runId}:profitability`, correlationId: rt.runId }
        )
        const delegation: DelegationRecord = {
          subagentKey: "rentabilidad",
          skillIds: ["agency-profitability"],
          objective: "Compute forecast margin for the job in context",
          childWorkflowRunId: outcome.runId,
          state: outcome.state,
          result: outcome.output,
        }
        const toolCall: ToolCallRecord = {
          callId: "delegate_profitability",
          toolFamily: "query_records",
          skillId: "agency-profitability",
          handler: "calculateJobProfitability",
          input: { job: rt.state.params.job, basis: "forecast" },
          status: outcome.state === "succeeded" ? "succeeded" : "blocked",
          result: outcome.output ?? outcome.error,
        }
        const parts: MessagePart[] = [
          {
            type: "delegation",
            subagentKey: "rentabilidad",
            skillIds: ["agency-profitability"],
            objective: { en: "Compute the job's forecast margin", es: "Calcular el margen pronosticado del trabajo" },
            state: outcome.state,
            runHref: `/a/${rt.ctx.tenant.slug}/runs/${outcome.runId}`,
          },
        ]
        if (outcome.state !== "succeeded") {
          return { kind: "blocked", code: outcome.error?.code ?? "blocked_by_rule", parts: [...parts, { type: "blocked", code: outcome.error?.code ?? "blocked_by_rule", message: { en: outcome.error?.message ?? "Blocked", es: outcome.error?.message ?? "Bloqueado" } }], delegation, toolCall }
        }
        return { kind: "continue", parts, save: { profit: outcome.output }, delegation, toolCall }
      },
    },
    {
      id: "show_margin",
      type: "show_result",
      label: { en: "Explain the result with sources", es: "Explicar el resultado con fuentes" },
      run: async (rt) => ({ kind: "complete", parts: await marginParts(rt.ctx, "agency-profitability", rt.state.results.profit as ProfitOutput) }),
    },
  ],
}

// ── S-JOB-CREATE: missing parameters → proposal → confirmation → command ──

const JobCreatePayload = z
  .object({
    action: z.literal("open"),
    client: z.string().uuid(),
    jobName: z.string().min(3).max(160),
    jobType: z.literal("A"),
    billingCode: z.literal("F"),
    period: z.string().regex(/^\d{4}-\d{2}$/),
  })
  .strict()

const jobCreateScenario: Scenario = {
  id: "S-JOB-CREATE",
  version: "1.1.0",
  title: { en: "Create a job draft", es: "Crear un trabajo" },
  skillIds: ["agency-orchestrator", "agency-job-lifecycle"],
  // Also owns the ERP-06 catalog entry (agency-job-lifecycle aliases).
  aliases: {
    en: ["create a job", "create job", "new job", "open a job", "create a new job", ...featuredSkillAliases("agency-job-lifecycle").en],
    es: ["crea un trabajo", "crear un trabajo", "crear trabajo", "nuevo trabajo", "abre un trabajo", ...featuredSkillAliases("agency-job-lifecycle").es],
  },
  presets: [
    {
      presetId: "preset.job.create",
      label: { en: "Create a job", es: "Crea un trabajo" },
      description: { en: "Asks for missing fields, then confirms", es: "Pide los datos faltantes y luego confirma" },
      featured: true,
      group: null,
      scenarioId: "S-JOB-CREATE",
    },
    {
      presetId: "preset.skill.agency-job-lifecycle",
      label: { en: "Run demo: Job lifecycle", es: "Ejecuta demo: Apertura y cierre de trabajos" },
      description: { en: "Open job", es: "Abrir trabajo" },
      featured: false,
      group: "clients-contracts",
      scenarioId: "ERP-06",
    },
  ],
  requiredPermission: "jobs.manage",
  readPermissions: ["workspace.view"],
  parameterSchema: z.object({ client: z.string().uuid().optional(), jobName: z.string().optional() }),
  allowedContext: ["none", "job", "module"],
  init: async () => ({}),
  steps: [
    {
      id: "ask_client",
      type: "request_input",
      field: "client",
      label: { en: "Ask which client", es: "Preguntar el cliente" },
      run: async (rt) => {
        if (rt.state.params.client) return { kind: "continue" }
        const clients = await withTenant(rt.ctx.tenant.id, (tx) =>
          tx
            .select({ id: client.id, name: client.name })
            .from(client)
            .where(and(eq(client.tenantId, rt.ctx.tenant.id), eq(client.state, "active")))
            .orderBy(asc(client.name))
        )
        return {
          kind: "wait_input",
          field: "client",
          parts: [
            text("assistant.jobCreate.askClient"),
            {
              type: "input_request",
              field: "client",
              label: { en: "Client", es: "Cliente" },
              options: clients.map((c) => ({ value: c.id, label: c.name })),
              runId: rt.runId,
              fieldType: "client",
            },
          ],
        }
      },
      acceptInput: async (rt, value) => {
        const clients = await withTenant(rt.ctx.tenant.id, (tx) =>
          tx.select({ id: client.id, name: client.name, code: client.code }).from(client).where(and(eq(client.tenantId, rt.ctx.tenant.id), eq(client.state, "active")))
        )
        const v = normalizeAlias(value)
        const match = clients.filter((c) => c.id === value || normalizeAlias(c.name) === v || c.code.toLowerCase() === v)
        if (match.length !== 1) return { ok: false, parts: [text("assistant.jobCreate.clientNotFound")] }
        return { ok: true, value: match[0]!.id }
      },
    },
    {
      id: "ask_name",
      type: "request_input",
      field: "jobName",
      label: { en: "Ask the job name", es: "Preguntar el nombre del trabajo" },
      run: async (rt) => {
        if (rt.state.params.jobName) return { kind: "continue" }
        return {
          kind: "wait_input",
          field: "jobName",
          parts: [
            text("assistant.jobCreate.askName"),
            { type: "input_request", field: "jobName", label: { en: "Job name", es: "Nombre del trabajo" }, options: [], runId: rt.runId, fieldType: "text", freeText: true },
          ],
        }
      },
      acceptInput: async (_rt, value) => {
        const v = value.trim()
        if (v.length < 3 || v.length > 160) return { ok: false, parts: [text("assistant.jobCreate.nameInvalid")] }
        return { ok: true, value: v }
      },
    },
    {
      id: "prepare",
      type: "prepare_action",
      label: { en: "Prepare the job proposal", es: "Preparar la propuesta del trabajo" },
      run: async (rt) => {
        const payload = JobCreatePayload.parse({
          action: "open",
          client: rt.state.params.client,
          jobName: rt.state.params.jobName,
          jobType: "A",
          billingCode: "F",
          period: "2027-03",
        })
        return withTenant(rt.ctx.tenant.id, async (tx) => {
          const [c] = await tx.select().from(client).where(and(eq(client.tenantId, rt.ctx.tenant.id), eq(client.id, payload.client))).limit(1)
          if (!c) throw new DomainError("not_found", "Client not found")
          const [seq] = await tx.select({ m: max(job.sequence) }).from(job).where(and(eq(job.tenantId, rt.ctx.tenant.id), eq(job.clientId, c.id), eq(job.year, 2027)))
          const [{ n }] = await tx.select({ n: count() }).from(job).where(and(eq(job.tenantId, rt.ctx.tenant.id), eq(job.year, 2027)))
          const preview = jobNumber({ clientCode: c.code, productCode: c.productCode, year: 2027, jobType: "A", billingCode: "F", sequence: (seq?.m ?? 0) + 1 })
          const proposal = await createProposal(
            tx,
            rt.ctx,
            {
              actionType: "jobs.open",
              skillId: "agency-job-lifecycle",
              aggregateType: "client",
              aggregateId: c.id,
              baseRevision: c.revision,
              payload,
              diff: { job: { before: null, after: payload.jobName } },
              impact: { jobNumberPreview: preview.code, displayReferencePreviewIndex: n + 1 },
              origin: "assistant_scripted",
              conversationId: rt.conversationId,
              runId: rt.runId,
            },
            "awaiting_confirmation"
          )
          const parts: MessagePart[] = [
            {
              type: "proposal",
              proposalId: proposal.id,
              digest: proposal.payloadDigest,
              state: "awaiting_confirmation",
              title: { en: "New job draft", es: "Borrador de nuevo trabajo" },
              rows: [
                { label: { en: "Client", es: "Cliente" }, before: null, after: c.name },
                { label: { en: "Job name", es: "Nombre del trabajo" }, before: null, after: payload.jobName },
                { label: { en: "Type · billing", es: "Tipo · facturación" }, before: null, after: "A · F" },
                { label: { en: "Period", es: "Periodo" }, before: null, after: payload.period },
              ],
              impact: [
                { label: { en: "JobNumber (preview, assigned by server on save)", es: "JobNumber (vista previa; el servidor lo asigna al guardar)" }, value: preview.code },
              ],
              requires: "confirmation",
              skillId: "agency-job-lifecycle",
            },
          ]
          return { kind: "wait_confirmation" as const, parts, proposalId: proposal.id, digest: proposal.payloadDigest }
        })
      },
    },
    {
      id: "delegate_create",
      type: "scripted_delegation",
      label: { en: "Clients specialist opens the job", es: "El especialista de clientes abre el trabajo" },
      run: async (rt) => {
        const proposal = await withTenant(rt.ctx.tenant.id, async (tx) => {
          const [p] = await tx.select().from(actionProposal).where(and(eq(actionProposal.tenantId, rt.ctx.tenant.id), eq(actionProposal.id, rt.state.proposalId!))).limit(1)
          return p ?? null
        })
        if (!proposal || (proposal.state !== "confirmed" && proposal.state !== "executed")) {
          return { kind: "blocked", code: "approval_required", parts: [{ type: "blocked", code: "approval_required", message: { en: "The proposal is not confirmed.", es: "La propuesta no está confirmada." } }] }
        }
        const outcome = await runCapability(rt.ctx, "agency-job-lifecycle", proposal.payload as Record<string, unknown>, {
          origin: "assistant_scripted",
          // Domain idempotency derives from the stable proposal id, never from text.
          idempotencyKey: `proposal:${proposal.id}`,
          correlationId: rt.runId,
        })
        const delegation: DelegationRecord = {
          subagentKey: "clientes",
          skillIds: ["agency-job-lifecycle"],
          objective: "Open the confirmed job through the shared command",
          childWorkflowRunId: outcome.runId,
          state: outcome.state,
          result: outcome.output ?? outcome.error,
        }
        const base: MessagePart[] = [
          {
            type: "delegation",
            subagentKey: "clientes",
            skillIds: ["agency-job-lifecycle"],
            objective: { en: "Open the confirmed job (real command)", es: "Abrir el trabajo confirmado (comando real)" },
            state: outcome.state,
            runHref: `/a/${rt.ctx.tenant.slug}/runs/${outcome.runId}`,
          },
        ]
        const toolCall: ToolCallRecord = {
          callId: "delegate_create",
          toolFamily: "execute_approved_action",
          skillId: "agency-job-lifecycle",
          handler: "jobs.openOrClose",
          input: proposal.payload,
          status: outcome.state === "succeeded" ? "succeeded" : "blocked",
          result: outcome.output ?? outcome.error,
          proposalId: proposal.id,
        }
        if (outcome.state !== "succeeded") {
          const code = outcome.error?.code ?? "blocked_by_rule"
          return { kind: "blocked", code, parts: [...base, { type: "blocked", code, message: { en: outcome.error?.message ?? "Blocked", es: outcome.error?.message ?? "Bloqueado" }, details: ruleDetails(outcome.error?.details) }], delegation, toolCall }
        }
        const r = outcome.output as { jobId: string; jobNumber: string; displayReference: string }
        await withTenant(rt.ctx.tenant.id, (tx) =>
          tx.update(actionProposal).set({ state: "executed", executedCommandId: outcome.runId, updatedAt: new Date() }).where(eq(actionProposal.id, proposal.id))
        )
        const href = `/a/${rt.ctx.tenant.slug}/jobs/${r.jobId}`
        return {
          kind: "complete",
          delegation,
          toolCall,
          parts: [
            ...base,
            {
              type: "receipt",
              title: { en: "Job created", es: "Trabajo creado" },
              lines: [
                { label: { en: "JobNumber", es: "JobNumber" }, value: r.jobNumber, href },
                { label: { en: "Reference", es: "Referencia" }, value: r.displayReference },
                { label: { en: "State", es: "Estado" }, value: "open" },
              ],
              commandId: outcome.runId,
              replayed: outcome.replayed,
            },
            text("assistant.jobCreate.done", { reference: r.displayReference }),
          ],
        }
      },
    },
  ],
}

// Investor-script prompts first (featured order in the composer), then the J07 journeys and ERP-01..42.
export const SCENARIOS: readonly Scenario[] = [...INVESTOR_SCENARIOS, marginScenario, jobCreateScenario, ...SKILL_SCENARIOS]

export function scenarioById(id: string, version?: string, registry: readonly Scenario[] = SCENARIOS) {
  return registry.find((s) => s.id === id && (!version || s.version === version)) ?? null
}

function aliasIndex(registry: readonly Scenario[]) {
  const index = new Map<string, Scenario[]>()
  for (const s of registry) {
    for (const a of new Set([...s.aliases.en, ...s.aliases.es].map(normalizeAlias))) {
      if (!a) continue
      index.set(a, [...(index.get(a) ?? []), s])
    }
  }
  return index
}

const INDEX = aliasIndex(SCENARIOS)

/** Exact normalized alias match. Two candidates → the caller asks the user to choose. */
export function matchScenarios(input: string, registry: readonly Scenario[] = SCENARIOS): Scenario[] {
  const n = normalizeAlias(input)
  if (!n) return []
  const index = registry === SCENARIOS ? INDEX : aliasIndex(registry)
  return index.get(n) ?? []
}

export function scenarioForPreset(presetId: string, registry: readonly Scenario[] = SCENARIOS) {
  return registry.find((s) => s.presets.some((p) => p.presetId === presetId)) ?? null
}

/**
 * Presets offered to this viewer. Presenter-only demo tools appear only for an
 * authorized presenter session; every other permission is enforced when a
 * scenario starts (and again by the command).
 */
export function allSuggestions(registry: readonly Scenario[] = SCENARIOS, viewer: { presenter: boolean } = { presenter: false }): SuggestionView[] {
  return registry.flatMap((s) => s.presets).filter((p) => !p.presenterOnly || viewer.presenter)
}

export const CONFIRM_ALIASES = ["yes", "confirm", "si", "sí", "confirmar", "confirmo"].map(normalizeAlias)
