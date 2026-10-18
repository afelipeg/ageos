import type { FieldSpec } from "@/lib/capabilities/types"

// Parameter clarification for scripted scenarios. A reply typed in the chat is
// parsed against the SAME FieldSpec the workbench form renders
// (lib/capabilities/input-fields.ts); the command's strict Zod schema validates
// again on the server when the capability runs. Values are kept as strings and
// converted to the handler's types only when the payload is built.

export type RefOption = { value: string; label: string }

export const REF_FIELD_TYPES = new Set(["job", "client", "supplier", "connection", "file", "member", "evidence"])

export function normalizeReply(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:'"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export type ParsedReply = { ok: true; value: string } | { ok: false; reason: "no_match" | "ambiguous" | "invalid" | "out_of_range" | "too_long" }

const YES = new Set(["yes", "y", "true", "si", "s", "1", "verdadero"])
const NO = new Set(["no", "n", "false", "0", "falso"])

/** Parses one reply for one field. `options` are the authorized choices for enum/ref fields. */
export function parseFieldReply(field: FieldSpec, raw: string, options: RefOption[] = []): ParsedReply {
  const text = raw.trim()
  if (!text) return { ok: false, reason: "invalid" }
  switch (field.type) {
    case "enum":
    case "job":
    case "client":
    case "supplier":
    case "connection":
    case "file":
    case "member":
    case "evidence": {
      const n = normalizeReply(text)
      const choices =
        field.type === "enum"
          ? (field.options ?? []).flatMap((o) => [
              { value: o.value, keys: [o.value, o.label.en, o.label.es].map(normalizeReply) },
            ])
          : options.map((o) => ({ value: o.value, keys: [o.value, o.label].map(normalizeReply) }))
      const exact = choices.filter((c) => c.keys.includes(n))
      if (exact.length === 1) return { ok: true, value: exact[0]!.value }
      if (exact.length > 1) return { ok: false, reason: "ambiguous" }
      return { ok: false, reason: "no_match" }
    }
    case "money": {
      const v = text.replace(/[,\s]/g, "").replace(/^[$]/, "")
      if (!/^-?\d{1,15}(\.\d{1,2})?$/.test(v)) return { ok: false, reason: "invalid" }
      const [i, d = ""] = v.split(".")
      return { ok: true, value: `${i}.${d.padEnd(2, "0")}` }
    }
    case "integer":
    case "minutes":
    case "bps": {
      const v = text.replace(/[,\s]/g, "")
      if (!/^-?\d{1,9}$/.test(v)) return { ok: false, reason: "invalid" }
      const n = Number(v)
      if (field.min !== undefined && n < field.min) return { ok: false, reason: "out_of_range" }
      if (field.max !== undefined && n > field.max) return { ok: false, reason: "out_of_range" }
      return { ok: true, value: String(n) }
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, reason: "invalid" }
      const d = new Date(`${text}T00:00:00Z`)
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) return { ok: false, reason: "invalid" }
      return { ok: true, value: text }
    }
    case "month": {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return { ok: false, reason: "invalid" }
      return { ok: true, value: text }
    }
    case "boolean": {
      const n = normalizeReply(text)
      if (YES.has(n)) return { ok: true, value: "true" }
      if (NO.has(n)) return { ok: true, value: "false" }
      return { ok: false, reason: "invalid" }
    }
    case "text":
    case "textarea": {
      const max = field.maxLength ?? (field.type === "text" ? 160 : 1000)
      if (text.length > max) return { ok: false, reason: "too_long" }
      return { ok: true, value: text }
    }
    default:
      return { ok: false, reason: "invalid" }
  }
}

/** String default from a field example or a fixture value (refs never default from examples). */
export function stringDefault(field: FieldSpec, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string") return value
  return null
}

/** Converts validated string params to the payload types the handler expects (same as the workbench form). */
export function toHandlerInput(fields: readonly FieldSpec[], params: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = params[f.key]
    if (v === undefined || v === "") continue
    if (f.type === "integer" || f.type === "minutes" || f.type === "bps") out[f.key] = Number(v)
    else if (f.type === "boolean") out[f.key] = v === "true"
    else out[f.key] = v
  }
  return out
}
