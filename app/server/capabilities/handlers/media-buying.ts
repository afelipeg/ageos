// Capability handlers for module "media-buying". Owner: Core-2.
// Skills: agency-rate-cards-contracts, agency-media-buying, agency-campaign-activation, agency-campaign-optimization, agency-transmission-control, agency-ooh-inventory
// A skill missing from `handlers` is "registered" only (no fake success).
import "server-only"

import { and, eq } from "drizzle-orm"

import type { AgencyContext } from "@/server/auth/context"
import { adapterOperation, budgetReservation, campaign, demoProviderEffect, mediaPlanRevision, oohFace, oohReservation, purchaseOrder, rateCard } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { reconcileBroadcastDelivery } from "@/server/domain/broadcast"
import { activateDemoCampaign, applyCampaignActivation, proposeCampaignOptimization } from "@/server/domain/campaigns"
import { applyMediaOrder, applyRateCardApproval, issueMediaOrder, rejectRateCard, saveRateCardAgreement } from "@/server/domain/media-buying"
import { reserveOOHFace } from "@/server/domain/ooh"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import type { ModuleCapabilities } from "../types"
import { approveAs, approvedPlanNumber, check, ensureLabFaceReservation, F, fixtureKey, LAB } from "./media-planning"

const approveAsFinance = (ctx: (actorKey: string) => Promise<AgencyContext>, approvalId: string, payloadDigest: string) =>
  approveAs(ctx, "user_demo_finance", approvalId, payloadDigest)

async function freeWindow(ctx: AgencyContext, faceKey: string) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const [face] = await tx.select().from(oohFace).where(and(eq(oohFace.tenantId, ctx.tenant.id), eq(oohFace.faceKey, faceKey)))
    const rows = await tx.select().from(oohReservation).where(and(eq(oohReservation.tenantId, ctx.tenant.id), eq(oohReservation.faceId, face!.id), eq(oohReservation.state, "reserved")))
    for (let start = Date.parse("2027-06-01T00:00:00Z"); ; start += 7 * 86_400_000) {
      const s = new Date(start).toISOString().slice(0, 10)
      const e = new Date(start + 6 * 86_400_000).toISOString().slice(0, 10)
      if (!rows.some((r) => r.startDate <= e && r.endDate >= s)) return { startDate: s, endDate: e }
    }
  })
}

export const capabilities: ModuleCapabilities = {
  handlers: {
    "agency-rate-cards-contracts": { kind: "command", command: saveRateCardAgreement },
    "agency-media-buying": { kind: "command", command: issueMediaOrder },
    "agency-campaign-activation": { kind: "command", command: activateDemoCampaign },
    "agency-campaign-optimization": { kind: "command", command: proposeCampaignOptimization },
    "agency-transmission-control": { kind: "command", command: reconcileBroadcastDelivery },
    "agency-ooh-inventory": { kind: "command", command: reserveOOHFace },
  },
  fixtures: {
    "agency-rate-cards-contracts": {
      positive: async (ctx) => ({
        actorKey: "user_demo_operator",
        input: { supplier: F("supplier_demo_digital_network"), medium: "digital", validFrom: "2027-03-01", validTo: "2027-12-31", grossRate: "1000.00", firstDiscountBps: 1000, secondDiscountBps: 500 },
        verify: async (output, actor) => {
          const o = output as { rateCardId: string; netRateMinor: string; state: string; approvalId: string; payloadDigest: string }
          check(o.netRateMinor === "85500" && o.state === "submitted", "10% then 5% on 1,000 = 855, awaiting approval")
          const self = await approveAs(ctx, "user_demo_operator", o.approvalId, o.payloadDigest).catch((e: unknown) => e)
          check(self instanceof DomainError, "the author cannot approve the rate card")
          const decided = await approveAsFinance(ctx, o.approvalId, o.payloadDigest)
          check(decided.outcome === "approved" && decided.executed, "approved by finance through the kernel")
          const state = await withTenant(actor.tenant.id, async (tx) => (await tx.select().from(rateCard).where(eq(rateCard.id, o.rateCardId)))[0]!.state)
          check(state === "approved", "rate card approved")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: { supplier: F("supplier_demo_digital_network"), medium: "digital", validFrom: "2027-01-01", validTo: "2027-02-28", grossRate: "1000.00", firstDiscountBps: 1000 },
        expectCode: "blocked_by_rule",
        expectRule: "rate_card_expired",
      }),
    },
    "agency-media-buying": {
      positive: async (ctx) => {
        const plan = await approvedPlanNumber(await ctx("user_demo_operator"), LAB)
        return {
          actorKey: "user_demo_operator",
          input: { job: LAB, supplier: F("supplier_demo_meta_ads"), channel: "meta", planRevision: plan, orderAmount: "10.00", poNumber: "PO-LAB-OPS-2027-01", connection: F("connection_demo_meta_labops") },
          verify: async (output, actor) => {
            const o = output as { orderId: string; approvalId: string; payloadDigest: string }
            const decided = await approveAsFinance(ctx, o.approvalId, o.payloadDigest)
            check(decided.outcome === "approved" && decided.executed, "approved order executed")
            const { executeApprovedCommand } = await import("@/server/domain/approvals")
            const again = await executeCommand(actor, executeApprovedCommand, { idempotencyKey: fixtureKey("re-execute"), origin: "system", payload: { approvalId: o.approvalId } }).catch((e: unknown) => e)
            check(again instanceof DomainError && again.code === "approval_required", "the same approval cannot issue twice")
            await withTenant(actor.tenant.id, async (tx) => {
              const [order] = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.id, o.orderId))
              check(order!.state === "acknowledged" && order!.receiptId?.startsWith("sim_"), "simulated acknowledged with sim_* receipt")
              const commitments = await tx.select().from(budgetReservation).where(and(eq(budgetReservation.tenantId, actor.tenant.id), eq(budgetReservation.purpose, `media_order:${order!.reference}`)))
              check(commitments.length === 1 && commitments[0]!.state === "committed" && commitments[0]!.amountMinor === 1000n, "one commitment")
            })
          },
        }
      },
      negative: async (ctx) => {
        const operator = await ctx("user_demo_operator")
        const notApproved = await withTenant(operator.tenant.id, async (tx) => {
          const revs = await tx.select().from(mediaPlanRevision).where(and(eq(mediaPlanRevision.tenantId, operator.tenant.id), eq(mediaPlanRevision.jobId, LAB)))
          return revs.find((r) => r.state !== "approved")?.number ?? Math.max(...revs.map((r) => r.number)) + 1
        })
        return {
          actorKey: "user_demo_operator",
          input: { job: LAB, supplier: F("supplier_demo_meta_ads"), channel: "meta", planRevision: notApproved, orderAmount: "10.00", connection: F("connection_demo_meta_labops") },
          expectCode: "blocked_by_rule",
          expectRule: "plan_revision_not_approved",
        }
      },
    },
    "agency-campaign-activation": {
      positive: async (ctx) => {
        const plan = await approvedPlanNumber(await ctx("user_demo_operator"), LAB)
        return {
          actorKey: "user_demo_operator",
          input: { job: LAB, connection: F("connection_demo_meta_labops"), planRevision: plan, creativeFile: F("file_demo_lab_creative"), rightsCleared: true, landingUrl: "https://lab.example/spring", conversionEvent: "purchase_demo" },
          verify: async (output, actor) => {
            const o = output as { campaignId: string; approvalId: string; payloadDigest: string; label: { en: string } }
            check(o.label.en === "Simulated activation", "labelled simulated")
            const decided = await approveAsFinance(ctx, o.approvalId, o.payloadDigest)
            check(decided.executed, "approved activation executed")
            await withTenant(actor.tenant.id, async (tx) => {
              const [c] = await tx.select().from(campaign).where(eq(campaign.id, o.campaignId))
              check(c!.state === "active_simulated" && c!.receiptId?.startsWith("sim_"), "simulated campaign with persistent receipt")
              const [op] = await tx.select().from(adapterOperation).where(eq(adapterOperation.id, c!.adapterOperationId!))
              const effects = await tx.select().from(demoProviderEffect).where(and(eq(demoProviderEffect.tenantId, actor.tenant.id), eq(demoProviderEffect.idempotencyKey, op!.idempotencyKey)))
              check(effects.length === 1, "exactly one simulated campaign effect")
            })
          },
        }
      },
      negative: async (ctx) => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, connection: F("connection_demo_tiktok_labops"), planRevision: await approvedPlanNumber(await ctx("user_demo_operator"), LAB), creativeFile: F("file_demo_lab_creative"), rightsCleared: true },
        expectCode: "connection_revoked",
        expectRule: "connection_revoked",
      }),
    },
    "agency-campaign-optimization": {
      positive: async (ctx) => {
        const before = await approvedPlanNumber(await ctx("user_demo_operator"), LAB)
        return {
          actorKey: "user_demo_operator",
          input: { job: LAB, objective: "conversions", metricsFile: F("file_demo_lab_metrics_csv"), metricsAsOf: "2027-03-15", maxShiftBps: 2000 },
          verify: async (output, actor) => {
            const o = output as { optimization_proposal: { fromLine: string; toLine: string; shiftMinor: string; state: string }; constraint_check: { totalUnchanged: boolean } }
            check(o.optimization_proposal.fromLine === "line_meta" && o.optimization_proposal.toLine === "line_google", "lower CPA line receives budget")
            check(o.optimization_proposal.shiftMinor === "100000" && o.optimization_proposal.state === "pending_approval", "1,000 reallocation pending approval")
            check(o.constraint_check.totalUnchanged && (await approvedPlanNumber(actor, LAB)) === before, "no automatic spend change")
          },
        }
      },
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, objective: "conversions", metricsFile: F("file_demo_lab_metrics_csv"), metricsAsOf: "2027-03-01", maxShiftBps: 2000 },
        expectCode: "blocked_by_rule",
        expectRule: "stale_metrics_source",
      }),
    },
    "agency-transmission-control": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, station: "Fictional City Radio", orderedSpots: 20, monitoringFile: F("file_demo_lab_emissions_csv"), toleranceSpots: 0, requestMakeGood: true },
        verify: async (output) => {
          const o = output as { emission_match: { matched: number }; missing_or_extra_insertions: { missing: string[]; duplicates: string[] }; makegood_register: { cashCostChangeMinor: string }[]; close_readiness: { missingMarkedDelivered: boolean } }
          check(o.emission_match.matched === 19, "19 unique confirmed spots")
          check(o.missing_or_extra_insertions.missing.length === 1 && o.missing_or_extra_insertions.duplicates.length === 1, "1 missing, duplicate not counted")
          check(o.makegood_register.length === 1 && o.makegood_register[0]!.cashCostChangeMinor === "0", "one make-good with no cash change")
          check(o.close_readiness.missingMarkedDelivered === false, "missing spot not delivered")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, station: "Fictional City Radio", orderedSpots: 20, monitoringFile: F("file_demo_lab_emissions_csv"), toleranceSpots: 0, requestMakeGood: false },
        expectCode: "blocked_by_rule",
        expectRule: "missing_spots_require_makegood",
      }),
    },
    "agency-ooh-inventory": {
      positive: async (ctx) => {
        const window = await freeWindow(await ctx("user_demo_operator"), "face_demo_c")
        return {
          actorKey: "user_demo_operator",
          input: { job: LAB, action: "reserve", face: "face_demo_c", ...window, operator: F("supplier_demo_ooh_operator") },
          verify: async (output) => {
            const o = output as { reservations: { state: string; planLineKey: string | null }[] }
            check(o.reservations.length === 1 && o.reservations[0]!.state === "reserved" && o.reservations[0]!.planLineKey === "line_ooh", "reserved once and linked to the plan line")
          },
        }
      },
      negative: async (ctx) => {
        await ensureLabFaceReservation(await ctx("user_demo_operator"))
        return {
          actorKey: "user_demo_operator",
          input: { job: LAB, action: "reserve", face: "face_demo_d", startDate: "2027-05-07", endDate: "2027-05-20", operator: F("supplier_demo_ooh_operator") },
          expectCode: "blocked_by_rule",
          expectRule: "face_overlap",
        }
      },
    },
  },
  executors: {
    "rate_card.approve": {
      permission: "media.buy",
      skillId: "agency-rate-cards-contracts",
      run: (tx, ctx, payload, mode) => applyRateCardApproval(tx, ctx, payload, mode),
      reject: (tx, ctx, payload, reason) => rejectRateCard(tx, ctx, payload, reason),
    },
    "media_order.issue": {
      permission: "media.buy",
      skillId: "agency-media-buying",
      run: (tx, ctx, payload, mode) => applyMediaOrder(tx, ctx, payload, mode),
    },
    "campaign.activate": {
      permission: "media.buy",
      skillId: "agency-campaign-activation",
      run: (tx, ctx, payload, mode) => applyCampaignActivation(tx, ctx, payload, mode),
    },
  },
}
