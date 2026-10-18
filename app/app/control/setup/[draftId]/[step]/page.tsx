import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { SetupWizard } from "@/components/control/setup-wizard"
import { PROVIDERS } from "@/server/adapters/simulated-provider"
import { requireControlSession } from "@/server/auth/request"
import {
  COUNTRIES,
  CURRENCIES,
  FEE_TYPES,
  getDraft,
  OPERATING_PROFILES,
  profileCapabilities,
  profileDefaults,
  SAMPLE_AGENCY,
  SERVICES,
  SETUP_STEPS,
  TIMEZONES,
  validateConfiguration,
  type ConfigurationValidation,
  type DraftView,
} from "@/server/domain/configuration"
import { isDomainError } from "@/server/kernel/errors"

export const metadata: Metadata = { title: "Build your agency" }

// setup-wizard family (P03, onboarding-1 adaptation): five persisted steps
// Agency → Operations → Connections → Brand & access → Review. Each step is
// saved with the draft revision before advancing; the server validates and
// reports blockers per step. Review validates the whole configuration and
// Deploy starts the logical activation.
export default async function SetupStepPage({ params }: { params: Promise<{ draftId: string; step: string }> }) {
  const { draftId, step } = await params
  const session = await requireControlSession(`/control/setup/${draftId}/${step}`)
  if (!(SETUP_STEPS as readonly string[]).includes(step)) notFound()
  let draft: DraftView
  try {
    draft = await getDraft(session, draftId)
  } catch (e) {
    if (isDomainError(e) && (e.code === "not_found" || e.code === "forbidden")) notFound()
    throw e
  }
  let validation: ConfigurationValidation | null = null
  if (step === "review") validation = await validateConfiguration(session, draftId)
  const profiles = Object.fromEntries(
    OPERATING_PROFILES.map((p) => {
      const d = profileDefaults(p)
      return [p, { ...d, enabledCapabilities: profileCapabilities(p) }]
    })
  )
  return (
    <SetupWizard
      draft={draft}
      step={step as (typeof SETUP_STEPS)[number]}
      validation={validation}
      options={{
        countries: [...COUNTRIES],
        currencies: [...CURRENCIES],
        timezones: [...TIMEZONES],
        services: [...SERVICES],
        profiles: [...OPERATING_PROFILES],
        feeTypes: [...FEE_TYPES],
        providers: Object.entries(PROVIDERS).map(([key, p]) => ({ key, category: p.category, scopes: p.scopes })),
        profileDefaults: profiles,
        sample: SAMPLE_AGENCY,
      }}
    />
  )
}
