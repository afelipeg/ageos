"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, CircleXIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { reviewEvidenceAction } from "@/server/actions/ui/evidence"

import { codeLabel } from "./code-label"

/** Review a piece of client evidence: Reviewed or Rejected, always with a reason. */
export function EvidenceReview({ agencySlug, evidenceId, allowed, reasonBlocked }: { agencySlug: string; evidenceId: string; allowed: boolean; reasonBlocked: string | null }) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; title: string; body?: string } | null>(null)
  const key = useRef(crypto.randomUUID())
  const decide = (decision: "reviewed" | "rejected") =>
    start(async () => {
      const res = await reviewEvidenceAction({ agencySlug, evidenceId, decision, reason, idempotencyKey: `ui:evidence:${decision}:${key.current}` })
      key.current = crypto.randomUUID()
      if (!res.ok) {
        const rule = (res.error.details as { rule?: string }).rule
        return setMsg({ ok: false, title: codeLabel(messages, t, res.error.code), body: rule ? codeLabel(messages, t, rule) : res.error.message })
      }
      setMsg({ ok: true, title: t(`records.evidence.done.${res.data.reviewState}`), body: res.data.staleApprovals ? t("records.evidence.staleApprovals", { n: res.data.staleApprovals }) : undefined })
      setReason("")
      router.refresh()
    })
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {reasonBlocked && <p className="text-xs text-muted-foreground">{reasonBlocked}</p>}
      <Field>
        <FieldLabel htmlFor="evidence-reason">{t("records.evidence.reason")}</FieldLabel>
        <Textarea id="evidence-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} disabled={!allowed || pending} className="min-h-16 resize-none" />
        <FieldDescription>{t("records.evidence.reasonHelp")}</FieldDescription>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!allowed || pending || reason.trim().length < 3} onClick={() => decide("reviewed")}>
          <CheckIcon aria-hidden="true" />
          {t("records.evidence.markReviewed")}
        </Button>
        <Button size="sm" variant="outline" disabled={!allowed || pending || reason.trim().length < 3} onClick={() => decide("rejected")}>
          <CircleXIcon aria-hidden="true" />
          {t("records.evidence.reject")}
        </Button>
      </div>
      {msg && (
        <Alert variant={msg.ok ? "success" : "warning"}>
          {msg.ok ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
          <AlertTitle>{msg.title}</AlertTitle>
          {msg.body && <AlertDescription>{msg.body}</AlertDescription>}
        </Alert>
      )}
    </div>
  )
}
