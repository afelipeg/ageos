import "server-only"

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { z } from "zod"

import { minorToDecimalString } from "@/lib/money"
import { syntheticPdf } from "@/lib/synthetic-pdf"
import type { AgencyContext } from "@/server/auth/context"
import { allocate } from "@/server/calculators"
import { invoiceCheck, paymentTerms } from "@/server/calculators/finance"
import type { Tx } from "@/server/db/client"
import { client, clientInvoice, clientInvoiceLine, contract, recognitionRecord, taxProfile } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { defineCommand, toJsonSafe, type EmittedEvent } from "@/server/kernel/commands"
import { assertBillingReady } from "@/server/domain/billing-requirements"
import { DomainError, isDomainError } from "@/server/kernel/errors"

import { acceptanceEvidence } from "./accruals"
import { effectiveAuthority } from "./profitability"
import { storeGeneratedFile } from "./cash"
import { assertPeriodOpen, blocked, Decimal, getPeriod, IsoDate, loadJob, moneyInput, periodOf, postJournals, requestFinanceApproval } from "./ledger"

// Client billing (M07). A demo invoice bills recognized agency fee and the
// pass-through media recovery as separate lines; it reclassifies unbilled
// revenue / media recoverable to AR. Requirements: client authority with its
// evidence, accepted-delivery evidence, an enabled synthetic tax profile, an
// open period and recognized amounts. Never a fiscal document.

export const DEMO_INVOICE_LABEL = "DEMO — NOT A TAX INVOICE"
export const DEMO_INVOICE_LABEL_ES = "DEMO — NO ES FACTURA FISCAL"
export const CLIENT_INVOICE_POLICY = "client-invoice-v1"
const LIVE_INVOICE = ["issued_demo", "partially_collected", "collected"] as const

export async function resolveTaxProfile(tx: Tx, tenantId: string, code: string, country: string) {
  const [p] = await tx.select().from(taxProfile).where(and(eq(taxProfile.tenantId, tenantId), eq(taxProfile.code, code))).limit(1)
  if (!p || !p.enabled || !p.countries.includes(country)) return null
  return p
}

/** Recognized vs already invoiced fee and media recovery for a job. */
export async function billableBalances(tx: Tx, tenantId: string, jobId: string, excludeInvoiceId: string | null) {
  const rec = await tx
    .select({ category: recognitionRecord.category, v: sql<string>`sum(${recognitionRecord.amountMinor})` })
    .from(recognitionRecord)
    .where(and(eq(recognitionRecord.tenantId, tenantId), eq(recognitionRecord.jobId, jobId), inArray(recognitionRecord.category, ["fee", "media"])))
    .groupBy(recognitionRecord.category)
  const billed = await tx
    .select({ id: clientInvoice.id, fee: clientInvoice.feeMinor, media: clientInvoice.mediaRecoveryMinor })
    .from(clientInvoice)
    .where(and(eq(clientInvoice.tenantId, tenantId), eq(clientInvoice.jobId, jobId), inArray(clientInvoice.state, [...LIVE_INVOICE])))
  const others = billed.filter((b) => b.id !== excludeInvoiceId)
  const recognizedFee = BigInt(rec.find((r) => r.category === "fee")?.v ?? "0")
  const recognizedMedia = BigInt(rec.find((r) => r.category === "media")?.v ?? "0")
  const billedFee = others.reduce((a, b) => a + b.fee, 0n)
  const billedMedia = others.reduce((a, b) => a + b.media, 0n)
  return { recognizedFee, recognizedMedia, billedFee, billedMedia, unbilledFee: recognizedFee - billedFee, unbilledMedia: recognizedMedia - billedMedia }
}

/**
 * Invoice requirements. Commercial/evidence readiness (approved budget, client
 * authority on reviewed PO evidence, accepted delivery with reviewed
 * acceptance evidence, no pending amendment) is Core-1's gate
 * `assertBillingReady` (agency-billing-requirements); on top of it billing
 * needs recognized, still-unbilled amounts, authority covering everything
 * billed and an enabled synthetic tax profile.
 */
async function evaluateRequirements(tx: Tx, tenantId: string, j: Awaited<ReturnType<typeof loadJob>>, fee: bigint, media: bigint, excludeInvoiceId: string | null) {
  const [c] = await tx.select().from(client).where(and(eq(client.tenantId, tenantId), eq(client.id, j.clientId))).limit(1)
  const contracts = await tx.select().from(contract).where(and(eq(contract.tenantId, tenantId), eq(contract.jobId, j.id)))
  const { approvedAuthority: authority } = effectiveAuthority(contracts, j.currency)
  const acceptance = await acceptanceEvidence(tx, tenantId, j.id)
  const balances = await billableBalances(tx, tenantId, j.id, excludeInvoiceId)
  const tax = c ? await resolveTaxProfile(tx, tenantId, c.fiscalProfile, c.country) : null
  const net = fee + media
  const billedNet = balances.billedFee + balances.billedMedia
  const items = [
    { id: "client_authority", ok: !!authority && authority.amountMinor >= billedNet + net, detail: authority ? { contractId: authority.id, reference: authority.reference, revision: authority.revisionNumber, authorityMinor: authority.amountMinor, alreadyBilledMinor: billedNet, evidenceId: authority.evidenceId } : null },
    { id: "fee_recognized", ok: fee <= balances.unbilledFee, detail: { requestedMinor: fee, unbilledRecognizedMinor: balances.unbilledFee } },
    { id: "media_recovery_recognized", ok: media <= balances.unbilledMedia, detail: { requestedMinor: media, unbilledRecognizedMinor: balances.unbilledMedia } },
    { id: "tax_profile", ok: !!tax, detail: c ? { profile: c.fiscalProfile, country: c.country, rateBps: tax?.rateBps ?? null, label: tax?.label ?? null } : null },
  ]
  return { client: c ?? null, authority: authority ?? null, acceptance, balances, tax, items, net }
}

const RULE_OF: Record<string, string> = {
  client_authority: "client_authority_missing",
  fee_recognized: "fee_not_recognized",
  media_recovery_recognized: "media_recovery_not_recognized",
  tax_profile: "no_fiscal_profile",
}

// ── agency-client-billing: issueDemoClientInvoice ──

export const IssueDemoClientInvoiceInput = z
  .object({
    job: z.string().uuid(),
    invoiceDate: IsoDate,
    feeAmount: Decimal,
    mediaRecoveryAmount: Decimal,
    poNumber: z.string().trim().max(60).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict()

export const issueDemoClientInvoice = defineCommand({
  type: "billing.prepareClientInvoice",
  skillId: "agency-client-billing",
  permission: "billing.manage",
  input: IssueDemoClientInvoiceInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await loadJob(tx, ctx.tenant.id, input.job)
    const currency = j.currency
    const fee = moneyInput(input.feeAmount, currency, "feeAmount", { allowZero: true })
    const media = moneyInput(input.mediaRecoveryAmount, currency, "mediaRecoveryAmount", { allowZero: true })
    if (fee + media === 0n) throw new DomainError("validation", "The invoice total must be positive", { field: "feeAmount" })
    const period = periodOf(input.invoiceDate)
    await assertPeriodOpen(tx, ctx.tenant.id, period)
    const readiness = await assertBillingReady(tx, ctx.tenant.id, j.id)
    const req = await evaluateRequirements(tx, ctx.tenant.id, j, fee, media, null)
    const failed = req.items.filter((i) => !i.ok)
    if (failed.length) {
      blocked(RULE_OF[failed[0]!.id]!, "Billing requirements are not met", toJsonSafe({ requirements: req.items, failed: failed.map((f) => f.id) }) as Record<string, unknown>)
    }
    const checkWith = (declaredTotalMinor: bigint) =>
      invoiceCheck({
        currency,
        lines: [
          { lineId: "agency_fee", netMinor: fee, vatBps: req.tax!.rateBps },
          { lineId: "media_recovery", netMinor: media, vatBps: req.tax!.rateBps },
        ],
        perceptionsMinor: 0n,
        otherChargesMinor: 0n,
        withholdingsNettedMinor: 0n,
        declaredTotalMinor,
        roundingToleranceMinor: 0n,
      })
    const check = checkWith(checkWith(0n).computedTotalMinor)
    const terms = paymentTerms({ baseDate: input.invoiceDate, termDays: 30, rule: "net_days", delayDays: 0, holidays: [], weekendRoll: true })
    const [inv] = await tx
      .insert(clientInvoice)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        clientId: j.clientId,
        invoiceDate: input.invoiceDate,
        dueDate: terms.dueDate,
        period,
        currency,
        feeMinor: fee,
        mediaRecoveryMinor: media,
        netMinor: check.netMinor,
        taxMinor: check.vatMinor,
        grossMinor: check.computedTotalMinor,
        taxProfile: req.tax!.code,
        state: "requirements_checked",
        requirements: toJsonSafe({ items: req.items, invoiceCheck: check }) as object,
        poNumber: input.poNumber ?? req.authority?.reference ?? null,
        notes: input.notes ?? null,
        label: DEMO_INVOICE_LABEL,
        preparedBy: ctx.user.id,
      })
      .returning()
    const lines = [
      ...(fee > 0n ? [{ lineType: "agency_fee", treatment: "agency_revenue", description: "Agency fee (net agency revenue)", amountMinor: fee }] : []),
      ...(media > 0n ? [{ lineType: "media_recovery", treatment: "pass_through_recovery", description: "Managed media recovery (pass-through, not agency revenue)", amountMinor: media }] : []),
    ]
    await tx.insert(clientInvoiceLine).values(lines.map((l, i) => ({ tenantId: ctx.tenant.id, invoiceId: inv!.id, lineNo: i + 1, ...l, currency })))
    const payload = {
      action: "billing.issue_invoice",
      invoiceId: inv!.id,
      invoiceRevision: inv!.revision,
      jobId: j.id,
      feeMinor: fee,
      mediaRecoveryMinor: media,
      taxMinor: check.vatMinor,
      grossMinor: check.computedTotalMinor,
      currency,
      invoiceDate: input.invoiceDate,
      dueDate: terms.dueDate,
      taxProfile: req.tax!.code,
      authorityContractId: req.authority!.id,
      billingReadinessId: readiness.readinessId,
    }
    const appr = await requestFinanceApproval(tx, ctx, {
      actionType: "billing.issue_invoice",
      skillId: "agency-client-billing",
      job: { id: j.id, revision: j.revision },
      aggregate: { type: "client_invoice", id: inv!.id, revision: inv!.revision },
      payload,
      impact: { feeMinor: fee, mediaRecoveryMinor: media, grossMinor: check.computedTotalMinor, currency, arAfterMinor: check.computedTotalMinor },
      title: `Demo client invoice ${j.displayReference}`,
      amountMinor: check.computedTotalMinor,
      currency,
      destination: `client:${req.client?.code ?? j.clientId}`,
      policyId: CLIENT_INVOICE_POLICY,
      origin: meta.origin,
    })
    await tx.update(clientInvoice).set({ approvalId: appr.approval.id }).where(eq(clientInvoice.id, inv!.id))
    const split = allocate({ currency, amountMinor: check.netMinor, weights: [{ targetId: "agency_fee", weight: fee }, { targetId: "media_recovery", weight: media }].filter((w) => w.weight > 0n) })
    return {
      result: {
        invoiceId: inv!.id,
        state: "requirements_checked",
        label: DEMO_INVOICE_LABEL,
        ...appr.approvalSummary,
        billing_selection: { jobId: j.id, recognized: req.balances, requirements: req.items, billingReadiness: { readinessId: readiness.readinessId, requirements: readiness.requirements } },
        invoice_drafts: [{ invoiceId: inv!.id, number: null, numberAssignedOn: "issue", invoiceDate: input.invoiceDate, dueDate: terms.dueDate, lines, netMinor: check.netMinor, taxMinor: check.vatMinor, grossMinor: check.computedTotalMinor, currency, label: DEMO_INVOICE_LABEL }],
        credit_debit_note_drafts: { items: [], reason: "No issued invoice to adjust; credit notes apply only after issue." },
        fee_calculation: { feeMinor: fee, basis: "approved agency fee recognized on accepted service", recognizedFeeMinor: req.balances.recognizedFee, alreadyBilledFeeMinor: req.balances.billedFee, invoiceCheck: check },
        split_allocation: { agencyRevenueMinor: fee, passThroughRecoveryMinor: media, allocation: split, note: "Media recovery is pass-through and never enters net agency revenue." },
        billing_exceptions: [],
      },
      events: [
        { eventType: "billing.invoice_prepared", aggregateType: "client_invoice", aggregateId: inv!.id, jobId: j.id, payload: { feeMinor: fee, mediaRecoveryMinor: media, grossMinor: check.computedTotalMinor, currency } },
        ...appr.events,
      ],
    }
  },
})

export async function applyClientInvoiceIssue(
  tx: Tx,
  ctx: AgencyContext,
  payload: { invoiceId: string; invoiceRevision: number },
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const [inv] = await tx.select().from(clientInvoice).where(and(eq(clientInvoice.tenantId, ctx.tenant.id), eq(clientInvoice.id, payload.invoiceId))).for("update").limit(1)
  if (!inv || inv.revision !== payload.invoiceRevision || inv.state !== "requirements_checked") return { ok: false, code: "approval_stale", details: { invoiceId: payload.invoiceId } }
  const p = await getPeriod(tx, ctx.tenant.id, inv.period)
  if (!p || p.state !== "open") return { ok: false, code: "period_closed", details: { period: inv.period } }
  const j = await loadJob(tx, ctx.tenant.id, inv.jobId)
  try {
    await assertBillingReady(tx, ctx.tenant.id, j.id)
  } catch (e) {
    if (isDomainError(e)) return { ok: false, code: String(e.details.rule ?? "billing_requirements_invalid"), details: e.details }
    throw e
  }
  const req = await evaluateRequirements(tx, ctx.tenant.id, j, inv.feeMinor, inv.mediaRecoveryMinor, inv.id)
  const failed = req.items.filter((i) => !i.ok)
  if (failed.length) return { ok: false, code: RULE_OF[failed[0]!.id]!, details: toJsonSafe({ requirements: req.items }) as Record<string, unknown> }
  if (mode === "check") return { ok: true, events: [] }

  // Internal demo numbering under a tenant-wide lock (never a fiscal folio).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`client_invoice_number:${ctx.tenant.id}`}))`)
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(clientInvoice).where(and(eq(clientInvoice.tenantId, ctx.tenant.id), isNotNull(clientInvoice.number)))) as [{ n: number }]
  const number = `DEMO-INV-${String(n + 1).padStart(4, "0")}`
  const lines = await tx.select().from(clientInvoiceLine).where(and(eq(clientInvoiceLine.tenantId, ctx.tenant.id), eq(clientInvoiceLine.invoiceId, inv.id))).orderBy(asc(clientInvoiceLine.lineNo))
  const fmt = (m: bigint) => `${inv.currency} ${minorToDecimalString(m, inv.currency)}`
  const pdf = syntheticPdf([
    DEMO_INVOICE_LABEL,
    `${DEMO_INVOICE_LABEL_ES}`,
    `Demo invoice ${number} - ${ctx.tenant.name} - synthetic data`,
    `Client: ${req.client?.name ?? ""} - Job ${j.displayReference}`,
    `Invoice date ${inv.invoiceDate} - due ${inv.dueDate}`,
    ...lines.map((l) => `${l.description}: ${fmt(l.amountMinor)}`),
    `Tax (${inv.taxProfile}, synthetic): ${fmt(inv.taxMinor)}`,
    `Total: ${fmt(inv.grossMinor)}`,
  ])
  const doc = await storeGeneratedFile(tx, ctx, { name: `${number}.pdf`, format: "pdf", bytes: pdf, jobId: j.id, label: DEMO_INVOICE_LABEL })
  const journalLines = [
    { account: "accounts_receivable", side: "debit" as const, amountMinor: inv.grossMinor },
    ...(inv.feeMinor > 0n ? [{ account: "unbilled_fee_asset", side: "credit" as const, amountMinor: inv.feeMinor }] : []),
    ...(inv.mediaRecoveryMinor > 0n ? [{ account: "media_recovery_asset", side: "credit" as const, amountMinor: inv.mediaRecoveryMinor }] : []),
    ...(inv.taxMinor > 0n ? [{ account: "tax_payable", side: "credit" as const, amountMinor: inv.taxMinor }] : []),
  ]
  const posted = await postJournals(
    tx,
    ctx,
    [{ entryKey: `client_invoice:${inv.id}`, ruleKey: "journal_client_invoice", sourceType: "client_invoice", sourceId: inv.id, jobId: j.id, businessDate: inv.invoiceDate, currency: inv.currency, memo: `Demo invoice ${number} reclassifies unbilled revenue and media recoverable to AR`, reportingGroup: j.reportingGroup, lines: journalLines }],
    { approvalId: inv.approvalId, approvedBy: ctx.user.id, preparedBy: inv.preparedBy }
  )
  await tx
    .update(clientInvoice)
    .set({ number, state: "issued_demo", approvedBy: ctx.user.id, issuedAt: new Date(), documentFileId: doc.id, journalEntryId: posted.entries.find((e) => e.ruleKey === "journal_client_invoice")?.id ?? null, updatedAt: new Date(), revision: sql`${clientInvoice.revision} + 1` })
    .where(eq(clientInvoice.id, inv.id))
  return {
    ok: true,
    events: [
      { eventType: "billing.invoice_issued_demo", aggregateType: "client_invoice", aggregateId: inv.id, jobId: j.id, payload: { number, grossMinor: inv.grossMinor, currency: inv.currency, label: DEMO_INVOICE_LABEL, documentFileId: doc.id } },
      ...posted.events,
    ],
  }
}

// ── Queries ──

export async function listClientInvoices(ctx: AgencyContext, filter: { jobId?: string } = {}) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const conds = [eq(clientInvoice.tenantId, ctx.tenant.id)]
    if (filter.jobId) conds.push(eq(clientInvoice.jobId, filter.jobId))
    const rows = await tx.select().from(clientInvoice).where(and(...conds)).orderBy(asc(clientInvoice.createdAt))
    const lines = rows.length ? await tx.select().from(clientInvoiceLine).where(and(eq(clientInvoiceLine.tenantId, ctx.tenant.id), inArray(clientInvoiceLine.invoiceId, rows.map((r) => r.id)))) : []
    return rows.map((r) => ({ ...r, outstandingMinor: r.grossMinor - r.collectedMinor, lines: lines.filter((l) => l.invoiceId === r.id) }))
  })
}
