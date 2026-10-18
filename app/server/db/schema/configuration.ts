import {
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

export const legalEntity = pgTable(
  "legal_entity",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    name: text("name").notNull(),
    country: text("country").notNull(),
    currency: text("currency").notNull(),
    fiscalProfileId: text("fiscal_profile_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [tenantUnique("legal_entity", t)]
)

// Versioned agency configuration. The wizard edits a draft revision; the
// published revision is immutable and referenced by agency.published_config_revision_id.
export const configurationRevision = pgTable(
  "configuration_revision",
  {
    id: pk(),
    tenantId: tenantId(),
    number: integer("number").notNull(),
    // draft | validating | awaiting_approval | approved | provisioning | ready |
    // blocked | rejected | stale | superseded
    state: text("state").notNull().default("draft"),
    schemaVersion: text("schema_version").notNull(),
    // Wizard sections, each validated by a Zod schema on the server.
    agencyProfile: jsonb("agency_profile").notNull().default({}),
    operations: jsonb("operations").notNull().default({}),
    connections: jsonb("connections").notNull().default({}),
    brandAccess: jsonb("brand_access").notNull().default({}),
    enabledCapabilities: text("enabled_capabilities").array().notNull(),
    approvalPolicy: jsonb("approval_policy").notNull().default({}),
    limits: jsonb("limits").notNull().default({}),
    lastCompletedStep: integer("last_completed_step").notNull().default(0),
    validation: jsonb("validation"),
    // Change revisions of an existing agency: published revision they were
    // computed against, capability diff, reason and the exact digest approved.
    basedOnRevisionId: uuid("based_on_revision_id"),
    diff: jsonb("diff"),
    changeReason: text("change_reason"),
    payloadDigest: text("payload_digest"),
    decisionReason: text("decision_reason"),
    createdBy: uuid("created_by").references(() => appUser.id),
    approvedBy: uuid("approved_by").references(() => appUser.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("configuration_revision", t),
    unique("configuration_revision_number_uq").on(t.tenantId, t.number),
  ]
)

export const activationRun = pgTable(
  "activation_run",
  {
    id: pk(),
    tenantId: tenantId(),
    configurationRevisionId: uuid("configuration_revision_id").notNull(),
    // queued | running | succeeded | failed | waiting
    state: text("state").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: uuid("created_by").references(() => appUser.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("activation_run", t),
    unique("activation_run_idem_uq").on(t.tenantId, t.idempotencyKey),
    foreignKey({
      columns: [t.tenantId, t.configurationRevisionId],
      foreignColumns: [configurationRevision.tenantId, configurationRevision.id],
    }),
  ]
)

export const activationStep = pgTable(
  "activation_step",
  {
    id: pk(),
    tenantId: tenantId(),
    runId: uuid("run_id").notNull(),
    seq: integer("seq").notNull(),
    stepKey: text("step_key").notNull(),
    // pending | running | succeeded | failed | simulated
    state: text("state").notNull().default("pending"),
    detail: jsonb("detail").notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    tenantUnique("activation_step", t),
    unique("activation_step_seq_uq").on(t.tenantId, t.runId, t.seq),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [activationRun.tenantId, activationRun.id],
    }),
  ]
)

// Simulated provider connection bound to one agency. "connected_demo" never
// means verified OAuth.
export const connection = pgTable(
  "connection",
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text("provider").notNull(),
    category: text("category").notNull(),
    // simulated | file
    mode: text("mode").notNull().default("simulated"),
    accountAlias: text("account_alias").notNull(),
    scopes: text("scopes").array().notNull(),
    // connected_demo | revoked | not_configured
    state: text("state").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => appUser.id),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("connection", t),
    unique("connection_provider_account_uq").on(
      t.tenantId,
      t.provider,
      t.accountAlias
    ),
    index("connection_tenant_idx").on(t.tenantId),
  ]
)
