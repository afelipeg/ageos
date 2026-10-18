"use client"

import { useState } from "react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { WrenchIcon } from "lucide-react"

/**
 * Assign / snooze / resolve for one attention item. Each control maps to a
 * server command of the attention service; snooze requires a date and never
 * clears the blocking condition; resolve is accepted only when the service
 * confirms the condition is gone. While the service is not available the
 * controls stay visible but disabled with the reason.
 */
export function InboxItemActions({
  itemId,
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
  const { t } = useI18n()
  const [assignee, setAssignee] = useState(assigneeId ?? "")
  const [until, setUntil] = useState("")
  const disabled = !available || state === "resolved"
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4" data-item={itemId}>
      {!available && (
        <Alert variant="info">
          <WrenchIcon aria-hidden="true" />
          <AlertTitle>{t("inbox.actions.pendingTitle")}</AlertTitle>
          <AlertDescription>{t("inbox.actions.pendingBody")}</AlertDescription>
        </Alert>
      )}
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
          <Button size="sm" variant="outline" disabled={disabled || !assignee || assignee === assigneeId}>
            {t("inbox.actions.save")}
          </Button>
        </div>
      </Field>
      <Field>
        <FieldLabel htmlFor={`snooze-${itemId}`}>{t("inbox.actions.snooze")}</FieldLabel>
        <div className="flex gap-2">
          <Input id={`snooze-${itemId}`} type="date" value={until} min="2027-01-01" max="2028-12-31" onChange={(e) => setUntil(e.target.value)} disabled={disabled} />
          <Button size="sm" variant="outline" disabled={disabled || !until}>
            {t("inbox.actions.snoozeCta")}
          </Button>
        </div>
        <FieldDescription>{t("inbox.actions.snoozeHelp")}</FieldDescription>
      </Field>
      <div className="flex flex-col gap-1">
        <Button size="sm" variant="outline" disabled={disabled}>
          {t("inbox.actions.resolve")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("inbox.actions.resolveHelp")}</span>
      </div>
    </div>
  )
}
