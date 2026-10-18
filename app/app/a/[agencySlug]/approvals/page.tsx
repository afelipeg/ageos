import type { Metadata } from "next"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { EmptyState } from "@/components/app/states"
import { UrlTabs } from "@/components/records/url-state"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel } from "@/components/reui/frame"
import { requireAgency } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"
import { APPROVAL_FILTERS, listApprovalsView, type ApprovalFilter } from "@/server/queries/approvals"

export const metadata: Metadata = { title: "Approvals" }

// Approval queue (solution-agents-5 adaptation): every request bound to an
// exact payload and revision. Opening a row shows the diff and decision bar;
// nothing is approved from the list or a toast.
export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>
  searchParams: Promise<{ state?: string }>
}) {
  const { agencySlug } = await params
  const { state } = await searchParams
  const ctx = await requireAgency(agencySlug)
  const { t } = await getI18n(ctx.tenant.timezone)
  const filter: ApprovalFilter = (APPROVAL_FILTERS as readonly string[]).includes(state ?? "") ? (state as ApprovalFilter) : "awaiting_approval"
  const { rows, counts } = await listApprovalsView(ctx, filter)
  const base = `/a/${ctx.tenant.slug}`
  const mine = rows.filter((r) => r.canDecide).length

  return (
    <>
      <PageHeader
        title={t("approvals.title")}
        description={t("approvals.description")}
        badges={filter === "awaiting_approval" ? <Badge variant="outline">{t("approvals.canDecideCount", { count: mine })}</Badge> : null}
      />
      <Frame spacing="default">
        <FrameHeader className="flex flex-col gap-3">
          <UrlTabs param="state" value={filter} label={t("approvals.filterLabel")} tabs={APPROVAL_FILTERS.map((f) => ({ value: f, label: t(`approvals.filters.${f}`), count: counts[f] }))} />
          <FrameDescription>{t("approvals.queueHelp")}</FrameDescription>
        </FrameHeader>
        <FramePanel className={rows.length ? "p-0" : undefined}>
          {rows.length === 0 ? (
            <EmptyState title={t("approvals.emptyTitle")} description={t(`approvals.emptyHelp.${filter}`)} />
          ) : (
            <RecordGrid
              rowHrefKey="href"
              emptyMessage={t("approvals.emptyTitle")}
              columns={[
                { id: "title", header: "approvals.columns.change", kind: "link", hrefKey: "href", subKey: "actionType" },
                { id: "state", header: "approvals.columns.state", kind: "state", labelPrefix: "records.state" },
                { id: "amountMinor", header: "approvals.columns.amount", kind: "money", align: "end" },
                { id: "requestedBy", header: "approvals.columns.requester", kind: "text" },
                { id: "eligible", header: "approvals.columns.eligible", kind: "text" },
                { id: "decide", header: "approvals.columns.you", kind: "state", labelPrefix: "approvals.you" },
                { id: "createdAt", header: "approvals.columns.created", kind: "timestamp" },
              ]}
              rows={rows.map((r) => ({
                id: r.id,
                title: r.title,
                actionType: r.actionType,
                state: r.state,
                amountMinor: r.amountMinor,
                currency: r.currency ?? ctx.tenant.baseCurrency,
                requestedBy: r.requestedBy ?? "—",
                eligible: r.eligibleRoles.map((role) => t(`header.roles.${role}`)).join(", "),
                decide: r.canDecide ? "can_decide" : r.state === "awaiting_approval" ? "cannot_decide" : "closed",
                createdAt: r.createdAt,
                href: `${base}/approvals/${r.id}`,
              }))}
            />
          )}
        </FramePanel>
      </Frame>
    </>
  )
}
