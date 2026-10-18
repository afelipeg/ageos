import "server-only"

import { and, asc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import type { Tx } from "@/server/db/client"
import { connection, simulationDirective } from "@/server/db/schema"
import { defineCommand } from "@/server/kernel/commands"

import { ADAPTER_VERSION, FAILURE_MODES, simulatedProvider, type FailureMode } from "./simulated-provider"

// Demo bank adapter (payments + statements) on top of SimulatedProviderAdapter.
// No network request is ever made: transfers are "Simulate payment" effects
// with sim_* receipts; the idempotency key derives from the approved action
// id, so a retry never moves money twice. `timeout_after_effect` leaves the
// outcome unknown until `reconcileDemoPayment` reads the provider's record.

export const PAYMENT_OPERATION = "payment.execute"
export const SIMULATED_PAYMENT_LABEL = { en: "Simulate payment", es: "Simular pago" } as const

export type DemoBankConnection = typeof connection.$inferSelect

export type DemoPaymentResult =
  | { state: "succeeded"; receiptId: string; operationId: string; replayed: boolean }
  | { state: "outcome_unknown"; operationId: string }
  | { state: "failed" | "rate_limited"; operationId: string; error: string; retryable: boolean; connectionRevoked: boolean }

const RETRYABLE = new Set(["timeout_before_effect", "rate_limited"])

export async function executeDemoPayment(
  tx: Tx,
  req: {
    tenantId: string
    connection: DemoBankConnection
    approvedActionId: string
    payment: { paymentId: string; amountMinor: bigint; currency: string; payee: string; sourceType: string; sourceId: string }
    businessDate: string
    failureMode: FailureMode
  }
): Promise<DemoPaymentResult> {
  const res = await simulatedProvider.execute(tx, {
    tenantId: req.tenantId,
    provider: req.connection.provider,
    accountAlias: req.connection.accountAlias,
    operationType: PAYMENT_OPERATION,
    approvedActionId: req.approvedActionId,
    // Exactly the approved payment; nothing that varies between retries.
    payload: { ...req.payment, simulation: true, adapterVersion: ADAPTER_VERSION },
    failureMode: req.failureMode,
    effectSummary: { direction: "out", amountMinor: req.payment.amountMinor, currency: req.payment.currency, businessDate: req.businessDate, payee: req.payment.payee, reference: req.payment.paymentId },
  })
  if (res.state === "succeeded" || res.state === "outcome_unknown") return res
  let connectionRevoked = false
  if (res.error === "permission_revoked") {
    await tx
      .update(connection)
      .set({ state: "revoked", updatedAt: new Date(), revision: sql`${connection.revision} + 1` })
      .where(and(eq(connection.tenantId, req.tenantId), eq(connection.id, req.connection.id)))
    connectionRevoked = true
  }
  return { state: res.state, operationId: res.operationId, error: res.error, retryable: RETRYABLE.has(res.error), connectionRevoked }
}

export function reconcileDemoPayment(tx: Tx, tenantId: string, operationId: string) {
  return simulatedProvider.reconcile(tx, tenantId, operationId)
}

/** Movements the fictional bank recorded for an account (its own statement). */
export async function demoBankEffects(tx: Tx, tenantId: string, accountAlias: string) {
  const rows = await simulatedProvider.listEffects(tx, tenantId, "demo_bank", accountAlias, PAYMENT_OPERATION)
  return rows.map((r) => {
    const e = r.effect as { summary?: { direction?: string; amountMinor?: string; currency?: string; businessDate?: string; payee?: string; reference?: string } | null }
    return {
      receiptId: r.receiptId,
      direction: (e.summary?.direction ?? "out") as "in" | "out",
      amountMinor: BigInt(e.summary?.amountMinor ?? "0"),
      currency: e.summary?.currency ?? "",
      businessDate: e.summary?.businessDate ?? r.createdAt.toISOString().slice(0, 10),
      description: `Simulated payment to ${e.summary?.payee ?? "payee"}`,
    }
  })
}

// ── Presenter control: queue the outcome of the next simulated payment ──
// Same store and pattern as the ads adapter (simulation_directive); the next
// payment execution of the agency consumes the oldest pending directive.

export const PAYMENT_PROVIDER = "demo_bank"

export async function takePaymentDirective(tx: Tx, tenantId: string) {
  const [d] = await tx
    .select()
    .from(simulationDirective)
    .where(and(eq(simulationDirective.tenantId, tenantId), eq(simulationDirective.provider, PAYMENT_PROVIDER), eq(simulationDirective.operationType, PAYMENT_OPERATION), eq(simulationDirective.state, "pending")))
    .orderBy(asc(simulationDirective.createdAt))
    .for("update")
    .limit(1)
  return d ? { id: d.id, failureMode: d.failureMode as FailureMode } : null
}

export async function markDirectiveConsumed(tx: Tx, directiveId: string, operationId: string) {
  await tx.update(simulationDirective).set({ state: "consumed", consumedByOperationId: operationId }).where(eq(simulationDirective.id, directiveId))
}

export const QueuePaymentSimulationOutcomeInput = z.object({ failureMode: z.enum(FAILURE_MODES) }).strict()

export const queuePaymentSimulationOutcome = defineCommand({
  type: "payments.queueSimulationOutcome",
  skillId: null,
  permission: "connections.manage",
  input: QueuePaymentSimulationOutcomeInput,
  handler: async (tx, ctx, input) => {
    const [row] = await tx
      .insert(simulationDirective)
      .values({ tenantId: ctx.tenant.id, provider: PAYMENT_PROVIDER, operationType: PAYMENT_OPERATION, failureMode: input.failureMode, createdBy: ctx.user.id })
      .returning()
    return {
      result: { directiveId: row!.id, provider: PAYMENT_PROVIDER, operationType: PAYMENT_OPERATION, failureMode: input.failureMode, simulation: true as const },
      events: [
        {
          eventType: "simulation.directive_queued",
          aggregateType: "simulation_directive",
          aggregateId: row!.id,
          payload: { provider: PAYMENT_PROVIDER, operationType: PAYMENT_OPERATION, failureMode: input.failureMode, presenter: ctx.presenter },
        },
      ],
    }
  },
})
