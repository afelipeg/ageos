"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, EyeIcon, SendIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { codeLabel } from "@/components/records/code-label"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { ColorPicker } from "@/components/reui/color-picker"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { previewBrandAction, proposeBrandChangeAction } from "@/server/actions/ui/settings"

import { SettingsChangeDecision, type PendingSettingsChange } from "./settings-change-decision"

const SWATCHES = ["#1d4ed8", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#334155"]

/**
 * Brand accent and logo text. "Preview" is validated on the server with the
 * contrast rule (≥ 4.5:1 on white) used by the configuration service; the
 * preview shows only the allowed accent — status colors never change.
 * Publish proposes a configuration revision (server re-checks contrast) that
 * an owner other than the proposer approves; pending changes are listed.
 */
export function BrandForm({
  agencySlug,
  appName,
  accent,
  logoText,
  publishAvailable,
  publishedNumber,
  pending: pendingChanges,
}: {
  agencySlug: string
  appName: string
  accent: string | null
  logoText: string | null
  publishAvailable: boolean
  publishedNumber: number | null
  pending: PendingSettingsChange[]
}) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [sent, setSent] = useState<{ ok: boolean; text: string } | null>(null)
  const key = useRef(crypto.randomUUID())
  const [color, setColor] = useState<string | null>(accent)
  const [logo, setLogo] = useState(logoText ?? "")
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ passes: boolean; contrast: number; issues: string[]; accent: string; logoText: string } | null>(null)
  const labels = {
    placeholder: t("settings.brand.picker.placeholder"),
    panelLabel: t("settings.brand.picker.panel"),
    openPicker: t("settings.brand.picker.open"),
    area: t("settings.brand.picker.area"),
    hue: t("settings.brand.picker.hue"),
    saturation: t("settings.brand.picker.saturation"),
    brightness: t("settings.brand.picker.brightness"),
    hex: "HEX",
    format: t("settings.brand.picker.format"),
    copy: t("common.copy"),
    copied: t("common.copied"),
    clear: t("settings.brand.picker.clear"),
    swatches: t("settings.brand.picker.swatches"),
  }
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            const res = await previewBrandAction({ agencySlug, accent: color ?? "", logoText: logo })
            if (res.ok) setResult(res.data)
            else setResult({ passes: false, contrast: 0, issues: [res.error.code], accent: color ?? "", logoText: logo })
          })
        }}
      >
        <Field>
          <FieldLabel htmlFor="brand-accent">{t("settings.brand.accent")}</FieldLabel>
          <ColorPicker id="brand-accent" value={color} onValueChange={(v) => { setColor(v); setResult(null) }} format="hex" swatches={SWATCHES} i18n={{ labels }} aria-label={t("settings.brand.accent")} />
          <FieldDescription>{t("settings.brand.accentHelp")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="brand-logo">{t("settings.brand.logoText")}</FieldLabel>
          <Input id="brand-logo" value={logo} maxLength={3} onChange={(e) => { setLogo(e.target.value.toUpperCase()); setResult(null) }} />
          <FieldDescription>{t("settings.brand.logoHelp")}</FieldDescription>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" size="sm" disabled={pending || !color}>
            <EyeIcon aria-hidden="true" />
            {t("settings.brand.preview")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!publishAvailable || !result?.passes || reason.trim().length < 3 || publishedNumber === null}
            onClick={() =>
              start(async () => {
                if (!result?.passes || publishedNumber === null) return
                const res = await proposeBrandChangeAction({ agencySlug, accent: result.accent, logoText: result.logoText, reason, expectedRevision: publishedNumber, idempotencyKey: `ui:brand:${key.current}` })
                if (!res.ok) return setSent({ ok: false, text: codeLabel(messages, t, res.error.code) })
                key.current = crypto.randomUUID()
                setSent({ ok: true, text: t("settings.brand.publishSent", { n: res.data.number }) })
                setReason("")
                router.refresh()
              })
            }
          >
            <SendIcon aria-hidden="true" />
            {t("settings.brand.publish")}
          </Button>
        </div>
        {publishAvailable ? (
          <Field>
            <FieldLabel htmlFor="brand-reason">{t("catalog.change.reason")}</FieldLabel>
            <Textarea id="brand-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-12 resize-none" />
            <FieldDescription>{t("settings.brand.publishHelp")}</FieldDescription>
          </Field>
        ) : (
          <p className="text-xs text-muted-foreground">{t("settings.brand.proposerOnly")}</p>
        )}
        {sent && (
          <Alert variant={sent.ok ? "success" : "warning"} aria-live="polite">
            {sent.ok ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
            <AlertTitle>{sent.text}</AlertTitle>
          </Alert>
        )}
        {pendingChanges.map((c) => (
          <SettingsChangeDecision key={c.id} agencySlug={agencySlug} change={c} />
        ))}
      </form>
      <div className="flex flex-col gap-3" aria-live="polite">
        <span className="text-xs font-medium text-muted-foreground">{t("settings.brand.previewTitle")}</span>
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-md text-sm font-semibold text-white"
            style={{ backgroundColor: result?.passes ? result.accent : (accent ?? "#334155") }}
          >
            {(result?.passes ? result.logoText : logoText) || "—"}
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-semibold">{appName}</span>
            <span className="text-xs text-muted-foreground">{result?.passes ? t("settings.brand.previewing") : t("settings.brand.current")}</span>
          </span>
        </div>
        {result &&
          (result.passes ? (
            <Alert variant="success">
              <CheckIcon aria-hidden="true" />
              <AlertTitle>{t("settings.brand.contrastOk", { ratio: result.contrast })}</AlertTitle>
              <AlertDescription>{t("settings.brand.previewOnly")}</AlertDescription>
            </Alert>
          ) : (
            <Alert variant="warning">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>{t("settings.brand.invalid")}</AlertTitle>
              <AlertDescription>{result.issues.map((i) => t(`settings.brand.issues.${i}`, { ratio: result.contrast })).join(" · ")}</AlertDescription>
            </Alert>
          ))}
      </div>
    </div>
  )
}
