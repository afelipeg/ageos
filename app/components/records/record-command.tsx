"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { runRecordCommandAction, type RecordCommand } from "@/server/actions/ui/record-commands"

import { codeLabel } from "./code-label"

export type CommandField = {
  key: string
  type: "text" | "textarea" | "decimal" | "date" | "select"
  /** i18n key */
  label: string
  help?: string
  required?: boolean
  options?: { value: string; label: string }[]
  currency?: string
  defaultValue?: string
}

export type CommandButton = { label: string; patch?: Record<string, unknown>; variant?: "default" | "outline" | "destructive"; requires?: string[] }

/**
 * One allowlisted record command as a small form. Fixed payload keys (the
 * record id and its revision) come from the server; the user fills only the
 * declared fields. The server validates, authorizes and audits.
 */
export function RecordCommandForm({
  agencySlug,
  command,
  fixed,
  fields,
  buttons,
  disabledReason,
}: {
  agencySlug: string
  command: RecordCommand
  fixed: Record<string, unknown>
  fields: CommandField[]
  buttons: CommandButton[]
  disabledReason?: string | null
}) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.defaultValue ?? ""])))
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; title: string; body?: string; runHref?: string } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const key = useRef(crypto.randomUUID())
  const disabled = Boolean(disabledReason) || pending

  const submit = (b: CommandButton) =>
    start(async () => {
      setMsg(null)
      const payload: Record<string, unknown> = { ...fixed }
      for (const f of fields) if (values[f.key] !== "") payload[f.key] = values[f.key]
      Object.assign(payload, b.patch ?? {})
      const res = await runRecordCommandAction({ agencySlug, command, payload, idempotencyKey: `ui:${command}:${key.current}` })
      key.current = crypto.randomUUID()
      if (!res.ok) {
        const d = res.error.details as { issues?: { path: string; message: string }[]; rule?: string; field?: string }
        const errs: Record<string, string> = {}
        for (const i of d.issues ?? []) errs[i.path.split(".")[0] ?? ""] = i.message
        if (d.field) errs[d.field] = res.error.message
        setErrors(errs)
        return setMsg({ ok: false, title: codeLabel(messages, t, res.error.code), body: d.rule ? codeLabel(messages, t, d.rule) : res.error.message })
      }
      setErrors({})
      const r = (res.data.result ?? {}) as Record<string, unknown>
      setMsg({ ok: true, title: res.data.replayed ? t("workbench.replayed") : t("records.commands.done"), body: typeof r.state === "string" ? t("records.commands.state", { state: t(`records.state.${r.state}`) }) : undefined })
      router.refresh()
    })

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
      {fields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => {
            const id = `rc-${command}-${f.key}`
            const err = errors[f.key]
            const set = (v: string) => setValues((s) => ({ ...s, [f.key]: v }))
            return (
              <Field key={f.key} data-invalid={err ? true : undefined} className={f.type === "textarea" ? "sm:col-span-2" : undefined}>
                <FieldLabel htmlFor={id}>{t(f.label)}</FieldLabel>
                {f.type === "textarea" ? (
                  <Textarea id={id} value={values[f.key]} onChange={(e) => set(e.target.value)} disabled={disabled} maxLength={500} className="min-h-16 resize-none" aria-invalid={err ? true : undefined} />
                ) : f.type === "select" ? (
                  <Select items={f.options ?? []} value={values[f.key]} onValueChange={(v) => set(String(v ?? ""))} disabled={disabled}>
                    <SelectTrigger id={id} className="w-full" aria-invalid={err ? true : undefined}>
                      <SelectValue placeholder={t("workbench.selectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(f.options ?? []).map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : f.type === "decimal" ? (
                  <InputGroup>
                    <InputGroupInput id={id} inputMode="decimal" value={values[f.key]} onChange={(e) => set(e.target.value)} disabled={disabled} aria-invalid={err ? true : undefined} />
                    {f.currency && (
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>{f.currency}</InputGroupText>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                ) : (
                  <Input id={id} type={f.type === "date" ? "date" : "text"} min={f.type === "date" ? "2026-01-01" : undefined} max={f.type === "date" ? "2028-12-31" : undefined} value={values[f.key]} onChange={(e) => set(e.target.value)} disabled={disabled} aria-invalid={err ? true : undefined} />
                )}
                {f.help && <FieldDescription>{t(f.help)}</FieldDescription>}
                {err && <FieldError>{err}</FieldError>}
              </Field>
            )
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <Button key={b.label} size="sm" variant={b.variant ?? "default"} disabled={disabled || (b.requires ?? fields.filter((f) => f.required).map((f) => f.key)).some((k) => !values[k] || values[k]!.trim().length === 0)} onClick={() => submit(b)}>
            {t(b.label)}
          </Button>
        ))}
      </div>
      {msg && (
        <Alert variant={msg.ok ? "success" : "warning"}>
          {msg.ok ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
          <AlertTitle>{msg.title}</AlertTitle>
          {msg.body && <AlertDescription>{msg.body}</AlertDescription>}
          {msg.runHref && <Link href={msg.runHref}>{t("workbench.openRun")}</Link>}
        </Alert>
      )}
    </div>
  )
}
