// Seed extension owned by Core-3 (finance: bank accounts, opening cash, chart of accounts, periods, demo-lab assets/FX/rebates/tax).
// Runs inside the demo seed transaction AFTER the base checkpoint
// (ready_for_scope_review). Never seed results of steps the journey has not
// executed yet (no posted journals, payments or approvals ahead of time).
//
// Seeded here (static prerequisites only):
// - chart of accounts and open periods 2027-01..2027-03 of the Demo ledger;
// - simulated bank accounts with a CONFIRMED opening bank entry (Rayo operating
//   USD 10,000 — demo-fixtures final_cash.opening_minor). The opening JOURNAL is
//   not seeded: the posting engine journalizes it when the ledger is first used;
// - synthetic tax profiles, FX table, a managed-media network supplier;
// - demo-lab secondary data on job_demo_lab (lab bank account, lab vendor with a
//   1,000.00 production order + accepted delivery for three-way-match
//   exercises, lab receipts/acceptance documents, rebate agreement, revenue
//   baseline). Demo-lab records never enter Aurora/primary metrics.
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { and, eq } from "drizzle-orm"

import { syntheticPdf } from "@/lib/synthetic-pdf"
import * as s from "@/server/db/schema"

import type { SeedIds, SeedTx } from "./types"

export const CHART_OF_ACCOUNTS: { code: string; name: string; type: "asset" | "liability" | "equity" | "revenue" | "expense" }[] = [
  { code: "cash", name: "Cash (demo bank)", type: "asset" },
  { code: "accounts_receivable", name: "Accounts receivable", type: "asset" },
  { code: "unbilled_fee_asset", name: "Unbilled agency fees", type: "asset" },
  { code: "media_recovery_asset", name: "Media recoverable from client (pass-through)", type: "asset" },
  { code: "rebate_receivable", name: "Supplier rebates receivable", type: "asset" },
  { code: "fixed_assets", name: "Fixed assets at cost", type: "asset" },
  { code: "accumulated_depreciation", name: "Accumulated depreciation", type: "asset" },
  { code: "opening_equity", name: "Opening balance equity", type: "equity" },
  { code: "payroll_payable", name: "Payroll payable", type: "liability" },
  { code: "accrued_production", name: "Accrued production costs", type: "liability" },
  { code: "ap_production", name: "Accounts payable — production", type: "liability" },
  { code: "expense_payable", name: "Expense reimbursements payable", type: "liability" },
  { code: "accrued_media", name: "Accrued media (pass-through)", type: "liability" },
  { code: "ap_media", name: "Accounts payable — media", type: "liability" },
  { code: "ap_fx_revaluation", name: "Payables FX revaluation", type: "liability" },
  { code: "rebate_payable_client", name: "Rebates payable to clients", type: "liability" },
  { code: "unapplied_cash", name: "Unapplied cash receipts", type: "liability" },
  { code: "tax_payable", name: "Synthetic demo tax payable (non-fiscal)", type: "liability" },
  { code: "agency_fee_revenue", name: "Agency fee revenue", type: "revenue" },
  { code: "rebate_income", name: "Rebate income (agency share)", type: "revenue" },
  { code: "fx_gain", name: "FX revaluation gain", type: "revenue" },
  { code: "labor_expense", name: "Labor cost", type: "expense" },
  { code: "production_expense", name: "Production cost", type: "expense" },
  { code: "direct_expense", name: "Direct job expenses", type: "expense" },
  { code: "depreciation_expense", name: "Depreciation expense", type: "expense" },
  { code: "fx_loss", name: "FX revaluation loss", type: "expense" },
]

const usd = (major: number) => BigInt(major) * 100n

async function storeFile(storageDir: string, tenantId: string, objectId: string, bytes: Uint8Array) {
  const dir = path.resolve(storageDir, tenantId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, objectId), bytes)
  return { storageKey: `${tenantId}/${objectId}`, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength }
}

export async function seedCore3(tx: SeedTx, ids: SeedIds): Promise<void> {
  const { F, RAYO, NORTE, owner, operator, producer, norteOwner } = ids

  // ── Chart of accounts + periods ──
  for (const tenant of [RAYO, NORTE]) {
    await tx.insert(s.ledgerAccount).values(CHART_OF_ACCOUNTS.map((a) => ({ tenantId: tenant, code: a.code, name: a.name, accountType: a.type })))
  }
  await tx.insert(s.accountingPeriod).values([
    { id: F("period_rayo_2027_01"), tenantId: RAYO, period: "2027-01" },
    { id: F("period_rayo_2027_02"), tenantId: RAYO, period: "2027-02" },
    { id: F("period_rayo_2027_03"), tenantId: RAYO, period: "2027-03" },
    { id: F("period_norte_2027_03"), tenantId: NORTE, period: "2027-03" },
  ])

  // ── Simulated bank accounts + confirmed opening entries ──
  const [labConn, labEmptyConn] = await tx
    .insert(s.connection)
    .values([
      { tenantId: RAYO, provider: "demo_bank", category: "payments", mode: "simulated", accountAlias: "rayo_lab_demo", scopes: ["payments.read", "payments.initiate"], state: "connected_demo", ownerUserId: owner },
      { tenantId: RAYO, provider: "demo_bank", category: "payments", mode: "simulated", accountAlias: "rayo_lab_empty_demo", scopes: ["payments.read", "payments.initiate"], state: "connected_demo", ownerUserId: owner },
    ])
    .returning({ id: s.connection.id })
  const connOf = async (tenant: string, alias: string) => {
    const [c] = await tx
      .select({ id: s.connection.id })
      .from(s.connection)
      .where(and(eq(s.connection.tenantId, tenant), eq(s.connection.provider, "demo_bank"), eq(s.connection.accountAlias, alias)))
      .limit(1)
    if (!c) throw new Error(`seedCore3: missing demo_bank connection ${alias}`)
    return c.id
  }
  const banks = [
    { key: "bank_demo_rayo_operating", tenant: RAYO, conn: await connOf(RAYO, "rayo_operating_demo"), name: "Rayo operating account (demo bank)", currency: "USD", group: "primary", opening: usd(10000), actor: owner },
    { key: "bank_demo_rayo_lab", tenant: RAYO, conn: labConn!.id, name: "Feature lab account (demo-lab)", currency: "USD", group: "demo-lab", opening: usd(5000), actor: owner },
    // Zero-balance lab account: insufficient-funds exercises never touch Aurora cash.
    { key: "bank_demo_rayo_lab_empty", tenant: RAYO, conn: labEmptyConn!.id, name: "Lab reserve account, empty (demo-lab)", currency: "USD", group: "demo-lab", opening: 0n, actor: owner },
    { key: "bank_demo_norte_operating", tenant: NORTE, conn: await connOf(NORTE, "norte_operating_demo"), name: "Norte operating account (demo bank)", currency: "CAD", group: "primary", opening: BigInt(500000), actor: norteOwner },
  ]
  for (const b of banks) {
    await tx.insert(s.bankAccount).values({ id: F(b.key), tenantId: b.tenant, fixtureKey: b.key, connectionId: b.conn, name: b.name, currency: b.currency, reportingGroup: b.group })
    if (b.opening === 0n) continue
    await tx.insert(s.bankTransaction).values({
      tenantId: b.tenant,
      bankAccountId: F(b.key),
      direction: "in",
      amountMinor: b.opening,
      currency: b.currency,
      businessDate: "2027-03-01",
      kind: "opening",
      provider: "demo_bank",
      providerReceiptId: `sim_opening_${b.key}`,
      sourceType: "opening_balance",
      detail: { simulation: true, label: "Confirmed opening balance (synthetic)" },
      createdBy: b.actor,
    })
  }

  // ── Synthetic tax profiles (never fiscally valid) + FX table ──
  const taxLabel = "Synthetic demo profile — not fiscally valid"
  await tx.insert(s.taxProfile).values([
    { tenantId: RAYO, code: "DEMO_NO_TAX", countries: ["US"], rateBps: 0, label: taxLabel },
    { tenantId: RAYO, code: "DEMO_SYNTHETIC_5_PERCENT", countries: ["US", "MX", "CO"], rateBps: 500, label: taxLabel },
    { tenantId: NORTE, code: "DEMO_NO_TAX", countries: ["CA"], rateBps: 0, label: taxLabel },
  ])
  await tx.insert(s.fxRate).values([
    { tenantId: RAYO, baseCurrency: "CAD", quoteCurrency: "USD", rateMicro: BigInt(750000), rateDate: "2027-02-28", source: "Synthetic demo FX table" },
    { tenantId: RAYO, baseCurrency: "CAD", quoteCurrency: "USD", rateMicro: BigInt(780000), rateDate: "2027-03-31", source: "Synthetic demo FX table" },
  ])

  // ── Suppliers: managed-media network (Aurora media statements) + lab vendor ──
  await tx.insert(s.supplier).values([
    { id: F("supplier_demo_media_network"), tenantId: RAYO, fixtureKey: "supplier_demo_media_network", name: "Demo Media Network (simulated)", country: "US", currency: "USD", externalIds: { ageosRole: "managed_media_network" }, createdBy: operator },
    { id: F("supplier_demo_lab_vendor"), tenantId: RAYO, fixtureKey: "supplier_demo_lab_vendor", name: "Lab Vendor (demo-lab)", country: "US", currency: "USD", createdBy: operator },
  ])

  // ── Demo-lab three-way-match prerequisite: order 1,000.00 + accepted delivery ──
  await tx.insert(s.purchaseOrder).values({
    id: F("order_demo_lab_production"),
    tenantId: RAYO,
    fixtureKey: "order_demo_lab_production",
    jobId: F("job_demo_lab"),
    supplierId: F("supplier_demo_lab_vendor"),
    kind: "production",
    reference: "PO-LAB-PROD-001",
    amountMinor: usd(1000),
    currency: "USD",
    state: "delivered",
    detail: { demoLab: true, purpose: "three-way match exercises" },
    createdBy: operator,
    updatedBy: operator,
  })
  await tx.insert(s.delivery).values({
    id: F("delivery_demo_lab_production"),
    tenantId: RAYO,
    orderId: F("order_demo_lab_production"),
    acceptedMinor: usd(1000),
    currency: "USD",
    state: "accepted",
    businessDate: "2027-03-10",
    detail: { demoLab: true },
    acceptedBy: producer,
  })

  // ── Documents: expense receipts (prepared demo extraction) + lab acceptance ──
  const docs = [
    { key: "file_demo_aurora_expense_receipt", job: "job_demo_aurora", name: "aurora-props-receipt.pdf", lines: ["DEMO - SYNTHETIC RECEIPT", "Props for the hero film shoot", "Total: USD 500.00 - 2027-03-18", "Not a real receipt."], extraction: { amount: "500.00", currency: "USD", date: "2027-03-18", confidence: "high" }, by: producer },
    { key: "file_demo_lab_expense_receipt", job: "job_demo_lab", name: "lab-taxi-receipt.pdf", lines: ["DEMO - SYNTHETIC RECEIPT", "Lab exercise taxi", "Total: USD 25.00 - 2027-03-12", "Not a real receipt."], extraction: { amount: "25.00", currency: "USD", date: "2027-03-12", confidence: "high" }, by: producer },
    { key: "file_demo_lab_blurry_receipt", job: "job_demo_lab", name: "lab-blurry-receipt.pdf", lines: ["DEMO - SYNTHETIC RECEIPT", "Unreadable total"], extraction: { amount: null, currency: "USD", date: null, confidence: "low" }, by: producer },
    { key: "evidence_demo_lab_acceptance", job: "job_demo_lab", name: "lab-accepted-delivery.pdf", lines: ["DEMO - SYNTHETIC DOCUMENT", "Feature lab - accepted delivery note", "Fictional acceptance for demo-lab exercises."], extraction: { title: "Lab accepted delivery" }, by: operator },
    { key: "evidence_demo_lab_po", job: "job_demo_lab", name: "lab-po-r1-1000.pdf", lines: ["DEMO - SYNTHETIC DOCUMENT", "Purchase order PO-LAB-2027-01 revision 1", "Authorized amount: USD 1,000.00", "Not a real commercial document."], extraction: { title: "Lab client PO" }, by: operator },
  ]
  const shaOf = new Map<string, string>()
  for (const d of docs) {
    const id = F(d.key)
    const bytes = syntheticPdf(d.lines)
    const stored = await storeFile(ids.storageDir, RAYO, id, bytes)
    shaOf.set(d.key, stored.sha256)
    await tx.insert(s.fileObject).values({
      id,
      tenantId: RAYO,
      fixtureKey: d.key,
      logicalId: id,
      version: 1,
      jobId: F(d.job),
      originalName: d.name,
      format: "pdf",
      mimeType: "application/pdf",
      sizeBytes: stored.size,
      sha256: stored.sha256,
      storageKey: stored.storageKey,
      extractionStatus: "prepared_demo_extraction",
      extraction: { label: "Prepared demo extraction", fields: d.extraction },
      synthetic: "fixture",
      uploadedBy: d.by,
    })
  }
  // Reviewed lab evidence, linked to the lab client/job and pinned to its file.
  const reviewed = (key: string, kind: string, title: string) => ({
    id: F(`ev:${key}`),
    tenantId: RAYO,
    fixtureKey: key,
    kind,
    title,
    fileId: F(key),
    clientId: F("client_demo_lab"),
    jobId: F("job_demo_lab"),
    reviewState: "reviewed",
    submittedBy: operator,
    reviewedBy: owner,
    reviewedAt: new Date(),
    reviewedFileSha256: shaOf.get(key)!,
    reviewedFileVersion: 1,
  })
  await tx.insert(s.evidence).values([
    reviewed("evidence_demo_lab_acceptance", "acceptance", "Lab accepted delivery"),
    reviewed("evidence_demo_lab_po", "client_po", "Lab client PO (demo-lab)"),
  ])

  // ── Demo-lab rebate agreement + revenue baseline ──
  await tx.insert(s.rebateAgreement).values({
    id: F("rebate_agreement_demo_lab"),
    tenantId: RAYO,
    fixtureKey: "rebate_agreement_demo_lab",
    supplierId: F("supplier_demo_lab_vendor"),
    name: "Lab vendor volume rebate 2027 H1 (synthetic)",
    method: "flat",
    rateBps: 200,
    clientShareBps: 5000,
    exclusions: ["production_fees"],
    validFrom: "2027-01-01",
    validTo: "2027-06-30",
    currency: "USD",
  })
  const months = Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, "0")}`)
  await tx.insert(s.revenueBudgetVersion).values({
    id: F("revenue_budget_demo_lab_baseline"),
    tenantId: RAYO,
    fixtureKey: "revenue_budget_demo_lab_baseline",
    scenarioName: "Lab baseline 2027",
    clientId: F("client_demo_lab"),
    jobId: F("job_demo_lab"),
    periodFrom: "2027-01",
    periodTo: "2027-12",
    currency: "USD",
    amountMinor: usd(20000),
    allocationDriver: "even_monthly",
    // 2,000,000 / 12 by largest remainder (166,667 ×8 then 166,666 ×4).
    lines: months.map((m, i) => ({ month: m, amountMinor: String(i < 8 ? 166667 : 166666) })),
    versionNumber: 1,
    state: "baseline",
    createdBy: owner,
  })
}
