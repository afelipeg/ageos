import type { Metadata } from "next"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { EmptyState } from "@/components/app/states"
import { ClearFiltersButton, UrlPager, UrlTabs } from "@/components/records/url-state"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel } from "@/components/reui/frame"
import { requireAgency } from "@/server/auth/request"
import { getCapability } from "@/server/capabilities/registry"
import { getI18n } from "@/server/i18n"
import { listRunsView, RUN_STATES, type RunStateFilter } from "@/server/queries/runs"
import { flatParams, positiveInt } from "@/server/queries/shared"

export const metadata: Metadata = { title: "Runs" }

// Runs console (agent-activity-1 adaptation): deterministic capability runs
// as persisted by the runner, filterable by state, capability and job in the
// URL. No timers, no invented reasoning; each row opens its step trace.
export default async function RunsPage({
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
  const state: RunStateFilter = (RUN_STATES as readonly string[]).includes(sp.state ?? "") ? (sp.state as RunStateFilter) : "all"
  const skill = sp.skill && getCapability(sp.skill) ? sp.skill : undefined
  const page = positiveInt(sp.page)
  const data = await listRunsView(ctx, { state, skill, job: sp.job, page })
  const base = `/a/${ctx.tenant.slug}`
  const filtered = Boolean(skill || sp.job)

  return (
    <>
      <PageHeader
        title={t("runs.title")}
        description={t("runs.description")}
        badges={
          <>
            <Badge variant="outline">{t("runs.mode")}</Badge>
            {skill && <Badge variant="outline" className="font-mono">{skill}</Badge>}
          </>
        }
      />
      <Frame spacing="default">
        <FrameHeader className="flex flex-col gap-3">
          <UrlTabs param="state" value={state} label={t("runs.filterLabel")} tabs={RUN_STATES.map((s) => ({ value: s, label: t(`runs.states.${s}`), count: data.counts[s] ?? 0 }))} />
          <FrameDescription>{t("runs.help")}</FrameDescription>
        </FrameHeader>
        <FramePanel className={data.rows.length ? "p-0" : undefined}>
          {data.rows.length === 0 ? (
            filtered || state !== "all" ? (
              <EmptyState title={t("states.noResultsTitle")} description={t("runs.noResults")} action={<ClearFiltersButton>{t("common.clearFilters")}</ClearFiltersButton>} />
            ) : (
              <EmptyState title={t("runs.emptyTitle")} description={t("runs.emptyBody")} />
            )
          ) : (
            <RecordGrid
              rowHrefKey="href"
              emptyMessage={t("runs.emptyTitle")}
              pageSize={data.pageSize}
              columns={[
                { id: "label", header: "runs.columns.capability", kind: "link", hrefKey: "href", subKey: "skillId" },
                { id: "state", header: "runs.columns.state", kind: "state", labelPrefix: "records.state" },
                { id: "job", header: "runs.columns.job", kind: "text" },
                { id: "origin", header: "runs.columns.origin", kind: "state", labelPrefix: "records.origin" },
                { id: "actor", header: "runs.columns.actor", kind: "text" },
                { id: "startedAt", header: "runs.columns.started", kind: "timestamp" },
              ]}
              rows={data.rows.map((r) => ({
                id: r.id,
                label: pick(r.label),
                skillId: r.skillId,
                state: r.state,
                job: r.jobRef ? `${r.jobRef} · ${r.jobName}` : "—",
                origin: r.origin,
                actor: r.actor ?? "—",
                startedAt: r.startedAt,
                href: `${base}/runs/${r.id}`,
              }))}
            />
          )}
        </FramePanel>
        <UrlPager page={page} pageSize={data.pageSize} total={data.total} />
      </Frame>
    </>
  )
}
