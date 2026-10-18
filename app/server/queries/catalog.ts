import "server-only"

import { MODULES } from "@/lib/capabilities/catalog.generated"
import type { HandlerStatus, Localized } from "@/lib/capabilities/types"
import type { AgencyContext } from "@/server/auth/context"
import { listCapabilities } from "@/server/capabilities/registry"

// Read-only projection of the 42-capability catalog for one actor: contract,
// implementation status (from the registry, never set here), activation from
// the published configuration, dependency coverage and the actor's
// permissions. Grouped by the nine canonical modules.

export type CatalogAvailability = "enabled" | "needs_setup" | "disabled"

export type CatalogEntry = {
  skillId: string
  moduleKey: string
  label: Localized
  primaryAction: Localized
  deliverableSummary: string
  actionId: string
  status: HandlerStatus
  availability: CatalogAvailability
  enabled: boolean
  mandatory: boolean
  dependsOn: string[]
  missingDependencies: string[]
  viewPermission: string
  executePermission: string
  canView: boolean
  canExecute: boolean
  approvalMode: string
  eligibleRoles: string[]
  connectorOptions: string[]
  href: string
}

export type CatalogModule = {
  key: string
  id: string
  label: Localized
  navigationGroup: string
  capabilities: CatalogEntry[]
}

export const CATALOG_TABS = ["available", "enabled", "needs_setup", "disabled"] as const
export type CatalogTab = (typeof CATALOG_TABS)[number]

export function getCatalog(ctx: AgencyContext): { modules: CatalogModule[]; total: number; counts: Record<CatalogTab, number> } {
  const caps = listCapabilities()
  const isEnabled = (skillId: string, mandatory: boolean) => mandatory || ctx.enabledCapabilities.has(skillId)
  const mandatoryOf = new Map(caps.map((c) => [c.contract.skillId, c.governance.mandatory]))
  const entries: CatalogEntry[] = caps.map((c) => {
    const g = c.governance
    const enabled = isEnabled(c.contract.skillId, g.mandatory)
    const missing = g.dependsOn.filter((d) => !isEnabled(d, mandatoryOf.get(d) ?? false))
    const availability: CatalogAvailability = !enabled ? "disabled" : missing.length ? "needs_setup" : "enabled"
    return {
      skillId: c.contract.skillId,
      moduleKey: c.contract.moduleKey,
      label: c.contract.label,
      primaryAction: c.contract.primaryAction,
      deliverableSummary: c.contract.deliverableSummary,
      actionId: c.contract.actionId,
      status: c.status,
      availability,
      enabled,
      mandatory: g.mandatory,
      dependsOn: [...g.dependsOn],
      missingDependencies: missing,
      viewPermission: g.viewPermission,
      executePermission: g.executePermission,
      canView: ctx.permissions.has(g.viewPermission),
      canExecute: ctx.permissions.has(g.executePermission),
      approvalMode: g.approval.mode,
      eligibleRoles: [...(g.approval.eligibleRoles ?? [])],
      connectorOptions: [...c.contract.connectorOptions],
      href: `/a/${ctx.tenant.slug}/modules/${c.contract.moduleKey}/workflows/${c.contract.skillId}`,
    }
  })
  const modules: CatalogModule[] = MODULES.map((m) => ({
    key: m.key,
    id: m.id,
    label: m.label,
    navigationGroup: m.navigationGroup,
    capabilities: m.skillIds.map((id) => entries.find((e) => e.skillId === id)!).filter(Boolean),
  }))
  const counts: Record<CatalogTab, number> = {
    available: entries.length,
    enabled: entries.filter((e) => e.availability === "enabled").length,
    needs_setup: entries.filter((e) => e.availability === "needs_setup").length,
    disabled: entries.filter((e) => e.availability === "disabled").length,
  }
  return { modules, total: entries.length, counts }
}

export function catalogEntry(ctx: AgencyContext, skillId: string): CatalogEntry | null {
  for (const m of getCatalog(ctx).modules) {
    const e = m.capabilities.find((c) => c.skillId === skillId)
    if (e) return e
  }
  return null
}

export function moduleDefinition(moduleKey: string) {
  return MODULES.find((m) => m.key === moduleKey) ?? null
}
