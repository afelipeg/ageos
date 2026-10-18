import "server-only"

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import { executeAds, reconcileAds, requireActiveConnection } from "@/server/adapters/ads"
import { discountCascade } from "@/server/calculators/planning"
import { budgetCheck } from "@/server/calculators"
import type { Tx } from "@/server/db/client"
import { approvalRequest, budgetReservation, connection, delivery, purchaseOrder, rateCard, supplier } from "@/server/db/schema"
import { createProposal, digestOf, registerApprovalPolicy, requestApproval } from "@/server/kernel/approvals"
import { defineCommand, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { lockJob } from "./budget"
import { getBusinessDate } from "./presenter"
import {
  ACTIVE_ORDER_STATES,
  DIGITAL_PROVIDERS,
  Decimal,
  IsoDate,
  PLAN_APPROVERS,
  Uuid,
  approvedPlan,
  assertDates,
  assertJobOpen,
  blocked,
  committedByLineKey,
  none,
  parseMoney,
} from "./media-planning"
import { budgetAvailability, loadJobFinancials } from "./profitability"

// Media buying (M05, Core-2): rate agreements, media orders issued from the
// exact approved plan revision (order backbone `purchase_order`), commitments
// and accepted deliveries. Order → delivery → invoice → payment are stages of
// one cost: a commitment moves to consumed on accepted delivery, never doubles.

const MEDIUM_OF: Record<string, string> = { meta: "digital", google: "digital", tiktok: "digital", ctv: "digital", radio: "radio", ooh: "ooh" }

async function supplierOf(tx: Tx, tenantId: string, id: string) {
  const [s] = await tx.select().from(supplier).where(and(eq(supplier.tenantId, tenantId), eq(supplier.id, id))).limit(1)
  if (!s) throw new DomainError("not_found", "Supplier not found", { field: "supplier" })
  return s
}

// ── agency-rate-cards-contracts: saveRateCardAgreement ──
export const RateCardInput = z
  .object({
    supplier: Uuid,
    medium: z.enum(["digital", "tv", "radio", "ooh"]),
    validFrom: IsoDate,
    validTo: IsoDate,
    grossRate: Decimal,
    firstDiscountBps: z.number().int().min(0).max(10000).optional(),
    secondDiscountBps: z.number().int().min(0).max(10000).optional(),
  })
  .strict()

export const RATE_CARD_ACTION = "rate_card.approve"
export const RATE_CARD_POLICY = registerApprovalPolicy({ id: "rate-card-v1", revision: 1 })

export const saveRateCardAgreement = defineCommand({
  type: "media.saveRateCardAgreement",
  skillId: "agency-rate-cards-contracts",
  permission: "media.buy",
  input: RateCardInput,
  handler: async (tx, ctx, input, meta) => {
    const s = await supplierOf(tx, ctx.tenant.id, input.supplier)
    assertDates(input.validFrom, input.validTo, "validTo")
    const today = await getBusinessDate()
    if (input.validTo < today) {
      blocked("rate_card_expired", "An expired rate card cannot be approved to price orders", { validTo: input.validTo, asOf: today })
    }
    const gross = parseMoney(input.grossRate, s.currency, "grossRate", { positive: true })
    const discounts = [input.firstDiscountBps, input.secondDiscountBps].filter((d): d is number => d !== undefined)
    const priced = discountCascade({ currency: s.currency, grossMinor: gross, mode: "compound", discountsBps: discounts, surcharges: [], feeBase: "none", feeBps: 0, feeDiscountBps: 0 })
    const existing = await tx
      .select()
      .from(rateCard)
      .where(and(eq(rateCard.tenantId, ctx.tenant.id), eq(rateCard.supplierId, s.id), eq(rateCard.medium, input.medium)))
      .orderBy(desc(rateCard.number))
    const overlaps = existing.filter((c) => c.state === "approved" && c.validFrom <= input.validTo && c.validTo >= input.validFrom)
    const [card] = await tx
      .insert(rateCard)
      .values({
        tenantId: ctx.tenant.id,
        supplierId: s.id,
        medium: input.medium,
        number: (existing[0]?.number ?? 0) + 1,
        validFrom: input.validFrom,
        validTo: input.validTo,
        grossRateMinor: gross,
        discountsBps: discounts,
        netRateMinor: priced.netMinor,
        currency: s.currency,
        state: "submitted",
        createdBy: ctx.user.id,
      })
      .returning()
    const daysToExpiry = Math.round((Date.parse(`${input.validTo}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    const exceptions = [
      ...overlaps.map((c) => ({ code: "overlaps_approved_card", rateCardNumber: c.number, effect: "superseded_on_approval" })),
      ...(daysToExpiry <= 30 ? [{ code: "expires_soon", daysToExpiry }] : []),
    ]
    const ordered = await tx
      .select({ amountMinor: purchaseOrder.amountMinor, state: purchaseOrder.state })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.tenantId, ctx.tenant.id), eq(purchaseOrder.supplierId, s.id), eq(purchaseOrder.kind, "media")))
    const activeOrdersMinor = ordered.filter((o) => ACTIVE_ORDER_STATES.includes(o.state)).reduce((t, o) => t + o.amountMinor, 0n)
    const payload = {
      action: RATE_CARD_ACTION,
      rateCardId: card!.id,
      rateCardRevision: card!.revision,
      supplierId: s.id,
      medium: input.medium,
      number: card!.number,
      validFrom: input.validFrom,
      validTo: input.validTo,
      grossRateMinor: gross.toString(),
      discountsBps: discounts,
      netRateMinor: priced.netMinor.toString(),
      currency: s.currency,
    }
    const proposal = await createProposal(
      tx,
      ctx,
      {
        actionType: RATE_CARD_ACTION,
        skillId: "agency-rate-cards-contracts",
        aggregateType: "rate_card",
        aggregateId: card!.id,
        baseRevision: card!.revision,
        payload,
        diff: { netRateMinor: { before: overlaps[0]?.netRateMinor ?? null, after: priced.netMinor }, supersedes: overlaps.map((c) => c.number) },
        impact: { pricingExceptions: exceptions },
        origin: meta.origin,
      },
      "awaiting_approval"
    )
    const { approval, events } = await requestApproval(tx, ctx, proposal, {
      policyId: RATE_CARD_POLICY.id,
      policyRevision: RATE_CARD_POLICY.revision,
      eligibleRoles: PLAN_APPROVERS,
      title: `Rate card ${s.name} ${input.medium} r${card!.number}`,
      amountMinor: priced.netMinor,
      currency: s.currency,
      destination: `supplier:${s.name}`,
      expiresInHours: 24 * 14,
    })
    return {
      result: {
        rateCardId: card!.id,
        number: card!.number,
        state: card!.state,
        netRateMinor: priced.netMinor.toString(),
        currency: s.currency,
        proposalId: proposal.id,
        approvalId: approval.id,
        payloadDigest: proposal.payloadDigest,
        approval: { approvalId: approval.id, eligibleRoles: PLAN_APPROVERS, separationOfDuties: true },
        rate_card_drafts: [
          {
            rateCardId: card!.id,
            supplier: s.name,
            medium: input.medium,
            number: card!.number,
            validFrom: input.validFrom,
            validTo: input.validTo,
            grossRateMinor: gross.toString(),
            steps: priced.steps.map((st) => ({ discountBps: st.discountBps, amountMinor: st.amountMinor.toString(), runningMinor: st.runningMinor.toString() })),
            netRateMinor: priced.netMinor.toString(),
            rounding: priced.rounding,
            currency: s.currency,
          },
        ],
        contract_drafts: none("The agreement terms are the rate card itself; no separate contract document is drafted."),
        installment_schedules: none("The agreement has no committed volume to split into installments."),
        contract_balance_report: { supplierId: s.id, medium: input.medium, activeOrdersMinor: activeOrdersMinor.toString(), currency: s.currency, asOf: today },
        adjustment_transfer_proposals: none("No balance transfer applies to a new agreement."),
        pricing_exceptions: exceptions.length ? exceptions : none("No overlaps and no expiry within 30 days."),
      },
      events: [
        {
          eventType: "rate_card.submitted",
          aggregateType: "rate_card",
          aggregateId: card!.id,
          aggregateRevision: card!.revision,
          payload: { supplierId: s.id, medium: input.medium, number: card!.number, grossRateMinor: gross, netRateMinor: priced.netMinor, discountsBps: discounts, validFrom: input.validFrom, validTo: input.validTo, approvalId: approval.id },
        },
        ...events,
      ] as EmittedEvent[],
    }
  },
})

/** Approval executor for `rate_card.approve`: supersedes overlapping approved cards. */
export async function applyRateCardApproval(
  tx: Tx,
  ctx: AgencyContext,
  raw: Record<string, unknown>,
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const p = raw as { rateCardId: string; rateCardRevision: number }
  const [card] = await tx
    .select()
    .from(rateCard)
    .where(and(eq(rateCard.tenantId, ctx.tenant.id), eq(rateCard.id, p.rateCardId)))
    .for("update")
    .limit(1)
  if (!card || card.state !== "submitted" || card.revision !== p.rateCardRevision) {
    return { ok: false, code: "approval_stale", details: { rateCardId: p.rateCardId, state: card?.state ?? null } }
  }
  const today = await getBusinessDate()
  if (card.validTo < today) return { ok: false, code: "rate_card_expired", details: { validTo: card.validTo, asOf: today } }
  if (mode === "check") return { ok: true, events: [] }
  const superseded = await tx
    .update(rateCard)
    .set({ state: "superseded", revision: sql`${rateCard.revision} + 1` })
    .where(
      and(
        eq(rateCard.tenantId, ctx.tenant.id),
        eq(rateCard.supplierId, card.supplierId),
        eq(rateCard.medium, card.medium),
        eq(rateCard.state, "approved"),
        sql`${rateCard.validFrom} <= ${card.validTo} and ${rateCard.validTo} >= ${card.validFrom}`
      )
    )
    .returning({ number: rateCard.number })
  const [updated] = await tx
    .update(rateCard)
    .set({ state: "approved", approvedBy: ctx.user.id, approvedAt: new Date(), revision: sql`${rateCard.revision} + 1` })
    .where(eq(rateCard.id, card.id))
    .returning()
  return {
    ok: true,
    events: [
      {
        eventType: "rate_card.approved",
        aggregateType: "rate_card",
        aggregateId: card.id,
        aggregateRevision: updated!.revision,
        payload: { number: card.number, supersededNumbers: superseded.map((r) => r.number) },
      },
    ],
  }
}

/**
 * Reject hook of `rate_card.approve` (runs inside the kernel decision): the
 * card becomes rejected with the reason. Idempotent: a no-op once the card is
 * no longer the submitted revision that was proposed.
 */
export async function rejectRateCard(tx: Tx, ctx: AgencyContext, raw: Record<string, unknown>, reason: string): Promise<{ events: EmittedEvent[] }> {
  const p = raw as { rateCardId: string; rateCardRevision: number }
  const [card] = await tx
    .select()
    .from(rateCard)
    .where(and(eq(rateCard.tenantId, ctx.tenant.id), eq(rateCard.id, p.rateCardId)))
    .for("update")
    .limit(1)
  if (!card || card.state !== "submitted" || card.revision !== p.rateCardRevision) return { events: [] }
  const [u] = await tx
    .update(rateCard)
    .set({ state: "rejected", decisionReason: reason, revision: sql`${rateCard.revision} + 1` })
    .where(eq(rateCard.id, card.id))
    .returning()
  return {
    events: [{ eventType: "rate_card.rejected", aggregateType: "rate_card", aggregateId: card.id, aggregateRevision: u!.revision, payload: { number: card.number, reason } }],
  }
}

/**
 * Thin wrapper: decide the pending rate-card approval from the rate card view
 * through the kernel decision (eligibility, SoD, digest, stale checks, reject
 * hook). An approval reason is also kept on the card.
 */
export const DecideRateCardInput = z
  .object({
    rateCard: Uuid,
    revision: z.number().int().min(1),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict()

export const decideRateCard = defineCommand({
  type: "media.decideRateCard",
  skillId: "agency-rate-cards-contracts",
  permission: "approvals.decide",
  input: DecideRateCardInput,
  handler: async (tx, ctx, input, meta) => {
    const [card] = await tx
      .select()
      .from(rateCard)
      .where(and(eq(rateCard.tenantId, ctx.tenant.id), eq(rateCard.id, input.rateCard)))
      .for("update")
      .limit(1)
    if (!card) throw new DomainError("not_found", "Rate card not found")
    if (card.revision !== input.revision) {
      throw new DomainError("revision_conflict", "This rate card changed", { expectedRevision: input.revision, currentRevision: card.revision })
    }
    if (card.state !== "submitted") blocked("rate_card_not_pending", "The rate card is not awaiting a decision", { state: card.state })
    const [approval] = await tx
      .select()
      .from(approvalRequest)
      .where(
        and(
          eq(approvalRequest.tenantId, ctx.tenant.id),
          eq(approvalRequest.aggregateType, "rate_card"),
          eq(approvalRequest.aggregateId, card.id),
          eq(approvalRequest.actionType, RATE_CARD_ACTION),
          eq(approvalRequest.state, "awaiting_approval")
        )
      )
      .orderBy(desc(approvalRequest.createdAt))
      .limit(1)
    if (!approval) blocked("approval_not_pending", "The rate card has no pending approval", { rateCardId: card.id })
    const { decideApprovalCommand } = await import("./approvals")
    const decided = await decideApprovalCommand.handler(
      tx,
      ctx,
      { approvalId: approval.id, decision: input.decision, reason: input.reason ?? null, reviewedDigest: approval.payloadDigest },
      meta
    )
    const events: EmittedEvent[] = [...decided.events]
    if (decided.result.executed && input.reason) {
      await tx.update(rateCard).set({ decisionReason: input.reason }).where(eq(rateCard.id, card.id))
    }
    const [now] = await tx.select().from(rateCard).where(eq(rateCard.id, card.id))
    return {
      result: { rateCardId: card.id, approvalId: approval.id, outcome: decided.result.outcome, executed: decided.result.executed, blockedCode: decided.result.blockedCode, state: now!.state, revision: now!.revision },
      events,
    }
  },
})

/** Approved rate cards of a supplier/medium and the one valid for a flight. */
export async function rateBasis(tx: Tx, tenantId: string, supplierId: string, medium: string, start: string, end: string) {
  const cards = await tx
    .select()
    .from(rateCard)
    .where(and(eq(rateCard.tenantId, tenantId), eq(rateCard.supplierId, supplierId), eq(rateCard.medium, medium), inArray(rateCard.state, ["approved", "superseded"])))
    .orderBy(desc(rateCard.number))
  const approved = cards.filter((c) => c.state === "approved")
  const valid = approved.find((c) => c.validFrom <= start && c.validTo >= end) ?? null
  return { cards, approved, valid }
}

// ── agency-media-buying: issueMediaOrder ──
export const IssueMediaOrderInput = z
  .object({
    job: Uuid,
    supplier: Uuid,
    channel: z.enum(["meta", "google", "tiktok", "ctv", "radio", "ooh"]),
    planRevision: z.number().int().min(1).max(99),
    orderAmount: Decimal,
    poNumber: z.string().trim().min(2).max(60).optional(),
    connection: Uuid.optional(),
  })
  .strict()

export const MEDIA_ORDER_ACTION = "media_order.issue"
export const MEDIA_ORDER_POLICY = registerApprovalPolicy({ id: "media-order-v1", revision: 1 })

export const issueMediaOrder = defineCommand({
  type: "media.issueMediaOrder",
  skillId: "agency-media-buying",
  permission: "media.buy",
  input: IssueMediaOrderInput,
  handler: async (tx, ctx, input, meta) => {
    const j = await lockJob(tx, ctx.tenant.id, input.job)
    assertJobOpen(j)
    const plan = await approvedPlan(tx, ctx.tenant.id, j.id)
    const rev = plan.revisions.find((r) => r.number === input.planRevision)
    if (!rev || rev.state !== "approved") {
      blocked("plan_revision_not_approved", "Orders are issued only from the current approved plan revision", {
        planRevision: input.planRevision,
        state: rev?.state ?? null,
        currentApprovedRevision: plan.revision?.number ?? null,
      })
    }
    const line = plan.lines.find((l) => l.channel === input.channel)
    if (!line) blocked("plan_line_not_found", `The approved plan has no ${input.channel} line`, { channel: input.channel })
    const s = await supplierOf(tx, ctx.tenant.id, input.supplier)
    const currency = j.currency
    const amountMinor = parseMoney(input.orderAmount, currency, "orderAmount", { positive: true })
    const exceptions: Record<string, unknown>[] = []

    const digital = DIGITAL_PROVIDERS.has(line.provider)
    let conn: typeof connection.$inferSelect | null = null
    if (digital) {
      const sp = (s.externalIds as { provider?: string }).provider
      if (sp !== line.provider) blocked("supplier_provider_mismatch", "The supplier is not the plan line's provider", { lineProvider: line.provider, supplierProvider: sp ?? null })
      if (!input.connection) throw new DomainError("validation", "A digital line needs its ad account", { field: "connection" })
      const { connection: c, check } = await requireActiveConnection(tx, ctx.tenant.id, input.connection)
      if (c.provider !== line.provider || c.accountAlias !== line.accountAlias) {
        blocked("account_mismatch", "The ad account differs from the approved plan line", {
          approvedAccount: line.accountAlias,
          approvedProvider: line.provider,
          requestedAccount: c.accountAlias,
          requestedProvider: c.provider,
        })
      }
      if (!check.active) throw new DomainError("connection_revoked", "The simulated connection is revoked or missing scopes", { ...check })
      conn = c
    } else if (input.connection) {
      throw new DomainError("validation", "Offline lines are not sent through an ad account", { field: "connection" })
    }

    const basis = await rateBasis(tx, ctx.tenant.id, s.id, MEDIUM_OF[input.channel]!, line.startDate, line.endDate)
    if (basis.approved.length && !basis.valid) {
      blocked("rate_card_expired", "The supplier's rate card is not valid for the line flight", {
        cards: basis.approved.map((c) => ({ number: c.number, validFrom: c.validFrom, validTo: c.validTo })),
        flight: { start: line.startDate, end: line.endDate },
      })
    }
    if (!basis.cards.length) exceptions.push({ code: "no_rate_card", note: "Priced from the approved plan line." })

    const { committed } = await committedByLineKey(tx, ctx.tenant.id, j.id)
    const lineCommitted = committed.get(line.lineKey) ?? 0n
    if (lineCommitted + amountMinor > line.amountMinor) {
      blocked("exceeds_plan_line", "The order exceeds the uncommitted amount of the approved line", {
        lineMinor: line.amountMinor.toString(),
        committedMinor: lineCommitted.toString(),
        requestedMinor: amountMinor.toString(),
        currency,
      })
    }
    const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
    const scope = budgetAvailability(fin).find((x) => x.scope === "managed_media_authority")!
    const check = budgetCheck({ currency, authorizedMinor: scope.authorizedMinor, spentMinor: scope.spentMinor, openCommitmentsMinor: scope.openCommitmentsMinor, reservationsMinor: scope.reservationsMinor, requestedMinor: amountMinor })
    if (!check.withinBudget) {
      blocked("budget_available", "Insufficient managed media budget", { availableMinor: check.availableMinor.toString(), requestedMinor: amountMinor.toString(), currency })
    }
    if (input.poNumber && input.poNumber !== fin.approvedAuthority?.reference) {
      blocked("client_po_mismatch", "The client PO number does not match the approved client authority", { poNumber: input.poNumber, approvedReference: fin.approvedAuthority?.reference ?? null })
    }

    const seq = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.tenantId, ctx.tenant.id), eq(purchaseOrder.jobId, j.id), eq(purchaseOrder.kind, "media")))
    const reference = `MO-${j.displayReference}-${line.lineKey.replace(/^line_/, "").toUpperCase()}-${String((seq[0]?.n ?? 0) + 1).padStart(2, "0")}`
    const actionId = crypto.randomUUID()
    const [order] = await tx
      .insert(purchaseOrder)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        supplierId: s.id,
        kind: "media",
        reference,
        planLineId: line.id,
        planRevisionNumber: String(rev.number),
        provider: line.provider,
        accountAlias: line.accountAlias,
        amountMinor,
        currency,
        state: "draft",
        detail: { actionId, lineKey: line.lineKey, channel: line.channel, placement: line.placement, rateCardId: basis.valid?.id ?? null, connectionId: conn?.id ?? null, poNumber: input.poNumber ?? null, simulation: true },
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning()
    const payload = {
      action: MEDIA_ORDER_ACTION,
      actionId,
      jobId: j.id,
      jobRevision: j.revision,
      orderId: order!.id,
      orderRevision: order!.revision,
      reference,
      planRevisionId: rev.id,
      planRevisionNumber: rev.number,
      planLineId: line.id,
      lineKey: line.lineKey,
      supplierId: s.id,
      provider: line.provider,
      accountAlias: line.accountAlias,
      connectionId: conn?.id ?? null,
      amountMinor: amountMinor.toString(),
      currency,
      poNumber: input.poNumber ?? null,
    }
    const proposal = await createProposal(
      tx,
      ctx,
      {
        actionType: MEDIA_ORDER_ACTION,
        skillId: "agency-media-buying",
        aggregateType: "job",
        aggregateId: j.id,
        baseRevision: j.revision,
        payload,
        diff: { managedMediaCommitmentsMinor: { before: scope.openCommitmentsMinor, after: scope.openCommitmentsMinor + amountMinor } },
        impact: { availableBeforeMinor: check.availableMinor, availableAfterMinor: check.afterRequestMinor, lineCommittedAfterMinor: lineCommitted + amountMinor, simulation: digital ? "simulated_provider_submit" : "offline_send_pack" },
        origin: meta.origin,
      },
      "awaiting_approval"
    )
    const { approval, events } = await requestApproval(tx, ctx, proposal, {
      policyId: MEDIA_ORDER_POLICY.id,
      policyRevision: MEDIA_ORDER_POLICY.revision,
      eligibleRoles: PLAN_APPROVERS,
      title: `Media order ${reference}`,
      amountMinor,
      currency,
      destination: digital ? `${line.provider}:${line.accountAlias}` : `supplier:${s.name}`,
      expiresInHours: 24 * 14,
    })
    const orderView = { orderId: order!.id, reference, state: order!.state, revision: order!.revision, lineKey: line.lineKey, planRevisionNumber: rev.number, supplier: s.name, amountMinor: amountMinor.toString(), currency }
    return {
      result: {
        orderId: order!.id,
        reference,
        proposalId: proposal.id,
        approvalId: approval.id,
        payloadDigest: proposal.payloadDigest,
        order_drafts: [orderView],
        order_versions: [{ orderId: order!.id, revision: order!.revision, state: order!.state, planRevisionNumber: rev.number }],
        send_packs: [
          digital
            ? { channel: "simulated_provider", provider: line.provider, accountAlias: line.accountAlias, simulatedAccount: true, payloadDigest: proposal.payloadDigest, sendsAfter: "approval" }
            : { channel: "offline_send_pack", supplier: s.name, payloadDigest: proposal.payloadDigest, sendsAfter: "approval" },
        ],
        close_reopen_proposals: none("A new order has nothing to close or reopen."),
        commitment_updates: [{ scope: "managed_media_authority", amountMinor: amountMinor.toString(), state: "pending_approval", availableAfterMinor: check.afterRequestMinor.toString(), currency }],
        supplier_exceptions: exceptions.length ? exceptions : none("No supplier pricing exceptions."),
      },
      events: [
        {
          eventType: "media_order.drafted",
          aggregateType: "purchase_order",
          aggregateId: order!.id,
          aggregateRevision: order!.revision,
          jobId: j.id,
          payload: { ...payload, proposalId: proposal.id, approvalId: approval.id },
        },
        ...events.map((e) => ({ ...e, jobId: j.id })),
      ] as EmittedEvent[],
    }
  },
})

type OrderPayload = {
  actionId: string
  jobId: string
  jobRevision: number
  orderId: string
  orderRevision: number
  reference: string
  planRevisionId: string
  lineKey: string
  provider: string
  accountAlias: string | null
  connectionId: string | null
  amountMinor: string
  currency: string
  planRevisionNumber: number
}

/** Approval executor for `media_order.issue`. */
export async function applyMediaOrder(
  tx: Tx,
  ctx: AgencyContext,
  raw: Record<string, unknown>,
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const p = raw as unknown as OrderPayload
  const j = await lockJob(tx, ctx.tenant.id, p.jobId)
  const [order] = await tx
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.tenantId, ctx.tenant.id), eq(purchaseOrder.id, p.orderId)))
    .for("update")
    .limit(1)
  if (!order || order.state !== "draft" || order.revision !== p.orderRevision) {
    return { ok: false, code: "approval_stale", details: { orderId: p.orderId, state: order?.state ?? null } }
  }
  const plan = await approvedPlan(tx, ctx.tenant.id, j.id)
  if (plan.revision?.id !== p.planRevisionId) {
    return { ok: false, code: "approval_stale", details: { reason: "plan_revision_changed", approvedPlanRevision: p.planRevisionNumber, currentApprovedRevision: plan.revision?.number ?? null } }
  }
  const line = plan.lines.find((l) => l.lineKey === p.lineKey)
  const amount = BigInt(p.amountMinor)
  const { committed } = await committedByLineKey(tx, ctx.tenant.id, j.id)
  if (!line || (committed.get(p.lineKey) ?? 0n) + amount > line.amountMinor) {
    return { ok: false, code: "exceeds_plan_line", details: { lineKey: p.lineKey } }
  }
  const fin = await loadJobFinancials(tx, ctx.tenant.id, j.id)
  const scope = budgetAvailability(fin).find((x) => x.scope === "managed_media_authority")!
  if (scope.availableMinor < amount) return { ok: false, code: "budget_available", details: { availableMinor: scope.availableMinor.toString() } }
  let conn: typeof connection.$inferSelect | null = null
  if (p.connectionId) {
    const { connection: c, check } = await requireActiveConnection(tx, ctx.tenant.id, p.connectionId)
    if (c.provider !== p.provider || c.accountAlias !== p.accountAlias) return { ok: false, code: "approval_stale", details: { reason: "account_changed" } }
    if (!check.active) return { ok: false, code: "connection_revoked", details: { ...check } }
    conn = c
  }
  if (mode === "check") return { ok: true, events: [] }

  const [approval] = await tx
    .select({ id: approvalRequest.id })
    .from(approvalRequest)
    .where(and(eq(approvalRequest.tenantId, ctx.tenant.id), eq(approvalRequest.payloadDigest, digestOf(raw)), eq(approvalRequest.actionType, MEDIA_ORDER_ACTION)))
    .orderBy(desc(approvalRequest.createdAt))
    .limit(1)
  const [reservation] = await tx
    .insert(budgetReservation)
    .values({ tenantId: ctx.tenant.id, jobId: j.id, budgetScope: "managed_media_authority", amountMinor: amount, currency: p.currency, state: "committed", purpose: `media_order:${p.reference}`, createdBy: ctx.user.id, updatedBy: ctx.user.id })
    .returning()
  const events: EmittedEvent[] = [
    {
      eventType: "media_order.issued",
      aggregateType: "purchase_order",
      aggregateId: order.id,
      jobId: j.id,
      payload: { reference: p.reference, amountMinor: amount, currency: p.currency, planRevisionNumber: p.planRevisionNumber, lineKey: p.lineKey, commitmentId: reservation!.id, approvalId: approval?.id ?? null },
    },
  ]
  let state = "approved"
  let submission: Record<string, unknown> = { channel: "offline_send_pack", state: "send_pack_ready" }
  let receiptId: string | null = null
  let operationId: string | null = null
  if (conn) {
    const res = await executeAds(tx, {
      tenantId: ctx.tenant.id,
      connection: conn,
      operationType: "media_order.submit",
      approvedActionId: p.actionId,
      payload: { reference: p.reference, lineKey: p.lineKey, amountMinor: p.amountMinor, currency: p.currency, planRevisionNumber: p.planRevisionNumber },
    })
    operationId = res.operationId
    if (res.state === "succeeded") {
      state = "acknowledged"
      receiptId = res.receiptId
      submission = { channel: "simulated_provider", state: "simulated_acknowledged", receiptId, failureMode: res.failureMode }
    } else if (res.state === "outcome_unknown") {
      submission = { channel: "simulated_provider", state: "outcome_unknown", failureMode: res.failureMode, next: "reconcile" }
    } else {
      submission = { channel: "simulated_provider", state: "failed", error: res.error, connectionRevoked: res.connectionRevoked, failureMode: res.failureMode }
    }
    events.push({
      eventType: `media_order.submission_${submission.state as string}`,
      aggregateType: "purchase_order",
      aggregateId: order.id,
      jobId: j.id,
      payload: { reference: p.reference, operationId, receiptId, simulation: true, ...submission },
    })
  }
  await tx
    .update(purchaseOrder)
    .set({
      state,
      approvalId: approval?.id ?? null,
      adapterOperationId: operationId,
      receiptId,
      detail: { ...(order.detail as object), commitmentId: reservation!.id, submission },
      updatedBy: ctx.user.id,
      updatedAt: new Date(),
      revision: sql`${purchaseOrder.revision} + 1`,
    })
    .where(eq(purchaseOrder.id, order.id))
  return { ok: true, events }
}

// ── Reconcile an uncertain simulated submission (outcome_unknown) ──
export const ReconcileOrderInput = z.object({ order: Uuid }).strict()

export const reconcileMediaOrderSubmission = defineCommand({
  type: "media.reconcileMediaOrderSubmission",
  skillId: "agency-media-buying",
  permission: "media.buy",
  input: ReconcileOrderInput,
  handler: async (tx, ctx, input) => {
    const [order] = await tx
      .select()
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.tenantId, ctx.tenant.id), eq(purchaseOrder.id, input.order)))
      .for("update")
      .limit(1)
    if (!order) throw new DomainError("not_found", "Order not found")
    const submission = (order.detail as { submission?: { state?: string } }).submission
    if (!order.adapterOperationId || submission?.state !== "outcome_unknown") {
      blocked("nothing_to_reconcile", "The order has no uncertain submission", { state: submission?.state ?? null })
    }
    const res = await reconcileAds(tx, ctx.tenant.id, order.adapterOperationId)
    const next = res.state === "succeeded" ? { state: "acknowledged", receiptId: res.receiptId } : { state: order.state, receiptId: null }
    const sub = res.state === "succeeded" ? { channel: "simulated_provider", state: "simulated_acknowledged", receiptId: res.receiptId, reconciled: true } : { channel: "simulated_provider", state: "failed", error: "no_effect_confirmed", reconciled: true }
    await tx
      .update(purchaseOrder)
      .set({ state: next.state, receiptId: next.receiptId, detail: { ...(order.detail as object), submission: sub }, updatedAt: new Date(), updatedBy: ctx.user.id, revision: sql`${purchaseOrder.revision} + 1` })
      .where(eq(purchaseOrder.id, order.id))
    return {
      result: { orderId: order.id, outcome: res.state, receiptId: res.receiptId, effectCount: res.effectCount, simulation: true },
      events: [{ eventType: "media_order.submission_reconciled", aggregateType: "purchase_order", aggregateId: order.id, jobId: order.jobId, payload: { outcome: res.state, receiptId: res.receiptId, effectCount: res.effectCount } }],
    }
  },
})

// ── Accepted delivery against an order (consumes its commitment) ──
const DELIVERABLE_STATES = ["approved", "submitted", "acknowledged", "partially_delivered"]

export async function acceptDeliveryTx(
  tx: Tx,
  ctx: AgencyContext,
  args: { orderId: string; amountMinor: bigint; businessDate: string; evidenceId?: string | null; detail?: Record<string, unknown> }
) {
  const [order] = await tx
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.tenantId, ctx.tenant.id), eq(purchaseOrder.id, args.orderId)))
    .for("update")
    .limit(1)
  if (!order) throw new DomainError("not_found", "Order not found", { field: "order" })
  if (!DELIVERABLE_STATES.includes(order.state)) blocked("order_not_deliverable", "The order cannot receive deliveries in its state", { state: order.state })
  const prior = await tx
    .select({ amountMinor: delivery.acceptedMinor })
    .from(delivery)
    .where(and(eq(delivery.tenantId, ctx.tenant.id), eq(delivery.orderId, order.id), eq(delivery.state, "accepted")))
  const deliveredBefore = prior.reduce((s, d) => s + d.amountMinor, 0n)
  if (args.amountMinor <= 0n || deliveredBefore + args.amountMinor > order.amountMinor) {
    blocked("delivery_exceeds_order", "Accepted delivery cannot exceed the order amount", {
      orderMinor: order.amountMinor.toString(),
      deliveredBeforeMinor: deliveredBefore.toString(),
      requestedMinor: args.amountMinor.toString(),
    })
  }
  const [row] = await tx
    .insert(delivery)
    .values({
      tenantId: ctx.tenant.id,
      orderId: order.id,
      acceptedMinor: args.amountMinor,
      currency: order.currency,
      state: "accepted",
      evidenceId: args.evidenceId ?? null,
      businessDate: args.businessDate,
      detail: args.detail ?? {},
      acceptedBy: ctx.user.id,
    })
    .returning()
  // Commitment → consumed for the accepted part (same scope, never a second cost).
  const commitmentId = (order.detail as { commitmentId?: string }).commitmentId
  if (commitmentId) {
    const [c] = await tx
      .select()
      .from(budgetReservation)
      .where(and(eq(budgetReservation.tenantId, ctx.tenant.id), eq(budgetReservation.id, commitmentId)))
      .for("update")
      .limit(1)
    if (c && c.state === "committed") {
      if (c.amountMinor <= args.amountMinor) {
        await tx.update(budgetReservation).set({ state: "consumed", revision: sql`${budgetReservation.revision} + 1` }).where(eq(budgetReservation.id, c.id))
      } else {
        await tx
          .update(budgetReservation)
          .set({ amountMinor: c.amountMinor - args.amountMinor, revision: sql`${budgetReservation.revision} + 1` })
          .where(eq(budgetReservation.id, c.id))
        await tx.insert(budgetReservation).values({ tenantId: ctx.tenant.id, jobId: c.jobId, budgetScope: c.budgetScope, amountMinor: args.amountMinor, currency: c.currency, state: "consumed", purpose: c.purpose, createdBy: ctx.user.id, updatedBy: ctx.user.id })
      }
    }
  }
  const deliveredAfter = deliveredBefore + args.amountMinor
  const state = deliveredAfter === order.amountMinor ? "delivered" : "partially_delivered"
  await tx
    .update(purchaseOrder)
    .set({ state, updatedAt: new Date(), updatedBy: ctx.user.id, revision: sql`${purchaseOrder.revision} + 1` })
    .where(eq(purchaseOrder.id, order.id))
  return {
    order,
    delivery: row!,
    state,
    deliveredAfterMinor: deliveredAfter,
    events: [
      {
        eventType: "delivery.accepted",
        aggregateType: "purchase_order",
        aggregateId: order.id,
        jobId: order.jobId,
        payload: { deliveryId: row!.id, reference: order.reference, kind: order.kind, acceptedMinor: args.amountMinor, deliveredAfterMinor: deliveredAfter, orderMinor: order.amountMinor, currency: order.currency, orderState: state },
        businessEffectiveAt: new Date(`${args.businessDate}T12:00:00Z`),
      },
    ] as EmittedEvent[],
  }
}

export const AcceptDeliveryInput = z
  .object({ order: Uuid, acceptedAmount: Decimal, businessDate: IsoDate, evidenceId: Uuid.optional(), note: z.string().trim().max(500).optional() })
  .strict()

export const acceptMediaDelivery = defineCommand({
  type: "media.acceptDelivery",
  skillId: "agency-media-buying",
  permission: "media.buy",
  input: AcceptDeliveryInput,
  handler: async (tx, ctx, input) => {
    const [o] = await tx.select().from(purchaseOrder).where(and(eq(purchaseOrder.tenantId, ctx.tenant.id), eq(purchaseOrder.id, input.order))).limit(1)
    if (!o) throw new DomainError("not_found", "Order not found", { field: "order" })
    if (o.kind !== "media") blocked("not_a_media_order", "Production deliveries are accepted through the production review", { kind: o.kind })
    const res = await acceptDeliveryTx(tx, ctx, {
      orderId: o.id,
      amountMinor: parseMoney(input.acceptedAmount, o.currency, "acceptedAmount", { positive: true }),
      businessDate: input.businessDate,
      evidenceId: input.evidenceId ?? null,
      detail: { note: input.note ?? null },
    })
    return {
      result: { orderId: o.id, deliveryId: res.delivery.id, orderState: res.state, deliveredMinor: res.deliveredAfterMinor.toString(), currency: o.currency },
      events: res.events,
    }
  },
})
