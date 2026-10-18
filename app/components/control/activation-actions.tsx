"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCwIcon, RotateCcwIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Button } from "@/components/ui/button"
import { retryActivationAction } from "@/server/actions/ui/control"

/** Retry the failed/waiting step (owner) or re-read the persisted run state. */
export function ActivationActions({ runId, canRetry, running }: { runId: string; canRetry: boolean; running: boolean }) {
  const { t } = useI18n()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-2">
        {canRetry && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null)
                const res = await retryActivationAction({ runId })
                if (!res.ok) return setError(t(`errors.${res.error.code}`))
                router.refresh()
              })
            }
          >
            <RotateCcwIcon aria-hidden="true" />
            {pending ? t("common.loading") : t("control.activation.retry")}
          </Button>
        )}
        {running && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => router.refresh()}>
            <RefreshCwIcon aria-hidden="true" />
            {t("control.activation.checkStatus")}
          </Button>
        )}
      </div>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
