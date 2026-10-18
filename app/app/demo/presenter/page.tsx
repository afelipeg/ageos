import type { Metadata } from "next"
import Link from "next/link"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { ClockPanel, FailureModes, PersonaSwitcher, ResetPanel } from "@/components/presenter/presenter-panels"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { JOURNEYS, journeyStepHref, type DemoCheckpoint } from "@/lib/demo/journeys"
import { fixtureUuid } from "@/lib/fixture-ids"
import { requirePresenter } from "@/server/auth/request"
import { getDemoClock, listPersonas, MAX_CLOCK_ADVANCE_DAYS } from "@/server/domain/presenter"
import { getI18n } from "@/server/i18n"
import { listSimulationDirectives } from "@/server/queries/presenter"

export const metadata: Metadata = { title: "Presenter controls" }

const CHECKPOINTS: DemoCheckpoint[] = ["ready_for_scope_review", "from_intake"]

// settings-form family for the authorized presenter: synthetic personas,
// demo reset and checkpoints (typed in-product confirmation, audited, demo
// tenants only), the fixed business clock, queued simulated outcomes and the
// J01–J10 journey launcher. Arbitrary visitors never reach this page.
export default async function PresenterPage() {
  const session = await requirePresenter()
  const { t, pick, date, timestamp } = await getI18n()
  const personas = listPersonas(session)
  const clock = await getDemoClock()
  const directives = await listSimulationDirectives().catch(() => [])

  return (
    <>
      <PageHeader
        title={t("presenter.title")}
        description={t("presenter.description")}
        badges={
          <>
            <Badge variant="outline">{t("presenter.businessDate", { date: date(clock.businessDate) })}</Badge>
            {clock.checkpoint && <Badge variant="outline">{t(`presenter.checkpoints.${clock.checkpoint}`)}</Badge>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("presenter.personas.title")}</FrameTitle>
            <FrameDescription>{t("presenter.personas.help")}</FrameDescription>
          </FrameHeader>
          <FramePanel>
            <PersonaSwitcher personas={personas.map((p) => ({ key: p.key, name: p.name, role: p.role, kind: p.kind, tenantSlug: p.tenantSlug, current: p.current }))} />
          </FramePanel>
        </Frame>
        <div className="flex min-w-0 flex-col gap-6">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("presenter.reset.title")}</FrameTitle>
              <FrameDescription>{t("presenter.reset.help")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              <ResetPanel tenants={["rayo-de-sol", "norte-studio"]} checkpoints={CHECKPOINTS} />
            </FramePanel>
          </Frame>
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("presenter.clock.title")}</FrameTitle>
              <FrameDescription>{t("presenter.clock.subtitle")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              <ClockPanel businessDate={clock.businessDate} baseDate={clock.baseDate} advancedDays={clock.advancedDays} max={MAX_CLOCK_ADVANCE_DAYS} />
            </FramePanel>
          </Frame>
        </div>
      </div>

      <Frame spacing="default">
        <FrameHeader>
          <FrameTitle>{t("presenter.failures.title")}</FrameTitle>
          <FrameDescription>{t("presenter.failures.help")}</FrameDescription>
        </FrameHeader>
        <FramePanel className="flex flex-col gap-4">
          <FailureModes agencySlug="rayo-de-sol" />
          {directives.length > 0 && (
            <RecordGrid
              compact
              emptyMessage={t("presenter.failures.none")}
              columns={[
                { id: "provider", header: "presenter.failures.provider", kind: "mono" },
                { id: "operationType", header: "presenter.failures.operation", kind: "mono" },
                { id: "failureMode", header: "presenter.failures.mode", kind: "state", labelPrefix: "presenter.failures.modes" },
                { id: "state", header: "presenter.failures.state", kind: "state", labelPrefix: "records.state" },
                { id: "createdAt", header: "presenter.failures.created", kind: "timestamp" },
              ]}
              rows={directives}
            />
          )}
        </FramePanel>
      </Frame>

      <Frame spacing="default">
        <FrameHeader>
          <FrameTitle>{t("presenter.journeys.title")}</FrameTitle>
          <FrameDescription>{t("presenter.journeys.help")}</FrameDescription>
        </FrameHeader>
        {JOURNEYS.map((j) => (
          <FramePanel key={j.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{j.id}</span>
              <span className="text-sm font-semibold">{pick(j.name)}</span>
              {j.entryCheckpoint && <Badge variant="outline">{t(`presenter.checkpoints.${j.entryCheckpoint}`)}</Badge>}
              <Badge variant="outline">{t(`header.roles.${personas.find((p) => p.key === j.actor)?.role ?? "owner"}`)}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{pick(j.expectedResult)}</p>
            <ol className="flex flex-col gap-1 text-sm">
              {j.steps.map((s) => {
                const href = journeyStepHref(s, { fixtureId: fixtureUuid })
                const actor = personas.find((p) => p.key === s.actor)
                return (
                  <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                    {href ? (
                      <Link href={href} className="font-medium underline-offset-3 hover:underline">
                        {pick(s.label)}
                      </Link>
                    ) : (
                      <span>{pick(s.label)}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {actor ? `${actor.name} · ` : ""}
                      {href ? "" : t("presenter.journeys.afterPrevious")}
                    </span>
                  </li>
                )
              })}
            </ol>
          </FramePanel>
        ))}
      </Frame>
      <p className="text-xs text-muted-foreground">{t("presenter.clockNote", { started: clock.startedAt ? timestamp(clock.startedAt) : "—" })}</p>
    </>
  )
}
