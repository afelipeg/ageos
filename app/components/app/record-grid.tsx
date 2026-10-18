"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTable, type ColumnDef, type PaginationState, type Row, type SortingState } from "@tanstack/react-table"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Badge } from "@/components/reui/badge"
import { DataGrid, DataGridContainer, dataGridFeatures, type DataGridFeatures } from "@/components/reui/data-grid/data-grid"
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header"
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination"
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area"
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table"
import { Skeleton } from "@/components/ui/skeleton"
import { compareMoneyMinor, parseMinorUnits } from "@/lib/format"

import { StateBadge } from "./state-badge"

// Generic read grid over the ReUI Data Grid (TanStack v9). Columns are plain
// data so Server Components can describe a grid without shipping functions;
// sorting and paging are real (client-side over the authorized rows).

export type GridRow = Record<string, unknown> & { id: string }

export type GridColumn = {
  id: string
  /** i18n key or literal header */
  header: string
  kind: "text" | "mono" | "link" | "file" | "money" | "bps" | "state" | "date" | "timestamp" | "number" | "tags"
  /** For link: row key holding the href. Without an href the cell is plain text. */
  hrefKey?: string
  /** For file: row keys holding the type ("pdf") and the size in bytes. Both optional in the row. */
  typeKey?: string
  sizeKey?: string
  /** For money: row key holding the currency. */
  currencyKey?: string
  /** For state: i18n prefix for the label, e.g. "records.state" → records.state.<value>. */
  labelPrefix?: string
  /** Optional secondary line under the main value. */
  subKey?: string
  size?: number
  align?: "start" | "end"
  sortable?: boolean
}

function cellValue(row: GridRow, key: string) {
  return row[key]
}

/** Currency shown for a money cell; the sort uses the same value. */
function currencyOf(row: GridRow, c: GridColumn) {
  return String(cellValue(row, c.currencyKey ?? "currency") ?? "USD")
}

/** "2 MB" / "340 KB" from a byte count. */
function fileSize(bytes: number, locale: string) {
  const units = ["B", "KB", "MB", "GB"]
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${new Intl.NumberFormat(locale === "es" ? "es-MX" : "en-US", { maximumFractionDigits: i === 0 ? 0 : 1 }).format(n)} ${units[i]}`
}

export function RecordGrid({
  rows,
  columns,
  emptyMessage,
  pageSize = 10,
  rowHrefKey,
  compact = false,
  initialSort,
}: {
  rows: GridRow[]
  columns: GridColumn[]
  emptyMessage: string
  pageSize?: number
  rowHrefKey?: string
  /** Narrow tables (≤4 columns) scroll from 560px instead of 720px. */
  compact?: boolean
  initialSort?: SortingState
}) {
  const { t, money, pct, date, timestamp, locale } = useI18n()
  const router = useRouter()
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize })
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? [])
  const label = (h: string) => (h.includes(".") ? t(h) : h)

  const defs = useMemo<ColumnDef<DataGridFeatures, GridRow>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        accessorFn: (row: GridRow) => {
          const v = cellValue(row, c.id)
          // Money keeps exact minor units (bigint); missing/invalid sorts last.
          if (c.kind === "money") return parseMinorUnits(v) ?? undefined
          return v as string | number
        },
        ...(c.kind === "money"
          ? {
              sortUndefined: "last" as const,
              sortFn: (a: Row<DataGridFeatures, GridRow>, b: Row<DataGridFeatures, GridRow>, id: string) =>
                compareMoneyMinor(
                  { amountMinor: a.getValue(id) as bigint, currency: currencyOf(a.original, c) },
                  { amountMinor: b.getValue(id) as bigint, currency: currencyOf(b.original, c) }
                ),
            }
          : {}),
        header: ({ column }) =>
          c.sortable === false ? label(c.header) : <DataGridColumnHeader title={label(c.header)} column={column} />,
        enableSorting: c.sortable !== false,
        size: c.size,
        meta: {
          headerClassName: c.align === "end" ? "text-end [&>div]:justify-end" : undefined,
          cellClassName: c.align === "end" ? "text-end tabular-nums" : undefined,
          skeleton: <Skeleton className="h-4 w-20" />,
        },
        cell: ({ row }) => {
          const r = row.original
          const v = cellValue(r, c.id)
          const sub = c.subKey ? (cellValue(r, c.subKey) as string | null) : null
          let main: React.ReactNode
          switch (c.kind) {
            case "link": {
              const href = cellValue(r, c.hrefKey ?? "href")
              main =
                typeof href === "string" && href ? (
                  <Link href={href} className="font-medium text-foreground underline-offset-3 hover:underline">
                    {String(v ?? "—")}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{String(v ?? "—")}</span>
                )
              break
            }
            case "file": {
              const type = cellValue(r, c.typeKey ?? "format")
              const size = cellValue(r, c.sizeKey ?? "sizeBytes")
              const meta = [
                typeof type === "string" && type ? type.toUpperCase() : null,
                typeof size === "number" && Number.isFinite(size) ? fileSize(size, locale) : null,
              ]
                .filter(Boolean)
                .join(" · ")
              main = (
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-foreground">{String(v ?? "—")}</span>
                  {meta && <span className="truncate text-xs text-muted-foreground">{meta}</span>}
                </div>
              )
              break
            }
            case "money":
              main = <span className="ageos-figure tabular-nums">{money(v as string | null, currencyOf(r, c))}</span>
              break
            case "bps":
              main = <span className="ageos-figure tabular-nums">{pct(v as number | null)}</span>
              break
            case "state":
              main = <StateBadge state={String(v)} label={c.labelPrefix ? t(`${c.labelPrefix}.${String(v)}`) : String(v)} />
              break
            case "date":
              main = v ? date(String(v)) : "—"
              break
            case "timestamp":
              main = v ? <span className="tabular-nums">{timestamp(String(v))}</span> : "—"
              break
            case "number":
              main = <span className="tabular-nums">{v === null || v === undefined ? "—" : new Intl.NumberFormat(locale === "es" ? "es-MX" : "en-US").format(Number(v))}</span>
              break
            case "mono":
              main = <span className="font-mono text-xs">{String(v ?? "—")}</span>
              break
            case "tags":
              main = (
                <span className="flex flex-wrap gap-1">
                  {((v as string[]) ?? []).map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </span>
              )
              break
            default:
              main = <span>{v === null || v === undefined || v === "" ? "—" : String(v)}</span>
          }
          return sub ? (
            <div className="flex min-w-0 flex-col">
              {main}
              <span className="truncate text-xs text-muted-foreground">{sub}</span>
            </div>
          ) : (
            main
          )
        },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, locale]
  )

  const table = useTable({
    features: dataGridFeatures,
    columns: defs,
    data: rows,
    getRowId: (row: GridRow) => row.id,
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    autoResetPageIndex: false,
  })

  return (
    <DataGrid
      table={table}
      recordCount={rows.length}
      tableLayout={{ dense: true, headerSticky: true }}
      tableClassNames={{ base: compact ? "min-w-[560px]" : "min-w-[720px]" }}
      emptyMessage={emptyMessage}
      onRowClick={rowHrefKey ? (row) => router.push(String(row[rowHrefKey])) : undefined}
    >
      <div className="flex w-full flex-col gap-2.5">
        <DataGridContainer>
          <DataGridScrollArea>
            <DataGridTable />
          </DataGridScrollArea>
        </DataGridContainer>
        {rows.length > pageSize ? (
          <DataGridPagination
            rowsPerPageLabel={t("common.rowsPerPage")}
            previousPageLabel={t("common.previous")}
            nextPageLabel={t("common.next")}
          />
        ) : null}
      </div>
    </DataGrid>
  )
}
