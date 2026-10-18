import { eq, sql } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { agency, membership } from "@/server/db/schema"
import { DomainError } from "@/server/kernel/errors"

import { ctxFor, id, ownerDb } from "./helpers"

// QA helpers shared by the acceptance harness and the audit regressions.
// Everything here reads through the owner connection (bypasses RLS) so a
// test can observe side effects in any tenant, including forbidden ones.

/** Infrastructure tables a blocked run is allowed to touch. */
const SIDE_EFFECT_EXCLUDED = new Set([
  "workflow_run",
  "workflow_run_step",
  "app_session",
  "platform_audit_event",
  "__drizzle_migrations",
])

export type DbSnapshot = Map<string, { n: number; digest: string }>

/**
 * Row count + content digest of every public table (all tenants). Catches
 * inserts, deletes AND updates anywhere, which a per-table count would miss.
 */
export async function snapshotDb(): Promise<DbSnapshot> {
  const db = ownerDb()
  const tables = (await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`
  )) as unknown as { table_name: string }[]
  const names = tables.map((t) => t.table_name).filter((n) => !SIDE_EFFECT_EXCLUDED.has(n))
  if (!names.length) return new Map()
  const query = names
    .map(
      (n) =>
        `select '${n}' as t, count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as d from public."${n}" x`
    )
    .join(" union all ")
  const rows = (await db.execute(sql.raw(query))) as unknown as { t: string; n: number; d: string }[]
  return new Map(rows.map((r) => [r.t, { n: r.n, digest: r.d }]))
}

export function diffSnapshots(before: DbSnapshot, after: DbSnapshot): string[] {
  const changed: string[] = []
  for (const [t, a] of after) {
    const b = before.get(t)
    if (!b) changed.push(`${t}: new table (${a.n} rows)`)
    else if (b.n !== a.n) changed.push(`${t}: rows ${b.n} -> ${a.n}`)
    else if (b.digest !== a.digest) changed.push(`${t}: content changed (${a.n} rows)`)
  }
  for (const t of before.keys()) if (!after.has(t)) changed.push(`${t}: table dropped`)
  return changed
}

export async function eventCounts(): Promise<Map<string, number>> {
  const rows = (await ownerDb().execute(
    sql`select event_type, count(*)::int as n from business_event group by event_type`
  )) as unknown as { event_type: string; n: number }[]
  return new Map(rows.map((r) => [r.event_type, r.n]))
}

/** Context for any demo persona, whichever agency holds its membership. */
export async function ctxForActor(userKey: string): Promise<AgencyContext> {
  const rows = await ownerDb()
    .select({ slug: agency.slug })
    .from(membership)
    .innerJoin(agency, eq(agency.id, membership.tenantId))
    .where(eq(membership.userId, id(userKey)))
    .limit(1)
  return ctxFor(userKey, rows[0]?.slug ?? "rayo-de-sol")
}

/** Temporarily changes a persona's role (permission revocation fixture). */
export async function setMembershipRole(userKey: string, tenantKey: string, role: string) {
  await ownerDb()
    .update(membership)
    .set({ role })
    .where(sql`${membership.userId} = ${id(userKey)} and ${membership.tenantId} = ${id(tenantKey)}`)
}

export type Blocked = { code: string; message: string; details: Record<string, unknown>; thrown: boolean }

/** Normalizes "blocked" whether the runner returned it or threw before the run. */
export async function settleBlocked(p: Promise<{ state: string; error: Blocked | null } | unknown>): Promise<
  { ok: true; value: unknown } | { ok: false; error: Blocked }
> {
  try {
    const value = (await p) as { state?: string; error?: Omit<Blocked, "thrown"> | null }
    if (value && typeof value === "object" && "state" in value && value.state !== "succeeded" && value.error) {
      return { ok: false, error: { ...value.error, thrown: false } }
    }
    return { ok: true, value }
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: { code: e.code, message: e.message, details: e.details, thrown: true } }
    throw e
  }
}

export async function expectDomainError(p: Promise<unknown>, codes: string | string[]) {
  const allowed = Array.isArray(codes) ? codes : [codes]
  let caught: unknown = null
  try {
    await p
  } catch (e) {
    caught = e
  }
  if (!(caught instanceof DomainError)) {
    throw new Error(`expected DomainError(${allowed.join("|")}), got ${caught === null ? "success" : String(caught)}`)
  }
  if (!allowed.includes(caught.code)) {
    throw new Error(`expected DomainError(${allowed.join("|")}), got ${caught.code}: ${caught.message}`)
  }
  return caught
}

/** Promise whose resolution the test controls (barrier for race tests). */
export function barrier() {
  let release!: () => void
  const wait = new Promise<void>((r) => (release = r))
  return { wait, release }
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 5000, stepMs = 20): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, stepMs))
  }
}
