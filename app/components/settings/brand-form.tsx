"use client"

import { useState, useTransition } from "react"
import { CheckIcon, EyeIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { ColorPicker } from "@/components/reui/color-picker"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { previewBrandAction } from "@/server/actions/ui/settings"

const SWATCHES = ["#1d4ed8", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#334155"]

/**
 * Brand accent and logo text. "Preview" is validated on the server with the
 * contrast rule (≥ 4.5:1 on white) used by the configuration service; the
 * preview shows only the allowed accent — status colors never change.
 * Publishing an existing agency's brand needs the configuration revision
 * service, so Publish states that dependency instead of faking a save.
 */
export function BrandForm({ agencySlug, appName, accent, logoText, publishAvailable }: { agencySlug: string; appName: string; accent: string | null; logoText: string | null; publishAvailable: boolean }) {
  const { t } = useI18n()
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
          <Button type="button" size="sm" disabled={!publishAvailable || !result?.passes}>
            {t("settings.brand.publish")}
          </Button>
        </div>
        {!publishAvailable && (
          <Alert variant="info">
            <WrenchIcon aria-hidden="true" />
            <AlertTitle>{t("settings.brand.publishPendingTitle")}</AlertTitle>
            <AlertDescription>{t("settings.brand.publishPendingBody")}</AlertDescription>
          </Alert>
        )}
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
