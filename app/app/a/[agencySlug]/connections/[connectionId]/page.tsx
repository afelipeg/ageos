import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ConnectionActions } from "@/components/connections/connection-actions"
import { RecordCommandForm } from "@/components/records/record-command"
import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { StateBadge } from "@/components/app/state-badge"
import { BlockedState } from "@/components/app/states"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline"
import { eventLabel } from "@/components/records/code-label"
import { MESSAGES } from "@/lib/i18n/messages"
import { requireAgency } from "@/server/auth/request"
import { getBusinessDate } from "@/server/domain/presenter"
import { getI18n } from "@/server/i18n"
import { getConnectionView } from "@/server/queries/connections"

export const metadata: Metadata = { title: "Connection settings" }

// settings-form family for one simulated connection: account, owner, scopes
// (granted vs expected), workflows that depend on it, adapter operations and
// events. Test, revoke (after impact review) and restore run through
// agency-integrations; the adapter is simulated and asks for no credentials.
export default async function ConnectionDetailPage({ params }: { params: Promise<{ agencySlug: string; connectionId: string }> }) {
  const { agencySlug, connectionId } = await params
  const ctx = await requireAgency(agencySlug)
  const v = await getConnectionView(ctx, connectionId)
  if (!v) notFound()
  const { t, pick, timestamp, locale } = await getI18n(ctx.tenant.timezone)
  const c = v.connection
  const enabled = ctx.enabledCapabilities.has("agency-integrations")
  const can = ctx.permissions.has("connections.manage")
  const businessDate = await getBusinessDate()
  const blockedReason = !enabled ? t("connections.capabilityDisabled") : !can ? t("connections.readOnly", { role: t(`header.roles.${ctx.role}`) }) : null

  return (
    <>
      <PageHeader
        title={`${t(`connections.providers.${c.provider}`)} · ${c.accountAlias}`}
        description={t("connections.detailDescription")}
        badges={
          <>
            <StateBadge state={c.state} label={t(`records.state.${c.state}`)} />
            <Badge variant="outline">{t("connections.simulatedBadge")}</Badge>
            <Badge variant="outline">{t("common.revision", { n: c.revision })}</Badge>
          </>
        }
      />
      {c.state === "revoked" && <BlockedState title={t("connections.revokedTitle")} description={t("connections.revokedBody", { count: v.workflows.length })} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("connections.actionsTitle")}</FrameTitle>
              <FrameDescription>{t("connections.actionsHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              <ConnectionActions
                agencySlug={ctx.tenant.slug}
                provider={c.provider}
                accountAlias={c.accountAlias}
                state={c.state}
                allowed={enabled && can}
                blockedReason={blockedReason}
                dependents={v.workflows.map((w) => ({ label: pick(w.label), href: w.href }))}
              />
            </FramePanel>
          </Frame>

          {c.provider === "demo_bank" && (
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("records.commands.exportStatement")}</FrameTitle>
                <FrameDescription>{t("records.commands.exportStatementHelp")}</FrameDescription>
              </FrameHeader>
              <FramePanel>
                <RecordCommandForm
                  agencySlug={ctx.tenant.slug}
                  command="cash.exportDemoBankStatement"
                  fixed={{ connection: c.id }}
                  fields={[{ key: "statementDate", type: "date", label: "records.commands.statementDate", required: true, defaultValue: businessDate }]}
                  buttons={[{ label: "records.commands.export" }]}
                  disabledReason={c.state !== "connected_demo" ? t("connections.revokedTitle") : null}
                />
              </FramePanel>
            </Frame>
          )}

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("connections.dependentTitle")}</FrameTitle>
              <FrameDescription>{t("connections.dependentHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel className={v.workflows.length ? "p-0" : undefined}>
              {v.workflows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("connections.noDependents")}</p>
              ) : (
                <RecordGrid
                  compact
                  rowHrefKey="href"
                  emptyMessage={t("connections.noDependents")}
                  columns={[
                    { id: "label", header: "catalog.columns.capability", kind: "link", hrefKey: "href", subKey: "skillId" },
                    { id: "status", header: "catalog.columns.status", kind: "state", labelPrefix: "records.state" },
                    { id: "availability", header: "catalog.columns.availability", kind: "state", labelPrefix: "catalog.availability" },
                  ]}
                  rows={v.workflows.map((w) => ({ id: w.skillId, label: pick(w.label), skillId: w.skillId, status: w.status, availability: w.availability, href: w.href }))}
                />
              )}
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("connections.operationsTitle")}</FrameTitle>
              <FrameDescription>{t("connections.operationsHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel className={v.operations.length ? "p-0" : undefined}>
              {v.operations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("connections.noOperations")}</p>
              ) : (
                <RecordGrid
                  compact
                  emptyMessage={t("connections.noOperations")}
                  columns={[
                    { id: "operationType", header: "connections.columns.operation", kind: "mono" },
                    { id: "state", header: "connections.columns.state", kind: "state", labelPrefix: "records.state" },
                    { id: "receiptId", header: "connections.columns.receipt", kind: "mono" },
                    { id: "createdAt", header: "connections.columns.created", kind: "timestamp" },
                  ]}
                  rows={v.operations}
                />
              )}
            </FramePanel>
          </Frame>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("connections.accountTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel className="flex flex-col gap-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">{t("connections.columns.category")}</dt>
                <dd>{t(`connections.categories.${c.category}`)}</dd>
                <dt className="text-muted-foreground">{t("connections.mode")}</dt>
                <dd>{t(`connections.modes.${c.mode}`)}</dd>
                <dt className="text-muted-foreground">{t("connections.columns.owner")}</dt>
                <dd>{c.owner ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("connections.columns.lastTest")}</dt>
                <dd>{c.lastSyncedAt ? timestamp(c.lastSyncedAt) : "—"}</dd>
                <dt className="text-muted-foreground">{t("connections.columns.created")}</dt>
                <dd>{c.createdAt ? timestamp(c.createdAt) : "—"}</dd>
              </dl>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("connections.columns.scopes")}</span>
                <span className="flex flex-wrap gap-1">
                  {c.expectedScopes.map((s) => (
                    <Badge key={s} variant={c.scopes.includes(s) ? "success-light" : "warning-light"} className="font-mono">
                      {s}
                    </Badge>
                  ))}
                </span>
                {c.missingScopes.length > 0 && <span className="text-xs text-muted-foreground">{t("connections.missingScopes", { list: c.missingScopes.join(", ") })}</span>}
              </div>
              <p className="text-xs text-muted-foreground">{t("connections.transportNote")}</p>
            </FramePanel>
          </Frame>

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("connections.eventsTitle")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              {v.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("connections.noEvents")}</p>
              ) : (
                <Timeline>
                  {v.events.map((e, idx) => (
                    <TimelineItem key={e.id} step={idx + 1}>
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
