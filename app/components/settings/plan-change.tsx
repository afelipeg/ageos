"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { codeLabel } from "@/components/records/code-label"
import { Alert, AlertTitle } from "@/components/reui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { proposePlanChangeAction } from "@/server/actions/ui/settings"

import { SettingsChangeDecision, type PendingSettingsChange } from "./settings-change-decision"

type Plan = { key: string; storageMb: number; filesPerJob: number; assistantRunsPerHour: number }

/**
 * Change demo plan: pick a catalog plan (sample quotas only, never prices),
 * give a reason and submit a configuration revision for an owner other than
 * you to approve. Pending changes are listed with their decision controls.
 */
export function PlanChange({
  agencySlug,
  plans,
  currentPlan,
  publishedNumber,
  canPropose,
  pending,
}: {
  agencySlug: string
  plans: Plan[]
  currentPlan: string | null
  publishedNumber: number | null
  canPropose: boolean
  pending: PendingSettingsChange[]
}) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [plan, setPlan] = useState("")
  const [reason, setReason] = useState("")
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const key = useRef(crypto.randomUUID())
  const items = plans.map((p) => ({
    value: p.key,
    label: `${t(`settings.plan.plans.${p.key}`)} · ${t("settings.plan.quota", { storage: p.storageMb, files: p.filesPerJob, runs: p.assistantRunsPerHour })}`,
  }))
  const submit = () =>
    start(async () => {
      if (publishedNumber === null) return
      const res = await proposePlanChangeAction({ agencySlug, plan, reason, expectedRevision: publishedNumber, idempotencyKey: `ui:plan:${key.current}` })
      if (!res.ok) return setMsg({ ok: false, text: codeLabel(messages, t, res.error.code) })
      key.current = crypto.randomUUID()
      setMsg({ ok: true, text: t("settings.plan.sent", { n: res.data.number }) })
      setReason("")
      router.refresh()
    })
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{currentPlan ? t("settings.plan.current", { plan: t(`settings.plan.plans.${currentPlan}`) }) : t("settings.plan.noCurrent")}</p>
      {canPropose && (
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="plan-select">{t("settings.plan.choose")}</FieldLabel>
            <Select items={items} value={plan} onValueChange={(v) => setPlan(String(v ?? ""))} disabled={busy}>
              <SelectTrigger id="plan-select" size="sm" className="w-full">
                <SelectValue placeholder={t("settings.plan.choose")} />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="plan-reason">{t("catalog.change.reason")}</FieldLabel>
            <Textarea id="plan-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-12 resize-none" disabled={busy} />
            <FieldDescription>{t("catalog.change.reasonHelp")}</FieldDescription>
          </Field>
          <div>
            <Button size="sm" disabled={busy || !plan || plan === currentPlan || reason.trim().length < 3 || publishedNumber === null} onClick={submit}>
              {t("catalog.change.submit")}
            </Button>
          </div>
        </div>
      )}
      {msg && (
        <Alert variant={msg.ok ? "success" : "warning"} aria-live="polite">
          {msg.ok ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
          <AlertTitle>{msg.text}</AlertTitle>
        </Alert>
      )}
      {pending.map((c) => (
        <SettingsChangeDecision key={c.id} agencySlug={agencySlug} change={c} />
      ))}
    </div>
  )
}
