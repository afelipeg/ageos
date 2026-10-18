import "server-only"

import { createHash } from "node:crypto"

import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm"
import { z } from "zod"

import { parseCsv } from "@/lib/csv"
import { DEMO_SEED_VERSION } from "@/lib/demo"
import { fixtureUuid } from "@/lib/fixture-ids"
import type { PlatformRole } from "@/lib/policy"
import { auditPlatform, isPlatformSession, type SessionInfo } from "@/server/auth/session"
import { db, type Tx } from "@/server/db/client"
import {
  agency,
  appUser,
  fileObject,
  importProfile,
  importProfileRevision,
  platformAuditEvent,
  platformChange,
  platformIncident,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { digestOf } from "@/server/kernel/approvals"
import { DomainError } from "@/server/kernel/errors"
import { privateDisk } from "@/server/storage/private-disk"

// Platform operations (/ops): the mandatory local circuit for
// ops_csv_delimiter_mismatch. A platform operator investigates with the REAL
// CSV parser and proposes one typed change (the delimiter of one allowlisted
// demo import profile); a different platform admin approves that exact
// payload/profile/revision; the server applies it, re-parses the SAME bytes
// and resolves the incident with before/after evidence and audit. It never
// imports orders, moves money, edits global configuration, opens a PR or calls
// an external system. Agency identities never hold these roles.

export const PLATFORM_COMMAND_TYPE = "updateAllowlistedDemoImportDelimiter"
export const ALLOWED_DELIMITERS = [",", ";", "\t", "|"] as const
export type AllowedDelimiter = (typeof ALLOWED_DELIMITERS)[number]

/** The only profiles the platform change may touch: demo tenant + profile key. */
export const ALLOWLISTED_DEMO_PROFILES = [
  { tenantId: fixtureUuid("tenant_demo_rayo"), profileKey: "import_profile_demo_media_orders" },
] as const

export const INCIDENT_STATES = ["detected", "investigating", "proposed", "awaiting_approval", "approved", "applying", "verifying", "resolved"] as const
export type IncidentState = (typeof INCIDENT_STATES)[number]

function assertPlatform(session: SessionInfo, roles: readonly PlatformRole[] = ["platform_operator", "platform_admin"]): PlatformRole {
  if (!isPlatformSession(session)) throw new DomainError("forbidden", "Platform operations require a platform identity")
  const role = session.user.platformRole as PlatformRole
  if (!roles.includes(role)) throw new DomainError("forbidden", `Role ${role} cannot perform this platform action`, { roles })
  return role
}

const isAllowlisted = (tenantId: string, profileKey: string) =>
  ALLOWLISTED_DEMO_PROFILES.some((p) => p.tenantId === tenantId && p.profileKey === profileKey)

/** Demo tenants only (minimal data per agency). */
async function demoTenants() {
  return db()
    .select({ id: agency.id, slug: agency.slug, name: agency.name, status: agency.status })
    .from(agency)
    .where(like(agency.demoSeedVersion, `${DEMO_SEED_VERSION}%`))
    .orderBy(asc(agency.slug))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function locate(table: typeof platformIncident | typeof platformChange, id: string) {
  if (!UUID.test(id)) return null
  for (const t of await demoTenants()) {
    const rows = await withTenant(t.id, (tx) => tx.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1))
    if (rows[0]) return t
  }
  return null
}

async function audit(tx: Tx, actor: string, tenantId: string, eventType: string, payload: Record<string, unknown>) {
  await auditPlatform({ eventType, actorUserId: actor, tenantId, payload }, tx)
}

async function transition(tx: Tx, actor: string, incident: typeof platformIncident.$inferSelect, to: IncidentState, extra: Record<string, unknown> = {}, set: Partial<typeof platformIncident.$inferInsert> = {}) {
  await tx
    .update(platformIncident)
    .set({ ...set, state: to, updatedAt: new Date(), revision: sql`${platformIncident.revision} + 1` })
    .where(eq(platformIncident.id, incident.id))
  await audit(tx, actor, incident.tenantId, "ops.incident.transition", { incidentId: incident.id, incidentKey: incident.incidentKey, from: incident.state, to, ...extra })
  incident.state = to
}

// ── Evidence with the real parser ──

type ParseEvidence = {
  parser: "lib/csv.parseCsv"
  delimiter: string
  observedColumns: number
  observedHeaders: string[]
  dataRows: number
  matchesExpected: boolean
}

function parseEvidence(bytes: Uint8Array, delimiter: string, expected: readonly string[]): ParseEvidence {
  const parsed = parseCsv(new TextDecoder().decode(bytes), delimiter)
  const matches =
    parsed.headers.length === expected.length &&
    parsed.headers.every((h, i) => h.trim() === expected[i]) &&
    parsed.rows.every((r) => r.length === expected.length)
  return {
    parser: "lib/csv.parseCsv",
    delimiter,
    observedColumns: parsed.headers.length,
    observedHeaders: parsed.headers,
    dataRows: parsed.rows.length,
    matchesExpected: matches,
  }
}

async function loadFile(tx: Tx, tenantId: string, fileId: string | null) {
  if (!fileId) throw new DomainError("not_found", "Incident file not found")
  const [f] = await tx.select().from(fileObject).where(and(eq(fileObject.tenantId, tenantId), eq(fileObject.id, fileId))).limit(1)
  if (!f) throw new DomainError("not_found", "Incident file not found")
  const bytes = await privateDisk.get(tenantId, f.storageKey)
  return { file: f, bytes, sha256: createHash("sha256").update(bytes).digest("hex") }
}

// ── Queries ──

export type OpsOverview = {
  tenants: { slug: string; name: string; status: string; openIncidents: number }[]
  incidents: { id: string; incidentKey: string; state: string; title: { en: string; es: string }; tenant: { slug: string; name: string }; updatedAt: string; synthetic: true }[]
}

/** /ops home: demo tenants (minimal data) and their platform incidents. */
export async function listIncidents(session: SessionInfo): Promise<OpsOverview> {
  assertPlatform(session)
  const out: OpsOverview = { tenants: [], incidents: [] }
  for (const t of await demoTenants()) {
    const rows = await withTenant(t.id, (tx) => tx.select().from(platformIncident).orderBy(desc(platformIncident.updatedAt)))
    out.tenants.push({ slug: t.slug, name: t.name, status: t.status, openIncidents: rows.filter((r) => r.state !== "resolved").length })
    for (const r of rows) {
      out.incidents.push({ id: r.id, incidentKey: r.incidentKey, state: r.state, title: r.title as { en: string; es: string }, tenant: { slug: t.slug, name: t.name }, updatedAt: r.updatedAt.toISOString(), synthetic: true })
    }
  }
  return out
}

export type ChangeView = {
  id: string
  commandType: string
  state: string
  payload: { profile_id: string; expected_revision: number; delimiter: string; reason: string }
  payloadDigest: string
  targetProfileRevision: number
  requestedBy: { id: string; name: string }
  approvedBy: { id: string; name: string } | null
  approvedAt: string | null
  appliedAt: string | null
  decisionReason: string | null
  diff: Record<string, unknown> | null
  verification: Record<string, unknown> | null
  createdAt: string
}

export type IncidentView = {
  id: string
  incidentKey: string
  state: string
  title: { en: string; es: string }
  synthetic: true
  tenant: { slug: string; name: string }
  file: { id: string; name: string; sha256: string; sizeBytes: number; sameBytesAsDetected: boolean }
  profile: { id: string; profileKey: string; delimiter: string; profileRevision: number; expectedHeaders: string[]; allowlisted: boolean }
  /** Live result of the real parser with the profile's CURRENT delimiter. */
  current: ParseEvidence
  /** Evidence persisted at detection/investigation (incl. deterministic diagnosis). */
  evidence: Record<string, unknown>
  resolution: Record<string, unknown> | null
  lastError: string | null
  changes: ChangeView[]
  profileRevisions: { revision: number; delimiter: string; changeId: string | null; diff: Record<string, unknown>; createdAt: string }[]
  audit: { seq: number; eventType: string; actor: string | null; payload: Record<string, unknown>; recordedAt: string }[]
}

async function namesOf(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter(Boolean) as string[])]
  if (!unique.length) return new Map<string, string>()
  const rows = await db().select({ id: appUser.id, name: appUser.displayName }).from(appUser).where(inArray(appUser.id, unique))
  return new Map(rows.map((r) => [r.id, r.name]))
}

function changeView(c: typeof platformChange.$inferSelect, names: Map<string, string>): ChangeView {
  return {
    id: c.id,
    commandType: c.commandType,
    state: c.state,
    payload: c.payload as ChangeView["payload"],
    payloadDigest: c.payloadDigest,
    targetProfileRevision: c.targetProfileRevision,
    requestedBy: { id: c.requestedBy, name: names.get(c.requestedBy) ?? "" },
    approvedBy: c.approvedBy ? { id: c.approvedBy, name: names.get(c.approvedBy) ?? "" } : null,
    approvedAt: c.approvedAt?.toISOString() ?? null,
    appliedAt: c.appliedAt?.toISOString() ?? null,
    decisionReason: c.decisionReason,
    diff: (c.diff ?? null) as Record<string, unknown> | null,
    verification: (c.verification ?? null) as Record<string, unknown> | null,
    createdAt: c.createdAt.toISOString(),
  }
}

/** /ops/incidents/:id — evidence (file sha256, profile revision, expected headers, live parse), changes, history, audit. */
export async function getIncident(session: SessionInfo, incidentId: string): Promise<IncidentView> {
  assertPlatform(session)
  const t = await locate(platformIncident, incidentId)
  if (!t) throw new DomainError("not_found", "Incident not found")
  const data = await withTenant(t.id, async (tx) => {
    const [inc] = await tx.select().from(platformIncident).where(eq(platformIncident.id, incidentId)).limit(1)
    const [profile] = await tx.select().from(importProfile).where(eq(importProfile.id, inc!.profileId)).limit(1)
    const { file, bytes, sha256 } = await loadFile(tx, t.id, inc!.fileId)
    const changes = await tx.select().from(platformChange).where(eq(platformChange.incidentId, incidentId)).orderBy(asc(platformChange.createdAt))
    const revisions = await tx.select().from(importProfileRevision).where(eq(importProfileRevision.profileId, profile!.id)).orderBy(asc(importProfileRevision.profileRevision))
    return { inc: inc!, profile: profile!, file, bytes, sha256, changes, revisions }
  })
  const auditRows = await db()
    .select()
    .from(platformAuditEvent)
    .where(and(eq(platformAuditEvent.tenantId, t.id), sql`${platformAuditEvent.payload}->>'incidentId' = ${incidentId}`))
    .orderBy(asc(platformAuditEvent.seq))
  const names = await namesOf([...data.changes.flatMap((c) => [c.requestedBy, c.approvedBy]), ...auditRows.map((a) => a.actorUserId)])
  const evidence = data.inc.evidence as Record<string, unknown>
  return {
    id: data.inc.id,
    incidentKey: data.inc.incidentKey,
    state: data.inc.state,
    title: data.inc.title as { en: string; es: string },
    synthetic: true,
    tenant: { slug: t.slug, name: t.name },
    file: { id: data.file.id, name: data.file.originalName, sha256: data.sha256, sizeBytes: data.file.sizeBytes, sameBytesAsDetected: evidence.fileSha256 === data.sha256 },
    profile: {
      id: data.profile.id,
      profileKey: data.profile.profileKey,
      delimiter: data.profile.delimiter,
      profileRevision: data.profile.profileRevision,
      expectedHeaders: data.profile.expectedHeaders,
      allowlisted: isAllowlisted(t.id, data.profile.profileKey),
    },
    current: parseEvidence(data.bytes, data.profile.delimiter, data.profile.expectedHeaders),
    evidence,
    resolution: (data.inc.resolution ?? null) as Record<string, unknown> | null,
    lastError: data.inc.lastError,
    changes: data.changes.map((c) => changeView(c, names)),
    profileRevisions: data.revisions.map((r) => ({ revision: r.profileRevision, delimiter: r.delimiter, changeId: r.changeId, diff: r.diff as Record<string, unknown>, createdAt: r.createdAt.toISOString() })),
    audit: auditRows.map((a) => ({ seq: a.seq, eventType: a.eventType, actor: a.actorUserId ? (names.get(a.actorUserId) ?? null) : null, payload: a.payload as Record<string, unknown>, recordedAt: a.recordedAt.toISOString() })),
  }
}

/** /ops/changes/:id — the reviewable change (payload, digest, approval, verification). */
export async function getPlatformChange(session: SessionInfo, changeId: string): Promise<ChangeView & { incidentId: string; tenant: { slug: string; name: string }; canDecide: boolean; canApply: boolean; canVerify: boolean }> {
  const role = assertPlatform(session)
  const t = await locate(platformChange, changeId)
  if (!t) throw new DomainError("not_found", "Change not found")
  const [c] = await withTenant(t.id, (tx) => tx.select().from(platformChange).where(eq(platformChange.id, changeId)).limit(1))
  const names = await namesOf([c!.requestedBy, c!.approvedBy])
  return {
    ...changeView(c!, names),
    incidentId: c!.incidentId,
    tenant: { slug: t.slug, name: t.name },
    canDecide: c!.state === "awaiting_approval" && role === "platform_admin" && c!.requestedBy !== session.user.id,
    canApply: c!.state === "approved",
    canVerify: c!.state === "applied",
  }
}

// ── Investigate ──

/**
 * detected → investigating. Re-runs the real parser on the stored bytes with
 * the profile's delimiter and every allowed delimiter; the diagnosis is a
 * deterministic rule (the allowed delimiter whose headers equal the expected
 * schema), shown for the operator to review — nothing is changed.
 */
export async function investigate(session: SessionInfo, incidentId: string) {
  assertPlatform(session)
  const t = await locate(platformIncident, incidentId)
  if (!t) throw new DomainError("not_found", "Incident not found")
  return withTenant(t.id, async (tx) => {
    const [inc] = await tx.select().from(platformIncident).where(eq(platformIncident.id, incidentId)).for("update").limit(1)
    if (inc!.state !== "detected" && inc!.state !== "investigating") {
      throw new DomainError("blocked_by_rule", "The incident is past investigation", { rule: "incident_not_investigable", state: inc!.state })
    }
    const [profile] = await tx.select().from(importProfile).where(eq(importProfile.id, inc!.profileId)).limit(1)
    const { file, bytes, sha256 } = await loadFile(tx, t.id, inc!.fileId)
    const current = parseEvidence(bytes, profile!.delimiter, profile!.expectedHeaders)
    const candidates = ALLOWED_DELIMITERS.map((d) => {
      const e = parseEvidence(bytes, d, profile!.expectedHeaders)
      return { delimiter: d, columns: e.observedColumns, dataRows: e.dataRows, matchesExpected: e.matchesExpected }
    })
    const match = candidates.filter((c) => c.matchesExpected)
    const evidence = {
      ...(inc!.evidence as object),
      fileName: file.originalName,
      fileSha256: sha256,
      profileRevision: profile!.profileRevision,
      delimiter: profile!.delimiter,
      expectedHeaders: profile!.expectedHeaders,
      expectedColumns: profile!.expectedHeaders.length,
      observedColumns: current.observedColumns,
      observedHeaders: current.observedHeaders,
      diagnosis: {
        rule: "recognized_format:single_allowed_delimiter_matches_schema",
        candidates,
        recommendedDelimiter: match.length === 1 ? match[0]!.delimiter : null,
      },
      investigatedBy: session.user.id,
    }
    const from = inc!.state
    await tx.update(platformIncident).set({ evidence, updatedAt: new Date(), revision: sql`${platformIncident.revision} + 1` }).where(eq(platformIncident.id, incidentId))
    if (from === "detected") await transition(tx, session.user.id, inc!, "investigating")
    return { incidentId, state: "investigating" as const, evidence }
  })
}

// ── Propose ──

export const ProposeDelimiterChangeInput = z
  .object({
    incidentId: z.string().uuid(),
    delimiter: z.enum(ALLOWED_DELIMITERS),
    expectedProfileRevision: z.number().int().positive(),
    reason: z.string().trim().min(3).max(300),
    idempotencyKey: z.string().min(8).max(200).regex(/^[A-Za-z0-9_.:-]+$/),
  })
  .strict()

function changeDigestOf(tenantId: string, profileUuid: string, payload: ChangeView["payload"]) {
  return digestOf({ commandType: PLATFORM_COMMAND_TYPE, tenantId, profileUuid, payload })
}

/**
 * Operator only. Prepares the typed change `delimiter` of the allowlisted demo
 * profile, bound to its current revision → awaiting_approval. Idempotent on
 * `idempotencyKey` (same payload replays; a different payload conflicts).
 */
export async function proposeDelimiterChange(session: SessionInfo, input: z.input<typeof ProposeDelimiterChangeInput>) {
  assertPlatform(session, ["platform_operator"])
  const parsed = ProposeDelimiterChangeInput.safeParse(input)
  if (!parsed.success) {
    throw new DomainError("validation", "Invalid platform change", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) })
  }
  const p = parsed.data
  const t = await locate(platformIncident, p.incidentId)
  if (!t) throw new DomainError("not_found", "Incident not found")
  return withTenant(t.id, async (tx) => {
    const [inc] = await tx.select().from(platformIncident).where(eq(platformIncident.id, p.incidentId)).for("update").limit(1)
    const [profile] = await tx.select().from(importProfile).where(eq(importProfile.id, inc!.profileId)).for("update").limit(1)
    const payload = { profile_id: profile!.profileKey, expected_revision: p.expectedProfileRevision, delimiter: p.delimiter, reason: p.reason }
    const digest = changeDigestOf(t.id, profile!.id, payload)
    const [prior] = await tx.select().from(platformChange).where(and(eq(platformChange.tenantId, t.id), eq(platformChange.proposalKey, p.idempotencyKey))).limit(1)
    if (prior) {
      if (prior.payloadDigest !== digest || prior.incidentId !== inc!.id) {
        throw new DomainError("idempotency_conflict", "The idempotency key was already used with a different payload")
      }
      return { changeId: prior.id, state: prior.state, payloadDigest: prior.payloadDigest, payload, replayed: true }
    }
    if (!isAllowlisted(t.id, profile!.profileKey)) {
      throw new DomainError("blocked_by_rule", "Only the allowlisted demo import profile can be changed", { rule: "profile_not_allowlisted", profileKey: profile!.profileKey })
    }
    if (inc!.state !== "investigating") {
      throw new DomainError("blocked_by_rule", "Investigate the incident before proposing a change", { rule: "incident_not_investigating", state: inc!.state })
    }
    if (profile!.profileRevision !== p.expectedProfileRevision) {
      throw new DomainError("revision_conflict", "The import profile changed", { aggregate: "import_profile", expectedRevision: p.expectedProfileRevision, currentRevision: profile!.profileRevision })
    }
    if (profile!.delimiter === p.delimiter) {
      throw new DomainError("validation", "The delimiter is already set", { issues: [{ path: "delimiter", message: "no_change" }] })
    }
    const [c] = await tx
      .insert(platformChange)
      .values({
        tenantId: t.id,
        incidentId: inc!.id,
        commandType: PLATFORM_COMMAND_TYPE,
        payload,
        payloadDigest: digest,
        targetProfileRevision: profile!.profileRevision,
        state: "awaiting_approval",
        requestedBy: session.user.id,
        proposalKey: p.idempotencyKey,
      })
      .returning()
    await transition(tx, session.user.id, inc!, "proposed", { changeId: c!.id, payloadDigest: digest })
    await transition(tx, session.user.id, inc!, "awaiting_approval", { changeId: c!.id })
    return { changeId: c!.id, state: c!.state, payloadDigest: digest, payload, replayed: false }
  })
}

// ── Decide ──

export const DecidePlatformChangeInput = z
  .object({
    changeId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    reviewedDigest: z.string().regex(/^[0-9a-f]{64}$/),
    reason: z.string().trim().max(300).optional().nullable(),
  })
  .strict()

async function freshness(tx: Tx, c: typeof platformChange.$inferSelect) {
  const [profile] = await tx.select().from(importProfile).where(and(eq(importProfile.tenantId, c.tenantId), eq(importProfile.profileKey, (c.payload as ChangeView["payload"]).profile_id))).for("update").limit(1)
  const fresh =
    !!profile &&
    isAllowlisted(c.tenantId, profile.profileKey) &&
    profile.profileRevision === c.targetProfileRevision &&
    changeDigestOf(c.tenantId, profile.id, c.payload as ChangeView["payload"]) === c.payloadDigest
  return { profile, fresh }
}

async function markStale(tx: Tx, actor: string, c: typeof platformChange.$inferSelect) {
  await tx.update(platformChange).set({ state: "stale", revision: sql`${platformChange.revision} + 1` }).where(eq(platformChange.id, c.id))
  const [inc] = await tx.select().from(platformIncident).where(eq(platformIncident.id, c.incidentId)).limit(1)
  if (inc && inc.state !== "resolved") await transition(tx, actor, inc, "investigating", { changeId: c.id, reason: "stale_revision" }, { lastError: "change_stale" })
}

/**
 * Admin only, never the requester. Binds the exact payload digest and the
 * profile revision; if the profile moved on, the change becomes `stale`
 * (persisted, returned as outcome "stale"). Reject keeps the incident open.
 */
export async function decidePlatformChange(session: SessionInfo, input: z.input<typeof DecidePlatformChangeInput>) {
  assertPlatform(session)
  const parsed = DecidePlatformChangeInput.safeParse(input)
  if (!parsed.success) throw new DomainError("validation", "Invalid decision", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) })
  const p = parsed.data
  const t = await locate(platformChange, p.changeId)
  if (!t) throw new DomainError("not_found", "Change not found")
  return withTenant(t.id, async (tx) => {
    const [c] = await tx.select().from(platformChange).where(eq(platformChange.id, p.changeId)).for("update").limit(1)
    if (c!.state !== "awaiting_approval") throw new DomainError("blocked_by_rule", "This change is no longer pending", { rule: "not_pending", state: c!.state })
    if (c!.requestedBy === session.user.id) throw new DomainError("self_approval", "The requester cannot approve their own change")
    if (session.user.platformRole !== "platform_admin") {
      throw new DomainError("approver_not_eligible", "Only a platform admin can decide platform changes", { eligibleRoles: ["platform_admin"] })
    }
    const { fresh } = await freshness(tx, c!)
    if (!fresh || p.reviewedDigest !== c!.payloadDigest) {
      await markStale(tx, session.user.id, c!)
      return { changeId: c!.id, outcome: "stale" as const }
    }
    const [inc] = await tx.select().from(platformIncident).where(eq(platformIncident.id, c!.incidentId)).for("update").limit(1)
    if (p.decision === "reject") {
      if (!p.reason?.trim()) throw new DomainError("validation", "A reason is required", { field: "reason" })
      await tx.update(platformChange).set({ state: "rejected", decisionReason: p.reason, revision: sql`${platformChange.revision} + 1` }).where(eq(platformChange.id, c!.id))
      await transition(tx, session.user.id, inc!, "investigating", { changeId: c!.id, decision: "reject" })
      return { changeId: c!.id, outcome: "rejected" as const }
    }
    const now = new Date()
    await tx
      .update(platformChange)
      .set({ state: "approved", approvedBy: session.user.id, approvedAt: now, decisionReason: p.reason ?? null, revision: sql`${platformChange.revision} + 1` })
      .where(eq(platformChange.id, c!.id))
    await transition(tx, session.user.id, inc!, "approved", { changeId: c!.id, payloadDigest: c!.payloadDigest, profileRevision: c!.targetProfileRevision })
    return { changeId: c!.id, outcome: "approved" as const }
  })
}

// ── Apply ──

export type ApplyResult = { changeId: string; profileRevision: number; diff: Record<string, unknown>; replayed: boolean }

/**
 * Applies an approved change to ONLY the allowlisted demo profile: persists
 * profile revision N+1 with its diff. Idempotent: the same key returns the
 * existing result; without approval → approval_required; a moved profile →
 * approval_stale (change marked stale, incident stays open).
 */
export async function applyPlatformChange(session: SessionInfo, input: { changeId: string; idempotencyKey: string }): Promise<ApplyResult> {
  assertPlatform(session)
  if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(input.idempotencyKey)) throw new DomainError("validation", "Invalid idempotency key", { field: "idempotencyKey" })
  const t = await locate(platformChange, input.changeId)
  if (!t) throw new DomainError("not_found", "Change not found")
  const outcome = await withTenant(t.id, async (tx): Promise<ApplyResult | { stale: true }> => {
    const [c] = await tx.select().from(platformChange).where(eq(platformChange.id, input.changeId)).for("update").limit(1)
    if ((c!.state === "applied" || c!.state === "verified") && c!.idempotencyKey === input.idempotencyKey) {
      const diff = c!.diff as Record<string, unknown>
      return { changeId: c!.id, profileRevision: (diff.after as { profileRevision: number }).profileRevision, diff, replayed: true }
    }
    if (c!.state === "applied" || c!.state === "verified") {
      throw new DomainError("blocked_by_rule", "This change was already applied", { rule: "already_applied" })
    }
    if (c!.state !== "approved" || !c!.approvedBy) {
      throw new DomainError("approval_required", "No valid approval for this exact change", { state: c!.state })
    }
    const [other] = await tx.select({ id: platformChange.id }).from(platformChange).where(and(eq(platformChange.tenantId, t.id), eq(platformChange.idempotencyKey, input.idempotencyKey))).limit(1)
    if (other) throw new DomainError("idempotency_conflict", "The idempotency key was already used for another change")
    const { profile, fresh } = await freshness(tx, c!)
    if (!fresh || !profile) {
      await markStale(tx, session.user.id, c!)
      return { stale: true }
    }
    const [inc] = await tx.select().from(platformIncident).where(eq(platformIncident.id, c!.incidentId)).for("update").limit(1)
    await transition(tx, session.user.id, inc!, "applying", { changeId: c!.id })
    const payload = c!.payload as ChangeView["payload"]
    const [updated] = await tx
      .update(importProfile)
      .set({ delimiter: payload.delimiter, profileRevision: profile.profileRevision + 1, updatedAt: new Date(), revision: sql`${importProfile.revision} + 1` })
      .where(and(eq(importProfile.id, profile.id), eq(importProfile.profileRevision, c!.targetProfileRevision)))
      .returning()
    const diff = {
      field: "delimiter",
      before: { delimiter: profile.delimiter, profileRevision: profile.profileRevision },
      after: { delimiter: updated!.delimiter, profileRevision: updated!.profileRevision },
    }
    await tx.insert(importProfileRevision).values({
      tenantId: t.id,
      profileId: profile.id,
      profileRevision: updated!.profileRevision,
      delimiter: updated!.delimiter,
      expectedHeaders: updated!.expectedHeaders,
      changeId: c!.id,
      diff,
      createdBy: session.user.id,
    })
    await tx
      .update(platformChange)
      .set({ state: "applied", appliedAt: new Date(), idempotencyKey: input.idempotencyKey, diff, revision: sql`${platformChange.revision} + 1` })
      .where(eq(platformChange.id, c!.id))
    await audit(tx, session.user.id, t.id, "ops.change.applied", { incidentId: c!.incidentId, changeId: c!.id, diff })
    return { changeId: c!.id, profileRevision: updated!.profileRevision, diff, replayed: false }
  })
  if ("stale" in outcome) throw new DomainError("approval_stale", "The profile changed after approval; the change is stale")
  return outcome
}

// ── Verify ──

export type VerifyResult = {
  changeId: string
  passed: boolean
  incidentState: string
  before: { delimiter: string; observedColumns: number }
  after: ParseEvidence
  fileSha256: string
  sameFile: boolean
  ordersImported: 0
}

/**
 * Re-parses the SAME stored bytes (sha256 must match the detected file) with
 * the applied profile. Six expected headers + one data row → change verified,
 * incident resolved with before/after. Otherwise the incident stays open.
 */
export async function verifyPlatformChange(session: SessionInfo, input: { changeId: string }): Promise<VerifyResult> {
  assertPlatform(session)
  const t = await locate(platformChange, input.changeId)
  if (!t) throw new DomainError("not_found", "Change not found")
  return withTenant(t.id, async (tx) => {
    const [c] = await tx.select().from(platformChange).where(eq(platformChange.id, input.changeId)).for("update").limit(1)
    if (c!.state === "verified") return c!.verification as VerifyResult
    if (c!.state !== "applied") throw new DomainError("blocked_by_rule", "Apply the approved change before verifying", { rule: "not_applied", state: c!.state })
    const [inc] = await tx.select().from(platformIncident).where(eq(platformIncident.id, c!.incidentId)).for("update").limit(1)
    const [profile] = await tx.select().from(importProfile).where(eq(importProfile.id, inc!.profileId)).limit(1)
    await transition(tx, session.user.id, inc!, "verifying", { changeId: c!.id })
    const { bytes, sha256 } = await loadFile(tx, t.id, inc!.fileId)
    const evidence = inc!.evidence as { fileSha256?: string; delimiter?: string; observedColumns?: number }
    const sameFile = evidence.fileSha256 === sha256
    const after = parseEvidence(bytes, profile!.delimiter, profile!.expectedHeaders)
    const passed = sameFile && after.matchesExpected && after.dataRows === 1
    const diff = c!.diff as { before: { delimiter: string } }
    const before = { delimiter: diff.before.delimiter, observedColumns: parseEvidence(bytes, diff.before.delimiter, profile!.expectedHeaders).observedColumns }
    const result: VerifyResult = { changeId: c!.id, passed, incidentState: passed ? "resolved" : "investigating", before, after, fileSha256: sha256, sameFile, ordersImported: 0 }
    if (passed) {
      await tx.update(platformChange).set({ state: "verified", verification: result, revision: sql`${platformChange.revision} + 1` }).where(eq(platformChange.id, c!.id))
      await transition(tx, session.user.id, inc!, "resolved", { changeId: c!.id, before, after: { columns: after.observedColumns, dataRows: after.dataRows } }, { resolution: result, resolvedAt: new Date(), lastError: null })
    } else {
      await tx.update(platformChange).set({ verification: result, revision: sql`${platformChange.revision} + 1` }).where(eq(platformChange.id, c!.id))
      await transition(tx, session.user.id, inc!, "investigating", { changeId: c!.id, reason: "verification_failed" }, { lastError: "verification_failed" })
    }
    return result
  })
}
