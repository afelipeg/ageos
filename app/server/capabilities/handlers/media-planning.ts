// Capability handlers for module "media-planning". Owner: Core-2.
// Skills: agency-media-ranking, agency-media-planning, agency-tv-radio-planning, agency-ooh-planning, agency-digital-planning, agency-plan-changes
// A skill missing from `handlers` is "registered" only (no fake success).
import "server-only"

import { and, eq } from "drizzle-orm"

import { fixtureUuid } from "@/lib/fixture-ids"
import type { AgencyContext } from "@/server/auth/context"
import { connection, job, oohFace, oohReservation } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { buildBroadcastSchedule } from "@/server/domain/broadcast"
import {
  approvedPlan,
  applyPlanRevision,
  DigitalPlanInput,
  proposePlanRevisionChange,
  RankMediaInput,
  rankMediaOptions,
  saveMediaPlanRevision,
  validateDigitalPlan,
} from "@/server/domain/media-planning"
import { proposeOOHPlan, reserveOOHFace } from "@/server/domain/ooh"
import { executeCommand } from "@/server/kernel/commands"

import type { ModuleCapabilities } from "../types"

// ── Fixture support shared by the Core-2 modules (demo-lab data only) ──
export const LAB = fixtureUuid("job_demo_lab_ops")
export const F = fixtureUuid
export const nonce = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
export const fixtureKey = (label: string) => `fixture:core2:${label}:${nonce()}`

/** Decides a pending kernel approval as `actorKey` (fixture verification of the governed path). */
export async function approveAs(ctx: (actorKey: string) => Promise<AgencyContext>, actorKey: string, approvalId: string, payloadDigest: string) {
  const { decideApprovalCommand } = await import("@/server/domain/approvals")
  const res = await executeCommand(await ctx(actorKey), decideApprovalCommand, {
    idempotencyKey: fixtureKey("approve"),
    origin: "system",
    payload: { approvalId, decision: "approve", reviewedDigest: payloadDigest },
  })
  return res.result
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`fixture verify failed: ${message}`)
}

export async function jobRevision(ctx: AgencyContext, jobId: string) {
  return withTenant(ctx.tenant.id, async (tx) => (await tx.select({ r: job.revision }).from(job).where(eq(job.id, jobId)))[0]!.r)
}

export async function approvedPlanNumber(ctx: AgencyContext, jobId: string) {
  return withTenant(ctx.tenant.id, async (tx) => (await approvedPlan(tx, ctx.tenant.id, jobId)).revision?.number ?? 1)
}

export async function connectionId(ctx: AgencyContext, alias: string) {
  return withTenant(ctx.tenant.id, async (tx) => (await tx.select({ id: connection.id }).from(connection).where(and(eq(connection.tenantId, ctx.tenant.id), eq(connection.accountAlias, alias))))[0]!.id)
}

/** Guarantees the demo-lab reservation of face_demo_d for 2027-05-01..14 exists (precondition). */
export async function ensureLabFaceReservation(ctx: AgencyContext) {
  const exists = await withTenant(ctx.tenant.id, async (tx) => {
    const [face] = await tx.select().from(oohFace).where(and(eq(oohFace.tenantId, ctx.tenant.id), eq(oohFace.faceKey, "face_demo_d")))
    const rows = await tx.select().from(oohReservation).where(and(eq(oohReservation.tenantId, ctx.tenant.id), eq(oohReservation.faceId, face!.id), eq(oohReservation.state, "reserved")))
    return rows.some((r) => r.startDate <= "2027-05-14" && r.endDate >= "2027-05-01")
  })
  if (!exists) {
    await executeCommand(ctx, reserveOOHFace, {
      idempotencyKey: fixtureKey("ooh-precondition"),
      origin: "system",
      payload: { job: LAB, action: "reserve", face: "face_demo_d", startDate: "2027-05-01", endDate: "2027-05-14", operator: F("supplier_demo_ooh_operator") },
    })
  }
}

type Out = Record<string, unknown>

export const capabilities: ModuleCapabilities = {
  handlers: {
    "agency-media-ranking": { kind: "query", input: RankMediaInput, run: rankMediaOptions as (ctx: AgencyContext, input: never) => Promise<unknown> },
    "agency-media-planning": { kind: "command", command: saveMediaPlanRevision },
    "agency-tv-radio-planning": { kind: "command", command: buildBroadcastSchedule },
    "agency-ooh-planning": { kind: "command", command: proposeOOHPlan },
    "agency-digital-planning": { kind: "query", input: DigitalPlanInput, run: validateDigitalPlan as (ctx: AgencyContext, input: never) => Promise<unknown> },
    "agency-plan-changes": { kind: "command", command: proposePlanRevisionChange },
  },
  fixtures: {
    "agency-media-ranking": {
      positive: async () => {
        const input = { job: LAB, objective: "reach", market: "US", targetAudience: "Adults 25-44, urban", flightStart: "2027-03-16", flightEnd: "2027-03-31", reachWeightBps: 6000 }
        return {
          actorKey: "user_demo_operator",
          input,
          verify: async (output, ctx) => {
            const o = output as Out & { manifestDigest: string; candidate_table: { vehicleKey: string }[]; data_quality_exceptions: { sourceKey: string; reasons: string[] }[] }
            const again = (await rankMediaOptions(ctx, RankMediaInput.parse(input))) as unknown as typeof o
            check(again.manifestDigest === o.manifestDigest, "ranking is reproducible")
            check(o.candidate_table.length >= 2, "ranked candidates")
            const reasons = o.data_quality_exceptions.flatMap((e) => e.reasons)
            check(reasons.includes("stale_source") && reasons.includes("license_unlicensed") && reasons.includes("incomparable_audience_base"), "stale, unlicensed and incomparable sources are flagged")
          },
        }
      },
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, objective: "reach", market: "CO", targetAudience: "Adults 25-44", flightStart: "2027-03-16", flightEnd: "2027-03-31", reachWeightBps: 6000 },
        expectCode: "blocked_by_rule",
        expectRule: "no_comparable_sources",
      }),
    },
    "agency-media-planning": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, channel: "ooh", placement: "Fictional Station Faces A/B", plannedAmount: "2500.00", flightStart: "2027-03-16", flightEnd: "2027-03-31", audience: "Adults 25-44, urban" },
        verify: async (output) => {
          const o = output as { plan_totals: { totalMinor: string }; media_plan: { jobId: string; state: string; lines: { amountMinor: string }[] }; approvalId: string }
          const sum = o.media_plan.lines.reduce((s, l) => s + BigInt(l.amountMinor), 0n)
          check(o.plan_totals.totalMinor === "1450000" && sum === 1450000n, "lines sum to the plan total")
          check(o.media_plan.jobId === LAB && o.media_plan.state === "submitted" && !!o.approvalId, "revision linked to the job and sent for approval")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, channel: "meta", placement: "Demo Feed", plannedAmount: "50000.00", flightStart: "2027-03-16", flightEnd: "2027-03-31" },
        expectCode: "blocked_by_rule",
        expectRule: "exceeds_managed_media_authority",
      }),
    },
    "agency-tv-radio-planning": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, medium: "radio", station: "Fictional City Radio", spotCount: 20, spotDurationSeconds: 30, unitCost: "100.00", flightStart: "2027-03-16", flightEnd: "2027-03-31" },
        verify: async (output) => {
          const o = output as { broadcast_schedule: { netMinor: string; timezone: string }; spot_register: { spotId: string }[]; material_distribution: { durationValidated: boolean }[]; evaluation_report: { label: string } }
          check(o.broadcast_schedule.netMinor === "200000", "20 spots at 100 = 2,000")
          check(new Set(o.spot_register.map((s) => s.spotId)).size === 20, "unique spot ids")
          check(o.material_distribution[0]!.durationValidated && o.evaluation_report.label === "Synthetic demo audience", "duration validated, audience labelled synthetic")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, medium: "radio", station: "Fictional City Radio", spotCount: 20, spotDurationSeconds: 45, unitCost: "100.00", flightStart: "2027-03-16", flightEnd: "2027-03-31" },
        expectCode: "blocked_by_rule",
        expectRule: "unsupported_duration",
      }),
    },
    "agency-ooh-planning": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, site: "Fictional Station Faces A/B", faces: 2, unitRate: "1000.00", flightStart: "2027-03-10", flightEnd: "2027-03-24", evidenceType: "photo" },
        verify: async (output) => {
          const o = output as { totalMinor: string; booking_proposals: { state: string }[]; evidence_requirements: { required: string }[] }
          check(o.totalMinor === "200000", "two faces at 1,000 = 2,000")
          check(o.booking_proposals.length === 2 && o.booking_proposals.every((b) => b.state === "proposed_not_reserved"), "proposal does not reserve")
          check(o.evidence_requirements.every((e) => e.required === "photo"), "static faces need installation photos")
        },
      }),
      negative: async (ctx) => {
        await ensureLabFaceReservation(await ctx("user_demo_operator"))
        return {
          actorKey: "user_demo_operator",
          input: { job: LAB, site: "Fictional Plaza Faces C/D", faces: 2, unitRate: "1000.00", flightStart: "2027-05-01", flightEnd: "2027-05-14" },
          expectCode: "blocked_by_rule",
          expectRule: "faces_unavailable",
        }
      },
    },
    "agency-digital-planning": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, connection: F("connection_demo_meta_labops"), objective: "conversions", budget: "5000.00", placement: "Demo Feed", conversionEvent: "purchase_demo", creativeFile: F("file_demo_lab_creative") },
        verify: async (output) => {
          const o = output as { preflight: { accountMapped: boolean; creative: { passed: boolean } }; digital_plan: { lines: { lineKey: string; accountAlias: string | null }[] }; taxonomy_strings: { name: string }[] }
          check(o.preflight.accountMapped && o.preflight.creative.passed, "account mapped and creative within spec")
          check(o.digital_plan.lines.some((l) => l.lineKey === "line_meta" && l.accountAlias === "demo_meta_labops"), "stable line ids and simulated accounts")
          check(o.taxonomy_strings[0]!.name.length > 0, "taxonomy name")
        },
      }),
      negative: async (ctx) => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, connection: await connectionId(await ctx("user_demo_operator"), "demo_meta_aurora"), objective: "awareness", budget: "1000.00", placement: "Demo Feed" },
        expectCode: "blocked_by_rule",
        expectRule: "account_unmapped",
      }),
    },
    "agency-plan-changes": {
      positive: async (ctx) => {
        const operator = await ctx("user_demo_operator")
        const base = await approvedPlanNumber(operator, LAB)
        return {
          actorKey: "user_demo_operator",
          input: { job: LAB, baseRevision: base, channel: "meta", newAmount: "4000.00", offsetChannel: "google", reasonCategory: "market_change", reason: "Move 1,000 from Meta to Google search (demo-lab)." },
          verify: async (output, c) => {
            const o = output as { proposed_revision: { totalMinor: string; number: number }; line_diff: { changed: string[] }; approval_pack: { approvalId: string } }
            check(o.proposed_revision.totalMinor === "1400000", "total preserved")
            check(o.line_diff.changed.join(",") === "line_google,line_meta", "two lines changed")
            check((await approvedPlanNumber(c, LAB)) === base && !!o.approval_pack.approvalId, "prior revision stays approved until the new approval")
          },
        }
      },
      negative: async (ctx) => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, baseRevision: await approvedPlanNumber(await ctx("user_demo_operator"), LAB), channel: "radio", newAmount: "1500.00", offsetChannel: "ooh", reasonCategory: "correction", reason: "Try to cut a fully committed radio line." },
        expectCode: "blocked_by_rule",
        expectRule: "below_commitment",
      }),
    },
  },
  executors: {
    "media_plan.approve_revision": {
      permission: "media.plan",
      skillId: "agency-media-planning",
      run: (tx, ctx, payload, mode) => applyPlanRevision(tx, ctx, payload, mode),
    },
  },
}

