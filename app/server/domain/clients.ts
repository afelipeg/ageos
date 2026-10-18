import "server-only"

import { and, asc, eq, ilike, sql } from "drizzle-orm"
import { z } from "zod"

import { parseDecimalToMinor } from "@/lib/money"
import type { AgencyContext } from "@/server/auth/context"
import { brief, client, contract, job, legalEntity } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { defineCommand, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { isUuid } from "./jobs"
import { normalizeLegalName } from "./master-data"

// ── agency-onboarding: createClientIntake ──
// One client per legal identity: the same code + legal name resolves to the
// existing client (no duplicate) and the same brief title is reused. A billing
// identity that cannot be established (no agency legal entity, or no demo
// fiscal profile for the client's country) is a visible blocker, never filled
// with invented data.

// Synthetic fiscal profiles enabled in this demo (contract 03 §6.10).
const DEMO_FISCAL_PROFILES: Partial<Record<string, string>> = { US: "DEMO_NO_TAX", CA: "DEMO_NO_TAX", MX: "DEMO_NO_TAX" }

export const CreateClientIntakeInput = z
  .object({
    clientName: z.string().trim().min(2).max(120),
    clientCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{3}$/, "3 uppercase letters or digits"),
    productCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{2}$/, "2 uppercase letters or digits"),
    billingCurrency: z.enum(["USD", "CAD", "MXN"]),
    country: z.enum(["US", "CA", "MX", "CO"]),
    creditLimit: z.string().trim().max(24).optional(),
    briefTitle: z.string().trim().min(3).max(160),
    briefSummary: z.string().trim().min(10).max(2000),
  })
  .strict()

export const createClientIntake = defineCommand({
  type: "clients.createIntake",
  skillId: "agency-onboarding",
  permission: "clients.manage",
  input: CreateClientIntakeInput,
  handler: async (tx, ctx, input) => {
    const normalized = normalizeLegalName(input.clientName)
    // Billing identity: the agency entity that bills and the client's fiscal profile.
    const fiscalProfile = DEMO_FISCAL_PROFILES[input.country]
    const [entity] = await tx.select().from(legalEntity).where(eq(legalEntity.tenantId, ctx.tenant.id)).orderBy(asc(legalEntity.createdAt)).limit(1)
    const identityGaps = [
      ...(fiscalProfile ? [] : [{ code: "fiscal_profile_missing", country: input.country }]),
      ...(entity ? [] : [{ code: "billing_entity_missing" }]),
    ]
    if (identityGaps.length) {
      throw new DomainError("blocked_by_rule", "The client's billing identity is incomplete", {
        rule: "billing_identity_missing",
        intake_gaps: identityGaps,
      })
    }
    let creditLimitMinor = 0n
    if (input.creditLimit) {
      try {
        creditLimitMinor = parseDecimalToMinor(input.creditLimit, input.billingCurrency)
      } catch {
        throw new DomainError("validation", "Invalid credit limit", { field: "creditLimit" })
      }
      if (creditLimitMinor < 0n) throw new DomainError("validation", "Invalid credit limit", { field: "creditLimit" })
    }
    // Serialize intakes per agency so two requests cannot create twins.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`master:${ctx.tenant.id}:client`}))`)
    const clients = await tx.select().from(client).where(eq(client.tenantId, ctx.tenant.id))
    const byCode = clients.find((c) => c.code === input.clientCode) ?? null
    if (byCode && (normalizeLegalName(byCode.name) !== normalized || byCode.billingCurrency !== input.billingCurrency || byCode.productCode !== input.productCode)) {
      throw new DomainError("blocked_by_rule", "This client code already belongs to another client identity", {
        rule: "conflicting_client_identity",
        field: "clientCode",
        clientId: byCode.id,
      })
    }
    const sameName = clients.filter((c) => c.id !== byCode?.id && normalizeLegalName(c.name) === normalized)
    if (!byCode && sameName.length) {
      throw new DomainError("blocked_by_rule", "A client with this legal name exists under another code; propose a merge in master data", {
        rule: "duplicate_client_name",
        duplicate_candidates: sameName.map((c) => ({ id: c.id, code: c.code, name: c.name })),
      })
    }
    const events: EmittedEvent[] = []
    // Same identity → the existing client (no twin); otherwise a new client.
    const c =
      byCode ??
      (
        await tx
          .insert(client)
          .values({
            tenantId: ctx.tenant.id,
            legalEntityId: entity!.id,
            name: input.clientName,
            code: input.clientCode,
            productCode: input.productCode,
            billingCurrency: input.billingCurrency,
            creditLimitMinor,
            country: input.country,
            fiscalProfile: fiscalProfile!,
            ownerUserId: ctx.user.id,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          })
          .returning()
      )[0]!
    const [existingBrief] = await tx
      .select()
      .from(brief)
      .where(and(eq(brief.tenantId, ctx.tenant.id), eq(brief.clientId, c.id), ilike(brief.title, input.briefTitle.replace(/[\\%_]/g, (m) => `\\${m}`))))
      .limit(1)
    const b =
      existingBrief ??
      (
        await tx
          .insert(brief)
          .values({
            tenantId: ctx.tenant.id,
            clientId: c.id,
            title: input.briefTitle,
            summary: input.briefSummary,
            services: [],
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          })
          .returning()
      )[0]!
    const jobs = await tx
      .select({ id: job.id, jobNumber: job.jobNumber, displayReference: job.displayReference, state: job.state })
      .from(job)
      .where(and(eq(job.tenantId, ctx.tenant.id), eq(job.clientId, c.id)))
    const [approvedPo] = await tx
      .select({ id: contract.id })
      .from(contract)
      .where(and(eq(contract.tenantId, ctx.tenant.id), eq(contract.clientId, c.id), eq(contract.state, "approved")))
      .limit(1)
    const intakeGaps = [
      ...(approvedPo ? [] : [{ code: "client_po_missing", next: "agency-contract-po" }]),
      ...(jobs.length ? [] : [{ code: "no_job_yet", next: "agency-job-lifecycle" }]),
      ...(c.creditLimitMinor > 0n ? [] : [{ code: "credit_limit_not_set" }]),
    ]
    const created = !byCode
    events.push({
      eventType: created ? "client.intake_created" : existingBrief ? "client.intake_resolved" : "client.brief_added",
      aggregateType: "client",
      aggregateId: c.id,
      aggregateRevision: c.revision,
      payload: { code: c.code, briefId: b.id, duplicateAvoided: !created, intakeGaps: intakeGaps.map((g) => g.code) },
    })
    return {
      result: {
        clientId: c.id,
        briefId: b.id,
        duplicateAvoided: !created,
        briefReused: Boolean(existingBrief),
        pendingRequirements: intakeGaps.map((g) => g.code),
        intake_pack: { clientId: c.id, briefId: b.id, code: c.code, productCode: c.productCode, legalEntityId: c.legalEntityId, created, briefReused: Boolean(existingBrief) },
        owner_client_draft: {
          clientId: c.id,
          name: c.name,
          code: c.code,
          billingCurrency: c.billingCurrency,
          country: c.country,
          creditLimitMinor: c.creditLimitMinor,
          ownerUserId: c.ownerUserId,
          state: c.state,
        },
        billing_client_links: [{ clientId: c.id, legalEntityId: c.legalEntityId, fiscalProfile: c.fiscalProfile, billingCurrency: c.billingCurrency }],
        product_drafts: [{ clientCode: c.code, productCode: c.productCode }],
        attention_group_plan: [{ group: "account_team", ownerUserId: c.ownerUserId, linkedJobs: jobs }],
        provisional_approval_requests: { applicable: false, reason: "intake_requires_no_internal_approval" },
        brief_draft: { briefId: b.id, title: b.title, summary: b.summary },
        intake_gaps: intakeGaps,
      },
      events,
    }
  },
})

export async function getClientDetail(ctx: AgencyContext, clientId: string) {
  if (!isUuid(clientId)) return null
  return withTenant(ctx.tenant.id, async (tx) => {
    const [c] = await tx
      .select()
      .from(client)
      .where(and(eq(client.tenantId, ctx.tenant.id), eq(client.id, clientId)))
      .limit(1)
    if (!c) return null
    const jobs = await tx
      .select({ id: job.id, name: job.name, jobNumber: job.jobNumber, displayReference: job.displayReference, state: job.state })
      .from(job)
      .where(and(eq(job.tenantId, ctx.tenant.id), eq(job.clientId, c.id)))
    const contracts = await tx
      .select()
      .from(contract)
      .where(and(eq(contract.tenantId, ctx.tenant.id), eq(contract.clientId, c.id)))
    const briefs = await tx
      .select()
      .from(brief)
      .where(and(eq(brief.tenantId, ctx.tenant.id), eq(brief.clientId, c.id)))
    return { client: c, jobs, contracts, briefs }
  })
}
