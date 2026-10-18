"use client"

// Must stay the first import: disables the package's dev-only devtools auto-mount.
import "./no-devtools"

import { Component, useMemo, useState, type ReactNode } from "react"
import { Renderer } from "@openuidev/react-lang"
import { TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { fmtMinutesAsHours } from "@/lib/format"
import { OPENUI_VIEW_VERSION, type DisplayValue, type OpenUIViewPart } from "@/lib/assistant/types"

import { OpenUIHost, openuiLibrary, validateOpenUISource } from "./library"

// Renders an `openui_view` message part through @openuidev/react-lang with the
// closed AgeOS library. The program is validated first; no toolProvider, no
// onAction, no Query/Mutation. Any invalid, unknown or failing payload shows a
// recoverable notice plus the readable fallback table, so a message is never
// blank and the rest of the conversation keeps rendering.

class RenderBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn("[ageos] openui view failed to render", error)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function FallbackTable({ part }: { part: Pick<OpenUIViewPart, "fallback" | "title"> }) {
  const { pick, money, pct, locale } = useI18n()
  const fmt = (v: DisplayValue) =>
    v.kind === "money" ? money(v.minor, v.currency) : v.kind === "bps" ? pct(v.bps) : v.kind === "minutes" ? fmtMinutesAsHours(v.minutes, locale) : v.kind === "count" ? String(v.count) : v.text
  if (!Array.isArray(part.fallback) || !part.fallback.length) return null
  return (
    <Table>
      <caption className="sr-only">{pick(part.title)}</caption>
      <TableBody>
        {part.fallback.map((row, i) => (
          <TableRow key={i}>
            <TableCell className="text-muted-foreground">{pick(row.label)}</TableCell>
            <TableCell className="text-end tabular-nums">{fmt(row.value)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function Unavailable({ part, reason }: { part: OpenUIViewPart; reason: string }) {
  const { t } = useI18n()
  return (
    <div className="flex w-full min-w-0 flex-col gap-2" data-openui-fallback={reason}>
      <Alert variant="warning">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>{t("assistant.openui.unavailableTitle")}</AlertTitle>
        <AlertDescription>{t("assistant.openui.unavailableBody")}</AlertDescription>
      </Alert>
      <FallbackTable part={part} />
    </div>
  )
}

export function OpenUIMessage({ part, agencySlug }: { part: OpenUIViewPart; agencySlug: string }) {
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const validation = useMemo(() => (part.version === OPENUI_VIEW_VERSION ? validateOpenUISource(part.source) : ({ ok: false, reason: "version" } as const)), [part.source, part.version])
  if (!validation.ok) return <Unavailable part={part} reason={validation.reason} />
  if (runtimeError) return <Unavailable part={part} reason={runtimeError} />
  return (
    <OpenUIHost.Provider value={{ agencySlug }}>
      <div className="w-full min-w-0" data-openui-view={part.template}>
        <RenderBoundary fallback={<Unavailable part={part} reason="render-error" />}>
          <Renderer
            response={part.source}
            library={openuiLibrary}
            toolProvider={null}
            publishObservability={false}
            onError={(errors) => {
              if (errors.length) setRuntimeError(errors[0]!.code)
            }}
          />
        </RenderBoundary>
      </div>
    </OpenUIHost.Provider>
  )
}
