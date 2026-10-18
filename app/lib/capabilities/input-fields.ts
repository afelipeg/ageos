import type { FieldSpec, FieldType, Localized } from "./types"

// Typed workbench inputs for the 42 skills, in catalog order. One entry drives
// the form and the server-side schema. Money is a decimal string in the record
// currency, minutes and bps are integers, references (job, client, supplier,
// connection, file, member) are resolved on the server inside the tenant.

type FieldExtra = Pick<
  FieldSpec,
  "help" | "options" | "min" | "max" | "maxLength" | "example"
>

const l = (en: string, es: string): Localized => ({ en, es })
const opt = (value: string, en: string, es: string) => ({
  value,
  label: l(en, es),
})
const field = (
  key: string,
  type: FieldType,
  label: Localized,
  required: boolean,
  extra: FieldExtra = {}
): FieldSpec => ({ key, type, label, required, ...extra })

const JOB = field("job", "job", l("Job", "Trabajo"), true)

const CURRENCIES = [
  opt("USD", "US dollar (USD)", "Dólar estadounidense (USD)"),
  opt("CAD", "Canadian dollar (CAD)", "Dólar canadiense (CAD)"),
  opt("MXN", "Mexican peso (MXN)", "Peso mexicano (MXN)"),
]

const COUNTRIES = [
  opt("US", "United States", "Estados Unidos"),
  opt("CA", "Canada", "Canadá"),
  opt("MX", "Mexico", "México"),
  opt("CO", "Colombia", "Colombia"),
]

const CHANNELS = [
  opt("meta", "Meta (demo)", "Meta (demo)"),
  opt("google", "Google (demo)", "Google (demo)"),
  opt("tiktok", "TikTok (demo)", "TikTok (demo)"),
  opt("ctv", "Connected TV (demo)", "TV conectada (demo)"),
  opt("radio", "Radio", "Radio"),
  opt("ooh", "Out-of-home (OOH)", "Exterior (OOH)"),
]

const BASES = [
  opt("forecast", "Forecast", "Proyectado"),
  opt("incurred", "Incurred", "Incurrido"),
]

const LEDGER_ACCOUNTS = [
  opt("cash", "Cash", "Caja"),
  opt("accounts_receivable", "Accounts receivable", "Cuentas por cobrar"),
  opt("unbilled_fee_asset", "Unbilled fees", "Honorarios sin facturar"),
  opt("agency_fee_revenue", "Agency fee revenue", "Ingreso por honorarios"),
  opt("labor_expense", "Labor expense", "Gasto de mano de obra"),
  opt("payroll_payable", "Payroll payable", "Nómina por pagar"),
  opt("production_expense", "Production expense", "Gasto de producción"),
  opt("accrued_production", "Accrued production", "Producción devengada"),
  opt("ap_production", "Production payable", "Producción por pagar"),
  opt("direct_expense", "Direct expense", "Gasto directo"),
  opt("expense_payable", "Expenses payable", "Gastos por pagar"),
  opt("media_recovery_asset", "Media recoverable (pass-through)", "Medios recuperables (traslado)"),
  opt("accrued_media", "Accrued media", "Medios devengados"),
  opt("ap_media", "Media payable", "Medios por pagar"),
  opt("opening_equity", "Opening balance equity", "Patrimonio de apertura"),
]

export const INPUT_FIELDS: Record<string, readonly FieldSpec[]> = {
  // M01 Agency setup
  "agency-orchestrator": [
    field("job", "job", l("Job", "Trabajo"), true, {
      help: l(
        "Choose the job to check for next steps and blockers.",
        "Elige el trabajo para revisar próximos pasos y bloqueos."
      ),
    }),
  ],
  "agency-integrations": [
    field("action", "enum", l("Action", "Acción"), true, {
      options: [
        opt("connect", "Connect", "Conectar"),
        opt("test", "Test connection", "Probar conexión"),
        opt("revoke", "Revoke", "Revocar"),
        opt("restore", "Restore", "Restaurar"),
      ],
      help: l(
        "Revoking a connection blocks only the actions that depend on it.",
        "Revocar una conexión bloquea solo las acciones que dependen de ella."
      ),
      example: "test",
    }),
    field("provider", "enum", l("Provider", "Proveedor"), true, {
      options: [
        opt("meta_ads", "Meta Ads (simulated)", "Meta Ads (simulado)"),
        opt("google_ads", "Google Ads (simulated)", "Google Ads (simulado)"),
        opt("tiktok_ads", "TikTok Ads (simulated)", "TikTok Ads (simulado)"),
        opt("dv360_demo", "DV360 (demo)", "DV360 (demo)"),
        opt("demo_bank", "Demo bank", "Banco demo"),
        opt("demo_ledger", "Demo ledger", "Libro contable demo"),
      ],
      example: "meta_ads",
    }),
    field("accountAlias", "text", l("Account alias", "Alias de cuenta"), true, {
      help: l(
        "Fictitious account name used in this demo.",
        "Nombre de cuenta ficticio usado en esta demo."
      ),
      maxLength: 80,
      example: "demo_meta_aurora",
    }),
  ],
  "agency-access-governance": [
    field("member", "member", l("Team member", "Miembro del equipo"), true),
    field("proposedRole", "enum", l("Proposed role", "Rol propuesto"), true, {
      options: [
        opt("owner", "Owner", "Propietario"),
        opt("account_manager", "Account manager", "Gerente de cuenta"),
        opt("finance_approver", "Finance approver", "Aprobador financiero"),
        opt("producer", "Producer", "Productor"),
        opt("viewer", "Viewer", "Observador"),
      ],
      example: "finance_approver",
    }),
    field("effectiveScope", "enum", l("Scope", "Alcance"), true, {
      options: [
        opt("agency_wide", "Whole agency", "Toda la agencia"),
        opt("assigned_jobs", "Assigned jobs only", "Solo trabajos asignados"),
      ],
      example: "assigned_jobs",
    }),
    field(
      "expenseApprovalCap",
      "money",
      l("Expense approval cap", "Límite de aprobación de gastos"),
      false,
      { example: "5000.00" }
    ),
    field("reason", "textarea", l("Reason", "Motivo"), true, {
      help: l(
        "Explain why the change is needed. The requester cannot approve their own change.",
        "Explica por qué se necesita el cambio. Quien lo solicita no puede aprobarlo."
      ),
      maxLength: 500,
      example:
        "Needs to approve scope-change amendments for the spring launch.",
    }),
  ],
  "agency-master-data": [
    field("recordType", "enum", l("Record type", "Tipo de registro"), true, {
      options: [
        opt("client", "Client", "Cliente"),
        opt("supplier", "Supplier", "Proveedor"),
        opt("account", "Ledger account", "Cuenta contable"),
      ],
      example: "supplier",
    }),
    field("code", "text", l("Code", "Código"), true, {
      maxLength: 20,
      example: "LUM",
    }),
    field("legalName", "text", l("Name", "Nombre"), true, {
      maxLength: 160,
      example: "Lumen Production Demo",
    }),
    field("country", "enum", l("Country", "País"), false, {
      options: COUNTRIES,
      example: "US",
    }),
    field(
      "externalMapping",
      "text",
      l("External ID mapping", "ID externo"),
      false,
      {
        help: l(
          "Identifier of this record in the connected demo system.",
          "Identificador de este registro en el sistema demo conectado."
        ),
        maxLength: 80,
        example: "demo_ledger:LUM",
      }
    ),
  ],

  // M02 Clients & contracts
  "agency-onboarding": [
    field("clientName", "text", l("Client name", "Nombre del cliente"), true, {
      maxLength: 120,
      example: "Aurora Beverages",
    }),
    field("clientCode", "text", l("Client code", "Código del cliente"), true, {
      help: l(
        "Three uppercase letters or digits.",
        "Tres letras mayúsculas o dígitos."
      ),
      maxLength: 3,
      example: "AUR",
    }),
    field(
      "productCode",
      "text",
      l("Product code", "Código del producto"),
      true,
      {
        help: l(
          "Two uppercase letters or digits.",
          "Dos letras mayúsculas o dígitos."
        ),
        maxLength: 2,
        example: "SL",
      }
    ),
    field(
      "billingCurrency",
      "enum",
      l("Billing currency", "Moneda de facturación"),
      true,
      { options: CURRENCIES, example: "USD" }
    ),
    field("country", "enum", l("Country", "País"), true, {
      options: COUNTRIES,
      example: "US",
    }),
    field(
      "creditLimit",
      "money",
      l("Credit limit", "Límite de crédito"),
      false,
      {
        example: "60000.00",
      }
    ),
    field("briefTitle", "text", l("Brief title", "Título del brief"), true, {
      maxLength: 160,
      example: "Aurora spring launch brief",
    }),
    field(
      "briefSummary",
      "textarea",
      l("Brief summary", "Resumen del brief"),
      true,
      {
        maxLength: 2000,
        example:
          "Launch a new sparkling line across social, search, connected TV, radio and out-of-home during March.",
      }
    ),
  ],
  "agency-job-lifecycle": [
    field("action", "enum", l("Action", "Acción"), true, {
      options: [
        opt("open", "Open job", "Abrir trabajo"),
        opt("request_close", "Request close", "Solicitar cierre"),
      ],
      example: "open",
    }),
    field("client", "client", l("Client", "Cliente"), false, {
      help: l(
        "Required when opening a job.",
        "Obligatorio al abrir un trabajo."
      ),
    }),
    field("jobName", "text", l("Job name", "Nombre del trabajo"), false, {
      maxLength: 160,
      example: "Aurora Spring Launch",
    }),
    field("jobType", "enum", l("Job type", "Tipo de trabajo"), false, {
      options: [
        opt("A", "Advertising campaign", "Campaña publicitaria"),
        opt("C", "Creative only", "Solo creatividad"),
        opt("P", "Production", "Producción"),
        opt("N", "Non-billable internal", "Interno no facturable"),
      ],
      example: "A",
    }),
    field(
      "billingCode",
      "enum",
      l("Billing code", "Código de facturación"),
      false,
      {
        options: [
          opt("F", "Fee billable", "Honorarios facturables"),
          opt("0", "Non-billable", "No facturable"),
          opt(
            "?",
            "Billing client pending",
            "Cliente de facturación pendiente"
          ),
        ],
        example: "F",
      }
    ),
    field("period", "month", l("Start month", "Mes de inicio"), false, {
      example: "2027-03",
    }),
    field("job", "job", l("Job", "Trabajo"), false, {
      help: l(
        "Required when requesting close.",
        "Obligatorio al solicitar el cierre."
      ),
    }),
    field(
      "closeReason",
      "textarea",
      l("Close reason", "Motivo del cierre"),
      false,
      {
        maxLength: 500,
        example: "All deliverables accepted and invoiced.",
      }
    ),
  ],
  "agency-contract-po": [
    JOB,
    field("reference", "text", l("PO number", "Número de PO"), true, {
      help: l(
        "A new revision of an existing PO number amends its authority.",
        "Una nueva revisión de un número de PO existente enmienda su autoridad."
      ),
      maxLength: 60,
      example: "PO-AUR-2027-01",
    }),
    field(
      "amount",
      "money",
      l("Authorized amount", "Importe autorizado"),
      true,
      {
        help: l(
          "Net of tax. Spending above this amount is blocked.",
          "Sin impuestos. Un gasto superior a este importe se bloquea."
        ),
        example: "53000.00",
      }
    ),
    field("validFrom", "date", l("Valid from", "Vigente desde"), false, {
      help: l(
        "Leave empty to keep the validity of the previous revision.",
        "Déjalo vacío para conservar la vigencia de la revisión anterior."
      ),
      example: "2027-03-01",
    }),
    field("validTo", "date", l("Valid until", "Vigente hasta"), false, {
      help: l(
        "An expired PO cannot authorize new commitments.",
        "Una PO vencida no puede autorizar nuevos compromisos."
      ),
      example: "2027-06-30",
    }),
    field(
      "billingRoute",
      "enum",
      l("Billing route", "Ruta de facturación"),
      false,
      {
        options: [
          opt(
            "holder_client",
            "Bill the holder client",
            "Facturar al cliente titular"
          ),
          opt("other_client", "Bill another client", "Facturar a otro cliente"),
        ],
        example: "holder_client",
      }
    ),
    field(
      "evidenceId",
      "evidence",
      l("Reviewed client PO evidence", "Evidencia de PO del cliente revisada"),
      true,
      {
        help: l(
          "Signed PO or agreement, reviewed by someone other than who submitted it.",
          "PO o acuerdo firmado, revisado por alguien distinto de quien lo aportó."
        ),
      }
    ),
  ],
  "agency-budget-control": [
    JOB,
    field(
      "budgetScope",
      "enum",
      l("Budget scope", "Alcance del presupuesto"),
      true,
      {
        options: [
          opt(
            "client_commercial_authority",
            "Client commercial authority",
            "Autoridad comercial del cliente"
          ),
          opt(
            "managed_media_authority",
            "Managed media authority",
            "Autoridad de medios administrados"
          ),
          opt(
            "agency_cost_authority",
            "Agency cost authority",
            "Autoridad de costo de la agencia"
          ),
        ],
        example: "managed_media_authority",
      }
    ),
    field(
      "amount",
      "money",
      l("Amount to reserve", "Importe a reservar"),
      true,
      {
        example: "30000.00",
      }
    ),
    field("purpose", "text", l("Purpose", "Propósito"), true, {
      maxLength: 200,
      example: "Reserve managed media for the spring launch",
    }),
  ],
  "agency-fee-contracts": [
    JOB,
    field(
      "newAgencyFee",
      "money",
      l("New agency fee", "Nuevo fee de agencia"),
      true,
      {
        example: "23000.00",
      }
    ),
    field("reason", "textarea", l("Reason", "Motivo"), true, {
      maxLength: 1000,
      example: "Scope change adds 40 hours of creative rework.",
    }),
  ],
  "agency-billing-requirements": [
    JOB,
    field(
      "deliverableAccepted",
      "boolean",
      l("Deliverable accepted by client", "Entregable aceptado por el cliente"),
      true,
      { example: true }
    ),
    field(
      "poNumber",
      "text",
      l("Client PO number", "Número de PO del cliente"),
      false,
      {
        maxLength: 60,
        example: "DEMO-PO-AUR-002",
      }
    ),
    field(
      "acceptanceEvidence",
      "evidence",
      l("Acceptance evidence", "Evidencia de aceptación"),
      false,
      {
        help: l(
          "Reviewed client acceptance linked to this job.",
          "Aceptación del cliente revisada y vinculada a este trabajo."
        ),
      }
    ),
    field("notes", "textarea", l("Notes", "Notas"), false, {
      maxLength: 500,
    }),
  ],

  // M03 Work & production
  "agency-tasks-timesheets": [
    JOB,
    field("taskTitle", "text", l("Task", "Tarea"), true, {
      maxLength: 160,
      example: "Scope change creative rework",
    }),
    field("member", "member", l("Person", "Persona"), true),
    field("workDate", "date", l("Work date", "Fecha de trabajo"), true, {
      example: "2027-03-18",
    }),
    field("minutes", "minutes", l("Time worked", "Tiempo trabajado"), true, {
      help: l("In minutes. 2400 = 40 hours.", "En minutos. 2400 = 40 horas."),
      min: 1,
      max: 600000,
      example: 2400,
    }),
    field(
      "hourlyCost",
      "money",
      l("Internal hourly cost", "Costo interno por hora"),
      true,
      {
        example: "50.00",
      }
    ),
    field("notes", "textarea", l("Notes", "Notas"), false, { maxLength: 500 }),
  ],
  "agency-production-estimating": [
    JOB,
    field(
      "laborMinutes",
      "minutes",
      l("Internal labor time", "Tiempo interno de trabajo"),
      true,
      {
        help: l(
          "In minutes. 8400 = 140 hours.",
          "En minutos. 8400 = 140 horas."
        ),
        min: 0,
        max: 600000,
        example: 8400,
      }
    ),
    field(
      "hourlyCost",
      "money",
      l("Internal hourly cost", "Costo interno por hora"),
      true,
      {
        example: "50.00",
      }
    ),
    field(
      "productionVendorAmount",
      "money",
      l("Production vendor amount", "Importe del proveedor de producción"),
      true,
      { example: "5500.00" }
    ),
    field(
      "expenseAmount",
      "money",
      l("Expense amount", "Importe de gastos"),
      true,
      {
        example: "500.00",
      }
    ),
    field("reason", "textarea", l("Reason", "Motivo"), true, {
      maxLength: 1000,
      example: "Estimate updated after the creative scope change.",
    }),
  ],
  "agency-production": [
    JOB,
    field("deliverable", "text", l("Deliverable", "Entregable"), true, {
      maxLength: 160,
      example: "Aurora spring hero film",
    }),
    field(
      "deliveryDate",
      "date",
      l("Delivery date", "Fecha de entrega"),
      true,
      {
        example: "2027-03-22",
      }
    ),
    field("assetFile", "file", l("Asset file", "Archivo del activo"), true),
    field(
      "rightsCleared",
      "boolean",
      l("Usage rights cleared", "Derechos de uso liberados"),
      true,
      { example: true }
    ),
    field(
      "qualityResult",
      "enum",
      l("Quality check result", "Resultado del control de calidad"),
      true,
      {
        options: [
          opt("passed", "Passed", "Aprobado"),
          opt("needs_rework", "Needs rework", "Requiere correcciones"),
          opt("failed", "Failed", "Rechazado"),
        ],
        example: "passed",
      }
    ),
    field(
      "qcNotes",
      "textarea",
      l("Quality notes", "Notas de calidad"),
      false,
      {
        maxLength: 1000,
      }
    ),
  ],

  // M04 Media planning
  "agency-media-ranking": [
    JOB,
    field("objective", "enum", l("Objective", "Objetivo"), true, {
      options: [
        opt("awareness", "Awareness", "Reconocimiento"),
        opt("reach", "Reach", "Alcance"),
        opt("conversions", "Conversions", "Conversiones"),
      ],
      example: "reach",
    }),
    field("market", "enum", l("Market", "Mercado"), true, {
      options: COUNTRIES,
      example: "US",
    }),
    field(
      "targetAudience",
      "text",
      l("Target audience", "Audiencia objetivo"),
      true,
      {
        maxLength: 160,
        example: "Adults 25-44, urban",
      }
    ),
    field(
      "flightStart",
      "date",
      l("Flight start", "Inicio de la pauta"),
      true,
      {
        example: "2027-03-01",
      }
    ),
    field("flightEnd", "date", l("Flight end", "Fin de la pauta"), true, {
      example: "2027-03-31",
    }),
    field(
      "reachWeightBps",
      "bps",
      l("Reach weight", "Peso del alcance"),
      true,
      {
        help: l(
          "In basis points. The remainder weights cost. 6000 = 60%.",
          "En puntos base. El resto pondera el costo. 6000 = 60 %."
        ),
        min: 0,
        max: 10000,
        example: 6000,
      }
    ),
    field(
      "audienceSource",
      "file",
      l("Synthetic audience source", "Fuente de audiencia sintética"),
      false
    ),
  ],
  "agency-media-planning": [
    JOB,
    field("channel", "enum", l("Channel", "Canal"), true, {
      options: CHANNELS,
      example: "meta",
    }),
    field("placement", "text", l("Placement", "Ubicación"), true, {
      maxLength: 120,
      example: "Demo Feed",
    }),
    field(
      "plannedAmount",
      "money",
      l("Planned amount", "Importe planificado"),
      true,
      {
        example: "10000.00",
      }
    ),
    field(
      "flightStart",
      "date",
      l("Flight start", "Inicio de la pauta"),
      true,
      {
        example: "2027-03-01",
      }
    ),
    field("flightEnd", "date", l("Flight end", "Fin de la pauta"), true, {
      example: "2027-03-31",
    }),
    field("audience", "text", l("Audience", "Audiencia"), false, {
      maxLength: 160,
      example: "Adults 25-44, urban",
    }),
  ],
  "agency-tv-radio-planning": [
    JOB,
    field("medium", "enum", l("Medium", "Medio"), true, {
      options: [
        opt("radio", "Radio", "Radio"),
        opt("tv", "Television", "Televisión"),
      ],
      example: "radio",
    }),
    field("station", "text", l("Station", "Emisora"), true, {
      help: l(
        "Fictitious station for this demo.",
        "Emisora ficticia para esta demo."
      ),
      maxLength: 120,
      example: "Fictional City Radio",
    }),
    field(
      "spotCount",
      "integer",
      l("Number of spots", "Cantidad de spots"),
      true,
      {
        min: 1,
        max: 500,
        example: 20,
      }
    ),
    field(
      "spotDurationSeconds",
      "integer",
      l("Spot duration (seconds)", "Duración del spot (segundos)"),
      true,
      {
        min: 5,
        max: 120,
        example: 30,
      }
    ),
    field("unitCost", "money", l("Cost per spot", "Costo por spot"), true, {
      example: "100.00",
    }),
    field(
      "flightStart",
      "date",
      l("Flight start", "Inicio de la pauta"),
      true,
      {
        example: "2027-03-01",
      }
    ),
    field("flightEnd", "date", l("Flight end", "Fin de la pauta"), true, {
      example: "2027-03-31",
    }),
  ],
  "agency-ooh-planning": [
    JOB,
    field("site", "text", l("Site", "Sitio"), true, {
      help: l(
        "Fictitious site for this demo.",
        "Sitio ficticio para esta demo."
      ),
      maxLength: 120,
      example: "Fictional Station Faces A/B",
    }),
    field("faces", "integer", l("Number of faces", "Cantidad de caras"), true, {
      min: 1,
      max: 50,
      example: 2,
    }),
    field("unitRate", "money", l("Rate per face", "Tarifa por cara"), true, {
      example: "1000.00",
    }),
    field("flightStart", "date", l("Start date", "Fecha de inicio"), true, {
      example: "2027-03-10",
    }),
    field("flightEnd", "date", l("End date", "Fecha de fin"), true, {
      example: "2027-03-24",
    }),
    field(
      "evidenceType",
      "enum",
      l("Proof required", "Evidencia requerida"),
      false,
      {
        options: [
          opt("photo", "Installation photo", "Foto de instalación"),
          opt("proof_of_play", "Proof of play", "Prueba de reproducción"),
        ],
        example: "photo",
      }
    ),
  ],
  "agency-digital-planning": [
    JOB,
    field(
      "connection",
      "connection",
      l("Ad account", "Cuenta publicitaria"),
      true,
      {
        help: l("Simulated account.", "Cuenta simulada."),
      }
    ),
    field("objective", "enum", l("Objective", "Objetivo"), true, {
      options: [
        opt("awareness", "Awareness", "Reconocimiento"),
        opt("traffic", "Traffic", "Tráfico"),
        opt("conversions", "Conversions", "Conversiones"),
      ],
      example: "conversions",
    }),
    field("budget", "money", l("Budget", "Presupuesto"), true, {
      example: "10000.00",
    }),
    field("placement", "text", l("Placement", "Ubicación"), true, {
      maxLength: 120,
      example: "Demo Feed",
    }),
    field(
      "conversionEvent",
      "text",
      l("Conversion event", "Evento de conversión"),
      false,
      {
        maxLength: 80,
        example: "purchase_demo",
      }
    ),
    field(
      "creativeFile",
      "file",
      l("Creative file", "Archivo creativo"),
      false
    ),
  ],
  "agency-plan-changes": [
    JOB,
    field(
      "baseRevision",
      "integer",
      l("Revision to change", "Revisión a modificar"),
      true,
      {
        min: 1,
        max: 99,
        example: 1,
      }
    ),
    field("channel", "enum", l("Channel", "Canal"), true, {
      options: CHANNELS,
      example: "meta",
    }),
    field(
      "newAmount",
      "money",
      l("New line amount", "Nuevo importe de la línea"),
      true,
      {
        example: "9000.00",
      }
    ),
    field(
      "offsetChannel",
      "enum",
      l("Move the difference to", "Mover la diferencia a"),
      false,
      {
        help: l(
          "The difference is added to (or taken from) this line, so the plan total stays the same.",
          "La diferencia se suma (o se resta) a esta línea, así el total del plan no cambia."
        ),
        options: CHANNELS,
        example: "google",
      }
    ),
    field(
      "reasonCategory",
      "enum",
      l("Reason category", "Categoría del motivo"),
      true,
      {
        options: [
          opt("client_request", "Client request", "Solicitud del cliente"),
          opt("market_change", "Market change", "Cambio de mercado"),
          opt("supplier_change", "Supplier change", "Cambio de proveedor"),
          opt("correction", "Correction", "Corrección"),
        ],
        example: "market_change",
      }
    ),
    field("reason", "textarea", l("Reason", "Motivo"), true, {
      help: l(
        "The earlier approval stops being valid for the changed lines.",
        "La aprobación anterior deja de ser válida para las líneas modificadas."
      ),
      maxLength: 1000,
      example: "Move 1,000 from Meta to Google search based on early results.",
    }),
  ],

  // M05 Media buying
  "agency-rate-cards-contracts": [
    field("supplier", "supplier", l("Supplier", "Proveedor"), true),
    field("medium", "enum", l("Medium", "Medio"), true, {
      options: [
        opt("digital", "Digital", "Digital"),
        opt("tv", "Television", "Televisión"),
        opt("radio", "Radio", "Radio"),
        opt("ooh", "Out-of-home (OOH)", "Exterior (OOH)"),
      ],
      example: "radio",
    }),
    field("validFrom", "date", l("Valid from", "Vigente desde"), true, {
      example: "2027-03-01",
    }),
    field("validTo", "date", l("Valid until", "Vigente hasta"), true, {
      example: "2027-12-31",
    }),
    field("grossRate", "money", l("Gross rate", "Tarifa bruta"), true, {
      example: "1000.00",
    }),
    field(
      "firstDiscountBps",
      "bps",
      l("First discount", "Primer descuento"),
      false,
      {
        help: l("In basis points. 1000 = 10%.", "En puntos base. 1000 = 10 %."),
        min: 0,
        max: 10000,
        example: 1000,
      }
    ),
    field(
      "secondDiscountBps",
      "bps",
      l("Second discount", "Segundo descuento"),
      false,
      {
        help: l(
          "Applied after the first discount. 500 = 5%.",
          "Se aplica después del primer descuento. 500 = 5 %."
        ),
        min: 0,
        max: 10000,
        example: 500,
      }
    ),
  ],
  "agency-media-buying": [
    JOB,
    field("supplier", "supplier", l("Supplier", "Proveedor"), true),
    field("channel", "enum", l("Channel", "Canal"), true, {
      options: CHANNELS,
      example: "meta",
    }),
    field(
      "planRevision",
      "integer",
      l("Approved plan revision", "Revisión de plan aprobada"),
      true,
      {
        min: 1,
        max: 99,
        example: 2,
      }
    ),
    field(
      "orderAmount",
      "money",
      l("Order amount", "Importe de la orden"),
      true,
      {
        example: "9000.00",
      }
    ),
    field(
      "poNumber",
      "text",
      l("Client PO number", "Número de PO del cliente"),
      false,
      {
        maxLength: 60,
        example: "DEMO-PO-AUR-002",
      }
    ),
    field(
      "connection",
      "connection",
      l("Ad account", "Cuenta publicitaria"),
      false
    ),
  ],
  "agency-campaign-activation": [
    JOB,
    field(
      "connection",
      "connection",
      l("Ad account", "Cuenta publicitaria"),
      true,
      {
        help: l("Simulated account.", "Cuenta simulada."),
      }
    ),
    field(
      "planRevision",
      "integer",
      l("Approved plan revision", "Revisión de plan aprobada"),
      true,
      {
        help: l(
          "Activation is blocked if the plan changed after approval.",
          "La activación se bloquea si el plan cambió después de la aprobación."
        ),
        min: 1,
        max: 99,
        example: 2,
      }
    ),
    field("creativeFile", "file", l("Creative file", "Archivo creativo"), true),
    field(
      "rightsCleared",
      "boolean",
      l("Usage rights cleared", "Derechos de uso liberados"),
      true,
      {
        example: true,
      }
    ),
    field(
      "landingUrl",
      "text",
      l("Landing page URL", "URL de la página de destino"),
      false,
      {
        maxLength: 200,
        example: "https://aurora.example/spring",
      }
    ),
    field(
      "conversionEvent",
      "text",
      l("Conversion event", "Evento de conversión"),
      false,
      {
        maxLength: 80,
        example: "purchase_demo",
      }
    ),
  ],
  "agency-campaign-optimization": [
    JOB,
    field("objective", "enum", l("Objective", "Objetivo"), true, {
      options: [
        opt("reach", "Reach", "Alcance"),
        opt("conversions", "Conversions", "Conversiones"),
        opt("cost_efficiency", "Cost efficiency", "Eficiencia de costo"),
      ],
      example: "conversions",
    }),
    field(
      "metricsFile",
      "file",
      l("Synthetic metrics file", "Archivo de métricas sintéticas"),
      true
    ),
    field("metricsAsOf", "date", l("Metrics as of", "Métricas al"), true, {
      help: l(
        "Stale metrics block budget increases.",
        "Las métricas vencidas bloquean aumentos de presupuesto."
      ),
      example: "2027-03-15",
    }),
    field(
      "maxShiftBps",
      "bps",
      l("Maximum budget shift", "Cambio máximo de presupuesto"),
      true,
      {
        help: l(
          "Ceiling per line, in basis points. 1000 = 10%.",
          "Tope por línea, en puntos base. 1000 = 10 %."
        ),
        min: 0,
        max: 10000,
        example: 1000,
      }
    ),
  ],
  "agency-transmission-control": [
    JOB,
    field("station", "text", l("Station", "Emisora"), true, {
      maxLength: 120,
      example: "Fictional City Radio",
    }),
    field(
      "orderedSpots",
      "integer",
      l("Ordered spots", "Spots ordenados"),
      true,
      {
        min: 1,
        max: 500,
        example: 20,
      }
    ),
    field(
      "monitoringFile",
      "file",
      l("Emission records", "Registros de emisión"),
      true
    ),
    field(
      "toleranceSpots",
      "integer",
      l("Tolerance (spots)", "Tolerancia (spots)"),
      true,
      {
        min: 0,
        max: 50,
        example: 0,
      }
    ),
    field(
      "requestMakeGood",
      "boolean",
      l(
        "Request make-good for missing spots",
        "Solicitar compensación por spots faltantes"
      ),
      false,
      {
        example: true,
      }
    ),
  ],
  "agency-ooh-inventory": [
    JOB,
    field("action", "enum", l("Action", "Acción"), true, {
      options: [
        opt("check", "Check availability", "Consultar disponibilidad"),
        opt("reserve", "Reserve", "Reservar"),
      ],
      example: "reserve",
    }),
    field("face", "text", l("Face ID", "ID de cara"), true, {
      help: l(
        "Fictitious face for this demo.",
        "Cara ficticia para esta demo."
      ),
      maxLength: 80,
      example: "face_demo_a",
    }),
    field("startDate", "date", l("Start date", "Fecha de inicio"), true, {
      example: "2027-03-10",
    }),
    field("endDate", "date", l("End date", "Fecha de fin"), true, {
      example: "2027-03-24",
    }),
    field("operator", "supplier", l("Operator", "Operador"), true),
  ],

  // M06 Suppliers & payments
  "agency-delivery-reconciliation": [
    JOB,
    field("supplier", "supplier", l("Supplier", "Proveedor"), true),
    field(
      "invoiceNumber",
      "text",
      l("Supplier invoice number", "Número de factura del proveedor"),
      true,
      {
        maxLength: 60,
        example: "DEMO-LUM-031",
      }
    ),
    field(
      "invoiceAmount",
      "money",
      l("Invoice amount", "Importe de la factura"),
      true,
      {
        example: "6000.00",
      }
    ),
    field("tolerance", "money", l("Tolerance", "Tolerancia"), true, {
      help: l(
        "Largest difference allowed before payment is held.",
        "Mayor diferencia permitida antes de retener el pago."
      ),
      example: "0.00",
    }),
    field(
      "invoiceFile",
      "file",
      l("Invoice file", "Archivo de la factura"),
      false
    ),
  ],
  "agency-payables": [
    field("supplier", "supplier", l("Supplier", "Proveedor"), true),
    JOB,
    field(
      "invoiceNumber",
      "text",
      l("Invoice number", "Número de factura"),
      true,
      {
        maxLength: 60,
        example: "DEMO-LUM-031",
      }
    ),
    field("invoiceDate", "date", l("Invoice date", "Fecha de factura"), true, {
      example: "2027-03-22",
    }),
    field("dueDate", "date", l("Due date", "Fecha de vencimiento"), false, {
      example: "2027-04-21",
    }),
    field(
      "invoiceAmount",
      "money",
      l("Invoice amount", "Importe de la factura"),
      true,
      {
        example: "5500.00",
      }
    ),
    field("period", "month", l("Accounting period", "Período contable"), true, {
      example: "2027-03",
    }),
    field(
      "invoiceFile",
      "file",
      l("Invoice file", "Archivo de la factura"),
      false
    ),
  ],
  "agency-payment-run": [
    field(
      "connection",
      "connection",
      l("Bank account", "Cuenta bancaria"),
      true,
      {
        help: l("Simulated bank account.", "Cuenta bancaria simulada."),
      }
    ),
    field("paymentDate", "date", l("Payment date", "Fecha de pago"), true, {
      example: "2027-03-24",
    }),
    field(
      "dueThrough",
      "date",
      l(
        "Include invoices due through",
        "Incluir facturas con vencimiento hasta"
      ),
      true,
      {
        example: "2027-03-31",
      }
    ),
    field(
      "paymentMethod",
      "enum",
      l("Payment method", "Método de pago"),
      true,
      {
        options: [
          opt("bank_transfer", "Bank transfer", "Transferencia bancaria"),
          opt("check", "Check", "Cheque"),
        ],
        example: "bank_transfer",
      }
    ),
    field("batchAmount", "money", l("Batch total", "Total del lote"), true, {
      help: l(
        "Must not exceed the confirmed available cash.",
        "No puede superar el efectivo disponible confirmado."
      ),
      example: "43000.00",
    }),
  ],
  "agency-cash-settlement": [
    field(
      "connection",
      "connection",
      l("Bank account", "Cuenta bancaria"),
      true,
      {
        help: l("Simulated bank account.", "Cuenta bancaria simulada."),
      }
    ),
    field(
      "statementFile",
      "file",
      l("Bank statement file", "Archivo del estado de cuenta"),
      true
    ),
    field(
      "statementDate",
      "date",
      l("Statement date", "Fecha del estado de cuenta"),
      true,
      {
        example: "2027-03-24",
      }
    ),
    field(
      "closingBalance",
      "money",
      l("Closing balance", "Saldo final"),
      true,
      {
        example: "14000.00",
      }
    ),
  ],
  "agency-expenses": [
    JOB,
    field("claimant", "member", l("Claimant", "Solicitante"), true),
    field("receipt", "file", l("Receipt", "Comprobante"), true),
    field("expenseDate", "date", l("Expense date", "Fecha del gasto"), true, {
      example: "2027-03-18",
    }),
    field("amount", "money", l("Amount", "Importe"), true, {
      example: "500.00",
    }),
    field("category", "enum", l("Category", "Categoría"), true, {
      options: [
        opt("travel", "Travel", "Viajes"),
        opt("meals", "Meals", "Comidas"),
        opt(
          "production_supplies",
          "Production supplies",
          "Insumos de producción"
        ),
        opt("software", "Software", "Software"),
        opt("other", "Other", "Otro"),
      ],
      example: "production_supplies",
    }),
    field("description", "text", l("Description", "Descripción"), false, {
      maxLength: 200,
      example: "Props for the hero film shoot",
    }),
  ],

  // M07 Billing & collections
  "agency-client-billing": [
    JOB,
    field("invoiceDate", "date", l("Invoice date", "Fecha de factura"), true, {
      example: "2027-03-22",
    }),
    field("feeAmount", "money", l("Agency fee", "Fee de agencia"), true, {
      example: "23000.00",
    }),
    field(
      "mediaRecoveryAmount",
      "money",
      l("Media recovery", "Recuperación de medios"),
      true,
      {
        help: l(
          "Pass-through media billed to the client. Kept separate from the agency fee.",
          "Medios trasladados al cliente. Se mantienen separados del fee de agencia."
        ),
        example: "30000.00",
      }
    ),
    field(
      "poNumber",
      "text",
      l("Client PO number", "Número de PO del cliente"),
      false,
      {
        maxLength: 60,
        example: "DEMO-PO-AUR-002",
      }
    ),
    field("notes", "textarea", l("Notes", "Notas"), false, { maxLength: 500 }),
  ],
  "agency-collections": [
    JOB,
    field(
      "invoiceNumber",
      "text",
      l("Invoice number", "Número de factura"),
      true,
      {
        maxLength: 60,
        example: "DEMO-INV-0001",
      }
    ),
    field(
      "receiptAmount",
      "money",
      l("Amount received", "Importe recibido"),
      true,
      {
        example: "40000.00",
      }
    ),
    field("receiptDate", "date", l("Receipt date", "Fecha de cobro"), true, {
      example: "2027-03-23",
    }),
    field(
      "receiptReference",
      "text",
      l("Receipt reference", "Referencia del cobro"),
      true,
      {
        help: l(
          "Repeating the same reference does not apply the payment twice.",
          "Repetir la misma referencia no aplica el cobro dos veces."
        ),
        maxLength: 80,
        example: "sim_receipt_collection_demo_first",
      }
    ),
  ],
  "agency-rebates": [
    JOB,
    field("supplier", "supplier", l("Supplier", "Proveedor"), true),
    field("period", "month", l("Period", "Período"), true, {
      example: "2027-03",
    }),
    field("eligibleBase", "money", l("Eligible base", "Base elegible"), true, {
      example: "10000.00",
    }),
    field("rebateRateBps", "bps", l("Rebate rate", "Tasa de rebate"), true, {
      help: l("In basis points. 200 = 2%.", "En puntos base. 200 = 2 %."),
      min: 0,
      max: 10000,
      example: 200,
    }),
    field(
      "clientShareBps",
      "bps",
      l("Client share", "Participación del cliente"),
      true,
      {
        help: l(
          "Share of the rebate returned to the client. 5000 = 50%.",
          "Parte del rebate devuelta al cliente. 5000 = 50 %."
        ),
        min: 0,
        max: 10000,
        example: 5000,
      }
    ),
  ],
  "agency-tax-compliance": [
    JOB,
    field("country", "enum", l("Country", "País"), true, {
      options: [
        ...COUNTRIES,
        opt("UNCONFIGURED", "Not configured", "Sin configurar"),
      ],
      help: l(
        "A country without a fiscal profile is blocked.",
        "Un país sin perfil fiscal se bloquea."
      ),
      example: "US",
    }),
    field(
      "taxProfile",
      "enum",
      l("Demo tax profile", "Perfil fiscal demo"),
      true,
      {
        options: [
          opt("DEMO_NO_TAX", "Demo, no tax", "Demo, sin impuesto"),
          opt(
            "DEMO_SYNTHETIC_5_PERCENT",
            "Demo, synthetic 5%",
            "Demo, 5 % sintético"
          ),
        ],
        help: l(
          "Synthetic profile. Not fiscally valid.",
          "Perfil sintético. Sin validez fiscal."
        ),
        example: "DEMO_SYNTHETIC_5_PERCENT",
      }
    ),
    field("taxableBase", "money", l("Taxable base", "Base imponible"), true, {
      example: "100.00",
    }),
    field(
      "invoiceNumber",
      "text",
      l("Invoice number", "Número de factura"),
      false,
      {
        maxLength: 60,
        example: "DEMO-INV-0001",
      }
    ),
  ],

  // M08 Accounting & close
  "agency-general-ledger": [
    field("job", "job", l("Job", "Trabajo"), false),
    field("period", "month", l("Period", "Período"), true, {
      example: "2027-03",
    }),
    field("businessDate", "date", l("Entry date", "Fecha del asiento"), true, {
      example: "2027-03-22",
    }),
    field("debitAccount", "enum", l("Debit account", "Cuenta al debe"), true, {
      options: LEDGER_ACCOUNTS,
      example: "labor_expense",
    }),
    field("debitAmount", "money", l("Debit amount", "Importe al debe"), true, {
      example: "7000.00",
    }),
    field(
      "creditAccount",
      "enum",
      l("Credit account", "Cuenta al haber"),
      true,
      {
        options: LEDGER_ACCOUNTS,
        example: "payroll_payable",
      }
    ),
    field(
      "creditAmount",
      "money",
      l("Credit amount", "Importe al haber"),
      true,
      {
        help: l(
          "Must equal the debit amount. An unbalanced entry is blocked.",
          "Debe ser igual al importe al debe. Un asiento desbalanceado se bloquea."
        ),
        example: "7000.00",
      }
    ),
    field("memo", "text", l("Description", "Descripción"), true, {
      maxLength: 200,
      example: "Labor recognized for the scope change",
    }),
  ],
  "agency-accruals-revaluation": [
    field(
      "adjustmentType",
      "enum",
      l("Adjustment type", "Tipo de ajuste"),
      true,
      {
        options: [
          opt("accrual", "Accrual", "Provisión"),
          opt("fx_revaluation", "FX revaluation", "Revaluación cambiaria"),
        ],
        example: "fx_revaluation",
      }
    ),
    field("job", "job", l("Job", "Trabajo"), false),
    field("period", "month", l("Period", "Período"), true, {
      example: "2027-03",
    }),
    field("amount", "money", l("Balance amount", "Importe del saldo"), false, {
      help: l(
        "FX revaluation: the balance in the foreign currency (required). Accrual: optional control total of the agency cost to recognize.",
        "Revaluación cambiaria: el saldo en la moneda extranjera (obligatorio). Provisión: total de control opcional del costo de agencia a reconocer."
      ),
      example: "1000.00",
    }),
    field(
      "foreignCurrency",
      "enum",
      l("Foreign currency", "Moneda extranjera"),
      false,
      {
        options: CURRENCIES,
        example: "CAD",
      }
    ),
    field(
      "balanceSide",
      "enum",
      l("Balance type", "Tipo de saldo"),
      false,
      {
        options: [
          opt("payable", "Payable", "Por pagar"),
          opt("receivable", "Receivable", "Por cobrar"),
        ],
        help: l(
          "FX revaluation only. Defaults to payable.",
          "Solo revaluación cambiaria. Por defecto, por pagar."
        ),
        example: "payable",
      }
    ),
    field(
      "previousRate",
      "text",
      l("Previous rate", "Tipo de cambio anterior"),
      false,
      {
        help: l(
          "Decimal rate, for example 0.75.",
          "Tasa decimal, por ejemplo 0.75."
        ),
        maxLength: 12,
        example: "0.75",
      }
    ),
    field(
      "closingRate",
      "text",
      l("Closing rate", "Tipo de cambio de cierre"),
      false,
      {
        help: l(
          "Decimal rate, for example 0.78.",
          "Tasa decimal, por ejemplo 0.78."
        ),
        maxLength: 12,
        example: "0.78",
      }
    ),
  ],
  "agency-fixed-assets": [
    field("assetName", "text", l("Asset name", "Nombre del activo"), true, {
      maxLength: 120,
      example: "Studio camera kit",
    }),
    field("cost", "money", l("Cost", "Costo"), true, {
      example: "1200.00",
    }),
    field(
      "residualValue",
      "money",
      l("Residual value", "Valor residual"),
      true,
      {
        example: "0.00",
      }
    ),
    field(
      "usefulLifeMonths",
      "integer",
      l("Useful life (months)", "Vida útil (meses)"),
      true,
      {
        min: 1,
        max: 600,
        example: 12,
      }
    ),
    field(
      "startDate",
      "date",
      l("Depreciation start", "Inicio de depreciación"),
      true,
      {
        example: "2027-03-01",
      }
    ),
    field(
      "method",
      "enum",
      l("Depreciation method", "Método de depreciación"),
      true,
      {
        options: [
          opt("straight_line", "Straight line", "Línea recta"),
          opt("declining_balance", "Declining balance", "Saldo decreciente"),
        ],
        example: "straight_line",
      }
    ),
    field("job", "job", l("Job (optional)", "Trabajo (opcional)"), false, {
      help: l(
        "Links the asset to a job's reporting group.",
        "Vincula el activo al grupo de reporte de un trabajo."
      ),
    }),
  ],
  "agency-period-close": [
    field("period", "month", l("Period", "Período"), true, {
      example: "2027-03",
    }),
    field("action", "enum", l("Action", "Acción"), true, {
      options: [
        opt("check_readiness", "Check readiness", "Revisar preparación"),
        opt("close", "Close period", "Cerrar período"),
        opt("reopen", "Reopen period", "Reabrir período"),
      ],
      example: "check_readiness",
    }),
    field("reason", "textarea", l("Reason", "Motivo"), false, {
      help: l("Required when reopening.", "Obligatorio al reabrir."),
      maxLength: 500,
    }),
  ],

  // M09 Profitability
  "agency-profitability": [
    JOB,
    field("basis", "enum", l("Basis", "Base"), true, {
      options: BASES,
      help: l(
        "Forecast uses plan and approved estimates. Incurred uses accepted and recognized amounts.",
        "Proyectado usa el plan y las estimaciones aprobadas. Incurrido usa importes aceptados y reconocidos."
      ),
      example: "forecast",
    }),
  ],
  "agency-revenue-budget": [
    field(
      "scenarioName",
      "text",
      l("Scenario name", "Nombre del escenario"),
      true,
      {
        maxLength: 80,
        example: "Spring upside",
      }
    ),
    field("client", "client", l("Client", "Cliente"), false),
    field("periodFrom", "month", l("From month", "Desde el mes"), true, {
      example: "2027-01",
    }),
    field("periodTo", "month", l("To month", "Hasta el mes"), true, {
      example: "2027-12",
    }),
    field(
      "scenarioAmount",
      "money",
      l("Scenario revenue", "Ingreso del escenario"),
      true,
      {
        help: l(
          "Revenue already posted is not changed by a scenario.",
          "El ingreso ya registrado no cambia por un escenario."
        ),
        example: "25000.00",
      }
    ),
    field(
      "allocationDriver",
      "enum",
      l("Allocation driver", "Criterio de asignación"),
      true,
      {
        options: [
          opt("even_monthly", "Evenly by month", "Uniforme por mes"),
          opt(
            "proportional_to_actuals",
            "Proportional to actuals",
            "Proporcional a lo real"
          ),
        ],
        example: "even_monthly",
      }
    ),
  ],
  "agency-cash-forecast": [
    field("openingCash", "money", l("Opening cash", "Efectivo inicial"), true, {
      example: "10000.00",
    }),
    field("currency", "enum", l("Currency", "Moneda"), true, {
      options: CURRENCIES,
      example: "USD",
    }),
    field("asOfDate", "date", l("Cut-off date", "Fecha de corte"), true, {
      example: "2027-03-15",
    }),
    field(
      "horizonDays",
      "integer",
      l("Horizon (days)", "Horizonte (días)"),
      true,
      {
        min: 7,
        max: 365,
        example: 90,
      }
    ),
    field("scenario", "enum", l("Scenario", "Escenario"), true, {
      options: [
        opt("base", "Base", "Base"),
        opt("downside", "Downside", "Adverso"),
      ],
      example: "downside",
    }),
    field(
      "collectionDelayDays",
      "integer",
      l("Collection delay (days)", "Retraso de cobranza (días)"),
      false,
      {
        min: 0,
        max: 120,
        example: 15,
      }
    ),
  ],
  "agency-management-reporting": [
    field("period", "month", l("Period", "Período"), true, {
      example: "2027-03",
    }),
    field("basis", "enum", l("Basis", "Base"), true, {
      options: BASES,
      example: "incurred",
    }),
    field(
      "reportTitle",
      "text",
      l("Report title", "Título del reporte"),
      false,
      {
        maxLength: 120,
        example: "March 2027 management pack",
      }
    ),
    field(
      "includeManagedMedia",
      "boolean",
      l(
        "Show managed media separately",
        "Mostrar medios administrados por separado"
      ),
      false,
      { example: true }
    ),
  ],
}
