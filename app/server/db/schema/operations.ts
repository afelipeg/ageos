import { date, foreignKey, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core"

import { createdAt, minor, pk, revision, updatedAt } from "./columns"
import { job, mediaPlanLine, supplier } from "./commercial"
import { appUser } from "./platform"
import { tenantId, tenantUnique } from "./tenant"

// Shared order backbone (coordinator-owned contract). Order → delivery →
// supplier invoice → payment are linked stages of ONE cost; they are never
// counted as four separate costs. Writers: media buying / production
// (Core-2). Readers: reconciliation, payables, payments, accounting (Core-3).

export const purchaseOrder = pgTable(
  "purchase_order",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    jobId: uuid("job_id").notNull(),
    supplierId: uuid("supplier_id"),
    // production | media
    kind: text("kind").notNull(),
    reference: text("reference").notNull(),
    planLineId: uuid("plan_line_id"),
    planRevisionNumber: text("plan_revision_number"),
    provider: text("provider"),
    accountAlias: text("account_alias"),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    // draft | approved | submitted | acknowledged | partially_delivered | delivered | reconciled | cancelled
    state: text("state").notNull().default("draft"),
    approvalId: uuid("approval_id"),
    adapterOperationId: uuid("adapter_operation_id"),
    receiptId: text("receipt_id"),
    detail: jsonb("detail").notNull().default({}),
    createdBy: uuid("created_by").references(() => appUser.id),
    updatedBy: uuid("updated_by").references(() => appUser.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("purchase_order", t),
    unique("purchase_order_reference_uq").on(t.tenantId, t.reference),
    index("purchase_order_job_idx").on(t.tenantId, t.jobId),
    foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
    foreignKey({ columns: [t.tenantId, t.supplierId], foreignColumns: [supplier.tenantId, supplier.id] }),
    foreignKey({ columns: [t.tenantId, t.planLineId], foreignColumns: [mediaPlanLine.tenantId, mediaPlanLine.id] }),
  ]
)

export const delivery = pgTable(
  "delivery",
  {
    id: pk(),
    tenantId: tenantId(),
    orderId: uuid("order_id").notNull(),
    // Accepted value of what was delivered (production deliverable, aired
    // spots, served impressions, OOH proof). Recognition consumes commitment.
    acceptedMinor: minor("accepted_minor").notNull(),
    currency: text("currency").notNull(),
    // proposed | accepted | rejected
    state: text("state").notNull().default("proposed"),
    evidenceId: uuid("evidence_id"),
    businessDate: date("business_date").notNull(),
    detail: jsonb("detail").notNull().default({}),
    acceptedBy: uuid("accepted_by").references(() => appUser.id),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("delivery", t),
    index("delivery_order_idx").on(t.tenantId, t.orderId),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [purchaseOrder.tenantId, purchaseOrder.id] }),
  ]
)
