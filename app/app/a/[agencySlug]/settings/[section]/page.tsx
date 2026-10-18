import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowUpRightIcon } from "lucide-react"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { PendingHandlerState } from "@/components/app/states"
import { BrandForm } from "@/components/settings/brand-form"
import { DomainSimulator } from "@/components/settings/domain-simulator"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { PERMISSIONS } from "@/lib/policy"
import { eventLabel } from "@/components/records/code-label"
import { MESSAGES } from "@/lib/i18n/messages"
import { requireAgency } from "@/server/auth/request"
import { getI18n } from "@/server/i18n"
import { getSettingsView, resolveSection, SETTINGS_SECTIONS } from "@/server/queries/settings"
import { aggregateHref } from "@/server/queries/shared"

export const metadata: Metadata = { title: "Settings" }

// settings-form family: brand & identity, team & roles, effective policy,
// simulated domain, demo plan & usage and audit, one section at a time
// (/settings/:section, tabs push history). Every value comes from the
// published configuration or persisted records; writes go through services.
export default async function SettingsPage({ params }: { params: Promise<{ agencySlug: string; section: string }> }) {
  const { agencySlug, section: raw } = await params
  const section = resolveSection(raw)
  if (!section) notFound()
  const ctx = await requireAgency(agencySlug)
  const { t, pick, timestamp, locale } = await getI18n(ctx.tenant.timezone)
  const v = await getSettingsView(ctx, section)
  const base = `/a/${ctx.tenant.slug}`
  const isOwner = ctx.role === "owner"

  return (
    <>
      <PageHeader
        title={t("settings.title")}
        description={t("settings.description", { app: v.agency.appName, agency: v.agency.name })}
        badges={v.published ? <Badge variant="outline">{t("settings.publishedRevision", { n: v.published.number })}</Badge> : <Badge variant="warning-light">{t("settings.noPublished")}</Badge>}
      />
      <SettingsTabs base={base} section={section} t={t} />

      {v.section === "brand" && (
        <div className="flex flex-col gap-6">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("settings.brand.identityTitle")}</FrameTitle>
              <FrameDescription>{t("settings.brand.identityHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
                <dt className="text-muted-foreground">{t("settings.brand.agencyName")}</dt>
                <dd>{v.agency.name}</dd>
                <dt className="text-muted-foreground">{t("settings.brand.appName")}</dt>
                <dd>{v.agency.appName}</dd>
                <dt className="text-muted-foreground">{t("settings.brand.slug")}</dt>
                <dd className="font-mono text-xs">/a/{v.agency.slug}</dd>
                <dt className="text-muted-foreground">{t("settings.brand.currency")}</dt>
                <dd className="font-mono text-xs">{v.agency.baseCurrency}</dd>
                <dt className="text-muted-foreground">{t("settings.brand.timezone")}</dt>
                <dd>{v.agency.timezone}</dd>
                <dt className="text-muted-foreground">{t("settings.brand.status")}</dt>
                <dd>{t(`records.state.${v.agency.status}`)}</dd>
              </dl>
            </FramePanel>
          </Frame>
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("settings.brand.brandTitle")}</FrameTitle>
              <FrameDescription>{t("settings.brand.brandHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel>
              <BrandForm agencySlug={ctx.tenant.slug} appName={v.agency.appName} accent={v.brand.accent} logoText={v.brand.logoText} publishAvailable={false} />
            </FramePanel>
          </Frame>
        </div>
      )}

      {v.section === "team" && (
        <div className="flex flex-col gap-6">
          <Frame spacing="default">
            <FrameHeader className="flex-row items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <FrameTitle>{t("settings.team.membersTitle")}</FrameTitle>
                <FrameDescription>{t("settings.team.membersHelp")}</FrameDescription>
              </div>
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`${base}/modules/setup/workflows/agency-access-governance`} />}>
                {t("settings.team.proposeRole")}
                <ArrowUpRightIcon aria-hidden="true" />
              </Button>
            </FrameHeader>
            <FramePanel className="p-0">
              <RecordGrid
                compact
                emptyMessage={t("settings.team.noMembers")}
                columns={[
                  { id: "name", header: "settings.team.columns.member", kind: "text", subKey: "email" },
                  { id: "role", header: "settings.team.columns.role", kind: "state", labelPrefix: "header.roles" },
                  { id: "status", header: "settings.team.columns.status", kind: "state", labelPrefix: "records.state" },
                ]}
                rows={v.members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, status: m.active ? "active" : "archived" }))}
              />
            </FramePanel>
          </Frame>
          {v.invites.length > 0 && (
            <Frame spacing="default">
              <FrameHeader>
                <FrameTitle>{t("settings.team.invitesTitle")}</FrameTitle>
                <FrameDescription>{t("settings.team.invitesHelp")}</FrameDescription>
              </FrameHeader>
              <FramePanel className="p-0">
                <RecordGrid
                  compact
                  emptyMessage={t("settings.team.noMembers")}
                  columns={[
                    { id: "name", header: "settings.team.columns.member", kind: "text", subKey: "email" },
                    { id: "role", header: "settings.team.columns.role", kind: "state", labelPrefix: "header.roles" },
                    { id: "status", header: "settings.team.columns.status", kind: "state", labelPrefix: "settings.team.inviteState" },
                  ]}
                  rows={v.invites.map((m) => ({ id: m.email, name: m.name, email: m.email, role: m.role, status: "simulated" }))}
                />
              </FramePanel>
            </Frame>
          )}
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("settings.team.matrixTitle")}</FrameTitle>
              <FrameDescription>{t("settings.team.matrixHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel className="p-0">
              <RecordGrid
                pageSize={30}
                emptyMessage={t("settings.team.noMembers")}
                columns={[
                  { id: "permission", header: "settings.team.columns.permission", kind: "mono" },
                  ...v.matrix.map((m) => ({ id: m.role, header: t(`header.roles.${m.role}`), kind: "state" as const, labelPrefix: "settings.team.grant", sortable: false })),
                ]}
                rows={PERMISSIONS.map((p) => ({ id: p, permission: p, ...Object.fromEntries(v.matrix.map((m) => [m.role, m.permissions.includes(p) ? "yes" : "no"])) }))}
              />
            </FramePanel>
          </Frame>
        </div>
      )}

      {v.section === "policy" && (
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("settings.policy.title")}</FrameTitle>
            <FrameDescription>{t("settings.policy.help")}</FrameDescription>
          </FrameHeader>
          <FramePanel className="p-0">
            <RecordGrid
              pageSize={42}
              rowHrefKey="href"
              emptyMessage={t("settings.team.noMembers")}
              columns={[
                { id: "label", header: "settings.policy.columns.capability", kind: "link", hrefKey: "href", subKey: "skillId" },
                { id: "effective", header: "settings.policy.columns.effective", kind: "state", labelPrefix: "settings.policy.modes" },
                { id: "approvers", header: "settings.policy.columns.approvers", kind: "text", subKey: "sod" },
                { id: "runners", header: "settings.policy.columns.runners", kind: "text" },
                { id: "mandatory", header: "settings.policy.columns.permanent", kind: "state", labelPrefix: "settings.policy.permanent" },
              ]}
              rows={v.rows.map((r) => ({
                id: r.skillId,
                label: pick(r.label),
                skillId: r.skillId,
                effective: r.effective,
                approvers: r.eligibleRoles.length ? r.eligibleRoles.map((x) => t(`header.roles.${x}`)).join(", ") : "—",
                sod: r.separationOfDuties ? t("workbench.sod") : "",
                runners: r.rolesThatCanRun.map((x) => t(`header.roles.${x}`)).join(", "),
                mandatory: r.mandatory ? "yes" : "no",
                href: `${base}/modules/${r.moduleKey}/workflows/${r.skillId}`,
              }))}
            />
          </FramePanel>
        </Frame>
      )}

      {v.section === "domains" && (
        <div className="flex flex-col gap-6">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("settings.domains.includedTitle")}</FrameTitle>
              <FrameDescription>{t("settings.domains.includedHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-mono text-xs">/a/{v.agency.slug}</span>
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={base} />}>
                {t("settings.domains.openWorkspace")}
              </Button>
            </FramePanel>
          </Frame>
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("settings.domains.customTitle")}</FrameTitle>
              <FrameDescription>{t("settings.domains.customHelp")}</FrameDescription>
            </FrameHeader>
            <FramePanel className="flex flex-col gap-4">
              {v.customDomain ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs">{v.customDomain}</span>
                    <Badge variant="outline">{t("common.simulated")}</Badge>
                    <Badge variant="outline">{t(`records.state.${v.agency.domainState}`)}</Badge>
                  </div>
                  <DomainSimulator agencySlug={ctx.tenant.slug} state={v.agency.domainState} allowed={isOwner} />
                  {!isOwner && <p className="text-xs text-muted-foreground">{t("settings.domains.ownerOnly")}</p>}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("settings.domains.none")}</p>
              )}
              <p className="text-xs text-muted-foreground">{t("settings.domains.purchaseNote")}</p>
            </FramePanel>
          </Frame>
        </div>
      )}

      {v.section === "plan" && (
        <div className="flex flex-col gap-6">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("settings.plan.title")}</FrameTitle>
              <FrameDescription>{t("settings.plan.help")}</FrameDescription>
            </FrameHeader>
            <FramePanel className="p-0">
              <RecordGrid
                compact
                emptyMessage={t("settings.plan.noLimits")}
                columns={[
                  { id: "label", header: "settings.plan.columns.limit", kind: "text" },
                  { id: "used", header: "settings.plan.columns.used", kind: "text", align: "end" },
                  { id: "limit", header: "settings.plan.columns.allowance", kind: "text", align: "end" },
                  { id: "measure", header: "settings.plan.columns.measure", kind: "state", labelPrefix: "settings.plan.measures" },
                ]}
                rows={[
                  { id: "storage", label: t("settings.plan.storage"), used: `${Math.round((v.usage.usedBytes / 1048576) * 10) / 10} MB`, limit: `${v.usage.storageMb} MB`, measure: "local" },
                  { id: "files", label: t("settings.plan.filesPerJob"), used: t("settings.plan.filesTotal", { n: v.usage.fileCount }), limit: String(v.usage.filesPerJob), measure: "local" },
                  { id: "runs", label: t("settings.plan.assistantRuns"), used: t("settings.plan.runsLastHour", { n: v.usage.runsLastHour }), limit: typeof v.limits.assistantRunsPerHour === "number" ? String(v.limits.assistantRunsPerHour) : "—", measure: "local" },
                  { id: "members", label: t("settings.plan.members"), used: String(v.usage.members), limit: "—", measure: "local" },
                  { id: "external", label: t("settings.plan.external"), used: "—", limit: "—", measure: "not_measured" },
                ]}
              />
            </FramePanel>
          </Frame>
          <PendingHandlerState title={t("settings.plan.changeTitle")} description={t("settings.plan.changeBody")} />
        </div>
      )}

      {v.section === "audit" && (
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("settings.audit.title")}</FrameTitle>
            <FrameDescription>{t("settings.audit.help")}</FrameDescription>
          </FrameHeader>
          <FramePanel className={v.events.length ? "p-0" : undefined}>
            {v.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("settings.audit.empty")}</p>
            ) : (
              <RecordGrid
                pageSize={25}
                emptyMessage={t("settings.audit.empty")}
                columns={[
                  { id: "recordedAt", header: "settings.audit.columns.at", kind: "timestamp" },
                  { id: "event", header: "settings.audit.columns.action", kind: "text", subKey: "commandType" },
                  { id: "actor", header: "settings.audit.columns.actor", kind: "text", subKey: "originLabel" },
                  { id: "record", header: "settings.audit.columns.record", kind: "link", hrefKey: "recordHref" },
                  { id: "correlation", header: "settings.audit.columns.run", kind: "link", hrefKey: "runHref", sortable: false },
                ]}
                rows={v.events.map((e) => ({
                  id: e.id,
                  recordedAt: e.recordedAt,
                  event: eventLabel(MESSAGES[locale], t, e.eventType),
                  commandType: e.commandType ?? "",
                  actor: e.actor ?? t("settings.audit.system"),
                  originLabel: t(`records.origin.${e.origin}`),
                  record: `${e.aggregateType}${e.aggregateRevision ? ` r${e.aggregateRevision}` : ""}`,
                  recordHref: aggregateHref(ctx.tenant.slug, e.aggregateType, e.aggregateId) ?? `${base}/settings/audit`,
                  correlation: e.correlationId && /^[0-9a-f-]{36}$/i.test(e.correlationId) ? e.correlationId.slice(0, 8) : "—",
                  runHref: e.correlationId && /^[0-9a-f-]{36}$/i.test(e.correlationId) ? `${base}/runs/${e.correlationId}` : `${base}/runs`,
                }))}
              />
            )}
          </FramePanel>
          <p className="px-1 text-xs text-muted-foreground">{v.events[0] ? t("settings.audit.latest", { at: timestamp(v.events[0].recordedAt) }) : null}</p>
        </Frame>
      )}
    </>
  )
}

function SettingsTabs({ base, section, t }: { base: string; section: string; t: (k: string) => string }) {
  return (
    <nav aria-label={t("settings.sectionsLabel")} className="-mx-1 flex gap-1 overflow-x-auto px-1">
      {SETTINGS_SECTIONS.map((s) => (
        <Button key={s} size="sm" variant={s === section ? "secondary" : "ghost"} aria-current={s === section ? "page" : undefined} nativeButton={false} render={<Link href={`${base}/settings/${s}`} />}>
          {t(`settings.sections.${s}`)}
        </Button>
      ))}
    </nav>
  )
}
