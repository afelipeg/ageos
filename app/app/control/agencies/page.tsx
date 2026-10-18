import type { Metadata } from "next"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { EmptyState } from "@/components/app/states"
import { NewAgencyButton } from "@/components/control/new-agency-button"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { requireControlSession } from "@/server/auth/request"
import { listControlAgencies } from "@/server/domain/configuration"
import { getI18n } from "@/server/i18n"

export const metadata: Metadata = { title: "Your agencies" }

// control-list family (P02): agencies of the signed-in user with their
// published configuration, setup progress, latest activation and demo address.
// New agency / Resume setup / View activation / Open workspace are distinct,
// state-dependent actions; creating a draft is idempotent.
export default async function ControlAgenciesPage() {
  const session = await requireControlSession()
  const { t } = await getI18n()
  const agencies = await listControlAgencies(session)

  return (
    <>
      <PageHeader title={t("control.agencies.title")} description={t("control.agencies.description")} actions={<NewAgencyButton label={t("control.agencies.new")} />} />
      <Frame spacing="default">
        <FrameHeader>
          <FrameTitle>{t("control.agencies.listTitle")}</FrameTitle>
          <FrameDescription>{t("control.agencies.listHelp")}</FrameDescription>
        </FrameHeader>
        <FramePanel className={agencies.length ? "p-0" : undefined}>
          {agencies.length === 0 ? (
            <EmptyState title={t("control.agencies.emptyTitle")} description={t("control.agencies.emptyBody")} action={<NewAgencyButton label={t("control.agencies.new")} />} />
          ) : (
            <RecordGrid
              rowHrefKey="href"
              emptyMessage={t("control.agencies.emptyTitle")}
              columns={[
                { id: "label", header: "control.columns.agency", kind: "link", hrefKey: "href", subKey: "appName" },
                { id: "status", header: "control.columns.status", kind: "state", labelPrefix: "control.status" },
                { id: "role", header: "control.columns.role", kind: "state", labelPrefix: "header.roles" },
                { id: "published", header: "control.columns.published", kind: "text" },
                { id: "setup", header: "control.columns.setup", kind: "link", hrefKey: "setupHref", sortable: false },
                { id: "activation", header: "control.columns.activation", kind: "link", hrefKey: "activationHref", sortable: false },
                { id: "workspace", header: "control.columns.workspace", kind: "link", hrefKey: "workspaceHref", sortable: false },
              ]}
              rows={agencies.map((a) => ({
                id: a.agencyId,
                label: a.name ?? t("control.agencies.unnamed"),
                appName: a.appName ?? a.slug,
                status: a.status,
                role: a.role,
                published: a.publishedRevision ? `r${a.publishedRevision.number}` : t("control.agencies.notPublished"),
                setup: a.draft ? t("control.agencies.resume", { step: t(`control.steps.${a.draft.nextStep}.title`) }) : "—",
                setupHref: a.draft ? `/control/setup/${a.draft.id}/${a.draft.nextStep}` : `/control/agencies/${a.agencyId}`,
                activation: a.latestActivation ? t(`control.activationState.${a.latestActivation.state}`) : "—",
                activationHref: a.latestActivation ? `/control/activations/${a.latestActivation.runId}` : `/control/agencies/${a.agencyId}`,
                workspace: a.canOpenWorkspace ? t("control.agencies.open") : "—",
                workspaceHref: a.canOpenWorkspace && a.demoPath ? a.demoPath : `/control/agencies/${a.agencyId}`,
                href: `/control/agencies/${a.agencyId}`,
              }))}
            />
          )}
        </FramePanel>
      </Frame>
    </>
  )
}
