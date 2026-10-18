"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { type ReactNode, useTransition } from "react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DOSSIER_TABS, type DossierTab } from "@/lib/dossier"


// Horizontal tabs archetype. The active tab lives in ?tab= so links and
// reloads land on the same section; the server renders only that panel.
export function DossierTabs({ active, children }: { active: DossierTab; children: ReactNode }) {
  const { t } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [, start] = useTransition()
  return (
    <Tabs
      value={active}
      onValueChange={(v) => {
        const next = new URLSearchParams(sp.toString())
        next.set("tab", String(v))
        start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
      }}
    >
      <div className="overflow-x-auto">
        <TabsList variant="line" aria-label={t("dossier.tabsLabel")}>
          {DOSSIER_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`dossier.tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value={active} className="pt-4">
        {children}
      </TabsContent>
    </Tabs>
  )
}
