import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/app/page-header"
import { RecordGrid } from "@/components/app/record-grid"
import { StateBadge } from "@/components/app/state-badge"
import { BlockedState, PendingHandlerState } from "@/components/app/states"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { WorkbenchForm } from "@/components/workbench/workbench-form"
import type { FieldType } from "@/lib/capabilities/types"
import { requireAgency } from "@/server/auth/request"
import { getCapability, HANDLERS } from "@/server/capabilities/registry"
import { loadReferenceOptions, recentRuns } from "@/server/domain/references"
import { getBusinessDate } from "@/server/domain/presenter"
import { getI18n } from "@/server/i18n"

export const metadata: Metadata = { title: "Workflow" }

// workflow-workbench family: one shared surface for all 42 capabilities —
// Context → typed Inputs → server Validation → persisted Output → Next action,
// beside the verbatim contract and its implementation status.
export default async function WorkbenchPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; moduleKey: string; skillId: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { agencySlug, moduleKey, skillId } = await params
  const sp = await searchParams
  const ctx = await requireAgency(agencySlug)
  const cap = getCapability(skillId)
  if (!cap || cap.contract.moduleKey !== moduleKey) notFound()
  const { t, pick, date, timestamp } = await getI18n(ctx.tenant.timezone)
  const g = cap.governance
  const types = [...new Set(cap.inputFields.map((f) => f.type))] as FieldType[]
  const refs = await loadReferenceOptions(ctx, types)
  const runs = await recentRuns(ctx, skillId)
  const businessDate = await getBusinessDate()
  const enabled = g.mandatory || ctx.enabledCapabilities.has(skillId)
  const canView = ctx.permissions.has(g.viewPermission)
  const canExecute = ctx.permissions.has(g.executePermission)
  const implemented = cap.status !== "registered"
  const handler = HANDLERS[skillId]
  const revisionOf = handler && handler.kind === "command" ? (handler.revisionOf ?? null) : null
  const preset: Record<string, string> = {}
  if (sp.job && refs.job?.some((o) => o.value === sp.job)) preset.job = sp.job
  if (sp.client && refs.client?.some((o) => o.value === sp.client)) preset.client = sp.client
  const blockedReason = !enabled ? "disabled" : !canExecute ? "forbidden" : null
  const base = `/a/${ctx.tenant.slug}`

  if (!canView) {
    return <BlockedState title={t("states.forbiddenTitle")} description={t("states.forbiddenBody")} />
  }

  return (
    <>
      <PageHeader
        title={pick(cap.contract.label)}
        description={cap.contract.deliverableSummary}
        badges={
          <>
            <StateBadge state={cap.status} label={t(`records.state.${cap.status}`)} />
            <Badge variant="outline" className="font-mono">
              {cap.contract.skillId}
            </Badge>
          </>
        }
        actions={
          <Link href={`${base}/modules/${moduleKey}`} className="text-sm font-medium underline-offset-3 hover:underline">
            {t(`modules.names.${moduleKey}`)}
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("workbench.regions.context")}</FrameTitle>
            </FrameHeader>
            <FramePanel>
              <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">{t("workbench.contextAgency")}</dt>
                <dd>
                  {ctx.tenant.appName} · {ctx.tenant.name}
                </dd>
                <dt className="text-muted-foreground">{t("workbench.contextActor")}</dt>
                <dd>
                  {ctx.user.displayName} · {t(`header.roles.${ctx.role}`)}
                </dd>
                <dt className="text-muted-foreground">{t("workbench.contextBusinessDate")}</dt>
                <dd>{date(businessDate)}</dd>
              </dl>
            </FramePanel>
          </Frame>

          {!implemented && <PendingHandlerState title={t("workbench.pendingTitle")} description={t("workbench.pendingBody", { action: cap.contract.actionId })} />}
          {blockedReason === "disabled" && <BlockedState title={t("workbench.disabledTitle")} description={t("workbench.disabledBody")} />}
          {blockedReason === "forbidden" && implemented && (
            <BlockedState title={t("states.forbiddenTitle")} description={t("workbench.forbiddenBody", { role: t(`header.roles.${ctx.role}`), permission: g.executePermission })} />
          )}

          <WorkbenchForm
            agencySlug={ctx.tenant.slug}
            skillId={skillId}
            fields={cap.inputFields}
            refs={refs}
            preset={preset}
            currency={ctx.tenant.baseCurrency}
            implemented={implemented}
            revisionOf={revisionOf}
            blockedReason={blockedReason}
          />

          <Frame spacing="default">
            <FrameHeader>
              <FrameTitle>{t("workbench.regions.runs")}</FrameTitle>
            </FrameHeader>
            <FramePanel className="p-0">
              <RecordGrid
                compact
                emptyMessage={t("workbench.runsEmpty")}
                rowHrefKey="href"
                columns={[
                  { id: "startedAt", header: "workbench.runColumns.started", kind: "timestamp" },
                  { id: "state", header: "workbench.runColumns.state", kind: "state", labelPrefix: "records.state" },
                  { id: "origin", header: "workbench.runColumns.origin", kind: "text" },
                  { id: "actor", header: "workbench.runColumns.actor", kind: "text" },
                ]}
                rows={runs.map((r) => ({ ...r, origin: t(`records.origin.${r.origin}`), href: `${base}/runs/${r.id}` }))}
              />
            </FramePanel>
          </Frame>
        </div>

        <Frame spacing="default" className="min-w-0 self-start">
          <FrameHeader>
            <FrameTitle>{t("workbench.regions.contract")}</FrameTitle>
            <FrameDescription>{t("workbench.statusHelp")}</FrameDescription>
          </FrameHeader>
          <FramePanel className="flex flex-col gap-3 text-sm">
            <ContractRow label={t("workbench.status")}>
              <StateBadge state={cap.status} label={t(`records.state.${cap.status}`)} />
              {cap.handlerVersion && <Badge variant="outline">{cap.handlerVersion}</Badge>}
            </ContractRow>
            <ContractRow label={t("workbench.action")}>
              <code className="font-mono text-xs">{cap.contract.actionId}</code>
            </ContractRow>
            <ContractRow label={t("workbench.specialist")}>
              <span>{t(`assistant.specialists.${cap.contract.specialistKey}`)}</span>
            </ContractRow>
            <ContractRow label={t("workbench.inputRequirement")}>
              <span>{cap.contract.inputRequirement}</span>
            </ContractRow>
            <ContractRow label={t("workbench.outputRequirement")}>
              <span>{cap.contract.outputRequirement}</span>
            </ContractRow>
            <ContractRow label={t("workbench.outputs")}>
              <span className="flex flex-wrap gap-1">
                {cap.contract.repositoryOutputs.map((o) => (
                  <Badge key={o} variant="outline" className="font-mono">
                    {o}
                  </Badge>
                ))}
              </span>
            </ContractRow>
            <ContractRow label={t("workbench.calculators")}>
              <span className="flex flex-wrap gap-1">
                {cap.contract.calculatorDependencies.length === 0 ? "—" : cap.contract.calculatorDependencies.map((c) => <Badge key={c} variant="outline" className="font-mono">{c}</Badge>)}
              </span>
            </ContractRow>
            <ContractRow label={t("workbench.permissions")}>
              <span className="flex flex-col gap-0.5">
                <span>
                  {t("workbench.view")}: <code className="font-mono text-xs">{g.viewPermission}</code>
                </span>
                <span>
                  {t("workbench.execute")}: <code className="font-mono text-xs">{g.executePermission}</code>
                </span>
              </span>
            </ContractRow>
            <ContractRow label={t("workbench.approval")}>
              <span className="flex flex-col gap-0.5">
                <span>{t(`workbench.approvalMode.${g.approval.mode}`)}</span>
                {g.approval.eligibleRoles && (
                  <span className="text-xs text-muted-foreground">
                    {t("workbench.eligible")}: {g.approval.eligibleRoles.map((r) => t(`header.roles.${r}`)).join(", ")}
                  </span>
                )}
                {g.approval.separationOfDuties && <span className="text-xs text-muted-foreground">{t("workbench.sod")}</span>}
                <span className="text-xs text-muted-foreground">{pick(g.approval.note)}</span>
              </span>
            </ContractRow>
            <ContractRow label={t("workbench.dependsOn")}>
              <span className="flex flex-col gap-0.5">
                {g.dependsOn.length === 0 ? <span>{t("workbench.noDependencies")}</span> : g.dependsOn.map((d) => <code key={d} className="font-mono text-xs">{d}</code>)}
                {g.mandatory && <span className="text-xs text-muted-foreground">{t("workbench.mandatory")}</span>}
              </span>
            </ContractRow>
            <ContractRow label={t("workbench.acceptance")}>
              <span className="flex flex-col gap-1 text-xs">
                <span>
                  <span className="font-medium">{t("workbench.positive")}:</span> {cap.contract.acceptance.positive}
                </span>
                <span>
                  <span className="font-medium">{t("workbench.negative")}:</span> {cap.contract.acceptance.negative}
                </span>
                <span className="text-muted-foreground">
                  {t("workbench.testId")}: <code className="font-mono">{cap.contract.acceptance.testId}</code>
                </span>
              </span>
            </ContractRow>
            {cap.contract.connectorOptions.length > 0 && (
              <ContractRow label={t("workbench.connectors")}>
                <span className="flex flex-wrap gap-1">
                  {cap.contract.connectorOptions.map((c) => (
                    <Badge key={c} variant="outline">
                      {c}
                    </Badge>
                  ))}
                </span>
              </ContractRow>
            )}
            <ContractRow label={t("workbench.route")}>
              <code className="font-mono text-xs break-all">{cap.contract.route}</code>
            </ContractRow>
            {runs[0] && <p className="text-xs text-muted-foreground">{timestamp(runs[0].startedAt)}</p>}
          </FramePanel>
        </Frame>
      </div>
    </>
  )
}

function ContractRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}
