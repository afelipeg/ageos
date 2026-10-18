import "server-only"

import { inArray } from "drizzle-orm"

import type { Tx } from "@/server/db/client"
import { appUser } from "@/server/db/schema"

// Small helpers shared by the read-only projections in server/queries.
// Projections never compute money: amounts are passed through as exact
// minor-unit strings next to their currency.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: string | null | undefined): v is string => typeof v === "string" && UUID_RE.test(v)

export async function userNames(tx: Tx, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => typeof v === "string"))]
  if (!unique.length) return new Map()
  const rows = await tx.select({ id: appUser.id, name: appUser.displayName }).from(appUser).where(inArray(appUser.id, unique))
  return new Map(rows.map((r) => [r.id, r.name]))
}

export const iso = (d: Date | string | null | undefined) => (d ? (typeof d === "string" ? d : d.toISOString()) : null)
export const minorStr = (v: bigint | number | string | null | undefined) => (v === null || v === undefined ? null : String(v))

/** Case-insensitive match of a free-text term against a row's string values. */
export function matchesTerm(row: Record<string, unknown>, term: string): boolean {
  if (!term) return true
  const t = term.toLowerCase()
  return Object.values(row).some((v) => typeof v === "string" && v.toLowerCase().includes(t))
}

/** Normalizes Next.js searchParams to single string values. */
export function flatParams(raw: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
}

export function positiveInt(v: string | undefined, fallback = 1, max = 1000): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback
}

/** Authorized page for an event aggregate, when one exists (never a guess). */
export function aggregateHref(slug: string, aggregateType: string, id: string | null): string | null {
  if (!id || !isUuid(id)) return null
  const base = `/a/${slug}`
  const map: Record<string, string> = {
    job: `${base}/jobs/${id}`,
    client: `${base}/clients/${id}`,
    connection: `${base}/connections/${id}`,
    file: `${base}/library/${id}`,
    approval: `${base}/approvals/${id}`,
    contract: `${base}/records/contract/${id}`,
    budget_revision: `${base}/records/budget-revision/${id}`,
    cost_estimate: `${base}/records/estimate/${id}`,
    timesheet: `${base}/records/timesheet/${id}`,
    media_plan_revision: `${base}/records/media-plan/${id}`,
    purchase_order: `${base}/records/purchase-order/${id}`,
    delivery: `${base}/records/delivery/${id}`,
    evidence: `${base}/records/evidence/${id}`,
    proposal: `${base}/records/proposal/${id}`,
    action_proposal: `${base}/records/proposal/${id}`,
    supplier: `${base}/records/supplier/${id}`,
    configuration_revision: `${base}/records/configuration-revision/${id}`,
  }
  return map[aggregateType] ?? null
}
