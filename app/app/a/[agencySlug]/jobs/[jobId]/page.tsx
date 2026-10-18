import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { AskAssistantButton } from "@/components/assistant/ask-assistant-button"
import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { StateBadge } from "@/components/app/state-badge"
import { BlockedState, EmptyState } from "@/components/app/states"
import { DossierTabs } from "@/components/jobs/dossier-tabs"
import { DOSSIER_TABS, type DossierTab } from "@/lib/dossier"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline"
import { Button } from "@/components/ui/button"
import { fmtMinutesAsHours } from "@/lib/format"
import { eventLabel } from "@/components/records/code-label"
import { MESSAGES } from "@/lib/i18n/messages"
import { requireAgency } from "@/server/auth/request"
import { getJobDossier } from "@/server/domain/jobs"
import { recomputeJobReadiness } from "@/server/domain/orchestrator"
import { getJobFinance } from "@/server/queries/jobs"
import { getI18n } from "@/server/i18n"

export const metadata: Metadata = { title: "Job dossier" }

// record-detail family: identity + state + forecast band, then the seven
// canonical tabs. All figures come from getJobDossier (the same services the
// Jobs desk, Overview and the assistant use).
export default async function JobDossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; jobId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { agencySlug, jobId } = await params
  const { tab } = await searchParams
  const active: DossierTab = (DOSSIER_TABS as readonly string[]).includes(tab ?? "") ? (tab as DossierTab) : "overview"
  const ctx = await requireAgency(agencySlug)
  const d = await getJobDossier(ctx, jobId)
  if (!d) notFound()
  const i = await getI18n(ctx.tenant.timezone)
  const { t, money, pct, date, timestamp, locale } = i
  const base = `/a/${ctx.tenant.slug}`
  const cur = d.job.currency
  const f = d.forecast

  return (
    <>
      <PageHeader
        title={d.job.name}
        description={`${d.client?.name ?? "—"} · ${d.job.displayReference} · ${d.job.jobNumber}`}
        badges={
          <>
            <StateBadge state={d.job.state} label={t(`records.state.${d.job.state}`)} />
            <Badge variant="outline">{t("dossier.revision", { n: d.job.revision })}</Badge>
          </>
        }
        actions={
          <>
            <AskAssistantButton record={{ type: "job", id: d.job.id, label: `${d.job.displayReference} · ${d.job.name}` }} />
            {ctx.permissions.has("budget.propose") && (
              <Button size="sm" nativeButton={false} render={<Link href={`${base}/modules/clients-contracts/workflows/agency-fee-contracts?job=${d.job.id}`} />}>
                {t("dossier.scope.proposeFee")}
              </Button>
            )}
          </>
        }
      />

      <Frame spacing="default" className="@container">
        <div className="grid gap-1 @xl:grid-cols-2 @4xl:grid-cols-4">
          {[
            { k: "fee", v: money(f.agencyFeeMinor, cur) },
            { k: "media", v: money(f.managedMediaMinor, cur) },
            { k: "cost", v: money(f.agencyCost.totalMinor, cur) },
            { k: "margin", v: `${money(f.marginMinor, cur)} · ${pct(f.marginBps)}` },
          ].map((x) => (
            <FramePanel key={x.k} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t(`dossier.band.${x.k}`)}</span>
              <span className="ageos-figure text-lg font-semibold tracking-tight tabular-nums">{x.v}</span>
            </FramePanel>
          ))}
        </div>
        <p className="px-1 pt-1 text-xs text-muted-foreground">
          {t("dossier.band.basisForecast")} · {t("common.asOf", { date: date(f.asOf) })} · {f.definition}
        </p>
      </Frame>

      <DossierTabs active={active}>
        {active === "overview" && <OverviewTab ctx={ctx} d={d} i={i} base={base} />}
        {active === "scope" && (
          <div className="flex flex-col gap-6">
            <Frame spacing="default">
              <FrameHeader className="flex-row items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <FrameTitle>{t("dossier.scope.authority")}</FrameTitle>
                  <FrameDescription>{t("dossier.scope.authorityHelp")}</FrameDescription>
                </div>
                {ctx.permissions.has("budget.propose") && (
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/modules/clients-contracts/workflows/agency-contract-po?job=${d.job.id}`} />}>
                    {t("dossier.scope.recordAuthority")}
                  </Button>
                )}
              </FrameHeader>
              <FramePanel className="p-0">
                <RecordGrid
                  compact
                  emptyMessage={t("dossier.scope.empty")}
                  columns={[
                    { id: "reference", header: "dossier.scope.columns.reference", kind: "mono" },
                    { id: "revisionNumber", header: "dossier.scope.columns.revision", kind: "number", align: "end" },
                    { id: "amountMinor", header: "dossier.scope.columns.amount", kind: "money", align: "end" },
                    { id: "state", header: "dossier.scope.columns.state", kind: "state", labelPrefix: "records.state" },
                  ]}
                  rows={d.contracts.map((c) => ({ id: c.id, reference: c.reference, revisionNumber: c.revisionNumber, amountMinor: c.amountMinor.toString(), currency: c.currency, state: c.state }))}
                />
              </FramePanel>
            </Frame>
            <Frame spacing="default">
              <FrameHeader className="flex-row items-start justify-between gap-2">
                <FrameTitle>{t("dossier.scope.budgets")}</FrameTitle>
                {ctx.permissions.has("budget.propose") && (
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/modules/clients-contracts/workflows/agency-fee-contracts?job=${d.job.id}`} />}>
                    {t("dossier.scope.proposeFee")}
                  </Button>
                )}
              </FrameHeader>
              <FramePanel className="p-0">
                <RecordGrid
                  emptyMessage={t("dossier.scope.empty")}
                  columns={[
                    { id: "number", header: "dossier.scope.columns.number", kind: "number" },
                    { id: "state", header: "dossier.scope.columns.state", kind: "state", labelPrefix: "records.state" },
                    { id: "agencyFeeMinor", header: "dossier.scope.columns.fee", kind: "money", align: "end" },
                    { id: "managedMediaMinor", header: "dossier.scope.columns.media", kind: "money", align: "end" },
                    { id: "reason", header: "dossier.scope.columns.reason", kind: "text" },
                  ]}
                  rows={d.budgets.map((b) => ({ id: b.id, number: b.number, state: b.state, agencyFeeMinor: b.agencyFeeMinor.toString(), managedMediaMinor: b.managedMediaMinor.toString(), currency: b.currency, reason: b.reason ?? "" }))}
                />
              </FramePanel>
            </Frame>
            <Frame spacing="default">
              <FrameHeader className="flex-row items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <FrameTitle>{t("dossier.scope.availability")}</FrameTitle>
                  <FrameDescription>{t("dossier.scope.availabilityHelp")}</FrameDescription>
                </div>
                {ctx.permissions.has("budget.propose") && (
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/modules/clients-contracts/workflows/agency-budget-control?job=${d.job.id}`} />}>
                    {t("dossier.scope.reserve")}
                  </Button>
                )}
              </FrameHeader>
              <FramePanel className="p-0">
                <RecordGrid
                  emptyMessage={t("dossier.scope.empty")}
                  columns={[
                    { id: "scopeLabel", header: "dossier.scope.columns.scope", kind: "text" },
                    { id: "authorizedMinor", header: "dossier.scope.columns.authorized", kind: "money", align: "end" },
                    { id: "reservationsMinor", header: "dossier.scope.columns.reserved", kind: "money", align: "end" },
                    { id: "openCommitmentsMinor", header: "dossier.scope.columns.committed", kind: "money", align: "end" },
                    { id: "availableMinor", header: "dossier.scope.columns.available", kind: "money", align: "end" },
                  ]}
                  rows={d.availability.map((a) => ({
                    id: a.scope,
                    scopeLabel: t(`records.scope.${a.scope}`),
                    authorizedMinor: a.authorizedMinor.toString(),
                    reservationsMinor: a.reservationsMinor.toString(),
                    openCommitmentsMinor: a.openCommitmentsMinor.toString(),
                    availableMinor: a.availableMinor.toString(),
                    currency: a.currency,
                  }))}
                />
              </FramePanel>
            </Frame>
          </div>
        )}
        {active === "production" && (
          <div className="flex flex-col gap-6">
            <Frame spacing="default">
              <FrameHeader className="flex-row items-start justify-between gap-2">
                <FrameTitle>{t("dossier.production.estimates")}</FrameTitle>
                {ctx.permissions.has("production.manage") && (
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/modules/work-production/workflows/agency-production-estimating?job=${d.job.id}`} />}>
                    {t("dossier.production.recordEstimate")}
                  </Button>
                )}
              </FrameHeader>
              <FramePanel className="p-0">
                <RecordGrid
                  emptyMessage={t("dossier.scope.empty")}
                  columns={[
                    { id: "number", header: "dossier.production.columns.number", kind: "number" },
                    { id: "state", header: "dossier.production.columns.state", kind: "state", labelPrefix: "records.state" },
                    { id: "hours", header: "dossier.production.columns.hours", kind: "text", align: "end" },
                    { id: "totalMinor", header: "dossier.production.columns.total", kind: "money", align: "end" },
                    { id: "reason", header: "dossier.production.columns.reason", kind: "text" },
                  ]}
                  rows={d.estimates.map((e) => ({ id: e.id, number: e.number, state: e.state, hours: fmtMinutesAsHours(e.totals.laborMinutes, locale), totalMinor: e.totals.totalMinor.toString(), currency: e.currency, reason: e.reason ?? "" }))}
                />
              </FramePanel>
            </Frame>
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("dossier.production.estimateLines")}</FrameTitle>
              </FrameHeader>
              <FramePanel className="p-0">
                <RecordGrid
                  compact
                  emptyMessage={t("dossier.scope.empty")}
                  columns={[
                    { id: "lineType", header: "dossier.production.columns.type", kind: "text" },
                    { id: "description", header: "dossier.production.columns.description", kind: "text", subKey: "detail" },
                    { id: "amountMinor", header: "dossier.production.columns.amount", kind: "money", align: "end" },
                  ]}
                  rows={d.estimateLines
                    .filter((l) => l.estimateId === d.currentEstimate?.id)
                    .map((l) => ({
                      id: l.id,
                      lineType: l.lineType,
                      description: l.description,
                      detail: l.minutes ? `${fmtMinutesAsHours(l.minutes, locale)} × ${money(l.hourlyCostMinor ?? 0n, l.currency)}/h` : "",
                      amountMinor: l.amountMinor.toString(),
                      currency: l.currency,
                    }))}
                />
              </FramePanel>
            </Frame>
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("dossier.production.timesheets")}</FrameTitle>
              </FrameHeader>
              <FramePanel>
                {d.timesheets.length === 0 ? (
                  <EmptyState
                    title={t("dossier.production.noTimesheets")}
                    action={
                      ctx.permissions.has("time.log") ? (
                        <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${base}/modules/work-production/workflows/agency-tasks-timesheets?job=${d.job.id}`} />}>
                          {t("dossier.production.logTime")}
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <RecordGrid
                    emptyMessage={t("dossier.scope.empty")}
                    columns={[
                      { id: "taskLabel", header: "dossier.production.columns.task", kind: "text" },
                      { id: "workDate", header: "dossier.production.columns.date", kind: "date" },
                      { id: "hours", header: "dossier.production.columns.minutes", kind: "text", align: "end" },
                      { id: "state", header: "dossier.production.columns.state", kind: "state", labelPrefix: "records.state" },
                    ]}
                    rows={d.timesheets.map((ts) => ({ id: ts.id, taskLabel: ts.taskLabel, workDate: ts.workDate, hours: fmtMinutesAsHours(ts.minutes, locale), state: ts.state }))}
                  />
                )}
              </FramePanel>
            </Frame>
          </div>
        )}
        {active === "media" && (
          <div className="flex flex-col gap-6">
            <Frame spacing="default">
              <FrameHeader className="flex-row items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <FrameTitle>{t("dossier.media.plans")}</FrameTitle>
                  <FrameDescription>{t("dossier.media.simulated")}</FrameDescription>
                </div>
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/modules/media-planning`} />}>
                  {t("dossier.media.openPlanning")}
                </Button>
              </FrameHeader>
              <FramePanel className="p-0">
                <RecordGrid
                  compact
                  emptyMessage={t("dossier.scope.empty")}
                  columns={[
                    { id: "number", header: "dossier.media.columns.number", kind: "number" },
                    { id: "state", header: "dossier.media.columns.state", kind: "state", labelPrefix: "records.state" },
                    { id: "objective", header: "dossier.media.columns.objective", kind: "text" },
                    { id: "totalMinor", header: "dossier.media.columns.total", kind: "money", align: "end" },
                  ]}
                  rows={d.plans.map((p) => ({ id: p.id, number: p.number, state: p.state, objective: p.objective, totalMinor: p.totalMinor.toString(), currency: p.currency }))}
                />
              </FramePanel>
            </Frame>
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("dossier.media.lines")}</FrameTitle>
              </FrameHeader>
              <FramePanel className="p-0">
                <RecordGrid
                  emptyMessage={t("dossier.scope.empty")}
                  columns={[
                    { id: "channel", header: "dossier.media.columns.channel", kind: "text" },
                    { id: "placement", header: "dossier.media.columns.placement", kind: "text" },
                    { id: "provider", header: "dossier.media.columns.provider", kind: "mono", subKey: "account" },
                    { id: "dates", header: "dossier.media.columns.dates", kind: "text" },
                    { id: "amountMinor", header: "dossier.media.columns.amount", kind: "money", align: "end" },
                  ]}
                  rows={d.planLines.map((l) => ({ id: l.id, channel: l.channel, placement: l.placement, provider: l.provider, account: l.accountAlias ? `${l.accountAlias} · ${t("common.simulated")}` : t("common.simulated"), dates: `${date(l.startDate)} – ${date(l.endDate)}`, amountMinor: l.amountMinor.toString(), currency: l.currency }))}
                />
              </FramePanel>
            </Frame>
          </div>
        )}
        {active === "finance" && (
          <div className="flex flex-col gap-6">
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("dossier.finance.approvals")}</FrameTitle>
              </FrameHeader>
              <FramePanel className="p-0">
                <RecordGrid
                  emptyMessage={t("dossier.scope.empty")}
                  rowHrefKey="href"
                  columns={[
                    { id: "title", header: "dossier.finance.columns.title", kind: "link", hrefKey: "href" },
                    { id: "state", header: "dossier.finance.columns.state", kind: "state", labelPrefix: "records.state" },
                    { id: "amountMinor", header: "dossier.finance.columns.amount", kind: "money", align: "end" },
                    { id: "createdAt", header: "dossier.finance.columns.created", kind: "timestamp" },
                  ]}
                  rows={d.approvals.map((a) => ({ id: a.id, title: a.title, state: a.state, amountMinor: a.amountMinor?.toString() ?? null, currency: a.currency ?? cur, createdAt: a.createdAt.toISOString(), href: `${base}/approvals/${a.id}` }))}
                />
              </FramePanel>
            </Frame>
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("dossier.finance.incurred")}</FrameTitle>
                <FrameDescription>{t("dossier.finance.incurredHelp")}</FrameDescription>
              </FrameHeader>
              <FramePanel className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>
                    {t("dossier.band.fee")}: <span className="ageos-figure font-semibold tabular-nums">{money(d.incurred.agencyFeeMinor, cur)}</span>
                  </span>
                  <span>
                    {t("dossier.band.cost")}: <span className="ageos-figure font-semibold tabular-nums">{money(d.incurred.agencyCost.totalMinor, cur)}</span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{t("dossier.finance.unmet")}:</p>
                <div className="flex flex-wrap gap-1.5">
                  {d.incurred.unmetRequirements.map((r) => (
                    <Badge key={r} variant="outline">
                      {r}
                    </Badge>
                  ))}
                </div>
              </FramePanel>
            </Frame>
            <JobFinanceRecords ctx={ctx} jobId={d.job.id} i={i} base={base} />
          </div>
        )}
        {active === "files" && (
          <Frame spacing="default">
            <FrameHeader className="flex-row items-start justify-between gap-2">
              <FrameTitle>{t("dossier.files.title")}</FrameTitle>
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/library?job=${d.job.id}`} />}>
                {t("dossier.files.openLibrary")}
              </Button>
            </FrameHeader>
            <FramePanel className="p-0">
              <RecordGrid
                emptyMessage={t("dossier.files.empty")}
                columns={[
                  { id: "originalName", header: "dossier.files.columns.name", kind: "link", hrefKey: "href" },
                  { id: "format", header: "dossier.files.columns.format", kind: "mono" },
                  { id: "version", header: "dossier.files.columns.version", kind: "number", align: "end" },
                  { id: "extractionStatus", header: "dossier.files.columns.status", kind: "state", labelPrefix: "records.state" },
                  { id: "createdAt", header: "dossier.files.columns.uploaded", kind: "timestamp" },
                ]}
                rows={d.files.map((file) => ({ id: file.id, originalName: file.originalName, format: file.format, version: file.version, extractionStatus: file.extractionStatus, createdAt: file.createdAt.toISOString(), href: `${base}/library/${file.id}` }))}
              />
            </FramePanel>
          </Frame>
        )}
        {active === "activity" && (
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("dossier.activity.title")}</FrameTitle>
              <FrameDescription>{t("dossier.activity.description")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              {d.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("dossier.activity.empty")}</p>
              ) : (
                <Timeline>
                  {d.events.map((e, idx) => (
                    <TimelineItem key={e.id} step={idx + 1}>
                      <TimelineHeader>
                        <TimelineDate>{timestamp(e.recordedAt)}</TimelineDate>
                        <TimelineTitle>{eventLabel(MESSAGES[locale], t, e.eventType)}</TimelineTitle>
                      </TimelineHeader>
                      <TimelineIndicator />
                      <TimelineSeparator />
                      <TimelineContent className="text-xs text-muted-foreground">
                        {e.actor ?? "—"} · {t(`records.origin.${e.origin}`)}
                        {e.aggregateRevision ? ` · ${t("dossier.activity.revision", { n: e.aggregateRevision })}` : ""}
                        {e.commandType ? ` · ${e.commandType}` : ""}
                      </TimelineContent>
                    </TimelineItem>
                  ))}
                </Timeline>
              )}
            </FramePanel>
          </Frame>
        )}
      </DossierTabs>
    </>
  )
}

async function OverviewTab({
  ctx,
  d,
  i,
  base,
}: {
  ctx: Awaited<ReturnType<typeof requireAgency>>
  d: NonNullable<Awaited<ReturnType<typeof getJobDossier>>>
  i: Awaited<ReturnType<typeof getI18n>>
  base: string
}) {
  const { t } = i
  const readiness = await recomputeJobReadiness(ctx, { job: d.job.id })
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Frame spacing="default" className="min-w-0 lg:col-span-2">
        <FrameHeader>
          <FrameTitle>{t("dossier.overview.nextStep")}</FrameTitle>
          <FrameDescription>{t("dossier.overview.nextStepHelp")}</FrameDescription>
        </FrameHeader>
        <FramePanel className="flex flex-col gap-3">
          <p className="text-sm font-medium">{t(`dossier.overview.node.${readiness.next_stage}`)}</p>
          <ul className="flex flex-col gap-1.5">
            {readiness.dependency_graph.map((n) => (
              <li key={n.key} className="flex items-center justify-between gap-2 text-sm">
                <span>{t(`dossier.overview.node.${n.key}`)}</span>
                <StateBadge state={n.status === "done" ? "approved" : n.status === "blocked" ? "blocked" : "draft"} label={t(`dossier.overview.nodeStatus.${n.status}`)} />
              </li>
            ))}
          </ul>
          {d.attention.filter((a) => a.state === "open").length > 0 ? (
            d.attention
              .filter((a) => a.state === "open")
              .map((a) => (
                <BlockedState
                  key={a.id}
                  title={i.pick(a.title as { en: string; es: string })}
                  action={
                    <Button size="xs" nativeButton={false} render={<Link href={a.ctaHref} />}>
                      {i.pick(a.ctaLabel as { en: string; es: string })}
                    </Button>
                  }
                />
              ))
          ) : (
            <p className="text-xs text-muted-foreground">{t("dossier.overview.noBlockers")}</p>
          )}
        </FramePanel>
      </Frame>
      <Frame spacing="default" className="min-w-0">
        <FrameHeader>
          <FrameTitle>{t("dossier.overview.relations")}</FrameTitle>
        </FrameHeader>
        <FramePanel className="flex flex-col gap-2 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted-foreground">{t("dossier.client")}</dt>
            <dd className="min-w-0 truncate">
              {d.client ? (
                <Link href={`${base}/clients/${d.client.id}`} className="font-medium underline-offset-3 hover:underline">
                  {d.client.name}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-muted-foreground">{t("dossier.owner")}</dt>
            <dd>{d.job.ownerName ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("dossier.period")}</dt>
            <dd className="tabular-nums">{d.job.period}</dd>
            <dt className="text-muted-foreground">{t("dossier.jobNumber")}</dt>
            <dd className="font-mono text-xs">{d.job.jobNumber}</dd>
            <dt className="text-muted-foreground">{t("dossier.reference")}</dt>
            <dd>{d.job.displayReference}</dd>
          </dl>
          {d.briefs[0] && (
            <div className="flex flex-col gap-0.5 border-t border-border pt-2">
              <span className="text-xs font-medium text-muted-foreground">{t("dossier.overview.brief")}</span>
              <span className="font-medium">{d.briefs[0].title}</span>
              <span className="text-xs text-muted-foreground">{d.briefs[0].summary}</span>
            </div>
          )}
        </FramePanel>
      </Frame>
    </div>
  )
}

async function JobFinanceRecords({
  ctx,
  jobId,
  i,
  base,
}: {
  ctx: Awaited<ReturnType<typeof requireAgency>>
  jobId: string
  i: Awaited<ReturnType<typeof getI18n>>
  base: string
}) {
  const { t } = i
  const fin = await getJobFinance(ctx, jobId)
  if (!fin) return null
  const recHref = (type: string, id: string) => (type === "supplier_invoice" ? `${base}/records/supplier-bill/${id}` : type === "client_invoice" ? `${base}/records/client-invoice/${id}` : null)
  return (
    <>
      <Frame spacing="default">
        <FrameHeader className="flex-row items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <FrameTitle>{t("dossier.finance.invoices")}</FrameTitle>
            <FrameDescription>{t("dossier.finance.invoicesHelp")}</FrameDescription>
          </div>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/modules/billing-collections/workflows/agency-client-billing?job=${jobId}`} />}>
            {t("dossier.finance.prepareInvoice")}
          </Button>
        </FrameHeader>
        <FramePanel className={fin.invoices.length ? "p-0" : undefined}>
          {fin.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dossier.finance.noInvoices")}</p>
          ) : (
            <RecordGrid
              rowHrefKey="href"
              emptyMessage={t("dossier.finance.noInvoices")}
              columns={[
                { id: "number", header: "modules.columns.invoice", kind: "link", hrefKey: "href" },
                { id: "feeMinor", header: "modules.columns.fee", kind: "money", align: "end" },
                { id: "mediaRecoveryMinor", header: "modules.columns.managedMedia", kind: "money", align: "end" },
                { id: "collectedMinor", header: "modules.columns.collected", kind: "money", align: "end" },
                { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
              ]}
              rows={fin.invoices.map((r) => ({ ...r, href: `${base}/records/client-invoice/${r.id}` }))}
            />
          )}
        </FramePanel>
      </Frame>
      <Frame spacing="default">
        <FrameHeader>
          <FrameTitle>{t("dossier.finance.bills")}</FrameTitle>
          <FrameDescription>{t("dossier.finance.billsHelp")}</FrameDescription>
        </FrameHeader>
        <FramePanel className={fin.bills.length ? "p-0" : undefined}>
          {fin.bills.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dossier.finance.noBills")}</p>
          ) : (
            <RecordGrid
              rowHrefKey="href"
              emptyMessage={t("dossier.finance.noBills")}
              columns={[
                { id: "invoiceNumber", header: "modules.columns.invoice", kind: "link", hrefKey: "href", subKey: "supplierName" },
                { id: "dueDate", header: "modules.columns.due", kind: "date" },
                { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
                { id: "paidMinor", header: "modules.columns.paid", kind: "money", align: "end" },
                { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
              ]}
              rows={fin.bills.map((r) => ({ ...r, href: `${base}/records/supplier-bill/${r.id}` }))}
            />
          )}
        </FramePanel>
      </Frame>
      <Frame spacing="default">
        <FrameHeader>
          <FrameTitle>{t("dossier.finance.closeChecks")}</FrameTitle>
          <FrameDescription>{t("dossier.finance.closeChecksHelp")}</FrameDescription>
        </FrameHeader>
        <FramePanel>
          <ul className="flex flex-col gap-2 text-sm">
            {fin.checks.map((c) => (
              <li key={c.id} className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <StateBadge state={c.ok ? "approved" : "blocked"} label={c.ok ? t("dossier.finance.checkOk") : t("dossier.finance.checkOpen", { n: c.count })} />
                  <span>{t(`dossier.finance.checks.${c.id}`)}</span>
                </span>
                {c.items.length > 0 && (
                  <span className="flex flex-wrap gap-x-3 gap-y-1 pl-1 text-xs text-muted-foreground">
                    {c.items.slice(0, 6).map((it) => {
                      const href = recHref(it.recordType, it.recordId)
                      return href ? (
                        <Link key={it.recordId} href={href} className="underline-offset-3 hover:underline">
                          {it.label} · {t(`records.state.${it.state}`)}
                        </Link>
                      ) : (
                        <span key={it.recordId}>
                          {it.label} · {it.state}
                        </span>
                      )
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </FramePanel>
      </Frame>
    </>
  )
}
