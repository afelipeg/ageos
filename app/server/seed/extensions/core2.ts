// Seed extension owned by Core-2 (production, media planning/buying fixtures: audiences, specs, rate cards, OOH faces, spots).
// Runs inside the demo seed transaction AFTER the base checkpoint
// (ready_for_scope_review). Never seed results of steps the journey has not
// executed yet (no posted journals, payments or approvals ahead of time).
//
// Seeded here (static prerequisites + demo-lab exercise data only):
// - media vendor suppliers (simulated platforms, a fictional radio station,
//   OOH operators) and their synthetic rate cards;
// - synthetic, versioned audience sources/estimates, ad placement specs,
//   broadcast stations and OOH faces (all labelled synthetic);
// - Aurora input assets (hero film proof, feed creative) with usage rights —
//   no Aurora orders, deliveries, campaigns or timesheets;
// - demo-lab job `job_demo_lab_ops` (reporting group demo-lab) with its own
//   PO/budget/approved plan, a committed radio order + 20-spot schedule, the
//   synthetic emission and metrics CSVs and lab creatives/assets.
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { syntheticPdf } from "@/lib/synthetic-pdf"
import { jobNumber } from "@/server/calculators"
import { broadcastSpotPlan } from "@/server/calculators/planning"
import * as s from "@/server/db/schema"

import type { SeedIds, SeedTx } from "./types"

async function storeFile(storageDir: string, tenantId: string, objectId: string, bytes: Uint8Array) {
  const dir = path.resolve(storageDir, tenantId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, objectId), bytes)
  return { storageKey: `${tenantId}/${objectId}`, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength }
}

export const LAB_OPS_JOB = "job_demo_lab_ops"
export const FCR_DAYPARTS = [
  { code: "AM", start: "06:00", end: "10:00", ratingHundredths: 150 },
  { code: "PM", start: "16:00", end: "19:00", ratingHundredths: 120 },
]
/** Spot of the lab schedule that the synthetic monitoring file omits. */
export const LAB_MISSING_SPOT = "S013"
/** Emission record duplicated once in the synthetic monitoring file. */
export const LAB_DUPLICATE_EVENT = "EM-007"

export async function seedCore2(tx: SeedTx, ids: SeedIds): Promise<void> {
  const { F, RAYO, owner, operator } = ids
  const usd = (major: number) => BigInt(major) * 100n
  const LAB = F(LAB_OPS_JOB)

  // ── Media vendors (simulated platforms, fictional broadcast/OOH) ──
  const vendor = (key: string, name: string, externalIds: Record<string, string> = {}) => ({
    id: F(key),
    tenantId: RAYO,
    fixtureKey: key,
    name,
    country: "US",
    currency: "USD",
    externalIds: { ...externalIds, synthetic: "true" },
    createdBy: operator,
  })
  await tx.insert(s.supplier).values([
    vendor("supplier_demo_meta_ads", "Meta Ads (simulated platform)", { provider: "meta_ads" }),
    vendor("supplier_demo_google_ads", "Google Ads (simulated platform)", { provider: "google_ads" }),
    vendor("supplier_demo_tiktok_ads", "TikTok Ads (simulated platform)", { provider: "tiktok_ads" }),
    vendor("supplier_demo_dv360", "DV360 CTV (simulated platform)", { provider: "dv360_demo" }),
    vendor("supplier_demo_city_radio", "Fictional City Radio Demo"),
    vendor("supplier_demo_metro_tv", "Fictional Metro TV Demo"),
    vendor("supplier_demo_ooh_operator", "Fictional OOH Operator Demo"),
    vendor("supplier_demo_billboard_co", "Fictional Billboard Co Demo"),
    vendor("supplier_demo_digital_network", "Fictional Digital Network Demo"),
  ])

  // ── Synthetic rate cards (r1 approved by the owner at seed time) ──
  const card = (key: string, supplierKey: string, medium: string, from: string, to: string, gross: bigint, discounts: number[], net: bigint) => ({
    id: F(key),
    tenantId: RAYO,
    fixtureKey: key,
    supplierId: F(supplierKey),
    medium,
    number: 1,
    validFrom: from,
    validTo: to,
    grossRateMinor: gross,
    discountsBps: discounts,
    netRateMinor: net,
    currency: "USD",
    state: "approved",
    approvedBy: owner,
    approvedAt: new Date("2027-01-05T15:00:00Z"),
    createdBy: operator,
  })
  await tx.insert(s.rateCard).values([
    card("rate_card_demo_city_radio_r1", "supplier_demo_city_radio", "radio", "2027-01-01", "2027-12-31", usd(100), [], usd(100)),
    card("rate_card_demo_ooh_operator_r1", "supplier_demo_ooh_operator", "ooh", "2027-01-01", "2027-12-31", usd(1000), [], usd(1000)),
    // Expired agreement: cannot price a new approved order.
    card("rate_card_demo_billboard_r1", "supplier_demo_billboard_co", "ooh", "2026-03-01", "2027-02-28", usd(1000), [1000], usd(900)),
  ])

  // ── Broadcast stations (fictitious) and OOH faces ──
  await tx.insert(s.broadcastStation).values([
    { id: F("station_demo_fcr"), tenantId: RAYO, fixtureKey: "station_demo_fcr", code: "FCR", name: "Fictional City Radio", medium: "radio", timezone: "America/Mexico_City", supplierId: F("supplier_demo_city_radio"), acceptedDurations: [10, 15, 20, 30, 60], dayparts: { universe: 1500000, sourceKey: "src_demo_us_radio", items: FCR_DAYPARTS } },
    { id: F("station_demo_fmt"), tenantId: RAYO, fixtureKey: "station_demo_fmt", code: "FMT", name: "Fictional Metro TV", medium: "tv", timezone: "America/Mexico_City", supplierId: F("supplier_demo_metro_tv"), acceptedDurations: [15, 30, 60], dayparts: { universe: 2500000, sourceKey: "src_demo_us_tv_households", items: [{ code: "PRIME", start: "20:00", end: "23:00", ratingHundredths: 400 }] } },
  ])
  const face = (key: string, site: string, format: string, operatorKey = "supplier_demo_ooh_operator") => ({ id: F(key), tenantId: RAYO, faceKey: key, site, format, operatorId: F(operatorKey) })
  await tx.insert(s.oohFace).values([
    face("face_demo_a", "Fictional Station Faces A/B", "static"),
    face("face_demo_b", "Fictional Station Faces A/B", "static"),
    face("face_demo_c", "Fictional Plaza Faces C/D", "static"),
    face("face_demo_d", "Fictional Plaza Faces C/D", "static"),
    face("face_demo_screen_1", "Fictional Mall Screens", "digital"),
    face("face_demo_billboard_1", "Fictional Highway Billboard", "static", "supplier_demo_billboard_co"),
  ])

  // ── Synthetic placement specs ──
  const spec = (provider: string, placement: string, aspectRatios: string[], minWidth: number, maxDurationSeconds: number | null) => ({
    tenantId: RAYO,
    provider,
    placement,
    version: "2027.1",
    asOf: "2027-03-01",
    source: "synthetic_demo_spec",
    allowedFormats: ["pdf"],
    aspectRatios,
    minWidth,
    maxDurationSeconds,
    maxSizeBytes: 5_000_000,
  })
  await tx.insert(s.placementSpec).values([
    spec("meta_ads", "Demo Feed", ["1:1", "4:5"], 600, 60),
    spec("google_ads", "Demo Search", ["1:1", "16:9"], 600, null),
    spec("tiktok_ads", "Demo In-feed", ["9:16", "1:1"], 540, 60),
    spec("dv360_demo", "Fictional CTV inventory", ["16:9"], 1280, 30),
  ])

  // ── Synthetic, versioned audience sources ──
  const src = (key: string, version: string, asOf: string, geography: string, channel: string, license: string, base: string, label: string, methodology: string) => ({
    id: F(`${key}@${version}`),
    tenantId: RAYO,
    fixtureKey: key,
    sourceKey: key,
    version,
    asOf,
    geography,
    channel,
    methodology,
    licenseStatus: license,
    audienceBase: base,
    audienceLabel: label,
  })
  await tx.insert(s.audienceSource).values([
    src("src_demo_us_radio", "2027.1", "2027-02-28", "US", "radio", "licensed_demo", "persons_25_44", "Adults 25-44", "Synthetic diary panel (demo)"),
    src("src_demo_us_digital", "2027.1", "2027-03-01", "US", "digital", "licensed_demo", "persons_25_44", "Adults 25-44", "Synthetic platform panel (demo)"),
    src("src_demo_us_ctv", "2026.3", "2026-09-30", "US", "ctv", "licensed_demo", "persons_25_44", "Adults 25-44", "Synthetic set-top panel (demo)"),
    src("src_demo_us_ooh", "2027.1", "2027-03-01", "US", "ooh", "unlicensed", "persons_25_44", "Adults 25-44", "Synthetic mobility panel (demo)"),
    src("src_demo_us_tv_households", "2027.1", "2027-02-15", "US", "tv", "licensed_demo", "households", "TV households", "Synthetic people meter (demo)"),
    src("src_demo_co_radio", "2026.1", "2026-06-30", "CO", "radio", "expired", "persons_25_44", "Adults 25-44", "Synthetic diary panel (demo)"),
  ])
  const ratings = (prefix: string, n: number, r: number) => Array.from({ length: n }, (_, i) => ({ spotId: `${prefix}${i + 1}`, ratingHundredths: r }))
  const est = (sourceKey: string, version: string, vehicleKey: string, label: string, channel: string, supplierKey: string | null, universe: number, spots: { spotId: string; ratingHundredths: number }[], reach: number, cost: number) => ({
    tenantId: RAYO,
    sourceId: F(`${sourceKey}@${version}`),
    vehicleKey,
    vehicleLabel: label,
    channel,
    supplierId: supplierKey ? F(supplierKey) : null,
    universe: BigInt(universe),
    spotRatings: spots,
    reachHundredths: reach,
    netCostMinor: usd(cost),
    currency: "USD",
  })
  await tx.insert(s.audienceEstimate).values([
    est("src_demo_us_radio", "2027.1", "fcr_am", "Fictional City Radio · Morning drive", "radio", "supplier_demo_city_radio", 1500000, ratings("AM", 10, 150), 3500, 1000),
    est("src_demo_us_radio", "2027.1", "fcr_pm", "Fictional City Radio · Afternoon drive", "radio", "supplier_demo_city_radio", 1500000, ratings("PM", 10, 120), 2800, 800),
    est("src_demo_us_digital", "2027.1", "meta_feed", "Meta Demo Feed (simulated)", "digital", "supplier_demo_meta_ads", 2000000, ratings("MF", 5, 300), 4200, 5000),
    est("src_demo_us_digital", "2027.1", "google_search", "Google Demo Search (simulated)", "digital", "supplier_demo_google_ads", 2000000, ratings("GS", 5, 200), 3000, 4000),
    est("src_demo_us_ctv", "2026.3", "ctv_prime", "Fictional CTV prime", "ctv", "supplier_demo_dv360", 1200000, ratings("CT", 4, 250), 2000, 4000),
    est("src_demo_us_ooh", "2027.1", "station_faces", "Fictional Station Faces A/B", "ooh", "supplier_demo_ooh_operator", 900000, ratings("OH", 2, 500), 1800, 2000),
    est("src_demo_us_tv_households", "2027.1", "fmt_prime", "Fictional Metro TV prime", "tv", "supplier_demo_metro_tv", 2500000, ratings("TV", 6, 400), 5000, 9000),
    est("src_demo_co_radio", "2026.1", "co_radio_am", "Fictional Bogotá Radio · AM", "radio", null, 800000, ratings("CO", 10, 140), 3000, 700),
  ])

  // ── Files: Aurora input assets, lab assets, synthetic CSVs ──
  type SeedFile = { key: string; name: string; format: "pdf" | "csv"; job: string | null; bytes: Uint8Array; extraction?: Record<string, unknown> }
  const fcrSchedule = broadcastSpotPlan({ stationCode: "FCR", spotCount: 20, durationSeconds: 30, flightStart: "2027-03-16", flightEnd: "2027-03-31", dayparts: FCR_DAYPARTS })
  const emissionRows: string[] = []
  let ev = 0
  for (const spot of fcrSchedule) {
    if (spot.spotId === LAB_MISSING_SPOT) continue
    ev += 1
    const [h, m] = spot.windowStart.split(":").map(Number)
    const row = `EM-${String(ev).padStart(3, "0")},FCR,${spot.airDate},${String(h! + 1).padStart(2, "0")}:${String(m! + 15).padStart(2, "0")},${spot.materialId}`
    emissionRows.push(row)
    if (`EM-${String(ev).padStart(3, "0")}` === LAB_DUPLICATE_EVENT) emissionRows.push(row)
  }
  const emissionsCsv = ["event_id,station_code,air_date,air_time,material_id", ...emissionRows].join("\n") + "\n"
  const metricRows: string[] = []
  for (let d = 9; d <= 15; d++) {
    const date = `2027-03-${String(d).padStart(2, "0")}`
    metricRows.push(`${date},line_meta,USD,30000,60000,900,3`)
    metricRows.push(`${date},line_google,USD,20000,25000,800,4`)
  }
  const metricsCsv = ["date,line_key,currency,spend_minor,impressions,clicks,conversions", ...metricRows].join("\n") + "\n"
  const enc = (t: string) => new TextEncoder().encode(t)
  const creativeExtraction = (w: number, h: number, sec: number) => ({ label: "Prepared demo extraction", fields: { width: w, height: h, durationSeconds: sec } })
  const files: SeedFile[] = [
    { key: "file_demo_aurora_hero_asset", name: "aurora-spring-hero-film-proof.pdf", format: "pdf", job: "job_demo_aurora", bytes: syntheticPdf(["DEMO - SYNTHETIC DOCUMENT", "Aurora spring hero film - delivery proof v1", "Lumen Production Demo (fictional vendor)."]), extraction: creativeExtraction(1920, 1080, 30) },
    { key: "file_demo_aurora_creative_feed", name: "aurora-feed-creative-1x1.pdf", format: "pdf", job: "job_demo_aurora", bytes: syntheticPdf(["DEMO - SYNTHETIC DOCUMENT", "Aurora feed creative 1:1 (1080x1080, 15 s)", "Fictional creative for simulated activation."]), extraction: creativeExtraction(1080, 1080, 15) },
    { key: "file_demo_lab_creative", name: "lab-feed-creative-1x1.pdf", format: "pdf", job: LAB_OPS_JOB, bytes: syntheticPdf(["DEMO - SYNTHETIC DOCUMENT", "Lab feed creative 1:1 (1080x1080, 15 s)", "demo-lab exercise."]), extraction: creativeExtraction(1080, 1080, 15) },
    { key: "file_demo_lab_asset", name: "lab-hero-proof.pdf", format: "pdf", job: LAB_OPS_JOB, bytes: syntheticPdf(["DEMO - SYNTHETIC DOCUMENT", "Lab hero proof", "demo-lab production exercise (rights valid)."]), extraction: creativeExtraction(1920, 1080, 30) },
    { key: "file_demo_lab_asset_expired", name: "lab-archive-proof.pdf", format: "pdf", job: LAB_OPS_JOB, bytes: syntheticPdf(["DEMO - SYNTHETIC DOCUMENT", "Lab archive proof", "demo-lab production exercise (usage right expired)."]), extraction: creativeExtraction(1920, 1080, 30) },
    { key: "file_demo_lab_emissions_csv", name: "lab-fcr-emissions-demo.csv", format: "csv", job: LAB_OPS_JOB, bytes: enc(emissionsCsv) },
    { key: "file_demo_lab_metrics_csv", name: "lab-campaign-metrics-demo.csv", format: "csv", job: LAB_OPS_JOB, bytes: enc(metricsCsv) },
  ]

  // ── demo-lab job with its own PO, budget and approved plan ──
  const jn = jobNumber({ clientCode: "LAB", productCode: "XX", year: 2027, jobType: "A", billingCode: "F", sequence: 9201 })
  await tx.insert(s.job).values({
    id: LAB,
    tenantId: RAYO,
    fixtureKey: LAB_OPS_JOB,
    clientId: F("client_demo_lab"),
    name: "Production & media lab (demo-lab)",
    jobNumber: jn.code,
    displayReference: "RDS-LAB-C2-01",
    jobType: "A",
    billingCode: "F",
    year: 2027,
    sequence: 9201,
    state: "in_progress",
    ownerUserId: operator,
    period: "2027-03",
    currency: "USD",
    services: ["production", "media"],
    reportingGroup: "demo-lab",
    createdBy: operator,
    updatedBy: operator,
  })

  for (const f of files) {
    const id = F(f.key)
    const stored = await storeFile(ids.storageDir, RAYO, id, f.bytes)
    await tx.insert(s.fileObject).values({
      id,
      tenantId: RAYO,
      fixtureKey: f.key,
      logicalId: id,
      version: 1,
      jobId: f.job ? F(f.job) : null,
      originalName: f.name,
      format: f.format,
      mimeType: f.format === "pdf" ? "application/pdf" : "text/csv",
      sizeBytes: stored.size,
      sha256: stored.sha256,
      storageKey: stored.storageKey,
      extractionStatus: f.extraction ? "prepared_demo_extraction" : "not_analyzed",
      extraction: f.extraction ?? null,
      synthetic: "fixture",
      uploadedBy: operator,
    })
  }
  const right = (key: string, fileKey: string, from: string, to: string, scope: string) => ({ id: F(key), tenantId: RAYO, fixtureKey: key, fileId: F(fileKey), scope, validFrom: from, validTo: to })
  await tx.insert(s.usageRight).values([
    right("right_demo_aurora_hero", "file_demo_aurora_hero_asset", "2027-03-01", "2027-06-30", "US digital, CTV, OOH (demo)"),
    right("right_demo_aurora_feed", "file_demo_aurora_creative_feed", "2027-03-01", "2027-06-30", "US social and search (demo)"),
    right("right_demo_lab_creative", "file_demo_lab_creative", "2027-01-01", "2027-12-31", "demo-lab"),
    right("right_demo_lab_asset", "file_demo_lab_asset", "2027-01-01", "2027-12-31", "demo-lab"),
    right("right_demo_lab_asset_expired", "file_demo_lab_asset_expired", "2026-01-01", "2027-02-28", "demo-lab"),
  ])

  const now = new Date()
  await tx.insert(s.contract).values({ id: F("contract_lab_ops_po_r1"), tenantId: RAYO, clientId: F("client_demo_lab"), jobId: LAB, kind: "client_po", reference: "PO-LAB-OPS-2027-01", revisionNumber: 1, amountMinor: usd(16000), currency: "USD", state: "approved", validFrom: "2027-03-01", validTo: "2027-12-31", approvedBy: owner, approvedAt: now, createdBy: operator, updatedBy: operator })
  await tx.insert(s.budgetRevision).values({ id: F("budget_lab_ops_r1"), tenantId: RAYO, jobId: LAB, number: 1, state: "approved", agencyFeeMinor: usd(1000), managedMediaMinor: usd(15000), currency: "USD", reason: "demo-lab media and production exercises", approvedBy: owner, approvedAt: now, createdBy: operator, updatedBy: operator })

  const conn = (alias: string, provider: string, state: string, scopes: string[]) => ({ id: F(`connection_${alias}`), tenantId: RAYO, provider, category: "ads", mode: "simulated", accountAlias: alias, scopes, state, ownerUserId: owner })
  await tx.insert(s.connection).values([
    conn("demo_meta_labops", "meta_ads", "connected_demo", ["ads.read", "ads.manage"]),
    conn("demo_google_labops", "google_ads", "connected_demo", ["ads.read", "ads.manage"]),
    conn("demo_tiktok_labops", "tiktok_ads", "revoked", ["ads.read"]),
  ])

  await tx.insert(s.mediaPlanRevision).values({ id: F("plan_lab_ops_r1"), tenantId: RAYO, jobId: LAB, number: 1, state: "approved", totalMinor: usd(14000), currency: "USD", objective: "demo-lab media exercises", approvedBy: owner, createdBy: operator, updatedBy: operator })
  const labLines = [
    { key: "line_meta", channel: "meta", placement: "Demo Feed", provider: "meta_ads", account: "demo_meta_labops", amount: 5000 },
    { key: "line_google", channel: "google", placement: "Demo Search", provider: "google_ads", account: "demo_google_labops", amount: 4000 },
    { key: "line_tiktok", channel: "tiktok", placement: "Demo In-feed", provider: "tiktok_ads", account: "demo_tiktok_labops", amount: 1000 },
    { key: "line_radio", channel: "radio", placement: "Fictional City Radio", provider: "offline_file_demo", amount: 2000, quantity: 20, unit: 100 },
    { key: "line_ooh", channel: "ooh", placement: "Fictional Station Faces A/B", provider: "offline_file_demo", amount: 2000, quantity: 2, unit: 1000 },
  ]
  await tx.insert(s.mediaPlanLine).values(
    labLines.map((l) => ({
      id: F(`plan_lab_ops_r1:${l.key}`),
      tenantId: RAYO,
      planRevisionId: F("plan_lab_ops_r1"),
      lineKey: l.key,
      channel: l.channel,
      placement: l.placement,
      provider: l.provider,
      accountAlias: l.account ?? null,
      quantity: l.quantity ?? null,
      unitCostMinor: l.unit ? usd(l.unit) : null,
      amountMinor: usd(l.amount),
      currency: "USD",
      startDate: "2027-03-16",
      endDate: "2027-03-31",
    }))
  )

  // Committed lab radio order (offline send pack) + its 20-spot schedule.
  const reference = "MO-RDS-LAB-C2-01-RADIO-01"
  await tx.insert(s.budgetReservation).values({ id: F("commitment_lab_ops_radio"), tenantId: RAYO, jobId: LAB, budgetScope: "managed_media_authority", amountMinor: usd(2000), currency: "USD", state: "committed", purpose: `media_order:${reference}`, createdBy: operator, updatedBy: operator })
  await tx.insert(s.purchaseOrder).values({
    id: F("order_lab_ops_radio"),
    tenantId: RAYO,
    fixtureKey: "order_lab_ops_radio",
    jobId: LAB,
    supplierId: F("supplier_demo_city_radio"),
    kind: "media",
    reference,
    planLineId: F("plan_lab_ops_r1:line_radio"),
    planRevisionNumber: "1",
    provider: "offline_file_demo",
    amountMinor: usd(2000),
    currency: "USD",
    state: "approved",
    detail: { lineKey: "line_radio", channel: "radio", placement: "Fictional City Radio", commitmentId: F("commitment_lab_ops_radio"), submission: { channel: "offline_send_pack", state: "send_pack_ready" }, seeded: "demo-lab", simulation: true },
    createdBy: operator,
    updatedBy: operator,
  })
  await tx.insert(s.broadcastSchedule).values({
    id: F("schedule_lab_ops_fcr"),
    tenantId: RAYO,
    jobId: LAB,
    stationId: F("station_demo_fcr"),
    planLineId: F("plan_lab_ops_r1:line_radio"),
    medium: "radio",
    spotCount: 20,
    durationSeconds: 30,
    unitCostMinor: usd(100),
    grossMinor: usd(2000),
    netMinor: usd(2000),
    currency: "USD",
    flightStart: "2027-03-16",
    flightEnd: "2027-03-31",
    timezone: "America/Mexico_City",
    state: "confirmed",
    detail: { rateCardId: F("rate_card_demo_city_radio_r1"), orderId: F("order_lab_ops_radio"), synthetic: true },
    createdBy: operator,
  })
  await tx.insert(s.broadcastSpot).values(
    fcrSchedule.map((sp) => ({ tenantId: RAYO, scheduleId: F("schedule_lab_ops_fcr"), spotKey: sp.spotId, airDate: sp.airDate, daypart: sp.daypart, windowStart: sp.windowStart, windowEnd: sp.windowEnd, materialId: sp.materialId, durationSeconds: sp.durationSeconds }))
  )

  const seedEvent = (eventType: string, aggregateType: string, aggregateId: string, jobId: string | null, payload: Record<string, unknown>) => ({
    tenantId: RAYO,
    eventType,
    aggregateType,
    aggregateId,
    jobId,
    actorUserId: operator,
    origin: "seed",
    payload: { ...payload, seededBy: "core2", synthetic: true },
    businessEffectiveAt: new Date("2027-03-01T15:00:00Z"),
  })
  await tx.insert(s.businessEvent).values([
    seedEvent("job.opened", "job", LAB, LAB, { jobNumber: jn.code, displayReference: "RDS-LAB-C2-01", reportingGroup: "demo-lab" }),
    seedEvent("media_plan.approved", "job", LAB, LAB, { planRevision: 1, totalMinor: "1400000" }),
    seedEvent("media_order.issued", "purchase_order", F("order_lab_ops_radio"), LAB, { reference, amountMinor: "200000", channel: "offline_send_pack" }),
    seedEvent("synthetic_sources.loaded", "audience_source", F("src_demo_us_radio@2027.1"), null, { sources: 6, placementSpecs: 4, stations: 2, oohFaces: 6 }),
  ])
}
