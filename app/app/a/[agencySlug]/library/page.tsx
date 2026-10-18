import type { Metadata } from "next"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { EmptyState } from "@/components/app/states"
import { UploadDialog } from "@/components/library/upload-dialog"
import { ClearFiltersButton, UrlChoice, UrlSearch, UrlSelect } from "@/components/records/url-state"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel } from "@/components/reui/frame"
import { requireAgency } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"
import { FILE_FORMATS, listLibrary } from "@/server/queries/library"
import { flatParams, isUuid } from "@/server/queries/shared"

export const metadata: Metadata = { title: "Library" }

const STATUSES = ["stored", "analyzed", "not_analyzed", "prepared_demo_extraction", "failed"] as const

function mb(bytes: number) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10
}

// file-library family (solution-files-1 adaptation): private PDF/DOCX/XLSX/CSV
// documents, latest version per document, job link and extraction status.
// Uploads are validated and stored server-side; "Stored" never means
// "Analyzed". Filters (job, format, status, search) live in the URL.
export default async function LibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { agencySlug } = await params
  const sp = flatParams(await searchParams)
  const ctx = await requireAgency(agencySlug)
  const { t } = await getI18n(ctx.tenant.timezone)
  const job = sp.job === "none" || isUuid(sp.job) ? sp.job : undefined
  const format = (FILE_FORMATS as readonly string[]).includes(sp.format ?? "") ? sp.format : undefined
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined
  const data = await listLibrary(ctx, { job, format, status, q: sp.q })
  const base = `/a/${ctx.tenant.slug}`
  const canWrite = ctx.permissions.has("files.write")
  const filtered = Boolean(job || format || status || sp.q)
  const overQuota = data.limits.usedBytes >= data.limits.storageMb * 1024 * 1024

  return (
    <>
      <PageHeader
        title={t("library.title")}
        description={t("library.description")}
        badges={
          <>
            <Badge variant="outline">{t("library.private")}</Badge>
            <Badge variant={overQuota ? "warning-light" : "outline"}>{t("library.usage", { used: mb(data.limits.usedBytes), limit: data.limits.storageMb, files: data.limits.fileCount })}</Badge>
          </>
        }
        actions={<UploadDialog agencySlug={ctx.tenant.slug} jobs={data.jobs} defaultJob={job && job !== "none" ? job : null} allowed={canWrite && !overQuota} triggerLabel={t("library.upload")} />}
      />
      {!canWrite && <p className="text-xs text-muted-foreground">{t("library.readOnly", { role: t(`header.roles.${ctx.role}`) })}</p>}
      {overQuota && <p className="text-xs text-muted-foreground">{t("library.quotaReached")}</p>}

      <Frame spacing="default">
        <FrameHeader className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
            <UrlSelect param="job" value={job ?? null} label={t("library.filters.job")} allLabel={t("library.filters.allJobs")} options={[{ value: "none", label: t("library.noJob") }, ...data.jobs.map((j) => ({ value: j.id, label: j.label }))]} />
            <UrlChoice param="format" value={format ?? "all"} label={t("library.filters.format")} options={[{ value: "all", label: t("library.filters.allFormats") }, ...FILE_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))]} />
            <UrlSearch placeholder={t("library.searchPlaceholder")} className="w-full lg:ml-auto lg:max-w-xs" />
          </div>
          <UrlChoice param="status" value={status ?? "all"} label={t("library.filters.status")} options={[{ value: "all", label: t("library.filters.allStatuses") }, ...STATUSES.map((s) => ({ value: s, label: t(`records.state.${s}`) }))]} />
          <FrameDescription>{t("library.storedVsAnalyzed")}</FrameDescription>
        </FrameHeader>
        <FramePanel className={data.rows.length ? "p-0" : undefined}>
          {data.rows.length === 0 ? (
            filtered ? (
              <EmptyState title={t("states.noResultsTitle")} description={t("library.noResults")} action={<ClearFiltersButton>{t("common.clearFilters")}</ClearFiltersButton>} />
            ) : (
              <EmptyState
                title={t("library.emptyTitle")}
                description={t("library.emptyBody")}
                action={<UploadDialog agencySlug={ctx.tenant.slug} jobs={data.jobs} allowed={canWrite && !overQuota} triggerLabel={t("library.uploadFirst")} />}
              />
            )
          ) : (
            <RecordGrid
              rowHrefKey="href"
              emptyMessage={t("library.emptyTitle")}
              columns={[
                { id: "originalName", header: "library.columns.name", kind: "link", hrefKey: "href", subKey: "jobLabel" },
                { id: "formatLabel", header: "library.columns.format", kind: "mono" },
                { id: "version", header: "library.columns.version", kind: "number", align: "end" },
                { id: "extractionStatus", header: "library.columns.status", kind: "state", labelPrefix: "records.state" },
                { id: "size", header: "library.columns.size", kind: "text", align: "end" },
                { id: "uploadedBy", header: "library.columns.uploadedBy", kind: "text" },
                { id: "createdAt", header: "library.columns.uploaded", kind: "timestamp" },
              ]}
              rows={data.rows.map((r) => ({
                id: r.id,
                originalName: r.originalName,
                jobLabel: r.jobLabel ?? t("library.noJob"),
                formatLabel: r.format.toUpperCase(),
                version: r.version,
                extractionStatus: r.extractionStatus,
                size: `${Math.max(1, Math.round(r.sizeBytes / 1024))} KB`,
                uploadedBy: r.uploadedBy ?? (r.synthetic === "uploaded" ? "—" : t("library.demoFixture")),
                createdAt: r.createdAt,
                href: `${base}/library/${r.id}`,
              }))}
            />
          )}
        </FramePanel>
      </Frame>
    </>
  )
}
