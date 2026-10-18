// @vitest-environment node
import { inArray } from "drizzle-orm"

import { job } from "@/server/db/schema"
import { openOrCloseJob } from "@/server/domain/jobs"
import { executeCommand } from "@/server/kernel/commands"

import { closeOwnerDb, ctxFor, id, key, ownerDb, resetDemo } from "./helpers"

// Audit regression B09: opening jobs concurrently for two different clients
// of the same agency and year must persist both, with unique visible
// references (no COUNT-based race, no unique-violation error to the user).

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

const open = (clientKey: string, name: string) =>
  ctxFor("user_demo_operator").then((ctx) =>
    executeCommand(ctx, openOrCloseJob, {
      idempotencyKey: key(`b09-${clientKey}`),
      payload: { action: "open", client: id(clientKey), jobName: name, jobType: "A", billingCode: "F", period: "2027-04" },
      origin: "ui",
    })
  )

describe("B09 · concurrent job openings for different clients", () => {
  it("both succeed with unique display references, across repeated races", async () => {
    const created: string[] = []
    for (let round = 0; round < 5; round++) {
      const results = await Promise.allSettled([
        open("client_demo_aurora", `B09 Aurora race ${round}`),
        open("client_demo_lab", `B09 Lab race ${round}`),
      ])
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => String((r.reason as Error)?.message ?? r.reason))
      expect(errors, `round ${round}: concurrent openings must not fail`).toEqual([])
      for (const r of results) {
        const res = (r as PromiseFulfilledResult<{ result: { jobId?: string; id?: string } }>).value.result
        created.push(String(res.jobId ?? res.id))
      }
    }
    const rows = await ownerDb().select({ id: job.id, ref: job.displayReference }).from(job).where(inArray(job.id, created))
    expect(rows).toHaveLength(10)
    expect(new Set(rows.map((r) => r.ref)).size).toBe(10)
  })
})
