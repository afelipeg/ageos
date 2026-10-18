"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleCheckIcon, FileUpIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { FileType } from "@/components/reui/file-type"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { applyValidJobImportAction, previewJobImportAction } from "@/server/actions/ui/jobs-import"
import type { ImportReason, JobImportPreview, JobImportProfile, JobImportResult } from "@/server/domain/job-import"

const MAX = 10 * 1024 * 1024
const RULES = ["no_valid_rows", "import_profile_missing", "import_profile_incompatible", "import_profile_changed", "not_csv"]

type Problem = { title: string; body?: string }
type Failure = { code: string; message: string; details?: { rule?: unknown } }

const showDelimiter = (d: string) => (d === "\t" ? "TAB" : `"${d}"`)

/**
 * Jobs desk import (preview_import + apply_valid_import). The CSV goes through
 * the private upload route; validation and the batch run on the server, which
 * re-validates every row on apply and derives the idempotency key from the
 * file id + profile revision, so a re-click or retry never opens a job twice.
 */
export function JobImportDialog({ agencySlug, profile }: { agencySlug: string; profile: JobImportProfile | null }) {
  const { t } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<JobImportPreview | null>(null)
  const [done, setDone] = useState<{ result: JobImportResult; replayed: boolean } | null>(null)
  const [pending, setPending] = useState<"validate" | "apply" | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)

  const reset = () => {
    setFile(null)
    setPreview(null)
    setDone(null)
    setProblem(null)
  }

  // Upload rules map to the library copy; import rules to this namespace.
  const fail = (e: Failure, phase: "upload" | "import") => {
    const rule = typeof e.details?.rule === "string" ? e.details.rule : null
    if (e.code === "idempotency_conflict") return setProblem({ title: t("jobs.import.alreadyAppliedByOther") })
    if (rule && RULES.includes(rule)) return setProblem({ title: t(`jobs.import.rules.${rule}`) })
    if (rule && phase === "upload") return setProblem({ title: t(`library.errors.${rule}`), body: e.message })
    setProblem({ title: t(`errors.${e.code}`), body: e.message })
  }

  const pick = (f: File | null) => {
    setProblem(null)
    if (f && (!f.name.toLowerCase().endsWith(".csv") || f.size > MAX)) {
      setProblem({ title: t("jobs.import.rules.not_csv"), body: t("jobs.import.csvOnly") })
      return setFile(null)
    }
    setFile(f)
  }

  const validate = async () => {
    if (!file) return
    setPending("validate")
    setProblem(null)
    try {
      const body = new FormData()
      body.set("file", file)
      const res = await fetch(`/api/a/${agencySlug}/files`, { method: "POST", body })
      const json = (await res.json().catch(() => ({}))) as { file?: { fileId: string }; error?: Failure }
      if (!res.ok || !json.file) return fail(json.error ?? { code: "internal", message: t("states.errorBody", { ref: String(res.status) }) }, "upload")
      const p = await previewJobImportAction({ agencySlug, fileId: json.file.fileId })
      if (!p.ok) return fail(p.error, "import")
      setPreview(p.data)
    } catch {
      setProblem({ title: t("states.errorTitle"), body: t("jobs.import.networkError") })
    } finally {
      setPending(null)
    }
  }

  const apply = async () => {
    if (!preview) return
    setPending("apply")
    setProblem(null)
    try {
      const r = await applyValidJobImportAction({ agencySlug, fileId: preview.file.id, profileRevision: preview.profile.revision })
      if (!r.ok) return fail(r.error, "import")
      setDone(r.data)
      router.refresh()
    } catch {
      setProblem({ title: t("states.errorTitle"), body: t("jobs.import.networkError") })
    } finally {
      setPending(null)
    }
  }

  const reason = (r: ImportReason) => t(`jobs.import.reasons.${r.code}`, { field: r.field, expected: r.expected, actual: r.actual })
  const columns = profile?.expectedHeaders ?? []
  const applied = done?.result ?? preview?.applied ?? null

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FileUpIcon aria-hidden="true" />
        {t("jobs.import.trigger")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (pending) return
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("jobs.import.title")}</DialogTitle>
            <DialogDescription>{t("jobs.import.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-col gap-4">
            {profile ? (
              <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                <span>{t("jobs.import.profile", { key: profile.key, revision: profile.revision, delimiter: showDelimiter(profile.delimiter) })}</span>
                <span className="font-mono">{t("jobs.import.expectedColumns", { columns: columns.join(profile.delimiter === "\t" ? " " : profile.delimiter) })}</span>
              </div>
            ) : (
              <Alert variant="warning">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertTitle>{t("jobs.import.noProfileTitle")}</AlertTitle>
                <AlertDescription>{t("jobs.import.noProfileBody")}</AlertDescription>
              </Alert>
            )}

            {profile && !preview && (
              <Field>
                <FieldLabel htmlFor="job-import-file">{t("jobs.import.file")}</FieldLabel>
                <label
                  htmlFor="job-import-file"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    pick(e.dataTransfer.files?.[0] ?? null)
                  }}
                  className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-input px-4 py-6 text-center text-sm transition-colors hover:bg-muted/50"
                >
                  {file ? (
                    <span className="flex items-center gap-2">
                      <FileType type="csv" size="sm" />
                      <span className="max-w-60 truncate font-medium">{file.name}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t("jobs.import.dropHere")}</span>
                  )}
                </label>
                <input id="job-import-file" type="file" accept=".csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
                <FieldDescription>{t("jobs.import.csvOnly")}</FieldDescription>
              </Field>
            )}

            {preview && (
              <div className="flex min-w-0 flex-col gap-3">
                <p className="text-sm font-medium" aria-live="polite">
                  {t("jobs.import.summary", { valid: preview.validCount, invalid: preview.invalidCount, total: preview.totalRows, name: preview.file.name })}
                </p>
                {preview.fileErrors.includes("header_mismatch") && (
                  <Alert variant="destructive">
                    <TriangleAlertIcon aria-hidden="true" />
                    <AlertTitle>{t("jobs.import.headerMismatchTitle")}</AlertTitle>
                    <AlertDescription>
                      {t("jobs.import.headerMismatchBody", { delimiter: showDelimiter(preview.profile.delimiter), parsed: preview.columnCount, expected: preview.profile.expectedHeaders.length })}
                      {preview.file.detectedDelimiter && preview.file.detectedDelimiter !== preview.profile.delimiter
                        ? ` ${t("jobs.import.detectedDelimiter", { delimiter: showDelimiter(preview.file.detectedDelimiter) })}`
                        : null}
                    </AlertDescription>
                  </Alert>
                )}
                {preview.fileErrors.includes("no_rows") && (
                  <Alert variant="warning">
                    <TriangleAlertIcon aria-hidden="true" />
                    <AlertTitle>{t("jobs.import.noRows")}</AlertTitle>
                  </Alert>
                )}
                {preview.fileErrors.includes("too_many_rows") && (
                  <Alert variant="destructive">
                    <TriangleAlertIcon aria-hidden="true" />
                    <AlertTitle>{t("jobs.import.tooManyRows", { count: preview.totalRows, max: preview.rows.length })}</AlertTitle>
                  </Alert>
                )}
                {preview.rows.length > 0 && (
                  <div className="max-h-80 overflow-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-14">{t("jobs.import.row")}</TableHead>
                          {preview.profile.expectedHeaders.map((h) => (
                            <TableHead key={h} className="font-mono text-xs">
                              {h}
                            </TableHead>
                          ))}
                          <TableHead>{t("jobs.import.status")}</TableHead>
                          <TableHead>{t("jobs.import.issues")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.rows.map((r) => (
                          <TableRow key={r.row}>
                            <TableCell className="tabular-nums text-muted-foreground">{r.row}</TableCell>
                            {r.cells.length === preview.profile.expectedHeaders.length ? (
                              r.cells.map((c, i) => (
                                <TableCell key={i} className="max-w-48 truncate">
                                  {c}
                                </TableCell>
                              ))
                            ) : (
                              <TableCell colSpan={preview.profile.expectedHeaders.length} className="max-w-96 truncate font-mono text-xs">
                                {r.cells.join(" | ")}
                              </TableCell>
                            )}
                            <TableCell>
                              <Badge variant={r.status === "valid" ? "success-light" : "destructive-light"}>{t(`jobs.import.${r.status}`)}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.reasons.map(reason).join("; ") || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}

            {applied && (
              <Alert variant="success" aria-live="polite">
                <CircleCheckIcon aria-hidden="true" />
                <AlertTitle>{done && !done.replayed ? t("jobs.import.appliedTitle", { count: applied.appliedCount }) : t("jobs.import.replayedTitle")}</AlertTitle>
                <AlertDescription>
                  <p>{done && !done.replayed ? t("jobs.import.appliedBody", { invalid: applied.invalidCount }) : t("jobs.import.replayedBody", { revision: applied.profileRevision })}</p>
                  <ul className="flex flex-wrap gap-x-3 gap-y-1">
                    {applied.applied.map((a) => (
                      <li key={a.jobId}>
                        <Link href={`/a/${agencySlug}/jobs/${a.jobId}`} className="font-mono text-xs underline-offset-3 hover:underline">
                          {a.displayReference} · {a.jobNumber}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {problem && (
              <Alert variant="destructive" aria-live="polite">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertTitle>{problem.title}</AlertTitle>
                {problem.body && <AlertDescription>{problem.body}</AlertDescription>}
              </Alert>
            )}
          </div>
          <DialogFooter>
            {preview && !applied && (
              <Button variant="outline" disabled={pending !== null} onClick={reset}>
                {t("jobs.import.chooseAnother")}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={pending !== null}
              onClick={() => {
                setOpen(false)
                reset()
              }}
            >
              {applied ? t("common.close") : t("common.cancel")}
            </Button>
            {profile && !preview && (
              <Button disabled={!file || pending !== null} onClick={() => void validate()}>
                {pending === "validate" ? t("jobs.import.validating") : t("jobs.import.uploadAndValidate")}
              </Button>
            )}
            {preview && !applied && (
              <Button disabled={preview.validCount === 0 || pending !== null} onClick={() => void apply()}>
                {pending === "apply" ? t("jobs.import.applying") : t("jobs.import.apply", { count: preview.validCount })}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
