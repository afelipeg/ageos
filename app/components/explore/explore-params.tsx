"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CalendarIcon, PlayIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { DateSelector, type DateSelectorValue } from "@/components/reui/date-selector"
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from "@/components/reui/number-field"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Param = { key: string; type: "bps" | "client" | "job" | "period" }

const pad = (n: number) => String(n).padStart(2, "0")
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

/** Converts a Date Selector value (month / quarter / year, single or range) to ISO from/to dates. */
function toRange(v: DateSelectorValue): { from: string; to: string } | null {
  const span = (y: number, m0: number, y2: number, m1: number) => ({ from: `${y}-${pad(m0 + 1)}-01`, to: `${y2}-${pad(m1 + 1)}-${pad(lastDay(y2, m1))}` })
  if (v.period === "month") {
    if (v.rangeStart && v.rangeEnd) return span(v.rangeStart.year, v.rangeStart.value, v.rangeEnd.year, v.rangeEnd.value)
    if (v.year !== undefined && v.month !== undefined) return span(v.year, v.month, v.year, v.month)
  }
  if (v.period === "quarter") {
    if (v.rangeStart && v.rangeEnd) return span(v.rangeStart.year, v.rangeStart.value * 3, v.rangeEnd.year, v.rangeEnd.value * 3 + 2)
    if (v.year !== undefined && v.quarter !== undefined) return span(v.year, v.quarter * 3, v.year, v.quarter * 3 + 2)
  }
  if (v.period === "year") {
    if (v.rangeStart && v.rangeEnd) return span(v.rangeStart.year, 0, v.rangeEnd.year, 11)
    if (v.year !== undefined) return span(v.year, 0, v.year, 11)
  }
  return null
}

/**
 * Typed parameters of a named question. Values go to the URL (shareable,
 * back/forward); the server validates them against the question's allowlist
 * and runs the read-only query. The Date Selector allows the 2027 demo periods.
 */
export function ExploreParams({
  params,
  clients,
  jobs,
  current,
}: {
  params: Param[]
  clients: { value: string; label: string }[]
  jobs: { value: string; label: string }[]
  current: { floorBps: number; client: string | null; job: string | null; from: string; to: string }
}) {
  const { t, messages, date } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [floor, setFloor] = useState<number | null>(current.floorBps / 100)
  const [clientId, setClientId] = useState(current.client ?? "all")
  const [jobId, setJobId] = useState(current.job ?? "all")
  const [range, setRange] = useState({ from: current.from, to: current.to })
  const [selector, setSelector] = useState<DateSelectorValue | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const dsI18n = messages.explore.dateSelector as unknown as Record<string, unknown>

  const run = () => {
    const next = new URLSearchParams(sp.toString())
    const set = (k: string, v: string | null) => (v === null ? next.delete(k) : next.set(k, v))
    if (params.some((p) => p.type === "bps")) set("floorBps", floor === null ? null : String(Math.round(floor * 100)))
    if (params.some((p) => p.type === "client")) set("client", clientId === "all" ? null : clientId)
    if (params.some((p) => p.type === "job")) set("job", jobId === "all" ? null : jobId)
    if (params.some((p) => p.type === "period")) {
      set("from", range.from)
      set("to", range.to)
    }
    router.push(`${pathname}?${next.toString()}`, { scroll: false })
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        run()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {params.map((p) => {
          if (p.type === "bps")
            return (
              <Field key={p.key}>
                <FieldLabel htmlFor="q-floor">{t("explore.params.floor")}</FieldLabel>
                <NumberField value={floor} onValueChange={setFloor} min={0} max={90} step={0.5}>
                  <NumberFieldGroup>
                    <NumberFieldDecrement />
                    <NumberFieldInput id="q-floor" />
                    <NumberFieldIncrement />
                  </NumberFieldGroup>
                </NumberField>
                <FieldDescription>{t("explore.params.floorHelp")}</FieldDescription>
              </Field>
            )
          if (p.type === "client" || p.type === "job") {
            const items = [{ value: "all", label: t(p.type === "client" ? "explore.params.allClients" : "explore.params.allJobs") }, ...(p.type === "client" ? clients : jobs)]
            const value = p.type === "client" ? clientId : jobId
            return (
              <Field key={p.key}>
                <FieldLabel htmlFor={`q-${p.key}`}>{t(`explore.params.${p.type}`)}</FieldLabel>
                <Select items={items} value={value} onValueChange={(v) => (p.type === "client" ? setClientId(String(v ?? "all")) : setJobId(String(v ?? "all")))}>
                  <SelectTrigger id={`q-${p.key}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )
          }
          return (
            <Field key={p.key}>
              <FieldLabel htmlFor="q-period">{t("explore.params.period")}</FieldLabel>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger render={<Button id="q-period" type="button" variant="outline" className="w-full justify-start" />}>
                  <CalendarIcon aria-hidden="true" />
                  {date(range.from)} – {date(range.to)}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-0">
                  <div className="flex flex-col gap-2 p-2">
                    <DateSelector
                      value={selector}
                      onChange={setSelector}
                      periodTypes={["month", "quarter", "year"]}
                      defaultPeriodType="month"
                      minYear={2026}
                      maxYear={2028}
                      baseYear={2027}
                      showTwoMonths={false}
                      i18n={dsI18n}
                    />
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
                        {t("common.cancel")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!selector || !toRange(selector)}
                        onClick={() => {
                          const r = selector ? toRange(selector) : null
                          if (r) setRange(r)
                          setOpen(false)
                        }}
                      >
                        {t("explore.params.applyPeriod")}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <FieldDescription>{t("explore.params.periodHelp")}</FieldDescription>
            </Field>
          )
        })}
      </div>
      <div>
        <Button type="submit" size="sm">
          <PlayIcon aria-hidden="true" />
          {t("explore.run")}
        </Button>
      </div>
    </form>
  )
}
