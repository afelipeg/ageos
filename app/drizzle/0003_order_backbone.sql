CREATE TABLE "delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"accepted_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"evidence_id" uuid,
	"business_date" date NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accepted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "delivery_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_key" text,
	"job_id" uuid NOT NULL,
	"supplier_id" uuid,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"plan_line_id" uuid,
	"plan_revision_number" text,
	"provider" text,
	"account_alias" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"approval_id" uuid,
	"adapter_operation_id" uuid,
	"receipt_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_order_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_order_reference_uq" UNIQUE("tenant_id","reference")
);
--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_accepted_by_app_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_tenant_id_order_id_purchase_order_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."purchase_order"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_agency_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."agency"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_job_id_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_supplier_id_supplier_tenant_id_id_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."supplier"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_plan_line_id_media_plan_line_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plan_line_id") REFERENCES "public"."media_plan_line"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_order_idx" ON "delivery" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_job_idx" ON "purchase_order" USING btree ("tenant_id","job_id");