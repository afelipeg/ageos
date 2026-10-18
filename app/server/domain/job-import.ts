import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { parseCsv } from "@/lib/csv"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import { client, fileObject, idempotencyRecord, importProfile, importProfileRevision, job } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { defineCommand, executeCommand, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"
import { canSeeFile } from "@/server/queries/library"
import { privateDisk } from "@/server/storage/private-disk"

import { openOrCloseJob, OpenOrCloseJobInput } from "./jobs"

// Jobs desk "Apply valid rows" (rutas-y-pantallas: jobs.apply_valid_import).
// A CSV already stored through the private upload path is parsed with the
// delimiter of the agency's PUBLISHED jobs import profile revision and
// validated row by row (columns, required fields, client of this agency,
// duplicates in the file and against existing jobs). Applying opens every
// valid row through the job-lifecycle command handler (openOrCloseJob) inside
// ONE transaction with ONE idempotency key derived from file id + profile
// revision: a re-click or retry replays, a profile revision change (e.g. the
// ops delimiter fix) yields a new key. Invalid rows are reported, never applied.

export const JOB_IMPORT_PROFILE_KEY = "import_profile_jobs"
export const JOB_IMPORT_COLUMNS = ["client_code", "job_name", "job_type", "billing_code", "period"] as const
export const MAX_JOB_IMPORT_ROWS = 200

type Column = (typeof JOB_IMPORT_COLUMNS)[number]
const FIELD_COLUMN: Record<string, Column> = { client: "client_code", jobName: "job_name", jobType: "job_type", billingCode: "billing_code", period: "period" }

export type ImportReason = { code: string; field?: Column; expected?: number; actual?: number }
export type ImportRow = { row: number; cells: string[]; status: "valid" | "invalid"; reasons: ImportReason[] }
export type JobImportProfile = { id: string; key: string; revision: number; delimiter: string; expectedHeaders: string[] }
type OpenInput = z.infer<typeof OpenOrCloseJobInput>

export function jobImportKey(fileId: string, profileRevision: number): string {
  return `job-import:${fileId}:r${profileRevision}`
}

async function loadProfile(tx: Tx, ctx: AgencyContext): Promise<JobImportProfile | null> {
  const [p] = await tx
    .select()
    .from(importProfile)
    .where(and(eq(importProfile.tenantId, ctx.tenant.id), eq(importProfile.profileKey, JOB_IMPORT_PROFILE_KEY)))
    .limit(1)
  if (!p) return null
  // Only a revision present in the immutable history counts as published.
  const [r] = await tx
    .select()
    .from(importProfileRevision)
    .where(and(eq(importProfileRevision.tenantId, ctx.tenant.id), eq(importProfileRevision.profileId, p.id), eq(importProfileRevision.profileRevision, p.profileRevision)))
    .limit(1)
  if (!r) return null
  return { id: p.id, key: p.profileKey, revision: r.profileRevision, delimiter: r.delimiter, expectedHeaders: r.expectedHeaders }
}

/** Published jobs import profile of the agency (null when none is published). */
export async function getJobImportProfile(ctx: AgencyContext): Promise<JobImportProfile | null> {
  return withTenant(ctx.tenant.id, (tx) => loadProfile(tx, ctx))
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

async function validateImport(tx: Tx, ctx: AgencyContext, fileId: string) {
  if (!z.string().uuid().safeParse(fileId).success) throw new DomainError("not_found", "File not found", { field: "file" })
  const profile = await loadProfile(tx, ctx)
  if (!profile) throw new DomainError("blocked_by_rule", "No published jobs import profile for this agency", { rule: "import_profile_missing" })
  if (!JOB_IMPORT_COLUMNS.every((c) => profile.expectedHeaders.includes(c))) {
    throw new DomainError("blocked_by_rule", "The jobs import profile lacks required columns", { rule: "import_profile_incompatible" })
  }
  const [f] = await tx.select().from(fileObject).where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.id, fileId))).limit(1)
  if (!f || !canSeeFile(ctx, f.visibility)) throw new DomainError("not_found", "File not found", { field: "file" })
  if (f.format !== "csv") throw new DomainError("validation", "Only CSV files can be imported", { rule: "not_csv", field: "file" })

  const text = new TextDecoder("utf-8").decode(await privateDisk.get(ctx.tenant.id, f.storageKey))
  const parsed = parseCsv(text, profile.delimiter)
  const headers = parsed.headers.map((h) => h.trim())
  const headersMatch = headers.length === profile.expectedHeaders.length && headers.every((h, i) => h === profile.expectedHeaders[i])
  const fileErrors: string[] = []
  if (!headersMatch) fileErrors.push("header_mismatch")
  if (parsed.rows.length === 0) fileErrors.push("no_rows")
  if (parsed.rows.length > MAX_JOB_IMPORT_ROWS) fileErrors.push("too_many_rows")

  const col = (cells: string[], c: Column) => cells[headers.indexOf(c)] ?? ""
  const codes = headersMatch ? [...new Set(parsed.rows.map((r) => col(r.map((x) => x.trim()), "client_code").toUpperCase()).filter(Boolean))] : []
  const clients = codes.length
    ? await tx.select({ id: client.id, code: client.code, state: client.state }).from(client).where(and(eq(client.tenantId, ctx.tenant.id), inArray(client.code, codes)))
    : []
  const byCode = new Map(clients.map((c) => [c.code, c]))
  const existing = clients.length
    ? await tx
        .select({ clientId: job.clientId, name: job.name, period: job.period })
        .from(job)
        .where(and(eq(job.tenantId, ctx.tenant.id), inArray(job.clientId, clients.map((c) => c.id))))
    : []
  const existingKeys = new Set(existing.map((j) => `${j.clientId}|${norm(j.name)}|${j.period}`))
  const seen = new Set<string>()

  const rows: ImportRow[] = []
  const inputs = new Map<number, OpenInput>()
  parsed.rows.slice(0, MAX_JOB_IMPORT_ROWS).forEach((raw, i) => {
    const cells = raw.map((c) => c.trim())
    const reasons: ImportReason[] = []
    if (!headersMatch) reasons.push({ code: "header_mismatch" })
    else if (cells.length !== headers.length) reasons.push({ code: "column_count", expected: headers.length, actual: cells.length })
    else {
      for (const c of JOB_IMPORT_COLUMNS) if (!col(cells, c)) reasons.push({ code: "required", field: c })
      const code = col(cells, "client_code").toUpperCase()
      const c = code ? byCode.get(code) : undefined
      if (code && !c) reasons.push({ code: "client_not_found", field: "client_code" })
      if (c && c.state !== "active") reasons.push({ code: "client_archived", field: "client_code" })
      const candidate = {
        action: "open" as const,
        client: c?.id,
        jobName: col(cells, "job_name") || undefined,
        jobType: col(cells, "job_type").toUpperCase() || undefined,
        billingCode: col(cells, "billing_code").toUpperCase() || undefined,
        period: col(cells, "period") || undefined,
      }
      const check = OpenOrCloseJobInput.safeParse(candidate)
      if (!check.success) {
        for (const issue of check.error.issues) {
          const field = FIELD_COLUMN[String(issue.path[0])]
          if (!field || reasons.some((r) => r.field === field)) continue
          reasons.push({ code: "invalid", field })
        }
      }
      if (!reasons.length && check.success) {
        const k = `${c!.id}|${norm(candidate.jobName!)}|${candidate.period}`
        if (seen.has(k)) reasons.push({ code: "duplicate_in_file" })
        else if (existingKeys.has(k)) reasons.push({ code: "duplicate_existing" })
        seen.add(k)
        if (!reasons.length) inputs.set(i + 1, check.data)
      }
    }
    if (!reasons.length && fileErrors.length) reasons.push({ code: fileErrors[0]! })
    rows.push({ row: i + 1, cells: cells.slice(0, 12).map((x) => x.slice(0, 120)), status: reasons.length ? "invalid" : "valid", reasons })
  })
  if (fileErrors.length) inputs.clear()
  const detected = (f.extraction as { delimiter?: unknown } | null)?.delimiter
  return {
    file: { id: f.id, name: f.originalName, sha256: f.sha256, version: f.version, detectedDelimiter: typeof detected === "string" ? detected : null },
    profile,
    headers: headers.slice(0, 12),
    columnCount: headers.length,
    fileErrors,
    totalRows: parsed.rows.length,
    rows,
    validCount: inputs.size,
    invalidCount: parsed.rows.length - inputs.size,
    inputs,
  }
}

export const ApplyJobImportInput = z.object({ file: z.string().uuid(), profileRevision: z.number().int().min(1) }).strict()

export const applyValidJobImport = defineCommand({
  type: "jobs.applyValidImport",
  skillId: openOrCloseJob.skillId,
  permission: openOrCloseJob.permission,
  input: ApplyJobImportInput,
  handler: async (tx, ctx, input, meta) => {
    // Serializes job imports of this agency so two files with the same rows
    // cannot both pass the duplicate check.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`job-import:${ctx.tenant.id}`}))`)
    const v = await validateImport(tx, ctx, input.file)
    if (v.profile.revision !== input.profileRevision) {
      throw new DomainError("revision_conflict", "The jobs import profile changed; preview again", { rule: "import_profile_changed", currentRevision: v.profile.revision })
    }
    if (v.validCount === 0) {
      throw new DomainError("blocked_by_rule", "No valid rows to apply", { rule: "no_valid_rows", invalidCount: v.invalidCount, fileErrors: v.fileErrors })
    }
    const applied: { row: number; jobId: string; jobNumber: string; displayReference: string }[] = []
    const events: EmittedEvent[] = []
    for (const [row, rowInput] of v.inputs) {
      const r = await openOrCloseJob.handler(tx, ctx, rowInput, meta)
      if (r.result.action !== "open") throw new DomainError("internal", "Unexpected job command result")
      applied.push({ row, jobId: r.result.jobId, jobNumber: r.result.jobNumber, displayReference: r.result.displayReference })
      events.push(...r.events)
    }
    const summary = {
      fileId: v.file.id,
      fileSha256: v.file.sha256,
      profileId: v.profile.id,
      profileKey: v.profile.key,
      profileRevision: v.profile.revision,
      delimiter: v.profile.delimiter,
      appliedCount: applied.length,
      invalidCount: v.invalidCount,
      invalid: v.rows.filter((r) => r.status === "invalid").map((r) => ({ row: r.row, reasons: r.reasons })),
    }
    events.push({
      eventType: "jobs.import_applied",
      aggregateType: "file",
      aggregateId: v.file.id,
      aggregateRevision: v.file.version,
      payload: { ...summary, appliedJobIds: applied.map((a) => a.jobId) },
    })
    return { result: { ...summary, applied }, events }
  },
})

export type JobImportResult = Awaited<ReturnType<typeof applyValidJobImport.handler>>["result"]

/** Read-only preview: the same validation the apply command re-runs server-side. */
export async function previewJobImport(ctx: AgencyContext, fileId: string) {
  if (!ctx.permissions.has(applyValidJobImport.permission)) {
    throw new DomainError("forbidden", `Role ${ctx.role} cannot import jobs`, { permission: applyValidJobImport.permission })
  }
  if (!ctx.enabledCapabilities.has(applyValidJobImport.skillId!)) {
    throw new DomainError("capability_disabled", `${applyValidJobImport.skillId} is not enabled`, { skillId: applyValidJobImport.skillId })
  }
  return withTenant(ctx.tenant.id, async (tx) => {
    const v = await validateImport(tx, ctx, fileId)
    const idempotencyKey = jobImportKey(v.file.id, v.profile.revision)
    const [done] = await tx
      .select({ response: idempotencyRecord.response })
      .from(idempotencyRecord)
      .where(
        and(
          eq(idempotencyRecord.tenantId, ctx.tenant.id),
          eq(idempotencyRecord.commandType, applyValidJobImport.type),
          eq(idempotencyRecord.idempotencyKey, idempotencyKey),
          eq(idempotencyRecord.status, "completed")
        )
      )
      .limit(1)
    const applied = done ? ((done.response as { result: JobImportResult }).result ?? null) : null
    return {
      file: v.file,
      profile: v.profile,
      headers: v.headers,
      columnCount: v.columnCount,
      fileErrors: v.fileErrors,
      totalRows: v.totalRows,
      rows: v.rows,
      validCount: v.validCount,
      invalidCount: v.invalidCount,
      idempotencyKey,
      applied,
    }
  })
}

export type JobImportPreview = Awaited<ReturnType<typeof previewJobImport>>

/** Applies the valid rows with the key derived from file id + profile revision. */
export function applyJobImport(ctx: AgencyContext, fileId: string, profileRevision: number, origin: "ui" | "assistant_scripted" = "ui") {
  return executeCommand(ctx, applyValidJobImport, {
    idempotencyKey: jobImportKey(fileId, profileRevision),
    origin,
    payload: { file: fileId, profileRevision },
  })
}
