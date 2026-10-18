// Exact money: integer minor units (bigint) + explicit ISO currency.
// Never floats. Mixed currencies are never added implicitly.

export const CURRENCY_EXPONENT: Record<string, number> = {
  USD: 2,
  CAD: 2,
  MXN: 2,
  EUR: 2,
  COP: 2,
  CLP: 0,
}

export type Money = { readonly amountMinor: bigint; readonly currency: string }

/** Wire form: bigint serialized as a decimal string. */
export type MoneyWire = { amountMinor: string; currency: string }

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Currency mismatch: ${a} vs ${b}`)
    this.name = "CurrencyMismatchError"
  }
}

export function exponentOf(currency: string): number {
  const e = CURRENCY_EXPONENT[currency]
  if (e === undefined) throw new Error(`Unsupported currency ${currency}`)
  return e
}

export function money(amountMinor: bigint | number | string, currency: string): Money {
  exponentOf(currency)
  const value =
    typeof amountMinor === "bigint"
      ? amountMinor
      : typeof amountMinor === "number"
        ? toBigIntStrict(amountMinor)
        : BigInt(amountMinor)
  return { amountMinor: value, currency }
}

function toBigIntStrict(n: number): bigint {
  if (!Number.isSafeInteger(n)) throw new Error("Money amounts must be safe integers of minor units")
  return BigInt(n)
}

function same(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency)
}

export function add(a: Money, b: Money): Money {
  same(a, b)
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency }
}

export function sub(a: Money, b: Money): Money {
  same(a, b)
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency }
}

export function sum(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => add(acc, m), money(0n, currency))
}

/** HALF_UP integer division for non-negative or negative numerators. */
export function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("Division by zero")
  const negative = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const q = (n + d / 2n) / d
  return negative ? -q : q
}

/** Ratio in basis points (1 bp = 0.01%), HALF_UP. Null when denominator is 0. */
export function ratioBps(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null
  return Number(divHalfUp(numerator * 10000n, denominator))
}

export function toWire(m: Money): MoneyWire {
  return { amountMinor: m.amountMinor.toString(), currency: m.currency }
}

export function fromWire(w: MoneyWire): Money {
  return money(BigInt(w.amountMinor), w.currency)
}

/**
 * Formats minor units without converting through a float, so large amounts
 * stay exact. Locale controls separators; currency is always shown.
 */
export function formatMoney(
  amountMinor: bigint | string,
  currency: string,
  locale: string,
  options?: { compact?: boolean; hideCents?: boolean }
): string {
  const value = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor)
  const exp = exponentOf(currency)
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(exp)
  const whole = abs / base
  const fraction = abs % base
  const digits = options?.hideCents ? 0 : exp
  const fractionStr = exp > 0 ? fraction.toString().padStart(exp, "0").slice(0, digits) : ""
  const intl = locale.startsWith("es") ? "es-MX" : "en-US"
  // Format the integer part via BigInt.toLocaleString (exact for any size).
  const wholeStr = whole.toLocaleString(intl)
  const sep = new Intl.NumberFormat(intl).format(1.1).charAt(1)
  const number = digits > 0 ? `${wholeStr}${sep}${fractionStr}` : wholeStr
  return `${negative ? "−" : ""}${currency} ${number}`
}

/** Formats basis points as a percentage with one decimal (43.5%). */
export function formatBps(bps: number | null, locale: string): string {
  if (bps === null) return "—"
  const intl = locale.startsWith("es") ? "es-MX" : "en-US"
  // bps/10 is an exact integer of tenths after HALF_UP rounding to 1 decimal.
  const tenths = Number(divHalfUp(BigInt(bps), 10n))
  const value = tenths / 10
  return `${new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}%`
}

/**
 * Parses a user-entered decimal string ("23000", "23000.5", "23,000.50") into
 * exact minor units for the currency. Rejects more fraction digits than the
 * currency exponent instead of rounding silently.
 */
export function parseDecimalToMinor(input: string, currency: string): bigint {
  const exp = exponentOf(currency)
  const cleaned = input.trim().replace(/,/g, "")
  const match = /^(-)?(\d{1,15})(?:\.(\d+))?$/.exec(cleaned)
  if (!match) throw new Error("Invalid amount")
  const [, sign, whole, fraction = ""] = match
  if (fraction.length > exp) throw new Error(`At most ${exp} decimal places for ${currency}`)
  const minor = BigInt(whole!) * 10n ** BigInt(exp) + BigInt(fraction.padEnd(exp, "0") || "0")
  return sign ? -minor : minor
}

/** Inverse of parseDecimalToMinor for editable form values ("23000.00"). */
export function minorToDecimalString(amountMinor: bigint | string, currency: string): string {
  const value = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor)
  const exp = exponentOf(currency)
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(exp)
  const whole = (abs / base).toString()
  const frac = exp > 0 ? "." + (abs % base).toString().padStart(exp, "0") : ""
  return `${negative ? "-" : ""}${whole}${frac}`
}
