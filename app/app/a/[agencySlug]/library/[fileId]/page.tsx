import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { DownloadIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { StateBadge } from "@/components/app/state-badge"
import { BlockedState, PendingHandlerState } from "@/components/app/states"
import { LinkJob } from "@/components/library/link-job"
import { UploadDialog } from "@/components/library/upload-dialog"
import { Badge } from "@/components/reui/badge"
import { FileType } from "@/components/reui/file-type"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline"
import { Button } from "@/components/ui/button"
import { eventLabel } from "@/components/records/code-label"
import { MESSAGES } from "@/lib/i18n/messages"
import { requireAgency } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"
import { getFileView } from "@/server/queries/library"

export const metadata: Metadata = { title: "Document" }

// record-detail family for a private document: metadata (hash, size, MIME,
// uploader), versions with authorized downloads, job link, the extraction as
// stored (Stored ≠ Analyzed) and the audit trail of the document.
export default async function FileDetailPage({ params }: { params: Promise<{ agencySlug: string; fileId: string }> }) {
  const { agencySlug, fileId } = await params
  const ctx = await requireAgency(agencySlug)
  const v = await getFileView(ctx, fileId)
  if (!v) notFound()
  const { t, timestamp, locale } = await getI18n(ctx.tenant.timezone)
  const base = `/a/${ctx.tenant.slug}`
  const f = v.file
  const x = f.extraction ?? {}
  const canWrite = ctx.permissions.has("files.write")
  const csv = f.extractionStatus === "analyzed" && Array.isArray(x.headers)
  const headers = (csv ? (x.headers as string[]) : []).slice(0, 12)
  const preview = csv && Array.isArray(x.preview) ? (x.preview as string[][]) : []
  const download = (id: string) => `/api/a/${ctx.tenant.slug}/files/${id}`

  return (
    <>
      <PageHeader
        title={f.originalName}
        description={v.job ? `${v.job.ref} · ${v.job.name}` : t("library.noJob")}
        badges={
          <>
            <FileType type={f.format} size="xs" aria-hidden="true" />
            <StateBadge state={f.extractionStatus} label={t(`records.state.${f.extractionStatus}`)} />
            <Badge variant="outline">v{f.version}</Badge>
            {f.visibility === "restricted" && <Badge variant="warning-light">{t("library.restricted")}</Badge>}
            {f.synthetic !== "uploaded" && <Badge variant="outline">{t("common.syntheticData")}</Badge>}
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={download(f.id)} download />}>
              <DownloadIcon aria-hidden="true" />
              {t("library.download")}
            </Button>
            <UploadDialog agencySlug={ctx.tenant.slug} jobs={v.jobs} logicalId={f.logicalId} allowed={canWrite} triggerLabel={t("library.newVersion")} />
          </>
        }
      />
      {f.id !== v.latestId && (
        <BlockedState
          title={t("library.olderVersionTitle")}
          description={t("library.olderVersionBody", { v: f.version })}
          action={
            <Button size="sm" nativeButton={false} render={<Link href={`${base}/library/${v.latestId}`} />}>
              {t("library.openLatest")}
            </Button>
          }
        />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("library.extractionTitle")}</FrameTitle>
              <FrameDescription>{t("library.storedVsAnalyzed")}</FrameDescription>
            </FrameHeader>
            {csv ? (
              <FramePanel className="flex flex-col gap-3 p-0">
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-sm">
                  <span>{t("library.csv.columns", { n: Number(x.columnCount ?? headers.length) })}</span>
                  <span>{t("library.csv.rows", { n: Number(x.rowCount ?? 0) })}</span>
                  <span className="font-mono text-xs">{t("library.csv.delimiter", { d: String(x.delimiter) === "\t" ? "TAB" : String(x.delimiter) })}</span>
                  {Number(x.formulaLikeCells ?? 0) > 0 && <Badge variant="warning-light">{t("library.csv.formulaCells", { n: Number(x.formulaLikeCells) })}</Badge>}
                </div>
                <RecordGrid
                  compact
                  emptyMessage={t("library.csv.noRows")}
                  columns={headers.map((h, i) => ({ id: `c${i}`, header: h || `#${i + 1}`, kind: "text" as const, sortable: false }))}
                  rows={preview.map((r, ri) => ({ id: `r${ri}`, ...Object.fromEntries(headers.map((_, i) => [`c${i}`, r[i] ?? ""])) }))}
                />
                <p className="px-4 pb-3 text-xs text-muted-foreground">{t("library.csv.previewNote")}</p>
              </FramePanel>
            ) : (
              <FramePanel className="flex flex-col gap-3">
                {f.extractionStatus === "prepared_demo_extraction" ? (
                  <>
                    <PendingHandlerState title={t("library.prepared.title")} description={t("library.prepared.body")} />
                    <pre className="max-h-60 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(x, null, 2)}</pre>
                  </>
                ) : (
                  <PendingHandlerState
                    title={t(`library.notAnalyzed.${f.format === "pdf" ? "pdfTitle" : "title"}`)}
                    description={t(`library.notAnalyzed.${f.format === "pdf" ? "pdfBody" : "body"}`)}
                  />
                )}
              </FramePanel>
            )}
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("library.versionsTitle")}</FrameTitle>
              <FrameDescription>{t("library.versionsHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel className="p-0">
              <RecordGrid
                compact
                rowHrefKey="href"
                emptyMessage={t("library.emptyTitle")}
                columns={[
                  { id: "label", header: "library.columns.version", kind: "link", hrefKey: "href" },
                  { id: "extractionStatus", header: "library.columns.status", kind: "state", labelPrefix: "records.state" },
                  { id: "hash", header: "library.columns.sha256", kind: "mono" },
                  { id: "uploadedBy", header: "library.columns.uploadedBy", kind: "text" },
                  { id: "createdAt", header: "library.columns.uploaded", kind: "timestamp" },
                  { id: "dl", header: "library.columns.download", kind: "link", hrefKey: "downloadHref", sortable: false },
                ]}
                rows={v.versions.map((ver) => ({
                  id: ver.id,
                  label: `v${ver.version}${ver.id === f.id ? ` · ${t("library.thisVersion")}` : ""}`,
                  extractionStatus: ver.extractionStatus,
                  hash: `${ver.sha256.slice(0, 12)}…`,
                  uploadedBy: ver.uploadedBy ?? "—",
                  createdAt: ver.createdAt,
                  dl: t("library.download"),
                  downloadHref: download(ver.id),
                  href: `${base}/library/${ver.id}`,
                }))}
              />
            </FramePanel>
          </Frame>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("library.metadataTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel className="flex flex-col gap-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">{t("library.meta.format")}</dt>
                <dd className="font-mono text-xs">{f.format.toUpperCase()} · {f.mimeType}</dd>
                <dt className="text-muted-foreground">{t("library.meta.size")}</dt>
                <dd className="tabular-nums">{t("library.meta.bytes", { n: f.sizeBytes })}</dd>
                <dt className="text-muted-foreground">{t("library.meta.sha256")}</dt>
                <dd className="font-mono text-xs break-all">{f.sha256}</dd>
                <dt className="text-muted-foreground">{t("library.meta.uploadedBy")}</dt>
                <dd>{f.uploadedBy ?? t("library.demoFixture")}</dd>
                <dt className="text-muted-foreground">{t("library.meta.uploaded")}</dt>
                <dd>{timestamp(f.createdAt)}</dd>
                <dt className="text-muted-foreground">{t("library.meta.visibility")}</dt>
                <dd>{t(`library.visibility.${f.visibility}`)}</dd>
                <dt className="text-muted-foreground">{t("library.meta.job")}</dt>
                <dd className="min-w-0 truncate">
                  {v.job ? (
                    <Link href={`${base}/jobs/${v.job.id}?tab=files`} className="font-medium underline-offset-3 hover:underline">
                      {v.job.ref} · {v.job.name}
                    </Link>
                  ) : (
                    t("library.noJob")
                  )}
                </dd>
              </dl>
              <LinkJob agencySlug={ctx.tenant.slug} fileId={f.id} current={v.job?.id ?? null} jobs={v.jobs} allowed={canWrite} />
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("library.activityTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              {v.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("library.noActivity")}</p>
              ) : (
                <Timeline>
                  {v.events.map((e, idx) => (
                    <TimelineItem key={e.id} step={idx + 1}>
                      <TimelineHeader>
                        <TimelineDate>{timestamp(e.recordedAt)}</TimelineDate>
                        <TimelineTitle>{eventLabel(MESSAGES[locale], t, e.eventType)}</TimelineTitle>
                      </TimelineHeader>
                      <TimelineIndicator />
                      <TimelineSeparator />
                      <TimelineContent className="text-xs text-muted-foreground">
                        {e.actor ?? "—"} · {t(`records.origin.${e.origin}`)}
                      </TimelineContent>
                    </TimelineItem>
                  ))}
                </Timeline>
              )}
            </FramePanel>
          </Frame>
        </div>
      </div>
    </>
  )
}
