// @vitest-environment node
import { and, count, eq, inArray } from "drizzle-orm"

import { storeUpload } from "@/server/actions/ui/library-upload"
import type { AgencyContext } from "@/server/auth/context"
import * as schema from "@/server/db/schema"
import { applyJobImport, JOB_IMPORT_COLUMNS, JOB_IMPORT_PROFILE_KEY, jobImportKey, previewJobImport } from "@/server/domain/job-import"
import { DomainError } from "@/server/kernel/errors"

import { closeOwnerDb, ctxFor, id, ownerDb, resetDemo } from "./helpers"

// Jobs desk "Apply valid rows": per-row validation against the agency's
// published jobs import profile, one atomic batch through the job-lifecycle
// command with a key derived from file id + profile revision.

const RAYO = id("tenant_demo_rayo")
const HEADER = JOB_IMPORT_COLUMNS.join(",")
let revision = 0

async function expectError(p: Promise<unknown>, code: string, rule?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code && (rule === undefined || e.details.rule === rule))
}

async function counts() {
  const db = ownerDb()
  const [j] = await db.select({ n: count() }).from(schema.job).where(eq(schema.job.tenantId, RAYO))
  const [e] = await db.select({ n: count() }).from(schema.businessEvent).where(eq(schema.businessEvent.tenantId, RAYO))
  const [k] = await db.select({ n: count() }).from(schema.idempotencyRecord).where(eq(schema.idempotencyRecord.tenantId, RAYO))
  return { jobs: j!.n, events: e!.n, keys: k!.n }
}

async function upload(ctx: AgencyContext, csv: string, name = "jobs-import.csv") {
  const res = await storeUpload(ctx, { name, bytes: new TextEncoder().encode(csv), jobId: null, logicalId: null })
  return res.fileId
}

beforeAll(async () => {
  await resetDemo()
  // Precondition: a published jobs import profile (revision 1, ',') for Rayo.
  const db = ownerDb()
  const [existing] = await db.select().from(schema.importProfile).where(and(eq(schema.importProfile.tenantId, RAYO), eq(schema.importProfile.profileKey, JOB_IMPORT_PROFILE_KEY)))
  if (existing) {
    revision = existing.profileRevision
    return
  }
  const profileId = id("import_profile_jobs")
  await db.insert(schema.importProfile).values({ id: profileId, tenantId: RAYO, profileKey: JOB_IMPORT_PROFILE_KEY, delimiter: ",", expectedHeaders: [...JOB_IMPORT_COLUMNS], profileRevision: 1 })
  await db.insert(schema.importProfileRevision).values({ tenantId: RAYO, profileId, profileRevision: 1, delimiter: ",", expectedHeaders: [...JOB_IMPORT_COLUMNS], diff: { origin: "test" } })
  revision = 1
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("jobs import: apply valid rows", () => {
  let fileId = ""

  it("applies only the 2 valid rows through the job-lifecycle command and reports the invalid one", async () => {
    const operator = await ctxFor("user_demo_operator")
    // MAP is a client of another agency (Norte): not found in this agency.
    fileId = await upload(operator, `${HEADER}\nAUR,Import spring launch,A,F,2027-04\nLAB,Import lab retainer,C,F,2027-04\nMAP,Import foreign client,A,F,2027-04\n`)
    const preview = await previewJobImport(operator, fileId)
    expect(preview.profile.revision).toBe(revision)
    expect(preview.fileErrors).toEqual([])
    expect(preview.validCount).toBe(2)
    expect(preview.invalidCount).toBe(1)
    expect(preview.rows.map((r) => r.status)).toEqual(["valid", "valid", "invalid"])
    expect(preview.rows[2]!.reasons).toEqual([{ code: "client_not_found", field: "client_code" }])
    expect(preview.idempotencyKey).toBe(jobImportKey(fileId, revision))
    expect(preview.applied).toBeNull()

    const before = await counts()
    const res = await applyJobImport(operator, fileId, revision)
    expect(res.replayed).toBe(false)
    expect(res.result.appliedCount).toBe(2)
    expect(res.result.invalidCount).toBe(1)
    expect(res.result.invalid).toEqual([{ row: 3, reasons: [{ code: "client_not_found", field: "client_code" }] }])
    const after = await counts()
    expect(after.jobs - before.jobs).toBe(2)
    // 2 × job.opened + 1 batch event, all under the batch command.
    expect(after.events - before.events).toBe(3)
    expect(after.keys - before.keys).toBe(1)

    const db = ownerDb()
    const jobs = await db.select().from(schema.job).where(inArray(schema.job.id, res.result.applied.map((a) => a.jobId)))
    expect(jobs.map((j) => j.name).sort()).toEqual(["Import lab retainer", "Import spring launch"])
    expect(jobs.every((j) => j.state === "open" && j.period === "2027-04")).toBe(true)
    const events = await db.select().from(schema.businessEvent).where(eq(schema.businessEvent.commandId, res.commandId))
    expect(events.map((e) => e.eventType).sort()).toEqual(["job.opened", "job.opened", "jobs.import_applied"])
    expect(events.every((e) => e.commandType === "jobs.applyValidImport" && e.actorUserId === operator.user.id)).toBe(true)
    const batch = events.find((e) => e.eventType === "jobs.import_applied")!
    expect(batch.aggregateId).toBe(fileId)
    expect(batch.payload).toMatchObject({ profileRevision: revision, appliedCount: 2, invalidCount: 1 })

    // Reload: the preview shows the stored batch; the rows are now duplicates.
    const again = await previewJobImport(operator, fileId)
    expect(again.applied?.appliedCount).toBe(2)
    expect(again.rows.slice(0, 2).map((r) => r.reasons[0]?.code)).toEqual(["duplicate_existing", "duplicate_existing"])
  })

  it("replaying the same file + profile revision creates no new jobs", async () => {
    const operator = await ctxFor("user_demo_operator")
    const before = await counts()
    const res = await applyJobImport(operator, fileId, revision)
    expect(res.replayed).toBe(true)
    expect(res.result.appliedCount).toBe(2)
    // Another member re-clicking the same batch gets a conflict, never a second batch.
    await expectError(applyJobImport(await ctxFor("user_demo_owner"), fileId, revision), "idempotency_conflict")
    expect(await counts()).toEqual(before)
  })

  it("a viewer is blocked from preview and apply with zero changes", async () => {
    const operator = await ctxFor("user_demo_operator")
    const viewerFile = await upload(operator, `${HEADER}\nAUR,Import viewer attempt,A,F,2027-05\n`)
    const viewer = await ctxFor("user_demo_viewer")
    const before = await counts()
    await expectError(previewJobImport(viewer, viewerFile), "forbidden")
    await expectError(applyJobImport(viewer, viewerFile, revision), "forbidden")
    expect(await counts()).toEqual(before)
  })

  it("a file parsed with the wrong delimiter has 0 valid rows and applies nothing", async () => {
    const operator = await ctxFor("user_demo_operator")
    const semi = await upload(operator, `${JOB_IMPORT_COLUMNS.join(";")}\nAUR;Import semicolon A;A;F;2027-06\nLAB;Import semicolon B;C;F;2027-06\n`)
    const preview = await previewJobImport(operator, semi)
    expect(preview.headers).toHaveLength(1)
    expect(preview.columnCount).toBe(1)
    expect(preview.fileErrors).toContain("header_mismatch")
    expect(preview.file.detectedDelimiter).toBe(";")
    expect(preview.validCount).toBe(0)
    expect(preview.rows.every((r) => r.status === "invalid" && r.reasons[0]?.code === "header_mismatch")).toBe(true)
    const before = await counts()
    await expectError(applyJobImport(operator, semi, revision), "blocked_by_rule", "no_valid_rows")
    expect(await counts()).toEqual(before)

    // The J09 incident file (';' media orders) is not a jobs import either.
    const j09 = await previewJobImport(operator, id("file_demo_media_orders_csv"))
    expect(j09.validCount).toBe(0)
    expect(j09.fileErrors).toContain("header_mismatch")
  })

  it("reports required, invalid, column-count and in-file duplicate rows; a stale profile revision is refused", async () => {
    const operator = await ctxFor("user_demo_operator")
    const f = await upload(
      operator,
      [
        HEADER,
        "AUR,,A,F,2027-07",
        "AUR,Import bad type,Z,F,2027-07",
        "AUR,Import bad period,A,F,2027-13",
        "AUR,Import extra cell,A,F,2027-07,extra",
        "AUR,Import twice,A,F,2027-07",
        "aur,import  TWICE,a,f,2027-07",
      ].join("\n") + "\n"
    )
    const p = await previewJobImport(operator, f)
    expect(p.rows.map((r) => r.reasons)).toEqual([
      [{ code: "required", field: "job_name" }],
      [{ code: "invalid", field: "job_type" }],
      [{ code: "invalid", field: "period" }],
      [{ code: "column_count", expected: 5, actual: 6 }],
      [],
      [{ code: "duplicate_in_file" }],
    ])
    expect(p.validCount).toBe(1)
    const before = await counts()
    await expectError(applyJobImport(operator, f, revision + 1), "revision_conflict", "import_profile_changed")
    expect(await counts()).toEqual(before)
  })
})
