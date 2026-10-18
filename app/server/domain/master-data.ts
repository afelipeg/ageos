import "server-only"

import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"

import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import { client, masterExternalRef, supplier } from "@/server/db/schema"
import { createProposal, invalidatePendingApprovals, registerApprovalPolicy, requestApproval } from "@/server/kernel/approvals"
import { defineCommand, type CommandMeta, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

// ── agency-master-data: upsertMasterRecord ──
// One master per legal identity. The same provider/external id or the same
// code + legal name resolves to the existing record (idempotent import). A
// probable duplicate (same normalized name, different code) becomes a merge
// PROPOSAL for someone else to approve — never an automatic merge. A conflict
// of legal identity (same code or external id, different name) is blocked.

const LEGAL_SUFFIXES = new Set(["inc", "llc", "ltd", "sa", "sas", "srl", "co", "corp", "corporation", "company", "de", "cv", "s", "a", "l"])

/** Comparable legal name: lowercase, no accents/punctuation/legal suffixes. */
export function normalizeLegalName(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop()
  return words.join(" ")
}

// Ledger accounts of the demo chart (contract journal policy / trial balance).
export const LEDGER_ACCOUNT_CODES = [
  "cash",
  "accounts_receivable",
  "unbilled_fee_asset",
  "agency_fee_revenue",
  "labor_expense",
  "payroll_payable",
  "production_expense",
  "accrued_production",
  "ap_production",
  "direct_expense",
  "expense_payable",
  "media_recovery_asset",
  "accrued_media",
  "ap_media",
  "opening_equity",
] as const

const DEFAULT_LEDGER_LINK: Record<"client" | "supplier", string> = {
  client: "accounts_receivable",
  supplier: "ap_production",
}

export const UpsertMasterRecordInput = z
  .object({
    recordType: z.enum(["client", "supplier", "account"]),
    code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Letters, digits, _ . -"),
    legalName: z.string().trim().min(2).max(160),
    country: z.enum(["US", "CA", "MX", "CO"]).optional(),
    externalMapping: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{2,40}:[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/, "provider:external_id")
      .optional(),
  })
  .strict()

type Input = z.infer<typeof UpsertMasterRecordInput>

export const MASTER_MERGE_POLICY = registerApprovalPolicy({ id: "master-merge-v1", revision: 1 })

type MasterRow = { id: string; code: string | null; name: string; revision: number }

async function findByExternal(tx: Tx, tenantId: string, recordType: string, provider: string, externalId: string) {
  const [ref] = await tx
    .select()
    .from(masterExternalRef)
    .where(
      and(
        eq(masterExternalRef.tenantId, tenantId),
        eq(masterExternalRef.recordType, recordType),
        eq(masterExternalRef.provider, provider),
        eq(masterExternalRef.externalId, externalId)
      )
    )
    .limit(1)
  return ref ?? null
}

async function loadMasters(tx: Tx, tenantId: string, recordType: "client" | "supplier"): Promise<MasterRow[]> {
  if (recordType === "client") {
    return tx.select({ id: client.id, code: client.code, name: client.name, revision: client.revision }).from(client).where(eq(client.tenantId, tenantId))
  }
  return tx
    .select({ id: supplier.id, code: supplier.code, name: supplier.name, revision: supplier.revision })
    .from(supplier)
    .where(eq(supplier.tenantId, tenantId))
}

async function addExternalRef(tx: Tx, ctx: AgencyContext, recordType: string, recordKey: string, mapping: { provider: string; externalId: string }) {
  const [row] = await tx
    .insert(masterExternalRef)
    .values({ tenantId: ctx.tenant.id, recordType, recordKey, ...mapping, createdBy: ctx.user.id })
    .onConflictDoNothing()
    .returning()
  return Boolean(row)
}

const conflict = (message: string, details: Record<string, unknown>) =>
  new DomainError("blocked_by_rule", message, { rule: "conflicting_legal_identity", ...details })

function outputs(args: {
  input: Input
  normalized: string
  changes: { op: string; recordType: string; recordId: string }[]
  duplicates: { recordId: string; code: string | null; name: string; reason: string }[]
  recordKey: string | null
  approvals: { proposalId: string; approvalId: string; payloadDigest: string; eligibleRoles: readonly string[] }[]
  externalMap: { provider: string; externalId: string; recordKey: string }[]
}) {
  const { input } = args
  return {
    outcome: args.changes[0]?.op ?? "unchanged",
    recordId: args.recordKey,
    master_change_set: args.changes,
    validation_report: {
      recordType: input.recordType,
      code: input.code,
      normalizedName: args.normalized,
      checks: ["code_format", "external_mapping_unique", "legal_identity_consistent", "duplicate_name_scan"],
    },
    duplicate_candidates: args.duplicates,
    ledger_link_map:
      args.recordKey === null
        ? []
        : [
            {
              recordType: input.recordType,
              recordKey: args.recordKey,
              ledgerAccount: input.recordType === "account" ? input.code : DEFAULT_LEDGER_LINK[input.recordType],
            },
          ],
    external_code_map: args.externalMap,
    deactivation_plan: { applicable: false, reason: "no_deactivation_requested" },
    provisional_approval_requests: args.approvals,
  }
}

export const upsertMasterRecord = defineCommand({
  type: "masterData.upsert",
  skillId: "agency-master-data",
  permission: "clients.manage",
  input: UpsertMasterRecordInput,
  handler: async (tx, ctx, input, meta: CommandMeta) => {
    const normalized = normalizeLegalName(input.legalName)
    if (!normalized) throw new DomainError("validation", "The legal name has no comparable characters", { field: "legalName" })
    const mapping = input.externalMapping
      ? { provider: input.externalMapping.split(":")[0]!, externalId: input.externalMapping.slice(input.externalMapping.indexOf(":") + 1) }
      : null
    const changes: { op: string; recordType: string; recordId: string }[] = []
    const events: EmittedEvent[] = []

    // Ledger accounts: the chart is fixed in this build; mapping only.
    if (input.recordType === "account") {
      if (!(LEDGER_ACCOUNT_CODES as readonly string[]).includes(input.code)) {
        throw new DomainError("blocked_by_rule", "Unknown ledger account", { rule: "unknown_ledger_account", code: input.code })
      }
      const externalMap: { provider: string; externalId: string; recordKey: string }[] = []
      if (mapping) {
        const ref = await findByExternal(tx, ctx.tenant.id, "account", mapping.provider, mapping.externalId)
        if (ref && ref.recordKey !== input.code) throw conflict("This external id already maps to another account", { recordKey: ref.recordKey })
        if (!ref && (await addExternalRef(tx, ctx, "account", input.code, mapping))) changes.push({ op: "mapping_added", recordType: "account", recordId: input.code })
        externalMap.push({ ...mapping, recordKey: input.code })
      }
      if (!changes.length) changes.push({ op: "resolved", recordType: "account", recordId: input.code })
      events.push({
        eventType: changes[0]!.op === "resolved" ? "master_data.resolved" : "master_data.mapping_added",
        aggregateType: "account",
        aggregateId: null,
        payload: { code: input.code, mapping },
      })
      return { result: outputs({ input, normalized, changes, duplicates: [], recordKey: input.code, approvals: [], externalMap }), events }
    }

    const recordType = input.recordType
    // Serialize upserts of the same master type within the agency.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`master:${ctx.tenant.id}:${recordType}`}))`)
    const masters = await loadMasters(tx, ctx.tenant.id, recordType)

    let target: MasterRow | null = null
    if (mapping) {
      const ref = await findByExternal(tx, ctx.tenant.id, recordType, mapping.provider, mapping.externalId)
      if (ref) {
        target = masters.find((m) => m.id === ref.recordKey) ?? null
        if (target && (normalizeLegalName(target.name) !== normalized || (target.code !== null && target.code !== input.code))) {
          throw conflict("This external id already belongs to a master with another legal identity", { recordId: target.id })
        }
      }
    }
    const byCode = masters.find((m) => m.code === input.code) ?? null
    if (byCode && normalizeLegalName(byCode.name) !== normalized) {
      throw conflict("This code already belongs to another legal identity", { recordId: byCode.id, code: input.code })
    }
    target = target ?? byCode
    const externalMap: { provider: string; externalId: string; recordKey: string }[] = []

    if (target) {
      // Same identity → resolve to the one master; only add a missing mapping.
      if (recordType === "supplier" && target.code === null) {
        await tx
          .update(supplier)
          .set({ code: input.code, updatedAt: new Date(), updatedBy: ctx.user.id, revision: sql`${supplier.revision} + 1` })
          .where(and(eq(supplier.tenantId, ctx.tenant.id), eq(supplier.id, target.id)))
        changes.push({ op: "code_assigned", recordType, recordId: target.id })
      }
      if (mapping) {
        if (await addExternalRef(tx, ctx, recordType, target.id, mapping)) changes.push({ op: "mapping_added", recordType, recordId: target.id })
        externalMap.push({ ...mapping, recordKey: target.id })
      }
      if (!changes.length) changes.push({ op: "resolved", recordType, recordId: target.id })
      // A repeated import is audited as resolved to the same master.
      events.push({
        eventType: changes[0]!.op === "resolved" ? "master_data.resolved" : "master_data.updated",
        aggregateType: recordType,
        aggregateId: target.id,
        payload: { code: input.code, changes: changes.map((c) => c.op), mapping },
      })
      return { result: outputs({ input, normalized, changes, duplicates: [], recordKey: target.id, approvals: [], externalMap }), events }
    }

    // Probable duplicate under another code → merge proposal, never a merge.
    const duplicates = masters
      .filter((m) => normalizeLegalName(m.name) === normalized)
      .map((m) => ({ recordId: m.id, code: m.code, name: m.name, reason: "same_normalized_legal_name" }))
    if (duplicates.length) {
      const into = masters.find((m) => m.id === duplicates[0]!.recordId)!
      await invalidatePendingApprovals(tx, ctx.tenant.id, recordType, into.id)
      const payload = {
        action: "master.merge",
        recordType,
        intoRecordId: into.id,
        intoRevision: into.revision,
        aliasCode: input.code,
        legalName: input.legalName,
        normalizedName: normalized,
        mapping,
      }
      const proposal = await createProposal(
        tx,
        ctx,
        {
          actionType: "master.merge",
          skillId: "agency-master-data",
          aggregateType: recordType,
          aggregateId: into.id,
          baseRevision: into.revision,
          payload,
          diff: { aliasCodes: { add: input.code }, externalIds: { add: input.externalMapping ?? null } },
          impact: { note: "Maps the incoming code and external id onto the existing master; no second record is created." },
          origin: meta.origin,
        },
        "awaiting_approval"
      )
      const eligibleRoles = ["owner", "finance_approver"] as const
      const { approval, events: approvalEvents } = await requestApproval(tx, ctx, proposal, {
        policyId: MASTER_MERGE_POLICY.id,
        policyRevision: MASTER_MERGE_POLICY.revision,
        eligibleRoles,
        title: `Merge ${input.code} into ${into.name}`,
        destination: `${recordType}:${into.id}`,
        expiresInHours: 24 * 7,
      })
      changes.push({ op: "merge_proposed", recordType, recordId: into.id })
      return {
        result: outputs({
          input,
          normalized,
          changes,
          duplicates,
          recordKey: null,
          approvals: [{ proposalId: proposal.id, approvalId: approval.id, payloadDigest: proposal.payloadDigest, eligibleRoles }],
          externalMap,
        }),
        events: [
          { eventType: "master_data.merge_proposed", aggregateType: recordType, aggregateId: into.id, payload: { ...payload, proposalId: proposal.id } },
          ...approvalEvents,
        ],
      }
    }

    if (recordType === "client") {
      // Clients carry billing identity and product codes: they are created by
      // agency-onboarding, never invented here.
      throw new DomainError("blocked_by_rule", "New clients are created through client onboarding", { rule: "client_intake_required" })
    }
    const [created] = await tx
      .insert(supplier)
      .values({
        tenantId: ctx.tenant.id,
        code: input.code,
        name: input.legalName,
        country: input.country ?? "US",
        currency: ctx.tenant.baseCurrency,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning()
    changes.push({ op: "created", recordType, recordId: created!.id })
    if (mapping && (await addExternalRef(tx, ctx, recordType, created!.id, mapping))) externalMap.push({ ...mapping, recordKey: created!.id })
    return {
      result: outputs({ input, normalized, changes, duplicates: [], recordKey: created!.id, approvals: [], externalMap }),
      events: [
        {
          eventType: "master_data.created",
          aggregateType: "supplier",
          aggregateId: created!.id,
          aggregateRevision: created!.revision,
          payload: { code: input.code, name: input.legalName, mapping },
        },
      ],
    }
  },
})

type MergePayload = {
  recordType: "client" | "supplier"
  intoRecordId: string
  intoRevision: number
  aliasCode: string
  normalizedName: string
  mapping: { provider: string; externalId: string } | null
}

/** Approval executor for master.merge: maps alias code + external id. */
export async function applyMasterMerge(
  tx: Tx,
  ctx: AgencyContext,
  payload: MergePayload,
  mode: "check" | "apply"
): Promise<{ ok: true; events: EmittedEvent[] } | { ok: false; code: string; details: Record<string, unknown> }> {
  const masters = await loadMasters(tx, ctx.tenant.id, payload.recordType)
  const into = masters.find((m) => m.id === payload.intoRecordId)
  if (!into || into.revision !== payload.intoRevision || normalizeLegalName(into.name) !== payload.normalizedName) {
    return { ok: false, code: "approval_stale", details: { recordId: payload.intoRecordId } }
  }
  if (masters.some((m) => m.code === payload.aliasCode && m.id !== into.id)) {
    return { ok: false, code: "conflicting_legal_identity", details: { code: payload.aliasCode } }
  }
  if (payload.mapping) {
    const ref = await findByExternal(tx, ctx.tenant.id, payload.recordType, payload.mapping.provider, payload.mapping.externalId)
    if (ref && ref.recordKey !== into.id) return { ok: false, code: "conflicting_legal_identity", details: { externalId: payload.mapping.externalId } }
  }
  if (mode === "check") return { ok: true, events: [] }
  await addExternalRef(tx, ctx, payload.recordType, into.id, { provider: "code_alias", externalId: payload.aliasCode })
  if (payload.mapping) await addExternalRef(tx, ctx, payload.recordType, into.id, payload.mapping)
  return {
    ok: true,
    events: [
      {
        eventType: "master_data.merged",
        aggregateType: payload.recordType,
        aggregateId: into.id,
        payload: { aliasCode: payload.aliasCode, mapping: payload.mapping },
      },
    ],
  }
}
