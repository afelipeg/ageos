// @vitest-environment node
import { eq } from "drizzle-orm"

import { runCapability } from "@/server/capabilities/runner"
import { job } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { decideApprovalCommand } from "@/server/domain/approvals"
import { proposeFeeAmendment } from "@/server/domain/budget"
import { executeCommand } from "@/server/kernel/commands"
import { checkUpload, storeUpload } from "@/server/actions/ui/library-upload"
import { getApprovalView, listApprovalsView } from "@/server/queries/approvals"
import { getCatalog } from "@/server/queries/catalog"
import { getConnectionView, listConnectionsView } from "@/server/queries/connections"
import { QUESTIONS, runQuestion } from "@/server/queries/explore"
import { getInbox, INBOX_VIEWS } from "@/server/queries/inbox"
import { getFileView, listLibrary } from "@/server/queries/library"
import { deskViewKeys, getModuleDesk } from "@/server/queries/modules"
import { getRecordDetail, RECORD_TYPES } from "@/server/queries/records"
import { getRunDetail, listRunsView } from "@/server/queries/runs"
import { getSettingsView, SETTINGS_SECTIONS } from "@/server/queries/settings"

import { closeOwnerDb, ctxFor, id, key, resetDemo } from "./helpers"

const AURORA = id("job_demo_aurora")
const MODULE_KEYS = ["setup", "clients-contracts", "work-production", "media-planning", "media-buying", "suppliers-payments", "billing-collections", "accounting-close", "profitability"]

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("catalog projection", () => {
  it("lists exactly 42 unique capabilities in the nine modules with consistent tab counts", async () => {
    const ctx = await ctxFor("user_demo_owner")
    const c = getCatalog(ctx)
    const all = c.modules.flatMap((m) => m.capabilities)
    expect(c.modules).toHaveLength(9)
    expect(all).toHaveLength(42)
    expect(new Set(all.map((x) => x.skillId)).size).toBe(42)
    expect(c.counts.available).toBe(42)
    expect(c.counts.enabled + c.counts.needs_setup + c.counts.disabled).toBe(42)
    for (const e of all) expect(e.href).toBe(`/a/rayo-de-sol/modules/${e.moduleKey}/workflows/${e.skillId}`)
  })
})

describe("module desks", () => {
  it("every desk and every view of the nine modules loads authorized rows", async () => {
    const ctx = await ctxFor("user_demo_owner")
    for (const m of MODULE_KEYS) {
      const views = deskViewKeys(m)
      expect(views.length).toBeGreaterThan(0)
      for (const v of views) {
        const desk = await getModuleDesk(ctx, m, { view: v })
        expect(desk?.active.key).toBe(v)
        expect(Array.isArray(desk?.active.rows)).toBe(true)
      }
    }
    expect(await getModuleDesk(ctx, "not-a-module", {})).toBeNull()
  })

  it("the named query 'losing margin' returns only jobs below the floor", async () => {
    const ctx = await ctxFor("user_demo_owner")
    const desk = await getModuleDesk(ctx, "profitability", { view: "losing-margin" })
    for (const r of desk!.active.rows) expect((r.marginBps as number) < (r.floorBps as number)).toBe(true)
    const q = await runQuestion(ctx, "jobs-losing-margin", { floorBps: "9000" })
    const all = await runQuestion(ctx, "margin-by-job", {})
    expect(q!.result.rows.length).toBeLessThanOrEqual(all!.result.rows.length)
    expect(q!.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("records and isolation", () => {
  it("resolves the Aurora client PO and never another tenant's record", async () => {
    const owner = await ctxFor("user_demo_owner")
    const desk = await getModuleDesk(owner, "clients-contracts", { view: "contracts" })
    const contractId = String(desk!.active.rows[0]!.id)
    const r = await getRecordDetail(owner, "contract", contractId)
    expect(r?.type).toBe("contract")
    expect(r?.relations.some((l) => l.href.includes("/jobs/"))).toBe(true)
    const norte = await ctxFor("user_demo_norte_owner", "norte-studio")
    expect(await getRecordDetail(norte, "contract", contractId)).toBeNull()
    expect(await getRecordDetail(owner, "contract", "not-a-uuid")).toBeNull()
    expect(await getRecordDetail(owner, "bogus", contractId)).toBeNull()
    expect(RECORD_TYPES).toContain("client-invoice")
  })
})

describe("approval and run projections", () => {
  it("shows the requester a non-decidable request and the finance approver a decidable one", async () => {
    const operator = await ctxFor("user_demo_operator")
    const revision = await withTenant(operator.tenant.id, async (tx) => (await tx.select().from(job).where(eq(job.id, AURORA)))[0]!.revision)
    const res = await executeCommand(operator, proposeFeeAmendment, {
      idempotencyKey: key("screens-fee"),
      origin: "ui",
      payload: { job: AURORA, newAgencyFee: "23000.00", reason: "Price the 40 extra hours" },
      expectedRevision: revision,
    })
    const approvalId = res.result.approvalId
    const queue = await listApprovalsView(operator, "awaiting_approval")
    expect(queue.rows.some((a) => a.id === approvalId)).toBe(true)
    const asRequester = await getApprovalView(operator, approvalId)
    expect(asRequester?.viewer.isRequester).toBe(true)
    expect(asRequester?.viewer.canDecide).toBe(false)
    expect(asRequester?.eligiblePeople.length).toBeGreaterThan(0)
    const finance = await ctxFor("user_demo_finance")
    const asFinance = await getApprovalView(finance, approvalId)
    expect(asFinance?.viewer.canDecide).toBe(true)
    await executeCommand(finance, decideApprovalCommand, {
      idempotencyKey: key("screens-decide"),
      origin: "ui",
      payload: { approvalId, decision: "approve", reason: null, reviewedDigest: asFinance!.approval.payloadDigest },
    })
    const after = await getApprovalView(finance, approvalId)
    expect(["approved", "consumed"]).toContain(after?.approval.state)
    const norte = await ctxFor("user_demo_norte_owner", "norte-studio")
    expect(await getApprovalView(norte, approvalId)).toBeNull()
  })

  it("lists a persisted run with its recorded steps", async () => {
    const owner = await ctxFor("user_demo_owner")
    const out = await runCapability(owner, "agency-orchestrator", { job: AURORA }, { origin: "ui", idempotencyKey: key("screens-run") })
    const list = await listRunsView(owner, { state: "all", page: 1 })
    expect(list.rows.some((r) => r.id === out.runId)).toBe(true)
    const d = await getRunDetail(owner, out.runId)
    expect(d?.steps.length).toBeGreaterThan(0)
    expect(d?.job?.id).toBe(AURORA)
    const norte = await ctxFor("user_demo_norte_owner", "norte-studio")
    expect(await getRunDetail(norte, out.runId)).toBeNull()
  })

  it("inbox views are consistent subsets", async () => {
    const owner = await ctxFor("user_demo_owner")
    for (const v of INBOX_VIEWS) {
      const res = await getInbox(owner, { view: v })
      expect(res.rows.length).toBe(res.counts[v])
    }
  })
})

describe("private library", () => {
  it("validates signatures server-side", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 demo")
    expect(checkUpload("brief.pdf", pdf)).toMatchObject({ ok: true, format: "pdf" })
    expect(checkUpload("brief.pdf", new TextEncoder().encode("not a pdf"))).toMatchObject({ ok: false, code: "signature_mismatch" })
    expect(checkUpload("tool.exe", pdf)).toMatchObject({ ok: false, code: "unsupported_type" })
    expect(checkUpload("empty.csv", new Uint8Array())).toMatchObject({ ok: false, code: "empty" })
    expect(checkUpload("fake.xlsx", new TextEncoder().encode("PK\u0003\u0004 no parts"))).toMatchObject({ ok: false, code: "signature_mismatch" })
  })

  it("stores a CSV privately, analyzes it for real and versions it; other tenants cannot read it", async () => {
    const owner = await ctxFor("user_demo_owner")
    const csv = new TextEncoder().encode("order_id;channel;amount_minor\nA-1;meta;100\n")
    const v1 = await storeUpload(owner, { name: "../orders.csv", bytes: csv, jobId: AURORA, logicalId: null })
    expect(v1.extractionStatus).toBe("analyzed")
    const f = await getFileView(owner, v1.fileId)
    expect(f?.file.originalName).toBe("orders.csv")
    expect(f?.file.extraction).toMatchObject({ delimiter: ";", columnCount: 3, rowCount: 1 })
    const v2 = await storeUpload(owner, { name: "orders.csv", bytes: csv, jobId: null, logicalId: v1.logicalId })
    expect(v2.version).toBe(2)
    const after = await getFileView(owner, v2.fileId)
    expect(after?.versions.map((x) => x.version)).toEqual([2, 1])
    expect(after?.job?.id).toBe(AURORA)
    const lib = await listLibrary(owner, { job: AURORA })
    expect(lib.rows.some((r) => r.logicalId === v1.logicalId && r.version === 2 && r.versions === 2)).toBe(true)
    const pdfStored = await storeUpload(owner, { name: "scan.pdf", bytes: new TextEncoder().encode("%PDF-1.7 x"), jobId: null, logicalId: null })
    expect(pdfStored.extractionStatus).toBe("not_analyzed")
    const norte = await ctxFor("user_demo_norte_owner", "norte-studio")
    expect(await getFileView(norte, v1.fileId)).toBeNull()
    const viewer = await ctxFor("user_demo_viewer")
    await expect(storeUpload(viewer, { name: "x.csv", bytes: csv, jobId: null, logicalId: null })).rejects.toMatchObject({ code: "forbidden" })
  })
})

describe("settings, connections and explore", () => {
  it("every settings section, the connection catalog and every named question load", async () => {
    const owner = await ctxFor("user_demo_owner")
    for (const s of SETTINGS_SECTIONS) expect((await getSettingsView(owner, s)).section).toBe(s)
    const conns = await listConnectionsView(owner)
    expect(conns.catalog.length).toBe(6)
    if (conns.connections[0]) expect((await getConnectionView(owner, conns.connections[0].id))?.connection.id).toBe(conns.connections[0].id)
    for (const q of QUESTIONS) {
      const r = await runQuestion(owner, q.key, {})
      expect(r?.result.columns.length).toBeGreaterThan(0)
    }
    expect(await runQuestion(owner, "drop-table", {})).toBeNull()
  })
})
