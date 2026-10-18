"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { LinkIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { linkFileToJobAction } from "@/server/actions/ui/library"

/** Link (or unlink) a document to one of this agency's jobs. */
export function LinkJob({ agencySlug, fileId, current, jobs, allowed }: { agencySlug: string; fileId: string; current: string | null; jobs: { id: string; label: string }[]; allowed: boolean }) {
  const { t } = useI18n()
  const router = useRouter()
  const [value, setValue] = useState(current ?? "none")
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const items = [{ value: "none", label: t("library.noJob") }, ...jobs.map((j) => ({ value: j.id, label: j.label }))]
  return (
    <Field>
      <FieldLabel htmlFor="link-job">{t("library.linkJob")}</FieldLabel>
      <div className="flex gap-2">
        <Select items={items} value={value} onValueChange={(v) => setValue(String(v ?? "none"))} disabled={!allowed || pending}>
          <SelectTrigger id="link-job" size="sm" className="w-full">
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
        <Button
          size="sm"
          variant="outline"
          disabled={!allowed || pending || value === (current ?? "none")}
          onClick={() =>
            start(async () => {
              const res = await linkFileToJobAction({ agencySlug, fileId, jobId: value === "none" ? null : value })
              if (!res.ok) return setMsg({ ok: false, text: t(`errors.${res.error.code}`) })
              setMsg({ ok: true, text: t("library.linked") })
              router.refresh()
            })
          }
        >
          <LinkIcon aria-hidden="true" />
          {t("library.saveLink")}
        </Button>
      </div>
      {msg && (
        <span role="status" className={msg.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {msg.text}
        </span>
      )}
    </Field>
  )
}
