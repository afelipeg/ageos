// @vitest-environment node
// Deterministic client commercial authority (loadJobFinancials):
// latest approved revision per PO reference; distinct references add up in
// the job currency; the result never depends on row insertion order.
import { eq } from "drizzle-orm"

import * as s from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { effectiveAuthority, loadJobFinancials } from "@/server/domain/profitability"

import { closeOwnerDb, ctxFor, id, ownerDb, resetDemo } from "./helpers"

const LAB = id("job_demo_lab")
const at = (iso: string) => new Date(iso)

beforeAll(async () => {
  await resetDemo()
})

afterAll(async () => {
  await closeOwnerDb()
})

describe("client authority with several approved references", () => {
  it("sums the latest approved revision of each distinct reference; primary row is the latest approved", async () => {
    const owner = await ctxFor("user_demo_owner")
    const t = owner.tenant.id
    // Test setup: two more approved references on the lab job (seed has PO-LAB-2027-01 r1 = 1,000).
    await ownerDb().insert(s.contract).values([
      { tenantId: t, clientId: id("client_demo_lab"), jobId: LAB, kind: "client_po", reference: "PO-LAB-B", revisionNumber: 1, amountMinor: 50000n, currency: "USD", state: "superseded", approvedAt: at("2027-03-02T10:00:00Z") },
      { tenantId: t, clientId: id("client_demo_lab"), jobId: LAB, kind: "client_po", reference: "PO-LAB-B", revisionNumber: 2, amountMinor: 70000n, currency: "USD", state: "approved", approvedAt: at("2027-03-05T10:00:00Z") },
      { tenantId: t, clientId: id("client_demo_lab"), jobId: LAB, kind: "client_po", reference: "PO-LAB-A", revisionNumber: 1, amountMinor: 30000n, currency: "USD", state: "approved", approvedAt: at("2027-03-04T10:00:00Z") },
      { tenantId: t, clientId: id("client_demo_lab"), jobId: LAB, kind: "client_po", reference: "PO-LAB-CAD", revisionNumber: 1, amountMinor: 99900n, currency: "CAD", state: "approved", approvedAt: at("2027-03-06T10:00:00Z") },
    ])
    const fin = await withTenant(t, (tx) => loadJobFinancials(tx, t, LAB))
    // 1,000 (seed r1) + 700 (B r2, r1 superseded) + 300 (A); CAD excluded, never converted.
    expect(fin.approvedAuthority?.amountMinor).toBe(100000n + 70000n + 30000n)
    expect(fin.approvedAuthority?.reference).toBe("PO-LAB-B")
    expect(fin.authorities.map((a) => a.reference)).toEqual(["PO-LAB-B", "PO-LAB-A", "PO-LAB-2027-01"])
    expect(fin.excludedAuthorities.map((a) => a.reference)).toEqual(["PO-LAB-CAD"])

    // Same answer whatever the row order.
    const rows = await withTenant(t, (tx) => tx.select().from(s.contract).where(eq(s.contract.jobId, LAB)))
    const forward = effectiveAuthority(rows, "USD")
    const backward = effectiveAuthority([...rows].reverse(), "USD")
    expect(backward.approvedAuthority).toEqual(forward.approvedAuthority)
    expect(backward.authorities.map((a) => a.id)).toEqual(forward.authorities.map((a) => a.id))
  })
})
