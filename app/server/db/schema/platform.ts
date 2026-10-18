import {
  bigserial,
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { createdAt, pk, revision, updatedAt } from "./columns"

// Global (non-tenant) tables. They hold identities, sessions, the agency
// registry and memberships. Access is mediated by server authorization code;
// tenant business data lives in tenant tables protected by RLS.

export const appUser = pgTable("app_user", {
  id: pk(),
  fixtureKey: text("fixture_key").unique(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull().unique(),
  locale: text("locale").notNull().default("en"),
  // agency | platform
  kind: text("kind").notNull().default("agency"),
  // platform_operator | platform_admin (only for kind=platform)
  platformRole: text("platform_role"),
  // Synthetic persona the authorized presenter may act as in demo mode.
  demoPersona: boolean("demo_persona").notNull().default(false),
  createdAt: createdAt(),
})

export const appSession = pgTable(
  "app_session",
  {
    id: pk(),
    // SHA-256 of the opaque cookie token. The raw token never touches the DB.
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    // The real principal that authenticated with the demo access code.
    presenterUserId: uuid("presenter_user_id").references(() => appUser.id),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("app_session_user_idx").on(t.userId)]
)

export const agency = pgTable("agency", {
  id: pk(),
  fixtureKey: text("fixture_key").unique(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  appName: text("app_name").notNull(),
  // draft | activating | ready | blocked
  status: text("status").notNull().default("draft"),
  baseCurrency: text("base_currency").notNull(),
  timezone: text("timezone").notNull(),
  locale: text("locale").notNull().default("en"),
  publishedConfigRevisionId: uuid("published_config_revision_id"),
  requestedDomain: text("requested_domain"),
  // none | requested | pending_dns | verifying | simulated_ready
  domainState: text("domain_state").notNull().default("none"),
  demoSeedVersion: text("demo_seed_version"),
  createdBy: uuid("created_by").references(() => appUser.id),
  createIdempotencyKey: text("create_idempotency_key").unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  revision: revision(),
})

export const membership = pgTable(
  "membership",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => agency.id),
    // owner | account_manager | finance_approver | producer | viewer
    role: text("role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("membership_user_tenant_uq").on(t.userId, t.tenantId)]
)

// Contract catalog of the 42 capabilities (read-only global catalog).
export const capabilityDefinition = pgTable("capability_definition", {
  skillId: text("skill_id").primaryKey(),
  moduleKey: text("module_key").notNull(),
  actionId: text("action_id").notNull(),
  specialistKey: text("specialist_key").notNull(),
  handlerVersion: text("handler_version").notNull(),
  dependencies: text("dependencies").array().notNull(),
  calculatorDependencies: text("calculator_dependencies").array().notNull(),
})

// Platform-level audit (sign-in, persona switch, resets). Append-only: the
// application role is granted INSERT/SELECT only.
export const platformAuditEvent = pgTable(
  "platform_audit_event",
  {
    id: pk(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => appUser.id),
    // No FK to agency: the audit stream must survive a demo tenant reset
    // (the reset record itself names the tenants it removed).
    tenantId: uuid("tenant_id"),
    payload: jsonb("payload").notNull().default({}),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("platform_audit_event_seq_idx").on(t.seq)]
)

// One row per demo seed/reset/checkpoint load (demo_run_id). Global and outside
// the reset set. The fixed business clock lives here so a presenter-authorized
// advance is persisted and audited instead of aging real records.
export const demoRun = pgTable(
  "demo_run",
  {
    id: pk(),
    seedVersion: text("seed_version").notNull(),
    // from_intake | ready_for_scope_review
    checkpoint: text("checkpoint").notNull(),
    // active | ended
    state: text("state").notNull().default("active"),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    tenantIds: uuid("tenant_ids").array().notNull(),
    startedBy: uuid("started_by").references(() => appUser.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    revision: revision(),
  },
  (t) => [index("demo_run_state_idx").on(t.state, t.startedAt)]
)
