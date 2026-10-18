"use client"

import Link from "next/link"
import { ArrowUpRightIcon, CheckIcon, ClockIcon, GitBranchIcon, LockIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react"

import { OpenUIMessage } from "@/components/openui/openui-view"
import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { fmtMinutesAsHours } from "@/lib/format"
import type { MessagePart } from "@/lib/assistant/types"

import { useAssistant } from "./assistant-provider"
import { FeaturedScenarios, ScenarioCatalog } from "./scenario-catalog"

// Allowlisted renderer for typed message parts. Unknown part types render
// nothing; no message can inject markup or code. OpenUI views go through the
// closed library in components/openui with a readable fallback.

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</span>
    </div>
  )
}

const internal = (href: string | null | undefined, slug: string) => Boolean(href && href.startsWith(`/a/${slug}/`) && !href.startsWith("//"))

function MarginResult({ part }: { part: Extract<MessagePart, { type: "margin_result" }> }) {
  const { t, money, pct, date, locale } = useI18n()
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle>{t("assistant.card.marginTitle")}</CardTitle>
        <CardDescription>
          {part.job.name} · {part.job.displayReference} · {part.job.jobNumber}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <Row label={t("assistant.card.agencyFee")} value={money(part.agencyFeeMinor, part.currency)} />
        <Row label={t("assistant.card.agencyCost")} value={money(part.agencyCostMinor, part.currency)} />
        <Row label={t("assistant.card.margin")} value={`${money(part.marginMinor, part.currency)} · ${pct(part.marginBps)}`} strong />
        <Row label={t("assistant.card.managedMedia")} value={money(part.managedMediaMinor, part.currency)} />
        <Row label={t("assistant.card.laborHours")} value={fmtMinutesAsHours(part.laborMinutes, locale)} />
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Badge variant="outline">{t("assistant.card.basis")}: {t(`common.${part.basis}`)}</Badge>
          <Badge variant="outline">{t("assistant.card.asOf")} {date(part.asOf)}</Badge>
          <Badge variant="outline">{t("assistant.card.revision")} {part.jobRevision}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("assistant.card.definition")}: {part.definition}
        </p>
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={part.job.href} />}>
          {t("assistant.card.openJob")}
          <ArrowUpRightIcon aria-hidden="true" data-icon="inline-end" />
        </Button>
      </CardFooter>
    </Card>
  )
}

function Proposal({ part }: { part: Extract<MessagePart, { type: "proposal" }> }) {
  const { t, pick } = useI18n()
  const assistant = useAssistant()
  const st = assistant.conversation?.activeRun
  const live = st?.status === "waiting_confirmation" && part.state === "awaiting_confirmation"
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle>{pick(part.title)}</CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          <ShieldCheckIcon aria-hidden="true" className="size-3.5" />
          {part.requires === "approval" ? t("assistant.card.proposalRequiresApproval") : t("assistant.card.proposalRequiresConfirmation")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <table className="w-full text-sm">
          <caption className="sr-only">{pick(part.title)}</caption>
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="py-1 text-left font-medium">
                <span className="sr-only">{t("assistant.card.field")}</span>
              </th>
              <th scope="col" className="py-1 text-left font-medium">{t("assistant.card.before")}</th>
              <th scope="col" className="py-1 text-left font-medium">{t("assistant.card.after")}</th>
            </tr>
          </thead>
          <tbody>
            {part.rows.map((r, i) => (
              <tr key={i} className="border-t border-border/60">
                <th scope="row" className="py-1 pe-2 text-left font-normal text-muted-foreground">{pick(r.label)}</th>
                <td className="py-1 pe-2 tabular-nums text-muted-foreground">{r.before ?? "—"}</td>
                <td className="py-1 font-medium break-words tabular-nums">{r.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {part.impact.map((i, idx) => (
          <Row key={idx} label={pick(i.label)} value={i.value} />
        ))}
        <p className="font-mono text-xs break-all text-muted-foreground">sha256 {part.digest.slice(0, 16)}…</p>
      </CardContent>
      <CardFooter className="justify-between gap-2">
        {live ? (
          <Button size="sm" disabled={assistant.sending} onClick={() => void assistant.confirm(part.proposalId, part.digest)}>
            <CheckIcon aria-hidden="true" />
            {t("assistant.card.confirm")}
          </Button>
        ) : (
          <Badge variant="outline">{t(`assistant.card.proposalState.${part.state}`)}</Badge>
        )}
      </CardFooter>
    </Card>
  )
}

function ApprovalRequest({ part }: { part: Extract<MessagePart, { type: "approval_request" }> }) {
  const { t, pick } = useI18n()
  const decided = part.state !== "awaiting_approval"
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle>{t("assistant.card.approvalTitle")}</CardTitle>
        <CardDescription>{pick(part.title)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <Row label={t("assistant.card.approvalState")} value={t(`assistant.card.approvalStates.${part.state}`)} strong />
        <Row label={t("assistant.card.eligibleApprovers")} value={part.eligibleRoles.join(", ")} />
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {t("assistant.card.approvalNote")}
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={part.href} />}>
          {decided ? t("assistant.card.viewApproval") : t("assistant.card.openApproval")}
          <ArrowUpRightIcon aria-hidden="true" data-icon="inline-end" />
        </Button>
      </CardFooter>
    </Card>
  )
}

export function MessageParts({ parts }: { parts: MessagePart[] }) {
  const { t, pick } = useI18n()
  const assistant = useAssistant()
  const pickPreset = (presetId: string) => void assistant.send({ presetId })
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {parts.map((part, idx) => {
        switch (part.type) {
          case "text":
            return (
              <p key={idx} className="text-sm/6">
                {t(part.template, part.params ?? undefined)}
              </p>
            )
          case "user_text":
            return (
              <p key={idx} className="text-sm/6 whitespace-pre-wrap">
                {part.text}
              </p>
            )
          case "margin_result":
            return <MarginResult key={idx} part={part} />
          case "openui_view":
            return <OpenUIMessage key={idx} part={part} agencySlug={assistant.slug} />
          case "proposal":
            return <Proposal key={idx} part={part} />
          case "approval_request":
            return <ApprovalRequest key={idx} part={part} />
          case "sources":
            return (
              <div key={idx} className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">{t("assistant.card.sourcesTitle")}</p>
                <ul className="flex flex-col gap-1">
                  {part.refs.map((r) => (
                    <li key={`${r.recordType}:${r.recordId}`} className="flex flex-wrap items-center gap-1.5 text-xs">
                      {internal(r.href, assistant.slug) ? (
                        <Link href={r.href} className="font-medium text-foreground underline-offset-3 hover:underline">
                          {r.label}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.label}</span>
                      )}
                      <span className="text-muted-foreground">
                        {r.recordType}
                        {r.revision !== null ? ` · r${r.revision}` : ""} · {r.asOf}
                        {r.currency ? ` · ${r.currency}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          case "input_request": {
            const waiting = assistant.conversation?.activeRun?.id === part.runId && assistant.conversation.activeRun.status === "waiting_input"
            return (
              <div key={idx} role="group" aria-label={pick(part.label)} className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">{pick(part.label)}</p>
                {part.help ? <p className="text-xs text-muted-foreground">{pick(part.help)}</p> : null}
                {part.freeText ? (
                  waiting ? <p className="text-xs text-muted-foreground">{t("assistant.skill.replyInComposer")}</p> : null
                ) : part.options.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {part.options.map((o) => (
                      <Button key={o.value} type="button" variant="outline" size="sm" disabled={!waiting || assistant.sending} onClick={() => void assistant.send({ text: o.label })}>
                        {o.label}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("assistant.skill.noOptions")}</p>
                )}
              </div>
            )
          }
          case "receipt":
            return (
              <Card key={idx} size="sm" className="w-full">
                <CardHeader>
                  <CardTitle>{pick(part.title)}</CardTitle>
                  {part.replayed && <CardDescription>{t("assistant.card.receiptReplayed")}</CardDescription>}
                </CardHeader>
                <CardContent className="flex flex-col gap-1.5">
                  {part.lines.map((l, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">{pick(l.label)}</span>
                      {l.href && internal(l.href, assistant.slug) ? (
                        <Link href={l.href} className="font-medium tabular-nums underline-offset-3 hover:underline">
                          {l.value}
                        </Link>
                      ) : (
                        <span className="tabular-nums">{l.value}</span>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )
          case "capability_result":
            return (
              <Card key={idx} size="sm" className="w-full">
                <CardHeader>
                  <CardTitle>{pick(part.label)}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={part.state === "succeeded" ? "success-light" : "warning-light"}>{t(`assistant.card.delegationState.${part.state}`)}</Badge>
                    <Badge variant="outline" className="font-mono">
                      {part.skillId}
                    </Badge>
                    {part.replayed ? <span>{t("assistant.card.receiptReplayed")}</span> : null}
                  </CardDescription>
                </CardHeader>
                {part.outputs.length ? (
                  <CardContent className="flex flex-col gap-1">
                    {part.outputs.map((o) => (
                      <div key={o.key} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="font-mono text-muted-foreground">{o.key}</span>
                        <span className="min-w-0 truncate tabular-nums">{o.summary}</span>
                      </div>
                    ))}
                  </CardContent>
                ) : null}
                <CardFooter>
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href={part.runHref} />}>
                    {t("assistant.card.viewRun")}
                    <ArrowUpRightIcon aria-hidden="true" data-icon="inline-end" />
                  </Button>
                </CardFooter>
              </Card>
            )
          case "capability_status":
            return (
              <Alert key={idx} variant="info">
                <ClockIcon aria-hidden="true" />
                <AlertTitle>{t(`assistant.skill.status.${part.status}`, { skill: pick(part.label) })}</AlertTitle>
                <AlertDescription className="flex flex-col gap-1.5">
                  <span>{t(`assistant.skill.statusBody.${part.status}`, { action: part.actionId })}</span>
                  <Link href={part.workbenchHref} className="font-medium underline-offset-3 hover:underline">
                    {t("assistant.skill.openWorkbench")}
                  </Link>
                </AlertDescription>
              </Alert>
            )
          case "blocked":
            return (
              <Alert key={idx} variant="warning">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertTitle>{t(`errors.${part.code}`)}</AlertTitle>
                <AlertDescription className="flex flex-col gap-1">
                  <span>{pick(part.message)}</span>
                  {typeof part.details?.rule === "string" ? (
                    <span className="font-mono text-xs">
                      {t("assistant.card.rule")}: {part.details.rule}
                    </span>
                  ) : null}
                  {typeof part.details?.permission === "string" ? (
                    <span className="font-mono text-xs">
                      {t("assistant.card.permission")}: {part.details.permission}
                    </span>
                  ) : null}
                </AlertDescription>
              </Alert>
            )
          case "attention_items":
            return (
              <Card key={idx} size="sm" className="w-full">
                <CardHeader>
                  <CardTitle>{t("assistant.attention.title")}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-1.5">
                    {internal(part.job.href, assistant.slug) ? (
                      <Link href={part.job.href} className="font-medium text-foreground underline-offset-3 hover:underline">
                        {part.job.displayReference} · {part.job.name}
                      </Link>
                    ) : (
                      <span>
                        {part.job.displayReference} · {part.job.name}
                      </span>
                    )}
                    <Badge variant="outline">{t("common.demoShort")}</Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {part.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("assistant.attention.empty")}</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-border">
                      {part.items.map((i) => (
                        <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                          <span className="flex min-w-0 flex-col">
                            {internal(i.href, assistant.slug) ? (
                              <Link href={i.href} className="font-medium underline-offset-3 hover:underline">
                                {pick(i.title)}
                              </Link>
                            ) : (
                              <span className="font-medium">{pick(i.title)}</span>
                            )}
                            {i.owner ? (
                              <span className="text-xs text-muted-foreground">
                                {t("assistant.attention.owner")}: {i.owner}
                              </span>
                            ) : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <Badge variant={i.severity === "blocked" ? "warning-light" : i.severity === "approval" ? "primary-light" : "outline"}>{t(`assistant.attention.sources.${i.source}`)}</Badge>
                            <Badge variant="outline" className="font-mono">
                              {i.state}
                            </Badge>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )
          case "restricted":
            return (
              <p key={idx} className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground">
                <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
                {part.reason === "permission" ? t("assistant.restricted.permission", { permission: part.permission ?? "" }) : t("assistant.restricted.unavailable", { count: part.count ?? 1 })}
              </p>
            )
          case "suggestions":
            return (
              <div key={idx} className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">{pick(part.heading)}</p>
                {part.items.some((s) => s.featured) || part.items.some((s) => s.group) ? (
                  <>
                    <FeaturedScenarios items={part.items} disabled={assistant.sending} onPick={pickPreset} />
                    <ScenarioCatalog items={part.items} disabled={assistant.sending} onPick={pickPreset} />
                  </>
                ) : null}
                {part.items
                  .filter((s) => !s.featured && !s.group)
                  .map((s) => (
                    <Button key={s.presetId} type="button" variant="outline" disabled={assistant.sending} onClick={() => pickPreset(s.presetId)} className="h-auto justify-start py-1.5 font-normal text-muted-foreground hover:text-foreground">
                      <span className="min-w-0 truncate">{pick(s.label)}</span>
                    </Button>
                  ))}
              </div>
            )
          case "delegation":
            return (
              <div key={idx} className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <GitBranchIcon aria-hidden="true" className="size-3.5" />
                <span>{t("assistant.card.delegatedTo", { specialist: t(`assistant.specialists.${part.subagentKey}`) })}</span>
                <Badge variant="outline">{part.skillIds.join(", ")}</Badge>
                <Badge variant={part.state === "succeeded" ? "success-light" : "warning-light"}>
                  {t(`assistant.card.delegationState.${part.state === "succeeded" ? "succeeded" : part.state === "blocked" ? "blocked" : "failed"}`)}
                </Badge>
                <Badge variant="outline">{t("common.simulated")}</Badge>
                {part.runHref && (
                  <Link href={part.runHref} className="underline-offset-3 hover:text-foreground hover:underline">
                    {t("assistant.card.viewRun")}
                  </Link>
                )}
              </div>
            )
          default:
            return null
        }
      })}
    </div>
  )
}
