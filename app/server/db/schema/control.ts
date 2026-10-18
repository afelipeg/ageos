import {
  bigserial,
  boolean,
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

import { createdAt, minor, pk, revision, updatedAt } from "./columns"
import { fileObject } from "./files"
import { appUser } from "./platform"
import { tenantId, tenantUnique } from "./tenant"

// Governance kernel: proposals, approvals bound to exact payload digests,
// immutable business events (audit), idempotency, outbox, simulated adapter
// operations and workflow runs.

export const actionProposal = pgTable(
  "action_proposal",
  {
    id: pk(),
    tenantId: tenantId(),
    actionType: text("action_type").notNull(),
    skillId: text("skill_id"),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id"),
    // Revision of the target aggregate the proposal was computed against.
    baseRevision: integer("base_revision"),
    payload: jsonb("payload").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    diff: jsonb("diff").notNull().default({}),
    impact: jsonb("impact").notNull().default({}),
    // draft | awaiting_confirmation | confirmed | awaiting_approval | approved |
    // executed | rejected | expired | cancelled | blocked | stale
    state: text("state").notNull().default("draft"),
    // ui | assistant_scripted
    origin: text("origin").notNull(),
    conversationId: uuid("conversation_id"),
    runId: uuid("run_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUser.id),
    confirmedBy: uuid("confirmed_by").references(() => appUser.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    executedCommandId: text("executed_command_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [tenantUnique("action_proposal", t)]
)

export const approvalRequest = pgTable(
  "approval_request",
  {
    id: pk(),
    tenantId: tenantId(),
    proposalId: uuid("proposal_id").notNull(),
    actionType: text("action_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    // Exact aggregate revision the approval applies to.
    aggregateRevision: integer("aggregate_revision").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    amountMinor: minor("amount_minor"),
    currency: text("currency"),
    destination: text("destination"),
    policyId: text("policy_id").notNull(),
    policyRevision: integer("policy_revision").notNull(),
    // Digest of the tenant's published approval policy when requested; a
    // different policy at execution time makes the approval stale.
    policySnapshotDigest: text("policy_snapshot_digest"),
    eligibleRoles: text("eligible_roles").array().notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => appUser.id),
    // awaiting_approval | approved | rejected | changes_requested | stale | expired | consumed
    state: text("state").notNull().default("awaiting_approval"),
    decidedBy: uuid("decided_by").references(() => appUser.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    title: text("title").notNull(),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("approval_request", t),
    index("approval_request_state_idx").on(t.tenantId, t.state),
    foreignKey({
      columns: [t.tenantId, t.proposalId],
      foreignColumns: [actionProposal.tenantId, actionProposal.id],
    }),
  ]
)

export const approvalDecision = pgTable(
  "approval_decision",
  {
    id: pk(),
    tenantId: tenantId(),
    approvalId: uuid("approval_id").notNull(),
    // approve | reject | request_changes
    decision: text("decision").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => appUser.id),
    reason: text("reason"),
    payloadDigest: text("payload_digest").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("approval_decision", t),
    foreignKey({
      columns: [t.tenantId, t.approvalId],
      foreignColumns: [approvalRequest.tenantId, approvalRequest.id],
    }),
  ]
)

// Evidence wraps one stored file version. Client authority and billing gates
// require it to be reviewed by someone other than its submitter; the review
// pins the exact file hash + version, so a later change is detectable.
export const evidence = pgTable(
  "evidence",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    // client_po | acceptance | brief
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    fileId: uuid("file_id"),
    // Link checked in code (client/job live in commercial.ts, which references
    // this table): client-level evidence has job_id null.
    clientId: uuid("client_id"),
    jobId: uuid("job_id"),
    synthetic: boolean("synthetic").notNull().default(true),
    // received | reviewed | rejected
    reviewState: text("review_state").notNull().default("received"),
    submittedBy: uuid("submitted_by").references(() => appUser.id),
    reviewedBy: uuid("reviewed_by").references(() => appUser.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedFileSha256: text("reviewed_file_sha256"),
    reviewedFileVersion: integer("reviewed_file_version"),
    reviewReason: text("review_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("evidence", t),
    index("evidence_job_idx").on(t.tenantId, t.jobId),
    foreignKey({
      columns: [t.tenantId, t.fileId],
      foreignColumns: [fileObject.tenantId, fileObject.id],
    }),
  ]
)

// Immutable business event stream = tenant audit log. The application role
// may only INSERT and SELECT (see security migration).
export const businessEvent = pgTable(
  "business_event",
  {
    id: pk(),
    tenantId: tenantId(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id"),
    aggregateRevision: integer("aggregate_revision"),
    actorUserId: uuid("actor_user_id").references(() => appUser.id),
    // ui | assistant_scripted | seed | system | presenter
    origin: text("origin").notNull(),
    commandType: text("command_type"),
    commandId: text("command_id"),
    correlationId: text("correlation_id"),
    jobId: uuid("job_id"),
    payload: jsonb("payload").notNull().default({}),
    businessEffectiveAt: timestamp("business_effective_at", {
      withTimezone: true,
    }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    tenantUnique("business_event", t),
    index("business_event_aggregate_idx").on(
      t.tenantId,
      t.aggregateType,
      t.aggregateId
    ),
    index("business_event_job_idx").on(t.tenantId, t.jobId),
  ]
)

export const idempotencyRecord = pgTable(
  "idempotency_record",
  {
    id: pk(),
    tenantId: tenantId(),
    commandType: text("command_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    // completed | failed
    status: text("status").notNull(),
    response: jsonb("response").notNull(),
    actorUserId: uuid("actor_user_id").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("idempotency_record", t),
    unique("idempotency_key_uq").on(t.tenantId, t.commandType, t.idempotencyKey),
  ]
)

export const outboxMessage = pgTable(
  "outbox_message",
  {
    id: pk(),
    tenantId: tenantId(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    // pending | leased | done | failed
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("outbox_message", t),
    index("outbox_pending_idx").on(t.state, t.nextAttemptAt),
  ]
)

// Intent + outcome of a call to the simulated provider adapter.
export const adapterOperation = pgTable(
  "adapter_operation",
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text("provider").notNull(),
    accountAlias: text("account_alias").notNull(),
    operationType: text("operation_type").notNull(),
    approvedActionId: text("approved_action_id").notNull(),
    // Derived from the stable approved action id, never from message text.
    idempotencyKey: text("idempotency_key").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    payload: jsonb("payload").notNull(),
    // pending | succeeded | failed | outcome_unknown | rate_limited
    state: text("state").notNull(),
    failureMode: text("failure_mode").notNull().default("success"),
    receiptId: text("receipt_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantUnique("adapter_operation", t),
    unique("adapter_operation_idem_uq").on(
      t.tenantId,
      t.provider,
      t.idempotencyKey
    ),
  ]
)

// What the fictional provider "did". Separate from adapter_operation so a
// timeout_after_effect can exist (effect recorded, app not told).
export const demoProviderEffect = pgTable(
  "demo_provider_effect",
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text("provider").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    receiptId: text("receipt_id").notNull(),
    effect: jsonb("effect").notNull(),
    simulation: boolean("simulation").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("demo_provider_effect", t),
    unique("demo_provider_effect_idem_uq").on(
      t.tenantId,
      t.provider,
      t.idempotencyKey
    ),
    unique("demo_provider_effect_receipt_uq").on(t.tenantId, t.receiptId),
  ]
)

// Execution of a capability (workflow-workbench / assistant delegation).
export const workflowRun = pgTable(
  "workflow_run",
  {
    id: pk(),
    tenantId: tenantId(),
    skillId: text("skill_id").notNull(),
    handlerVersion: text("handler_version").notNull(),
    jobId: uuid("job_id"),
    // queued | executing | awaiting_approval | blocked | succeeded | failed | outcome_unknown
    state: text("state").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    origin: text("origin").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => appUser.id),
    idempotencyKey: text("idempotency_key"),
    // Canonical digest of skill + input + expectedRevision + actor; a replay
    // with the same key must match it exactly (B02).
    requestDigest: text("request_digest"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    tenantUnique("workflow_run", t),
    index("workflow_run_skill_idx").on(t.tenantId, t.skillId),
    unique("workflow_run_idem_uq").on(t.tenantId, t.skillId, t.idempotencyKey),
  ]
)

export const workflowRunStep = pgTable(
  "workflow_run_step",
  {
    id: pk(),
    tenantId: tenantId(),
    runId: uuid("run_id").notNull(),
    seq: integer("seq").notNull(),
    stepKey: text("step_key").notNull(),
    state: text("state").notNull(),
    detail: jsonb("detail").notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    tenantUnique("workflow_run_step", t),
    unique("workflow_run_step_seq_uq").on(t.tenantId, t.runId, t.seq),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [workflowRun.tenantId, workflowRun.id],
    }),
  ]
)

// Inbox / "needs attention" items produced by explicit rules.
export const attentionItem = pgTable(
  "attention_item",
  {
    id: pk(),
    tenantId: tenantId(),
    ruleId: text("rule_id").notNull(),
    // Dedup key per rule/subject so re-evaluating a rule does not duplicate items.
    subjectKey: text("subject_key").notNull(),
    jobId: uuid("job_id"),
    moduleKey: text("module_key").notNull(),
    // attention | blocked | approval
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    // open | snoozed | resolved
    state: text("state").notNull().default("open"),
    title: jsonb("title").notNull(),
    effect: jsonb("effect").notNull(),
    ctaHref: text("cta_href").notNull(),
    ctaLabel: jsonb("cta_label").notNull(),
    assigneeUserId: uuid("assignee_user_id").references(() => appUser.id),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("attention_item", t),
    unique("attention_item_subject_uq").on(t.tenantId, t.ruleId, t.subjectKey),
  ]
)
