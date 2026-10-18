import "server-only"

import { readFileSync } from "node:fs"
import path from "node:path"

import { CAPABILITY_CONTRACTS } from "@/lib/capabilities/catalog.generated"
import { GOVERNANCE } from "@/lib/capabilities/governance"
import { INPUT_FIELDS } from "@/lib/capabilities/input-fields"
import type { HandlerStatus } from "@/lib/capabilities/types"

import { capabilities as accountingClose } from "./handlers/accounting-close"
import { capabilities as billingCollections } from "./handlers/billing-collections"
import { capabilities as clientsContracts } from "./handlers/clients-contracts"
import { capabilities as mediaBuying } from "./handlers/media-buying"
import { capabilities as mediaPlanning } from "./handlers/media-planning"
import { capabilities as profitability } from "./handlers/profitability"
import { capabilities as setup } from "./handlers/setup"
import { capabilities as suppliersPayments } from "./handlers/suppliers-payments"
import { capabilities as workProduction } from "./handlers/work-production"
import type { ApprovalExecutor, CapabilityFixture, CapabilityHandler } from "./types"

export type { CapabilityHandler } from "./types"

// Capability registry: the 42 catalog contracts plus the server handler and
// acceptance fixtures each module file implements. A capability without a
// handler is `registered` only; the workbench and the assistant report that
// state instead of faking success. `scenario_verified` is derived from the
// last recorded acceptance run (evidence/skill-verification.json written by
// the test harness), never set by hand.

export const HANDLER_VERSION = "chassis-2"

const MODULES = [setup, clientsContracts, workProduction, mediaPlanning, mediaBuying, suppliersPayments, billingCollections, accountingClose, profitability]

export const HANDLERS: Partial<Record<string, CapabilityHandler>> = Object.assign({}, ...MODULES.map((m) => m.handlers))
export const FIXTURES: Partial<Record<string, CapabilityFixture>> = Object.assign({}, ...MODULES.map((m) => m.fixtures))
export const EXECUTORS: Partial<Record<string, ApprovalExecutor>> = Object.assign({}, ...MODULES.map((m) => m.executors ?? {}))

type Verification = { skills: Record<string, { positive: "passed" | "failed"; negative: "passed" | "failed"; handlerVersion: string; ranAt: string }> }

let verificationCache: { at: number; data: Verification | null } | null = null

function verification(): Verification | null {
  if (verificationCache && Date.now() - verificationCache.at < 10_000) return verificationCache.data
  let data: Verification | null = null
  try {
    data = JSON.parse(readFileSync(path.resolve(process.cwd(), "evidence/skill-verification.json"), "utf8")) as Verification
  } catch {
    data = null
  }
  verificationCache = { at: Date.now(), data }
  return data
}

export function handlerStatus(skillId: string): HandlerStatus {
  if (!HANDLERS[skillId]) return "registered"
  const v = verification()?.skills[skillId]
  if (v && v.positive === "passed" && v.negative === "passed" && v.handlerVersion === HANDLER_VERSION) return "scenario_verified"
  return "handler_implemented"
}

export function getCapability(skillId: string) {
  const contract = CAPABILITY_CONTRACTS.find((c) => c.skillId === skillId)
  if (!contract) return null
  return {
    contract,
    governance: GOVERNANCE[skillId]!,
    inputFields: INPUT_FIELDS[skillId] ?? [],
    status: handlerStatus(skillId),
    handlerVersion: HANDLERS[skillId] ? HANDLER_VERSION : null,
    hasFixtures: Boolean(FIXTURES[skillId]),
  }
}

export function listCapabilities() {
  return CAPABILITY_CONTRACTS.map((c) => getCapability(c.skillId)!)
}
