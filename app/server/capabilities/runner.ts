import "server-only"

import { and, eq } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { workflowRun, workflowRunStep } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { digestOf } from "@/server/kernel/approvals"
import { executeCommand, toJsonSafe, type CommandOrigin } from "@/server/kernel/commands"
import { DomainError, isDomainError } from "@/server/kernel/errors"

import { getCapability, HANDLER_VERSION, HANDLERS } from "./registry"

// Runs one capability for the workbench, Explore and the assistant's
// delegated specialists. Every run is persisted with its steps, so the Runs
// page and the assistant trace show what actually executed.
//
// Idempotency (B02/B03): authorization (view + execute + enabled capability)
// is checked on EVERY call, before any replay. The run is claimed atomically
// (INSERT … ON CONFLICT DO NOTHING) and bound to a digest of skill + input +
// expectedRevision + actor. Same key + same request → the same run and result;
// same key + anything different → idempotency_conflict, nothing written.

export type RunOutcome = {
  runId: string
  skillId: string
  state: "succeeded" | "blocked" | "failed"
  output: unknown
  error: { code: string; message: string; details: Record<string, unknown> } | null
  replayed: boolean
}

const BLOCKED_CODES = new Set([
  "forbidden",
  "validation",
  "revision_conflict",
  "idempotency_conflict",
  "blocked_by_rule",
  "approval_required",
  "approval_stale",
  "self_approval",
  "approver_not_eligible",
  "capability_disabled",
  "insufficient_funds",
  "client_authority_missing",
  "connection_revoked",
  "not_found",
])

type RunRow = typeof workflowRun.$inferSelect

function storedOutcome(row: RunRow, skillId: string): RunOutcome {
  const out = row.output as { result?: unknown; error?: RunOutcome["error"] } | null
  return {
    runId: row.id,
    skillId,
    state: row.state as RunOutcome["state"],
    output: out?.result ?? null,
    error: out?.error ?? null,
    replayed: true,
  }
}

export async function runCapability(
  ctx: AgencyContext,
  skillId: string,
  input: Record<string, unknown>,
  opts: { origin: CommandOrigin; idempotencyKey: string; expectedRevision?: number; correlationId?: string }
): Promise<RunOutcome> {
  const cap = getCapability(skillId)
  if (!cap) throw new DomainError("not_found", "Unknown capability")
  if (!ctx.permissions.has(cap.governance.viewPermission)) {
    throw new DomainError("forbidden", "Your role cannot open this capability", { permission: cap.governance.viewPermission })
  }
  if (!cap.governance.mandatory && !ctx.enabledCapabilities.has(skillId)) {
    throw new DomainError("capability_disabled", `${skillId} is disabled for this agency`, { skillId })
  }
  const handler = HANDLERS[skillId]
  if (!handler) {
    throw new DomainError("capability_pending", "This capability is registered; its handler is scheduled for instruction 2", {
      skillId,
      status: "registered",
    })
  }
  if (!ctx.permissions.has(cap.governance.executePermission)) {
    throw new DomainError("forbidden", "Your role cannot run this capability", { permission: cap.governance.executePermission })
  }

  const requestDigest = digestOf({
    skillId,
    input,
    expectedRevision: opts.expectedRevision ?? null,
    actorUserId: ctx.user.id,
  })
  const jobId = typeof input.job === "string" && /^[0-9a-f-]{36}$/i.test(input.job) ? input.job : null

  // Atomic claim: exactly one caller inserts the run; any other caller with
  // the same key waits for that insert to commit and then reads the winner.
  const claim = await withTenant(ctx.tenant.id, async (tx) => {
    const [inserted] = await tx
      .insert(workflowRun)
      .values({
        tenantId: ctx.tenant.id,
        skillId,
        handlerVersion: HANDLER_VERSION,
        jobId,
        state: "executing",
        input: toJsonSafe(input) as object,
        origin: opts.origin,
        actorUserId: ctx.user.id,
        idempotencyKey: opts.idempotencyKey,
        requestDigest,
      })
      .onConflictDoNothing({ target: [workflowRun.tenantId, workflowRun.skillId, workflowRun.idempotencyKey] })
      .returning()
    if (inserted) return { run: inserted, won: true }
    const [existing] = await tx
      .select()
      .from(workflowRun)
      .where(
        and(
          eq(workflowRun.tenantId, ctx.tenant.id),
          eq(workflowRun.skillId, skillId),
          eq(workflowRun.idempotencyKey, opts.idempotencyKey)
        )
      )
      .limit(1)
    return { run: existing!, won: false }
  })

  if (!claim.won) {
    if (claim.run.requestDigest !== requestDigest) {
      throw new DomainError("idempotency_conflict", "This idempotency key was already used for a different request", {
        skillId,
        runId: claim.run.id,
      })
    }
    if (claim.run.state !== "executing") return storedOutcome(claim.run, skillId)
    // The same request is still executing (or its process stopped): continue
    // through the command bus with the same key, which replays a committed
    // command instead of executing it twice.
  }
  const run = claim.run

  const steps: { key: string; state: string; detail: Record<string, unknown> }[] = [
    { key: "authorize", state: "succeeded", detail: { role: ctx.role, permission: cap.governance.executePermission } },
  ]
  let outcome: RunOutcome
  try {
    let result: unknown
    if (handler.kind === "command") {
      const res = await executeCommand(ctx, handler.command, {
        idempotencyKey: `${skillId}:${opts.idempotencyKey}`,
        payload: input,
        origin: opts.origin,
        expectedRevision: opts.expectedRevision,
        correlationId: opts.correlationId ?? run.id,
      })
      steps.push({ key: "validate", state: "succeeded", detail: {} })
      steps.push({ key: "execute_command", state: "succeeded", detail: { commandType: res.commandType, commandId: res.commandId, replayed: res.replayed } })
      result = res.result
    } else {
      const parsed = handler.input.safeParse(input)
      if (!parsed.success) {
        throw new DomainError("validation", "Invalid input", {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        })
      }
      steps.push({ key: "validate", state: "succeeded", detail: {} })
      result = toJsonSafe(await handler.run(ctx, parsed.data as never))
      steps.push({ key: "run_query", state: "succeeded", detail: { handler: skillId } })
    }
    steps.push({ key: "persist_output", state: "succeeded", detail: {} })
    outcome = { runId: run.id, skillId, state: "succeeded", output: result, error: null, replayed: !claim.won }
  } catch (e) {
    const err = isDomainError(e)
      ? e.toJSON()
      : { code: "internal", message: "Unexpected error", details: {} as Record<string, unknown> }
    if (!isDomainError(e)) console.error("[ageos] capability run failed", skillId, e)
    const blocked = BLOCKED_CODES.has(err.code)
    steps.push({ key: "execute", state: blocked ? "blocked" : "failed", detail: { code: err.code, details: err.details } })
    outcome = { runId: run.id, skillId, state: blocked ? "blocked" : "failed", output: null, error: err, replayed: !claim.won }
  }

  // Compare-and-set: only the first finisher records steps and the outcome.
  const finalRow = await withTenant(ctx.tenant.id, async (tx) => {
    const [updated] = await tx
      .update(workflowRun)
      .set({
        state: outcome.state,
        output: toJsonSafe({ result: outcome.output, error: outcome.error }) as object,
        finishedAt: new Date(),
      })
      .where(and(eq(workflowRun.tenantId, ctx.tenant.id), eq(workflowRun.id, run.id), eq(workflowRun.state, "executing")))
      .returning()
    if (updated) {
      await tx
        .insert(workflowRunStep)
        .values(
          steps.map((s, i) => ({
            tenantId: ctx.tenant.id,
            runId: run.id,
            seq: i + 1,
            stepKey: s.key,
            state: s.state,
            detail: toJsonSafe(s.detail) as object,
            finishedAt: new Date(),
          }))
        )
        .onConflictDoNothing()
      return null
    }
    const [current] = await tx.select().from(workflowRun).where(and(eq(workflowRun.tenantId, ctx.tenant.id), eq(workflowRun.id, run.id))).limit(1)
    return current ?? null
  })
  // Another caller finished first: answer with what was recorded.
  return finalRow ? storedOutcome(finalRow, skillId) : outcome
}
