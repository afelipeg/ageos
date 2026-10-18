import { z } from "zod"

// Closed OpenUI library contract for assistant visuals (openui-view@1).
// Prop schemas are shared by the server composer (lib/assistant/openui-compose)
// and the browser renderer (components/openui). Only these five components
// exist; anything else is rejected before rendering. Money is always an exact
// minor-unit string plus currency; chart coordinates (`plot`) are bounded
// non-negative presentation numbers derived on the server, never used for
// arithmetic or shown as figures.

export const OPENUI_COMPONENTS = ["Dashboard", "MetricCard", "BarChart", "LineChart", "RecordTable"] as const
export type OpenUIComponentName = (typeof OPENUI_COMPONENTS)[number]

export const OPENUI_LIMITS = {
  sourceChars: 16_000,
  statements: 40,
  dashboardItems: 12,
  bars: 12,
  points: 60,
  columns: 6,
  rows: 25,
  text: 200,
  plotMax: 10_000,
} as const

const Text = z.string().max(OPENUI_LIMITS.text)
export const LocalizedSchema = z.object({ en: Text, es: Text }).strict()

const Minor = z.string().regex(/^-?\d{1,20}$/)
const Currency = z.string().regex(/^[A-Z]{3}$/)
const SignedInt = z.string().regex(/^-?\d{1,10}$/)
// Non-negative: OpenUI Lang parses `-n` as a unary expression, which the gate rejects.
const Plot = z.number().finite().min(0).max(OPENUI_LIMITS.plotMax)

export const DisplayValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("money"), minor: Minor, currency: Currency }).strict(),
  // Negative integers travel as strings: OpenUI Lang parses `-n` as an expression.
  z.object({ kind: z.literal("bps"), bps: z.union([z.number().int().min(0).max(1_000_000), SignedInt]).nullish() }).strict(),
  z.object({ kind: z.literal("minutes"), minutes: z.number().int().min(0).max(10_000_000) }).strict(),
  z.object({ kind: z.literal("count"), count: z.union([z.number().int().min(0).max(1_000_000_000), SignedInt]) }).strict(),
  z.object({ kind: z.literal("text"), text: Text }).strict(),
])

export const MetricCardProps = z
  .object({
    label: LocalizedSchema,
    value: DisplayValueSchema,
    secondary: DisplayValueSchema.nullish(),
    hint: LocalizedSchema.nullish(),
    tone: z.enum(["default", "positive", "warning"]).nullish(),
  })
  .strict()

export const BarChartProps = z
  .object({
    title: LocalizedSchema,
    currency: Currency,
    bars: z
      .array(z.object({ label: LocalizedSchema, valueMinor: Minor, plot: Plot }).strict())
      .min(1)
      .max(OPENUI_LIMITS.bars),
    caption: LocalizedSchema.nullish(),
  })
  .strict()

export const LineChartProps = z
  .object({
    title: LocalizedSchema,
    currency: Currency,
    points: z
      .array(
        z
          .object({
            label: Text,
            valueMinor: Minor,
            plot: Plot,
            series: z.enum(["actual", "forecast", "simulated"]),
          })
          .strict()
      )
      .min(2)
      .max(OPENUI_LIMITS.points),
    caption: LocalizedSchema.nullish(),
  })
  .strict()

export const RecordTableProps = z
  .object({
    title: LocalizedSchema,
    columns: z
      .array(z.object({ key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,40}$/), label: LocalizedSchema, align: z.enum(["start", "end"]).nullish() }).strict())
      .min(1)
      .max(OPENUI_LIMITS.columns),
    rows: z
      .array(
        z
          .object({
            cells: z.array(DisplayValueSchema).max(OPENUI_LIMITS.columns),
            /** Internal agency link; the renderer re-checks it belongs to the current agency. */
            href: z.string().max(300).nullish(),
          })
          .strict()
      )
      .max(OPENUI_LIMITS.rows),
    caption: LocalizedSchema.nullish(),
  })
  .strict()

export const DashboardMetaSchema = z
  .object({
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // nullish (not nullable): the OpenUI parser treats a present-but-null prop as missing-required.
    currency: Currency.nullish(),
    revision: z.number().int().nullish(),
    basis: z.string().max(40).nullish(),
  })
  .strict()

export type DisplayValueProps = z.infer<typeof DisplayValueSchema>
export type MetricCardPropsT = z.infer<typeof MetricCardProps>
export type BarChartPropsT = z.infer<typeof BarChartProps>
export type LineChartPropsT = z.infer<typeof LineChartProps>
export type RecordTablePropsT = z.infer<typeof RecordTableProps>
export type DashboardMeta = z.infer<typeof DashboardMetaSchema>
