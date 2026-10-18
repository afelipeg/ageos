// @vitest-environment node
import { and, eq, sql } from "drizzle-orm"
import postgres from "postgres"

import { resolveAgencyContext } from "@/server/auth/context"
import { simulatedProvider } from "@/server/adapters/simulated-provider"
import { runCapability } from "@/server/capabilities/runner"
import { db } from "@/server/db/client"
import { attentionItem, businessEvent, costEstimate, demoProviderEffect, job, workflowRun } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import {
  proposeFeeAmendment,
  recordClientAuthority,
  recordCostEstimate,
  reserveBudget,
} from "@/server/domain/budget"
import { createClientIntake } from "@/server/domain/clients"
import {
  decideApprovalCommand,
  executeApprovedCommand,
  getApprovalDetail,
} from "@/server/domain/approvals"
import { reviewEvidence } from "@/server/domain/evidence"
import { getJobDossier, listJobs } from "@/server/domain/jobs"
import { computeProfitability, loadJobFinancials } from "@/server/domain/profitability"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, id, key, resetDemo, sessionFor } from "./helpers"

const AURORA = id("job_demo_aurora")
const LAB = id("job_demo_lab")
const NORTE_JOB = id("job_demo_norte")

async function jobRevision(jobId: string, tenantSlug = "rayo-de-sol") {
  const ctx = await ctxFor(tenantSlug === "rayo-de-sol" ? "user_demo_owner" : "user_demo_norte_owner", tenantSlug)
  return withTenant(ctx.tenant.id, async (tx) => (await tx.select().from(job).where(eq(job.id, jobId)))[0]!.revision)
}

async function margin(jobId: string) {
  const ctx = await ctxFor("user_demo_owner")
  return withTenant(ctx.tenant.id, async (tx) =>
    computeProfitability(await loadJobFinancials(tx, ctx.tenant.id, jobId), "forecast", ctx.tenant.slug)
  )
}

async function expectDomainError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code)
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("tenant isolation and RLS", () => {
  it("application role sees no tenant rows without a tenant context", async () => {
    const appSql = postgres(process.env.DATABASE_URL!, { max: 1 })
    try {
      const rows = await appSql`select count(*)::int as n from job`
      expect(rows[0]!.n).toBe(0)
      await expect(
        appSql`insert into job (tenant_id, client_id, name, job_number, display_reference, job_type, billing_code, year, sequence, period, currency, services)
               values (${id("tenant_demo_rayo")}, ${id("client_demo_aurora")}, 'x', 'X', 'X', 'A', 'F', 2027, 99, '2027-03', 'USD', '{}')`
      ).rejects.toThrow(/row-level security/)
    } finally {
      await appSql.end()
    }
  })

  it("a Rayo session cannot resolve, list, or open Norte records", async () => {
    const rayoOwner = await sessionFor("user_demo_owner")
    expect(await resolveAgencyContext(rayoOwner, "norte-studio")).toBeNull()
    const ctx = await ctxFor("user_demo_owner")
    expect(await getJobDossier(ctx, NORTE_JOB)).toBeNull()
    const list = await listJobs(ctx, { q: "Norte" })
    expect(list.items.map((j) => j.id)).not.toContain(NORTE_JOB)
    // Even with an explicit tenant context, RLS hides the other tenant.
    const rows = await withTenant(ctx.tenant.id, (tx) => tx.select().from(job).where(eq(job.id, NORTE_JOB)))
    expect(rows).toHaveLength(0)
  })

  it("audit events are append-only for the application role", async () => {
    const ctx = await ctxFor("user_demo_owner")
    await expect(
      withTenant(ctx.tenant.id, (tx) => tx.update(businessEvent).set({ eventType: "tampered" }))
    ).rejects.toSatisfy((e: unknown) => /permission denied for table business_event/.test(String((e as { cause?: Error }).cause?.message)))
  })
})

describe("Aurora margin is derived from persisted records", () => {
  it("starts at 45.0% (fee 20,000 − cost 11,000), managed media excluded", async () => {
    const p = await margin(AURORA)
    expect(p.agencyFeeMinor).toBe(2000000n)
    expect(p.agencyCost.totalMinor).toBe(1100000n)
    expect(p.managedMediaMinor).toBe(3000000n)
    expect(p.marginMinor).toBe(900000n)
    expect(p.marginBps).toBe(4500)
  })

  it("rejects a stale expected revision and records the 40h scope change exactly once", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const rev = await jobRevision(AURORA)
    const payload = {
      job: AURORA,
      laborMinutes: 8400,
      hourlyCost: "50.00",
      productionVendorAmount: "5500.00",
      expenseAmount: "500.00",
      reason: "Scope change adds 40 hours",
    }
    await expectDomainError(
      executeCommand(ctx, recordCostEstimate, { idempotencyKey: key("est-stale"), payload, origin: "ui", expectedRevision: rev - 1 }),
      "revision_conflict"
    )
    const k = key("est")
    const first = await executeCommand(ctx, recordCostEstimate, { idempotencyKey: k, payload, origin: "ui", expectedRevision: rev })
    const again = await executeCommand(ctx, recordCostEstimate, { idempotencyKey: k, payload, origin: "ui", expectedRevision: rev })
    expect(first.replayed).toBe(false)
    expect(again.replayed).toBe(true)
    expect(again.result).toEqual(first.result)
    await expectDomainError(
      executeCommand(ctx, recordCostEstimate, { idempotencyKey: k, payload: { ...payload, laborMinutes: 9000 }, origin: "ui", expectedRevision: rev }),
      "idempotency_conflict"
    )
    const estimates = await withTenant(ctx.tenant.id, (tx) => tx.select().from(costEstimate).where(eq(costEstimate.jobId, AURORA)))
    expect(estimates.filter((e) => e.state === "current")).toHaveLength(1)
    expect(estimates).toHaveLength(2)

    const p = await margin(AURORA)
    expect(p.agencyCost.totalMinor).toBe(1300000n)
    expect(p.marginBps).toBe(3500)
    const items = await withTenant(ctx.tenant.id, (tx) =>
      tx.select().from(attentionItem).where(and(eq(attentionItem.jobId, AURORA), eq(attentionItem.ruleId, "margin-floor-v1")))
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.state).toBe("open")
  })
})

describe("exact-payload approvals, separation of duties and client authority", () => {
  let approvalId = ""
  let digest = ""

  it("operator proposes a USD 3,000 fee amendment awaiting finance", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const res = await executeCommand(ctx, proposeFeeAmendment, {
      idempotencyKey: key("fee"),
      payload: { job: AURORA, newAgencyFee: "23000.00", reason: "Price the 40 extra hours" },
      origin: "ui",
      expectedRevision: await jobRevision(AURORA),
    })
    approvalId = res.result.approvalId
    digest = res.result.payloadDigest
    expect(res.result.marginAfterBps).toBe(4348)
    const detail = await getApprovalDetail(ctx, approvalId)
    expect(detail?.approval.state).toBe("awaiting_approval")
    expect(detail?.viewer.canDecide).toBe(false)
  })

  it("blocks ineligible roles, the requester, and a mismatched digest", async () => {
    const decide = (userKey: string, reviewedDigest: string) =>
      ctxFor(userKey).then((ctx) =>
        executeCommand(ctx, decideApprovalCommand, {
          idempotencyKey: key(`decide-${userKey}`),
          payload: { approvalId, decision: "approve", reviewedDigest },
          origin: "ui",
        })
      )
    await expectDomainError(decide("user_demo_owner", digest), "approver_not_eligible")
    await expectDomainError(decide("user_demo_operator", digest), "forbidden")
    await expectDomainError(decide("user_demo_viewer", digest), "forbidden")
    // A UI or forged client cannot approve a different payload than the one bound.
    const stale = await decide("user_demo_finance", "0".repeat(64))
    expect(stale.result.outcome).toBe("stale")
  })

  it("re-proposed amendment approved by finance stays blocked until client authority covers 53,000", async () => {
    const operator = await ctxFor("user_demo_operator")
    const res = await executeCommand(operator, proposeFeeAmendment, {
      idempotencyKey: key("fee-2"),
      payload: { job: AURORA, newAgencyFee: "23000.00", reason: "Price the 40 extra hours" },
      origin: "ui",
      expectedRevision: await jobRevision(AURORA),
    })
    approvalId = res.result.approvalId
    const finance = await ctxFor("user_demo_finance")
    const decided = await executeCommand(finance, decideApprovalCommand, {
      idempotencyKey: key("decide-fin"),
      payload: { approvalId, decision: "approve", reviewedDigest: res.result.payloadDigest },
      origin: "ui",
    })
    expect(decided.result).toMatchObject({ outcome: "approved", executed: false, blockedCode: "client_authority_missing" })
    expect((await margin(AURORA)).marginBps).toBe(3500)

    // Client PO r2 (evidence) is a separate control with its own approval.
    // The owner reviews the received PO r2 document first (B06).
    await executeCommand(await ctxFor("user_demo_owner"), reviewEvidence, {
      idempotencyKey: key("po2-review"),
      payload: { evidence: id("ev:evidence_demo_po_r2"), decision: "reviewed", reason: "Client PO revision 2 checked against the amendment" },
      origin: "ui",
    })
    const po = await executeCommand(operator, recordClientAuthority, {
      idempotencyKey: key("po2"),
      payload: { job: AURORA, reference: "PO-AUR-2027-01", amount: "53000.00", evidenceId: id("ev:evidence_demo_po_r2") },
      origin: "ui",
    })
    const owner = await ctxFor("user_demo_owner")
    const poDecision = await executeCommand(owner, decideApprovalCommand, {
      idempotencyKey: key("po2-approve"),
      payload: { approvalId: po.result.approvalId, decision: "approve", reviewedDigest: po.result.payloadDigest },
      origin: "ui",
    })
    expect(poDecision.result).toMatchObject({ outcome: "approved", executed: true })

    const applied = await executeCommand(operator, executeApprovedCommand, {
      idempotencyKey: key("apply"),
      payload: { approvalId },
      origin: "ui",
    })
    expect(applied.result.executed).toBe(true)
    const p = await margin(AURORA)
    expect(p.agencyFeeMinor).toBe(2300000n)
    expect(p.marginMinor).toBe(1000000n)
    expect(p.marginBps).toBe(4348)

    // Consumed approvals cannot be replayed into a second execution.
    await expectDomainError(
      executeCommand(operator, executeApprovedCommand, { idempotencyKey: key("apply-again"), payload: { approvalId }, origin: "ui" }),
      "approval_required"
    )
    const events = await withTenant(owner.tenant.id, (tx) =>
      tx.select().from(businessEvent).where(and(eq(businessEvent.jobId, AURORA), eq(businessEvent.eventType, "budget.fee_amendment.applied")))
    )
    expect(events).toHaveLength(1)
    expect(events[0]!.actorUserId).toBe(id("user_demo_operator"))
  })

  it("the requester cannot approve their own client authority change", async () => {
    const owner = await ctxFor("user_demo_owner")
    const po = await executeCommand(owner, recordClientAuthority, {
      idempotencyKey: key("lab-po"),
      payload: { job: LAB, reference: "PO-LAB-2027-01", amount: "1200.00", evidenceId: id("ev:evidence_demo_c1_lab_po") },
      origin: "ui",
    })
    await expectDomainError(
      executeCommand(owner, decideApprovalCommand, {
        idempotencyKey: key("self"),
        payload: { approvalId: po.result.approvalId, decision: "approve", reviewedDigest: po.result.payloadDigest },
        origin: "ui",
      }),
      "self_approval"
    )
  })

  it("a material change after the request makes the pending approval stale", async () => {
    const operator = await ctxFor("user_demo_operator")
    const res = await executeCommand(operator, proposeFeeAmendment, {
      idempotencyKey: key("fee-3"),
      payload: { job: AURORA, newAgencyFee: "24000.00", reason: "Another change" },
      origin: "ui",
      expectedRevision: await jobRevision(AURORA),
    })
    await executeCommand(operator, recordCostEstimate, {
      idempotencyKey: key("est-after"),
      payload: { job: AURORA, laborMinutes: 8400, hourlyCost: "50.00", productionVendorAmount: "5600.00", expenseAmount: "500.00", reason: "Vendor quote changed" },
      origin: "ui",
      expectedRevision: await jobRevision(AURORA),
    })
    const detail = await getApprovalDetail(operator, res.result.approvalId)
    expect(detail?.approval.state).toBe("stale")
    const finance = await ctxFor("user_demo_finance")
    await expectDomainError(
      executeCommand(finance, decideApprovalCommand, {
        idempotencyKey: key("decide-stale"),
        payload: { approvalId: res.result.approvalId, decision: "approve", reviewedDigest: res.result.payloadDigest },
        origin: "ui",
      }),
      "blocked_by_rule"
    )
  })
})

describe("budget reservations under concurrency", () => {
  it("two concurrent 700.00 reservations against 1,000.00 authority: one succeeds", async () => {
    const ctx = await ctxFor("user_demo_operator")
    const attempt = (label: string) =>
      executeCommand(ctx, reserveBudget, {
        idempotencyKey: key(label),
        payload: { job: LAB, budgetScope: "client_commercial_authority", amount: "700.00", purpose: "Concurrent request" },
        origin: "ui",
      })
    const results = await Promise.allSettled([attempt("r1"), attempt("r2")])
    const ok = results.filter((r) => r.status === "fulfilled")
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[]
    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect((failed[0]!.reason as DomainError).code).toBe("blocked_by_rule")
    expect((ok[0] as PromiseFulfilledResult<{ result: { availableAfterMinor: string } }>).value.result.availableAfterMinor).toBe("30000")
  })
})

describe("permissions are enforced on the server", () => {
  it("viewer cannot create a client; producer cannot propose a fee", async () => {
    const viewer = await ctxFor("user_demo_viewer")
    await expectDomainError(
      executeCommand(viewer, createClientIntake, {
        idempotencyKey: key("viewer-client"),
        payload: { clientName: "X Co", clientCode: "XCO", productCode: "XX", billingCurrency: "USD", country: "US", briefTitle: "Brief", briefSummary: "A brief summary text" },
        origin: "ui",
      }),
      "forbidden"
    )
    const producer = await ctxFor("user_demo_producer")
    await expectDomainError(
      executeCommand(producer, proposeFeeAmendment, {
        idempotencyKey: key("producer-fee"),
        payload: { job: AURORA, newAgencyFee: "99999.00", reason: "Not allowed" },
        origin: "ui",
        expectedRevision: 1,
      }),
      "forbidden"
    )
  })

  it("browser-supplied identity fields are rejected by strict input schemas", async () => {
    const ctx = await ctxFor("user_demo_operator")
    await expectDomainError(
      executeCommand(ctx, reserveBudget, {
        idempotencyKey: key("forged"),
        payload: { job: LAB, budgetScope: "client_commercial_authority", amount: "1.00", purpose: "x y z", tenant_id: id("tenant_demo_norte"), role: "owner" },
        origin: "ui",
      }),
      "validation"
    )
  })
})

describe("capability runner", () => {
  it("persists a query run; rejects unknown skills and unauthorized roles before any replay or effect", async () => {
    const ctx = await ctxFor("user_demo_owner")
    const k = key("run")
    const run = await runCapability(ctx, "agency-profitability", { job: AURORA, basis: "forecast" }, { origin: "ui", idempotencyKey: k })
    expect(run.state).toBe("succeeded")
    expect((run.output as { marginBps: number }).marginBps).toBeTypeOf("number")
    const persisted = await withTenant(ctx.tenant.id, (tx) => tx.select().from(workflowRun).where(eq(workflowRun.id, run.runId)))
    expect(persisted[0]).toMatchObject({ skillId: "agency-profitability", state: "succeeded", idempotencyKey: k })

    // Not one of the 42 catalog ids: rejected, nothing recorded.
    await expectDomainError(runCapability(ctx, "agency-skill-43", {}, { origin: "ui", idempotencyKey: key("unknown") }), "not_found")

    // A viewer can open the payment-run workbench but lacks payables.manage: forbidden before validation or any run.
    const viewer = await ctxFor("user_demo_viewer")
    expect(viewer.permissions.has("payables.manage")).toBe(false)
    const pk = key("no-permission")
    await expectDomainError(runCapability(viewer, "agency-payment-run", {}, { origin: "ui", idempotencyKey: pk }), "forbidden")
    const runs = await withTenant(ctx.tenant.id, (tx) => tx.select().from(workflowRun).where(eq(workflowRun.idempotencyKey, pk)))
    expect(runs).toHaveLength(0)

    // A stored result is not replayed to a role that lost the permission.
    expect(viewer.permissions.has("reports.view")).toBe(true)
    const producer = await ctxFor("user_demo_producer")
    expect(producer.permissions.has("reports.view")).toBe(false)
    await expectDomainError(runCapability(producer, "agency-profitability", { job: AURORA, basis: "forecast" }, { origin: "ui", idempotencyKey: k }), "forbidden")
  })
})

describe("simulated provider adapter", () => {
  it("executes once per key and reconciles an unknown outcome without a second effect", async () => {
    const ctx = await ctxFor("user_demo_finance")
    await withTenant(ctx.tenant.id, async (tx) => {
      const base = {
        tenantId: ctx.tenant.id,
        provider: "demo_bank",
        accountAlias: "rayo_operating_demo",
        operationType: "payment.execute",
        payload: { amountMinor: 550000, currency: "USD", payee: "supplier_demo_lumen" },
      }
      const a = await simulatedProvider.execute(tx, { ...base, approvedActionId: "approval-ok" })
      const b = await simulatedProvider.execute(tx, { ...base, approvedActionId: "approval-ok" })
      expect(a.state).toBe("succeeded")
      expect(b).toMatchObject({ state: "succeeded", replayed: true })
      if (a.state === "succeeded" && b.state === "succeeded") expect(b.receiptId).toBe(a.receiptId)
      expect(a.state === "succeeded" && a.receiptId.startsWith("sim_")).toBe(true)

      const unknown = await simulatedProvider.execute(tx, { ...base, approvedActionId: "approval-timeout", failureMode: "timeout_after_effect" })
      expect(unknown.state).toBe("outcome_unknown")
      const retry = await simulatedProvider.execute(tx, { ...base, approvedActionId: "approval-timeout" })
      expect(retry.state).toBe("outcome_unknown")
      const rec = await simulatedProvider.reconcile(tx, ctx.tenant.id, unknown.operationId)
      expect(rec).toMatchObject({ state: "succeeded", effectCount: 1 })
      const effects = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(demoProviderEffect)
        .where(eq(demoProviderEffect.idempotencyKey, "payment.execute:approval-timeout"))
      expect(effects[0]!.n).toBe(1)
    })
  })
})

describe("dev database is untouched", () => {
  it("tests run against the dedicated test database", async () => {
    const [{ name }] = (await db().execute(sql`select current_database() as name`)) as unknown as { name: string }[]
    expect(name).toMatch(/^ageos_test(_[a-z0-9]+)?$/)
    expect(name).not.toBe("ageos_dev")
  })
})
