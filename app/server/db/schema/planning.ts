// Schema owned by Core-2 (work-production, media planning, media buying).
// Tenant tables must use tenantId() + tenantUnique() and composite tenant FKs.
import {
  type AnyPgColumn,
  boolean,
  date,
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
import { job, mediaPlanLine, mediaPlanRevision, supplier } from "./commercial"
import { connection } from "./configuration"
import { fileObject } from "./files"
import { appUser } from "./platform"
import { tenantId, tenantUnique } from "./tenant"

const jobFk = (t: { tenantId: AnyPgColumn; jobId: AnyPgColumn }) =>
  foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] })

// ── Production ──

// One released (or held) version of a deliverable. Release requires QA and
// valid usage rights; a blocked review is not persisted as a release.
export const productionDeliverable = pgTable(
  "production_deliverable",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    assetFileId: uuid("asset_file_id").notNull(),
    deliveryDate: date("delivery_date").notNull(),
    // passed | needs_rework | failed
    qualityResult: text("quality_result").notNull(),
    qcNotes: text("qc_notes"),
    rightsCleared: boolean("rights_cleared").notNull(),
    rightsBasis: text("rights_basis").notNull(),
    // released | held
    state: text("state").notNull(),
    productionOrderId: uuid("production_order_id"),
    deliveryId: uuid("delivery_id"),
    findings: jsonb("findings").notNull().default([]),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("production_deliverable", t),
    unique("production_deliverable_version_uq").on(t.tenantId, t.jobId, t.name, t.version),
    jobFk(t),
    foreignKey({ columns: [t.tenantId, t.assetFileId], foreignColumns: [fileObject.tenantId, fileObject.id] }),
  ]
)

// Usage-rights evidence for an asset file (synthetic in the demo).
export const usageRight = pgTable(
  "usage_right",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    fileId: uuid("file_id").notNull(),
    scope: text("scope").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to").notNull(),
    synthetic: boolean("synthetic").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("usage_right", t),
    index("usage_right_file_idx").on(t.tenantId, t.fileId),
    foreignKey({ columns: [t.tenantId, t.fileId], foreignColumns: [fileObject.tenantId, fileObject.id] }),
  ]
)

// ── Synthetic audience sources and ad specs (versioned) ──

export const audienceSource = pgTable(
  "audience_source",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    sourceKey: text("source_key").notNull(),
    version: text("version").notNull(),
    asOf: date("as_of").notNull(),
    geography: text("geography").notNull(),
    channel: text("channel").notNull(),
    methodology: text("methodology").notNull(),
    // licensed_demo | unlicensed | expired
    licenseStatus: text("license_status").notNull(),
    audienceBase: text("audience_base").notNull(),
    audienceLabel: text("audience_label").notNull(),
    fileId: uuid("file_id"),
    synthetic: boolean("synthetic").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [tenantUnique("audience_source", t), unique("audience_source_version_uq").on(t.tenantId, t.sourceKey, t.version)]
)

export const audienceEstimate = pgTable(
  "audience_estimate",
  {
    id: pk(),
    tenantId: tenantId(),
    sourceId: uuid("source_id").notNull(),
    vehicleKey: text("vehicle_key").notNull(),
    vehicleLabel: text("vehicle_label").notNull(),
    channel: text("channel").notNull(),
    supplierId: uuid("supplier_id"),
    universe: minor("universe").notNull(),
    // Per-spot ratings in hundredths of a point (synthetic).
    spotRatings: jsonb("spot_ratings").notNull(),
    reachHundredths: integer("reach_hundredths"),
    netCostMinor: minor("net_cost_minor").notNull(),
    currency: text("currency").notNull(),
  },
  (t) => [
    tenantUnique("audience_estimate", t),
    unique("audience_estimate_vehicle_uq").on(t.tenantId, t.sourceId, t.vehicleKey),
    foreignKey({ columns: [t.tenantId, t.sourceId], foreignColumns: [audienceSource.tenantId, audienceSource.id] }),
  ]
)

export const placementSpec = pgTable(
  "placement_spec",
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text("provider").notNull(),
    placement: text("placement").notNull(),
    version: text("version").notNull(),
    asOf: date("as_of").notNull(),
    source: text("source").notNull(),
    allowedFormats: text("allowed_formats").array().notNull(),
    aspectRatios: text("aspect_ratios").array().notNull(),
    minWidth: integer("min_width").notNull(),
    maxDurationSeconds: integer("max_duration_seconds"),
    maxSizeBytes: integer("max_size_bytes").notNull(),
    synthetic: boolean("synthetic").notNull().default(true),
  },
  (t) => [tenantUnique("placement_spec", t), unique("placement_spec_uq").on(t.tenantId, t.provider, t.placement, t.version)]
)

// ── Rate cards (versioned agreements) ──

export const rateCard = pgTable(
  "rate_card",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    supplierId: uuid("supplier_id").notNull(),
    medium: text("medium").notNull(),
    number: integer("number").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to").notNull(),
    grossRateMinor: minor("gross_rate_minor").notNull(),
    discountsBps: integer("discounts_bps").array().notNull(),
    netRateMinor: minor("net_rate_minor").notNull(),
    currency: text("currency").notNull(),
    // submitted | approved | rejected | superseded
    state: text("state").notNull(),
    approvedBy: uuid("approved_by").references(() => appUser.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("rate_card", t),
    unique("rate_card_number_uq").on(t.tenantId, t.supplierId, t.medium, t.number),
    foreignKey({ columns: [t.tenantId, t.supplierId], foreignColumns: [supplier.tenantId, supplier.id] }),
  ]
)

// ── Broadcast (TV/radio) ──

export const broadcastStation = pgTable(
  "broadcast_station",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    medium: text("medium").notNull(),
    timezone: text("timezone").notNull(),
    supplierId: uuid("supplier_id"),
    acceptedDurations: integer("accepted_durations").array().notNull(),
    dayparts: jsonb("dayparts").notNull(),
    synthetic: boolean("synthetic").notNull().default(true),
  },
  (t) => [
    tenantUnique("broadcast_station", t),
    unique("broadcast_station_code_uq").on(t.tenantId, t.code),
    unique("broadcast_station_name_uq").on(t.tenantId, t.name),
  ]
)

export const broadcastSchedule = pgTable(
  "broadcast_schedule",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    stationId: uuid("station_id").notNull(),
    planLineId: uuid("plan_line_id"),
    medium: text("medium").notNull(),
    spotCount: integer("spot_count").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    unitCostMinor: minor("unit_cost_minor").notNull(),
    grossMinor: minor("gross_minor").notNull(),
    netMinor: minor("net_minor").notNull(),
    currency: text("currency").notNull(),
    flightStart: date("flight_start").notNull(),
    flightEnd: date("flight_end").notNull(),
    timezone: text("timezone").notNull(),
    // confirmed
    state: text("state").notNull(),
    detail: jsonb("detail").notNull().default({}),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("broadcast_schedule", t),
    index("broadcast_schedule_job_idx").on(t.tenantId, t.jobId),
    jobFk(t),
    foreignKey({ columns: [t.tenantId, t.stationId], foreignColumns: [broadcastStation.tenantId, broadcastStation.id] }),
  ]
)

export const broadcastSpot = pgTable(
  "broadcast_spot",
  {
    id: pk(),
    tenantId: tenantId(),
    scheduleId: uuid("schedule_id").notNull(),
    spotKey: text("spot_key").notNull(),
    airDate: date("air_date").notNull(),
    daypart: text("daypart").notNull(),
    windowStart: text("window_start").notNull(),
    windowEnd: text("window_end").notNull(),
    materialId: text("material_id").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
  },
  (t) => [
    tenantUnique("broadcast_spot", t),
    unique("broadcast_spot_key_uq").on(t.tenantId, t.scheduleId, t.spotKey),
    foreignKey({ columns: [t.tenantId, t.scheduleId], foreignColumns: [broadcastSchedule.tenantId, broadcastSchedule.id] }),
  ]
)

export const broadcastReconciliation = pgTable(
  "broadcast_reconciliation",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    scheduleId: uuid("schedule_id").notNull(),
    monitoringFileId: uuid("monitoring_file_id").notNull(),
    monitoringSha256: text("monitoring_sha256").notNull(),
    orderedSpots: integer("ordered_spots").notNull(),
    matchedSpots: integer("matched_spots").notNull(),
    missingSpots: integer("missing_spots").notNull(),
    duplicateRecords: integer("duplicate_records").notNull(),
    extraRecords: integer("extra_records").notNull(),
    toleranceSpots: integer("tolerance_spots").notNull(),
    // ready_to_close | awaiting_makegood
    status: text("status").notNull(),
    result: jsonb("result").notNull(),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("broadcast_reconciliation", t),
    jobFk(t),
    foreignKey({ columns: [t.tenantId, t.scheduleId], foreignColumns: [broadcastSchedule.tenantId, broadcastSchedule.id] }),
  ]
)

export const makeGood = pgTable(
  "make_good",
  {
    id: pk(),
    tenantId: tenantId(),
    reconciliationId: uuid("reconciliation_id").notNull(),
    spotKey: text("spot_key").notNull(),
    originalAirDate: date("original_air_date").notNull(),
    // requested | confirmed | aired
    state: text("state").notNull(),
    cashCostChangeMinor: minor("cash_cost_change_minor").notNull(),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("make_good", t),
    unique("make_good_spot_uq").on(t.tenantId, t.reconciliationId, t.spotKey),
    foreignKey({
      columns: [t.tenantId, t.reconciliationId],
      foreignColumns: [broadcastReconciliation.tenantId, broadcastReconciliation.id],
    }),
  ]
)

// ── Out-of-home ──

export const oohFace = pgTable(
  "ooh_face",
  {
    id: pk(),
    tenantId: tenantId(),
    faceKey: text("face_key").notNull(),
    site: text("site").notNull(),
    // static | digital
    format: text("format").notNull(),
    operatorId: uuid("operator_id").notNull(),
    synthetic: boolean("synthetic").notNull().default(true),
    revision: revision(),
  },
  (t) => [
    tenantUnique("ooh_face", t),
    unique("ooh_face_key_uq").on(t.tenantId, t.faceKey),
    foreignKey({ columns: [t.tenantId, t.operatorId], foreignColumns: [supplier.tenantId, supplier.id] }),
  ]
)

// Site plan proposal; it never reserves inventory by itself.
export const oohPlan = pgTable(
  "ooh_plan",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    site: text("site").notNull(),
    faces: integer("faces").notNull(),
    unitRateMinor: minor("unit_rate_minor").notNull(),
    totalMinor: minor("total_minor").notNull(),
    currency: text("currency").notNull(),
    flightStart: date("flight_start").notNull(),
    flightEnd: date("flight_end").notNull(),
    evidenceType: text("evidence_type").notNull(),
    // proposed
    state: text("state").notNull(),
    bookingProposals: jsonb("booking_proposals").notNull(),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [tenantUnique("ooh_plan", t), jobFk(t)]
)

export const oohReservation = pgTable(
  "ooh_reservation",
  {
    id: pk(),
    tenantId: tenantId(),
    faceId: uuid("face_id").notNull(),
    jobId: uuid("job_id").notNull(),
    planLineId: uuid("plan_line_id"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    // reserved | released
    state: text("state").notNull(),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("ooh_reservation", t),
    index("ooh_reservation_face_idx").on(t.tenantId, t.faceId),
    jobFk(t),
    foreignKey({ columns: [t.tenantId, t.faceId], foreignColumns: [oohFace.tenantId, oohFace.id] }),
    foreignKey({ columns: [t.tenantId, t.planLineId], foreignColumns: [mediaPlanLine.tenantId, mediaPlanLine.id] }),
  ]
)

// ── Simulated campaigns ──

export const campaign = pgTable(
  "campaign",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    planRevisionId: uuid("plan_revision_id").notNull(),
    planLineId: uuid("plan_line_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    provider: text("provider").notNull(),
    accountAlias: text("account_alias").notNull(),
    name: text("name").notNull(),
    budgetMinor: minor("budget_minor").notNull(),
    currency: text("currency").notNull(),
    creativeFileId: uuid("creative_file_id").notNull(),
    // awaiting_approval | active_simulated | outcome_unknown | failed | stale
    state: text("state").notNull(),
    approvalId: uuid("approval_id"),
    adapterOperationId: uuid("adapter_operation_id"),
    receiptId: text("receipt_id"),
    externalId: text("external_id"),
    preflight: jsonb("preflight").notNull(),
    lastError: text("last_error"),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("campaign", t),
    index("campaign_job_idx").on(t.tenantId, t.jobId),
    jobFk(t),
    foreignKey({ columns: [t.tenantId, t.planRevisionId], foreignColumns: [mediaPlanRevision.tenantId, mediaPlanRevision.id] }),
    foreignKey({ columns: [t.tenantId, t.connectionId], foreignColumns: [connection.tenantId, connection.id] }),
  ]
)

// Presenter-injected outcome for the next simulated ads operation (contract
// 03 §8 test modes). Consumed once, audited through business events.
export const simulationDirective = pgTable(
  "simulation_directive",
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text("provider").notNull(),
    operationType: text("operation_type").notNull(),
    failureMode: text("failure_mode").notNull(),
    // pending | consumed
    state: text("state").notNull().default("pending"),
    consumedByOperationId: uuid("consumed_by_operation_id"),
    createdBy: uuid("created_by").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [tenantUnique("simulation_directive", t), index("simulation_directive_pending_idx").on(t.tenantId, t.provider, t.state)]
)

