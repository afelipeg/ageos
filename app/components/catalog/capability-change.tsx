"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, CircleXIcon, SlidersHorizontalIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { codeLabel } from "@/components/records/code-label"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { decideCapabilityChangeAction, proposeCapabilityChangeAction } from "@/server/actions/ui/configuration"

type Cap = { skillId: string; label: string; moduleLabel: string; enabled: boolean; mandatory: boolean }

/**
 * Request an activation change: a new configuration revision that an owner
 * other than the requester approves. Mandatory controls cannot be disabled;
 * dependencies are validated by the configuration service.
 */
export function CapabilityChangeDialog({ agencySlug, caps, publishedNumber, allowed }: { agencySlug: string; caps: Cap[]; publishedNumber: number | null; allowed: boolean }) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState("")
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const key = useRef(crypto.randomUUID())
  const enable = caps.filter((c) => !c.enabled && toggled.has(c.skillId)).map((c) => c.skillId)
  const disable = caps.filter((c) => c.enabled && toggled.has(c.skillId)).map((c) => c.skillId)
  return (
    <>
      <Button size="sm" variant="outline" disabled={!allowed || publishedNumber === null} onClick={() => setOpen(true)}>
        <SlidersHorizontalIcon aria-hidden="true" />
        {t("catalog.change.request")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("catalog.change.title")}</DialogTitle>
            <DialogDescription>{t("catalog.change.body", { n: publishedNumber ?? "—" })}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-2">
            {caps.map((c) => (
              <Field key={c.skillId} orientation="horizontal" className="items-start gap-2">
                <Checkbox
                  id={`cc-${c.skillId}`}
                  checked={toggled.has(c.skillId) ? !c.enabled : c.enabled}
                  disabled={c.mandatory}
                  onCheckedChange={() =>
                    setToggled((s) => {
                      const n = new Set(s)
                      if (n.has(c.skillId)) n.delete(c.skillId)
                      else n.add(c.skillId)
                      return n
                    })
                  }
                />
                <FieldLabel htmlFor={`cc-${c.skillId}`} className="flex flex-col items-start gap-0.5 font-normal">
                  <span>{c.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.moduleLabel} · <span className="font-mono">{c.skillId}</span>
                    {c.mandatory ? ` · ${t("catalog.mandatory")}` : ""}
                  </span>
                </FieldLabel>
              </Field>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("catalog.change.summary", { enable: enable.length, disable: disable.length })}</p>
          <Field>
            <FieldLabel htmlFor="cc-reason">{t("catalog.change.reason")}</FieldLabel>
            <Textarea id="cc-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-16 resize-none" />
            <FieldDescription>{t("catalog.change.reasonHelp")}</FieldDescription>
          </Field>
          {error && (
            <Alert variant="warning">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={pending || (enable.length + disable.length === 0) || reason.trim().length < 3 || publishedNumber === null}
              onClick={() =>
                start(async () => {
                  setError(null)
                  const res = await proposeCapabilityChangeAction({ agencySlug, enable, disable, reason, expectedRevision: publishedNumber!, idempotencyKey: `ui:capchange:${key.current}` })
                  if (!res.ok) {
                    key.current = crypto.randomUUID()
                    const rule = (res.error.details as { rule?: string }).rule
                    return setError(rule ? `${codeLabel(messages, t, res.error.code)} · ${codeLabel(messages, t, rule)}` : codeLabel(messages, t, res.error.code))
                  }
                  setOpen(false)
                  setToggled(new Set())
                  setReason("")
                  key.current = crypto.randomUUID()
                  router.refresh()
                })
              }
            >
              {t("catalog.change.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Pending change: owner (not the requester) approves the exact digest or rejects with a reason. */
export function PendingCapabilityChange({
  agencySlug,
  revisionId,
  number,
  digest,
  diff,
  reason,
  canDecide,
}: {
  agencySlug: string
  revisionId: string
  number: number
  digest: string
  diff: { enabled: string[]; disabled: string[] } | null
  reason: string | null
  canDecide: boolean
}) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [comment, setComment] = useState("")
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const decide = (decision: "approve" | "reject") =>
    start(async () => {
      const res = await decideCapabilityChangeAction({ agencySlug, revisionId, decision, reviewedDigest: digest, reason: comment.trim() || undefined, idempotencyKey: `ui:capdecide:${revisionId}:${decision}:${crypto.randomUUID()}` })
      if (!res.ok) return setMsg({ ok: false, text: codeLabel(messages, t, res.error.code) })
      setMsg({ ok: res.data.outcome === "published", text: t(`catalog.change.outcome.${res.data.outcome}`) })
      router.refresh()
    })
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t("catalog.change.pendingLabel", { n: number })}</span>
        {(diff?.enabled ?? []).map((s) => (
          <Badge key={`e-${s}`} variant="success-light" className="font-mono">
            +{s}
          </Badge>
        ))}
        {(diff?.disabled ?? []).map((s) => (
          <Badge key={`d-${s}`} variant="warning-light" className="font-mono">
            −{s}
          </Badge>
        ))}
      </div>
      {reason && <p className="text-xs text-muted-foreground">“{reason}”</p>}
      {canDecide ? (
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
        <p className="text-xs text-muted-foreground">{t("catalog.change.ownerOther")}</p>
      )}
      {msg && (
        <Alert variant={msg.ok ? "success" : "warning"}>
          {msg.ok ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
