"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { GlobeIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Stepper, StepperIndicator, StepperItem, StepperNav, StepperSeparator, StepperTitle, StepperTrigger } from "@/components/reui/stepper"
import { Button } from "@/components/ui/button"
import { simulateDnsForAgencyAction } from "@/server/actions/ui/control"
import { simulateDnsAction } from "@/server/actions/ui/settings"

const STATES = ["requested", "pending_dns", "verifying", "simulated_ready"] as const

/** Requested → Pending DNS → Verifying → Simulated ready, advanced by the activation service. No DNS is queried. */
export function DomainSimulator({ agencySlug, agencyId, state, allowed }: { agencySlug?: string; agencyId?: string; state: string; allowed: boolean }) {
  const { t } = useI18n()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const idx = STATES.indexOf(state as (typeof STATES)[number])
  const done = state === "simulated_ready"
  return (
    <div className="flex flex-col gap-4">
      <Stepper value={idx + 1} className="w-full">
        <StepperNav>
          {STATES.map((s, i) => (
            <StepperItem key={s} step={i + 1} completed={i < idx || done} className="relative">
              <StepperTrigger className="flex flex-col items-center gap-1.5" disabled>
                <StepperIndicator>{i + 1}</StepperIndicator>
                <StepperTitle className="text-center text-xs">{t(`records.state.${s}`)}</StepperTitle>
              </StepperTrigger>
              {i < STATES.length - 1 && <StepperSeparator className="mx-2 mb-5" />}
            </StepperItem>
          ))}
        </StepperNav>
      </Stepper>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!allowed || pending || done || idx < 0}
          onClick={() =>
            start(async () => {
              setError(null)
              const res = agencyId ? await simulateDnsForAgencyAction({ agencyId, expectedState: state }) : await simulateDnsAction({ agencySlug: agencySlug ?? "", expectedState: state })
              if (!res.ok) return setError(t(`errors.${res.error.code}`))
              router.refresh()
            })
          }
        >
          <GlobeIcon aria-hidden="true" />
          {pending ? t("common.loading") : t("settings.domains.simulate")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("settings.domains.simulateHelp")}</span>
      </div>
      {error && (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{error}</AlertTitle>
          <AlertDescription>{t("settings.domains.errorHelp")}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
