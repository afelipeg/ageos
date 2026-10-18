import "server-only"

import { sql } from "drizzle-orm"

import { db, type Tx } from "./client"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Runs `fn` inside a transaction whose RLS context is the given tenant.
 * `set_config(..., true)` is transaction-local, so a pooled connection never
 * keeps a tenant after commit/rollback. Callers must have already authorized
 * the actor for this tenant; RLS is defense in depth, not the only check.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  options?: { isolationLevel?: "read committed" | "repeatable read" | "serializable" }
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error("withTenant: invalid tenant id")
  return db().transaction(
    async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`)
      return fn(tx)
    },
    options?.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined
  )
}
