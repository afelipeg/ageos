"use client"

import { useActionState, useId } from "react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { signInWithAccessCode, type SignInState } from "@/server/actions/session"

export function SignInForm({ next }: { next: string }) {
  const { t } = useI18n()
  const id = useId()
  const [state, action, pending] = useActionState<SignInState, FormData>(signInWithAccessCode, { error: null })
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field data-invalid={state.error ? true : undefined}>
        <FieldLabel htmlFor={id}>{t("auth.accessCode")}</FieldLabel>
        <Input id={id} name="accessCode" type="password" autoComplete="off" required aria-invalid={state.error ? true : undefined} aria-describedby={`${id}-help`} />
        <FieldDescription id={`${id}-help`}>{t("auth.accessCodeHelp")}</FieldDescription>
        {state.error && <FieldError>{t("auth.invalidCode")}</FieldError>}
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {t("auth.signIn")}
      </Button>
    </form>
  )
}
