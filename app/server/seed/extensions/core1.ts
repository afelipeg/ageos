// Seed extension owned by Core-1 (governance, clients & contracts fixtures).
// Runs inside the demo seed transaction AFTER the base checkpoint
// (ready_for_scope_review). Never seed results of steps the journey has not
// executed yet (no posted journals, payments or approvals ahead of time).
//
// Secondary exercises live on demo-lab records (reporting group demo-lab) so
// Aurora KPIs stay clean. Lab jobs seeded here use job sequences 91xx and
// display references RDS-LAB-C1-* so they never collide with jobs opened
// during the demo or seeded by other modules.
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { eq, sql } from "drizzle-orm"

import { syntheticPdf } from "@/lib/synthetic-pdf"
import { jobNumber } from "@/server/calculators"
import * as s from "@/server/db/schema"

import type { SeedIds, SeedTx } from "./types"

async function storeFile(storageDir: string, tenantId: string, objectId: string, bytes: Uint8Array) {
  const dir = path.resolve(storageDir, tenantId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, objectId), bytes)
  return { storageKey: `${tenantId}/${objectId}`, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength }
}

/**
 * Evidence inherits its job/client and submitter from the stored file;
 * reviewed evidence pins the exact file hash and version that was reviewed.
 * Only fills missing values, so it is safe to run again after every seed
 * extension (other modules insert evidence after Core-1 runs).
 */
export async function backfillEvidenceLinks(tx: SeedTx, ids: SeedIds): Promise<void> {
  await tx.execute(sql`
    update evidence e
       set job_id = coalesce(e.job_id, f.job_id),
           client_id = coalesce(e.client_id, j.client_id),
           submitted_by = coalesce(e.submitted_by, f.uploaded_by),
           reviewed_file_sha256 = case when e.review_state = 'reviewed' then coalesce(e.reviewed_file_sha256, f.sha256) end,
           reviewed_file_version = case when e.review_state = 'reviewed' then coalesce(e.reviewed_file_version, f.version) end,
           reviewed_at = case when e.review_state = 'reviewed' then coalesce(e.reviewed_at, now()) end
      from file_object f
      left join job j on j.tenant_id = f.tenant_id and j.id = f.job_id
     where f.tenant_id = e.tenant_id and f.id = e.file_id
       and e.tenant_id in (${ids.RAYO}::uuid, ${ids.NORTE}::uuid)`)
}

export async function seedCore1(tx: SeedTx, ids: SeedIds): Promise<void> {
  const { F, RAYO, owner, operator, producer } = ids
  const usd = (major: number) => BigInt(major) * 100n

  // ── Evidence links + review pins for the base fixtures ──
  await backfillEvidenceLinks(tx, ids)

  // ── Masters ──
  await tx.update(s.client).set({ reportingGroup: "demo-lab" }).where(eq(s.client.id, F("client_demo_lab")))
  await tx.update(s.supplier).set({ code: "LUM" }).where(eq(s.supplier.id, F("supplier_demo_lumen")))

  // ── Access governance: a non-persona lab member whose role can change ──
  await tx
    .insert(s.appUser)
    .values({ id: F("user_demo_lab_member"), fixtureKey: "user_demo_lab_member", displayName: "Riley Santos", email: "riley.santos@rayodesol.example", kind: "agency", demoPersona: false })
    .onConflictDoUpdate({ target: s.appUser.id, set: { displayName: "Riley Santos", email: "riley.santos@rayodesol.example" } })
  await tx.insert(s.membership).values({ userId: F("user_demo_lab_member"), tenantId: RAYO, role: "viewer" })

  // ── Integrations: a revoked lab connection (dependent actions blocked) ──
  await tx.insert(s.connection).values({
    id: F("connection_demo_lab_revoked"),
    tenantId: RAYO,
    provider: "meta_ads",
    category: "ads",
    mode: "simulated",
    accountAlias: "demo_lab_revoked",
    scopes: ["ads.read"],
    state: "revoked",
    ownerUserId: owner,
  })

  // ── Lab jobs ──
  const labJob = (key: string, name: string, ref: string, sequence: number) => {
    const jn = jobNumber({ clientCode: "LAB", productCode: "XX", year: 2027, jobType: "A", billingCode: "F", sequence })
    return {
      id: F(key),
      tenantId: RAYO,
      fixtureKey: key,
      clientId: F("client_demo_lab"),
      name,
      jobNumber: jn.code,
      displayReference: ref,
      jobType: "A",
      billingCode: "F",
      year: 2027,
      sequence,
      state: "in_progress",
      ownerUserId: operator,
      period: "2027-03",
      currency: "USD",
      services: ["creative", "production", "media"],
      reportingGroup: "demo-lab",
      createdBy: operator,
      updatedBy: operator,
    }
  }
  await tx.insert(s.job).values([
    labJob("job_demo_lab_fee", "Lab fee contract exercise", "RDS-LAB-C1-01", 9101),
    labJob("job_demo_lab_billing", "Lab billing requirements exercise", "RDS-LAB-C1-02", 9102),
  ])

  // ── Lab evidence: client-level PO (reviewed) + accepted delivery (reviewed) ──
  const files = [
    { key: "evidence_demo_c1_lab_po", name: "lab-po-demo.pdf", title: "Feature Lab client PO (demo)", kind: "client_po", job: null as string | null, lines: ["DEMO - SYNTHETIC DOCUMENT", "Feature Lab (demo-lab) client purchase order", "Covers demo-lab jobs; not a real commercial document."] },
    { key: "evidence_demo_c1_lab_acceptance", name: "lab-acceptance-demo.pdf", title: "Feature Lab accepted delivery (demo)", kind: "acceptance", job: "job_demo_lab_billing", lines: ["DEMO - SYNTHETIC DOCUMENT", "Feature Lab accepted delivery note", "Fictional acceptance for the billing requirements exercise."] },
  ]
  for (const f of files) {
    const id = F(f.key)
    const stored = await storeFile(ids.storageDir, RAYO, id, syntheticPdf(f.lines))
    await tx.insert(s.fileObject).values({
      id,
      tenantId: RAYO,
      fixtureKey: f.key,
      logicalId: id,
      version: 1,
      jobId: f.job ? F(f.job) : null,
      originalName: f.name,
      format: "pdf",
      mimeType: "application/pdf",
      sizeBytes: stored.size,
      sha256: stored.sha256,
      storageKey: stored.storageKey,
      extractionStatus: "prepared_demo_extraction",
      extraction: { label: "Prepared demo extraction", fields: { title: f.title } },
      synthetic: "fixture",
      uploadedBy: operator,
    })
    await tx.insert(s.evidence).values({
      id: F(`ev:${f.key}`),
      tenantId: RAYO,
      fixtureKey: f.key,
      kind: f.kind,
      title: f.title,
      fileId: id,
      clientId: F("client_demo_lab"),
      jobId: f.job ? F(f.job) : null,
      reviewState: "reviewed",
      submittedBy: operator,
      reviewedBy: owner,
      reviewedAt: new Date(),
      reviewedFileSha256: stored.sha256,
      reviewedFileVersion: 1,
      reviewReason: "Seeded demo-lab evidence",
    })
  }

  // ── Lab fee job: approved fee 1,000, 10h labor estimate, mixed timesheets,
  // one open supplier commitment (blocks close) ──
  await tx.insert(s.budgetRevision).values([
    { id: F("budget_lab_fee_r1"), tenantId: RAYO, jobId: F("job_demo_lab_fee"), number: 1, state: "approved", agencyFeeMinor: usd(1000), managedMediaMinor: 0n, currency: "USD", reason: "Lab fee exercise", approvedBy: owner, approvedAt: new Date(), createdBy: operator, updatedBy: operator },
    { id: F("budget_lab_billing_r1"), tenantId: RAYO, jobId: F("job_demo_lab_billing"), number: 1, state: "approved", agencyFeeMinor: usd(800), managedMediaMinor: 0n, currency: "USD", reason: "Lab billing exercise", approvedBy: owner, approvedAt: new Date(), createdBy: operator, updatedBy: operator },
  ])
  await tx.insert(s.costEstimate).values({ id: F("estimate_lab_fee_r1"), tenantId: RAYO, jobId: F("job_demo_lab_fee"), number: 1, state: "current", reason: "Lab plan: 10h labor", currency: "USD", createdBy: operator, updatedBy: operator })
  await tx.insert(s.costEstimateLine).values({ tenantId: RAYO, estimateId: F("estimate_lab_fee_r1"), lineType: "labor", description: "Agency labor", minutes: 600, hourlyCostMinor: usd(50), amountMinor: usd(500), currency: "USD" })
  await tx.insert(s.timesheet).values([
    { tenantId: RAYO, fixtureKey: "time_lab_fee_approved", jobId: F("job_demo_lab_fee"), userId: producer, taskLabel: "Lab design", workDate: "2027-03-08", minutes: 720, hourlyCostMinor: usd(50), currency: "USD", state: "approved", approvedBy: operator, createdBy: producer, updatedBy: operator },
    { tenantId: RAYO, fixtureKey: "time_lab_fee_submitted", jobId: F("job_demo_lab_fee"), userId: producer, taskLabel: "Lab revisions", workDate: "2027-03-10", minutes: 120, hourlyCostMinor: usd(50), currency: "USD", state: "submitted", createdBy: producer, updatedBy: producer },
    { tenantId: RAYO, fixtureKey: "time_lab_fee_rejected", jobId: F("job_demo_lab_fee"), userId: producer, taskLabel: "Out-of-scope work", workDate: "2027-03-11", minutes: 180, hourlyCostMinor: usd(50), currency: "USD", state: "rejected", createdBy: producer, updatedBy: operator },
  ])
  await tx.insert(s.budgetReservation).values({ tenantId: RAYO, jobId: F("job_demo_lab_fee"), budgetScope: "agency_cost_authority", amountMinor: usd(100), currency: "USD", state: "committed", purpose: "Lab supplier commitment (open)", createdBy: operator, updatedBy: operator })

  // ── Lab billing job: approved PO on reviewed client-level evidence ──
  await tx.insert(s.contract).values({
    id: F("contract_lab_billing_po_r1"),
    tenantId: RAYO,
    clientId: F("client_demo_lab"),
    jobId: F("job_demo_lab_billing"),
    kind: "client_po",
    reference: "PO-LAB-BILL-01",
    revisionNumber: 1,
    amountMinor: usd(800),
    currency: "USD",
    state: "approved",
    evidenceId: F("ev:evidence_demo_c1_lab_po"),
    validFrom: "2027-03-01",
    validTo: "2027-12-31",
    approvedBy: owner,
    approvedAt: new Date(),
    createdBy: operator,
    updatedBy: operator,
  })
}
