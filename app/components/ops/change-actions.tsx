"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, CircleXIcon, PlayIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { codeLabel } from "@/components/records/code-label"
import { Alert, AlertTitle } from "@/components/reui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { applyPlatformChangeAction, decidePlatformChangeAction, verifyPlatformChangeAction } from "@/server/actions/ui/ops"

/** Approve exact configuration change / reject / apply locally / verify on the same file. */
export function ChangeActions({ changeId, digest, canDecide, canApply, canVerify, decideReason }: { changeId: string; digest: string; canDecide: boolean; canApply: boolean; canVerify: boolean; decideReason: string | null }) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [reason, setReason] = useState("")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const applyKey = useRef(`ops:apply:${changeId}:${crypto.randomUUID()}`)
  const fail = (code: string, rule?: string) => setMsg({ ok: false, text: codeLabel(messages, t, rule ?? code) })
  const decide = (decision: "approve" | "reject") =>
    start(async () => {
      setMsg(null)
      const res = await decidePlatformChangeAction({ changeId, decision, reviewedDigest: digest, reason: reason.trim() || undefined })
      if (!res.ok) return fail(res.error.code, (res.error.details as { rule?: string }).rule)
      setMsg({ ok: res.data.outcome !== "stale", text: t(`ops.change.outcome.${res.data.outcome}`) })
      router.refresh()
    })
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      {msg && (
        <Alert variant={msg.ok ? "success" : "warning"}>
          {msg.ok ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
          <AlertTitle>{msg.text}</AlertTitle>
        </Alert>
      )}
      {canDecide && (
        <Field>
          <FieldLabel htmlFor="ops-decision-reason">{t("ops.change.reason")}</FieldLabel>
          <Textarea id="ops-decision-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="min-h-16 resize-none" />
        </Field>
      )}
      {decideReason && <p className="text-xs text-muted-foreground">{decideReason}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!canDecide || pending} onClick={() => decide("approve")}>
          <ShieldCheckIcon aria-hidden="true" />
          {t("ops.change.approve")}
        </Button>
        <Button size="sm" variant="outline" disabled={!canDecide || pending || reason.trim().length < 3} onClick={() => decide("reject")}>
          <CircleXIcon aria-hidden="true" />
          {t("ops.change.reject")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canApply || pending}
          onClick={() =>
            start(async () => {
              setMsg(null)
              const res = await applyPlatformChangeAction({ changeId, idempotencyKey: applyKey.current })
              if (!res.ok) return fail(res.error.code, (res.error.details as { rule?: string }).rule)
              setMsg({ ok: true, text: t("ops.change.applied", { rev: res.data.profileRevision }) })
              router.refresh()
            })
          }
        >
          <PlayIcon aria-hidden="true" />
          {t("ops.change.apply")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canVerify || pending}
          onClick={() =>
            start(async () => {
              setMsg(null)
              const res = await verifyPlatformChangeAction({ changeId })
              if (!res.ok) return fail(res.error.code, (res.error.details as { rule?: string }).rule)
              setMsg({ ok: res.data.passed, text: res.data.passed ? t("ops.change.verifiedOk", { n: res.data.after.observedColumns }) : t("ops.change.verifiedFail") })
              router.refresh()
            })
          }
        >
          <CheckIcon aria-hidden="true" />
          {t("ops.change.verify")}
        </Button>
      </div>
    </div>
  )
}
