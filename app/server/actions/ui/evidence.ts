"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { agencyContextForApi } from "@/server/auth/request"
import { reviewEvidence } from "@/server/domain/evidence"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

// Evidence review (J04): reviewed / rejected with a reason, through the
// evidence command (approvals.decide; the submitter can never review).

const Input = z.object({
  agencySlug: z.string().min(2).max(63),
  evidenceId: z.string().uuid(),
  decision: z.enum(["reviewed", "rejected"]),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(160),
})

export async function reviewEvidenceAction(input: z.infer<typeof Input>): Promise<{ ok: true; data: { reviewState: string; staleApprovals: number } } | Failure> {
  try {
    const p = Input.parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    const res = await executeCommand(ctx, reviewEvidence, {
      idempotencyKey: p.idempotencyKey,
      origin: "ui",
      payload: { evidence: p.evidenceId, decision: p.decision, reason: p.reason },
    })
    revalidatePath(`/a/${ctx.tenant.slug}`, "layout")
    const r = res.result as { reviewState: string; staleApprovals: number }
    return { ok: true, data: { reviewState: r.reviewState, staleApprovals: r.staleApprovals } }
  } catch (e) {
    return toFailure(e)
  }
}
