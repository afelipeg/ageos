import "server-only"

import { and, eq } from "drizzle-orm"

import { ROLE_PERMISSIONS, type Permission, type Role, ROLES } from "@/lib/policy"
import { db } from "@/server/db/client"
import { agency, configurationRevision, membership } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { DomainError } from "@/server/kernel/errors"

import type { SessionInfo, SessionUser } from "./session"

// The actor context every query and command receives. It is built only on the
// server from a valid session plus an active membership in the agency.

export type TenantInfo = {
  id: string
  slug: string
  name: string
  appName: string
  status: string
  baseCurrency: string
  timezone: string
  locale: string
  publishedConfigRevisionId: string | null
  requestedDomain: string | null
  domainState: string
}

export type AgencyContext = {
  kind: "agency"
  sessionId: string
  user: SessionUser
  presenter: boolean
  tenant: TenantInfo
  role: Role
  permissions: ReadonlySet<Permission>
  enabledCapabilities: ReadonlySet<string>
  /** Branding of the published configuration (accent and logo text). */
  branding: { accent: string | null; logoText: string | null }
}

/**
 * Builds the agency actor context. Returns null (→ 404) when the slug is
 * malformed, the session is a platform identity (platform roles never grant
 * agency access), the user has no active membership, or the agency is not
 * `ready` yet. `allowNotReady` is reserved for the activation access check.
 */
export async function resolveAgencyContext(
  session: SessionInfo,
  agencySlug: string,
  opts: { allowNotReady?: boolean } = {}
): Promise<AgencyContext | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(agencySlug)) return null
  if (session.user.kind !== "agency") return null
  const rows = await db()
    .select({ agency, role: membership.role })
    .from(membership)
    .innerJoin(agency, eq(agency.id, membership.tenantId))
    .where(
      and(
        eq(membership.userId, session.user.id),
        eq(membership.active, true),
        eq(agency.slug, agencySlug)
      )
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null
  if (row.agency.status !== "ready" && !opts.allowNotReady) return null
  const role = (ROLES as readonly string[]).includes(row.role) ? (row.role as Role) : null
  if (!role) return null

  let enabled: string[] = []
  let branding: AgencyContext["branding"] = { accent: null, logoText: null }
  if (row.agency.publishedConfigRevisionId) {
    // configuration_revision is RLS-protected: read it inside the tenant scope.
    const cfg = await withTenant(row.agency.id, (tx) =>
      tx
        .select({
          enabled: configurationRevision.enabledCapabilities,
          brandAccess: configurationRevision.brandAccess,
        })
        .from(configurationRevision)
        .where(eq(configurationRevision.id, row.agency.publishedConfigRevisionId!))
        .limit(1)
    )
    enabled = cfg[0]?.enabled ?? []
    const brand = (cfg[0]?.brandAccess ?? {}) as { accent?: string; logoText?: string }
    branding = { accent: brand.accent ?? null, logoText: brand.logoText ?? null }
  }

  return {
    kind: "agency",
    sessionId: session.sessionId,
    user: session.user,
    presenter: session.presenter,
    tenant: {
      id: row.agency.id,
      slug: row.agency.slug,
      name: row.agency.name,
      appName: row.agency.appName,
      status: row.agency.status,
      baseCurrency: row.agency.baseCurrency,
      timezone: row.agency.timezone,
      locale: row.agency.locale,
      publishedConfigRevisionId: row.agency.publishedConfigRevisionId,
      requestedDomain: row.agency.requestedDomain,
      domainState: row.agency.domainState,
    },
    role,
    permissions: new Set(ROLE_PERMISSIONS[role]),
    enabledCapabilities: new Set(enabled),
    branding,
  }
}

export function assertPermission(ctx: AgencyContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) {
    throw new DomainError("forbidden", `Role ${ctx.role} lacks ${permission}`, {
      permission,
      role: ctx.role,
    })
  }
}

/** Active memberships in ready agencies (agency switcher). Drafts are listed by the control plane. */
export async function listMemberships(userId: string) {
  return db()
    .select({
      tenantId: agency.id,
      slug: agency.slug,
      name: agency.name,
      appName: agency.appName,
      status: agency.status,
      role: membership.role,
    })
    .from(membership)
    .innerJoin(agency, eq(agency.id, membership.tenantId))
    .where(and(eq(membership.userId, userId), eq(membership.active, true), eq(agency.status, "ready")))
}
