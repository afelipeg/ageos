"use client"

import Link from "next/link"
import { CheckIcon, LockKeyholeIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import type { ConfigurationValidation } from "@/server/domain/configuration"

/** Review: what Deploy will publish, blockers with a link to the step that fixes them, and warnings. */
export function ReviewStep({ validation, base, issueText }: { validation: ConfigurationValidation; base: string; issueText: (code: string, details?: Record<string, unknown>) => string }) {
  const { t } = useI18n()
  const s = validation.summary
  return (
    <div className="flex flex-col gap-4">
      {validation.valid ? (
        <Alert variant="success">
          <CheckIcon aria-hidden="true" />
          <AlertTitle>{t("control.review.validTitle")}</AlertTitle>
          <AlertDescription>{t("control.review.validBody", { n: s.publish.revisionNumber })}</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <LockKeyholeIcon aria-hidden="true" />
          <AlertTitle>{t("control.review.blockedTitle", { n: validation.blockers.length })}</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {validation.blockers.map((b, i) => (
                <li key={i} className="flex flex-wrap items-center gap-1.5">
                  <span>
                    {t(`control.steps.${b.step}.title`)}: {issueText(b.code, b.details)}
                  </span>
                  <Link href={`${base}/${b.step}`} className="font-medium underline-offset-3 hover:underline">
                    {t("control.review.fix")}
                  </Link>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {validation.warnings.length > 0 && (
        <Alert variant="info">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t("control.review.warningsTitle")}</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {validation.warnings.map((w, i) => (
                <li key={i}>
                  {t(`control.steps.${w.step}.title`)}: {issueText(w.code, w.details)}{" "}
                  <Link href={`${base}/${w.step}`} className="underline-offset-3 hover:underline">
                    {t("common.edit")}
                  </Link>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr_auto]">
        <Row label={t("control.review.agency")} value={`${s.agency.name ?? "—"} · ${s.agency.appName ?? "—"}`} href={`${base}/agency`} edit={t("common.edit")} />
        <Row label={t("control.review.address")} value={s.agency.demoPath ?? `/a/${s.agency.slug ?? "—"}`} href={`${base}/brand-access`} edit={t("common.edit")} mono />
        <Row label={t("control.review.catalog")} value={t("control.review.catalogValue", { modules: s.catalog.modules, skills: s.catalog.skills, enabled: s.catalog.enabled })} href={`${base}/operations`} edit={t("common.edit")} />
        <Row label={t("control.review.mandatory")} value={s.catalog.mandatory.join(", ") || "—"} mono />
        <Row label={t("control.review.connections")} value={t("control.review.connectionsValue", { mode: t(`control.connections.modes.${s.connections.mode ?? "simulated"}.title`), n: s.connections.accounts })} href={`${base}/connections`} edit={t("common.edit")} />
        <Row label={t("control.review.members")} value={String(s.members)} href={`${base}/brand-access`} edit={t("common.edit")} />
        <Row label={t("control.review.domain")} value={s.customDomain ? `${s.customDomain} · ${t("common.simulated")}` : "—"} href={`${base}/brand-access`} edit={t("common.edit")} mono />
        <Row label={t("control.review.limits")} value={t("control.review.limitsValue", { storage: s.limits.storageMb, files: s.limits.filesPerJob, runs: s.limits.assistantRunsPerHour })} />
        <Row label={t("control.review.publish")} value={t("control.review.publishValue", { n: s.publish.revisionNumber, count: s.publish.enabledCapabilities.length })} />
        <Row label={t("control.review.digest")} value={`${s.publish.digest.slice(0, 24)}…`} mono />
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">{t("control.review.noInfra")}</Badge>
      </div>
    </div>
  )
}

function Row({ label, value, href, edit, mono }: { label: string; value: string; href?: string; edit?: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "min-w-0 font-mono text-xs break-all" : "min-w-0"}>{value}</dd>
      <dd className="sm:text-end">
        {href && edit ? (
          <Link href={href} className="text-xs font-medium underline-offset-3 hover:underline">
            {edit}
          </Link>
        ) : null}
      </dd>
    </>
  )
}
