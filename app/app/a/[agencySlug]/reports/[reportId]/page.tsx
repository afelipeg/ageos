import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app/page-header"
import { StateBadge } from "@/components/app/state-badge"
import { BlockedState } from "@/components/app/states"
import { ExploreParams } from "@/components/explore/explore-params"
import { QuestionResultView } from "@/components/explore/question-result"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { requireAgency } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"
import { getQuestion, questionOptions, resolveParams, runQuestion } from "@/server/queries/explore"
import { getManagementReport } from "@/server/queries/reports"
import { getRunDetail } from "@/server/queries/runs"
import { flatParams, isUuid } from "@/server/queries/shared"

export const metadata: Metadata = { title: "Report" }

const REPORT_VERSION = "named-query@1"

// report family: either a named read-only question rendered as a report
// (filters in the URL, definitions, source manifest, cutoff, CSV download) or
// a persisted management report produced by agency-management-reporting
// (/reports/<runId>), shown exactly as its run stored it.
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; reportId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { agencySlug, reportId } = await params
  const sp = flatParams(await searchParams)
  const ctx = await requireAgency(agencySlug)
  const { t, pick, date, timestamp } = await getI18n(ctx.tenant.timezone)
  const base = `/a/${ctx.tenant.slug}`

  if (isUuid(reportId)) {
    const report = await getManagementReport(ctx, reportId)
    if (report) {
      return (
        <>
          <PageHeader
            title={report.title}
            description={`${report.period} · ${report.basis} · ${report.currency}`}
            badges={
              <>
                <Badge variant="outline">{t("explore.reports.cutOff", { date: report.cutOff ? date(report.cutOff) : "—" })}</Badge>
                {report.synthetic && <Badge variant="outline">{t("common.syntheticData")}</Badge>}
                {report.label && <Badge variant="warning-light">{report.label}</Badge>}
              </>
            }
            actions={
              report.exportFileId ? (
                <Button size="sm" variant="outline" nativeButton={false} render={<a href={`/api/a/${ctx.tenant.slug}/files/${report.exportFileId}`} download />}>
                  {t("explore.downloadCsv")}
                </Button>
              ) : null
            }
          />
          <div className="grid gap-6 lg:grid-cols-2">
            {(["totals", "definitions", "sources", "content"] as const).map((k) => (
              <Frame key={k} spacing="default" className={k === "content" ? "lg:col-span-2" : undefined}>
                <FrameHeader>
                  <FrameTitle>{t(`explore.reports.sections.${k}`)}</FrameTitle>
                </FrameHeader>
                <FramePanel>
                  <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(report[k] ?? null, null, 2)}</pre>
                </FramePanel>
              </Frame>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("explore.reports.generatedAt", { at: timestamp(report.createdAt) })}</p>
        </>
      )
    }
    const run = await getRunDetail(ctx, reportId)
    if (!run || run.run.skillId !== "agency-management-reporting") notFound()
    const out = run.run.result ?? {}
    return (
      <>
        <PageHeader
          title={run.capability ? pick(run.capability.label) : t("explore.reports.managementPack")}
          description={t("explore.reports.persistedHelp")}
          badges={
            <>
              <StateBadge state={run.run.state} label={t(`records.state.${run.run.state}`)} />
              <Badge variant="outline">{run.run.handlerVersion}</Badge>
            </>
          }
          actions={
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${base}/runs/${run.run.id}`} />}>
              {t("explore.reports.openRun")}
            </Button>
          }
        />
        {run.run.error && <BlockedState title={t(`errors.${run.run.error.code}`)} description={run.run.error.message} />}
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("explore.reports.outputTitle")}</FrameTitle>
            <FrameDescription>{t("explore.reports.generatedAt", { at: timestamp(run.run.startedAt) })}</FrameDescription>
          </FrameHeader>
          <FramePanel>
            <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(out, null, 2)}</pre>
          </FramePanel>
        </Frame>
      </>
    )
  }

  const q = getQuestion(reportId)
  if (!q) notFound()
  if (!ctx.permissions.has("reports.view")) {
    return <BlockedState title={t("states.forbiddenTitle")} description={t("explore.forbidden", { role: t(`header.roles.${ctx.role}`) })} />
  }
  const ran = (await runQuestion(ctx, q.key, sp))!
  const options = await questionOptions(ctx)
  const title = t(`explore.questions.${q.key}.title`)

  return (
    <>
      <PageHeader
        title={title}
        description={t(`explore.questions.${q.key}.help`)}
        badges={
          <>
            <Badge variant="outline" className="font-mono">
              {q.key}@{REPORT_VERSION}
            </Badge>
            <Badge variant="outline">{t("explore.asOf", { date: date(ran.asOf) })}</Badge>
          </>
        }
        actions={
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${base}/explore?question=${q.key}`} />}>
            {t("explore.reports.backToExplore")}
          </Button>
        }
      />
      {q.params.length > 0 && (
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("explore.reports.filtersTitle")}</FrameTitle>
            <FrameDescription>{t("explore.reports.filtersHelp")}</FrameDescription>
          </FrameHeader>
          <FramePanel>
            <ExploreParams params={q.params.map((p) => ({ key: p.key, type: p.type }))} clients={options.clients} jobs={options.jobs} current={resolveParams(sp)} />
          </FramePanel>
        </Frame>
      )}
      <QuestionResultView
        t={t}
        title={title}
        result={ran.result}
        asOfLabel={q.params.some((p) => p.type === "period") ? t("explore.period", { from: date(ran.params.from), to: date(ran.params.to) }) : t("explore.asOf", { date: date(ran.asOf) })}
        executedLabel={t("explore.executedAt", { at: timestamp(ran.executedAt) })}
        filename={`${ctx.tenant.slug}-${q.key}-report.csv`}
      />
    </>
  )
}
