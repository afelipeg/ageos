import "server-only"

import { and, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import { client, contract, evidence, fileObject, job } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { invalidatePendingApprovals } from "@/server/kernel/approvals"
import { defineCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

// Evidence = one stored file version wrapped with kind, client/job link and a
// review by someone other than its submitter. Gates that rely on evidence
// (client authority, billing readiness) pin {evidence revision, file id,
// sha256, version} and re-verify the pin right before they take effect (B06).

const Uuid = z.string().uuid()

export const EVIDENCE_KINDS = ["client_po", "acceptance", "brief"] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

export type EvidencePin = {
  evidenceId: string
  evidenceRevision: number
  kind: string
  fileId: string
  fileSha256: string
  fileVersion: number
}

export type EvidenceCheck =
  | { ok: true; pin: EvidencePin; evidence: typeof evidence.$inferSelect }
  | { ok: false; rule: string; details: Record<string, unknown> }

type EvidenceRow = typeof evidence.$inferSelect
type FileRow = typeof fileObject.$inferSelect

async function loadFile(tx: Tx, tenantId: string, fileId: string | null): Promise<FileRow | null> {
  if (!fileId) return null
  const [f] = await tx
    .select()
    .from(fileObject)
    .where(and(eq(fileObject.tenantId, tenantId), eq(fileObject.id, fileId)))
    .limit(1)
  return f ?? null
}

async function newerVersionExists(tx: Tx, tenantId: string, f: FileRow) {
  const [n] = await tx
    .select({ id: fileObject.id })
    .from(fileObject)
    .where(and(eq(fileObject.tenantId, tenantId), eq(fileObject.logicalId, f.logicalId), gt(fileObject.version, f.version)))
    .limit(1)
  return Boolean(n)
}

/**
 * Resolves an evidence id inside the tenant only. A random UUID, a file id or
 * another agency's id resolves to nothing (RLS + tenant predicate).
 */
async function resolveEvidence(tx: Tx, tenantId: string, evidenceId: string): Promise<EvidenceRow | null> {
  const [row] = await tx
    .select()
    .from(evidence)
    .where(and(eq(evidence.tenantId, tenantId), eq(evidence.id, evidenceId)))
    .limit(1)
  return row ?? null
}

/** Full check of evidence for a gate; returns the pin to store in a payload. */
export async function checkEvidence(
  tx: Tx,
  tenantId: string,
  ref: string,
  expect: { kind: EvidenceKind; clientId: string; jobId: string }
): Promise<EvidenceCheck> {
  const ev = await resolveEvidence(tx, tenantId, ref)
  if (!ev) return { ok: false, rule: "evidence_not_found", details: { field: "evidence" } }
  if (ev.kind !== expect.kind) return { ok: false, rule: "evidence_kind_mismatch", details: { expected: expect.kind, actual: ev.kind } }
  if (ev.clientId !== expect.clientId) return { ok: false, rule: "evidence_client_mismatch", details: { evidenceId: ev.id } }
  if (ev.jobId !== null && ev.jobId !== expect.jobId) return { ok: false, rule: "evidence_job_mismatch", details: { evidenceId: ev.id } }
  if (ev.reviewState !== "reviewed") {
    return { ok: false, rule: "evidence_not_reviewed", details: { evidenceId: ev.id, reviewState: ev.reviewState } }
  }
  const f = await loadFile(tx, tenantId, ev.fileId)
  if (!f) return { ok: false, rule: "evidence_file_missing", details: { evidenceId: ev.id } }
  // A review recorded through reviewEvidence pins the reviewed file; a pinned
  // review no longer holds once the stored file differs. (Reviews without a
  // pin predate this check; the proposal pin below still protects them.)
  if (ev.reviewedFileSha256 !== null && (ev.reviewedFileSha256 !== f.sha256 || ev.reviewedFileVersion !== f.version)) {
    return { ok: false, rule: "evidence_changed_after_review", details: { evidenceId: ev.id } }
  }
  if (await newerVersionExists(tx, tenantId, f)) {
    return { ok: false, rule: "evidence_superseded", details: { evidenceId: ev.id, reviewedVersion: f.version } }
  }
  return {
    ok: true,
    evidence: ev,
    pin: { evidenceId: ev.id, evidenceRevision: ev.revision, kind: ev.kind, fileId: f.id, fileSha256: f.sha256, fileVersion: f.version },
  }
}

/** Re-verifies a stored pin: same evidence revision, file, hash and version. */
export async function verifyEvidencePin(
  tx: Tx,
  tenantId: string,
  pin: EvidencePin,
  expect: { clientId: string; jobId: string }
): Promise<{ ok: true } | { ok: false; rule: string; details: Record<string, unknown> }> {
  const now = await checkEvidence(tx, tenantId, pin.evidenceId, { kind: pin.kind as EvidenceKind, ...expect })
  if (!now.ok) return now
  const same =
    now.pin.evidenceRevision === pin.evidenceRevision &&
    now.pin.fileId === pin.fileId &&
    now.pin.fileSha256 === pin.fileSha256 &&
    now.pin.fileVersion === pin.fileVersion
  return same ? { ok: true } : { ok: false, rule: "evidence_changed", details: { evidenceId: pin.evidenceId } }
}

/**
 * Keeps evidence links in step with its document when the document is linked
 * to (or unlinked from) a job: evidence not yet reviewed follows the job and
 * its client. Reviewed evidence keeps the links it was reviewed with; if it
 * was reviewed without any link (a library document), the first link fills
 * them once — it is never moved to another job afterwards.
 */
export async function linkEvidenceToJob(tx: Tx, tenantId: string, fileLogicalId: string, target: { jobId: string; clientId: string } | null) {
  const files = await tx
    .select({ id: fileObject.id })
    .from(fileObject)
    .where(and(eq(fileObject.tenantId, tenantId), eq(fileObject.logicalId, fileLogicalId)))
  if (!files.length) return { linked: [] as string[] }
  const fileIds = files.map((f) => f.id)
  const now = new Date()
  const unreviewed = await tx
    .update(evidence)
    .set({ jobId: target?.jobId ?? null, clientId: target?.clientId ?? null, updatedAt: now })
    .where(and(eq(evidence.tenantId, tenantId), inArray(evidence.fileId, fileIds), ne(evidence.reviewState, "reviewed")))
    .returning({ id: evidence.id })
  const firstLink = target
    ? await tx
        .update(evidence)
        .set({ jobId: target.jobId, clientId: target.clientId, updatedAt: now })
        .where(and(eq(evidence.tenantId, tenantId), inArray(evidence.fileId, fileIds), eq(evidence.reviewState, "reviewed"), isNull(evidence.jobId), isNull(evidence.clientId)))
        .returning({ id: evidence.id })
    : []
  return { linked: [...unreviewed, ...firstLink].map((e) => e.id) }
}

// ── evidence.register ──
export const RegisterEvidenceInput = z
  .object({
    file: Uuid,
    kind: z.enum(EVIDENCE_KINDS),
    title: z.string().trim().min(3).max(160),
    client: Uuid.optional(),
    job: Uuid.optional(),
  })
  .strict()

export const registerEvidence = defineCommand({
  type: "evidence.register",
  skillId: null,
  permission: "files.write",
  input: RegisterEvidenceInput,
  handler: async (tx, ctx, input) => {
    const f = await loadFile(tx, ctx.tenant.id, input.file)
    if (!f) throw new DomainError("not_found", "File not found", { field: "file" })
    let clientId = input.client ?? null
    let jobId: string | null = null
    if (input.job) {
      const [j] = await tx.select().from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, input.job))).limit(1)
      if (!j) throw new DomainError("not_found", "Job not found", { field: "job" })
      if (clientId && clientId !== j.clientId) throw new DomainError("validation", "The job belongs to another client", { field: "client" })
      clientId = j.clientId
      jobId = j.id
    } else if (clientId) {
      const [c] = await tx.select({ id: client.id }).from(client).where(and(eq(client.tenantId, ctx.tenant.id), eq(client.id, clientId))).limit(1)
      if (!c) throw new DomainError("not_found", "Client not found", { field: "client" })
    }
    if (!clientId && input.kind !== "brief") {
      throw new DomainError("validation", "Client PO and acceptance evidence must link to a client or job", { field: "job" })
    }
    const [row] = await tx
      .insert(evidence)
      .values({
        tenantId: ctx.tenant.id,
        kind: input.kind,
        title: input.title,
        fileId: f.id,
        clientId,
        jobId,
        synthetic: f.synthetic !== "uploaded",
        reviewState: "received",
        submittedBy: ctx.user.id,
      })
      .returning()
    return {
      result: { evidenceId: row!.id, reviewState: row!.reviewState, fileId: f.id, fileVersion: f.version, fileSha256: f.sha256 },
      events: [
        {
          eventType: "evidence.registered",
          aggregateType: "evidence",
          aggregateId: row!.id,
          aggregateRevision: row!.revision,
          jobId,
          payload: { kind: input.kind, fileId: f.id, fileVersion: f.version, fileSha256: f.sha256, clientId, jobId },
        },
      ],
    }
  },
})

// ── evidence.review ── (owner / finance; never the submitter)
export const ReviewEvidenceInput = z
  .object({
    evidence: Uuid,
    decision: z.enum(["reviewed", "rejected"]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()

export const reviewEvidence = defineCommand({
  type: "evidence.review",
  skillId: null,
  permission: "approvals.decide",
  input: ReviewEvidenceInput,
  handler: async (tx, ctx, input) => {
    const [ev] = await tx
      .select()
      .from(evidence)
      .where(and(eq(evidence.tenantId, ctx.tenant.id), eq(evidence.id, input.evidence)))
      .for("update")
      .limit(1)
    if (!ev) throw new DomainError("not_found", "Evidence not found", { field: "evidence" })
    if (ev.submittedBy === ctx.user.id) {
      throw new DomainError("self_approval", "The person who submitted the evidence cannot review it")
    }
    const f = await loadFile(tx, ctx.tenant.id, ev.fileId)
    if (!f) throw new DomainError("blocked_by_rule", "The evidence has no stored file", { rule: "evidence_file_missing" })
    if (await newerVersionExists(tx, ctx.tenant.id, f)) {
      throw new DomainError("blocked_by_rule", "A newer version of this document exists; register it before review", {
        rule: "evidence_superseded",
      })
    }
    const [row] = await tx
      .update(evidence)
      .set({
        reviewState: input.decision,
        reviewedBy: ctx.user.id,
        reviewedAt: new Date(),
        reviewedFileSha256: f.sha256,
        reviewedFileVersion: f.version,
        reviewReason: input.reason,
        updatedAt: new Date(),
        revision: ev.revision + 1,
      })
      .where(eq(evidence.id, ev.id))
      .returning()
    // A review change invalidates pending client-authority approvals that
    // pinned the previous evidence revision.
    const dependents = await tx
      .select({ id: contract.id })
      .from(contract)
      .where(and(eq(contract.tenantId, ctx.tenant.id), eq(contract.evidenceId, ev.id), eq(contract.state, "submitted")))
    let staleApprovals = 0
    for (const c of dependents) staleApprovals += await invalidatePendingApprovals(tx, ctx.tenant.id, "contract", c.id)
    return {
      result: {
        evidenceId: ev.id,
        reviewState: row!.reviewState,
        revision: row!.revision,
        fileSha256: f.sha256,
        fileVersion: f.version,
        staleApprovals,
      },
      events: [
        {
          eventType: input.decision === "reviewed" ? "evidence.reviewed" : "evidence.rejected",
          aggregateType: "evidence",
          aggregateId: ev.id,
          aggregateRevision: row!.revision,
          jobId: ev.jobId,
          payload: { kind: ev.kind, fileId: f.id, fileSha256: f.sha256, fileVersion: f.version, reason: input.reason, staleApprovals },
        },
      ],
    }
  },
})

// ── Queries (screens, assistant) ──
export async function listEvidence(ctx: AgencyContext, filter: { job?: string; client?: string } = {}) {
  if (!ctx.permissions.has("files.read")) throw new DomainError("forbidden", "Your role cannot read evidence", { permission: "files.read" })
  return withTenant(ctx.tenant.id, async (tx) => {
    const conds = [eq(evidence.tenantId, ctx.tenant.id)]
    if (filter.job && Uuid.safeParse(filter.job).success) {
      const [j] = await tx.select({ clientId: job.clientId }).from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, filter.job))).limit(1)
      if (!j) return []
      conds.push(or(eq(evidence.jobId, filter.job), and(eq(evidence.clientId, j.clientId), inArray(evidence.kind, ["client_po"])))!)
    } else if (filter.client && Uuid.safeParse(filter.client).success) {
      conds.push(eq(evidence.clientId, filter.client))
    }
    const rows = await tx
      .select({ ev: evidence, file: fileObject })
      .from(evidence)
      .leftJoin(fileObject, and(eq(fileObject.tenantId, evidence.tenantId), eq(fileObject.id, evidence.fileId)))
      .where(and(...conds))
      .orderBy(desc(evidence.createdAt))
    return rows.map(({ ev, file }) => ({
      id: ev.id,
      kind: ev.kind,
      title: ev.title,
      reviewState: ev.reviewState,
      revision: ev.revision,
      clientId: ev.clientId,
      jobId: ev.jobId,
      submittedBy: ev.submittedBy,
      reviewedBy: ev.reviewedBy,
      reviewedAt: ev.reviewedAt?.toISOString() ?? null,
      file: file ? { id: file.id, name: file.originalName, version: file.version, sha256: file.sha256 } : null,
      // Reviewed hash differs from the stored file: the review no longer holds.
      reviewCurrent: ev.reviewState === "reviewed" && !!file && ev.reviewedFileSha256 === file.sha256 && ev.reviewedFileVersion === file.version,
    }))
  })
}
