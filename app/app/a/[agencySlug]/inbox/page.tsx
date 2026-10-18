import type { Metadata } from "next"
import Link from "next/link"
import { ArrowUpRightIcon } from "lucide-react"

import { InboxItemActions } from "@/components/inbox/inbox-item-actions"
import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { StateBadge } from "@/components/app/state-badge"
import { EmptyState } from "@/components/app/states"
import { ClearFiltersButton, UrlSelect, UrlTabs } from "@/components/records/url-state"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { MODULES } from "@/lib/capabilities/catalog.generated"
import { requireAgency } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"
import { getInbox, INBOX_COMMANDS_AVAILABLE, INBOX_VIEWS, type InboxView } from "@/server/queries/inbox"
import { flatParams } from "@/server/queries/shared"

export const metadata: Metadata = { title: "Inbox" }

// Inbox (solution-agents-5 adaptation): For me / Approvals / Blocked / All,
// filters by job, owner and module, and the selected item (?item=) in the URL.
// The detail opens the evidence; assign / snooze / resolve go through server
// commands — resolve only when the service confirms the condition is gone.
export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { agencySlug } = await params
  const sp = flatParams(await searchParams)
  const ctx = await requireAgency(agencySlug)
  const { t, pick, timestamp } = await getI18n(ctx.tenant.timezone)
  const view: InboxView = (INBOX_VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as InboxView) : "for-me"
  const moduleKey = MODULES.some((m) => m.key === sp.module) ? sp.module : undefined
  const data = await getInbox(ctx, { view, job: sp.job, owner: sp.owner, module: moduleKey })
  const selected = data.rows.find((r) => r.key === sp.item) ?? null
  const base = `/a/${ctx.tenant.slug}`
  const qs = (item: string) => {
    const next = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"))
    next.set("item", item)
    return `${base}/inbox?${next.toString()}`
  }
  const label = (title: string | { en: string; es: string }) => (typeof title === "string" ? title : pick(title))
  const filtered = Boolean(data.filters.job || data.filters.owner || data.filters.module)
  const commands = INBOX_COMMANDS_AVAILABLE

  return (
    <>
      <PageHeader title={t("inbox.title")} description={t("inbox.description")} />

      <div className="grid gap-6 xl:grid-cols-3">
        <Frame spacing="default" className="min-w-0 xl:col-span-2">
          <FrameHeader className="flex flex-col gap-3">
            <UrlTabs param="view" value={view} label={t("inbox.viewsLabel")} tabs={INBOX_VIEWS.map((v) => ({ value: v, label: t(`inbox.views.${v}`), count: data.counts[v] }))} />
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <UrlSelect param="job" value={data.filters.job} label={t("inbox.filters.job")} allLabel={t("inbox.filters.allJobs")} options={data.jobs.map((j) => ({ value: j.id, label: j.label }))} />
              <UrlSelect param="owner" value={data.filters.owner} label={t("inbox.filters.owner")} allLabel={t("inbox.filters.allOwners")} options={data.members.map((m) => ({ value: m.id, label: m.name }))} />
              <UrlSelect param="module" value={data.filters.module} label={t("inbox.filters.module")} allLabel={t("inbox.filters.allModules")} options={MODULES.map((m) => ({ value: m.key, label: pick(m.label) }))} />
            </div>
          </FrameHeader>
          <FramePanel className={data.rows.length ? "p-0" : undefined}>
            {data.rows.length === 0 ? (
              filtered ? (
                <EmptyState title={t("states.noResultsTitle")} description={t("inbox.noResults")} action={<ClearFiltersButton keep={["view"]}>{t("common.clearFilters")}</ClearFiltersButton>} />
              ) : (
                <EmptyState
                  title={t(`inbox.empty.${view}`)}
                  description={t("inbox.emptyBody")}
                  action={
                    <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${base}/jobs`} />}>
                      {t("inbox.openJobs")}
                    </Button>
                  }
                />
              )
            ) : (
              <RecordGrid
                rowHrefKey="select"
                emptyMessage={t(`inbox.empty.${view}`)}
                columns={[
                  { id: "title", header: "inbox.columns.item", kind: "link", hrefKey: "select", subKey: "sourceLabel" },
                  { id: "job", header: "inbox.columns.job", kind: "text" },
                  { id: "state", header: "inbox.columns.state", kind: "state", labelPrefix: "records.state" },
                  { id: "owner", header: "inbox.columns.owner", kind: "text" },
                  { id: "createdAt", header: "inbox.columns.created", kind: "timestamp" },
                ]}
                rows={data.rows.map((r) => ({
                  id: r.key,
                  title: label(r.title),
                  sourceLabel: t(`inbox.source.${r.source}`),
                  job: r.jobLabel ?? "—",
                  state: r.state,
                  owner: r.source === "approval" ? (r.ownerName ?? "").split(", ").map((role) => t(`header.roles.${role}`)).join(", ") : (r.ownerName ?? t("inbox.unassigned")),
                  createdAt: r.createdAt,
                  select: qs(r.key),
                }))}
              />
            )}
          </FramePanel>
        </Frame>

        <Frame spacing="default" className="min-w-0 self-start">
          <FrameHeader>
            <FrameTitle>{selected ? label(selected.title) : t("inbox.detailTitle")}</FrameTitle>
            <FrameDescription>{selected ? t(`inbox.source.${selected.source}`) : t("inbox.detailEmpty")}</FrameDescription>
          </FrameHeader>
          {selected && (
            <FramePanel className="flex flex-col gap-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">{t("inbox.columns.state")}</dt>
                <dd>
                  <StateBadge state={selected.state} label={t(`records.state.${selected.state}`)} />
                </dd>
                <dt className="text-muted-foreground">{t("inbox.columns.job")}</dt>
                <dd className="min-w-0 truncate">
                  {selected.jobId ? (
                    <Link href={`${base}/jobs/${selected.jobId}`} className="font-medium underline-offset-3 hover:underline">
                      {selected.jobLabel}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="text-muted-foreground">{t("inbox.columns.owner")}</dt>
                <dd>{selected.source === "approval" ? t("inbox.eligibleRoles") : (selected.ownerName ?? t("inbox.unassigned"))}</dd>
                <dt className="text-muted-foreground">{t("inbox.columns.created")}</dt>
                <dd>{timestamp(selected.createdAt)}</dd>
                {selected.snoozedUntil && (
                  <>
                    <dt className="text-muted-foreground">{t("inbox.snoozedUntil")}</dt>
                    <dd>{timestamp(selected.snoozedUntil)}</dd>
                  </>
                )}
              </dl>
              <Button size="sm" nativeButton={false} render={<Link href={selected.href} />}>
                {selected.ctaLabel ? pick(selected.ctaLabel) : t(`inbox.openEvidence.${selected.source}`)}
                <ArrowUpRightIcon aria-hidden="true" />
              </Button>
              {selected.source === "attention" && (
                <InboxItemActions
                  agencySlug={ctx.tenant.slug}
                  itemId={selected.id}
                  revision={selected.revision ?? 1}
                  state={selected.state}
                  assigneeId={selected.ownerId}
                  members={data.members.map((m) => ({ value: m.id, label: `${m.name} · ${t(`header.roles.${m.role}`)}` }))}
                  available={commands}
                />
              )}
            </FramePanel>
          )}
        </Frame>
      </div>
    </>
  )
}
