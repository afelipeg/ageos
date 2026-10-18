import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { PencilIcon, PlusIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { StateBadge } from "@/components/app/state-badge"
import { EmptyState, PendingHandlerState } from "@/components/app/states"
import { UrlTabs } from "@/components/records/url-state"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { requireAgency } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"
import { getClientRecord } from "@/server/queries/clients"

export const metadata: Metadata = { title: "Client" }

const TABS = ["overview", "jobs", "contracts", "invoices", "files"] as const
type Tab = (typeof TABS)[number]

// record-detail family for a client: identity, owner and billing profile,
// then ?tab= overview | jobs | contracts | invoices | files. Same records the
// Clients & contracts desk, the dossier and the assistant read.
export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; clientId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { agencySlug, clientId } = await params
  const { tab: rawTab } = await searchParams
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "overview"
  const ctx = await requireAgency(agencySlug)
  const d = await getClientRecord(ctx, clientId)
  if (!d) notFound()
  const { t, money, date } = await getI18n(ctx.tenant.timezone)
  const base = `/a/${ctx.tenant.slug}`
  const c = d.client
  const canManage = ctx.permissions.has("clients.manage")
  const canOpenJob = ctx.permissions.has("jobs.manage")

  return (
    <>
      <PageHeader
        title={c.name}
        description={`${c.code}-${c.productCode} · ${c.country} · ${c.billingCurrency}`}
        badges={
          <>
            <StateBadge state={c.state} label={t(`records.state.${c.state}`)} />
            <Badge variant="outline">{t("common.syntheticData")}</Badge>
          </>
        }
        actions={
          <>
            {canManage && (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/modules/setup/workflows/agency-master-data?client=${c.id}`} />}>
                <PencilIcon aria-hidden="true" />
                {t("clients.edit")}
              </Button>
            )}
            {canOpenJob && (
              <Button size="sm" nativeButton={false} render={<Link href={`${base}/modules/clients-contracts/workflows/agency-job-lifecycle?client=${c.id}`} />}>
                <PlusIcon aria-hidden="true" />
                {t("clients.newJob")}
              </Button>
            )}
          </>
        }
      />

      <UrlTabs
        param="tab"
        value={tab}
        label={t("clients.tabsLabel")}
        tabs={TABS.map((k) => ({ value: k, label: t(`clients.tabs.${k}`), count: k === "jobs" ? d.jobs.length : k === "contracts" ? d.contracts.length : k === "files" ? d.files.length : undefined }))}
      />

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Frame spacing="default" className="min-w-0 lg:col-span-2">
            <FrameHeader>
              <FrameTitle>{t("clients.briefs")}</FrameTitle>
            </FrameHeader>
            <FramePanel className="flex flex-col gap-3">
              {d.briefs.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("clients.noBriefs")}</p>
              ) : (
                d.briefs.map((b) => (
                  <div key={b.id} className="flex flex-col gap-0.5 text-sm">
                    <span className="font-medium">{b.title}</span>
                    <span className="text-muted-foreground">{b.summary}</span>
                  </div>
                ))
              )}
            </FramePanel>
          </Frame>
          <Frame spacing="default" className="min-w-0">
            <FrameHeader>
              <FrameTitle>{t("clients.profile")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">{t("clients.owner")}</dt>
                <dd>{d.ownerName ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("clients.billingCurrency")}</dt>
                <dd className="font-mono text-xs">{c.billingCurrency}</dd>
                <dt className="text-muted-foreground">{t("clients.creditLimit")}</dt>
                <dd className="ageos-figure tabular-nums">{money(c.creditLimitMinor, c.billingCurrency)}</dd>
                <dt className="text-muted-foreground">{t("clients.fiscalProfile")}</dt>
                <dd className="font-mono text-xs">{c.fiscalProfile}</dd>
                <dt className="text-muted-foreground">{t("clients.jobCount")}</dt>
                <dd className="tabular-nums">{d.jobs.length}</dd>
              </dl>
            </FramePanel>
          </Frame>
        </div>
      )}

      {tab === "jobs" && (
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("clients.tabs.jobs")}</FrameTitle>
          </FrameHeader>
          <FramePanel className={d.jobs.length ? "p-0" : undefined}>
            {d.jobs.length === 0 ? (
              <EmptyState
                title={t("clients.noJobs")}
                action={
                  canOpenJob ? (
                    <Button size="sm" nativeButton={false} render={<Link href={`${base}/modules/clients-contracts/workflows/agency-job-lifecycle?client=${c.id}`} />}>
                      {t("clients.newJob")}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <RecordGrid
                emptyMessage={t("clients.noJobs")}
                rowHrefKey="href"
                columns={[
                  { id: "name", header: "jobs.columns.name", kind: "link", hrefKey: "href", subKey: "displayReference" },
                  { id: "jobNumber", header: "jobs.columns.jobNumber", kind: "mono" },
                  { id: "state", header: "jobs.columns.state", kind: "state", labelPrefix: "records.state" },
                ]}
                rows={d.jobs.map((j) => ({ ...j, href: `${base}/jobs/${j.id}` }))}
              />
            )}
          </FramePanel>
        </Frame>
      )}

      {tab === "contracts" && (
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("clients.tabs.contracts")}</FrameTitle>
            <FrameDescription>{t("clients.contractsHelp")}</FrameDescription>
          </FrameHeader>
          <FramePanel className={d.contracts.length ? "p-0" : undefined}>
            {d.contracts.length === 0 ? (
              <EmptyState title={t("clients.noContracts")} />
            ) : (
              <RecordGrid
                emptyMessage={t("clients.noContracts")}
                rowHrefKey="href"
                columns={[
                  { id: "reference", header: "modules.columns.reference", kind: "link", hrefKey: "href" },
                  { id: "kind", header: "modules.columns.kind", kind: "state", labelPrefix: "modules.kinds" },
                  { id: "revisionNumber", header: "modules.columns.revision", kind: "number", align: "end" },
                  { id: "amountMinor", header: "modules.columns.amount", kind: "money", align: "end" },
                  { id: "validity", header: "modules.columns.validity", kind: "text" },
                  { id: "state", header: "modules.columns.state", kind: "state", labelPrefix: "records.state" },
                ]}
                rows={d.contracts.map((k) => ({
                  id: k.id,
                  reference: k.reference,
                  kind: k.kind,
                  revisionNumber: k.revisionNumber,
                  amountMinor: k.amountMinor.toString(),
                  currency: k.currency,
                  validity: k.validFrom || k.validTo ? `${k.validFrom ? date(k.validFrom) : "…"} → ${k.validTo ? date(k.validTo) : "…"}` : "—",
                  state: k.state,
                  href: `${base}/records/contract/${k.id}`,
                }))}
              />
            )}
          </FramePanel>
        </Frame>
      )}

      {tab === "invoices" && <PendingHandlerState title={t("clients.invoicesPendingTitle")} description={t("clients.invoicesPendingBody")} />}

      {tab === "files" && (
        <Frame spacing="default">
          <FrameHeader className="flex-row items-start justify-between gap-2">
            <FrameTitle>{t("clients.tabs.files")}</FrameTitle>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/library`} />}>
              {t("clients.openLibrary")}
            </Button>
          </FrameHeader>
          <FramePanel className={d.files.length ? "p-0" : undefined}>
            {d.files.length === 0 ? (
              <EmptyState title={t("clients.noFiles")} />
            ) : (
              <RecordGrid
                emptyMessage={t("clients.noFiles")}
                rowHrefKey="href"
                columns={[
                  { id: "originalName", header: "dossier.files.columns.name", kind: "link", hrefKey: "href" },
                  { id: "format", header: "dossier.files.columns.format", kind: "mono" },
                  { id: "version", header: "dossier.files.columns.version", kind: "number", align: "end" },
                  { id: "extractionStatus", header: "dossier.files.columns.status", kind: "state", labelPrefix: "records.state" },
                  { id: "createdAt", header: "dossier.files.columns.uploaded", kind: "timestamp" },
                ]}
                rows={d.files.map((f) => ({ ...f, href: `${base}/library/${f.id}` }))}
              />
            )}
          </FramePanel>
        </Frame>
      )}
    </>
  )
}
