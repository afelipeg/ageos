CREATE TABLE "agency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fixture_key" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"app_name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"base_currency" text NOT NULL,
	"timezone" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"published_config_revision_id" uuid,
	"requested_domain" text,
	"domain_state" text DEFAULT 'none' NOT NULL,
	"demo_seed_version" text,
	"created_by" uuid,
	"create_idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agency_fixture_key_unique" UNIQUE("fixture_key"),
	CONSTRAINT "agency_slug_unique" UNIQUE("slug"),
	CONSTRAINT "agency_create_idempotency_key_unique" UNIQUE("create_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "app_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"presenter_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "app_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fixture_key" text,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"kind" text DEFAULT 'agency' NOT NULL,
	"platform_role" text,
	"demo_persona" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_fixture_key_unique" UNIQUE("fixture_key"),
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "capability_definition" (
	"skill_id" text PRIMARY KEY NOT NULL,
	"module_key" text NOT NULL,
	"action_id" text NOT NULL,
	"specialist_key" text NOT NULL,
	"handler_version" text NOT NULL,
	"dependencies" text[] NOT NULL,
	"calculator_dependencies" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" uuid,
	"tenant_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"configuration_revision_id" uuid NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activation_run_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "activation_run_idem_uq" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "activation_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"step_key" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "activation_step_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "activation_step_seq_uq" UNIQUE("tenant_id","run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "configuration_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"schema_version" text NOT NULL,
	"agency_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"operations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brand_access" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled_capabilities" text[] NOT NULL,
	"approval_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_completed_step" integer DEFAULT 0 NOT NULL,
	"validation" jsonb,
	"created_by" uuid,
	"approved_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "configuration_revision_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "configuration_revision_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"mode" text DEFAULT 'simulated' NOT NULL,
	"account_alias" text NOT NULL,
	"scopes" text[] NOT NULL,
	"state" text NOT NULL,
	"owner_user_id" uuid,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "connection_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "connection_provider_account_uq" UNIQUE("tenant_id","provider","account_alias")
);
--> statement-breakpoint
CREATE TABLE "legal_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"fiscal_profile_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_entity_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "brief" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"services" text[] NOT NULL,
	"evidence_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "brief_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "budget_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"budget_scope" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"purpose" text NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_reservation_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "budget_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"agency_fee_minor" bigint NOT NULL,
	"managed_media_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text,
	"supersedes_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_revision_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "budget_revision_number_uq" UNIQUE("tenant_id","job_id","number")
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"legal_entity_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"product_code" text NOT NULL,
	"billing_currency" text NOT NULL,
	"credit_limit_minor" bigint DEFAULT 0 NOT NULL,
	"country" text NOT NULL,
	"fiscal_profile" text NOT NULL,
	"owner_user_id" uuid,
	"state" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "client_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "client_code_uq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"job_id" uuid,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"revision_number" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"evidence_id" uuid,
	"valid_from" date,
	"valid_to" date,
	"supersedes_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contract_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "contract_reference_rev_uq" UNIQUE("tenant_id","reference","revision_number")
);
--> statement-breakpoint
CREATE TABLE "cost_estimate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"state" text DEFAULT 'current' NOT NULL,
	"reason" text,
	"currency" text NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cost_estimate_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "cost_estimate_number_uq" UNIQUE("tenant_id","job_id","number")
);
--> statement-breakpoint
CREATE TABLE "cost_estimate_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"line_type" text NOT NULL,
	"description" text NOT NULL,
	"minutes" integer,
	"hourly_cost_minor" bigint,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"supplier_id" uuid,
	CONSTRAINT "cost_estimate_line_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"job_number" text NOT NULL,
	"display_reference" text NOT NULL,
	"job_type" text NOT NULL,
	"billing_code" text NOT NULL,
	"year" integer NOT NULL,
	"sequence" integer NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"owner_user_id" uuid,
	"period" text NOT NULL,
	"currency" text NOT NULL,
	"services" text[] NOT NULL,
	"reporting_group" text DEFAULT 'primary' NOT NULL,
	"close_reason" text,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "job_number_uq" UNIQUE("tenant_id","job_number"),
	CONSTRAINT "job_display_reference_uq" UNIQUE("tenant_id","display_reference")
);
--> statement-breakpoint
CREATE TABLE "media_plan_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_revision_id" uuid NOT NULL,
	"line_key" text NOT NULL,
	"channel" text NOT NULL,
	"placement" text NOT NULL,
	"provider" text NOT NULL,
	"account_alias" text,
	"quantity" integer,
	"unit_cost_minor" bigint,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"simulation" text DEFAULT 'simulated' NOT NULL,
	CONSTRAINT "media_plan_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "media_plan_line_key_uq" UNIQUE("tenant_id","plan_revision_id","line_key")
);
--> statement-breakpoint
CREATE TABLE "media_plan_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"total_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"objective" text NOT NULL,
	"approved_by" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "media_plan_revision_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "media_plan_revision_number_uq" UNIQUE("tenant_id","job_id","number")
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "timesheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"job_id" uuid NOT NULL,
	"user_id" uuid,
	"task_label" text NOT NULL,
	"work_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"hourly_cost_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "timesheet_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "action_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"skill_id" text,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid,
	"base_revision" integer,
	"payload" jsonb NOT NULL,
	"payload_digest" text NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"impact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"origin" text NOT NULL,
	"conversation_id" uuid,
	"run_id" uuid,
	"created_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"executed_command_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "action_proposal_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "adapter_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_alias" text NOT NULL,
	"operation_type" text NOT NULL,
	"approved_action_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_digest" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text NOT NULL,
	"failure_mode" text DEFAULT 'success' NOT NULL,
	"receipt_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adapter_operation_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "adapter_operation_idem_uq" UNIQUE("tenant_id","provider","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "approval_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" text,
	"payload_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decision_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_revision" integer NOT NULL,
	"payload_digest" text NOT NULL,
	"amount_minor" bigint,
	"currency" text,
	"destination" text,
	"policy_id" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"eligible_roles" text[] NOT NULL,
	"requested_by" uuid NOT NULL,
	"state" text DEFAULT 'awaiting_approval' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "approval_request_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "attention_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"subject_key" text NOT NULL,
	"job_id" uuid,
	"module_key" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"title" jsonb NOT NULL,
	"effect" jsonb NOT NULL,
	"cta_href" text NOT NULL,
	"cta_label" jsonb NOT NULL,
	"assignee_user_id" uuid,
	"snoozed_until" timestamp with time zone,
	"due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "attention_item_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "attention_item_subject_uq" UNIQUE("tenant_id","rule_id","subject_key")
);
--> statement-breakpoint
CREATE TABLE "business_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" bigserial NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid,
	"aggregate_revision" integer,
	"actor_user_id" uuid,
	"origin" text NOT NULL,
	"command_type" text,
	"command_id" text,
	"correlation_id" text,
	"job_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"business_effective_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_event_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "demo_provider_effect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"receipt_id" text NOT NULL,
	"effect" jsonb NOT NULL,
	"simulation" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_provider_effect_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "demo_provider_effect_idem_uq" UNIQUE("tenant_id","provider","idempotency_key"),
	CONSTRAINT "demo_provider_effect_receipt_uq" UNIQUE("tenant_id","receipt_id")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"file_id" uuid,
	"synthetic" boolean DEFAULT true NOT NULL,
	"review_state" text DEFAULT 'received' NOT NULL,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"status" text NOT NULL,
	"response" jsonb NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_record_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "idempotency_key_uq" UNIQUE("tenant_id","command_type","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "outbox_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_message_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"handler_version" text NOT NULL,
	"job_id" uuid,
	"state" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"origin" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"idempotency_key" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "workflow_run_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "workflow_run_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"step_key" text NOT NULL,
	"state" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "workflow_run_step_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workflow_run_step_seq_uq" UNIQUE("tenant_id","run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "assistant_context_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"route" text NOT NULL,
	"module_key" text,
	"entity_type" text,
	"entity_id" uuid,
	"entity_revision" integer,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locale" text NOT NULL,
	"as_of" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_context_snapshot_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "assistant_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"scope" text DEFAULT 'agency' NOT NULL,
	"title" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_conversation_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "assistant_delegation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_run_id" uuid NOT NULL,
	"child_workflow_run_id" uuid,
	"subagent_key" text NOT NULL,
	"skill_ids" text[] NOT NULL,
	"objective" text NOT NULL,
	"effective_permissions" text[] NOT NULL,
	"simulation" text DEFAULT 'scripted_simulation' NOT NULL,
	"state" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_delegation_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "assistant_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"actor_user_id" uuid,
	"client_message_id" text,
	"run_id" uuid,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_message_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "assistant_message_seq_uq" UNIQUE("tenant_id","conversation_id","sequence"),
	CONSTRAINT "assistant_message_client_uq" UNIQUE("tenant_id","conversation_id","client_message_id")
);
--> statement-breakpoint
CREATE TABLE "assistant_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"triggering_message_id" uuid,
	"scenario_id" text NOT NULL,
	"scenario_version" text NOT NULL,
	"current_step" text,
	"status" text NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	CONSTRAINT "assistant_run_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "assistant_run_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"step_id" text NOT NULL,
	"step_type" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_run_event_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "assistant_run_event_seq_uq" UNIQUE("tenant_id","run_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "assistant_source_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"message_id" uuid,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"record_revision" integer,
	"as_of" text NOT NULL,
	"basis" text,
	"currency" text,
	"href" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_source_reference_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "assistant_tool_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"call_id" text NOT NULL,
	"tool_family" text NOT NULL,
	"skill_id" text,
	"handler" text NOT NULL,
	"handler_version" text NOT NULL,
	"input" jsonb NOT NULL,
	"proposal_id" uuid,
	"command_id" text,
	"operation_id" uuid,
	"status" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_tool_call_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "assistant_tool_call_uq" UNIQUE("tenant_id","run_id","call_id")
);
--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"logical_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"job_id" uuid,
	"original_name" text NOT NULL,
	"format" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"extraction_status" text DEFAULT 'stored' NOT NULL,
	"extraction" jsonb,
	"synthetic" text DEFAULT 'uploaded' NOT NULL,
	"visibility" text DEFAULT 'private_agency' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_object_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "file_object_version_uq" UNIQUE("tenant_id","logical_id","version")
);
--> statement-breakpoint
CREATE TABLE "import_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_key" text NOT NULL,
	"delimiter" text NOT NULL,
	"expected_headers" text[] NOT NULL,
	"profile_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "import_profile_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_profile_key_uq" UNIQUE("tenant_id","profile_key")
);
--> statement-breakpoint
CREATE TABLE "platform_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_digest" text NOT NULL,
	"target_profile_revision" integer NOT NULL,
	"state" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"verification" jsonb,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "platform_change_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "platform_incident" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_key" text NOT NULL,
	"state" text NOT NULL,
	"title" jsonb NOT NULL,
	"file_id" uuid,
	"profile_id" uuid NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "platform_incident_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "platform_incident_key_uq" UNIQUE("tenant_id","incident_key")
);
--> statement-breakpoint
ALTER TABLE "agency" ADD CONSTRAINT "agency_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session" ADD CONSTRAINT "app_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session" ADD CONSTRAINT "app_session_presenter_user_id_app_user_id_fk" FOREIGN KEY ("presenter_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_event" ADD CONSTRAINT "platform_audit_event_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_event" ADD CONSTRAINT "platform_audit_event_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_run" ADD CONSTRAINT "activation_run_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_run" ADD CONSTRAINT "activation_run_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_run" ADD CONSTRAINT "activation_run_tenant_id_configuration_revision_id_configuration_revision_tenant_id_id_fk" FOREIGN KEY ("tenant_id","configuration_revision_id") REFERENCES "public"."configuration_revision"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_step" ADD CONSTRAINT "activation_step_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_step" ADD CONSTRAINT "activation_step_tenant_id_run_id_activation_run_tenant_id_id_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."activation_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD CONSTRAINT "configuration_revision_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD CONSTRAINT "configuration_revision_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD CONSTRAINT "configuration_revision_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief" ADD CONSTRAINT "brief_tenant_id_client_id_client_tenant_id_id_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."client"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation" ADD CONSTRAINT "budget_reservation_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation" ADD CONSTRAINT "budget_reservation_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation" ADD CONSTRAINT "budget_reservation_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation" ADD CONSTRAINT "budget_reservation_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_revision" ADD CONSTRAINT "budget_revision_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_revision" ADD CONSTRAINT "budget_revision_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_revision" ADD CONSTRAINT "budget_revision_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_revision" ADD CONSTRAINT "budget_revision_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_revision" ADD CONSTRAINT "budget_revision_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_tenant_id_legal_entity_id_legal_entity_tenant_id_id_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entity"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_tenant_id_client_id_client_tenant_id_id_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."client"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_estimate" ADD CONSTRAINT "cost_estimate_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_estimate" ADD CONSTRAINT "cost_estimate_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_estimate" ADD CONSTRAINT "cost_estimate_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_estimate" ADD CONSTRAINT "cost_estimate_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_estimate_line" ADD CONSTRAINT "cost_estimate_line_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_estimate_line" ADD CONSTRAINT "cost_estimate_line_tenant_id_estimate_id_cost_estimate_tenant_id_id_fk" FOREIGN KEY ("tenant_id","estimate_id") REFERENCES "public"."cost_estimate"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_tenant_id_client_id_client_tenant_id_id_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."client"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_line" ADD CONSTRAINT "media_plan_line_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_line" ADD CONSTRAINT "media_plan_line_tenant_id_plan_revision_id_media_plan_revision_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plan_revision_id") REFERENCES "public"."media_plan_revision"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_revision" ADD CONSTRAINT "media_plan_revision_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_revision" ADD CONSTRAINT "media_plan_revision_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_revision" ADD CONSTRAINT "media_plan_revision_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_revision" ADD CONSTRAINT "media_plan_revision_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plan_revision" ADD CONSTRAINT "media_plan_revision_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal" ADD CONSTRAINT "action_proposal_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal" ADD CONSTRAINT "action_proposal_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal" ADD CONSTRAINT "action_proposal_confirmed_by_app_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adapter_operation" ADD CONSTRAINT "adapter_operation_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decision" ADD CONSTRAINT "approval_decision_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decision" ADD CONSTRAINT "approval_decision_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decision" ADD CONSTRAINT "approval_decision_tenant_id_approval_id_approval_request_tenant_id_id_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approval_request"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_tenant_id_proposal_id_action_proposal_tenant_id_id_fk" FOREIGN KEY ("tenant_id","proposal_id") REFERENCES "public"."action_proposal"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_item" ADD CONSTRAINT "attention_item_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_item" ADD CONSTRAINT "attention_item_assignee_user_id_app_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_event" ADD CONSTRAINT "business_event_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_event" ADD CONSTRAINT "business_event_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_provider_effect" ADD CONSTRAINT "demo_provider_effect_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_reviewed_by_app_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_message" ADD CONSTRAINT "outbox_message_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_step" ADD CONSTRAINT "workflow_run_step_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_step" ADD CONSTRAINT "workflow_run_step_tenant_id_run_id_workflow_run_tenant_id_id_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."workflow_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_context_snapshot" ADD CONSTRAINT "assistant_context_snapshot_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_context_snapshot" ADD CONSTRAINT "assistant_context_snapshot_tenant_id_run_id_assistant_run_tenant_id_id_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."assistant_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_delegation" ADD CONSTRAINT "assistant_delegation_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_delegation" ADD CONSTRAINT "assistant_delegation_tenant_id_parent_run_id_assistant_run_tenant_id_id_fk" FOREIGN KEY ("tenant_id","parent_run_id") REFERENCES "public"."assistant_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_tenant_id_conversation_id_assistant_conversation_tenant_id_id_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."assistant_conversation"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_run" ADD CONSTRAINT "assistant_run_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_run" ADD CONSTRAINT "assistant_run_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_run" ADD CONSTRAINT "assistant_run_tenant_id_conversation_id_assistant_conversation_tenant_id_id_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."assistant_conversation"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_run_event" ADD CONSTRAINT "assistant_run_event_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_run_event" ADD CONSTRAINT "assistant_run_event_tenant_id_run_id_assistant_run_tenant_id_id_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."assistant_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_source_reference" ADD CONSTRAINT "assistant_source_reference_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_source_reference" ADD CONSTRAINT "assistant_source_reference_tenant_id_run_id_assistant_run_tenant_id_id_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."assistant_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_tool_call" ADD CONSTRAINT "assistant_tool_call_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_tool_call" ADD CONSTRAINT "assistant_tool_call_tenant_id_run_id_assistant_run_tenant_id_id_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."assistant_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profile" ADD CONSTRAINT "import_profile_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_change" ADD CONSTRAINT "platform_change_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_change" ADD CONSTRAINT "platform_change_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_change" ADD CONSTRAINT "platform_change_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_change" ADD CONSTRAINT "platform_change_tenant_id_incident_id_platform_incident_tenant_id_id_fk" FOREIGN KEY ("tenant_id","incident_id") REFERENCES "public"."platform_incident"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_incident" ADD CONSTRAINT "platform_incident_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_incident" ADD CONSTRAINT "platform_incident_tenant_id_profile_id_import_profile_tenant_id_id_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "public"."import_profile"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_session_user_idx" ON "app_session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_user_tenant_uq" ON "membership" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "platform_audit_event_seq_idx" ON "platform_audit_event" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "connection_tenant_idx" ON "connection" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "budget_reservation_job_idx" ON "budget_reservation" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "job_client_idx" ON "job" USING btree ("tenant_id","client_id");--> statement-breakpoint
CREATE INDEX "approval_request_state_idx" ON "approval_request" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "business_event_aggregate_idx" ON "business_event" USING btree ("tenant_id","aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "business_event_job_idx" ON "business_event" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_message" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "workflow_run_skill_idx" ON "workflow_run" USING btree ("tenant_id","skill_id");--> statement-breakpoint
CREATE INDEX "assistant_conversation_owner_idx" ON "assistant_conversation" USING btree ("tenant_id","owner_user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_run_one_active_uq" ON "assistant_run" USING btree ("tenant_id","conversation_id") WHERE "assistant_run"."status" in ('queued','running','waiting_input','waiting_confirmation','waiting_approval');--> statement-breakpoint
CREATE INDEX "file_object_job_idx" ON "file_object" USING btree ("tenant_id","job_id");