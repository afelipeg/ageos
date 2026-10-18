"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Button } from "@/components/ui/button"
import { createAgencyDraftAction } from "@/server/actions/ui/control"

/** Creates (or, on a repeated click/refresh, returns) one persisted agency draft and opens step 1. */
export function NewAgencyButton({ label, variant = "default" }: { label: string; variant?: "default" | "outline" }) {
  const { t } = useI18n()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const key = useRef(`control:new-agency:${crypto.randomUUID()}`)
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null)
            const res = await createAgencyDraftAction({ idempotencyKey: key.current })
            if (!res.ok) return setError(t(`errors.${res.error.code}`))
            router.push(`/control/setup/${res.data.draftId}/agency`)
          })
        }
      >
        <PlusIcon aria-hidden="true" />
        {pending ? t("common.loading") : label}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
