import "server-only"

import { and, asc, eq, sql } from "drizzle-orm"

import { payloadDigest } from "@/server/calculators"
import type { Tx } from "@/server/db/client"
import { adapterOperation, connection, demoProviderEffect } from "@/server/db/schema"
import { toJsonSafe } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

// Contract shared with future real adapters (Eve/Connect, Composio, API, MCP):
//   capabilities(), validateConnection(), preview(), execute(), getOperation(), reconcile().
// This demo implementation never makes network requests. Its fictional
// provider state lives in demo_provider_effect; receipts are always sim_*.

export const ADAPTER_VERSION = "simulated-provider@1"

export const FAILURE_MODES = [
  "success",
  "validation_error",
  "permission_revoked",
  "rate_limited",
  "timeout_before_effect",
  "timeout_after_effect",
  "permanent_failure",
] as const
export type FailureMode = (typeof FAILURE_MODES)[number]

export const PROVIDERS: Record<string, { category: string; scopes: string[]; capabilities: string[] }> = {
  meta_ads: { category: "ads", scopes: ["ads.read", "ads.manage"], capabilities: ["campaign.activate", "campaign.read_metrics"] },
  google_ads: { category: "ads", scopes: ["ads.read", "ads.manage"], capabilities: ["campaign.activate", "campaign.read_metrics"] },
  tiktok_ads: { category: "ads", scopes: ["ads.read", "ads.manage"], capabilities: ["campaign.activate", "campaign.read_metrics"] },
  dv360_demo: { category: "ads", scopes: ["ads.read", "ads.manage"], capabilities: ["campaign.activate"] },
  demo_bank: { category: "payments", scopes: ["payments.read", "payments.initiate"], capabilities: ["payment.execute", "statement.read"] },
  demo_ledger: { category: "accounting", scopes: ["ledger.read", "ledger.post"], capabilities: ["journal.post"] },
}

export type ExecuteRequest = {
  tenantId: string
  provider: string
  accountAlias: string
  operationType: string
  /** Stable id of the approved action; the idempotency key derives from it. */
  approvedActionId: string
  payload: Record<string, unknown>
  failureMode?: FailureMode
  /**
   * What the fictional provider records about the effect (e.g. amount, date,
   * reference of a simulated bank movement), so it can later produce its own
   * statement. Not part of the idempotency digest.
   */
  effectSummary?: Record<string, unknown>
}

export type ExecuteResult =
  | { state: "succeeded"; receiptId: string; operationId: string; replayed: boolean }
  | { state: "outcome_unknown"; operationId: string }
  | { state: "failed" | "rate_limited"; operationId: string; error: string; retryAfterSeconds?: number }

function receiptFor(provider: string, key: string) {
  return `sim_${provider}_${payloadDigest({ key }).sha256.slice(0, 16)}`
}

export class SimulatedProviderAdapter {
  capabilities(provider: string) {
    return PROVIDERS[provider]?.capabilities ?? []
  }

  async validateConnection(tx: Tx, tenantId: string, connectionId: string) {
    const [c] = await tx
      .select()
      .from(connection)
      .where(and(eq(connection.tenantId, tenantId), eq(connection.id, connectionId)))
      .limit(1)
    if (!c) throw new DomainError("not_found", "Connection not found")
    const expected = PROVIDERS[c.provider]?.scopes ?? []
    const missing = expected.filter((s) => !c.scopes.includes(s))
    return {
      simulation: true as const,
      adapterVersion: ADAPTER_VERSION,
      state: c.state,
      reachable: c.state === "connected_demo",
      missingScopes: missing,
      checkedCapabilities: this.capabilities(c.provider),
    }
  }

  preview(req: ExecuteRequest) {
    return {
      simulation: true as const,
      provider: req.provider,
      operationType: req.operationType,
      payloadDigest: payloadDigest(toJsonSafe(req.payload)).sha256,
    }
  }

  /** Executes exactly the approved payload once per idempotency key. */
  async execute(tx: Tx, req: ExecuteRequest): Promise<ExecuteResult> {
    const idempotencyKey = `${req.operationType}:${req.approvedActionId}`
    const digest = payloadDigest(toJsonSafe(req.payload)).sha256
    const mode = req.failureMode ?? "success"
    const [existing] = await tx
      .select()
      .from(adapterOperation)
      .where(
        and(
          eq(adapterOperation.tenantId, req.tenantId),
          eq(adapterOperation.provider, req.provider),
          eq(adapterOperation.idempotencyKey, idempotencyKey)
        )
      )
      .for("update")
      .limit(1)
    if (existing && existing.payloadDigest !== digest) {
      throw new DomainError("idempotency_conflict", "Operation key reused with a different payload")
    }
    if (existing?.state === "succeeded") {
      return { state: "succeeded", receiptId: existing.receiptId!, operationId: existing.id, replayed: true }
    }
    if (existing?.state === "outcome_unknown") {
      // Never resend blindly: the caller must reconcile first.
      return { state: "outcome_unknown", operationId: existing.id }
    }
    const op =
      existing ??
      (
        await tx
          .insert(adapterOperation)
          .values({
            tenantId: req.tenantId,
            provider: req.provider,
            accountAlias: req.accountAlias,
            operationType: req.operationType,
            approvedActionId: req.approvedActionId,
            idempotencyKey,
            payloadDigest: digest,
            payload: toJsonSafe(req.payload) as object,
            state: "pending",
            failureMode: mode,
          })
          .returning()
      )[0]!

    const bump = { attempts: sql`${adapterOperation.attempts} + 1`, updatedAt: new Date() }
    const recordEffect = async () => {
      const receiptId = receiptFor(req.provider, idempotencyKey)
      await tx
        .insert(demoProviderEffect)
        .values({
          tenantId: req.tenantId,
          provider: req.provider,
          idempotencyKey,
          receiptId,
          effect: toJsonSafe({
            operationType: req.operationType,
            payloadDigest: digest,
            adapterVersion: ADAPTER_VERSION,
            simulation: true,
            accountAlias: req.accountAlias,
            approvedActionId: req.approvedActionId,
            summary: req.effectSummary ?? null,
          }) as object,
        })
        .onConflictDoNothing()
      return receiptId
    }

    switch (mode) {
      case "success": {
        const receiptId = await recordEffect()
        await tx.update(adapterOperation).set({ ...bump, state: "succeeded", receiptId }).where(eq(adapterOperation.id, op.id))
        return { state: "succeeded", receiptId, operationId: op.id, replayed: false }
      }
      case "timeout_after_effect": {
        // The fictional provider applied the effect, but the app never heard.
        await recordEffect()
        await tx.update(adapterOperation).set({ ...bump, state: "outcome_unknown" }).where(eq(adapterOperation.id, op.id))
        return { state: "outcome_unknown", operationId: op.id }
      }
      case "rate_limited":
        await tx.update(adapterOperation).set({ ...bump, state: "rate_limited", lastError: "rate_limited" }).where(eq(adapterOperation.id, op.id))
        return { state: "rate_limited", operationId: op.id, error: "rate_limited", retryAfterSeconds: 60 }
      case "timeout_before_effect":
        await tx.update(adapterOperation).set({ ...bump, state: "failed", lastError: "timeout_before_effect" }).where(eq(adapterOperation.id, op.id))
        return { state: "failed", operationId: op.id, error: "timeout_before_effect" }
      default:
        await tx.update(adapterOperation).set({ ...bump, state: "failed", lastError: mode }).where(eq(adapterOperation.id, op.id))
        return { state: "failed", operationId: op.id, error: mode }
    }
  }

  async getOperation(tx: Tx, tenantId: string, operationId: string) {
    const [op] = await tx
      .select()
      .from(adapterOperation)
      .where(and(eq(adapterOperation.tenantId, tenantId), eq(adapterOperation.id, operationId)))
      .limit(1)
    return op ?? null
  }

  /** The fictional provider's own record of effects for one account (statements). */
  async listEffects(tx: Tx, tenantId: string, provider: string, accountAlias: string, operationType?: string) {
    const rows = await tx
      .select()
      .from(demoProviderEffect)
      .where(and(eq(demoProviderEffect.tenantId, tenantId), eq(demoProviderEffect.provider, provider)))
      .orderBy(asc(demoProviderEffect.createdAt))
    return rows.filter((r) => {
      const e = r.effect as { accountAlias?: string; operationType?: string }
      return e.accountAlias === accountAlias && (!operationType || e.operationType === operationType)
    })
  }

  /** Resolves an uncertain outcome from the provider's own record. */
  async reconcile(tx: Tx, tenantId: string, operationId: string) {
    const op = await this.getOperation(tx, tenantId, operationId)
    if (!op) throw new DomainError("not_found", "Operation not found")
    const [effect] = await tx
      .select()
      .from(demoProviderEffect)
      .where(
        and(
          eq(demoProviderEffect.tenantId, tenantId),
          eq(demoProviderEffect.provider, op.provider),
          eq(demoProviderEffect.idempotencyKey, op.idempotencyKey)
        )
      )
      .limit(1)
    if (effect) {
      await tx
        .update(adapterOperation)
        .set({ state: "succeeded", receiptId: effect.receiptId, updatedAt: new Date() })
        .where(eq(adapterOperation.id, op.id))
      return { state: "succeeded" as const, receiptId: effect.receiptId, effectCount: 1 }
    }
    await tx
      .update(adapterOperation)
      .set({ state: "failed", lastError: "no_effect_confirmed", updatedAt: new Date() })
      .where(eq(adapterOperation.id, op.id))
    return { state: "no_effect" as const, receiptId: null, effectCount: 0 }
  }
}

export const simulatedProvider = new SimulatedProviderAdapter()
