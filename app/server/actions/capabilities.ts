"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { agencyContextForApi } from "@/server/auth/request"
import { runCapability, type RunOutcome } from "@/server/capabilities/runner"
import { decideApprovalCommand, executeApprovedCommand } from "@/server/domain/approvals"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

// Server actions used by the shared workbench and approval screens. Identity,
// tenant and role are resolved from the session cookie on every call; the
// browser only supplies the payload, an idempotency key and the revision it saw.

const Common = z.object({
  agencySlug: z.string().min(2).max(63),
  idempotencyKey: z.string().min(8).max(160),
})

export type ActionResult<T> = { ok: true; data: T } | Failure

async function ctxOrThrow(slug: string) {
  const ctx = await agencyContextForApi(slug)
  if (!ctx) throw new DomainError("not_found", "Agency not available")
  return ctx
}

export async function runCapabilityAction(input: {
  agencySlug: string
  skillId: string
  payload: Record<string, unknown>
  idempotencyKey: string
  expectedRevision?: number
}): Promise<ActionResult<RunOutcome>> {
  try {
    const base = Common.extend({
      skillId: z.string().regex(/^agency-[a-z-]+$/),
      payload: z.record(z.string(), z.unknown()),
      expectedRevision: z.number().int().positive().optional(),
    }).parse(input)
    const ctx = await ctxOrThrow(base.agencySlug)
    const outcome = await runCapability(ctx, base.skillId, base.payload, {
      origin: "ui",
      idempotencyKey: base.idempotencyKey,
      expectedRevision: base.expectedRevision,
    })
    revalidatePath(`/a/${ctx.tenant.slug}`, "layout")
    return { ok: true, data: outcome }
  } catch (e) {
    return toFailure(e)
  }
}

export async function decideApprovalAction(input: {
  agencySlug: string
  approvalId: string
  decision: "approve" | "reject" | "request_changes"
  reason?: string
  reviewedDigest: string
  idempotencyKey: string
}): Promise<ActionResult<unknown>> {
  try {
    const base = Common.parse(input)
    const ctx = await ctxOrThrow(base.agencySlug)
    const res = await executeCommand(ctx, decideApprovalCommand, {
      idempotencyKey: base.idempotencyKey,
      origin: "ui",
      payload: {
        approvalId: input.approvalId,
        decision: input.decision,
        reason: input.reason ?? null,
        reviewedDigest: input.reviewedDigest,
      },
    })
    revalidatePath(`/a/${ctx.tenant.slug}`, "layout")
    return { ok: true, data: res.result }
  } catch (e) {
    return toFailure(e)
  }
}

export async function executeApprovedAction(input: {
  agencySlug: string
  approvalId: string
  idempotencyKey: string
}): Promise<ActionResult<unknown>> {
  try {
    const base = Common.parse(input)
    const ctx = await ctxOrThrow(base.agencySlug)
    const res = await executeCommand(ctx, executeApprovedCommand, {
      idempotencyKey: base.idempotencyKey,
      origin: "ui",
      payload: { approvalId: input.approvalId },
    })
    revalidatePath(`/a/${ctx.tenant.slug}`, "layout")
    return { ok: true, data: res.result }
  } catch (e) {
    return toFailure(e)
  }
}
