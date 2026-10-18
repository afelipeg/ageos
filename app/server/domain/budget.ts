import "server-only"

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { divHalfUp, parseDecimalToMinor } from "@/lib/money"
import type { AgencyContext } from "@/server/auth/context"
import { budgetCheck, margin } from "@/server/calculators"
import { hourlyFeeSettlement } from "@/server/calculators/clients"
import { allocate, creditExposure, installmentSchedule } from "@/server/calculators/shared"
import type { Tx } from "@/server/db/client"
import {
  budgetRevision,
  budgetReservation,
  client,
  contract,
  costEstimate,
  costEstimateLine,
  feeSchedule,
  feeScheduleLine,
  job,
  mediaPlanRevision,
} from "@/server/db/schema"
import {
  createProposal,
  invalidatePendingApprovals,
  registerApprovalPolicy,
  requestApproval,
} from "@/server/kernel/approvals"
import {
  assertRevision,
  defineCommand,
  toJsonSafe,
  type CommandMeta,
  type EmittedEvent,
} from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { evaluateMarginFloor } from "./attention"
import { checkEvidence, verifyEvidencePin, type EvidencePin } from "./evidence"
import { getBusinessDate } from "./presenter"
import { budgetAvailability, estimateTotals, loadJobFinancials, type JobFinancials } from "./profitability"

// Field keys match lib/capabilities/input-fields.ts, so the workbench form and
// the assistant submit the same payload the command validates.

const Uuid = z.string().uuid()
const Decimal = z.string().trim().min(1).max(24)
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Invalid date")

export async function lockJob(tx: Tx, tenantId: string, jobId: string) {
  const rows = await tx
    .select()
    .from(job)
    .where(and(eq(job.tenantId, tenantId), eq(job.id, jobId)))
    .for("update")
    .limit(1)
  if (!rows[0]) throw new DomainError("not_found", "Job not found")
  return rows[0]
}

function amount(value: string, currency: string, field: string): bigint {
  try {
    const minor = parseDecimalToMinor(value, currency)
    if (minor < 0n) throw new Error("negative")
    return minor
  } catch {
    throw new DomainError("validation", `Invalid amount for ${field}`, { field })
  }
}

async function bumpJobRevision(tx: Tx, tenantId: string, jobId: string, actor: string) {
  const [row] = await tx
    .update(job)
    .set({ revision: sql`${job.revision} + 1`, updatedAt: new Date(), updatedBy: actor })
    .where(and(eq(job.tenantId, tenantId), eq(job.id, jobId)))
    .returning({ revision: job.revision })
  return row!.revision
}

// ── agency-production-estimating: createProductionEstimate ──
export const RecordCostEstimateInput = z
  .object({
    job: Uuid,
    laborMinutes: z.number().int().min(0).max(600000),
    hourlyCost: Decimal,
    productionVendorAmount: Decimal,
    expenseAmount: Decimal,
    reason: z.string().trim().min(3).max(1000),
  })
  .strict()

export const recordCostEstimate = defineCommand({
  type: "production.recordCostEstimate",
  skillId: "agency-production-estimating",
  permission: "production.manage",
  input: RecordCostEstimateInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertRevision(j.revision, meta.expectedRevision, "job")
    const currency = j.currency
    const hourly = amount(input.hourlyCost, currency, "hourlyCost")
    const production = amount(input.productionVendorAmount, currency, "productionVendorAmount")
    const expense = amount(input.expenseAmount, currency, "expenseAmount")
    // Labor = minutes × hourly cost / 60 (HALF_UP when not whole hours).
    const laborMinor = divHalfUp(BigInt(input.laborMinutes) * hourly, 60n)

    const [prev] = await tx
      .select()
      .from(costEstimate)
      .where(
        and(
          eq(costEstimate.tenantId, ctx.tenant.id),
          eq(costEstimate.jobId, j.id),
          eq(costEstimate.state, "current")
        )
      )
      .limit(1)
    // The production vendor of the superseded estimate stays linked to the
    // new production line (the input carries amounts, not the vendor).
    const [prevProduction] = prev
      ? await tx
          .select({ supplierId: costEstimateLine.supplierId })
          .from(costEstimateLine)
          .where(and(eq(costEstimateLine.tenantId, ctx.tenant.id), eq(costEstimateLine.estimateId, prev.id), eq(costEstimateLine.lineType, "production")))
          .limit(1)
      : []
    if (prev) {
      await tx
        .update(costEstimate)
        .set({ state: "superseded", revision: sql`${costEstimate.revision} + 1` })
        .where(eq(costEstimate.id, prev.id))
    }
    const [last] = await tx
      .select({ number: costEstimate.number })
      .from(costEstimate)
      .where(and(eq(costEstimate.tenantId, ctx.tenant.id), eq(costEstimate.jobId, j.id)))
      .orderBy(desc(costEstimate.number))
      .limit(1)
    const [est] = await tx
      .insert(costEstimate)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        number: (last?.number ?? 0) + 1,
        state: "current",
        reason: input.reason,
        currency,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning()
    await tx.insert(costEstimateLine).values([
      {
        tenantId: ctx.tenant.id,
        estimateId: est!.id,
        lineType: "labor",
        description: "Agency labor",
        minutes: input.laborMinutes,
        hourlyCostMinor: hourly,
        amountMinor: laborMinor,
        currency,
      },
      {
        tenantId: ctx.tenant.id,
        estimateId: est!.id,
        lineType: "production",
        description: "Production vendor",
        amountMinor: production,
        currency,
        supplierId: prevProduction?.supplierId ?? null,
      },
      {
        tenantId: ctx.tenant.id,
        estimateId: est!.id,
        lineType: "expense",
        description: "Expenses",
        amountMinor: expense,
        currency,
      },
    ])
    const jobRevision = await bumpJobRevision(tx, ctx.tenant.id, j.id, ctx.user.id)
    const staled = await invalidatePendingApprovals(tx, ctx.tenant.id, "job", j.id)
    const ruleEvents = await evaluateMarginFloor(tx, ctx.tenant.id, ctx.tenant.slug, j.id)
    const totalMinor = laborMinor + production + expense
    return {
      result: {
        estimateId: est!.id,
        number: est!.number,
        totalMinor: totalMinor.toString(),
        currency,
        jobRevision,
        staleApprovals: staled,
      },
      events: [
        {
          eventType: "cost_estimate.recorded",
          aggregateType: "job",
          aggregateId: j.id,
          aggregateRevision: jobRevision,
          jobId: j.id,
          payload: {
            estimateId: est!.id,
            number: est!.number,
            previousEstimateId: prev?.id ?? null,
            laborMinutes: input.laborMinutes,
            totalMinor,
            currency,
            reason: input.reason,
            staleApprovals: staled,
          },
        },
        ...ruleEvents,
      ],
    }
  },
})

// ── agency-fee-contracts: calculateFeeSchedule → fee amendment proposal ──
export const ProposeFeeAmendmentInput = z
  .object({
    job: Uuid,
    newAgencyFee: Decimal,
    reason: z.string().trim().min(3).max(1000),
  })
  .strict()

export const FEE_AMENDMENT_POLICY = registerApprovalPolicy({ id: "fee-amendment-v1", revision: 1 })

// Demo fee-contract policy (source skill agency-fee-contracts, procedure
// steps 3–4 and 9): one instalment in the job period with no advance; each
// instalment is split into media and production fee items (50/50 when the job
// runs both services); fixed fees absorb hours above the covered quota.
const FEE_POLICY = { advanceBps: 0, installments: 1, overagePolicy: "absorb" as const }

type FeeException = { code: string; detail: Record<string, unknown> }

function feeSplitWeights(services: readonly string[]) {
  const media = services.includes("media")
  const production = services.includes("production") || services.includes("creative") || !media
  return [
    ...(media ? [{ targetId: "media", weight: 1n }] : []),
    ...(production ? [{ targetId: "production", weight: 1n }] : []),
  ]
}

const toHundredths = (minutes: number) => divHalfUp(BigInt(minutes) * 100n, 60n)

/** Instalments, media/production split, job allocation and hourly settlement. */
export function computeFeeSchedule(fin: JobFinancials, toFeeMinor: bigint) {
  const j = fin.job
  const currency = j.currency
  const schedule = installmentSchedule({
    currency,
    grossMinor: toFeeMinor,
    advanceBps: FEE_POLICY.advanceBps,
    installments: FEE_POLICY.installments,
    startMonth: j.period,
  })
  const lines: { instalmentNumber: number; month: string; share: string; amountMinor: bigint }[] = []
  for (const inst of schedule.installments) {
    const split = allocate({ currency, amountMinor: inst.amountMinor, weights: feeSplitWeights(j.services) })
    for (const a of split.allocations) {
      lines.push({ instalmentNumber: inst.number, month: inst.month, share: a.targetId, amountMinor: a.amountMinor })
    }
  }
  const linesTotal = lines.reduce((s, l) => s + l.amountMinor, 0n) + schedule.advanceMinor
  if (linesTotal !== toFeeMinor || schedule.totalMinor !== toFeeMinor) {
    // Allocations must recover the source amount exactly (contract 03 §6.9).
    throw new DomainError("blocked_by_rule", "Fee allocations do not total the fee", {
      rule: "allocation_total_mismatch",
      feeMinor: toFeeMinor.toString(),
      allocatedMinor: linesTotal.toString(),
    })
  }
  const jobAllocation = allocate({ currency, amountMinor: toFeeMinor, weights: [{ targetId: j.id, weight: 1n }] })

  // Only approved (or locked) hours are billable; draft, submitted and
  // rejected hours are reported, never counted.
  const exceptions: FeeException[] = []
  const sumMinutes = (states: string[]) => fin.timesheets.filter((t) => states.includes(t.state)).reduce((s, t) => s + t.minutes, 0)
  const unapproved = sumMinutes(["draft", "submitted"])
  const rejected = sumMinutes(["rejected"])
  if (unapproved) exceptions.push({ code: "unapproved_hours_excluded", detail: { minutes: unapproved } })
  if (rejected) exceptions.push({ code: "rejected_hours_never_billable", detail: { minutes: rejected } })
  const perPerson = new Map<string, number>()
  for (const t of fin.timesheets.filter((t) => t.state === "approved" || t.state === "locked")) {
    const k = t.userId ?? "unassigned"
    perPerson.set(k, (perPerson.get(k) ?? 0) + t.minutes)
  }
  const estimate = estimateTotals(fin, fin.currentEstimate?.id ?? null)
  let settlement: ReturnType<typeof hourlyFeeSettlement> | null = null
  if (estimate.laborMinutes > 0) {
    const covered = toHundredths(estimate.laborMinutes)
    settlement = hourlyFeeSettlement({
      currency,
      instalmentMinor: toFeeMinor,
      coveredHoursHundredths: covered < 1n ? 1n : covered,
      hours: [...perPerson.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([personId, minutes]) => ({ personId, approvedHoursHundredths: toHundredths(minutes), clientRateMinor: 0n })),
      overagePolicy: FEE_POLICY.overagePolicy,
    })
    if (settlement.overageHoursHundredths > 0n) {
      exceptions.push({ code: "overage_absorbed_fixed_fee", detail: { overageHoursHundredths: settlement.overageHoursHundredths } })
    }
  } else {
    exceptions.push({ code: "no_labor_estimate", detail: { note: "Hourly settlement needs a current cost estimate with labor." } })
  }
  return { contractKind: "fixed_fee" as const, schedule, lines, jobAllocation, settlement, exceptions }
}

export const proposeFeeAmendment = defineCommand({
  type: "budget.proposeFeeAmendment",
  skillId: "agency-fee-contracts",
  permission: "budget.propose",
  input: ProposeFeeAmendmentInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertRevision(j.revision, meta.expectedRevision, "job")
    const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
    // No approved budget yet: this fee is the job's initial fixed fee.
    if (!fin.approvedBudget) return proposeInitialBudget(tx, ctx, j, fin, input, meta)
    const currency = j.currency
    const toFee = amount(input.newAgencyFee, currency, "newAgencyFee")
    const fromFee = fin.approvedBudget.agencyFeeMinor
    if (toFee === fromFee) {
      throw new DomainError("validation", "The new fee equals the approved fee", { field: "newAgencyFee" })
    }
    const fee = computeFeeSchedule(fin, toFee)
    // A newer proposal supersedes pending ones for the same job.
    await invalidatePendingApprovals(tx, ctx.tenant.id, "job", j.id)

    const [last] = await tx
      .select({ number: budgetRevision.number })
      .from(budgetRevision)
      .where(and(eq(budgetRevision.tenantId, ctx.tenant.id), eq(budgetRevision.jobId, j.id)))
      .orderBy(desc(budgetRevision.number))
      .limit(1)
    const [draft] = await tx
      .insert(budgetRevision)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        number: (last?.number ?? 0) + 1,
        state: "submitted",
        agencyFeeMinor: toFee,
        managedMediaMinor: fin.approvedBudget.managedMediaMinor,
        currency,
        reason: input.reason,
        supersedesId: fin.approvedBudget.id,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning()
    await tx
      .update(feeSchedule)
      .set({ state: "superseded", updatedAt: new Date(), revision: sql`${feeSchedule.revision} + 1` })
      .where(and(eq(feeSchedule.tenantId, ctx.tenant.id), eq(feeSchedule.jobId, j.id), eq(feeSchedule.state, "proposed")))
    const [sched] = await tx
      .insert(feeSchedule)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        budgetRevisionId: draft!.id,
        state: "proposed",
        contractKind: fee.contractKind,
        totalMinor: toFee,
        currency,
        settlement: fee.settlement ? (toJsonSafe(fee.settlement) as object) : null,
        exceptions: toJsonSafe(fee.exceptions) as object,
        createdBy: ctx.user.id,
      })
      .returning()
    await tx.insert(feeScheduleLine).values(fee.lines.map((l) => ({ tenantId: ctx.tenant.id, scheduleId: sched!.id, currency, ...l })))

    const cost = estimateTotals(fin, fin.currentEstimate?.id ?? null).totalMinor
    const media = fin.approvedBudget.managedMediaMinor
    const before = margin({ currency, agencyRevenueMinor: fromFee, agencyCostMinor: cost, managedSpendMinor: media })
    const after = margin({ currency, agencyRevenueMinor: toFee, agencyCostMinor: cost, managedSpendMinor: media })
    const requiredAuthority = toFee + media
    const payload = {
      action: "budget.fee_amendment",
      jobId: j.id,
      jobRevision: j.revision,
      budgetRevisionId: draft!.id,
      budgetRevisionNumber: draft!.number,
      fromAgencyFeeMinor: fromFee,
      toAgencyFeeMinor: toFee,
      managedMediaMinor: media,
      requiredClientAuthorityMinor: requiredAuthority,
      currency,
      feeScheduleId: sched!.id,
      feeScheduleLines: fee.lines,
    }
    const proposal = await createProposal(
      tx,
      ctx,
      {
        actionType: "budget.fee_amendment",
        skillId: "agency-fee-contracts",
        aggregateType: "job",
        aggregateId: j.id,
        baseRevision: j.revision,
        payload,
        diff: {
          agencyFeeMinor: { before: fromFee, after: toFee },
          clientBillableMinor: { before: fromFee + media, after: requiredAuthority },
        },
        impact: {
          costMinor: cost,
          marginBefore: { minor: before.marginMinor, bps: before.marginBps },
          marginAfter: { minor: after.marginMinor, bps: after.marginBps },
          clientAuthority: {
            approvedMinor: fin.approvedAuthority?.amountMinor ?? 0n,
            requiredMinor: requiredAuthority,
            sufficient: (fin.approvedAuthority?.amountMinor ?? 0n) >= requiredAuthority,
          },
        },
        origin: meta.origin,
      },
      "awaiting_approval"
    )
    await tx.update(feeSchedule).set({ proposalId: proposal.id }).where(eq(feeSchedule.id, sched!.id))
    const eligibleRoles = ["finance_approver"] as const
    const { approval, events } = await requestApproval(tx, ctx, proposal, {
      policyId: FEE_AMENDMENT_POLICY.id,
      policyRevision: FEE_AMENDMENT_POLICY.revision,
      eligibleRoles,
      title: `Fee amendment ${j.displayReference}`,
      amountMinor: toFee - fromFee,
      currency,
      destination: `job:${j.jobNumber}`,
      expiresInHours: 24 * 14,
    })
    return {
      result: {
        proposalId: proposal.id,
        approvalId: approval.id,
        payloadDigest: proposal.payloadDigest,
        budgetRevisionId: draft!.id,
        marginBeforeBps: before.marginBps,
        marginAfterBps: after.marginBps,
        fee_contract_draft: {
          contractKind: fee.contractKind,
          budgetRevisionId: draft!.id,
          budgetRevisionNumber: draft!.number,
          feeScheduleId: sched!.id,
          fromAgencyFeeMinor: fromFee,
          toAgencyFeeMinor: toFee,
          currency,
          state: "pending_approval",
        },
        instalment_schedule: {
          advanceMinor: fee.schedule.advanceMinor,
          installments: fee.schedule.installments,
          lines: fee.lines,
          totalMinor: fee.schedule.totalMinor,
          currency,
        },
        job_allocation: fee.jobAllocation,
        hourly_settlement: fee.settlement ?? { applicable: false, reason: "no_labor_estimate" },
        approval_proposal: {
          proposalId: proposal.id,
          approvalId: approval.id,
          payloadDigest: proposal.payloadDigest,
          eligibleRoles,
          clientAuthoritySufficient: (fin.approvedAuthority?.amountMinor ?? 0n) >= requiredAuthority,
        },
        fee_exceptions: fee.exceptions,
      },
      events: [
        {
          eventType: "budget.fee_amendment.proposed",
          aggregateType: "job",
          aggregateId: j.id,
          aggregateRevision: j.revision,
          jobId: j.id,
          payload: { ...payload, proposalId: proposal.id, approvalId: approval.id },
        },
        ...events.map((e) => ({ ...e, jobId: j.id })),
      ],
    }
  },
})

export const INITIAL_BUDGET_POLICY = registerApprovalPolicy({ id: "initial-budget-v1", revision: 1 })

/**
 * Initial budget (fixture steps approve_initial_authority →
 * approve_estimate_and_plan): the fixed agency fee is the input; managed media
 * is the rest of the approved client authority (the PO covers fee + media
 * recovery); cost comes from the current estimate when there is one. Finance
 * approves it (requester ≠ approver) and the executor makes it the job's first
 * approved budget revision.
 */
async function proposeInitialBudget(
  tx: Tx,
  ctx: AgencyContext,
  j: typeof job.$inferSelect,
  fin: JobFinancials,
  input: z.infer<typeof ProposeFeeAmendmentInput>,
  meta: CommandMeta
) {
  const currency = j.currency
  const fee = amount(input.newAgencyFee, currency, "newAgencyFee")
  if (fee === 0n) throw new DomainError("validation", "The agency fee must be positive", { field: "newAgencyFee" })
  const auth = fin.approvedAuthority
  if (!auth) {
    throw new DomainError("blocked_by_rule", "An approved client PO must exist before the initial budget", { rule: "client_authority_required" })
  }
  if (auth.currency !== currency) throw new DomainError("blocked_by_rule", "The client PO is in another currency", { rule: "currency_mismatch" })
  if (auth.evidenceId) {
    const ev = await checkEvidence(tx, ctx.tenant.id, auth.evidenceId, { kind: "client_po", clientId: j.clientId, jobId: j.id })
    if (!ev.ok) throw new DomainError("blocked_by_rule", "The client PO evidence no longer supports the budget", { rule: ev.rule })
  }
  if (fee > auth.amountMinor) {
    throw new DomainError("blocked_by_rule", "The agency fee exceeds the client authority", {
      rule: "fee_exceeds_authority",
      authorityMinor: auth.amountMinor.toString(),
      feeMinor: fee.toString(),
      currency,
    })
  }
  const media = auth.amountMinor - fee
  const plans = await tx
    .select({ number: mediaPlanRevision.number, totalMinor: mediaPlanRevision.totalMinor })
    .from(mediaPlanRevision)
    .where(and(eq(mediaPlanRevision.tenantId, ctx.tenant.id), eq(mediaPlanRevision.jobId, j.id), eq(mediaPlanRevision.state, "approved")))
  const plan = plans.sort((a, b) => b.number - a.number)[0]
  if (plan && plan.totalMinor !== media) {
    throw new DomainError("blocked_by_rule", "The approved media plan does not match the media part of the client authority", {
      rule: "media_plan_mismatch",
      planMinor: plan.totalMinor.toString(),
      mediaMinor: media.toString(),
      currency,
    })
  }
  const fee_ = computeFeeSchedule(fin, fee)
  // A newer initial proposal replaces a pending one.
  await invalidatePendingApprovals(tx, ctx.tenant.id, "job", j.id, { actionTypes: ["budget.initial"] })
  const [last] = await tx
    .select({ number: budgetRevision.number })
    .from(budgetRevision)
    .where(and(eq(budgetRevision.tenantId, ctx.tenant.id), eq(budgetRevision.jobId, j.id)))
    .orderBy(desc(budgetRevision.number))
    .limit(1)
  const [draft] = await tx
    .insert(budgetRevision)
    .values({
      tenantId: ctx.tenant.id,
      jobId: j.id,
      number: (last?.number ?? 0) + 1,
      state: "submitted",
      agencyFeeMinor: fee,
      managedMediaMinor: media,
      currency,
      reason: input.reason,
      createdBy: ctx.user.id,
      updatedBy: ctx.user.id,
    })
    .returning()
  await tx
    .update(feeSchedule)
    .set({ state: "superseded", updatedAt: new Date(), revision: sql`${feeSchedule.revision} + 1` })
    .where(and(eq(feeSchedule.tenantId, ctx.tenant.id), eq(feeSchedule.jobId, j.id), eq(feeSchedule.state, "proposed")))
  const [sched] = await tx
    .insert(feeSchedule)
    .values({
      tenantId: ctx.tenant.id,
      jobId: j.id,
      budgetRevisionId: draft!.id,
      state: "proposed",
      contractKind: fee_.contractKind,
      totalMinor: fee,
      currency,
      settlement: fee_.settlement ? (toJsonSafe(fee_.settlement) as object) : null,
      exceptions: toJsonSafe(fee_.exceptions) as object,
      createdBy: ctx.user.id,
    })
    .returning()
  await tx.insert(feeScheduleLine).values(fee_.lines.map((l) => ({ tenantId: ctx.tenant.id, scheduleId: sched!.id, currency, ...l })))
  const cost = estimateTotals(fin, fin.currentEstimate?.id ?? null).totalMinor
  const after = margin({ currency, agencyRevenueMinor: fee, agencyCostMinor: cost, managedSpendMinor: media })
  const payload = {
    action: "budget.initial",
    jobId: j.id,
    jobRevision: j.revision,
    budgetRevisionId: draft!.id,
    budgetRevisionNumber: draft!.number,
    agencyFeeMinor: fee,
    managedMediaMinor: media,
    clientAuthorityMinor: auth.amountMinor,
    contractId: auth.id,
    currency,
    feeScheduleId: sched!.id,
    feeScheduleLines: fee_.lines,
  }
  const proposal = await createProposal(
    tx,
    ctx,
    {
      actionType: "budget.initial",
      skillId: "agency-fee-contracts",
      aggregateType: "job",
      aggregateId: j.id,
      baseRevision: j.revision,
      payload,
      diff: { agencyFeeMinor: { before: null, after: fee }, managedMediaMinor: { before: null, after: media } },
      impact: { costMinor: cost, marginAfter: { minor: after.marginMinor, bps: after.marginBps }, clientAuthority: { approvedMinor: auth.amountMinor, reference: auth.reference } },
      origin: meta.origin,
    },
    "awaiting_approval"
  )
  await tx.update(feeSchedule).set({ proposalId: proposal.id }).where(eq(feeSchedule.id, sched!.id))
  const eligibleRoles = ["finance_approver"] as const
  const { approval, events } = await requestApproval(tx, ctx, proposal, {
    policyId: INITIAL_BUDGET_POLICY.id,
    policyRevision: INITIAL_BUDGET_POLICY.revision,
    eligibleRoles,
    title: `Initial budget ${j.displayReference}`,
    amountMinor: fee + media,
    currency,
    destination: `job:${j.jobNumber}`,
    expiresInHours: 24 * 14,
  })
  return {
    result: {
      proposalId: proposal.id,
      approvalId: approval.id,
      payloadDigest: proposal.payloadDigest,
      budgetRevisionId: draft!.id,
      marginBeforeBps: null as number | null,
      marginAfterBps: after.marginBps,
      fee_contract_draft: {
        contractKind: fee_.contractKind,
        kind: "initial_budget",
        budgetRevisionId: draft!.id,
        budgetRevisionNumber: draft!.number,
        feeScheduleId: sched!.id,
        fromAgencyFeeMinor: null as bigint | null,
        toAgencyFeeMinor: fee,
        managedMediaMinor: media,
        clientAuthorityMinor: auth.amountMinor,
        currency,
        state: "pending_approval",
      },
      instalment_schedule: { advanceMinor: fee_.schedule.advanceMinor, installments: fee_.schedule.installments, lines: fee_.lines, totalMinor: fee_.schedule.totalMinor, currency },
      job_allocation: fee_.jobAllocation,
      hourly_settlement: fee_.settlement ?? { applicable: false, reason: "no_labor_estimate" },
      approval_proposal: { proposalId: proposal.id, approvalId: approval.id, payloadDigest: proposal.payloadDigest, eligibleRoles, clientAuthoritySufficient: true },
      fee_exceptions: fee_.exceptions,
    },
    events: [
      {
        eventType: "budget.initial.proposed",
        aggregateType: "job",
        aggregateId: j.id,
        aggregateRevision: j.revision,
        jobId: j.id,
        payload: { ...payload, proposalId: proposal.id, approvalId: approval.id },
      },
      ...events.map((e) => ({ ...e, jobId: j.id })),
    ] as EmittedEvent[],
  }
}

/** Executor of `budget.initial`: the proposed revision becomes the first approved budget. */
export async function applyInitialBudget(
  tx: Tx,
  ctx: AgencyContext,
  payload: { jobId: string; jobRevision: number; budgetRevisionId: string; agencyFeeMinor: string; managedMediaMinor: string; contractId: string; feeScheduleId: string },
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const j = await lockJob(tx, ctx.tenant.id, payload.jobId)
  if (j.revision !== payload.jobRevision) {
    return { ok: false, code: "approval_stale", details: { jobRevision: j.revision, approvedRevision: payload.jobRevision } }
  }
  const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
  if (fin.approvedBudget) return { ok: false, code: "approval_stale", details: { reason: "budget_already_approved" } }
  const required = BigInt(payload.agencyFeeMinor) + BigInt(payload.managedMediaMinor)
  const auth = fin.approvedAuthority
  if (!auth || auth.id !== payload.contractId || auth.amountMinor < required) {
    return { ok: false, code: "client_authority_missing", details: { requiredMinor: required.toString(), currency: j.currency } }
  }
  if (mode === "check") return { ok: true, events: [] }
  await tx
    .update(budgetRevision)
    .set({ state: "approved", approvedBy: ctx.user.id, approvedAt: new Date(), revision: sql`${budgetRevision.revision} + 1` })
    .where(and(eq(budgetRevision.tenantId, ctx.tenant.id), eq(budgetRevision.id, payload.budgetRevisionId)))
  await tx
    .update(feeSchedule)
    .set({ state: "approved", updatedAt: new Date(), revision: sql`${feeSchedule.revision} + 1` })
    .where(and(eq(feeSchedule.tenantId, ctx.tenant.id), eq(feeSchedule.id, payload.feeScheduleId)))
  const jobRevision = await bumpJobRevision(tx, ctx.tenant.id, j.id, ctx.user.id)
  const ruleEvents = await evaluateMarginFloor(tx, ctx.tenant.id, ctx.tenant.slug, j.id)
  return {
    ok: true,
    events: [
      {
        eventType: "budget.approved",
        aggregateType: "job",
        aggregateId: j.id,
        aggregateRevision: jobRevision,
        jobId: j.id,
        payload: { budgetRevisionId: payload.budgetRevisionId, agencyFeeMinor: payload.agencyFeeMinor, managedMediaMinor: payload.managedMediaMinor, initial: true },
      },
      ...ruleEvents,
    ],
  }
}

/** Applies an approved fee amendment (called by the approval executor). */
export async function applyFeeAmendment(
  tx: Tx,
  ctx: AgencyContext,
  payload: {
    jobId: string
    jobRevision: number
    budgetRevisionId: string
    toAgencyFeeMinor: string | bigint
    requiredClientAuthorityMinor: string | bigint
    feeScheduleId?: string
  },
  check: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: "client_authority_missing" | "approval_stale"; details: Record<string, unknown> }> {
  const j = await lockJob(tx, ctx.tenant.id, payload.jobId)
  if (j.revision !== payload.jobRevision) {
    return { ok: false, code: "approval_stale", details: { jobRevision: j.revision, approvedRevision: payload.jobRevision } }
  }
  const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
  const required = BigInt(payload.requiredClientAuthorityMinor)
  const authority = fin.approvedAuthority?.amountMinor ?? 0n
  if (authority < required) {
    return {
      ok: false,
      code: "client_authority_missing",
      details: { approvedAuthorityMinor: authority.toString(), requiredMinor: required.toString(), currency: j.currency },
    }
  }
  // The client's authority must still rest on reviewed, unchanged evidence.
  if (fin.approvedAuthority?.evidenceId) {
    const ev = await checkEvidence(tx, ctx.tenant.id, fin.approvedAuthority.evidenceId, {
      kind: "client_po",
      clientId: j.clientId,
      jobId: j.id,
    })
    if (!ev.ok) return { ok: false, code: "client_authority_missing", details: { rule: ev.rule, ...ev.details } }
  }
  if (check === "check") return { ok: true, events: [] }

  if (fin.approvedBudget) {
    await tx
      .update(budgetRevision)
      .set({ state: "superseded", revision: sql`${budgetRevision.revision} + 1` })
      .where(eq(budgetRevision.id, fin.approvedBudget.id))
  }
  await tx
    .update(budgetRevision)
    .set({
      state: "approved",
      approvedBy: ctx.user.id,
      approvedAt: new Date(),
      revision: sql`${budgetRevision.revision} + 1`,
    })
    .where(and(eq(budgetRevision.tenantId, ctx.tenant.id), eq(budgetRevision.id, payload.budgetRevisionId)))
  if (payload.feeScheduleId) {
    await tx
      .update(feeSchedule)
      .set({ state: "superseded", updatedAt: new Date(), revision: sql`${feeSchedule.revision} + 1` })
      .where(and(eq(feeSchedule.tenantId, ctx.tenant.id), eq(feeSchedule.jobId, j.id), eq(feeSchedule.state, "approved")))
    await tx
      .update(feeSchedule)
      .set({ state: "approved", updatedAt: new Date(), revision: sql`${feeSchedule.revision} + 1` })
      .where(and(eq(feeSchedule.tenantId, ctx.tenant.id), eq(feeSchedule.id, payload.feeScheduleId)))
  }
  const jobRevision = await bumpJobRevision(tx, ctx.tenant.id, j.id, ctx.user.id)
  const ruleEvents = await evaluateMarginFloor(tx, ctx.tenant.id, ctx.tenant.slug, j.id)
  return {
    ok: true,
    events: [
      {
        eventType: "budget.fee_amendment.applied",
        aggregateType: "job",
        aggregateId: j.id,
        aggregateRevision: jobRevision,
        jobId: j.id,
        payload: {
          budgetRevisionId: payload.budgetRevisionId,
          toAgencyFeeMinor: payload.toAgencyFeeMinor,
          clientAuthorityMinor: authority,
          feeScheduleId: payload.feeScheduleId ?? null,
        },
      },
      ...ruleEvents,
    ],
  }
}

// ── agency-contract-po: recordClientAuthority ──
export const RecordClientAuthorityInput = z
  .object({
    job: Uuid,
    reference: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9][A-Za-z0-9_.\-/]*$/, "Letters, digits, - _ . /"),
    amount: Decimal,
    // Omitted validity is inherited from the previous revision of the PO.
    validFrom: IsoDate.optional(),
    validTo: IsoDate.optional(),
    billingRoute: z.enum(["holder_client", "other_client"]).optional(),
    // Evidence record id (never a bare file id).
    evidenceId: Uuid,
  })
  .strict()

export const CLIENT_AUTHORITY_POLICY = registerApprovalPolicy({ id: "client-authority-v1", revision: 1 })

type ClientAuthorityPayload = {
  contractId: string
  contractRevision: number
  jobId: string
  clientId: string
  evidencePin: EvidencePin
}

export const recordClientAuthority = defineCommand({
  type: "contract.recordClientAuthority",
  skillId: "agency-contract-po",
  permission: "budget.propose",
  input: RecordClientAuthorityInput,
  handler: async (tx, ctx, input, meta: CommandMeta) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    if (j.state === "closed") throw new DomainError("blocked_by_rule", "The job is closed", { rule: "job_closed" })
    const currency = j.currency
    const amountMinor = amount(input.amount, currency, "amount")
    if (amountMinor === 0n) throw new DomainError("validation", "The authorized amount must be positive", { field: "amount" })
    const [last] = await tx
      .select()
      .from(contract)
      .where(and(eq(contract.tenantId, ctx.tenant.id), eq(contract.reference, input.reference)))
      .orderBy(desc(contract.revisionNumber))
      .limit(1)
    if (last && last.jobId !== j.id) {
      throw new DomainError("blocked_by_rule", "This PO number belongs to another job", { rule: "po_reference_in_use" })
    }
    if (last && last.state === "submitted") {
      throw new DomainError("blocked_by_rule", "A revision of this PO is already awaiting approval", { rule: "one_pending_revision" })
    }
    const validFrom = input.validFrom ?? last?.validFrom ?? null
    const validTo = input.validTo ?? last?.validTo ?? null
    if (validFrom && validTo && validTo < validFrom) throw new DomainError("validation", "Validity ends before it starts", { field: "validTo" })
    const businessDate = await getBusinessDate()
    if (validTo && validTo < businessDate) {
      throw new DomainError("blocked_by_rule", "An expired PO cannot authorize new commitments", {
        rule: "po_expired",
        validTo,
        businessDate,
      })
    }
    const billingRoute = input.billingRoute ?? "holder_client"
    if (billingRoute === "other_client") {
      // No billing-client field in this build: never invent one.
      throw new DomainError("blocked_by_rule", "Billing another client needs that client's identity first", {
        rule: "billing_client_required",
      })
    }
    // Evidence: same agency, kind client_po, linked to this client/job,
    // reviewed by someone other than its submitter, file unchanged (B06).
    const ev = await checkEvidence(tx, ctx.tenant.id, input.evidenceId, { kind: "client_po", clientId: j.clientId, jobId: j.id })
    if (!ev.ok) {
      throw new DomainError("blocked_by_rule", "The PO evidence cannot support client authority", { rule: ev.rule, ...ev.details })
    }
    const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
    const scope = budgetAvailability(fin).find((s) => s.scope === "client_commercial_authority")!
    const consumedMinor = scope.spentMinor + scope.openCommitmentsMinor + scope.reservationsMinor
    if (amountMinor < consumedMinor) {
      throw new DomainError("blocked_by_rule", "The new authority is below what is already reserved or committed", {
        rule: "authority_below_consumption",
        consumedMinor: consumedMinor.toString(),
        requestedMinor: amountMinor.toString(),
        currency,
      })
    }
    const [row] = await tx
      .insert(contract)
      .values({
        tenantId: ctx.tenant.id,
        clientId: j.clientId,
        jobId: j.id,
        kind: "client_po",
        reference: input.reference,
        revisionNumber: (last?.revisionNumber ?? 0) + 1,
        amountMinor,
        currency,
        state: "submitted",
        evidenceId: ev.pin.evidenceId,
        validFrom,
        validTo,
        supersedesId: last?.id ?? null,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning()
    const payload = {
      action: "contract.client_authority",
      contractId: row!.id,
      contractRevision: row!.revision,
      jobId: j.id,
      clientId: j.clientId,
      reference: input.reference,
      revisionNumber: row!.revisionNumber,
      amountMinor,
      currency,
      validFrom,
      validTo,
      billingRoute,
      evidencePin: ev.pin,
    }
    const proposal = await createProposal(
      tx,
      ctx,
      {
        actionType: "contract.client_authority",
        skillId: "agency-contract-po",
        aggregateType: "contract",
        aggregateId: row!.id,
        baseRevision: row!.revision,
        payload,
        diff: { amountMinor: { before: last?.amountMinor ?? 0n, after: amountMinor } },
        impact: {
          note: "Client commercial authority; distinct from internal approvals.",
          evidence: { evidenceId: ev.pin.evidenceId, fileSha256: ev.pin.fileSha256, fileVersion: ev.pin.fileVersion },
        },
        origin: meta.origin,
      },
      "awaiting_approval"
    )
    const eligibleRoles = ["owner", "finance_approver"] as const
    const { approval, events } = await requestApproval(tx, ctx, proposal, {
      policyId: CLIENT_AUTHORITY_POLICY.id,
      policyRevision: CLIENT_AUTHORITY_POLICY.revision,
      eligibleRoles,
      title: `Client authority ${input.reference} r${row!.revisionNumber}`,
      amountMinor,
      currency,
      destination: `client:${j.clientId}`,
    })
    return {
      result: {
        contractId: row!.id,
        proposalId: proposal.id,
        approvalId: approval.id,
        payloadDigest: proposal.payloadDigest,
        commercial_terms: {
          kind: "client_po",
          reference: input.reference,
          revisionNumber: row!.revisionNumber,
          amountMinor,
          currency,
          validFrom,
          validTo,
          state: row!.state,
        },
        po_limits: {
          scope: "client_commercial_authority",
          currentAuthorizedMinor: scope.authorizedMinor,
          proposedAuthorizedMinor: amountMinor,
          spentMinor: scope.spentMinor,
          openCommitmentsMinor: scope.openCommitmentsMinor,
          reservationsMinor: scope.reservationsMinor,
          availableAfterApprovalMinor: amountMinor - consumedMinor,
          currency,
        },
        po_link_decisions: [
          { jobId: j.id, contractId: row!.id, evidenceId: ev.pin.evidenceId, fileSha256: ev.pin.fileSha256, fileVersion: ev.pin.fileVersion, decision: "linked" },
        ],
        po_transfer_proposal: { applicable: false, reason: "no_transfer_requested" },
        reserve_setup: { scope: "client_commercial_authority", existingReservations: fin.reservations.filter((r) => r.budgetScope === "client_commercial_authority").length },
        billing_route: { route: billingRoute, billingClientId: j.clientId },
        scope_exceptions: [] as string[],
        approval: { approvalId: approval.id, eligibleRoles, state: approval.state },
      },
      events: [
        {
          eventType: "contract.client_authority.recorded",
          aggregateType: "contract",
          aggregateId: row!.id,
          aggregateRevision: row!.revision,
          jobId: j.id,
          payload,
        },
        ...events.map((e) => ({ ...e, jobId: j.id })),
      ],
    }
  },
})

/** Check/apply of an approved client authority: contract and evidence unchanged. */
export async function applyClientAuthority(
  tx: Tx,
  ctx: AgencyContext,
  payload: ClientAuthorityPayload,
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: "approval_stale"; details: Record<string, unknown> }> {
  const [c] = await tx
    .select()
    .from(contract)
    .where(and(eq(contract.tenantId, ctx.tenant.id), eq(contract.id, payload.contractId)))
    .for("update")
    .limit(1)
  if (!c || c.revision !== payload.contractRevision || c.state !== "submitted") {
    return { ok: false, code: "approval_stale", details: { contractId: payload.contractId, reason: "contract_changed" } }
  }
  if (!payload.evidencePin || c.evidenceId !== payload.evidencePin.evidenceId) {
    return { ok: false, code: "approval_stale", details: { contractId: c.id, rule: "evidence_missing" } }
  }
  const pin = await verifyEvidencePin(tx, ctx.tenant.id, payload.evidencePin, { clientId: c.clientId, jobId: payload.jobId })
  if (!pin.ok) return { ok: false, code: "approval_stale", details: { contractId: c.id, rule: pin.rule, ...pin.details } }
  if (mode === "check") return { ok: true, events: [] }
  if (c.supersedesId) {
    await tx
      .update(contract)
      .set({ state: "superseded", revision: sql`${contract.revision} + 1` })
      .where(and(eq(contract.tenantId, ctx.tenant.id), eq(contract.id, c.supersedesId)))
  }
  await tx
    .update(contract)
    .set({ state: "approved", approvedBy: ctx.user.id, approvedAt: new Date(), revision: sql`${contract.revision} + 1` })
    .where(eq(contract.id, c.id))
  return {
    ok: true,
    events: [
      {
        eventType: "contract.client_authority.approved",
        aggregateType: "contract",
        aggregateId: c.id,
        jobId: payload.jobId,
        payload: {
          amountMinor: c.amountMinor,
          currency: c.currency,
          reference: c.reference,
          revisionNumber: c.revisionNumber,
          evidenceId: payload.evidencePin.evidenceId,
          fileSha256: payload.evidencePin.fileSha256,
        },
      },
    ],
  }
}

// ── agency-budget-control: reserveBudget ──
export const ReserveBudgetInput = z
  .object({
    job: Uuid,
    budgetScope: z.enum(["client_commercial_authority", "managed_media_authority", "agency_cost_authority"]),
    amount: Decimal,
    purpose: z.string().trim().min(3).max(200),
  })
  .strict()

export const reserveBudget = defineCommand({
  type: "budget.reserve",
  skillId: "agency-budget-control",
  permission: "budget.propose",
  input: ReserveBudgetInput,
  handler: async (tx, ctx, input, meta) => {
    // Row lock on the job serializes concurrent reservations of the same
    // budget: of two requests that together exceed authority, one fails.
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    if (meta.expectedRevision !== undefined) assertRevision(j.revision, meta.expectedRevision, "job")
    const currency = j.currency
    const requested = amount(input.amount, currency, "amount")
    if (requested === 0n) throw new DomainError("validation", "Amount must be positive", { field: "amount" })
    const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
    const scope = budgetAvailability(fin).find((s) => s.scope === input.budgetScope)!
    const check = budgetCheck({
      currency,
      authorizedMinor: scope.authorizedMinor,
      spentMinor: scope.spentMinor,
      openCommitmentsMinor: scope.openCommitmentsMinor,
      reservationsMinor: scope.reservationsMinor,
      requestedMinor: requested,
    })
    if (!check.withinBudget) {
      throw new DomainError("blocked_by_rule", "Insufficient available budget", {
        rule: "budget_available",
        scope: input.budgetScope,
        availableMinor: check.availableMinor.toString(),
        requestedMinor: requested.toString(),
        currency,
      })
    }
    // Client credit applies to billable (client authority) reservations only.
    // Open receivables come from client billing; none are recorded for this
    // client in this build, so exposure = this client's open client-scope
    // reservations/commitments + the request.
    let creditCheck: Record<string, unknown> = { applicable: false, reason: "not_a_client_billable_scope" }
    if (input.budgetScope === "client_commercial_authority") {
      const [c] = await tx.select().from(client).where(and(eq(client.tenantId, ctx.tenant.id), eq(client.id, j.clientId))).limit(1)
      const open = await tx
        .select({ amountMinor: budgetReservation.amountMinor })
        .from(budgetReservation)
        .innerJoin(job, and(eq(job.tenantId, budgetReservation.tenantId), eq(job.id, budgetReservation.jobId)))
        .where(
          and(
            eq(budgetReservation.tenantId, ctx.tenant.id),
            eq(job.clientId, j.clientId),
            eq(budgetReservation.budgetScope, "client_commercial_authority"),
            inArray(budgetReservation.state, ["reserved", "committed"]),
            eq(budgetReservation.currency, currency)
          )
        )
      const exposure = creditExposure({
        currency,
        creditLimitMinor: c!.creditLimitMinor,
        arOpenMinor: 0n,
        approvedUnbilledMinor: open.reduce((s, r) => s + r.amountMinor, 0n),
        requestedMinor: requested,
      })
      creditCheck = { applicable: true, ...exposure, arOpenSource: "no_client_invoices_recorded" }
      if (!exposure.withinLimit) {
        throw new DomainError("blocked_by_rule", "The client's credit limit would be exceeded", {
          rule: "credit_limit_exceeded",
          creditLimitMinor: c!.creditLimitMinor.toString(),
          exposureAfterMinor: exposure.exposureAfterMinor.toString(),
          currency,
        })
      }
    }
    const [row] = await tx
      .insert(budgetReservation)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        budgetScope: input.budgetScope,
        amountMinor: requested,
        currency,
        state: "reserved",
        purpose: input.purpose,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning()
    return {
      result: {
        reservationId: row!.id,
        availableAfterMinor: check.afterRequestMinor.toString(),
        currency,
        budget_check: check,
        credit_check: creditCheck,
        reservation_proposal: { reservationId: row!.id, scope: input.budgetScope, amountMinor: requested, state: row!.state, purpose: input.purpose },
        balance_revision: {
          scope: input.budgetScope,
          valuationBasis: input.budgetScope === "managed_media_authority" ? "net_media_spend" : input.budgetScope === "agency_cost_authority" ? "internal_direct_cost" : "client_net_billing",
          authorizedMinor: scope.authorizedMinor,
          spentMinor: scope.spentMinor,
          openCommitmentsMinor: scope.openCommitmentsMinor,
          reservationsBeforeMinor: scope.reservationsMinor,
          reservationsAfterMinor: scope.reservationsMinor + requested,
          availableBeforeMinor: check.availableMinor,
          availableAfterMinor: check.afterRequestMinor,
          currency,
        },
        blocking_exceptions: [] as string[],
      },
      events: [
        {
          eventType: "budget.reserved",
          aggregateType: "job",
          aggregateId: j.id,
          jobId: j.id,
          payload: {
            reservationId: row!.id,
            scope: input.budgetScope,
            amountMinor: requested,
            availableBeforeMinor: check.availableMinor,
            availableAfterMinor: check.afterRequestMinor,
            currency,
          },
        },
      ],
    }
  },
})
