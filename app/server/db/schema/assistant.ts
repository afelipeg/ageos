import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

import { createdAt, pk, updatedAt } from "./columns"
import { appUser } from "./platform"
import { tenantId, tenantUnique } from "./tenant"

// Assistant persistence. Conversations are private to (tenant, owner user).
// The server owns history: the browser only submits new user turns, preset
// ids and confirmation clicks bound to proposal ids/revisions.

export const assistantConversation = pgTable(
  "assistant_conversation",
  {
    id: pk(),
    tenantId: tenantId(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => appUser.id),
    // agency (control/ops scopes are separate surfaces)
    scope: text("scope").notNull().default("agency"),
    title: text("title").notNull(),
    // active | archived
    state: text("state").notNull().default("active"),
    schemaVersion: text("schema_version").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantUnique("assistant_conversation", t),
    index("assistant_conversation_owner_idx").on(
      t.tenantId,
      t.ownerUserId,
      t.updatedAt
    ),
  ]
)

export const assistantMessage = pgTable(
  "assistant_message",
  {
    id: pk(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id").notNull(),
    // user | assistant
    role: text("role").notNull(),
    // Typed parts rendered by an allowlisted renderer (never raw HTML/JSX).
    parts: jsonb("parts").notNull(),
    sequence: integer("sequence").notNull(),
    // complete | cancelled
    status: text("status").notNull().default("complete"),
    actorUserId: uuid("actor_user_id").references(() => appUser.id),
    clientMessageId: text("client_message_id"),
    runId: uuid("run_id"),
    schemaVersion: text("schema_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("assistant_message", t),
    unique("assistant_message_seq_uq").on(
      t.tenantId,
      t.conversationId,
      t.sequence
    ),
    unique("assistant_message_client_uq").on(
      t.tenantId,
      t.conversationId,
      t.clientMessageId
    ),
    foreignKey({
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [assistantConversation.tenantId, assistantConversation.id],
    }),
  ]
)

export const assistantRun = pgTable(
  "assistant_run",
  {
    id: pk(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id").notNull(),
    triggeringMessageId: uuid("triggering_message_id"),
    scenarioId: text("scenario_id").notNull(),
    scenarioVersion: text("scenario_version").notNull(),
    currentStep: text("current_step"),
    // queued | running | waiting_input | waiting_confirmation | waiting_approval |
    // completed | failed | cancelled | interrupted | blocked
    status: text("status").notNull(),
    // Scenario working state: validated params and results of executed steps.
    state: jsonb("state").notNull().default({}),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => appUser.id),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  },
  (t) => [
    tenantUnique("assistant_run", t),
    // One active run per conversation.
    uniqueIndex("assistant_run_one_active_uq")
      .on(t.tenantId, t.conversationId)
      .where(
        sql`${t.status} in ('queued','running','waiting_input','waiting_confirmation','waiting_approval')`
      ),
    foreignKey({
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [assistantConversation.tenantId, assistantConversation.id],
    }),
  ]
)

export const assistantDelegation = pgTable(
  "assistant_delegation",
  {
    id: pk(),
    tenantId: tenantId(),
    parentRunId: uuid("parent_run_id").notNull(),
    // Child workflow run executed by the specialist handler.
    childWorkflowRunId: uuid("child_workflow_run_id"),
    subagentKey: text("subagent_key").notNull(),
    skillIds: text("skill_ids").array().notNull(),
    objective: text("objective").notNull(),
    effectivePermissions: text("effective_permissions").array().notNull(),
    simulation: text("simulation").notNull().default("scripted_simulation"),
    state: text("state").notNull(),
    result: jsonb("result"),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("assistant_delegation", t),
    foreignKey({
      columns: [t.tenantId, t.parentRunId],
      foreignColumns: [assistantRun.tenantId, assistantRun.id],
    }),
  ]
)

export const assistantContextSnapshot = pgTable(
  "assistant_context_snapshot",
  {
    id: pk(),
    tenantId: tenantId(),
    runId: uuid("run_id").notNull(),
    route: text("route").notNull(),
    moduleKey: text("module_key"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    entityRevision: integer("entity_revision"),
    filters: jsonb("filters").notNull().default({}),
    locale: text("locale").notNull(),
    asOf: text("as_of").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("assistant_context_snapshot", t),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [assistantRun.tenantId, assistantRun.id],
    }),
  ]
)

export const assistantToolCall = pgTable(
  "assistant_tool_call",
  {
    id: pk(),
    tenantId: tenantId(),
    runId: uuid("run_id").notNull(),
    callId: text("call_id").notNull(),
    toolFamily: text("tool_family").notNull(),
    skillId: text("skill_id"),
    handler: text("handler").notNull(),
    handlerVersion: text("handler_version").notNull(),
    input: jsonb("input").notNull(),
    proposalId: uuid("proposal_id"),
    commandId: text("command_id"),
    operationId: uuid("operation_id"),
    // succeeded | failed | blocked
    status: text("status").notNull(),
    result: jsonb("result"),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("assistant_tool_call", t),
    unique("assistant_tool_call_uq").on(t.tenantId, t.runId, t.callId),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [assistantRun.tenantId, assistantRun.id],
    }),
  ]
)

export const assistantSourceReference = pgTable(
  "assistant_source_reference",
  {
    id: pk(),
    tenantId: tenantId(),
    runId: uuid("run_id").notNull(),
    messageId: uuid("message_id"),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    recordRevision: integer("record_revision"),
    asOf: text("as_of").notNull(),
    basis: text("basis"),
    currency: text("currency"),
    href: text("href").notNull(),
    label: text("label").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("assistant_source_reference", t),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [assistantRun.tenantId, assistantRun.id],
    }),
  ]
)

export const assistantRunEvent = pgTable(
  "assistant_run_event",
  {
    id: pk(),
    tenantId: tenantId(),
    runId: uuid("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    stepId: text("step_id").notNull(),
    stepType: text("step_type").notNull(),
    // started | succeeded | waiting | blocked | failed | cancelled
    outcome: text("outcome").notNull(),
    detail: jsonb("detail").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("assistant_run_event", t),
    unique("assistant_run_event_seq_uq").on(t.tenantId, t.runId, t.sequence),
    foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [assistantRun.tenantId, assistantRun.id],
    }),
  ]
)
