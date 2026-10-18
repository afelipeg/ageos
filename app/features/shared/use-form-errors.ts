"use client"

import { useCallback, useState } from "react"

/**
 * Client-side validation state shared by every form in the template (sheets,
 * dialogs, and the settings/profile pages).
 *
 * The contract each form follows:
 *   - the submit button stays enabled, so pressing it on an empty form is what
 *     surfaces the errors instead of leaving the user with a dead control;
 *   - `validate()` shows every failure at once and focuses the first one;
 *   - `clearError()` on change drops a message the moment the user fixes it;
 *   - `setError()` on blur flags a required field the user tabbed past.
 *
 * Convention: an error key IS the DOM id of the control it belongs to. That is
 * what lets `validate()` scroll to and focus the first field needing attention
 * without every form threading refs around.
 *
 * Buyers wiring a real backend can drop in react-hook-form + zod instead — the
 * markup contract stays the same: `aria-invalid` on the control and a
 * `<FieldError>` rendered underneath it.
 */
export type FormErrors = Record<string, string | undefined>

export function useFormErrors() {
  const [errors, setErrors] = useState<FormErrors>({})

  /** Drop a field's error as soon as the user starts correcting it. */
  const clearError = useCallback((key: string) => {
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }, [])

  /** Set one field's error (an empty message clears it) — used on blur. */
  const setError = useCallback((key: string, message?: string) => {
    setErrors((prev) => ({ ...prev, [key]: message || undefined }))
  }, [])

  /** Clear everything — call after a successful submit or when the form closes. */
  const resetErrors = useCallback(() => setErrors({}), [])

  /**
   * Check every rule at once. Pass a map of `fieldId -> message-or-empty`; any
   * non-empty message counts as a failure. Returns true when the form is valid
   * and the submit may proceed.
   */
  const validate = useCallback((rules: FormErrors) => {
    const failed: FormErrors = {}
    for (const [key, message] of Object.entries(rules)) {
      if (message) failed[key] = message
    }
    setErrors(failed)

    const [firstKey] = Object.keys(failed)
    if (!firstKey) return true

    // Sheets and dialogs scroll, so bring the offending field into view before
    // focusing it — otherwise the message can land outside the viewport.
    const element = document.getElementById(firstKey)
    element?.scrollIntoView({ block: "center", behavior: "smooth" })
    element?.focus({ preventScroll: true })
    return false
  }, [])

  return { errors, validate, setError, clearError, resetErrors }
}
