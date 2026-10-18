import { describe, expect, it } from "vitest"

import { CAPABILITY_CONTRACTS } from "./catalog.generated"
import { INPUT_FIELDS } from "./input-fields"
import type { FieldSpec, FieldType } from "./types"

const skillIds = CAPABILITY_CONTRACTS.map((c) => c.skillId)
const allFields = Object.entries(INPUT_FIELDS).flatMap(([skillId, fields]) =>
  fields.map((field) => ({ skillId, field }))
)
const REFERENCE_TYPES: FieldType[] = [
  "job",
  "client",
  "supplier",
  "connection",
  "file",
  "member",
]

type Expected = {
  key: string
  type: FieldType
  required: boolean
  options?: string[]
  maxLength?: number
  min?: number
  max?: number
  example?: string | number
}

const CURRENCIES = ["USD", "CAD", "MXN"]
const COUNTRIES = ["US", "CA", "MX", "CO"]

const FIXED: Record<string, Expected[]> = {
  "agency-orchestrator": [{ key: "job", type: "job", required: true }],
  "agency-onboarding": [
    { key: "clientName", type: "text", required: true, maxLength: 120 },
    { key: "clientCode", type: "text", required: true, maxLength: 3 },
    { key: "productCode", type: "text", required: true, maxLength: 2 },
    {
      key: "billingCurrency",
      type: "enum",
      required: true,
      options: CURRENCIES,
    },
    { key: "country", type: "enum", required: true, options: COUNTRIES },
    { key: "creditLimit", type: "money", required: false },
    { key: "briefTitle", type: "text", required: true, maxLength: 160 },
    { key: "briefSummary", type: "textarea", required: true, maxLength: 2000 },
  ],
  "agency-job-lifecycle": [
    {
      key: "action",
      type: "enum",
      required: true,
      options: ["open", "request_close"],
    },
    { key: "client", type: "client", required: false },
    { key: "jobName", type: "text", required: false, maxLength: 160 },
    {
      key: "jobType",
      type: "enum",
      required: false,
      options: ["A", "C", "P", "N"],
    },
    {
      key: "billingCode",
      type: "enum",
      required: false,
      options: ["F", "0", "?"],
    },
    { key: "period", type: "month", required: false },
    { key: "job", type: "job", required: false },
    { key: "closeReason", type: "textarea", required: false, maxLength: 500 },
  ],
  "agency-budget-control": [
    { key: "job", type: "job", required: true },
    {
      key: "budgetScope",
      type: "enum",
      required: true,
      options: [
        "client_commercial_authority",
        "managed_media_authority",
        "agency_cost_authority",
      ],
    },
    { key: "amount", type: "money", required: true },
    { key: "purpose", type: "text", required: true, maxLength: 200 },
  ],
  "agency-fee-contracts": [
    { key: "job", type: "job", required: true },
    {
      key: "newAgencyFee",
      type: "money",
      required: true,
      example: "23000.00",
    },
    { key: "reason", type: "textarea", required: true, maxLength: 1000 },
  ],
  "agency-production-estimating": [
    { key: "job", type: "job", required: true },
    {
      key: "laborMinutes",
      type: "minutes",
      required: true,
      min: 0,
      max: 600000,
      example: 8400,
    },
    { key: "hourlyCost", type: "money", required: true, example: "50.00" },
    {
      key: "productionVendorAmount",
      type: "money",
      required: true,
      example: "5500.00",
    },
    { key: "expenseAmount", type: "money", required: true, example: "500.00" },
    { key: "reason", type: "textarea", required: true, maxLength: 1000 },
  ],
  "agency-integrations": [
    {
      key: "action",
      type: "enum",
      required: true,
      options: ["connect", "test", "revoke", "restore"],
    },
    {
      key: "provider",
      type: "enum",
      required: true,
      options: [
        "meta_ads",
        "google_ads",
        "tiktok_ads",
        "dv360_demo",
        "demo_bank",
        "demo_ledger",
      ],
    },
    {
      key: "accountAlias",
      type: "text",
      required: true,
      maxLength: 80,
      example: "demo_meta_aurora",
    },
  ],
  "agency-profitability": [
    { key: "job", type: "job", required: true },
    {
      key: "basis",
      type: "enum",
      required: true,
      options: ["forecast", "incurred"],
    },
  ],
}

describe("INPUT_FIELDS", () => {
  it("has exactly the 42 catalog skills, in catalog order", () => {
    expect(skillIds).toHaveLength(42)
    expect(Object.keys(INPUT_FIELDS)).toEqual(skillIds)
  })

  it.each(skillIds)("%s has a sane field list", (skillId) => {
    const fields = INPUT_FIELDS[skillId]
    expect(fields.length).toBeGreaterThanOrEqual(1)
    expect(fields.length).toBeLessThanOrEqual(8)
    if (!["agency-orchestrator", "agency-profitability"].includes(skillId)) {
      expect(fields.length).toBeGreaterThanOrEqual(2)
    }
    const keys = fields.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("uses camelCase keys and non-empty en/es labels", () => {
    for (const { skillId, field } of allFields) {
      expect(field.key, skillId).toMatch(/^[a-z][a-zA-Z0-9]*$/)
      expect(field.label.en.trim(), `${skillId}.${field.key}`).not.toBe("")
      expect(field.label.es.trim(), `${skillId}.${field.key}`).not.toBe("")
      if (field.help) {
        expect(field.help.en.trim(), `${skillId}.${field.key}`).not.toBe("")
        expect(field.help.es.trim(), `${skillId}.${field.key}`).not.toBe("")
      }
    }
  })

  it("gives every enum at least two unique options and a valid example", () => {
    for (const { skillId, field } of allFields) {
      const at = `${skillId}.${field.key}`
      if (field.type !== "enum") {
        expect(field.options, at).toBeUndefined()
        continue
      }
      const values = (field.options ?? []).map((o) => o.value)
      expect(values.length, at).toBeGreaterThanOrEqual(2)
      expect(new Set(values).size, at).toBe(values.length)
      for (const option of field.options ?? []) {
        expect(option.label.en.trim(), at).not.toBe("")
        expect(option.label.es.trim(), at).not.toBe("")
      }
      if (field.example !== undefined) {
        expect(values, at).toContain(field.example)
      }
    }
  })

  it("keeps examples consistent with their field type", () => {
    for (const { skillId, field } of allFields) {
      const at = `${skillId}.${field.key}`
      const { example } = field
      switch (field.type) {
        case "money":
          if (example !== undefined) {
            expect(typeof example, at).toBe("string")
            expect(example, at).toMatch(/^\d+\.\d{2}$/)
          }
          break
        case "date":
          if (example !== undefined) {
            expect(example, at).toMatch(/^2027-\d{2}-\d{2}$/)
          }
          break
        case "month":
          if (example !== undefined) {
            expect(example, at).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
          }
          break
        case "boolean":
          if (example !== undefined) expect(typeof example, at).toBe("boolean")
          break
        case "integer":
        case "minutes":
        case "bps":
          if (example !== undefined) {
            expect(Number.isInteger(example), at).toBe(true)
          }
          break
        default:
          if (REFERENCE_TYPES.includes(field.type)) {
            expect(example, at).toBeUndefined()
          }
      }
    }
  })

  it("bounds text, numeric and basis-point fields", () => {
    for (const { skillId, field } of allFields) {
      const at = `${skillId}.${field.key}`
      if (field.type === "text") {
        expect(field.maxLength, at).toBeGreaterThan(0)
        expect(field.maxLength, at).toBeLessThanOrEqual(200)
      }
      if (field.type === "textarea") {
        expect(field.maxLength, at).toBeGreaterThan(0)
        expect(field.maxLength, at).toBeLessThanOrEqual(2000)
      }
      if (["integer", "minutes", "bps"].includes(field.type)) {
        expect(field.min, at).toBeDefined()
        expect(field.max, at).toBeDefined()
        expect(field.min as number, at).toBeLessThanOrEqual(field.max as number)
      }
      if (field.type === "bps") {
        expect(field.min, at).toBeGreaterThanOrEqual(0)
        expect(field.max, at).toBeLessThanOrEqual(10000)
      }
      if (typeof field.example === "number") {
        if (field.min !== undefined) {
          expect(field.example, at).toBeGreaterThanOrEqual(field.min)
        }
        if (field.max !== undefined) {
          expect(field.example, at).toBeLessThanOrEqual(field.max)
        }
      }
      if (typeof field.example === "string" && field.maxLength) {
        expect(field.example.length, at).toBeLessThanOrEqual(field.maxLength)
      }
    }
  })

  it("adds a currency field only to FX and multi-currency skills", () => {
    const withCurrency = allFields
      .filter(({ field }) => /currency/i.test(field.key))
      .map(({ skillId }) => skillId)
    expect(withCurrency.sort()).toEqual([
      "agency-accruals-revaluation",
      "agency-cash-forecast",
      "agency-onboarding",
    ])
  })

  describe.each(Object.entries(FIXED))(
    "fixed contract: %s",
    (skillId, expected) => {
      it("has exactly the specified fields", () => {
        const fields: readonly FieldSpec[] = INPUT_FIELDS[skillId]
        expect(fields.map((f) => f.key)).toEqual(expected.map((e) => e.key))
        expected.forEach((e, index) => {
          const { options, ...rest } = e
          expect(fields[index]).toMatchObject(rest)
          if (options) {
            expect(fields[index].options?.map((o) => o.value)).toEqual(options)
          }
        })
      })
    }
  )
})
