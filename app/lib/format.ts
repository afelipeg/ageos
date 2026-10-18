import { formatBps, formatMoney } from "./money"
import { intlLocale, type Locale } from "./i18n/translate"

// Locale-aware display helpers. Display only: amounts arrive as exact minor
// units (string/bigint) from the server and are never recomputed here.

export function fmtMoney(amountMinor: string | bigint | null | undefined, currency: string, locale: Locale) {
  // Wire values are integer minor units; anything else (empty, decimals, junk)
  // renders as "—", never a fabricated amount or a crash.
  const minor = parseMinorUnits(amountMinor)
  if (minor === null) return "—"
  return formatMoney(minor, currency, locale)
}

export function fmtPct(bps: number | null | undefined, locale: Locale) {
  return formatBps(bps ?? null, locale)
}

/**
 * Business dates (YYYY-MM-DD) are calendar dates: formatted in UTC from their
 * own Y/M/D parts, so no agency or browser time zone can shift the day. A
 * value carrying a time part keeps only its calendar prefix.
 */
export function fmtBusinessDate(isoDate: string, locale: Locale) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate)
  if (!m) return isoDate
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  )
}

/** A valid IANA zone, or UTC when the value is missing or unknown to Intl. */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return timeZone
  } catch {
    return "UTC"
  }
}

/**
 * Real audit timestamps, shown in the agency time zone with its short name so
 * the reference zone is always visible. Without an agency context (public or
 * platform pages) the zone is UTC and labelled as such — never a guessed one.
 */
export function fmtTimestamp(iso: string | Date, locale: Locale, timeZone?: string | null) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: resolveTimeZone(timeZone),
  }).format(typeof iso === "string" ? new Date(iso) : iso)
}

export function fmtMinutesAsHours(minutes: number, locale: Locale) {
  return `${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(minutes / 60)} h`
}

/** Exact minor units from a wire value (integer string or bigint); null otherwise. */
export function parseMinorUnits(value: unknown): bigint | null {
  if (typeof value === "bigint") return value
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim())
  return null
}

export type MoneySortKey = { amountMinor: bigint; currency: string }

/**
 * Exact ordering for money cells (UI sort only). Currencies are never compared
 * or summed across: rows group by ISO code first, then order by minor units as
 * bigint, so cents, negatives and values beyond 2^53 keep full precision.
 * Within one currency the exponent is shared, so minor units compare exactly.
 */
export function compareMoneyMinor(a: MoneySortKey, b: MoneySortKey): number {
  if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1
  if (a.amountMinor === b.amountMinor) return 0
  return a.amountMinor < b.amountMinor ? -1 : 1
}
