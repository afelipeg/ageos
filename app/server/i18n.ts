import "server-only"

import { cookies } from "next/headers"

import { fmtBusinessDate, fmtMoney, fmtPct, fmtTimestamp } from "@/lib/format"
import { MESSAGES } from "@/lib/i18n/messages"
import { isLocale, LOCALE_COOKIE, pick, translate, type Locale, type Params } from "@/lib/i18n/translate"
import { getRequestSession } from "@/server/auth/request"

/** Signed-in users keep their saved preference; visitors use the cookie. */
export async function getLocale(): Promise<Locale> {
  const session = await getRequestSession()
  if (session) return session.user.locale
  const jar = await cookies()
  const c = jar.get(LOCALE_COOKIE)?.value
  return isLocale(c) ? c : "en"
}

export async function getI18n(timeZone?: string) {
  const locale = await getLocale()
  const messages = MESSAGES[locale]
  return {
    locale,
    t: (key: string, params?: Params) => translate(messages as never, key, params),
    pick: (v: { en: string; es: string } | null | undefined) => pick(v, locale),
    money: (a: string | bigint | null | undefined, c: string) => fmtMoney(a, c, locale),
    pct: (b: number | null | undefined) => fmtPct(b, locale),
    date: (d: string) => fmtBusinessDate(d, locale),
    timestamp: (iso: string | Date) => fmtTimestamp(iso, locale, timeZone),
  }
}
