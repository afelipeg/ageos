"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CalendarClockIcon, CheckIcon, FlaskConicalIcon, RotateCcwIcon, TriangleAlertIcon, UserRoundIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { codeLabel } from "@/components/records/code-label"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from "@/components/reui/number-field"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { advanceBusinessClockAction, loadCheckpointAction, resetDemoTenantAction, switchPersonaAction } from "@/server/actions/session"
import { queueSimulationOutcomeAction } from "@/server/actions/ui/presenter"

type Msg = { ok: boolean; title: string; body?: string } | null

function Result({ msg }: { msg: Msg }) {
  if (!msg) return null
  return (
    <Alert variant={msg.ok ? "success" : "warning"} aria-live="polite">
      {msg.ok ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
      <AlertTitle>{msg.title}</AlertTitle>
      {msg.body && <AlertDescription>{msg.body}</AlertDescription>}
    </Alert>
  )
}

/** Opens a new audited session as one synthetic persona (never an arbitrary user). */
export function PersonaSwitcher({ personas }: { personas: { key: string; name: string; role: string; kind: string; tenantSlug: string | null; current: boolean }[] }) {
  const { t, messages } = useI18n()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<Msg>(null)
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border">
        {personas.map((p) => (
          <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-2 text-sm font-medium">
                <UserRoundIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                {p.name}
                {p.current && <Badge variant="success-light">{t("presenter.personas.current")}</Badge>}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(`header.roles.${p.role}`)} · {p.tenantSlug ?? t("presenter.personas.platform")}
              </span>
            </span>
            <Button
              size="sm"
              variant={p.current ? "secondary" : "outline"}
              disabled={pending || p.current}
              onClick={() =>
                start(async () => {
                  const res = await switchPersonaAction(p.key)
                  if (res && !res.ok) setMsg({ ok: false, title: codeLabel(messages, t, res.error.code), body: res.error.message })
                })
              }
            >
              {t("presenter.personas.actAs")}
            </Button>
          </li>
        ))}
      </ul>
      <Result msg={msg} />
    </div>
  )
}

/** Reset the demo run of a demo tenant or load a checkpoint, each behind a typed confirmation. */
export function ResetPanel({ tenants, checkpoints }: { tenants: string[]; checkpoints: string[] }) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<Msg>(null)
  const [target, setTarget] = useState<{ kind: "reset" | "checkpoint"; value: string } | null>(null)
  const [confirm, setConfirm] = useState("")
  const [tenant, setTenant] = useState(tenants[0] ?? "rayo-de-sol")
  const [checkpoint, setCheckpoint] = useState(checkpoints[0] ?? "ready_for_scope_review")
  const run = () =>
    start(async () => {
      if (!target) return
      const res = target.kind === "reset" ? await resetDemoTenantAction(target.value, confirm) : await loadCheckpointAction(target.value as "ready_for_scope_review" | "from_intake", confirm)
      setTarget(null)
      setConfirm("")
      if (!res.ok) return setMsg({ ok: false, title: codeLabel(messages, t, res.error.code), body: res.error.message })
      setMsg({ ok: true, title: t("presenter.reset.done", { checkpoint: res.result.checkpoint, n: res.result.tenantsReset }), body: t("presenter.reset.run", { id: res.result.demoRunId.slice(0, 8) }) })
      router.refresh()
    })
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="reset-tenant">{t("presenter.reset.tenant")}</FieldLabel>
          <div className="flex gap-2">
            <Select items={tenants.map((x) => ({ value: x, label: x }))} value={tenant} onValueChange={(v) => setTenant(String(v ?? tenant))}>
              <SelectTrigger id="reset-tenant" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((x) => (
                  <SelectItem key={x} value={x}>
                    {x}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="destructive" disabled={pending} onClick={() => setTarget({ kind: "reset", value: tenant })}>
              <RotateCcwIcon aria-hidden="true" />
              {t("presenter.reset.reset")}
            </Button>
          </div>
          <FieldDescription>{t("presenter.reset.resetHelp")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="reset-checkpoint">{t("presenter.reset.checkpoint")}</FieldLabel>
          <div className="flex gap-2">
            <Select items={checkpoints.map((x) => ({ value: x, label: t(`presenter.checkpoints.${x}`) }))} value={checkpoint} onValueChange={(v) => setCheckpoint(String(v ?? checkpoint))}>
              <SelectTrigger id="reset-checkpoint" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {checkpoints.map((x) => (
                  <SelectItem key={x} value={x}>
                    {t(`presenter.checkpoints.${x}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setTarget({ kind: "checkpoint", value: checkpoint })}>
              {t("presenter.reset.load")}
            </Button>
          </div>
          <FieldDescription>{t("presenter.reset.checkpointHelp")}</FieldDescription>
        </Field>
      </div>
      <Result msg={msg} />
      <AlertDialog open={target !== null} onOpenChange={(o) => !o && !pending && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{target?.kind === "reset" ? t("presenter.reset.confirmResetTitle", { slug: target.value }) : t("presenter.reset.confirmCheckpointTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("presenter.reset.confirmBody", { value: target?.value ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="reset-confirm">{t("presenter.reset.typeToConfirm", { value: target?.value ?? "" })}</FieldLabel>
            <Input id="reset-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending || confirm !== target?.value} onClick={run}>
              {pending ? t("common.loading") : t("presenter.reset.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Advance the fixed demo business clock (audited; never ages real timestamps). */
export function ClockPanel({ businessDate, baseDate, advancedDays, max }: { businessDate: string; baseDate: string; advancedDays: number; max: number }) {
  const { t, date, messages } = useI18n()
  const router = useRouter()
  const [days, setDays] = useState<number | null>(1)
  const [reason, setReason] = useState("")
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<Msg>(null)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        {t("presenter.clock.current", { date: date(businessDate) })} · <span className="text-muted-foreground">{t("presenter.clock.base", { date: date(baseDate), n: advancedDays })}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <Field>
          <FieldLabel htmlFor="clock-days">{t("presenter.clock.days")}</FieldLabel>
          <NumberField value={days} onValueChange={setDays} min={1} max={31}>
            <NumberFieldGroup>
              <NumberFieldDecrement />
              <NumberFieldInput id="clock-days" />
              <NumberFieldIncrement />
            </NumberFieldGroup>
          </NumberField>
        </Field>
        <Field>
          <FieldLabel htmlFor="clock-reason">{t("presenter.clock.reason")}</FieldLabel>
          <Input id="clock-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !days || reason.trim().length < 3 || advancedDays + (days ?? 0) > max}
          onClick={() =>
            start(async () => {
              const res = await advanceBusinessClockAction({ days: days ?? 1, reason, expectedBusinessDate: businessDate })
              if (!res.ok) return setMsg({ ok: false, title: codeLabel(messages, t, res.error.code), body: res.error.message })
              setMsg({ ok: true, title: t("presenter.clock.advanced", { date: date(res.clock.businessDate) }) })
              setReason("")
              router.refresh()
            })
          }
        >
          <CalendarClockIcon aria-hidden="true" />
          {t("presenter.clock.advance")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("presenter.clock.help", { max })}</p>
      <Result msg={msg} />
    </div>
  )
}

const FAILURES = ["success", "validation_error", "permission_revoked", "rate_limited", "timeout_before_effect", "timeout_after_effect", "permanent_failure"]

/** Queue the outcome of the next simulated ads operation (consumed by that operation). */
export function FailureModes({ agencySlug }: { agencySlug: string }) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [provider, setProvider] = useState("meta_ads")
  const [operation, setOperation] = useState("campaign.activate")
  const [mode, setMode] = useState("timeout_after_effect")
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<Msg>(null)
  const key = useRef(crypto.randomUUID())
  const sel = (id: string, label: string, value: string, items: { value: string; label: string }[], on: (v: string) => void) => (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={(v) => on(String(v ?? value))}>
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue />
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
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {sel("fm-provider", t("presenter.failures.provider"), provider, ["meta_ads", "google_ads", "tiktok_ads", "dv360_demo", "demo_bank"].map((p) => ({ value: p, label: t(`connections.providers.${p}`) })), (v) => {
          setProvider(v)
          setOperation(v === "demo_bank" ? "payment.execute" : "campaign.activate")
        })}
        {sel("fm-operation", t("presenter.failures.operation"), operation, (provider === "demo_bank" ? ["payment.execute"] : ["campaign.activate", "media_order.submit"]).map((o) => ({ value: o, label: t(`presenter.failures.operations.${o.replace(".", "_")}`) })), setOperation)}
        {sel("fm-mode", t("presenter.failures.mode"), mode, FAILURES.map((f) => ({ value: f, label: t(`presenter.failures.modes.${f}`) })), setMode)}
      </div>
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await queueSimulationOutcomeAction({ agencySlug, provider: provider as "meta_ads", operationType: operation as "campaign.activate", failureMode: mode as "success", idempotencyKey: `presenter:fm:${key.current}` })
              key.current = crypto.randomUUID()
              if (!res.ok) return setMsg({ ok: false, title: codeLabel(messages, t, res.error.code), body: res.error.message })
              setMsg({ ok: true, title: t("presenter.failures.queued"), body: t("presenter.failures.queuedBody") })
              router.refresh()
            })
          }
        >
          <FlaskConicalIcon aria-hidden="true" />
          {t("presenter.failures.queue")}
        </Button>
      </div>
      <Result msg={msg} />
    </div>
  )
}
