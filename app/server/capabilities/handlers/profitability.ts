// Capability handlers for module "profitability". Owner: Core-3.
// Skills: agency-profitability, agency-revenue-budget, agency-cash-forecast, agency-management-reporting
// A skill missing from `handlers` is "registered" only (no fake success).
import "server-only"

import { and, eq } from "drizzle-orm"

import { minorToDecimalString } from "@/lib/money"
import { bankAccount, fileObject, revenueBudgetVersion } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { cashPosition } from "@/server/domain/cash"
import { calculateCashScenario, CalculateCashScenarioInput } from "@/server/domain/cash-forecast"
import { calculateJobProfitability, ProfitabilityInput } from "@/server/domain/profitability"
import { applyRevenueBudgetLock, saveRevenueBudgetScenario } from "@/server/domain/revenue-budget"
import { generateManagementSnapshot, SYNTHETIC_REPORT_LABEL } from "@/server/domain/reporting"
import type { AgencyContext } from "@/server/auth/context"
import type { ModuleCapabilities } from "../types"

import { check, labRefs, runTag, type Out } from "./suppliers-payments"

async function primaryCashAt(ctx: AgencyContext, asOf: string) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const accounts = await tx.select().from(bankAccount).where(and(eq(bankAccount.tenantId, ctx.tenant.id), eq(bankAccount.reportingGroup, "primary"), eq(bankAccount.currency, "USD")))
    let total = 0n
    for (const a of accounts) total += (await cashPosition(tx, ctx.tenant.id, a.id, asOf)).confirmedMinor
    return total
  })
}

export const capabilities: ModuleCapabilities = {
  handlers: {
    "agency-profitability": { kind: "query", input: ProfitabilityInput, run: calculateJobProfitability as never },
    "agency-revenue-budget": { kind: "command", command: saveRevenueBudgetScenario },
    "agency-cash-forecast": { kind: "query", input: CalculateCashScenarioInput, run: calculateCashScenario as never },
    "agency-management-reporting": { kind: "command", command: generateManagementSnapshot },
  },
  fixtures: {
    // ERP-39: Aurora margin from persisted records; managed media stays out of
    // net agency revenue. Negative: a job outside the agency is not found.
    "agency-profitability": {
      positive: async (c) => {
        const refs = await labRefs(await c("user_demo_owner"))
        return {
          actorKey: "user_demo_owner",
          input: { job: refs.auroraJob, basis: "forecast" },
          verify: async (output) => {
            const o = output as Out
            const pnl = o.job_pnl as { revenueMinor: string; costMinor: string; marginMinor: string }
            const media = (o.managed_spend as { managedMediaMinor: string }).managedMediaMinor
            check(pnl.revenueMinor === String(o.agencyFeeMinor) && BigInt(media) > 0n, "fee is the revenue; media reported apart")
            check(BigInt(pnl.marginMinor) === BigInt(pnl.revenueMinor) - BigInt(pnl.costMinor), "margin excludes managed media")
            check(o.basis === "forecast" && Array.isArray(o.sources) && (o.sources as unknown[]).length > 0, "basis and sources")
          },
        }
      },
      negative: async () => ({
        actorKey: "user_demo_owner",
        input: { job: crypto.randomUUID(), basis: "forecast" },
        expectCode: "not_found",
      }),
    },
    // ERP-40: a lab scenario changes projected revenue only; the approved
    // baseline and posted revenue stay. Negative: overwriting the baseline.
    "agency-revenue-budget": {
      positive: async (c) => {
        const owner = await c("user_demo_owner")
        const lab = await withTenant(owner.tenant.id, async (tx) => (await tx.select().from(revenueBudgetVersion).where(and(eq(revenueBudgetVersion.tenantId, owner.tenant.id), eq(revenueBudgetVersion.fixtureKey, "revenue_budget_demo_lab_baseline"))).limit(1))[0]!)
        return {
          actorKey: "user_demo_owner",
          input: { scenarioName: `Lab upside ${runTag("rb")}`, client: lab.clientId, periodFrom: "2027-01", periodTo: "2027-12", scenarioAmount: "25000.00", allocationDriver: "even_monthly" },
          verify: async (output, ctx) => {
            const o = output as Out
            const lines = o.budget_lines as { amountMinor: string }[]
            check(lines.length === 12 && lines.reduce((a, l) => a + BigInt(l.amountMinor), 0n) === 2500000n, "allocation conserves the scenario total")
            const proj = o.income_projection as { baselineMinor: string; deltaMinor: string }
            check(proj.baselineMinor === "2000000" && proj.deltaMinor === "500000", "projection vs approved baseline")
            const [base] = await withTenant(ctx.tenant.id, (tx) => tx.select().from(revenueBudgetVersion).where(eq(revenueBudgetVersion.id, lab.id)))
            check(base?.state === "baseline" && base.amountMinor === 2000000n, "baseline unchanged")
            const pva = o.plan_vs_actual as { postedMinor: string; note: string }
            check(typeof pva.postedMinor === "string", "posted revenue reported from the ledger")
          },
        }
      },
      negative: async (c) => {
        const owner = await c("user_demo_owner")
        const lab = await withTenant(owner.tenant.id, async (tx) => (await tx.select().from(revenueBudgetVersion).where(and(eq(revenueBudgetVersion.tenantId, owner.tenant.id), eq(revenueBudgetVersion.fixtureKey, "revenue_budget_demo_lab_baseline"))).limit(1))[0]!)
        return {
          actorKey: "user_demo_owner",
          input: { scenarioName: lab.scenarioName, client: lab.clientId, periodFrom: "2027-01", periodTo: "2027-12", scenarioAmount: "30000.00", allocationDriver: "even_monthly" },
          expectCode: "blocked_by_rule",
          expectRule: "baseline_locked",
        }
      },
    },
    // ERP-41: forecast opens at confirmed bank cash and keeps receivables,
    // payables and undated pipeline apart. Negative: receivables entered as
    // opening cash are rejected.
    "agency-cash-forecast": {
      positive: async (c) => {
        const owner = await c("user_demo_owner")
        const cash = await primaryCashAt(owner, "2027-03-15")
        return {
          actorKey: "user_demo_owner",
          input: { openingCash: minorToDecimalString(cash, "USD"), currency: "USD", asOfDate: "2027-03-15", horizonDays: 90, scenario: "downside", collectionDelayDays: 15 },
          verify: async (output) => {
            const o = output as Out
            const bucket = (o.currency_buckets as { confirmedCashMinor: string; probableInflowsMinor: string }[])[0]!
            check(BigInt(bucket.confirmedCashMinor) === cash, "confirmed cash = bank balance")
            check((o.collection_scenarios as unknown[]).length === 2, "base and downside scenarios")
          },
        }
      },
      negative: async (c) => {
        const owner = await c("user_demo_owner")
        const cash = await primaryCashAt(owner, "2027-03-15")
        return {
          actorKey: "user_demo_owner",
          input: { openingCash: minorToDecimalString(cash + 5300000n, "USD"), currency: "USD", asOfDate: "2027-03-15", horizonDays: 90, scenario: "base" },
          expectCode: "blocked_by_rule",
          expectRule: "opening_cash_not_confirmed",
        }
      },
    },
    // ERP-42: persisted snapshot with cut-off, definitions, sources, totals
    // reconciled with the queries and a labelled CSV export. Negative: an
    // unconfigured period cannot produce a report.
    "agency-management-reporting": {
      positive: async () => ({
        actorKey: "user_demo_owner",
        input: { period: "2027-03", basis: "incurred", reportTitle: "March 2027 management pack", includeManagedMedia: true },
        verify: async (output, ctx) => {
          const o = output as Out
          check(o.label === SYNTHETIC_REPORT_LABEL, "synthetic label")
          const pack = o.management_pack as { cutOff: string; definitions: Record<string, string>; sources: unknown[]; reconciliation: { metric: string; equal: boolean }[] }
          check(!!pack.cutOff && Object.keys(pack.definitions).length >= 4 && pack.sources.length > 0, "cut-off, definitions and sources")
          check(pack.reconciliation.filter((r) => r.metric === "revenue" || r.metric === "agency_cost" || r.metric === "trial_balance_sum").every((r) => r.equal), "totals reconcile with the ledger")
          const file = (o.export_files as { fileId: string }[])[0]!
          const [f] = await withTenant(ctx.tenant.id, (tx) => tx.select().from(fileObject).where(eq(fileObject.id, file.fileId)))
          check(f?.format === "csv" && f.tenantId === ctx.tenant.id, "export stored in the agency library")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_owner",
        input: { period: "2026-12", basis: "incurred" },
        expectCode: "blocked_by_rule",
        expectRule: "period_not_configured",
      }),
    },
  },
  executors: {
    "revenue_budget.lock": {
      permission: "reports.view",
      skillId: "agency-revenue-budget",
      run: (tx, ctx, payload, mode) => applyRevenueBudgetLock(tx, ctx, payload as Parameters<typeof applyRevenueBudgetLock>[2], mode),
    },
  },
}
