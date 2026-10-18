import "server-only"

import { and, eq, max, sql } from "drizzle-orm"

import { parseCsv } from "@/lib/csv"
import type { AgencyContext } from "@/server/auth/context"
import { businessEvent, fileObject, job } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { DomainError } from "@/server/kernel/errors"
import { libraryLimits, MAX_UPLOAD_BYTES, type FileFormat } from "@/server/queries/library"
import { isUuid } from "@/server/queries/shared"
import { privateDisk } from "@/server/storage/private-disk"

// Private upload: the server decides type and MIME from the extension AND the
// file signature (never from the browser's content-type), enforces size and
// demo quotas, hashes the bytes, stores them in private storage and records
// metadata + an audit event. Only CSV is analyzed here (real parse); other
// formats are stored and reported as not analyzed — Stored ≠ Analyzed.

const MIME: Record<FileFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
}

function includesAscii(bytes: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle)
  outer: for (let i = 0; i + n.length <= bytes.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer
    return true
  }
  return false
}

export function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file"
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim()
  return (clean || "file").slice(0, 200)
}

export type UploadCheck = { ok: true; format: FileFormat; mimeType: string } | { ok: false; code: "empty" | "too_large" | "unsupported_type" | "signature_mismatch" }

/** Validates size, extension and signature. Pure; exported for tests. */
export function checkUpload(name: string, bytes: Uint8Array): UploadCheck {
  if (bytes.byteLength === 0) return { ok: false, code: "empty" }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, code: "too_large" }
  const ext = name.toLowerCase().split(".").pop() ?? ""
  if (!["pdf", "docx", "xlsx", "csv"].includes(ext)) return { ok: false, code: "unsupported_type" }
  const format = ext as FileFormat
  const head = (n: number) => String.fromCharCode(...bytes.slice(0, n))
  if (format === "pdf" && head(5) !== "%PDF-") return { ok: false, code: "signature_mismatch" }
  if (format === "docx" || format === "xlsx") {
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
    const part = format === "docx" ? "word/" : "xl/"
    if (!zip || !includesAscii(bytes, "[Content_Types].xml") || !includesAscii(bytes, part)) return { ok: false, code: "signature_mismatch" }
  }
  if (format === "csv") {
    if (bytes.includes(0)) return { ok: false, code: "signature_mismatch" }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      return { ok: false, code: "signature_mismatch" }
    }
  }
  return { ok: true, format, mimeType: MIME[format] }
}

/** Real CSV analysis: delimiter, headers, row count, preview and formula-like cells. */
export function analyzeCsv(text: string) {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? ""
  const candidates = [",", ";", "\t", "|"]
  const delimiter = candidates.reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ",")
  const parsed = parseCsv(text, delimiter)
  const formulaCells = parsed.rows.reduce((n, r) => n + r.filter((c) => /^[=+\-@]/.test(c)).length, 0)
  return {
    analyzer: "csv-rfc4180@1",
    delimiter,
    headers: parsed.headers.slice(0, 50),
    columnCount: parsed.headers.length,
    rowCount: parsed.rows.length,
    preview: parsed.rows.slice(0, 5).map((r) => r.slice(0, 12).map((c) => c.slice(0, 120))),
    formulaLikeCells: formulaCells,
  }
}

export async function storeUpload(
  ctx: AgencyContext,
  input: { name: string; bytes: Uint8Array; jobId: string | null; logicalId: string | null }
): Promise<{ fileId: string; logicalId: string; version: number; sha256: string; extractionStatus: string }> {
  if (!ctx.permissions.has("files.write")) throw new DomainError("forbidden", "Your role cannot upload files", { permission: "files.write" })
  const name = sanitizeName(input.name)
  const check = checkUpload(name, input.bytes)
  if (!check.ok) throw new DomainError("validation", `Upload rejected: ${check.code}`, { rule: check.code, field: "file" })
  if (input.jobId !== null && !isUuid(input.jobId)) throw new DomainError("validation", "Invalid job", { field: "job" })
  if (input.logicalId !== null && !isUuid(input.logicalId)) throw new DomainError("validation", "Invalid document", { field: "logicalId" })

  // Pre-checks inside the tenant scope (job ownership, document, quotas).
  const plan = await withTenant(ctx.tenant.id, async (tx) => {
    if (input.jobId) {
      const [j] = await tx.select({ id: job.id }).from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, input.jobId))).limit(1)
      if (!j) throw new DomainError("not_found", "Job not found", { field: "job" })
    }
    let version = 1
    let logicalId = crypto.randomUUID()
    let jobId = input.jobId
    if (input.logicalId) {
      const [prev] = await tx
        .select({ v: max(fileObject.version), jobId: sql<string | null>`max(${fileObject.jobId}::text)` })
        .from(fileObject)
        .where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.logicalId, input.logicalId)))
      if (!prev?.v) throw new DomainError("not_found", "Document not found", { field: "logicalId" })
      version = prev.v + 1
      logicalId = input.logicalId
      jobId = jobId ?? prev.jobId
    }
    const limits = await libraryLimits(tx, ctx)
    if (limits.usedBytes + input.bytes.byteLength > limits.storageMb * 1024 * 1024) {
      throw new DomainError("blocked_by_rule", "Demo storage quota reached", { rule: "demo_storage_quota", storageMb: limits.storageMb })
    }
    if (jobId) {
      const [{ n }] = await tx.select({ n: sql<string>`count(*)` }).from(fileObject).where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.jobId, jobId)))
      if (Number(n) >= limits.filesPerJob) throw new DomainError("blocked_by_rule", "Demo files-per-job quota reached", { rule: "demo_files_per_job", filesPerJob: limits.filesPerJob })
    }
    return { version, logicalId, jobId }
  })

  const fileId = crypto.randomUUID()
  const stored = await privateDisk.put(ctx.tenant.id, fileId, input.bytes)
  let extractionStatus = "not_analyzed"
  let extraction: Record<string, unknown> = { reason: check.format === "pdf" ? "ocr_not_connected_in_demo" : "parser_not_connected_in_demo" }
  if (check.format === "csv") {
    extraction = analyzeCsv(new TextDecoder("utf-8").decode(input.bytes))
    extractionStatus = "analyzed"
  }
  await withTenant(ctx.tenant.id, async (tx) => {
    await tx.insert(fileObject).values({
      id: fileId,
      tenantId: ctx.tenant.id,
      logicalId: plan.logicalId,
      version: plan.version,
      jobId: plan.jobId,
      originalName: name,
      format: check.format,
      mimeType: check.mimeType,
      sizeBytes: stored.size,
      sha256: stored.sha256,
      storageKey: stored.storageKey,
      extractionStatus,
      extraction,
      synthetic: "uploaded",
      visibility: "private_agency",
      uploadedBy: ctx.user.id,
    })
    await tx.insert(businessEvent).values({
      tenantId: ctx.tenant.id,
      eventType: "file.uploaded",
      aggregateType: "file",
      aggregateId: fileId,
      aggregateRevision: plan.version,
      actorUserId: ctx.user.id,
      origin: "ui",
      jobId: plan.jobId,
      payload: { name, format: check.format, sizeBytes: stored.size, sha256: stored.sha256, version: plan.version, logicalId: plan.logicalId, extractionStatus },
    })
  })
  return { fileId, logicalId: plan.logicalId, version: plan.version, sha256: stored.sha256, extractionStatus }
}
