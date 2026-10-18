"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTable, type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table"
import { SearchIcon } from "lucide-react"

import { StateBadge } from "@/components/app/state-badge"
import { useI18n } from "@/components/i18n/i18n-provider"
import { DataGrid, DataGridContainer, dataGridFeatures, type DataGridFeatures } from "@/components/reui/data-grid/data-grid"
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header"
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination"
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area"
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

export type JobRow = {
  id: string
  jobNumber: string
  displayReference: string
  name: string
  state: string
  currency: string
  clientName: string
  ownerName: string | null
  agencyFeeMinor: string
  marginBps: number | null
  nextAction: { label: { en: string; es: string }; href: string } | null
  updatedAt: string
  href: string
}

const STATES = ["open", "in_progress", "ready_to_close", "closed"] as const

// c-data-grid-3 composition with server-side search, filters, sorting and
// pagination: the URL is the shareable source of truth and the server
// re-queries the same authorized view the dossier uses.
export function JobsDesk({ rows, total, clients }: { rows: JobRow[]; total: number; clients: { id: string; name: string }[] }) {
  const { t, money, pct, pick, timestamp } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [pending, start] = useTransition()
  const [q, setQ] = useState(sp.get("q") ?? "")

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k)
      else next.set(k, v)
    }
    if (!("page" in patch)) next.delete("page")
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
  }

  useEffect(() => {
    const id = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) setParams({ q })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const pageSize = Number(sp.get("pageSize") ?? 20)
  const pagination: PaginationState = { pageIndex: Math.max(0, Number(sp.get("page") ?? 1) - 1), pageSize }
  const sortKey = sp.get("sort") ?? "updated"
  const sorting: SortingState = [{ id: sortKey === "job_number" ? "jobNumber" : sortKey === "margin" ? "marginBps" : sortKey === "name" ? "name" : "updatedAt", desc: (sp.get("dir") ?? "desc") === "desc" }]

  const columns = useMemo<ColumnDef<DataGridFeatures, JobRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataGridColumnHeader title={t("jobs.columns.name")} column={column} />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <Link href={row.original.href} className="truncate font-medium text-foreground underline-offset-3 hover:underline">
              {row.original.name}
            </Link>
            <span className="truncate text-xs text-muted-foreground">{row.original.displayReference}</span>
          </div>
        ),
        size: 240,
        meta: { skeleton: <Skeleton className="h-4 w-40" /> },
      },
      {
        id: "jobNumber",
        accessorKey: "jobNumber",
        header: ({ column }) => <DataGridColumnHeader title={t("jobs.columns.jobNumber")} column={column} />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.jobNumber}</span>,
        size: 140,
      },
      { id: "clientName", accessorKey: "clientName", header: t("jobs.columns.client"), enableSorting: false, size: 170 },
      { id: "ownerName", accessorKey: "ownerName", header: t("jobs.columns.owner"), enableSorting: false, size: 130, cell: ({ row }) => row.original.ownerName ?? "—" },
      {
        id: "state",
        accessorKey: "state",
        header: t("jobs.columns.state"),
        enableSorting: false,
        cell: ({ row }) => <StateBadge state={row.original.state} label={t(`records.state.${row.original.state}`)} />,
        size: 130,
      },
      {
        id: "agencyFeeMinor",
        accessorKey: "agencyFeeMinor",
        header: t("jobs.columns.fee"),
        enableSorting: false,
        cell: ({ row }) => <span className="ageos-figure tabular-nums">{money(row.original.agencyFeeMinor, row.original.currency)}</span>,
        meta: { headerClassName: "text-end [&>div]:justify-end", cellClassName: "text-end tabular-nums" },
        size: 160,
      },
      {
        id: "marginBps",
        accessorKey: "marginBps",
        header: ({ column }) => <DataGridColumnHeader title={t("jobs.columns.margin")} column={column} />,
        cell: ({ row }) => <span className="ageos-figure tabular-nums">{pct(row.original.marginBps)}</span>,
        meta: { headerClassName: "text-end ps-6 [&>div]:justify-end", cellClassName: "text-end tabular-nums" },
        size: 190,
      },
      {
        id: "nextAction",
        header: t("jobs.columns.nextAction"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.nextAction ? (
            <Link href={row.original.nextAction.href} className="text-sm font-medium underline-offset-3 hover:underline">
              {pick(row.original.nextAction.label)}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        size: 170,
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: ({ column }) => <DataGridColumnHeader title={t("jobs.columns.updated")} column={column} />,
        cell: ({ row }) => <span className="text-xs tabular-nums text-muted-foreground">{timestamp(row.original.updatedAt)}</span>,
        size: 160,
      },
    ],
    [t, money, pct, pick, timestamp]
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: rows,
    getRowId: (r: JobRow) => r.id,
    manualPagination: true,
    manualSorting: true,
    rowCount: total,
    state: { pagination, sorting },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(pagination) : updater
      setParams({ page: String(next.pageIndex + 1), pageSize: String(next.pageSize) })
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater
      const s = next[0]
      const map: Record<string, string> = { name: "name", jobNumber: "job_number", marginBps: "margin", updatedAt: "updated" }
      setParams({ sort: s ? (map[s.id] ?? "updated") : null, dir: s ? (s.desc ? "desc" : "asc") : null })
    },
  })

  const filtersActive = Boolean(sp.get("q") || sp.get("state") || sp.get("client") || sp.get("group"))
  const stateItems = [{ value: "", label: t("jobs.allStates") }, ...STATES.map((s) => ({ value: s, label: t(`records.state.${s}`) }))]
  const clientItems = [{ value: "", label: t("jobs.allClients") }, ...clients.map((c) => ({ value: c.id, label: c.name }))]
  const groupItems = [
    { value: "", label: t("jobs.groupAll") },
    { value: "primary", label: t("jobs.groupPrimary") },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <InputGroup className="md:max-w-80">
          <InputGroupAddon align="inline-start">
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput aria-label={t("jobs.searchLabel")} placeholder={t("jobs.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
        </InputGroup>
        <div className="flex flex-wrap items-center gap-2">
          <Select items={stateItems} value={sp.get("state") ?? ""} onValueChange={(v) => setParams({ state: (v as string) || null })}>
            <SelectTrigger size="sm" aria-label={t("jobs.filterState")} className="min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stateItems.map((i) => (
                <SelectItem key={i.value || "all"} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select items={clientItems} value={sp.get("client") ?? ""} onValueChange={(v) => setParams({ client: (v as string) || null })}>
            <SelectTrigger size="sm" aria-label={t("jobs.filterClient")} className="min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {clientItems.map((i) => (
                <SelectItem key={i.value || "all"} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select items={groupItems} value={sp.get("group") ?? ""} onValueChange={(v) => setParams({ group: (v as string) || null })}>
            <SelectTrigger size="sm" aria-label={t("jobs.group")} className="min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groupItems.map((i) => (
                <SelectItem key={i.value || "all"} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={() => { setQ(""); start(() => router.replace(pathname, { scroll: false })) }}>
              {t("common.clearFilters")}
            </Button>
          )}
        </div>
        <span className="text-xs text-muted-foreground md:ml-auto" aria-live="polite">
          {t("jobs.total", { count: total })}
        </span>
      </div>
      <DataGrid
        table={table}
        recordCount={total}
        isLoading={pending}
        tableLayout={{ dense: true, headerSticky: true }}
        tableClassNames={{ base: "min-w-[1180px]" }}
        emptyMessage={filtersActive ? t("jobs.empty") : t("jobs.emptyAgency")}
      >
        <div className="flex w-full flex-col gap-2.5">
          <DataGridContainer>
            <DataGridScrollArea>
              <DataGridTable />
            </DataGridScrollArea>
          </DataGridContainer>
          <DataGridPagination rowsPerPageLabel={t("common.rowsPerPage")} previousPageLabel={t("common.previous")} nextPageLabel={t("common.next")} />
        </div>
      </DataGrid>
    </div>
  )
}
