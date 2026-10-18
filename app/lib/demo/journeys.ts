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

export type RuntimeParam = "draftId" | "runId" | "agencyId" | "agencySlug" | "changeId" | "approvalId" | "fileId" | "connectionId"

export type JourneySurface =
  | { readonly kind: "route"; readonly routeId: string; readonly path: string; readonly params?: Readonly<Record<string, ParamSource>> }
  | { readonly kind: "assistant"; readonly presetId: string; readonly path: string; readonly params?: Readonly<Record<string, ParamSource>> }

export type JourneyStep = {
  readonly id: string
  readonly actor: JourneyActor
  readonly label: Localized
  readonly surface: JourneySurface
  /** Server service/command (or capability skill id) that performs the step. */
  readonly performs: string
  readonly expected: Localized
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

const step = (id: string, actor: JourneyActor, surface: JourneySurface, performs: string, label: Localized, expected: Localized): JourneyStep => ({ id, actor, surface, performs, label, expected })

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
      en: "The job keeps its identity and revisions; hours change cost and margin.",
      es: "El trabajo conserva identidad y revisiones; las horas cambian costo y margen.",
    },
    steps: [
      step("J02.1", "user_demo_operator", wb("agency-onboarding"), "agency-onboarding",
        { en: "Intake the brief and create the client", es: "Recibir el brief y crear el cliente" },
        { en: "Aurora Beverages and its brief exist once, linked to the brief document.", es: "Aurora Beverages y su brief existen una vez, vinculados al documento." }),
      step("J02.2", "user_demo_operator", wb("agency-contract-po"), "agency-contract-po",
        { en: "Record the client contract / PO with its evidence", es: "Registrar contrato / PO del cliente con su evidencia" },
        { en: "Client authority USD 50,000 recorded with reviewed evidence; owner approval separate.", es: "Autoridad del cliente USD 50,000 registrada con evidencia revisada; aprobación del owner separada." }),
      step("J02.3", "user_demo_operator", wb("agency-job-lifecycle"), "agency-job-lifecycle",
        { en: "Open the job", es: "Abrir el trabajo" },
        { en: "JobNumber AURSL7AF0001 assigned once; retry does not duplicate.", es: "JobNumber AURSL7AF0001 asignado una vez; reintentar no duplica." }),
      step("J02.4", "user_demo_operator", wb("agency-budget-control"), "agency-budget-control",
        { en: "Set and approve the budget", es: "Definir y aprobar el presupuesto" },
        { en: "Fee USD 20,000 and managed media USD 30,000 kept separate.", es: "Fee USD 20,000 y medios administrados USD 30,000 separados." }),
      step("J02.5", "user_demo_producer", wb("agency-tasks-timesheets"), "agency-tasks-timesheets",
        { en: "Plan tasks and log hours", es: "Planificar tareas y registrar horas" },
        { en: "Approved hours change labor cost and the margin forecast.", es: "Las horas aprobadas cambian el costo laboral y el margen proyectado." }),
      step("J02.6", "user_demo_operator", wb("agency-production-estimating"), "agency-production-estimating",
        { en: "Estimate production", es: "Estimar producción" },
        { en: "Production vendor estimate linked to the job revision.", es: "Estimación del proveedor de producción vinculada a la revisión del trabajo." }),
      step("J02.7", "user_demo_producer", wb("agency-production"), "agency-production",
        { en: "Track production and attach the deliverable evidence", es: "Seguir producción y adjuntar la evidencia del entregable" },
        { en: "Deliverable and evidence visible in the job dossier.", es: "Entregable y evidencia visibles en el expediente." }),
      step("J02.8", "user_demo_operator", route("job-dossier", "/a/:agencySlug/jobs/:jobId", AURORA_JOB), "getJobDossier",
        { en: "Review the job dossier", es: "Revisar el expediente del trabajo" },
        { en: "Contract, budget, hours, production and margin connected on one record.", es: "Contrato, presupuesto, horas, producción y margen conectados en un registro." }),
    ],
  },
  {
    id: "J03",
    name: { en: "Media plan to campaign", es: "Plan de medios a campaña" },
    moduleKeys: ["media-planning", "media-buying"],
    entryCheckpoint: "ready_for_scope_review",
    continues: [],
    actor: "user_demo_operator",
    source: "demo-scenarios-v1.json#/journeys/J03",
    expectedResult: {
      en: "Media total USD 30,000; approved revision and correct demo account; no external spend.",
      es: "Total de medios USD 30,000; revisión aprobada y cuenta demo correcta; sin gasto externo.",
    },
    steps: [
      step("J03.1", "user_demo_operator", wb("agency-media-ranking"), "agency-media-ranking",
        { en: "Rank channels with synthetic audiences", es: "Priorizar canales con audiencias sintéticas" },
        { en: "Ranking from labelled synthetic audience data.", es: "Priorización con datos de audiencia sintéticos rotulados." }),
      step("J03.2", "user_demo_operator", wb("agency-digital-planning"), "agency-digital-planning",
        { en: "Plan digital lines and specs", es: "Planificar líneas digitales y specs" },
        { en: "Digital lines with complete specs.", es: "Líneas digitales con specs completas." }),
      step("J03.3", "user_demo_operator", wb("agency-tv-radio-planning"), "agency-tv-radio-planning",
        { en: "Plan TV/radio spots", es: "Planificar spots de TV/radio" },
        { en: "Radio line 20 × USD 100 on the plan.", es: "Línea de radio 20 × USD 100 en el plan." }),
      step("J03.4", "user_demo_operator", wb("agency-ooh-planning"), "agency-ooh-planning",
        { en: "Plan OOH faces", es: "Planificar caras OOH" },
        { en: "OOH line 2 × USD 1,000 on the plan.", es: "Línea OOH 2 × USD 1,000 en el plan." }),
      step("J03.5", "user_demo_operator", wb("agency-media-planning"), "agency-media-planning",
        { en: "Review the media plan revision", es: "Revisar la revisión del plan de medios" },
        { en: "Plan total USD 30,000 across six channels.", es: "Total del plan USD 30,000 en seis canales." }),
      step("J03.6", "user_demo_operator", wb("agency-media-buying"), "agency-media-buying",
        { en: "Create media orders from the approved revision", es: "Crear órdenes de medios desde la revisión aprobada" },
        { en: "Orders bound to the approved plan revision.", es: "Órdenes vinculadas a la revisión aprobada del plan." }),
      step("J03.7", "user_demo_operator", wb("agency-campaign-activation"), "agency-campaign-activation",
        { en: "Activate the demo campaign", es: "Activar la campaña demo" },
        { en: "Simulated activation with sim_* receipt on the demo account; no real spend.", es: "Activación simulada con recibo sim_* en la cuenta demo; sin gasto real." }),
      step("J03.8", "user_demo_operator", wb("agency-transmission-control"), "agency-transmission-control",
        { en: "Check delivery / transmission", es: "Revisar entrega / emisión" },
        { en: "Delivery recorded against the orders.", es: "Entrega registrada contra las órdenes." }),
      step("J03.9", "user_demo_operator", wb("agency-campaign-optimization"), "agency-campaign-optimization",
        { en: "Optimize from simulated metrics", es: "Optimizar con métricas simuladas" },
        { en: "Recommendation proposed, not applied automatically.", es: "Recomendación propuesta, no aplicada automáticamente." }),
      step("J03.10", "user_demo_operator", wb("agency-plan-changes"), "agency-plan-changes",
        { en: "Revise the plan", es: "Revisar el plan" },
        { en: "New plan revision; prior approvals of the old payload become stale.", es: "Nueva revisión del plan; las aprobaciones del payload anterior quedan obsoletas." }),
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
        { en: "Cost USD 13,000; margin 35.0% below the 40% floor.", es: "Costo USD 13,000; margen 35.0% bajo el piso de 40%." }),
      step("J04.3", "user_demo_operator", preset("preset.margin.aurora", "/a/:agencySlug/jobs/:jobId", AURORA_JOB), "preset.margin.aurora",
        { en: "Ask the assistant why the margin fell", es: "Preguntar al asistente por qué bajó el margen" },
        { en: "Scripted answer cites the persisted records; labelled scripted demo.", es: "Respuesta guionada que cita los registros persistidos; rotulada como demo guionada." }),
      step("J04.4", "user_demo_operator", wb("agency-fee-contracts"), "proposeFeeAmendment",
        { en: "Propose the USD 3,000 fee amendment", es: "Proponer la enmienda de fee de USD 3,000" },
        { en: "Proposal awaiting finance approval; no financial effect yet.", es: "Propuesta en espera de aprobación de finanzas; sin efecto financiero aún." }),
      step("J04.5", "user_demo_operator", wb("agency-contract-po"), "recordClientAuthority",
        { en: "Record client PO revision 2 (USD 53,000) with its evidence", es: "Registrar la PO revisión 2 del cliente (USD 53,000) con su evidencia" },
        { en: "Client authority is a separate fact from internal approval.", es: "La autoridad del cliente es un hecho distinto de la aprobación interna." }),
      step("J04.6", "user_demo_finance", route("approval-detail", "/a/:agencySlug/approvals/:approvalId", { ...RAYO, approvalId: { runtime: "approvalId" } }), "decideApprovalCommand",
        { en: "Finance approves the exact payload", es: "Finanzas aprueba el payload exacto" },
        { en: "Requester cannot self-approve; approval bound to the digest and revision.", es: "El solicitante no puede autoaprobar; aprobación ligada a digest y revisión." }),
      step("J04.7", "user_demo_operator", route("job-dossier", "/a/:agencySlug/jobs/:jobId", AURORA_JOB), "getJobDossier",
        { en: "Return to the job", es: "Volver al trabajo" },
        { en: "Fee USD 23,000, cost USD 13,000, margin USD 10,000 · 43.5%; media USD 30,000 separate.", es: "Fee USD 23,000, costo USD 13,000, margen USD 10,000 · 43.5%; medios USD 30,000 separados." }),
    ],
  },
  {
    id: "J05",
    name: { en: "Supplier reconciliation and payment", es: "Conciliación de proveedor y pago" },
    moduleKeys: ["suppliers-payments", "billing-collections"],
    entryCheckpoint: "ready_for_scope_review",
    continues: ["J04"],
    actor: "user_demo_finance",
    source: "demo-scenarios-v1.json#/journeys/J05",
    expectedResult: {
      en: "No overdraft: cash 10k + 53k − 43k = 20k. Order/delivery/invoice/payment never duplicate costs.",
      es: "Sin sobregiro: caja 10k + 53k − 43k = 20k. Orden/entrega/factura/pago no duplican costos.",
    },
    steps: [
      step("J05.1", "user_demo_finance", wb("agency-delivery-reconciliation"), "agency-delivery-reconciliation",
        { en: "Match supplier invoice USD 6,000 against delivery USD 5,500", es: "Conciliar factura de proveedor USD 6,000 contra entrega USD 5,500" },
        { en: "Invoice held: amount differs from the accepted delivery.", es: "Factura retenida: el importe difiere de la entrega aceptada." }),
      step("J05.2", "user_demo_finance", wb("agency-payables"), "agency-payables",
        { en: "Correct the invoice and make it payable", es: "Corregir la factura y dejarla pagable" },
        { en: "One payable of USD 5,500; no duplicate cost.", es: "Una cuenta por pagar de USD 5,500; sin costo duplicado." }),
      step("J05.3", "user_demo_finance", wb("agency-client-billing"), "agency-client-billing",
        { en: "Issue the demo client invoice USD 53,000", es: "Emitir la factura demo al cliente USD 53,000" },
        { en: "Billing requirements checked; demo issuance, no tax filing.", es: "Requisitos de facturación verificados; emisión demo, sin timbrado fiscal." }),
      step("J05.4", "user_demo_finance", wb("agency-payment-run"), "agency-payment-run",
        { en: "Try to pay USD 43,000 before collecting", es: "Intentar pagar USD 43,000 antes de cobrar" },
        { en: "Blocked: insufficient funds (cash USD 10,000).", es: "Bloqueado: fondos insuficientes (caja USD 10,000)." }),
      step("J05.5", "user_demo_finance", wb("agency-collections"), "agency-collections",
        { en: "Collect USD 40,000", es: "Cobrar USD 40,000" },
        { en: "Cash USD 50,000; receivable USD 13,000.", es: "Caja USD 50,000; cartera USD 13,000." }),
      step("J05.6", "user_demo_finance", wb("agency-payment-run"), "agency-payment-run",
        { en: "Release the approved payments", es: "Liberar los pagos aprobados" },
        { en: "USD 43,000 paid with sim_* receipts; cash USD 7,000.", es: "USD 43,000 pagados con recibos sim_*; caja USD 7,000." }),
      step("J05.7", "user_demo_finance", wb("agency-cash-settlement"), "agency-cash-settlement",
        { en: "Settle cash and reconcile", es: "Liquidar caja y conciliar" },
        { en: "Cash settlement distinct from expense recognition.", es: "Liquidación de caja distinta del reconocimiento de gasto." }),
      step("J05.8", "user_demo_finance", wb("agency-collections"), "agency-collections",
        { en: "Collect the remaining USD 13,000", es: "Cobrar los USD 13,000 restantes" },
        { en: "Cash USD 20,000; receivable zero.", es: "Caja USD 20,000; cartera cero." }),
    ],
  },
  {
    id: "J06",
    name: { en: "Accounting close and reporting", es: "Cierre contable y reportes" },
    moduleKeys: ["accounting-close", "profitability", "billing-collections"],
    entryCheckpoint: "ready_for_scope_review",
    continues: ["J04", "J05"],
    actor: "user_demo_finance",
    source: "demo-scenarios-v1.json#/journeys/J06",
    expectedResult: {
      en: "15 primary journals balanced and the exact final balance; jurisdiction and tax types are demo.",
      es: "15 asientos principales equilibrados y saldo final exacto; jurisdicción y tipos fiscales son demo.",
    },
    steps: [
      step("J06.1", "user_demo_finance", wb("agency-general-ledger"), "agency-general-ledger",
        { en: "Recognize and reconcile journals", es: "Reconocer y conciliar asientos" },
        { en: "Every journal balances; prepared by one actor, posted by another.", es: "Cada asiento cuadra; preparado por un actor y contabilizado por otro." }),
      step("J06.2", "user_demo_finance", wb("agency-accruals-revaluation"), "agency-accruals-revaluation",
        { en: "Accruals and FX revaluation (demo-lab)", es: "Provisiones y revaluación cambiaria (demo-lab)" },
        { en: "Secondary cases stay out of Aurora KPIs.", es: "Los casos secundarios no afectan los KPIs de Aurora." }),
      step("J06.3", "user_demo_finance", wb("agency-fixed-assets"), "agency-fixed-assets",
        { en: "Fixed asset depreciation (demo-lab)", es: "Depreciación de activo fijo (demo-lab)" },
        { en: "Depreciation entry on the demo-lab asset.", es: "Asiento de depreciación del activo demo-lab." }),
      step("J06.4", "user_demo_finance", wb("agency-period-close"), "agency-period-close",
        { en: "Run the close checklist and close March 2027", es: "Ejecutar el checklist y cerrar marzo 2027" },
        { en: "A difference blocks the close; once corrected the internal demo ledger closes.", es: "Una diferencia bloquea el cierre; corregida, se cierra el libro interno demo." }),
      step("J06.5", "user_demo_finance", wb("agency-management-reporting"), "agency-management-reporting",
        { en: "P&L, aging, cash and management report", es: "P&L, antigüedad, caja y reporte gerencial" },
        { en: "Reports from persisted records; exports are real files.", es: "Reportes desde registros persistidos; las exportaciones son archivos reales." }),
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
        { en: "Blocked with connection_revoked.", es: "Bloqueada con connection_revoked." }),
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
      ...CAPABILITY_CONTRACTS.map((c, i) =>
        step(`J10.${i + 1}`, "user_demo_owner", wb(c.skillId), c.skillId, c.label, {
          en: `ERP-${String(i + 1).padStart(2, "0")}: positive case persists; negative case is blocked by its rule with no side effect.`,
          es: `ERP-${String(i + 1).padStart(2, "0")}: el caso positivo persiste; el negativo se bloquea por su regla sin efecto lateral.`,
        })
      ),
    ],
  },
]

export function journeyById(id: string): Journey | null {
  return JOURNEYS.find((j) => j.id === id) ?? null
}

/**
 * Builds the link of a step. Fixture params resolve through `fixtureId`
 * (server: fixtureUuid); runtime params come from the current run. Returns
 * null while a runtime param is still unknown (the step is not reachable yet).
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
  return s.surface.kind === "assistant" ? `${path}${path.includes("?") ? "&" : "?"}preset=${encodeURIComponent(s.surface.presetId)}` : path
}
