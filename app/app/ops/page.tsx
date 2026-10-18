import type { Metadata } from "next"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { EmptyState } from "@/components/app/states"
import { UrlTabs } from "@/components/records/url-state"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { requirePlatformSession } from "@/server/auth/request"
import { listIncidents } from "@/server/domain/ops"
import { getI18n } from "@/server/i18n"

export const metadata: Metadata = { title: "Platform operations" }

const FILTERS = ["open", "resolved", "all"] as const

// platform-ops family: minimal per-tenant health (demo tenants only) and the
// synthetic platform incidents. Filter (?health=) lives in the URL.
export default async function OpsHomePage({ searchParams }: { searchParams: Promise<{ health?: string }> }) {
  const { health } = await searchParams
  const session = await requirePlatformSession()
  const { t, pick } = await getI18n()
  const data = await listIncidents(session)
  const filter = (FILTERS as readonly string[]).includes(health ?? "") ? (health as (typeof FILTERS)[number]) : "open"
  const incidents = data.incidents.filter((i) => filter === "all" || (filter === "resolved" ? i.state === "resolved" : i.state !== "resolved"))

  return (
    <>
      <PageHeader title={t("ops.title")} description={t("ops.description")} badges={<Badge variant="outline">{t("ops.syntheticOnly")}</Badge>} />
      <Frame spacing="default">
        <FrameHeader className="flex flex-col gap-3">
          <FrameTitle>{t("ops.incidentsTitle")}</FrameTitle>
          <UrlTabs
            param="health"
            value={filter}
            label={t("ops.filterLabel")}
            tabs={FILTERS.map((f) => ({ value: f, label: t(`ops.filters.${f}`), count: data.incidents.filter((i) => f === "all" || (f === "resolved" ? i.state === "resolved" : i.state !== "resolved")).length }))}
          />
        </FrameHeader>
        <FramePanel className={incidents.length ? "p-0" : undefined}>
          {incidents.length === 0 ? (
            <EmptyState title={t("ops.noIncidents")} description={t("ops.noIncidentsBody")} />
          ) : (
            <RecordGrid
              rowHrefKey="href"
              emptyMessage={t("ops.noIncidents")}
              columns={[
                { id: "title", header: "ops.columns.incident", kind: "link", hrefKey: "href", subKey: "incidentKey" },
                { id: "tenant", header: "ops.columns.tenant", kind: "text" },
                { id: "state", header: "ops.columns.state", kind: "state", labelPrefix: "ops.states" },
                { id: "updatedAt", header: "ops.columns.updated", kind: "timestamp" },
              ]}
              rows={incidents.map((i) => ({ id: i.id, title: pick(i.title), incidentKey: i.incidentKey, tenant: `${i.tenant.name} (${i.tenant.slug})`, state: i.state, updatedAt: i.updatedAt, href: `/ops/incidents/${i.id}` }))}
            />
          )}
        </FramePanel>
      </Frame>
      <Frame spacing="default">
        <FrameHeader>
          <FrameTitle>{t("ops.tenantsTitle")}</FrameTitle>
          <FrameDescription>{t("ops.tenantsHelp")}</FrameDescription>
        </FrameHeader>
        <FramePanel className="p-0">
          <RecordGrid
            compact
            emptyMessage={t("ops.noIncidents")}
            columns={[
              { id: "name", header: "ops.columns.tenant", kind: "text", subKey: "slug" },
              { id: "status", header: "ops.columns.status", kind: "state", labelPrefix: "control.status" },
              { id: "openIncidents", header: "ops.columns.openIncidents", kind: "number", align: "end" },
            ]}
            rows={data.tenants.map((x) => ({ id: x.slug, name: x.name, slug: x.slug, status: x.status, openIncidents: x.openIncidents }))}
          />
        </FramePanel>
      </Frame>
    </>
  )
}
