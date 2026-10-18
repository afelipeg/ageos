"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { agencyContextForApi } from "@/server/auth/request"
import { reconcileCampaignActivation } from "@/server/domain/campaigns"
import { acceptMediaDelivery, decideRateCard, reconcileMediaOrderSubmission } from "@/server/domain/media-buying"
import { issueProductionOrder } from "@/server/domain/production"
import { executeBatchPayment, exportDemoBankStatement, reconcileBatchPayment } from "@/server/domain/payments"
import { decideTimesheet } from "@/server/domain/timesheets"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

// Record-level commands exposed on record pages and desks, beyond the 42
// workbench handlers. A closed allowlist: the browser names one command and
// sends its payload; executeCommand validates it with the command's strict
// schema and checks role, capability, SoD and revision on the server.

const COMMANDS = {
  "time.decideTimesheet": decideTimesheet,
  "media.decideRateCard": decideRateCard,
  "production.issueProductionOrder": issueProductionOrder,
  "media.acceptDelivery": acceptMediaDelivery,
  "media.reconcileMediaOrderSubmission": reconcileMediaOrderSubmission,
  "media.reconcileCampaignActivation": reconcileCampaignActivation,
  "payments.executePayment": executeBatchPayment,
  "payments.reconcilePayment": reconcileBatchPayment,
  "cash.exportDemoBankStatement": exportDemoBankStatement,
} as const

export type RecordCommand = keyof typeof COMMANDS

const Input = z.object({
  agencySlug: z.string().min(2).max(63),
  command: z.enum(Object.keys(COMMANDS) as [RecordCommand, ...RecordCommand[]]),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(8).max(160),
})

export async function runRecordCommandAction(input: z.infer<typeof Input>): Promise<{ ok: true; data: { result: unknown; replayed: boolean } } | Failure> {
  try {
    const p = Input.parse(input)
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def = COMMANDS[p.command] as any
    const res = await executeCommand(ctx, def, { idempotencyKey: p.idempotencyKey, origin: "ui", payload: p.payload })
    revalidatePath(`/a/${ctx.tenant.slug}`, "layout")
    return { ok: true, data: { result: res.result, replayed: res.replayed } }
  } catch (e) {
    return toFailure(e)
  }
}
