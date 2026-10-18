import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { createdAt, pk, revision, updatedAt } from "./columns"
import { appUser } from "./platform"
import { tenantId, tenantUnique } from "./tenant"

// Private library. Bytes live in a private storage adapter (local disk outside
// public/ in development); this table holds metadata and authorization scope.
// Downloads always re-check tenant membership.
export const fileObject = pgTable(
  "file_object",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    // Groups versions of the same logical document.
    logicalId: uuid("logical_id").notNull(),
    version: integer("version").notNull(),
    jobId: uuid("job_id"),
    originalName: text("original_name").notNull(),
    // pdf | docx | xlsx | csv
    format: text("format").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    // stored | analyzed | not_analyzed | prepared_demo_extraction | failed
    extractionStatus: text("extraction_status").notNull().default("stored"),
    extraction: jsonb("extraction"),
    synthetic: text("synthetic").notNull().default("uploaded"),
    // private_agency (all members) | restricted (owner + finance)
    visibility: text("visibility").notNull().default("private_agency"),
    uploadedBy: uuid("uploaded_by").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("file_object", t),
    unique("file_object_version_uq").on(t.tenantId, t.logicalId, t.version),
    index("file_object_job_idx").on(t.tenantId, t.jobId),
  ]
)

// Platform operations (/ops). The import profile belongs to a tenant but is
// mutated only through the allowlisted platform change flow.
export const importProfile = pgTable(
  "import_profile",
  {
    id: pk(),
    tenantId: tenantId(),
    profileKey: text("profile_key").notNull(),
    delimiter: text("delimiter").notNull(),
    expectedHeaders: text("expected_headers").array().notNull(),
    profileRevision: integer("profile_revision").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("import_profile", t),
    unique("import_profile_key_uq").on(t.tenantId, t.profileKey),
  ]
)

export const platformIncident = pgTable(
  "platform_incident",
  {
    id: pk(),
    tenantId: tenantId(),
    incidentKey: text("incident_key").notNull(),
    // detected | investigating | proposed | awaiting_approval | approved |
    // applying | verifying | resolved
    state: text("state").notNull(),
    title: jsonb("title").notNull(),
    fileId: uuid("file_id"),
    profileId: uuid("profile_id").notNull(),
    evidence: jsonb("evidence").notNull().default({}),
    // Before/after verification result once resolved; last error otherwise.
    resolution: jsonb("resolution"),
    lastError: text("last_error"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("platform_incident", t),
    unique("platform_incident_key_uq").on(t.tenantId, t.incidentKey),
    foreignKey({
      columns: [t.tenantId, t.profileId],
      foreignColumns: [importProfile.tenantId, importProfile.id],
    }),
  ]
)

export const platformChange = pgTable(
  "platform_change",
  {
    id: pk(),
    tenantId: tenantId(),
    incidentId: uuid("incident_id").notNull(),
    commandType: text("command_type").notNull(),
    payload: jsonb("payload").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    targetProfileRevision: integer("target_profile_revision").notNull(),
    // proposed | awaiting_approval | approved | rejected | applied | verified | stale
    state: text("state").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => appUser.id),
    approvedBy: uuid("approved_by").references(() => appUser.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    verification: jsonb("verification"),
    // Apply idempotency key (second apply with the same key replays).
    idempotencyKey: text("idempotency_key"),
    // Proposal idempotency key (refresh/double submit never creates two).
    proposalKey: text("proposal_key"),
    decisionReason: text("decision_reason"),
    // Profile before/after persisted by apply.
    diff: jsonb("diff"),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("platform_change", t),
    unique("platform_change_apply_key_uq").on(t.tenantId, t.idempotencyKey),
    unique("platform_change_proposal_key_uq").on(t.tenantId, t.proposalKey),
    foreignKey({
      columns: [t.tenantId, t.incidentId],
      foreignColumns: [platformIncident.tenantId, platformIncident.id],
    }),
  ]
)

// Immutable history of import profile revisions (revision 1 from the seed,
// later ones only from an approved, applied platform change).
export const importProfileRevision = pgTable(
  "import_profile_revision",
  {
    id: pk(),
    tenantId: tenantId(),
    profileId: uuid("profile_id").notNull(),
    profileRevision: integer("profile_revision").notNull(),
    delimiter: text("delimiter").notNull(),
    expectedHeaders: text("expected_headers").array().notNull(),
    changeId: uuid("change_id"),
    diff: jsonb("diff").notNull().default({}),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("import_profile_revision", t),
    unique("import_profile_revision_uq").on(t.tenantId, t.profileId, t.profileRevision),
    foreignKey({
      columns: [t.tenantId, t.profileId],
      foreignColumns: [importProfile.tenantId, importProfile.id],
    }),
  ]
)
