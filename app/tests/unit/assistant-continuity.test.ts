// @vitest-environment node
import { createGenerationGuard, draftKey, isThreadId, safeReturnTo } from "@/lib/assistant/continuity"
import { parseFieldReply, toHandlerInput } from "@/lib/assistant/field-input"
import type { FieldSpec } from "@/lib/capabilities/types"

const ORIGIN = "http://localhost:3100"

describe("F08 · return to work keeps path, search and hash inside the agency", () => {
  it("keeps the dossier tab and filters", () => {
    expect(safeReturnTo("/a/rayo-de-sol/jobs/abc?tab=activity", "rayo-de-sol", ORIGIN)).toBe("/a/rayo-de-sol/jobs/abc?tab=activity")
    expect(safeReturnTo("/a/rayo-de-sol/jobs?q=aurora&state=open#row-3", "rayo-de-sol", ORIGIN)).toBe("/a/rayo-de-sol/jobs?q=aurora&state=open#row-3")
    expect(safeReturnTo("/a/rayo-de-sol", "rayo-de-sol", ORIGIN)).toBe("/a/rayo-de-sol")
  })
  it.each([
    ["another agency", "/a/norte-studio/jobs/x"],
    ["agency prefix trick", "/a/rayo-de-sol-evil/jobs"],
    ["external URL", "https://evil.example/a/rayo-de-sol"],
    ["protocol-relative", "//evil.example/a/rayo-de-sol"],
    ["backslash", "/a/rayo-de-sol\\..\\x"],
    ["the assistant page itself", "/a/rayo-de-sol/assistant?thread=1"],
    ["javascript scheme", "javascript:alert(1)"],
    ["empty", ""],
  ])("rejects %s", (_n, target) => {
    expect(safeReturnTo(target, "rayo-de-sol", ORIGIN)).toBeNull()
  })
})

describe("F02 · drafts are keyed per agency, user and thread", () => {
  it("never shares a draft across agencies, users or threads", () => {
    const keys = new Set([
      draftKey("rayo-de-sol", "u1", "t1"),
      draftKey("rayo-de-sol", "u1", "t2"),
      draftKey("rayo-de-sol", "u2", "t1"),
      draftKey("norte-studio", "u1", "t1"),
      draftKey("rayo-de-sol", "u1", null),
    ])
    expect(keys.size).toBe(5)
    expect(draftKey("rayo-de-sol", "u1", null)).toBe("rayo-de-sol:u1:new")
  })
})

describe("F03/F04 · thread ids and request generations", () => {
  it("accepts only UUID thread ids", () => {
    expect(isThreadId("8a8c24f2-258e-51c1-8efa-b417dd3f2c3e")).toBe(true)
    expect(isThreadId("../../etc")).toBe(false)
    expect(isThreadId(null)).toBe(false)
  })
  it("a late response from an older selection is not current", () => {
    const g = createGenerationGuard()
    const sentForA = g.current()
    g.bump() // user opens thread B
    expect(g.isCurrent(sentForA)).toBe(false)
    expect(g.isCurrent(g.current())).toBe(true)
  })
})

describe("parameter clarification uses the workbench field contract", () => {
  const f = (spec: Partial<FieldSpec> & Pick<FieldSpec, "key" | "type">): FieldSpec => ({ label: { en: spec.key, es: spec.key }, required: true, ...spec })
  it("parses enums by value or EN/ES label", () => {
    const basis = f({ key: "basis", type: "enum", options: [{ value: "forecast", label: { en: "Forecast", es: "Proyectado" } }, { value: "incurred", label: { en: "Incurred", es: "Incurrido" } }] })
    expect(parseFieldReply(basis, "Proyectado")).toEqual({ ok: true, value: "forecast" })
    expect(parseFieldReply(basis, "incurred")).toEqual({ ok: true, value: "incurred" })
    expect(parseFieldReply(basis, "maybe")).toEqual({ ok: false, reason: "no_match" })
  })
  it("resolves references only among authorized options and flags ambiguity", () => {
    const job = f({ key: "job", type: "job" })
    const opts = [
      { value: "11111111-1111-4111-8111-111111111111", label: "RDS-2027-001 · Aurora Spring Launch" },
      { value: "22222222-2222-4222-8222-222222222222", label: "Twin" },
      { value: "33333333-3333-4333-8333-333333333333", label: "Twin" },
    ]
    expect(parseFieldReply(job, "rds-2027-001 · aurora spring launch", opts)).toEqual({ ok: true, value: opts[0]!.value })
    expect(parseFieldReply(job, "Twin", opts)).toEqual({ ok: false, reason: "ambiguous" })
    expect(parseFieldReply(job, "44444444-4444-4444-8444-444444444444", opts)).toEqual({ ok: false, reason: "no_match" })
  })
  it("treats evidence as an authorized reference (never a free file id)", () => {
    const ev = f({ key: "evidenceId", type: "evidence" as FieldSpec["type"] })
    const opts = [{ value: "55555555-5555-4555-8555-555555555555", label: "Aurora PO r2 · client_po · reviewed" }]
    expect(parseFieldReply(ev, "aurora po r2 · client_po · reviewed", opts)).toEqual({ ok: true, value: opts[0]!.value })
    expect(parseFieldReply(ev, "66666666-6666-4666-8666-666666666666", opts)).toEqual({ ok: false, reason: "no_match" })
  })

  it("keeps money exact as a decimal string and validates scalars", () => {
    expect(parseFieldReply(f({ key: "amount", type: "money" }), "$23,000")).toEqual({ ok: true, value: "23000.00" })
    expect(parseFieldReply(f({ key: "amount", type: "money" }), "1.005")).toEqual({ ok: false, reason: "invalid" })
    expect(parseFieldReply(f({ key: "days", type: "integer", min: 7, max: 365 }), "3")).toEqual({ ok: false, reason: "out_of_range" })
    expect(parseFieldReply(f({ key: "d", type: "date" }), "2027-02-30")).toEqual({ ok: false, reason: "invalid" })
    expect(parseFieldReply(f({ key: "m", type: "month" }), "2027-03")).toEqual({ ok: true, value: "2027-03" })
    expect(parseFieldReply(f({ key: "b", type: "boolean" }), "sí")).toEqual({ ok: true, value: "true" })
    expect(parseFieldReply(f({ key: "t", type: "text", maxLength: 5 }), "too long")).toEqual({ ok: false, reason: "too_long" })
  })
  it("builds the handler payload with the same types as the workbench form", () => {
    const fields: FieldSpec[] = [f({ key: "minutes", type: "minutes" }), f({ key: "fee", type: "money" }), f({ key: "ok", type: "boolean" }), f({ key: "note", type: "text", required: false })]
    expect(toHandlerInput(fields, { minutes: "2400", fee: "23000.00", ok: "false" })).toEqual({ minutes: 2400, fee: "23000.00", ok: false })
  })
})
