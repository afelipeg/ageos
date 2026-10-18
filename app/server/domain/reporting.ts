import "server-only"

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { csvSafeCell } from "@/lib/csv"
import { formatBps, minorToDecimalString } from "@/lib/money"
import type { AgencyContext } from "@/server/auth/context"
import { margin } from "@/server/calculators"
import { bankAccount, businessEvent, job, ledgerAccount, managementReport, recognitionRecord } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { getBusinessDate } from "@/server/domain/presenter"
import { defineCommand, toJsonSafe } from "@/server/kernel/commands"

import { periodEnd } from "./accruals"
import { cashPosition, storeGeneratedFile } from "./cash"
import { receivablesAging } from "./collections"
import { blocked, DEMO_LEDGER_LABEL, getPeriod, Month, trialBalance } from "./ledger"
import { computeProfitability, loadJobFinancials } from "./profitability"

// Management reporting (M09): a persisted, labelled snapshot with cut-off,
// metric definitions, sources and totals reconciled against the same queries
// the app uses (profitability, Demo ledger trial balance, bank cash, AR), plus
// a CSV export. Primary scope only (demo-lab excluded); single tenant; data is
// synthetic and says so on every artifact.

export const SYNTHETIC_REPORT_LABEL = "Synthetic demo data — not a financial statement"

export const GenerateManagementSnapshotInput = z
  .object({
    period: Month,
    basis: z.enum(["forecast", "incurred", "posted"]),
    reportTitle: z.string().trim().max(120).optional().nullable(),
    includeManagedMedia: z.boolean().optional().nullable(),
  })
  .strict()

const REPORT_LINES: Record<string, string> = {
  agency_fee_revenue: "Net agency revenue",
  labor_expense: "Agency cost — labor",
  production_expense: "Agency cost — production",
  direct_expense: "Agency cost — direct expenses",
  cash: "Cash (demo bank)",
  accounts_receivable: "Receivables",
  media_recovery_asset: "Managed media (pass-through)",
  accrued_media: "Managed media (pass-through)",
  ap_media: "Managed media (pass-through)",
}

export const generateManagementSnapshot = defineCommand({
  type: "reporting.generateSnapshot",
  skillId: "agency-management-reporting",
  permission: "reports.view",
  input: GenerateManagementSnapshotInput,
  handler: async (tx, ctx, input) => {
    const p = await getPeriod(tx, ctx.tenant.id, input.period)
    if (!p) blocked("period_not_configured", `Accounting period ${input.period} is not configured`, { period: input.period })
    // Cut-off = period end: the pack covers every record dated in the period
    // (the business date is reported next to it; an open period is labelled).
    const today = await getBusinessDate()
    const cutOff = periodEnd(input.period)
    const currency = ctx.tenant.baseCurrency
    const jobs = await tx.select().from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.reportingGroup, "primary"), eq(job.currency, currency))).orderBy(asc(job.displayReference))
    const rows = []
    for (const j of jobs) {
      const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
      const at = computeProfitability(fin, input.basis, ctx.tenant.slug)
      const forecast = computeProfitability(fin, "forecast", ctx.tenant.slug)
      rows.push({ jobId: j.id, reference: j.displayReference, name: j.name, revenueMinor: at.agencyFeeMinor, costMinor: at.agencyCost.totalMinor, marginMinor: at.marginMinor, marginBps: at.marginBps, managedMediaMinor: at.managedMediaMinor, forecastMarginBps: forecast.marginBps, unmetRequirements: at.unmetRequirements })
    }
    const revenue = rows.reduce((a, r) => a + r.revenueMinor, 0n)
    const cost = rows.reduce((a, r) => a + r.costMinor, 0n)
    const media = rows.reduce((a, r) => a + r.managedMediaMinor, 0n)
    const m = margin({ currency, agencyRevenueMinor: revenue, agencyCostMinor: cost, managedSpendMinor: media })

    const tb = await trialBalance(tx, ctx.tenant.id, { excludeGroups: ["demo-lab"], throughPeriod: input.period })
    const tbCur = tb.currencies.find((c) => c.currency === currency) ?? { currency, balances: {} as Record<string, bigint>, sumMinor: 0n, netProfitMinor: 0n }
    const banks = await tx.select().from(bankAccount).where(and(eq(bankAccount.tenantId, ctx.tenant.id), eq(bankAccount.reportingGroup, "primary"), eq(bankAccount.currency, currency)))
    let cash = 0n
    for (const b of banks) cash += (await cashPosition(tx, ctx.tenant.id, b.id, cutOff)).confirmedMinor
    const { open, report: agingReport } = await receivablesAging(tx, ctx.tenant.id, cutOff)
    const primaryJobIds = new Set(jobs.map((j) => j.id))
    const ar = open.filter((o) => primaryJobIds.has(o.jobId) && o.currency === currency).reduce((a, o) => a + (o.grossMinor - o.collectedMinor), 0n)
    const [seq] = await tx.select({ s: sql<number>`coalesce(max(${businessEvent.seq}), 0)::int` }).from(businessEvent).where(eq(businessEvent.tenantId, ctx.tenant.id))
    const recCount = jobs.length
      ? (await tx.select({ n: sql<number>`count(*)::int` }).from(recognitionRecord).where(and(eq(recognitionRecord.tenantId, ctx.tenant.id), inArray(recognitionRecord.jobId, [...primaryJobIds]))))[0]!.n
      : 0

    const ledgerRevenue = -(tbCur.balances["agency_fee_revenue"] ?? 0n)
    const ledgerCost = (tbCur.balances["labor_expense"] ?? 0n) + (tbCur.balances["production_expense"] ?? 0n) + (tbCur.balances["direct_expense"] ?? 0n)
    const reconciliation = [
      { metric: "cash", report: cash, source: tbCur.balances["cash"] ?? 0n, sourceName: "Demo ledger cash vs confirmed demo bank", equal: cash === (tbCur.balances["cash"] ?? 0n) },
      { metric: "receivables", report: ar, source: tbCur.balances["accounts_receivable"] ?? 0n, sourceName: "Demo ledger AR vs open demo invoices", equal: ar === (tbCur.balances["accounts_receivable"] ?? 0n) },
      ...(input.basis === "forecast" ? [] : [
        { metric: "revenue", report: revenue, source: ledgerRevenue, sourceName: "Demo ledger agency_fee_revenue", equal: revenue === ledgerRevenue },
        { metric: "agency_cost", report: cost, source: ledgerCost, sourceName: "Demo ledger labor + production + direct expense", equal: cost === ledgerCost },
      ]),
      { metric: "trial_balance_sum", report: tbCur.sumMinor, source: 0n, sourceName: "Debits equal credits", equal: tbCur.sumMinor === 0n },
    ]
    const accounts = await tx.select({ code: ledgerAccount.code }).from(ledgerAccount).where(eq(ledgerAccount.tenantId, ctx.tenant.id))
    const used = Object.keys(tbCur.balances)
    const mapping = { mapped: used.filter((c) => REPORT_LINES[c]), unmapped: used.filter((c) => !REPORT_LINES[c]), chartAccounts: accounts.length }
    const title = input.reportTitle?.trim() || `${input.period} management pack`
    const status = { periodState: p.state, businessDate: today, inProgress: p.state === "open" && today < cutOff }
    const definitions = {
      margin: "(net agency revenue − agency cost) / net agency revenue, HALF_UP to basis points",
      basis: input.basis === "forecast" ? "approved fee and current cost estimate" : input.basis === "incurred" ? "recognized fee and recognized agency cost (Demo ledger recognition)" : "posted Demo ledger journals",
      managedMedia: "pass-through: excluded from net agency revenue and agency cost",
      cash: "confirmed demo-bank balance at cut-off (receivables and forecasts are not cash)",
      scope: "primary reporting group; demo-lab excluded; single tenant and currency",
    }
    const kpi = { currency, revenueMinor: revenue, costMinor: cost, marginMinor: m.marginMinor, marginBps: m.marginBps, cashMinor: cash, receivablesMinor: ar, ...(input.includeManagedMedia ? { managedMediaMinor: media } : {}) }
    const commentary = rows.map((r) => {
      const delta = r.marginBps !== null && r.forecastMarginBps !== null ? r.marginBps - r.forecastMarginBps : null
      return { jobId: r.jobId, text: `${r.reference}: ${input.basis} margin ${formatBps(r.marginBps, "en")} vs forecast ${formatBps(r.forecastMarginBps, "en")}${delta === null ? "" : ` (${delta >= 0 ? "+" : ""}${delta} bps)`}${r.unmetRequirements.length ? `; pending: ${r.unmetRequirements.join(", ")}` : ""}.` }
    })
    const fmt = (v: bigint) => minorToDecimalString(v, currency)
    const csvRows = [
      ["section", "metric", "currency", "value"],
      ["meta", "label", "", SYNTHETIC_REPORT_LABEL],
      ["meta", "title", "", title],
      ["meta", "period", "", input.period],
      ["meta", "basis", "", input.basis],
      ["meta", "cut_off", "", cutOff],
      ["meta", "period_state", "", `${p.state}${status.inProgress ? " (in progress)" : ""}`],
      ["meta", "snapshot_seq", "", String(seq?.s ?? 0)],
      ["kpi", "net_agency_revenue", currency, fmt(revenue)],
      ["kpi", "agency_cost", currency, fmt(cost)],
      ["kpi", "margin", currency, fmt(m.marginMinor)],
      ["kpi", "margin_bps", "", String(m.marginBps ?? "")],
      ["kpi", "cash_confirmed", currency, fmt(cash)],
      ["kpi", "receivables", currency, fmt(ar)],
      ...(input.includeManagedMedia ? [["kpi", "managed_media_passthrough", currency, fmt(media)]] : []),
      ...rows.map((r) => ["job", `${r.reference} margin_bps`, "", String(r.marginBps ?? "")]),
    ]
    const csv = csvRows.map((r) => r.map((c) => csvSafeCell(c)).join(";")).join("\n") + "\n"
    const file = await storeGeneratedFile(tx, ctx, { name: `management-pack-${input.period}-${input.basis}.csv`, format: "csv", bytes: new TextEncoder().encode(csv), label: SYNTHETIC_REPORT_LABEL })
    const sources = [
      ...rows.map((r) => ({ recordType: "job", recordId: r.jobId, label: r.reference, href: `/a/${ctx.tenant.slug}/jobs/${r.jobId}` })),
      { recordType: "trial_balance", recordId: input.period, label: `${DEMO_LEDGER_LABEL} (${tb.journalCount} journals)`, href: `/a/${ctx.tenant.slug}/modules/accounting-close/workflows/agency-general-ledger` },
      ...banks.map((b) => ({ recordType: "bank_account", recordId: b.id, label: b.name, href: `/a/${ctx.tenant.slug}/modules/suppliers-payments` })),
      { recordType: "recognition_record", recordId: "count", label: `${recCount} recognition records`, href: `/a/${ctx.tenant.slug}/modules/accounting-close` },
    ]
    const content = { jobs: rows, aging: agingReport, reconciliation, mapping, commentary, status }
    const [snap] = await tx
      .insert(managementReport)
      .values({ tenantId: ctx.tenant.id, title, period: input.period, basis: input.basis, currency, cutOff, snapshotSeq: seq?.s ?? 0, definitions, sources: toJsonSafe(sources) as object, totals: toJsonSafe(kpi) as object, content: toJsonSafe(content) as object, exportFileId: file.id, label: SYNTHETIC_REPORT_LABEL, createdBy: ctx.user.id })
      .returning()
    return {
      result: {
        snapshotId: snap!.id,
        label: SYNTHETIC_REPORT_LABEL,
        management_pack: { title, period: input.period, basis: input.basis, currency, cutOff, status, snapshotSeq: snap!.snapshotSeq, definitions, sources, jobs: rows, reconciliation },
        mapping_coverage: mapping,
        export_files: [{ fileId: file.id, name: file.originalName, format: "csv", sha256: file.sha256, label: SYNTHETIC_REPORT_LABEL }],
        kpi_summary: kpi,
        variance_commentary: commentary,
      },
      events: [{ eventType: "reporting.snapshot_generated", aggregateType: "management_report", aggregateId: snap!.id, payload: { period: input.period, basis: input.basis, snapshotSeq: snap!.snapshotSeq, exportFileId: file.id } }],
    }
  },
})

export async function listManagementReports(ctx: AgencyContext) {
  return withTenant(ctx.tenant.id, (tx) => tx.select().from(managementReport).where(eq(managementReport.tenantId, ctx.tenant.id)).orderBy(desc(managementReport.createdAt)))
}
