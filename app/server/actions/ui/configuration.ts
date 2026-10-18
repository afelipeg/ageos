"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { agencyContextForApi } from "@/server/auth/request"
import { decideCapabilityChange, proposeCapabilityChange } from "@/server/domain/configuration"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

// Capability activation changes of an active agency: a new configuration
// revision awaiting an owner other than the requester (configuration service).

const Slug = z.string().min(2).max(63)
const Key = z.string().min(8).max(160)

export async function proposeCapabilityChangeAction(input: { agencySlug: string; enable: string[]; disable: string[]; reason: string; expectedRevision: number; idempotencyKey: string }): Promise<
  { ok: true; data: { revisionId: string; number: number } } | Failure
> {
  try {
    const p = z.object({ agencySlug: Slug, enable: z.array(z.string().max(80)).max(42), disable: z.array(z.string().max(80)).max(42), reason: z.string().max(500), expectedRevision: z.number().int().min(1), idempotencyKey: Key }).parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    const res = await proposeCapabilityChange(ctx, { enable: p.enable, disable: p.disable, reason: p.reason, idempotencyKey: p.idempotencyKey, expectedRevision: p.expectedRevision })
    revalidatePath(`/a/${ctx.tenant.slug}`, "layout")
    return { ok: true, data: { revisionId: res.result.revisionId, number: res.result.number } }
  } catch (e) {
    return toFailure(e)
  }
}

export async function decideCapabilityChangeAction(input: { agencySlug: string; revisionId: string; decision: "approve" | "reject"; reviewedDigest: string; reason?: string; idempotencyKey: string }): Promise<
  { ok: true; data: { outcome: string } } | Failure
> {
  try {
    const p = z.object({ agencySlug: Slug, revisionId: z.string().uuid(), decision: z.enum(["approve", "reject"]), reviewedDigest: z.string(), reason: z.string().max(500).optional(), idempotencyKey: Key }).parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    const res = await decideCapabilityChange(ctx, { revisionId: p.revisionId, decision: p.decision, reviewedDigest: p.reviewedDigest, reason: p.reason ?? null, idempotencyKey: p.idempotencyKey })
    revalidatePath(`/a/${ctx.tenant.slug}`, "layout")
    return { ok: true, data: { outcome: res.result.outcome } }
  } catch (e) {
    return toFailure(e)
  }
}
