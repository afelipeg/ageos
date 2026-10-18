// Reproducible demo seed with two checkpoints (demo-fixtures.json seed_modes):
// * `ready_for_scope_review` (default): configured agency, masters, open job
//   with approved initial authority, approved budget/plan and the 100h
//   forecast. The 40h scope change, amendment, orders, invoices and payments
//   are NOT seeded: they arise from commands during the demo.
// * `from_intake`: configured agency + masters only (users, roles, legal
//   entities, published configuration, simulated connections, supplier,
//   synthetic documents, platform incident). The Aurora client, brief, job,
//   authority, budget, estimate and plan arise through user commands. Norte
//   Studio (isolation) and the demo-lab exercises are seeded in both modes.
//
// Runs as the schema owner role (bypasses RLS as table owner). Reset deletes
// only demo tenants' rows and records a platform audit event. Every seed opens
// a new `demo_run` (demo_run_id + fixed business clock) and ends the previous.

import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { and, eq, inArray, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"

import { CAPABILITY_CONTRACTS } from "@/lib/capabilities/catalog.generated"
import { GOVERNANCE } from "@/lib/capabilities/governance"
import { parseCsv } from "@/lib/csv"
import { BUSINESS_AS_OF, DEMO_SEED_VERSION } from "@/lib/demo"
import { fixtureUuid } from "@/lib/fixture-ids"
import { syntheticPdf } from "@/lib/synthetic-pdf"
import { jobNumber } from "@/server/calculators"
import * as s from "@/server/db/schema"

import { seedCore1 } from "./extensions/core1"
import { seedCore2 } from "./extensions/core2"
import { seedCore3 } from "./extensions/core3"
import { seedPlatform } from "./extensions/platform"

type Db = PostgresJsDatabase<typeof s>

export const SEED_MODES = ["ready_for_scope_review", "from_intake"] as const
export type SeedMode = (typeof SEED_MODES)[number]

/** Script helper: `--mode=from_intake` (default ready_for_scope_review). */
export function seedModeFromArgv(argv: readonly string[]): SeedMode {
  const arg = argv.find((a) => a.startsWith("--mode="))?.slice("--mode=".length)
  if (!arg) return "ready_for_scope_review"
  if (!(SEED_MODES as readonly string[]).includes(arg)) throw new Error(`Unknown seed mode ${arg}; use ${SEED_MODES.join(" | ")}`)
  return arg as SeedMode
}

const F = fixtureUuid
const RAYO = F("tenant_demo_rayo")
const NORTE = F("tenant_demo_norte")
export const DEMO_TENANTS = { rayo: RAYO, norte: NORTE }

export const DEMO_USERS = [
  { key: "user_demo_owner", name: "Alex Rivera", email: "alex.rivera@rayodesol.example", tenant: RAYO, role: "owner" },
  { key: "user_demo_operator", name: "Sam Cruz", email: "sam.cruz@rayodesol.example", tenant: RAYO, role: "account_manager" },
  { key: "user_demo_finance", name: "Morgan Lee", email: "morgan.lee@rayodesol.example", tenant: RAYO, role: "finance_approver" },
  { key: "user_demo_producer", name: "Taylor Chen", email: "taylor.chen@rayodesol.example", tenant: RAYO, role: "producer" },
  { key: "user_demo_viewer", name: "Jordan Kim", email: "jordan.kim@rayodesol.example", tenant: RAYO, role: "viewer" },
  { key: "user_demo_norte_owner", name: "Casey Martin", email: "casey.martin@nortestudio.example", tenant: NORTE, role: "owner" },
] as const

export const PLATFORM_USERS = [
  { key: "user_demo_platform_operator", name: "Avery Park", email: "avery.park@ageos.example", role: "platform_operator" },
  { key: "user_demo_platform_admin", name: "Jamie Torres", email: "jamie.torres@ageos.example", role: "platform_admin" },
] as const

/**
 * Tenant tables in child → parent order, computed from the live FK graph so
 * tables added by later migrations are always covered by the scoped reset.
 */
async function tenantTablesChildFirst(tx: Parameters<Parameters<Db["transaction"]>[0]>[0]): Promise<string[]> {
  const rows = (await tx.execute(sql`
    select c.relname as table_name,
           coalesce(array_agg(distinct pc.relname) filter (where pc.relname is not null and pc.relname <> c.relname), '{}') as parents
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join information_schema.columns col on col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id'
    left join pg_constraint fk on fk.conrelid = c.oid and fk.contype = 'f'
    left join pg_class pc on pc.oid = fk.confrelid
    where c.relkind = 'r' and c.relname not in ('membership', 'platform_audit_event')
    group by c.relname`)) as unknown as { table_name: string; parents: string[] }[]
  const parents = new Map(rows.map((r) => [r.table_name, new Set(r.parents.filter((p) => rows.some((x) => x.table_name === p)))]))
  // Kahn: emit a table only when no remaining table depends on it (children first).
  const order: string[] = []
  const remaining = new Set(parents.keys())
  while (remaining.size) {
    const leaf = [...remaining].find((t) => ![...remaining].some((o) => o !== t && parents.get(o)!.has(t)))
    if (!leaf) throw new Error("FK cycle among tenant tables")
    order.push(leaf)
    remaining.delete(leaf)
  }
  return order
}

const usd = (major: number) => BigInt(major) * 100n

const DEMO_CONNECTIONS = [
  { tenant: RAYO, provider: "meta_ads", category: "ads", alias: "demo_meta_aurora", scopes: ["ads.read", "ads.manage"] },
  { tenant: RAYO, provider: "google_ads", category: "ads", alias: "demo_google_aurora", scopes: ["ads.read", "ads.manage"] },
  { tenant: RAYO, provider: "tiktok_ads", category: "ads", alias: "demo_tiktok_aurora", scopes: ["ads.read", "ads.manage"] },
  { tenant: RAYO, provider: "dv360_demo", category: "ads", alias: "demo_dv360_aurora", scopes: ["ads.read", "ads.manage"] },
  { tenant: RAYO, provider: "demo_bank", category: "payments", alias: "rayo_operating_demo", scopes: ["payments.read", "payments.initiate"] },
  { tenant: RAYO, provider: "demo_ledger", category: "accounting", alias: "rayo_demo_ledger", scopes: ["ledger.read", "ledger.post"] },
  { tenant: NORTE, provider: "demo_bank", category: "payments", alias: "norte_operating_demo", scopes: ["payments.read", "payments.initiate"] },
] as const

async function store(storageDir: string, tenantId: string, objectId: string, bytes: Uint8Array) {
  const dir = path.resolve(storageDir, tenantId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, objectId), bytes)
  return {
    storageKey: `${tenantId}/${objectId}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  }
}

export async function resetDemoTenants(db: Db, actor: string | null) {
  const demoAgencies = await db
    .select({ id: s.agency.id })
    .from(s.agency)
    .where(sql`${s.agency.demoSeedVersion} like ${DEMO_SEED_VERSION + "%"}`)
  const ids = [...new Set([RAYO, NORTE, ...demoAgencies.map((a) => a.id)])]
  await db.transaction(async (tx) => {
    for (const table of await tenantTablesChildFirst(tx)) {
      await tx.execute(sql`delete from ${sql.identifier(table)} where tenant_id in ${sql`(${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`}`)
    }
    await tx.delete(s.membership).where(inArray(s.membership.tenantId, ids))
    await tx.delete(s.agency).where(inArray(s.agency.id, ids))
    await tx.insert(s.platformAuditEvent).values({
      eventType: "demo.reset",
      actorUserId: actor,
      payload: { tenants: ids.length, seedVersion: DEMO_SEED_VERSION },
    })
  })
  return ids.length
}

export type SeedResult =
  | { seeded: false }
  | {
      seeded: true
      tenants: string[]
      mode: SeedMode
      demoRunId: string
      tenantsReset: number
      /** from_intake only: extensions that could not seed without the primary job (rolled back to a savepoint). */
      skippedExtensions: { name: string; error: string }[]
    }

export async function seedDemo(
  db: Db,
  opts: { storageDir: string; reset: boolean; mode?: SeedMode; actor?: string | null }
): Promise<SeedResult> {
  const mode: SeedMode = opts.mode ?? "ready_for_scope_review"
  const intake = mode === "from_intake"
  const [existing] = await db.select({ id: s.agency.id }).from(s.agency).where(eq(s.agency.id, RAYO))
  if (existing && !opts.reset) return { seeded: false as const }
  const tenantsReset = existing ? await resetDemoTenants(db, opts.actor ?? null) : 0
  const skippedExtensions: { name: string; error: string }[] = []

  // ── Users (global, upserted so existing sessions stay valid) ──
  for (const u of DEMO_USERS) {
    await db
      .insert(s.appUser)
      .values({ id: F(u.key), fixtureKey: u.key, displayName: u.name, email: u.email, kind: "agency", demoPersona: true })
      .onConflictDoUpdate({ target: s.appUser.id, set: { displayName: u.name, email: u.email } })
  }
  for (const u of PLATFORM_USERS) {
    await db
      .insert(s.appUser)
      .values({ id: F(u.key), fixtureKey: u.key, displayName: u.name, email: u.email, kind: "platform", platformRole: u.role, demoPersona: true })
      .onConflictDoUpdate({ target: s.appUser.id, set: { displayName: u.name, email: u.email, platformRole: u.role } })
  }
  const owner = F("user_demo_owner")
  const operator = F("user_demo_operator")
  const finance = F("user_demo_finance")
  const norteOwner = F("user_demo_norte_owner")

  // ── Capability catalog ──
  for (const c of CAPABILITY_CONTRACTS) {
    await db
      .insert(s.capabilityDefinition)
      .values({
        skillId: c.skillId,
        moduleKey: c.moduleKey,
        actionId: c.actionId,
        specialistKey: c.specialistKey,
        handlerVersion: "chassis-1",
        dependencies: [...(GOVERNANCE[c.skillId]?.dependsOn ?? [])],
        calculatorDependencies: [...c.calculatorDependencies],
      })
      .onConflictDoUpdate({
        target: s.capabilityDefinition.skillId,
        set: { dependencies: [...(GOVERNANCE[c.skillId]?.dependsOn ?? [])] },
      })
  }
  const allSkills = CAPABILITY_CONTRACTS.map((c) => c.skillId)

  await db.transaction(async (tx) => {
    // ── Agencies + memberships ──
    await tx.insert(s.agency).values([
      {
        id: RAYO,
        fixtureKey: "tenant_demo_rayo",
        slug: "rayo-de-sol",
        name: "Rayo de Sol",
        appName: "Estudio Solar",
        status: "ready",
        baseCurrency: "USD",
        timezone: "America/Mexico_City",
        locale: "en",
        requestedDomain: "estudio.rayodesol.example",
        domainState: "pending_dns",
        demoSeedVersion: DEMO_SEED_VERSION,
        createdBy: owner,
      },
      {
        id: NORTE,
        fixtureKey: "tenant_demo_norte",
        slug: "norte-studio",
        name: "Norte Studio",
        appName: "Norte Workspace",
        status: "ready",
        baseCurrency: "CAD",
        timezone: "America/Toronto",
        locale: "en",
        demoSeedVersion: DEMO_SEED_VERSION,
        createdBy: norteOwner,
      },
    ])
    for (const u of DEMO_USERS) {
      await tx.insert(s.membership).values({ userId: F(u.key), tenantId: u.tenant, role: u.role })
    }

    // ── Legal entities + published configuration r1 ──
    await tx.insert(s.legalEntity).values([
      { id: F("le_rayo"), tenantId: RAYO, name: "Rayo de Sol Demo Entity", country: "US", currency: "USD", fiscalProfileId: "DEMO_NO_TAX" },
      { id: F("le_norte"), tenantId: NORTE, name: "Norte Studio Demo Entity", country: "CA", currency: "CAD", fiscalProfileId: "DEMO_NO_TAX" },
    ])
    const config = (tenant: string, key: string, name: string, appName: string, currency: string, accent: string, logoText: string, slug: string) => ({
      id: F(key),
      tenantId: tenant,
      number: 1,
      state: "ready",
      schemaVersion: "ageos-config@1",
      // Shapes match the wizard step schemas (server/domain/configuration.ts).
      agencyProfile: {
        name,
        appName,
        country: tenant === RAYO ? "US" : "CA",
        legalEntityName: tenant === RAYO ? "Rayo de Sol Demo Entity" : "Norte Studio Demo Entity",
        baseCurrency: currency,
        timezone: tenant === RAYO ? "America/Mexico_City" : "America/Toronto",
        services: ["creative", "production", "media"],
        region: tenant === RAYO ? "US" : "CAN",
      },
      operations: {
        profile: "full_service",
        feeType: "fixed_fee",
        budget: { requireApprovedBudget: true, marginFloorBps: 4000 },
        approvalOwners: { budget: "finance_approver", payments: "finance_approver", configuration: "owner" },
      },
      connections: {
        mode: "simulated",
        accounts: DEMO_CONNECTIONS.filter((c) => c.tenant === tenant).map((c) => ({ provider: c.provider, accountAlias: c.alias, scopes: c.scopes })),
      },
      brandAccess: {
        accent,
        logoText,
        appSlug: slug,
        members: [],
        customDomain: tenant === RAYO ? "estudio.rayodesol.example" : null,
        demoPath: `/a/${slug}`,
      },
      enabledCapabilities: allSkills,
      approvalPolicy: { feeAmendment: "finance_approver", clientAuthority: ["owner", "finance_approver"], selfApproval: false },
      limits: { storageMb: 100, filesPerJob: 50, assistantRunsPerHour: 120 },
      lastCompletedStep: 5,
      createdBy: tenant === RAYO ? owner : norteOwner,
      approvedBy: tenant === RAYO ? owner : norteOwner,
      publishedAt: new Date(),
    })
    await tx.insert(s.configurationRevision).values([
      config(RAYO, "config_rayo_r1", "Rayo de Sol", "Estudio Solar", "USD", "#c2410c", "ES", "rayo-de-sol"),
      config(NORTE, "config_norte_r1", "Norte Studio", "Norte Workspace", "CAD", "#0f766e", "NW", "norte-studio"),
    ])
    await tx.update(s.agency).set({ publishedConfigRevisionId: F("config_rayo_r1") }).where(eq(s.agency.id, RAYO))
    await tx.update(s.agency).set({ publishedConfigRevisionId: F("config_norte_r1") }).where(eq(s.agency.id, NORTE))

    // ── Simulated connections ──
    await tx.insert(s.connection).values(
      DEMO_CONNECTIONS.map((c) => ({
        id: F(`connection_${c.alias}`),
        tenantId: c.tenant,
        provider: c.provider,
        category: c.category,
        mode: "simulated",
        accountAlias: c.alias,
        scopes: [...c.scopes],
        state: "connected_demo",
        ownerUserId: c.tenant === RAYO ? owner : norteOwner,
      }))
    )

    // ── Clients, brief, supplier ──
    // from_intake: the Aurora client and brief arise through the intake command.
    await tx.insert(s.client).values([
      ...(intake ? [] : [{ id: F("client_demo_aurora"), tenantId: RAYO, fixtureKey: "client_demo_aurora", legalEntityId: F("le_rayo"), name: "Aurora Beverages", code: "AUR", productCode: "SL", billingCurrency: "USD", creditLimitMinor: usd(60000), country: "US", fiscalProfile: "DEMO_NO_TAX", ownerUserId: operator, createdBy: operator, updatedBy: operator }]),
      { id: F("client_demo_lab"), tenantId: RAYO, fixtureKey: "client_demo_lab", legalEntityId: F("le_rayo"), name: "Feature Lab (demo-lab)", code: "LAB", productCode: "XX", billingCurrency: "USD", creditLimitMinor: usd(5000), country: "US", fiscalProfile: "DEMO_NO_TAX", ownerUserId: operator, createdBy: operator, updatedBy: operator },
      { id: F("client_demo_norte"), tenantId: NORTE, fixtureKey: "client_demo_norte", legalEntityId: F("le_norte"), name: "Maple Fictional Foods", code: "MAP", productCode: "FF", billingCurrency: "CAD", creditLimitMinor: BigInt(2000000), country: "CA", fiscalProfile: "DEMO_NO_TAX", ownerUserId: norteOwner, createdBy: norteOwner, updatedBy: norteOwner },
    ])
    await tx.insert(s.supplier).values({ id: F("supplier_demo_lumen"), tenantId: RAYO, fixtureKey: "supplier_demo_lumen", name: "Lumen Production Demo", country: "US", currency: "USD", createdBy: operator })

    // ── Files + evidence (synthetic PDFs and the platform CSV) ──
    const files: { key: string; tenant: string; name: string; format: string; mime: string; bytes: Uint8Array; job?: string; title: string; kind: string; review: string }[] = [
      { key: "evidence_demo_brief", tenant: RAYO, name: "aurora-creative-brief.pdf", format: "pdf", mime: "application/pdf", job: "job_demo_aurora", title: "Aurora creative brief", kind: "brief", review: "reviewed", bytes: syntheticPdf(["DEMO - SYNTHETIC DOCUMENT", "Aurora Beverages - Spring Launch creative brief", "Fictional client and data for the AgeOS demo."]) },
      { key: "evidence_demo_po_r1", tenant: RAYO, name: "aurora-po-r1-50000.pdf", format: "pdf", mime: "application/pdf", job: "job_demo_aurora", title: "Aurora approved authority 50,000", kind: "client_po", review: "reviewed", bytes: syntheticPdf(["DEMO - SYNTHETIC DOCUMENT", "Purchase order PO-AUR-2027-01 revision 1", "Authorized amount: USD 50,000.00", "Not a real commercial document."]) },
      { key: "evidence_demo_po_r2", tenant: RAYO, name: "aurora-po-r2-53000.pdf", format: "pdf", mime: "application/pdf", job: "job_demo_aurora", title: "Aurora amendment authority 53,000", kind: "client_po", review: "received", bytes: syntheticPdf(["DEMO - SYNTHETIC DOCUMENT", "Purchase order PO-AUR-2027-01 revision 2", "Authorized amount: USD 53,000.00", "Not a real commercial document."]) },
      { key: "evidence_demo_aurora_acceptance", tenant: RAYO, name: "aurora-accepted-delivery.pdf", format: "pdf", mime: "application/pdf", job: "job_demo_aurora", title: "Aurora accepted delivery", kind: "acceptance", review: "received", bytes: syntheticPdf(["DEMO - SYNTHETIC DOCUMENT", "Aurora Beverages - accepted delivery note", "Fictional acceptance for the demo scenario."]) },
      { key: "evidence_demo_norte_private", tenant: NORTE, name: "norte-private-brief.pdf", format: "pdf", mime: "application/pdf", job: "job_demo_norte", title: "Norte private brief", kind: "brief", review: "reviewed", bytes: syntheticPdf(["DEMO - SYNTHETIC DOCUMENT", "Norte Studio private brief", "Must never be visible from Rayo de Sol."]) },
      { key: "file_demo_media_orders_csv", tenant: RAYO, name: "demo-media-orders.csv", format: "csv", mime: "text/csv", title: "Demo media orders import", kind: "import", review: "received", bytes: new TextEncoder().encode("order_id;channel;amount_minor;currency;job_reference;service_date\nDEMO-ORD-01;meta;1000000;USD;AURSL7AF0001;2027-03-20\n") },
    ]
    for (const f of files) {
      const id = F(f.key)
      const stored = await store(opts.storageDir, f.tenant, id, f.bytes)
      await tx.insert(s.fileObject).values({
        id,
        tenantId: f.tenant,
        fixtureKey: f.key,
        logicalId: id,
        version: 1,
        // from_intake: documents exist in the library; linking them to the job is a user step.
        jobId: f.job && !(intake && f.job === "job_demo_aurora") ? F(f.job) : null,
        originalName: f.name,
        format: f.format,
        mimeType: f.mime,
        sizeBytes: stored.size,
        sha256: stored.sha256,
        storageKey: stored.storageKey,
        extractionStatus: f.format === "csv" ? "not_analyzed" : "prepared_demo_extraction",
        extraction: f.format === "pdf" ? { label: "Prepared demo extraction", fields: { title: f.title } } : null,
        synthetic: "fixture",
        uploadedBy: f.tenant === RAYO ? operator : norteOwner,
      })
      if (f.kind !== "import") {
        await tx.insert(s.evidence).values({ id: F(`ev:${f.key}`), tenantId: f.tenant, fixtureKey: f.key, kind: f.kind, title: f.title, fileId: id, reviewState: f.review, reviewedBy: f.review === "reviewed" ? owner : null })
      }
    }
    if (!intake) await tx.insert(s.brief).values({ id: F("brief_demo_aurora"), tenantId: RAYO, clientId: F("client_demo_aurora"), title: "Aurora Spring Launch brief", summary: "Launch the fictional Aurora sparkling line in spring 2027 across digital, CTV, radio and OOH.", services: ["creative", "production", "media"], evidenceId: F("ev:evidence_demo_brief"), createdBy: operator, updatedBy: operator })

    // ── Jobs ──
    const mkJob = (key: string, tenant: string, clientKey: string, name: string, ref: string, codes: { client: string; product: string }, currency: string, ownerId: string, group = "primary") => {
      const jn = jobNumber({ clientCode: codes.client, productCode: codes.product, year: 2027, jobType: "A", billingCode: "F", sequence: 1 })
      return { id: F(key), tenantId: tenant, fixtureKey: key, clientId: F(clientKey), name, jobNumber: jn.code, displayReference: ref, jobType: "A", billingCode: "F", year: 2027, sequence: 1, state: "in_progress", ownerUserId: ownerId, period: "2027-03", currency, services: ["creative", "production", "media"], reportingGroup: group, createdBy: ownerId, updatedBy: ownerId }
    }
    await tx.insert(s.job).values([
      ...(intake ? [] : [mkJob("job_demo_aurora", RAYO, "client_demo_aurora", "Aurora Spring Launch", "RDS-2027-001", { client: "AUR", product: "SL" }, "USD", operator)]),
      mkJob("job_demo_lab", RAYO, "client_demo_lab", "Secondary feature laboratory", "RDS-2027-002", { client: "LAB", product: "XX" }, "USD", operator, "demo-lab"),
      mkJob("job_demo_norte", NORTE, "client_demo_norte", "Private Norte launch", "NS-2027-001", { client: "MAP", product: "FF" }, "CAD", norteOwner),
    ])

    // ── Client authority (PO) r1, budgets, cost estimates ──
    const now = new Date()
    await tx.insert(s.contract).values([
      ...(intake ? [] : [{ id: F("contract_aurora_po_r1"), tenantId: RAYO, clientId: F("client_demo_aurora"), jobId: F("job_demo_aurora"), kind: "client_po", reference: "PO-AUR-2027-01", revisionNumber: 1, amountMinor: usd(50000), currency: "USD", state: "approved", evidenceId: F("ev:evidence_demo_po_r1"), validFrom: "2027-03-01", validTo: "2027-06-30", approvedBy: owner, approvedAt: now, createdBy: operator, updatedBy: operator }]),
      { id: F("contract_lab_po_r1"), tenantId: RAYO, clientId: F("client_demo_lab"), jobId: F("job_demo_lab"), kind: "client_po", reference: "PO-LAB-2027-01", revisionNumber: 1, amountMinor: usd(1000), currency: "USD", state: "approved", validFrom: "2027-03-01", validTo: "2027-12-31", approvedBy: owner, approvedAt: now, createdBy: operator, updatedBy: operator },
      { id: F("contract_norte_po_r1"), tenantId: NORTE, clientId: F("client_demo_norte"), jobId: F("job_demo_norte"), kind: "client_po", reference: "PO-MAP-2027-01", revisionNumber: 1, amountMinor: BigInt(990000), currency: "CAD", state: "approved", approvedBy: norteOwner, approvedAt: now, createdBy: norteOwner, updatedBy: norteOwner },
    ])
    await tx.insert(s.budgetRevision).values([
      ...(intake ? [] : [{ id: F("budget_aurora_r1"), tenantId: RAYO, jobId: F("job_demo_aurora"), number: 1, state: "approved", agencyFeeMinor: usd(20000), managedMediaMinor: usd(30000), currency: "USD", reason: "Initial approved scope", approvedBy: owner, approvedAt: now, createdBy: operator, updatedBy: operator }]),
      { id: F("budget_lab_r1"), tenantId: RAYO, jobId: F("job_demo_lab"), number: 1, state: "approved", agencyFeeMinor: usd(1000), managedMediaMinor: 0n, currency: "USD", reason: "Lab exercise", approvedBy: owner, approvedAt: now, createdBy: operator, updatedBy: operator },
      { id: F("budget_norte_r1"), tenantId: NORTE, jobId: F("job_demo_norte"), number: 1, state: "approved", agencyFeeMinor: BigInt(990000), managedMediaMinor: 0n, currency: "CAD", approvedBy: norteOwner, approvedAt: now, createdBy: norteOwner, updatedBy: norteOwner },
    ])
    await tx.insert(s.costEstimate).values([
      ...(intake ? [] : [{ id: F("estimate_aurora_r1"), tenantId: RAYO, jobId: F("job_demo_aurora"), number: 1, state: "current", reason: "Initial plan: 100h labor", currency: "USD", createdBy: operator, updatedBy: operator }]),
      { id: F("estimate_norte_r1"), tenantId: NORTE, jobId: F("job_demo_norte"), number: 1, state: "current", reason: "Initial plan", currency: "CAD", createdBy: norteOwner, updatedBy: norteOwner },
    ])
    await tx.insert(s.costEstimateLine).values([
      ...(intake ? [] : [{ tenantId: RAYO, estimateId: F("estimate_aurora_r1"), lineType: "labor", description: "Agency labor", minutes: 6000, hourlyCostMinor: usd(50), amountMinor: usd(5000), currency: "USD" },
      { tenantId: RAYO, estimateId: F("estimate_aurora_r1"), lineType: "production", description: "Production vendor (Lumen Production Demo)", amountMinor: usd(5500), currency: "USD", supplierId: F("supplier_demo_lumen") },
      { tenantId: RAYO, estimateId: F("estimate_aurora_r1"), lineType: "expense", description: "Expenses", amountMinor: usd(500), currency: "USD" }]),
      { tenantId: NORTE, estimateId: F("estimate_norte_r1"), lineType: "labor", description: "Agency labor", minutes: 3000, hourlyCostMinor: BigInt(6000), amountMinor: BigInt(300000), currency: "CAD" },
    ])

    // ── Media plan r1 (approved, USD 30,000 across six channels) ──
    if (!intake) await tx.insert(s.mediaPlanRevision).values({ id: F("plan_aurora_r1"), tenantId: RAYO, jobId: F("job_demo_aurora"), number: 1, state: "approved", totalMinor: usd(30000), currency: "USD", objective: "Launch awareness and trial", approvedBy: owner, createdBy: operator, updatedBy: operator })
    const lines = [
      { key: "line_meta", channel: "meta", placement: "Demo Feed", provider: "meta_ads", amount: 10000, account: "demo_meta_aurora" },
      { key: "line_google", channel: "google", placement: "Demo Search", provider: "google_ads", amount: 8000, account: "demo_google_aurora" },
      { key: "line_tiktok", channel: "tiktok", placement: "Demo In-feed", provider: "tiktok_ads", amount: 4000, account: "demo_tiktok_aurora" },
      { key: "line_ctv", channel: "ctv", placement: "Fictional CTV inventory", provider: "dv360_demo", amount: 4000, account: "demo_dv360_aurora" },
      { key: "line_radio", channel: "radio", placement: "Fictional City Radio", provider: "offline_file_demo", amount: 2000, quantity: 20, unit: 100 },
      { key: "line_ooh", channel: "ooh", placement: "Fictional Station Faces A/B", provider: "offline_file_demo", amount: 2000, quantity: 2, unit: 1000 },
    ]
    if (!intake) await tx.insert(s.mediaPlanLine).values(
      lines.map((l) => ({
        tenantId: RAYO,
        planRevisionId: F("plan_aurora_r1"),
        lineKey: l.key,
        channel: l.channel,
        placement: l.placement,
        provider: l.provider,
        accountAlias: l.account ?? null,
        quantity: l.quantity ?? null,
        unitCostMinor: l.unit ? usd(l.unit) : null,
        amountMinor: usd(l.amount),
        currency: "USD",
        startDate: "2027-03-16",
        endDate: "2027-03-31",
      }))
    )

    // ── Platform operations incident (real parser evidence) ──
    const csv = new TextDecoder().decode(files.find((f) => f.key === "file_demo_media_orders_csv")!.bytes)
    const expected = ["order_id", "channel", "amount_minor", "currency", "job_reference", "service_date"]
    const parsed = parseCsv(csv, ",")
    await tx.insert(s.importProfile).values({ id: F("import_profile_demo_media_orders"), tenantId: RAYO, profileKey: "import_profile_demo_media_orders", delimiter: ",", expectedHeaders: expected, profileRevision: 1 })
    await tx.insert(s.importProfileRevision).values({ tenantId: RAYO, profileId: F("import_profile_demo_media_orders"), profileRevision: 1, delimiter: ",", expectedHeaders: expected, diff: { origin: "seed" } })
    // Published jobs import profile (Jobs → Import jobs; server/domain/job-import.ts).
    const jobHeaders = ["client_code", "job_name", "job_type", "billing_code", "period"]
    await tx.insert(s.importProfile).values({ id: F("import_profile_jobs"), tenantId: RAYO, profileKey: "import_profile_jobs", delimiter: ",", expectedHeaders: jobHeaders, profileRevision: 1 })
    await tx.insert(s.importProfileRevision).values({ tenantId: RAYO, profileId: F("import_profile_jobs"), profileRevision: 1, delimiter: ",", expectedHeaders: jobHeaders, diff: { origin: "seed" } })
    await tx.insert(s.platformIncident).values({
      id: F("ops_csv_delimiter_mismatch"),
      tenantId: RAYO,
      incidentKey: "ops_csv_delimiter_mismatch",
      state: "detected",
      title: { en: "Media order import parses 1 column instead of 6", es: "La importación de órdenes lee 1 columna en vez de 6" },
      fileId: F("file_demo_media_orders_csv"),
      profileId: F("import_profile_demo_media_orders"),
      evidence: {
        parser: "lib/csv.parseCsv",
        delimiter: ",",
        observedColumns: parsed.headers.length,
        expectedColumns: expected.length,
        expectedHeaders: expected,
        fileSha256: createHash("sha256").update(csv).digest("hex"),
      },
    })

    // ── Seed history as audit events (origin=seed) ──
    const ev = (tenant: string, eventType: string, aggregateType: string, aggregateId: string, jobKey: string | null, actor: string, payload: Record<string, unknown>) => ({
      tenantId: tenant,
      eventType,
      aggregateType,
      aggregateId,
      jobId: jobKey ? F(jobKey) : null,
      actorUserId: actor,
      origin: "seed",
      payload: { ...payload, seedVersion: DEMO_SEED_VERSION, checkpoint: mode },
      businessEffectiveAt: new Date("2027-03-01T15:00:00Z"),
    })
    await tx.insert(s.businessEvent).values([
      ...(intake ? [] : [
      ev(RAYO, "client.intake_created", "client", F("client_demo_aurora"), null, operator, { code: "AUR" }),
      ev(RAYO, "job.opened", "job", F("job_demo_aurora"), "job_demo_aurora", operator, { jobNumber: "AURSL7AF0001", displayReference: "RDS-2027-001" }),
      ev(RAYO, "contract.client_authority.approved", "contract", F("contract_aurora_po_r1"), "job_demo_aurora", owner, { amountMinor: "5000000", currency: "USD", reference: "PO-AUR-2027-01", revisionNumber: 1 }),
      ev(RAYO, "budget.approved", "job", F("job_demo_aurora"), "job_demo_aurora", owner, { budgetRevision: 1, agencyFeeMinor: "2000000", managedMediaMinor: "3000000" }),
      ev(RAYO, "cost_estimate.recorded", "job", F("job_demo_aurora"), "job_demo_aurora", operator, { number: 1, laborMinutes: 6000, totalMinor: "1100000" }),
      ev(RAYO, "media_plan.approved", "job", F("job_demo_aurora"), "job_demo_aurora", owner, { planRevision: 1, totalMinor: "3000000" })]),
      ev(NORTE, "job.opened", "job", F("job_demo_norte"), "job_demo_norte", norteOwner, { jobNumber: "MAPFF7AF0001" }),
    ])

    // `mode` travels with the ids so extensions can skip journey rows in from_intake
    // (request: add `mode: SeedMode` to SeedIds in extensions/types.ts).
    const ids = { F, RAYO, NORTE, owner, operator, finance, producer: F("user_demo_producer"), viewer: F("user_demo_viewer"), norteOwner, storageDir: opts.storageDir, mode }
    await seedPlatform(tx, ids)
    const extensions = [
      ["core1", seedCore1],
      ["core2", seedCore2],
      ["core3", seedCore3],
    ] as const
    for (const [name, run] of extensions) {
      if (!intake) {
        await run(tx, ids)
        continue
      }
      // from_intake: an extension that still needs the primary job is rolled
      // back to its savepoint and reported (never silently half-seeded).
      try {
        await tx.transaction((sp) => run(sp, ids))
      } catch (e) {
        skippedExtensions.push({ name, error: e instanceof Error ? e.message.slice(0, 300) : String(e) })
      }
    }
  })

  // ── Demo run: new demo_run_id + fixed business clock; previous run ends ──
  const demoRunId = await db.transaction(async (tx) => {
    await tx
      .update(s.demoRun)
      .set({ state: "ended", endedAt: new Date(), endedReason: tenantsReset ? "reset" : "superseded" })
      .where(eq(s.demoRun.state, "active"))
    const [run] = await tx
      .insert(s.demoRun)
      .values({ seedVersion: DEMO_SEED_VERSION, checkpoint: mode, businessDate: BUSINESS_AS_OF, tenantIds: [RAYO, NORTE], startedBy: opts.actor ?? null })
      .returning({ id: s.demoRun.id })
    await tx.insert(s.platformAuditEvent).values({
      eventType: "demo.run_started",
      actorUserId: opts.actor ?? null,
      payload: { demoRunId: run!.id, checkpoint: mode, seedVersion: DEMO_SEED_VERSION, skippedExtensions },
    })
    return run!.id
  })

  return { seeded: true as const, tenants: [RAYO, NORTE], mode, demoRunId, tenantsReset, skippedExtensions }
}

export async function seedSummary(db: Db) {
  const [jobs] = await db.select({ n: sql<number>`count(*)::int` }).from(s.job).where(inArray(s.job.tenantId, [RAYO, NORTE]))
  const [users] = await db.select({ n: sql<number>`count(*)::int` }).from(s.appUser).where(and(eq(s.appUser.demoPersona, true)))
  return { jobs: jobs!.n, users: users!.n }
}
