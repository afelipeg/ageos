import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowUpRightIcon, CheckIcon, CircleDashedIcon, CircleXIcon, LoaderIcon, PauseIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { StateBadge } from "@/components/app/state-badge"
import { BlockedState, ErrorState } from "@/components/app/states"
import { ActivationActions } from "@/components/control/activation-actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { requireControlSession } from "@/server/auth/request"
import { getActivationRun, type ActivationRunView } from "@/server/domain/activation"
import { getI18n } from "@/server/i18n"
import { isDomainError } from "@/server/kernel/errors"

export const metadata: Metadata = { title: "Activating your workspace" }

function StepIcon({ state }: { state: string }) {
  if (state === "succeeded" || state === "simulated") return <CheckIcon />
  if (state === "failed") return <CircleXIcon />
  if (state === "running") return <LoaderIcon />
  if (state === "waiting") return <PauseIcon />
  return <CircleDashedIcon />
}

// run-detail family (P04): the persisted activation run — validate → create
// workspace → roles → publish → storage → capabilities → access → ready —
// with each step's recorded start/end/result. It survives refresh, resumes
// from the failed step and never claims cloud infrastructure was provisioned.
export default async function ActivationPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const session = await requireControlSession(`/control/activations/${runId}`)
  let run: ActivationRunView
  try {
    run = await getActivationRun(session, runId)
  } catch (e) {
    if (isDomainError(e) && (e.code === "not_found" || e.code === "forbidden")) notFound()
    throw e
  }
  const { t, timestamp } = await getI18n()
  const running = run.state === "queued" || run.state === "running"

  return (
    <>
      <PageHeader
        title={t("control.activation.title")}
        description={`${run.agency.appName || "—"} · ${run.agency.name || "—"} · ${t("control.activation.revision", { n: run.revision.number })}`}
        badges={
          <>
            <StateBadge state={run.state === "succeeded" ? "succeeded" : run.state === "failed" ? "failed" : run.state === "waiting" ? "blocked" : "running"} label={t(`control.activationState.${run.state}`)} />
            <Badge variant="outline">{t("control.activation.logical")}</Badge>
          </>
        }
        actions={
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/control/agencies/${run.agency.id}`} />}>
            {t("control.activation.reviewConfiguration")}
          </Button>
        }
      />

      {run.result && (
        <Alert variant="success">
          <CheckIcon aria-hidden="true" />
          <AlertTitle>{run.result.domainPending ? t("control.activation.readyDomainPending") : t("control.activation.ready")}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{t("control.activation.readyBody", { app: run.agency.appName, path: run.result.path })}</span>
            <span className="text-xs">{t("control.activation.noProvisioning")}</span>
            <span className="flex flex-wrap gap-2">
              <Button size="sm" nativeButton={false} render={<Link href={run.result.path} />}>
                {t("control.agencies.open")}
                <ArrowUpRightIcon aria-hidden="true" />
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
      {run.state === "waiting" && (
        <BlockedState
          title={t("control.activation.waitingTitle")}
          description={t(`control.activation.waitingFor.${run.waitingFor === "connections" ? "connections" : "access"}`)}
          action={<ActivationActions runId={run.runId} canRetry={run.canRetry} running={false} />}
        />
      )}
      {run.state === "failed" && <ErrorState title={t("control.activation.failedTitle")} description={run.steps.find((s) => s.state === "failed")?.error ?? t("states.errorBody", { ref: run.runId.slice(0, 8) })} action={<ActivationActions runId={run.runId} canRetry={run.canRetry} running={false} />} />}
      {running && <ActivationActions runId={run.runId} canRetry={false} running />}

      <Frame spacing="default">
        <FrameHeader>
          <FrameTitle>{t("control.activation.stepsTitle")}</FrameTitle>
          <FrameDescription>{t("control.activation.stepsHelp")}</FrameDescription>
        </FrameHeader>
        <FramePanel>
          <Trace>
            {run.steps.map((s) => {
              const status = s.state === "failed" ? "error" : s.state === "pending" ? "pending" : s.state === "running" ? "running" : undefined
              const line = (
                <TraceLine status={status}>
                  <TraceIcon>
                    <StepIcon state={s.state} />
                  </TraceIcon>
                  <TraceTitle>
                    {s.seq}. {t(`control.activation.steps.${s.key}`)}
                  </TraceTitle>
                  <TraceDescription>
                    {t(`control.stepState.${s.state}`)}
                    {s.finishedAt ? ` · ${timestamp(s.finishedAt)}` : ""}
                  </TraceDescription>
                </TraceLine>
              )
              return Object.keys(s.detail ?? {}).length || s.error ? (
                <TraceCollapsible key={s.key}>
                  <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
                  <TraceCollapsibleContent>
                    {s.error && <p className="text-xs text-destructive">{s.error}</p>}
                    <pre className="font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(s.detail, null, 2)}</pre>
                  </TraceCollapsibleContent>
                </TraceCollapsible>
              ) : (
                <div key={s.key}>{line}</div>
              )
            })}
          </Trace>
        </FramePanel>
      </Frame>
      <p className="text-xs text-muted-foreground">
        {t("control.activation.times", { created: timestamp(run.createdAt), finished: run.finishedAt ? timestamp(run.finishedAt) : "—" })}
      </p>
    </>
  )
}
