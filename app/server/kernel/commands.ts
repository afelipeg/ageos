import "server-only"

import { and, eq } from "drizzle-orm"
import { z } from "zod"

import type { Permission } from "@/lib/policy"
import type { AgencyContext } from "@/server/auth/context"
import { payloadDigest } from "@/server/calculators"
import type { Tx } from "@/server/db/client"
import { businessEvent, idempotencyRecord } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

import { DomainError } from "./errors"

// Shared command bus. Screens, the scripted assistant and its delegated
// specialists all execute business mutations through `executeCommand`:
//   authenticate (ctx) → authorize → validate → capability check →
//   transaction { idempotency → handler (expected revision, rules) → events } →
//   persisted response.
// Identity fields in payloads are ignored: actor and tenant come from ctx.

export type CommandOrigin = "ui" | "assistant_scripted" | "seed" | "system" | "presenter"

export type CommandMeta = {
  commandId: string
  origin: CommandOrigin
  correlationId?: string
  reason?: string
  expectedRevision?: number
}

export type EmittedEvent = {
  eventType: string
  aggregateType: string
  aggregateId: string | null
  aggregateRevision?: number | null
  jobId?: string | null
  payload?: Record<string, unknown>
  businessEffectiveAt?: Date | null
}

export type HandlerResult<R> = { result: R; events: EmittedEvent[] }

export type CommandDefinition<I extends z.ZodType, R> = {
  type: string
  /** Capability this command implements (null for platform/kernel commands). */
  skillId: string | null
  permission: Permission
  input: I
  handler: (
    tx: Tx,
    ctx: AgencyContext,
    input: z.infer<I>,
    meta: CommandMeta
  ) => Promise<HandlerResult<R>>
}

type AnyHandler<I extends z.ZodType> = (
  tx: Tx,
  ctx: AgencyContext,
  input: z.infer<I>,
  meta: CommandMeta
) => Promise<{ result: unknown; events: EmittedEvent[] }>

/** Infers the result as the union of every return path of the handler. */
export function defineCommand<I extends z.ZodType, H extends AnyHandler<I>>(def: {
  type: string
  skillId: string | null
  permission: Permission
  input: I
  handler: H
}): CommandDefinition<I, Awaited<ReturnType<H>>["result"]> {
  return def as unknown as CommandDefinition<I, Awaited<ReturnType<H>>["result"]>
}

export type CommandEnvelope = {
  idempotencyKey: string
  payload: unknown
  origin: CommandOrigin
  expectedRevision?: number
  reason?: string
  correlationId?: string
}

export type CommandResponse<R> = {
  commandId: string
  commandType: string
  replayed: boolean
  result: R
}

const IdempotencyKey = z.string().min(8).max(200).regex(/^[A-Za-z0-9_.:-]+$/)

/** JSON-safe clone that turns bigint into strings for persistence/transport. */
export function toJsonSafe<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  )
}

export async function executeCommand<I extends z.ZodType, R>(
  ctx: AgencyContext,
  def: CommandDefinition<I, R>,
  envelope: CommandEnvelope
): Promise<CommandResponse<R>> {
  if (!ctx.permissions.has(def.permission)) {
    throw new DomainError("forbidden", `Role ${ctx.role} cannot run ${def.type}`, {
      permission: def.permission,
      commandType: def.type,
    })
  }
  if (def.skillId && !ctx.enabledCapabilities.has(def.skillId)) {
    throw new DomainError("capability_disabled", `${def.skillId} is not enabled`, {
      skillId: def.skillId,
    })
  }
  const keyCheck = IdempotencyKey.safeParse(envelope.idempotencyKey)
  if (!keyCheck.success) {
    throw new DomainError("validation", "Invalid idempotency key", { field: "idempotencyKey" })
  }
  const parsed = def.input.safeParse(envelope.payload)
  if (!parsed.success) {
    throw new DomainError("validation", "Invalid command input", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    })
  }

  // The key is bound to the exact request AND the actor: another user reusing
  // a key gets a conflict, never someone else's stored result.
  const requestDigest = payloadDigest(
    toJsonSafe({
      payload: parsed.data,
      expectedRevision: envelope.expectedRevision ?? null,
      actorUserId: ctx.user.id,
    })
  ).sha256

  return withTenant(ctx.tenant.id, async (tx) => {
    // Unique (tenant, command_type, key): a concurrent duplicate blocks on the
    // insert below until this transaction resolves, then replays.
    const existing = await tx
      .select()
      .from(idempotencyRecord)
      .where(
        and(
          eq(idempotencyRecord.tenantId, ctx.tenant.id),
          eq(idempotencyRecord.commandType, def.type),
          eq(idempotencyRecord.idempotencyKey, envelope.idempotencyKey)
        )
      )
      .limit(1)
    if (existing[0]) return replay<R>(existing[0], requestDigest, def.type)

    const commandId = crypto.randomUUID()
    const meta: CommandMeta = {
      commandId,
      origin: envelope.origin,
      correlationId: envelope.correlationId,
      reason: envelope.reason,
      expectedRevision: envelope.expectedRevision,
    }

    const inserted = await tx
      .insert(idempotencyRecord)
      .values({
        tenantId: ctx.tenant.id,
        commandType: def.type,
        idempotencyKey: envelope.idempotencyKey,
        requestDigest,
        status: "in_progress",
        response: {},
        actorUserId: ctx.user.id,
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyRecord.id })
    if (!inserted[0]) {
      const again = await tx
        .select()
        .from(idempotencyRecord)
        .where(
          and(
            eq(idempotencyRecord.tenantId, ctx.tenant.id),
            eq(idempotencyRecord.commandType, def.type),
            eq(idempotencyRecord.idempotencyKey, envelope.idempotencyKey)
          )
        )
        .limit(1)
      return replay<R>(again[0]!, requestDigest, def.type)
    }

    const { result, events } = await def.handler(tx, ctx, parsed.data, meta)

    if (events.length) {
      await tx.insert(businessEvent).values(
        events.map((e) => ({
          tenantId: ctx.tenant.id,
          eventType: e.eventType,
          aggregateType: e.aggregateType,
          aggregateId: e.aggregateId,
          aggregateRevision: e.aggregateRevision ?? null,
          actorUserId: ctx.user.id,
          origin: envelope.origin,
          commandType: def.type,
          commandId,
          correlationId: envelope.correlationId ?? null,
          jobId: e.jobId ?? null,
          payload: (toJsonSafe(e.payload ?? {}) as Record<string, unknown>) ?? {},
          businessEffectiveAt: e.businessEffectiveAt ?? null,
        }))
      )
    }

    // Fresh and replayed responses share the same JSON-safe shape (bigint →
    // decimal string), so a retry is indistinguishable from the first answer.
    const response = toJsonSafe({
      commandId,
      commandType: def.type,
      replayed: false,
      result,
    }) as CommandResponse<R>
    await tx
      .update(idempotencyRecord)
      .set({ status: "completed", response: response as object })
      .where(eq(idempotencyRecord.id, inserted[0].id))
    return response
  })
}

function replay<R>(
  record: typeof idempotencyRecord.$inferSelect,
  requestDigest: string,
  commandType: string
): CommandResponse<R> {
  if (record.requestDigest !== requestDigest) {
    throw new DomainError(
      "idempotency_conflict",
      "The idempotency key was already used with a different payload",
      { commandType }
    )
  }
  const stored = record.response as CommandResponse<R>
  return { ...stored, replayed: true }
}

/** Optimistic concurrency guard for handlers. */
export function assertRevision(current: number, expected: number | undefined, aggregate: string) {
  if (expected === undefined) {
    throw new DomainError("validation", "expectedRevision is required", { aggregate })
  }
  if (current !== expected) {
    throw new DomainError("revision_conflict", "This record changed", {
      aggregate,
      expectedRevision: expected,
      currentRevision: current,
    })
  }
}
