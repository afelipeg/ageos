"use client"

import { useEffect } from "react"
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Frame, FrameHeader, FramePanel } from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

// Route-level loading and error states. Loading mirrors the desk layout
// (header, one Frame with rows) so the context does not jump; the error
// boundary shows a readable reason, the digest as incident reference and an
// idempotent Retry that re-renders the server segment.

export function DeskSkeleton({ rows = 6, side = false }: { rows?: number; side?: boolean }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label={t("common.loading")}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className={side ? "grid gap-6 xl:grid-cols-3" : "flex flex-col gap-6"}>
        <Frame spacing="default" className={side ? "min-w-0 xl:col-span-2" : "min-w-0"}>
          <FrameHeader>
            <Skeleton className="h-5 w-64 max-w-full" />
          </FrameHeader>
          <FramePanel className="flex flex-col gap-3">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
            ))}
          </FramePanel>
        </Frame>
        {side && (
          <Frame spacing="default" className="min-w-0">
            <FramePanel className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </FramePanel>
          </Frame>
        )}
      </div>
    </div>
  )
}

export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n()
  useEffect(() => {
    console.error("[ageos] route error", error.digest ?? "")
  }, [error])
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>{t("states.errorTitle")}</AlertTitle>
      <AlertDescription>{t("states.errorBody", { ref: error.digest ?? "—" })}</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={() => reset()}>
          <RefreshCwIcon aria-hidden="true" />
          {t("common.retry")}
        </Button>
      </AlertAction>
    </Alert>
  )
}
