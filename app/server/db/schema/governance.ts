// Schema owned by Core-1: access governance, master data, orchestrator
// checkpoints, fee schedules and billing readiness. Tenant tables use
// tenantId() + tenantUnique() and composite tenant FKs.
import { boolean, foreignKey, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core"

import { createdAt, minor, pk, revision, updatedAt } from "./columns"
import { budgetRevision, job } from "./commercial"
import { appUser } from "./platform"
import { tenantId, tenantUnique } from "./tenant"

// Governed access profile of a member (agency-access-governance). Mirrors the
// membership role and adds scope and expense cap; its revision is the
// aggregate revision role-change approvals bind to.
export const memberAccess = pgTable(
  "member_access",
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    role: text("role").notNull(),
    // agency_wide | assigned_jobs
    effectiveScope: text("effective_scope").notNull().default("agency_wide"),
    expenseApprovalCapMinor: minor("expense_approval_cap_minor"),
    currency: text("currency"),
    updatedBy: uuid("updated_by").references(() => appUser.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [tenantUnique("member_access", t), unique("member_access_user_uq").on(t.tenantId, t.userId)]
)

// External code map (agency-master-data): one provider/external id resolves to
// exactly one master record of a type.
export const masterExternalRef = pgTable(
  "master_external_ref",
  {
    id: pk(),
    tenantId: tenantId(),
    // client | supplier | account
    recordType: text("record_type").notNull(),
    // Record uuid, or the ledger account code for record_type = account.
    recordKey: text("record_key").notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("master_external_ref", t),
    unique("master_external_ref_uq").on(t.tenantId, t.recordType, t.provider, t.externalId),
  ]
)

// Persisted readiness checkpoint (agency-orchestrator). Same job revision and
// same derived state → same row (retries never duplicate).
export const readinessCheckpoint = pgTable(
  "readiness_checkpoint",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    jobRevision: integer("job_revision").notNull(),
    approvedPlanRevision: integer("approved_plan_revision"),
    digest: text("digest").notNull(),
    nextStage: text("next_stage").notNull(),
    blockers: jsonb("blockers").notNull().default([]),
    snapshot: jsonb("snapshot").notNull(),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("readiness_checkpoint", t),
    unique("readiness_checkpoint_digest_uq").on(t.tenantId, t.jobId, t.digest),
    foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
  ]
)

// Fee schedule computed for a fee amendment (agency-fee-contracts):
// instalments split into media/production fee items. proposed → approved |
// superseded.
export const feeSchedule = pgTable(
  "fee_schedule",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    budgetRevisionId: uuid("budget_revision_id").notNull(),
    proposalId: uuid("proposal_id"),
    state: text("state").notNull().default("proposed"),
    // fixed_fee | hourly_fee
    contractKind: text("contract_kind").notNull(),
    totalMinor: minor("total_minor").notNull(),
    currency: text("currency").notNull(),
    // Hourly settlement (approved hours only) and exceptions, as computed.
    settlement: jsonb("settlement"),
    exceptions: jsonb("exceptions").notNull().default([]),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("fee_schedule", t),
    index("fee_schedule_job_idx").on(t.tenantId, t.jobId),
    foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
    foreignKey({ columns: [t.tenantId, t.budgetRevisionId], foreignColumns: [budgetRevision.tenantId, budgetRevision.id] }),
  ]
)

export const feeScheduleLine = pgTable(
  "fee_schedule_line",
  {
    id: pk(),
    tenantId: tenantId(),
    scheduleId: uuid("schedule_id").notNull(),
    instalmentNumber: integer("instalment_number").notNull(),
    month: text("month").notNull(),
    // media | production
    share: text("share").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
  },
  (t) => [
    tenantUnique("fee_schedule_line", t),
    unique("fee_schedule_line_uq").on(t.tenantId, t.scheduleId, t.instalmentNumber, t.share),
    foreignKey({ columns: [t.tenantId, t.scheduleId], foreignColumns: [feeSchedule.tenantId, feeSchedule.id] }),
  ]
)

// Billing requirements checked for a job (agency-billing-requirements). A row
// exists only when every requirement passed; it pins the evidence it used.
export const billingReadiness = pgTable(
  "billing_readiness",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    jobRevision: integer("job_revision").notNull(),
    ready: boolean("ready").notNull(),
    digest: text("digest").notNull(),
    requirements: jsonb("requirements").notNull(),
    evidencePins: jsonb("evidence_pins").notNull().default([]),
    deliverableAccepted: boolean("deliverable_accepted").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("billing_readiness", t),
    unique("billing_readiness_digest_uq").on(t.tenantId, t.jobId, t.digest),
    foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
  ]
)
