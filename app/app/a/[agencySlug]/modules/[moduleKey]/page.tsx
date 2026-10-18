import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowUpRightIcon, PlusIcon, WorkflowIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { EmptyState } from "@/components/app/states"
import { PaymentRunPreview } from "@/components/modules/payment-run-preview"
import { RecordCommandForm } from "@/components/records/record-command"
import { ClearFiltersButton, UrlPager, UrlSearch, UrlTabs } from "@/components/records/url-state"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { MARGIN_FLOOR_BPS } from "@/lib/demo"
import { requireAgency } from "@/server/auth/request"
import { listConnections } from "@/server/domain/connections"
import { getBusinessDate } from "@/server/domain/presenter"
import { loadReferenceOptions } from "@/server/domain/references"
import { getI18n } from "@/server/i18n"
import { getModuleDesk } from "@/server/queries/modules"
import { flatParams, positiveInt } from "@/server/queries/shared"

export const metadata: Metadata = { title: "Module desk" }

// module-desk family: one page for the nine modules. Allowlisted views
// (?view=), search (?q=) and paging (?page=) live in the URL; rows open the
// authorized record; the module's capabilities link to their workbenches with
// their registry status (registered / handler implemented / scenario verified).
export default async function ModuleDeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; moduleKey: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { agencySlug, moduleKey } = await params
  const sp = flatParams(await searchParams)
  const ctx = await requireAgency(agencySlug)
  const desk = await getModuleDesk(ctx, moduleKey, { view: sp.view, q: sp.q, page: positiveInt(sp.page) })
  if (!desk) notFound()
  const { t, pick, pct } = await getI18n(ctx.tenant.timezone)
  const base = `/a/${ctx.tenant.slug}`
  const v = desk.active
  const createCap = v.createSkill ? desk.capabilities.find((c) => c.skillId === v.createSkill) : undefined
  const canCreate = Boolean(createCap && createCap.canExecute && createCap.availability !== "disabled")
  const createHref = createCap ? createCap.href : null
  const implemented = desk.capabilities.filter((c) => c.status !== "registered").length
  const paymentBanks =
    moduleKey === "suppliers-payments" && v.key === "payment-runs" && (ctx.permissions.has("payables.manage") || ctx.permissions.has("payments.execute"))
      ? (await listConnections(ctx)).filter((c) => c.provider === "demo_bank").map((c) => ({ value: c.id, label: `${c.accountAlias} · ${t(`records.state.${c.state}`)}` }))
      : null
  const businessDate = paymentBanks ? await getBusinessDate() : null
  const issueRefs = moduleKey === "work-production" && ctx.permissions.has("production.manage") ? await loadReferenceOptions(ctx, ["job", "supplier"]) : null

  return (
    <>
      <PageHeader
        title={pick(desk.module.label)}
        description={t(`modules.descriptions.${moduleKey}`)}
        badges={
          <>
            <Badge variant="outline">{t("modules.capabilityCount", { count: desk.capabilities.length })}</Badge>
            <Badge variant="outline">{t("modules.implementedCount", { count: implemented, total: desk.capabilities.length })}</Badge>
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/capabilities?module=${moduleKey}`} />}>
              <WorkflowIcon aria-hidden="true" />
              {t("modules.openCatalog")}
            </Button>
            {createHref && canCreate && (
              <Button size="sm" nativeButton={false} render={<Link href={createHref} />}>
                <PlusIcon aria-hidden="true" />
                {pick(createCap!.primaryAction)}
              </Button>
            )}
          </>
        }
      />

      {moduleKey === "profitability" && (
        <Alert variant="info">
          <WorkflowIcon aria-hidden="true" />
          <AlertTitle>{t("modules.namedQuery.title")}</AlertTitle>
          <AlertDescription>{t("modules.namedQuery.body", { floor: pct(MARGIN_FLOOR_BPS) })}</AlertDescription>
          <AlertAction className="flex flex-wrap gap-2">
            <Button size="sm" variant={v.key === "losing-margin" ? "secondary" : "outline"} nativeButton={false} render={<Link href={`${base}/modules/profitability?view=losing-margin`} />}>
              {t("modules.namedQuery.run")}
            </Button>
            <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`${base}/explore?question=jobs-losing-margin`} />}>
              {t("modules.namedQuery.explore")}
              <ArrowUpRightIcon aria-hidden="true" />
            </Button>
          </AlertAction>
        </Alert>
      )}

      <Frame spacing="default">
        <FrameHeader className="flex flex-col gap-3">
          <UrlTabs param="view" value={v.key} label={t("modules.viewsLabel")} tabs={desk.views.map((x) => ({ value: x.key, label: t(x.labelKey) }))} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <FrameDescription>{t(v.descriptionKey)}</FrameDescription>
            <UrlSearch placeholder={t("modules.searchPlaceholder")} />
          </div>
        </FrameHeader>
        <FramePanel className={v.rows.length ? "p-0" : undefined}>
          {v.rows.length === 0 ? (
            desk.q ? (
              <EmptyState title={t("states.noResultsTitle")} description={t("modules.noResults", { q: desk.q })} action={<ClearFiltersButton keep={["view"]}>{t("common.clearFilters")}</ClearFiltersButton>} />
            ) : (
              <EmptyState
                title={t("modules.emptyTitle")}
                description={t(`modules.emptyHelp.${v.key}`)}
                action={
                  createHref && canCreate ? (
                    <Button size="sm" nativeButton={false} render={<Link href={createHref} />}>
                      <PlusIcon aria-hidden="true" />
                      {pick(createCap!.primaryAction)}
                    </Button>
                  ) : createHref ? (
                    <Button size="sm" variant="outline" nativeButton={false} render={<Link href={createHref} />}>
                      {t("modules.openWorkflow")}
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <RecordGrid rows={v.rows} columns={v.columns} emptyMessage={t("modules.emptyTitle")} pageSize={desk.pageSize} rowHrefKey={v.rowHrefKey} />
          )}
        </FramePanel>
        <UrlPager page={desk.page} pageSize={desk.pageSize} total={desk.totalRows} />
      </Frame>

      {paymentBanks && businessDate && (
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("modules.paymentPreview.title")}</FrameTitle>
            <FrameDescription>{t("modules.paymentPreview.help")}</FrameDescription>
          </FrameHeader>
          <FramePanel>
            <PaymentRunPreview agencySlug={ctx.tenant.slug} banks={paymentBanks} defaultDate={businessDate} />
          </FramePanel>
        </Frame>
      )}

      {issueRefs && (
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("modules.issueOrder.title")}</FrameTitle>
            <FrameDescription>{t("modules.issueOrder.help")}</FrameDescription>
          </FrameHeader>
          <FramePanel>
            <RecordCommandForm
              agencySlug={ctx.tenant.slug}
              command="production.issueProductionOrder"
              fixed={{}}
              fields={[
                { key: "job", type: "select", label: "records.commands.job", required: true, options: (issueRefs.job ?? []).map((o) => ({ value: o.value, label: o.label })) },
                { key: "supplier", type: "select", label: "records.commands.supplier", required: true, options: (issueRefs.supplier ?? []).map((o) => ({ value: o.value, label: o.label })) },
                { key: "amount", type: "decimal", label: "records.commands.amount", required: true, currency: ctx.tenant.baseCurrency },
                { key: "deliverable", type: "text", label: "records.commands.deliverable", required: true },
              ]}
              buttons={[{ label: "records.commands.issueProductionOrder" }]}
            />
          </FramePanel>
        </Frame>
      )}

      <Frame spacing="default">
        <FrameHeader className="flex-row items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <FrameTitle>{t("modules.capabilitiesTitle")}</FrameTitle>
            <FrameDescription>{t("modules.capabilitiesHelp")}</FrameDescription>
          </div>
        </FrameHeader>
        <FramePanel className="p-0">
          <RecordGrid
            emptyMessage={t("modules.emptyTitle")}
            rowHrefKey="href"
            pageSize={10}
            columns={[
              { id: "label", header: "catalog.columns.capability", kind: "link", hrefKey: "href", subKey: "skillId" },
              { id: "status", header: "catalog.columns.status", kind: "state", labelPrefix: "records.state" },
              { id: "availability", header: "catalog.columns.availability", kind: "state", labelPrefix: "catalog.availability" },
              { id: "approvalMode", header: "catalog.columns.approval", kind: "state", labelPrefix: "workbench.approvalMode" },
              { id: "access", header: "catalog.columns.access", kind: "state", labelPrefix: "catalog.access" },
            ]}
            rows={desk.capabilities.map((c) => ({
              id: c.skillId,
              label: pick(c.label),
              skillId: c.skillId,
              status: c.status,
              availability: c.availability,
              approvalMode: c.approvalMode,
              access: c.canExecute ? "execute" : c.canView ? "view" : "none",
              href: c.href,
            }))}
          />
        </FramePanel>
      </Frame>
    </>
  )
}
