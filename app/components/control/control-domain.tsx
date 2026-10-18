"use client"

import { DomainSimulator } from "@/components/settings/domain-simulator"

/** Control-plane variant of the domain simulation (by agency id, owner only). */
export function ControlDomainSimulator({ agencyId, state, allowed }: { agencyId: string; state: string; allowed: boolean }) {
  return <DomainSimulator agencyId={agencyId} state={state} allowed={allowed} />
}
