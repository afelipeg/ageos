CREATE TABLE "demo_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed_version" text NOT NULL,
	"checkpoint" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"business_date" date NOT NULL,
	"tenant_ids" uuid[] NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"revision" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "display_reference_counter" (
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "display_reference_counter_tenant_id_year_pk" PRIMARY KEY("tenant_id","year")
);
--> statement-breakpoint
CREATE TABLE "import_profile_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_revision" integer NOT NULL,
	"delimiter" text NOT NULL,
	"expected_headers" text[] NOT NULL,
	"change_id" uuid,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_profile_revision_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "import_profile_revision_uq" UNIQUE("tenant_id","profile_id","profile_revision")
);
--> statement-breakpoint
CREATE TABLE "billing_readiness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"job_revision" integer NOT NULL,
	"ready" boolean NOT NULL,
	"digest" text NOT NULL,
	"requirements" jsonb NOT NULL,
	"evidence_pins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deliverable_accepted" boolean NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_readiness_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "billing_readiness_digest_uq" UNIQUE("tenant_id","job_id","digest")
);
--> statement-breakpoint
CREATE TABLE "fee_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"budget_revision_id" uuid NOT NULL,
	"proposal_id" uuid,
	"state" text DEFAULT 'proposed' NOT NULL,
	"contract_kind" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"settlement" jsonb,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "fee_schedule_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "fee_schedule_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"instalment_number" integer NOT NULL,
	"month" text NOT NULL,
	"share" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "fee_schedule_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fee_schedule_line_uq" UNIQUE("tenant_id","schedule_id","instalment_number","share")
);
--> statement-breakpoint
CREATE TABLE "master_external_ref" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_key" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_external_ref_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "master_external_ref_uq" UNIQUE("tenant_id","record_type","provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "member_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"effective_scope" text DEFAULT 'agency_wide' NOT NULL,
	"expense_approval_cap_minor" bigint,
	"currency" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "member_access_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "member_access_user_uq" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "readiness_checkpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"job_revision" integer NOT NULL,
	"approved_plan_revision" integer,
	"digest" text NOT NULL,
	"next_stage" text NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readiness_checkpoint_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "readiness_checkpoint_digest_uq" UNIQUE("tenant_id","job_id","digest")
);
--> statement-breakpoint
CREATE TABLE "audience_estimate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"vehicle_key" text NOT NULL,
	"vehicle_label" text NOT NULL,
	"channel" text NOT NULL,
	"supplier_id" uuid,
	"universe" bigint NOT NULL,
	"spot_ratings" jsonb NOT NULL,
	"reach_hundredths" integer,
	"net_cost_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "audience_estimate_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "audience_estimate_vehicle_uq" UNIQUE("tenant_id","source_id","vehicle_key")
);
--> statement-breakpoint
CREATE TABLE "audience_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"source_key" text NOT NULL,
	"version" text NOT NULL,
	"as_of" date NOT NULL,
	"geography" text NOT NULL,
	"channel" text NOT NULL,
	"methodology" text NOT NULL,
	"license_status" text NOT NULL,
	"audience_base" text NOT NULL,
	"audience_label" text NOT NULL,
	"file_id" uuid,
	"synthetic" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audience_source_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "audience_source_version_uq" UNIQUE("tenant_id","source_key","version")
);
--> statement-breakpoint
CREATE TABLE "broadcast_reconciliation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"monitoring_file_id" uuid NOT NULL,
	"monitoring_sha256" text NOT NULL,
	"ordered_spots" integer NOT NULL,
	"matched_spots" integer NOT NULL,
	"missing_spots" integer NOT NULL,
	"duplicate_records" integer NOT NULL,
	"extra_records" integer NOT NULL,
	"tolerance_spots" integer NOT NULL,
	"status" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_reconciliation_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "broadcast_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"plan_line_id" uuid,
	"medium" text NOT NULL,
	"spot_count" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"unit_cost_minor" bigint NOT NULL,
	"gross_minor" bigint NOT NULL,
	"net_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"flight_start" date NOT NULL,
	"flight_end" date NOT NULL,
	"timezone" text NOT NULL,
	"state" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "broadcast_schedule_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "broadcast_spot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"spot_key" text NOT NULL,
	"air_date" date NOT NULL,
	"daypart" text NOT NULL,
	"window_start" text NOT NULL,
	"window_end" text NOT NULL,
	"material_id" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	CONSTRAINT "broadcast_spot_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "broadcast_spot_key_uq" UNIQUE("tenant_id","schedule_id","spot_key")
);
--> statement-breakpoint
CREATE TABLE "broadcast_station" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"medium" text NOT NULL,
	"timezone" text NOT NULL,
	"supplier_id" uuid,
	"accepted_durations" integer[] NOT NULL,
	"dayparts" jsonb NOT NULL,
	"synthetic" boolean DEFAULT true NOT NULL,
	CONSTRAINT "broadcast_station_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "broadcast_station_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "broadcast_station_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"plan_revision_id" uuid NOT NULL,
	"plan_line_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_alias" text NOT NULL,
	"name" text NOT NULL,
	"budget_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"creative_file_id" uuid NOT NULL,
	"state" text NOT NULL,
	"approval_id" uuid,
	"adapter_operation_id" uuid,
	"receipt_id" text,
	"external_id" text,
	"preflight" jsonb NOT NULL,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "campaign_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "make_good" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"spot_key" text NOT NULL,
	"original_air_date" date NOT NULL,
	"state" text NOT NULL,
	"cash_cost_change_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "make_good_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "make_good_spot_uq" UNIQUE("tenant_id","reconciliation_id","spot_key")
);
--> statement-breakpoint
CREATE TABLE "ooh_face" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"face_key" text NOT NULL,
	"site" text NOT NULL,
	"format" text NOT NULL,
	"operator_id" uuid NOT NULL,
	"synthetic" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ooh_face_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "ooh_face_key_uq" UNIQUE("tenant_id","face_key")
);
--> statement-breakpoint
CREATE TABLE "ooh_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"site" text NOT NULL,
	"faces" integer NOT NULL,
	"unit_rate_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"flight_start" date NOT NULL,
	"flight_end" date NOT NULL,
	"evidence_type" text NOT NULL,
	"state" text NOT NULL,
	"booking_proposals" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ooh_plan_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "ooh_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"face_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"plan_line_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"state" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ooh_reservation_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "placement_spec" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"placement" text NOT NULL,
	"version" text NOT NULL,
	"as_of" date NOT NULL,
	"source" text NOT NULL,
	"allowed_formats" text[] NOT NULL,
	"aspect_ratios" text[] NOT NULL,
	"min_width" integer NOT NULL,
	"max_duration_seconds" integer,
	"max_size_bytes" integer NOT NULL,
	"synthetic" boolean DEFAULT true NOT NULL,
	CONSTRAINT "placement_spec_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "placement_spec_uq" UNIQUE("tenant_id","provider","placement","version")
);
--> statement-breakpoint
CREATE TABLE "production_deliverable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"asset_file_id" uuid NOT NULL,
	"delivery_date" date NOT NULL,
	"quality_result" text NOT NULL,
	"qc_notes" text,
	"rights_cleared" boolean NOT NULL,
	"rights_basis" text NOT NULL,
	"state" text NOT NULL,
	"production_order_id" uuid,
	"delivery_id" uuid,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "production_deliverable_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "production_deliverable_version_uq" UNIQUE("tenant_id","job_id","name","version")
);
--> statement-breakpoint
CREATE TABLE "rate_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"supplier_id" uuid NOT NULL,
	"medium" text NOT NULL,
	"number" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"gross_rate_minor" bigint NOT NULL,
	"discounts_bps" integer[] NOT NULL,
	"net_rate_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"state" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"decision_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_card_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "rate_card_number_uq" UNIQUE("tenant_id","supplier_id","medium","number")
);
--> statement-breakpoint
CREATE TABLE "simulation_directive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"operation_type" text NOT NULL,
	"failure_mode" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"consumed_by_operation_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simulation_directive_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "usage_right" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"file_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"synthetic" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_right_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "accounting_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"job_id" uuid,
	"period" text NOT NULL,
	"business_date" date NOT NULL,
	"currency" text NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"journal_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'awaiting_approval' NOT NULL,
	"reporting_group" text DEFAULT 'primary' NOT NULL,
	"approval_id" uuid,
	"journal_entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reversal_date" date,
	"prepared_by" uuid,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "accounting_adjustment_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "accounting_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"close_snapshot" jsonb,
	"reopen_reason" text,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "accounting_period_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "accounting_period_uq" UNIQUE("tenant_id","period")
);
--> statement-breakpoint
CREATE TABLE "bank_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"reporting_group" text DEFAULT 'primary' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "bank_account_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_account_connection_uq" UNIQUE("tenant_id","connection_id")
);
--> statement-breakpoint
CREATE TABLE "bank_statement_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"file_sha256" text NOT NULL,
	"statement_date" date NOT NULL,
	"closing_balance_minor" bigint NOT NULL,
	"book_balance_minor" bigint NOT NULL,
	"difference_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statement_import_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "bank_statement_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"line_id" text NOT NULL,
	"business_date" date NOT NULL,
	"direction" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reference" text NOT NULL,
	"outcome" text NOT NULL,
	"bank_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statement_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_statement_line_uq" UNIQUE("tenant_id","bank_account_id","line_id")
);
--> statement-breakpoint
CREATE TABLE "bank_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"business_date" date NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"provider_receipt_id" text NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"state" text DEFAULT 'confirmed' NOT NULL,
	"statement_line_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transaction_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_transaction_receipt_uq" UNIQUE("tenant_id","bank_account_id","provider_receipt_id")
);
--> statement-breakpoint
CREATE TABLE "client_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"number" text,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"period" text NOT NULL,
	"currency" text NOT NULL,
	"fee_minor" bigint NOT NULL,
	"media_recovery_minor" bigint NOT NULL,
	"net_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"gross_minor" bigint NOT NULL,
	"tax_profile" text NOT NULL,
	"state" text NOT NULL,
	"requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"po_number" text,
	"notes" text,
	"collected_minor" bigint DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"prepared_by" uuid,
	"approved_by" uuid,
	"approval_id" uuid,
	"journal_entry_id" uuid,
	"document_file_id" uuid,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "client_invoice_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "client_invoice_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "client_invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"line_type" text NOT NULL,
	"treatment" text NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "client_invoice_line_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_receipt_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"receipt_date" date NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"allocated_minor" bigint NOT NULL,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "collection_receipt_uq" UNIQUE("tenant_id","bank_account_id","provider_receipt_id")
);
--> statement-breakpoint
CREATE TABLE "collection_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_allocation_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "collection_allocation_uq" UNIQUE("tenant_id","collection_id","invoice_id")
);
--> statement-breakpoint
CREATE TABLE "depreciation_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"month" text NOT NULL,
	"charge_minor" bigint NOT NULL,
	"accumulated_minor" bigint NOT NULL,
	"net_book_minor" bigint NOT NULL,
	"state" text DEFAULT 'scheduled' NOT NULL,
	"adjustment_id" uuid,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depreciation_entry_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "depreciation_month_uq" UNIQUE("tenant_id","asset_id","month")
);
--> statement-breakpoint
CREATE TABLE "expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"claimant_user_id" uuid NOT NULL,
	"receipt_file_id" uuid NOT NULL,
	"expense_date" date NOT NULL,
	"period" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"receipt_check" text NOT NULL,
	"receipt_check_detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text NOT NULL,
	"submitted_by" uuid NOT NULL,
	"approved_by" uuid,
	"approval_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "expense_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "fixed_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"job_id" uuid,
	"cost_minor" bigint NOT NULL,
	"residual_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"life_months" integer NOT NULL,
	"start_date" date NOT NULL,
	"method" text NOT NULL,
	"state" text DEFAULT 'registered' NOT NULL,
	"reporting_group" text DEFAULT 'primary' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "fixed_asset_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fixed_asset_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "fx_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate_micro" bigint NOT NULL,
	"rate_date" date NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rate_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fx_rate_uq" UNIQUE("tenant_id","base_currency","quote_currency","rate_date")
);
--> statement-breakpoint
CREATE TABLE "journal_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" bigserial NOT NULL,
	"entry_key" text NOT NULL,
	"rule_key" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"job_id" uuid,
	"period" text NOT NULL,
	"business_date" date NOT NULL,
	"currency" text NOT NULL,
	"memo" text NOT NULL,
	"ledger_label" text NOT NULL,
	"state" text DEFAULT 'posted' NOT NULL,
	"reporting_group" text DEFAULT 'primary' NOT NULL,
	"prepared_by" uuid,
	"approved_by" uuid,
	"approval_id" uuid,
	"reverses_id" uuid,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entry_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "journal_entry_key_uq" UNIQUE("tenant_id","entry_key")
);
--> statement-breakpoint
CREATE TABLE "journal_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_code" text NOT NULL,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"job_id" uuid,
	CONSTRAINT "journal_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "journal_line_no_uq" UNIQUE("tenant_id","entry_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "ledger_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"account_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_account_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_account_code_uq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "management_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"period" text NOT NULL,
	"basis" text NOT NULL,
	"currency" text NOT NULL,
	"cut_off" date NOT NULL,
	"snapshot_seq" integer NOT NULL,
	"definitions" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"export_file_id" uuid,
	"synthetic" boolean DEFAULT true NOT NULL,
	"label" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_report_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"category" text NOT NULL,
	"job_id" uuid,
	"payee" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"state" text NOT NULL,
	"adapter_operation_id" uuid,
	"receipt_id" text,
	"bank_transaction_id" uuid,
	"journal_entry_id" uuid,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"business_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payment_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_batch_seq_uq" UNIQUE("tenant_id","batch_id","seq")
);
--> statement-breakpoint
CREATE TABLE "payment_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"payment_date" date NOT NULL,
	"due_through" date NOT NULL,
	"payment_method" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"job_id" uuid,
	"state" text NOT NULL,
	"proposal_id" uuid,
	"approval_id" uuid,
	"prepared_by" uuid,
	"approved_by" uuid,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payment_batch_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_batch_reference_uq" UNIQUE("tenant_id","reference")
);
--> statement-breakpoint
CREATE TABLE "payment_hold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_hold_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_hold_payment_uq" UNIQUE("tenant_id","payment_id")
);
--> statement-breakpoint
CREATE TABLE "rebate_agreement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"supplier_id" uuid NOT NULL,
	"name" text NOT NULL,
	"method" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"brackets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_share_bps" integer NOT NULL,
	"exclusions" text[] DEFAULT '{}'::text[] NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rebate_agreement_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "rebate_calculation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"period" text NOT NULL,
	"eligible_base_minor" bigint NOT NULL,
	"rebate_minor" bigint NOT NULL,
	"client_return_minor" bigint NOT NULL,
	"agency_retained_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text NOT NULL,
	"adjustment_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rebate_calculation_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "recognition_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"category" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"adjustment_id" uuid,
	"period" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recognition_record_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "recognition_source_uq" UNIQUE("tenant_id","category","source_type","source_id")
);
--> statement-breakpoint
CREATE TABLE "revenue_budget_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"scenario_name" text NOT NULL,
	"client_id" uuid,
	"job_id" uuid,
	"period_from" text NOT NULL,
	"period_to" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"allocation_driver" text NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version_number" integer NOT NULL,
	"state" text NOT NULL,
	"based_on_id" uuid,
	"approval_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "revenue_budget_version_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "revenue_budget_version_uq" UNIQUE("tenant_id","scenario_name","version_number")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"cost_category" text NOT NULL,
	"order_id" uuid,
	"invoice_number" text NOT NULL,
	"duplicate_key" text NOT NULL,
	"currency" text NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"period" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"match_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hold_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"document_revision" integer DEFAULT 1 NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_id" uuid,
	"received_by" uuid,
	"prepared_by" uuid,
	"approved_by" uuid,
	"approval_id" uuid,
	"reclass_journal_id" uuid,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_invoice_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_invoice_duplicate_key_uq" UNIQUE("tenant_id","duplicate_key")
);
--> statement-breakpoint
CREATE TABLE "tax_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"countries" text[] NOT NULL,
	"rate_bps" integer NOT NULL,
	"label" text NOT NULL,
	"fiscal_validity" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_profile_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "tax_profile_code_uq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
ALTER TABLE "platform_audit_event" DROP CONSTRAINT "platform_audit_event_tenant_id_agency_id_fk";
--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD COLUMN "based_on_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD COLUMN "diff" jsonb;--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD COLUMN "change_reason" text;--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD COLUMN "payload_digest" text;--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "reporting_group" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_plan_line" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "timesheet" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "policy_snapshot_digest" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "reviewed_file_sha256" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "reviewed_file_version" integer;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "request_digest" text;--> statement-breakpoint
ALTER TABLE "platform_change" ADD COLUMN "proposal_key" text;--> statement-breakpoint
ALTER TABLE "platform_change" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "platform_change" ADD COLUMN "diff" jsonb;--> statement-breakpoint
ALTER TABLE "platform_incident" ADD COLUMN "resolution" jsonb;--> statement-breakpoint
ALTER TABLE "platform_incident" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "platform_incident" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "demo_run" ADD CONSTRAINT "demo_run_started_by_app_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_reference_counter" ADD CONSTRAINT "display_reference_counter_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profile_revision" ADD CONSTRAINT "import_profile_revision_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profile_revision" ADD CONSTRAINT "import_profile_revision_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profile_revision" ADD CONSTRAINT "import_profile_revision_tenant_id_profile_id_import_profile_tenant_id_id_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "public"."import_profile"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_readiness" ADD CONSTRAINT "billing_readiness_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_readiness" ADD CONSTRAINT "billing_readiness_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_readiness" ADD CONSTRAINT "billing_readiness_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_tenant_id_budget_revision_id_budget_revision_tenant_id_id_fk" FOREIGN KEY ("tenant_id","budget_revision_id") REFERENCES "public"."budget_revision"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedule_line" ADD CONSTRAINT "fee_schedule_line_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedule_line" ADD CONSTRAINT "fee_schedule_line_tenant_id_schedule_id_fee_schedule_tenant_id_id_fk" FOREIGN KEY ("tenant_id","schedule_id") REFERENCES "public"."fee_schedule"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_external_ref" ADD CONSTRAINT "master_external_ref_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_external_ref" ADD CONSTRAINT "master_external_ref_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_access" ADD CONSTRAINT "member_access_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_access" ADD CONSTRAINT "member_access_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_access" ADD CONSTRAINT "member_access_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_checkpoint" ADD CONSTRAINT "readiness_checkpoint_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_checkpoint" ADD CONSTRAINT "readiness_checkpoint_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_checkpoint" ADD CONSTRAINT "readiness_checkpoint_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_estimate" ADD CONSTRAINT "audience_estimate_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_estimate" ADD CONSTRAINT "audience_estimate_tenant_id_source_id_audience_source_tenant_id_id_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "public"."audience_source"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_source" ADD CONSTRAINT "audience_source_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_reconciliation" ADD CONSTRAINT "broadcast_reconciliation_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_reconciliation" ADD CONSTRAINT "broadcast_reconciliation_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_reconciliation" ADD CONSTRAINT "broadcast_reconciliation_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_reconciliation" ADD CONSTRAINT "broadcast_reconciliation_tenant_id_schedule_id_broadcast_schedule_tenant_id_id_fk" FOREIGN KEY ("tenant_id","schedule_id") REFERENCES "public"."broadcast_schedule"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_schedule" ADD CONSTRAINT "broadcast_schedule_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_schedule" ADD CONSTRAINT "broadcast_schedule_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_schedule" ADD CONSTRAINT "broadcast_schedule_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_schedule" ADD CONSTRAINT "broadcast_schedule_tenant_id_station_id_broadcast_station_tenant_id_id_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "public"."broadcast_station"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_spot" ADD CONSTRAINT "broadcast_spot_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_spot" ADD CONSTRAINT "broadcast_spot_tenant_id_schedule_id_broadcast_schedule_tenant_id_id_fk" FOREIGN KEY ("tenant_id","schedule_id") REFERENCES "public"."broadcast_schedule"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_station" ADD CONSTRAINT "broadcast_station_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_tenant_id_plan_revision_id_media_plan_revision_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plan_revision_id") REFERENCES "public"."media_plan_revision"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_tenant_id_connection_id_connection_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connection"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "make_good" ADD CONSTRAINT "make_good_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "make_good" ADD CONSTRAINT "make_good_tenant_id_reconciliation_id_broadcast_reconciliation_tenant_id_id_fk" FOREIGN KEY ("tenant_id","reconciliation_id") REFERENCES "public"."broadcast_reconciliation"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooh_face" ADD CONSTRAINT "ooh_face_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooh_face" ADD CONSTRAINT "ooh_face_tenant_id_operator_id_supplier_tenant_id_id_fk" FOREIGN KEY ("tenant_id","operator_id") REFERENCES "public"."supplier"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooh_plan" ADD CONSTRAINT "ooh_plan_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooh_plan" ADD CONSTRAINT "ooh_plan_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooh_plan" ADD CONSTRAINT "ooh_plan_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooh_reservation" ADD CONSTRAINT "ooh_reservation_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooh_reservation" ADD CONSTRAINT "ooh_reservation_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooh_reservation" ADD CONSTRAINT "ooh_reservation_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooh_reservation" ADD CONSTRAINT "ooh_reservation_tenant_id_face_id_ooh_face_tenant_id_id_fk" FOREIGN KEY ("tenant_id","face_id") REFERENCES "public"."ooh_face"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooh_reservation" ADD CONSTRAINT "ooh_reservation_tenant_id_plan_line_id_media_plan_line_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plan_line_id") REFERENCES "public"."media_plan_line"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_spec" ADD CONSTRAINT "placement_spec_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_deliverable" ADD CONSTRAINT "production_deliverable_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_deliverable" ADD CONSTRAINT "production_deliverable_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_deliverable" ADD CONSTRAINT "production_deliverable_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_deliverable" ADD CONSTRAINT "production_deliverable_tenant_id_asset_file_id_file_object_tenant_id_id_fk" FOREIGN KEY ("tenant_id","asset_file_id") REFERENCES "public"."file_object"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_tenant_id_supplier_id_supplier_tenant_id_id_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."supplier"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_directive" ADD CONSTRAINT "simulation_directive_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_directive" ADD CONSTRAINT "simulation_directive_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_right" ADD CONSTRAINT "usage_right_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_right" ADD CONSTRAINT "usage_right_tenant_id_file_id_file_object_tenant_id_id_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."file_object"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_adjustment" ADD CONSTRAINT "accounting_adjustment_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_adjustment" ADD CONSTRAINT "accounting_adjustment_prepared_by_app_user_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_adjustment" ADD CONSTRAINT "accounting_adjustment_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_adjustment" ADD CONSTRAINT "accounting_adjustment_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_period" ADD CONSTRAINT "accounting_period_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_period" ADD CONSTRAINT "accounting_period_closed_by_app_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_period" ADD CONSTRAINT "accounting_period_reopened_by_app_user_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connection"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_import" ADD CONSTRAINT "bank_statement_import_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_import" ADD CONSTRAINT "bank_statement_import_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_import" ADD CONSTRAINT "bank_statement_account_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_account"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_import_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."bank_statement_import"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_account_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_account"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invoice" ADD CONSTRAINT "client_invoice_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invoice" ADD CONSTRAINT "client_invoice_prepared_by_app_user_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invoice" ADD CONSTRAINT "client_invoice_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invoice" ADD CONSTRAINT "client_invoice_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invoice" ADD CONSTRAINT "client_invoice_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."client"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invoice_line" ADD CONSTRAINT "client_invoice_line_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_invoice_line" ADD CONSTRAINT "client_invoice_line_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."client_invoice"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_account_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_account"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_allocation" ADD CONSTRAINT "collection_allocation_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_allocation" ADD CONSTRAINT "collection_allocation_collection_fk" FOREIGN KEY ("tenant_id","collection_id") REFERENCES "public"."collection"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_allocation" ADD CONSTRAINT "collection_allocation_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."client_invoice"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_entry" ADD CONSTRAINT "depreciation_entry_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_entry" ADD CONSTRAINT "depreciation_asset_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."fixed_asset"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_claimant_user_id_app_user_id_fk" FOREIGN KEY ("claimant_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_submitted_by_app_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rate" ADD CONSTRAINT "fx_rate_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_prepared_by_app_user_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."journal_entry"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_account_fk" FOREIGN KEY ("tenant_id","account_code") REFERENCES "public"."ledger_account"("tenant_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report" ADD CONSTRAINT "management_report_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report" ADD CONSTRAINT "management_report_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."payment_batch"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_prepared_by_app_user_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_account_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_account"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_hold" ADD CONSTRAINT "payment_hold_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_hold" ADD CONSTRAINT "payment_hold_account_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."bank_account"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_hold" ADD CONSTRAINT "payment_hold_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payment"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rebate_agreement" ADD CONSTRAINT "rebate_agreement_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rebate_agreement" ADD CONSTRAINT "rebate_agreement_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."supplier"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rebate_calculation" ADD CONSTRAINT "rebate_calculation_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rebate_calculation" ADD CONSTRAINT "rebate_calculation_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rebate_calculation" ADD CONSTRAINT "rebate_calculation_agreement_fk" FOREIGN KEY ("tenant_id","agreement_id") REFERENCES "public"."rebate_agreement"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rebate_calculation" ADD CONSTRAINT "rebate_calculation_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_record" ADD CONSTRAINT "recognition_record_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_record" ADD CONSTRAINT "recognition_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_record" ADD CONSTRAINT "recognition_entry_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "public"."journal_entry"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_budget_version" ADD CONSTRAINT "revenue_budget_version_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_budget_version" ADD CONSTRAINT "revenue_budget_version_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_budget_version" ADD CONSTRAINT "revenue_budget_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."client"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_received_by_app_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_prepared_by_app_user_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."supplier"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."purchase_order"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profile" ADD CONSTRAINT "tax_profile_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_run_state_idx" ON "demo_run" USING btree ("state","started_at");--> statement-breakpoint
CREATE INDEX "fee_schedule_job_idx" ON "fee_schedule" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "broadcast_schedule_job_idx" ON "broadcast_schedule" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "campaign_job_idx" ON "campaign" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "ooh_reservation_face_idx" ON "ooh_reservation" USING btree ("tenant_id","face_id");--> statement-breakpoint
CREATE INDEX "simulation_directive_pending_idx" ON "simulation_directive" USING btree ("tenant_id","provider","state");--> statement-breakpoint
CREATE INDEX "usage_right_file_idx" ON "usage_right" USING btree ("tenant_id","file_id");--> statement-breakpoint
CREATE INDEX "accounting_adjustment_job_idx" ON "accounting_adjustment" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "bank_transaction_account_idx" ON "bank_transaction" USING btree ("tenant_id","bank_account_id");--> statement-breakpoint
CREATE INDEX "client_invoice_job_idx" ON "client_invoice" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "expense_job_idx" ON "expense" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "journal_entry_job_idx" ON "journal_entry" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "journal_entry_period_idx" ON "journal_entry" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_live_source_uq" ON "payment" USING btree ("tenant_id","source_type","source_id") WHERE "payment"."state" not in ('failed','cancelled');--> statement-breakpoint
CREATE INDEX "recognition_job_idx" ON "recognition_record" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "supplier_invoice_job_idx" ON "supplier_invoice" USING btree ("tenant_id","job_id");--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_tenant_id_evidence_id_evidence_tenant_id_id_fk" FOREIGN KEY ("tenant_id","evidence_id") REFERENCES "public"."evidence"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_submitted_by_app_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_file_id_file_object_tenant_id_id_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."file_object"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_job_idx" ON "evidence" USING btree ("tenant_id","job_id");--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_code_uq" UNIQUE("tenant_id","code");--> statement-breakpoint
ALTER TABLE "platform_change" ADD CONSTRAINT "platform_change_apply_key_uq" UNIQUE("tenant_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "platform_change" ADD CONSTRAINT "platform_change_proposal_key_uq" UNIQUE("tenant_id","proposal_key");