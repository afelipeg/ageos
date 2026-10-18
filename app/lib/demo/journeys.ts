// Typed catalog of the ten product journeys J01–J10 (demo-scenarios-v1.json
// `journeys`, 08-instruccion-2 "Recorridos obligatorios"). Shared by the
// presenter launcher (Screens builds the UI) and QA E2E. Pure data: no server
// imports, no fixture UUIDs (entity params are fixture keys resolved on the
// server with fixtureUuid). Steps name the route or assistant preset that
// performs them; expected results restate the spec, never invented figures.

import { CAPABILITY_CONTRACTS } from "@/lib/capabilities/catalog.generated"

export type Localized = { readonly en: string; readonly es: string }
export type JourneyId = "J01" | "J02" | "J03" | "J04" | "J05" | "J06" | "J07" | "J08" | "J09" | "J10"
export type DemoCheckpoint = "from_intake" | "ready_for_scope_review"

/** Synthetic personas (demo-fixtures.json users + platform_users). */
export type JourneyActor =
  | "user_demo_owner"
  | "user_demo_operator"
  | "user_demo_finance"
  | "user_demo_producer"
  | "user_demo_viewer"
  | "user_demo_norte_owner"
  | "user_demo_platform_operator"
  | "user_demo_platform_admin"

/** Where a path parameter comes from when the launcher builds a link. */
export type ParamSource =
  | { readonly literal: string }
  /** Fixture key (e.g. job_demo_aurora) → fixtureUuid on the server. */
  | { readonly fixture: string }
  /** Produced by an earlier step of the same run (draftId, runId, changeId…). */
  | { readonly runtime: RuntimeParam }

export type RuntimeParam =
  | "draftId"
  | "runId"
  | "agencyId"
  | "agencySlug"
  | "changeId"
  | "approvalId"
  | "fileId"
  | "connectionId"
  | "clientId"
  | "jobId"
  /** A value an earlier step captured from its output (see JourneyStep.captures). */
  | `capture:${string}`

export type JourneySurface =
  | { readonly kind: "route"; readonly routeId: string; readonly path: string; readonly params?: Readonly<Record<string, ParamSource>> }
  | { readonly kind: "assistant"; readonly presetId: string; readonly path: string; readonly params?: Readonly<Record<string, ParamSource>> }

/**
 * Expected class of a server outcome: persisted without an approval, persisted
 * awaiting an approval, or blocked by the named rule (details.rule or code).
 * Omitted on a workbench step = persisted (with or without an approval).
 */
export type JourneyOutcome = "succeeded" | "pending_approval" | { readonly blocked: string }

export type JourneyStep = {
  readonly id: string
  readonly actor: JourneyActor
  readonly label: Localized
  readonly surface: JourneySurface
  /** Server service/command (or capability skill id) that performs the step. */
  readonly performs: string
  readonly expected: Localized
  /**
   * Workbench inputs keyed by the skill's field keys (lib/capabilities/input-fields.ts).
   * Sent as `f.<field>` query params; fixture keys stay keys and resolve on the
   * server inside the tenant. Values come from demo-fixtures.json / the seed
   * (Aurora) or the skill's positive fixture (demo-lab). Record commands,
   * presenter controls and previews use the same map for their form fields.
   * A literal "" clears an editable example.
   */
  readonly inputs?: Readonly<Record<string, ParamSource>>
  readonly outcome?: JourneyOutcome
  /** Runtime values this step's persisted output provides to later steps: capture key → output path (`a.b`, `items[category=media].paymentId`). */
  readonly captures?: Readonly<Record<`capture:${string}`, string>>
}

export type Journey = {
  readonly id: JourneyId
  readonly name: Localized
  readonly moduleKeys: readonly string[]
  /** Checkpoint to load before starting (null = any; the journey does not depend on job state). */
  readonly entryCheckpoint: DemoCheckpoint | null
  /** Journeys whose committed results this one continues in the same demo run. */
  readonly continues: readonly JourneyId[]
  readonly actor: JourneyActor
  readonly steps: readonly JourneyStep[]
  readonly expectedResult: Localized
  readonly source: string
}

const RAYO = { agencySlug: { literal: "rayo-de-sol" } } as const
const AURORA_JOB = { ...RAYO, jobId: { fixture: "job_demo_aurora" } } as const

function wb(skillId: string): JourneySurface {
  const c = CAPABILITY_CONTRACTS.find((x) => x.skillId === skillId)
  if (!c) throw new Error(`Unknown capability ${skillId}`)
  return {
    kind: "route",
    routeId: "workflow-workbench",
    path: "/a/:agencySlug/modules/:moduleKey/workflows/:skillId",
    params: { ...RAYO, moduleKey: { literal: c.moduleKey }, skillId: { literal: skillId } },
  }
}

const route = (routeId: string, path: string, params?: Record<string, ParamSource>): JourneySurface => ({ kind: "route", routeId, path, params })
const preset = (presetId: string, path = "/a/:agencySlug/assistant", params: Record<string, ParamSource> = RAYO): JourneySurface => ({ kind: "assistant", presetId, path, params })

type StepExtra = { inputs?: Record<string, ParamSource>; outcome?: JourneyOutcome; captures?: Record<`capture:${string}`, string> }
const step = (id: string, actor: JourneyActor, surface: JourneySurface, performs: string, label: Localized, expected: Localized, extra: StepExtra = {}): JourneyStep => ({ id, actor, surface, performs, label, expected, ...extra })

// Input helpers: plain strings are literals (money as decimal strings).
const fx = (fixture: string): ParamSource => ({ fixture })
const rt = (runtime: RuntimeParam): ParamSource => ({ runtime })
const I = (o: Record<string, string | ParamSource>): Record<string, ParamSource> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? { literal: v } : v]))
const pending = { outcome: "pending_approval" } as const
const blocked = (rule: string) => ({ outcome: { blocked: rule } }) as const

const AURORA = fx("job_demo_aurora")
const LAB = fx("job_demo_lab")
const LAB_OPS = fx("job_demo_lab_ops")
// Aurora demo connections carry the same key convention as the demo-lab ones
// (connection_<accountAlias>); the workbench drops a key whose id is not an
// authorized connection of the tenant.
const AURORA_META = fx("connection_demo_meta_aurora")
const RAYO_BANK = fx("connection_rayo_operating_demo")

// Screens other than the workbench that perform steps.
const record = (recordType: string, recordId: ParamSource) => route("business-record", "/a/:agencySlug/records/:recordType/:recordId", { ...RAYO, recordType: { literal: recordType }, recordId })
const desk = (moduleKey: string) => route("module-desk", "/a/:agencySlug/modules/:moduleKey", { ...RAYO, moduleKey: { literal: moduleKey } })
const approvalDetail = () => route("approval-detail", "/a/:agencySlug/approvals/:approvalId", { ...RAYO, approvalId: { runtime: "approvalId" } })
const presenterControls = () => route("presenter-controls", "/demo/presenter")
const connectionDetail = (connectionId: ParamSource) => route("connection-detail", "/a/:agencySlug/connections/:connectionId", { ...RAYO, connectionId })
const fileDetail = (fileKey: string) => route("file-detail", "/a/:agencySlug/library/:fileId", { ...RAYO, fileId: fx(fileKey) })
const L = (en: string, es: string): Localized => ({ en, es })

// J03: the six Aurora media orders after reallocation r2 (demo-fixtures media_plan_lines.after_reallocation_minor).
const MEDIA_ORDERS = [
  { channel: "meta", supplier: "supplier_demo_meta_ads", connection: "connection_demo_meta_aurora", amount: "9000.00", label: "9,000" },
  { channel: "google", supplier: "supplier_demo_google_ads", connection: "connection_demo_google_aurora", amount: "9000.00", label: "9,000" },
  { channel: "tiktok", supplier: "supplier_demo_tiktok_ads", connection: "connection_demo_tiktok_aurora", amount: "4000.00", label: "4,000" },
  { channel: "ctv", supplier: "supplier_demo_dv360", connection: "connection_demo_dv360_aurora", amount: "4000.00", label: "4,000" },
  { channel: "radio", supplier: "supplier_demo_city_radio", connection: null, amount: "2000.00", label: "2,000" },
  { channel: "ooh", supplier: "supplier_demo_ooh_operator", connection: null, amount: "2000.00", label: "2,000" },
] as const

// J05: the USD 43,000 batch (payment_funding_policy) on the Rayo operating account; supplier invoices are due 2027-04-21.
const PAYMENT_BATCH = I({ connection: RAYO_BANK, paymentDate: "2027-03-24", dueThrough: "2027-04-30", paymentMethod: "bank_transfer", batchAmount: "43000.00" })

// J06: demo-lab jobs whose March items the close checklist lists as unrecognized.
const LAB_RECOGNITION: readonly string[] = []

/**
 * J10 inputs: the values of each skill's positive fixture
 * (server/capabilities/handlers/*.ts) that exist on a fresh seed. Fixtures
 * that create their own preconditions (fresh jobs, recognized liabilities,
 * statements) point at the seeded demo-lab records instead.
 */
const J10_INPUTS: Record<string, Record<string, ParamSource>> = {
  "agency-orchestrator": I({ job: LAB }),
  "agency-integrations": I({ action: "connect", provider: "google_ads", accountAlias: "demo_lab_google" }),
  "agency-access-governance": I({ member: fx("user_demo_lab_member"), proposedRole: "producer", effectiveScope: "assigned_jobs", expenseApprovalCap: "500.00", reason: "Lab member joins production for the demo-lab exercise." }),
  "agency-master-data": I({ recordType: "supplier", code: "LUM", legalName: "Lumen Production Demo", country: "US", externalMapping: "demo_ledger:LUM" }),
  "agency-onboarding": I({ clientName: "Feature Lab (demo-lab)", clientCode: "LAB", productCode: "XX", billingCurrency: "USD", country: "US", briefTitle: "Lab intake brief", briefSummary: "Secondary intake exercise for the demo-lab client." }),
  "agency-job-lifecycle": I({ action: "open", client: fx("client_demo_lab"), jobName: "Lab job lifecycle exercise", jobType: "A", billingCode: "F", period: "2027-03" }),
  "agency-contract-po": I({ job: LAB, reference: "PO-LAB-2027-02", amount: "1000.00", validFrom: "2027-03-01", validTo: "2027-12-31", billingRoute: "holder_client", evidenceId: fx("ev:evidence_demo_c1_lab_po") }),
  "agency-budget-control": I({ job: LAB, budgetScope: "client_commercial_authority", amount: "700.00", purpose: "Fixture reservation" }),
  "agency-fee-contracts": I({ job: fx("job_demo_lab_fee"), newAgencyFee: "1200.00", reason: "Lab scope adds approved hours." }),
  "agency-billing-requirements": I({ job: fx("job_demo_lab_billing"), deliverableAccepted: "true", poNumber: "PO-LAB-BILL-01", acceptanceEvidence: fx("ev:evidence_demo_c1_lab_acceptance") }),
  "agency-tasks-timesheets": I({ job: LAB_OPS, taskTitle: "Lab creative rework", member: fx("user_demo_producer"), workDate: "2027-03-18", minutes: "8400", hourlyCost: "50.00", notes: "demo-lab hours" }),
  "agency-production-estimating": I({ job: LAB_OPS, laborMinutes: "6000", hourlyCost: "50.00", productionVendorAmount: "5500.00", expenseAmount: "500.00", reason: "demo-lab estimate: 100h, vendor quote and expenses" }),
  "agency-production": I({ job: LAB_OPS, deliverable: "Lab hero proof", deliveryDate: "2027-03-22", assetFile: fx("file_demo_lab_asset"), rightsCleared: "true", qualityResult: "passed", qcNotes: "Specs and legal lines checked (demo-lab)." }),
  "agency-media-ranking": I({ job: LAB_OPS, objective: "reach", market: "US", targetAudience: "Adults 25-44, urban", flightStart: "2027-03-16", flightEnd: "2027-03-31", reachWeightBps: "6000" }),
  "agency-media-planning": I({ job: LAB_OPS, channel: "ooh", placement: "Fictional Station Faces A/B", plannedAmount: "2500.00", flightStart: "2027-03-16", flightEnd: "2027-03-31", audience: "Adults 25-44, urban" }),
  "agency-tv-radio-planning": I({ job: LAB_OPS, medium: "radio", station: "Fictional City Radio", spotCount: "20", spotDurationSeconds: "30", unitCost: "100.00", flightStart: "2027-03-16", flightEnd: "2027-03-31" }),
  "agency-ooh-planning": I({ job: LAB_OPS, site: "Fictional Station Faces A/B", faces: "2", unitRate: "1000.00", flightStart: "2027-03-10", flightEnd: "2027-03-24", evidenceType: "photo" }),
  "agency-digital-planning": I({ job: LAB_OPS, connection: fx("connection_demo_meta_labops"), objective: "conversions", budget: "5000.00", placement: "Demo Feed", conversionEvent: "purchase_demo", creativeFile: fx("file_demo_lab_creative") }),
  "agency-plan-changes": I({ job: LAB_OPS, baseRevision: "1", channel: "meta", newAmount: "4000.00", offsetChannel: "google", reasonCategory: "market_change", reason: "Move 1,000 from Meta to Google search (demo-lab)." }),
  "agency-rate-cards-contracts": I({ supplier: fx("supplier_demo_digital_network"), medium: "digital", validFrom: "2027-03-01", validTo: "2027-12-31", grossRate: "1000.00", firstDiscountBps: "1000", secondDiscountBps: "500" }),
  "agency-media-buying": I({ job: LAB_OPS, supplier: fx("supplier_demo_meta_ads"), channel: "meta", planRevision: "1", orderAmount: "10.00", poNumber: "PO-LAB-OPS-2027-01", connection: fx("connection_demo_meta_labops") }),
  "agency-campaign-activation": I({ job: LAB_OPS, connection: fx("connection_demo_meta_labops"), planRevision: "1", creativeFile: fx("file_demo_lab_creative"), rightsCleared: "true", landingUrl: "https://lab.example/spring", conversionEvent: "purchase_demo" }),
  "agency-campaign-optimization": I({ job: LAB_OPS, objective: "conversions", metricsFile: fx("file_demo_lab_metrics_csv"), metricsAsOf: "2027-03-15", maxShiftBps: "2000" }),
  "agency-transmission-control": I({ job: LAB_OPS, station: "Fictional City Radio", orderedSpots: "20", monitoringFile: fx("file_demo_lab_emissions_csv"), toleranceSpots: "0", requestMakeGood: "true" }),
  // First free week of face_demo_c from 2027-06-01 on a fresh seed (the fixture's freeWindow).
  "agency-ooh-inventory": I({ job: LAB_OPS, action: "reserve", face: "face_demo_c", startDate: "2027-06-01", endDate: "2027-06-07", operator: fx("supplier_demo_ooh_operator") }),
  "agency-delivery-reconciliation": I({ job: LAB, supplier: fx("supplier_demo_lab_vendor"), invoiceNumber: "LAB-SUP-RECON", invoiceAmount: "1000.00", tolerance: "0.00" }),
  "agency-payables": I({ supplier: fx("supplier_demo_lab_vendor"), job: LAB, invoiceNumber: "LAB-SUP-RECON", invoiceDate: "2027-03-12", dueDate: "2027-04-11", invoiceAmount: "1000.00", period: "2027-03" }),
  // The fixture batches the recognized lab liabilities it prepares itself; on a
  // fresh seed nothing is due yet, so no batch amount is prefilled.
  "agency-payment-run": I({ connection: fx("connection_rayo_lab_demo"), paymentDate: "2027-03-20", dueThrough: "2027-03-31", paymentMethod: "bank_transfer" }),
  // Statement exported in J10.29a; closing balance = the lab account's confirmed opening USD 5,000 (seed).
  "agency-cash-settlement": I({ connection: fx("connection_rayo_lab_demo"), statementFile: rt("capture:statement.lab"), statementDate: "2027-03-31", closingBalance: "5000.00" }),
  "agency-expenses": I({ job: LAB, claimant: fx("user_demo_producer"), receipt: fx("file_demo_lab_expense_receipt"), expenseDate: "2027-03-12", amount: "25.00", category: "travel", description: "Lab taxi" }),
  "agency-client-billing": I({ job: LAB, invoiceDate: "2027-03-20", feeAmount: "1.00", mediaRecoveryAmount: "0.00", notes: "Lab billing exercise" }),
  "agency-collections": I({ job: LAB, receiptAmount: "1.00", receiptDate: "2027-03-21" }),
  "agency-rebates": I({ job: LAB, supplier: fx("supplier_demo_lab_vendor"), period: "2027-03", eligibleBase: "10000.00", rebateRateBps: "200", clientShareBps: "5000" }),
  "agency-tax-compliance": I({ job: LAB, country: "US", taxProfile: "DEMO_SYNTHETIC_5_PERCENT", taxableBase: "100.00" }),
  "agency-general-ledger": I({ job: LAB, period: "2027-03", businessDate: "2027-03-20", debitAccount: "production_expense", debitAmount: "10.00", creditAccount: "accrued_production", creditAmount: "10.00", memo: "Lab manual accrual" }),
  "agency-accruals-revaluation": I({ adjustmentType: "fx_revaluation", job: LAB, period: "2027-03", amount: "1000.00", foreignCurrency: "CAD", balanceSide: "payable" }),
  "agency-fixed-assets": I({ assetName: "Lab camera kit", cost: "1200.00", residualValue: "0.00", usefulLifeMonths: "12", startDate: "2027-03-01", method: "straight_line", job: LAB }),
  "agency-period-close": I({ period: "2027-01", action: "close", reason: "January has no open items" }),
  "agency-profitability": I({ job: AURORA, basis: "forecast" }),
  "agency-revenue-budget": I({ scenarioName: "Lab upside", client: fx("client_demo_lab"), periodFrom: "2027-01", periodTo: "2027-12", scenarioAmount: "25000.00", allocationDriver: "even_monthly" }),
  // Opening cash = confirmed primary bank cash on 2027-03-15 (demo-fixtures cash_timeline opening 10,000).
  "agency-cash-forecast": I({ openingCash: "10000.00", currency: "USD", asOfDate: "2027-03-15", horizonDays: "90", scenario: "downside", collectionDelayDays: "15" }),
  "agency-management-reporting": I({ period: "2027-03", basis: "incurred", reportTitle: "March 2027 management pack", includeManagedMedia: "true" }),
}

export const JOURNEYS: readonly Journey[] = [
  {
    id: "J01",
    name: { en: "Build and activate an agency", es: "Configurar y activar una agencia" },
    moduleKeys: ["setup"],
    entryCheckpoint: null,
    continues: [],
    actor: "user_demo_owner",
    source: "demo-scenarios-v1.json#/journeys/J01",
    expectedResult: {
      en: "Configuration changes navigation and capabilities; the custom domain is simulated and no real DNS is used.",
      es: "La configuración cambia navegación y capacidades; el dominio propio es simulado y no se usa DNS real.",
    },
    steps: [
      step("J01.1", "user_demo_owner", route("control-agencies", "/control/agencies"), "createAgencyDraft",
        { en: "Create a demo agency draft", es: "Crear un borrador de agencia demo" },
        { en: "One draft; refresh or double submit never creates a second tenant.", es: "Un solo borrador; recargar o repetir no crea otro tenant." }),
      step("J01.2", "user_demo_owner", route("setup-wizard", "/control/setup/:draftId/:step", { draftId: { runtime: "draftId" }, step: { literal: "agency" } }), "saveSetupStep(1)",
        { en: "Agency: name, app name, sample country, currency, timezone, services", es: "Agencia: nombre, nombre de app, país de ejemplo, moneda, zona horaria, servicios" },
        { en: "Step saved on the server; region is a commercial segment, not a tax jurisdiction.", es: "Paso guardado en servidor; la región es segmento comercial, no jurisdicción fiscal." }),
      step("J01.3", "user_demo_owner", route("setup-wizard", "/control/setup/:draftId/:step", { draftId: { runtime: "draftId" }, step: { literal: "operations" } }), "saveSetupStep(2)",
        { en: "Operations: profile, fee type, budget policy, approvers, capabilities", es: "Operación: perfil, tipo de fee, política de presupuesto, aprobadores, capacidades" },
        { en: "Catalog lists 9 modules / 42 capabilities; mandatory controls stay on; dependencies are enforced.", es: "El catálogo lista 9 módulos / 42 capacidades; los controles obligatorios siguen activos; se respetan dependencias." }),
      step("J01.4", "user_demo_owner", route("setup-wizard", "/control/setup/:draftId/:step", { draftId: { runtime: "draftId" }, step: { literal: "connections" } }), "saveSetupStep(3)",
        { en: "Connections: simulated demo accounts and scopes, or start with files", es: "Conexiones: cuentas demo simuladas y permisos, o empezar con archivos" },
        { en: "No OAuth or tokens; flows without an account run in manual/file mode.", es: "Sin OAuth ni tokens; los flujos sin cuenta usan modo manual/archivo." }),
      step("J01.5", "user_demo_owner", route("setup-wizard", "/control/setup/:draftId/:step", { draftId: { runtime: "draftId" }, step: { literal: "brand-access" } }), "saveSetupStep(4)",
        { en: "Brand & access: logo text, accent, slug, sample members, .example domain", es: "Marca y acceso: texto de logo, color, slug, miembros de ejemplo, dominio .example" },
        { en: "Unique slug, accent with ≥4.5:1 contrast, invitations simulated (not sent).", es: "Slug único, color con contraste ≥4.5:1, invitaciones simuladas (no enviadas)." }),
      step("J01.6", "user_demo_owner", route("setup-wizard", "/control/setup/:draftId/:step", { draftId: { runtime: "draftId" }, step: { literal: "review" } }), "validateConfiguration",
        { en: "Review exactly what will be published", es: "Revisar exactamente qué se publicará" },
        { en: "Blockers link to the step to fix; revision number and digest shown.", es: "Los bloqueos enlazan al paso a corregir; se muestran versión y digest." }),
      step("J01.7", "user_demo_owner", route("activation", "/control/activations/:runId", { runId: { runtime: "runId" } }), "startActivation",
        { en: "Deploy demo agency and follow the persisted steps", es: "Desplegar la agencia demo y seguir los pasos persistidos" },
        { en: "validate → workspace → roles → publish → storage → capabilities → access → ready; survives refresh; retry resumes.", es: "validar → espacio → roles → publicar → almacenamiento → capacidades → acceso → listo; sobrevive a recargar; reintentar reanuda." }),
      step("J01.8", "user_demo_owner", route("control-agency", "/control/agencies/:agencyId", { agencyId: { runtime: "agencyId" } }), "simulateDnsVerification",
        { en: "Simulate DNS verification of the requested domain", es: "Simular la verificación DNS del dominio solicitado" },
        { en: "Requested → Pending DNS → Verifying → Simulated ready; labelled simulated.", es: "Solicitado → DNS pendiente → Verificando → Listo simulado; rotulado como simulado." }),
      step("J01.9", "user_demo_owner", route("workspace-home", "/a/:agencySlug", { agencySlug: { runtime: "agencySlug" } }), "resolveAgencyContext",
        { en: "Open the workspace with its identity", es: "Abrir el espacio con su identidad" },
        { en: "Real demo path /a/<slug> with the published app name, accent and capabilities.", es: "Ruta demo real /a/<slug> con nombre de app, color y capacidades publicados." }),
      step("J01.10", "user_demo_operator", route("capabilities", "/a/:agencySlug/capabilities", RAYO), "proposeCapabilityChange",
        { en: "Propose disabling a capability (new configuration revision)", es: "Proponer desactivar una capacidad (nueva revisión de configuración)" },
        { en: "Dependencies and mandatory controls are enforced; the change awaits an owner.", es: "Se aplican dependencias y controles obligatorios; el cambio espera a un owner." }),
      step("J01.11", "user_demo_owner", route("capabilities", "/a/:agencySlug/capabilities", RAYO), "decideCapabilityChange",
        { en: "Owner approves the exact change and publishes it", es: "El owner aprueba el cambio exacto y lo publica" },
        { en: "Requester cannot approve; navigation and capability gates follow the new revision; history kept.", es: "El solicitante no aprueba; navegación y permisos siguen la nueva revisión; se conserva el historial." }),
    ],
  },
  {
    id: "J02",
    name: { en: "Client to production", es: "Cliente a producción" },
    moduleKeys: ["clients-contracts", "work-production"],
    entryCheckpoint: "from_intake",
    continues: [],
    actor: "user_demo_operator",
    source: "demo-scenarios-v1.json#/journeys/J02",
    expectedResult: {
      en: "The job keeps its identity and revisions; it ends where ready_for_scope_review starts: approved authority 50,000, budget fee 20,000 / media 30,000, 100 h forecast, margin 45.0%.",
      es: "El trabajo conserva identidad y revisiones; termina donde empieza ready_for_scope_review: autoridad aprobada 50,000, presupuesto fee 20,000 / medios 30,000, 100 h proyectadas, margen 45.0%.",
    },
    steps: [
      step("J02.1", "user_demo_operator", wb("agency-onboarding"), "agency-onboarding",
        L("Intake the brief and create the client", "Recibir el brief y crear el cliente"),
        L("Aurora Beverages and its brief exist once, linked to the brief document.", "Aurora Beverages y su brief existen una vez, vinculados al documento."),
        { inputs: I({ clientName: "Aurora Beverages", clientCode: "AUR", productCode: "SL", billingCurrency: "USD", country: "US", creditLimit: "60000.00", briefTitle: "Aurora Spring Launch brief", briefSummary: "Launch the fictional Aurora sparkling line in spring 2027 across digital, CTV, radio and OOH." }) }),
      step("J02.2", "user_demo_operator", wb("agency-job-lifecycle"), "agency-job-lifecycle",
        L("Open the job", "Abrir el trabajo"),
        L("JobNumber AURSL7AF0001 assigned once; retry does not duplicate.", "JobNumber AURSL7AF0001 asignado una vez; reintentar no duplica."),
        { inputs: I({ action: "open", client: rt("clientId"), jobName: "Aurora Spring Launch", jobType: "A", billingCode: "F", period: "2027-03" }) }),
      // The PO is recorded on the job (contract-po requires it), so the job opens first
      // and the library documents are linked to it.
      step("J02.3", "user_demo_operator", fileDetail("evidence_demo_po_r1"), "linkFileToJob",
        L("Link the client PO revision 1 document to the job", "Vincular el documento de la PO revisión 1 al trabajo"),
        L("The reviewed PO evidence now belongs to Aurora Beverages and its job.", "La evidencia revisada de la PO pertenece ahora a Aurora Beverages y su trabajo."),
        { inputs: I({ job: rt("jobId") }) }),
      step("J02.4", "user_demo_operator", wb("agency-contract-po"), "agency-contract-po",
        L("Record the client contract / PO with its evidence", "Registrar contrato / PO del cliente con su evidencia"),
        L("Client authority USD 50,000 recorded with reviewed evidence; owner approval separate.", "Autoridad del cliente USD 50,000 registrada con evidencia revisada; aprobación del owner separada."),
        { inputs: I({ job: rt("jobId"), reference: "PO-AUR-2027-01", amount: "50000.00", validFrom: "2027-03-01", validTo: "2027-06-30", billingRoute: "holder_client", evidenceId: fx("ev:evidence_demo_po_r1") }), ...pending }),
      step("J02.5", "user_demo_owner", approvalDetail(), "decideApprovalCommand",
        L("Owner approves the initial client authority", "El owner aprueba la autoridad inicial del cliente"),
        L("Authority USD 50,000 approved by someone other than the requester.", "Autoridad USD 50,000 aprobada por alguien distinto del solicitante.")),
      // Initial budget (Core-1 budget.initial, policy initial-budget-v1): fee 20,000 inside the
      // approved PO 50,000 leaves managed media 30,000; finance approves (not the proposer, not the owner).
      step("J02.6", "user_demo_operator", wb("agency-fee-contracts"), "agency-fee-contracts",
        L("Propose the initial budget", "Proponer el presupuesto inicial"),
        L("Fee USD 20,000 and managed media USD 30,000 from the USD 50,000 authority; awaiting finance.", "Fee USD 20,000 y medios administrados USD 30,000 desde la autoridad de USD 50,000; en espera de finanzas."),
        { inputs: I({ job: rt("jobId"), newAgencyFee: "20000.00", reason: "Initial approved scope" }), ...pending }),
      step("J02.7", "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance approves the initial budget", "Finanzas aprueba el presupuesto inicial"),
        L("Budget revision 1 approved: fee USD 20,000, managed media USD 30,000 kept separate.", "Revisión 1 del presupuesto aprobada: fee USD 20,000, medios administrados USD 30,000 separados.")),
      step("J02.8", "user_demo_operator", wb("agency-budget-control"), "agency-budget-control",
        L("Reserve the managed media budget", "Reservar el presupuesto de medios administrados"),
        L("USD 30,000 reserved against the managed media authority.", "USD 30,000 reservados contra la autoridad de medios administrados."),
        { inputs: I({ job: rt("jobId"), budgetScope: "managed_media_authority", amount: "30000.00", purpose: "Reserve managed media for the spring launch" }) }),
      step("J02.9", "user_demo_operator", wb("agency-production-estimating"), "agency-production-estimating",
        L("Estimate production", "Estimar producción"),
        L("100 h at USD 50, vendor USD 5,500 and expenses USD 500: cost USD 11,000 on the job revision.", "100 h a USD 50, proveedor USD 5,500 y gastos USD 500: costo USD 11,000 en la revisión del trabajo."),
        { inputs: I({ job: rt("jobId"), laborMinutes: "6000", hourlyCost: "50.00", productionVendorAmount: "5500.00", expenseAmount: "500.00", reason: "Initial plan: 100h labor" }) }),
      step("J02.10", "user_demo_producer", wb("agency-tasks-timesheets"), "agency-tasks-timesheets",
        L("Plan tasks and log hours", "Planificar tareas y registrar horas"),
        L("Hours submitted for a manager's approval; only approved hours change labor cost.", "Horas enviadas a aprobación del responsable; solo las horas aprobadas cambian el costo laboral."),
        { inputs: I({ job: rt("jobId"), taskTitle: "Base scope 100h", member: fx("user_demo_producer"), workDate: "2027-03-12", minutes: "6000", hourlyCost: "50.00" }) }),
      step("J02.11", "user_demo_operator", fileDetail("file_demo_aurora_hero_asset"), "linkFileToJob",
        L("Link the hero film proof to the job", "Vincular la prueba del film principal al trabajo"),
        L("The deliverable file is visible from the job dossier.", "El archivo del entregable es visible desde el expediente."),
        { inputs: I({ job: rt("jobId") }) }),
      step("J02.12", "user_demo_producer", wb("agency-production"), "agency-production",
        L("Track production and attach the deliverable evidence", "Seguir producción y adjuntar la evidencia del entregable"),
        L("Deliverable and evidence visible in the job dossier.", "Entregable y evidencia visibles en el expediente."),
        { inputs: I({ job: rt("jobId"), deliverable: "Aurora spring hero film", deliveryDate: "2027-03-22", assetFile: fx("file_demo_aurora_hero_asset"), rightsCleared: "true", qualityResult: "passed" }) }),
      step("J02.13", "user_demo_operator", route("job-dossier", "/a/:agencySlug/jobs/:jobId", { ...RAYO, jobId: rt("jobId") }), "getJobDossier",
        L("Review the job dossier", "Revisar el expediente del trabajo"),
        L("Contract, budget, hours, production and margin connected on one record.", "Contrato, presupuesto, horas, producción y margen conectados en un registro.")),
    ],
  },
  {
    id: "J03",
    name: { en: "Media plan to campaign", es: "Plan de medios a campaña" },
    moduleKeys: ["media-planning", "media-buying"],
    entryCheckpoint: "ready_for_scope_review",
    // demo-fixtures scenario.steps: reallocate media after the approved amendment (J04).
    continues: ["J04"],
    actor: "user_demo_operator",
    source: "demo-scenarios-v1.json#/journeys/J03",
    expectedResult: {
      en: "Media total USD 30,000; approved revision and correct demo account; no external spend.",
      es: "Total de medios USD 30,000; revisión aprobada y cuenta demo correcta; sin gasto externo.",
    },
    steps: [
      step("J03.1", "user_demo_operator", wb("agency-media-ranking"), "agency-media-ranking",
        L("Rank channels with synthetic audiences", "Priorizar canales con audiencias sintéticas"),
        L("Ranking from labelled synthetic audience data.", "Priorización con datos de audiencia sintéticos rotulados."),
        { inputs: I({ job: AURORA, objective: "reach", market: "US", targetAudience: "Adults 25-44, urban", flightStart: "2027-03-16", flightEnd: "2027-03-31", reachWeightBps: "6000" }) }),
      step("J03.2", "user_demo_operator", wb("agency-digital-planning"), "agency-digital-planning",
        L("Plan digital lines and specs", "Planificar líneas digitales y specs"),
        L("Digital lines with complete specs.", "Líneas digitales con specs completas."),
        { inputs: I({ job: AURORA, connection: AURORA_META, objective: "conversions", budget: "10000.00", placement: "Demo Feed", conversionEvent: "purchase_demo", creativeFile: fx("file_demo_aurora_creative_feed") }) }),
      step("J03.3", "user_demo_operator", wb("agency-tv-radio-planning"), "agency-tv-radio-planning",
        L("Plan TV/radio spots", "Planificar spots de TV/radio"),
        L("Radio line 20 × USD 100 on the plan.", "Línea de radio 20 × USD 100 en el plan."),
        { inputs: I({ job: AURORA, medium: "radio", station: "Fictional City Radio", spotCount: "20", spotDurationSeconds: "30", unitCost: "100.00", flightStart: "2027-03-16", flightEnd: "2027-03-31" }) }),
      step("J03.4", "user_demo_operator", wb("agency-ooh-planning"), "agency-ooh-planning",
        L("Plan OOH faces", "Planificar caras OOH"),
        L("OOH line 2 × USD 1,000 on the plan.", "Línea OOH 2 × USD 1,000 en el plan."),
        { inputs: I({ job: AURORA, site: "Fictional Station Faces A/B", faces: "2", unitRate: "1000.00", flightStart: "2027-03-16", flightEnd: "2027-03-31", evidenceType: "photo" }) }),
      step("J03.5", "user_demo_operator", record("media-plan", fx("plan_aurora_r1")), "getRecordDetail",
        L("Review the media plan revision", "Revisar la revisión del plan de medios"),
        L("Plan total USD 30,000 across six channels.", "Total del plan USD 30,000 en seis canales.")),
      step("J03.6", "user_demo_operator", wb("agency-plan-changes"), "agency-plan-changes",
        L("Reallocate media: revise the plan", "Reasignar medios: revisar el plan"),
        L("Revision 2 moves USD 1,000 from Meta to Google; total stays USD 30,000.", "La revisión 2 mueve USD 1,000 de Meta a Google; el total sigue en USD 30,000."),
        { inputs: I({ job: AURORA, baseRevision: "1", channel: "meta", newAmount: "9000.00", offsetChannel: "google", reasonCategory: "market_change", reason: "Move 1,000 from Meta to Google search based on early results." }), ...pending }),
      step("J03.7", "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance approves plan revision 2", "Finanzas aprueba la revisión 2 del plan"),
        L("Revision 2 approved; revision 1 superseded; approvals of the old payload become stale.", "Revisión 2 aprobada; la revisión 1 queda reemplazada; las aprobaciones del payload anterior quedan obsoletas.")),
      ...MEDIA_ORDERS.map((o, i) =>
        step(`J03.${8 + i}`, "user_demo_operator", wb("agency-media-buying"), "agency-media-buying",
          L(`Order the ${o.channel} line from revision 2 (USD ${o.label})`, `Ordenar la línea ${o.channel} desde la revisión 2 (USD ${o.label})`),
          L("Order bound to the approved plan revision; awaiting finance.", "Orden vinculada a la revisión aprobada del plan; en espera de finanzas."),
          { inputs: I({ job: AURORA, supplier: fx(o.supplier), channel: o.channel, planRevision: "2", orderAmount: o.amount, poNumber: "PO-AUR-2027-01", ...(o.connection ? { connection: fx(o.connection) } : {}) }), ...pending, captures: { [`capture:order.${o.channel}`]: "orderId" } })
      ),
      step("J03.14", "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance approves the six media orders", "Finanzas aprueba las seis órdenes de medios"),
        L("Each order executes once through the simulated adapter (sim_* receipt or offline send pack).", "Cada orden se ejecuta una vez por el adaptador simulado (recibo sim_* o paquete de envío offline).")),
      step("J03.15", "user_demo_operator", wb("agency-campaign-activation"), "agency-campaign-activation",
        L("Activate the demo campaign", "Activar la campaña demo"),
        L("Simulated activation on revision 2 and the demo Meta account; awaiting finance.", "Activación simulada sobre la revisión 2 y la cuenta demo de Meta; en espera de finanzas."),
        { inputs: I({ job: AURORA, connection: AURORA_META, planRevision: "2", creativeFile: fx("file_demo_aurora_creative_feed"), rightsCleared: "true", landingUrl: "https://aurora.example/spring", conversionEvent: "purchase_demo" }), ...pending }),
      step("J03.16", "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance approves the activation", "Finanzas aprueba la activación"),
        L("Simulated campaign with a sim_* receipt; no real spend.", "Campaña simulada con recibo sim_*; sin gasto real.")),
      step("J03.17", "user_demo_operator", wb("agency-transmission-control"), "agency-transmission-control",
        L("Check delivery / transmission", "Revisar entrega / emisión"),
        L("20 of 20 radio spots confirmed against the schedule; ready to close.", "20 de 20 spots de radio confirmados contra la pauta; listo para cerrar."),
        { inputs: I({ job: AURORA, station: "Fictional City Radio", orderedSpots: "20", monitoringFile: fx("file_demo_aurora_monitoring_csv"), toleranceSpots: "0", requestMakeGood: "true" }) }),
      ...MEDIA_ORDERS.map((o, i) =>
        step(`J03.${18 + i}`, "user_demo_operator", record("media-order", rt(`capture:order.${o.channel}`)), "media.acceptDelivery",
          L(`Accept the ${o.channel} delivery (USD ${o.label})`, `Aceptar la entrega ${o.channel} (USD ${o.label})`),
          L("Accepted delivery consumes the order commitment once (order → delivery is one cost).", "La entrega aceptada consume el compromiso de la orden una sola vez (orden → entrega es un costo)."),
          { inputs: I({ acceptedAmount: o.amount, businessDate: "2027-03-22" }) })
      ),
      step("J03.24", "user_demo_operator", wb("agency-campaign-optimization"), "agency-campaign-optimization",
        L("Optimize from simulated metrics", "Optimizar con métricas simuladas"),
        L("USD 1,000 Meta → Google recommended, pending approval; not applied automatically.", "USD 1,000 de Meta → Google recomendado, pendiente de aprobación; no se aplica automáticamente."),
        { inputs: I({ job: AURORA, objective: "conversions", metricsFile: fx("file_demo_aurora_metrics_csv"), metricsAsOf: "2027-03-15", maxShiftBps: "1000" }), ...pending }),
    ],
  },
  {
    id: "J04",
    name: { en: "Scope change protects margin", es: "El cambio de alcance protege el margen" },
    moduleKeys: ["clients-contracts", "work-production", "profitability"],
    entryCheckpoint: "ready_for_scope_review",
    continues: [],
    actor: "user_demo_operator",
    source: "demo-scenarios-v1.json#/journeys/J04",
    expectedResult: {
      en: "45.0% → 35.0% → 43.5%; fee 20k → 23k; cost 11k → 13k; media 30k kept separate.",
      es: "45.0% → 35.0% → 43.5%; fee 20k → 23k; costo 11k → 13k; medios 30k separados.",
    },
    steps: [
      step("J04.1", "user_demo_operator", route("job-dossier", "/a/:agencySlug/jobs/:jobId", AURORA_JOB), "getJobDossier",
        { en: "Open Aurora Spring Launch at the initial plan", es: "Abrir Aurora Spring Launch en el plan inicial" },
        { en: "Fee USD 20,000, cost USD 11,000, margin 45.0%.", es: "Fee USD 20,000, costo USD 11,000, margen 45.0%." }),
      step("J04.2", "user_demo_operator", wb("agency-production-estimating"), "recordCostEstimate",
        { en: "Record the 40 additional hours", es: "Registrar las 40 horas adicionales" },
        { en: "Cost USD 13,000; margin 35.0% below the 40% floor.", es: "Costo USD 13,000; margen 35.0% bajo el piso de 40%." },
        { inputs: I({ job: AURORA, laborMinutes: "8400", hourlyCost: "50.00", productionVendorAmount: "5500.00", expenseAmount: "500.00", reason: "Scope change adds 40 hours" }) }),
      step("J04.3", "user_demo_operator", preset("preset.margin.aurora", "/a/:agencySlug/jobs/:jobId", AURORA_JOB), "preset.margin.aurora",
        { en: "Ask the assistant why the margin fell", es: "Preguntar al asistente por qué bajó el margen" },
        { en: "Scripted answer cites the persisted records; labelled scripted demo.", es: "Respuesta guionada que cita los registros persistidos; rotulada como demo guionada." }),
      step("J04.4", "user_demo_operator", wb("agency-fee-contracts"), "proposeFeeAmendment",
        { en: "Propose the USD 3,000 fee amendment", es: "Proponer la enmienda de fee de USD 3,000" },
        { en: "Proposal awaiting finance approval; no financial effect yet.", es: "Propuesta en espera de aprobación de finanzas; sin efecto financiero aún." },
        { inputs: I({ job: AURORA, newAgencyFee: "23000.00", reason: "Scope change adds 40 hours of creative rework." }), ...pending }),
      step("J04.5", "user_demo_owner", route("business-record", "/a/:agencySlug/records/:recordType/:recordId", { ...RAYO, recordType: { literal: "evidence" }, recordId: { fixture: "ev:evidence_demo_po_r2" } }), "reviewEvidence",
        { en: "Owner reviews the client PO revision 2 evidence", es: "El owner revisa la evidencia de la PO revisión 2 del cliente" },
        { en: "Reviewed by someone other than its submitter; the review pins the exact file version and hash.", es: "Revisada por alguien distinto de quien la aportó; la revisión fija la versión y el hash exactos del archivo." }),
      step("J04.6", "user_demo_operator", wb("agency-contract-po"), "recordClientAuthority",
        { en: "Record client PO revision 2 (USD 53,000) with its evidence", es: "Registrar la PO revisión 2 del cliente (USD 53,000) con su evidencia" },
        { en: "Client authority is a separate fact from internal approval.", es: "La autoridad del cliente es un hecho distinto de la aprobación interna." },
        { inputs: I({ job: AURORA, reference: "PO-AUR-2027-01", amount: "53000.00", validFrom: "2027-03-01", validTo: "2027-06-30", billingRoute: "holder_client", evidenceId: fx("ev:evidence_demo_po_r2") }), ...pending }),
      step("J04.7", "user_demo_finance", route("approval-detail", "/a/:agencySlug/approvals/:approvalId", { ...RAYO, approvalId: { runtime: "approvalId" } }), "decideApprovalCommand",
        { en: "Finance approves the exact payload", es: "Finanzas aprueba el payload exacto" },
        { en: "Requester cannot self-approve; approval bound to the digest and revision.", es: "El solicitante no puede autoaprobar; aprobación ligada a digest y revisión." }),
      step("J04.8", "user_demo_operator", route("job-dossier", "/a/:agencySlug/jobs/:jobId", AURORA_JOB), "getJobDossier",
        { en: "Return to the job", es: "Volver al trabajo" },
        { en: "Fee USD 23,000, cost USD 13,000, margin USD 10,000 · 43.5%; media USD 30,000 separate.", es: "Fee USD 23,000, costo USD 13,000, margen USD 10,000 · 43.5%; medios USD 30,000 separados." }),
    ],
  },
  {
    id: "J05",
    name: { en: "Supplier reconciliation and payment", es: "Conciliación de proveedor y pago" },
    moduleKeys: ["suppliers-payments", "billing-collections"],
    entryCheckpoint: "ready_for_scope_review",
    continues: ["J03"],
    actor: "user_demo_finance",
    source: "demo-scenarios-v1.json#/journeys/J05",
    expectedResult: {
      en: "No overdraft: cash 10k + 53k − 43k = 20k. Order/delivery/invoice/payment never duplicate costs.",
      es: "Sin sobregiro: caja 10k + 53k − 43k = 20k. Orden/entrega/factura/pago no duplican costos.",
    },
    steps: [
      step("J05.1", "user_demo_operator", desk("work-production"), "production.issueProductionOrder",
        L("Issue the Lumen production order USD 5,500", "Emitir la orden de producción a Lumen USD 5,500"),
        L("Order against the agency cost authority, linked to the estimate.", "Orden contra la autoridad de costo de la agencia, vinculada a la estimación."),
        { inputs: I({ job: AURORA, supplier: fx("supplier_demo_lumen"), amount: "5500.00", deliverable: "Aurora spring hero film" }) }),
      step("J05.2", "user_demo_operator", wb("agency-production"), "agency-production",
        L("Accept the production delivery", "Aceptar la entrega de producción"),
        L("Delivery USD 5,500 accepted against the order; rights and QA recorded.", "Entrega USD 5,500 aceptada contra la orden; derechos y QA registrados."),
        { inputs: I({ job: AURORA, deliverable: "Aurora spring hero film", deliveryDate: "2027-03-22", assetFile: fx("file_demo_aurora_hero_asset"), rightsCleared: "true", qualityResult: "passed" }) }),
      step("J05.3", "user_demo_producer", wb("agency-tasks-timesheets"), "agency-tasks-timesheets",
        L("Log the base 100 hours", "Registrar las 100 horas base"),
        L("Timesheet submitted for a manager's approval.", "Hoja de horas enviada a aprobación del responsable."),
        { inputs: I({ job: AURORA, taskTitle: "Base scope 100h", member: fx("user_demo_producer"), workDate: "2027-03-12", minutes: "6000", hourlyCost: "50.00" }), captures: { "capture:timesheet.base": "timesheetId" } }),
      step("J05.4", "user_demo_producer", wb("agency-tasks-timesheets"), "agency-tasks-timesheets",
        L("Log the 40 scope-change hours", "Registrar las 40 horas del cambio de alcance"),
        L("Timesheet submitted for a manager's approval.", "Hoja de horas enviada a aprobación del responsable."),
        { inputs: I({ job: AURORA, taskTitle: "Scope change 40h", member: fx("user_demo_producer"), workDate: "2027-03-19", minutes: "2400", hourlyCost: "50.00" }), captures: { "capture:timesheet.scope": "timesheetId" } }),
      step("J05.5", "user_demo_operator", record("timesheet", rt("capture:timesheet.base")), "time.decideTimesheet",
        L("Approve the base hours", "Aprobar las horas base"),
        L("100 h approved by a manager other than the worker.", "100 h aprobadas por un responsable distinto de quien trabajó.")),
      step("J05.6", "user_demo_operator", record("timesheet", rt("capture:timesheet.scope")), "time.decideTimesheet",
        L("Approve the scope-change hours", "Aprobar las horas del cambio de alcance"),
        L("140 h approved at USD 50 = USD 7,000, valued once.", "140 h aprobadas a USD 50 = USD 7,000, valoradas una vez.")),
      step("J05.7", "user_demo_producer", wb("agency-expenses"), "agency-expenses",
        L("Submit the USD 500 production expense", "Enviar el gasto de producción de USD 500"),
        L("Receipt verified; awaiting finance.", "Recibo verificado; en espera de finanzas."),
        { inputs: I({ job: AURORA, claimant: fx("user_demo_producer"), receipt: fx("file_demo_aurora_expense_receipt"), expenseDate: "2027-03-18", amount: "500.00", category: "production_supplies", description: "Props for the hero film shoot" }), ...pending }),
      step("J05.8", "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance approves the expense", "Finanzas aprueba el gasto"),
        L("Approved by someone other than the submitter.", "Aprobado por alguien distinto de quien lo envió.")),
      step("J05.9", "user_demo_owner", wb("agency-delivery-reconciliation"), "agency-delivery-reconciliation",
        L("Match supplier invoice USD 6,000 against delivery USD 5,500", "Conciliar factura de proveedor USD 6,000 contra entrega USD 5,500"),
        L("Invoice held: amount differs from the accepted delivery.", "Factura retenida: el importe difiere de la entrega aceptada."),
        { inputs: I({ job: AURORA, supplier: fx("supplier_demo_lumen"), invoiceNumber: "DEMO-LUM-031", invoiceAmount: "6000.00", tolerance: "0.00" }) }),
      step("J05.10", "user_demo_owner", wb("agency-delivery-reconciliation"), "agency-delivery-reconciliation",
        L("Record the corrected supplier invoice USD 5,500", "Registrar la factura corregida del proveedor USD 5,500"),
        L("Same invoice corrected and matched to the accepted delivery; no new cost.", "La misma factura corregida y conciliada con la entrega aceptada; sin costo nuevo."),
        { inputs: I({ job: AURORA, supplier: fx("supplier_demo_lumen"), invoiceNumber: "DEMO-LUM-031", invoiceAmount: "5500.00", tolerance: "0.00" }) }),
      step("J05.11", "user_demo_owner", wb("agency-payables"), "agency-payables",
        L("Make the corrected invoice payable", "Dejar pagable la factura corregida"),
        L("One payable of USD 5,500; no duplicate cost; awaiting finance.", "Una cuenta por pagar de USD 5,500; sin costo duplicado; en espera de finanzas."),
        { inputs: I({ supplier: fx("supplier_demo_lumen"), job: AURORA, invoiceNumber: "DEMO-LUM-031", invoiceDate: "2027-03-22", dueDate: "2027-04-21", invoiceAmount: "5500.00", period: "2027-03" }), ...pending }),
      step("J05.12", "user_demo_owner", wb("agency-payables"), "agency-payables",
        L("Register the managed media invoice USD 30,000", "Registrar la factura de medios administrados USD 30,000"),
        L("Matched to the accepted media deliveries; awaiting finance.", "Conciliada con las entregas de medios aceptadas; en espera de finanzas."),
        { inputs: I({ supplier: fx("supplier_demo_media_network"), job: AURORA, invoiceNumber: "DEMO-MEDIA-AUR-03", invoiceDate: "2027-03-22", dueDate: "2027-04-21", invoiceAmount: "30000.00", period: "2027-03" }), ...pending }),
      step("J05.13", "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance approves both supplier invoices", "Finanzas aprueba las dos facturas de proveedor"),
        L("Payables USD 5,500 and USD 30,000; the preparer cannot approve.", "Cuentas por pagar USD 5,500 y USD 30,000; quien prepara no aprueba.")),
      step("J05.14", "user_demo_owner", record("evidence", fx("ev:evidence_demo_aurora_acceptance")), "reviewEvidence",
        L("Owner reviews the client acceptance evidence", "El owner revisa la evidencia de aceptación del cliente"),
        L("Accepted delivery reviewed; fee recognition may proceed.", "Entrega aceptada revisada; el reconocimiento del fee puede proceder.")),
      step("J05.15", "user_demo_owner", wb("agency-accruals-revaluation"), "agency-accruals-revaluation",
        L("Recognize the accepted fee and costs", "Reconocer el fee aceptado y los costos"),
        L("Recognition run prepared by the owner; awaiting finance.", "Corrida de reconocimiento preparada por el owner; en espera de finanzas."),
        { inputs: I({ adjustmentType: "accrual", job: AURORA, period: "2027-03", amount: "", foreignCurrency: "", balanceSide: "", previousRate: "", closingRate: "" }), ...pending }),
      step("J05.16", "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance posts the recognition run", "Finanzas contabiliza la corrida de reconocimiento"),
        L("Labor, production, expense, media and fee journals posted once; incurred margin 43.5%.", "Asientos de mano de obra, producción, gasto, medios y fee contabilizados una vez; margen incurrido 43.5%.")),
      step("J05.17", "user_demo_operator", wb("agency-billing-requirements"), "agency-billing-requirements",
        L("Check the billing requirements", "Verificar los requisitos de facturación"),
        L("PO revision 2 and the reviewed acceptance evidence linked; issuance ready.", "PO revisión 2 y la evidencia de aceptación revisada vinculadas; emisión lista."),
        { inputs: I({ job: AURORA, deliverableAccepted: "true", poNumber: "PO-AUR-2027-01", acceptanceEvidence: fx("ev:evidence_demo_aurora_acceptance") }) }),
      step("J05.18", "user_demo_operator", wb("agency-client-billing"), "agency-client-billing",
        L("Issue the demo client invoice USD 53,000", "Emitir la factura demo al cliente USD 53,000"),
        L("Fee USD 23,000 + media recovery USD 30,000; demo issuance, no tax filing; awaiting finance.", "Fee USD 23,000 + recuperación de medios USD 30,000; emisión demo, sin timbrado fiscal; en espera de finanzas."),
        { inputs: I({ job: AURORA, invoiceDate: "2027-03-22", feeAmount: "23000.00", mediaRecoveryAmount: "30000.00", poNumber: "PO-AUR-2027-01" }), ...pending }),
      step("J05.19", "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance approves the client invoice", "Finanzas aprueba la factura al cliente"),
        L("DEMO-INV-0001 issued; cash USD 10,000, receivable USD 53,000.", "DEMO-INV-0001 emitida; caja USD 10,000, cartera USD 53,000.")),
      step("J05.20", "user_demo_owner", wb("agency-payment-run"), "agency-payment-run",
        L("Try to pay USD 43,000 before collecting", "Intentar pagar USD 43,000 antes de cobrar"),
        L("Blocked: insufficient funds (cash USD 10,000).", "Bloqueado: fondos insuficientes (caja USD 10,000)."),
        { inputs: PAYMENT_BATCH, ...blocked("insufficient_funds") }),
      step("J05.21", "user_demo_finance", wb("agency-collections"), "agency-collections",
        L("Collect USD 40,000", "Cobrar USD 40,000"),
        L("Cash USD 50,000; receivable USD 13,000.", "Caja USD 50,000; cartera USD 13,000."),
        { inputs: I({ job: AURORA, invoiceNumber: "DEMO-INV-0001", receiptAmount: "40000.00", receiptDate: "2027-03-23", receiptReference: "sim_receipt_collection_demo_first" }) }),
      step("J05.22", "user_demo_owner", desk("suppliers-payments"), "previewPaymentRun",
        L("Preview the funds for USD 43,000 of payments", "Previsualizar fondos para USD 43,000 en pagos"),
        L("Media 30,000, production 5,500, expense 500, payroll 7,000 = USD 43,000 against confirmed cash USD 50,000.", "Medios 30,000, producción 5,500, gasto 500, nómina 7,000 = USD 43,000 frente a caja confirmada USD 50,000."),
        { inputs: I({ connection: RAYO_BANK, dueThrough: "2027-04-30" }) }),
      step("J05.23", "user_demo_owner", wb("agency-payment-run"), "agency-payment-run",
        L("Prepare the payment batch", "Preparar el lote de pagos"),
        L("Batch USD 43,000 prepared by the owner; awaiting finance.", "Lote USD 43,000 preparado por el owner; en espera de finanzas."),
        { inputs: PAYMENT_BATCH, ...pending, captures: { "capture:batch": "batchId", ...Object.fromEntries(["media", "production", "expense", "payroll"].map((c) => [`capture:payment.${c}`, `payment_list_proposal.items[category=${c}].paymentId`])) } }),
      step("J05.24", "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance approves the batch", "Finanzas aprueba el lote"),
        L("Funds reserved atomically; available cash USD 7,000.", "Fondos reservados de forma atómica; caja disponible USD 7,000.")),
      step("J05.25", "user_demo_finance", record("payment-run", rt("capture:batch")), "payments.executePayment",
        L("Pay the media invoice USD 30,000", "Pagar la factura de medios USD 30,000"),
        L("Paid once with a sim_* receipt; cash USD 20,000.", "Pagada una vez con recibo sim_*; caja USD 20,000."),
        { inputs: I({ paymentId: rt("capture:payment.media") }) }),
      step("J05.26", "user_demo_owner", presenterControls(), "queueSimulationOutcome",
        L("Presenter: the next demo-bank payment times out after its effect", "Presentador: el próximo pago del banco demo vence tras su efecto"),
        L("Outcome queued for the next simulated payment.", "Resultado en cola para el próximo pago simulado."),
        { inputs: I({ provider: "demo_bank", operationType: "payment.execute", failureMode: "timeout_after_effect" }) }),
      step("J05.27", "user_demo_finance", record("payment-run", rt("capture:batch")), "payments.executePayment",
        L("Pay the production invoice USD 5,500", "Pagar la factura de producción USD 5,500"),
        L("Outcome unknown: the hold stays until reconciliation; no second effect.", "Resultado incierto: la reserva se mantiene hasta conciliar; sin segundo efecto."),
        { inputs: I({ paymentId: rt("capture:payment.production") }) }),
      step("J05.28", "user_demo_finance", record("payment-run", rt("capture:batch")), "payments.reconcilePayment",
        L("Reconcile the production payment with the provider", "Conciliar el pago de producción con el proveedor"),
        L("Existing receipt found: one provider effect; cash USD 14,500.", "Recibo existente encontrado: un efecto del proveedor; caja USD 14,500."),
        { inputs: I({ paymentId: rt("capture:payment.production") }) }),
      step("J05.29", "user_demo_finance", record("payment-run", rt("capture:batch")), "payments.executePayment",
        L("Reimburse the USD 500 expense", "Reembolsar el gasto de USD 500"),
        L("Settles the expense already recognized; cash USD 14,000.", "Liquida el gasto ya reconocido; caja USD 14,000."),
        { inputs: I({ paymentId: rt("capture:payment.expense") }) }),
      step("J05.30", "user_demo_finance", record("payment-run", rt("capture:batch")), "payments.executePayment",
        L("Settle payroll USD 7,000", "Liquidar la nómina USD 7,000"),
        L("Settles labor already recognized; cash USD 7,000.", "Liquida la mano de obra ya reconocida; caja USD 7,000."),
        { inputs: I({ paymentId: rt("capture:payment.payroll") }) }),
      step("J05.31", "user_demo_finance", wb("agency-collections"), "agency-collections",
        L("Collect the remaining USD 13,000", "Cobrar los USD 13,000 restantes"),
        L("Cash USD 20,000; receivable zero.", "Caja USD 20,000; cartera cero."),
        { inputs: I({ job: AURORA, invoiceNumber: "DEMO-INV-0001", receiptAmount: "13000.00", receiptDate: "2027-03-27", receiptReference: "sim_receipt_collection_demo_final" }) }),
      step("J05.32", "user_demo_owner", connectionDetail(RAYO_BANK), "cash.exportDemoBankStatement",
        L("Export the demo bank statement", "Exportar el extracto del banco demo"),
        L("Synthetic statement file of the operating account.", "Archivo de extracto sintético de la cuenta operativa."),
        { inputs: I({ statementDate: "2027-03-31" }), captures: { "capture:statement.file": "fileId" } }),
      step("J05.33", "user_demo_owner", wb("agency-cash-settlement"), "agency-cash-settlement",
        L("Settle cash and reconcile", "Liquidar caja y conciliar"),
        L("Statement and book balance agree at USD 20,000; cash settlement distinct from expense recognition.", "Extracto y saldo en libros coinciden en USD 20,000; liquidación de caja distinta del reconocimiento de gasto."),
        { inputs: I({ connection: RAYO_BANK, statementFile: rt("capture:statement.file"), statementDate: "2027-03-31", closingBalance: "20000.00" }) }),
    ],
  },
  {
    id: "J06",
    name: { en: "Accounting close and reporting", es: "Cierre contable y reportes" },
    moduleKeys: ["accounting-close", "profitability", "billing-collections"],
    entryCheckpoint: "ready_for_scope_review",
    continues: ["J05"],
    actor: "user_demo_finance",
    source: "demo-scenarios-v1.json#/journeys/J06",
    expectedResult: {
      en: "15 primary journals balanced and the exact final balance; jurisdiction and tax types are demo.",
      es: "15 asientos principales equilibrados y saldo final exacto; jurisdicción y tipos fiscales son demo.",
    },
    steps: [
      step("J06.1", "user_demo_owner", wb("agency-general-ledger"), "agency-general-ledger",
        L("Prepare a balanced journal (demo-lab)", "Preparar un asiento cuadrado (demo-lab)"),
        L("Debit equals credit; prepared by one actor, posted by another.", "Debe igual a haber; preparado por un actor y contabilizado por otro."),
        { inputs: J10_INPUTS["agency-general-ledger"], ...pending }),
      step("J06.2", "user_demo_owner", wb("agency-accruals-revaluation"), "agency-accruals-revaluation",
        L("Accruals and FX revaluation (demo-lab)", "Provisiones y revaluación cambiaria (demo-lab)"),
        L("Secondary cases stay out of Aurora KPIs.", "Los casos secundarios no afectan los KPIs de Aurora."),
        { inputs: J10_INPUTS["agency-accruals-revaluation"], ...pending }),
      step("J06.3", "user_demo_owner", wb("agency-fixed-assets"), "agency-fixed-assets",
        L("Fixed asset depreciation (demo-lab)", "Depreciación de activo fijo (demo-lab)"),
        L("Depreciation schedule on the demo-lab asset.", "Calendario de depreciación del activo demo-lab."),
        { inputs: J10_INPUTS["agency-fixed-assets"], ...pending }),
      step("J06.4", "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance posts the demo-lab entries", "Finanzas contabiliza los asientos demo-lab"),
        L("Every journal balances; the preparer cannot post.", "Cada asiento cuadra; quien prepara no contabiliza.")),
      step("J06.5", "user_demo_finance", wb("agency-period-close"), "agency-period-close",
        L("Run the close checklist for March 2027", "Ejecutar el checklist de cierre de marzo 2027"),
        L("Open items are listed with their records; nothing closes yet.", "Las partidas abiertas se listan con sus registros; aún no se cierra nada."),
        { inputs: I({ period: "2027-03", action: "check_readiness" }) }),
      ...LAB_RECOGNITION.map((jobKey, i) =>
        step(`J06.${6 + i}`, "user_demo_owner", wb("agency-accruals-revaluation"), "agency-accruals-revaluation",
          L(`Recognize the pending demo-lab items (${jobKey})`, `Reconocer las partidas demo-lab pendientes (${jobKey})`),
          L("Recognition run for the secondary job; awaiting finance.", "Corrida de reconocimiento del trabajo secundario; en espera de finanzas."),
          { inputs: I({ adjustmentType: "accrual", job: fx(jobKey), period: "2027-03", amount: "", foreignCurrency: "", balanceSide: "", previousRate: "", closingRate: "" }), ...pending })
      ),
      step(`J06.${6 + LAB_RECOGNITION.length}`, "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance posts the demo-lab recognitions", "Finanzas contabiliza los reconocimientos demo-lab"),
        L("No unrecognized item remains in March 2027.", "No queda ninguna partida sin reconocer en marzo 2027.")),
      step(`J06.${7 + LAB_RECOGNITION.length}`, "user_demo_finance", wb("agency-management-reporting"), "agency-management-reporting",
        L("P&L, aging, cash and management report", "P&L, antigüedad, caja y reporte gerencial"),
        L("Reports from persisted records; exports are real files.", "Reportes desde registros persistidos; las exportaciones son archivos reales."),
        { inputs: J10_INPUTS["agency-management-reporting"] }),
      step(`J06.${8 + LAB_RECOGNITION.length}`, "user_demo_owner", wb("agency-period-close"), "agency-period-close",
        L("Propose closing March 2027", "Proponer el cierre de marzo 2027"),
        L("Close proposal with its reason; awaiting an approver other than the proposer.", "Propuesta de cierre con su motivo; en espera de un aprobador distinto de quien la propone."),
        { inputs: I({ period: "2027-03", action: "close", reason: "March demo ledger reconciled and complete" }), ...pending }),
      step(`J06.${9 + LAB_RECOGNITION.length}`, "user_demo_finance", approvalDetail(), "decideApprovalCommand",
        L("Finance approves the close", "Finanzas aprueba el cierre"),
        L("March 2027 closed in the internal demo ledger; later writes are blocked.", "Marzo 2027 cerrado en el libro interno demo; las escrituras posteriores se bloquean.")),
    ],
  },
  {
    id: "J07",
    name: { en: "Assistant page and right panel", es: "Asistente en página y panel derecho" },
    moduleKeys: ["setup"],
    entryCheckpoint: "ready_for_scope_review",
    continues: [],
    actor: "user_demo_operator",
    source: "demo-scenarios-v1.json#/journeys/J07",
    expectedResult: {
      en: "Same orchestrator and thread; no double execution; scripted replies with current-state data.",
      es: "Mismo orquestador e hilo; sin doble ejecución; respuestas guionadas con datos del estado vigente.",
    },
    steps: [
      step("J07.1", "user_demo_operator", preset("preset.margin.aurora"), "preset.margin.aurora",
        { en: "Open the assistant page from the sidebar and ask about the margin", es: "Abrir la página del asistente desde el sidebar y consultar el margen" },
        { en: "Answer cites the job, forecast and sources.", es: "La respuesta cita el trabajo, el forecast y las fuentes." }),
      step("J07.2", "user_demo_operator", route("job-dossier", "/a/:agencySlug/jobs/:jobId", AURORA_JOB), "getJobDossier",
        { en: "Open the job dossier from the answer", es: "Abrir el expediente desde la respuesta" },
        { en: "Same thread continues in the right panel.", es: "El mismo hilo continúa en el panel derecho." }),
      step("J07.3", "user_demo_operator", preset("preset.skill.agency-fee-contracts", "/a/:agencySlug/jobs/:jobId", AURORA_JOB), "preset.skill.agency-fee-contracts",
        { en: "Prepare the fee change from the panel", es: "Preparar el cambio de fee desde el panel" },
        { en: "Proposal awaits an eligible approver; nothing executes twice.", es: "La propuesta espera a un aprobador elegible; nada se ejecuta dos veces." }),
      step("J07.4", "user_demo_finance", route("approvals", "/a/:agencySlug/approvals", RAYO), "decideApprovalCommand",
        { en: "Eligible approver decides", es: "El aprobador elegible decide" },
        { en: "Approval bound to the exact payload.", es: "Aprobación ligada al payload exacto." }),
      step("J07.5", "user_demo_operator", preset("preset.margin.aurora"), "preset.margin.aurora",
        { en: "Reload and ask again", es: "Recargar y volver a preguntar" },
        { en: "Thread persists; figures reflect the new committed state.", es: "El hilo persiste; las cifras reflejan el nuevo estado confirmado." }),
    ],
  },
  {
    id: "J08",
    name: { en: "Files, connections and isolation", es: "Archivos, conexiones y aislamiento" },
    moduleKeys: ["setup"],
    entryCheckpoint: "ready_for_scope_review",
    continues: [],
    actor: "user_demo_operator",
    source: "demo-scenarios-v1.json#/journeys/J08",
    expectedResult: {
      en: "No file, message or record crosses tenants; no real OAuth.",
      es: "Ningún archivo, mensaje o registro cruza tenants; sin OAuth real.",
    },
    steps: [
      step("J08.1", "user_demo_operator", route("library", "/a/:agencySlug/library", RAYO), "uploadFile",
        { en: "Upload and open a synthetic file", es: "Cargar y abrir un archivo sintético" },
        { en: "Stored privately with hash and version; Stored is not Analyzed.", es: "Guardado en privado con hash y versión; Guardado no es Analizado." }),
      step("J08.2", "user_demo_operator", route("file-detail", "/a/:agencySlug/library/:fileId", { ...RAYO, fileId: { runtime: "fileId" } }), "linkFileToJob",
        { en: "Link it to the job dossier", es: "Vincularlo al expediente" },
        { en: "Visible from the dossier with authorized download.", es: "Visible desde el expediente con descarga autorizada." }),
      step("J08.3", "user_demo_owner", route("connection-detail", "/a/:agencySlug/connections/:connectionId", { ...RAYO, connectionId: { runtime: "connectionId" } }), "agency-integrations",
        { en: "Revoke a simulated connection", es: "Revocar una conexión simulada" },
        { en: "Dependent actions blocked; others keep working; event recorded.", es: "Acciones dependientes bloqueadas; las demás siguen; evento registrado." }),
      step("J08.4", "user_demo_operator", wb("agency-campaign-activation"), "agency-campaign-activation",
        { en: "Try the dependent action", es: "Intentar la acción dependiente" },
        { en: "Blocked with connection_revoked.", es: "Bloqueada con connection_revoked." },
        // The connection revoked in J08.3 (runtime id); plan r1 is the approved Aurora plan.
        { inputs: I({ job: AURORA, connection: rt("connectionId"), planRevision: "1", creativeFile: fx("file_demo_aurora_creative_feed"), rightsCleared: "true", landingUrl: "https://aurora.example/spring", conversionEvent: "purchase_demo" }), ...blocked("connection_revoked") }),
      step("J08.5", "user_demo_norte_owner", route("workspace-home", "/a/:agencySlug", { agencySlug: { literal: "norte-studio" } }), "switchPersona",
        { en: "Switch to the Norte Studio owner", es: "Cambiar al owner de Norte Studio" },
        { en: "Only Norte records are visible.", es: "Solo se ven registros de Norte." }),
      step("J08.6", "user_demo_norte_owner", route("job-dossier", "/a/:agencySlug/jobs/:jobId", AURORA_JOB), "resolveAgencyContext",
        { en: "Open a Rayo URL directly", es: "Abrir directamente una URL de Rayo" },
        { en: "404: another agency's job, file or approval is never revealed.", es: "404: nunca se revela el trabajo, archivo o aprobación de otra agencia." }),
      step("J08.7", "user_demo_owner", route("connection-detail", "/a/:agencySlug/connections/:connectionId", { ...RAYO, connectionId: { runtime: "connectionId" } }), "agency-integrations",
        { en: "Restore the connection", es: "Restaurar la conexión" },
        { en: "New verification enables the dependent action again.", es: "Una nueva verificación habilita de nuevo la acción dependiente." }),
    ],
  },
  {
    id: "J09",
    name: { en: "Operate the platform", es: "Operar la plataforma" },
    moduleKeys: ["setup"],
    entryCheckpoint: null,
    continues: [],
    actor: "user_demo_platform_operator",
    source: "demo-scenarios-v1.json#/journeys/J09",
    expectedResult: {
      en: "1 column → 6 columns and 1 row; no orders imported, no spend; no skill 43.",
      es: "1 columna → 6 columnas y 1 fila; sin importar órdenes ni gastar; sin skill 43.",
    },
    steps: [
      step("J09.1", "user_demo_platform_operator", route("platform-home", "/ops"), "listIncidents",
        { en: "Open platform operations", es: "Abrir operación de plataforma" },
        { en: "Demo tenants with minimal data and the synthetic incident.", es: "Tenants demo con datos mínimos y el incidente sintético." }),
      step("J09.2", "user_demo_platform_operator", route("platform-incident", "/ops/incidents/:incidentId", { incidentId: { fixture: "ops_csv_delimiter_mismatch" } }), "investigate",
        { en: "Investigate ops_csv_delimiter_mismatch", es: "Investigar ops_csv_delimiter_mismatch" },
        { en: "File hash, profile revision 1, six expected headers; real parser returns one column.", es: "Hash del archivo, perfil revisión 1, seis encabezados esperados; el parser real devuelve una columna." }),
      step("J09.3", "user_demo_platform_operator", route("platform-incident", "/ops/incidents/:incidentId", { incidentId: { fixture: "ops_csv_delimiter_mismatch" } }), "proposeDelimiterChange",
        { en: "Propose delimiter ',' → ';' for the allowlisted demo profile", es: "Proponer delimitador ',' → ';' para el perfil demo permitido" },
        { en: "Typed change bound to profile revision 1; awaiting approval.", es: "Cambio tipado ligado a la revisión 1 del perfil; en espera de aprobación." }),
      step("J09.4", "user_demo_platform_admin", route("platform-change", "/ops/changes/:changeId", { changeId: { runtime: "changeId" } }), "decidePlatformChange",
        { en: "A different platform admin approves the exact change", es: "Un admin de plataforma distinto aprueba el cambio exacto" },
        { en: "Requester cannot approve; stale revision is refused.", es: "El solicitante no aprueba; una revisión obsoleta se rechaza." }),
      step("J09.5", "user_demo_platform_admin", route("platform-change", "/ops/changes/:changeId", { changeId: { runtime: "changeId" } }), "applyPlatformChange",
        { en: "Apply the approved local change", es: "Aplicar el cambio local aprobado" },
        { en: "Profile revision 2 persisted with its diff; repeating the apply keeps one change.", es: "Perfil revisión 2 persistido con su diff; repetir la aplicación conserva un solo cambio." }),
      step("J09.6", "user_demo_platform_admin", route("platform-change", "/ops/changes/:changeId", { changeId: { runtime: "changeId" } }), "verifyPlatformChange",
        { en: "Verify by re-parsing the same file", es: "Verificar re-analizando el mismo archivo" },
        { en: "Same hash; six named columns and one data row; incident resolved and audited.", es: "Mismo hash; seis columnas con nombre y una fila; incidente resuelto y auditado." }),
    ],
  },
  {
    id: "J10",
    name: { en: "All capabilities and guarded failures", es: "Todas las capacidades y fallos controlados" },
    moduleKeys: ["setup", "clients-contracts", "work-production", "media-planning", "media-buying", "suppliers-payments", "billing-collections", "accounting-close", "profitability"],
    entryCheckpoint: "ready_for_scope_review",
    continues: [],
    actor: "user_demo_owner",
    source: "demo-scenarios-v1.json#/journeys/J10",
    expectedResult: {
      en: "42/42 implemented and verified; no Coming soon, dead controls or automatic success.",
      es: "42/42 implementadas y verificadas; sin Coming soon, controles muertos ni éxito automático.",
    },
    steps: [
      step("J10.0", "user_demo_owner", route("capabilities", "/a/:agencySlug/capabilities", RAYO), "listCapabilities",
        { en: "Open the catalog of 42 capabilities", es: "Abrir el catálogo de 42 capacidades" },
        { en: "Nine groups, 42 unique skills, each linking to its workbench.", es: "Nueve grupos, 42 skills únicas, cada una enlaza a su workbench." }),
      ...CAPABILITY_CONTRACTS.flatMap((c, i) => [
        // The settlement imports a statement exported from the lab demo bank first.
        ...(c.skillId === "agency-cash-settlement"
          ? [
              step(`J10.${i + 1}a`, "user_demo_owner", connectionDetail(fx("connection_rayo_lab_demo")), "cash.exportDemoBankStatement",
                L("Export the lab demo bank statement", "Exportar el extracto del banco demo del laboratorio"),
                L("Synthetic statement file of the lab account.", "Archivo de extracto sintético de la cuenta del laboratorio."),
                { inputs: I({ statementDate: "2027-03-31" }), captures: { "capture:statement.lab": "fileId" } }),
            ]
          : []),
        step(`J10.${i + 1}`, "user_demo_owner", wb(c.skillId), c.skillId, c.label, {
          en: `ERP-${String(i + 1).padStart(2, "0")}: positive case persists; negative case is blocked by its rule with no side effect.`,
          es: `ERP-${String(i + 1).padStart(2, "0")}: el caso positivo persiste; el negativo se bloquea por su regla sin efecto lateral.`,
        }, { inputs: J10_INPUTS[c.skillId] }),
      ]),
    ],
  },
]

export function journeyById(id: string): Journey | null {
  return JOURNEYS.find((j) => j.id === id) ?? null
}

/**
 * Execution order: a journey runs right after the journeys it continues (one
 * demo run, no reset in between), otherwise in catalog order. Catalog
 * J01…J10 → J01, J02, J04, J03, J05, J06, J07, J08, J09, J10.
 */
export function journeyRunOrder(): Journey[] {
  const out: Journey[] = []
  const visit = (j: Journey) => {
    if (out.includes(j)) return
    for (const c of j.continues) visit(journeyById(c)!)
    out.push(j)
  }
  for (const j of JOURNEYS) visit(j)
  return out
}

/** Value at `path` of a step output: dot segments, numeric indexes and `[key=value]` filters. */
export function journeyOutputValue(output: unknown, path: string): unknown {
  let cur: unknown = output
  for (const seg of path.split(".")) {
    const m = /^([^[\]]+)(?:\[([^=\]]+)=([^\]]+)\])?$/.exec(seg)
    if (!m || cur === null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[m[1]!]
    if (m[2] !== undefined) cur = Array.isArray(cur) ? cur.find((x) => x && typeof x === "object" && String((x as Record<string, unknown>)[m[2]!]) === m[3]) : undefined
  }
  return cur
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Every approval a step output requested (top level, nested proposals, request lists). */
export function journeyApprovalIds(output: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(output)) for (const v of output) journeyApprovalIds(v, out)
  else if (output && typeof output === "object") {
    for (const [k, v] of Object.entries(output)) {
      if (k === "approvalId" && typeof v === "string" && UUID_RE.test(v)) out.add(v)
      else journeyApprovalIds(v, out)
    }
  }
  return out
}

/** Query value of a fixture-key input (`f.job=fixture:job_demo_aurora`); resolved on the server. */
export const FIXTURE_INPUT_PREFIX = "fixture:"

/**
 * Builds the link of a step. Fixture params resolve through `fixtureId`
 * (server: fixtureUuid); runtime params come from the current run. Returns
 * null while a runtime param is still unknown (the step is not reachable yet).
 * Workbench inputs become `f.<field>` query params: literals as-is, fixture
 * keys as `fixture:<key>` (resolved by the workbench inside the tenant),
 * runtime values when known (an unknown one is left for the user to choose).
 */
export function journeyStepHref(
  s: JourneyStep,
  resolve: { fixtureId: (key: string) => string; runtime?: Partial<Record<RuntimeParam, string>> }
): string | null {
  let path = s.surface.path
  for (const [name, src] of Object.entries(s.surface.params ?? {})) {
    const value = "literal" in src ? src.literal : "fixture" in src ? resolve.fixtureId(src.fixture) : resolve.runtime?.[src.runtime]
    if (!value) return null
    path = path.replace(`:${name}`, encodeURIComponent(value))
  }
  if (path.includes("/:")) return null
  if (s.surface.kind === "assistant") return `${path}${path.includes("?") ? "&" : "?"}preset=${encodeURIComponent(s.surface.presetId)}`
  const query = new URLSearchParams()
  for (const [field, src] of Object.entries(s.inputs ?? {})) {
    const value = "literal" in src ? src.literal : "fixture" in src ? `${FIXTURE_INPUT_PREFIX}${src.fixture}` : resolve.runtime?.[src.runtime]
    if (value !== undefined && (value !== "" || "literal" in src)) query.set(`f.${field}`, value)
  }
  return query.size ? `${path}?${query}` : path
}
