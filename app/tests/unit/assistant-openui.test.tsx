import { render, screen } from "@testing-library/react"

import { I18nProvider } from "@/components/i18n/i18n-provider"
import { openuiLibrary, validateOpenUISource } from "@/components/openui/library"
import { OpenUIMessage } from "@/components/openui/openui-view"
import { capabilityResultView, marginDashboardView, plotOf, plotRange } from "@/lib/assistant/openui-compose"
import { OPENUI_LIMITS } from "@/lib/assistant/openui-schema"
import type { OpenUIViewPart } from "@/lib/assistant/types"

// OpenUI (@openuidev/react-lang 0.3.0) with the closed AgeOS library: server
// templates compose literal-only programs; the browser validates before
// rendering and falls back to a readable table on any invalid payload.

const AURORA = {
  skillId: "agency-profitability",
  job: { name: "Aurora Spring Launch", displayReference: "RDS-2027-001", jobNumber: "AUR-SL-27-A-F-001", revision: 3 },
  profit: {
    basis: "forecast",
    asOf: "2027-03-15",
    currency: "USD",
    agencyFeeMinor: "2000000",
    managedMediaMinor: "3000000",
    agencyCost: { laborMinutes: 6000, laborMinor: "500000", productionMinor: "550000", expenseMinor: "50000", totalMinor: "1100000" },
    marginMinor: "900000",
    marginBps: 4500,
    definition: "margin = (approved agency fee − current cost estimate) / approved agency fee",
  },
  floorBps: 4000,
  sources: [{ recordType: "budget_revision", recordId: "00000000-0000-4000-8000-000000000001", revision: 1, label: "Budget r1 (approved)", href: "/a/rayo-de-sol/jobs/x?tab=scope", asOf: "2027-03-15" }],
}

function renderPart(part: OpenUIViewPart, locale: "en" | "es" = "en") {
  return render(
    <I18nProvider locale={locale}>
      <OpenUIMessage part={part} agencySlug="rayo-de-sol" />
    </I18nProvider>
  )
}

describe("OpenUI composition (server templates)", () => {
  it("composes the Aurora margin dashboard that validates against the closed library", () => {
    const part = marginDashboardView(AURORA)
    expect(part.version).toBe("openui-view@1")
    expect(part.source.split("\n")[0]).toMatch(/^root = Dashboard\(/)
    const v = validateOpenUISource(part.source)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.result.root?.typeName).toBe("Dashboard")
    expect(v.result.queryStatements).toHaveLength(0)
    expect(v.result.mutationStatements).toHaveLength(0)
    expect(Object.keys(openuiLibrary.components).sort()).toEqual(["BarChart", "Dashboard", "LineChart", "MetricCard", "RecordTable"])
  })

  it("keeps exact minor units in props; chart coordinates are bounded presentation numbers", () => {
    const part = marginDashboardView(AURORA)
    expect(part.source).toContain('"minor": "2000000"')
    expect(part.source).toContain('"valueMinor": "550000"')
    expect(plotOf(550000n, 550000n)).toBe(10000)
    expect(plotOf(-1n, 3n)).toBe(0)
    expect(plotOf(5n, 0n)).toBe(0)
    expect(plotRange([1000000n, -250000n, 1200000n])).toEqual([8620.68, 0, 10000])
    expect(plotRange([7n, 7n])).toEqual([5000, 5000])
  })

  it("user-controlled text (job names) can never become code", () => {
    const evil = { ...AURORA, job: { ...AURORA.job, name: 'X") \nq = Query("drop", {})\n$s = 1 @Run(q) ${x}' } }
    const part = marginDashboardView(evil)
    const v = validateOpenUISource(part.source)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.result.queryStatements).toHaveLength(0)
    expect(Object.keys(v.result.stateDeclarations)).toHaveLength(0)
    expect(String((v.result.root!.props.title as { en: string }).en)).toContain('Query("drop"')
  })

  it("reuses the library for other results: dated money series → LineChart, records → RecordTable", () => {
    const part = capabilityResultView({
      skillId: "agency-cash-forecast",
      label: { en: "Cash forecast", es: "Pronóstico de caja" },
      output: {
        currency: "USD",
        closingCashMinor: "1200000",
        weeks: [
          { weekStart: "2027-03-15", balanceMinor: "1000000" },
          { weekStart: "2027-03-22", balanceMinor: "-250000" },
          { weekStart: "2027-03-29", balanceMinor: "1200000" },
        ],
      },
      asOf: "2027-03-15",
      defaultCurrency: null,
      seriesKind: "forecast",
    })
    expect(part).not.toBeNull()
    const v = validateOpenUISource(part!.source)
    expect(v.ok).toBe(true)
    expect(part!.source).toContain("LineChart(")
    expect(part!.source).toContain("RecordTable(")
    expect(part!.fallback[0]).toEqual({ label: { en: "Closing cash", es: "Closing cash" }, value: { kind: "money", minor: "1200000", currency: "USD" } })
  })

  it("negative margins and counts survive as signed strings (no unary expressions)", () => {
    const part = marginDashboardView({ ...AURORA, profit: { ...AURORA.profit, marginMinor: "-200000", marginBps: -1000 } })
    expect(part.source).toContain('"bps": "-1000"')
    expect(validateOpenUISource(part.source).ok).toBe(true)
  })

  it("returns null instead of inventing a visual when the output has nothing faithful to show", () => {
    expect(capabilityResultView({ skillId: "x", label: { en: "x", es: "x" }, output: { ok: true, note: "done" }, asOf: "2027-03-15", defaultCurrency: null, seriesKind: "actual" })).toBeNull()
    // Money without an explicit currency is never charted.
    expect(capabilityResultView({ skillId: "x", label: { en: "x", es: "x" }, output: { totalMinor: "100" }, asOf: "2027-03-15", defaultCurrency: null, seriesKind: "actual" })).toBeNull()
  })
})

describe("OpenUI validation gate (browser)", () => {
  const base = marginDashboardView(AURORA).source
  it.each([
    ["unknown component", base.replace("fee = MetricCard(", "fee = Evil(")],
    ["Query statement", `${base}\nq = Query("tool", {})`],
    ["$state declaration", `${base}\n$v = 1`],
    ["runtime expression", base.replace('root = Dashboard({"en"', 'root = Dashboard({"en": "a" + "b", "x"')],
    ["wrong root", 'root = MetricCard({"en": "a", "es": "a"}, {"kind": "text", "text": "x"})'],
    ["non-exact money (float minor units)", base.replace('"minor": "2000000"', '"minor": "20000.5"')],
    ["lower-case currency", base.replace('"minor": "2000000", "currency": "USD"', '"minor": "2000000", "currency": "usd"')],
    ["oversized program", base + " ".repeat(OPENUI_LIMITS.sourceChars)],
    ["empty", ""],
    ["truncated", base.slice(0, base.length - 40)],
  ])("rejects %s", (_name, source) => {
    expect(validateOpenUISource(source).ok).toBe(false)
  })
})

describe("OpenUIMessage rendering", () => {
  it("renders the dashboard with exact money labels, as-of, revision and sources", () => {
    renderPart(marginDashboardView(AURORA))
    expect(screen.getByText("Aurora Spring Launch · projected margin")).toBeInTheDocument()
    expect(screen.getByText("USD 20,000.00")).toBeInTheDocument()
    expect(screen.getByText("USD 11,000.00")).toBeInTheDocument()
    expect(screen.getByText("45.0%")).toBeInTheDocument()
    expect(screen.getByText(/Revision 3|Job revision 3/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Budget r1 (approved)" })).toHaveAttribute("href", "/a/rayo-de-sol/jobs/x?tab=scope")
    // Table alternative to the chart is one keyboard-reachable toggle away.
    expect(screen.getByRole("button", { name: "Show as table" })).toHaveAttribute("aria-pressed", "false")
  })

  it("shows 35.0% and 43.5% for the later Aurora checkpoints", () => {
    const { unmount } = renderPart(marginDashboardView({ ...AURORA, profit: { ...AURORA.profit, marginBps: 3500 } }))
    expect(screen.getByText("35.0%")).toBeInTheDocument()
    unmount()
    renderPart(marginDashboardView({ ...AURORA, profit: { ...AURORA.profit, marginBps: 4348 } }))
    expect(screen.getByText("43.5%")).toBeInTheDocument()
  })

  it("renders Spanish labels from the same persisted program", () => {
    renderPart(marginDashboardView(AURORA), "es")
    expect(screen.getByText("Aurora Spring Launch · margen proyectado")).toBeInTheDocument()
    expect(screen.getByText("Desglose de costos")).toBeInTheDocument()
  })

  it("an invalid or unknown payload shows a recoverable notice plus the readable fallback, never a blank message", () => {
    const part = { ...marginDashboardView(AURORA), source: 'root = Evil("x")' }
    const { container } = renderPart(part)
    expect(screen.getByText("Visual view unavailable")).toBeInTheDocument()
    expect(screen.getByText("USD 20,000.00")).toBeInTheDocument()
    expect(container.querySelector("[data-openui-fallback]")).not.toBeNull()
  })

  it("an unknown view version falls back too", () => {
    const part = { ...marginDashboardView(AURORA), version: "openui-view@9" } as unknown as OpenUIViewPart
    renderPart(part)
    expect(screen.getByText("Visual view unavailable")).toBeInTheDocument()
  })

  it("links outside the current agency render as plain text", () => {
    const view = marginDashboardView({ ...AURORA, sources: [{ ...AURORA.sources[0]!, href: "https://evil.example/x", label: "External" }] })
    renderPart(view)
    expect(screen.getByText("External").closest("a")).toBeNull()
  })
})
