import type { z } from "zod"

import type { MessagePart, SuggestionView } from "@/lib/assistant/types"
import type { Permission } from "@/lib/policy"
import type { AgencyContext } from "@/server/auth/context"

// Scenario contract shared by the registry, the skill scenario factory and the
// driver. A scenario is versioned; a run stores scenario id + version and its
// checkpointed state, so a resumed run always continues the same script.

export type RunLease = { owner: string; until: string }

export type ScenarioState = {
  params: Record<string, string>
  results: Record<string, unknown>
  stepIndex: number
  proposalId?: string
  digest?: string
  delegations?: string[]
  /** Driver bookkeeping: compare-and-set revision of the run state. */
  rev?: number
  /** Driver bookkeeping: worker that may advance the run, until the lease expires. */
  lease?: RunLease | null
  /** Assistant message the current advance appends its parts to. */
  messageId?: string | null
}

export type StepRuntime = {
  ctx: AgencyContext
  runId: string
  conversationId: string
  state: ScenarioState
}

export type StepResult =
  | { kind: "continue"; parts?: MessagePart[]; save?: Record<string, unknown>; params?: Record<string, string> }
  | { kind: "wait_input"; parts: MessagePart[]; field: string }
  | { kind: "wait_confirmation"; parts: MessagePart[]; proposalId: string; digest: string }
  | { kind: "blocked"; parts: MessagePart[]; code: string }
  | { kind: "complete"; parts?: MessagePart[] }

export type DelegationRecord = {
  subagentKey: string
  skillIds: string[]
  objective: string
  childWorkflowRunId: string | null
  state: string
  result: unknown
}

export type ToolCallRecord = {
  callId: string
  toolFamily: string
  skillId: string | null
  handler: string
  input: unknown
  status: "succeeded" | "failed" | "blocked"
  result: unknown
  proposalId?: string | null
  commandId?: string | null
}

export type ScenarioStep = {
  id: string
  type:
    | "query"
    | "request_input"
    | "prepare_action"
    | "confirm"
    | "request_approval"
    | "scripted_delegation"
    | "execute_command"
    | "reconcile"
    | "show_result"
  label: { en: string; es: string }
  /** request_input: the scenario parameter this step fills. */
  field?: string
  run: (rt: StepRuntime) => Promise<StepResult & { delegation?: DelegationRecord; toolCall?: ToolCallRecord }>
  /** For request_input: turns the user's reply into a validated param. */
  acceptInput?: (rt: StepRuntime, text: string) => Promise<{ ok: true; value: string } | { ok: false; parts: MessagePart[] }>
}

export type Scenario = {
  id: string
  version: string
  title: { en: string; es: string }
  skillIds: string[]
  aliases: { en: string[]; es: string[] }
  presets: SuggestionView[]
  /** Checked before anything is prepared. */
  requiredPermission: Permission
  /** Re-checked when history is read: results stay hidden without them (B08). */
  readPermissions: Permission[]
  parameterSchema: z.ZodType
  allowedContext: ("job" | "module" | "none")[]
  /** Resolve start parameters from context and the matched alias. */
  init: (ctx: AgencyContext, hint: { recordJobId: string | null; text: string }) => Promise<Record<string, string>>
  steps: ScenarioStep[]
}

export const text = (template: string, params?: Record<string, string | number | null>): MessagePart => ({ type: "text", template, params })

export function normalizeAlias(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:'"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
