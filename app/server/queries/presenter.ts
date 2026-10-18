import "server-only"

import { desc, eq } from "drizzle-orm"

import { fixtureUuid } from "@/lib/fixture-ids"
import { simulationDirective } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

// Presenter read model: the simulated-outcome directives of the demo agency
// (pending ones are consumed by the next simulated ads operation).
export async function listSimulationDirectives(tenantFixtureKey = "tenant_demo_rayo") {
  const tenantId = fixtureUuid(tenantFixtureKey)
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.select().from(simulationDirective).where(eq(simulationDirective.tenantId, tenantId)).orderBy(desc(simulationDirective.createdAt)).limit(20)
    return rows.map((r) => ({ id: r.id, provider: r.provider, operationType: r.operationType, failureMode: r.failureMode, state: r.state, consumedByOperationId: r.consumedByOperationId, createdAt: r.createdAt.toISOString() }))
  })
}
