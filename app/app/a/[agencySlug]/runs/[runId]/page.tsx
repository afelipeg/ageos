import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CheckIcon, CircleAlertIcon, CircleDashedIcon, CircleXIcon, LockKeyholeIcon, ShieldCheckIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { StateBadge } from "@/components/app/state-badge"
import { BlockedState, ErrorState } from "@/components/app/states"
import { RetryRunButton } from "@/components/runs/retry-run-button"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { eventLabel } from "@/components/records/code-label"
import { MESSAGES } from "@/lib/i18n/messages"
import { requireAgency } from "@/server/auth/request"
import { HANDLERS } from "@/server/capabilities/registry"
import { getI18n } from "@/server/i18n"
import { getRunDetail } from "@/server/queries/runs"
import { aggregateHref } from "@/server/queries/shared"

export const metadata: Metadata = { title: "Run details" }

function StepIcon({ state }: { state: string }) {
  if (state === "succeeded") return <CheckIcon />
  if (state === "blocked") return <LockKeyholeIcon />
  if (state === "failed") return <CircleXIcon />
  if (state === "awaiting_approval") return <ShieldCheckIcon />
  if (state === "outcome_unknown") return <CircleAlertIcon />
  return <CircleDashedIcon />
}

// run-detail family (agent-activity-1 + c-trace-4/5): the persisted steps of
// one deterministic run with their recorded detail, the output keys of the
// contract, correlated business events and approvals. The UI never drives
// the clock or fabricates a step.
export default async function RunDetailPage({ params }: { params: Promise<{ agencySlug: string; runId: string }> }) {
  const { agencySlug, runId } = await params
  const ctx = await requireAgency(agencySlug)
  const d = await getRunDetail(ctx, runId)
  if (!d) notFound()
  const { t, pick, timestamp, locale } = await getI18n(ctx.tenant.timezone)
  const base = `/a/${ctx.tenant.slug}`
  const r = d.run
  const isQuery = HANDLERS[r.skillId]?.kind === "query"
  const workbench = d.capability ? `${base}/modules/${d.capability.moduleKey}/workflows/${r.skillId}${d.job ? `?job=${d.job.id}` : ""}` : null
  const duration = r.finishedAt ? Math.max(0, new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) : null
  const outputKeys = d.capability?.repositoryOutputs ?? []
  const result = r.result ?? {}

  return (
    <>
      <PageHeader
        title={d.capability ? pick(d.capability.label) : r.skillId}
        description={`${r.skillId} · ${d.job ? `${d.job.ref} · ${d.job.name}` : t("runs.noJob")}`}
        badges={
          <>
            <StateBadge state={r.state} label={t(`records.state.${r.state}`)} />
            <Badge variant="outline">{t("runs.mode")}</Badge>
            <Badge variant="outline" className="font-mono">
              {r.handlerVersion}
            </Badge>
          </>
        }
        actions={
          <>
            {d.job && (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/jobs/${d.job.id}?tab=activity`} />}>
                {t("runs.openJob")}
              </Button>
            )}
            {workbench && (
              <Button size="sm" nativeButton={false} render={<Link href={workbench} />}>
                {t("runs.openWorkflow")}
              </Button>
            )}
          </>
        }
      />

      {r.state === "blocked" && r.error && (
        <BlockedState
          title={t(`errors.${r.error.code}`)}
          description={`${r.error.message}${typeof r.error.details?.rule === "string" ? ` · ${t("runs.rule", { rule: r.error.details.rule })}` : ""}`}
          action={isQuery ? <RetryRunButton agencySlug={ctx.tenant.slug} runId={r.id} /> : undefined}
        />
      )}
      {r.state === "failed" && r.error && <ErrorState title={t(`errors.${r.error.code}`)} description={t("states.errorBody", { ref: r.id.slice(0, 8) })} action={isQuery ? <RetryRunButton agencySlug={ctx.tenant.slug} runId={r.id} /> : undefined} />}
      {r.state === "outcome_unknown" && <BlockedState title={t("states.outcomeUnknown")} description={t("runs.reconcileBody")} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("runs.stepsTitle")}</FrameTitle>
              <FrameDescription>{t("runs.stepsHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              {d.steps.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("runs.noSteps")}</p>
              ) : (
                <Trace>
                  {d.steps.map((s) => {
                    const detailEntries = Object.entries(s.detail ?? {})
                    const status = s.state === "failed" || s.state === "blocked" ? "error" : s.state === "executing" || s.state === "queued" ? "pending" : undefined
                    const line = (
                      <TraceLine status={status}>
                        <TraceIcon>
                          <StepIcon state={s.state} />
                        </TraceIcon>
                        <TraceTitle>
                          {s.seq}. {t(`runs.steps.${s.key}`)}
                        </TraceTitle>
                        <TraceDescription>{t(`records.state.${s.state}`)}</TraceDescription>
                      </TraceLine>
                    )
                    return detailEntries.length ? (
                      <TraceCollapsible key={s.id}>
                        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
                        <TraceCollapsibleContent>
                          <pre className="font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(s.detail, null, 2)}</pre>
                        </TraceCollapsibleContent>
                      </TraceCollapsible>
                    ) : (
                      <div key={s.id}>{line}</div>
                    )
                  })}
                </Trace>
              )}
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("runs.outputTitle")}</FrameTitle>
              <FrameDescription>{t("runs.outputHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel className="flex flex-col gap-3">
              {outputKeys.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {outputKeys.map((k) => (
                    <Badge key={k} variant={k in result ? "success-light" : "outline"} className="font-mono">
                      {k}
                    </Badge>
                  ))}
                </div>
              )}
              {r.result ? (
                <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(r.result, null, 2)}</pre>
              ) : (
                <p className="text-sm text-muted-foreground">{r.error ? t("runs.noOutputBlocked") : t("runs.noOutput")}</p>
              )}
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("runs.inputTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(r.input, null, 2)}</pre>
            </FramePanel>
          </Frame>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("runs.factsTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">{t("runs.facts.actor")}</dt>
                <dd>{r.actor ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("runs.facts.origin")}</dt>
                <dd>{t(`records.origin.${r.origin}`)}</dd>
                <dt className="text-muted-foreground">{t("runs.facts.started")}</dt>
                <dd>{timestamp(r.startedAt)}</dd>
                <dt className="text-muted-foreground">{t("runs.facts.finished")}</dt>
                <dd>{r.finishedAt ? timestamp(r.finishedAt) : "—"}</dd>
                <dt className="text-muted-foreground">{t("runs.facts.duration")}</dt>
                <dd className="tabular-nums">{duration === null ? "—" : t("runs.ms", { ms: duration })}</dd>
                <dt className="text-muted-foreground">{t("runs.facts.idempotency")}</dt>
                <dd className="font-mono text-xs break-all">{r.idempotencyKey ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("runs.facts.status")}</dt>
                <dd>{d.capability ? <StateBadge state={d.capability.status} label={t(`records.state.${d.capability.status}`)} /> : "—"}</dd>
              </dl>
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("runs.approvalsTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              {d.approvals.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("runs.noApprovals")}</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {d.approvals.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <Link href={`${base}/approvals/${a.id}`} className="min-w-0 truncate font-medium underline-offset-3 hover:underline">
                        {a.title}
                      </Link>
                      <StateBadge state={a.state} label={t(`records.state.${a.state}`)} />
                    </li>
                  ))}
                </ul>
              )}
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("runs.eventsTitle")}</FrameTitle>
              <FrameDescription>{t("runs.eventsHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              {d.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("runs.noEvents")}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {d.events.map((e) => {
                    const href = aggregateHref(ctx.tenant.slug, e.aggregateType, e.aggregateId)
                    return (
                      <li key={e.id} className="flex flex-col gap-0.5">
                        <span className="font-medium">{eventLabel(MESSAGES[locale], t, e.eventType)}</span>
                        <span className="text-xs text-muted-foreground">
                          {timestamp(e.recordedAt)} · {e.aggregateType}
                          {e.aggregateRevision ? ` r${e.aggregateRevision}` : ""}
                          {href && (
                            <>
                              {" · "}
                              <Link href={href} className="underline-offset-3 hover:underline">
                                {t("runs.openRecord")}
                              </Link>
                            </>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </FramePanel>
          </Frame>
        </div>
      </div>
    </>
  )
}
