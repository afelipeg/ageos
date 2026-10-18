"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { agencyContextForApi, getRequestSession } from "@/server/auth/request"
import { simulateDnsVerification, DOMAIN_STATES } from "@/server/domain/activation"
import { contrastRatio, decideCapabilityChange, proposeBrandChange, proposePlanChange } from "@/server/domain/configuration"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

// Settings actions. Brand preview is validated on the server with the same
// contrast rule the configuration service enforces on publish; the domain
// simulation advances one fixture state through the activation service.

const Slug = z.string().min(2).max(63)

export async function previewBrandAction(input: { agencySlug: string; accent: string; logoText: string }): Promise<
  { ok: true; data: { accent: string; logoText: string; contrast: number; passes: boolean; issues: string[] } } | Failure
> {
  try {
    const p = z.object({ agencySlug: Slug, accent: z.string().max(20), logoText: z.string().max(10) }).parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    const issues: string[] = []
    const accent = p.accent.trim().toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(accent)) issues.push("accent_format")
    if (!/^[A-Z0-9]{1,3}$/.test(p.logoText.trim())) issues.push("logo_text_format")
    const contrast = issues.includes("accent_format") ? 0 : Math.round(contrastRatio(accent, "#ffffff") * 100) / 100
    if (!issues.includes("accent_format") && contrast < 4.5) issues.push("contrast_below_4_5")
    return { ok: true, data: { accent, logoText: p.logoText.trim(), contrast, passes: issues.length === 0, issues } }
  } catch (e) {
    return toFailure(e)
  }
}

export async function simulateDnsAction(input: { agencySlug: string; expectedState: string }): Promise<{ ok: true; data: { state: string; previous: string } } | Failure> {
  try {
    const p = z.object({ agencySlug: Slug, expectedState: z.enum(DOMAIN_STATES) }).parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    const session = await getRequestSession()
    if (!ctx || !session) throw new DomainError("not_found", "Agency not available")
    const res = await simulateDnsVerification(session, ctx.tenant.id, p.expectedState)
    revalidatePath(`/a/${ctx.tenant.slug}/settings/domains`)
    return { ok: true, data: { state: res.state, previous: res.previous } }
  } catch (e) {
    return toFailure(e)
  }
}

// Brand and demo plan changes of an active agency: each creates a
// configuration revision awaiting approval by an owner other than the
// proposer; the decision publishes exactly the reviewed digest.

type Proposed = { ok: true; data: { revisionId: string; number: number; state: string; payloadDigest: string } } | Failure

const Change = z.object({ agencySlug: Slug, reason: z.string().trim().min(3).max(500), expectedRevision: z.number().int().min(1), idempotencyKey: z.string().min(8).max(160) })

export async function proposeBrandChangeAction(input: { agencySlug: string; accent: string; logoText: string; reason: string; expectedRevision: number; idempotencyKey: string }): Promise<Proposed> {
  try {
    const p = Change.extend({ accent: z.string().max(20), logoText: z.string().max(10) }).parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    const res = await proposeBrandChange(ctx, { accent: p.accent.trim(), logoText: p.logoText.trim(), reason: p.reason, idempotencyKey: p.idempotencyKey, expectedRevision: p.expectedRevision })
    revalidatePath(`/a/${ctx.tenant.slug}/settings/brand`)
    return { ok: true, data: res.result }
  } catch (e) {
    return toFailure(e)
  }
}

export async function proposePlanChangeAction(input: { agencySlug: string; plan: string; reason: string; expectedRevision: number; idempotencyKey: string }): Promise<Proposed> {
  try {
    const p = Change.extend({ plan: z.string().max(40) }).parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    const res = await proposePlanChange(ctx, { plan: p.plan, reason: p.reason, idempotencyKey: p.idempotencyKey, expectedRevision: p.expectedRevision })
    revalidatePath(`/a/${ctx.tenant.slug}/settings/plan`)
    return { ok: true, data: res.result }
  } catch (e) {
    return toFailure(e)
  }
}

export async function decideSettingsChangeAction(input: { agencySlug: string; revisionId: string; decision: "approve" | "reject"; reviewedDigest: string; reason?: string; idempotencyKey: string }): Promise<
  { ok: true; data: { outcome: string; published: boolean } } | Failure
> {
  try {
    const p = z
      .object({ agencySlug: Slug, revisionId: z.string().uuid(), decision: z.enum(["approve", "reject"]), reviewedDigest: z.string().regex(/^[0-9a-f]{64}$/), reason: z.string().trim().max(500).optional(), idempotencyKey: z.string().min(8).max(160) })
      .parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    const res = await decideCapabilityChange(ctx, { revisionId: p.revisionId, decision: p.decision, reviewedDigest: p.reviewedDigest, reason: p.reason ?? null, idempotencyKey: p.idempotencyKey })
    revalidatePath(`/a/${ctx.tenant.slug}`, "layout")
    return { ok: true, data: res.result }
  } catch (e) {
    return toFailure(e)
  }
}
