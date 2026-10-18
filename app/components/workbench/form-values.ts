import type { FieldSpec } from "@/lib/capabilities/types"

// Workbench form values shared by the form (client), the page (server) and the
// journey runner test, so a prefilled link behaves the same everywhere.

export type RefOption = { value: string; label: string; detail?: string; revision?: number }
export type FormValues = Record<string, string | boolean>

export const REF_TYPES = new Set(["job", "client", "supplier", "connection", "file", "member", "evidence"])

/** Initial form values: preset (session or journey prefill), else the field's editable example. */
export function initialValues(fields: readonly FieldSpec[], preset: Record<string, string>): FormValues {
  return Object.fromEntries(
    fields.map((f) => {
      const p = preset[f.key]
      if (f.type === "boolean") return [f.key, p !== undefined ? p === "true" : f.example === true]
      if (p !== undefined) return [f.key, p]
      if (f.example !== undefined && !REF_TYPES.has(f.type)) return [f.key, String(f.example)]
      return [f.key, ""]
    })
  )
}

/** Required fields the form would flag client-side before calling the server. */
export function missingRequired(fields: readonly FieldSpec[], values: FormValues): string[] {
  return fields.filter((f) => f.required && (values[f.key] === "" || values[f.key] === undefined)).map((f) => f.key)
}

/** Payload sent to the command: empty values omitted, integer kinds as numbers. */
export function buildPayload(fields: readonly FieldSpec[], values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = values[f.key]
    if (v === "" || v === undefined) continue
    if (f.type === "integer" || f.type === "minutes" || f.type === "bps") out[f.key] = Number(v)
    else out[f.key] = v
  }
  return out
}
