"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"

import { fmtBusinessDate, fmtMoney, fmtPct, fmtTimestamp, resolveTimeZone } from "@/lib/format"
import { MESSAGES, type Messages } from "@/lib/i18n/messages"
import { pick, translate, type Locale, type Params } from "@/lib/i18n/translate"

type I18nValue = {
  locale: Locale
  /** IANA zone for real timestamps: the agency's inside /a/:slug, else UTC. */
  timeZone: string
  messages: Messages
  t: (key: string, params?: Params) => string
  pick: (value: { en: string; es: string } | null | undefined) => string
  money: (amountMinor: string | bigint | null | undefined, currency: string) => string
  pct: (bps: number | null | undefined) => string
  date: (isoDate: string) => string
  timestamp: (iso: string | Date) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ locale, timeZone, children }: { locale: Locale; timeZone?: string; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    const messages = MESSAGES[locale]
    const zone = resolveTimeZone(timeZone)
    return {
      locale,
      timeZone: zone,
      messages,
      t: (key, params) => translate(messages as never, key, params),
      pick: (v) => pick(v, locale),
      money: (a, c) => fmtMoney(a, c, locale),
      pct: (b) => fmtPct(b, locale),
      date: (d) => fmtBusinessDate(d, locale),
      timestamp: (iso) => fmtTimestamp(iso, locale, zone),
    }
  }, [locale, timeZone])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used within I18nProvider")
  return ctx
}
