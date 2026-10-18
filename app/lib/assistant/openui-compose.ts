import { OPENUI_VIEW_VERSION, type DisplayValue, type Localized, type OpenUIViewPart, type SourceRefView } from "./types"
import { OPENUI_LIMITS } from "./openui-schema"

// Server-side composition of OpenUI Lang programs from FIXED templates. Every
// value is serialized as a literal (strings JSON-escaped), so business data or
// user-entered names can never become code, components, $state, Query() or
// actions. Statement ids and component names come only from this file.

type Ref = { readonly $ref: string }
type Literal = string | number | boolean | null | Ref | Literal[] | { [key: string]: Literal | undefined }

const ID = /^[a-z][a-zA-Z0-9_]{0,30}$/
const ref = (id: string): Ref => {
  if (!ID.test(id)) throw new Error(`openui: invalid statement id ${id}`)
  return { $ref: id }
}

function lit(v: Literal): string {
  if (v === null) return "null"
  if (typeof v === "string") return JSON.stringify(v.slice(0, OPENUI_LIMITS.text))
  if (typeof v === "number") {
    // OpenUI Lang has no negative literals (`-n` is an expression): templates
    // must send signed integers as strings (see `signed`).
    if (!Number.isFinite(v) || v < 0) throw new Error("openui: numbers must be finite and non-negative")
    return String(v)
  }
  if (typeof v === "boolean") return v ? "true" : "false"
  if (Array.isArray(v)) return `[${v.map(lit).join(", ")}]`
  if ("$ref" in v && typeof v.$ref === "string") return v.$ref
  const entries = Object.entries(v).filter((e): e is [string, Literal] => e[1] !== undefined)
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}: ${lit(val)}`).join(", ")}}`
}

type Statement = { id: string; component: "Dashboard" | "MetricCard" | "BarChart" | "LineChart" | "RecordTable"; args: Literal[] }

function program(statements: Statement[]): string {
  const lines = statements.map((s) => {
    if (s.id !== "root" && !ID.test(s.id)) throw new Error(`openui: invalid statement id ${s.id}`)
    // Trailing optional args are omitted rather than sent as null.
    const args = [...s.args]
    while (args.length && (args[args.length - 1] === undefined || args[args.length - 1] === null)) args.pop()
    return `${s.id} = ${s.component}(${args.map((a) => lit(a === undefined ? null : a)).join(", ")})`
  })
  const source = lines.join("\n")
  if (source.length > OPENUI_LIMITS.sourceChars) throw new Error("openui: program exceeds the size limit")
  return source
}

const L = (en: string, es: string): Localized => ({ en, es })
/** Signed integer for OpenUI props: non-negative stays numeric, negative becomes a string. */
const signed = (n: number): number | string => (n < 0 ? String(n) : n)
const bpsLit = (bps: number | null): Literal => ({ kind: "bps", bps: bps === null ? null : signed(bps) })
/** A typed display value as an OpenUI literal (signed integers made safe). */
const dvLit = (v: DisplayValue): Literal =>
  v.kind === "bps" ? bpsLit(v.bps) : v.kind === "count" ? { kind: "count", count: signed(v.count) } : (v as unknown as Literal)
const money = (minor: string | bigint, currency: string): DisplayValue => ({ kind: "money", minor: String(minor), currency })

/** Bar coordinate in [0, 10000] for a non-negative amount; the exact value travels as `valueMinor`. */
export function plotOf(minor: bigint, max: bigint): number {
  if (max <= 0n || minor <= 0n) return 0
  return Number((minor * 1_000_000n) / max) / 100
}

/** Line coordinates on a relative [0, 10000] scale between the series min and max (sign-safe). */
export function plotRange(values: bigint[]): number[] {
  if (!values.length) return []
  const min = values.reduce((m, v) => (v < m ? v : m), values[0]!)
  const max = values.reduce((m, v) => (v > m ? v : m), values[0]!)
  if (max === min) return values.map(() => 5000)
  return values.map((v) => Number(((v - min) * 1_000_000n) / (max - min)) / 100)
}

const asBig = (v: unknown): bigint | null => {
  if (typeof v === "bigint") return v
  if (typeof v === "string" && /^-?\d{1,20}$/.test(v)) return BigInt(v)
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v)
  return null
}

// ── Template: margin dashboard (S-MARGIN-EXPLAIN, ERP-39) ──

export type MarginDashboardInput = {
  skillId: string
  job: { name: string; displayReference: string; jobNumber: string; revision: number }
  profit: {
    basis: string
    asOf: string
    currency: string
    agencyFeeMinor: string
    managedMediaMinor: string
    agencyCost: { laborMinutes: number; laborMinor: string; productionMinor: string; expenseMinor: string; totalMinor: string }
    marginMinor: string
    marginBps: number | null
    definition: string
  }
  floorBps: number
  sources: SourceRefView[]
}

export function marginDashboardView(input: MarginDashboardInput): OpenUIViewPart {
  const { job, profit } = input
  const c = profit.currency
  const breakdown = [
    { id: "labor", label: L("Labor", "Mano de obra"), minor: BigInt(profit.agencyCost.laborMinor) },
    { id: "production", label: L("Production vendors", "Proveedores de producción"), minor: BigInt(profit.agencyCost.productionMinor) },
    { id: "expense", label: L("Expenses", "Gastos"), minor: BigInt(profit.agencyCost.expenseMinor) },
  ]
  const maxMinor = breakdown.reduce((m, b) => (b.minor > m ? b.minor : m), 0n)
  const below = profit.marginBps !== null && profit.marginBps < input.floorBps
  const title = L(`${job.name} · projected margin`, `${job.name} · margen proyectado`)
  const sources = input.sources.slice(0, OPENUI_LIMITS.rows)
  const statements: Statement[] = [
    {
      id: "root",
      component: "Dashboard",
      args: [
        title,
        { asOf: profit.asOf, currency: c, revision: job.revision, basis: profit.basis },
        [ref("fee"), ref("cost"), ref("margin"), ref("media"), ref("costs"), ref("sources")],
        L(`Definition: ${profit.definition}`, `Definición: ${profit.definition}`),
      ],
    },
    { id: "fee", component: "MetricCard", args: [L("Agency fee (net revenue)", "Honorario de agencia (ingreso neto)"), money(profit.agencyFeeMinor, c)] },
    {
      id: "cost",
      component: "MetricCard",
      args: [L("Agency cost (forecast)", "Costo de agencia (proyectado)"), money(profit.agencyCost.totalMinor, c), { kind: "minutes", minutes: profit.agencyCost.laborMinutes }],
    },
    {
      id: "margin",
      component: "MetricCard",
      args: [
        L("Margin", "Margen"),
        bpsLit(profit.marginBps),
        money(profit.marginMinor, c),
        below ? L("Below the 40% floor", "Por debajo del mínimo de 40%") : L("At or above the 40% floor", "En o por encima del mínimo de 40%"),
        below ? "warning" : "positive",
      ],
    },
    {
      id: "media",
      component: "MetricCard",
      args: [L("Managed media (pass-through)", "Medios administrados (pass-through)"), money(profit.managedMediaMinor, c), null, L("Excluded from margin", "Excluido del margen")],
    },
    {
      id: "costs",
      component: "BarChart",
      args: [
        L("Cost breakdown", "Desglose de costos"),
        c,
        breakdown.map((b) => ({ label: b.label, valueMinor: b.minor.toString(), plot: plotOf(b.minor, maxMinor) })),
        L("Current cost estimate lines, exact amounts in labels and table.", "Líneas de la estimación vigente; importes exactos en etiquetas y tabla."),
      ],
    },
    {
      id: "sources",
      component: "RecordTable",
      args: [
        L("Sources", "Fuentes"),
        [
          { key: "record", label: L("Record", "Registro") },
          { key: "type", label: L("Type", "Tipo") },
          { key: "revision", label: L("Revision", "Revisión"), align: "end" },
          { key: "asOf", label: L("As of", "Corte") },
        ],
        sources.map((s) => ({
          cells: [
            { kind: "text", text: s.label },
            { kind: "text", text: s.recordType },
            s.revision === null ? { kind: "text", text: "—" } : { kind: "count", count: signed(s.revision) },
            { kind: "text", text: s.asOf },
          ],
          href: s.href,
        })),
      ],
    },
  ]
  // Optional props in the middle of positional args are sent as null (nullish schemas).
  return {
    type: "openui_view",
    version: OPENUI_VIEW_VERSION,
    template: "margin_dashboard",
    skillId: input.skillId,
    title,
    source: program(statements),
    asOf: profit.asOf,
    currency: c,
    revision: job.revision,
    fallback: [
      { label: L("Agency fee (net revenue)", "Honorario de agencia (ingreso neto)"), value: money(profit.agencyFeeMinor, c) },
      { label: L("Agency cost (forecast)", "Costo de agencia (proyectado)"), value: money(profit.agencyCost.totalMinor, c) },
      { label: L("Labor", "Mano de obra"), value: money(profit.agencyCost.laborMinor, c) },
      { label: L("Production vendors", "Proveedores de producción"), value: money(profit.agencyCost.productionMinor, c) },
      { label: L("Expenses", "Gastos"), value: money(profit.agencyCost.expenseMinor, c) },
      { label: L("Margin", "Margen"), value: { kind: "bps", bps: profit.marginBps } },
      { label: L("Margin amount", "Importe del margen"), value: money(profit.marginMinor, c) },
      { label: L("Managed media (pass-through)", "Medios administrados (pass-through)"), value: money(profit.managedMediaMinor, c) },
    ],
  }
}

// ── Template: generic capability result (other ERP scenarios) ──

export function humanizeKey(key: string): string {
  const base = key.replace(/Minor$/, "").replace(/Bps$/, "").replace(/Id$/, " id")
  const spaced = base.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase()
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : key
}

const DATE_KEYS = ["date", "weekStart", "week", "period", "month", "day", "asOf"]

function cellOf(v: unknown, key: string, currency: string | null): DisplayValue {
  const big = asBig(v)
  if (key.endsWith("Minor") && big !== null && currency) return money(big, currency)
  if (key.endsWith("Bps") && typeof v === "number") return { kind: "bps", bps: Math.round(v) }
  if (typeof v === "number" && Number.isSafeInteger(v)) return { kind: "count", count: v }
  if (typeof v === "number") return { kind: "text", text: String(v) }
  if (typeof v === "string") return { kind: "text", text: v.slice(0, 120) }
  if (typeof v === "boolean") return { kind: "text", text: v ? "true" : "false" }
  if (v === null || v === undefined) return { kind: "text", text: "—" }
  return { kind: "text", text: Array.isArray(v) ? `${v.length}` : "…" }
}

/**
 * Composes a visual for a capability output when its shape carries exact
 * money/bps scalars, a dated money series, or a list of records. Returns null
 * when nothing can be shown faithfully (the typed result card still renders).
 */
export function capabilityResultView(input: {
  skillId: string
  label: Localized
  output: unknown
  asOf: string
  defaultCurrency: string | null
  seriesKind: "actual" | "forecast" | "simulated"
}): OpenUIViewPart | null {
  if (!input.output || typeof input.output !== "object" || Array.isArray(input.output)) return null
  const out = input.output as Record<string, unknown>
  const currency = typeof out.currency === "string" && /^[A-Z]{3}$/.test(out.currency) ? out.currency : input.defaultCurrency
  const statements: Statement[] = []
  const items: Ref[] = []
  const fallback: OpenUIViewPart["fallback"] = []

  // Metric cards: exact money (needs an explicit currency) and bps scalars.
  for (const [k, v] of Object.entries(out)) {
    if (items.length >= 4) break
    const big = asBig(v)
    if (k.endsWith("Minor") && big !== null && currency) {
      const id = `m${items.length}`
      const label = L(humanizeKey(k), humanizeKey(k))
      statements.push({ id, component: "MetricCard", args: [label, money(big, currency)] })
      fallback.push({ label, value: money(big, currency) })
      items.push(ref(id))
    } else if (k.endsWith("Bps") && (typeof v === "number" || v === null)) {
      const id = `m${items.length}`
      const label = L(humanizeKey(k), humanizeKey(k))
      const value: DisplayValue = { kind: "bps", bps: v === null ? null : Math.round(v as number) }
      statements.push({ id, component: "MetricCard", args: [label, dvLit(value)] })
      fallback.push({ label, value })
      items.push(ref(id))
    }
  }

  // First array of records: a dated money series becomes a LineChart, any
  // record list becomes a RecordTable (both bounded).
  const arrays = Object.entries(out).filter((e): e is [string, Record<string, unknown>[]] => Array.isArray(e[1]) && e[1].length > 0 && e[1].every((r) => r && typeof r === "object" && !Array.isArray(r)))
  const first = arrays[0]
  if (first) {
    const [key, rows] = first
    const sample = rows[0]!
    const dateKey = DATE_KEYS.find((d) => typeof sample[d] === "string")
    const moneyKey = Object.keys(sample).find((k) => k.endsWith("Minor") && asBig(sample[k]) !== null)
    if (dateKey && moneyKey && currency && rows.length >= 2 && rows.length <= OPENUI_LIMITS.points) {
      const values = rows.map((r) => asBig(r[moneyKey]) ?? 0n)
      const plots = plotRange(values)
      statements.push({
        id: "series",
        component: "LineChart",
        args: [
          L(`${humanizeKey(key)} · ${humanizeKey(moneyKey)}`, `${humanizeKey(key)} · ${humanizeKey(moneyKey)}`),
          currency,
          rows.map((r, i) => ({ label: String(r[dateKey]).slice(0, 40), valueMinor: values[i]!.toString(), plot: plots[i]!, series: input.seriesKind })),
          L("Relative scale; exact amounts in the tooltip and the table view.", "Escala relativa; importes exactos en la información emergente y la tabla."),
        ],
      })
      items.push(ref("series"))
    }
    const columns = Object.keys(sample)
      .filter((k) => ["string", "number", "boolean", "bigint"].includes(typeof sample[k]) && !/^(tenantId|createdBy|updatedBy)$/.test(k))
      .slice(0, OPENUI_LIMITS.columns)
    if (columns.length) {
      statements.push({
        id: "records",
        component: "RecordTable",
        args: [
          L(humanizeKey(key), humanizeKey(key)),
          columns.map((c) => ({ key: c.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-z]/, "c"), label: L(humanizeKey(c), humanizeKey(c)), align: c.endsWith("Minor") || typeof sample[c] === "number" ? "end" : "start" })),
          rows.slice(0, OPENUI_LIMITS.rows).map((r) => ({ cells: columns.map((c) => dvLit(cellOf(r[c], c, currency))) })),
        ],
      })
      items.push(ref("records"))
    }
  }

  if (!items.length) return null
  statements.unshift({
    id: "root",
    component: "Dashboard",
    args: [input.label, { asOf: input.asOf, currency, revision: null, basis: null }, items],
  })
  let source: string
  try {
    source = program(statements)
  } catch {
    return null
  }
  return {
    type: "openui_view",
    version: OPENUI_VIEW_VERSION,
    template: "capability_result",
    skillId: input.skillId,
    title: input.label,
    source,
    asOf: input.asOf,
    currency,
    revision: null,
    fallback,
  }
}
