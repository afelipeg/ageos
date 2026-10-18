import "server-only"

import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import { approvalRequest, billingReadiness } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { digestOf } from "@/server/kernel/approvals"
import { defineCommand, toJsonSafe } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { checkEvidence, verifyEvidencePin, type EvidencePin } from "./evidence"
import { loadJobFinancials } from "./profitability"

// ── agency-billing-requirements: evaluateBillingReadiness ──
// Per-requirement checklist for the client invoice: approved budget, approved
// client authority resting on reviewed evidence, authority covering what will
// be billed, deliverable accepted AND backed by reviewed acceptance evidence,
// no pending amendment. The `requirements_checked` record exists only when all
// pass; invoice preparation calls `assertBillingReady`, which re-verifies the
// pinned evidence so removing or changing it blocks issuance server-side.

export const EvaluateBillingReadinessInput = z
  .object({
    job: z.string().uuid(),
    deliverableAccepted: z.boolean(),
    poNumber: z.string().trim().min(2).max(60).optional(),
    // Evidence id, or the id of the stored file it wraps (workbench file field).
    acceptanceEvidence: z.string().uuid().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()

type Requirement = { key: string; status: "met" | "missing"; detail: Record<string, unknown> }

async function evaluate(
  tx: Tx,
  tenantId: string,
  input: { job: string; deliverableAccepted: boolean; poNumber?: string; acceptanceEvidence?: string }
) {
  const fin = await loadJobFinancials(tx, tenantId, input.job)
  const j = fin.job
  const req: Requirement[] = []
  const pins: (EvidencePin & { requirement: string })[] = []
  const billable = (fin.approvedBudget?.agencyFeeMinor ?? 0n) + (fin.approvedBudget?.managedMediaMinor ?? 0n)

  req.push({
    key: "approved_budget",
    status: fin.approvedBudget ? "met" : "missing",
    detail: { budgetRevision: fin.approvedBudget?.number ?? null, billableMinor: billable, currency: j.currency },
  })

  const auth = fin.approvedAuthority
  let authorityDetail: Record<string, unknown> = { reason: "no_approved_client_authority" }
  let authorityMet = false
  if (auth) {
    if (input.poNumber && input.poNumber !== auth.reference) {
      authorityDetail = { reason: "po_number_mismatch", approvedReference: auth.reference }
    } else if (!auth.evidenceId) {
      authorityDetail = { reason: "authority_evidence_missing", reference: auth.reference }
    } else {
      const ev = await checkEvidence(tx, tenantId, auth.evidenceId, { kind: "client_po", clientId: j.clientId, jobId: j.id })
      if (ev.ok) {
        authorityMet = true
        pins.push({ ...ev.pin, requirement: "client_authority" })
        authorityDetail = { reference: auth.reference, revisionNumber: auth.revisionNumber, evidenceId: ev.pin.evidenceId }
      } else {
        authorityDetail = { reason: ev.rule, reference: auth.reference }
      }
    }
  }
  req.push({ key: "client_authority", status: authorityMet ? "met" : "missing", detail: authorityDetail })
  req.push({
    key: "authority_covers_billable",
    status: auth && auth.amountMinor >= billable && billable > 0n ? "met" : "missing",
    detail: { authorityMinor: auth?.amountMinor ?? 0n, billableMinor: billable, currency: j.currency },
  })
  req.push({ key: "deliverable_accepted", status: input.deliverableAccepted ? "met" : "missing", detail: {} })

  let acceptanceDetail: Record<string, unknown> = { reason: "acceptance_evidence_required" }
  let acceptanceMet = false
  if (input.acceptanceEvidence) {
    const ev = await checkEvidence(tx, tenantId, input.acceptanceEvidence, { kind: "acceptance", clientId: j.clientId, jobId: j.id })
    if (ev.ok) {
      acceptanceMet = true
      pins.push({ ...ev.pin, requirement: "acceptance_evidence" })
      acceptanceDetail = { evidenceId: ev.pin.evidenceId, fileVersion: ev.pin.fileVersion }
    } else {
      acceptanceDetail = { reason: ev.rule }
    }
  }
  req.push({ key: "acceptance_evidence", status: acceptanceMet ? "met" : "missing", detail: acceptanceDetail })

  const pending = await tx
    .select({ id: approvalRequest.id, actionType: approvalRequest.actionType })
    .from(approvalRequest)
    .where(and(eq(approvalRequest.tenantId, tenantId), eq(approvalRequest.aggregateId, j.id), eq(approvalRequest.state, "awaiting_approval")))
  req.push({ key: "no_pending_amendments", status: pending.length ? "missing" : "met", detail: { pending } })

  const missing = req.filter((r) => r.status === "missing").map((r) => r.key)
  return { fin, requirements: req, pins, missing, ready: missing.length === 0, billable }
}

export const evaluateBillingReadiness = defineCommand({
  type: "billing.evaluateRequirements",
  skillId: "agency-billing-requirements",
  permission: "billing.manage",
  input: EvaluateBillingReadinessInput,
  handler: async (tx, ctx, input) => {
    const ev = await evaluate(tx, ctx.tenant.id, input)
    const j = ev.fin.job
    const ownerRequests = ev.requirements
      .filter((r) => r.status === "missing")
      .map((r) => ({
        requirement: r.key,
        owner: r.key === "client_authority" || r.key === "authority_covers_billable" ? "agency-contract-po" : r.key === "approved_budget" || r.key === "no_pending_amendments" ? "agency-fee-contracts" : "account_team",
      }))
    if (!ev.ready) {
      throw new DomainError("blocked_by_rule", "Billing requirements are not met", {
        rule: "billing_requirements_missing",
        missing_requirements: ev.missing,
        requirement_matrix: toJsonSafe(ev.requirements),
        owner_requests: ownerRequests,
      })
    }
    const state = { jobId: j.id, jobRevision: j.revision, requirements: ev.requirements, pins: ev.pins, deliverableAccepted: input.deliverableAccepted }
    const digest = digestOf(state)
    const [inserted] = await tx
      .insert(billingReadiness)
      .values({
        tenantId: ctx.tenant.id,
        jobId: j.id,
        jobRevision: j.revision,
        ready: true,
        digest,
        requirements: toJsonSafe(ev.requirements) as object,
        evidencePins: toJsonSafe(ev.pins) as object,
        deliverableAccepted: input.deliverableAccepted,
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
      })
      .onConflictDoNothing()
      .returning()
    const [row] = inserted
      ? [inserted]
      : await tx
          .select()
          .from(billingReadiness)
          .where(and(eq(billingReadiness.tenantId, ctx.tenant.id), eq(billingReadiness.jobId, j.id), eq(billingReadiness.digest, digest)))
          .limit(1)
    return {
      result: {
        readinessId: row!.id,
        reused: !inserted,
        requirement_matrix: ev.requirements,
        evidence_matches: ev.pins,
        missing_requirements: [] as string[],
        issuance_ready: true,
        // Fields locked for the invoice once requirements are checked.
        locked_field_changes: [
          { field: "po_reference", value: ev.fin.approvedAuthority!.reference },
          { field: "billable_amount_minor", value: ev.billable },
          { field: "currency", value: j.currency },
          { field: "billing_client", value: j.clientId },
        ],
        owner_requests: [] as { requirement: string; owner: string }[],
      },
      events: [
        {
          eventType: inserted ? "billing.requirements_checked" : "billing.requirements_rechecked",
          aggregateType: "job",
          aggregateId: j.id,
          aggregateRevision: j.revision,
          jobId: j.id,
          payload: { readinessId: row!.id, digest, evidence: ev.pins.map((p) => ({ evidenceId: p.evidenceId, fileSha256: p.fileSha256 })) },
        },
      ],
    }
  },
})

/**
 * Gate for invoice preparation (agency-client-billing): the latest readiness
 * record of the job must still hold now — same requirements met, same pinned
 * evidence (reviewed, unchanged). Throws blocked_by_rule otherwise.
 */
export async function assertBillingReady(tx: Tx, tenantId: string, jobId: string) {
  const [last] = await tx
    .select()
    .from(billingReadiness)
    .where(and(eq(billingReadiness.tenantId, tenantId), eq(billingReadiness.jobId, jobId)))
    .orderBy(desc(billingReadiness.createdAt))
    .limit(1)
  if (!last) {
    throw new DomainError("blocked_by_rule", "Billing requirements have not been checked", { rule: "billing_requirements_unchecked" })
  }
  const pins = last.evidencePins as (EvidencePin & { requirement: string })[]
  const acceptance = pins.find((p) => p.requirement === "acceptance_evidence")
  const now = await evaluate(tx, tenantId, { job: jobId, deliverableAccepted: last.deliverableAccepted, acceptanceEvidence: acceptance?.evidenceId })
  const fin = now.fin
  for (const pin of pins) {
    const ok = await verifyEvidencePin(tx, tenantId, pin, { clientId: fin.job.clientId, jobId })
    if (!ok.ok) {
      throw new DomainError("blocked_by_rule", "Required billing evidence changed or was removed", {
        rule: "billing_requirements_invalid",
        requirement: pin.requirement,
        reason: ok.rule,
      })
    }
  }
  if (!now.ready) {
    throw new DomainError("blocked_by_rule", "Billing requirements no longer hold", { rule: "billing_requirements_invalid", missing_requirements: now.missing })
  }
  return { readinessId: last.id, requirements: now.requirements }
}

/** Latest checklist for screens: evaluates without persisting. */
export async function getBillingReadiness(ctx: AgencyContext, input: { job: string; acceptanceEvidence?: string }) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const [last] = await tx
      .select()
      .from(billingReadiness)
      .where(and(eq(billingReadiness.tenantId, ctx.tenant.id), eq(billingReadiness.jobId, input.job)))
      .orderBy(desc(billingReadiness.createdAt))
      .limit(1)
    const pins = (last?.evidencePins ?? []) as (EvidencePin & { requirement: string })[]
    const ev = await evaluate(tx, ctx.tenant.id, {
      job: input.job,
      deliverableAccepted: last?.deliverableAccepted ?? false,
      acceptanceEvidence: input.acceptanceEvidence ?? pins.find((p) => p.requirement === "acceptance_evidence")?.evidenceId,
    })
    return { requirements: ev.requirements, missing: ev.missing, ready: ev.ready, lastCheckedId: last?.id ?? null }
  })
}
