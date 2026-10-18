import type { Metadata } from "next"
import Link from "next/link"
import { FileSpreadsheetIcon } from "lucide-react"

import { ConnectDialog } from "@/components/connections/connection-actions"
import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { EmptyState } from "@/components/app/states"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { requireAgency } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"
import { listConnectionsView } from "@/server/queries/connections"

export const metadata: Metadata = { title: "Connections" }

// Connections (solution-dev-ops-6 adaptation): the simulated provider catalog
// grouped by use, this agency's bindings and the file workflow alternative.
// Configuring persists a binding through agency-integrations; no OAuth, no
// tokens, no network call.
export default async function ConnectionsPage({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params
  const ctx = await requireAgency(agencySlug)
  const { t, pick } = await getI18n(ctx.tenant.timezone)
  const data = await listConnectionsView(ctx)
  const base = `/a/${ctx.tenant.slug}`
  const enabled = ctx.enabledCapabilities.has("agency-integrations")
  const canManage = ctx.permissions.has("connections.manage") && enabled
  const categories = [...new Set(data.catalog.map((p) => p.category))]

  return (
    <>
      <PageHeader
        title={t("connections.title")}
        description={t("connections.description")}
        badges={<Badge variant="outline">{t("connections.simulatedBadge")}</Badge>}
        actions={
          <>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/library`} />}>
              <FileSpreadsheetIcon aria-hidden="true" />
              {t("connections.startWithFiles")}
            </Button>
            <ConnectDialog
              agencySlug={ctx.tenant.slug}
              allowed={canManage}
              providers={data.catalog.map((p) => ({ provider: p.provider, label: t(`connections.providers.${p.provider}`), scopes: p.scopes, workflows: p.workflows.map((w) => w.skillId) }))}
            />
          </>
        }
      />
      {!canManage && <p className="text-xs text-muted-foreground">{enabled ? t("connections.readOnly", { role: t(`header.roles.${ctx.role}`) }) : t("connections.capabilityDisabled")}</p>}

      <Frame spacing="default">
        <FrameHeader>
          <FrameTitle>{t("connections.bindingsTitle")}</FrameTitle>
          <FrameDescription>{t("connections.bindingsHelp")}</FrameDescription>
        </FrameHeader>
        <FramePanel className={data.connections.length ? "p-0" : undefined}>
          {data.connections.length === 0 ? (
            <EmptyState title={t("connections.emptyTitle")} description={t("connections.emptyBody")} />
          ) : (
            <RecordGrid
              rowHrefKey="href"
              emptyMessage={t("connections.emptyTitle")}
              columns={[
                { id: "providerLabel", header: "connections.columns.provider", kind: "link", hrefKey: "href", subKey: "accountAlias" },
                { id: "category", header: "connections.columns.category", kind: "state", labelPrefix: "connections.categories" },
                { id: "state", header: "connections.columns.state", kind: "state", labelPrefix: "records.state" },
                { id: "scopes", header: "connections.columns.scopes", kind: "tags", sortable: false },
                { id: "owner", header: "connections.columns.owner", kind: "text" },
                { id: "lastSyncedAt", header: "connections.columns.lastTest", kind: "timestamp" },
              ]}
              rows={data.connections.map((c) => ({ ...c, providerLabel: t(`connections.providers.${c.provider}`), owner: c.owner ?? "—", href: `${base}/connections/${c.id}` }))}
            />
          )}
        </FramePanel>
      </Frame>

      <Frame spacing="default">
        <FrameHeader>
          <FrameTitle>{t("connections.catalogTitle")}</FrameTitle>
          <FrameDescription>{t("connections.catalogHelp")}</FrameDescription>
        </FrameHeader>
        {categories.map((cat) => (
          <FramePanel key={cat} className="flex flex-col gap-2 p-0">
            <div className="px-4 pt-3">
              <FrameTitle>{t(`connections.categories.${cat}`)}</FrameTitle>
            </div>
            <RecordGrid
              compact
              emptyMessage={t("connections.emptyTitle")}
              columns={[
                { id: "label", header: "connections.columns.provider", kind: "text", subKey: "capabilities" },
                { id: "state", header: "connections.columns.state", kind: "state", labelPrefix: "records.state" },
                { id: "bindings", header: "connections.columns.bindings", kind: "number", align: "end" },
                { id: "workflows", header: "connections.columns.workflows", kind: "tags", sortable: false },
              ]}
              rows={data.catalog
                .filter((p) => p.category === cat)
                .map((p) => ({
                  id: p.provider,
                  label: t(`connections.providers.${p.provider}`),
                  capabilities: p.capabilities.join(" · "),
                  state: p.state,
                  bindings: p.bindings,
                  workflows: p.workflows.map((w) => pick(w.label)),
                }))}
            />
          </FramePanel>
        ))}
      </Frame>
    </>
  )
}
