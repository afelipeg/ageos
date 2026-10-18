// Capability handlers for module "billing-collections". Owner: Core-3.
// Skills: agency-client-billing, agency-collections, agency-rebates, agency-tax-compliance
// A skill missing from `handlers` is "registered" only (no fake success).
import "server-only"

import { and, eq } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { bankTransaction, clientInvoice } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { applyClientInvoiceIssue, DEMO_INVOICE_LABEL, issueDemoClientInvoice } from "@/server/domain/billing"
import { evaluateBillingReadiness } from "@/server/domain/billing-requirements"
import { recordClientAuthority } from "@/server/domain/budget"
import { allocateCollection } from "@/server/domain/collections"
import { loadJobFinancials } from "@/server/domain/profitability"
import { applyRebateProvision, calculateRebateSettlement } from "@/server/domain/rebates"
import { validateDemoTaxProfile, ValidateDemoTaxInput } from "@/server/domain/tax"
import type { ModuleCapabilities } from "../types"

import { approveAs, check, cmd, ensureLabRecognition, labRefs, runTag, type FixtureCtx, type Out } from "./suppliers-payments"

/**
 * Lab billing readiness through Core-1's gate: an approved client authority
 * on the reviewed lab PO evidence (operator → owner), then the requirements
 * check with the reviewed acceptance evidence; plus the lab fee recognized.
 */
async function ensureLabBillingReady(c: FixtureCtx) {
  await ensureLabRecognition(c)
  const operator = await c("user_demo_operator")
  const refs = await labRefs(operator)
  const fin = await withTenant(operator.tenant.id, (tx) => loadJobFinancials(tx, operator.tenant.id, refs.labJob))
  if (!fin.approvedAuthority?.evidenceId) {
    const po = await cmd(operator, recordClientAuthority, { job: refs.labJob, reference: runTag("PO-LAB-C3"), amount: "1000.00", validFrom: "2027-03-01", validTo: "2027-12-31", evidenceId: refs.labPoEvidence }, "lab-po")
    await approveAs(c, po as unknown as { approvalId: string; payloadDigest: string }, "user_demo_owner")
  }
  await cmd(operator, evaluateBillingReadiness, { job: refs.labJob, deliverableAccepted: true, acceptanceEvidence: refs.labAcceptanceEvidence }, "lab-readiness")
  return refs
}

/** A USD 1.00 lab fee invoice issued in the demo (operator prepares, finance approves). */
async function labIssuedInvoice(c: FixtureCtx) {
  await ensureLabBillingReady(c)
  const operator = await c("user_demo_operator")
  const refs = await labRefs(operator)
  const draft = await cmd(operator, issueDemoClientInvoice, { job: refs.labJob, invoiceDate: "2027-03-20", feeAmount: "1.00", mediaRecoveryAmount: "0.00" }, "lab-invoice")
  await approveAs(c, draft as { approvalId: string; payloadDigest: string })
  const [inv] = await withTenant(operator.tenant.id, (tx) => tx.select().from(clientInvoice).where(eq(clientInvoice.id, String(draft.invoiceId))).limit(1))
  return { jobId: refs.labJob, number: inv!.number! }
}

async function receiptCount(ctx: AgencyContext, ref: string) {
  return withTenant(ctx.tenant.id, async (tx) => (await tx.select().from(bankTransaction).where(and(eq(bankTransaction.tenantId, ctx.tenant.id), eq(bankTransaction.providerReceiptId, ref)))).length)
}

export const capabilities: ModuleCapabilities = {
  handlers: {
    "agency-client-billing": { kind: "command", command: issueDemoClientInvoice },
    "agency-collections": { kind: "command", command: allocateCollection },
    "agency-rebates": { kind: "command", command: calculateRebateSettlement },
    "agency-tax-compliance": { kind: "query", input: ValidateDemoTaxInput, run: validateDemoTaxProfile as never },
  },
  fixtures: {
    // ERP-31: lab fee invoice prepared on recognized fee, approved by finance,
    // issued as a labelled demo document; fee and pass-through stay separate.
    // Negative: media recovery that was never recognized cannot be billed.
    "agency-client-billing": {
      positive: async (c) => {
        const refs = await ensureLabBillingReady(c)
        return {
          actorKey: "user_demo_operator",
          input: { job: refs.labJob, invoiceDate: "2027-03-20", feeAmount: "1.00", mediaRecoveryAmount: "0.00", notes: "Lab billing exercise" },
          verify: async (output) => {
            const o = output as Out
            check(o.label === DEMO_INVOICE_LABEL, "labelled as a demo, non-fiscal invoice")
            const split = o.split_allocation as { agencyRevenueMinor: string; passThroughRecoveryMinor: string }
            check(split.agencyRevenueMinor === "100" && split.passThroughRecoveryMinor === "0", "fee and pass-through separate")
            await approveAs(c, o as unknown as { approvalId: string; payloadDigest: string })
            const finance = await c("user_demo_finance")
            const [inv] = await withTenant(finance.tenant.id, (tx) => tx.select().from(clientInvoice).where(eq(clientInvoice.id, String(o.invoiceId))).limit(1))
            check(inv?.state === "issued_demo" && /^DEMO-INV-\d{4}$/.test(inv.number ?? "") && inv.documentFileId, "issued with internal demo number and document")
          },
        }
      },
      negative: async (c) => {
        const refs = await ensureLabBillingReady(c)
        return {
          actorKey: "user_demo_operator",
          input: { job: refs.labJob, invoiceDate: "2027-03-20", feeAmount: "0.00", mediaRecoveryAmount: "10.00" },
          expectCode: "blocked_by_rule",
          expectRule: "media_recovery_not_recognized",
        }
      },
    },
    // ERP-32: a unique receipt credits cash once and clears the invoice; the
    // same receipt again returns the prior result. Negative: allocation above
    // the invoice outstanding is rejected.
    "agency-collections": {
      positive: async (c) => {
        const inv = await labIssuedInvoice(c)
        const receiptReference = `sim_receipt_${runTag("lab")}`.replace(/-/g, "_")
        const input = { job: inv.jobId, invoiceNumber: inv.number, receiptAmount: "1.00", receiptDate: "2027-03-21", receiptReference }
        return {
          actorKey: "user_demo_operator",
          input,
          verify: async (output) => {
            const o = output as Out
            check(o.outstandingMinor === "0" && o.duplicateReceipt === false, "invoice cleared by the receipt")
            const operator = await c("user_demo_operator")
            const again = await cmd(operator, allocateCollection, input, "collect-again")
            check(again.duplicateReceipt === true, "repeat returns the prior result")
            check((await receiptCount(operator, receiptReference)) === 1, "cash credited once")
          },
        }
      },
      negative: async (c) => {
        const inv = await labIssuedInvoice(c)
        return {
          actorKey: "user_demo_operator",
          input: { job: inv.jobId, invoiceNumber: inv.number, receiptAmount: "2.00", receiptDate: "2027-03-21", receiptReference: `sim_receipt_${runTag("over")}`.replace(/-/g, "_") },
          expectCode: "blocked_by_rule",
          expectRule: "allocation_exceeds_outstanding",
        }
      },
    },
    // ERP-33: lab base 10,000 at 2% → 200, split 100/100, provision for
    // finance. Negative: a period outside the agreement dates is excluded.
    "agency-rebates": {
      positive: async (c) => {
        const refs = await labRefs(await c("user_demo_operator"))
        return {
          actorKey: "user_demo_operator",
          input: { job: refs.labJob, supplier: refs.labVendor, period: "2027-03", eligibleBase: "10000.00", rebateRateBps: 200, clientShareBps: 5000 },
          verify: async (output) => {
            const calc = (output as Out).rebate_calculation as { rebateMinor: string; clientReturnMinor: string; agencyRetainedMinor: string }
            check(calc.rebateMinor === "20000" && calc.clientReturnMinor === "10000" && calc.agencyRetainedMinor === "10000", "200 split 100/100")
          },
        }
      },
      negative: async (c) => {
        const refs = await labRefs(await c("user_demo_operator"))
        return {
          actorKey: "user_demo_operator",
          input: { job: refs.labJob, supplier: refs.labVendor, period: "2027-08", eligibleBase: "10000.00", rebateRateBps: 200, clientShareBps: 5000 },
          expectCode: "blocked_by_rule",
          expectRule: "outside_eligibility",
        }
      },
    },
    // ERP-34: synthetic 5% profile: 100 net → 5 tax → 105 gross, non-fiscal.
    // Negative: a country without a profile is blocked.
    "agency-tax-compliance": {
      positive: async (c) => {
        const refs = await labRefs(await c("user_demo_operator"))
        return {
          actorKey: "user_demo_operator",
          input: { job: refs.labJob, country: "US", taxProfile: "DEMO_SYNTHETIC_5_PERCENT", taxableBase: "100.00" },
          verify: async (output) => {
            const o = output as Out
            const pos = (o.tax_positions as { taxMinor: string; grossMinor: string }[])[0]!
            check(pos.taxMinor === "500" && pos.grossMinor === "10500", "5.00 tax, 105.00 gross")
            check((o.profile as { fiscalValidity: boolean }).fiscalValidity === false, "never fiscally valid")
          },
        }
      },
      negative: async (c) => {
        const refs = await labRefs(await c("user_demo_operator"))
        return {
          actorKey: "user_demo_operator",
          input: { job: refs.labJob, country: "UNCONFIGURED", taxProfile: "DEMO_SYNTHETIC_5_PERCENT", taxableBase: "100.00" },
          expectCode: "blocked_by_rule",
          expectRule: "no_fiscal_profile",
        }
      },
    },
  },
  executors: {
    "billing.issue_invoice": {
      permission: "billing.manage",
      skillId: "agency-client-billing",
      run: (tx, ctx, payload, mode) => applyClientInvoiceIssue(tx, ctx, payload as Parameters<typeof applyClientInvoiceIssue>[2], mode),
    },
    "rebates.provision": {
      permission: "billing.manage",
      skillId: "agency-rebates",
      run: (tx, ctx, payload, mode) => applyRebateProvision(tx, ctx, payload as Parameters<typeof applyRebateProvision>[2], mode),
    },
  },
}
