"use client"

import { DownloadIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Button } from "@/components/ui/button"
import { csvSafeCell } from "@/lib/csv"
import { minorToDecimalString } from "@/lib/money"

type Col = { id: string; header: string; kind: string; currencyKey?: string }

/**
 * Exports exactly the authorized rows the server returned as a real CSV file
 * (UTF-8, formula-like cells neutralized). Money is written as the exact
 * decimal of its minor units next to its currency; nothing is recomputed.
 */
export function DownloadCsv({ filename, columns, rows, meta }: { filename: string; columns: Col[]; rows: Record<string, unknown>[]; meta: string[] }) {
  const { t } = useI18n()
  const label = (h: string) => (h.includes(".") ? t(h) : h)
  const download = () => {
    const head: string[] = []
    for (const c of columns) {
      head.push(label(c.header))
      if (c.kind === "money") head.push(`${label(c.header)} (${t("common.currency")})`)
    }
    const lines = [head.map(csvSafeCell).join(",")]
    for (const r of rows) {
      const cells: string[] = []
      for (const c of columns) {
        const v = r[c.id]
        if (c.kind === "money") {
          const cur = String(r[c.currencyKey ?? "currency"] ?? "")
          cells.push(typeof v === "string" && /^-?\d+$/.test(v) && cur ? minorToDecimalString(v, cur) : "")
          cells.push(cur)
        } else if (c.kind === "bps") cells.push(typeof v === "number" ? (v / 100).toFixed(2) : "")
        else cells.push(v === null || v === undefined ? "" : Array.isArray(v) ? v.join(" ") : String(v))
      }
      lines.push(cells.map(csvSafeCell).join(","))
    }
    const body = [...meta.map((m) => `# ${m}`), ...lines].join("\r\n")
    const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Button size="sm" variant="outline" onClick={download} disabled={rows.length === 0}>
      <DownloadIcon aria-hidden="true" />
      {t("explore.downloadCsv")}
    </Button>
  )
}
