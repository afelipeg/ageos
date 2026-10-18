// Capability handlers for module "accounting-close". Owner: Core-3.
// Skills: agency-general-ledger, agency-accruals-revaluation, agency-fixed-assets, agency-period-close
// A skill missing from `handlers` is "registered" only (no fake success).
import "server-only"

import { and, eq } from "drizzle-orm"

import { accountingPeriod, depreciationEntry, journalEntry } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { applyFxRevaluation, applyRecognitionRun, proposeAccrualOrFx } from "@/server/domain/accruals"
import { applyDepreciation, calculateAssetDepreciation } from "@/server/domain/assets"
import { applyPeriodAction, closeAccountingPeriod } from "@/server/domain/close"
import { applyManualJournal, postDemoJournal } from "@/server/domain/ledger"
import { approveSupplierInvoice } from "@/server/domain/payables"
import type { ModuleCapabilities } from "../types"

import { approveAs, check, cmd, labRefs, runTag, tolerate, type Out } from "./suppliers-payments"

export const capabilities: ModuleCapabilities = {
  handlers: {
    "agency-general-ledger": { kind: "command", command: postDemoJournal },
    "agency-accruals-revaluation": { kind: "command", command: proposeAccrualOrFx },
    "agency-fixed-assets": { kind: "command", command: calculateAssetDepreciation },
    "agency-period-close": { kind: "command", command: closeAccountingPeriod },
  },
  fixtures: {
    // ERP-35: a balanced lab journal prepared by the owner, approved by finance (≠ preparer), posts
    // once in the Demo ledger. Negative: debit ≠ credit is blocked.
    "agency-general-ledger": {
      positive: async (c) => {
        const refs = await labRefs(await c("user_demo_owner"))
        return {
          actorKey: "user_demo_owner",
          input: { job: refs.labJob, period: "2027-03", businessDate: "2027-03-20", debitAccount: "production_expense", debitAmount: "10.00", creditAccount: "accrued_production", creditAmount: "10.00", memo: "Lab manual accrual (fixture)" },
          verify: async (output, ctx) => {
            const o = output as Out
            check((o.journal_check_report as { status: string }).status === "valid", "journal_check valid (debit = credit)")
            await approveAs(c, o as unknown as { approvalId: string; payloadDigest: string })
            const rows = await withTenant(ctx.tenant.id, (tx) => tx.select().from(journalEntry).where(and(eq(journalEntry.tenantId, ctx.tenant.id), eq(journalEntry.entryKey, `manual:${String(o.adjustmentId)}`))))
            check(rows.length === 1 && rows[0]!.reportingGroup === "demo-lab", "posted once, outside primary reports")
          },
        }
      },
      negative: async (c) => {
        const refs = await labRefs(await c("user_demo_owner"))
        return {
          actorKey: "user_demo_owner",
          input: { job: refs.labJob, period: "2027-03", businessDate: "2027-03-20", debitAccount: "production_expense", debitAmount: "100.00", creditAccount: "accrued_production", creditAmount: "90.00", memo: "Unbalanced lab entry" },
          expectCode: "blocked_by_rule",
          expectRule: "journal_unbalanced",
        }
      },
    },
    // ERP-36: lab CAD 1,000 payable revalued 0.75 → 0.78 (dated, sourced
    // rates) → USD 30 loss with a reversal next period. Negative: no rate.
    "agency-accruals-revaluation": {
      positive: async (c) => {
        const refs = await labRefs(await c("user_demo_owner"))
        return {
          actorKey: "user_demo_owner",
          input: { adjustmentType: "fx_revaluation", job: refs.labJob, period: "2027-03", amount: "1000.00", foreignCurrency: "CAD", balanceSide: "payable" },
          verify: async (output) => {
            const fx = (output as Out).fx_revaluation_proposal as { calc: { lossMinor: string; items: { bookLocalMinor: string; closingLocalMinor: string }[] }; rates: { previous: { rateDate: string; source: string } }; reversal: { date: string } }
            check(fx.calc.lossMinor === "3000" && fx.calc.items[0]!.bookLocalMinor === "75000" && fx.calc.items[0]!.closingLocalMinor === "78000", "USD 30 payable increase")
            check(fx.rates.previous.rateDate === "2027-02-28" && !!fx.rates.previous.source && fx.reversal.date === "2027-04-01", "dated, sourced rates and reversal")
            await approveAs(c, output as { approvalId: string; payloadDigest: string })
          },
        }
      },
      negative: async (c) => {
        const refs = await labRefs(await c("user_demo_owner"))
        return {
          actorKey: "user_demo_owner",
          input: { adjustmentType: "fx_revaluation", job: refs.labJob, period: "2027-03", amount: "1000.00", foreignCurrency: "MXN", balanceSide: "payable" },
          expectCode: "blocked_by_rule",
          expectRule: "fx_rate_missing",
        }
      },
    },
    // ERP-37: lab asset 1,200 / 12 months / residual 0 → 100 per month,
    // first month posted after finance review. Negative: residual > cost.
    "agency-fixed-assets": {
      positive: async (c) => {
        const refs = await labRefs(await c("user_demo_owner"))
        return {
          actorKey: "user_demo_owner",
          input: { assetName: `Lab camera kit ${runTag("asset")}`, cost: "1200.00", residualValue: "0.00", usefulLifeMonths: 12, startDate: "2027-03-01", method: "straight_line", job: refs.labJob },
          verify: async (output, ctx) => {
            const o = output as Out
            const annex = o.fixed_asset_annex as { months: { chargeMinor: string }[]; depreciableMinor: string }
            check(annex.months.length === 12 && annex.months.every((m) => m.chargeMinor === "10000") && annex.depreciableMinor === "120000", "100.00 monthly, exact total")
            await approveAs(c, o as unknown as { approvalId: string; payloadDigest: string })
            const [first] = await withTenant(ctx.tenant.id, (tx) => tx.select().from(depreciationEntry).where(and(eq(depreciationEntry.assetId, String(o.assetId)), eq(depreciationEntry.month, "2027-03"))))
            check(first?.state === "posted" && !!first.journalEntryId, "first month posted once")
          },
        }
      },
      negative: async () => ({
        actorKey: "user_demo_owner",
        input: { assetName: `Lab invalid asset ${runTag("asset")}`, cost: "1200.00", residualValue: "1300.00", usefulLifeMonths: 12, startDate: "2027-03-01", method: "straight_line" },
        expectCode: "blocked_by_rule",
        expectRule: "residual_exceeds_cost",
      }),
    },
    // ERP-38: with no blocker, a close proposal (with reason) approved by
    // finance — not the proposer — locks the period (writes blocked); an
    // approved reopen with a reason restores it (2027-01, untouched by the
    // journey). Negative: a held supplier invoice blocks the close proposal.
    "agency-period-close": {
      positive: async (c) => ({
        actorKey: "user_demo_owner",
        input: { period: "2027-01", action: "close", reason: "January has no open items (fixture)" },
        verify: async (output, ctx) => {
          const o = output as Out
          check(o.state === "open" && o.pendingApproval === true, "close waits for an independent approval")
          await approveAs(c, o as unknown as { approvalId: string; payloadDigest: string })
          const period = async () => (await withTenant(ctx.tenant.id, (tx) => tx.select().from(accountingPeriod).where(and(eq(accountingPeriod.tenantId, ctx.tenant.id), eq(accountingPeriod.period, "2027-01")))))[0]!
          check((await period()).state === "closed", "period closed after approval")
          const refs = await labRefs(ctx)
          const blocked = await tolerate(cmd(ctx, approveSupplierInvoice, { supplier: refs.labVendor, job: refs.labJob, invoiceNumber: runTag("JAN").toUpperCase(), invoiceDate: "2027-01-20", invoiceAmount: "1.00", period: "2027-01" }, "jan-write"))
          check(blocked === null, "writes into the closed period are blocked")
          const reopen = await cmd(ctx, closeAccountingPeriod, { period: "2027-01", action: "reopen", reason: "Fixture verification reopens January" }, "reopen")
          await approveAs(c, reopen as unknown as { approvalId: string; payloadDigest: string })
          const p = await period()
          check(p.state === "open" && p.reopenReason === "Fixture verification reopens January", "approved reopen with its reason")
        },
      }),
      negative: async (c) => {
        const owner = await c("user_demo_owner")
        const refs = await labRefs(owner)
        // Precondition: a supplier invoice above its order, held in February.
        await cmd(owner, approveSupplierInvoice, { supplier: refs.labVendor, job: refs.labJob, invoiceNumber: "LAB-SUP-FEB-HOLD", invoiceDate: "2027-02-20", invoiceAmount: "1500.00", period: "2027-02" }, "feb-hold")
        return { actorKey: "user_demo_owner", input: { period: "2027-02", action: "close", reason: "Attempt to close February" }, expectCode: "blocked_by_rule", expectRule: "unmatched_supplier_invoice" }
      },
    },
  },
  executors: {
    "ledger.manual_journal": {
      permission: "ledger.post",
      skillId: "agency-general-ledger",
      run: (tx, ctx, payload, mode) => applyManualJournal(tx, ctx, payload as Parameters<typeof applyManualJournal>[2], mode),
    },
    "accounting.recognition_run": {
      permission: "ledger.post",
      skillId: "agency-accruals-revaluation",
      run: (tx, ctx, payload, mode) => applyRecognitionRun(tx, ctx, payload as Parameters<typeof applyRecognitionRun>[2], mode),
    },
    "accounting.fx_revaluation": {
      permission: "ledger.post",
      skillId: "agency-accruals-revaluation",
      run: (tx, ctx, payload, mode) => applyFxRevaluation(tx, ctx, payload as Parameters<typeof applyFxRevaluation>[2], mode),
    },
    "close.period_action": {
      permission: "period.close",
      skillId: "agency-period-close",
      run: (tx, ctx, payload, mode) => applyPeriodAction(tx, ctx, payload as Parameters<typeof applyPeriodAction>[2], mode),
    },
    "assets.depreciation": {
      permission: "ledger.post",
      skillId: "agency-fixed-assets",
      run: (tx, ctx, payload, mode) => applyDepreciation(tx, ctx, payload as Parameters<typeof applyDepreciation>[2], mode),
    },
  },
}
