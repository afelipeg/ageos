import type { Metadata } from "next"
import Link from "next/link"
import { ArrowUpRightIcon, PlusIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { PrivacyToggle } from "@/components/app/privacy-toggle"
import { RecordGrid } from "@/components/app/record-grid"
import { EmptyState } from "@/components/app/states"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { eventLabel } from "@/components/records/code-label"
import { MESSAGES } from "@/lib/i18n/messages"
import { requireAgency } from "@/server/auth/request"
import { getOverview } from "@/server/domain/overview"
import { getI18n } from "@/server/i18n"

export const metadata: Metadata = { title: "Overview" }

// workspace-home family (card-28 adaptation): four KPIs from server queries,
// the rule-driven attention queue and recent jobs. Frame-led, dense, no
// entrance motion. Every figure links to the set it summarizes.
export default async function OverviewPage({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params
  const ctx = await requireAgency(agencySlug)
  const { t, pick, money, pct, date, locale } = await getI18n(ctx.tenant.timezone)
  const data = await getOverview(ctx)
  const base = `/a/${ctx.tenant.slug}`

  const kpis = [
    { key: "activeJobs", value: String(data.kpis.activeJobs), help: t("overview.kpi.activeJobsHelp"), href: `${base}/jobs?state=in_progress` },
    { key: "pendingApprovals", value: String(data.kpis.pendingApprovals), help: t("overview.kpi.pendingApprovalsHelp"), href: `${base}/approvals` },
    {
      key: "pendingBilling",
      value: money(data.kpis.pendingBillingMinor, data.currency),
      help: t("overview.kpi.pendingBillingHelp", { issued: money(data.kpis.issuedInvoicesMinor, data.currency) }),
      href: `${base}/modules/billing-collections`,
    },
    {
      key: "projectedMargin",
      value: pct(data.kpis.projectedMarginBps),
      help: t("overview.kpi.projectedMarginHelp", { currency: data.currency }),
      href: `${base}/modules/profitability`,
    },
  ]

  return (
    <>
      <PageHeader
        title={t("overview.title")}
        description={t("overview.description", { app: ctx.tenant.appName })}
        badges={<Badge variant="outline">{t("overview.businessDate", { date: date(data.asOf) })}</Badge>}
        actions={
          <>
            <PrivacyToggle />
            <Button size="sm" nativeButton={false} render={<Link href={`${base}/modules/clients-contracts/workflows/agency-job-lifecycle`} />}>
              <PlusIcon aria-hidden="true" />
              {t("nav.jobs")}
            </Button>
          </>
        }
      />

      <Frame spacing="default" className="@container w-full">
        <div className="grid gap-1 @2xl:grid-cols-2 @4xl:grid-cols-4">
          {kpis.map((k) => (
            <FramePanel key={k.key} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t(`overview.kpi.${k.key}`)}</span>
                <span className="ageos-figure text-2xl font-semibold tracking-tight tabular-nums">{k.value}</span>
                <p className="text-xs leading-relaxed text-muted-foreground">{k.help}</p>
              </div>
              <Link href={k.href} className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-3 hover:underline">
                {t("overview.kpi.open")}
                <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
              </Link>
            </FramePanel>
          ))}
        </div>
      </Frame>

      <div className="grid gap-6 xl:grid-cols-3">
        <Frame spacing="default" className="min-w-0 xl:col-span-2">
          <FrameHeader>
            <FrameTitle>{t("overview.attention.title")}</FrameTitle>
            <FrameDescription>{t("overview.attention.description")}</FrameDescription>
          </FrameHeader>
          <FramePanel className="p-0">
            <RecordGrid
              emptyMessage={t("overview.attention.empty")}
              columns={[
                { id: "jobName", header: "overview.attention.job", kind: "text", subKey: "jobRef" },
                { id: "title", header: "overview.attention.issue", kind: "text" },
                { id: "effect", header: "overview.attention.effect", kind: "text" },
                { id: "cta", header: "overview.attention.action", kind: "link", hrefKey: "ctaHref", sortable: false },
              ]}
              rows={data.attention.map((a) => ({
                id: a.id,
                jobName: a.jobName ?? "—",
                jobRef: a.jobRef ?? "",
                title: pick(a.title),
                effect:
                  typeof a.effect.marginBps === "number"
                    ? t("overview.attention.marginEffect", { value: pct(a.effect.marginBps as number), floor: pct(a.effect.thresholdBps as number) })
                    : "—",
                cta: pick(a.ctaLabel),
                ctaHref: a.ctaHref,
              }))}
            />
          </FramePanel>
        </Frame>

        <Frame spacing="default" className="min-w-0">
          <FrameHeader>
            <FrameTitle>{t("overview.activity.title")}</FrameTitle>
            <FrameDescription>{t("overview.activity.description")}</FrameDescription>
          </FrameHeader>
          <FramePanel>
            {data.activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("overview.activity.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {data.activity.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5 text-sm">
                    <span className="font-medium">{eventLabel(MESSAGES[locale], t, e.eventType)}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.actor ?? "—"} · {t(`records.origin.${e.origin}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </FramePanel>
        </Frame>
      </div>

      <Frame spacing="default">
        <FrameHeader className="flex-row items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <FrameTitle>{t("overview.recentJobs.title")}</FrameTitle>
            <FrameDescription>{t("overview.recentJobs.description")}</FrameDescription>
          </div>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/jobs`} />}>
            {t("overview.recentJobs.viewAll")}
          </Button>
        </FrameHeader>
        <FramePanel className="p-0">
          {data.recentJobs.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={t("overview.recentJobs.empty")}
                action={
                  <Button size="sm" nativeButton={false} render={<Link href={`${base}/modules/clients-contracts/workflows/agency-job-lifecycle`} />}>
                    {t("overview.recentJobs.create")}
                  </Button>
                }
              />
            </div>
          ) : (
            <RecordGrid
              emptyMessage={t("overview.recentJobs.empty")}
              rowHrefKey="href"
              columns={[
                { id: "name", header: "jobs.columns.name", kind: "link", hrefKey: "href", subKey: "displayReference" },
                { id: "jobNumber", header: "jobs.columns.jobNumber", kind: "mono" },
                { id: "state", header: "jobs.columns.state", kind: "state", labelPrefix: "records.state" },
                { id: "agencyFeeMinor", header: "jobs.columns.fee", kind: "money", align: "end" },
                { id: "marginBps", header: "jobs.columns.margin", kind: "bps", align: "end" },
              ]}
              rows={data.recentJobs.map((j) => ({ ...j, href: `${base}/jobs/${j.id}` }))}
            />
          )}
        </FramePanel>
      </Frame>
    </>
  )
}
