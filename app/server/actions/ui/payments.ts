"use server"

import { z } from "zod"

import { agencyContextForApi } from "@/server/auth/request"
import { toJsonSafe } from "@/server/kernel/commands"
import { previewPaymentRun } from "@/server/domain/payments"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

// Read-only preview of a payment run (eligible liabilities, holds and cash
// position) computed by the payments service. Nothing is reserved or paid.

const Input = z.object({ agencySlug: z.string().min(2).max(63), connection: z.string().uuid(), dueThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export async function previewPaymentRunAction(input: z.infer<typeof Input>): Promise<{ ok: true; data: Record<string, unknown> } | Failure> {
  try {
    const p = Input.parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    if (!ctx.permissions.has("payables.manage") && !ctx.permissions.has("payments.execute")) throw new DomainError("forbidden", "Your role cannot preview payment runs", { permission: "payables.manage" })
    const res = await previewPaymentRun(ctx, { connection: p.connection, dueThrough: p.dueThrough })
    return { ok: true, data: toJsonSafe(res) as Record<string, unknown> }
  } catch (e) {
    return toFailure(e)
  }
}
