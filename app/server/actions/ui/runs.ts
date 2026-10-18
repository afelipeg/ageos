"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { agencyContextForApi } from "@/server/auth/request"
import { HANDLERS } from "@/server/capabilities/registry"
import { runCapability } from "@/server/capabilities/runner"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"
import { getRunDetail } from "@/server/queries/runs"

// "Retry safe step": only read-only (query) capabilities are re-run, with the
// exact persisted input and a new idempotency key. Commands are never retried
// blindly from here; they go back through their workbench and validation.

const Input = z.object({
  agencySlug: z.string().min(2).max(63),
  runId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(160),
})

export async function retrySafeRunAction(input: z.infer<typeof Input>): Promise<{ ok: true; data: { runId: string; state: string } } | Failure> {
  try {
    const p = Input.parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    const detail = await getRunDetail(ctx, p.runId)
    if (!detail) throw new DomainError("not_found", "Run not found")
    const handler = HANDLERS[detail.run.skillId]
    if (!handler || handler.kind !== "query") {
      throw new DomainError("blocked_by_rule", "Only read-only runs can be retried from the run page", { rule: "retry_read_only_only" })
    }
    const outcome = await runCapability(ctx, detail.run.skillId, detail.run.input, { origin: "ui", idempotencyKey: `retry:${p.runId}:${p.idempotencyKey}` })
    revalidatePath(`/a/${ctx.tenant.slug}/runs`)
    return { ok: true, data: { runId: outcome.runId, state: outcome.state } }
  } catch (e) {
    return toFailure(e)
  }
}
