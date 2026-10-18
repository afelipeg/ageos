import Link from "next/link"

import { RecordGrid } from "@/components/app/record-grid"
import { EmptyState } from "@/components/app/states"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import type { QuestionResult } from "@/server/queries/explore"

import { DownloadCsv } from "./download-csv"

/** Results of one named read-only question: table, definition, sources and cutoff. */
export function QuestionResultView({
  t,
  title,
  result,
  asOfLabel,
  executedLabel,
  filename,
  actions,
}: {
  t: (k: string, p?: Record<string, string | number>) => string
  title: string
  result: QuestionResult
  asOfLabel: string
  executedLabel: string
  filename: string
  actions?: React.ReactNode
}) {
  const unique = Array.from(new Map(result.sources.map((s) => [s.href + s.label, s])).values())
  return (
    <div className="flex flex-col gap-6">
      <Frame spacing="default">
        <FrameHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <FrameTitle className="flex flex-wrap items-center gap-2">
              {title}
              <Badge variant="outline">{t("explore.deterministic")}</Badge>
              <Badge variant="outline">{t(`explore.basis.${result.basis}`)}</Badge>
            </FrameTitle>
            <FrameDescription>
              {asOfLabel} · {executedLabel}
            </FrameDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {actions}
            <DownloadCsv filename={filename} columns={result.columns} rows={result.rows} meta={[title, asOfLabel, executedLabel, t(result.definitionKey)]} />
          </div>
        </FrameHeader>
        <FramePanel className={result.rows.length ? "p-0" : undefined}>
          {result.rows.length === 0 ? (
            <EmptyState title={t("explore.noRowsTitle")} description={t("explore.noRowsBody")} />
          ) : (
            <RecordGrid rows={result.rows} columns={result.columns} emptyMessage={t("explore.noRowsTitle")} rowHrefKey={result.rows.some((r) => typeof r.href === "string") ? "href" : undefined} pageSize={20} />
          )}
        </FramePanel>
      </Frame>
      <div className="grid gap-6 lg:grid-cols-2">
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("explore.definitionTitle")}</FrameTitle>
          </FrameHeader>
          <FramePanel>
            <p className="text-sm">{t(result.definitionKey)}</p>
          </FramePanel>
        </Frame>
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("explore.sourcesTitle")}</FrameTitle>
            <FrameDescription>{t("explore.sourcesHelp")}</FrameDescription>
          </FrameHeader>
          <FramePanel>
            {unique.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("explore.noSources")}</p>
            ) : (
              <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto text-sm">
                {unique.map((s) => (
                  <li key={s.href + s.label}>
                    <Link href={s.href} className="underline-offset-3 hover:underline">
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </FramePanel>
        </Frame>
      </div>
    </div>
  )
}
