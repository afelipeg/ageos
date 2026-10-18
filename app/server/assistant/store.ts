import "server-only"

import { and, asc, desc, eq, gt, inArray, max, sql } from "drizzle-orm"

import type { ConversationView, MessagePart, MessageView, RunView, SourceRefView, SuggestionView } from "@/lib/assistant/types"
import { GOVERNANCE } from "@/lib/capabilities/governance"
import type { Permission } from "@/lib/policy"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import {
  actionProposal,
  approvalRequest,
  assistantConversation,
  assistantMessage,
  assistantRun,
  assistantRunEvent,
  budgetRevision,
  client,
  costEstimate,
  job,
} from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { HANDLERS } from "@/server/capabilities/registry"
import { DomainError } from "@/server/kernel/errors"

import type { RunLease, Scenario } from "./scenario-types"

// Conversation persistence. Every read is scoped by tenant (RLS) AND owner:
// knowing a conversation id grants nothing. Owning a thread does not grant
// its content either: parts are re-authorized against the viewer's CURRENT
// permissions and record availability on every read (B08), so a revoked
// permission hides persisted results without sending their values.

export const ASSISTANT_SCHEMA_VERSION = "assistant@2"
export const ACTIVE_RUN_STATES = ["queued", "running", "waiting_input", "waiting_confirmation", "waiting_approval"] as const

export function isLeaseLive(lease: RunLease | null | undefined, now: Date) {
  return Boolean(lease && new Date(lease.until).getTime() > now.getTime())
}

export async function getOwnedConversation(tx: Tx, ctx: AgencyContext, conversationId: string) {
  const [c] = await tx
    .select()
    .from(assistantConversation)
    .where(
      and(
        eq(assistantConversation.tenantId, ctx.tenant.id),
        eq(assistantConversation.id, conversationId),
        eq(assistantConversation.ownerUserId, ctx.user.id)
      )
    )
    .limit(1)
  if (!c) throw new DomainError("not_found", "Conversation not found")
  return c
}

export async function createConversation(tx: Tx, ctx: AgencyContext, title: string) {
  const [c] = await tx
    .insert(assistantConversation)
    .values({
      tenantId: ctx.tenant.id,
      ownerUserId: ctx.user.id,
      scope: "agency",
      title,
      schemaVersion: ASSISTANT_SCHEMA_VERSION,
    })
    .returning()
  return c!
}

export async function latestConversation(tx: Tx, ctx: AgencyContext) {
  const [c] = await tx
    .select()
    .from(assistantConversation)
    .where(
      and(
        eq(assistantConversation.tenantId, ctx.tenant.id),
        eq(assistantConversation.ownerUserId, ctx.user.id),
        eq(assistantConversation.state, "active")
      )
    )
    .orderBy(desc(assistantConversation.updatedAt))
    .limit(1)
  return c ?? null
}

export async function appendMessage(
  tx: Tx,
  ctx: AgencyContext,
  input: {
    conversationId: string
    role: "user" | "assistant"
    parts: MessagePart[]
    clientMessageId?: string | null
    runId?: string | null
  }
) {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(${max(assistantMessage.sequence)}, 0) + 1` })
    .from(assistantMessage)
    .where(and(eq(assistantMessage.tenantId, ctx.tenant.id), eq(assistantMessage.conversationId, input.conversationId)))
  const [m] = await tx
    .insert(assistantMessage)
    .values({
      tenantId: ctx.tenant.id,
      conversationId: input.conversationId,
      role: input.role,
      parts: input.parts as object,
      sequence: next,
      actorUserId: input.role === "user" ? ctx.user.id : null,
      clientMessageId: input.clientMessageId ?? null,
      runId: input.runId ?? null,
      schemaVersion: ASSISTANT_SCHEMA_VERSION,
    })
    .returning()
  await tx
    .update(assistantConversation)
    .set({ updatedAt: new Date() })
    .where(eq(assistantConversation.id, input.conversationId))
  return m!
}

export async function recentUserTurns(tx: Tx, ctx: AgencyContext, sinceMs: number) {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(assistantMessage)
    .where(
      and(
        eq(assistantMessage.tenantId, ctx.tenant.id),
        eq(assistantMessage.actorUserId, ctx.user.id),
        eq(assistantMessage.role, "user"),
        gt(assistantMessage.createdAt, new Date(Date.now() - sinceMs))
      )
    )
  return n
}

export async function activeRun(tx: Tx, tenantId: string, conversationId: string) {
  const [r] = await tx
    .select()
    .from(assistantRun)
    .where(
      and(
        eq(assistantRun.tenantId, tenantId),
        eq(assistantRun.conversationId, conversationId),
        inArray(assistantRun.status, [...ACTIVE_RUN_STATES])
      )
    )
    .for("update")
    .limit(1)
  return r ?? null
}

export async function addRunEvent(
  tx: Tx,
  tenantId: string,
  runId: string,
  e: { stepId: string; stepType: string; outcome: string; detail?: Record<string, unknown> }
) {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(${max(assistantRunEvent.sequence)}, 0) + 1` })
    .from(assistantRunEvent)
    .where(and(eq(assistantRunEvent.tenantId, tenantId), eq(assistantRunEvent.runId, runId)))
  await tx.insert(assistantRunEvent).values({
    tenantId,
    runId,
    sequence: next,
    stepId: e.stepId,
    stepType: e.stepType,
    outcome: e.outcome,
    detail: e.detail ?? {},
  })
}

function toRunView(r: typeof assistantRun.$inferSelect | null, now: Date): RunView | null {
  if (!r) return null
  const lease = (r.state as { lease?: RunLease | null } | null)?.lease ?? null
  return {
    id: r.id,
    scenarioId: r.scenarioId,
    scenarioVersion: r.scenarioVersion,
    status: r.status,
    currentStep: r.currentStep,
    resumable: r.status === "running" && !isLeaseLive(lease, now),
  }
}

// ── Read-time authorization of persisted parts (B08) ──

function skillReadPermissions(skillId: string | undefined): Permission[] {
  const g = skillId ? GOVERNANCE[skillId] : undefined
  if (!g) return []
  const kind = HANDLERS[skillId!]?.kind ?? g.handlerKind
  return kind === "query" ? [g.viewPermission, g.executePermission] : [g.viewPermission]
}

/** Permissions a viewer needs today to see this part (server-derived, never from the part's own claims). */
export function partPermissions(part: MessagePart, scenario: Pick<Scenario, "readPermissions"> | null): Permission[] {
  const base = scenario?.readPermissions ?? []
  switch (part.type) {
    case "user_text":
    case "suggestions":
    case "blocked":
    case "restricted":
      return []
    case "text":
      return part.params && Object.keys(part.params).length ? base : []
    case "margin_result":
      return [...base, "reports.view"]
    case "openui_view":
    case "capability_result":
    case "approval_request":
    case "capability_status":
      return [...base, ...skillReadPermissions(part.skillId)]
    case "proposal":
      return [...base, ...skillReadPermissions(part.skillId)]
    default:
      return base
  }
}

type SourceCheck = (tx: Tx, tenantId: string, ids: string[]) => Promise<Set<string>>

const existing =
  (table: typeof job | typeof budgetRevision | typeof costEstimate | typeof client): SourceCheck =>
  async (tx, tenantId, ids) => {
    if (!ids.length) return new Set()
    const rows = await tx.select({ id: table.id }).from(table).where(and(eq(table.tenantId, tenantId), inArray(table.id, ids)))
    return new Set(rows.map((r) => r.id))
  }

const SOURCE_CHECKS: Record<string, SourceCheck> = {
  job: existing(job),
  budget_revision: existing(budgetRevision),
  cost_estimate: existing(costEstimate),
  client: existing(client),
}

/**
 * Projects stored parts for the current viewer: parts whose permissions are
 * missing are replaced by one `restricted` marker (no values), sources are
 * re-checked for existence inside the tenant and must link inside the agency.
 */
export function projectParts(
  ctx: AgencyContext,
  parts: MessagePart[],
  scenario: Pick<Scenario, "readPermissions"> | null,
  available: (ref: SourceRefView) => boolean
): MessagePart[] {
  const out: MessagePart[] = []
  const restrict = (permission: string | undefined, reason: "permission" | "record_unavailable" = "permission", n = 1) => {
    const last = out[out.length - 1]
    if (last?.type === "restricted" && last.reason === reason) last.count = (last.count ?? 1) + n
    else out.push({ type: "restricted", reason, permission, count: n })
  }
  for (const p of parts) {
    const missing = partPermissions(p, scenario).find((perm) => !ctx.permissions.has(perm))
    if (missing) {
      restrict(missing)
      continue
    }
    if (p.type === "sources") {
      const base = `/a/${ctx.tenant.slug}/`
      const refs = p.refs.filter((r) => r.href.startsWith(base) && available(r))
      if (refs.length) out.push({ ...p, refs })
      if (refs.length < p.refs.length) restrict(undefined, "record_unavailable", p.refs.length - refs.length)
      continue
    }
    out.push(p)
  }
  return out
}

export async function conversationView(
  ctx: AgencyContext,
  conversationId: string | null,
  suggestions: SuggestionView[],
  scenarioLookup: (id: string, version: string) => Pick<Scenario, "readPermissions"> | null = () => null,
  now: Date = new Date()
): Promise<{ conversation: ConversationView | null; messages: MessageView[]; suggestions: SuggestionView[] }> {
  return withTenant(ctx.tenant.id, async (tx) => {
    const conv = conversationId ? await getOwnedConversation(tx, ctx, conversationId) : await latestConversation(tx, ctx)
    const history = await tx
      .select({ id: assistantConversation.id, title: assistantConversation.title, updatedAt: assistantConversation.updatedAt })
      .from(assistantConversation)
      .where(and(eq(assistantConversation.tenantId, ctx.tenant.id), eq(assistantConversation.ownerUserId, ctx.user.id)))
      .orderBy(desc(assistantConversation.updatedAt))
      .limit(20)
    if (!conv) {
      return { conversation: null, messages: [], suggestions }
    }
    const rows = await tx
      .select()
      .from(assistantMessage)
      .where(and(eq(assistantMessage.tenantId, ctx.tenant.id), eq(assistantMessage.conversationId, conv.id)))
      .orderBy(asc(assistantMessage.sequence))
    const runIds = [...new Set(rows.map((r) => r.runId).filter(Boolean) as string[])]
    const runs = runIds.length
      ? await tx.select().from(assistantRun).where(and(eq(assistantRun.tenantId, ctx.tenant.id), inArray(assistantRun.id, runIds)))
      : []
    const [current] = await tx
      .select()
      .from(assistantRun)
      .where(
        and(
          eq(assistantRun.tenantId, ctx.tenant.id),
          eq(assistantRun.conversationId, conv.id),
          inArray(assistantRun.status, [...ACTIVE_RUN_STATES])
        )
      )
      .limit(1)
    const allParts = rows.flatMap((m) => m.parts as MessagePart[])

    // Proposal and approval cards always show their current server state.
    const proposalIds = allParts.flatMap((p) => (p.type === "proposal" ? [p.proposalId] : []))
    const approvalIds = allParts.flatMap((p) => (p.type === "approval_request" ? [p.approvalId] : []))
    const proposals = proposalIds.length
      ? await tx.select({ id: actionProposal.id, state: actionProposal.state }).from(actionProposal).where(and(eq(actionProposal.tenantId, ctx.tenant.id), inArray(actionProposal.id, proposalIds)))
      : []
    const approvals = approvalIds.length
      ? await tx.select({ id: approvalRequest.id, state: approvalRequest.state }).from(approvalRequest).where(and(eq(approvalRequest.tenantId, ctx.tenant.id), inArray(approvalRequest.id, approvalIds)))
      : []
    const proposalState = new Map(proposals.map((p) => [p.id, p.state]))
    const approvalState = new Map(approvals.map((a) => [a.id, a.state]))

    // Source availability, re-checked inside the tenant for known record types.
    const refsByType = new Map<string, Set<string>>()
    for (const p of allParts) if (p.type === "sources") for (const r of p.refs) if (SOURCE_CHECKS[r.recordType] && /^[0-9a-f-]{36}$/i.test(r.recordId)) refsByType.set(r.recordType, (refsByType.get(r.recordType) ?? new Set()).add(r.recordId))
    const present = new Map<string, Set<string>>()
    for (const [type, ids] of refsByType) present.set(type, await SOURCE_CHECKS[type]!(tx, ctx.tenant.id, [...ids]))
    const available = (r: SourceRefView) => (SOURCE_CHECKS[r.recordType] ? Boolean(present.get(r.recordType)?.has(r.recordId)) : true)

    const live = (parts: MessagePart[]) =>
      parts.map((p) =>
        p.type === "proposal"
          ? { ...p, state: proposalState.get(p.proposalId) ?? p.state }
          : p.type === "approval_request"
            ? { ...p, state: approvalState.get(p.approvalId) ?? p.state }
            : p
      )
    return {
      suggestions,
      conversation: {
        id: conv.id,
        title: conv.title,
        updatedAt: conv.updatedAt.toISOString(),
        activeRun: toRunView(current ?? null, now),
        suggestions,
        history: history.map((h) => ({ id: h.id, title: h.title, updatedAt: h.updatedAt.toISOString() })),
      },
      messages: rows.map((m) => {
        const run = runs.find((r) => r.id === m.runId) ?? null
        const scenario = run ? scenarioLookup(run.scenarioId, run.scenarioVersion) : null
        return {
          id: m.id,
          role: m.role as "user" | "assistant",
          parts: projectParts(ctx, live(m.parts as MessagePart[]), scenario, available),
          sequence: m.sequence,
          createdAt: m.createdAt.toISOString(),
          scenarioId: run?.scenarioId ?? null,
        }
      }),
    }
  })
}
