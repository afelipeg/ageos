import "server-only"

import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { MARGIN_FLOOR_BPS } from "@/lib/demo"
import type { AgencyContext } from "@/server/auth/context"
import type { Tx } from "@/server/db/client"
import { attentionItem, membership } from "@/server/db/schema"
import { assertRevision, defineCommand, type EmittedEvent } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import { getBusinessDate } from "./presenter"
import { computeProfitability, loadJobFinancials } from "./profitability"

// Explicit, versioned rules that open or resolve inbox items. Re-evaluating a
// rule is idempotent: one item per (rule, subject).

export const RULES = {
  marginFloor: { id: "margin-floor-v1", thresholdBps: MARGIN_FLOOR_BPS },
} as const

export async function evaluateMarginFloor(
  tx: Tx,
  tenantId: string,
  slug: string,
  jobId: string
): Promise<EmittedEvent[]> {
  const fin = await loadJobFinancials(tx, tenantId, jobId)
  const p = computeProfitability(fin, "forecast", slug)
  const below = p.marginBps !== null && p.marginBps < RULES.marginFloor.thresholdBps
  const subjectKey = `job:${jobId}`
  const [existing] = await tx
    .select()
    .from(attentionItem)
    .where(
      and(
        eq(attentionItem.tenantId, tenantId),
        eq(attentionItem.ruleId, RULES.marginFloor.id),
        eq(attentionItem.subjectKey, subjectKey)
      )
    )
    .limit(1)

  if (below) {
    const values = {
      tenantId,
      ruleId: RULES.marginFloor.id,
      subjectKey,
      jobId,
      moduleKey: "profitability",
      kind: "attention",
      severity: "attention",
      state: "open",
      title: {
        en: `Projected margin below ${RULES.marginFloor.thresholdBps / 100}% floor`,
        es: `Margen proyectado bajo el mínimo de ${RULES.marginFloor.thresholdBps / 100}%`,
      },
      effect: { marginBps: p.marginBps, thresholdBps: RULES.marginFloor.thresholdBps },
      ctaHref: `/a/${slug}/modules/clients-contracts/workflows/agency-fee-contracts?job=${jobId}`,
      ctaLabel: { en: "Review scope change", es: "Revisar cambio de alcance" },
      resolvedAt: null,
      updatedAt: new Date(),
    }
    if (!existing) {
      await tx.insert(attentionItem).values(values)
    } else if (existing.state === "resolved" || JSON.stringify(existing.effect) !== JSON.stringify(values.effect)) {
      await tx
        .update(attentionItem)
        .set({ ...values, revision: sql`${attentionItem.revision} + 1` })
        .where(eq(attentionItem.id, existing.id))
    }
    return [
      {
        eventType: "rule.margin_floor.breached",
        aggregateType: "job",
        aggregateId: jobId,
        jobId,
        payload: { marginBps: p.marginBps, thresholdBps: RULES.marginFloor.thresholdBps },
      },
    ]
  }
  if (existing && existing.state !== "resolved") {
    await tx
      .update(attentionItem)
      .set({
        state: "resolved",
        resolvedAt: new Date(),
        updatedAt: new Date(),
        effect: { marginBps: p.marginBps, thresholdBps: RULES.marginFloor.thresholdBps },
        revision: sql`${attentionItem.revision} + 1`,
      })
      .where(eq(attentionItem.id, existing.id))
    return [
      {
        eventType: "rule.margin_floor.resolved",
        aggregateType: "job",
        aggregateId: jobId,
        jobId,
        payload: { marginBps: p.marginBps },
      },
    ]
  }
  return []
}


// ── Inbox commands on attention items: assign, snooze, resolve ──
// Managers (jobs.manage or approvals.decide) triage any item; the assignee may
// snooze or resolve their own. Approval items resolve only through the
// approval decision; a blocking condition is never cleared by snoozing, and a
// rule-driven item resolves only when its rule confirms the condition is gone.

const Uuid = z.string().uuid()
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_SNOOZE_DAYS = 90

const canTriage = (ctx: AgencyContext) => ctx.permissions.has("jobs.manage") || ctx.permissions.has("approvals.decide")

async function lockItem(tx: Tx, ctx: AgencyContext, itemId: string, expectedRevision: number | undefined) {
  const [item] = await tx
    .select()
    .from(attentionItem)
    .where(and(eq(attentionItem.tenantId, ctx.tenant.id), eq(attentionItem.id, itemId)))
    .for("update")
    .limit(1)
  if (!item) throw new DomainError("not_found", "Inbox item not found", { field: "item" })
  assertRevision(item.revision, expectedRevision, "attention_item")
  if (item.state === "resolved") throw new DomainError("blocked_by_rule", "The item is already resolved", { rule: "item_resolved" })
  return item
}

function assertMayAct(ctx: AgencyContext, item: typeof attentionItem.$inferSelect) {
  if (!canTriage(ctx) && item.assigneeUserId !== ctx.user.id) {
    throw new DomainError("forbidden", "Only a manager or the assignee can change this item", { permissions: ["jobs.manage", "approvals.decide"] })
  }
}

const itemEvent = (item: typeof attentionItem.$inferSelect, eventType: string, revision: number, payload: Record<string, unknown>): EmittedEvent => ({
  eventType,
  aggregateType: "attention_item",
  aggregateId: item.id,
  aggregateRevision: revision,
  jobId: item.jobId,
  payload: { ruleId: item.ruleId, ...payload },
})

export const AssignInboxItemInput = z.object({ item: Uuid, assignee: Uuid }).strict()

export const assignInboxItem = defineCommand({
  type: "inbox.assign",
  skillId: null,
  permission: "workspace.view",
  input: AssignInboxItemInput,
  handler: async (tx, ctx, input, meta) => {
    if (!canTriage(ctx)) throw new DomainError("forbidden", "Only managers can assign inbox items", { permissions: ["jobs.manage", "approvals.decide"] })
    const item = await lockItem(tx, ctx, input.item, meta.expectedRevision)
    const [m] = await tx
      .select({ userId: membership.userId })
      .from(membership)
      .where(and(eq(membership.tenantId, ctx.tenant.id), eq(membership.userId, input.assignee), eq(membership.active, true)))
      .limit(1)
    if (!m) throw new DomainError("not_found", "Member not found", { field: "assignee" })
    if (item.assigneeUserId === input.assignee) throw new DomainError("validation", "The item is already assigned to this member", { field: "assignee" })
    const [row] = await tx
      .update(attentionItem)
      .set({ assigneeUserId: input.assignee, updatedAt: new Date(), revision: sql`${attentionItem.revision} + 1` })
      .where(eq(attentionItem.id, item.id))
      .returning()
    return {
      result: { itemId: item.id, assigneeUserId: input.assignee, state: row!.state, revision: row!.revision },
      events: [itemEvent(item, "inbox.item_assigned", row!.revision, { from: item.assigneeUserId, to: input.assignee })],
    }
  },
})

export const SnoozeInboxItemInput = z.object({ item: Uuid, until: IsoDate }).strict()

export const snoozeInboxItem = defineCommand({
  type: "inbox.snooze",
  skillId: null,
  permission: "workspace.view",
  input: SnoozeInboxItemInput,
  handler: async (tx, ctx, input, meta) => {
    const item = await lockItem(tx, ctx, input.item, meta.expectedRevision)
    assertMayAct(ctx, item)
    const today = await getBusinessDate()
    const days = Math.round((Date.parse(`${input.until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    if (!Number.isFinite(days) || days < 1 || days > MAX_SNOOZE_DAYS) {
      throw new DomainError("validation", `Snooze until a business date 1–${MAX_SNOOZE_DAYS} days after ${today}`, { field: "until", businessDate: today })
    }
    const [row] = await tx
      .update(attentionItem)
      .set({ state: "snoozed", snoozedUntil: new Date(`${input.until}T00:00:00Z`), updatedAt: new Date(), revision: sql`${attentionItem.revision} + 1` })
      .where(eq(attentionItem.id, item.id))
      .returning()
    return {
      result: { itemId: item.id, state: row!.state, snoozedUntil: input.until, revision: row!.revision, conditionCleared: false },
      // Snoozing hides the item until the date; the condition itself stays.
      events: [itemEvent(item, "inbox.item_snoozed", row!.revision, { until: input.until, businessDate: today, conditionCleared: false })],
    }
  },
})

export const ResolveInboxItemInput = z.object({ item: Uuid, note: z.string().trim().min(3).max(500) }).strict()

/** Rule checks that confirm a condition is gone before an item may resolve. */
const CONDITION_CHECKS: Record<string, (tx: Tx, ctx: AgencyContext, item: typeof attentionItem.$inferSelect) => Promise<{ present: boolean; detail: Record<string, unknown> }>> = {
  [RULES.marginFloor.id]: async (tx, ctx, item) => {
    if (!item.jobId) return { present: false, detail: {} }
    const p = computeProfitability(await loadJobFinancials(tx, ctx.tenant.id, item.jobId), "forecast", ctx.tenant.slug)
    return { present: p.marginBps !== null && p.marginBps < RULES.marginFloor.thresholdBps, detail: { marginBps: p.marginBps, thresholdBps: RULES.marginFloor.thresholdBps } }
  },
}

export const resolveInboxItem = defineCommand({
  type: "inbox.resolve",
  skillId: null,
  permission: "workspace.view",
  input: ResolveInboxItemInput,
  handler: async (tx, ctx, input, meta) => {
    const item = await lockItem(tx, ctx, input.item, meta.expectedRevision)
    assertMayAct(ctx, item)
    if (item.kind === "approval") {
      throw new DomainError("blocked_by_rule", "Approval items resolve only through the approval decision", { rule: "approval_resolves_by_decision" })
    }
    const check = CONDITION_CHECKS[item.ruleId]
    if (check) {
      const c = await check(tx, ctx, item)
      if (c.present) throw new DomainError("blocked_by_rule", "The condition still holds", { rule: "condition_still_present", ...c.detail })
    } else if (item.kind === "blocked") {
      // A blocking condition belongs to the flow that raised it.
      throw new DomainError("blocked_by_rule", "This blocker clears when its flow resolves the condition", { rule: "condition_owned_by_flow", ruleId: item.ruleId })
    }
    const [row] = await tx
      .update(attentionItem)
      .set({ state: "resolved", resolvedAt: new Date(), snoozedUntil: null, updatedAt: new Date(), revision: sql`${attentionItem.revision} + 1` })
      .where(eq(attentionItem.id, item.id))
      .returning()
    return {
      result: { itemId: item.id, state: row!.state, revision: row!.revision, verifiedByRule: Boolean(check) },
      events: [itemEvent(item, "inbox.item_resolved", row!.revision, { note: input.note, verifiedByRule: Boolean(check) })],
    }
  },
})
