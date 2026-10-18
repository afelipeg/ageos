import type { Metadata } from "next"
import Link from "next/link"
import { FileBarChartIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { ExploreParams } from "@/components/explore/explore-params"
import { QuestionResultView } from "@/components/explore/question-result"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { requireAgency } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"
import { getQuestion, questionOptions, QUESTIONS, resolveParams, runQuestion } from "@/server/queries/explore"
import { flatParams } from "@/server/queries/shared"

export const metadata: Metadata = { title: "Explore your operation" }

// report family: a closed list of named, deterministic, read-only questions.
// The chosen question (?question=) and its typed parameters live in the URL;
// results carry their definition, sources and data cutoff. No SQL is written
// in the browser and nothing here mutates data.
export default async function ExplorePage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { agencySlug } = await params
  const sp = flatParams(await searchParams)
  const ctx = await requireAgency(agencySlug)
  const { t, date, timestamp } = await getI18n(ctx.tenant.timezone)
  const base = `/a/${ctx.tenant.slug}`
  const q = getQuestion(sp.question) ?? QUESTIONS[0]!
  const canView = ctx.permissions.has("reports.view")
  const options = await questionOptions(ctx)
  const ran = canView ? await runQuestion(ctx, q.key, sp) : null
  const current = resolveParams(sp)
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== "question"))

  return (
    <>
      <PageHeader title={t("explore.title")} description={t("explore.description")} badges={<Badge variant="outline">{t("explore.noSql")}</Badge>} />
      <div className="grid gap-6 xl:grid-cols-4">
        <Frame spacing="default" className="min-w-0 self-start">
          <FrameHeader>
            <FrameTitle>{t("explore.questionsTitle")}</FrameTitle>
          </FrameHeader>
          <FramePanel className="p-2">
            <nav aria-label={t("explore.questionsTitle")} className="flex flex-col gap-0.5">
              {QUESTIONS.map((x) => (
                <Link
                  key={x.key}
                  href={`${base}/explore?question=${x.key}`}
                  aria-current={x.key === q.key ? "page" : undefined}
                  className="rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-medium"
                >
                  {t(`explore.questions.${x.key}.title`)}
                </Link>
              ))}
            </nav>
          </FramePanel>
        </Frame>
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-3">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t(`explore.questions.${q.key}.title`)}</FrameTitle>
              <FrameDescription>{t(`explore.questions.${q.key}.help`)}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              {q.params.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("explore.noParams")}</p>
              ) : (
                <ExploreParams key={q.key} params={q.params.map((p) => ({ key: p.key, type: p.type }))} clients={options.clients} jobs={options.jobs} current={current} />
              )}
            </FramePanel>
          </Frame>
          {!canView ? (
            <p className="text-sm text-muted-foreground">{t("explore.forbidden", { role: t(`header.roles.${ctx.role}`) })}</p>
          ) : (
            ran && (
              <QuestionResultView
                t={t}
                title={t(`explore.questions.${q.key}.title`)}
                result={ran.result}
                asOfLabel={q.params.some((p) => p.type === "period") ? t("explore.period", { from: date(ran.params.from), to: date(ran.params.to) }) : t("explore.asOf", { date: date(ran.asOf) })}
                executedLabel={t("explore.executedAt", { at: timestamp(ran.executedAt) })}
                filename={`${ctx.tenant.slug}-${q.key}.csv`}
                actions={
                  <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${base}/reports/${q.key}${qs.toString() ? `?${qs.toString()}` : ""}`} />}>
                    <FileBarChartIcon aria-hidden="true" />
                    {t("explore.openReport")}
                  </Button>
                }
              />
            )
          )}
        </div>
      </div>
    </>
  )
}
