import "server-only"

import { and, count, desc, eq, gte } from "drizzle-orm"

import { GOVERNANCE } from "@/lib/capabilities/governance"
import { CAPABILITY_CONTRACTS } from "@/lib/capabilities/catalog.generated"
import { ROLE_PERMISSIONS, ROLES, type Role } from "@/lib/policy"
import type { AgencyContext } from "@/server/auth/context"
import { agency, appUser, businessEvent, configurationRevision, membership, workflowRun } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

import { libraryLimits } from "./library"
import { iso } from "./shared"

// Settings projections: identity/brand of the published configuration, team
// and the role → permission matrix, effective policy per capability, the
// simulated domain, demo plan limits with measured local usage, and the audit
// log. Writes go through the owning services (configuration, governance,
// activation), never from this module.

export const SETTINGS_SECTIONS = ["brand", "team", "policy", "domains", "plan", "audit"] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export function resolveSection(raw: string): SettingsSection | null {
  if (raw === "identity") return "brand"
  return (SETTINGS_SECTIONS as readonly string[]).includes(raw) ? (raw as SettingsSection) : null
}

export async function getSettingsView(ctx: AgencyContext, section: SettingsSection) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const [a] = await tx.select().from(agency).where(eq(agency.id, ctx.tenant.id)).limit(1)
    const [published] = ctx.tenant.publishedConfigRevisionId
      ? await tx.select().from(configurationRevision).where(and(eq(configurationRevision.tenantId, ctx.tenant.id), eq(configurationRevision.id, ctx.tenant.publishedConfigRevisionId))).limit(1)
      : []
    const brand = (published?.brandAccess ?? {}) as { accent?: string; logoText?: string; appSlug?: string; customDomain?: string | null; members?: { name: string; email: string; role: string }[] }
    const base = {
      agency: { id: a!.id, name: a!.name, appName: a!.appName, slug: a!.slug, status: a!.status, baseCurrency: a!.baseCurrency, timezone: a!.timezone, requestedDomain: a!.requestedDomain, domainState: a!.domainState, revision: a!.revision },
      published: published ? { id: published.id, number: published.number, state: published.state, publishedAt: iso(published.publishedAt), schemaVersion: published.schemaVersion } : null,
      brand: { accent: brand.accent ?? ctx.branding.accent ?? null, logoText: brand.logoText ?? ctx.branding.logoText ?? null },
    }
    if (section === "brand") return { section, ...base }
    if (section === "team") {
      const members = await tx
        .select({ id: membership.id, userId: appUser.id, name: appUser.displayName, email: appUser.email, role: membership.role, active: membership.active })
        .from(membership)
        .innerJoin(appUser, eq(appUser.id, membership.userId))
        .where(eq(membership.tenantId, ctx.tenant.id))
      const invites = (brand.members ?? []).filter((m) => !members.some((x) => x.email.toLowerCase() === m.email.toLowerCase()))
      const matrix = ROLES.map((r) => ({ role: r, permissions: [...ROLE_PERMISSIONS[r as Role]] }))
      return { section, ...base, members, invites, matrix }
    }
    if (section === "policy") {
      const rows = CAPABILITY_CONTRACTS.map((c) => {
        const g = GOVERNANCE[c.skillId]!
        const enabled = g.mandatory || ctx.enabledCapabilities.has(c.skillId)
        const effective = !enabled ? "blocked" : g.approval.mode === "approval" ? "approval" : g.approval.mode === "confirmation" ? "confirmation" : "auto"
        return {
          skillId: c.skillId,
          moduleKey: c.moduleKey,
          label: c.label,
          effective,
          eligibleRoles: [...(g.approval.eligibleRoles ?? [])],
          separationOfDuties: g.approval.separationOfDuties,
          mandatory: g.mandatory,
          executePermission: g.executePermission,
          rolesThatCanRun: ROLES.filter((r) => ROLE_PERMISSIONS[r as Role].includes(g.executePermission)),
          note: g.approval.note,
        }
      })
      return { section, ...base, rows }
    }
    if (section === "domains") return { section, ...base, customDomain: brand.customDomain ?? a!.requestedDomain }
    if (section === "plan") {
      const limitsRow = (published?.limits ?? {}) as Record<string, unknown>
      const usage = await libraryLimits(tx, ctx)
      const since = new Date(Date.now() - 60 * 60 * 1000)
      const [{ runs }] = await tx.select({ runs: count() }).from(workflowRun).where(eq(workflowRun.tenantId, ctx.tenant.id))
      const [{ lastHour }] = await tx.select({ lastHour: count() }).from(workflowRun).where(and(eq(workflowRun.tenantId, ctx.tenant.id), gte(workflowRun.startedAt, since)))
      const [{ members }] = await tx.select({ members: count() }).from(membership).where(and(eq(membership.tenantId, ctx.tenant.id), eq(membership.active, true)))
      return {
        section,
        ...base,
        limits: limitsRow,
        usage: { usedBytes: usage.usedBytes, storageMb: usage.storageMb, fileCount: usage.fileCount, filesPerJob: usage.filesPerJob, runs: Number(runs), runsLastHour: Number(lastHour), members: Number(members) },
      }
    }
    const events = await tx
      .select({
        id: businessEvent.id,
        seq: businessEvent.seq,
        eventType: businessEvent.eventType,
        aggregateType: businessEvent.aggregateType,
        aggregateId: businessEvent.aggregateId,
        aggregateRevision: businessEvent.aggregateRevision,
        origin: businessEvent.origin,
        commandType: businessEvent.commandType,
        correlationId: businessEvent.correlationId,
        recordedAt: businessEvent.recordedAt,
        actor: appUser.displayName,
      })
      .from(businessEvent)
      .leftJoin(appUser, eq(appUser.id, businessEvent.actorUserId))
      .where(eq(businessEvent.tenantId, ctx.tenant.id))
      .orderBy(desc(businessEvent.seq))
      .limit(200)
    return { section, ...base, events: events.map((e) => ({ ...e, recordedAt: e.recordedAt.toISOString() })) }
  })
}

export type SettingsView = Awaited<ReturnType<typeof getSettingsView>>
