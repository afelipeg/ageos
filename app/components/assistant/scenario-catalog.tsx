"use client"

import { ChevronDownIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { SuggestionView } from "@/lib/assistant/types"

// Scripted scenario catalog: featured journeys plus one entry per ERP skill,
// grouped by module. Choosing an entry sends its preset id (never free text).

const MODULE_ORDER = ["setup", "clients-contracts", "work-production", "media-planning", "media-buying", "suppliers-payments", "billing-collections", "accounting-close", "profitability"]

export function FeaturedScenarios({ items, disabled, onPick }: { items: SuggestionView[]; disabled: boolean; onPick: (presetId: string) => void }) {
  const { t, pick } = useI18n()
  const featured = items.filter((s) => s.featured)
  if (!featured.length) return null
  return (
    <div role="group" aria-label={t("assistant.catalog.featured")} className="flex flex-wrap gap-1.5">
      {featured.map((s) => (
        <Button key={s.presetId} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onPick(s.presetId)} className="font-normal text-muted-foreground hover:text-foreground">
          {pick(s.label)}
        </Button>
      ))}
    </div>
  )
}

export function ScenarioCatalog({ items, disabled, onPick, defaultOpen = false }: { items: SuggestionView[]; disabled: boolean; onPick: (presetId: string) => void; defaultOpen?: boolean }) {
  const { t, pick } = useI18n()
  const groups = MODULE_ORDER.map((m) => ({ module: m, items: items.filter((s) => s.group === m) })).filter((g) => g.items.length)
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  if (!total) return null
  return (
    <Collapsible defaultOpen={defaultOpen} className="flex w-full min-w-0 flex-col gap-2">
      <CollapsibleTrigger
        render={
          <Button type="button" variant="ghost" size="sm" className="group/catalog self-start text-muted-foreground hover:text-foreground">
            <ChevronDownIcon aria-hidden="true" className="transition-transform duration-200 group-data-[panel-open]/catalog:rotate-180" />
            {t("assistant.catalog.browse", { count: total })}
          </Button>
        }
      />
      <CollapsibleContent className="flex flex-col gap-3">
        {groups.map((g) => (
          <section key={g.module} aria-label={t(`modules.names.${g.module}`)} className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">{t(`modules.names.${g.module}`)}</p>
            <ul className="flex flex-col gap-1">
              {g.items.map((s) => (
                <li key={s.presetId}>
                  <Button type="button" variant="outline" disabled={disabled} onClick={() => onPick(s.presetId)} className="h-auto w-full justify-start gap-2 py-1.5 text-start font-normal">
                    {s.scenarioId ? (
                      <Badge variant="outline" className="shrink-0 font-mono">
                        {s.scenarioId}
                      </Badge>
                    ) : null}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{pick(s.label)}</span>
                      {s.description ? <span className="truncate text-xs text-muted-foreground">{pick(s.description)}</span> : null}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
