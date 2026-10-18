import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

import { createdAt, minor, pk, revision, updatedAt } from "./columns"
import { legalEntity } from "./configuration"
import { evidence } from "./control"
import { appUser } from "./platform"
import { tenantId, tenantUnique } from "./tenant"

// Client → contract/PO → job → budget/estimate → production/media.
// Mutable rows carry revision + actor + timestamps. Approved revisions are
// never edited in place: a change creates a new revision row.

const actors = () => ({
  createdBy: uuid("created_by").references(() => appUser.id),
  updatedBy: uuid("updated_by").references(() => appUser.id),
})

export const client = pgTable(
  "client",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    legalEntityId: uuid("legal_entity_id"),
    name: text("name").notNull(),
    // 3-char client code and 2-char product code used by the job_number calculator.
    code: text("code").notNull(),
    productCode: text("product_code").notNull(),
    billingCurrency: text("billing_currency").notNull(),
    creditLimitMinor: minor("credit_limit_minor").notNull().default(sql`0`),
    country: text("country").notNull(),
    fiscalProfile: text("fiscal_profile").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => appUser.id),
    // active | archived
    state: text("state").notNull().default("active"),
    // Jobs opened for a client inherit it; demo-lab stays out of primary KPIs.
    reportingGroup: text("reporting_group").notNull().default("primary"),
    ...actors(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("client", t),
    unique("client_code_uq").on(t.tenantId, t.code),
    foreignKey({
      columns: [t.tenantId, t.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    }),
  ]
)

export const brief = pgTable(
  "brief",
  {
    id: pk(),
    tenantId: tenantId(),
    clientId: uuid("client_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    services: text("services").array().notNull(),
    evidenceId: uuid("evidence_id"),
    ...actors(),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("brief", t),
    foreignKey({
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }),
  ]
)

export const job = pgTable(
  "job",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    clientId: uuid("client_id").notNull(),
    name: text("name").notNull(),
    // Canonical code from the job_number calculator (e.g. AURSL7AF0001) and the
    // separate friendly alias (e.g. RDS-2027-001).
    jobNumber: text("job_number").notNull(),
    displayReference: text("display_reference").notNull(),
    jobType: text("job_type").notNull(),
    billingCode: text("billing_code").notNull(),
    year: integer("year").notNull(),
    sequence: integer("sequence").notNull(),
    // draft | open | in_progress | ready_to_close | closed
    state: text("state").notNull().default("open"),
    ownerUserId: uuid("owner_user_id").references(() => appUser.id),
    period: text("period").notNull(),
    currency: text("currency").notNull(),
    services: text("services").array().notNull(),
    // Secondary exercises (demo-lab) are excluded from primary metrics.
    reportingGroup: text("reporting_group").notNull().default("primary"),
    closeReason: text("close_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...actors(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("job", t),
    unique("job_number_uq").on(t.tenantId, t.jobNumber),
    unique("job_display_reference_uq").on(t.tenantId, t.displayReference),
    index("job_client_idx").on(t.tenantId, t.clientId),
    foreignKey({
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }),
  ]
)

// Client commercial authority (contract / PO). Distinct from internal approval:
// an internal approval never stands in for this evidence.
export const contract = pgTable(
  "contract",
  {
    id: pk(),
    tenantId: tenantId(),
    clientId: uuid("client_id").notNull(),
    jobId: uuid("job_id"),
    // client_po | master_agreement
    kind: text("kind").notNull(),
    reference: text("reference").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    // draft | submitted | approved | superseded
    state: text("state").notNull().default("draft"),
    evidenceId: uuid("evidence_id"),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    supersedesId: uuid("supersedes_id"),
    approvedBy: uuid("approved_by").references(() => appUser.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...actors(),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("contract", t),
    unique("contract_reference_rev_uq").on(
      t.tenantId,
      t.reference,
      t.revisionNumber
    ),
    foreignKey({
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.jobId],
      foreignColumns: [job.tenantId, job.id],
    }),
    // Client authority must point at evidence of the same agency (B06).
    foreignKey({
      columns: [t.tenantId, t.evidenceId],
      foreignColumns: [evidence.tenantId, evidence.id],
    }),
  ]
)

// Atomic per-agency/year counter for the friendly job reference (B09).
export const displayReferenceCounter = pgTable(
  "display_reference_counter",
  {
    tenantId: tenantId(),
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year] })]
)

// Commercial budget of a job: agency fee (net agency revenue) and managed media
// (pass-through, excluded from agency margin under the demo policy).
export const budgetRevision = pgTable(
  "budget_revision",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    number: integer("number").notNull(),
    // draft | submitted | approved | superseded | rejected
    state: text("state").notNull().default("draft"),
    agencyFeeMinor: minor("agency_fee_minor").notNull(),
    managedMediaMinor: minor("managed_media_minor").notNull(),
    currency: text("currency").notNull(),
    reason: text("reason"),
    supersedesId: uuid("supersedes_id"),
    approvedBy: uuid("approved_by").references(() => appUser.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...actors(),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("budget_revision", t),
    unique("budget_revision_number_uq").on(t.tenantId, t.jobId, t.number),
    foreignKey({
      columns: [t.tenantId, t.jobId],
      foreignColumns: [job.tenantId, job.id],
    }),
  ]
)

// Forecast of the agency's own direct cost (labor, production, expenses).
export const costEstimate = pgTable(
  "cost_estimate",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    number: integer("number").notNull(),
    // current | superseded
    state: text("state").notNull().default("current"),
    reason: text("reason"),
    currency: text("currency").notNull(),
    ...actors(),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("cost_estimate", t),
    unique("cost_estimate_number_uq").on(t.tenantId, t.jobId, t.number),
    foreignKey({
      columns: [t.tenantId, t.jobId],
      foreignColumns: [job.tenantId, job.id],
    }),
  ]
)

export const costEstimateLine = pgTable(
  "cost_estimate_line",
  {
    id: pk(),
    tenantId: tenantId(),
    estimateId: uuid("estimate_id").notNull(),
    // labor | production | expense
    lineType: text("line_type").notNull(),
    description: text("description").notNull(),
    minutes: integer("minutes"),
    hourlyCostMinor: minor("hourly_cost_minor"),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    supplierId: uuid("supplier_id"),
  },
  (t) => [
    tenantUnique("cost_estimate_line", t),
    foreignKey({
      columns: [t.tenantId, t.estimateId],
      foreignColumns: [costEstimate.tenantId, costEstimate.id],
    }),
  ]
)

// Budget reservations: available = authorized − spent − open_commitments −
// uncommitted_reservations, per budget_scope. Reserving locks the job row.
export const budgetReservation = pgTable(
  "budget_reservation",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    // client_commercial_authority | managed_media_authority | agency_cost_authority
    budgetScope: text("budget_scope").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    // reserved | committed | consumed | released
    state: text("state").notNull().default("reserved"),
    purpose: text("purpose").notNull(),
    ...actors(),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("budget_reservation", t),
    index("budget_reservation_job_idx").on(t.tenantId, t.jobId),
    foreignKey({
      columns: [t.tenantId, t.jobId],
      foreignColumns: [job.tenantId, job.id],
    }),
  ]
)

export const timesheet = pgTable(
  "timesheet",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    jobId: uuid("job_id").notNull(),
    userId: uuid("user_id").references(() => appUser.id),
    taskLabel: text("task_label").notNull(),
    workDate: date("work_date").notNull(),
    minutes: integer("minutes").notNull(),
    hourlyCostMinor: minor("hourly_cost_minor").notNull(),
    currency: text("currency").notNull(),
    // draft | submitted | approved | rejected | locked
    state: text("state").notNull().default("draft"),
    // Author's note when logging; approver's reason on approve/reject.
    notes: text("notes"),
    decisionReason: text("decision_reason"),
    approvedBy: uuid("approved_by").references(() => appUser.id),
    ...actors(),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("timesheet", t),
    foreignKey({
      columns: [t.tenantId, t.jobId],
      foreignColumns: [job.tenantId, job.id],
    }),
  ]
)

export const supplier = pgTable(
  "supplier",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    // Master code (agency-master-data); unique per agency when present.
    code: text("code"),
    name: text("name").notNull(),
    country: text("country").notNull(),
    currency: text("currency").notNull(),
    externalIds: jsonb("external_ids").notNull().default({}),
    // active | inactive
    state: text("state").notNull().default("active"),
    ...actors(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [tenantUnique("supplier", t), unique("supplier_code_uq").on(t.tenantId, t.code)]
)

export const mediaPlanRevision = pgTable(
  "media_plan_revision",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    number: integer("number").notNull(),
    // draft | submitted | approved | superseded
    state: text("state").notNull().default("draft"),
    totalMinor: minor("total_minor").notNull(),
    currency: text("currency").notNull(),
    objective: text("objective").notNull(),
    approvedBy: uuid("approved_by").references(() => appUser.id),
    ...actors(),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("media_plan_revision", t),
    unique("media_plan_revision_number_uq").on(t.tenantId, t.jobId, t.number),
    foreignKey({
      columns: [t.tenantId, t.jobId],
      foreignColumns: [job.tenantId, job.id],
    }),
  ]
)

export const mediaPlanLine = pgTable(
  "media_plan_line",
  {
    id: pk(),
    tenantId: tenantId(),
    planRevisionId: uuid("plan_revision_id").notNull(),
    lineKey: text("line_key").notNull(),
    channel: text("channel").notNull(),
    placement: text("placement").notNull(),
    provider: text("provider").notNull(),
    accountAlias: text("account_alias"),
    quantity: integer("quantity"),
    unitCostMinor: minor("unit_cost_minor"),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    // Target audience the line buys against (media planning).
    audience: text("audience"),
    simulation: text("simulation").notNull().default("simulated"),
  },
  (t) => [
    tenantUnique("media_plan_line", t),
    unique("media_plan_line_key_uq").on(t.tenantId, t.planRevisionId, t.lineKey),
    foreignKey({
      columns: [t.tenantId, t.planRevisionId],
      foreignColumns: [mediaPlanRevision.tenantId, mediaPlanRevision.id],
    }),
  ]
)
