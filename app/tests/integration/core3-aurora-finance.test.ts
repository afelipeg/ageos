// @vitest-environment node
// Aurora finance sequence (03 §11, journeys J05/J06) replayed through the
// domain commands, asserting demo-fixtures.json exactly: cash timeline and AR
// after every step, the 15 expected Demo-ledger journals (order, lines,
// balance, cash after each) and the final trial balance.
//
// Test-setup note: the six Aurora MEDIA orders and their accepted deliveries
// are inserted directly into purchase_order/delivery here (Core-2's media
// issue flow needs rate cards, plan revisions and approvals outside this
// test's scope). Production order/delivery, hours, amendment and evidence go
// through their owners' commands. Production code never bypasses commands.
import { readFileSync } from "node:fs"
import path from "node:path"

import { and, asc, eq, sql } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import * as s from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { proposeAccrualOrFx } from "@/server/domain/accruals"
import { decideApprovalCommand, executeApprovedCommand } from "@/server/domain/approvals"
import { issueDemoClientInvoice } from "@/server/domain/billing"
import { evaluateBillingReadiness } from "@/server/domain/billing-requirements"
import { proposeFeeAmendment, recordClientAuthority, recordCostEstimate } from "@/server/domain/budget"
import { calculateCashScenario } from "@/server/domain/cash-forecast"
import { bankAccountByConnection, cashPosition } from "@/server/domain/cash"
import { closeAccountingPeriod } from "@/server/domain/close"
import { allocateCollection } from "@/server/domain/collections"
import { reviewEvidence } from "@/server/domain/evidence"
import { getJobRevision } from "@/server/domain/jobs"
import { journalsWithLines, postDemoJournal, trialBalance } from "@/server/domain/ledger"
import { approveSupplierInvoice, reconcileDeliveryInvoice, submitExpense } from "@/server/domain/payables"
import { executeBatchPayment, previewPaymentRun, proposePaymentBatch, reconcileBatchPayment } from "@/server/domain/payments"
import { queuePaymentSimulationOutcome } from "@/server/adapters/payments"
import { issueProductionOrder, reviewProductionDelivery } from "@/server/domain/production"
import { computeProfitability, loadJobFinancials } from "@/server/domain/profitability"
import { generateManagementSnapshot } from "@/server/domain/reporting"
import { decideTimesheet, submitTimesheet } from "@/server/domain/timesheets"
import { executeCommand, type CommandDefinition } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo } from "./helpers"

type Fixtures = {
  cash_timeline: { step: string; business_date: string; delta_minor: number; cash_minor: number; ar_minor: number }[]
  expected_final_demo_journals: { id: string; business_date: string; lines: { account: string; side: "debit" | "credit"; amount_minor: number }[]; expected_cash_after_minor: number }[]
  expected_final_trial_balance: { balances_minor: Record<string, number>; sum_minor: number; net_agency_profit_minor: number }
  payment_funding_policy: { pre_collection_attempt: { requested_payment_minor: number }; after_first_collection: { expected_available_after_hold_minor: number } }
}
const FX = JSON.parse(readFileSync(path.resolve(process.cwd(), "../demo-fixtures.json"), "utf8")) as Fixtures

const AURORA = id("job_demo_aurora")
const RULE_OF: Record<string, string> = {
  journal_opening: "journal_opening",
  journal_labor: "journal_labor",
  journal_production_delivery: "journal_production_delivery",
  journal_production_invoice: "journal_production_invoice",
  journal_expense: "journal_expense",
  journal_media_delivery: "journal_media_delivery",
  journal_media_invoice: "journal_media_invoice",
  journal_fee_acceptance: "journal_fee_acceptance",
  journal_client_invoice: "journal_client_invoice",
  journal_first_collection: "journal_collection",
  journal_media_payment: "journal_media_payment",
  journal_production_payment: "journal_production_payment",
  journal_expense_reimbursement: "journal_expense_reimbursement",
  journal_payroll_settlement: "journal_payroll_settlement",
  journal_final_collection: "journal_collection",
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run<R>(ctx: AgencyContext, def: CommandDefinition<any, R>, payload: Record<string, unknown>, expectedRevision?: number) {
  return (await executeCommand(ctx, def, { idempotencyKey: key(def.type), payload, origin: "ui", expectedRevision })).result
}

async function approve(actorKey: string, a: { approvalId: string; payloadDigest: string }) {
  const res = await run(await ctxFor(actorKey), decideApprovalCommand, { approvalId: a.approvalId, decision: "approve", reviewedDigest: a.payloadDigest })
  expect(res, JSON.stringify(res)).toMatchObject({ outcome: "approved", executed: true })
}

async function expectBlocked(p: Promise<unknown>, code: string, rule?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code && (!rule || e.details.rule === rule))
}

let owner: AgencyContext
let operator: AgencyContext
let finance: AgencyContext
let producer: AgencyContext
let bankId = ""
let operatingConnection = ""

async function position() {
  const tenant = owner.tenant.id
  return withTenant(tenant, async (tx) => {
    const cash = await cashPosition(tx, tenant, bankId)
    const [ar] = await tx
      .select({ v: sql<string>`coalesce(sum(${s.clientInvoice.grossMinor} - ${s.clientInvoice.collectedMinor}), 0)` })
      .from(s.clientInvoice)
      .where(and(eq(s.clientInvoice.tenantId, tenant), eq(s.clientInvoice.jobId, AURORA)))
    return { ...cash, arMinor: BigInt(ar?.v ?? "0") }
  })
}

function step(name: string) {
  const t = FX.cash_timeline.find((x) => x.step === name)!
  return { cash: BigInt(t.cash_minor), ar: BigInt(t.ar_minor) }
}

beforeAll(async () => {
  await resetDemo()
  owner = await ctxFor("user_demo_owner")
  operator = await ctxFor("user_demo_operator")
  finance = await ctxFor("user_demo_finance")
  producer = await ctxFor("user_demo_producer")
  const [conn] = await ownerDb().select().from(s.connection).where(and(eq(s.connection.tenantId, owner.tenant.id), eq(s.connection.accountAlias, "rayo_operating_demo")))
  operatingConnection = conn!.id
  bankId = await withTenant(owner.tenant.id, async (tx) => (await bankAccountByConnection(tx, owner.tenant.id, operatingConnection)).account.id)
}, 60_000)

afterAll(async () => {
  await closeOwnerDb()
})

describe("Aurora finance sequence (J05 → J06)", () => {
  it("scope change and client amendment: fee 23,000 on PO r2 53,000 (Core-1 commands)", async () => {
    await run(operator, recordCostEstimate, { job: AURORA, laborMinutes: 8400, hourlyCost: "50.00", productionVendorAmount: "5500.00", expenseAmount: "500.00", reason: "Scope change adds 40 hours" }, await getJobRevision(operator, AURORA))
    const fee = await run(operator, proposeFeeAmendment, { job: AURORA, newAgencyFee: "23000.00", reason: "Price the 40 extra hours" }, await getJobRevision(operator, AURORA))
    await run(finance, decideApprovalCommand, { approvalId: fee.approvalId, decision: "approve", reviewedDigest: fee.payloadDigest })
    await run(owner, reviewEvidence, { evidence: id("ev:evidence_demo_po_r2"), decision: "reviewed", reason: "Signed PO r2 for 53,000" })
    const po = await run(operator, recordClientAuthority, { job: AURORA, reference: "PO-AUR-2027-01", amount: "53000.00", evidenceId: id("ev:evidence_demo_po_r2") })
    await approve("user_demo_owner", po as unknown as { approvalId: string; payloadDigest: string })
    expect((await run(operator, executeApprovedCommand, { approvalId: fee.approvalId })).executed).toBe(true)
    const p = await withTenant(owner.tenant.id, async (tx) => computeProfitability(await loadJobFinancials(tx, owner.tenant.id, AURORA), "forecast", "rayo-de-sol"))
    expect(p).toMatchObject({ agencyFeeMinor: 2300000n, marginBps: 4348 })
  })

  it("orders, accepted deliveries, approved hours and expense (no cost recognized yet)", async () => {
    const order = await run(operator, issueProductionOrder, { job: AURORA, supplier: id("supplier_demo_lumen"), amount: "5500.00", deliverable: "Spring hero film" })
    await run(operator, reviewProductionDelivery, { job: AURORA, deliverable: "Spring hero film", deliveryDate: "2027-03-22", assetFile: id("file_demo_aurora_hero_asset"), rightsCleared: true, qualityResult: "passed" })
    const [d] = await ownerDb().select().from(s.delivery).where(eq(s.delivery.orderId, String(order.orderId)))
    expect(d).toMatchObject({ state: "accepted", acceptedMinor: 550000n })

    // Test setup only: the six reallocated media orders (30,000) and their accepted deliveries.
    const media: [string, string, number][] = [
      ["meta", "supplier_demo_meta_ads", 900000],
      ["google", "supplier_demo_google_ads", 900000],
      ["tiktok", "supplier_demo_tiktok_ads", 400000],
      ["ctv", "supplier_demo_dv360", 400000],
      ["radio", "supplier_demo_city_radio", 200000],
      ["ooh", "supplier_demo_ooh_operator", 200000],
    ]
    for (const [channel, supplierKey, amount] of media) {
      const [o] = await ownerDb()
        .insert(s.purchaseOrder)
        .values({ tenantId: owner.tenant.id, jobId: AURORA, supplierId: id(supplierKey), kind: "media", reference: `TEST-MO-AUR-${channel.toUpperCase()}`, amountMinor: BigInt(amount), currency: "USD", state: "delivered", detail: { testSetup: true, channel } })
        .returning()
      await ownerDb().insert(s.delivery).values({ tenantId: owner.tenant.id, orderId: o!.id, acceptedMinor: BigInt(amount), currency: "USD", state: "accepted", businessDate: "2027-03-22", detail: { testSetup: true } })
    }

    for (const [minutes, date, task] of [[6000, "2027-03-12", "Base scope 100h"], [2400, "2027-03-19", "Scope change 40h"]] as const) {
      const t = await run(producer, submitTimesheet, { job: AURORA, taskTitle: task, member: producer.user.id, workDate: date, minutes, hourlyCost: "50.00" })
      await run(operator, decideTimesheet, { timesheet: t.timesheetId, revision: t.revision, decision: "approve" })
    }

    const exp = await run(producer, submitExpense, { job: AURORA, claimant: producer.user.id, receipt: id("file_demo_aurora_expense_receipt"), expenseDate: "2027-03-18", amount: "500.00", category: "production_supplies", description: "Props for the hero film shoot" })
    expect(exp.state).toBe("awaiting_approval")
    await expectBlocked(run(producer, decideApprovalCommand, { approvalId: exp.approval_requests[0]!.approvalId, decision: "approve", reviewedDigest: exp.approval_requests[0]!.payloadDigest }), "forbidden")
    await approve("user_demo_finance", exp.approval_requests[0]! as { approvalId: string; payloadDigest: string })

    const journals = await withTenant(owner.tenant.id, (tx) => journalsWithLines(tx, owner.tenant.id, {}))
    expect(journals).toHaveLength(0)
  })

  it("supplier invoice 6,000 vs 5,500 is held; the corrected 5,500 matches the same cost item; payables approved by finance", async () => {
    const held = await run(owner, reconcileDeliveryInvoice, { job: AURORA, supplier: id("supplier_demo_lumen"), invoiceNumber: "DEMO-LUM-031", invoiceAmount: "6000.00", tolerance: "0.00" })
    expect(held.match_result).toMatchObject({ status: "hold", paymentHold: true })
    expect(held.discrepancies[0]).toMatchObject({ discrepancyMinor: "50000" })
    await expectBlocked(run(owner, approveSupplierInvoice, { supplier: id("supplier_demo_lumen"), job: AURORA, invoiceNumber: "DEMO-LUM-031", invoiceDate: "2027-03-22", dueDate: "2027-04-21", invoiceAmount: "6000.00", period: "2027-03" }), "blocked_by_rule", "three_way_mismatch")

    const fixed = await run(owner, reconcileDeliveryInvoice, { job: AURORA, supplier: id("supplier_demo_lumen"), invoiceNumber: "DEMO-LUM-031", invoiceAmount: "5500.00", tolerance: "0.00" })
    expect(fixed).toMatchObject({ invoiceId: held.invoiceId, action: "corrected", match_result: { status: "matched" } })

    const reg = await run(owner, approveSupplierInvoice, { supplier: id("supplier_demo_lumen"), job: AURORA, invoiceNumber: "DEMO-LUM-031", invoiceDate: "2027-03-22", dueDate: "2027-04-21", invoiceAmount: "5500.00", period: "2027-03" })
    expect(reg.duplicate_check.status).toBe("registered_existing")
    await expectBlocked(run(owner, decideApprovalCommand, { approvalId: (reg.registration_proposal!.approval as { approvalId: string }).approvalId, decision: "approve", reviewedDigest: (reg.registration_proposal!.approval as { payloadDigest: string }).payloadDigest }), "approver_not_eligible")
    await approve("user_demo_finance", reg.registration_proposal!.approval as { approvalId: string; payloadDigest: string })
    await expectBlocked(run(owner, approveSupplierInvoice, { supplier: id("supplier_demo_lumen"), job: AURORA, invoiceNumber: "DEMO-LUM-031", invoiceDate: "2027-03-22", dueDate: "2027-04-21", invoiceAmount: "6000.00", period: "2027-03" }), "blocked_by_rule", "duplicate_supplier_invoice")

    const mediaInv = await run(owner, approveSupplierInvoice, { supplier: id("supplier_demo_media_network"), job: AURORA, invoiceNumber: "DEMO-MEDIA-AUR-03", invoiceDate: "2027-03-22", dueDate: "2027-04-21", invoiceAmount: "30000.00", period: "2027-03" })
    expect(mediaInv.state).toBe("matched")
    await approve("user_demo_finance", mediaInv.registration_proposal!.approval as { approvalId: string; payloadDigest: string })

    const invoices = await ownerDb().select().from(s.supplierInvoice).where(eq(s.supplierInvoice.jobId, AURORA))
    expect(invoices.map((i) => [i.invoiceNumber, i.state, i.amountMinor]).sort()).toEqual([["DEMO-LUM-031", "payable", 550000n], ["DEMO-MEDIA-AUR-03", "payable", 3000000n]])
    expect(invoices.find((i) => i.invoiceNumber === "DEMO-LUM-031")!.documentRevision).toBe(2)
  })

  it("recognition run (owner prepares, finance approves) posts the first 8 journals in order", async () => {
    await run(owner, reviewEvidence, { evidence: id("ev:evidence_demo_aurora_acceptance"), decision: "reviewed", reason: "Client accepted the spring launch delivery" })
    const rec = await run(owner, proposeAccrualOrFx, { adjustmentType: "accrual", job: AURORA, period: "2027-03" })
    await expectBlocked(run(owner, decideApprovalCommand, { approvalId: rec.approvalId, decision: "approve", reviewedDigest: rec.payloadDigest }), "approver_not_eligible")
    await approve("user_demo_finance", rec as unknown as { approvalId: string; payloadDigest: string })
    const journals = await withTenant(owner.tenant.id, (tx) => journalsWithLines(tx, owner.tenant.id, { excludeGroups: ["demo-lab"] }))
    expect(journals.map((j) => j.ruleKey)).toEqual(FX.expected_final_demo_journals.slice(0, 8).map((j) => RULE_OF[j.id]))
    const incurred = await withTenant(owner.tenant.id, async (tx) => computeProfitability(await loadJobFinancials(tx, owner.tenant.id, AURORA), "incurred", "rayo-de-sol"))
    expect(incurred).toMatchObject({ agencyFeeMinor: 2300000n, marginMinor: 1000000n, marginBps: 4348, managedMediaMinor: 3000000n, unmetRequirements: [] })
    expect(incurred.agencyCost.totalMinor).toBe(1300000n)
  })

  it("demo invoice 53,000 (fee 23,000 + media recovery 30,000), cash 10,000 and AR 53,000", async () => {
    await run(operator, evaluateBillingReadiness, { job: AURORA, deliverableAccepted: true, acceptanceEvidence: id("ev:evidence_demo_aurora_acceptance") })
    const draft = await run(operator, issueDemoClientInvoice, { job: AURORA, invoiceDate: "2027-03-22", feeAmount: "23000.00", mediaRecoveryAmount: "30000.00" })
    expect(draft.split_allocation).toMatchObject({ agencyRevenueMinor: "2300000", passThroughRecoveryMinor: "3000000" })
    await approve("user_demo_finance", draft as unknown as { approvalId: string; payloadDigest: string })
    const [inv] = await ownerDb().select().from(s.clientInvoice).where(eq(s.clientInvoice.id, String(draft.invoiceId)))
    expect(inv).toMatchObject({ number: "DEMO-INV-0001", state: "issued_demo", feeMinor: 2300000n, mediaRecoveryMinor: 3000000n, taxMinor: 0n, grossMinor: 5300000n, label: "DEMO — NOT A TAX INVOICE" })
    const pos = await position()
    expect([pos.confirmedMinor, pos.arMinor]).toEqual([step("invoice_issued").cash, step("invoice_issued").ar])
  })

  it("paying 43,000 before the first collection is blocked for insufficient funds (no provider effect)", async () => {
    const effectsBefore = (await ownerDb().select().from(s.demoProviderEffect).where(eq(s.demoProviderEffect.tenantId, owner.tenant.id))).length
    await expectBlocked(
      run(owner, proposePaymentBatch, { connection: operatingConnection, paymentDate: "2027-03-24", dueThrough: "2027-04-30", paymentMethod: "bank_transfer", batchAmount: "43000.00" }),
      "insufficient_funds",
      "insufficient_funds"
    )
    expect(BigInt(FX.payment_funding_policy.pre_collection_attempt.requested_payment_minor)).toBe(4300000n)
    expect((await ownerDb().select().from(s.demoProviderEffect).where(eq(s.demoProviderEffect.tenantId, owner.tenant.id))).length).toBe(effectsBefore)
  })

  it("first collection 40,000: cash 50,000, AR 13,000; the same receipt again never credits twice", async () => {
    const payload = { job: AURORA, invoiceNumber: "DEMO-INV-0001", receiptAmount: "40000.00", receiptDate: "2027-03-23", receiptReference: "sim_receipt_collection_demo_first" }
    const first = await run(operator, allocateCollection, payload)
    expect(first.duplicateReceipt).toBe(false)
    expect((await run(operator, allocateCollection, payload)).duplicateReceipt).toBe(true)
    const pos = await position()
    expect([pos.confirmedMinor, pos.arMinor]).toEqual([step("first_collection").cash, step("first_collection").ar])
  })

  let payments: { paymentId: string; category: string }[] = []

  it("batch 43,000 prepared by the owner, approved by finance, reserves funds atomically: available 7,000", async () => {
    const preview = await previewPaymentRun(owner, { connection: operatingConnection, dueThrough: "2027-04-30" })
    expect(preview.totalMinor).toBe(4300000n)
    expect(preview.items.map((i) => [i.category, i.amountMinor])).toEqual([["media", 3000000n], ["production", 550000n], ["expense", 50000n], ["payroll", 700000n]])
    const batch = await run(owner, proposePaymentBatch, { connection: operatingConnection, paymentDate: "2027-03-24", dueThrough: "2027-04-30", paymentMethod: "bank_transfer", batchAmount: "43000.00" })
    await expectBlocked(run(owner, decideApprovalCommand, { approvalId: batch.approvalId, decision: "approve", reviewedDigest: batch.payloadDigest }), "approver_not_eligible")
    await approve("user_demo_finance", batch as unknown as { approvalId: string; payloadDigest: string })
    const pos = await position()
    expect(pos.confirmedMinor).toBe(5000000n)
    expect(pos.availableMinor).toBe(BigInt(FX.payment_funding_policy.after_first_collection.expected_available_after_hold_minor))
    payments = (batch.payment_list_proposal.items as { paymentId: string; category: string }[]).map((p) => ({ paymentId: p.paymentId, category: p.category }))
  })

  it("payments settle once, in order; the production payment times out after effect and is reconciled from the provider (one effect)", async () => {
    const pay = (category: string) => payments.find((p) => p.category === category)!.paymentId
    await expectBlocked(run(owner, executeBatchPayment, { paymentId: pay("media") }), "forbidden")
    const media = await run(finance, executeBatchPayment, { paymentId: pay("media") })
    expect(media.state).toBe("succeeded")
    expect((await position()).confirmedMinor).toBe(step("media_payment").cash)

    // Presenter control: the next simulated payment times out after its effect.
    await run(owner, queuePaymentSimulationOutcome, { failureMode: "timeout_after_effect" })
    const unknown = await run(finance, executeBatchPayment, { paymentId: pay("production") })
    expect(unknown.state).toBe("outcome_unknown")
    const held = await position()
    expect([held.confirmedMinor, held.activeHoldsMinor]).toEqual([step("media_payment").cash, 550000n + 50000n + 700000n])
    await expectBlocked(run(finance, executeBatchPayment, { paymentId: pay("production") }), "blocked_by_rule", "outcome_unknown_reconcile_first")
    const rec = await run(finance, reconcileBatchPayment, { paymentId: pay("production") })
    expect(rec).toMatchObject({ state: "succeeded", effectCount: 1 })
    expect((await run(finance, reconcileBatchPayment, { paymentId: pay("production") })).replayed).toBe(true)
    const [p] = await ownerDb().select().from(s.payment).where(eq(s.payment.id, pay("production")))
    const effects = await ownerDb().select().from(s.demoProviderEffect).where(eq(s.demoProviderEffect.receiptId, p!.receiptId!))
    expect(effects).toHaveLength(1)
    expect(p!.receiptId!.startsWith("sim_")).toBe(true)
    expect((await position()).confirmedMinor).toBe(step("production_payment_reconciled").cash)

    await run(finance, executeBatchPayment, { paymentId: pay("expense") })
    expect((await position()).confirmedMinor).toBe(step("expense_reimbursement").cash)
    await run(finance, executeBatchPayment, { paymentId: pay("payroll"), businessDate: "2027-03-25" })
    const after = await position()
    expect([after.confirmedMinor, after.activeHoldsMinor, after.arMinor]).toEqual([step("payroll_settlement").cash, 0n, step("payroll_settlement").ar])
  })

  it("final collection 13,000: cash 20,000, AR 0", async () => {
    await run(operator, allocateCollection, { job: AURORA, invoiceNumber: "DEMO-INV-0001", receiptAmount: "13000.00", receiptDate: "2027-03-27", receiptReference: "sim_receipt_collection_demo_final" })
    const pos = await position()
    expect([pos.confirmedMinor, pos.arMinor]).toEqual([step("final_collection").cash, step("final_collection").ar])
  })

  it("bank movements reproduce the cash timeline exactly", async () => {
    const moves = await ownerDb().select().from(s.bankTransaction).where(eq(s.bankTransaction.bankAccountId, bankId)).orderBy(asc(s.bankTransaction.businessDate), asc(s.bankTransaction.createdAt))
    let cash = 0n
    const timeline = moves.map((m) => {
      cash += m.direction === "in" ? m.amountMinor : -m.amountMinor
      return [m.businessDate, cash]
    })
    const expected = FX.cash_timeline.filter((t) => t.delta_minor !== 0).map((t) => [t.business_date, BigInt(t.cash_minor)])
    expect(timeline).toEqual(expected)
  })

  it("the 15 expected Demo-ledger journals, in order, balanced, with the expected cash after each", async () => {
    const journals = await withTenant(owner.tenant.id, (tx) => journalsWithLines(tx, owner.tenant.id, { excludeGroups: ["demo-lab"] }))
    expect(journals.map((j) => j.ruleKey)).toEqual(FX.expected_final_demo_journals.map((j) => RULE_OF[j.id]))
    let cash = 0n
    journals.forEach((j, i) => {
      const exp = FX.expected_final_demo_journals[i]!
      const lines = j.lines.map((l) => [l.accountCode, l.debitMinor > 0n ? "debit" : "credit", l.debitMinor > 0n ? l.debitMinor : l.creditMinor]).sort()
      expect(lines, exp.id).toEqual(exp.lines.map((l) => [l.account, l.side, BigInt(l.amount_minor)]).sort())
      expect(j.lines.reduce((a, l) => a + l.debitMinor - l.creditMinor, 0n), `${exp.id} balanced`).toBe(0n)
      expect(j.businessDate, exp.id).toBe(exp.business_date)
      expect(j.ledgerLabel).toBe("Demo ledger — synthetic, non-fiscal")
      cash += j.lines.filter((l) => l.accountCode === "cash").reduce((a, l) => a + l.debitMinor - l.creditMinor, 0n)
      expect(cash, `${exp.id} cash after`).toBe(BigInt(exp.expected_cash_after_minor))
    })
  })

  it("trial balance equals expected_final_trial_balance: sums to 0, net agency profit 10,000", async () => {
    const tb = await withTenant(owner.tenant.id, (tx) => trialBalance(tx, owner.tenant.id, { excludeGroups: ["demo-lab"] }))
    expect(tb.currencies).toHaveLength(1)
    const usd = tb.currencies[0]!
    const expected = FX.expected_final_trial_balance
    for (const [account, v] of Object.entries(expected.balances_minor)) expect(usd.balances[account] ?? 0n, account).toBe(BigInt(v))
    for (const [account, v] of Object.entries(usd.balances)) if (v !== 0n) expect(expected.balances_minor, `unexpected balance ${account}`).toHaveProperty(account)
    expect(usd.sumMinor).toBe(BigInt(expected.sum_minor))
    expect(usd.netProfitMinor).toBe(BigInt(expected.net_agency_profit_minor))
    const posted = await withTenant(owner.tenant.id, async (tx) => computeProfitability(await loadJobFinancials(tx, owner.tenant.id, AURORA), "posted", "rayo-de-sol"))
    expect(posted).toMatchObject({ agencyFeeMinor: 2300000n, marginMinor: 1000000n, marginBps: 4348 })
  })

  it("cash forecast opens at confirmed cash 20,000 with nothing double counted; management snapshot reconciles", async () => {
    const forecast = await calculateCashScenario(owner, { openingCash: "20000.00", currency: "USD", asOfDate: "2027-03-31", horizonDays: 90, scenario: "base" })
    expect(forecast.currency_buckets[0]).toMatchObject({ confirmedCashMinor: 2000000n, probableInflowsMinor: 0n, availableMinor: 2000000n })
    await expectBlocked(calculateCashScenario(owner, { openingCash: "33000.00", currency: "USD", asOfDate: "2027-03-31", horizonDays: 90, scenario: "base" }), "blocked_by_rule", "opening_cash_not_confirmed")
    const snap = await run(owner, generateManagementSnapshot, { period: "2027-03", basis: "posted", includeManagedMedia: true })
    expect(snap.kpi_summary).toMatchObject({ revenueMinor: "2300000", costMinor: "1300000", marginBps: 4348, cashMinor: "2000000", receivablesMinor: "0", managedMediaMinor: "3000000" })
    expect((snap.management_pack.reconciliation as { equal: boolean }[]).every((r) => r.equal)).toBe(true)
  })

  it("J06: demo-lab recognition, checklist, close 2027-03; writes blocked afterwards; reopen needs a reason", async () => {
    // Secondary demo-lab items pending in March are recognized first (J06).
    for (let i = 0; i < 5; i++) {
      const check = await run(owner, closeAccountingPeriod, { period: "2027-03", action: "check_readiness" })
      const pending = (check.close_checklist as { id: string; items: { recordId: string }[] }[]).find((c) => c.id === "unrecognized_items")!.items
      if (!pending.length) break
      for (const item of pending) {
        expect(item.recordId).not.toBe(AURORA)
        const rec = await run(owner, proposeAccrualOrFx, { adjustmentType: "accrual", job: item.recordId, period: "2027-03" })
        await approve("user_demo_finance", rec as unknown as { approvalId: string; payloadDigest: string })
      }
    }
    // Close is a proposal: it needs a reason and an approver other than the proposer.
    await expectBlocked(run(owner, closeAccountingPeriod, { period: "2027-03", action: "close" }), "blocked_by_rule", "close_reason_required")
    const proposal = await run(owner, closeAccountingPeriod, { period: "2027-03", action: "close", reason: "March demo ledger reconciled and complete" })
    expect(proposal).toMatchObject({ state: "open", pendingApproval: true })
    await expectBlocked(run(owner, decideApprovalCommand, { approvalId: proposal.approvalId, decision: "approve", reviewedDigest: proposal.payloadDigest }), "self_approval")
    const [stillOpen] = await ownerDb().select().from(s.accountingPeriod).where(and(eq(s.accountingPeriod.tenantId, owner.tenant.id), eq(s.accountingPeriod.period, "2027-03")))
    expect(stillOpen!.state).toBe("open")
    await approve("user_demo_finance", proposal as unknown as { approvalId: string; payloadDigest: string })
    const [closedRow] = await ownerDb().select().from(s.accountingPeriod).where(and(eq(s.accountingPeriod.tenantId, owner.tenant.id), eq(s.accountingPeriod.period, "2027-03")))
    expect(closedRow!.state).toBe("closed")
    await expectBlocked(
      run(owner, postDemoJournal, { job: AURORA, period: "2027-03", businessDate: "2027-03-28", debitAccount: "direct_expense", debitAmount: "1.00", creditAccount: "expense_payable", creditAmount: "1.00", memo: "After close" }),
      "blocked_by_rule",
      "period_closed"
    )
    await expectBlocked(run(owner, closeAccountingPeriod, { period: "2027-03", action: "reopen" }), "blocked_by_rule", "reopen_reason_required")
    await expectBlocked(run(await ctxFor("user_demo_viewer"), closeAccountingPeriod, { period: "2027-03", action: "reopen", reason: "Viewer tries to reopen" }), "forbidden")
    const events = await ownerDb().select().from(s.businessEvent).where(and(eq(s.businessEvent.tenantId, owner.tenant.id), eq(s.businessEvent.eventType, "period.closed")))
    expect(events).toHaveLength(1)
    // Primary journals unchanged by the demo-lab recognitions and the close.
    const journals = await withTenant(owner.tenant.id, (tx) => journalsWithLines(tx, owner.tenant.id, { excludeGroups: ["demo-lab"] }))
    expect(journals).toHaveLength(15)
  })
})
