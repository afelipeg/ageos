"use client"

import "./no-devtools"

import { createContext, useContext, useState, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import { createLibrary, createParser, defineComponent, type ElementNode, type ParseResult } from "@openuidev/react-lang"
import { Bar, BarChart as RBarChart, CartesianGrid, LabelList, Line, LineChart as RLineChart, XAxis, YAxis } from "recharts"
import { z } from "zod"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  BarChartProps,
  DashboardMetaSchema,
  LineChartProps,
  LocalizedSchema,
  MetricCardProps,
  OPENUI_COMPONENTS,
  OPENUI_LIMITS,
  RecordTableProps,
  type DisplayValueProps,
} from "@/lib/assistant/openui-schema"
import { fmtMinutesAsHours } from "@/lib/format"
import { cn } from "@/lib/utils"

// Closed OpenUI component library for assistant visuals (openui-view@1).
// Five AgeOS wrappers over installed ReUI/shadcn parts and Recharts. No
// component triggers actions, queries or mutations; links are internal
// agency routes only. Money is formatted from exact minor units.

export const OpenUIHost = createContext<{ agencySlug: string }>({ agencySlug: "" })

function useValue() {
  const { money, pct, locale } = useI18n()
  return (v: DisplayValueProps | null | undefined): string => {
    if (!v) return "—"
    switch (v.kind) {
      case "money":
        return money(v.minor, v.currency)
      case "bps":
        return pct(v.bps === null || v.bps === undefined ? null : Number(v.bps))
      case "minutes":
        return fmtMinutesAsHours(v.minutes, locale)
      case "count":
        return new Intl.NumberFormat(locale === "es" ? "es-MX" : "en-US").format(Number(v.count))
      case "text":
        return v.text
    }
  }
}

function InternalLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  const { agencySlug } = useContext(OpenUIHost)
  const ok = Boolean(href && agencySlug && href.startsWith(`/a/${agencySlug}/`) && !href.startsWith("//"))
  if (!ok) return <>{children}</>
  return (
    <Link href={href!} className="font-medium underline-offset-3 hover:underline">
      {children}
    </Link>
  )
}

function ChartOrTable({ chart, table, label }: { chart: ReactNode; table: ReactNode; label: string }) {
  const { t } = useI18n()
  const [asTable, setAsTable] = useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{label}</p>
        <Button type="button" variant="ghost" size="xs" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} className="shrink-0 text-muted-foreground hover:text-foreground">
          {asTable ? t("assistant.openui.showChart") : t("assistant.openui.showTable")}
        </Button>
      </div>
      {asTable ? table : chart}
    </div>
  )
}

const MetricCard = defineComponent({
  name: "MetricCard",
  description: "One exact figure with label, optional secondary value and hint.",
  props: MetricCardProps,
  component: function MetricCardView({ props }) {
    const { pick } = useI18n()
    const fmt = useValue()
    return (
      <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-3">
        <p className="truncate text-xs text-muted-foreground">{pick(props.label)}</p>
        <p className="text-lg/6 font-semibold tabular-nums">{fmt(props.value)}</p>
        {props.secondary ? <p className="text-xs tabular-nums text-muted-foreground">{fmt(props.secondary)}</p> : null}
        {props.hint ? (
          <Badge variant={props.tone === "warning" ? "warning-light" : props.tone === "positive" ? "success-light" : "outline"} className="max-w-full self-start truncate">
            {pick(props.hint)}
          </Badge>
        ) : null}
      </div>
    )
  },
})

const BarChart = defineComponent({
  name: "BarChart",
  description: "Bounded bar chart; exact amounts in labels and the table view.",
  props: BarChartProps,
  component: function BarChartView({ props }) {
    const { pick, money } = useI18n()
    const data = props.bars.map((b) => ({ name: pick(b.label), plot: b.plot, exact: money(b.valueMinor, props.currency) }))
    const config: ChartConfig = { plot: { label: pick(props.title), color: "var(--chart-2)" } }
    const title = pick(props.title)
    return (
      <div className="flex min-w-0 flex-col gap-1 @2xl:col-span-2">
        <ChartOrTable
          label={title}
          chart={
            <ChartContainer config={config} className="aspect-auto h-[calc(var(--bars)*40px+16px)] w-full" style={{ "--bars": data.length } as CSSProperties} role="img" aria-label={`${title}: ${data.map((d) => `${d.name} ${d.exact}`).join("; ")}`}>
              <RBarChart data={data} layout="vertical" margin={{ left: 4, right: 96, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" dataKey="plot" hide />
                <YAxis type="category" dataKey="name" width={124} tickLine={false} axisLine={false} />
                <ChartTooltip
                  cursor={false}
                  content={({ active, payload }) =>
                    active && payload?.[0] ? (
                      <div className="rounded-md border border-border bg-background px-2 py-1 text-xs shadow-sm">
                        {(payload[0].payload as { name: string }).name}: <span className="font-medium tabular-nums">{(payload[0].payload as { exact: string }).exact}</span>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="plot" fill="var(--color-plot)" radius={4} isAnimationActive={false}>
                  <LabelList dataKey="exact" position="right" className="fill-foreground" fontSize={12} />
                </Bar>
              </RBarChart>
            </ChartContainer>
          }
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{title}</TableHead>
                  <TableHead className="text-end">{props.currency}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((d) => (
                  <TableRow key={d.name}>
                    <TableCell>{d.name}</TableCell>
                    <TableCell className="text-end tabular-nums">{d.exact}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        />
        {props.caption ? <p className="text-xs text-muted-foreground">{pick(props.caption)}</p> : null}
      </div>
    )
  },
})

const LineChart = defineComponent({
  name: "LineChart",
  description: "Ordered series; actual, forecast and simulated points are distinguished.",
  props: LineChartProps,
  component: function LineChartView({ props }) {
    const { pick, money, t } = useI18n()
    const data = props.points.map((p) => ({
      name: p.label,
      actual: p.series === "actual" ? p.plot : null,
      projected: p.series !== "actual" ? p.plot : null,
      exact: money(p.valueMinor, props.currency),
      series: p.series,
    }))
    const title = pick(props.title)
    const config: ChartConfig = {
      actual: { label: t("assistant.openui.series.actual"), color: "var(--chart-2)" },
      projected: { label: t(`assistant.openui.series.${props.points.find((p) => p.series !== "actual")?.series ?? "forecast"}`), color: "var(--chart-1)" },
    }
    return (
      <div className="flex min-w-0 flex-col gap-1 @2xl:col-span-2">
        <ChartOrTable
          label={title}
          chart={
            <ChartContainer config={config} className="aspect-auto h-[200px] w-full" role="img" aria-label={`${title}: ${data.map((d) => `${d.name} ${d.exact}`).join("; ")}`}>
              <RLineChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis hide />
                <ChartTooltip
                  content={({ active, payload }) =>
                    active && payload?.[0] ? (
                      <div className="rounded-md border border-border bg-background px-2 py-1 text-xs shadow-sm">
                        {(payload[0].payload as { name: string }).name} · {t(`assistant.openui.series.${(payload[0].payload as { series: string }).series}`)}:{" "}
                        <span className="font-medium tabular-nums">{(payload[0].payload as { exact: string }).exact}</span>
                      </div>
                    ) : null
                  }
                />
                <Line dataKey="actual" type="monotone" stroke="var(--color-actual)" strokeWidth={2} dot connectNulls={false} isAnimationActive={false} />
                <Line dataKey="projected" type="monotone" stroke="var(--color-projected)" strokeWidth={2} strokeDasharray="4 4" dot connectNulls={false} isAnimationActive={false} />
              </RLineChart>
            </ChartContainer>
          }
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("assistant.openui.period")}</TableHead>
                  <TableHead>{t("assistant.openui.seriesLabel")}</TableHead>
                  <TableHead className="text-end">{props.currency}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((d, i) => (
                  <TableRow key={`${d.name}-${i}`}>
                    <TableCell>{d.name}</TableCell>
                    <TableCell>{t(`assistant.openui.series.${d.series}`)}</TableCell>
                    <TableCell className="text-end tabular-nums">{d.exact}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        />
        {props.caption ? <p className="text-xs text-muted-foreground">{pick(props.caption)}</p> : null}
      </div>
    )
  },
})

const RecordTable = defineComponent({
  name: "RecordTable",
  description: "Bounded list of authorized records with internal links.",
  props: RecordTableProps,
  component: function RecordTableView({ props }) {
    const { pick, t } = useI18n()
    const fmt = useValue()
    return (
      <div className="flex min-w-0 flex-col gap-1 @2xl:col-span-full @sm:col-span-full">
        <p className="text-sm font-medium">{pick(props.title)}</p>
        {props.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("assistant.openui.noRows")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {props.columns.map((c) => (
                  <TableHead key={c.key} className={cn(c.align === "end" && "text-end")}>
                    {pick(c.label)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.rows.map((r, i) => (
                <TableRow key={i}>
                  {props.columns.map((c, ci) => (
                    <TableCell key={c.key} className={cn("max-w-48 truncate", c.align === "end" && "text-end tabular-nums")}>
                      {ci === 0 ? <InternalLink href={r.href}>{fmt(r.cells[ci])}</InternalLink> : fmt(r.cells[ci])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {props.caption ? <p className="text-xs text-muted-foreground">{pick(props.caption)}</p> : null}
      </div>
    )
  },
})

const DashboardProps = z
  .object({
    title: LocalizedSchema,
    meta: DashboardMetaSchema,
    items: z.array(z.union([MetricCard.ref, BarChart.ref, LineChart.ref, RecordTable.ref])).min(1).max(OPENUI_LIMITS.dashboardItems),
    note: LocalizedSchema.nullish(),
  })
  .strict()

const Dashboard = defineComponent({
  name: "Dashboard",
  description: "Root layout: composes metric cards, charts and tables with as-of, currency and revision.",
  props: DashboardProps,
  component: function DashboardView({ props, renderNode }) {
    const { pick, t, date } = useI18n()
    return (
      <Card size="sm" className="w-full min-w-0">
        <CardHeader>
          <CardTitle>{pick(props.title)}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">
              {t("assistant.card.asOf")} {date(props.meta.asOf)}
            </Badge>
            {props.meta.currency ? <Badge variant="outline">{props.meta.currency}</Badge> : null}
            {props.meta.basis ? <Badge variant="outline">{t(`common.${props.meta.basis}`)}</Badge> : null}
            {props.meta.revision !== null && props.meta.revision !== undefined ? (
              <Badge variant="outline">
                {t("assistant.card.revision")} {props.meta.revision}
              </Badge>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="@container">
          <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @2xl:grid-cols-4">{renderNode(props.items)}</div>
        </CardContent>
        {props.note ? (
          <CardFooter>
            <p className="text-xs text-muted-foreground">{pick(props.note)}</p>
          </CardFooter>
        ) : null}
      </Card>
    )
  },
})

export const openuiLibrary = createLibrary({
  components: [Dashboard, MetricCard, BarChart, LineChart, RecordTable],
  root: "Dashboard",
  id: "ageos-assistant-openui@1",
})

const SCHEMAS: Record<string, z.ZodType> = {
  MetricCard: MetricCardProps,
  BarChart: BarChartProps,
  LineChart: LineChartProps,
  RecordTable: RecordTableProps,
}

let parser: ReturnType<typeof createParser> | null = null

export type OpenUIValidation = { ok: true; result: ParseResult } | { ok: false; reason: string }

function isElement(v: unknown): v is ElementNode {
  return Boolean(v) && typeof v === "object" && (v as ElementNode).type === "element"
}

/** True when a value holds an unevaluated expression node (state refs, operators, queries). */
function hasExpression(v: unknown): boolean {
  if (!v || typeof v !== "object") return false
  if (isElement(v)) return false
  if ("k" in (v as object) && typeof (v as { k: unknown }).k === "string") return true
  return Array.isArray(v) ? v.some(hasExpression) : Object.values(v as object).some(hasExpression)
}

/**
 * Validation gate run BEFORE rendering: size, parse errors, closed component
 * set, static literal props only (no $state, Query, Mutation, actions or
 * expressions), statement limits and every prop schema.
 */
export function validateOpenUISource(source: unknown): OpenUIValidation {
  if (typeof source !== "string" || !source.trim()) return { ok: false, reason: "empty" }
  if (source.length > OPENUI_LIMITS.sourceChars) return { ok: false, reason: "too_large" }
  parser ??= createParser(openuiLibrary.toJSONSchema())
  let result: ParseResult
  try {
    result = parser.parse(source)
  } catch {
    return { ok: false, reason: "parse_failed" }
  }
  const m = result.meta
  if (!result.root || m.incomplete) return { ok: false, reason: "incomplete" }
  if (m.errors.length) return { ok: false, reason: m.errors[0]!.code }
  if (m.unresolved.length || m.orphaned.length) return { ok: false, reason: "unresolved" }
  if (m.statementCount > OPENUI_LIMITS.statements) return { ok: false, reason: "too_many_statements" }
  if (result.queryStatements.length || result.mutationStatements.length || Object.keys(result.stateDeclarations).length) return { ok: false, reason: "runtime_not_allowed" }
  if (result.root.typeName !== "Dashboard") return { ok: false, reason: "root" }
  const stack: ElementNode[] = [result.root]
  while (stack.length) {
    const node = stack.pop()!
    if (!(OPENUI_COMPONENTS as readonly string[]).includes(node.typeName)) return { ok: false, reason: "unknown-component" }
    if (node.hasDynamicProps !== false || node.partial) return { ok: false, reason: "dynamic_props" }
    if (hasExpression(node.props)) return { ok: false, reason: "dynamic_props" }
    if (node.typeName === "Dashboard") {
      const items = node.props.items
      if (!Array.isArray(items) || !items.every(isElement) || items.some((i) => i.typeName === "Dashboard")) return { ok: false, reason: "items" }
      const rest = Object.fromEntries(Object.entries(node.props).filter(([k]) => k !== "items"))
      if (!DashboardProps.omit({ items: true }).safeParse(rest).success) return { ok: false, reason: "props" }
      stack.push(...items)
    } else if (!SCHEMAS[node.typeName]!.safeParse(node.props).success) {
      return { ok: false, reason: "props" }
    }
  }
  return { ok: true, result }
}

