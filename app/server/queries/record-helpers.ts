import "server-only"

import { and, eq } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import type { CommandButton, CommandField } from "@/components/records/record-command"
import { client, job } from "@/server/db/schema"

// Shared shapes and helpers of the record-detail projections.

export type RecordField = {
  key: string
  /** i18n key under records.fields.* */
  labelKey: string
  value: string | number | null
  kind: "text" | "mono" | "money" | "date" | "timestamp" | "state" | "number"
  currency?: string
}

export type RecordLink = { labelKey: string; label: string; href: string }

export type RecordLines = {
  columns: { id: string; header: string; kind: "text" | "mono" | "money" | "date" | "number" | "state"; align?: "end"; labelPrefix?: string }[]
  rows: (Record<string, unknown> & { id: string })[]
}

export type RecordDetail = {
  type: string
  id: string
  title: string
  subtitle: string
  state: string | null
  revision: number | null
  synthetic: boolean
  fields: RecordField[]
  relations: RecordLink[]
  siblings: { id: string; label: string; state: string; current: boolean; href: string }[]
  lines: RecordLines | null
  events: { id: string; eventType: string; actor: string | null; origin: string; recordedAt: string; revision: number | null; commandType: string | null }[]
  files: { id: string; name: string; version: number; format: string; href: string }[]
  /** Workbench that owns changes to this record type. */
  owningSkill: { moduleKey: string; skillId: string } | null
  jobId: string | null
  /** Allowlisted record commands available on this record (server re-checks everything). */
  commands: RecordCommandSpec[]
  /** Evidence only: who submitted it (the submitter can never review it). */
  reviewer: { submittedBy: string | null } | null
}

export function f(key: string, value: RecordField["value"], kind: RecordField["kind"] = "text", currency?: string): RecordField {
  return { key, labelKey: `records.fields.${key}`, value, kind, currency }
}

export async function jobLink(tx: Tx, ctx: AgencyContext, jobId: string | null, tab?: string): Promise<RecordLink[]> {
  if (!jobId) return []
  const [j] = await tx
    .select({ id: job.id, name: job.name, ref: job.displayReference, clientId: job.clientId })
    .from(job)
    .where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, jobId)))
    .limit(1)
  if (!j) return []
  const [c] = await tx.select({ id: client.id, name: client.name }).from(client).where(and(eq(client.tenantId, ctx.tenant.id), eq(client.id, j.clientId))).limit(1)
  const base = `/a/${ctx.tenant.slug}`
  return [
    { labelKey: "records.links.job", label: `${j.ref} · ${j.name}`, href: `${base}/jobs/${j.id}${tab ? `?tab=${tab}` : ""}` },
    ...(c ? [{ labelKey: "records.links.client", label: c.name, href: `${base}/clients/${c.id}` }] : []),
  ]
}

export type RecordCommandSpec = {
  command: import("@/server/actions/ui/record-commands").RecordCommand
  titleKey: string
  helpKey: string
  fixed: Record<string, unknown>
  fields: CommandField[]
  buttons: CommandButton[]
}

export type Loaded = Omit<RecordDetail, "events" | "files" | "type" | "id" | "reviewer" | "commands"> & {
  eventIds?: string[]
  fileIds?: (string | null)[]
  reviewer?: RecordDetail["reviewer"]
  commands?: RecordCommandSpec[]
}

