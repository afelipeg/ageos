"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { agencyContextForApi } from "@/server/auth/request"
import { assignInboxItem, resolveInboxItem, snoozeInboxItem } from "@/server/domain/attention"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

// Inbox triage actions. Identity, tenant and role come from the session; the
// browser sends the item, the revision it saw and an idempotency key.

const Base = z.object({
  agencySlug: z.string().min(2).max(63),
  itemId: z.string().uuid(),
  revision: z.number().int().min(1),
  idempotencyKey: z.string().min(8).max(160),
})

type Done = { ok: true; data: { state: string; revision: number } } | Failure

async function run(
  input: z.infer<typeof Base>,
  def: typeof assignInboxItem | typeof snoozeInboxItem | typeof resolveInboxItem,
  payload: Record<string, unknown>
): Promise<Done> {
  const ctx = await agencyContextForApi(input.agencySlug)
  if (!ctx) throw new DomainError("not_found", "Agency not available")
  const res = await executeCommand(ctx, def as typeof assignInboxItem, {
    idempotencyKey: input.idempotencyKey,
    payload: { item: input.itemId, ...payload },
    origin: "ui",
    expectedRevision: input.revision,
  })
  revalidatePath(`/a/${ctx.tenant.slug}/inbox`)
  const r = res.result as { state: string; revision: number }
  return { ok: true, data: { state: r.state, revision: r.revision } }
}

export async function assignInboxItemAction(input: z.infer<typeof Base> & { assignee: string }): Promise<Done> {
  try {
    const p = Base.extend({ assignee: z.string().uuid() }).parse(input)
    return await run(p, assignInboxItem, { assignee: p.assignee })
  } catch (e) {
    return toFailure(e)
  }
}

export async function snoozeInboxItemAction(input: z.infer<typeof Base> & { until: string }): Promise<Done> {
  try {
    const p = Base.extend({ until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input)
    return await run(p, snoozeInboxItem, { until: p.until })
  } catch (e) {
    return toFailure(e)
  }
}

export async function resolveInboxItemAction(input: z.infer<typeof Base> & { note: string }): Promise<Done> {
  try {
    const p = Base.extend({ note: z.string().trim().min(3).max(500) }).parse(input)
    return await run(p, resolveInboxItem, { note: p.note })
  } catch (e) {
    return toFailure(e)
  }
}
