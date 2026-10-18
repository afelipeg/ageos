import { sql } from "drizzle-orm"
import {
  bigserial,
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { createdAt, minor, pk, revision, updatedAt } from "./columns"
import { client, job, supplier } from "./commercial"
import { connection } from "./configuration"
import { purchaseOrder } from "./operations"
import { appUser } from "./platform"
import { tenantId, tenantUnique } from "./tenant"

// Schema owned by Core-3: suppliers & payments, billing & collections,
// accounting & close, profitability. Money is bigint minor units next to an
// explicit currency. The ledger is the internal "Demo ledger — synthetic,
// non-fiscal"; nothing here is a real bank, tax or accounting record.
//
// No-duplication contract (03 §6): order → delivery → supplier invoice →
// payment are stages of ONE cost. Delivery recognition posts the cost once
// (recognition_record is unique per source), a matching supplier invoice only
// reclassifies the liability, and a payment only settles it.

const actor = (name: string) => uuid(name).references(() => appUser.id)

// ── Ledger ──

export const ledgerAccount = pgTable(
  "ledger_account",
  {
    id: pk(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    // asset | liability | equity | revenue | expense
    accountType: text("account_type").notNull(),
    createdAt: createdAt(),
  },
  (t) => [tenantUnique("ledger_account", t), unique("ledger_account_code_uq").on(t.tenantId, t.code)]
)

export const accountingPeriod = pgTable(
  "accounting_period",
  {
    id: pk(),
    tenantId: tenantId(),
    period: text("period").notNull(),
    // open | closed
    state: text("state").notNull().default("open"),
    closedBy: actor("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeSnapshot: jsonb("close_snapshot"),
    reopenReason: text("reopen_reason"),
    reopenedBy: actor("reopened_by"),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [tenantUnique("accounting_period", t), unique("accounting_period_uq").on(t.tenantId, t.period)]
)

export const journalEntry = pgTable(
  "journal_entry",
  {
    id: pk(),
    tenantId: tenantId(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    // Stable key of the business fact posted (unique: a fact posts once).
    entryKey: text("entry_key").notNull(),
    // Posting rule (journal_opening, journal_labor, …, manual, fx_revaluation…).
    ruleKey: text("rule_key").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    jobId: uuid("job_id"),
    period: text("period").notNull(),
    businessDate: date("business_date").notNull(),
    currency: text("currency").notNull(),
    memo: text("memo").notNull(),
    ledgerLabel: text("ledger_label").notNull(),
    // posted | reversed
    state: text("state").notNull().default("posted"),
    // primary | demo-lab (secondary exercises never enter primary reports)
    reportingGroup: text("reporting_group").notNull().default("primary"),
    preparedBy: actor("prepared_by"),
    approvedBy: actor("approved_by"),
    approvalId: uuid("approval_id"),
    reversesId: uuid("reverses_id"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantUnique("journal_entry", t),
    unique("journal_entry_key_uq").on(t.tenantId, t.entryKey),
    index("journal_entry_job_idx").on(t.tenantId, t.jobId),
    index("journal_entry_period_idx").on(t.tenantId, t.period),
    foreignKey({ name: "journal_entry_job_fk", columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
  ]
)

export const journalLine = pgTable(
  "journal_line",
  {
    id: pk(),
    tenantId: tenantId(),
    entryId: uuid("entry_id").notNull(),
    lineNo: integer("line_no").notNull(),
    accountCode: text("account_code").notNull(),
    debitMinor: minor("debit_minor").notNull().default(sql`0`),
    creditMinor: minor("credit_minor").notNull().default(sql`0`),
    currency: text("currency").notNull(),
    jobId: uuid("job_id"),
  },
  (t) => [
    tenantUnique("journal_line", t),
    unique("journal_line_no_uq").on(t.tenantId, t.entryId, t.lineNo),
    foreignKey({ name: "journal_line_entry_fk", columns: [t.tenantId, t.entryId], foreignColumns: [journalEntry.tenantId, journalEntry.id] }),
    foreignKey({ name: "journal_line_account_fk", columns: [t.tenantId, t.accountCode], foreignColumns: [ledgerAccount.tenantId, ledgerAccount.code] }),
  ]
)

// What was recognized into the ledger, per source record (no double count).
export const recognitionRecord = pgTable(
  "recognition_record",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    // labor | production | expense | media | fee
    category: text("category").notNull(),
    // timesheet | delivery | expense | budget_revision
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    journalEntryId: uuid("journal_entry_id").notNull(),
    adjustmentId: uuid("adjustment_id"),
    period: text("period").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("recognition_record", t),
    unique("recognition_source_uq").on(t.tenantId, t.category, t.sourceType, t.sourceId),
    index("recognition_job_idx").on(t.tenantId, t.jobId),
    foreignKey({ name: "recognition_job_fk", columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
    foreignKey({ name: "recognition_entry_fk", columns: [t.tenantId, t.journalEntryId], foreignColumns: [journalEntry.tenantId, journalEntry.id] }),
  ]
)

// Recognition runs, accruals, FX revaluations: proposal → approval → posting.
export const accountingAdjustment = pgTable(
  "accounting_adjustment",
  {
    id: pk(),
    tenantId: tenantId(),
    // recognition | fx_revaluation | manual_journal | depreciation | rebate_provision
    kind: text("kind").notNull(),
    jobId: uuid("job_id"),
    period: text("period").notNull(),
    businessDate: date("business_date").notNull(),
    currency: text("currency").notNull(),
    inputs: jsonb("inputs").notNull().default({}),
    result: jsonb("result").notNull().default({}),
    journalPlan: jsonb("journal_plan").notNull().default([]),
    // awaiting_approval | posted | rejected | blocked | reversed
    state: text("state").notNull().default("awaiting_approval"),
    reportingGroup: text("reporting_group").notNull().default("primary"),
    approvalId: uuid("approval_id"),
    journalEntryIds: jsonb("journal_entry_ids").notNull().default([]),
    reversalDate: date("reversal_date"),
    preparedBy: actor("prepared_by"),
    approvedBy: actor("approved_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("accounting_adjustment", t),
    index("accounting_adjustment_job_idx").on(t.tenantId, t.jobId),
    foreignKey({ name: "accounting_adjustment_job_fk", columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
  ]
)

export const fxRate = pgTable(
  "fx_rate",
  {
    id: pk(),
    tenantId: tenantId(),
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    // Units of quote currency per 1 base currency, in millionths (exact).
    rateMicro: minor("rate_micro").notNull(),
    rateDate: date("rate_date").notNull(),
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [tenantUnique("fx_rate", t), unique("fx_rate_uq").on(t.tenantId, t.baseCurrency, t.quoteCurrency, t.rateDate)]
)

export const fixedAsset = pgTable(
  "fixed_asset",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    jobId: uuid("job_id"),
    costMinor: minor("cost_minor").notNull(),
    residualMinor: minor("residual_minor").notNull(),
    currency: text("currency").notNull(),
    lifeMonths: integer("life_months").notNull(),
    startDate: date("start_date").notNull(),
    // straight_line
    method: text("method").notNull(),
    // registered | disposed
    state: text("state").notNull().default("registered"),
    reportingGroup: text("reporting_group").notNull().default("primary"),
    createdBy: actor("created_by"),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("fixed_asset", t),
    unique("fixed_asset_name_uq").on(t.tenantId, t.name),
    foreignKey({ name: "fixed_asset_job_fk", columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
  ]
)

export const depreciationEntry = pgTable(
  "depreciation_entry",
  {
    id: pk(),
    tenantId: tenantId(),
    assetId: uuid("asset_id").notNull(),
    month: text("month").notNull(),
    chargeMinor: minor("charge_minor").notNull(),
    accumulatedMinor: minor("accumulated_minor").notNull(),
    netBookMinor: minor("net_book_minor").notNull(),
    // scheduled | proposed | posted
    state: text("state").notNull().default("scheduled"),
    adjustmentId: uuid("adjustment_id"),
    journalEntryId: uuid("journal_entry_id"),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("depreciation_entry", t),
    unique("depreciation_month_uq").on(t.tenantId, t.assetId, t.month),
    foreignKey({ name: "depreciation_asset_fk", columns: [t.tenantId, t.assetId], foreignColumns: [fixedAsset.tenantId, fixedAsset.id] }),
  ]
)

// ── Treasury (simulated demo bank) ──

export const bankAccount = pgTable(
  "bank_account",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    connectionId: uuid("connection_id").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    reportingGroup: text("reporting_group").notNull().default("primary"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("bank_account", t),
    unique("bank_account_connection_uq").on(t.tenantId, t.connectionId),
    foreignKey({ name: "bank_account_connection_fk", columns: [t.tenantId, t.connectionId], foreignColumns: [connection.tenantId, connection.id] }),
  ]
)

// Confirmed movements of the fictional bank account. available_cash =
// confirmed cash − active payment holds; receivables never count as cash.
export const bankTransaction = pgTable(
  "bank_transaction",
  {
    id: pk(),
    tenantId: tenantId(),
    bankAccountId: uuid("bank_account_id").notNull(),
    // in | out
    direction: text("direction").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    businessDate: date("business_date").notNull(),
    // opening | collection | payment
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    // Unique per account: repeating a receipt never moves cash twice.
    providerReceiptId: text("provider_receipt_id").notNull(),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    // confirmed
    state: text("state").notNull().default("confirmed"),
    statementLineId: text("statement_line_id"),
    detail: jsonb("detail").notNull().default({}),
    createdBy: actor("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("bank_transaction", t),
    unique("bank_transaction_receipt_uq").on(t.tenantId, t.bankAccountId, t.providerReceiptId),
    index("bank_transaction_account_idx").on(t.tenantId, t.bankAccountId),
    foreignKey({ name: "bank_transaction_account_fk", columns: [t.tenantId, t.bankAccountId], foreignColumns: [bankAccount.tenantId, bankAccount.id] }),
  ]
)

export const bankStatementImport = pgTable(
  "bank_statement_import",
  {
    id: pk(),
    tenantId: tenantId(),
    bankAccountId: uuid("bank_account_id").notNull(),
    fileId: uuid("file_id").notNull(),
    fileSha256: text("file_sha256").notNull(),
    statementDate: date("statement_date").notNull(),
    closingBalanceMinor: minor("closing_balance_minor").notNull(),
    bookBalanceMinor: minor("book_balance_minor").notNull(),
    differenceMinor: minor("difference_minor").notNull(),
    currency: text("currency").notNull(),
    result: jsonb("result").notNull().default({}),
    createdBy: actor("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("bank_statement_import", t),
    foreignKey({ name: "bank_statement_account_fk", columns: [t.tenantId, t.bankAccountId], foreignColumns: [bankAccount.tenantId, bankAccount.id] }),
  ]
)

// One row per imported statement line id: a bank line is applied once.
export const bankStatementLine = pgTable(
  "bank_statement_line",
  {
    id: pk(),
    tenantId: tenantId(),
    bankAccountId: uuid("bank_account_id").notNull(),
    importId: uuid("import_id").notNull(),
    lineId: text("line_id").notNull(),
    businessDate: date("business_date").notNull(),
    direction: text("direction").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    reference: text("reference").notNull(),
    // matched | settled | unapplied | bank_charge
    outcome: text("outcome").notNull(),
    bankTransactionId: uuid("bank_transaction_id"),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("bank_statement_line", t),
    unique("bank_statement_line_uq").on(t.tenantId, t.bankAccountId, t.lineId),
    foreignKey({ name: "bank_statement_line_import_fk", columns: [t.tenantId, t.importId], foreignColumns: [bankStatementImport.tenantId, bankStatementImport.id] }),
  ]
)

// ── Payables & expenses ──

export const supplierInvoice = pgTable(
  "supplier_invoice",
  {
    id: pk(),
    tenantId: tenantId(),
    supplierId: uuid("supplier_id").notNull(),
    jobId: uuid("job_id").notNull(),
    // production (orders of this supplier) | media (consolidated media statement of the job)
    costCategory: text("cost_category").notNull(),
    orderId: uuid("order_id"),
    invoiceNumber: text("invoice_number").notNull(),
    // supplier|number|currency — a repeated key is held, never duplicated.
    duplicateKey: text("duplicate_key").notNull(),
    currency: text("currency").notNull(),
    invoiceDate: date("invoice_date").notNull(),
    dueDate: date("due_date"),
    period: text("period").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    taxMinor: minor("tax_minor").notNull().default(sql`0`),
    // validation_hold | matched | awaiting_approval | payable | paid
    state: text("state").notNull(),
    matchResult: jsonb("match_result").notNull().default({}),
    holdReasons: text("hold_reasons").array().notNull().default(sql`'{}'::text[]`),
    documentRevision: integer("document_revision").notNull().default(1),
    history: jsonb("history").notNull().default([]),
    fileId: uuid("file_id"),
    receivedBy: actor("received_by"),
    preparedBy: actor("prepared_by"),
    approvedBy: actor("approved_by"),
    approvalId: uuid("approval_id"),
    reclassJournalId: uuid("reclass_journal_id"),
    paidMinor: minor("paid_minor").notNull().default(sql`0`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("supplier_invoice", t),
    unique("supplier_invoice_duplicate_key_uq").on(t.tenantId, t.duplicateKey),
    index("supplier_invoice_job_idx").on(t.tenantId, t.jobId),
    foreignKey({ name: "supplier_invoice_supplier_fk", columns: [t.tenantId, t.supplierId], foreignColumns: [supplier.tenantId, supplier.id] }),
    foreignKey({ name: "supplier_invoice_job_fk", columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
    foreignKey({ name: "supplier_invoice_order_fk", columns: [t.tenantId, t.orderId], foreignColumns: [purchaseOrder.tenantId, purchaseOrder.id] }),
  ]
)

export const expense = pgTable(
  "expense",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    claimantUserId: actor("claimant_user_id").notNull(),
    receiptFileId: uuid("receipt_file_id").notNull(),
    expenseDate: date("expense_date").notNull(),
    period: text("period").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    category: text("category").notNull(),
    description: text("description"),
    // verified | manual_review
    receiptCheck: text("receipt_check").notNull(),
    receiptCheckDetail: jsonb("receipt_check_detail").notNull().default({}),
    // manual_review | awaiting_approval | approved | rejected | reimbursed
    state: text("state").notNull(),
    submittedBy: actor("submitted_by").notNull(),
    approvedBy: actor("approved_by"),
    approvalId: uuid("approval_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("expense", t),
    index("expense_job_idx").on(t.tenantId, t.jobId),
    foreignKey({ name: "expense_job_fk", columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
  ]
)

export const paymentBatch = pgTable(
  "payment_batch",
  {
    id: pk(),
    tenantId: tenantId(),
    reference: text("reference").notNull(),
    bankAccountId: uuid("bank_account_id").notNull(),
    paymentDate: date("payment_date").notNull(),
    dueThrough: date("due_through").notNull(),
    paymentMethod: text("payment_method").notNull(),
    totalMinor: minor("total_minor").notNull(),
    currency: text("currency").notNull(),
    // Approval anchor (single-job batches) — see payments.ts.
    jobId: uuid("job_id"),
    // awaiting_approval | reserved | executing | executed | blocked | cancelled
    state: text("state").notNull(),
    proposalId: uuid("proposal_id"),
    approvalId: uuid("approval_id"),
    preparedBy: actor("prepared_by"),
    approvedBy: actor("approved_by"),
    blockedReason: text("blocked_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("payment_batch", t),
    unique("payment_batch_reference_uq").on(t.tenantId, t.reference),
    foreignKey({ name: "payment_batch_account_fk", columns: [t.tenantId, t.bankAccountId], foreignColumns: [bankAccount.tenantId, bankAccount.id] }),
  ]
)

export const payment = pgTable(
  "payment",
  {
    id: pk(),
    tenantId: tenantId(),
    batchId: uuid("batch_id").notNull(),
    seq: integer("seq").notNull(),
    // supplier_invoice | expense | payroll
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    // media | production | expense | payroll
    category: text("category").notNull(),
    jobId: uuid("job_id"),
    payee: text("payee").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    // pending_approval | reserved | outcome_unknown | failed_retryable | succeeded | failed | cancelled
    state: text("state").notNull(),
    adapterOperationId: uuid("adapter_operation_id"),
    receiptId: text("receipt_id"),
    bankTransactionId: uuid("bank_transaction_id"),
    journalEntryId: uuid("journal_entry_id"),
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(0),
    businessDate: date("business_date"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("payment", t),
    unique("payment_batch_seq_uq").on(t.tenantId, t.batchId, t.seq),
    // A liability is in at most one live payment.
    uniqueIndex("payment_live_source_uq")
      .on(t.tenantId, t.sourceType, t.sourceId)
      .where(sql`${t.state} not in ('failed','cancelled')`),
    foreignKey({ name: "payment_batch_fk", columns: [t.tenantId, t.batchId], foreignColumns: [paymentBatch.tenantId, paymentBatch.id] }),
  ]
)

export const paymentHold = pgTable(
  "payment_hold",
  {
    id: pk(),
    tenantId: tenantId(),
    bankAccountId: uuid("bank_account_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    // active | consumed | released
    state: text("state").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantUnique("payment_hold", t),
    unique("payment_hold_payment_uq").on(t.tenantId, t.paymentId),
    foreignKey({ name: "payment_hold_account_fk", columns: [t.tenantId, t.bankAccountId], foreignColumns: [bankAccount.tenantId, bankAccount.id] }),
    foreignKey({ name: "payment_hold_payment_fk", columns: [t.tenantId, t.paymentId], foreignColumns: [payment.tenantId, payment.id] }),
  ]
)

// ── Billing & collections ──

export const clientInvoice = pgTable(
  "client_invoice",
  {
    id: pk(),
    tenantId: tenantId(),
    jobId: uuid("job_id").notNull(),
    clientId: uuid("client_id").notNull(),
    // Internal demo document number, assigned on issue (DEMO-INV-0001).
    number: text("number"),
    invoiceDate: date("invoice_date").notNull(),
    dueDate: date("due_date").notNull(),
    period: text("period").notNull(),
    currency: text("currency").notNull(),
    feeMinor: minor("fee_minor").notNull(),
    mediaRecoveryMinor: minor("media_recovery_minor").notNull(),
    netMinor: minor("net_minor").notNull(),
    taxMinor: minor("tax_minor").notNull(),
    grossMinor: minor("gross_minor").notNull(),
    taxProfile: text("tax_profile").notNull(),
    // requirements_checked | awaiting_approval | issued_demo | partially_collected | collected | cancelled
    state: text("state").notNull(),
    requirements: jsonb("requirements").notNull().default({}),
    poNumber: text("po_number"),
    notes: text("notes"),
    collectedMinor: minor("collected_minor").notNull().default(sql`0`),
    label: text("label").notNull(),
    preparedBy: actor("prepared_by"),
    approvedBy: actor("approved_by"),
    approvalId: uuid("approval_id"),
    journalEntryId: uuid("journal_entry_id"),
    documentFileId: uuid("document_file_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("client_invoice", t),
    unique("client_invoice_number_uq").on(t.tenantId, t.number),
    index("client_invoice_job_idx").on(t.tenantId, t.jobId),
    foreignKey({ name: "client_invoice_job_fk", columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
    foreignKey({ name: "client_invoice_client_fk", columns: [t.tenantId, t.clientId], foreignColumns: [client.tenantId, client.id] }),
  ]
)

export const clientInvoiceLine = pgTable(
  "client_invoice_line",
  {
    id: pk(),
    tenantId: tenantId(),
    invoiceId: uuid("invoice_id").notNull(),
    lineNo: integer("line_no").notNull(),
    // agency_fee | media_recovery
    lineType: text("line_type").notNull(),
    // agency_revenue | pass_through_recovery
    treatment: text("treatment").notNull(),
    description: text("description").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
  },
  (t) => [
    tenantUnique("client_invoice_line", t),
    foreignKey({ name: "client_invoice_line_invoice_fk", columns: [t.tenantId, t.invoiceId], foreignColumns: [clientInvoice.tenantId, clientInvoice.id] }),
  ]
)

// Cash receipt (unique per account + provider receipt id) and its bounded
// allocation to invoices: sum of allocations ≤ receipt and ≤ invoice balance.
export const collection = pgTable(
  "collection",
  {
    id: pk(),
    tenantId: tenantId(),
    bankAccountId: uuid("bank_account_id").notNull(),
    provider: text("provider").notNull(),
    providerReceiptId: text("provider_receipt_id").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    receiptDate: date("receipt_date").notNull(),
    bankTransactionId: uuid("bank_transaction_id").notNull(),
    allocatedMinor: minor("allocated_minor").notNull(),
    journalEntryId: uuid("journal_entry_id"),
    createdBy: actor("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("collection", t),
    unique("collection_receipt_uq").on(t.tenantId, t.bankAccountId, t.providerReceiptId),
    foreignKey({ name: "collection_account_fk", columns: [t.tenantId, t.bankAccountId], foreignColumns: [bankAccount.tenantId, bankAccount.id] }),
  ]
)

export const collectionAllocation = pgTable(
  "collection_allocation",
  {
    id: pk(),
    tenantId: tenantId(),
    collectionId: uuid("collection_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("collection_allocation", t),
    unique("collection_allocation_uq").on(t.tenantId, t.collectionId, t.invoiceId),
    foreignKey({ name: "collection_allocation_collection_fk", columns: [t.tenantId, t.collectionId], foreignColumns: [collection.tenantId, collection.id] }),
    foreignKey({ name: "collection_allocation_invoice_fk", columns: [t.tenantId, t.invoiceId], foreignColumns: [clientInvoice.tenantId, clientInvoice.id] }),
  ]
)

export const rebateAgreement = pgTable(
  "rebate_agreement",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    supplierId: uuid("supplier_id").notNull(),
    name: text("name").notNull(),
    // flat | tiered
    method: text("method").notNull(),
    rateBps: integer("rate_bps").notNull(),
    // Ascending brackets for tiered agreements: [{fromMinor, bps}]
    brackets: jsonb("brackets").notNull().default([]),
    clientShareBps: integer("client_share_bps").notNull(),
    // Ids of excluded cost categories (e.g. "production").
    exclusions: text("exclusions").array().notNull().default(sql`'{}'::text[]`),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to").notNull(),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantUnique("rebate_agreement", t),
    foreignKey({ name: "rebate_agreement_supplier_fk", columns: [t.tenantId, t.supplierId], foreignColumns: [supplier.tenantId, supplier.id] }),
  ]
)

export const rebateCalculation = pgTable(
  "rebate_calculation",
  {
    id: pk(),
    tenantId: tenantId(),
    agreementId: uuid("agreement_id").notNull(),
    jobId: uuid("job_id").notNull(),
    period: text("period").notNull(),
    eligibleBaseMinor: minor("eligible_base_minor").notNull(),
    rebateMinor: minor("rebate_minor").notNull(),
    clientReturnMinor: minor("client_return_minor").notNull(),
    agencyRetainedMinor: minor("agency_retained_minor").notNull(),
    currency: text("currency").notNull(),
    result: jsonb("result").notNull().default({}),
    // awaiting_approval | provisioned | rejected
    state: text("state").notNull(),
    adjustmentId: uuid("adjustment_id"),
    createdBy: actor("created_by"),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("rebate_calculation", t),
    foreignKey({ name: "rebate_calculation_agreement_fk", columns: [t.tenantId, t.agreementId], foreignColumns: [rebateAgreement.tenantId, rebateAgreement.id] }),
    foreignKey({ name: "rebate_calculation_job_fk", columns: [t.tenantId, t.jobId], foreignColumns: [job.tenantId, job.id] }),
  ]
)

// Synthetic, explicitly non-fiscal tax profiles per country.
export const taxProfile = pgTable(
  "tax_profile",
  {
    id: pk(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    countries: text("countries").array().notNull(),
    rateBps: integer("rate_bps").notNull(),
    label: text("label").notNull(),
    fiscalValidity: boolean("fiscal_validity").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [tenantUnique("tax_profile", t), unique("tax_profile_code_uq").on(t.tenantId, t.code)]
)

// ── Profitability & reporting ──

export const revenueBudgetVersion = pgTable(
  "revenue_budget_version",
  {
    id: pk(),
    tenantId: tenantId(),
    fixtureKey: text("fixture_key"),
    scenarioName: text("scenario_name").notNull(),
    clientId: uuid("client_id"),
    jobId: uuid("job_id"),
    periodFrom: text("period_from").notNull(),
    periodTo: text("period_to").notNull(),
    currency: text("currency").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    allocationDriver: text("allocation_driver").notNull(),
    lines: jsonb("lines").notNull().default([]),
    versionNumber: integer("version_number").notNull(),
    // baseline (approved, immutable) | scenario | awaiting_approval | approved
    state: text("state").notNull(),
    basedOnId: uuid("based_on_id"),
    approvalId: uuid("approval_id"),
    createdBy: actor("created_by"),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    tenantUnique("revenue_budget_version", t),
    unique("revenue_budget_version_uq").on(t.tenantId, t.scenarioName, t.versionNumber),
    foreignKey({ name: "revenue_budget_client_fk", columns: [t.tenantId, t.clientId], foreignColumns: [client.tenantId, client.id] }),
  ]
)

export const managementReport = pgTable(
  "management_report",
  {
    id: pk(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    period: text("period").notNull(),
    basis: text("basis").notNull(),
    currency: text("currency").notNull(),
    cutOff: date("cut_off").notNull(),
    // Highest business_event seq included: the snapshot revision.
    snapshotSeq: integer("snapshot_seq").notNull(),
    definitions: jsonb("definitions").notNull(),
    sources: jsonb("sources").notNull(),
    totals: jsonb("totals").notNull(),
    content: jsonb("content").notNull(),
    exportFileId: uuid("export_file_id"),
    synthetic: boolean("synthetic").notNull().default(true),
    label: text("label").notNull(),
    createdBy: actor("created_by"),
    createdAt: createdAt(),
  },
  (t) => [tenantUnique("management_report", t)]
)
