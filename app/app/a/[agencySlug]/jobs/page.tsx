import type { Metadata } from "next"
import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { JobImportDialog } from "@/components/jobs/job-import-dialog"
import { JobsDesk } from "@/components/jobs/jobs-desk"
import { Frame, FramePanel } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { requireAgency } from "@/server/auth/request"
import { getJobImportProfile } from "@/server/domain/job-import"
import { listClients, listJobs } from "@/server/domain/jobs"
import { getI18n } from "@/server/i18n"

export const metadata: Metadata = { title: "Jobs" }

export default async function JobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { agencySlug } = await params
  const ctx = await requireAgency(agencySlug)
  const { t } = await getI18n(ctx.tenant.timezone)
  const raw = await searchParams
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
  const safe = await listJobs(ctx, flat).catch(() => listJobs(ctx, {}))
  const clients = await listClients(ctx)
  const base = `/a/${ctx.tenant.slug}`
  // Import needs jobs.manage (the job-open command) and files.write (upload).
  const canImport = ctx.permissions.has("jobs.manage") && ctx.permissions.has("files.write")
  const importProfile = canImport ? await getJobImportProfile(ctx) : null
  return (
    <>
      <PageHeader
        title={t("jobs.title")}
        description={t("jobs.description")}
        actions={
          ctx.permissions.has("jobs.manage") ? (
            <>
              {canImport && <JobImportDialog agencySlug={ctx.tenant.slug} profile={importProfile} />}
              <Button size="sm" nativeButton={false} render={<Link href={`${base}/modules/clients-contracts/workflows/agency-job-lifecycle`} />}>
                <PlusIcon aria-hidden="true" />
                {t("jobs.newJob")}
              </Button>
            </>
          ) : null
        }
      />
      <Frame spacing="default">
        <FramePanel>
          <JobsDesk
            total={safe.total}
            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
            rows={safe.items.map((j) => ({
              id: j.id,
              jobNumber: j.jobNumber,
              displayReference: j.displayReference,
              name: j.name,
              state: j.state,
              currency: j.currency,
              clientName: j.clientName,
              ownerName: j.ownerName,
              agencyFeeMinor: j.agencyFeeMinor,
              marginBps: j.marginBps,
              nextAction: j.nextAction,
              updatedAt: j.updatedAt,
              href: `${base}/jobs/${j.id}`,
            }))}
          />
          <p className="pt-3 text-xs text-muted-foreground">{t("jobs.marginHelp")}</p>
        </FramePanel>
      </Frame>
    </>
  )
}
