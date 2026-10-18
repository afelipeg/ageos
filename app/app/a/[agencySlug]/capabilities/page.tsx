import type { Metadata } from "next"

import { CapabilityChangeDialog, PendingCapabilityChange } from "@/components/catalog/capability-change"
import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { EmptyState } from "@/components/app/states"
import { ClearFiltersButton, UrlChoice, UrlSearch, UrlTabs } from "@/components/records/url-state"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { requireAgency } from "@/server/auth/request"
import { listConfigurationRevisions } from "@/server/domain/configuration"
import { getI18n } from "@/server/i18n"
import { CATALOG_TABS, getCatalog, type CatalogTab } from "@/server/queries/catalog"
import { flatParams } from "@/server/queries/shared"

export const metadata: Metadata = { title: "All capabilities" }

// Catalog of the 42 capabilities (data-grid-filtering-2 adaptation): grouped
// by the nine modules, tabs Available / Enabled / Needs setup / Disabled,
// module filter and search in the URL. Status comes from the registry;
// activation from the published configuration; nothing is toggled locally.
export default async function CapabilitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { agencySlug } = await params
  const sp = flatParams(await searchParams)
  const ctx = await requireAgency(agencySlug)
  const { t, pick } = await getI18n(ctx.tenant.timezone)
  const catalog = getCatalog(ctx)
  const tab: CatalogTab = (CATALOG_TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as CatalogTab) : "available"
  const moduleFilter = catalog.modules.some((m) => m.key === sp.module) ? sp.module! : "all"
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 80)
  const revisions = await listConfigurationRevisions(ctx)
  const published = revisions.find((r) => r.published) ?? null
  const pendingChanges = revisions.filter((r) => r.state === "awaiting_approval")
  const canPropose = ["owner", "account_manager"].includes(ctx.role)

  const groups = catalog.modules
    .filter((m) => moduleFilter === "all" || m.key === moduleFilter)
    .map((m) => ({
      ...m,
      capabilities: m.capabilities.filter(
        (c) =>
          (tab === "available" || c.availability === tab) &&
          (!q || pick(c.label).toLowerCase().includes(q) || c.skillId.includes(q) || c.deliverableSummary.toLowerCase().includes(q))
      ),
    }))
    .filter((m) => m.capabilities.length > 0)
  const shown = groups.reduce((s, g) => s + g.capabilities.length, 0)

  return (
    <>
      <PageHeader
        title={t("catalog.title")}
        description={t("catalog.description")}
        badges={
          <>
            <Badge variant="outline">{t("catalog.totals", { count: catalog.total, modules: catalog.modules.length })}</Badge>
            <Badge variant="outline">{t("catalog.implemented", { count: catalog.modules.flatMap((m) => m.capabilities).filter((c) => c.status !== "registered").length })}</Badge>
          </>
        }
        actions={
          <CapabilityChangeDialog
            agencySlug={ctx.tenant.slug}
            allowed={canPropose}
            publishedNumber={published?.number ?? null}
            caps={catalog.modules.flatMap((m) => m.capabilities.map((c) => ({ skillId: c.skillId, label: pick(c.label), moduleLabel: pick(m.label), enabled: c.enabled, mandatory: c.mandatory })))}
          />
        }
      />

      {pendingChanges.length > 0 && (
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("catalog.change.pendingTitle")}</FrameTitle>
            <FrameDescription>{t("catalog.change.pendingHelp")}</FrameDescription>
          </FrameHeader>
          {pendingChanges.map((r) => (
            <FramePanel key={r.id}>
              <PendingCapabilityChange agencySlug={ctx.tenant.slug} revisionId={r.id} number={r.number} digest={r.payloadDigest ?? ""} diff={r.diff} reason={r.reason} canDecide={r.canDecide} />
            </FramePanel>
          ))}
        </Frame>
      )}

      <Frame spacing="default">
        <FrameHeader className="flex flex-col gap-3">
          <UrlTabs
            param="tab"
            value={tab}
            label={t("catalog.tabsLabel")}
            tabs={CATALOG_TABS.map((k) => ({ value: k, label: t(`catalog.tabs.${k}`), count: catalog.counts[k] }))}
          />
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <UrlChoice
              param="module"
              value={moduleFilter}
              label={t("catalog.moduleFilter")}
              options={[{ value: "all", label: t("catalog.allModules") }, ...catalog.modules.map((m) => ({ value: m.key, label: pick(m.label) }))]}
            />
            <UrlSearch placeholder={t("catalog.searchPlaceholder")} />
          </div>
          <FrameDescription>{t(`catalog.tabHelp.${tab}`)}</FrameDescription>
        </FrameHeader>
        {groups.length === 0 ? (
          <FramePanel>
            <EmptyState
              title={t("states.noResultsTitle")}
              description={t("catalog.noResults")}
              action={<ClearFiltersButton>{t("common.clearFilters")}</ClearFiltersButton>}
            />
          </FramePanel>
        ) : (
          groups.map((g) => (
            <FramePanel key={g.key} className="flex flex-col gap-2 p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
                <FrameTitle>
                  {g.id} · {pick(g.label)}
                </FrameTitle>
                <Badge variant="outline">{t("catalog.groupCount", { count: g.capabilities.length })}</Badge>
              </div>
              <RecordGrid
                emptyMessage={t("catalog.noResults")}
                rowHrefKey="href"
                pageSize={10}
                columns={[
                  { id: "label", header: "catalog.columns.capability", kind: "link", hrefKey: "href", subKey: "skillId" },
                  { id: "status", header: "catalog.columns.status", kind: "state", labelPrefix: "records.state" },
                  { id: "availability", header: "catalog.columns.availability", kind: "state", labelPrefix: "catalog.availability", subKey: "missing" },
                  { id: "dependsOn", header: "catalog.columns.dependencies", kind: "tags", sortable: false },
                  { id: "executePermission", header: "catalog.columns.permission", kind: "mono" },
                  { id: "approvalMode", header: "catalog.columns.approval", kind: "state", labelPrefix: "workbench.approvalMode" },
                  { id: "action", header: "catalog.columns.action", kind: "link", hrefKey: "actionHref", sortable: false },
                ]}
                rows={g.capabilities.map((c) => ({
                  id: c.skillId,
                  label: pick(c.label),
                  skillId: c.skillId,
                  status: c.status,
                  availability: c.availability,
                  missing: c.missingDependencies.length ? t("catalog.missing", { list: c.missingDependencies.join(", ") }) : c.mandatory ? t("catalog.mandatory") : "",
                  dependsOn: c.dependsOn,
                  executePermission: c.executePermission,
                  approvalMode: c.approvalMode,
                  action: c.availability === "enabled" ? t("catalog.openWorkflow") : t("catalog.configure"),
                  actionHref: c.href,
                  href: c.href,
                }))}
              />
            </FramePanel>
          ))
        )}
        <p className="px-1 text-xs text-muted-foreground">{t("catalog.shown", { count: shown, total: catalog.total })}</p>
      </Frame>
    </>
  )
}
