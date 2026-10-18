import { render, screen } from "@testing-library/react"
import { vi } from "vitest"

import { RecordGrid, type GridColumn, type GridRow } from "@/components/app/record-grid"
import { I18nProvider } from "@/components/i18n/i18n-provider"
import { compareMoneyMinor, fmtBusinessDate, fmtTimestamp, parseMinorUnits, resolveTimeZone } from "@/lib/format"

// lib/format display contract (audit F05 + F07): exact money ordering by
// currency then minor units, agency-zone timestamps with a visible zone label
// (UTC fallback for unknown zones), and calendar business dates that never
// shift with any time zone.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const usd = (v: string | bigint) => ({ amountMinor: typeof v === "bigint" ? v : BigInt(v), currency: "USD" })

describe("parseMinorUnits", () => {
  it("accepts integer minor-unit strings (trimmed) and bigint", () => {
    expect(parseMinorUnits("10001")).toBe(10001n)
    expect(parseMinorUnits(" -42 ")).toBe(-42n)
    expect(parseMinorUnits("9007199254740993")).toBe(9007199254740993n)
    expect(parseMinorUnits(5n)).toBe(5n)
  })

  it("rejects empty, decimal, float, NaN-like and non-string input", () => {
    for (const v of ["", "  ", "100.01", "1e5", "abc", "--1", null, undefined, 100, 100.5, Number.NaN, {}]) {
      expect(parseMinorUnits(v), JSON.stringify(v)).toBeNull()
    }
  })
})

describe("compareMoneyMinor", () => {
  it("10001 sorts before 10099 (cents inside one major unit)", () => {
    expect(compareMoneyMinor(usd("10001"), usd("10099"))).toBeLessThan(0)
    expect(compareMoneyMinor(usd("10099"), usd("10001"))).toBeGreaterThan(0)
  })

  it("negatives order exactly and before zero", () => {
    expect(compareMoneyMinor(usd("-150"), usd("-149"))).toBeLessThan(0)
    expect(compareMoneyMinor(usd("-1"), usd("0"))).toBeLessThan(0)
    expect(compareMoneyMinor(usd("0"), usd("0"))).toBe(0)
  })

  it("distinguishes 9007199254740993 from 9007199254740992 (beyond Number precision)", () => {
    expect(Number(9007199254740993n)).toBe(Number(9007199254740992n)) // why floats are not allowed
    expect(compareMoneyMinor(usd(9007199254740993n), usd(9007199254740992n))).toBeGreaterThan(0)
    expect(compareMoneyMinor(usd(9007199254740992n), usd(9007199254740993n))).toBeLessThan(0)
  })

  it("never compares amounts across currencies: CAD groups before USD whatever the amounts", () => {
    expect(compareMoneyMinor({ amountMinor: 999999n, currency: "CAD" }, usd("1"))).toBeLessThan(0)
    expect(compareMoneyMinor(usd("1"), { amountMinor: 999999n, currency: "CAD" })).toBeGreaterThan(0)
    expect(compareMoneyMinor({ amountMinor: 1n, currency: "CAD" }, usd("1"))).not.toBe(0)
  })
})

describe("RecordGrid money column (grouping, empty/invalid placement)", () => {
  const columns: GridColumn[] = [
    { id: "label", header: "Label", kind: "text" },
    { id: "amount", header: "Amount", kind: "money", currencyKey: "currency" },
  ]
  const rows: GridRow[] = [
    { id: "1", label: "ROW-empty", amount: "", currency: "USD" },
    { id: "2", label: "ROW-usd-10099", amount: "10099", currency: "USD" },
    { id: "3", label: "ROW-undefined", currency: "USD" },
    { id: "4", label: "ROW-cad-9007199254740993", amount: "9007199254740993", currency: "CAD" },
    { id: "5", label: "ROW-usd-10001", amount: "10001", currency: "USD" },
    { id: "6", label: "ROW-null", amount: null, currency: "USD" },
    { id: "7", label: "ROW-cad-9007199254740992", amount: "9007199254740992", currency: "CAD" },
  ]
  const order = () => screen.getAllByText(/^ROW-/).map((e) => e.textContent)
  const grid = (desc: boolean) =>
    render(
      <I18nProvider locale="en">
        <RecordGrid rows={rows} columns={columns} emptyMessage="empty" pageSize={50} initialSort={[{ id: "amount", desc }]} />
      </I18nProvider>
    )

  it("ascending: grouped by currency, exact within each, empty/invalid last", () => {
    grid(false)
    const o = order()
    expect(o.slice(0, 4)).toEqual(["ROW-cad-9007199254740992", "ROW-cad-9007199254740993", "ROW-usd-10001", "ROW-usd-10099"])
    expect(new Set(o.slice(4))).toEqual(new Set(["ROW-empty", "ROW-undefined", "ROW-null"]))
  })

  it("an invalid wire value or empty string renders as — (never a fabricated 0.00) and does not crash the grid", () => {
    render(
      <I18nProvider locale="en">
        <RecordGrid
          rows={[
            { id: "a", label: "ROW-invalid", amount: "12.50", currency: "USD" },
            { id: "b", label: "ROW-empty", amount: "", currency: "USD" },
            { id: "c", label: "ROW-ok", amount: "1250", currency: "USD" },
          ]}
          columns={columns}
          emptyMessage="empty"
          pageSize={50}
        />
      </I18nProvider>
    )
    const cellOf = (label: string) => screen.getByText(label).closest("tr")!.textContent ?? ""
    expect(cellOf("ROW-ok")).toContain("12.50")
    expect(cellOf("ROW-invalid")).toContain("—")
    expect(cellOf("ROW-empty")).toContain("—")
    expect(cellOf("ROW-empty")).not.toMatch(/0\.00/)
  })

  it("descending: exact reverse within currency, and empty/invalid still last", () => {
    grid(true)
    const o = order()
    expect(o.slice(0, 4)).toEqual(["ROW-usd-10099", "ROW-usd-10001", "ROW-cad-9007199254740993", "ROW-cad-9007199254740992"])
    expect(new Set(o.slice(4))).toEqual(new Set(["ROW-empty", "ROW-undefined", "ROW-null"]))
  })
})

describe("fmtTimestamp (agency zone, visible label)", () => {
  const instant = "2027-03-15T18:30:00Z"

  it("America/Mexico_City shows 12:30 PM CST (UTC−6, no DST since 2022)", () => {
    expect(fmtTimestamp(instant, "en", "America/Mexico_City")).toBe("Mar 15, 2027, 12:30 PM CST")
  })

  it("America/Toronto shows 2:30 PM EDT (DST from 2027-03-14)", () => {
    expect(fmtTimestamp(instant, "en", "America/Toronto")).toBe("Mar 15, 2027, 2:30 PM EDT")
  })

  it("the same instant differs only by zone; Spanish keeps the offset label", () => {
    expect(fmtTimestamp(instant, "es", "America/Mexico_City")).toMatch(/12:30.*GMT-6/)
    expect(fmtTimestamp(instant, "es", "America/Toronto")).toMatch(/2:30.*GMT-4/)
  })

  it("unknown, empty or missing zone falls back to UTC and says so", () => {
    for (const z of ["Mars/Olympus_Mons", "", null, undefined]) {
      expect(resolveTimeZone(z)).toBe("UTC")
      expect(fmtTimestamp(instant, "en", z)).toBe("Mar 15, 2027, 6:30 PM UTC")
    }
  })

  it("accepts a Date as well as an ISO string", () => {
    expect(fmtTimestamp(new Date(instant), "en", "America/Toronto")).toBe(fmtTimestamp(instant, "en", "America/Toronto"))
  })
})

describe("fmtBusinessDate (calendar dates never shift)", () => {
  it("formats the calendar day of a YYYY-MM-DD date", () => {
    expect(fmtBusinessDate("2027-03-01", "en")).toBe("Mar 1, 2027")
    expect(fmtBusinessDate("2027-03-01", "es")).toMatch(/^1 mar 2027$/)
  })

  it("a full timestamp keeps its own date part even when the UTC instant is another day", () => {
    // 23:30 at UTC−6 is 05:30Z on April 1st; the business date stays March 31.
    expect(fmtBusinessDate("2027-03-31T23:30:00-06:00", "en")).toBe("Mar 31, 2027")
    expect(fmtBusinessDate("2027-01-01T00:15:00+14:00", "en")).toBe("Jan 1, 2027")
  })

  it("does not depend on the process time zone", () => {
    const prev = process.env.TZ
    try {
      for (const tz of ["Pacific/Honolulu", "Pacific/Kiritimati", "America/Mexico_City"]) {
        process.env.TZ = tz
        expect(fmtBusinessDate("2027-03-31", "en")).toBe("Mar 31, 2027")
      }
    } finally {
      if (prev === undefined) delete process.env.TZ
      else process.env.TZ = prev
    }
  })

  it("returns non-date input unchanged instead of inventing a date", () => {
    expect(fmtBusinessDate("not-a-date", "en")).toBe("not-a-date")
  })
})
