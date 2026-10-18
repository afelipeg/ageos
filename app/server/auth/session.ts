import "server-only"

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { and, eq, gt, isNull } from "drizzle-orm"

import { PLATFORM_ROLES } from "@/lib/policy"
import { db, type Executor } from "@/server/db/client"
import { appSession, appUser, platformAuditEvent } from "@/server/db/schema"
import { env, isDemoMode } from "@/server/env"

// Opaque server sessions. The cookie holds a random token; the database keeps
// only an HMAC of it. Roles, tenant and memberships are always resolved on the
// server from the session's user — never taken from the browser.

export const SESSION_COOKIE = "ageos_session"
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export type SessionUser = {
  id: string
  fixtureKey: string | null
  displayName: string
  email: string
  locale: "en" | "es"
  kind: string
  platformRole: string | null
  demoPersona: boolean
}

export type SessionInfo = {
  sessionId: string
  user: SessionUser
  /** True when the session was opened with the presenter access code. */
  presenter: boolean
  presenterUserId: string | null
}

/** A platform identity (kind=platform) holding a platform role. Agency owners never qualify. */
export function isPlatformSession(session: SessionInfo): boolean {
  return (
    session.user.kind === "platform" &&
    (PLATFORM_ROLES as readonly string[]).includes(session.user.platformRole ?? "")
  )
}

export function hashToken(token: string): string {
  return createHmac("sha256", env().AGEOS_SESSION_SECRET).update(token).digest("hex")
}

export function newToken(): string {
  return randomBytes(32).toString("base64url")
}

export function accessCodeMatches(candidate: string): boolean {
  const expected = Buffer.from(env().AGEOS_DEMO_ACCESS_CODE, "utf8")
  const given = Buffer.from(candidate, "utf8")
  // Compare HMACs so the comparison is constant-time regardless of length.
  const a = createHmac("sha256", "ageos-access").update(expected).digest()
  const b = createHmac("sha256", "ageos-access").update(given).digest()
  return timingSafeEqual(a, b)
}

export async function createSession(input: {
  userId: string
  presenterUserId: string | null
}): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db().insert(appSession).values({
    tokenHash: hashToken(token),
    userId: input.userId,
    presenterUserId: input.presenterUserId,
    expiresAt,
  })
  return { token, expiresAt }
}

export async function loadSession(token: string | undefined): Promise<SessionInfo | null> {
  if (!token || token.length < 20 || token.length > 200) return null
  const rows = await db()
    .select({
      sessionId: appSession.id,
      presenterUserId: appSession.presenterUserId,
      user: {
        id: appUser.id,
        fixtureKey: appUser.fixtureKey,
        displayName: appUser.displayName,
        email: appUser.email,
        locale: appUser.locale,
        kind: appUser.kind,
        platformRole: appUser.platformRole,
        demoPersona: appUser.demoPersona,
      },
    })
    .from(appSession)
    .innerJoin(appUser, eq(appUser.id, appSession.userId))
    .where(
      and(
        eq(appSession.tokenHash, hashToken(token)),
        isNull(appSession.revokedAt),
        gt(appSession.expiresAt, new Date())
      )
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    sessionId: row.sessionId,
    presenterUserId: row.presenterUserId,
    presenter: row.presenterUserId !== null && isDemoMode(),
    user: { ...row.user, locale: row.user.locale === "es" ? "es" : "en" },
  }
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db()
    .update(appSession)
    .set({ revokedAt: new Date() })
    .where(eq(appSession.id, sessionId))
}

/** Appends to the global platform audit stream; pass `executor` to write inside a transaction. */
export async function auditPlatform(
  event: {
    eventType: string
    actorUserId: string | null
    tenantId?: string | null
    payload?: Record<string, unknown>
  },
  executor: Executor = db()
): Promise<void> {
  await executor
    .insert(platformAuditEvent)
    .values({
      eventType: event.eventType,
      actorUserId: event.actorUserId,
      tenantId: event.tenantId ?? null,
      payload: event.payload ?? {},
    })
}
