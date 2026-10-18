"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { FAILURE_MODES } from "@/server/adapters/simulated-provider"
import { queueSimulationOutcome } from "@/server/adapters/ads"
import { queuePaymentSimulationOutcome } from "@/server/adapters/payments"
import { agencyContextForApi, getRequestSession } from "@/server/auth/request"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError, toFailure, type Failure } from "@/server/kernel/errors"

// Presenter: queue the outcome of the next simulated ads operation of the
// demo agency (ads.queueSimulationOutcome, permission connections.manage).
// Only an authorized presenter session may use it; the next simulated
// operation consumes the directive and records its own result.

const Input = z.object({
  agencySlug: z.string().min(2).max(63),
  provider: z.enum(["meta_ads", "google_ads", "tiktok_ads", "dv360_demo", "demo_bank"]),
  operationType: z.enum(["media_order.submit", "campaign.activate", "payment.execute"]),
  failureMode: z.enum(FAILURE_MODES),
  idempotencyKey: z.string().min(8).max(160),
})

export async function queueSimulationOutcomeAction(input: z.infer<typeof Input>): Promise<{ ok: true; data: { directiveId: string } } | Failure> {
  try {
    const p = Input.parse(input)
    const session = await getRequestSession()
    if (!session?.presenter) throw new DomainError("forbidden", "Presenter tools require the authorized presenter")
    const ctx = await agencyContextForApi(p.agencySlug)
    if (!ctx) throw new DomainError("not_found", "Agency not available")
    // Payments use their own queue command (demo bank, payment.execute); ads use the ads queue.
    const res =
      p.provider === "demo_bank"
        ? await executeCommand(ctx, queuePaymentSimulationOutcome, { idempotencyKey: p.idempotencyKey, origin: "presenter", payload: { failureMode: p.failureMode } })
        : p.operationType === "payment.execute"
          ? (() => {
              throw new DomainError("validation", "payment.execute applies to the demo bank only", { field: "operationType" })
            })()
          : await executeCommand(ctx, queueSimulationOutcome, {
              idempotencyKey: p.idempotencyKey,
              origin: "presenter",
              payload: { provider: p.provider as "meta_ads", operationType: p.operationType as "campaign.activate", failureMode: p.failureMode },
            })
    revalidatePath("/demo/presenter")
    return { ok: true, data: { directiveId: (res.result as { directiveId: string }).directiveId } }
  } catch (e) {
    return toFailure(e)
  }
}
