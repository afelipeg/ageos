import "server-only"

import { and, desc, eq } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { PROVIDERS } from "@/server/adapters/simulated-provider"
import { adapterOperation, appUser, businessEvent, connection } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

import { getCatalog, type CatalogEntry } from "./catalog"
import { isUuid, iso, userNames } from "./shared"

// Simulated connections: the provider catalog of the simulated adapter, the
// agency's persisted bindings and the workflows that list each kind of
// connector in their contract. "Connected · Demo" never means verified OAuth.

/** Contract connector names (catalog connectorOptions) served by each simulated provider. */
const CONNECTOR_NAMES: Record<string, string[]> = {
  meta_ads: ["meta-ads"],
  google_ads: ["google-ads"],
  tiktok_ads: ["tiktok-ads"],
  dv360_demo: ["google-ads", "amazon-ads"],
  demo_bank: ["wise", "stripe", "paypal"],
  demo_ledger: ["quickbooks", "xero", "alegra", "netsuite"],
}

export const PROVIDER_KEYS = Object.keys(PROVIDERS)

function dependentWorkflows(ctx: AgencyContext, provider: string): CatalogEntry[] {
  const names = new Set(CONNECTOR_NAMES[provider] ?? [])
  return getCatalog(ctx)
    .modules.flatMap((m) => m.capabilities)
    .filter((c) => c.connectorOptions.some((o) => names.has(o)))
}

export async function listConnectionsView(ctx: AgencyContext) {
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx.select({ c: connection, owner: appUser.displayName }).from(connection).leftJoin(appUser, eq(appUser.id, connection.ownerUserId)).where(eq(connection.tenantId, ctx.tenant.id)).orderBy(desc(connection.updatedAt))
  )
  const catalog = PROVIDER_KEYS.map((provider) => {
    const spec = PROVIDERS[provider]!
    const bound = rows.filter((r) => r.c.provider === provider)
    return {
      provider,
      category: spec.category,
      scopes: spec.scopes,
      capabilities: spec.capabilities,
      state: bound.some((b) => b.c.state === "connected_demo") ? "connected_demo" : bound.length ? bound[0]!.c.state : "not_configured",
      bindings: bound.length,
      workflows: dependentWorkflows(ctx, provider).map((w) => ({ skillId: w.skillId, label: w.label, href: w.href, status: w.status })),
    }
  })
  return {
    catalog,
    connections: rows.map((r) => ({
      id: r.c.id,
      provider: r.c.provider,
      category: r.c.category,
      mode: r.c.mode,
      accountAlias: r.c.accountAlias,
      scopes: r.c.scopes,
      state: r.c.state,
      owner: r.owner,
      lastSyncedAt: iso(r.c.lastSyncedAt),
      updatedAt: iso(r.c.updatedAt),
      revision: r.c.revision,
    })),
  }
}

export async function getConnectionView(ctx: AgencyContext, connectionId: string) {
  if (!isUuid(connectionId)) return null
  return withTenant(ctx.tenant.id, async (tx) => {
    const [c] = await tx.select().from(connection).where(and(eq(connection.tenantId, ctx.tenant.id), eq(connection.id, connectionId))).limit(1)
    if (!c) return null
    const names = await userNames(tx, [c.ownerUserId])
    const events = await tx
      .select({ id: businessEvent.id, eventType: businessEvent.eventType, origin: businessEvent.origin, recordedAt: businessEvent.recordedAt, payload: businessEvent.payload, actor: appUser.displayName })
      .from(businessEvent)
      .leftJoin(appUser, eq(appUser.id, businessEvent.actorUserId))
      .where(and(eq(businessEvent.tenantId, ctx.tenant.id), eq(businessEvent.aggregateId, c.id)))
      .orderBy(desc(businessEvent.seq))
      .limit(50)
    const operations = await tx
      .select()
      .from(adapterOperation)
      .where(and(eq(adapterOperation.tenantId, ctx.tenant.id), eq(adapterOperation.provider, c.provider), eq(adapterOperation.accountAlias, c.accountAlias)))
      .orderBy(desc(adapterOperation.createdAt))
      .limit(20)
    const spec = PROVIDERS[c.provider]
    const expected = spec?.scopes ?? []
    return {
      connection: {
        id: c.id,
        provider: c.provider,
        category: c.category,
        mode: c.mode,
        accountAlias: c.accountAlias,
        scopes: c.scopes,
        expectedScopes: expected,
        missingScopes: expected.filter((s) => !c.scopes.includes(s)),
        state: c.state,
        owner: c.ownerUserId ? (names.get(c.ownerUserId) ?? null) : null,
        lastSyncedAt: iso(c.lastSyncedAt),
        createdAt: iso(c.createdAt),
        revision: c.revision,
      },
      providerCapabilities: spec?.capabilities ?? [],
      workflows: dependentWorkflows(ctx, c.provider).map((w) => ({ skillId: w.skillId, label: w.label, href: w.href, status: w.status, availability: w.availability })),
      events: events.map((e) => ({ id: e.id, eventType: e.eventType, origin: e.origin, actor: e.actor, recordedAt: e.recordedAt.toISOString(), payload: e.payload as Record<string, unknown> })),
      operations: operations.map((o) => ({ id: o.id, operationType: o.operationType, state: o.state, receiptId: o.receiptId, attempts: o.attempts, createdAt: o.createdAt.toISOString() })),
    }
  })
}
