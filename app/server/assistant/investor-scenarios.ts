import "server-only"

import { z } from "zod"

import { MARGIN_FLOOR_BPS } from "@/lib/demo"
import { marginChangeView } from "@/lib/assistant/openui-compose"
import type { Localized, MessagePart, SourceRefView } from "@/lib/assistant/types"
import { INPUT_FIELDS } from "@/lib/capabilities/input-fields"
import { fmtMinutesAsHours, fmtMoney, fmtPct } from "@/lib/format"
import { parseDecimalToMinor, minorToDecimalString } from "@/lib/money"
import type { AgencyContext } from "@/server/auth/context"
import { margin } from "@/server/calculators"
import { runCapability } from "@/server/capabilities/runner"
import { withTenant } from "@/server/db/tenant"
import { estimateTotals, loadJobFinancials } from "@/server/domain/profitability"
import { DomainError } from "@/server/kernel/errors"
import { getInbox } from "@/server/queries/inbox"

import { assistantBusinessDate } from "./clock"
import { loadSampleScopeRequest, presenterSessionFor } from "./presenter-scope"
import { authorizedJob, findJobByName, ruleDetails } from "./scenario-helpers"
import { text, type DelegationRecord, type Scenario, type StepRuntime, type ToolCallRecord } from "./scenario-types"
import { skillScenarioSteps } from "./skill-scenarios"

// Scenarios of the 90-second investor walkthrough (05-guion-demo-inversionistas.md):
//   25–40 s  "What needs attention on this job?"            → S-JOB-ATTENTION (read-only)
//   40–58 s  "Explain the margin change and prepare the fee adjustment for review"
//                                                            → S-MARGIN-CHANGE-FEE (explain + ERP-09 proposal)
//   demo tools "Load sample scope request"                   → S-PRESENTER-SCOPE (presenter only)
// plus the attach_authorized_file tool record (S-ATTACH-FILE). Wording is
// scripted; every figure comes from the ERP at the moment of the request.

const pickL = (v: Localized, ctx: AgencyContext) => (ctx.user.locale === "es" ? v.es : v.en)

/** The job in context (dossier/pinned), or Aurora when the text names it. */
async function contextJob(ctx: AgencyContext, hint: { recordJobId: string | null; text: string }) {
  const fromContext = await authorizedJob(ctx, hint.recordJobId)
  if (fromContext) return fromContext.id
  if (/aurora/.test(hint.text)) {
    const id = await findJobByName(ctx, "Aurora")
    if (id) return id
  }
  throw new DomainError("not_found", "No job in context", { reason: "job_required" })
}

// ── 25–40 s · What needs attention on this job? ──

const attentionScenario: Scenario = {
  id: "S-JOB-ATTENTION",
  version: "1.0.0",
  title: { en: "What needs attention on this job", es: "Qué necesita atención en este trabajo" },
  skillIds: ["agency-orchestrator"],
  aliases: {
    en: ["What needs attention on this job?", "What needs attention on this job", "What needs attention?", "What needs attention on Aurora?"],
    es: ["¿Qué necesita atención en este trabajo?", "¿Qué necesita atención?", "¿Qué necesita atención en Aurora?"],
  },
  presets: [
    {
      presetId: "preset.job.attention",
      label: { en: "What needs attention on this job?", es: "¿Qué necesita atención en este trabajo?" },
      description: { en: "Authorized attention items, approvals and blocked runs of the job in context", es: "Alertas, aprobaciones y ejecuciones bloqueadas autorizadas del trabajo en contexto" },
      featured: true,
      group: null,
      scenarioId: "S-JOB-ATTENTION",
    },
  ],
  requiredPermission: "workspace.view",
  readPermissions: ["workspace.view"],
  parameterSchema: z.object({ job: z.string().uuid() }).strict(),
  allowedContext: ["job"],
  init: async (ctx, hint) => ({ job: await contextJob(ctx, hint) }),
  steps: [
    {
      id: "query_attention",
      type: "query",
      label: { en: "Coordinator reads the job's authorized attention", es: "El coordinador lee la atención autorizada del trabajo" },
      run: async (rt) => {
        const { ctx } = rt
        const j = await authorizedJob(ctx, rt.state.params.job ?? null)
        if (!j) throw new DomainError("not_found", "Job not available")
        const inbox = await getInbox(ctx, { view: "all", job: j.id })
        const asOf = await assistantBusinessDate()
        const open = inbox.rows.filter((r) => !(r.source === "attention" && r.state === "resolved")).slice(0, 12)
        const base = `/a/${ctx.tenant.slug}`
        const jobHref = `${base}/jobs/${j.id}`
        const items = open.map((r) => ({
          key: r.key,
          source: r.source,
          title: typeof r.title === "string" ? { en: r.title, es: r.title } : r.title,
          severity: r.severity,
          state: r.state,
          href: r.href.startsWith(`${base}/`) ? r.href : jobHref,
          owner: r.ownerName,
        }))
        const recordType = { attention: "attention_item", approval: "approval_request", run: "workflow_run" } as const
        const refs: SourceRefView[] = [
          { recordType: "job", recordId: j.id, revision: j.revision, label: `${j.displayReference} · ${j.name}`, href: jobHref, asOf },
          ...open.map((r) => ({ recordType: recordType[r.source], recordId: r.id, revision: r.revision, label: pickL(typeof r.title === "string" ? { en: r.title, es: r.title } : r.title, ctx), href: r.href.startsWith(`${base}/`) ? r.href : jobHref, asOf })),
        ]
        const toolCall: ToolCallRecord = {
          callId: "query_attention",
          toolFamily: "query_records",
          skillId: "agency-orchestrator",
          handler: "getInbox",
          input: { view: "all", job: j.id },
          status: "succeeded",
          result: { items: items.map((i) => i.key) },
        }
        const parts: MessagePart[] = [
          { type: "attention_items", job: { id: j.id, name: j.name, displayReference: j.displayReference, href: jobHref }, asOf, items },
          text(items.length ? "assistant.attention.summary" : "assistant.attention.none", { job: j.name, count: items.length }),
          { type: "sources", refs },
        ]
        return { kind: "complete", parts, toolCall }
      },
    },
  ],
}

// ── 40–58 s · Explain the margin change and prepare the fee adjustment for review ──

/** Target fee of the scripted fee adjustment: the ERP-09 field default (fixture-aligned), never a number in copy. */
function scriptedFeeTarget(): string | null {
  const ex = INPUT_FIELDS["agency-fee-contracts"]?.find((f) => f.key === "newAgencyFee")?.example
  return typeof ex === "string" ? ex : null
}

async function delegateProfitability(rt: StepRuntime) {
  const outcome = await runCapability(rt.ctx, "agency-profitability", { job: rt.state.params.job!, basis: "forecast" }, { origin: "assistant_scripted", idempotencyKey: `assistant:${rt.runId}:profitability`, correlationId: rt.runId })
  const delegation: DelegationRecord = { subagentKey: "rentabilidad", skillIds: ["agency-profitability"], objective: "Compute forecast margin for the job in context", childWorkflowRunId: outcome.runId, state: outcome.state, result: outcome.output }
  const toolCall: ToolCallRecord = { callId: "delegate_profitability", toolFamily: "query_records", skillId: "agency-profitability", handler: "calculateJobProfitability", input: { job: rt.state.params.job, basis: "forecast" }, status: outcome.state === "succeeded" ? "succeeded" : "blocked", result: outcome.output ?? outcome.error }
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
    const code = outcome.error?.code ?? "blocked_by_rule"
    return { kind: "blocked" as const, code, parts: [...parts, { type: "blocked" as const, code, message: { en: outcome.error?.message ?? "Blocked", es: outcome.error?.message ?? "Bloqueado" }, details: ruleDetails(outcome.error?.details) }], delegation, toolCall }
  }
  return { kind: "continue" as const, parts, delegation, toolCall }
}

const presenterSuggestion = {
  presetId: "preset.presenter.scope_request",
  label: { en: "Load sample scope request", es: "Cargar solicitud de alcance de ejemplo" },
  description: { en: "Demo tools · Sample scope change (demo)", es: "Herramientas de demo · Cambio de alcance de ejemplo (demo)" },
  presenterOnly: true,
  group: null,
  scenarioId: "S-PRESENTER-SCOPE",
}

const marginChangeScenario: Scenario = {
  id: "S-MARGIN-CHANGE-FEE",
  version: "1.0.0",
  title: { en: "Explain the margin change and prepare the fee adjustment", es: "Explicar el cambio de margen y preparar el ajuste de honorarios" },
  skillIds: ["agency-orchestrator", "agency-profitability", "agency-fee-contracts"],
  aliases: {
    en: ["Explain the margin change and prepare the fee adjustment for review", "Explain the margin change and prepare the fee adjustment"],
    es: ["Explica el cambio de margen y prepara el ajuste de honorarios para revisión", "Explica el cambio de margen y prepara el ajuste de fee para revisión", "Explica el cambio de margen y prepara el ajuste de honorarios"],
  },
  presets: [
    {
      presetId: "preset.margin.change_fee",
      label: { en: "Explain the margin change and prepare the fee adjustment for review", es: "Explica el cambio de margen y prepara el ajuste de honorarios para revisión" },
      description: { en: "Forecast explanation with sources, then an ERP-09 proposal for approval", es: "Explicación proyectada con fuentes y una propuesta ERP-09 para aprobación" },
      featured: true,
      group: null,
      scenarioId: "S-MARGIN-CHANGE-FEE",
    },
  ],
  // Preparing the amendment is a budget proposal: checked before anything is prepared.
  requiredPermission: "budget.propose",
  readPermissions: ["workspace.view", "reports.view"],
  parameterSchema: z.object({ job: z.string().uuid() }).passthrough(),
  allowedContext: ["job"],
  init: async (ctx, hint) => {
    const job = await contextJob(ctx, hint)
    return { job, _contextJob: job }
  },
  steps: [
    {
      id: "delegate_profitability",
      type: "scripted_delegation",
      label: { en: "Profitability specialist computes the current forecast margin", es: "El especialista de rentabilidad calcula el margen proyectado vigente" },
      run: delegateProfitability,
    },
    {
      id: "explain_change",
      type: "show_result",
      label: { en: "Explain the change between estimate revisions", es: "Explicar el cambio entre revisiones de estimación" },
      run: async (rt) => {
        const { ctx } = rt
        const j = await authorizedJob(ctx, rt.state.params.job ?? null)
        if (!j) throw new DomainError("not_found", "Job not available")
        const fin = await withTenant(ctx.tenant.id, (tx) => loadJobFinancials(tx, ctx.tenant.id, j.id))
        const c = fin.job.currency
        const loc = ctx.user.locale
        const cur = fin.currentEstimate
        const prev = cur ? (fin.estimates.find((e) => e.id !== cur.id && e.number < cur.number) ?? null) : null
        const after = estimateTotals(fin, cur?.id ?? null)
        const before = prev ? estimateTotals(fin, prev.id) : null
        // No scope change on record yet: say so; the presenter can introduce it.
        if (!cur || !prev || !before || after.laborMinutes <= before.laborMinutes) {
          const parts: MessagePart[] = [text("assistant.marginChange.notLoaded", { job: j.name })]
          if (ctx.presenter) parts.push({ type: "suggestions", heading: { en: "Demo tools (presenter)", es: "Herramientas de demo (presentador)" }, items: [presenterSuggestion] })
          else parts.push(text("assistant.marginChange.askPresenter"))
          return { kind: "complete", parts }
        }
        const fee = fin.approvedBudget?.agencyFeeMinor ?? 0n
        const media = fin.approvedBudget?.managedMediaMinor ?? 0n
        const m0 = margin({ currency: c, agencyRevenueMinor: fee, agencyCostMinor: before.totalMinor, managedSpendMinor: media })
        const m1 = margin({ currency: c, agencyRevenueMinor: fee, agencyCostMinor: after.totalMinor, managedSpendMinor: media })
        const addedMinutes = after.laborMinutes - before.laborMinutes
        const addedCost = after.totalMinor - before.totalMinor
        const asOf = await assistantBusinessDate()
        const jobHref = `/a/${ctx.tenant.slug}/jobs/${j.id}`
        const refs: SourceRefView[] = [
          { recordType: "job", recordId: j.id, revision: j.revision, label: `${j.displayReference} · ${j.jobNumber}`, href: jobHref, asOf, basis: "forecast", currency: c },
          ...(fin.approvedBudget ? [{ recordType: "budget_revision", recordId: fin.approvedBudget.id, revision: fin.approvedBudget.number, label: `Budget r${fin.approvedBudget.number} (approved)`, href: `${jobHref}?tab=scope`, asOf, basis: "forecast", currency: c }] : []),
          { recordType: "cost_estimate", recordId: prev.id, revision: prev.number, label: `Cost estimate r${prev.number} (superseded)`, href: `${jobHref}?tab=production`, asOf, basis: "forecast", currency: c },
          { recordType: "cost_estimate", recordId: cur.id, revision: cur.number, label: `Cost estimate r${cur.number} (current)`, href: `${jobHref}?tab=production`, asOf, basis: "forecast", currency: c },
        ]
        const parts: MessagePart[] = [
          marginChangeView({
            skillId: "agency-profitability",
            job: { name: j.name, revision: j.revision },
            asOf,
            currency: c,
            before: { estimateNumber: prev.number, laborMinutes: before.laborMinutes, costMinor: before.totalMinor.toString(), marginMinor: m0.marginMinor.toString(), marginBps: m0.marginBps },
            after: { estimateNumber: cur.number, laborMinutes: after.laborMinutes, costMinor: after.totalMinor.toString(), marginMinor: m1.marginMinor.toString(), marginBps: m1.marginBps },
            floorBps: MARGIN_FLOOR_BPS,
            sources: refs,
          }),
          text("assistant.marginChange.explained", {
            job: j.name,
            hours: fmtMinutesAsHours(addedMinutes, loc),
            cost: fmtMoney(addedCost, c, loc),
            before: fmtPct(m0.marginBps, loc),
            after: fmtPct(m1.marginBps, loc),
            from: `r${prev.number}`,
            to: `r${cur.number}`,
          }),
          { type: "sources", refs },
        ]
        const target = scriptedFeeTarget()
        const targetMinor = target ? parseDecimalToMinor(target, c) : null
        if (targetMinor === null || fee >= targetMinor) {
          parts.push(text("assistant.marginChange.alreadyPriced", { job: j.name, fee: fmtMoney(fee, c, loc), margin: fmtPct(m1.marginBps, loc) }))
          return { kind: "complete", parts }
        }
        parts.push(text("assistant.marginChange.preparing", { delta: fmtMoney(targetMinor - fee, c, loc), fee: fmtMoney(targetMinor, c, loc) }))
        return {
          kind: "continue",
          parts,
          params: {
            newAgencyFee: minorToDecimalString(targetMinor, c),
            reason: `Price the ${addedMinutes / 60} additional hours of the scope change (${j.displayReference}, estimate r${prev.number} → r${cur.number})`,
          },
        }
      },
    },
    // Exactly ERP-09: check → clarify (pre-filled) → proposal → confirmation → specialist command → approval request.
    ...skillScenarioSteps("agency-fee-contracts"),
  ],
}

// ── Demo tools · Load sample scope request (presenter only) ──

const presenterScopeScenario: Scenario = {
  id: "S-PRESENTER-SCOPE",
  version: "1.0.0",
  title: { en: "Load sample scope request (demo tools)", es: "Cargar solicitud de alcance de ejemplo (herramientas de demo)" },
  skillIds: ["agency-orchestrator", "agency-production-estimating"],
  aliases: { en: ["Load sample scope request"], es: ["Cargar solicitud de alcance de ejemplo"] },
  presets: [{ ...presenterSuggestion, featured: true }],
  requiredPermission: "assistant.use",
  readPermissions: ["workspace.view"],
  parameterSchema: z.object({}).strict(),
  allowedContext: ["job", "module", "none"],
  init: async () => ({}),
  steps: [
    {
      id: "presenter_scope",
      type: "execute_command",
      label: { en: "Presenter introduces the sample scope change", es: "El presentador introduce el cambio de alcance de ejemplo" },
      run: async (rt) => {
        const { ctx } = rt
        // Throws forbidden unless this is the authorized presenter in demo mode.
        const res = await loadSampleScopeRequest(await presenterSessionFor(ctx))
        const loc = ctx.user.locale
        const href = `/a/${ctx.tenant.slug}/jobs/${res.jobId}`
        const toolCall: ToolCallRecord = { callId: "presenter_scope", toolFamily: "execute_approved_action", skillId: "agency-production-estimating", handler: "createProductionEstimate", input: { job: res.jobId }, status: "succeeded", result: res, commandId: res.runId }
        return {
          kind: "complete",
          toolCall,
          parts: [
            {
              type: "receipt",
              title: { en: "Sample scope change (demo)", es: "Cambio de alcance de ejemplo (demo)" },
              lines: [
                { label: { en: "Job", es: "Trabajo" }, value: res.jobLabel, href },
                { label: { en: "Labor in estimate", es: "Mano de obra en la estimación" }, value: `${fmtMinutesAsHours(res.laborMinutesBefore, loc)} → ${fmtMinutesAsHours(res.laborMinutesAfter, loc)}` },
                { label: { en: "Agency cost (forecast)", es: "Costo de agencia (proyectado)" }, value: `${fmtMoney(res.costBeforeMinor, res.currency, loc)} → ${fmtMoney(res.costAfterMinor, res.currency, loc)}` },
                { label: { en: "Projected margin now", es: "Margen proyectado ahora" }, value: fmtPct(res.marginBpsAfter, loc) },
              ],
              commandId: res.runId,
              replayed: res.state !== "loaded",
            },
            text(`assistant.presenterScope.${res.state}`),
          ],
        }
      },
    },
  ],
}

// ── attach_authorized_file: history record of an attached library file ──

export const ATTACH_SCENARIO_ID = "S-ATTACH-FILE"

const attachScenario: Scenario = {
  id: ATTACH_SCENARIO_ID,
  version: "1.0.0",
  title: { en: "Attach an authorized library file", es: "Adjuntar un archivo autorizado de la biblioteca" },
  skillIds: ["agency-orchestrator"],
  aliases: { en: [], es: [] },
  presets: [],
  requiredPermission: "files.read",
  readPermissions: ["files.read"],
  parameterSchema: z.object({ file: z.string().uuid() }).strict(),
  allowedContext: ["job", "module", "none"],
  init: async () => ({}),
  // Not started by a turn: the driver's attachFile tool records a completed run.
  steps: [],
}

export const INVESTOR_SCENARIOS: readonly Scenario[] = [attentionScenario, marginChangeScenario, presenterScopeScenario, attachScenario]
