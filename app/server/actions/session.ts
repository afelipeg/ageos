"use server"

import { eq } from "drizzle-orm"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/translate"
import { fixtureUuid } from "@/lib/fixture-ids"
import { getRequestSession, sessionCookieOptions } from "@/server/auth/request"
import {
  accessCodeMatches,
  auditPlatform,
  createSession,
  revokeSession,
  SESSION_COOKIE,
} from "@/server/auth/session"
import { db } from "@/server/db/client"
import { appUser } from "@/server/db/schema"
import {
  advanceBusinessClock,
  loadCheckpoint,
  resetDemoTenant,
  switchPersona,
  type DemoClock,
  type ResetResult,
} from "@/server/domain/presenter"
import { isDemoMode } from "@/server/env"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"
import type { SeedMode } from "@/server/seed/demo-seed"

export type SignInState = { error: "invalid" | "disabled" | null }

const NextPath = z
  .string()
  .regex(/^\/(?!\/)[A-Za-z0-9/_\-?=&.%]*$/)
  .max(300)

/** Presenter sign-in: a server-held access code opens a session as the
 *  synthetic agency owner. It never accepts a role or user from the form. */
export async function signInWithAccessCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  if (!isDemoMode()) return { error: "disabled" }
  const code = String(form.get("accessCode") ?? "")
  if (!code || !accessCodeMatches(code)) {
    await auditPlatform({ eventType: "auth.sign_in_failed", actorUserId: null })
    await new Promise((r) => setTimeout(r, 400)) // dampen brute force
    return { error: "invalid" }
  }
  const presenter = fixtureUuid("user_demo_owner")
  const { token, expiresAt } = await createSession({ userId: presenter, presenterUserId: presenter })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt))
  await auditPlatform({ eventType: "auth.presenter_signed_in", actorUserId: presenter })
  const next = NextPath.safeParse(form.get("next"))
  redirect(next.success ? next.data : "/a/rayo-de-sol")
}

export async function signOut() {
  const session = await getRequestSession()
  if (session) {
    await revokeSession(session.sessionId)
    await auditPlatform({ eventType: "auth.signed_out", actorUserId: session.user.id })
  }
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  redirect("/")
}

/** Language change keeps URL and state: the client refreshes server data. */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return
  const jar = await cookies()
  jar.set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 })
  const session = await getRequestSession()
  if (session) await db().update(appUser).set({ locale }).where(eq(appUser.id, session.user.id))
}

// ── Presenter tools (server-authorized; see server/domain/presenter.ts) ──

/**
 * Switches the presenter to a synthetic persona: rotates the session cookie
 * (old session revoked), audits, and redirects to the persona's home
 * (/a/rayo-de-sol, /a/norte-studio or /ops). Non-presenter sessions get a Failure.
 */
export async function switchPersonaAction(personaKey: string): Promise<Failure | void> {
  const session = await getRequestSession()
  if (!session) redirect("/sign-in")
  let home: string
  try {
    const res = await switchPersona(session, personaKey)
    const jar = await cookies()
    jar.set(SESSION_COOKIE, res.token, sessionCookieOptions(res.expiresAt))
    home = res.persona.home
  } catch (e) {
    return toFailure(e)
  }
  redirect(home)
}

/** Resets the demo run of a demo tenant. `confirm` must equal `tenantSlug`. */
export async function resetDemoTenantAction(
  tenantSlug: string,
  confirm: string,
  checkpoint?: SeedMode
): Promise<{ ok: true; result: ResetResult } | Failure> {
  const session = await getRequestSession()
  if (!session) return toFailure(new DomainError("unauthenticated", "Sign in first"))
  try {
    return { ok: true, result: await resetDemoTenant(session, tenantSlug, { confirm, checkpoint }) }
  } catch (e) {
    return toFailure(e)
  }
}

/** Loads `from_intake` or `ready_for_scope_review`. `confirm` must equal the checkpoint id. */
export async function loadCheckpointAction(checkpoint: SeedMode, confirm: string): Promise<{ ok: true; result: ResetResult } | Failure> {
  const session = await getRequestSession()
  if (!session) return toFailure(new DomainError("unauthenticated", "Sign in first"))
  try {
    return { ok: true, result: await loadCheckpoint(session, checkpoint, { confirm }) }
  } catch (e) {
    return toFailure(e)
  }
}

/** Presenter-authorized, audited advance of the fixed business clock. */
export async function advanceBusinessClockAction(input: {
  days: number
  reason: string
  expectedBusinessDate: string
}): Promise<{ ok: true; clock: DemoClock } | Failure> {
  const session = await getRequestSession()
  if (!session) return toFailure(new DomainError("unauthenticated", "Sign in first"))
  try {
    return { ok: true, clock: await advanceBusinessClock(session, input) }
  } catch (e) {
    return toFailure(e)
  }
}
