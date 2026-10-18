// Dictionary-based i18n. Keys are dot paths into the message tree; params
// interpolate {name} placeholders. Business record names, IDs and file
// contents are never translated.

export type Locale = "en" | "es"
export const LOCALES: readonly Locale[] = ["en", "es"]
export const LOCALE_COOKIE = "ageos_locale"

export type MessageTree = { [key: string]: string | MessageTree }

export type Params = Record<string, string | number | null | undefined>

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "es"
}

export function lookup(tree: MessageTree, key: string): string | undefined {
  let node: string | MessageTree | undefined = tree
  for (const part of key.split(".")) {
    if (!node || typeof node === "string") return undefined
    node = node[part]
  }
  return typeof node === "string" ? node : undefined
}

export function translate(tree: MessageTree, key: string, params?: Params): string {
  const template = lookup(tree, key)
  if (template === undefined) {
    if (process.env.NODE_ENV !== "production") console.warn(`[i18n] missing key ${key}`)
    return key
  }
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name]
    return v === undefined || v === null ? "" : String(v)
  })
}

/** Picks a localized pair stored in data ({ en, es }). */
export function pick(value: { en: string; es: string } | null | undefined, locale: Locale): string {
  if (!value) return ""
  return value[locale] ?? value.en
}

export function intlLocale(locale: Locale): string {
  return locale === "es" ? "es-MX" : "en-US"
}
