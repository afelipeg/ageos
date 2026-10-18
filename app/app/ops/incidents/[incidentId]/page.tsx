import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CheckIcon, CircleXIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { StateBadge } from "@/components/app/state-badge"
import { IncidentActions } from "@/components/ops/incident-actions"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { requirePlatformSession } from "@/server/auth/request"
import { getIncident, type IncidentView } from "@/server/domain/ops"
import { getI18n } from "@/server/i18n"
import { isDomainError } from "@/server/kernel/errors"

export const metadata: Metadata = { title: "Incident investigation" }

const dl = (d: string) => (d === "\t" ? "TAB" : d)

// run-detail family for the synthetic incident ops_csv_delimiter_mismatch:
// the stored file (hash), the import profile revision, the expected schema,
// the REAL parser result with the current delimiter and the deterministic
// diagnosis; then the typed, reviewable change and the audit trail.
export default async function IncidentPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params
  const session = await requirePlatformSession()
  let v: IncidentView
  try {
    v = await getIncident(session, incidentId)
  } catch (e) {
    if (isDomainError(e) && (e.code === "not_found" || e.code === "forbidden")) notFound()
    throw e
  }
  const { t, pick, timestamp } = await getI18n()
  const diagnosis = (v.evidence.diagnosis ?? null) as { rule: string; recommendedDelimiter: string | null; candidates: { delimiter: string; columns: number; dataRows: number; matchesExpected: boolean }[] } | null
  const isOperator = session.user.platformRole === "platform_operator"

  return (
    <>
      <PageHeader
        title={pick(v.title)}
        description={`${v.incidentKey} · ${v.tenant.name} (${v.tenant.slug})`}
        badges={
          <>
            <StateBadge state={v.state === "resolved" ? "resolved" : "attention"} label={t(`ops.states.${v.state}`)} />
            <Badge variant="outline">{t("ops.syntheticFixture")}</Badge>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("ops.incident.evidenceTitle")}</FrameTitle>
              <FrameDescription>{t("ops.incident.evidenceHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
                <dt className="text-muted-foreground">{t("ops.incident.file")}</dt>
                <dd className="font-mono text-xs">{v.file.name}</dd>
                <dt className="text-muted-foreground">SHA-256</dt>
                <dd className="font-mono text-xs break-all">{v.file.sha256}</dd>
                <dt className="text-muted-foreground">{t("ops.incident.sameBytes")}</dt>
                <dd>{v.file.sameBytesAsDetected ? t("common.yes") : t("common.no")}</dd>
                <dt className="text-muted-foreground">{t("ops.incident.profile")}</dt>
                <dd className="font-mono text-xs">
                  {v.profile.profileKey} · r{v.profile.profileRevision} · {t("ops.incident.delimiter", { d: dl(v.profile.delimiter) })}
                  {v.profile.allowlisted ? ` · ${t("ops.incident.allowlisted")}` : ""}
                </dd>
                <dt className="text-muted-foreground">{t("ops.incident.expected")}</dt>
                <dd className="flex flex-wrap gap-1">
                  {v.profile.expectedHeaders.map((h) => (
                    <Badge key={h} variant="outline" className="font-mono">
                      {h}
                    </Badge>
                  ))}
                </dd>
                <dt className="text-muted-foreground">{t("ops.incident.observed")}</dt>
                <dd className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {v.current.matchesExpected ? <CheckIcon aria-hidden="true" className="size-4 text-success" /> : <CircleXIcon aria-hidden="true" className="size-4 text-destructive" />}
                    {t("ops.incident.columns", { n: v.current.observedColumns, expected: v.profile.expectedHeaders.length, rows: v.current.dataRows })}
                  </span>
                  <span className="font-mono text-xs break-all text-muted-foreground">{v.current.observedHeaders.join(" | ")}</span>
                  <span className="text-xs text-muted-foreground">{t("ops.incident.parser", { parser: v.current.parser })}</span>
                </dd>
              </dl>
            </FramePanel>
          </Frame>

          {diagnosis && (
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("ops.incident.diagnosisTitle")}</FrameTitle>
                <FrameDescription>{t("ops.incident.diagnosisHelp")}</FrameDescription>
              </FrameHeader>
              <FramePanel className="p-0">
                <RecordGrid
                  compact
                  emptyMessage={t("ops.noIncidents")}
                  columns={[
                    { id: "delimiter", header: "ops.columns.delimiter", kind: "mono" },
                    { id: "columns", header: "ops.columns.columns", kind: "number", align: "end" },
                    { id: "dataRows", header: "ops.columns.rows", kind: "number", align: "end" },
                    { id: "match", header: "ops.columns.match", kind: "state", labelPrefix: "records.state" },
                  ]}
                  rows={diagnosis.candidates.map((c) => ({ id: c.delimiter, delimiter: dl(c.delimiter), columns: c.columns, dataRows: c.dataRows, match: c.matchesExpected ? "yes" : "no" }))}
                />
              </FramePanel>
            </Frame>
          )}

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("ops.incident.actionsTitle")}</FrameTitle>
              <FrameDescription>{t("ops.incident.actionsHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              <IncidentActions incidentId={v.id} state={v.state} isOperator={isOperator} profileRevision={v.profile.profileRevision} currentDelimiter={v.profile.delimiter} recommended={diagnosis?.recommendedDelimiter ?? null} />
            </FramePanel>
          </Frame>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("ops.incident.changesTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              {v.changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("ops.incident.noChanges")}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {v.changes.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <Link href={`/ops/changes/${c.id}`} className="min-w-0 truncate font-medium underline-offset-3 hover:underline">
                        {t("ops.incident.changeLabel", { d: dl(c.payload.delimiter), rev: c.targetProfileRevision })}
                      </Link>
                      <Badge variant="outline">{t(`ops.changeStates.${c.state}`)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </FramePanel>
          </Frame>
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("ops.incident.revisionsTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              <ul className="flex flex-col gap-1.5 text-sm">
                {v.profileRevisions.map((r) => (
                  <li key={r.revision} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">
                      r{r.revision} · {t("ops.incident.delimiter", { d: dl(r.delimiter) })}
                    </span>
                    <span className="text-xs text-muted-foreground">{timestamp(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </FramePanel>
          </Frame>
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("ops.incident.auditTitle")}</FrameTitle>
              <FrameDescription>{t("ops.incident.auditHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              {v.audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("ops.incident.noAudit")}</p>
              ) : (
                <Trace>
                  {v.audit.map((a) => (
                    <TraceLine key={a.seq}>
                      <TraceIcon>
                        <CheckIcon />
                      </TraceIcon>
                      <TraceTitle className="font-mono text-xs">{a.eventType}</TraceTitle>
                      <TraceDescription>
                        {a.actor ?? "—"} · {timestamp(a.recordedAt)}
                      </TraceDescription>
                    </TraceLine>
                  ))}
                </Trace>
              )}
            </FramePanel>
          </Frame>
        </div>
      </div>
    </>
  )
}
