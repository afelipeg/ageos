import { render, screen, within } from "@testing-library/react"
import { vi } from "vitest"

import { RecordGrid, type GridColumn, type GridRow } from "@/components/app/record-grid"
import { I18nProvider } from "@/components/i18n/i18n-provider"
import { compareMoneyMinor, parseMinorUnits } from "@/lib/format"

// Audit regression F05: money columns sort by exact minor units. Cents inside
// the same major unit, negatives, and amounts beyond Number.MAX_SAFE_INTEGER
// must order exactly (the previous accessor truncated to whole units).

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const columns: GridColumn[] = [
  { id: "label", header: "Label", kind: "text" },
  { id: "amount", header: "Amount", kind: "money", currencyKey: "currency", align: "end" },
]

// Each tie pair under truncation is listed in the WRONG order on purpose, so a
// stable sort over truncated values keeps it wrong and the test fails.
const rows: GridRow[] = [
  { id: "a", label: "ROW-10099", amount: "10099", currency: "USD" },
  { id: "b", label: "ROW-10001", amount: "10001", currency: "USD" },
  { id: "c", label: "ROW-neg149", amount: "-149", currency: "USD" },
  { id: "d", label: "ROW-neg150", amount: "-150", currency: "USD" },
  { id: "e", label: "ROW-big312", amount: "900719925474099312", currency: "USD" },
  { id: "f", label: "ROW-big311", amount: "900719925474099311", currency: "USD" },
]

function renderedOrder() {
  return screen.getAllByText(/^ROW-/).map((el) => el.textContent)
}

function renderGrid(desc: boolean, data: GridRow[] = rows) {
  return render(
    <I18nProvider locale="en">
      <RecordGrid rows={data} columns={columns} emptyMessage="empty" pageSize={50} initialSort={[{ id: "amount", desc }]} />
    </I18nProvider>
  )
}

describe("F05 · RecordGrid money sort uses exact minor units", () => {
  it("ascending: negatives, cents within one unit and >2^53 amounts are exact", () => {
    renderGrid(false)
    expect(renderedOrder()).toEqual(["ROW-neg150", "ROW-neg149", "ROW-10001", "ROW-10099", "ROW-big311", "ROW-big312"])
  })

  it("descending is the exact reverse", () => {
    renderGrid(true)
    expect(renderedOrder()).toEqual(["ROW-big312", "ROW-big311", "ROW-10099", "ROW-10001", "ROW-neg149", "ROW-neg150"])
  })

  it("still renders the formatted amount (display unchanged by the sort fix)", () => {
    renderGrid(false)
    const row = screen.getByText("ROW-10001").closest("tr")!
    expect(within(row).getByText(/100\.01/)).toBeInTheDocument()
  })

  it("mixed currencies are never compared by amount: rows group by ISO code, then exact minor units; missing sorts last", () => {
    renderGrid(false, [
      { id: "1", label: "ROW-usd-5", amount: "500", currency: "USD" },
      { id: "2", label: "ROW-missing", amount: null, currency: "USD" },
      { id: "3", label: "ROW-cad-900", amount: "90000", currency: "CAD" },
      { id: "4", label: "ROW-usd-1", amount: "100", currency: "USD" },
      { id: "5", label: "ROW-cad-1", amount: "100", currency: "CAD" },
    ])
    expect(renderedOrder()).toEqual(["ROW-cad-1", "ROW-cad-900", "ROW-usd-1", "ROW-usd-5", "ROW-missing"])
  })
})

describe("F05 · exported exact comparator (lib/format)", () => {
  it("orders by bigint minor units within a currency", () => {
    const k = (v: string) => ({ amountMinor: BigInt(v), currency: "USD" })
    expect(compareMoneyMinor(k("10001"), k("10099"))).toBeLessThan(0)
    expect(compareMoneyMinor(k("-150"), k("-149"))).toBeLessThan(0)
    expect(compareMoneyMinor(k("900719925474099312"), k("900719925474099311"))).toBeGreaterThan(0)
    expect(compareMoneyMinor(k("0"), k("0"))).toBe(0)
  })

  it("parses only integer minor-unit strings or bigint", () => {
    expect(parseMinorUnits("10099")).toBe(10099n)
    expect(parseMinorUnits("-5")).toBe(-5n)
    expect(parseMinorUnits(7n)).toBe(7n)
    expect(parseMinorUnits("100.99")).toBeNull()
    expect(parseMinorUnits(100.99)).toBeNull()
    expect(parseMinorUnits(null)).toBeNull()
  })
})
