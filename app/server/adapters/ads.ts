import "server-only"

import { and, asc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import type { Tx } from "@/server/db/client"
import { connection, simulationDirective } from "@/server/db/schema"
import { defineCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { ADAPTER_VERSION, FAILURE_MODES, PROVIDERS, simulatedProvider, type FailureMode } from "./simulated-provider"

// Ads/media adapter for Core-2 (media orders, campaign activation). Built on
// top of the shared SimulatedProviderAdapter: never a network call, receipts
// are always sim_*, the idempotency key derives from the approved action id.
// Results are labelled "Simulated activation" — never "Live on <provider>".

export const SIMULATED_LABEL = { en: "Simulated activation", es: "Activación simulada" } as const

export type AdsConnection = typeof connection.$inferSelect

/** Locks and checks a connection: present, connected (demo) and with all provider scopes. */
export async function requireActiveConnection(tx: Tx, tenantId: string, connectionId: string) {
  const [c] = await tx
    .select()
    .from(connection)
    .where(and(eq(connection.tenantId, tenantId), eq(connection.id, connectionId)))
    .limit(1)
  if (!c) throw new DomainError("not_found", "Connection not found", { field: "connection" })
  const check = connectionCheck(c)
  return { connection: c, check }
}

export function connectionCheck(c: AdsConnection) {
  const expected = PROVIDERS[c.provider]?.scopes ?? []
  const missingScopes = expected.filter((s) => !c.scopes.includes(s))
  return {
    simulation: true as const,
    adapterVersion: ADAPTER_VERSION,
    provider: c.provider,
    accountAlias: c.accountAlias,
    state: c.state,
    active: c.state === "connected_demo" && missingScopes.length === 0 && expected.length > 0,
    missingScopes,
  }
}

/** Takes (and consumes) the presenter's pending outcome for the next operation. */
async function takeDirective(tx: Tx, tenantId: string, provider: string, operationType: string): Promise<FailureMode> {
  const [d] = await tx
    .select()
    .from(simulationDirective)
    .where(
      and(
        eq(simulationDirective.tenantId, tenantId),
        eq(simulationDirective.provider, provider),
        eq(simulationDirective.operationType, operationType),
        eq(simulationDirective.state, "pending")
      )
    )
    .orderBy(asc(simulationDirective.createdAt))
    .for("update")
    .limit(1)
  if (!d) return "success"
  await tx.update(simulationDirective).set({ state: "consumed" }).where(eq(simulationDirective.id, d.id))
  return d.failureMode as FailureMode
}

export type AdsExecution =
  | { state: "succeeded"; receiptId: string; operationId: string; replayed: boolean; failureMode: FailureMode }
  | { state: "outcome_unknown"; operationId: string; failureMode: FailureMode }
  | { state: "failed" | "rate_limited"; operationId: string; error: string; failureMode: FailureMode; connectionRevoked: boolean }

/**
 * Executes exactly the approved payload against the simulated provider. A
 * `permission_revoked` answer revokes the connection (only dependent
 * capabilities are blocked); `timeout_after_effect` leaves outcome_unknown
 * until `reconcileAds` reads the provider's own record.
 */
export async function executeAds(
  tx: Tx,
  req: {
    tenantId: string
    connection: AdsConnection
    operationType: string
    approvedActionId: string
    payload: Record<string, unknown>
  }
): Promise<AdsExecution> {
  const failureMode = await takeDirective(tx, req.tenantId, req.connection.provider, req.operationType)
  const res = await simulatedProvider.execute(tx, {
    tenantId: req.tenantId,
    provider: req.connection.provider,
    accountAlias: req.connection.accountAlias,
    operationType: req.operationType,
    approvedActionId: req.approvedActionId,
    payload: { ...req.payload, simulation: true, adapterVersion: ADAPTER_VERSION },
    failureMode,
  })
  if (res.state === "succeeded") return { ...res, failureMode }
  if (res.state === "outcome_unknown") return { ...res, failureMode }
  let connectionRevoked = false
  if (res.error === "permission_revoked") {
    await tx
      .update(connection)
      .set({ state: "revoked", updatedAt: new Date(), revision: sql`${connection.revision} + 1` })
      .where(and(eq(connection.tenantId, req.tenantId), eq(connection.id, req.connection.id)))
    connectionRevoked = true
  }
  return { state: res.state, operationId: res.operationId, error: res.error, failureMode, connectionRevoked }
}

export function reconcileAds(tx: Tx, tenantId: string, operationId: string) {
  return simulatedProvider.reconcile(tx, tenantId, operationId)
}

/** Stable simulated external id derived from the receipt (never a real platform id). */
export function simulatedExternalId(receiptId: string) {
  return receiptId.replace(/^sim_/, "sim_ext_")
}

// ── Presenter control: queue the outcome of the next simulated ads operation ──
export const QueueSimulationOutcomeInput = z
  .object({
    provider: z.enum(["meta_ads", "google_ads", "tiktok_ads", "dv360_demo"]),
    operationType: z.enum(["media_order.submit", "campaign.activate"]),
    failureMode: z.enum(FAILURE_MODES),
  })
  .strict()

export const queueSimulationOutcome = defineCommand({
  type: "ads.queueSimulationOutcome",
  skillId: null,
  permission: "connections.manage",
  input: QueueSimulationOutcomeInput,
  handler: async (tx, ctx, input) => {
    const [row] = await tx
      .insert(simulationDirective)
      .values({ tenantId: ctx.tenant.id, ...input, createdBy: ctx.user.id })
      .returning()
    return {
      result: { directiveId: row!.id, ...input, simulation: true as const },
      events: [
        {
          eventType: "simulation.directive_queued",
          aggregateType: "simulation_directive",
          aggregateId: row!.id,
          payload: { ...input, presenter: ctx.presenter },
        },
      ],
    }
  },
})
