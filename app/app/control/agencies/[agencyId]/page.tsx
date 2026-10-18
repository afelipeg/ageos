import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowUpRightIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { StateBadge } from "@/components/app/state-badge"
import { ControlDomainSimulator } from "@/components/control/control-domain"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { requireControlSession } from "@/server/auth/request"
import { listControlAgencies } from "@/server/domain/configuration"
import { getI18n } from "@/server/i18n"

export const metadata: Metadata = { title: "Agency activation" }

// record-detail family for one agency in the control plane: published
// configuration, draft progress, latest activation, demo address and the
// simulated custom domain. Only agencies the user belongs to resolve; any
// other id is 404 without revealing whether it exists.
export default async function ControlAgencyPage({ params }: { params: Promise<{ agencyId: string }> }) {
  const { agencyId } = await params
  const session = await requireControlSession()
  const a = (await listControlAgencies(session)).find((x) => x.agencyId === agencyId)
  if (!a) notFound()
  const { t, timestamp } = await getI18n()
  const isOwner = a.role === "owner"

  return (
    <>
      <PageHeader
        title={a.name ?? t("control.agencies.unnamed")}
        description={`${a.appName ?? "—"} · /a/${a.slug}`}
        badges={
          <>
            <StateBadge state={a.status === "ready" ? "ready" : a.status === "blocked" ? "blocked" : "draft"} label={t(`control.status.${a.status}`)} />
            <Badge variant="outline">{t(`header.roles.${a.role}`)}</Badge>
          </>
        }
        actions={
          <>
            {a.draft && (
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/control/setup/${a.draft.id}/${a.draft.nextStep === "review" ? "review" : a.draft.nextStep}`} />}>
                {t("control.detail.reviewConfiguration")}
              </Button>
            )}
            {a.canOpenWorkspace && a.demoPath && (
              <Button size="sm" nativeButton={false} render={<Link href={a.demoPath} />}>
                {t("control.agencies.open")}
                <ArrowUpRightIcon aria-hidden="true" />
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("control.detail.configurationTitle")}</FrameTitle>
            <FrameDescription>{t("control.detail.configurationHelp")}</FrameDescription>
          </FrameHeader>
          <FramePanel>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">{t("control.detail.published")}</dt>
              <dd>
                {a.publishedRevision ? (
                  <>
                    r{a.publishedRevision.number}
                    {a.publishedRevision.publishedAt ? ` · ${timestamp(a.publishedRevision.publishedAt)}` : ""}
                  </>
                ) : (
                  t("control.agencies.notPublished")
                )}
              </dd>
              <dt className="text-muted-foreground">{t("control.detail.draft")}</dt>
              <dd>
                {a.draft ? (
                  <Link href={`/control/setup/${a.draft.id}/${a.draft.nextStep}`} className="font-medium underline-offset-3 hover:underline">
                    {t("control.detail.draftProgress", { n: a.draft.number, done: a.draft.lastCompletedStep })}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-muted-foreground">{t("control.detail.activation")}</dt>
              <dd>
                {a.latestActivation ? (
                  <Link href={`/control/activations/${a.latestActivation.runId}`} className="font-medium underline-offset-3 hover:underline">
                    {t(`control.activationState.${a.latestActivation.state}`)}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-muted-foreground">{t("control.detail.address")}</dt>
              <dd className="font-mono text-xs">{a.demoPath ?? t("control.detail.notActive")}</dd>
            </dl>
          </FramePanel>
        </Frame>

        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("control.detail.domainTitle")}</FrameTitle>
            <FrameDescription>{t("control.detail.domainHelp")}</FrameDescription>
          </FrameHeader>
          <FramePanel className="flex flex-col gap-3">
            {a.domain.requested ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs">{a.domain.requested}</span>
                  <Badge variant="outline">{t("common.simulated")}</Badge>
                  <Badge variant="outline">{t(`records.state.${a.domain.state}`)}</Badge>
                </div>
                <ControlDomainSimulator agencyId={a.agencyId} state={a.domain.state} allowed={isOwner && a.status === "ready"} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("control.detail.noDomain")}</p>
            )}
          </FramePanel>
        </Frame>
      </div>
      <p className="text-xs text-muted-foreground">{t("control.detail.logicalNote")}</p>
    </>
  )
}
