"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { agencyContextForApi, getRequestSession } from "@/server/auth/request"
import { simulateDnsVerification, DOMAIN_STATES } from "@/server/domain/activation"
import { contrastRatio } from "@/server/domain/configuration"
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
