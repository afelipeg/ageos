"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"

import { useI18n } from "@/components/i18n/i18n-provider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { setLocale } from "@/server/actions/session"

/** EN/ES switch for public pages (cookie + saved preference when signed in). */
export function LocaleSwitch() {
  const { t, locale } = useI18n()
  const router = useRouter()
  const [, start] = useTransition()
  return (
    <ToggleGroup
      aria-label={t("common.language")}
      value={[locale]}
      onValueChange={(v) => {
        const next = (v as string[])[0]
        if (next === "en" || next === "es") start(async () => { await setLocale(next); router.refresh() })
      }}
      size="sm"
      variant="outline"
    >
      <ToggleGroupItem value="en" aria-label={t("common.english")}>EN</ToggleGroupItem>
      <ToggleGroupItem value="es" aria-label={t("common.spanish")}>ES</ToggleGroupItem>
    </ToggleGroup>
  )
}
