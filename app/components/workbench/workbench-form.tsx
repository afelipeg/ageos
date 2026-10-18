"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { CheckIcon, LinkIcon, PlayIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame"
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from "@/components/reui/number-field"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { FieldSpec } from "@/lib/capabilities/types"
import { codeLabel } from "@/components/records/code-label"
import { buildPayload, initialValues, missingRequired, REF_TYPES, type RefOption } from "@/components/workbench/form-values"
import { runCapabilityAction } from "@/server/actions/capabilities"

type Outcome =
  | { kind: "ok"; runId: string; state: string; output: unknown; error: { code: string; message: string; details: Record<string, unknown> } | null; replayed: boolean }
  | { kind: "failure"; code: string; message: string; details: Record<string, unknown> }

/**
 * Typed form generated from the capability's FieldSpec contract. The same keys
 * reach the server command, which validates again (strict Zod schema).
 */
export function WorkbenchForm({
  agencySlug,
  skillId,
  fields,
  refs,
  preset,
  prefilled = false,
  currency,
  implemented,
  revisionOf,
  blockedReason,
}: {
  agencySlug: string
  skillId: string
  fields: readonly FieldSpec[]
  refs: Partial<Record<string, RefOption[]>>
  preset: Record<string, string>
  /** Some values came from a demo-journey link (`f.<field>` params). */
  prefilled?: boolean
  currency: string
  implemented: boolean
  revisionOf: "job" | null
  blockedReason: string | null
}) {
  const { t, pick, money, messages } = useI18n()
  const [values, setValues] = useState<Record<string, string | boolean>>(() => initialValues(fields, preset))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [pending, start] = useTransition()
  // Stable key per attempt: a retry or double click replays, never duplicates.
  const attemptKey = useRef<string>(crypto.randomUUID())
  const formRef = useRef<HTMLFormElement>(null)

  const expectedRevision = useMemo(() => {
    if (revisionOf !== "job") return undefined
    const jobId = values.job
    return refs.job?.find((o) => o.value === jobId)?.revision
  }, [refs.job, revisionOf, values.job])

  const set = (key: string, v: string | boolean) => {
    setValues((prev) => ({ ...prev, [key]: v }))
    attemptKey.current = crypto.randomUUID()
  }

  const submit = () => {
    const local: Record<string, string> = Object.fromEntries(missingRequired(fields, values).map((k) => [k, t("common.required")]))
    setErrors(local)
    if (Object.keys(local).length) {
      setOutcome(null)
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus())
      return
    }
    start(async () => {
      const res = await runCapabilityAction({ agencySlug, skillId, payload: buildPayload(fields, values), idempotencyKey: attemptKey.current, expectedRevision })
      if (!res.ok) {
        setOutcome({ kind: "failure", ...res.error })
        return
      }
      const issues = (res.data.error?.details?.issues as { path: string; message: string }[] | undefined) ?? []
      if (issues.length) setErrors(Object.fromEntries(issues.map((i) => [i.path.split(".")[0] || "_", i.message])))
      else setErrors({})
      setOutcome({ kind: "ok", ...res.data })
      if (res.data.state === "succeeded") attemptKey.current = crypto.randomUUID()
    })
  }

  const renderField = (f: FieldSpec) => {
    const id = `wb-${f.key}`
    const err = errors[f.key]
    const label = pick(f.label)
    const disabled = !implemented || pending || Boolean(blockedReason)
    const common = { id, "aria-invalid": err ? true : undefined, disabled }
    let control: React.ReactNode
    if (f.type === "textarea") {
      control = <Textarea {...common} maxLength={f.maxLength} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} />
    } else if (f.type === "boolean") {
      control = <Switch id={id} checked={values[f.key] === true} onCheckedChange={(v) => set(f.key, v)} disabled={disabled} />
    } else if (f.type === "enum" || REF_TYPES.has(f.type)) {
      const items = f.type === "enum" ? (f.options ?? []).map((o) => ({ value: o.value, label: pick(o.label) })) : (refs[f.type] ?? []).map((o) => ({ value: o.value, label: o.detail ? `${o.label} (${o.detail})` : o.label }))
      control = (
        <Select items={items} value={String(values[f.key] ?? "")} onValueChange={(v) => set(f.key, String(v ?? ""))} disabled={disabled}>
          <SelectTrigger id={id} aria-invalid={err ? true : undefined} className="w-full">
            <SelectValue placeholder={items.length ? t("workbench.selectPlaceholder") : t("workbench.noOptions")} />
          </SelectTrigger>
          <SelectContent>
            {items.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    } else if (f.type === "money") {
      control = (
        <InputGroup>
          <InputGroupInput {...common} inputMode="decimal" value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{currency}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      )
    } else if (f.type === "integer" || f.type === "minutes" || f.type === "bps") {
      const n = values[f.key] === "" ? null : Number(values[f.key])
      control = (
        <NumberField value={n} onValueChange={(v) => set(f.key, v === null ? "" : String(v))} min={f.min} max={f.max} disabled={disabled}>
          <NumberFieldGroup>
            <NumberFieldDecrement />
            <NumberFieldInput id={id} aria-invalid={err ? true : undefined} />
            <NumberFieldIncrement />
          </NumberFieldGroup>
        </NumberField>
      )
    } else {
      const type = f.type === "date" ? "date" : f.type === "month" ? "month" : "text"
      control = <Input {...common} type={type} min={type === "date" ? "2026-01-01" : undefined} max={type === "date" ? "2028-12-31" : undefined} maxLength={f.maxLength} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} />
    }
    return (
      <Field key={f.key} data-invalid={err ? true : undefined}>
        <FieldLabel htmlFor={id}>
          {label}
          {!f.required && <span className="text-xs font-normal text-muted-foreground">({t("common.optional")})</span>}
        </FieldLabel>
        {control}
        {f.help && <FieldDescription>{pick(f.help)}</FieldDescription>}
        {f.type === "minutes" && values[f.key] !== "" && <FieldDescription>{(Number(values[f.key]) / 60).toLocaleString()} h</FieldDescription>}
        {err && <FieldError>{err}</FieldError>}
      </Field>
    )
  }

  const out = outcome?.kind === "ok" ? outcome : null
  const result = (out?.output ?? null) as Record<string, unknown> | null
  return (
    <div className="flex flex-col gap-6">
      <Frame spacing="default">
        <FrameHeader>
          <FrameTitle>{t("workbench.regions.inputs")}</FrameTitle>
          <FrameDescription>{t("workbench.examplesNote")}</FrameDescription>
          {prefilled && (
            <Badge variant="info-light" className="w-fit">
              <LinkIcon aria-hidden="true" />
              {t("workbench.prefilledNote")}
            </Badge>
          )}
        </FrameHeader>
        <FramePanel>
          <form
            className="grid gap-4 md:grid-cols-2"
            ref={formRef}
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            {fields.map(renderField)}
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              <Button type="submit" disabled={!implemented || pending || Boolean(blockedReason)}>
                <PlayIcon aria-hidden="true" />
                {pending ? t("workbench.running") : out ? t("workbench.runAgain") : t("workbench.run")}
              </Button>
              {expectedRevision !== undefined && <Badge variant="outline">{t("workbench.expectedRevision", { n: expectedRevision })}</Badge>}
            </div>
          </form>
        </FramePanel>
      </Frame>

      <Frame spacing="default">
        <FrameHeader>
          <FrameTitle>{t("workbench.regions.validate")} · {t("workbench.regions.output")}</FrameTitle>
        </FrameHeader>
        <FramePanel className="flex flex-col gap-3" aria-live="polite">
          {!outcome && <p className="text-sm text-muted-foreground">{t("workbench.outputEmpty")}</p>}
          {outcome?.kind === "failure" && (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>{codeLabel(messages, t, outcome.code)}</AlertTitle>
              <AlertDescription>{outcome.message}</AlertDescription>
            </Alert>
          )}
          {out && out.state !== "succeeded" && out.error && (
            <Alert variant="warning">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>{codeLabel(messages, t, out.error.code)}</AlertTitle>
              <AlertDescription className="flex flex-col gap-1">
                <span>{out.error.message}</span>
                {Object.keys(out.error.details ?? {}).length > 0 && (
                  <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">{JSON.stringify(out.error.details)}</code>
                )}
              </AlertDescription>
            </Alert>
          )}
          {out && out.state === "succeeded" && (
            <>
              <Alert variant="success">
                <CheckIcon aria-hidden="true" />
                <AlertTitle>{t("workbench.validationPassed")}</AlertTitle>
                <AlertDescription>{out.replayed ? t("workbench.replayed") : t("workbench.succeeded", { id: out.runId.slice(0, 8) })}</AlertDescription>
              </Alert>
              {result && (
                <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
                  {Object.entries(result).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                      <dd className="min-w-0 break-words tabular-nums">
                        {typeof v === "string" && /Minor$/.test(k) && /^-?\d+$/.test(v) ? money(v, String(result.currency ?? currency)) : typeof v === "object" ? <code className="font-mono text-xs break-all">{JSON.stringify(v)}</code> : String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </FramePanel>
      </Frame>

      {out && (
        <Frame spacing="default">
          <FrameHeader>
            <FrameTitle>{t("workbench.regions.next")}</FrameTitle>
          </FrameHeader>
          <FramePanel className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/a/${agencySlug}/runs/${out.runId}`} />}>
              {t("workbench.openRun")}
            </Button>
            {typeof result?.approvalId === "string" && (
              <Button size="sm" nativeButton={false} render={<Link href={`/a/${agencySlug}/approvals/${result.approvalId}`} />}>
                {t("workbench.openApproval")}
              </Button>
            )}
            {typeof result?.jobId === "string" && (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/a/${agencySlug}/jobs/${result.jobId}`} />}>
                {t("workbench.openJob")}
              </Button>
            )}
            {typeof result?.clientId === "string" && (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/a/${agencySlug}/clients/${result.clientId}`} />}>
                {t("workbench.openClient")}
              </Button>
            )}
          </FramePanel>
        </Frame>
      )}
    </div>
  )
}
