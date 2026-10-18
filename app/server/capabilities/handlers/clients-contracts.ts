// Capability handlers for module "clients-contracts". Owner: Core-1.
// Skills: agency-onboarding, agency-job-lifecycle, agency-contract-po, agency-budget-control, agency-fee-contracts, agency-billing-requirements
// A skill missing from `handlers` is "registered" only (no fake success).
import "server-only"

import { fixtureUuid as F } from "@/lib/fixture-ids"
import type { AgencyContext } from "@/server/auth/context"
import { decideApprovalCommand } from "@/server/domain/approvals"
import { evaluateBillingReadiness } from "@/server/domain/billing-requirements"
import { applyClientAuthority, applyFeeAmendment, proposeFeeAmendment, recordClientAuthority, reserveBudget } from "@/server/domain/budget"
import { createClientIntake } from "@/server/domain/clients"
import { getJobRevision, openOrCloseJob } from "@/server/domain/jobs"
import { executeCommand } from "@/server/kernel/commands"
import type { ModuleCapabilities } from "../types"

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`fixture verify failed: ${message}`)
}

type Out = Record<string, unknown>
type Ctx = (actorKey: string) => Promise<AgencyContext>

let seq = 0
/** Unique per run so fixtures stay re-runnable on the same database. */
const runTag = (label: string) => `fx-${label}-${Date.now().toString(36)}-${(seq++).toString(36)}`

const LAB_CLIENT = F("client_demo_lab")
const LAB_PO_EVIDENCE = F("ev:evidence_demo_c1_lab_po")

/** Prepares a fresh demo-lab job (no budget, no authority) via the command. */
async function openLabJob(ctx: Ctx, label: string) {
  const operator = await ctx("user_demo_operator")
  const res = await executeCommand(operator, openOrCloseJob, {
    idempotencyKey: runTag(`${label}-open`),
    payload: { action: "open", client: LAB_CLIENT, jobName: `Lab ${label} exercise`, jobType: "A", billingCode: "F", period: "2027-03" },
    origin: "system",
  })
  return res.result.jobId
}

/** Fresh lab job with USD 1,000 approved client authority (operator → owner). */
async function labJobWithAuthority(ctx: Ctx, label: string) {
  const jobId = await openLabJob(ctx, label)
  const operator = await ctx("user_demo_operator")
  const po = await executeCommand(operator, recordClientAuthority, {
    idempotencyKey: runTag(`${label}-po`),
    payload: { job: jobId, reference: runTag(label).toUpperCase(), amount: "1000.00", validFrom: "2027-03-01", validTo: "2027-12-31", evidenceId: LAB_PO_EVIDENCE },
    origin: "system",
  })
  await executeCommand(await ctx("user_demo_owner"), decideApprovalCommand, {
    idempotencyKey: runTag(`${label}-po-approve`),
    payload: { approvalId: po.result.approvalId, decision: "approve", reviewedDigest: po.result.payloadDigest },
    origin: "system",
  })
  return jobId
}

export const capabilities: ModuleCapabilities = {
  handlers: {
    "agency-onboarding": { kind: "command", command: createClientIntake },
    "agency-job-lifecycle": { kind: "command", command: openOrCloseJob, revisionOf: "job" },
    "agency-contract-po": { kind: "command", command: recordClientAuthority },
    "agency-budget-control": { kind: "command", command: reserveBudget, revisionOf: "job" },
    "agency-fee-contracts": { kind: "command", command: proposeFeeAmendment, revisionOf: "job" },
    "agency-billing-requirements": { kind: "command", command: evaluateBillingReadiness },
  },
  fixtures: {
    // ERP-05: the same client identity resolves to the existing client (no
    // twin) and its brief links to the client's jobs. Negative: no fiscal
    // profile for the country → visible blocker.
    "agency-onboarding": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: {
          clientName: "Feature Lab (demo-lab)",
          clientCode: "LAB",
          productCode: "XX",
          billingCurrency: "USD",
          country: "US",
          briefTitle: "Lab intake brief",
          briefSummary: "Secondary intake exercise for the demo-lab client.",
        },
        verify: async (output) => {
          const o = output as Out
          expect(o.clientId === LAB_CLIENT && o.duplicateAvoided === true, "resolves to the existing lab client")
          const plan = (o.attention_group_plan as { linkedJobs: { id: string }[] }[])[0]!
          expect(plan.linkedJobs.some((j) => j.id === F("job_demo_lab")), "brief links to the client's job")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: {
          clientName: "Andes Demo SAS",
          clientCode: "AND",
          productCode: "AD",
          billingCurrency: "USD",
          country: "CO",
          briefTitle: "Andes launch brief",
          briefSummary: "Fictional client without a configured fiscal profile.",
        },
        expectCode: "blocked_by_rule",
        expectRule: "billing_identity_missing",
      }),
    },
    // ERP-06: JobNumber from the calculator, display reference as alias.
    // Negative: close blocked by an open commitment and unresolved hours.
    "agency-job-lifecycle": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: { action: "open", client: LAB_CLIENT, jobName: "Lab job lifecycle exercise", jobType: "A", billingCode: "F", period: "2027-03" },
        verify: async (output) => {
          const o = output as Out
          expect(/^LABXX7AF\d{4}$/.test(String(o.jobNumber)), "canonical JobNumber")
          expect(/^RDS-2027-\d{3}$/.test(String(o.displayReference)), "display reference alias")
        },
      }),
      negative: async (ctx) => ({
        actorKey: "user_demo_operator",
        input: { action: "request_close", job: F("job_demo_lab_fee"), closeReason: "Try to close with open items." },
        expectedRevision: await getJobRevision(await ctx("user_demo_operator"), F("job_demo_lab_fee")),
        expectCode: "blocked_by_rule",
        expectRule: "job_close_gate",
      }),
    },
    // ERP-07: PO revision on reviewed client evidence goes to owner/finance.
    // Negative: an expired PO cannot authorize new commitments.
    "agency-contract-po": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: {
          job: F("job_demo_lab"),
          reference: runTag("po").toUpperCase(),
          amount: "1000.00",
          validFrom: "2027-03-01",
          validTo: "2027-12-31",
          billingRoute: "holder_client",
          evidenceId: LAB_PO_EVIDENCE,
        },
        verify: async (output) => {
          const o = output as Out
          const approval = o.approval as { state: string }
          expect(approval.state === "awaiting_approval", "approval pending")
          expect((o.po_link_decisions as { evidenceId: string }[])[0]!.evidenceId === LAB_PO_EVIDENCE, "evidence pinned")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: {
          job: F("job_demo_lab"),
          reference: runTag("po-expired").toUpperCase(),
          amount: "1000.00",
          validFrom: "2027-02-01",
          validTo: "2027-03-10",
          evidenceId: LAB_PO_EVIDENCE,
        },
        expectCode: "blocked_by_rule",
        expectRule: "po_expired",
      }),
    },
    // ERP-08: USD 700 against USD 1,000 authority leaves 300.
    // Negative: a second 700 cannot be reserved.
    "agency-budget-control": {
      positive: async (ctx) => {
        const jobId = await labJobWithAuthority(ctx, "reserve")
        return {
          actorKey: "user_demo_operator",
          input: { job: jobId, budgetScope: "client_commercial_authority", amount: "700.00", purpose: "Fixture reservation" },
          expectedRevision: await getJobRevision(await ctx("user_demo_operator"), jobId),
          verify: async (output) => {
            expect((output as Out).availableAfterMinor === "30000", "300.00 left")
          },
        }
      },
      negative: async (ctx) => {
        const jobId = await labJobWithAuthority(ctx, "reserve-neg")
        await executeCommand(await ctx("user_demo_operator"), reserveBudget, {
          idempotencyKey: runTag("reserve-first"),
          payload: { job: jobId, budgetScope: "client_commercial_authority", amount: "700.00", purpose: "First reservation" },
          origin: "system",
        })
        return {
          actorKey: "user_demo_operator",
          input: { job: jobId, budgetScope: "client_commercial_authority", amount: "700.00", purpose: "Second reservation" },
          expectedRevision: await getJobRevision(await ctx("user_demo_operator"), jobId),
          expectCode: "blocked_by_rule",
          expectRule: "budget_available",
        }
      },
    },
    // ERP-09: fee schedule with instalment, media/production split, job
    // allocation and an hourly settlement over approved hours only.
    // Negative: no approved budget to amend.
    "agency-fee-contracts": {
      positive: async (ctx) => ({
        actorKey: "user_demo_operator",
        input: { job: F("job_demo_lab_fee"), newAgencyFee: "1200.00", reason: "Lab scope adds approved hours." },
        expectedRevision: await getJobRevision(await ctx("user_demo_operator"), F("job_demo_lab_fee")),
        verify: async (output) => {
          const o = output as Out
          const settlement = o.hourly_settlement as { totalHoursHundredths: string }
          expect(settlement.totalHoursHundredths === "1200", "only the 12 approved hours count")
          const exceptions = (o.fee_exceptions as { code: string }[]).map((e) => e.code)
          expect(exceptions.includes("rejected_hours_never_billable"), "rejected hours reported, not billed")
          const schedule = o.instalment_schedule as { totalMinor: string }
          expect(schedule.totalMinor === "120000", "instalments total the fee")
        },
      }),
      negative: async (ctx) => {
        const jobId = await openLabJob(ctx, "fee-no-budget")
        return {
          actorKey: "user_demo_operator",
          input: { job: jobId, newAgencyFee: "500.00", reason: "No approved fee to amend." },
          expectedRevision: await getJobRevision(await ctx("user_demo_operator"), jobId),
          expectCode: "blocked_by_rule",
          expectRule: "approved_budget_required",
        }
      },
    },
    // ERP-10: requirements met only with reviewed acceptance evidence linked.
    // Negative: without the acceptance evidence issuance is blocked.
    "agency-billing-requirements": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: {
          job: F("job_demo_lab_billing"),
          deliverableAccepted: true,
          poNumber: "PO-LAB-BILL-01",
          acceptanceEvidence: F("ev:evidence_demo_c1_lab_acceptance"),
        },
        verify: async (output) => {
          expect((output as Out).issuance_ready === true, "issuance ready")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: { job: F("job_demo_lab_billing"), deliverableAccepted: true, poNumber: "PO-LAB-BILL-01" },
        expectCode: "blocked_by_rule",
        expectRule: "billing_requirements_missing",
      }),
    },
  },
  executors: {
    "budget.fee_amendment": {
      permission: "budget.propose",
      skillId: "agency-fee-contracts",
      run: (tx, ctx, payload, mode) => applyFeeAmendment(tx, ctx, payload as Parameters<typeof applyFeeAmendment>[2], mode),
    },
    "contract.client_authority": {
      permission: "budget.propose",
      skillId: "agency-contract-po",
      run: (tx, ctx, payload, mode) => applyClientAuthority(tx, ctx, payload as Parameters<typeof applyClientAuthority>[2], mode),
    },
  },
}
