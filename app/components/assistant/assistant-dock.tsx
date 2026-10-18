"use client"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"

import { useAssistant } from "./assistant-provider"
import { AssistantConversation } from "./assistant-conversation"

// Docking pattern from app-shell-18 (reference only): desktop panel in the
// layout flow beside the work; mobile/tablet uses the installed Sheet with its
// focus trap, Escape and focus return. Hidden on the full assistant page.
export function AssistantDock() {
  const { t } = useI18n()
  const assistant = useAssistant()
  const isMobile = useIsMobile()

  if (assistant.isAssistantPage) return null

  if (isMobile) {
    return (
      <Sheet open={assistant.panelOpen} onOpenChange={(o) => (o ? assistant.openPanel() : assistant.closePanel())}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-full">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("nav.assistant")}</SheetTitle>
            <SheetDescription>{t("common.demoBadge")}</SheetDescription>
          </SheetHeader>
          <AssistantConversation variant="panel" />
        </SheetContent>
      </Sheet>
    )
  }

  if (!assistant.panelOpen) return null
  return (
    <aside
      aria-label={t("nav.assistant")}
      className="hidden h-full w-[440px] max-w-[45vw] shrink-0 flex-col border-l border-border bg-background md:flex"
    >
      <AssistantConversation variant="panel" />
    </aside>
  )
}
