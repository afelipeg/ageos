"use client"

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

// URL-backed list state shared by every desk: tab/view, search and page live
// in the query string so a desk is shareable and back/forward restore it. The
// server re-renders the authorized view for the new URL.

function useUrlPatch() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [pending, start] = useTransition()
  const patch = (changes: Record<string, string | null>, opts: { resetPage?: boolean; push?: boolean } = {}) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k)
      else next.set(k, v)
    }
    if (opts.resetPage !== false && !("page" in changes)) next.delete("page")
    const qs = next.toString()
    const url = qs ? `${pathname}?${qs}` : pathname
    start(() => (opts.push ? router.push(url, { scroll: false }) : router.replace(url, { scroll: false })))
  }
  return { sp, patch, pending }
}

/** Line tabs bound to one query parameter (pushes history so Back works). */
export function UrlTabs({
  param,
  value,
  tabs,
  label,
}: {
  param: string
  value: string
  tabs: { value: string; label: string; count?: number }[]
  label: string
}) {
  const { patch } = useUrlPatch()
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <Tabs value={value} onValueChange={(v) => patch({ [param]: String(v) }, { push: true })}>
        <TabsList variant="line" aria-label={label}>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {typeof t.count === "number" && (
                <Badge variant="outline" className="tabular-nums">
                  {t.count}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}

/** Debounced search box bound to ?q= (replaces history while typing). */
export function UrlSearch({ param = "q", placeholder, className }: { param?: string; placeholder: string; className?: string }) {
  const { t } = useI18n()
  const { sp, patch } = useUrlPatch()
  const current = sp.get(param) ?? ""
  const [q, setQ] = useState(current)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = setTimeout(() => {
      if ((sp.get(param) ?? "") !== q) patch({ [param]: q })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  return (
    <InputGroup className={className ?? "w-full sm:max-w-xs"}>
      <InputGroupAddon>
        <SearchIcon aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {q && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label={t("common.clearFilters")} onClick={() => setQ("")}>
            <XIcon aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

/** Select-like filter chips bound to one parameter. */
export function UrlChoice({ param, value, options, label }: { param: string; value: string; options: { value: string; label: string }[]; label: string }) {
  const { patch } = useUrlPatch()
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {options.map((o) => (
        <Button key={o.value} type="button" size="sm" variant={o.value === value ? "secondary" : "ghost"} aria-pressed={o.value === value} onClick={() => patch({ [param]: o.value === "all" ? null : o.value })}>
          {o.label}
        </Button>
      ))}
    </div>
  )
}

/** Previous/next pager bound to ?page= with the visible range. */
export function UrlPager({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const { t } = useI18n()
  const { patch, pending } = useUrlPatch()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav aria-label={t("common.page")} className="flex items-center justify-between gap-2 pt-3 text-sm text-muted-foreground">
      <span className="tabular-nums">{t("records.range", { from, to, total })}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" disabled={page <= 1 || pending} aria-label={t("common.previous")} onClick={() => patch({ page: String(page - 1) }, { push: true })}>
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <span className="px-1 tabular-nums">
          {page} / {pages}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page >= pages || pending} aria-label={t("common.next")} onClick={() => patch({ page: String(page + 1) }, { push: true })}>
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}

/** "Clear filters" action for no-results states. */
export function ClearFiltersButton({ keep = [] as string[], children }: { keep?: string[]; children: ReactNode }) {
  const { sp, patch } = useUrlPatch()
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        const changes: Record<string, null> = {}
        for (const k of sp.keys()) if (!keep.includes(k)) changes[k] = null
        patch(changes)
      }}
    >
      {children}
    </Button>
  )
}

/** Select bound to one query parameter ("all" clears it). */
export function UrlSelect({ param, value, options, label, allLabel }: { param: string; value: string | null; options: { value: string; label: string }[]; label: string; allLabel: string }) {
  const { patch } = useUrlPatch()
  const items = [{ value: "all", label: allLabel }, ...options]
  return (
    <Select items={items} value={value ?? "all"} onValueChange={(v) => patch({ [param]: !v || v === "all" ? null : String(v) })}>
      <SelectTrigger size="sm" aria-label={label} className="w-full sm:w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
