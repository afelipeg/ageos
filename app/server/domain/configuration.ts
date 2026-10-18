import "server-only"

import { randomUUID } from "node:crypto"

import { and, desc, eq, ne, sql } from "drizzle-orm"
import { z } from "zod"

import { CAPABILITY_CONTRACTS, MODULES } from "@/lib/capabilities/catalog.generated"
import { GOVERNANCE } from "@/lib/capabilities/governance"
import type { Localized } from "@/lib/capabilities/types"
import { DEMO_SEED_VERSION } from "@/lib/demo"
import { ROLES, type Role } from "@/lib/policy"
import { PROVIDERS } from "@/server/adapters/simulated-provider"
import type { AgencyContext } from "@/server/auth/context"
import type { SessionInfo } from "@/server/auth/session"
import { db, type Tx } from "@/server/db/client"
import { activationRun, agency, businessEvent, configurationRevision, membership } from "@/server/db/schema"
import { withTenant } from "@/server/db/tenant"
import { isDemoMode } from "@/server/env"
import { digestOf } from "@/server/kernel/approvals"
import { assertRevision, defineCommand, executeCommand, type CommandResponse } from "@/server/kernel/commands"
import { DomainError } from "@/server/kernel/errors"

// Control plane: the five-step setup wizard (P03), its validation, and
// capability changes of an existing agency (new revision + owner approval with
// separation of duties). Every entry point re-checks the session's membership
// on the server; ids from the browser are only lookup keys.

export const CONFIG_SCHEMA_VERSION = "ageos-config@1"
/** Marker prefix for agencies created during a demo run (removed by demo reset). */
export const DEMO_CREATED_MARKER = `${DEMO_SEED_VERSION}:created`

export const SETUP_STEPS = ["agency", "operations", "connections", "brand-access", "review"] as const
export type SetupStepKey = (typeof SETUP_STEPS)[number]
export type SetupStepNumber = 1 | 2 | 3 | 4 | 5

export const COUNTRIES = ["US", "CA", "MX", "CO", "CL"] as const
export const CURRENCIES = ["USD", "CAD", "MXN", "COP", "CLP", "EUR"] as const
export const TIMEZONES = [
  "America/Mexico_City",
  "America/Bogota",
  "America/Santiago",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "UTC",
] as const
export const SERVICES = ["creative", "production", "media"] as const
export const OPERATING_PROFILES = ["full_service", "media", "production"] as const
export type OperatingProfile = (typeof OPERATING_PROFILES)[number]
export const FEE_TYPES = ["fixed_fee", "retainer", "time_and_materials", "commission"] as const

/** Roles that may prepare a capability change; only an owner other than the requester approves. */
export const CONFIG_PROPOSER_ROLES: readonly Role[] = ["owner", "account_manager"]
export const CONFIG_APPROVER_ROLES: readonly Role[] = ["owner"]

/** Commercial segment derived from the country. Never a tax jurisdiction. */
function regionOf(country: string): "US" | "CAN" | "LATAM" {
  return country === "US" ? "US" : country === "CA" ? "CAN" : "LATAM"
}

// ── Step schemas (server is the only validator; the UI mirrors them) ──

export const AgencyStepSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    appName: z.string().trim().min(2).max(60),
    country: z.enum(COUNTRIES),
    legalEntityName: z.string().trim().min(2).max(120),
    baseCurrency: z.enum(CURRENCIES),
    timezone: z.enum(TIMEZONES),
    services: z.array(z.enum(SERVICES)).min(1).max(3),
  })
  .strict()

export const OperationsStepSchema = z
  .object({
    profile: z.enum(OPERATING_PROFILES),
    feeType: z.enum(FEE_TYPES),
    budget: z
      .object({
        requireApprovedBudget: z.boolean(),
        marginFloorBps: z.number().int().min(0).max(9000),
      })
      .strict(),
    approvalOwners: z
      .object({
        budget: z.enum(["finance_approver", "owner"]),
        payments: z.enum(["finance_approver"]),
        configuration: z.enum(["owner"]),
      })
      .strict(),
    enabledCapabilities: z.array(z.string().max(80)).max(42),
  })
  .strict()

const ProviderKey = z.string().refine((p) => p in PROVIDERS, { message: "unknown_provider" })

export const ConnectionsStepSchema = z
  .object({
    // "files" = Start with files: every flow runs in manual/file mode.
    mode: z.enum(["simulated", "files"]),
    accounts: z
      .array(
        z
          .object({
            provider: ProviderKey,
            accountAlias: z.string().trim().regex(/^[a-z0-9_]{3,80}$/, "alias_format"),
            scopes: z.array(z.string().max(40)).min(1).max(10),
          })
          .strict()
      )
      .max(12),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>()
    v.accounts.forEach((a, i) => {
      const k = `${a.provider}:${a.accountAlias}`
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["accounts", i, "accountAlias"], message: "duplicate_account" })
      seen.add(k)
      const allowed = PROVIDERS[a.provider]?.scopes ?? []
      a.scopes.forEach((s, j) => {
        if (!allowed.includes(s)) ctx.addIssue({ code: "custom", path: ["accounts", i, "scopes", j], message: "scope_not_offered" })
      })
    })
  })

const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+example$/

export const BrandAccessStepSchema = z
  .object({
    logoText: z.string().trim().regex(/^[A-Z0-9]{1,3}$/, "logo_text_format"),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "accent_format")
      .transform((v) => v.toLowerCase()),
    appSlug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "slug_format")
      .refine((v) => !v.startsWith("draft-"), { message: "slug_reserved" }),
    members: z
      .array(
        z
          .object({
            name: z.string().trim().min(2).max(80),
            email: z.email().max(200).refine((e) => e.toLowerCase().endsWith(".example"), { message: "email_must_be_example" }),
            role: z.enum(ROLES).refine((r) => r !== "owner", { message: "invite_owner_not_allowed" }),
          })
          .strict()
      )
      .max(20),
    // Optional own domain: always simulated, must use the reserved .example TLD.
    customDomain: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => HOSTNAME.test(v), { message: "domain_must_end_with_example" })
      .nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (contrastRatio(v.accent, "#ffffff") < 4.5) {
      ctx.addIssue({ code: "custom", path: ["accent"], message: "contrast_below_4_5" })
    }
    const emails = new Set<string>()
    v.members.forEach((m, i) => {
      const e = m.email.toLowerCase()
      if (emails.has(e)) ctx.addIssue({ code: "custom", path: ["members", i, "email"], message: "duplicate_member" })
      emails.add(e)
    })
  })

export const ReviewStepSchema = z.object({}).strict()

export type AgencyStep = z.infer<typeof AgencyStepSchema>
export type OperationsStep = z.infer<typeof OperationsStepSchema>
export type ConnectionsStep = z.infer<typeof ConnectionsStepSchema>
export type BrandAccessStep = z.input<typeof BrandAccessStepSchema>

/** WCAG 2.x contrast ratio between two #rrggbb colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    const [r, g, bl] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// ── Capability catalog, profiles and dependency rules ──

const ALL_SKILLS = CAPABILITY_CONTRACTS.map((c) => c.skillId)
const MANDATORY = ALL_SKILLS.filter((s) => GOVERNANCE[s]?.mandatory)
const DEPS = (s: string): readonly string[] => GOVERNANCE[s]?.dependsOn ?? []

export type CapabilityCatalogEntry = {
  skillId: string
  moduleKey: string
  moduleId: string
  label: Localized
  enabled: boolean
  mandatory: boolean
  dependsOn: readonly string[]
  /** Enabled capabilities that depend on this one (disable them first). */
  requiredBy: string[]
}

/** The full 42-capability catalog with enablement and dependency flags. Always 42 entries. */
export function getCapabilityCatalog(enabled: Iterable<string>): CapabilityCatalogEntry[] {
  const on = new Set(enabled)
  return CAPABILITY_CONTRACTS.map((c) => ({
    skillId: c.skillId,
    moduleKey: c.moduleKey,
    moduleId: c.moduleId,
    label: c.label,
    enabled: on.has(c.skillId),
    mandatory: Boolean(GOVERNANCE[c.skillId]?.mandatory),
    dependsOn: DEPS(c.skillId),
    requiredBy: ALL_SKILLS.filter((o) => on.has(o) && DEPS(o).includes(c.skillId)),
  }))
}

const PROFILE_EXCLUDED_MODULES: Record<OperatingProfile, string[]> = {
  full_service: [],
  media: ["work-production"],
  production: ["media-planning", "media-buying"],
}

/**
 * Deterministic profile prefill: start from all 42, drop the profile's excluded
 * modules, then drop anything whose dependencies are gone. Mandatory controls stay.
 */
export function profileCapabilities(profile: OperatingProfile): string[] {
  const excluded = new Set(MODULES.filter((m) => PROFILE_EXCLUDED_MODULES[profile].includes(m.key)).flatMap((m) => m.skillIds))
  const on = new Set(ALL_SKILLS.filter((s) => !excluded.has(s)))
  let changed = true
  while (changed) {
    changed = false
    for (const s of [...on]) {
      if (!MANDATORY.includes(s) && DEPS(s).some((d) => !on.has(d))) {
        on.delete(s)
        changed = true
      }
    }
  }
  return ALL_SKILLS.filter((s) => on.has(s))
}

/** Editable operations defaults for a profile (the wizard's "profile" selector). */
export function profileDefaults(profile: OperatingProfile): OperationsStep {
  return {
    profile,
    feeType: profile === "media" ? "commission" : "fixed_fee",
    budget: { requireApprovedBudget: true, marginFloorBps: 4000 },
    approvalOwners: { budget: "finance_approver", payments: "finance_approver", configuration: "owner" },
    enabledCapabilities: profileCapabilities(profile),
  }
}

/** "Use a sample agency" values for step 1 (fictional data, editable). */
export const SAMPLE_AGENCY: AgencyStep = {
  name: "Rayo de Sol",
  appName: "Estudio Solar",
  country: "US",
  legalEntityName: "Rayo de Sol Demo Entity",
  baseCurrency: "USD",
  timezone: "America/Mexico_City",
  services: ["creative", "production", "media"],
}

export type CapabilityRuleViolation = {
  rule: "unknown_capability" | "mandatory_capability" | "dependency_missing"
  skillId: string
  /** For dependency_missing: the enabled dependents that need `skillId`. */
  requiredBy?: string[]
}

/** Governance rules on an enabled set: known ids, mandatory controls on, dependencies satisfied. */
export function capabilityViolations(enabled: readonly string[]): CapabilityRuleViolation[] {
  const on = new Set(enabled)
  const out: CapabilityRuleViolation[] = []
  for (const s of on) if (!ALL_SKILLS.includes(s)) out.push({ rule: "unknown_capability", skillId: s })
  for (const s of MANDATORY) if (!on.has(s)) out.push({ rule: "mandatory_capability", skillId: s })
  const missing = new Map<string, string[]>()
  for (const s of ALL_SKILLS) {
    if (!on.has(s)) continue
    for (const d of DEPS(s)) if (!on.has(d)) missing.set(d, [...(missing.get(d) ?? []), s])
  }
  for (const [d, by] of missing) out.push({ rule: "dependency_missing", skillId: d, requiredBy: by })
  return out
}

const sortSkills = (skills: Iterable<string>) => ALL_SKILLS.filter((s) => new Set(skills).has(s))

// ── Membership-checked loading ──

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AgencyRow = typeof agency.$inferSelect
export type RevisionRow = typeof configurationRevision.$inferSelect

function assertControlSession(session: SessionInfo) {
  if (session.user.kind !== "agency") {
    throw new DomainError("forbidden", "The control plane requires an agency identity")
  }
}

async function activeMemberships(userId: string) {
  return db()
    .select({ agency, role: membership.role })
    .from(membership)
    .innerJoin(agency, eq(agency.id, membership.tenantId))
    .where(and(eq(membership.userId, userId), eq(membership.active, true)))
}

/** Owner-checked lookup of a configuration revision (draft) across the user's agencies. */
export async function loadOwnedRevision(session: SessionInfo, revisionId: string): Promise<{ agency: AgencyRow; rev: RevisionRow }> {
  assertControlSession(session)
  if (!UUID.test(revisionId)) throw new DomainError("not_found", "Draft not found")
  for (const m of await activeMemberships(session.user.id)) {
    if (m.role !== "owner") continue
    const rows = await withTenant(m.agency.id, (tx) =>
      tx.select().from(configurationRevision).where(eq(configurationRevision.id, revisionId)).limit(1)
    )
    if (rows[0]) return { agency: m.agency, rev: rows[0] }
  }
  throw new DomainError("not_found", "Draft not found")
}

/** Owner-checked agency lookup by id. */
export async function loadOwnedAgency(session: SessionInfo, agencyId: string): Promise<AgencyRow> {
  assertControlSession(session)
  if (!UUID.test(agencyId)) throw new DomainError("not_found", "Agency not found")
  const m = (await activeMemberships(session.user.id)).find((x) => x.agency.id === agencyId && x.role === "owner")
  if (!m) throw new DomainError("not_found", "Agency not found")
  return m.agency
}

export async function insertControlEvent(
  tx: Tx,
  tenantId: string,
  actorUserId: string,
  e: { eventType: string; aggregateType: string; aggregateId: string; aggregateRevision?: number; payload: Record<string, unknown> }
) {
  await tx.insert(businessEvent).values({
    tenantId,
    eventType: e.eventType,
    aggregateType: e.aggregateType,
    aggregateId: e.aggregateId,
    aggregateRevision: e.aggregateRevision ?? null,
    actorUserId,
    origin: "ui",
    commandType: e.eventType,
    payload: e.payload,
  })
}

// ── Control list ──

export type ControlAgency = {
  agencyId: string
  slug: string
  /** Null while the draft has no name yet (UI shows its own placeholder). */
  name: string | null
  appName: string | null
  status: string
  role: string
  publishedRevision: { id: string; number: number; publishedAt: string | null } | null
  draft: { id: string; number: number; lastCompletedStep: number; nextStep: SetupStepKey } | null
  latestActivation: { runId: string; state: string } | null
  demoPath: string | null
  domain: { requested: string | null; state: string; simulated: true }
  canOpenWorkspace: boolean
  canResumeSetup: boolean
}

/** P02: agencies the signed-in agency user belongs to, with configuration and activation state. */
export async function listControlAgencies(session: SessionInfo): Promise<ControlAgency[]> {
  assertControlSession(session)
  const out: ControlAgency[] = []
  for (const m of await activeMemberships(session.user.id)) {
    const a = m.agency
    const { revs, run } = await withTenant(a.id, async (tx) => ({
      revs: await tx.select().from(configurationRevision).where(eq(configurationRevision.tenantId, a.id)).orderBy(desc(configurationRevision.number)),
      run: (
        await tx
          .select({ id: activationRun.id, state: activationRun.state })
          .from(activationRun)
          .where(eq(activationRun.tenantId, a.id))
          .orderBy(desc(activationRun.createdAt))
          .limit(1)
      )[0],
    }))
    const published = revs.find((r) => r.id === a.publishedConfigRevisionId) ?? null
    const draft = m.role === "owner" ? (revs.find((r) => r.state === "draft") ?? null) : null
    out.push({
      agencyId: a.id,
      slug: a.slug,
      name: a.name || null,
      appName: a.appName || null,
      status: a.status,
      role: m.role,
      publishedRevision: published ? { id: published.id, number: published.number, publishedAt: published.publishedAt?.toISOString() ?? null } : null,
      draft: draft ? { id: draft.id, number: draft.number, lastCompletedStep: draft.lastCompletedStep, nextStep: SETUP_STEPS[Math.min(draft.lastCompletedStep, 4)]! } : null,
      latestActivation: run ? { runId: run.id, state: run.state } : null,
      demoPath: a.status === "ready" ? `/a/${a.slug}` : null,
      domain: { requested: a.requestedDomain, state: a.domainState, simulated: true },
      canOpenWorkspace: a.status === "ready",
      canResumeSetup: draft !== null,
    })
  }
  return out.sort((x, y) => (x.name ?? "").localeCompare(y.name ?? "") || x.slug.localeCompare(y.slug))
}

// ── Draft creation (idempotent) ──

const IdempotencyKey = z.string().min(8).max(200).regex(/^[A-Za-z0-9_.:-]+$/)

/**
 * P01/P02 "Build my demo agency": creates agency (status draft) + owner
 * membership + configuration revision 1 (draft). Idempotent per user and key:
 * a refresh or double submit returns the same draft, never a second tenant.
 */
export async function createAgencyDraft(
  session: SessionInfo,
  input: { idempotencyKey: string }
): Promise<{ draftId: string; agencyId: string; created: boolean }> {
  assertControlSession(session)
  if (!IdempotencyKey.safeParse(input.idempotencyKey).success) {
    throw new DomainError("validation", "Invalid idempotency key", { field: "idempotencyKey" })
  }
  const scopedKey = `${session.user.id}:${input.idempotencyKey}`
  const existing = async () => {
    const [a] = await db().select().from(agency).where(eq(agency.createIdempotencyKey, scopedKey)).limit(1)
    if (!a) return null
    const [rev] = await withTenant(a.id, (tx) =>
      tx.select({ id: configurationRevision.id }).from(configurationRevision).where(eq(configurationRevision.tenantId, a.id)).orderBy(configurationRevision.number).limit(1)
    )
    return { draftId: rev!.id, agencyId: a.id, created: false }
  }
  const found = await existing()
  if (found) return found

  const agencyId = randomUUID()
  const { enabledCapabilities, ...operations } = profileDefaults("full_service")
  const result = await withTenant(agencyId, async (tx) => {
    const inserted = await tx
      .insert(agency)
      .values({
        id: agencyId,
        slug: `draft-${agencyId.slice(0, 8)}`,
        name: "",
        appName: "",
        status: "draft",
        baseCurrency: "USD",
        timezone: "UTC",
        locale: session.user.locale,
        demoSeedVersion: isDemoMode() ? DEMO_CREATED_MARKER : null,
        createdBy: session.user.id,
        createIdempotencyKey: scopedKey,
      })
      .onConflictDoNothing({ target: agency.createIdempotencyKey })
      .returning({ id: agency.id })
    if (!inserted[0]) return null
    await tx.insert(membership).values({ userId: session.user.id, tenantId: agencyId, role: "owner" })
    const [rev] = await tx
      .insert(configurationRevision)
      .values({
        tenantId: agencyId,
        number: 1,
        state: "draft",
        schemaVersion: CONFIG_SCHEMA_VERSION,
        operations,
        connections: { mode: "simulated", accounts: [] },
        enabledCapabilities,
        approvalPolicy: { configuration: "owner", selfApproval: false },
        limits: DEMO_LIMITS,
        createdBy: session.user.id,
      })
      .returning({ id: configurationRevision.id })
    await insertControlEvent(tx, agencyId, session.user.id, {
      eventType: "configuration.draft_created",
      aggregateType: "configuration_revision",
      aggregateId: rev!.id,
      aggregateRevision: 1,
      payload: { number: 1, demo: isDemoMode() },
    })
    return { draftId: rev!.id, agencyId, created: true }
  })
  return result ?? (await existing())!
}

/** Demo limits shown on Review (labelled as sample quotas, never prices). */
export const DEMO_LIMITS = { storageMb: 100, filesPerJob: 50, assistantRunsPerHour: 120 } as const

// ── Draft view ──

export type ValidationIssue = {
  step: SetupStepKey
  /** Field path inside the step ("" for the whole step). */
  path: string
  /** Stable code; the UI maps it to EN/ES copy. */
  code: string
  details?: Record<string, unknown>
}

export type DraftView = {
  draftId: string
  agency: { id: string; slug: string; name: string | null; appName: string | null; status: string; existing: boolean }
  revision: { number: number; state: string; revision: number; lastCompletedStep: number; editable: boolean }
  sections: {
    agency: Partial<AgencyStep>
    operations: Partial<Omit<OperationsStep, "enabledCapabilities">>
    connections: Partial<ConnectionsStep>
    brandAccess: Partial<z.infer<typeof BrandAccessStepSchema>>
  }
  enabledCapabilities: string[]
  catalog: CapabilityCatalogEntry[]
  steps: { key: SetupStepKey; number: SetupStepNumber; completed: boolean }[]
  nextStep: SetupStepKey
  activationRunId: string | null
}

function toDraftView(a: AgencyRow, rev: RevisionRow, runId: string | null): DraftView {
  return {
    draftId: rev.id,
    agency: { id: a.id, slug: a.slug, name: a.name || null, appName: a.appName || null, status: a.status, existing: a.status === "ready" },
    revision: { number: rev.number, state: rev.state, revision: rev.revision, lastCompletedStep: rev.lastCompletedStep, editable: rev.state === "draft" },
    sections: {
      agency: rev.agencyProfile as DraftView["sections"]["agency"],
      operations: rev.operations as DraftView["sections"]["operations"],
      connections: rev.connections as DraftView["sections"]["connections"],
      brandAccess: rev.brandAccess as DraftView["sections"]["brandAccess"],
    },
    enabledCapabilities: rev.enabledCapabilities,
    catalog: getCapabilityCatalog(rev.enabledCapabilities),
    steps: SETUP_STEPS.map((key, i) => ({ key, number: (i + 1) as SetupStepNumber, completed: rev.lastCompletedStep >= i + 1 })),
    nextStep: SETUP_STEPS[Math.min(rev.lastCompletedStep, 4)]!,
    activationRunId: runId,
  }
}

/** P03: the persisted draft (owner only). Survives refresh; `nextStep` resumes the wizard. */
export async function getDraft(session: SessionInfo, draftId: string): Promise<DraftView> {
  const { agency: a, rev } = await loadOwnedRevision(session, draftId)
  const [run] = await withTenant(a.id, (tx) =>
    tx
      .select({ id: activationRun.id })
      .from(activationRun)
      .where(eq(activationRun.configurationRevisionId, rev.id))
      .orderBy(desc(activationRun.createdAt))
      .limit(1)
  )
  return toDraftView(a, rev, run?.id ?? null)
}

// ── Save a step ──

function zodIssues(step: SetupStepKey, error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({ step, path: i.path.join("."), code: i.code === "custom" ? i.message : i.code, details: { message: i.message } }))
}

function stepIndex(step: number): SetupStepKey {
  const key = SETUP_STEPS[step - 1]
  if (!key) throw new DomainError("validation", "Unknown setup step", { field: "step" })
  return key
}

export type SaveStepResult = {
  draftId: string
  step: SetupStepKey
  revision: number
  lastCompletedStep: number
  /** Present after step 5 (Review): the full configuration validation. */
  validation: ConfigurationValidation | null
}

/**
 * Saves one wizard step (1 Agency … 5 Review) with its Zod schema and the
 * draft's optimistic revision. Mandatory controls cannot be disabled and
 * dependencies must hold (blocked_by_rule with details.rule). Step 4 reserves a
 * unique slug. Step 5 runs the full validation and records it.
 */
export async function saveSetupStep(
  session: SessionInfo,
  draftId: string,
  step: number,
  data: unknown,
  expectedRevision: number
): Promise<SaveStepResult> {
  const key = stepIndex(step)
  const { agency: a, rev } = await loadOwnedRevision(session, draftId)
  if (rev.state !== "draft") {
    throw new DomainError("blocked_by_rule", "This configuration is no longer editable", { rule: "draft_not_editable", state: rev.state })
  }
  assertRevision(rev.revision, expectedRevision, "configuration_revision")

  const set: Partial<typeof configurationRevision.$inferInsert> = {}
  const agencyMirror: Partial<typeof agency.$inferInsert> = {}
  let validation: ConfigurationValidation | null = null
  let completes = true

  if (key === "agency") {
    const parsed = AgencyStepSchema.safeParse(data)
    if (!parsed.success) throw new DomainError("validation", "Invalid agency step", { issues: zodIssues(key, parsed.error) })
    set.agencyProfile = { ...parsed.data, region: regionOf(parsed.data.country) }
    if (a.status !== "ready") {
      Object.assign(agencyMirror, { name: parsed.data.name, appName: parsed.data.appName, baseCurrency: parsed.data.baseCurrency, timezone: parsed.data.timezone })
    }
  } else if (key === "operations") {
    const parsed = OperationsStepSchema.safeParse(data)
    if (!parsed.success) throw new DomainError("validation", "Invalid operations step", { issues: zodIssues(key, parsed.error) })
    const violations = capabilityViolations(parsed.data.enabledCapabilities)
    if (violations.length) {
      throw new DomainError("blocked_by_rule", "Capability selection breaks a governance rule", { rule: violations[0]!.rule, violations })
    }
    const { enabledCapabilities, ...ops } = parsed.data
    set.operations = ops
    set.enabledCapabilities = sortSkills(enabledCapabilities)
  } else if (key === "connections") {
    const parsed = ConnectionsStepSchema.safeParse(data)
    if (!parsed.success) throw new DomainError("validation", "Invalid connections step", { issues: zodIssues(key, parsed.error) })
    set.connections = parsed.data
  } else if (key === "brand-access") {
    const parsed = BrandAccessStepSchema.safeParse(data)
    if (!parsed.success) throw new DomainError("validation", "Invalid brand & access step", { issues: zodIssues(key, parsed.error) })
    const b = parsed.data
    if (a.status === "ready" && b.appSlug !== a.slug) {
      throw new DomainError("blocked_by_rule", "An active workspace keeps its slug", { rule: "slug_locked", slug: a.slug })
    }
    const [taken] = await db().select({ id: agency.id }).from(agency).where(and(eq(agency.slug, b.appSlug), ne(agency.id, a.id))).limit(1)
    if (taken) throw new DomainError("validation", "Slug already in use", { issues: [{ step: key, path: "appSlug", code: "slug_taken" }] })
    set.brandAccess = { ...b, demoPath: `/a/${b.appSlug}` }
    if (a.status !== "ready") agencyMirror.slug = b.appSlug
  } else {
    const parsed = ReviewStepSchema.safeParse(data ?? {})
    if (!parsed.success) throw new DomainError("validation", "Invalid review step", { issues: zodIssues(key, parsed.error) })
    validation = await withTenant(a.id, (tx) => validateRevisionTx(tx, a, rev))
    set.validation = validation
    completes = validation.valid
  }

  const updated = await withTenant(a.id, async (tx) => {
    const rows = await tx
      .update(configurationRevision)
      .set({
        ...set,
        lastCompletedStep: completes ? Math.max(rev.lastCompletedStep, step) : rev.lastCompletedStep,
        updatedAt: new Date(),
        revision: sql`${configurationRevision.revision} + 1`,
      })
      .where(and(eq(configurationRevision.id, rev.id), eq(configurationRevision.revision, expectedRevision), eq(configurationRevision.state, "draft")))
      .returning({ revision: configurationRevision.revision, lastCompletedStep: configurationRevision.lastCompletedStep })
    if (!rows[0]) throw new DomainError("revision_conflict", "This draft changed", { aggregate: "configuration_revision", expectedRevision })
    if (Object.keys(agencyMirror).length) {
      try {
        await tx.update(agency).set({ ...agencyMirror, updatedAt: new Date() }).where(eq(agency.id, a.id))
      } catch (e) {
        if (String((e as { cause?: { code?: string } }).cause?.code) === "23505") {
          throw new DomainError("validation", "Slug already in use", { issues: [{ step: key, path: "appSlug", code: "slug_taken" }] })
        }
        throw e
      }
    }
    await insertControlEvent(tx, a.id, session.user.id, {
      eventType: "configuration.step_saved",
      aggregateType: "configuration_revision",
      aggregateId: rev.id,
      aggregateRevision: rows[0].revision,
      payload: { step: key, number: rev.number, valid: completes },
    })
    return rows[0]
  })
  return { draftId: rev.id, step: key, revision: updated.revision, lastCompletedStep: updated.lastCompletedStep, validation }
}

// ── Validation ──

export type ConfigurationValidation = {
  valid: boolean
  blockers: ValidationIssue[]
  warnings: ValidationIssue[]
  summary: {
    agency: { name: string | null; appName: string | null; slug: string | null; demoPath: string | null }
    catalog: { modules: number; skills: number; enabled: number; mandatory: string[] }
    connections: { mode: string | null; accounts: number }
    members: number
    customDomain: string | null
    limits: typeof DEMO_LIMITS
    /** What Deploy will publish: the next revision number and its digest. */
    publish: { revisionNumber: number; enabledCapabilities: string[]; digest: string }
  }
}

/** Capabilities that use a simulated provider category (warning when no account is configured). */
const CATEGORY_USERS: Record<string, string[]> = {
  ads: ["agency-campaign-activation", "agency-campaign-optimization"],
  payments: ["agency-payment-run", "agency-cash-settlement"],
  accounting: ["agency-general-ledger"],
}

/** Full validation of a revision (shared by Review and the activation `validate` step). */
export async function validateRevisionTx(tx: Tx, a: AgencyRow, rev: RevisionRow): Promise<ConfigurationValidation> {
  const blockers: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const sections: [SetupStepKey, z.ZodType, unknown][] = [
    ["agency", AgencyStepSchema, stripKeys(rev.agencyProfile, ["region"])],
    ["operations", OperationsStepSchema, { ...(rev.operations as object), enabledCapabilities: rev.enabledCapabilities }],
    ["connections", ConnectionsStepSchema, rev.connections],
    ["brand-access", BrandAccessStepSchema, stripKeys(rev.brandAccess, ["demoPath"])],
  ]
  sections.forEach(([step, schema, value], i) => {
    if (rev.lastCompletedStep < i + 1) {
      blockers.push({ step, path: "", code: "step_incomplete" })
      return
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) blockers.push(...zodIssues(step, parsed.error).map((x) => ({ ...x, code: `invalid:${x.code}` })))
  })
  for (const v of capabilityViolations(rev.enabledCapabilities)) {
    blockers.push({ step: "operations", path: "enabledCapabilities", code: v.rule, details: { skillId: v.skillId, requiredBy: v.requiredBy ?? [] } })
  }
  const brand = rev.brandAccess as { appSlug?: string; customDomain?: string | null; members?: unknown[] }
  if (brand.appSlug) {
    const [taken] = await tx.select({ id: agency.id }).from(agency).where(and(eq(agency.slug, brand.appSlug), ne(agency.id, a.id))).limit(1)
    if (taken) blockers.push({ step: "brand-access", path: "appSlug", code: "slug_taken" })
  }
  let basePublished: RevisionRow | null = null
  if (a.publishedConfigRevisionId && a.publishedConfigRevisionId !== rev.id) {
    basePublished = (await tx.select().from(configurationRevision).where(eq(configurationRevision.id, a.publishedConfigRevisionId)).limit(1))[0] ?? null
  }
  if (a.status === "ready" && basePublished) {
    // Capability changes on an active agency need an owner other than the requester.
    const before = new Set(basePublished.enabledCapabilities)
    const after = new Set(rev.enabledCapabilities)
    if (before.size !== after.size || [...after].some((s) => !before.has(s))) {
      blockers.push({ step: "operations", path: "enabledCapabilities", code: "capability_change_requires_approval" })
    }
  }
  const agencyProfile = rev.agencyProfile as Partial<AgencyStep>
  const ops = rev.operations as Partial<OperationsStep>
  if (ops.profile === "media" && agencyProfile.services && !agencyProfile.services.includes("media")) {
    warnings.push({ step: "operations", path: "profile", code: "profile_services_mismatch" })
  }
  if (ops.profile === "production" && agencyProfile.services && !agencyProfile.services.includes("production")) {
    warnings.push({ step: "operations", path: "profile", code: "profile_services_mismatch" })
  }
  const conns = rev.connections as Partial<ConnectionsStep>
  const categories = new Set((conns.accounts ?? []).map((x) => PROVIDERS[x.provider]?.category))
  for (const [category, users] of Object.entries(CATEGORY_USERS)) {
    const affected = users.filter((u) => rev.enabledCapabilities.includes(u))
    if (affected.length && !categories.has(category)) {
      warnings.push({ step: "connections", path: "accounts", code: "manual_mode_for_flow", details: { category, capabilities: affected } })
    }
  }
  const enabled = sortSkills(rev.enabledCapabilities)
  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
    summary: {
      agency: { name: agencyProfile.name ?? null, appName: agencyProfile.appName ?? null, slug: brand.appSlug ?? null, demoPath: brand.appSlug ? `/a/${brand.appSlug}` : null },
      catalog: { modules: MODULES.length, skills: ALL_SKILLS.length, enabled: enabled.length, mandatory: MANDATORY },
      connections: { mode: conns.mode ?? null, accounts: conns.accounts?.length ?? 0 },
      members: brand.members?.length ?? 0,
      customDomain: brand.customDomain ?? null,
      limits: DEMO_LIMITS,
      publish: {
        revisionNumber: rev.number,
        enabledCapabilities: enabled,
        digest: publishDigest(a.id, rev),
      },
    },
  }
}

function stripKeys(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !keys.includes(k)))
}

/** Digest of exactly what a revision publishes. */
export function publishDigest(tenantId: string, rev: RevisionRow): string {
  return digestOf({
    tenantId,
    number: rev.number,
    schemaVersion: rev.schemaVersion,
    agencyProfile: rev.agencyProfile,
    operations: rev.operations,
    connections: rev.connections,
    brandAccess: rev.brandAccess,
    enabledCapabilities: sortSkills(rev.enabledCapabilities),
  })
}

/** Review: validates the draft without saving (blockers carry the step to fix). */
export async function validateConfiguration(session: SessionInfo, draftId: string): Promise<ConfigurationValidation> {
  const { agency: a, rev } = await loadOwnedRevision(session, draftId)
  return withTenant(a.id, (tx) => validateRevisionTx(tx, a, rev))
}

// ── Capability changes on an existing agency (revision + SoD approval) ──

export const ProposeCapabilityChangeInput = z
  .object({
    enable: z.array(z.string().max(80)).max(42).default([]),
    disable: z.array(z.string().max(80)).max(42).default([]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()

function changeDigest(tenantId: string, basedOnRevisionId: string, enabled: readonly string[]) {
  return digestOf({ kind: "capability_change", tenantId, basedOnRevisionId, enabledCapabilities: sortSkills(enabled) })
}

async function lockAgency(tx: Tx, tenantId: string) {
  const [a] = await tx.select().from(agency).where(eq(agency.id, tenantId)).for("update").limit(1)
  if (!a) throw new DomainError("not_found", "Agency not found")
  return a
}

export const proposeCapabilityChangeCommand = defineCommand({
  type: "configuration.proposeCapabilityChange",
  skillId: null,
  permission: "workspace.view",
  input: ProposeCapabilityChangeInput,
  handler: async (tx, ctx, input, meta) => {
    if (!CONFIG_PROPOSER_ROLES.includes(ctx.role)) {
      throw new DomainError("forbidden", `Role ${ctx.role} cannot propose configuration changes`, { roles: CONFIG_PROPOSER_ROLES })
    }
    const a = await lockAgency(tx, ctx.tenant.id)
    const [published] = await tx.select().from(configurationRevision).where(eq(configurationRevision.id, a.publishedConfigRevisionId ?? randomUUID())).limit(1)
    if (!published) throw new DomainError("blocked_by_rule", "No published configuration", { rule: "no_published_configuration" })
    assertRevision(published.number, meta.expectedRevision, "published_configuration")
    const unknown = [...input.enable, ...input.disable].filter((s) => !ALL_SKILLS.includes(s))
    if (unknown.length) throw new DomainError("validation", "Unknown capability", { issues: unknown.map((s) => ({ path: "skillId", code: "unknown_capability", skillId: s })) })
    const next = new Set(published.enabledCapabilities)
    input.disable.forEach((s) => next.delete(s))
    input.enable.forEach((s) => next.add(s))
    const enabled = sortSkills(next)
    const before = new Set(published.enabledCapabilities)
    const diff = { enabled: enabled.filter((s) => !before.has(s)), disabled: sortSkills(before).filter((s) => !next.has(s)) }
    if (!diff.enabled.length && !diff.disabled.length) {
      throw new DomainError("validation", "The change does not modify the configuration", { issues: [{ path: "", code: "no_change" }] })
    }
    const violations = capabilityViolations(enabled)
    if (violations.length) {
      const v = violations[0]!
      throw new DomainError("blocked_by_rule", "Capability change breaks a governance rule", {
        rule: v.rule === "dependency_missing" ? (diff.disabled.includes(v.skillId) ? "dependency_required" : "dependency_missing") : v.rule,
        violations,
      })
    }
    const [maxRow] = await tx
      .select({ n: sql<number>`max(${configurationRevision.number})::int` })
      .from(configurationRevision)
      .where(eq(configurationRevision.tenantId, ctx.tenant.id))
    const digest = changeDigest(ctx.tenant.id, published.id, enabled)
    const [rev] = await tx
      .insert(configurationRevision)
      .values({
        tenantId: ctx.tenant.id,
        number: (maxRow?.n ?? 0) + 1,
        state: "awaiting_approval",
        schemaVersion: published.schemaVersion,
        agencyProfile: published.agencyProfile as object,
        operations: published.operations as object,
        connections: published.connections as object,
        brandAccess: published.brandAccess as object,
        enabledCapabilities: enabled,
        approvalPolicy: published.approvalPolicy as object,
        limits: published.limits as object,
        lastCompletedStep: 5,
        basedOnRevisionId: published.id,
        diff,
        changeReason: input.reason,
        payloadDigest: digest,
        createdBy: ctx.user.id,
      })
      .returning()
    return {
      result: { revisionId: rev!.id, number: rev!.number, state: rev!.state, payloadDigest: digest, diff, eligibleRoles: CONFIG_APPROVER_ROLES },
      events: [
        {
          eventType: "configuration.change_proposed",
          aggregateType: "configuration_revision",
          aggregateId: rev!.id,
          aggregateRevision: rev!.revision,
          payload: { number: rev!.number, basedOn: published.number, diff, payloadDigest: digest, reason: input.reason },
        },
      ],
    }
  },
})

/**
 * Prepares a capability change of an existing agency as a new configuration
 * revision awaiting owner approval. `expectedRevision` is the published
 * revision NUMBER the user saw. Disabling keeps history and is blocked while
 * enabled capabilities depend on it; mandatory controls cannot be disabled.
 */
export async function proposeCapabilityChange(
  ctx: AgencyContext,
  input: { enable?: string[]; disable?: string[]; reason: string; idempotencyKey: string; expectedRevision: number }
) {
  const { idempotencyKey, expectedRevision, ...payload } = input
  return executeCommand(ctx, proposeCapabilityChangeCommand, { idempotencyKey, payload, origin: "ui", expectedRevision })
}

export const DecideCapabilityChangeInput = z
  .object({
    revisionId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    reviewedDigest: z.string().regex(/^[0-9a-f]{64}$/),
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .strict()

export const decideCapabilityChangeCommand = defineCommand({
  type: "configuration.decideCapabilityChange",
  skillId: null,
  permission: "config.manage",
  input: DecideCapabilityChangeInput,
  handler: async (tx, ctx, input) => {
    const [rev] = await tx
      .select()
      .from(configurationRevision)
      .where(and(eq(configurationRevision.tenantId, ctx.tenant.id), eq(configurationRevision.id, input.revisionId)))
      .for("update")
      .limit(1)
    if (!rev || !rev.basedOnRevisionId) throw new DomainError("not_found", "Configuration change not found")
    if (rev.state !== "awaiting_approval") {
      throw new DomainError("blocked_by_rule", "This change is no longer pending", { rule: "not_pending", state: rev.state })
    }
    if (rev.createdBy === ctx.user.id) throw new DomainError("self_approval", "The requester cannot approve their own change")
    if (!CONFIG_APPROVER_ROLES.includes(ctx.role)) {
      throw new DomainError("approver_not_eligible", "Your role cannot decide this change", { eligibleRoles: CONFIG_APPROVER_ROLES, role: ctx.role })
    }
    const a = await lockAgency(tx, ctx.tenant.id)
    const recomputed = changeDigest(ctx.tenant.id, rev.basedOnRevisionId, rev.enabledCapabilities)
    const stale = recomputed !== rev.payloadDigest || input.reviewedDigest !== rev.payloadDigest || a.publishedConfigRevisionId !== rev.basedOnRevisionId
    if (stale) {
      await tx.update(configurationRevision).set({ state: "stale", updatedAt: new Date(), revision: sql`${configurationRevision.revision} + 1` }).where(eq(configurationRevision.id, rev.id))
      return {
        result: { outcome: "stale" as string, published: false },
        events: [{ eventType: "configuration.change_stale", aggregateType: "configuration_revision", aggregateId: rev.id, payload: { number: rev.number } }],
      }
    }
    if (input.decision === "reject") {
      if (!input.reason?.trim()) throw new DomainError("validation", "A reason is required", { field: "reason" })
      await tx
        .update(configurationRevision)
        .set({ state: "rejected", approvedBy: null, decisionReason: input.reason, updatedAt: new Date(), revision: sql`${configurationRevision.revision} + 1` })
        .where(eq(configurationRevision.id, rev.id))
      return {
        result: { outcome: "rejected", published: false },
        events: [{ eventType: "configuration.change_rejected", aggregateType: "configuration_revision", aggregateId: rev.id, payload: { number: rev.number, reason: input.reason } }],
      }
    }
    const now = new Date()
    await tx
      .update(configurationRevision)
      .set({ state: "superseded", updatedAt: now, revision: sql`${configurationRevision.revision} + 1` })
      .where(eq(configurationRevision.id, rev.basedOnRevisionId))
    await tx
      .update(configurationRevision)
      .set({ state: "ready", approvedBy: ctx.user.id, publishedAt: now, decisionReason: input.reason ?? null, updatedAt: now, revision: sql`${configurationRevision.revision} + 1` })
      .where(eq(configurationRevision.id, rev.id))
    await tx
      .update(agency)
      .set({ publishedConfigRevisionId: rev.id, updatedAt: now, revision: sql`${agency.revision} + 1` })
      .where(eq(agency.id, ctx.tenant.id))
    return {
      result: { outcome: "published", published: true },
      events: [
        {
          eventType: "configuration.change_published",
          aggregateType: "configuration_revision",
          aggregateId: rev.id,
          payload: { number: rev.number, supersedes: rev.basedOnRevisionId, diff: rev.diff, payloadDigest: rev.payloadDigest },
        },
      ],
    }
  },
})

/**
 * Owner decision on a pending capability change. The approver must be an owner
 * other than the requester and must have reviewed the exact digest. Approval
 * publishes the revision (previous one becomes `superseded`); a change computed
 * against an older published revision becomes `stale`.
 */
export async function decideCapabilityChange(
  ctx: AgencyContext,
  input: z.input<typeof DecideCapabilityChangeInput> & { idempotencyKey: string }
): Promise<CommandResponse<{ outcome: string; published: boolean }>> {
  const { idempotencyKey, ...payload } = input
  return executeCommand(ctx, decideCapabilityChangeCommand, { idempotencyKey, payload, origin: "ui" })
}

/** Configuration history of the agency (published, pending, superseded…) for Settings. */
export async function listConfigurationRevisions(ctx: AgencyContext) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const rows = await tx.select().from(configurationRevision).where(eq(configurationRevision.tenantId, ctx.tenant.id)).orderBy(desc(configurationRevision.number))
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      state: r.state,
      published: r.id === ctx.tenant.publishedConfigRevisionId,
      enabled: r.enabledCapabilities.length,
      diff: (r.diff ?? null) as { enabled: string[]; disabled: string[] } | null,
      reason: r.changeReason,
      payloadDigest: r.payloadDigest,
      createdBy: r.createdBy,
      approvedBy: r.approvedBy,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      canDecide: r.state === "awaiting_approval" && CONFIG_APPROVER_ROLES.includes(ctx.role) && r.createdBy !== ctx.user.id,
    }))
  })
}
