"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckIcon, CircleXIcon, MessageSquareWarningIcon, PlayIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { codeLabel } from "@/components/records/code-label"
import { decideApprovalAction, executeApprovedAction } from "@/server/actions/capabilities"

type Decision = "approve" | "reject" | "request_changes"

type Result =
  | { kind: "decided"; outcome: string; executed: boolean; blockedCode: string | null }
  | { kind: "executed"; executed: boolean; blockedCode: string | null }
  | { kind: "error"; code: string; message: string }

/**
 * Decision bar for one approval. The browser sends only the decision, the
 * digest it reviewed and an idempotency key; eligibility, separation of
 * duties, staleness and execution are decided again on the server.
 */
export function ApprovalDecision({
  agencySlug,
  approvalId,
  digest,
  summary,
  canDecide,
  canExecute,
  state,
  reasonRequiredOnApprove,
}: {
  agencySlug: string
  approvalId: string
  digest: string
  /** Human summary of the exact change (amount, version, destination). */
  summary: string
  canDecide: boolean
  canExecute: boolean
  state: string
  reasonRequiredOnApprove: boolean
}) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState<Decision | null>(null)
  const [reason, setReason] = useState("")
  const [result, setResult] = useState<Result | null>(null)
  const [pending, start] = useTransition()
  const keys = useRef<Record<string, string>>({})
  const keyFor = (k: string) => (keys.current[k] ??= `ui:${k}:${crypto.randomUUID()}`)

  const decide = (decision: Decision) => {
    start(async () => {
      const res = await decideApprovalAction({ agencySlug, approvalId, decision, reason: reason.trim() || undefined, reviewedDigest: digest, idempotencyKey: keyFor(`decide:${decision}`) })
      if (!res.ok) {
        setResult({ kind: "error", code: res.error.code, message: res.error.message })
        delete keys.current[`decide:${decision}`]
        return
      }
      const data = res.data as { outcome: string; executed: boolean; blockedCode: string | null }
      setResult({ kind: "decided", ...data })
      setOpen(null)
      setReason("")
      router.refresh()
    })
  }

  const execute = () => {
    start(async () => {
      const res = await executeApprovedAction({ agencySlug, approvalId, idempotencyKey: keyFor("execute") })
      if (!res.ok) {
        setResult({ kind: "error", code: res.error.code, message: res.error.message })
        delete keys.current.execute
        return
      }
      const data = res.data as { executed: boolean; blockedCode: string | null }
      setResult({ kind: "executed", ...data })
      router.refresh()
    })
  }

  const needsReason = open === "reject" || open === "request_changes" || (open === "approve" && reasonRequiredOnApprove)

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {result?.kind === "error" && (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{codeLabel(messages, t, result.code)}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
      {result?.kind === "decided" && (
        <Alert variant={result.outcome === "approved" && (result.executed || !result.blockedCode) ? "success" : "warning"}>
          {result.outcome === "approved" ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
          <AlertTitle>{t(`approvals.outcome.${result.outcome}`)}</AlertTitle>
          <AlertDescription>
            {result.executed ? t("approvals.outcome.executed") : result.blockedCode ? t("approvals.outcome.blocked", { code: codeLabel(messages, t, result.blockedCode) }) : t("approvals.outcome.recorded")}
          </AlertDescription>
        </Alert>
      )}
      {result?.kind === "executed" && (
        <Alert variant={result.executed ? "success" : "warning"}>
          {result.executed ? <CheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
          <AlertTitle>{result.executed ? t("approvals.outcome.executed") : t("approvals.outcome.notExecuted")}</AlertTitle>
          {result.blockedCode && <AlertDescription>{codeLabel(messages, t, result.blockedCode)}</AlertDescription>}
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {state === "awaiting_approval" && (
          <>
            <Button size="sm" disabled={!canDecide || pending} onClick={() => setOpen("approve")}>
              <ShieldCheckIcon aria-hidden="true" />
              {t("approvals.actions.approve")}
            </Button>
            <Button size="sm" variant="outline" disabled={!canDecide || pending} onClick={() => setOpen("request_changes")}>
              <MessageSquareWarningIcon aria-hidden="true" />
              {t("approvals.actions.requestChanges")}
            </Button>
            <Button size="sm" variant="outline" disabled={!canDecide || pending} onClick={() => setOpen("reject")}>
              <CircleXIcon aria-hidden="true" />
              {t("approvals.actions.reject")}
            </Button>
          </>
        )}
        {state === "approved" && (
          <Button size="sm" disabled={!canExecute || pending} onClick={execute}>
            <PlayIcon aria-hidden="true" />
            {pending ? t("approvals.actions.applying") : t("approvals.actions.apply")}
          </Button>
        )}
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/a/${agencySlug}/approvals`} />}>
          {t("approvals.actions.backToQueue")}
        </Button>
      </div>

      <AlertDialog open={open !== null} onOpenChange={(o) => !o && !pending && setOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{open ? t(`approvals.confirm.${open}.title`) : ""}</AlertDialogTitle>
            <AlertDialogDescription>{open ? t(`approvals.confirm.${open}.body`) : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2 text-xs">
            <span className="font-medium">{summary}</span>
            <span className="font-mono break-all text-muted-foreground">{t("approvals.digest", { digest: digest.slice(0, 16) })}</span>
          </div>
          {open && (
            <Field>
              <FieldLabel htmlFor="approval-reason">
                {open === "approve" ? t("approvals.reasonOptional") : t("approvals.reasonRequired")}
              </FieldLabel>
              <Textarea id="approval-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className="min-h-20 resize-none" />
              {needsReason && <FieldDescription>{t("approvals.reasonHelp")}</FieldDescription>}
            </Field>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={open === "reject" ? "destructive" : "default"}
              disabled={pending || (needsReason && reason.trim().length < 3)}
              onClick={() => open && decide(open)}
            >
              {pending ? t("common.loading") : open ? t(`approvals.confirm.${open}.cta`) : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
