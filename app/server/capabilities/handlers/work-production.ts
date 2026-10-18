// Capability handlers for module "work-production". Owner: Core-2.
// Skills: agency-tasks-timesheets, agency-production-estimating, agency-production
// A skill missing from `handlers` is "registered" only (no fake success).
import "server-only"

import { createProductionEstimate, reviewProductionDelivery } from "@/server/domain/production"
import { eq } from "drizzle-orm"

import { timesheet } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { applyTimesheetApproval, rejectTimesheet, submitTimesheet, valueOf } from "@/server/domain/timesheets"
import { executeCommand } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

import type { ModuleCapabilities } from "../types"
import { approveAs, check, F, fixtureKey, jobRevision, LAB, nonce } from "./media-planning"

export const capabilities: ModuleCapabilities = {
  handlers: {
    "agency-tasks-timesheets": { kind: "command", command: submitTimesheet },
    "agency-production-estimating": { kind: "command", command: createProductionEstimate, revisionOf: "job" },
    "agency-production": { kind: "command", command: reviewProductionDelivery },
  },
  executors: {
    "timesheet.approve": {
      permission: "time.approve",
      skillId: "agency-tasks-timesheets",
      run: (tx, ctx, payload, mode) => applyTimesheetApproval(tx, ctx, payload, mode),
      reject: (tx, ctx, payload, reason) => rejectTimesheet(tx, ctx, payload, reason),
    },
  },
  fixtures: {
    "agency-tasks-timesheets": {
      positive: async (ctx) => ({
        actorKey: "user_demo_producer",
        input: { job: LAB, taskTitle: `Lab creative rework ${nonce()}`, member: F("user_demo_producer"), workDate: "2027-03-18", minutes: 8400, hourlyCost: "50.00", notes: "demo-lab hours" },
        verify: async (output, actor) => {
          const o = output as { timesheetId: string; state: string; approvalId: string; payloadDigest: string }
          check(o.state === "submitted" && !!o.approvalId, "hours submitted to the approval kernel")
          const decided = await approveAs(ctx, "user_demo_owner", o.approvalId, o.payloadDigest)
          check(decided.outcome === "approved" && decided.executed, "a manager other than the worker approved")
          const t = await withTenant(actor.tenant.id, async (tx) => (await tx.select().from(timesheet).where(eq(timesheet.id, o.timesheetId)))[0]!)
          check(t.state === "approved" && valueOf(t.minutes, t.hourlyCostMinor) === 700000n && t.notes === "demo-lab hours", "140 approved hours at 50 = 7,000")
          const again = await approveAs(ctx, "user_demo_owner", o.approvalId, o.payloadDigest).catch((e: unknown) => e)
          check(again instanceof DomainError && again.code === "blocked_by_rule", "approved hours are valued once")
        },
      }),
      negative: async (ctx) => {
        const producer = await ctx("user_demo_producer")
        const input = { job: LAB, taskTitle: `Imported timesheet ${nonce()}`, member: F("user_demo_producer"), workDate: "2027-03-17", minutes: 480, hourlyCost: "50.00" }
        await executeCommand(producer, submitTimesheet, { idempotencyKey: fixtureKey("hours-precondition"), origin: "system", payload: input })
        return { actorKey: "user_demo_producer", input, expectCode: "blocked_by_rule", expectRule: "duplicate_timesheet" }
      },
    },
    "agency-production-estimating": {
      positive: async (ctx) => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, laborMinutes: 6000, hourlyCost: "50.00", productionVendorAmount: "5500.00", expenseAmount: "500.00", reason: "demo-lab estimate: 100h, vendor quote and expenses" },
        expectedRevision: await jobRevision(await ctx("user_demo_operator"), LAB),
        verify: async (output) => {
          const o = output as { estimate_totals: { totalMinor: string; laborMinor: string }; estimate_draft: { state: string } }
          check(o.estimate_totals.totalMinor === "1100000" && o.estimate_totals.laborMinor === "500000", "100h×50 + 5,500 + 500 = 11,000")
          check(o.estimate_draft.state === "current", "versioned estimate is current")
        },
      }),
      negative: async (ctx) => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, laborMinutes: 6000, hourlyCost: "0.00", productionVendorAmount: "5500.00", expenseAmount: "500.00", reason: "Labor quantity without a rate" },
        expectedRevision: await jobRevision(await ctx("user_demo_operator"), LAB),
        expectCode: "blocked_by_rule",
        expectRule: "quote_incomplete",
      }),
    },
    "agency-production": {
      positive: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, deliverable: "Lab hero proof", deliveryDate: "2027-03-22", assetFile: F("file_demo_lab_asset"), rightsCleared: true, qualityResult: "passed", qcNotes: "Specs and legal lines checked (demo-lab)." },
        verify: async (output) => {
          const o = output as { state: string; rights_check: { record: string }; qa_findings: { passed: boolean }[] }
          check(o.state === "released", "approved version released")
          check(o.rights_check.record === "valid" && o.qa_findings.every((f) => f.passed), "rights evidence and QA recorded")
        },
      }),
      negative: async () => ({
        actorKey: "user_demo_operator",
        input: { job: LAB, deliverable: "Lab archive proof", deliveryDate: "2027-03-22", assetFile: F("file_demo_lab_asset_expired"), rightsCleared: true, qualityResult: "passed" },
        expectCode: "blocked_by_rule",
        expectRule: "rights_expired",
      }),
    },
  },
}
