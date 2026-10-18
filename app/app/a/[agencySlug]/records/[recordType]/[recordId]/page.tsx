import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowUpRightIcon, GitCompareArrowsIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { StateBadge } from "@/components/app/state-badge"
import { PendingHandlerState } from "@/components/app/states"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline"
import { EvidenceReview } from "@/components/records/evidence-review"
import { RecordCommandForm } from "@/components/records/record-command"
import { Button } from "@/components/ui/button"
import { eventLabel } from "@/components/records/code-label"
import { MESSAGES } from "@/lib/i18n/messages"
import { requireAgency } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"
import { getRecordDetail, PENDING_RECORD_TYPES, type RecordField } from "@/server/queries/records"
import { isUuid } from "@/server/queries/shared"

export const metadata: Metadata = { title: "Business record" }

const STATE_PREFIX: Record<string, string> = { kind: "modules.kinds", origin: "records.origin", published: "modules.published", reviewCurrent: "records.state" }

// record-detail family for structured business records: identity + state,
// fields, related records (navigable both ways), revisions with an
// accessible field diff (?compare=), lines, files and the immutable events.
export default async function BusinessRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; recordType: string; recordId: string }>
  searchParams: Promise<{ compare?: string }>
}) {
  const { agencySlug, recordType, recordId } = await params
  const { compare } = await searchParams
  const ctx = await requireAgency(agencySlug)
  const i18n = await getI18n(ctx.tenant.timezone)
  const { t, money, date, timestamp } = i18n

  if ((PENDING_RECORD_TYPES as readonly string[]).includes(recordType)) {
    if (!isUuid(recordId)) notFound()
    return (
      <>
        <PageHeader title={t(`records.types.${recordType}`)} description={recordId} />
        <PendingHandlerState title={t("records.page.pendingTypeTitle")} description={t("records.page.pendingTypeBody", { type: t(`records.types.${recordType}`) })} />
      </>
    )
  }

  const r = await getRecordDetail(ctx, recordType, recordId)
  if (!r) notFound()
  const other = compare && compare !== r.id && r.siblings.some((s) => s.id === compare) ? await getRecordDetail(ctx, recordType, compare) : null
  const base = `/a/${ctx.tenant.slug}`
  const self = `${base}/records/${recordType}/${recordId}`

  const show = (fld: RecordField | undefined): string => {
    if (!fld || fld.value === null || fld.value === "") return "—"
    switch (fld.kind) {
      case "money":
        return money(String(fld.value), fld.currency ?? ctx.tenant.baseCurrency)
      case "date":
        return date(String(fld.value))
      case "timestamp":
        return timestamp(String(fld.value))
      case "state":
        return t(`${STATE_PREFIX[fld.key] ?? "records.state"}.${String(fld.value)}`)
      case "number":
        return new Intl.NumberFormat(i18n.locale === "es" ? "es-MX" : "en-US").format(Number(fld.value))
      default:
        return String(fld.value)
    }
  }

  return (
    <>
      <PageHeader
        title={r.title}
        description={`${t(`records.types.${recordType}`)}${r.subtitle ? ` · ${r.subtitle}` : ""}`}
        badges={
          <>
            {r.state && <StateBadge state={r.state} label={t(`records.state.${r.state}`)} />}
            {r.revision !== null && <Badge variant="outline">{t("common.revision", { n: r.revision })}</Badge>}
            {r.synthetic && <Badge variant="outline">{t("common.syntheticData")}</Badge>}
          </>
        }
        actions={
          <>
            {r.jobId && (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/jobs/${r.jobId}`} />}>
                {t("records.page.openJob")}
              </Button>
            )}
            {r.owningSkill && (
              <Button size="sm" nativeButton={false} render={<Link href={`${base}/modules/${r.owningSkill.moduleKey}/workflows/${r.owningSkill.skillId}${r.jobId ? `?job=${r.jobId}` : ""}`} />}>
                {t("records.page.openWorkflow")}
                <ArrowUpRightIcon aria-hidden="true" />
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{other ? t("records.page.comparing", { a: r.title, b: other.title }) : t("records.page.details")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              {other ? (
                <RecordGrid
                  compact
                  emptyMessage={t("modules.emptyTitle")}
                  pageSize={50}
                  columns={[
                    { id: "field", header: "records.page.field", kind: "text", sortable: false },
                    { id: "a", header: "records.page.thisRevision", kind: "text", sortable: false },
                    { id: "b", header: "records.page.otherRevision", kind: "text", sortable: false },
                    { id: "changed", header: "records.page.changed", kind: "state", labelPrefix: "records.state", sortable: false },
                  ]}
                  rows={r.fields.map((fld) => {
                    const o = other.fields.find((x) => x.key === fld.key)
                    return { id: fld.key, field: t(fld.labelKey), a: show(fld), b: show(o), changed: show(fld) !== show(o) ? "yes" : "no" }
                  })}
                />
              ) : (
                <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
                  {r.fields.map((fld) => (
                    <div key={fld.key} className="contents">
                      <dt className="text-muted-foreground">{t(fld.labelKey)}</dt>
                      <dd className={fld.kind === "mono" ? "min-w-0 font-mono text-xs break-all" : "min-w-0 tabular-nums"}>
                        {fld.kind === "money" ? <span className="ageos-figure">{show(fld)}</span> : show(fld)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </FramePanel>
          </Frame>

          {recordType === "evidence" && (
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("records.evidence.title")}</FrameTitle>
                <FrameDescription>{t("records.evidence.help")}</FrameDescription>
              </FrameHeader>
              <FramePanel>
                <EvidenceReview
                  agencySlug={ctx.tenant.slug}
                  evidenceId={r.id}
                  allowed={ctx.permissions.has("approvals.decide") && r.reviewer?.submittedBy !== ctx.user.id}
                  reasonBlocked={
                    !ctx.permissions.has("approvals.decide")
                      ? t("records.evidence.notEligible", { role: t(`header.roles.${ctx.role}`) })
                      : r.reviewer?.submittedBy === ctx.user.id
                        ? t("records.evidence.submitter")
                        : null
                  }
                />
              </FramePanel>
            </Frame>
          )}

          {r.commands.map((c) => (
            <Frame key={c.command} spacing="default">
              <FrameHeader>
                <FrameTitle>{t(c.titleKey)}</FrameTitle>
                <FrameDescription>{t(c.helpKey)}</FrameDescription>
              </FrameHeader>
              <FramePanel>
                <RecordCommandForm agencySlug={ctx.tenant.slug} command={c.command} fixed={c.fixed} fields={c.fields} buttons={c.buttons} />
              </FramePanel>
            </Frame>
          ))}

          {r.lines && (
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("records.page.lines")}</FrameTitle>
              </FrameHeader>
              <FramePanel className="p-0">
                <RecordGrid
                  compact
                  emptyMessage={t("modules.emptyTitle")}
                  rows={r.lines.rows}
                  rowHrefKey={r.lines.rows.some((x) => typeof x.href === "string") ? "href" : undefined}
                  columns={r.lines.columns}
                />
              </FramePanel>
            </Frame>
          )}

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("records.page.activity")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              {r.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("records.page.noActivity")}</p>
              ) : (
                <Timeline>
                  {r.events.map((e, idx) => (
                    <TimelineItem key={e.id} step={idx + 1}>
                      <TimelineHeader>
                        <TimelineDate>{timestamp(e.recordedAt)}</TimelineDate>
                        <TimelineTitle>{eventLabel(MESSAGES[i18n.locale], t, e.eventType)}</TimelineTitle>
                      </TimelineHeader>
                      <TimelineIndicator />
                      <TimelineSeparator />
                      <TimelineContent className="text-xs text-muted-foreground">
                        {e.actor ?? "—"} · {t(`records.origin.${e.origin}`)}
                        {e.revision ? ` · ${t("common.revision", { n: e.revision })}` : ""}
                        {e.commandType ? ` · ${e.commandType}` : ""}
                      </TimelineContent>
                    </TimelineItem>
                  ))}
                </Timeline>
              )}
            </FramePanel>
          </Frame>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("records.page.relations")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              {r.relations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("records.page.noRelations")}</p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  {r.relations.map((l) => (
                    <div key={`${l.labelKey}:${l.href}`} className="contents">
                      <dt className="text-muted-foreground">{t(l.labelKey)}</dt>
                      <dd className="min-w-0 truncate">
                        <Link href={l.href} className="font-medium underline-offset-3 hover:underline">
                          {l.label}
                        </Link>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </FramePanel>
          </Frame>

          {r.siblings.length > 1 && (
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("records.page.revisions")}</FrameTitle>
                <FrameDescription>{t("records.page.compareWith")}</FrameDescription>
              </FrameHeader>
              <FramePanel>
                <ul className="flex flex-col gap-2">
                  {r.siblings.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2">
                        {s.current ? (
                          <span className="font-medium">{s.label}</span>
                        ) : (
                          <Link href={s.href} className="font-medium underline-offset-3 hover:underline">
                            {s.label}
                          </Link>
                        )}
                        <StateBadge state={s.state} label={t(`records.state.${s.state}`)} />
                      </span>
                      {!s.current &&
                        (other?.id === s.id ? (
                          <Button size="xs" variant="secondary" nativeButton={false} render={<Link href={self} />}>
                            {t("records.page.stopCompare")}
                          </Button>
                        ) : (
                          <Button size="xs" variant="outline" nativeButton={false} render={<Link href={`${self}?compare=${s.id}`} />}>
                            <GitCompareArrowsIcon aria-hidden="true" />
                            {t("records.page.compareWith")}
                          </Button>
                        ))}
                    </li>
                  ))}
                </ul>
              </FramePanel>
            </Frame>
          )}

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("records.page.files")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              {r.files.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("records.page.noFiles")}</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {r.files.map((file) => (
                    <li key={file.id} className="flex items-center justify-between gap-2">
                      <Link href={file.href} className="min-w-0 truncate font-medium underline-offset-3 hover:underline">
                        {file.name}
                      </Link>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {file.format} · v{file.version}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </FramePanel>
          </Frame>
        </div>
      </div>
    </>
  )
}
