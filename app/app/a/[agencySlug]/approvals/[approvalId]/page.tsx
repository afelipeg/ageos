import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ApprovalDecision } from "@/components/approvals/approval-decision"
import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { StateBadge } from "@/components/app/state-badge"
import { BlockedState, PendingHandlerState } from "@/components/app/states"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline"
import { Button } from "@/components/ui/button"
import { MESSAGES } from "@/lib/i18n/messages"
import { lookup } from "@/lib/i18n/translate"
import { eventLabel } from "@/components/records/code-label"
import { requireAgency } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"
import { getApprovalView } from "@/server/queries/approvals"

export const metadata: Metadata = { title: "Review change" }

type Flat = { key: string; path: string[]; value: unknown }

function flatten(obj: Record<string, unknown>, prefix: string[] = []): Flat[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? flatten(v as Record<string, unknown>, [...prefix, k]) : [{ key: [...prefix, k].join("."), path: [...prefix, k], value: v }]
  )
}

// approval-detail family: before/after diff of the exact payload, financial
// impact, evidence and rules, eligible approvers and the decision bar. The
// requester sees the request but cannot approve it; an outdated request shows
// "Approval outdated" and links to the newer proposal instead.
export default async function ApprovalDetailPage({ params }: { params: Promise<{ agencySlug: string; approvalId: string }> }) {
  const { agencySlug, approvalId } = await params
  const ctx = await requireAgency(agencySlug)
  const v = await getApprovalView(ctx, approvalId)
  if (!v) notFound()
  const { t, money, pct, timestamp, locale } = await getI18n(ctx.tenant.timezone)
  const base = `/a/${ctx.tenant.slug}`
  const a = v.approval
  const currency = a.currency ?? ctx.tenant.baseCurrency
  const msgs = MESSAGES[locale] as never

  const label = (path: string[]) =>
    path.map((p) => lookup(msgs, `approvals.fields.${p}`) ?? p.replace(/([A-Z])/g, " $1").toLowerCase()).join(" · ")
  const fmt = (path: string[], value: unknown): string => {
    const leaf = path[path.length - 1] ?? ""
    if (value === null || value === undefined || value === "") return "—"
    if (typeof value === "boolean") return value ? t("common.yes") : t("common.no")
    if ((/Minor$/.test(leaf) || leaf === "minor") && /^-?\d+$/.test(String(value))) return money(String(value), currency)
    if ((/Bps$/.test(leaf) || leaf === "bps") && typeof value === "number") return pct(value)
    return String(value)
  }

  const diffRows = Object.entries(v.proposal?.diff ?? {}).map(([k, d]) => {
    const pair = (d ?? {}) as { before?: unknown; after?: unknown }
    return { id: k, field: label([k]), before: fmt([k], pair.before), after: fmt([k], pair.after) }
  })
  const impact = flatten(v.proposal?.impact ?? {})
  const outdated = v.outdated || a.state === "stale"
  const summary = `${a.title} · ${a.amountMinor ? money(a.amountMinor, currency) : "—"} · ${t("approvals.revisionOf", { n: a.aggregateRevision })}${a.destination ? ` · ${a.destination}` : ""}`

  return (
    <>
      <PageHeader
        title={a.title}
        description={`${a.actionType} · ${t("approvals.requestedBy", { name: v.requesterName ?? "—" })}`}
        badges={
          <>
            <StateBadge state={outdated ? "stale" : a.state} label={t(`records.state.${outdated ? "stale" : a.state}`)} />
            <Badge variant="outline" className="font-mono">
              {a.policyId} r{a.policyRevision}
            </Badge>
          </>
        }
        actions={
          v.job ? (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/jobs/${v.job.id}?tab=finance`} />}>
              {t("approvals.openJob")}
            </Button>
          ) : null
        }
      />

      {outdated && (
        <BlockedState
          title={t("approvals.outdatedTitle")}
          description={t("approvals.outdatedBody", { approved: a.aggregateRevision, current: v.currentRevision ?? "—" })}
          action={
            v.newer ? (
              <Button size="sm" nativeButton={false} render={<Link href={`${base}/approvals/${v.newer.id}`} />}>
                {t("approvals.openNewer")}
              </Button>
            ) : undefined
          }
        />
      )}
      {a.state === "expired" && <BlockedState title={t("records.state.expired")} description={t("records.codes.approval_expired")} />}
      {!outdated && a.state === "awaiting_approval" && v.viewer.isRequester && <PendingHandlerState title={t("approvals.requesterTitle")} description={t("approvals.requesterBody")} />}
      {!outdated && a.state === "awaiting_approval" && !v.viewer.isRequester && !v.viewer.eligible && (
        <BlockedState title={t("approvals.notEligibleTitle")} description={t("approvals.notEligibleBody", { role: t(`header.roles.${ctx.role}`) })} />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("approvals.changeTitle")}</FrameTitle>
              <FrameDescription>{t("approvals.changeHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel className="p-0">
              <RecordGrid
                compact
                emptyMessage={t("approvals.noDiff")}
                columns={[
                  { id: "field", header: "approvals.columns.field", kind: "text", sortable: false },
                  { id: "before", header: "approvals.columns.before", kind: "text", align: "end", sortable: false },
                  { id: "after", header: "approvals.columns.after", kind: "text", align: "end", sortable: false },
                ]}
                rows={diffRows}
              />
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("approvals.impactTitle")}</FrameTitle>
              <FrameDescription>{t("approvals.impactHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              {impact.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("approvals.noImpact")}</p>
              ) : (
                <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
                  {impact.map((row) => (
                    <div key={row.key} className="contents">
                      <dt className="text-muted-foreground">{label(row.path)}</dt>
                      <dd className="ageos-figure tabular-nums">{fmt(row.path, row.value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("approvals.decisionTitle")}</FrameTitle>
              <FrameDescription>{t("approvals.decisionHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              <ApprovalDecision
                agencySlug={ctx.tenant.slug}
                approvalId={a.id}
                digest={a.payloadDigest}
                summary={summary}
                canDecide={v.viewer.canDecide}
                canExecute={v.viewer.canExecute}
                state={outdated ? "stale" : a.state}
                reasonRequiredOnApprove={false}
              />
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("approvals.payloadTitle")}</FrameTitle>
              <FrameDescription>{t("approvals.payloadHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(v.proposal?.payload ?? {}, null, 2)}</pre>
            </FramePanel>
          </Frame>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("approvals.factsTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">{t("approvals.facts.amount")}</dt>
                <dd className="ageos-figure tabular-nums">{a.amountMinor ? money(a.amountMinor, currency) : "—"}</dd>
                <dt className="text-muted-foreground">{t("approvals.facts.revision")}</dt>
                <dd className="tabular-nums">
                  r{a.aggregateRevision} · {t("approvals.facts.current", { n: v.currentRevision ?? "—" })}
                </dd>
                <dt className="text-muted-foreground">{t("approvals.facts.destination")}</dt>
                <dd className="font-mono text-xs break-all">{a.destination ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("approvals.facts.created")}</dt>
                <dd>{timestamp(a.createdAt)}</dd>
                <dt className="text-muted-foreground">{t("approvals.facts.expires")}</dt>
                <dd>{a.expiresAt ? timestamp(a.expiresAt) : "—"}</dd>
                <dt className="text-muted-foreground">{t("approvals.facts.digest")}</dt>
                <dd className="font-mono text-xs break-all">{a.payloadDigest.slice(0, 24)}…</dd>
                {v.job && (
                  <>
                    <dt className="text-muted-foreground">{t("approvals.facts.job")}</dt>
                    <dd className="min-w-0 truncate">
                      <Link href={`${base}/jobs/${v.job.id}`} className="font-medium underline-offset-3 hover:underline">
                        {v.job.ref} · {v.job.name}
                      </Link>
                    </dd>
                  </>
                )}
                {v.runId && (
                  <>
                    <dt className="text-muted-foreground">{t("approvals.facts.run")}</dt>
                    <dd>
                      <Link href={`${base}/runs/${v.runId}`} className="font-mono text-xs underline-offset-3 hover:underline">
                        {v.runId.slice(0, 8)}
                      </Link>
                    </dd>
                  </>
                )}
                {v.proposal && (
                  <>
                    <dt className="text-muted-foreground">{t("approvals.facts.proposal")}</dt>
                    <dd>
                      <Link href={`${base}/records/proposal/${v.proposal.id}`} className="font-mono text-xs underline-offset-3 hover:underline">
                        {v.proposal.id.slice(0, 8)}
                      </Link>
                    </dd>
                  </>
                )}
              </dl>
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("approvals.eligibleTitle")}</FrameTitle>
              <FrameDescription>{a.eligibleRoles.map((r) => t(`header.roles.${r}`)).join(", ")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              <ul className="flex flex-col gap-1.5 text-sm">
                {v.eligiblePeople.length === 0 && <li className="text-muted-foreground">{t("approvals.noEligible")}</li>}
                {v.eligiblePeople.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span>{p.name}</span>
                    <span className="flex items-center gap-1.5">
                      <Badge variant="outline">{t(`header.roles.${p.role}`)}</Badge>
                      {p.isRequester && <Badge variant="warning-light">{t("approvals.requesterBadge")}</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("approvals.evidenceTitle")}</FrameTitle>
              <FrameDescription>{t("approvals.evidenceHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              {v.evidence.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("approvals.noEvidence")}</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {v.evidence.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2">
                      <Link href={`${base}/records/evidence/${e.id}`} className="min-w-0 truncate font-medium underline-offset-3 hover:underline">
                        {e.title}
                      </Link>
                      <StateBadge state={e.reviewState} label={t(`records.state.${e.reviewState}`)} />
                    </li>
                  ))}
                </ul>
              )}
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("approvals.historyTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              {v.decisions.length === 0 && v.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("approvals.noHistory")}</p>
              ) : (
                <Timeline>
                  {v.decisions.map((d, idx) => (
                    <TimelineItem key={d.id} step={idx + 1}>
                      <TimelineHeader>
                        <TimelineDate>{timestamp(d.createdAt)}</TimelineDate>
                        <TimelineTitle>{t(`approvals.decision.${d.decision}`)}</TimelineTitle>
                      </TimelineHeader>
                      <TimelineIndicator />
                      <TimelineSeparator />
                      <TimelineContent className="text-xs text-muted-foreground">
                        {d.actor}
                        {d.reason ? ` · “${d.reason}”` : ""}
                      </TimelineContent>
                    </TimelineItem>
                  ))}
                  {v.events.map((e, idx) => (
                    <TimelineItem key={e.id} step={v.decisions.length + idx + 1}>
                      <TimelineHeader>
                        <TimelineDate>{timestamp(e.recordedAt)}</TimelineDate>
                        <TimelineTitle>{eventLabel(MESSAGES[locale], t, e.eventType)}</TimelineTitle>
                      </TimelineHeader>
                      <TimelineIndicator />
                      <TimelineSeparator />
                      <TimelineContent className="text-xs text-muted-foreground">
                        {e.actor ?? "—"} · {t(`records.origin.${e.origin}`)}
                      </TimelineContent>
                    </TimelineItem>
                  ))}
                </Timeline>
              )}
            </FramePanel>
          </Frame>
        </div>
      </div>
    </>
  )
}
