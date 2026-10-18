"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FileSearchIcon, GitPullRequestDraftIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { codeLabel } from "@/components/records/code-label"
import { Alert, AlertTitle } from "@/components/reui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { investigateAction, proposeDelimiterAction } from "@/server/actions/ui/ops"

const DELIMS = [",", ";", "\t", "|"]
const label = (d: string) => (d === "\t" ? "TAB" : d)

/** Investigate (re-run the real parser) and prepare the typed delimiter change. */
export function IncidentActions({
  incidentId,
  state,
  isOperator,
  profileRevision,
  currentDelimiter,
  recommended,
}: {
  incidentId: string
  state: string
  isOperator: boolean
  profileRevision: number
  currentDelimiter: string
  recommended: string | null
}) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [delimiter, setDelimiter] = useState(recommended ?? ";")
  const [reason, setReason] = useState("")
  const key = useRef(`ops:propose:${incidentId}:${crypto.randomUUID()}`)
  const canInvestigate = state === "detected" || state === "investigating"
  const canPropose = state === "investigating" && isOperator
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      {error && (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!canInvestigate || pending}
          onClick={() =>
            start(async () => {
              setError(null)
              const res = await investigateAction({ incidentId })
              if (!res.ok) return setError(codeLabel(messages, t, (res.error.details as { rule?: string }).rule ?? res.error.code))
              router.refresh()
            })
          }
        >
          <FileSearchIcon aria-hidden="true" />
          {t("ops.incident.investigate")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("ops.incident.investigateHelp")}</span>
      </div>
      <form
        className="flex flex-col gap-3 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            setError(null)
            const res = await proposeDelimiterAction({ incidentId, delimiter, expectedProfileRevision: profileRevision, reason, idempotencyKey: key.current })
            if (!res.ok) {
              key.current = `ops:propose:${incidentId}:${crypto.randomUUID()}`
              return setError(codeLabel(messages, t, (res.error.details as { rule?: string }).rule ?? res.error.code))
            }
            router.push(`/ops/changes/${res.data.changeId}`)
          })
        }}
      >
        <span className="text-sm font-medium">{t("ops.incident.proposeTitle")}</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="ops-delim">{t("ops.incident.newDelimiter", { from: label(currentDelimiter) })}</FieldLabel>
            <Select items={DELIMS.map((d) => ({ value: d, label: label(d) }))} value={delimiter} onValueChange={(v) => setDelimiter(String(v ?? ";"))} disabled={!canPropose || pending}>
              <SelectTrigger id="ops-delim" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIMS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {label(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t("ops.incident.allowlistOnly")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ops-reason">{t("ops.incident.reason")}</FieldLabel>
            <Textarea id="ops-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} disabled={!canPropose || pending} className="min-h-16 resize-none" />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!canPropose || pending || reason.trim().length < 3 || delimiter === currentDelimiter}>
            <GitPullRequestDraftIcon aria-hidden="true" />
            {t("ops.incident.prepare")}
          </Button>
          {!isOperator && <span className="text-xs text-muted-foreground">{t("ops.incident.operatorOnly")}</span>}
          {isOperator && state !== "investigating" && <span className="text-xs text-muted-foreground">{t("ops.incident.investigateFirst")}</span>}
        </div>
      </form>
    </div>
  )
}
