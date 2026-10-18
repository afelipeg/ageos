// Capability handlers for module "setup". Owner: Core-1 (agent: núcleo gobierno).
// Skills: agency-orchestrator, agency-integrations, agency-access-governance, agency-master-data
// A skill missing from `handlers` is "registered" only (no fake success).
import "server-only"

import { fixtureUuid as F } from "@/lib/fixture-ids"
import { configureDemoConnection } from "@/server/domain/connections"
import { applyAccessChange, proposeAccessChange } from "@/server/domain/governance"
import { getJobRevision } from "@/server/domain/jobs"
import { applyMasterMerge, upsertMasterRecord } from "@/server/domain/master-data"
import { recordReadinessCheckpoint } from "@/server/domain/orchestrator"
import type { ModuleCapabilities } from "../types"

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`fixture verify failed: ${message}`)
}

type Out = Record<string, unknown>

export const capabilities: ModuleCapabilities = {
  handlers: {
    "agency-orchestrator": { kind: "command", command: recordReadinessCheckpoint, revisionOf: "job" },
    "agency-integrations": { kind: "command", command: configureDemoConnection },
    "agency-access-governance": { kind: "command", command: proposeAccessChange },
    "agency-master-data": { kind: "command", command: upsertMasterRecord },
  },
  fixtures: {
    // ERP-01: checkpoint persisted for the revision seen; recomputing the same
    // state reuses it. Negative: an outdated revision is rejected.
    "agency-orchestrator": {
      positive: async (ctx) => {
        const lab = F("job_demo_lab")
        return {
          actorKey: "user_demo_operator",
          input: { job: lab },
          expectedRevision: await getJobRevision(await ctx("user_demo_operator"), lab),
          verify: async (output) => {
            const o = output as Out
            expect(typeof o.checkpointId === "string", "checkpointId")
            expect(Array.isArray(o.dependency_graph) && typeof o.next_stage === "string", "graph + next stage")
          },
        }
      },
      negative: async (ctx) => {
        const lab = F("job_demo_lab")
        return {
          actorKey: "user_demo_operator",
          input: { job: lab },
          expectedRevision: (await getJobRevision(await ctx("user_demo_operator"), lab)) + 1,
          expectCode: "revision_conflict",
          expectRule: "outdated_revision",
        }
      },
    },
    // ERP-02: Connected · Demo persists for the chosen fictitious account.
    // Negative: testing a revoked connection is blocked (no fallback provider).
    "agency-integrations": {
      positive: async () => ({
        actorKey: "user_demo_owner",
        input: { action: "connect", provider: "google_ads", accountAlias: "demo_lab_google" },
        verify: async (output) => {
          const o = output as Out
          expect(o.state === "connected_demo", "connected_demo")
          expect(Array.isArray(o.stage_wiring_plan), "stage wiring plan")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_owner",
        input: { action: "test", provider: "meta_ads", accountAlias: "demo_lab_revoked" },
        expectCode: "connection_revoked",
        expectRule: "connection_revoked",
      }),
    },
    // ERP-03: an account manager requests a lab member's role change; only an
    // owner other than the requester may approve. Negative: self-escalation.
    "agency-access-governance": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: {
          member: F("user_demo_lab_member"),
          proposedRole: "producer",
          effectiveScope: "assigned_jobs",
          expenseApprovalCap: "500.00",
          reason: "Lab member joins production for the demo-lab exercise.",
        },
        verify: async (output) => {
          const o = output as Out
          const req = (o.access_change_requests as { eligibleRoles: string[]; state: string }[])[0]!
          expect(req.state === "awaiting_approval" && req.eligibleRoles.join() === "owner", "owner approval pending")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: {
          member: F("user_demo_operator"),
          proposedRole: "finance_approver",
          effectiveScope: "agency_wide",
          reason: "Wants to approve their own amendments.",
        },
        expectCode: "blocked_by_rule",
        expectRule: "self_role_change",
      }),
    },
    // ERP-04: the same supplier code/name/external id always resolves to one
    // master. Negative: same code with another legal identity is blocked.
    "agency-master-data": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: { recordType: "supplier", code: "LUM", legalName: "Lumen Production Demo", country: "US", externalMapping: "demo_ledger:LUM" },
        verify: async (output) => {
          const o = output as Out
          expect(o.recordId === F("supplier_demo_lumen"), "resolves to the seeded Lumen master")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: { recordType: "supplier", code: "LUM", legalName: "Lumen Productions International", country: "US" },
        expectCode: "blocked_by_rule",
        expectRule: "conflicting_legal_identity",
      }),
    },
  },
  executors: {
    "access.role_change": {
      permission: "access.request",
      skillId: "agency-access-governance",
      run: (tx, ctx, payload, mode) => applyAccessChange(tx, ctx, payload as Parameters<typeof applyAccessChange>[2], mode),
    },
    "master.merge": {
      permission: "clients.manage",
      skillId: "agency-master-data",
      run: (tx, ctx, payload, mode) => applyMasterMerge(tx, ctx, payload as Parameters<typeof applyMasterMerge>[2], mode),
    },
  },
}
