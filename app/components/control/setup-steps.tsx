"use client"

import { LockKeyholeIcon, PlusIcon, Trash2Icon, WandSparklesIcon } from "lucide-react"

import { useI18n } from "@/components/i18n/i18n-provider"
import { Badge } from "@/components/reui/badge"
import { ColorPicker } from "@/components/reui/color-picker"
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from "@/components/reui/number-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { MODULES } from "@/lib/capabilities/catalog.generated"
import type { CapabilityCatalogEntry } from "@/server/domain/configuration"

import type { Issue } from "./setup-wizard"

export type WizardOptions = {
  countries: string[]
  currencies: string[]
  timezones: string[]
  services: string[]
  profiles: string[]
  feeTypes: string[]
  providers: { key: string; category: string; scopes: string[] }[]
  profileDefaults: Record<string, Record<string, unknown> & { enabledCapabilities: string[] }>
  sample: Record<string, unknown>
}

type StepProps = {
  data: Record<string, unknown>
  update: (patch: Record<string, unknown>) => void
  issues: Issue[]
  issueText: (code: string, details?: Record<string, unknown>) => string
  options: WizardOptions
}

function useErr(issues: Issue[], issueText: StepProps["issueText"]) {
  return (path: string) => {
    const i = issues.find((x) => x.path === path)
    return i ? issueText(i.code, i.details) : null
  }
}

function SelectField({ id, label, value, items, onChange, error }: { id: string; label: string; value: string; items: { value: string; label: string }[]; onChange: (v: string) => void; error: string | null }) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={(v) => onChange(String(v ?? ""))}>
        <SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined}>
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
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}

function TextField({ id, label, value, onChange, error, help, maxLength, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; error: string | null; help?: string; maxLength?: number; placeholder?: string }) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} maxLength={maxLength} placeholder={placeholder} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} />
      {help && <FieldDescription>{help}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}

// ── 1 · Agency ──

export function AgencyStepForm({ data, update, issues, issueText, options }: StepProps) {
  const { t } = useI18n()
  const err = useErr(issues, issueText)
  const services = (data.services as string[]) ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t("control.agency.sampleHelp")}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => update({ ...options.sample })}>
          <WandSparklesIcon aria-hidden="true" />
          {t("control.agency.useSample")}
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="ag-name" label={t("control.agency.name")} value={String(data.name ?? "")} onChange={(v) => update({ name: v })} error={err("name")} maxLength={80} />
        <TextField id="ag-app" label={t("control.agency.appName")} value={String(data.appName ?? "")} onChange={(v) => update({ appName: v })} error={err("appName")} maxLength={60} help={t("control.agency.appNameHelp")} />
        <SelectField id="ag-country" label={t("control.agency.country")} value={String(data.country ?? "")} items={options.countries.map((c) => ({ value: c, label: t(`control.countries.${c}`) }))} onChange={(v) => update({ country: v })} error={err("country")} />
        <TextField id="ag-entity" label={t("control.agency.legalEntity")} value={String(data.legalEntityName ?? "")} onChange={(v) => update({ legalEntityName: v })} error={err("legalEntityName")} maxLength={120} />
        <SelectField id="ag-currency" label={t("control.agency.currency")} value={String(data.baseCurrency ?? "")} items={options.currencies.map((c) => ({ value: c, label: c }))} onChange={(v) => update({ baseCurrency: v })} error={err("baseCurrency")} />
        <SelectField id="ag-tz" label={t("control.agency.timezone")} value={String(data.timezone ?? "")} items={options.timezones.map((z) => ({ value: z, label: z }))} onChange={(v) => update({ timezone: v })} error={err("timezone")} />
      </div>
      <FieldSet data-invalid={err("services") ? true : undefined}>
        <FieldLegend variant="label">{t("control.agency.services")}</FieldLegend>
        <div className="flex flex-wrap gap-4">
          {options.services.map((s) => (
            <Field key={s} orientation="horizontal" className="w-auto gap-2">
              <Checkbox id={`ag-svc-${s}`} checked={services.includes(s)} onCheckedChange={(c) => update({ services: c ? [...services, s] : services.filter((x) => x !== s) })} />
              <FieldLabel htmlFor={`ag-svc-${s}`} className="font-normal">
                {t(`control.services.${s}`)}
              </FieldLabel>
            </Field>
          ))}
        </div>
        {err("services") && <FieldError>{err("services")}</FieldError>}
      </FieldSet>
      <p className="text-xs text-muted-foreground">{t("control.agency.regionNote")}</p>
    </div>
  )
}

// ── 2 · Operations ──

export function OperationsStepForm({ data, update, issues, issueText, options, catalog }: StepProps & { catalog: CapabilityCatalogEntry[] }) {
  const { t, pick } = useI18n()
  const err = useErr(issues, issueText)
  const enabled = new Set((data.enabledCapabilities as string[]) ?? [])
  const budget = (data.budget as { requireApprovedBudget?: boolean; marginFloorBps?: number }) ?? {}
  const owners = (data.approvalOwners as { budget?: string; payments?: string; configuration?: string }) ?? {}
  const requiredBy = (skill: string) => catalog.filter((c) => enabled.has(c.skillId) && c.dependsOn.includes(skill)).map((c) => c.skillId)
  const toggle = (skill: string, on: boolean) => {
    const next = new Set(enabled)
    if (on) next.add(skill)
    else next.delete(skill)
    update({ enabledCapabilities: catalog.map((c) => c.skillId).filter((s) => next.has(s)) })
  }
  return (
    <div className="flex flex-col gap-5">
      <FieldSet>
        <FieldLegend variant="label">{t("control.operations.profile")}</FieldLegend>
        <RadioGroup
          value={String(data.profile ?? "full_service")}
          onValueChange={(v) => {
            const p = String(v)
            const d = options.profileDefaults[p]
            update(d ? { ...d, profile: p } : { profile: p })
          }}
          className="grid gap-2 sm:grid-cols-3"
          aria-label={t("control.operations.profile")}
        >
          {options.profiles.map((p) => (
            <Field key={p} orientation="horizontal" className="gap-2 rounded-lg border border-border p-3">
              <RadioGroupItem id={`op-${p}`} value={p} />
              <FieldLabel htmlFor={`op-${p}`} className="flex flex-col items-start gap-0.5 font-normal">
                <span className="font-medium">{t(`control.profiles.${p}.title`)}</span>
                <span className="text-xs text-muted-foreground">{t(`control.profiles.${p}.help`)}</span>
              </FieldLabel>
            </Field>
          ))}
        </RadioGroup>
        <FieldDescription>{t("control.operations.profileHelp")}</FieldDescription>
      </FieldSet>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id="op-fee" label={t("control.operations.feeType")} value={String(data.feeType ?? "")} items={options.feeTypes.map((f) => ({ value: f, label: t(`control.feeTypes.${f}`) }))} onChange={(v) => update({ feeType: v })} error={err("feeType")} />
        <Field data-invalid={err("budget.marginFloorBps") ? true : undefined}>
          <FieldLabel htmlFor="op-floor">{t("control.operations.marginFloor")}</FieldLabel>
          <NumberField value={typeof budget.marginFloorBps === "number" ? budget.marginFloorBps / 100 : null} onValueChange={(v) => update({ budget: { ...budget, marginFloorBps: v === null ? 0 : Math.round(v * 100) } })} min={0} max={90} step={0.5}>
            <NumberFieldGroup>
              <NumberFieldDecrement />
              <NumberFieldInput id="op-floor" />
              <NumberFieldIncrement />
            </NumberFieldGroup>
          </NumberField>
          <FieldDescription>{t("control.operations.marginFloorHelp")}</FieldDescription>
          {err("budget.marginFloorBps") && <FieldError>{err("budget.marginFloorBps")}</FieldError>}
        </Field>
        <Field orientation="horizontal" className="gap-2">
          <Switch id="op-budget" checked={budget.requireApprovedBudget !== false} onCheckedChange={(c) => update({ budget: { ...budget, requireApprovedBudget: c } })} />
          <FieldLabel htmlFor="op-budget" className="font-normal">
            {t("control.operations.requireBudget")}
          </FieldLabel>
        </Field>
        <SelectField
          id="op-owner-budget"
          label={t("control.operations.budgetApprover")}
          value={String(owners.budget ?? "finance_approver")}
          items={["finance_approver", "owner"].map((r) => ({ value: r, label: t(`header.roles.${r}`) }))}
          onChange={(v) => update({ approvalOwners: { budget: v, payments: "finance_approver", configuration: "owner" } })}
          error={err("approvalOwners.budget")}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("control.operations.fixedApprovers")}</p>

      <FieldSet>
        <FieldLegend variant="label">{t("control.operations.capabilities", { n: enabled.size, total: catalog.length })}</FieldLegend>
        <FieldDescription>{t("control.operations.capabilitiesHelp")}</FieldDescription>
        {err("enabledCapabilities") && <FieldError>{err("enabledCapabilities")}</FieldError>}
        <div className="flex flex-col gap-3">
          {MODULES.map((m) => (
            <div key={m.key} className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
              <span className="text-sm font-medium">
                {m.id} · {pick(m.label)}
              </span>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {catalog
                  .filter((c) => c.moduleKey === m.key)
                  .map((c) => {
                    const on = c.mandatory || enabled.has(c.skillId)
                    const needed = requiredBy(c.skillId)
                    const missing = c.dependsOn.filter((d) => !enabled.has(d) && !catalog.find((x) => x.skillId === d)?.mandatory)
                    return (
                      <Field key={c.skillId} orientation="horizontal" className="items-start gap-2">
                        <Checkbox id={`cap-${c.skillId}`} checked={on} disabled={c.mandatory} onCheckedChange={(v) => toggle(c.skillId, v === true)} />
                        <FieldLabel htmlFor={`cap-${c.skillId}`} className="flex flex-col items-start gap-0.5 font-normal">
                          <span className="flex flex-wrap items-center gap-1.5">
                            {pick(c.label)}
                            {c.mandatory && (
                              <Badge variant="outline">
                                <LockKeyholeIcon aria-hidden="true" />
                                {t("control.operations.mandatory")}
                              </Badge>
                            )}
                          </span>
                          {on && missing.length > 0 && <span className="text-xs text-destructive">{t("control.operations.needs", { list: missing.join(", ") })}</span>}
                          {!on && needed.length > 0 && <span className="text-xs text-destructive">{t("control.operations.requiredBy", { list: needed.join(", ") })}</span>}
                        </FieldLabel>
                      </Field>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
      </FieldSet>
    </div>
  )
}

// ── 3 · Connections ──

export function ConnectionsStepForm({ data, update, issues, issueText, options }: StepProps) {
  const { t } = useI18n()
  const err = useErr(issues, issueText)
  const accounts = ((data.accounts as { provider: string; accountAlias: string; scopes: string[] }[]) ?? []).map((a) => ({ ...a }))
  const set = (i: number, patch: Partial<(typeof accounts)[number]>) => update({ accounts: accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  return (
    <div className="flex flex-col gap-5">
      <FieldSet>
        <FieldLegend variant="label">{t("control.connections.mode")}</FieldLegend>
        <RadioGroup value={String(data.mode ?? "simulated")} onValueChange={(v) => update({ mode: String(v) })} className="grid gap-2 sm:grid-cols-2" aria-label={t("control.connections.mode")}>
          {["simulated", "files"].map((m) => (
            <Field key={m} orientation="horizontal" className="gap-2 rounded-lg border border-border p-3">
              <RadioGroupItem id={`cn-${m}`} value={m} />
              <FieldLabel htmlFor={`cn-${m}`} className="flex flex-col items-start gap-0.5 font-normal">
                <span className="font-medium">{t(`control.connections.modes.${m}.title`)}</span>
                <span className="text-xs text-muted-foreground">{t(`control.connections.modes.${m}.help`)}</span>
              </FieldLabel>
            </Field>
          ))}
        </RadioGroup>
      </FieldSet>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">{t("control.connections.accounts")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={accounts.length >= 12}
            onClick={() => {
              const p = options.providers[0]!
              update({ accounts: [...accounts, { provider: p.key, accountAlias: "", scopes: [...p.scopes] }] })
            }}
          >
            <PlusIcon aria-hidden="true" />
            {t("control.connections.add")}
          </Button>
        </div>
        {accounts.length === 0 && <p className="text-sm text-muted-foreground">{t("control.connections.none")}</p>}
        {accounts.map((a, i) => {
          const spec = options.providers.find((p) => p.key === a.provider)
          return (
            <div key={i} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_auto]">
              <SelectField
                id={`cn-provider-${i}`}
                label={t("control.connections.provider")}
                value={a.provider}
                items={options.providers.map((p) => ({ value: p.key, label: t(`connections.providers.${p.key}`) }))}
                onChange={(v) => set(i, { provider: v, scopes: [...(options.providers.find((p) => p.key === v)?.scopes ?? [])] })}
                error={err(`accounts.${i}.provider`)}
              />
              <TextField id={`cn-alias-${i}`} label={t("control.connections.alias")} value={a.accountAlias} onChange={(v) => set(i, { accountAlias: v })} error={err(`accounts.${i}.accountAlias`)} maxLength={80} placeholder="demo_meta_brand" />
              <div className="flex items-end">
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t("control.connections.remove")} onClick={() => update({ accounts: accounts.filter((_, j) => j !== i) })}>
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-3 sm:col-span-3">
                {(spec?.scopes ?? []).map((s, j) => (
                  <Field key={s} orientation="horizontal" className="w-auto gap-2" data-invalid={err(`accounts.${i}.scopes.${j}`) ? true : undefined}>
                    <Checkbox id={`cn-scope-${i}-${s}`} checked={a.scopes.includes(s)} onCheckedChange={(c) => set(i, { scopes: c ? [...a.scopes, s] : a.scopes.filter((x) => x !== s) })} />
                    <FieldLabel htmlFor={`cn-scope-${i}-${s}`} className="font-mono text-xs font-normal">
                      {s}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            </div>
          )
        })}
        {err("accounts") && <FieldError>{err("accounts")}</FieldError>}
      </div>
      <p className="text-xs text-muted-foreground">{t("control.connections.note")}</p>
    </div>
  )
}

// ── 4 · Brand & access ──

export function BrandStepForm({ data, update, issues, issueText }: StepProps) {
  const { t } = useI18n()
  const err = useErr(issues, issueText)
  const members = ((data.members as { name: string; email: string; role: string }[]) ?? []).map((m) => ({ ...m }))
  const setM = (i: number, patch: Partial<(typeof members)[number]>) => update({ members: members.map((m, j) => (j === i ? { ...m, ...patch } : m)) })
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="br-logo" label={t("settings.brand.logoText")} value={String(data.logoText ?? "")} onChange={(v) => update({ logoText: v.toUpperCase() })} error={err("logoText")} maxLength={3} help={t("settings.brand.logoHelp")} />
        <Field data-invalid={err("accent") ? true : undefined}>
          <FieldLabel htmlFor="br-accent">{t("settings.brand.accent")}</FieldLabel>
          <ColorPicker id="br-accent" value={String(data.accent ?? "")} onValueChange={(v) => update({ accent: v ?? "" })} format="hex" invalid={Boolean(err("accent"))} aria-label={t("settings.brand.accent")} />
          <FieldDescription>{t("settings.brand.accentHelp")}</FieldDescription>
          {err("accent") && <FieldError>{err("accent")}</FieldError>}
        </Field>
        <TextField id="br-slug" label={t("control.brand.slug")} value={String(data.appSlug ?? "")} onChange={(v) => update({ appSlug: v.toLowerCase() })} error={err("appSlug")} maxLength={63} help={t("control.brand.slugHelp")} />
        <TextField id="br-domain" label={t("control.brand.domain")} value={String(data.customDomain ?? "")} onChange={(v) => update({ customDomain: v })} error={err("customDomain")} maxLength={253} placeholder="estudio.rayodesol.example" help={t("control.brand.domainHelp")} />
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">{t("control.brand.members")}</span>
          <Button type="button" size="sm" variant="outline" disabled={members.length >= 20} onClick={() => update({ members: [...members, { name: "", email: "", role: "account_manager" }] })}>
            <PlusIcon aria-hidden="true" />
            {t("control.brand.addMember")}
          </Button>
        </div>
        {members.length === 0 && <p className="text-sm text-muted-foreground">{t("control.brand.noMembers")}</p>}
        {members.map((m, i) => (
          <div key={i} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <TextField id={`br-m-name-${i}`} label={t("control.brand.memberName")} value={m.name} onChange={(v) => setM(i, { name: v })} error={err(`members.${i}.name`)} maxLength={80} />
            <TextField id={`br-m-email-${i}`} label={t("control.brand.memberEmail")} value={m.email} onChange={(v) => setM(i, { email: v })} error={err(`members.${i}.email`)} maxLength={200} placeholder="name@agency.example" />
            <SelectField id={`br-m-role-${i}`} label={t("control.brand.memberRole")} value={m.role} items={["account_manager", "finance_approver", "producer", "viewer"].map((r) => ({ value: r, label: t(`header.roles.${r}`) }))} onChange={(v) => setM(i, { role: v })} error={err(`members.${i}.role`)} />
            <div className="flex items-end">
              <Button type="button" size="icon-sm" variant="ghost" aria-label={t("control.brand.removeMember")} onClick={() => update({ members: members.filter((_, j) => j !== i) })}>
                <Trash2Icon aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("control.brand.note")}</p>
    </div>
  )
}
