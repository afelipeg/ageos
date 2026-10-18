"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon, ArrowRightIcon, RocketIcon, SaveIcon, TriangleAlertIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { Stepper, StepperIndicator, StepperItem, StepperNav, StepperSeparator, StepperTitle, StepperTrigger } from "@/components/reui/stepper"
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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { saveSetupStepAction, startActivationAction } from "@/server/actions/ui/control"
import type { ConfigurationValidation, DraftView, SetupStepKey } from "@/server/domain/configuration"

import { AgencyStepForm, BrandStepForm, ConnectionsStepForm, OperationsStepForm, type WizardOptions } from "./setup-steps"
import { ReviewStep } from "./setup-review"

const STEPS: SetupStepKey[] = ["agency", "operations", "connections", "brand-access", "review"]

export type Issue = { step?: string; path: string; code: string; details?: Record<string, unknown> }

type StepData = Record<string, unknown>

function initialData(draft: DraftView, step: SetupStepKey, options: WizardOptions): StepData {
  const s = draft.sections
  if (step === "agency") return { name: "", appName: "", country: "US", legalEntityName: "", baseCurrency: "USD", timezone: "UTC", services: [], ...(s.agency as StepData) }
  if (step === "operations") {
    const profile = (s.operations as { profile?: string }).profile ?? "full_service"
    const defaults = options.profileDefaults[profile] ?? Object.values(options.profileDefaults)[0]!
    return { ...defaults, ...(s.operations as StepData), enabledCapabilities: draft.enabledCapabilities }
  }
  if (step === "connections") return { mode: "simulated", accounts: [], ...(s.connections as StepData) }
  if (step === "brand-access") {
    const b = s.brandAccess as StepData
    return { logoText: "", accent: "#1d4ed8", appSlug: draft.agency.slug.startsWith("draft-") ? "" : draft.agency.slug, members: [], customDomain: null, ...b }
  }
  return {}
}

/** Server data the brand step does not accept (computed fields). */
function cleanForSave(step: SetupStepKey, data: StepData): StepData {
  if (step === "brand-access") {
    const { demoPath: _ignored, ...rest } = data as StepData & { demoPath?: unknown }
    void _ignored
    return { ...rest, customDomain: typeof rest.customDomain === "string" && rest.customDomain.trim() ? rest.customDomain : null }
  }
  if (step === "agency") {
    const { region: _r, ...rest } = data as StepData & { region?: unknown }
    void _r
    return rest
  }
  return data
}

/**
 * Five-step wizard over the persisted draft. Each Save/Continue sends the
 * step data with the draft revision it was loaded with; the configuration
 * service validates, stores and bumps the revision. Unsaved edits are
 * protected (Save / Discard / Stay). Deploy starts the activation run.
 */
export function SetupWizard({ draft, step, validation, options }: { draft: DraftView; step: SetupStepKey; validation: ConfigurationValidation | null; options: WizardOptions }) {
  const { t, messages } = useI18n()
  const router = useRouter()
  const [data, setData] = useState<StepData>(() => initialData(draft, step, options))
  const [revision, setRevision] = useState(draft.revision.revision)
  const [dirty, setDirty] = useState(false)
  const [issues, setIssues] = useState<Issue[]>([])
  const [banner, setBanner] = useState<{ kind: "saved" | "conflict" | "blocked" | "error"; text: string } | null>(null)
  const [pending, start] = useTransition()
  const [leaveTo, setLeaveTo] = useState<string | null>(null)
  const deployKey = useRef(`control:deploy:${draft.draftId}:${crypto.randomUUID()}`)
  const formRef = useRef<HTMLDivElement>(null)
  const index = STEPS.indexOf(step)
  const editable = draft.revision.editable
  const base = `/control/setup/${draft.draftId}`

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])

  const update = (patch: StepData) => {
    setData((d) => ({ ...d, ...patch }))
    setDirty(true)
    setBanner(null)
  }

  const issueText = (code: string, details?: Record<string, unknown>) => {
    const key = code.replace(/^invalid:/, "")
    const tree = (messages.control as unknown as { issues: Record<string, string> }).issues
    return tree[key] ? t(`control.issues.${key}`, { skill: String(details?.skillId ?? ""), requiredBy: Array.isArray(details?.requiredBy) ? (details!.requiredBy as string[]).join(", ") : "" }) : t("control.issues.generic", { code: key })
  }

  const save = (then?: string) => {
    if (step === "review") return
    start(async () => {
      const res = await saveSetupStepAction({ draftId: draft.draftId, step: index + 1, data: cleanForSave(step, data), expectedRevision: revision })
      if (!res.ok) {
        const d = res.error.details as { issues?: Issue[]; rule?: string; violations?: Issue[] }
        if (res.error.code === "revision_conflict") {
          setBanner({ kind: "conflict", text: t("states.revisionConflictBody") })
          return
        }
        if (res.error.code === "validation" && Array.isArray(d.issues)) {
          setIssues(d.issues)
          setBanner({ kind: "error", text: t("control.wizard.fixFields") })
          requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus())
          return
        }
        if (res.error.code === "blocked_by_rule") {
          const v = (d.violations as unknown as { rule: string; skillId: string; requiredBy?: string[] }[] | undefined)?.[0]
          setIssues(v ? [{ path: "enabledCapabilities", code: v.rule, details: { skillId: v.skillId, requiredBy: v.requiredBy } }] : [])
          setBanner({ kind: "blocked", text: v ? issueText(v.rule, { skillId: v.skillId, requiredBy: v.requiredBy }) : issueText(d.rule ?? "generic") })
          return
        }
        setBanner({ kind: "error", text: t(`errors.${res.error.code}`) })
        return
      }
      setIssues([])
      setRevision(res.data.revision)
      setDirty(false)
      if (then) router.push(then)
      else {
        setBanner({ kind: "saved", text: t("control.wizard.saved", { n: res.data.revision }) })
        router.refresh()
      }
    })
  }

  const deploy = () => {
    start(async () => {
      const res = await startActivationAction({ draftId: draft.draftId, idempotencyKey: deployKey.current })
      if (!res.ok) {
        const d = res.error.details as { rule?: string }
        setBanner({ kind: res.error.code === "blocked_by_rule" ? "blocked" : "error", text: d.rule ? issueText(d.rule) : t(`errors.${res.error.code}`) })
        return
      }
      router.push(`/control/activations/${res.data.runId}`)
    })
  }

  const go = (href: string) => (dirty ? setLeaveTo(href) : router.push(href))
  const maxReachable = Math.min(4, draft.revision.lastCompletedStep)
  const preview = useMemo(() => {
    const a = draft.sections.agency as { name?: string; appName?: string }
    const b = (step === "brand-access" ? data : draft.sections.brandAccess) as { accent?: string; logoText?: string; appSlug?: string }
    const ag = (step === "agency" ? data : a) as { name?: string; appName?: string }
    return { name: ag.name || t("control.agencies.unnamed"), appName: ag.appName || "—", accent: typeof b.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(b.accent) ? b.accent : "#334155", logo: b.logoText || "—", slug: b.appSlug || draft.agency.slug }
  }, [data, draft, step, t])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{t("control.wizard.title")}</h1>
          <Badge variant="outline">{t("control.wizard.revision", { n: draft.revision.number, rev: revision })}</Badge>
          {dirty ? <Badge variant="warning-light">{t("states.unsavedChanges")}</Badge> : <Badge variant="outline">{t("control.wizard.draftSaved")}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{t("control.wizard.description")}</p>
      </div>

      <Stepper value={index + 1} className="w-full">
        <StepperNav className="overflow-x-auto pb-1">
          {STEPS.map((s, i) => {
            const reachable = i <= maxReachable || i <= index
            return (
              <StepperItem key={s} step={i + 1} completed={draft.steps[i]?.completed} disabled={!reachable} className="relative">
                <StepperTrigger className="flex flex-col items-center gap-1.5" disabled={!reachable} onClick={() => reachable && i !== index && go(`${base}/${s}`)}>
                  <StepperIndicator>{i + 1}</StepperIndicator>
                  <StepperTitle className="text-center text-xs whitespace-nowrap">{t(`control.steps.${s}.title`)}</StepperTitle>
                </StepperTrigger>
                {i < STEPS.length - 1 && <StepperSeparator className="mx-2 mb-5" />}
              </StepperItem>
            )
          })}
        </StepperNav>
      </Stepper>

      {!editable && (
        <Alert variant="info">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t("control.wizard.notEditableTitle")}</AlertTitle>
          <AlertDescription>{t("control.wizard.notEditableBody", { state: t(`records.state.${draft.revision.state}`) })}</AlertDescription>
          {draft.activationRunId && (
            <AlertAction>
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/control/activations/${draft.activationRunId}`} />}>
                {t("control.wizard.viewActivation")}
              </Button>
            </AlertAction>
          )}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>{t(`control.steps.${step}.title`)}</CardTitle>
            <CardDescription>{t(`control.steps.${step}.help`)}</CardDescription>
          </CardHeader>
          <CardContent ref={formRef} className="flex flex-col gap-4">
            {banner && (
              <Alert variant={banner.kind === "saved" ? "success" : banner.kind === "conflict" || banner.kind === "blocked" ? "warning" : "destructive"} aria-live="polite">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertTitle>{banner.kind === "conflict" ? t("states.revisionConflictTitle") : banner.kind === "saved" ? t("common.save") : banner.kind === "blocked" ? t("states.blockedTitle") : t("states.errorTitle")}</AlertTitle>
                <AlertDescription>{banner.text}</AlertDescription>
                {banner.kind === "conflict" && (
                  <AlertAction>
                    <Button size="sm" variant="outline" onClick={() => router.refresh()}>
                      {t("states.reloadLatest")}
                    </Button>
                  </AlertAction>
                )}
              </Alert>
            )}
            <fieldset disabled={!editable || pending} className="flex min-w-0 flex-col gap-4">
              {step === "agency" && <AgencyStepForm data={data} update={update} issues={issues} issueText={issueText} options={options} />}
              {step === "operations" && <OperationsStepForm data={data} update={update} issues={issues} issueText={issueText} options={options} catalog={draft.catalog} />}
              {step === "connections" && <ConnectionsStepForm data={data} update={update} issues={issues} issueText={issueText} options={options} />}
              {step === "brand-access" && <BrandStepForm data={data} update={update} issues={issues} issueText={issueText} options={options} />}
            </fieldset>
            {step === "review" && validation && <ReviewStep validation={validation} base={base} issueText={issueText} />}
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" size="sm" disabled={index === 0 || pending} onClick={() => go(`${base}/${STEPS[index - 1]}`)}>
              <ArrowLeftIcon aria-hidden="true" />
              {t("common.back")}
            </Button>
            <div className="flex flex-wrap gap-2">
              {step !== "review" && (
                <>
                  <Button variant="outline" size="sm" disabled={!editable || pending} onClick={() => save()}>
                    <SaveIcon aria-hidden="true" />
                    {t("common.saveDraft")}
                  </Button>
                  <Button size="sm" disabled={!editable || pending} onClick={() => save(`${base}/${STEPS[index + 1]}`)}>
                    {pending ? t("common.loading") : t("common.continue")}
                    <ArrowRightIcon aria-hidden="true" />
                  </Button>
                </>
              )}
              {step === "review" && (
                <Button size="sm" disabled={!editable || pending || !validation?.valid} onClick={deploy}>
                  <RocketIcon aria-hidden="true" />
                  {pending ? t("common.loading") : t("control.wizard.deploy")}
                </Button>
              )}
            </div>
          </CardFooter>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHeader>
            <CardTitle>{t("control.wizard.previewTitle")}</CardTitle>
            <CardDescription>{t("control.wizard.previewHelp")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-md text-sm font-semibold text-white" style={{ backgroundColor: preview.accent }}>
                {preview.logo}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{preview.appName}</span>
                <span className="truncate text-xs text-muted-foreground">{preview.name}</span>
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">{t("control.wizard.address")}</dt>
              <dd className="font-mono text-xs break-all">/a/{preview.slug}</dd>
              <dt className="text-muted-foreground">{t("control.wizard.capabilities")}</dt>
              <dd>{t("control.wizard.capabilitiesCount", { n: draft.enabledCapabilities.length })}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">{t("control.wizard.previewNote")}</p>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={leaveTo !== null} onOpenChange={(o) => !o && setLeaveTo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("states.unsavedChanges")}</AlertDialogTitle>
            <AlertDialogDescription>{t("control.wizard.leaveBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("control.wizard.stay")}</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const to = leaveTo
                setLeaveTo(null)
                setDirty(false)
                if (to) router.push(to)
              }}
            >
              {t("control.wizard.discard")}
            </Button>
            <AlertDialogAction
              onClick={() => {
                const to = leaveTo
                setLeaveTo(null)
                if (to) save(to)
              }}
            >
              {t("common.save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
