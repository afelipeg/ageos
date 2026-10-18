"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { TriangleAlertIcon, UploadIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { FileType } from "@/components/reui/file-type"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const ACCEPT = ".pdf,.docx,.xlsx,.csv"
const MAX = 10 * 1024 * 1024

/**
 * Private upload to /api/a/:slug/files. The browser only pre-checks the
 * extension and size for a fast message; the server validates type,
 * signature, size and quotas again and is the only authority.
 */
export function UploadDialog({
  agencySlug,
  jobs,
  defaultJob,
  logicalId,
  allowed,
  triggerLabel,
}: {
  agencySlug: string
  jobs: { id: string; label: string }[]
  defaultJob?: string | null
  /** Upload a new version of this document instead of a new one. */
  logicalId?: string
  allowed: boolean
  triggerLabel: string
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState(defaultJob ?? "none")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ title: string; body: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const pick = (f: File | null) => {
    setError(null)
    if (!f) return setFile(null)
    const ext = f.name.toLowerCase().split(".").pop() ?? ""
    if (!["pdf", "docx", "xlsx", "csv"].includes(ext)) {
      setError({ title: t("library.errors.unsupported_type"), body: t("library.acceptHelp") })
      return setFile(null)
    }
    if (f.size > MAX) {
      setError({ title: t("library.errors.too_large"), body: t("library.acceptHelp") })
      return setFile(null)
    }
    setFile(f)
  }

  const submit = async () => {
    if (!file) return
    setPending(true)
    setError(null)
    try {
      const body = new FormData()
      body.set("file", file)
      if (job && job !== "none") body.set("job", job)
      if (logicalId) body.set("logicalId", logicalId)
      const res = await fetch(`/api/a/${agencySlug}/files`, { method: "POST", body })
      const json = (await res.json().catch(() => ({}))) as { href?: string; error?: { code: string; message: string; details?: { rule?: string } } }
      if (!res.ok || !json.href) {
        const rule = json.error?.details?.rule
        setError({
          title: rule ? t(`library.errors.${rule}`) : t(`errors.${json.error?.code ?? "internal"}`),
          body: json.error?.message ?? t("states.errorBody", { ref: String(res.status) }),
        })
        return
      }
      setOpen(false)
      setFile(null)
      router.push(json.href)
      router.refresh()
    } catch {
      setError({ title: t("states.errorTitle"), body: t("library.networkError") })
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button size="sm" disabled={!allowed} onClick={() => setOpen(true)}>
        <UploadIcon aria-hidden="true" />
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{logicalId ? t("library.uploadVersionTitle") : t("library.uploadTitle")}</DialogTitle>
            <DialogDescription>{t("library.uploadBody")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="library-file">{t("library.file")}</FieldLabel>
              <label
                htmlFor="library-file"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  pick(e.dataTransfer.files?.[0] ?? null)
                }}
                className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-input px-4 py-6 text-center text-sm transition-colors hover:bg-muted/50"
              >
                {file ? (
                  <span className="flex items-center gap-2">
                    <FileType type={file.name.split(".").pop() ?? ""} size="sm" />
                    <span className="max-w-60 truncate font-medium">{file.name}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t("library.dropHere")}</span>
                )}
              </label>
              <input ref={inputRef} id="library-file" type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
              <FieldDescription>{t("library.acceptHelp")}</FieldDescription>
            </Field>
            {!logicalId && (
              <Field>
                <FieldLabel htmlFor="library-job">{t("library.linkJob")}</FieldLabel>
                <Select items={[{ value: "none", label: t("library.noJob") }, ...jobs.map((j) => ({ value: j.id, label: j.label }))]} value={job} onValueChange={(v) => setJob(String(v ?? "none"))}>
                  <SelectTrigger id="library-job" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("library.noJob")}</SelectItem>
                    {jobs.map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {error && (
              <Alert variant="destructive" aria-live="polite">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertTitle>{error.title}</AlertTitle>
                <AlertDescription>{error.body}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!file || pending} onClick={() => void submit()}>
              {pending ? t("library.uploading") : t("library.upload")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
