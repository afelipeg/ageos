"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, CircleXIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { codeLabel } from "@/components/records/code-label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { decideSettingsChangeAction } from "@/server/actions/ui/settings"

export type PendingSettingsChange = { id: string; number: number; payloadDigest: string | null; reason: string | null; summary: string; canDecide: boolean }

/**
 * A pending brand/plan configuration revision. An owner other than the
 * proposer approves the exact digest (publishing it) or rejects with a reason.
 */
export function SettingsChangeDecision({ agencySlug, change }: { agencySlug: string; change: PendingSettingsChange }) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [comment, setComment] = useState("")
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const decide = (decision: "approve" | "reject") =>
    start(async () => {
      if (!change.payloadDigest) return
      const res = await decideSettingsChangeAction({ agencySlug, revisionId: change.id, decision, reviewedDigest: change.payloadDigest, reason: comment.trim() || undefined, idempotencyKey: `ui:settings-decide:${change.id}:${decision}:${crypto.randomUUID()}` })
      if (!res.ok) return setMsg(codeLabel(messages, t, res.error.code))
      setMsg(t(`catalog.change.outcome.${res.data.outcome}`))
      router.refresh()
    })
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <span className="font-medium">{t("catalog.change.pendingLabel", { n: change.number })}</span>
      <span className="text-xs text-muted-foreground">{change.summary}</span>
      {change.reason && <p className="text-xs text-muted-foreground">“{change.reason}”</p>}
      {change.canDecide ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label={t("catalog.change.comment")} placeholder={t("catalog.change.comment")} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} className="min-h-12 resize-none" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => decide("approve")}>
              <CheckIcon aria-hidden="true" />
              {t("catalog.change.approve")}
            </Button>
            <Button size="sm" variant="outline" disabled={pending || comment.trim().length < 3} onClick={() => decide("reject")}>
              <CircleXIcon aria-hidden="true" />
              {t("catalog.change.reject")}
            </Button>
          </div>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">{t("catalog.change.ownerOther")}</span>
      )}
      {msg && (
        <span className="text-xs" aria-live="polite">
          {msg}
        </span>
      )}
    </div>
  )
}
