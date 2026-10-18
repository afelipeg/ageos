import type { Messages } from "@/lib/i18n/messages"

/**
 * Localized label for a stable domain/blocked code. Prefers the shared
 * `errors.*` copy, then the screens' own `records.codes.*`, and finally shows
 * the code itself (never an empty or misleading message).
 */
export function codeLabel(messages: Messages, t: (k: string) => string, code: string): string {
  const errors = (messages as unknown as { errors: Record<string, string> }).errors
  if (errors && typeof errors[code] === "string") return t(`errors.${code}`)
  const own = (messages as unknown as { records: { codes?: Record<string, string> } }).records.codes
  if (own && typeof own[code] === "string") return t(`records.codes.${code}`)
  return code
}

/** Localized label of a business event type; falls back to the stable type itself. */
export function eventLabel(messages: Messages, t: (k: string) => string, eventType: string): string {
  const key = eventType.replace(/\./g, "_")
  const events = (messages as unknown as { records: { events: Record<string, string> } }).records.events
  return typeof events[key] === "string" ? t(`records.events.${key}`) : eventType
}
