"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { codeLabel } from "@/components/records/code-label"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { assignInboxItemAction, resolveInboxItemAction, snoozeInboxItemAction } from "@/server/actions/ui/inbox"

/**
 * Assign / snooze / resolve for one attention item. Each control calls a
 * server command of the attention service with the revision shown; snooze
 * requires a business date and never clears the blocking condition; resolve
 * is accepted only when the service confirms the condition is gone.
 */
export function InboxItemActions({
  agencySlug,
  itemId,
  revision,
  state,
  assigneeId,
  members,
  available,
}: {
  agencySlug: string
  itemId: string
  revision: number
  state: string
  assigneeId: string | null
  members: { value: string; label: string }[]
  available: boolean
}) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [assignee, setAssignee] = useState(assigneeId ?? "")
  const [until, setUntil] = useState("")
  const [note, setNote] = useState("")
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const disabled = !available || state === "resolved" || pending
  const submit = (kind: "assign" | "snooze" | "resolve") =>
    start(async () => {
      const base = { agencySlug, itemId, revision, idempotencyKey: `ui:inbox:${kind}:${itemId}:${revision}:${crypto.randomUUID()}` }
      const res =
        kind === "assign"
          ? await assignInboxItemAction({ ...base, assignee })
          : kind === "snooze"
            ? await snoozeInboxItemAction({ ...base, until })
            : await resolveInboxItemAction({ ...base, note })
      if (!res.ok) {
        const rule = typeof res.error.details.rule === "string" ? res.error.details.rule : null
        return setMsg({ ok: false, text: rule ? `${codeLabel(messages, t, res.error.code)} · ${codeLabel(messages, t, rule)}` : codeLabel(messages, t, res.error.code) })
      }
      setMsg({ ok: true, text: t("inbox.actions.done") })
      router.refresh()
    })
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4" data-item={itemId}>
      <Field>
        <FieldLabel htmlFor={`assign-${itemId}`}>{t("inbox.actions.assign")}</FieldLabel>
        <div className="flex gap-2">
          <Select items={members} value={assignee} onValueChange={(v) => setAssignee(String(v ?? ""))} disabled={disabled}>
            <SelectTrigger id={`assign-${itemId}`} size="sm" className="w-full">
              <SelectValue placeholder={t("inbox.actions.choose")} />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={disabled || !assignee || assignee === assigneeId} onClick={() => submit("assign")}>
            {t("inbox.actions.save")}
          </Button>
        </div>
      </Field>
      <Field>
        <FieldLabel htmlFor={`snooze-${itemId}`}>{t("inbox.actions.snooze")}</FieldLabel>
        <div className="flex gap-2">
          <Input id={`snooze-${itemId}`} type="date" value={until} min="2027-01-01" max="2028-12-31" onChange={(e) => setUntil(e.target.value)} disabled={disabled} />
          <Button size="sm" variant="outline" disabled={disabled || !until} onClick={() => submit("snooze")}>
            {t("inbox.actions.snoozeCta")}
          </Button>
        </div>
        <FieldDescription>{t("inbox.actions.snoozeHelp")}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`resolve-${itemId}`}>{t("inbox.actions.resolveNote")}</FieldLabel>
        <Textarea id={`resolve-${itemId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="min-h-12 resize-none" disabled={disabled} />
        <div className="flex flex-col gap-1">
          <Button size="sm" variant="outline" disabled={disabled || note.trim().length < 3} onClick={() => submit("resolve")}>
            {t("inbox.actions.resolve")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("inbox.actions.resolveHelp")}</span>
        </div>
      </Field>
      {msg && (
        <Alert variant={msg.ok ? "success" : "warning"} aria-live="polite">
          {msg.ok ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
          <AlertTitle>{msg.text}</AlertTitle>
          {!msg.ok && <AlertDescription>{t("inbox.actions.resolveHelp")}</AlertDescription>}
        </Alert>
      )}
    </div>
  )
}
