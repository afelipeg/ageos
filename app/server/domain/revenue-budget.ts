import "server-only"

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import { allocate, margin } from "@/server/calculators"
import type { Tx } from "@/server/db/client"
import { client, job, journalEntry, journalLine, revenueBudgetVersion } from "@/server/db/schema"
import { defineCommand, toJsonSafe, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { blocked, Decimal, moneyInput, Month, requestFinanceApproval } from "./ledger"

// Revenue budget (M09): versioned scenarios over an immutable approved
// baseline. A scenario changes projected revenue only; posted revenue comes
// from the Demo ledger and never changes because of a scenario. One currency
// per comparison (no implicit FX).

export const REVENUE_BUDGET_POLICY = "revenue-budget-lock-v1"

function monthsBetween(from: string, to: string) {
  const out: string[] = []
  let [y, m] = from.split("-").map(Number) as [number, number]
  const [ty, tm] = to.split("-").map(Number) as [number, number]
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    m += 1
    if (m === 13) {
      m = 1
      y += 1
    }
  }
  return out
}

async function postedRevenueByMonth(tx: Tx, tenantId: string, jobIds: string[]) {
  if (!jobIds.length) return new Map<string, bigint>()
  const rows = await tx
    .select({ period: journalEntry.period, v: sql<string>`sum(${journalLine.creditMinor} - ${journalLine.debitMinor})` })
    .from(journalLine)
    .innerJoin(journalEntry, and(eq(journalEntry.tenantId, journalLine.tenantId), eq(journalEntry.id, journalLine.entryId)))
    .where(and(eq(journalLine.tenantId, tenantId), eq(journalLine.accountCode, "agency_fee_revenue"), eq(journalEntry.state, "posted"), inArray(journalLine.jobId, jobIds)))
    .groupBy(journalEntry.period)
  return new Map(rows.map((r) => [r.period, BigInt(r.v ?? "0")]))
}

export const SaveRevenueBudgetInput = z
  .object({
    scenarioName: z.string().trim().min(2).max(80),
    client: z.string().uuid().optional().nullable(),
    periodFrom: Month,
    periodTo: Month,
    scenarioAmount: Decimal,
    allocationDriver: z.enum(["even_monthly", "proportional_to_actuals"]),
  })
  .strict()

export const saveRevenueBudgetScenario = defineCommand({
  type: "revenueBudget.saveScenario",
  skillId: "agency-revenue-budget",
  permission: "budget.propose",
  input: SaveRevenueBudgetInput,
  handler: async (tx, ctx, input, meta) => {
    if (input.periodFrom > input.periodTo) throw new DomainError("validation", "The period range is inverted", { field: "periodTo" })
    const months = monthsBetween(input.periodFrom, input.periodTo)
    if (months.length > 24) throw new DomainError("validation", "At most 24 months per scenario", { field: "periodTo" })
    const c = input.client ? (await tx.select().from(client).where(and(eq(client.tenantId, ctx.tenant.id), eq(client.id, input.client))).limit(1))[0] : null
    if (input.client && !c) throw new DomainError("not_found", "Client not found", { field: "client" })
    const currency = c?.billingCurrency ?? ctx.tenant.baseCurrency
    const amount = moneyInput(input.scenarioAmount, currency, "scenarioAmount")
    const versions = await tx
      .select()
      .from(revenueBudgetVersion)
      .where(and(eq(revenueBudgetVersion.tenantId, ctx.tenant.id), c ? eq(revenueBudgetVersion.clientId, c.id) : sql`${revenueBudgetVersion.clientId} is null`))
      .orderBy(desc(revenueBudgetVersion.createdAt), desc(revenueBudgetVersion.versionNumber))
    const baseline = versions.find((v) => v.state === "baseline" || v.state === "approved") ?? null
    if (versions.some((v) => v.scenarioName === input.scenarioName && (v.state === "baseline" || v.state === "approved"))) {
      blocked("baseline_locked", "An approved baseline cannot be overwritten; save the scenario under a new name", { scenarioName: input.scenarioName })
    }
    if (baseline && baseline.currency !== currency) blocked("mixed_currency", "Scenario and baseline currencies differ; no implicit FX", { baselineCurrency: baseline.currency, scenarioCurrency: currency })
    const jobs = c ? await tx.select().from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.clientId, c.id))) : []
    const posted = await postedRevenueByMonth(tx, ctx.tenant.id, jobs.map((j) => j.id))
    const exceptions: string[] = []
    let weights = months.map((m) => ({ targetId: m, weight: 1n }))
    if (input.allocationDriver === "proportional_to_actuals") {
      const w = months.map((m) => ({ targetId: m, weight: posted.get(m) ?? 0n }))
      if (w.some((x) => x.weight > 0n)) weights = w
      else exceptions.push("no_posted_actuals_in_range: allocated evenly")
    }
    const lines = allocate({ currency, amountMinor: amount, weights }).allocations.map((a) => ({ month: a.targetId, amountMinor: a.amountMinor }))
    const sameName = versions.filter((v) => v.scenarioName === input.scenarioName).sort((a, b) => b.versionNumber - a.versionNumber)
    const [row] = await tx
      .insert(revenueBudgetVersion)
      .values({ tenantId: ctx.tenant.id, scenarioName: input.scenarioName, clientId: c?.id ?? null, jobId: jobs.length === 1 ? jobs[0]!.id : null, periodFrom: input.periodFrom, periodTo: input.periodTo, currency, amountMinor: amount, allocationDriver: input.allocationDriver, lines: toJsonSafe(lines) as object, versionNumber: (sameName[0]?.versionNumber ?? 0) + 1, state: "scenario", basedOnId: baseline?.id ?? null, createdBy: ctx.user.id })
      .returning()
    const baseLines = new Map(((baseline?.lines as { month: string; amountMinor: string }[] | undefined) ?? []).map((l) => [l.month, BigInt(l.amountMinor)]))
    const planVsActual = months.map((m) => {
      const plan = baseLines.get(m) ?? 0n
      const scenario = lines.find((l) => l.month === m)!.amountMinor
      const actual = posted.get(m) ?? 0n
      return { month: m, baselineMinor: plan, scenarioMinor: scenario, postedMinor: actual, varianceToBaselineMinor: scenario - plan, varianceActualToScenarioMinor: actual - scenario }
    })
    const postedTotal = months.reduce((a, m) => a + (posted.get(m) ?? 0n), 0n)
    const baselineTotal = [...baseLines.entries()].filter(([m]) => months.includes(m)).reduce((a, [, v]) => a + v, 0n)
    // Approval to lock the scenario as the new baseline binds this version.
    const anchorJob = jobs.length === 1 ? { id: jobs[0]!.id, revision: jobs[0]!.revision } : null
    const appr = await requestFinanceApproval(tx, ctx, {
      actionType: "revenue_budget.lock",
      skillId: "agency-revenue-budget",
      job: anchorJob,
      aggregate: { type: "revenue_budget_version", id: row!.id, revision: row!.revision },
      payload: { action: "revenue_budget.lock", versionId: row!.id, versionRevision: row!.revision, scenarioName: input.scenarioName, amountMinor: amount, currency, lines },
      impact: { scenarioMinor: amount, baselineMinor: baselineTotal, postedMinor: postedTotal, currency },
      title: `Revenue budget "${input.scenarioName}" v${row!.versionNumber}`,
      amountMinor: amount,
      currency,
      destination: c ? `client:${c.code}` : "agency",
      policyId: REVENUE_BUDGET_POLICY,
      eligibleRoles: ["owner", "finance_approver"],
      origin: meta.origin,
    })
    await tx.update(revenueBudgetVersion).set({ approvalId: appr.approval.id }).where(eq(revenueBudgetVersion.id, row!.id))
    const projected = margin({ currency, agencyRevenueMinor: amount, agencyCostMinor: 0n, managedSpendMinor: 0n })
    return {
      result: {
        versionId: row!.id,
        ...appr.approvalSummary,
        budget_version: { versionId: row!.id, scenarioName: input.scenarioName, versionNumber: row!.versionNumber, state: "scenario", basedOn: baseline ? { id: baseline.id, name: baseline.scenarioName, state: baseline.state } : null, currency },
        budget_lines: lines,
        income_projection: { scenarioMinor: amount, baselineMinor: baselineTotal, deltaMinor: amount - baselineTotal, currency, contributionBps: projected.marginBps },
        plan_vs_actual: { months: planVsActual, postedMinor: postedTotal, note: "Posted revenue comes from the Demo ledger; a scenario never changes it." },
        version_lock_proposal: { approvalId: appr.approval.id, eligibleRoles: ["owner", "finance_approver"], state: "awaiting_approval" },
        budget_exceptions: exceptions,
      },
      events: [
        { eventType: "revenue_budget.scenario_saved", aggregateType: "revenue_budget_version", aggregateId: row!.id, jobId: anchorJob?.id ?? null, payload: { scenarioName: input.scenarioName, amountMinor: amount, currency, versionNumber: row!.versionNumber } },
        ...appr.events,
      ],
    }
  },
})

export async function applyRevenueBudgetLock(
  tx: Tx,
  ctx: AgencyContext,
  payload: { versionId: string; versionRevision: number },
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const [v] = await tx.select().from(revenueBudgetVersion).where(and(eq(revenueBudgetVersion.tenantId, ctx.tenant.id), eq(revenueBudgetVersion.id, payload.versionId))).for("update").limit(1)
  if (!v || v.revision !== payload.versionRevision || v.state !== "scenario") return { ok: false, code: "approval_stale", details: { versionId: payload.versionId } }
  if (mode === "check") return { ok: true, events: [] }
  await tx.update(revenueBudgetVersion).set({ state: "approved", revision: sql`${revenueBudgetVersion.revision} + 1` }).where(eq(revenueBudgetVersion.id, v.id))
  return { ok: true, events: [{ eventType: "revenue_budget.version_approved", aggregateType: "revenue_budget_version", aggregateId: v.id, payload: { scenarioName: v.scenarioName, versionNumber: v.versionNumber } }] }
}
