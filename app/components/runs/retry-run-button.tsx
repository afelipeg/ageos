"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCwIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Button } from "@/components/ui/button"
import { retrySafeRunAction } from "@/server/actions/ui/runs"

/** Re-runs a read-only capability run; navigates to the new persisted run. */
export function RetryRunButton({ agencySlug, runId }: { agencySlug: string; runId: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const key = useRef(crypto.randomUUID())
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await retrySafeRunAction({ agencySlug, runId, idempotencyKey: key.current })
            if (!res.ok) {
              setError(t(`errors.${res.error.code}`))
              key.current = crypto.randomUUID()
              return
            }
            router.push(`/a/${agencySlug}/runs/${res.data.runId}`)
          })
        }
      >
        <RefreshCwIcon aria-hidden="true" />
        {pending ? t("common.loading") : t("runs.retrySafe")}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
