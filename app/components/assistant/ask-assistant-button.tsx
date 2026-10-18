"use client"

import { MessagesSquareIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Button } from "@/components/ui/button"

import { useAssistant } from "./assistant-provider"

/** Opens the right panel with this record pinned as explicit context. */
export function AskAssistantButton({ record }: { record: { type: "job"; id: string; label: string } }) {
  const { t } = useI18n()
  const a = useAssistant()
  return (
    <Button variant="outline" size="sm" onClick={() => a.openPanel({ pin: record })}>
      <MessagesSquareIcon aria-hidden="true" />
      {t("dossier.askAssistant")}
    </Button>
  )
}
