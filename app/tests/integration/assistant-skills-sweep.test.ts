// @vitest-environment node
import { eq } from "drizzle-orm"

import type { MessagePart } from "@/lib/assistant/types"
import { CAPABILITY_CONTRACTS } from "@/lib/capabilities/catalog.generated"
import { GOVERNANCE } from "@/lib/capabilities/governance"
import { ROLE_PERMISSIONS } from "@/lib/policy"
import type { AgencyContext } from "@/server/auth/context"
import { assistantDriver } from "@/server/assistant/driver"
import { matchScenarios } from "@/server/assistant/scenarios"
import { assistantView } from "@/server/assistant/view"
import { assistantDelegation, assistantRun, workflowRun } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"

import { closeOwnerDb, ctxFor, resetDemo } from "./helpers"

// Drives every ERP scenario (ERP-01..ERP-42) through the scripted driver to a
// terminal state: clarifications answered with authorized options, proposals
// confirmed by the requester. The outcome must be a real handler result or a
// block by a named rule — never an internal failure — and every run that
// reached its specialist records the delegation with the child workflow run.

process.env.AGEOS_ASSISTANT_MAX_REQUESTS_PER_MINUTE = "100000"

const FREE_TEXT: Record<string, string> = {
  text: "Assistant sweep",
  textarea: "Assistant sweep reason text",
  money: "100.00",
  integer: "1",
  minutes: "60",
  bps: "100",
  date: "2027-03-15",
  month: "2027-03",
}

type Row = { erp: string; skillId: string; actor: string; status: string; outcome: string; delegated: boolean }
const rows: Row[] = []

function actorFor(skillId: string) {
  const exec = GOVERNANCE[skillId]!.executePermission
  return ROLE_PERMISSIONS.owner.includes(exec) ? "user_demo_owner" : "user_demo_finance"
}

const parts = (v: Awaited<ReturnType<typeof assistantView>>) => v.messages.flatMap((m) => m.parts)

async function drive(ctx: AgencyContext, skillId: string) {
  let { conversationId } = await assistantDriver.handleTurn(ctx, { conversationId: null, clientMessageId: crypto.randomUUID(), presetId: `preset.skill.${skillId}`, context: { route: `/a/${ctx.tenant.slug}`, moduleKey: null, record: null } })
  for (let i = 0; i < 16; i++) {
    const v = await assistantView(ctx, conversationId)
    const run = v.conversation?.activeRun
    if (!run) break
    const all = parts(v)
    if (run.status === "waiting_input") {
      const req = [...all].reverse().find((p): p is Extract<MessagePart, { type: "input_request" }> => p.type === "input_request")!
      const reply = req.options[0]?.label ?? FREE_TEXT[req.fieldType ?? "text"] ?? "Assistant sweep"
      ;({ conversationId } = await assistantDriver.handleTurn(ctx, { conversationId, clientMessageId: crypto.randomUUID(), text: reply, context: { route: `/a/${ctx.tenant.slug}`, moduleKey: null, record: null } }))
      continue
    }
    if (run.status === "waiting_confirmation") {
      const proposal = [...all].reverse().find((p): p is Extract<MessagePart, { type: "proposal" }> => p.type === "proposal")!
      await assistantDriver.confirm(ctx, { conversationId, proposalId: proposal.proposalId, digest: proposal.digest, clientMessageId: crypto.randomUUID() })
      continue
    }
    break
  }
  return conversationId
}

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  process.stdout.write(`\nASSISTANT_SWEEP ${JSON.stringify(rows)}\n`)
  await closeOwnerDb()
})

describe("42 ERP scenarios through the scripted driver", () => {
  it.each(CAPABILITY_CONTRACTS.map((c, i) => [`ERP-${String(i + 1).padStart(2, "0")}`, c.skillId] as const))("%s %s reaches a real outcome", async (erp, skillId) => {
    const actor = actorFor(skillId)
    const ctx = await ctxFor(actor)
    const conversationId = await drive(ctx, skillId)
    const v = await assistantView(ctx, conversationId)
    const all = parts(v)
    const runs = await withTenant(ctx.tenant.id, (tx) => tx.select().from(assistantRun).where(eq(assistantRun.conversationId, conversationId)))
    expect(runs).toHaveLength(1)
    const run = runs[0]!
    expect(matchScenarios(`Run demo: ${skillId}`)[0]!.id).toBe(run.scenarioId)

    // Never an internal failure, never a stuck run.
    expect(run.status).not.toBe("failed")
    expect(["completed", "blocked"]).toContain(run.status)
    const blocked = all.filter((p): p is Extract<MessagePart, { type: "blocked" }> => p.type === "blocked")
    expect(blocked.map((b) => b.code)).not.toContain("internal")

    const result = all.find((p): p is Extract<MessagePart, { type: "capability_result" }> => p.type === "capability_result")
    const receipt = all.find((p) => p.type === "receipt")
    const status = all.find((p): p is Extract<MessagePart, { type: "capability_status" }> => p.type === "capability_status")
    const outcome = result ? `${result.state}` : receipt ? "succeeded" : status ? `status:${status.status}` : blocked.length ? `blocked:${blocked.at(-1)!.code}${typeof blocked.at(-1)!.details?.rule === "string" ? `/${blocked.at(-1)!.details!.rule}` : ""}` : "none"
    if (run.status === "completed") expect(Boolean(result || receipt)).toBe(true)

    const delegations = await withTenant(ctx.tenant.id, (tx) => tx.select().from(assistantDelegation).where(eq(assistantDelegation.parentRunId, run.id)))
    for (const d of delegations) {
      expect(d.skillIds).toContain(skillId)
      expect(d.subagentKey).toBe(CAPABILITY_CONTRACTS.find((c) => c.skillId === skillId)!.specialistKey)
      const [child] = await withTenant(ctx.tenant.id, (tx) => tx.select().from(workflowRun).where(eq(workflowRun.id, d.childWorkflowRunId!)))
      expect(child!.origin).toBe("assistant_scripted")
      expect(child!.actorUserId).toBe(ctx.user.id)
    }
    rows.push({ erp, skillId, actor, status: run.status, outcome, delegated: delegations.length > 0 })
  })
})
