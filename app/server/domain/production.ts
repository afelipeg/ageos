import "server-only"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { margin } from "@/server/calculators"
import { estimateTotalsCalc } from "@/server/calculators/planning"
import type { Tx } from "@/server/db/client"
import { appUser, budgetReservation, costEstimateLine, delivery, fileObject, job, productionDeliverable, purchaseOrder, supplier, timesheet } from "@/server/db/schema"
import { defineCommand, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { lockJob, recordCostEstimate, RecordCostEstimateInput } from "./budget"
import { rightsFor } from "./campaigns"
import { acceptDeliveryTx } from "./media-buying"
import { Decimal, IsoDate, Uuid, assertJobOpen, blocked, none, parseMoney } from "./media-planning"
import { budgetAvailability, loadJobFinancials } from "./profitability"
import { valueOf } from "./timesheets"

// Production (M03, Core-2): versioned estimates (wrapping Core-1's
// recordCostEstimate), production purchase orders on the shared order
// backbone, and deliverable review (QA + rights → release, delivery accepted).

const OPEN_PRODUCTION_STATES = ["approved", "partially_delivered"]

async function productionOrdersOf(tx: Tx, tenantId: string, jobId: string) {
  return tx
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.tenantId, tenantId), eq(purchaseOrder.jobId, jobId), eq(purchaseOrder.kind, "production")))
    .orderBy(asc(purchaseOrder.createdAt))
}

// ── agency-production-estimating: createProductionEstimate ──
export const createProductionEstimate = defineCommand({
  type: "production.createEstimate",
  skillId: "agency-production-estimating",
  permission: "production.manage",
  input: RecordCostEstimateInput,
  handler: async (tx, ctx, input, meta) => {
    const [j0] = await tx.select().from(job).where(and(eq(job.tenantId, ctx.tenant.id), eq(job.id, input.job))).limit(1)
    if (!j0) throw new DomainError("not_found", "Job not found")
    assertJobOpen(j0)
    const hourly = parseMoney(input.hourlyCost, j0.currency, "hourlyCost")
    if (input.laborMinutes > 0 && hourly === 0n) {
      blocked("quote_incomplete", "A labor quantity needs an hourly cost before it can be approved", { field: "hourlyCost", laborMinutes: input.laborMinutes })
    }
    const before = await loadJobFinancials(tx, ctx.tenant.id, j0.id)
    const prevLines = before.estimateLines.filter((l) => l.estimateId === before.currentEstimate?.id)
    const { result, events } = await recordCostEstimate.handler(tx, ctx, input, meta)
    const prevProduction = prevLines.find((l) => l.lineType === "production")
    const lines = await tx.select().from(costEstimateLine).where(and(eq(costEstimateLine.tenantId, ctx.tenant.id), eq(costEstimateLine.estimateId, result.estimateId)))
    const kind = { labor: "internal", production: "direct", expense: "cost_rendering" } as const
    const calc = estimateTotalsCalc({
      agencyServiceBps: 0,
      agencyServiceDiscountBps: 0,
      lines: lines.map((l) => ({
        lineId: l.lineType,
        kind: kind[l.lineType as keyof typeof kind] ?? "indirect",
        currency: l.currency,
        unitPriceMinor: l.amountMinor,
        unitCostMinor: l.amountMinor,
        quantity: 1,
        days: 1,
        discountBps: 0,
        serviceEligible: false,
        supplierCommissionMode: "none",
        supplierCommissionValue: 0n,
      })),
    })
    const by = (xs: typeof lines, t: string) => xs.filter((l) => l.lineType === t).reduce((s, l) => s + l.amountMinor, 0n)
    const fin = await loadJobFinancials(tx, ctx.tenant.id, j0.id)
    const total = by(lines, "labor") + by(lines, "production") + by(lines, "expense")
    const fee = fin.approvedBudget?.agencyFeeMinor ?? 0n
    const m = margin({ currency: j0.currency, agencyRevenueMinor: fee, agencyCostMinor: total, managedSpendMinor: fin.approvedBudget?.managedMediaMinor ?? 0n })
    const prodLine = lines.find((l) => l.lineType === "production")
    const supplierIds = [prevProduction?.supplierId, prodLine?.supplierId].filter((x): x is string => !!x)
    const suppliers = supplierIds.length ? await tx.select({ id: supplier.id, name: supplier.name }).from(supplier).where(and(eq(supplier.tenantId, ctx.tenant.id), inArray(supplier.id, supplierIds))) : []
    const orders = await productionOrdersOf(tx, ctx.tenant.id, j0.id)
    const ordered = orders.filter((o) => o.state !== "cancelled" && o.state !== "draft").reduce((s, o) => s + o.amountMinor, 0n)
    const accepted = orders.length
      ? (await tx.select().from(delivery).where(and(eq(delivery.tenantId, ctx.tenant.id), inArray(delivery.orderId, orders.map((o) => o.id)), eq(delivery.state, "accepted")))).reduce((s, d) => s + d.acceptedMinor, 0n)
      : 0n
    const productionMinor = by(lines, "production")
    return {
      result: {
        ...result,
        estimate_draft: {
          estimateId: result.estimateId,
          number: result.number,
          state: "current",
          reason: input.reason,
          lines: lines.map((l) => ({ lineType: l.lineType, description: l.description, minutes: l.minutes, hourlyCostMinor: l.hourlyCostMinor?.toString() ?? null, amountMinor: l.amountMinor.toString(), supplierId: l.supplierId })),
        },
        estimate_totals: {
          currency: j0.currency,
          laborMinor: by(lines, "labor").toString(),
          productionMinor: productionMinor.toString(),
          expenseMinor: by(lines, "expense").toString(),
          totalMinor: total.toString(),
          calculator: calc.currencyTotals.map((t) => ({ currency: t.currency, costMinor: t.costMinor.toString(), saleMinor: t.saleMinor.toString() })),
          blockers: calc.blockers,
        },
        supplier_comparison: [
          {
            supplier: suppliers.find((s) => s.id === (prodLine?.supplierId ?? prevProduction?.supplierId))?.name ?? null,
            previousMinor: prevProduction?.amountMinor.toString() ?? null,
            currentMinor: productionMinor.toString(),
            deltaMinor: (productionMinor - (prevProduction?.amountMinor ?? 0n)).toString(),
          },
        ],
        client_approval_pack: {
          approvedAgencyFeeMinor: fee.toString(),
          estimateTotalMinor: total.toString(),
          marginMinor: m.marginMinor.toString(),
          marginBps: m.marginBps,
          clientAuthorityMinor: (fin.approvedAuthority?.amountMinor ?? 0n).toString(),
          staleApprovals: result.staleApprovals,
          note: "This estimate revision invalidates pending approvals of the job.",
        },
        purchase_order_drafts:
          prodLine && productionMinor > ordered
            ? [{ supplierId: prodLine.supplierId, amountMinor: (productionMinor - ordered).toString(), alreadyOrderedMinor: ordered.toString(), state: "proposed", command: "production.issueProductionOrder" }]
            : none(prodLine ? "The production line is fully ordered." : "The estimate has no production line."),
        post_buy_variance: [
          ...(["labor", "production", "expense"] as const).map((t) => ({ lineType: t, previousMinor: by(prevLines, t).toString(), currentMinor: by(lines, t).toString(), deltaMinor: (by(lines, t) - by(prevLines, t)).toString() })),
          { lineType: "production_accepted", previousMinor: null, currentMinor: accepted.toString(), deltaMinor: (accepted - productionMinor).toString() },
        ],
      },
      events,
    }
  },
})

// ── Production purchase order (order backbone, kind = production) ──
export const IssueProductionOrderInput = z
  .object({ job: Uuid, supplier: Uuid, amount: Decimal, deliverable: z.string().trim().min(2).max(160) })
  .strict()

export const issueProductionOrder = defineCommand({
  type: "production.issueProductionOrder",
  skillId: "agency-production",
  permission: "production.manage",
  input: IssueProductionOrderInput,
  handler: async (tx, ctx, input) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertJobOpen(j)
    const [s] = await tx.select().from(supplier).where(and(eq(supplier.tenantId, ctx.tenant.id), eq(supplier.id, input.supplier))).limit(1)
    if (!s) throw new DomainError("not_found", "Supplier not found", { field: "supplier" })
    const amountMinor = parseMoney(input.amount, j.currency, "amount", { positive: true })
    const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
    const estimated = fin.estimateLines.filter((l) => l.estimateId === fin.currentEstimate?.id && l.lineType === "production").reduce((t, l) => t + l.amountMinor, 0n)
    const orders = await productionOrdersOf(tx, ctx.tenant.id, j.id)
    const ordered = orders.filter((o) => o.state !== "cancelled" && o.state !== "draft").reduce((t, o) => t + o.amountMinor, 0n)
    if (ordered + amountMinor > estimated) {
      blocked("exceeds_production_estimate", "The order exceeds the production amount of the current estimate", { estimatedMinor: estimated.toString(), orderedMinor: ordered.toString(), requestedMinor: amountMinor.toString() })
    }
    const scope = budgetAvailability(fin).find((x) => x.scope === "agency_cost_authority")!
    if (scope.availableMinor < amountMinor) {
      blocked("budget_available", "Insufficient agency cost budget", { availableMinor: scope.availableMinor.toString(), requestedMinor: amountMinor.toString() })
    }
    const reference = `PO-${j.displayReference}-PRD-${String(orders.length + 1).padStart(2, "0")}`
    const [reservation] = await tx
      .insert(budgetReservation)
      .values({ tenantId: ctx.tenant.id, jobId: j.id, budgetScope: "agency_cost_authority", amountMinor, currency: j.currency, state: "committed", purpose: `production_order:${reference}`, createdBy: ctx.user.id, updatedBy: ctx.user.id })
      .returning()
    const [order] = await tx
      .insert(purchaseOrder)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        supplierId: s.id,
        kind: "production",
        reference,
        amountMinor,
        currency: j.currency,
        state: "approved",
        detail: { deliverable: input.deliverable, estimateId: fin.currentEstimate?.id ?? null, commitmentId: reservation!.id, submission: { channel: "offline_send_pack", state: "send_pack_ready" } },
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning()
    return {
      result: { orderId: order!.id, reference, state: order!.state, amountMinor: amountMinor.toString(), currency: j.currency, commitmentId: reservation!.id, availableAfterMinor: (scope.availableMinor - amountMinor).toString() },
      events: [
        {
          eventType: "production_order.issued",
          aggregateType: "purchase_order",
          aggregateId: order!.id,
          jobId: j.id,
          payload: { reference, supplierId: s.id, amountMinor, currency: j.currency, deliverable: input.deliverable, commitmentId: reservation!.id },
        },
      ],
    }
  },
})

// ── agency-production: reviewProductionDelivery ──
export const ReviewDeliveryInput = z
  .object({
    job: Uuid,
    deliverable: z.string().trim().min(2).max(160),
    deliveryDate: IsoDate,
    assetFile: Uuid,
    rightsCleared: z.boolean(),
    qualityResult: z.enum(["passed", "needs_rework", "failed"]),
    qcNotes: z.string().trim().max(1000).optional(),
  })
  .strict()

export const reviewProductionDelivery = defineCommand({
  type: "production.reviewDelivery",
  skillId: "agency-production",
  permission: "production.manage",
  input: ReviewDeliveryInput,
  handler: async (tx, ctx, input) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertJobOpen(j)
    const [file] = await tx.select().from(fileObject).where(and(eq(fileObject.tenantId, ctx.tenant.id), eq(fileObject.id, input.assetFile))).limit(1)
    if (!file) throw new DomainError("not_found", "Asset file not found", { field: "assetFile" })
    if (file.jobId && file.jobId !== j.id) blocked("asset_job_mismatch", "The asset belongs to another job", { fileJobId: file.jobId })
    const rights = await rightsFor(tx, ctx.tenant.id, file.id, input.deliveryDate)
    const findings = [
      { check: "quality", result: input.qualityResult, passed: input.qualityResult === "passed", notes: input.qcNotes ?? null },
      { check: "rights_attested", result: input.rightsCleared ? "cleared" : "not_cleared", passed: input.rightsCleared },
      { check: "rights_record", result: rights.state, passed: rights.state !== "expired", validTo: rights.state === "valid" ? rights.right.validTo : (rights.rights[0]?.validTo ?? null) },
    ]
    if (input.qualityResult !== "passed") blocked(input.qualityResult === "failed" ? "qa_failed" : "qa_needs_rework", "The version is held: quality check not passed", { findings })
    if (!input.rightsCleared) blocked("rights_not_cleared", "The version is held: usage rights are not cleared", { findings })
    if (rights.state === "expired") blocked("rights_expired", "The version is held: the usage right expired", { findings })

    const [last] = await tx
      .select({ version: productionDeliverable.version })
      .from(productionDeliverable)
      .where(and(eq(productionDeliverable.tenantId, ctx.tenant.id), eq(productionDeliverable.jobId, j.id), eq(productionDeliverable.name, input.deliverable)))
      .orderBy(desc(productionDeliverable.version))
      .limit(1)
    const version = (last?.version ?? 0) + 1
    const open = (await productionOrdersOf(tx, ctx.tenant.id, j.id)).find((o) => OPEN_PRODUCTION_STATES.includes(o.state)) ?? null
    let accepted: Awaited<ReturnType<typeof acceptDeliveryTx>> | null = null
    const events: EmittedEvent[] = []
    if (open) {
      const prior = await tx.select().from(delivery).where(and(eq(delivery.tenantId, ctx.tenant.id), eq(delivery.orderId, open.id), eq(delivery.state, "accepted")))
      const remaining = open.amountMinor - prior.reduce((s, d) => s + d.acceptedMinor, 0n)
      accepted = await acceptDeliveryTx(tx, ctx, { orderId: open.id, amountMinor: remaining, businessDate: input.deliveryDate, detail: { deliverable: input.deliverable, version, assetFileId: file.id, assetSha256: file.sha256 } })
      events.push(...accepted.events)
    }
    const [row] = await tx
      .insert(productionDeliverable)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        name: input.deliverable,
        version,
        assetFileId: file.id,
        deliveryDate: input.deliveryDate,
        qualityResult: input.qualityResult,
        qcNotes: input.qcNotes ?? null,
        rightsCleared: input.rightsCleared,
        rightsBasis: rights.state === "valid" ? "usage_right_record" : "attested_by_reviewer",
        state: "released",
        productionOrderId: open?.id ?? null,
        deliveryId: accepted?.delivery.id ?? null,
        findings,
        createdBy: ctx.user.id,
      })
      .returning()
    const deliverables = await tx.select().from(productionDeliverable).where(and(eq(productionDeliverable.tenantId, ctx.tenant.id), eq(productionDeliverable.jobId, j.id))).orderBy(asc(productionDeliverable.deliveryDate), asc(productionDeliverable.version))
    const staff = await tx
      .select({ name: appUser.displayName, minutes: timesheet.minutes, hourly: timesheet.hourlyCostMinor, state: timesheet.state })
      .from(timesheet)
      .innerJoin(appUser, eq(appUser.id, timesheet.userId))
      .where(and(eq(timesheet.tenantId, ctx.tenant.id), eq(timesheet.jobId, j.id)))
    const byPerson = new Map<string, { minutes: number; approvedValueMinor: bigint }>()
    for (const s of staff.filter((x) => x.state !== "rejected")) {
      const t = byPerson.get(s.name) ?? { minutes: 0, approvedValueMinor: 0n }
      t.minutes += s.minutes
      if (s.state === "approved" || s.state === "locked") t.approvedValueMinor += valueOf(s.minutes, s.hourly)
      byPerson.set(s.name, t)
    }
    events.unshift({
      eventType: "production.deliverable_released",
      aggregateType: "production_deliverable",
      aggregateId: row!.id,
      jobId: j.id,
      payload: { deliverable: input.deliverable, version, assetFileId: file.id, assetSha256: file.sha256, rightsBasis: row!.rightsBasis, productionOrderId: open?.id ?? null, deliveryId: accepted?.delivery.id ?? null },
      businessEffectiveAt: new Date(`${input.deliveryDate}T12:00:00Z`),
    })
    return {
      result: {
        deliverableId: row!.id,
        version,
        state: row!.state,
        production_schedule: deliverables.map((d) => ({ deliverable: d.name, version: d.version, deliveryDate: d.deliveryDate, state: d.state })),
        asset_manifest: [{ fileId: file.id, name: file.originalName, format: file.format, sha256: file.sha256, version: file.version, deliverableVersion: version, synthetic: file.synthetic }],
        qa_findings: findings,
        rights_check: { basis: row!.rightsBasis, record: rights.state, validTo: rights.state === "valid" ? rights.right.validTo : null, scope: rights.state === "valid" ? rights.right.scope : null },
        staff_assignment: byPerson.size
          ? [...byPerson.entries()].map(([name, v]) => ({ person: name, minutes: v.minutes, approvedValueMinor: v.approvedValueMinor.toString() }))
          : none("No hours are logged on this job yet."),
        release_candidates: [
          {
            deliverable: input.deliverable,
            version,
            state: "released",
            delivery: accepted
              ? { orderId: accepted.order.id, reference: accepted.order.reference, deliveryId: accepted.delivery.id, acceptedMinor: accepted.delivery.acceptedMinor.toString(), orderState: accepted.state, currency: accepted.order.currency }
              : null,
          },
        ],
      },
      events,
    }
  },
})

