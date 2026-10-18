import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { MARGIN_FLOOR_BPS } from "@/lib/demo"
import type { Tx } from "@/server/db/client"
import { attentionItem } from "@/server/db/schema"
import type { EmittedEvent } from "@/server/kernel/commands"

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
