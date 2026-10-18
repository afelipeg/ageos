import type { FieldSpec } from "@/lib/capabilities/types"
import { FIXTURE_INPUT_PREFIX } from "@/lib/demo/journeys"

import { REF_TYPES, type RefOption } from "./form-values"

/**
 * Demo-journey prefill from `f.<field>` search params. Keeps only this skill's
 * fields; a `fixture:<key>` value resolves through `fixtureId` (server-only)
 * and any reference value survives only if it is one of the field's authorized
 * options in the current tenant; enum and boolean values must be valid
 * choices; an empty value clears the field. Anything else is dropped. Prefill never submits: the command
 * validates the whole payload again.
 */
export function prefillFromParams(
  fields: readonly FieldSpec[],
  refs: Partial<Record<string, RefOption[]>>,
  params: Record<string, string | string[] | undefined>,
  fixtureId: (key: string) => string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields) {
    const raw = params[`f.${f.key}`]
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
    if (value === undefined) continue
    // An explicitly empty value clears the field's editable example.
    if (value === "") {
      out[f.key] = ""
      continue
    }
    if (REF_TYPES.has(f.type)) {
      const id = value.startsWith(FIXTURE_INPUT_PREFIX) ? fixtureId(value.slice(FIXTURE_INPUT_PREFIX.length)) : value
      if (refs[f.type]?.some((o) => o.value === id)) out[f.key] = id
    } else if (value.startsWith(FIXTURE_INPUT_PREFIX)) {
      continue
    } else if (f.type === "enum") {
      if (f.options?.some((o) => o.value === value)) out[f.key] = value
    } else if (f.type === "boolean") {
      if (value === "true" || value === "false") out[f.key] = value
    } else {
      out[f.key] = f.maxLength ? value.slice(0, f.maxLength) : value
    }
  }
  return out
}
