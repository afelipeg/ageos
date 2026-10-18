"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckIcon, PlugIcon, PlugZapIcon, RefreshCwIcon, TriangleAlertIcon, UnplugIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { runCapabilityAction } from "@/server/actions/capabilities"

type Outcome = { kind: "ok"; runId: string; output: Record<string, unknown> | null } | { kind: "blocked"; runId: string | null; code: string; message: string }

function useIntegration(agencySlug: string) {
  const [pending, start] = useTransition()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const keys = useRef<Record<string, string>>({})
  const run = (payload: { action: string; provider: string; accountAlias: string }, onOk?: (output: Record<string, unknown> | null) => void) => {
    const k = `${payload.action}:${payload.provider}:${payload.accountAlias}`
    keys.current[k] ??= `ui:integrations:${crypto.randomUUID()}`
    start(async () => {
      const res = await runCapabilityAction({ agencySlug, skillId: "agency-integrations", payload, idempotencyKey: keys.current[k]! })
      delete keys.current[k]
      if (!res.ok) {
        setOutcome({ kind: "blocked", runId: null, code: res.error.code, message: res.error.message })
        return
      }
      if (res.data.state !== "succeeded" || res.data.error) {
        setOutcome({ kind: "blocked", runId: res.data.runId, code: res.data.error?.code ?? "internal", message: res.data.error?.message ?? "" })
        return
      }
      const output = (res.data.output ?? null) as Record<string, unknown> | null
      setOutcome({ kind: "ok", runId: res.data.runId, output })
      onOk?.(output)
    })
  }
  return { pending, outcome, run }
}

function OutcomeAlert({ outcome, agencySlug }: { outcome: Outcome | null; agencySlug: string }) {
  const { t } = useI18n()
  if (!outcome) return null
  if (outcome.kind === "blocked") {
    return (
      <Alert variant="warning">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>{t(`errors.${outcome.code}`)}</AlertTitle>
        <AlertDescription className="flex flex-col gap-1">
          <span>{outcome.message}</span>
          {outcome.runId && (
            <Link href={`/a/${agencySlug}/runs/${outcome.runId}`} className="text-xs underline-offset-3 hover:underline">
              {t("connections.openRun")}
            </Link>
          )}
        </AlertDescription>
      </Alert>
    )
  }
  const diag = outcome.output?.diagnostic as { reachable?: boolean; missingScopes?: string[]; adapterVersion?: string } | undefined
  return (
    <Alert variant={diag && !diag.reachable ? "warning" : "success"}>
      <CheckIcon aria-hidden="true" />
      <AlertTitle>{diag ? (diag.reachable ? t("connections.testOk") : t("connections.testUnreachable")) : outcome.output?.unchanged ? t("connections.unchanged") : t("connections.saved")}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        {diag && (
          <span>
            {t("connections.diagnostic", { adapter: diag.adapterVersion ?? "—", missing: diag.missingScopes?.length ? diag.missingScopes.join(", ") : t("connections.none") })}
          </span>
        )}
        <Link href={`/a/${agencySlug}/runs/${outcome.runId}`} className="text-xs underline-offset-3 hover:underline">
          {t("connections.openRun")}
        </Link>
      </AlertDescription>
    </Alert>
  )
}

/** Test / revoke after impact review / restore for one simulated connection. */
export function ConnectionActions({
  agencySlug,
  provider,
  accountAlias,
  state,
  allowed,
  blockedReason,
  dependents,
}: {
  agencySlug: string
  provider: string
  accountAlias: string
  state: string
  allowed: boolean
  blockedReason: string | null
  dependents: { label: string; href: string }[]
}) {
  const { t } = useI18n()
  const router = useRouter()
  const { pending, outcome, run } = useIntegration(agencySlug)
  const [review, setReview] = useState(false)
  const refresh = () => router.refresh()
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!allowed || pending} onClick={() => run({ action: "test", provider, accountAlias }, refresh)}>
          <RefreshCwIcon aria-hidden="true" />
          {t("connections.test")}
        </Button>
        {state === "connected_demo" ? (
          <Button size="sm" variant="outline" disabled={!allowed || pending} onClick={() => setReview(true)}>
            <UnplugIcon aria-hidden="true" />
            {t("connections.reviewImpact")}
          </Button>
        ) : (
          <Button size="sm" disabled={!allowed || pending} onClick={() => run({ action: "restore", provider, accountAlias }, refresh)}>
            <PlugZapIcon aria-hidden="true" />
            {t("connections.restore")}
          </Button>
        )}
      </div>
      <OutcomeAlert outcome={outcome} agencySlug={agencySlug} />
      <AlertDialog open={review} onOpenChange={(o) => !pending && setReview(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("connections.impactTitle", { account: accountAlias })}</AlertDialogTitle>
            <AlertDialogDescription>{t("connections.impactBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
            {dependents.length === 0 ? <li className="text-muted-foreground">{t("connections.noDependents")}</li> : dependents.map((d) => <li key={d.href}>{d.label}</li>)}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run({ action: "revoke", provider, accountAlias }, () => {
                  setReview(false)
                  refresh()
                })
              }
            >
              {t("connections.revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const ALIAS = /^[a-z0-9_]{3,80}$/

/** Configure a demo connection: provider, fictitious account alias, required scopes. */
export function ConnectDialog({
  agencySlug,
  providers,
  allowed,
}: {
  agencySlug: string
  providers: { provider: string; label: string; scopes: string[]; workflows: string[] }[]
  allowed: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState(providers[0]?.provider ?? "")
  const [alias, setAlias] = useState("")
  const { pending, outcome, run } = useIntegration(agencySlug)
  const spec = providers.find((p) => p.provider === provider)
  const invalid = alias !== "" && !ALIAS.test(alias)
  return (
    <>
      <Button size="sm" disabled={!allowed} onClick={() => setOpen(true)}>
        <PlugIcon aria-hidden="true" />
        {t("connections.configure")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("connections.configureTitle")}</DialogTitle>
            <DialogDescription>{t("connections.configureBody")}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!ALIAS.test(alias)) return
              run({ action: "connect", provider, accountAlias: alias }, (output) => {
                const id = typeof output?.connectionId === "string" ? output.connectionId : null
                setOpen(false)
                if (id) router.push(`/a/${agencySlug}/connections/${id}`)
                else router.refresh()
              })
            }}
          >
            <Field>
              <FieldLabel htmlFor="connect-provider">{t("connections.provider")}</FieldLabel>
              <Select items={providers.map((p) => ({ value: p.provider, label: p.label }))} value={provider} onValueChange={(v) => setProvider(String(v ?? ""))}>
                <SelectTrigger id="connect-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.provider} value={p.provider}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="connect-alias">{t("connections.alias")}</FieldLabel>
              <Input id="connect-alias" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="demo_meta_brand" aria-invalid={invalid || undefined} maxLength={80} />
              <FieldDescription>{t("connections.aliasHelp")}</FieldDescription>
              {invalid && <FieldError>{t("connections.aliasInvalid")}</FieldError>}
            </Field>
            {spec && (
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs font-medium text-muted-foreground">{t("connections.scopesRequested")}</span>
                <span className="flex flex-wrap gap-1">
                  {spec.scopes.map((s) => (
                    <Badge key={s} variant="outline" className="font-mono">
                      {s}
                    </Badge>
                  ))}
                </span>
                <span className="text-xs text-muted-foreground">{t("connections.usedBy", { count: spec.workflows.length })}</span>
              </div>
            )}
            <OutcomeAlert outcome={outcome} agencySlug={agencySlug} />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending || !ALIAS.test(alias)}>
                {pending ? t("common.loading") : t("connections.connect")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
