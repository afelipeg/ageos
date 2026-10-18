import "server-only"

import { cache } from "react"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { env } from "@/server/env"

import { resolveAgencyContext, type AgencyContext } from "./context"
import { isPlatformSession, loadSession, SESSION_COOKIE, type SessionInfo } from "./session"

// Request-scoped helpers for Server Components, Server Actions and Route
// Handlers. Cached per request so a page and its layout share one lookup.

export const getRequestSession = cache(async (): Promise<SessionInfo | null> => {
  const jar = await cookies()
  return loadSession(jar.get(SESSION_COOKIE)?.value)
})

export async function requireSession(nextPath?: string): Promise<SessionInfo> {
  const session = await getRequestSession()
  if (!session) {
    redirect(nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in")
  }
  return session
}

/**
 * Resolves the actor for /a/:agencySlug. A missing session redirects to
 * sign-in; a slug the user has no membership in renders 404 so the existence
 * of other agencies is never revealed.
 */
export const requireAgency = cache(async (agencySlug: string): Promise<AgencyContext> => {
  const session = await requireSession(`/a/${agencySlug}`)
  const ctx = await resolveAgencyContext(session, agencySlug)
  if (!ctx) notFound()
  return ctx
})

/** Same resolution for JSON route handlers: returns null instead of redirecting. */
export async function agencyContextForApi(agencySlug: string): Promise<AgencyContext | null> {
  const session = await getRequestSession()
  if (!session) return null
  return resolveAgencyContext(session, agencySlug)
}

/** /ops/*: a platform identity with a platform role; anything else is 404. */
export async function requirePlatformSession(): Promise<SessionInfo> {
  const session = await requireSession("/ops")
  if (!isPlatformSession(session)) notFound()
  return session
}

/** /control/*: a signed-in agency identity (platform identities get 404). */
export async function requireControlSession(nextPath = "/control/agencies"): Promise<SessionInfo> {
  const session = await requireSession(nextPath)
  if (session.user.kind !== "agency") notFound()
  return session
}

export async function requirePresenter(): Promise<SessionInfo> {
  const session = await requireSession("/demo/presenter")
  if (!session.presenter) notFound()
  return session
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().AGEOS_DEPLOYMENT_PROFILE !== "local",
    path: "/",
    expires: expiresAt,
  }
}
