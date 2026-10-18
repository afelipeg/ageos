import type { z } from "zod"

import type { Permission } from "@/lib/policy"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import type { EmittedEvent } from "@/server/kernel/commands"
import type { CommandDefinition } from "@/server/kernel/commands"
import type { DomainErrorCode } from "@/server/kernel/errors"

// Shared contract for capability handlers and their acceptance fixtures.
// Each module file under ./handlers exports one ModuleCapabilities object.

export type CommandHandler = {
  kind: "command"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  command: CommandDefinition<any, any>
  /** Which input field holds the aggregate whose revision the user saw. */
  revisionOf?: "job"
}

export type QueryHandler = {
  kind: "query"
  input: z.ZodType
  run: (ctx: AgencyContext, input: never) => Promise<unknown>
}

export type CapabilityHandler = CommandHandler | QueryHandler

/**
 * Deterministic acceptance fixtures (ERP-01..ERP-42). `positive` must succeed
 * and persist its output; `negative` must be blocked by the named rule with no
 * forbidden side effect. Builders read current tenant state (never hardcoded
 * ids from another tenant) and may prepare preconditions only through domain
 * commands. `actorKey` is the demo persona that runs the case.
 */
export type CapabilityFixture = {
  positive: (ctx: (actorKey: string) => Promise<AgencyContext>) => Promise<{
    actorKey: string
    input: Record<string, unknown>
    expectedRevision?: number
    /** Assertion on the persisted output (throws on mismatch). */
    verify?: (output: unknown, ctx: AgencyContext) => Promise<void>
  }>
  negative: (ctx: (actorKey: string) => Promise<AgencyContext>) => Promise<{
    actorKey: string
    input: Record<string, unknown>
    expectedRevision?: number
    expectCode: DomainErrorCode
    /** Business rule id or reason expected in error details, when applicable. */
    expectRule?: string
  }>
}

/**
 * Applies an approved proposal of `actionType` (approval executor). `check`
 * evaluates current preconditions without side effects; `apply` mutates inside
 * the approval transaction. `skillId` is re-checked as enabled before consuming.
 */
export type ApprovalExecutor = {
  permission: Permission
  skillId: string | null
  run: (
    tx: Tx,
    ctx: AgencyContext,
    payload: Record<string, unknown>,
    mode: "check" | "apply"
  ) => Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }>
  /**
   * Optional side effect of a REJECT decision (e.g. mark the timesheet or rate
   * card rejected with the reason). Runs inside the decision transaction;
   * must be idempotent (a no-op when the aggregate is no longer pending).
   */
  reject?: (tx: Tx, ctx: AgencyContext, payload: Record<string, unknown>, reason: string) => Promise<{ events: EmittedEvent[] }>
}

export type ModuleCapabilities = {
  handlers: Record<string, CapabilityHandler>
  fixtures: Record<string, CapabilityFixture>
  executors?: Record<string, ApprovalExecutor>
}
