import "server-only"

import { and, asc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import { ADAPTER_VERSION, PROVIDERS, simulatedProvider } from "@/server/adapters/simulated-provider"
import type { Tx } from "@/server/db/client"
import { connection } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { defineCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

// ── agency-integrations: configureDemoConnection ──
// "Connected · Demo" never means verified OAuth. Revoking blocks only the
// capabilities that depend on the connection; local documents stay readable.

export const ConfigureConnectionInput = z
  .object({
    action: z.enum(["connect", "test", "revoke", "restore"]),
    provider: z.enum(["meta_ads", "google_ads", "tiktok_ads", "dv360_demo", "demo_bank", "demo_ledger"]),
    accountAlias: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{3,80}$/, "lowercase letters, digits and underscores"),
  })
  .strict()

// Capabilities that depend on each simulated provider; revoking one blocks
// only these, never another provider's actions.
const DEPENDENT_CAPABILITIES: Record<string, string[]> = {
  meta_ads: ["agency-media-buying", "agency-campaign-activation", "agency-campaign-optimization"],
  google_ads: ["agency-media-buying", "agency-campaign-activation", "agency-campaign-optimization"],
  tiktok_ads: ["agency-media-buying", "agency-campaign-activation", "agency-campaign-optimization"],
  dv360_demo: ["agency-media-buying", "agency-campaign-activation"],
  demo_bank: ["agency-payment-run", "agency-cash-settlement", "agency-collections"],
  demo_ledger: ["agency-general-ledger", "agency-period-close"],
}

async function connectionOutputs(tx: Tx, tenantId: string, provider: string, row: { state: string; scopes: string[] } | null) {
  const spec = PROVIDERS[provider]!
  const all = await tx
    .select({ alias: connection.accountAlias, state: connection.state, scopes: connection.scopes })
    .from(connection)
    .where(and(eq(connection.tenantId, tenantId), eq(connection.provider, provider)))
    .orderBy(asc(connection.accountAlias))
  const missingScopes = row ? spec.scopes.filter((s) => !row.scopes.includes(s)) : spec.scopes
  const active = row?.state === "connected_demo"
  return {
    capability_inventory: { provider, category: spec.category, capabilities: spec.capabilities, scopes: spec.scopes },
    stage_wiring_plan: (DEPENDENT_CAPABILITIES[provider] ?? []).map((skillId) => ({ skillId, provider, state: active ? "wired_simulated" : "blocked_connection_inactive" })),
    access_matrix: all.map((c) => ({ provider, accountAlias: c.alias, state: c.state, scopes: c.scopes })),
    schema_review: { mode: "simulated", adapterVersion: ADAPTER_VERSION, verifiedOAuth: false },
    connection_requests: { applicable: false, reason: "simulated_connections_need_no_external_request" },
    file_mode_plan: { applicable: false, reason: "provider_is_simulated_api" },
    gaps: [
      { code: "oauth_not_verified_demo" },
      ...(missingScopes.length ? [{ code: "missing_scopes", scopes: missingScopes }] : []),
      ...(row && !active ? [{ code: "connection_inactive", state: row.state }] : []),
    ],
  }
}

/** Audit record of a request that found the connection already in place. */
function unchangedEvent(c: { id: string; provider: string; accountAlias: string; state: string; revision: number }, action: string) {
  return {
    eventType: "connection.confirmed_unchanged",
    aggregateType: "connection",
    aggregateId: c.id,
    aggregateRevision: c.revision,
    payload: { provider: c.provider, accountAlias: c.accountAlias, state: c.state, action, simulation: true },
  }
}

export const configureDemoConnection = defineCommand({
  type: "connections.configure",
  skillId: "agency-integrations",
  permission: "connections.manage",
  input: ConfigureConnectionInput,
  handler: async (tx, ctx, input) => {
    const spec = PROVIDERS[input.provider]!
    const [existing] = await tx
      .select()
      .from(connection)
      .where(
        and(
          eq(connection.tenantId, ctx.tenant.id),
          eq(connection.provider, input.provider),
          eq(connection.accountAlias, input.accountAlias)
        )
      )
      .for("update")
      .limit(1)

    if (input.action === "connect") {
      if (existing && existing.state === "connected_demo") {
        return {
          result: { connectionId: existing.id, state: existing.state, unchanged: true, ...(await connectionOutputs(tx, ctx.tenant.id, input.provider, existing)) },
          events: [unchangedEvent(existing, input.action)],
        }
      }
      const row = existing
        ? (
            await tx
              .update(connection)
              .set({ state: "connected_demo", scopes: spec.scopes, updatedAt: new Date(), revision: sql`${connection.revision} + 1` })
              .where(eq(connection.id, existing.id))
              .returning()
          )[0]!
        : (
            await tx
              .insert(connection)
              .values({
                tenantId: ctx.tenant.id,
                provider: input.provider,
                category: spec.category,
                mode: "simulated",
                accountAlias: input.accountAlias,
                scopes: spec.scopes,
                state: "connected_demo",
                ownerUserId: ctx.user.id,
                lastSyncedAt: null,
              })
              .returning()
          )[0]!
      return {
        result: { connectionId: row.id, state: row.state, unchanged: false, ...(await connectionOutputs(tx, ctx.tenant.id, input.provider, row)) },
        events: [
          {
            eventType: "connection.connected_demo",
            aggregateType: "connection",
            aggregateId: row.id,
            aggregateRevision: row.revision,
            payload: { provider: input.provider, accountAlias: input.accountAlias, scopes: spec.scopes, simulation: true },
          },
        ],
      }
    }

    // The alias must exist for THIS provider: never fall through to another.
    if (!existing) throw new DomainError("not_found", "Connection not found", { field: "accountAlias", provider: input.provider })

    if (input.action === "test") {
      if (existing.state !== "connected_demo") {
        throw new DomainError("connection_revoked", "The simulated connection is not active", {
          rule: "connection_revoked",
          provider: existing.provider,
          accountAlias: existing.accountAlias,
          state: existing.state,
          blockedCapabilities: DEPENDENT_CAPABILITIES[existing.provider] ?? [],
        })
      }
      const diagnostic = await simulatedProvider.validateConnection(tx, ctx.tenant.id, existing.id)
      await tx.update(connection).set({ lastSyncedAt: new Date() }).where(eq(connection.id, existing.id))
      return {
        result: { connectionId: existing.id, state: existing.state, diagnostic, unchanged: true, ...(await connectionOutputs(tx, ctx.tenant.id, input.provider, existing)) },
        events: [
          {
            eventType: "connection.tested",
            aggregateType: "connection",
            aggregateId: existing.id,
            payload: diagnostic as unknown as Record<string, unknown>,
          },
        ],
      }
    }

    const nextState = input.action === "revoke" ? "revoked" : "connected_demo"
    if (existing.state === nextState) {
      return {
        result: { connectionId: existing.id, state: existing.state, unchanged: true, ...(await connectionOutputs(tx, ctx.tenant.id, input.provider, existing)) },
        events: [unchangedEvent(existing, input.action)],
      }
    }
    const [row] = await tx
      .update(connection)
      .set({ state: nextState, updatedAt: new Date(), revision: sql`${connection.revision} + 1` })
      .where(eq(connection.id, existing.id))
      .returning()
    return {
      result: { connectionId: row!.id, state: row!.state, unchanged: false, ...(await connectionOutputs(tx, ctx.tenant.id, input.provider, row!)) },
      events: [
        {
          eventType: input.action === "revoke" ? "connection.revoked" : "connection.restored",
          aggregateType: "connection",
          aggregateId: row!.id,
          aggregateRevision: row!.revision,
          payload: { provider: row!.provider, accountAlias: row!.accountAlias, blockedCapabilities: input.action === "revoke" ? DEPENDENT_CAPABILITIES[row!.provider] ?? [] : [] },
        },
      ],
    }
  },
})

export async function listConnections(ctx: AgencyContext) {
  return withTenant(ctx.tenant.id, (tx) =>
    tx.select().from(connection).where(eq(connection.tenantId, ctx.tenant.id)).orderBy(asc(connection.provider))
  )
}

/** Guard used by dependent capability handlers (e.g. campaign activation). */
export async function assertConnectionActive(ctx: AgencyContext, provider: string, accountAlias: string) {
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({ state: connection.state })
      .from(connection)
      .where(
        and(
          eq(connection.tenantId, ctx.tenant.id),
          eq(connection.provider, provider),
          eq(connection.accountAlias, accountAlias)
        )
      )
      .limit(1)
  )
  if (rows[0]?.state !== "connected_demo") {
    throw new DomainError("connection_revoked", "The simulated connection is not active", { provider, accountAlias })
  }
}
