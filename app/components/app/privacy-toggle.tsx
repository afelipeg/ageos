"use client"

import { useEffect, useState } from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"

const KEY = "ageos:privacy"

function readStored() {
  try {
    return window.localStorage.getItem(KEY) === "on"
  } catch {
    return false /* storage unavailable */
  }
}

/** Hides figures marked `.ageos-figure` during a presentation (local UI pref). */
export function PrivacyToggle() {
  const { t } = useI18n()
  // Server and hydration render "off"; afterwards the stored preference
  // applies until the user toggles in this session.
  const hydrated = useHydrated()
  const [choice, setChoice] = useState<boolean | null>(null)
  const on = choice ?? (hydrated && readStored())
  useEffect(() => {
    document.documentElement.dataset.privacy = on ? "on" : "off"
    if (choice === null) return
    try {
      window.localStorage.setItem(KEY, choice ? "on" : "off")
    } catch {
      /* ignore */
    }
  }, [on, choice])
  return (
    <Button variant="outline" size="sm" aria-pressed={on} onClick={() => setChoice(!on)}>
      {on ? <EyeIcon aria-hidden="true" /> : <EyeOffIcon aria-hidden="true" />}
      {on ? t("common.privacyOff") : t("common.privacyOn")}
    </Button>
  )
}
