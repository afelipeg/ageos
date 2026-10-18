// GENERATED from cobertura-42-skills.json, rutas-y-pantallas.json and
// referencias/agency-erp-matriz-42-skills.json by scripts/generate-catalog.py.
// Do not edit by hand: IDs, routes and contracts are the canonical scope.

import type { CapabilityContract, ModuleDefinition } from "./types"

export const MODULES: readonly ModuleDefinition[] = [
  {
    "id": "M01",
    "key": "setup",
    "label": {
      "en": "Agency setup",
      "es": "Arranque"
    },
    "navigationGroup": "manage",
    "skillIds": [
      "agency-orchestrator",
      "agency-integrations",
      "agency-access-governance",
      "agency-master-data"
    ],
    "icon": "SlidersHorizontal",
    "reuiReferences": [
      "data-grid-filtering-2",
      "solution-agents-4"
    ]
  },
  {
    "id": "M02",
    "key": "clients-contracts",
    "label": {
      "en": "Clients & contracts",
      "es": "Clientes y contratos"
    },
    "navigationGroup": "operations",
    "skillIds": [
      "agency-onboarding",
      "agency-job-lifecycle",
      "agency-contract-po",
      "agency-budget-control",
      "agency-fee-contracts",
      "agency-billing-requirements"
    ],
    "icon": "ContactRound",
    "reuiReferences": [
      "c-data-grid-3"
    ]
  },
  {
    "id": "M03",
    "key": "work-production",
    "label": {
      "en": "Work & production",
      "es": "Trabajo y producción"
    },
    "navigationGroup": "operations",
    "skillIds": [
      "agency-tasks-timesheets",
      "agency-production-estimating",
      "agency-production"
    ],
    "icon": "Clapperboard",
    "reuiReferences": [
      "gantt-1",
      "data-grid-editing-5"
    ]
  },
  {
    "id": "M04",
    "key": "media-planning",
    "label": {
      "en": "Media planning",
      "es": "Planificación de medios"
    },
    "navigationGroup": "operations",
    "skillIds": [
      "agency-media-ranking",
      "agency-media-planning",
      "agency-tv-radio-planning",
      "agency-ooh-planning",
      "agency-digital-planning",
      "agency-plan-changes"
    ],
    "icon": "CalendarRange",
    "reuiReferences": [
      "data-grid-advanced-3"
    ]
  },
  {
    "id": "M05",
    "key": "media-buying",
    "label": {
      "en": "Media buying",
      "es": "Compra de medios"
    },
    "navigationGroup": "operations",
    "skillIds": [
      "agency-rate-cards-contracts",
      "agency-media-buying",
      "agency-campaign-activation",
      "agency-campaign-optimization",
      "agency-transmission-control",
      "agency-ooh-inventory"
    ],
    "icon": "Megaphone",
    "reuiReferences": [
      "data-grid-advanced-1"
    ]
  },
  {
    "id": "M06",
    "key": "suppliers-payments",
    "label": {
      "en": "Suppliers & payments",
      "es": "Proveedores y pagos"
    },
    "navigationGroup": "finance",
    "skillIds": [
      "agency-delivery-reconciliation",
      "agency-payables",
      "agency-payment-run",
      "agency-cash-settlement",
      "agency-expenses"
    ],
    "icon": "WalletCards",
    "reuiReferences": [
      "data-grid-filtering-1"
    ]
  },
  {
    "id": "M07",
    "key": "billing-collections",
    "label": {
      "en": "Billing & collections",
      "es": "Facturación y cobranza"
    },
    "navigationGroup": "finance",
    "skillIds": [
      "agency-client-billing",
      "agency-collections",
      "agency-rebates",
      "agency-tax-compliance"
    ],
    "icon": "ReceiptText",
    "reuiReferences": [
      "data-grid-filtering-1"
    ]
  },
  {
    "id": "M08",
    "key": "accounting-close",
    "label": {
      "en": "Accounting & close",
      "es": "Contabilidad y cierre"
    },
    "navigationGroup": "finance",
    "skillIds": [
      "agency-general-ledger",
      "agency-accruals-revaluation",
      "agency-fixed-assets",
      "agency-period-close"
    ],
    "icon": "BookOpenCheck",
    "reuiReferences": [
      "c-data-grid-3"
    ]
  },
  {
    "id": "M09",
    "key": "profitability",
    "label": {
      "en": "Profitability",
      "es": "Rentabilidad"
    },
    "navigationGroup": "finance",
    "skillIds": [
      "agency-profitability",
      "agency-revenue-budget",
      "agency-cash-forecast",
      "agency-management-reporting"
    ],
    "icon": "ChartNoAxesCombined",
    "reuiReferences": [
      "data-grid-advanced-2"
    ]
  }
] as const

export const CAPABILITY_CONTRACTS: readonly CapabilityContract[] = [
  {
    "skillId": "agency-orchestrator",
    "moduleKey": "setup",
    "moduleId": "M01",
    "actionId": "recomputeJobReadiness",
    "specialistKey": "coordinador",
    "route": "/a/:agencySlug/modules/setup/workflows/agency-orchestrator",
    "label": {
      "en": "Work coordination",
      "es": "Estado del trabajo y dependencias"
    },
    "primaryAction": {
      "en": "Check next steps",
      "es": "Revisar próximos pasos"
    },
    "deliverableSummary": "Estado del trabajo y dependencias",
    "inputRequirement": "Job, revisions, dependencies and period state",
    "inputsFromRepository": "Trusted tenant/client/job ids and JobNumber; JobNumber state and documents with revisions; period state per subledger; approval-circuit configuration; commercial scope; prior checkpoints; run ceilings; available tools.",
    "outputRequirement": "Persisted checkpoint, next steps and blockers",
    "repositoryOutputs": [
      "job_state",
      "dependency_graph",
      "period_gate_status",
      "task_assignments",
      "blockers",
      "approval_requests",
      "checkpoints",
      "next_stage"
    ],
    "calculatorDependencies": [
      "payload_digest",
      "job_number",
      "approval_route"
    ],
    "connectorOptions": [],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "A completed checkpoint survives refresh and action retry creates no duplicate",
      "negative": "An outdated plan revision blocks its dependent purchase",
      "testId": "skill.orchestrator",
      "sourceAcceptance": "Reanudar un job sin repetir una escritura; bloquear etapas dependientes de una revisión obsoleta."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-integrations",
    "moduleKey": "setup",
    "moduleId": "M01",
    "actionId": "configureDemoConnection",
    "specialistKey": "coordinador",
    "route": "/a/:agencySlug/modules/setup/workflows/agency-integrations",
    "label": {
      "en": "Connection coverage",
      "es": "Inventario de capacidades y conexiones por etapa"
    },
    "primaryAction": {
      "en": "Check coverage",
      "es": "Revisar cobertura"
    },
    "deliverableSummary": "Inventario de capacidades y conexiones por etapa",
    "inputRequirement": "Provider, fictitious account, supported capabilities and granted scopes",
    "inputsFromRepository": "Host type; stages in scope; tenant, client and platform account ids from trusted records; enabled marketplace apps and MCP servers; approved tool policy; host approval, sandbox and idempotency support; country context.",
    "outputRequirement": "Saved connection, capability matrix and affected workflows",
    "repositoryOutputs": [
      "capability_inventory",
      "stage_wiring_plan",
      "access_matrix",
      "schema_review",
      "connection_requests",
      "file_mode_plan",
      "gaps"
    ],
    "calculatorDependencies": [],
    "connectorOptions": [
      "composio"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Connected · Demo persists; dependent actions use the selected fictitious account",
      "negative": "Revoked scope blocks only dependent actions and never falls through to another provider",
      "testId": "skill.integrations",
      "sourceAcceptance": "Descubrir scopes reales y mostrar faltantes; una conexión revocada bloquea únicamente las acciones que la necesitan."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-access-governance",
    "moduleKey": "setup",
    "moduleId": "M01",
    "actionId": "proposeAccessChange",
    "specialistKey": "coordinador",
    "route": "/a/:agencySlug/modules/setup/workflows/agency-access-governance",
    "label": {
      "en": "Access & approval policy",
      "es": "Matriz de acceso y cambios de configuración"
    },
    "primaryAction": {
      "en": "Review access change",
      "es": "Revisar cambio de acceso"
    },
    "deliverableSummary": "Matriz de acceso y cambios de configuración",
    "inputRequirement": "Member, proposed role, effective scope, reason",
    "inputsFromRepository": "Tenant id; users, profiles, roles, specific activities and expense approval caps; agency SoD matrix; security policy; for parameter changes current and proposed values with reason; for offboarding the leaver, successor and owned open items.",
    "outputRequirement": "Diff, segregation-of-duties check and approval request",
    "repositoryOutputs": [
      "access_matrix",
      "capability_register",
      "sod_conflicts",
      "access_change_requests",
      "config_change_requests",
      "offboarding_plan",
      "audit_evidence_pack"
    ],
    "calculatorDependencies": [
      "payload_digest",
      "approval_route"
    ],
    "connectorOptions": [],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Another authorized person approves and permissions update server-side",
      "negative": "Cross-tenant role change and self-approved finance escalation are rejected",
      "testId": "skill.access-governance",
      "sourceAcceptance": "Usuario de agencia A no accede a conexiones, archivos ni acciones de B, incluyendo subagentes."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-master-data",
    "moduleKey": "setup",
    "moduleId": "M01",
    "actionId": "upsertMasterRecord",
    "specialistKey": "coordinador",
    "route": "/a/:agencySlug/modules/setup/workflows/agency-master-data",
    "label": {
      "en": "Master data",
      "es": "Maestros y equivalencias externas"
    },
    "primaryAction": {
      "en": "Validate master record",
      "es": "Validar maestro"
    },
    "deliverableSummary": "Maestros y equivalencias externas",
    "inputRequirement": "Client/supplier code, normalized identity and external mapping",
    "inputsFromRepository": "Tenant id; master type and payload; current records with usage status; legal identity evidence under restricted access; chart of accounts with observation codes; bridge-account and provisional-master configuration.",
    "outputRequirement": "Saved master, duplicate candidates and code map",
    "repositoryOutputs": [
      "master_change_set",
      "validation_report",
      "duplicate_candidates",
      "ledger_link_map",
      "external_code_map",
      "deactivation_plan",
      "provisional_approval_requests"
    ],
    "calculatorDependencies": [
      "job_number",
      "approval_route"
    ],
    "connectorOptions": [
      "salesforce",
      "attio",
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Repeated import of same provider/account/external ID resolves to one master",
      "negative": "Conflicting legal identity cannot be silently merged",
      "testId": "skill.master-data",
      "sourceAcceptance": "Detectar un proveedor duplicado y conservar los IDs externos correctos al sincronizar."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-onboarding",
    "moduleKey": "clients-contracts",
    "moduleId": "M02",
    "actionId": "createClientIntake",
    "specialistKey": "clientes",
    "route": "/a/:agencySlug/modules/clients-contracts/workflows/agency-onboarding",
    "label": {
      "en": "Client intake",
      "es": "Alta de cliente y brief"
    },
    "primaryAction": {
      "en": "Create client intake",
      "es": "Crear expediente de cliente"
    },
    "deliverableSummary": "Alta de cliente y brief",
    "inputRequirement": "Company, billing profile, brand, brief and contacts",
    "inputsFromRepository": "Tenant id; trade name; billing-client references from trusted CxC records; product names and agreed commission percentages; provisional-master and hierarchy configuration; brief recipients and body; registered contact attendees.",
    "outputRequirement": "Persistent client/brief with intake gaps",
    "repositoryOutputs": [
      "intake_pack",
      "owner_client_draft",
      "billing_client_links",
      "product_drafts",
      "attention_group_plan",
      "provisional_approval_requests",
      "brief_draft",
      "intake_gaps"
    ],
    "calculatorDependencies": [
      "job_number"
    ],
    "connectorOptions": [
      "salesforce",
      "attio",
      "google-drive",
      "notion",
      "microsoft365",
      "dropbox",
      "box"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Aurora client and brief link to its job without a duplicate",
      "negative": "Missing billing identity is a visible blocker, not fabricated data",
      "testId": "skill.onboarding",
      "sourceAcceptance": "Importar cliente/brief sin crear duplicado y registrar faltantes de facturación."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-job-lifecycle",
    "moduleKey": "clients-contracts",
    "moduleId": "M02",
    "actionId": "openOrCloseJob",
    "specialistKey": "clientes",
    "route": "/a/:agencySlug/modules/clients-contracts/workflows/agency-job-lifecycle",
    "label": {
      "en": "Job lifecycle",
      "es": "Apertura y cierre de trabajos"
    },
    "primaryAction": {
      "en": "Open job",
      "es": "Abrir trabajo"
    },
    "deliverableSummary": "Apertura y cierre de trabajos",
    "inputRequirement": "Client/product, typology, period, JobNumber parts or close request",
    "inputsFromRepository": "Tenant ID; titular client and product codes; requested action; start year, typology, billing code and billing client for opens; job content listing with document statuses and open tasks; acting user's department type and level; inactivity-days configuration.",
    "outputRequirement": "Unique JobNumber, status and close readiness",
    "repositoryOutputs": [
      "job_proposal",
      "job_code_check",
      "move_or_substitution_plan",
      "close_readiness",
      "inactive_job_list",
      "job_audit_note"
    ],
    "calculatorDependencies": [
      "job_number",
      "approval_route"
    ],
    "connectorOptions": [
      "salesforce",
      "attio",
      "clickup"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "AURSL7AF0001 is generated and RDS-2027-001 remains only display reference",
      "negative": "Close fails while an order commitment or invoice issue remains",
      "testId": "skill.job-lifecycle",
      "sourceAcceptance": "Asignar JobNumber único; impedir cierre con compromisos o documentos pendientes."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-contract-po",
    "moduleKey": "clients-contracts",
    "moduleId": "M02",
    "actionId": "recordClientAuthority",
    "specialistKey": "clientes",
    "route": "/a/:agencySlug/modules/clients-contracts/workflows/agency-contract-po",
    "label": {
      "en": "Contracts & purchase orders",
      "es": "Contrato, PO, reservas y ruta de facturación"
    },
    "primaryAction": {
      "en": "Validate contract and PO",
      "es": "Validar contrato y PO"
    },
    "deliverableSummary": "Contrato, PO, reservas y ruta de facturación",
    "inputRequirement": "Agreement evidence, PO amount/currency/validity and billing route",
    "inputsFromRepository": "Tenant ID; titular and billing client; signed PO or agreement with signer evidence; amount net of tax, currency and validity; documents to link with creation dates; transfer source document and POs; reserve control type and pool areas.",
    "outputRequirement": "Versioned terms, authority balance and evidence link",
    "repositoryOutputs": [
      "commercial_terms",
      "po_limits",
      "po_link_decisions",
      "po_transfer_proposal",
      "reserve_setup",
      "billing_route",
      "scope_exceptions"
    ],
    "calculatorDependencies": [
      "budget_check",
      "installment_schedule",
      "approval_route"
    ],
    "connectorOptions": [
      "google-drive",
      "notion",
      "microsoft365",
      "dropbox",
      "box"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Initial PO authorizes USD50,000 and approved amendment raises to USD53,000",
      "negative": "Expired/missing approval or mixed-currency PO cannot authorize a new commitment",
      "testId": "skill.contract-po",
      "sourceAcceptance": "Extraer un límite de PO del documento, validarlo y bloquear un compromiso que lo exceda."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-budget-control",
    "moduleKey": "clients-contracts",
    "moduleId": "M02",
    "actionId": "reserveBudget",
    "specialistKey": "clientes",
    "route": "/a/:agencySlug/modules/clients-contracts/workflows/agency-budget-control",
    "label": {
      "en": "Budget control",
      "es": "Presupuesto, crédito y reservas"
    },
    "primaryAction": {
      "en": "Validate reservation",
      "es": "Validar reserva"
    },
    "deliverableSummary": "Presupuesto, crédito y reservas",
    "inputRequirement": "Authorized balance, disjoint consumed/committed/reserved amounts and request",
    "inputsFromRepository": "Tenant ID; billing client; JobNumber; document id, revision and amount; PO or reserve authorized, spent, committed and reserved balances; credit limit, open receivables and approved unbilled work; approval circuit configuration.",
    "outputRequirement": "Atomic reservation and refreshed availability",
    "repositoryOutputs": [
      "budget_check",
      "credit_check",
      "reservation_proposal",
      "balance_revision",
      "blocking_exceptions"
    ],
    "calculatorDependencies": [
      "budget_check",
      "credit_exposure",
      "approval_route"
    ],
    "connectorOptions": [
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo",
      "google-sheets",
      "excel"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "In concurrent USD700 reservations against USD1,000, only one succeeds",
      "negative": "Same request repeated cannot reserve twice; stale revision returns conflict",
      "testId": "skill.budget-control",
      "sourceAcceptance": "Dos operaciones concurrentes no pueden reservar el mismo saldo disponible."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-fee-contracts",
    "moduleKey": "clients-contracts",
    "moduleId": "M02",
    "actionId": "calculateFeeSchedule",
    "specialistKey": "clientes",
    "route": "/a/:agencySlug/modules/clients-contracts/workflows/agency-fee-contracts",
    "label": {
      "en": "Fee agreements",
      "es": "Honorarios, cuotas y liquidación de horas"
    },
    "primaryAction": {
      "en": "Calculate fee",
      "es": "Calcular honorarios"
    },
    "deliverableSummary": "Honorarios, cuotas y liquidación de horas",
    "inputRequirement": "Fixed fee or approved hours/rate, instalments and allocation",
    "inputsFromRepository": "Tenant ID; titular client; signed agreement; fixed or hourly kind and contract type; instalment months and amounts; single currency and rate; media/production split; jobs with percentages or pattern; approved hours and client rates for hourly contracts; open fiscal periods.",
    "outputRequirement": "Saved fee schedule and settlement lines",
    "repositoryOutputs": [
      "fee_contract_draft",
      "instalment_schedule",
      "job_allocation",
      "hourly_settlement",
      "approval_proposal",
      "fee_exceptions"
    ],
    "calculatorDependencies": [
      "hourly_fee_settlement",
      "installment_schedule",
      "allocate",
      "approval_route"
    ],
    "connectorOptions": [
      "harvest",
      "clickup",
      "google-sheets",
      "excel"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Fixed USD20,000 plus USD3,000 amendment, internally approved by finance and supported by separately reviewed synthetic client POv2, yields fee23,000",
      "negative": "Unapproved hours and allocations not totaling source amount are rejected",
      "testId": "skill.fee-contracts",
      "sourceAcceptance": "Calcular fee fijo y por horas con moneda/redondeo explícitos, sin duplicar horas importadas."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-billing-requirements",
    "moduleKey": "clients-contracts",
    "moduleId": "M02",
    "actionId": "evaluateBillingReadiness",
    "specialistKey": "clientes",
    "route": "/a/:agencySlug/modules/clients-contracts/workflows/agency-billing-requirements",
    "label": {
      "en": "Billing readiness",
      "es": "Matriz de requisitos y expediente de emisión"
    },
    "primaryAction": {
      "en": "Check billing requirements",
      "es": "Revisar requisitos de facturación"
    },
    "deliverableSummary": "Matriz de requisitos y expediente de emisión",
    "inputRequirement": "Client checklist, PO, accepted deliverable and attachments",
    "inputsFromRepository": "Requirement catalogue; source documents; client po records; attachments; issued invoices.",
    "outputRequirement": "Per-requirement evidence and issuance readiness",
    "repositoryOutputs": [
      "requirement_matrix",
      "evidence_matches",
      "missing_requirements",
      "issuance_ready",
      "locked_field_changes",
      "owner_requests"
    ],
    "calculatorDependencies": [],
    "connectorOptions": [
      "google-drive",
      "notion",
      "microsoft365",
      "dropbox",
      "box"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Final invoice becomes ready only after acceptance is linked",
      "negative": "Removing required evidence makes issuance blocked server-side",
      "testId": "skill.billing-requirements",
      "sourceAcceptance": "Bloquear factura final si falta PO, aceptación o evidencia requerida por ese cliente."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-tasks-timesheets",
    "moduleKey": "work-production",
    "moduleId": "M03",
    "actionId": "submitAndApproveTimesheet",
    "specialistKey": "produccion",
    "route": "/a/:agencySlug/modules/work-production/workflows/agency-tasks-timesheets",
    "label": {
      "en": "Tasks & timesheets",
      "es": "Horas validadas, valoración y aprobaciones"
    },
    "primaryAction": {
      "en": "Submit timesheet",
      "es": "Enviar hoja de horas"
    },
    "deliverableSummary": "Horas validadas, valoración y aprobaciones",
    "inputRequirement": "Open job, task, staff, date, minutes and rate revision",
    "inputsFromRepository": "Tenant ID; open non-generic JobNumber; task record, three task dates, recipient and actor role; timesheet lines in hundredths with daily total and allocation mode; approved hours with internal cost and client rates; timesheet closing date and configuration flags.",
    "outputRequirement": "Timesheet, approval and valued cost",
    "repositoryOutputs": [
      "task_actions",
      "task_delay_report",
      "timesheet_validation",
      "hour_approval_queue",
      "hour_valuation",
      "chargeability_report",
      "timesheet_close_proposal"
    ],
    "calculatorDependencies": [
      "allocate",
      "hourly_fee_settlement"
    ],
    "connectorOptions": [
      "harvest",
      "clickup",
      "google-sheets",
      "excel"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "140 approved hours at USD50 produce USD7,000 once",
      "negative": "Duplicate imported timesheet or time in closed period is blocked",
      "testId": "skill.tasks-timesheets",
      "sourceAcceptance": "Reimportar la misma semana no duplica horas; horas rechazadas no se facturan."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-production-estimating",
    "moduleKey": "work-production",
    "moduleId": "M03",
    "actionId": "createProductionEstimate",
    "specialistKey": "produccion",
    "route": "/a/:agencySlug/modules/work-production/workflows/agency-production-estimating",
    "label": {
      "en": "Production estimate",
      "es": "Estimación, comparación de proveedores y órdenes"
    },
    "primaryAction": {
      "en": "Calculate estimate",
      "es": "Calcular estimación"
    },
    "deliverableSummary": "Estimación, comparación de proveedores y órdenes",
    "inputRequirement": "Scope, internal hours, vendor quotes and expense lines",
    "inputsFromRepository": "Job number state; production type catalogue; supplier master; estimate header terms; line quotes; client credit position; config flags.",
    "outputRequirement": "Versioned estimate, comparison and purchase proposal",
    "repositoryOutputs": [
      "estimate_draft",
      "estimate_totals",
      "supplier_comparison",
      "client_approval_pack",
      "purchase_order_drafts",
      "post_buy_variance"
    ],
    "calculatorDependencies": [
      "estimate_totals",
      "allocate",
      "credit_exposure"
    ],
    "connectorOptions": [
      "harvest",
      "clickup",
      "google-sheets",
      "excel"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "100h×50 plus5,500 vendor plus500 expenses total11,000",
      "negative": "A quote without currency/quantity cannot be approved",
      "testId": "skill.production-estimating",
      "sourceAcceptance": "Recalcular subtotal, markups y asignaciones; cambio del presupuesto invalida aprobación anterior."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-production",
    "moduleKey": "work-production",
    "moduleId": "M03",
    "actionId": "reviewProductionDelivery",
    "specialistKey": "produccion",
    "route": "/a/:agencySlug/modules/work-production/workflows/agency-production",
    "label": {
      "en": "Production & delivery",
      "es": "Calendario, activos, control de calidad y derechos"
    },
    "primaryAction": {
      "en": "Review deliverable",
      "es": "Revisar entregable"
    },
    "deliverableSummary": "Calendario, activos, control de calidad y derechos",
    "inputRequirement": "Task dates, creative version, rights and QC measurements",
    "inputsFromRepository": "Approved estimate lines; asset versions; deliverable specs; royalty contracts; event staff master; config flags.",
    "outputRequirement": "Delivery checklist, asset state and evidence",
    "repositoryOutputs": [
      "production_schedule",
      "asset_manifest",
      "qa_findings",
      "rights_check",
      "staff_assignment",
      "release_candidates"
    ],
    "calculatorDependencies": [
      "payload_digest",
      "approval_route"
    ],
    "connectorOptions": [
      "clickup",
      "google-drive",
      "microsoft365",
      "dropbox",
      "box"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Approved asset version and rights evidence unlock delivery",
      "negative": "An expired right or failed spec holds release of that version",
      "testId": "skill.production",
      "sourceAcceptance": "Relacionar la versión exacta del creativo con sus derechos y bloquear liberación vencida."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-media-ranking",
    "moduleKey": "media-planning",
    "moduleId": "M04",
    "actionId": "rankMediaOptions",
    "specialistKey": "planificacion",
    "route": "/a/:agencySlug/modules/media-planning/workflows/agency-media-ranking",
    "label": {
      "en": "Audience & media ranking",
      "es": "Ranking y manifest de datos"
    },
    "primaryAction": {
      "en": "Calculate ranking",
      "es": "Calcular ranking"
    },
    "deliverableSummary": "Ranking y manifest de datos",
    "inputRequirement": "Synthetic audience sources, objective, weights and costs",
    "inputsFromRepository": "Open JobNumber and holder client (client rankings); licensed rating book export for one market and period with targets and population data; provider and market code mappings; planning and negotiation targets; time window, weekdays and outlets; rate-card settings and approved FX reference.",
    "outputRequirement": "Reproducible ranking with methodology/as-of/source",
    "repositoryOutputs": [
      "rating_book_manifest",
      "ranking_spec",
      "candidate_table",
      "data_quality_exceptions",
      "commercial_inheritance",
      "planning_handoff"
    ],
    "calculatorDependencies": [
      "audience_metrics"
    ],
    "connectorOptions": [
      "gwi",
      "numeris",
      "nielsen",
      "kantar",
      "google-ads",
      "dv360"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Same inputs/weights yield same ranked candidates and source trace",
      "negative": "Missing licensing/freshness or incomparable audience bases are flagged",
      "testId": "skill.media-ranking",
      "sourceAcceptance": "No comparar ratings de universos incompatibles ni inventar un ranking cuando faltan tarifas o audiencia."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-media-planning",
    "moduleKey": "media-planning",
    "moduleId": "M04",
    "actionId": "saveMediaPlanRevision",
    "specialistKey": "planificacion",
    "route": "/a/:agencySlug/modules/media-planning/workflows/agency-media-planning",
    "label": {
      "en": "Media plan",
      "es": "Plan, calendario, costos y aprobación"
    },
    "primaryAction": {
      "en": "Validate plan",
      "es": "Validar plan"
    },
    "deliverableSummary": "Plan, calendario, costos y aprobación",
    "inputRequirement": "Channel lines, schedule, cost, audiences and approvals",
    "inputsFromRepository": "Open JobNumber with billing client, product, typology, division and billing code; media type and validity; outlets with default vendors and publication types; fee settings; currency and monthly reference FX; rating criterion and targets; contracts and rate cards; approval configuration; authoritative credit limit, open AR and approved-unbilled amounts.",
    "outputRequirement": "Versioned plan, totals, budget checks and approval request",
    "repositoryOutputs": [
      "media_plan",
      "schedule_register",
      "item_pricing",
      "plan_totals",
      "objective_summary",
      "approval_payload",
      "billing_release"
    ],
    "calculatorDependencies": [
      "media_line_cost",
      "discount_cascade",
      "audience_metrics",
      "credit_exposure",
      "plan_diff"
    ],
    "connectorOptions": [
      "meta-ads",
      "google-ads",
      "tiktok-ads",
      "amazon-ads",
      "dv360",
      "netflix",
      "openai-ads",
      "vistar",
      "gwi",
      "numeris",
      "nielsen",
      "kantar"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Six Aurora lines sum to30,000 and are linked to the correct job",
      "negative": "Plan above PO authority cannot advance to client-approved",
      "testId": "skill.media-planning",
      "sourceAcceptance": "Todas las líneas cuadran con presupuesto, moneda, fuente de audiencia y revisión; aprobación ligada al plan exacto."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-tv-radio-planning",
    "moduleKey": "media-planning",
    "moduleId": "M04",
    "actionId": "buildBroadcastSchedule",
    "specialistKey": "planificacion",
    "route": "/a/:agencySlug/modules/media-planning/workflows/agency-tv-radio-planning",
    "label": {
      "en": "TV & radio plan",
      "es": "Pauta, spots, materiales e instrucciones de tráfico"
    },
    "primaryAction": {
      "en": "Validate schedule",
      "es": "Validar pauta"
    },
    "deliverableSummary": "Pauta, spots, materiales e instrucciones de tráfico",
    "inputRequirement": "Fictitious station/program, spot counts, rate, dates and materials",
    "inputsFromRepository": "Saved ranking linked to an open JobNumber; programs with airing days and hours; daypart set and cut-off hour; contracts or rate cards; base duration, pricing mode and coefficient tables; materials with durations and royalty contracts; spot counts or objectives; evaluation provider settings.",
    "outputRequirement": "Spot schedule, cost and traffic instructions",
    "repositoryOutputs": [
      "broadcast_schedule",
      "spot_register",
      "rate_basis",
      "material_distribution",
      "traffic_instructions",
      "evaluation_report"
    ],
    "calculatorDependencies": [
      "media_line_cost",
      "discount_cascade",
      "audience_metrics"
    ],
    "connectorOptions": [
      "mediaocean",
      "freewheel",
      "numeris",
      "nielsen",
      "kantar"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "20 radio spots at100 give2,000 and material duration is validated",
      "negative": "Duplicate spot IDs or unsupported creative duration are rejected",
      "testId": "skill.tv-radio-planning",
      "sourceAcceptance": "Validar fecha/hora local, duración, tarifa y material de cada spot; importar emisiones y obtener post-evaluación."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-ooh-planning",
    "moduleKey": "media-planning",
    "moduleId": "M04",
    "actionId": "proposeOOHPlan",
    "specialistKey": "planificacion",
    "route": "/a/:agencySlug/modules/media-planning/workflows/agency-ooh-planning",
    "label": {
      "en": "OOH plan",
      "es": "Sitios, costos, reservas y evidencia exigida"
    },
    "primaryAction": {
      "en": "Validate placement plan",
      "es": "Validar plan de ubicaciones"
    },
    "deliverableSummary": "Sitios, costos, reservas y evidencia exigida",
    "inputRequirement": "Site faces, dates, unit rates, availability and evidence requirements",
    "inputsFromRepository": "Open JobNumber and plan header; supplier quotes or rate cards per circuit, face or press unit; site, circuit, screen or publication data; tariff type Normal or Package; production, installation, permit and dismantling costs; evidence policy agreed with the client.",
    "outputRequirement": "Site plan, costs and reservation proposal",
    "repositoryOutputs": [
      "site_plan",
      "ooh_line_pricing",
      "cost_schedule",
      "evidence_requirements",
      "booking_proposals",
      "exceptions"
    ],
    "calculatorDependencies": [
      "media_line_cost",
      "discount_cascade",
      "allocate"
    ],
    "connectorOptions": [
      "vistar",
      "broadsign",
      "google-sheets",
      "excel"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Two synthetic faces at1,000 total2,000",
      "negative": "Overlapping exclusive reservation on same face is blocked",
      "testId": "skill.ooh-planning",
      "sourceAcceptance": "Distinguir pantalla digital de soporte estático, ubicación, vigencia y formato compatible."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-digital-planning",
    "moduleKey": "media-planning",
    "moduleId": "M04",
    "actionId": "validateDigitalPlan",
    "specialistKey": "planificacion",
    "route": "/a/:agencySlug/modules/media-planning/workflows/agency-digital-planning",
    "label": {
      "en": "Digital media plan",
      "es": "Plan digital, taxonomía, costos y conciliación"
    },
    "primaryAction": {
      "en": "Run planning checks",
      "es": "Validar plan digital"
    },
    "deliverableSummary": "Plan digital, taxonomía, costos y conciliación",
    "inputRequirement": "Platform/account, objective, placements, taxonomy, currency, creative specs",
    "inputsFromRepository": "Open JobNumber and linked ranking; digital masters (platforms, formats, buy types, calc types, tracking and placement types, AdServers); per-item quantities, rates, vendor, contract and currency; taxonomy templates and external codes; read-only actuals exports; platform invoices registered with taxonomy order codes.",
    "outputRequirement": "Digital plan with ad-spec validation and account mapping",
    "repositoryOutputs": [
      "digital_plan",
      "taxonomy_strings",
      "adserver_costs",
      "actuals_snapshot",
      "invoice_match_register",
      "order_adjustment_proposal"
    ],
    "calculatorDependencies": [
      "media_line_cost",
      "discount_cascade",
      "reconcile",
      "invoice_check"
    ],
    "connectorOptions": [
      "meta-ads",
      "google-ads",
      "tiktok-ads",
      "amazon-ads",
      "dv360",
      "netflix",
      "openai-ads",
      "ga4"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Meta/Google/TikTok/CTV lines retain stable IDs and fictional accounts",
      "negative": "Unmapped advertiser account or invalid placement spec blocks submission",
      "testId": "skill.digital-planning",
      "sourceAcceptance": "Validar objetivo/targeting permitido y conversiones disponibles antes de entregar el plan a compra."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-plan-changes",
    "moduleKey": "media-planning",
    "moduleId": "M04",
    "actionId": "proposePlanRevisionChange",
    "specialistKey": "planificacion",
    "route": "/a/:agencySlug/modules/media-planning/workflows/agency-plan-changes",
    "label": {
      "en": "Plan revisions",
      "es": "Diferencias entre revisiones y acciones sobre órdenes"
    },
    "primaryAction": {
      "en": "Compare revisions",
      "es": "Comparar revisiones"
    },
    "deliverableSummary": "Diferencias entre revisiones y acciones sobre órdenes",
    "inputRequirement": "Before/after revision, line changes, commitments and reason",
    "inputsFromRepository": "Plan number with approved and latest revisions; authenticated change request with reason category and deadline; spot states and order numbers/versions (sent or unsent); authoritative PO and reserve balances; contracts, rate cards, materials and royalty validity for new dates; approval configuration.",
    "outputRequirement": "Diff, deltas, affected orders and approval",
    "repositoryOutputs": [
      "baseline_revision",
      "proposed_revision",
      "line_diff",
      "lock_report",
      "currency_deltas",
      "order_version_actions",
      "approval_pack",
      "verified_receipts",
      "blocked_actions"
    ],
    "calculatorDependencies": [
      "plan_diff",
      "budget_check",
      "approval_route"
    ],
    "connectorOptions": [
      "meta-ads",
      "google-ads",
      "tiktok-ads",
      "amazon-ads",
      "dv360",
      "netflix",
      "openai-ads",
      "vistar",
      "mediaocean",
      "freewheel"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Moving1,000 from Meta to Google preserves total30,000 and creates revision2",
      "negative": "Cannot reduce a line below delivered/committed authority without explicit release",
      "testId": "skill.plan-changes",
      "sourceAcceptance": "Cambio de presupuesto produce diff y nueva aprobación; una aprobación vieja no ejecuta la nueva revisión."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-rate-cards-contracts",
    "moduleKey": "media-buying",
    "moduleId": "M05",
    "actionId": "saveRateCardAgreement",
    "specialistKey": "compra",
    "route": "/a/:agencySlug/modules/media-buying/workflows/agency-rate-cards-contracts",
    "label": {
      "en": "Media rates & agreements",
      "es": "Tarifarios, contratos y saldos"
    },
    "primaryAction": {
      "en": "Calculate applicable rate",
      "es": "Calcular tarifa aplicable"
    },
    "deliverableSummary": "Tarifarios, contratos y saldos",
    "inputRequirement": "Supplier, validity, channel rates, discount cascade and currency",
    "inputsFromRepository": "Medium or provider with media type; holder client or printed scope; currency and exponent; validity; calculation type; base or copy source with coefficient; contract consumption/control type, payment condition, cap, VAT flag, discounts, commission, assignment, rate cards by date range; installment advance % and count; authoritative contract current account for adjustments and transfers; vendor negotiation evidence.",
    "outputRequirement": "Versioned rate card and net pricing",
    "repositoryOutputs": [
      "rate_card_drafts",
      "contract_drafts",
      "installment_schedules",
      "contract_balance_report",
      "adjustment_transfer_proposals",
      "pricing_exceptions"
    ],
    "calculatorDependencies": [
      "discount_cascade",
      "media_line_cost",
      "installment_schedule",
      "budget_check",
      "approval_route"
    ],
    "connectorOptions": [
      "google-drive",
      "microsoft365",
      "dropbox",
      "box",
      "mediaocean",
      "freewheel",
      "google-sheets",
      "excel"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Successive10% and5% discounts on1,000 yield855",
      "negative": "Expired rate card cannot price a new approved order",
      "testId": "skill.rate-cards-contracts",
      "sourceAcceptance": "Aplicar tarifa vigente y cascada de descuentos; no usar una tarifa vencida sin excepción aprobada."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-media-buying",
    "moduleKey": "media-buying",
    "moduleId": "M05",
    "actionId": "issueMediaOrder",
    "specialistKey": "compra",
    "route": "/a/:agencySlug/modules/media-buying/workflows/agency-media-buying",
    "label": {
      "en": "Media orders",
      "es": "Órdenes versionadas, envío y compromisos"
    },
    "primaryAction": {
      "en": "Prepare order",
      "es": "Preparar orden"
    },
    "deliverableSummary": "Órdenes versionadas, envío y compromisos",
    "inputRequirement": "Approved plan line, supplier, rate revision, account and approval",
    "inputsFromRepository": "Client-approved plan and schedule revision; credit limit, open AR and approved unbilled or override approval; outlet and linked vendor per line; rate card or manual buy price; currency and exponent; VAT attributes; split criterion and cut-off; PO numbers; for changes the order number, version, sent status, reason and supplier-invoice status.",
    "outputRequirement": "Order, disjoint commitment and simulated receipt",
    "repositoryOutputs": [
      "order_drafts",
      "order_versions",
      "send_packs",
      "close_reopen_proposals",
      "commitment_updates",
      "supplier_exceptions"
    ],
    "calculatorDependencies": [
      "discount_cascade",
      "media_line_cost",
      "credit_exposure",
      "plan_diff",
      "approval_route"
    ],
    "connectorOptions": [
      "meta-ads",
      "google-ads",
      "tiktok-ads",
      "amazon-ads",
      "dv360",
      "netflix",
      "openai-ads",
      "vistar",
      "mediaocean",
      "freewheel"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Repeating same approved issue command creates one order and commitment",
      "negative": "Unapproved plan or changed account invalidates execution",
      "testId": "skill.media-buying",
      "sourceAcceptance": "Cada orden conserva vínculo a la línea aprobada; resultado incierto se concilia antes de reintentar."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-campaign-activation",
    "moduleKey": "media-buying",
    "moduleId": "M05",
    "actionId": "activateDemoCampaign",
    "specialistKey": "compra",
    "route": "/a/:agencySlug/modules/media-buying/workflows/agency-campaign-activation",
    "label": {
      "en": "Campaign activation",
      "es": "Preflight, IDs externos y comprobantes de ejecución"
    },
    "primaryAction": {
      "en": "Run preflight",
      "es": "Revisar antes de activar"
    },
    "deliverableSummary": "Preflight, IDs externos y comprobantes de ejecución",
    "inputRequirement": "Approved campaign payload, account, creative QA and exact revision",
    "inputsFromRepository": "Approved digital plan and issued order items; platform account with verified write tool; account currency and timezone; item platform, format, buy type, rates, flights and ordered net; budget snapshot and host reservation; taxonomy templates; creatives with rights; URLs and conversion events; authenticated approval reference.",
    "outputRequirement": "Preflight report, simulated external ID and receipt",
    "repositoryOutputs": [
      "activation_proposal",
      "taxonomy_names",
      "preflight_results",
      "external_ids",
      "readback_report",
      "execution_receipts",
      "uncertain_actions"
    ],
    "calculatorDependencies": [
      "payload_digest",
      "budget_check",
      "approval_route"
    ],
    "connectorOptions": [
      "meta-ads",
      "google-ads",
      "tiktok-ads",
      "amazon-ads",
      "dv360",
      "netflix",
      "openai-ads",
      "vistar"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Simulated activation records one campaign effect and persistent receipt",
      "negative": "Changed budget after approval or revoked scope blocks launch",
      "testId": "skill.campaign-activation",
      "sourceAcceptance": "Crear borrador/pausado cuando se soporte; activar solo tras aprobación, comprobar estado externo y no duplicar por timeout."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-campaign-optimization",
    "moduleKey": "media-buying",
    "moduleId": "M05",
    "actionId": "proposeCampaignOptimization",
    "specialistKey": "compra",
    "route": "/a/:agencySlug/modules/media-buying/workflows/agency-campaign-optimization",
    "label": {
      "en": "Campaign optimization",
      "es": "Diagnóstico, propuesta, experimento y recibos"
    },
    "primaryAction": {
      "en": "Prepare optimization proposal",
      "es": "Preparar propuesta de optimización"
    },
    "deliverableSummary": "Diagnóstico, propuesta, experimento y recibos",
    "inputRequirement": "Campaign/day synthetic metrics, objective, ceilings and approved plan",
    "inputsFromRepository": "Approved plan revision with investment, TRP and reach objectives and planning target; dated actuals with source, window, attribution and lag; licensed ratings and universe; committed order and contract amounts; budget snapshot; change history.",
    "outputRequirement": "Evidence-based deterministic proposal and revised budget diff",
    "repositoryOutputs": [
      "diagnostic",
      "objective_deviation",
      "optimization_proposal",
      "experiment_plan",
      "constraint_check",
      "verified_change_receipts"
    ],
    "calculatorDependencies": [
      "audience_metrics",
      "budget_check",
      "plan_diff",
      "approval_route"
    ],
    "connectorOptions": [
      "meta-ads",
      "google-ads",
      "tiktok-ads",
      "amazon-ads",
      "dv360",
      "netflix",
      "openai-ads",
      "vistar",
      "ga4"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Rule detects lower CPA and proposes1,000 reallocation, pending approval",
      "negative": "No automatic spend change occurs when only generating a proposal",
      "testId": "skill.campaign-optimization",
      "sourceAcceptance": "Con datos atrasados no aumentar presupuesto; propuesta respeta techo y conserva resultado de verificación."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-transmission-control",
    "moduleKey": "media-buying",
    "moduleId": "M05",
    "actionId": "reconcileBroadcastDelivery",
    "specialistKey": "compra",
    "route": "/a/:agencySlug/modules/media-buying/workflows/agency-transmission-control",
    "label": {
      "en": "Delivery verification",
      "es": "Conciliación de emisiones y compensaciones"
    },
    "primaryAction": {
      "en": "Reconcile transmissions",
      "es": "Conciliar transmisiones"
    },
    "deliverableSummary": "Conciliación de emisiones y compensaciones",
    "inputRequirement": "Booked spots, synthetic emission records and tolerance",
    "inputsFromRepository": "Ordered spots with station, date, window, material and order version; monitoring file or certificate with provider, timezone, cut-off and hash; default OK and deficient audit codes; code links; tolerance and match options; makegood policy; licensed ratings for post-buy.",
    "outputRequirement": "Matched/missing spots and make-good request",
    "repositoryOutputs": [
      "emission_match",
      "missing_or_extra_insertions",
      "material_exceptions",
      "makegood_register",
      "close_readiness",
      "postbuy_report",
      "finance_handoff"
    ],
    "calculatorDependencies": [
      "spot_match",
      "reconcile"
    ],
    "connectorOptions": [
      "mediaocean",
      "freewheel",
      "broadsign",
      "vistar"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "19/20 emissions produce one missing spot and a corrective request",
      "negative": "Duplicate emission cannot count twice; missing spot is not marked delivered",
      "testId": "skill.transmission-control",
      "sourceAcceptance": "Conciliar orden contra transmisión/proof-of-play; identificar faltantes, duplicados y makegoods."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-ooh-inventory",
    "moduleKey": "media-buying",
    "moduleId": "M05",
    "actionId": "reserveOOHFace",
    "specialistKey": "compra",
    "route": "/a/:agencySlug/modules/media-buying/workflows/agency-ooh-inventory",
    "label": {
      "en": "OOH inventory",
      "es": "Disponibilidad, reservas, caras y órdenes del operador"
    },
    "primaryAction": {
      "en": "Check availability",
      "es": "Consultar disponibilidad"
    },
    "deliverableSummary": "Disponibilidad, reservas, caras y órdenes del operador",
    "inputRequirement": "Fictitious face, availability interval, operator and job",
    "inputsFromRepository": "JobNumber; billboard type and zone; salesperson; OOH rate card and item; tariff type, faces, outings, start date, rate, currency and FX; payment terms and client PO; face states and permits; motifs with shares; posting date; agreement level, validity, type, payment, billable and bonus amounts.",
    "outputRequirement": "Versioned availability, reservation and operator order",
    "repositoryOutputs": [
      "availability_report",
      "reservations",
      "ooh_orders",
      "monthly_suborders",
      "face_motif_assignments",
      "posting_batches",
      "agreement_balances",
      "inventory_exceptions"
    ],
    "calculatorDependencies": [
      "media_line_cost",
      "discount_cascade",
      "allocate",
      "installment_schedule"
    ],
    "connectorOptions": [
      "broadsign",
      "google-sheets",
      "excel"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Two distinct faces reserve once and link to plan lines",
      "negative": "Concurrent overlapping reservation on same face has one winner",
      "testId": "skill.ooh-inventory",
      "sourceAcceptance": "Dos clientes no reservan la misma cara y periodo; mantener separado inventario propio de compra externa."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-delivery-reconciliation",
    "moduleKey": "suppliers-payments",
    "moduleId": "M06",
    "actionId": "reconcileDeliveryInvoice",
    "specialistKey": "proveedores",
    "route": "/a/:agencySlug/modules/suppliers-payments/workflows/agency-delivery-reconciliation",
    "label": {
      "en": "Three-way reconciliation",
      "es": "Cruce de orden, entrega y factura"
    },
    "primaryAction": {
      "en": "Match order, delivery and bill",
      "es": "Cruzar orden, entrega y factura"
    },
    "deliverableSummary": "Cruce de orden, entrega y factura",
    "inputRequirement": "Order5,500, accepted delivery5,500, invoice6,000 and tolerance0",
    "inputsFromRepository": "Supplier document header and declared total; pendings per spot/item/request line with expected net; order close and certification status; estimate approval and PO status; tolerance policy.",
    "outputRequirement": "Three-way match with500 difference and payment hold",
    "repositoryOutputs": [
      "match_result",
      "discrepancies",
      "evidence_links",
      "payable_candidate",
      "writeoff_proposals"
    ],
    "calculatorDependencies": [
      "reconcile",
      "invoice_check",
      "spot_match",
      "approval_route"
    ],
    "connectorOptions": [
      "mediaocean",
      "freewheel",
      "broadsign",
      "vistar",
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Corrected invoice5,500 matches existing cost item",
      "negative": "Invoice6,000 cannot enter payment run until discrepancy resolved",
      "testId": "skill.delivery-reconciliation",
      "sourceAcceptance": "Bloquear factura cuyo importe o entrega no coincide y adjuntar la evidencia correspondiente."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-payables",
    "moduleKey": "suppliers-payments",
    "moduleId": "M06",
    "actionId": "approveSupplierInvoice",
    "specialistKey": "proveedores",
    "route": "/a/:agencySlug/modules/suppliers-payments/workflows/agency-payables",
    "label": {
      "en": "Supplier bills",
      "es": "Recepción, normalización y propuesta de registro"
    },
    "primaryAction": {
      "en": "Validate supplier bill",
      "es": "Validar factura de proveedor"
    },
    "deliverableSummary": "Recepción, normalización y propuesta de registro",
    "inputRequirement": "Supplier, invoice number/currency/date, lines, delivery and period",
    "inputsFromRepository": "Supplier document with type, letter, number, dates, currency, declared total and source hash; saved control; VAT accounts and perceptions; payment term; accounts on media/production/expense types; period status.",
    "outputRequirement": "Normalized invoice, duplicate check and payable",
    "repositoryOutputs": [
      "reception_log",
      "duplicate_check",
      "normalized_invoice",
      "registration_proposal",
      "holds",
      "posting_receipt"
    ],
    "calculatorDependencies": [
      "invoice_check",
      "reconcile",
      "payment_terms",
      "tiered_commission",
      "approval_route"
    ],
    "connectorOptions": [
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo",
      "bill"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "One corrected payable5,500 posts against the existing cost source",
      "negative": "Same supplier/invoice number repeated is held rather than duplicated",
      "testId": "skill.payables",
      "sourceAcceptance": "Detectar factura duplicada por entidad/proveedor/número/importe; registrar una sola vez tras aprobar."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-payment-run",
    "moduleKey": "suppliers-payments",
    "moduleId": "M06",
    "actionId": "executeDemoPaymentBatch",
    "specialistKey": "proveedores",
    "route": "/a/:agencySlug/modules/suppliers-payments/workflows/agency-payment-run",
    "label": {
      "en": "Payment runs",
      "es": "Lista de pagos, retenciones y órdenes bancarias"
    },
    "primaryAction": {
      "en": "Prepare demo payment run",
      "es": "Preparar lote de pagos demo"
    },
    "deliverableSummary": "Lista de pagos, retenciones y órdenes bancarias",
    "inputRequirement": "Eligible invoices, confirmed available cash, active holds, beneficiary accounts, currency and exact approvals",
    "inputsFromRepository": "Payment date, due window, currency, method and bank account; open items with balances and locks; client-collection evidence; supplier tax profiles, overrides and host rates; availability and checkbook state; FX rates.",
    "outputRequirement": "Batch, simulated payments, receipts and status",
    "repositoryOutputs": [
      "payment_list_proposal",
      "payment_orders_draft",
      "withholding_schedule",
      "release_proposal",
      "bank_file_request",
      "approval_requests"
    ],
    "calculatorDependencies": [
      "withholding",
      "payment_terms",
      "aging",
      "fx_revaluation",
      "approval_route"
    ],
    "connectorOptions": [
      "wise",
      "bill",
      "paypal",
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "After collection40,000 raises cash to50,000, atomically reserve and execute approved payments43,000 once, leaving7,000 before final collection",
      "negative": "Payments43,000 against opening cash10,000 are blocked; timeout after effect remains held/unknown until reconciliation, never blindly re-sent",
      "testId": "skill.payment-run",
      "sourceAcceptance": "No fondear con credencial solo lectura; aprobar beneficiario/importe exactos y conciliar timeout antes de repetir."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-cash-settlement",
    "moduleKey": "suppliers-payments",
    "moduleId": "M06",
    "actionId": "reconcileBankTransaction",
    "specialistKey": "proveedores",
    "route": "/a/:agencySlug/modules/suppliers-payments/workflows/agency-cash-settlement",
    "label": {
      "en": "Cash reconciliation",
      "es": "Conciliación bancaria y caja sin aplicar"
    },
    "primaryAction": {
      "en": "Reconcile statement",
      "es": "Conciliar estado de cuenta"
    },
    "deliverableSummary": "Conciliación bancaria y caja sin aplicar",
    "inputRequirement": "Synthetic bank lines, amounts, candidate payments and allocations",
    "inputsFromRepository": "Bank account and statement balances and lines; last definitive reconciliation; treasury movements; portfolio cheques; bank charge details; checkbook and cheque status; card statements; rejection details.",
    "outputRequirement": "Matched/unapplied balances and accounting links",
    "repositoryOutputs": [
      "deposit_proposals",
      "bank_charge_entries",
      "reconciliation_report",
      "cheque_actions",
      "card_statement_match",
      "availability_snapshot",
      "unapplied_cash"
    ],
    "calculatorDependencies": [
      "reconcile",
      "allocate",
      "journal_check",
      "approval_route"
    ],
    "connectorOptions": [
      "wise",
      "stripe",
      "paypal",
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo",
      "bill"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "One bank debit clears one simulated liability without new expense",
      "negative": "Allocation beyond transaction amount and duplicate bank ID are rejected",
      "testId": "skill.cash-settlement",
      "sourceAcceptance": "Webhook repetido no duplica recibo; cuadrar comisiones, moneda y liquidación bancaria."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-expenses",
    "moduleKey": "suppliers-payments",
    "moduleId": "M06",
    "actionId": "submitAndApproveExpense",
    "specialistKey": "proveedores",
    "route": "/a/:agencySlug/modules/suppliers-payments/workflows/agency-expenses",
    "label": {
      "en": "Expense claims",
      "es": "Gastos, rendiciones y diferimientos"
    },
    "primaryAction": {
      "en": "Validate expense claim",
      "es": "Validar rendición"
    },
    "deliverableSummary": "Gastos, rendiciones y diferimientos",
    "inputRequirement": "Job, claimant, receipt, date, amount and category",
    "inputsFromRepository": "Requester or claimant pseudonym; concept, net amount, currency and allocation; configuration flags and approver matrix; contract schedule; sheet lines and receipts; estimate item; fund balance; budget balances.",
    "outputRequirement": "Approved expense, allocation and reimbursement state",
    "repositoryOutputs": [
      "expense_request_drafts",
      "contract_schedule",
      "sheet_review",
      "settlement_proposal",
      "deferral_schedule",
      "budget_check_result",
      "approval_requests"
    ],
    "calculatorDependencies": [
      "allocate",
      "installment_schedule",
      "invoice_check",
      "budget_check",
      "approval_route"
    ],
    "connectorOptions": [
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo",
      "bill",
      "google-drive",
      "microsoft365"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "USD500 expense contributes once to Aurora cost and once to reimbursement cash",
      "negative": "No receipt when required blocks approval; reimbursement never adds second expense",
      "testId": "skill.expenses",
      "sourceAcceptance": "OCR con baja confianza requiere revisión; no registrar dos veces el mismo comprobante."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-client-billing",
    "moduleKey": "billing-collections",
    "moduleId": "M07",
    "actionId": "issueDemoClientInvoice",
    "specialistKey": "facturacion",
    "route": "/a/:agencySlug/modules/billing-collections/workflows/agency-client-billing",
    "label": {
      "en": "Client invoices",
      "es": "Facturas y notas de crédito o débito"
    },
    "primaryAction": {
      "en": "Prepare demo invoice",
      "es": "Preparar factura demo"
    },
    "deliverableSummary": "Facturas y notas de crédito o débito",
    "inputRequirement": "Approved fee23,000, media recovery30,000, requirements and tax profile",
    "inputsFromRepository": "Billing client master; pending to bill extract; billing readiness; tax tables; split codes; advance sale balances.",
    "outputRequirement": "Demo invoice53,000, AR and agency/pass-through split",
    "repositoryOutputs": [
      "billing_selection",
      "invoice_drafts",
      "credit_debit_note_drafts",
      "fee_calculation",
      "split_allocation",
      "billing_exceptions"
    ],
    "calculatorDependencies": [
      "discount_cascade",
      "estimate_totals",
      "payment_terms",
      "allocate",
      "invoice_check",
      "approval_route"
    ],
    "connectorOptions": [
      "stripe",
      "paypal",
      "quickbooks",
      "xero",
      "alegra",
      "siigo",
      "netsuite",
      "facturapi",
      "arca",
      "nuvem-fiscal"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Issuance persists and credits fee23,000 separately from30,000 media recovery",
      "negative": "Missing acceptance, closed period or changed approved payload blocks issue",
      "testId": "skill.client-billing",
      "sourceAcceptance": "Emitir una vez y guardar folio/estado; separar factura comercial de documento fiscal autorizado."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-collections",
    "moduleKey": "billing-collections",
    "moduleId": "M07",
    "actionId": "allocateCollection",
    "specialistKey": "facturacion",
    "route": "/a/:agencySlug/modules/billing-collections/workflows/agency-collections",
    "label": {
      "en": "Collections",
      "es": "Aplicación de cobros y antigüedad de saldos"
    },
    "primaryAction": {
      "en": "Apply demo receipt",
      "es": "Aplicar cobro demo"
    },
    "deliverableSummary": "Aplicación de cobros y antigüedad de saldos",
    "inputRequirement": "Invoice53,000 and receipts40,000 then13,000",
    "inputsFromRepository": "Open items; remittance evidence; withholding certificates; credit limits; tax tables; fx rates; client contacts.",
    "outputRequirement": "Applied collections, open balance and aging",
    "repositoryOutputs": [
      "receipt_proposal",
      "application_plan",
      "withholding_certificates",
      "advance_applications",
      "aging_report",
      "credit_exposure",
      "followup_worklist"
    ],
    "calculatorDependencies": [
      "aging",
      "credit_exposure",
      "allocate",
      "withholding",
      "payment_terms",
      "approval_route"
    ],
    "connectorOptions": [
      "stripe",
      "paypal",
      "wise",
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Unique receipt40,000 credits cash once and allocates AR to13,000 before payments; final receipt13,000 after payments clears AR and cash becomes20,000",
      "negative": "Duplicate provider receipt or idempotency retry cannot credit cash twice; allocations above receipt or invoice outstanding rejected",
      "testId": "skill.collections",
      "sourceAcceptance": "Pago parcial reduce saldo correcto; borrador de recordatorio no se envía sin la autorización prevista."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-rebates",
    "moduleKey": "billing-collections",
    "moduleId": "M07",
    "actionId": "calculateRebateSettlement",
    "specialistKey": "facturacion",
    "route": "/a/:agencySlug/modules/billing-collections/workflows/agency-rebates",
    "label": {
      "en": "Rebates",
      "es": "Base elegible, provisión y rebate al cliente"
    },
    "primaryAction": {
      "en": "Calculate rebate",
      "es": "Calcular rebate"
    },
    "deliverableSummary": "Base elegible, provisión y rebate al cliente",
    "inputRequirement": "Eligible synthetic base, tiers/rate and client share",
    "inputsFromRepository": "Rebate contracts; qualifying orders; registered supplier invoices; prior pendings; fx rates; supplier settlements.",
    "outputRequirement": "Accrual proposal, client share and agency retention",
    "repositoryOutputs": [
      "eligible_base",
      "rebate_calculation",
      "pending_register",
      "provision_proposal",
      "client_rebates",
      "rebate_exceptions"
    ],
    "calculatorDependencies": [
      "tiered_commission",
      "flat_rebate",
      "allocate",
      "approval_route"
    ],
    "connectorOptions": [
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo",
      "google-sheets",
      "excel"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Separate lab base10,000 at2% gives200, split100/100",
      "negative": "Rebate outside eligibility dates is excluded; no change to Aurora fixture",
      "testId": "skill.rebates",
      "sourceAcceptance": "Aplicar tramos del contrato y excluir facturas no elegibles; no reconocer ingreso duplicado."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-tax-compliance",
    "moduleKey": "billing-collections",
    "moduleId": "M07",
    "actionId": "validateDemoTaxProfile",
    "specialistKey": "facturacion",
    "route": "/a/:agencySlug/modules/billing-collections/workflows/agency-tax-compliance",
    "label": {
      "en": "Tax readiness",
      "es": "Autorizaciones, impuestos y exportaciones fiscales"
    },
    "primaryAction": {
      "en": "Check tax readiness",
      "es": "Revisar preparación fiscal"
    },
    "deliverableSummary": "Autorizaciones, impuestos y exportaciones fiscales",
    "inputRequirement": "Entity country, explicit demo profile, invoice basis and tax fields",
    "inputsFromRepository": "Approved document drafts; country tax tables; numbering series; ledger tax balances; sub journals; withholding records.",
    "outputRequirement": "Validation, demo tax calculation and export package",
    "repositoryOutputs": [
      "authorization_requests",
      "numbering_report",
      "vat_books_reconciliation",
      "withholding_perception_schedule",
      "certificate_register",
      "tax_positions",
      "statutory_exports"
    ],
    "calculatorDependencies": [
      "invoice_check",
      "withholding",
      "approval_route"
    ],
    "connectorOptions": [
      "facturapi",
      "arca",
      "nuvem-fiscal",
      "alegra",
      "siigo",
      "quickbooks",
      "xero",
      "netsuite"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Synthetic100 net at5% yields105 gross with non-fiscal demo label",
      "negative": "Unsupported country/profile blocks fiscal emission; no universal LATAM tax claim",
      "testId": "skill.tax-compliance",
      "sourceAcceptance": "País sin adaptador validado permite preparación, pero bloquea emisión/declaración automática y muestra el faltante."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-general-ledger",
    "moduleKey": "accounting-close",
    "moduleId": "M08",
    "actionId": "postDemoJournal",
    "specialistKey": "contabilidad",
    "route": "/a/:agencySlug/modules/accounting-close/workflows/agency-general-ledger",
    "label": {
      "en": "General ledger",
      "es": "Asientos y conciliación contable"
    },
    "primaryAction": {
      "en": "Validate journal",
      "es": "Validar asiento"
    },
    "deliverableSummary": "Asientos y conciliación contable",
    "inputRequirement": "Balanced lines, accounts, currency, period, dimensions and approval",
    "inputsFromRepository": "Fiscal year; period subledger states; locked periods; chart of accounts; voucher types; entry lines; supporting attachment; opening subledger detail.",
    "outputRequirement": "Demo ledger journal and reconciliation reference",
    "repositoryOutputs": [
      "journal_entry_proposal",
      "journal_check_report",
      "coa_change_proposal",
      "opening_balance_reconciliation",
      "integration_difference_report"
    ],
    "calculatorDependencies": [
      "journal_check",
      "allocate",
      "approval_route"
    ],
    "connectorOptions": [
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Approved balanced journal posts once and reports debit=credit",
      "negative": "Unbalanced entry or closed period cannot post",
      "testId": "skill.general-ledger",
      "sourceAcceptance": "Debe y haber cuadran; mapa de cuentas incompleto bloquea publicación en el libro maestro."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-accruals-revaluation",
    "moduleKey": "accounting-close",
    "moduleId": "M08",
    "actionId": "proposeAccrualOrFXAdjustment",
    "specialistKey": "contabilidad",
    "route": "/a/:agencySlug/modules/accounting-close/workflows/agency-accruals-revaluation",
    "label": {
      "en": "Accruals & FX revaluation",
      "es": "Provisiones y revaluación cambiaria"
    },
    "primaryAction": {
      "en": "Calculate adjustment",
      "es": "Calcular ajuste"
    },
    "deliverableSummary": "Provisiones y revaluación cambiaria",
    "inputRequirement": "Uninvoiced delivered cost or foreign balance with two FX rates",
    "inputsFromRepository": "Period subledger states; month end buy sell rates; open foreign currency items; pending billing and supplier items; expense requests without invoice; overcommission pendings; bridge balances by ot; intercompany flags.",
    "outputRequirement": "Accrual/revaluation proposal and reversal schedule",
    "repositoryOutputs": [
      "fx_revaluation_proposal",
      "gross_income_provision_proposal",
      "wip_reclass_proposal",
      "expense_provision_proposal",
      "overcommission_provision_proposal",
      "ot_close_proposal",
      "ic_reclass_proposal",
      "close_job_checklist"
    ],
    "calculatorDependencies": [
      "fx_revaluation",
      "journal_check",
      "tiered_commission",
      "allocate",
      "approval_route"
    ],
    "connectorOptions": [
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Lab CAD1,000 at0.75→0.78 USD generates USD30 payable increase",
      "negative": "Missing FX date/rate or already-reversed accrual cannot be silently processed",
      "testId": "skill.accruals-revaluation",
      "sourceAcceptance": "Recalcular con tipo de cambio/fecha aprobados; no mutar periodo cerrado ni duplicar reversión."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-fixed-assets",
    "moduleKey": "accounting-close",
    "moduleId": "M08",
    "actionId": "calculateAssetDepreciation",
    "specialistKey": "contabilidad",
    "route": "/a/:agencySlug/modules/accounting-close/workflows/agency-fixed-assets",
    "label": {
      "en": "Fixed assets",
      "es": "Registro de activos y depreciación"
    },
    "primaryAction": {
      "en": "Calculate depreciation",
      "es": "Calcular depreciación"
    },
    "deliverableSummary": "Registro de activos y depreciación",
    "inputRequirement": "Asset cost, residual, useful life, start date and method",
    "inputsFromRepository": "Asset concepts; expense request and invoice; purchase value and dates; depreciation method and criterion; cost center mode; period state; disposal details.",
    "outputRequirement": "Schedule and proposed monthly journals",
    "repositoryOutputs": [
      "asset_register_changes",
      "depreciation_run_proposal",
      "disposal_proposal",
      "fixed_asset_annex"
    ],
    "calculatorDependencies": [
      "depreciation_schedule",
      "journal_check",
      "approval_route"
    ],
    "connectorOptions": [
      "xero",
      "quickbooks",
      "alegra",
      "netsuite",
      "siigo",
      "google-sheets",
      "excel"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Lab asset1,200 over12months residual0 gives100 monthly",
      "negative": "Depreciation beyond depreciable base or duplicate month is blocked",
      "testId": "skill.fixed-assets",
      "sourceAcceptance": "Calendario aprobado respeta vida útil, residual y periodo; si API de activos no existe usar registro nativo y asiento revisado."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-period-close",
    "moduleKey": "accounting-close",
    "moduleId": "M08",
    "actionId": "closeAccountingPeriod",
    "specialistKey": "contabilidad",
    "route": "/a/:agencySlug/modules/accounting-close/workflows/agency-period-close",
    "label": {
      "en": "Period close",
      "es": "Checklist, conciliaciones y bloqueo de periodo"
    },
    "primaryAction": {
      "en": "Check close readiness",
      "es": "Revisar preparación de cierre"
    },
    "deliverableSummary": "Checklist, conciliaciones y bloqueo de periodo",
    "inputRequirement": "Subledger readiness, trial balance, open proposals and reconciliations",
    "inputsFromRepository": "Period subledger states; month end rate; close job receipts; trial balance with integrators; unpaid invoices at cutoff; bank reconciliations; reopen or year close request.",
    "outputRequirement": "Close checklist, blockers, approval and immutable snapshot",
    "repositoryOutputs": [
      "close_checklist",
      "close_job_status",
      "post_close_reconciliations",
      "unresolved_balances",
      "lock_proposal",
      "reopen_plan",
      "adjustment_plan"
    ],
    "calculatorDependencies": [
      "journal_check",
      "fx_revaluation",
      "aging",
      "approval_route"
    ],
    "connectorOptions": [
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "After all checks pass, closing locks March demo period",
      "negative": "Open unmatched payable or unbalanced journal blocks close",
      "testId": "skill.period-close",
      "sourceAcceptance": "Impedir cierre con diferencias; bloqueo local no se anuncia como cierre externo sin recibo del sistema contable."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-profitability",
    "moduleKey": "profitability",
    "moduleId": "M09",
    "actionId": "calculateJobProfitability",
    "specialistKey": "rentabilidad",
    "route": "/a/:agencySlug/modules/profitability/workflows/agency-profitability",
    "label": {
      "en": "Job & client profitability",
      "es": "Rentabilidad por job y cliente"
    },
    "primaryAction": {
      "en": "Calculate profitability",
      "es": "Calcular rentabilidad"
    },
    "deliverableSummary": "Rentabilidad por job y cliente",
    "inputRequirement": "Job, period, basis, fee, agency costs and managed spend",
    "inputsFromRepository": "Ledger results by job; approved hours and rates; direct expenses; structural expense pool; managed spend; pending items.",
    "outputRequirement": "Margin bridge with source links and clear forecast/actual basis",
    "repositoryOutputs": [
      "job_pnl",
      "client_profitability",
      "overhead_allocation",
      "margin_bridge",
      "managed_spend",
      "completeness_gaps"
    ],
    "calculatorDependencies": [
      "margin",
      "allocate"
    ],
    "connectorOptions": [
      "harvest",
      "clickup",
      "meta-ads",
      "google-ads",
      "tiktok-ads",
      "amazon-ads",
      "dv360",
      "openai-ads",
      "vistar",
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "20k−11k=9k/45%;20k−13k=7k/35%;23k−13k=10k/43.48%",
      "negative": "Managed media30k cannot enter net agency revenue or agency-cost denominator",
      "testId": "skill.profitability",
      "sourceAcceptance": "Separar gasto de medios administrado de ingreso propio; no duplicar costos entre factura y feed de plataforma."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-revenue-budget",
    "moduleKey": "profitability",
    "moduleId": "M09",
    "actionId": "saveRevenueBudgetScenario",
    "specialistKey": "rentabilidad",
    "route": "/a/:agencySlug/modules/profitability/workflows/agency-revenue-budget",
    "label": {
      "en": "Revenue budget",
      "es": "Versiones del presupuesto e ingresos proyectados"
    },
    "primaryAction": {
      "en": "Compare budget and actual",
      "es": "Comparar presupuesto y real"
    },
    "deliverableSummary": "Versiones del presupuesto e ingresos proyectados",
    "inputRequirement": "Period, approved opportunities/contracts, allocation drivers and scenario",
    "inputsFromRepository": "Tenant ID; budget year, version name and loading method; client x product x division lines with media/supplier or production-type rows; monthly investment, commission and cost-difference bps; projected fees, rebates and refunds; actuals and last closed month; supervisor identity.",
    "outputRequirement": "Versioned forecast, assumption table and actual variance",
    "repositoryOutputs": [
      "budget_version",
      "budget_lines",
      "income_projection",
      "plan_vs_actual",
      "version_lock_proposal",
      "budget_exceptions"
    ],
    "calculatorDependencies": [
      "allocate",
      "margin"
    ],
    "connectorOptions": [
      "google-sheets",
      "excel",
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "New scenario changes projected revenue without changing posted revenue",
      "negative": "Mixed currencies or overwritten approved baseline rejected",
      "testId": "skill.revenue-budget",
      "sourceAcceptance": "Comparar plan y real en moneda/período homogéneos y conservar revisión aprobada."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-cash-forecast",
    "moduleKey": "profitability",
    "moduleId": "M09",
    "actionId": "calculateCashScenario",
    "specialistKey": "rentabilidad",
    "route": "/a/:agencySlug/modules/profitability/workflows/agency-cash-forecast",
    "label": {
      "en": "Cash forecast",
      "es": "Pronóstico de caja y escenarios"
    },
    "primaryAction": {
      "en": "Calculate cash forecast",
      "es": "Calcular proyección de caja"
    },
    "deliverableSummary": "Pronóstico de caja y escenarios",
    "inputRequirement": "Opening cash, expected dated receipts/payments, probabilities and cut-off",
    "inputsFromRepository": "Opening liquidity; ar open items; ap open items; chronic delays; approved unbilled pipeline; payroll capex recurring; holiday calendar.",
    "outputRequirement": "Dated cash table, assumptions and downside scenario",
    "repositoryOutputs": [
      "cash_forecast",
      "currency_buckets",
      "undated_pipeline",
      "collection_scenarios",
      "supplier_exposure",
      "liquidity_gaps"
    ],
    "calculatorDependencies": [
      "cash_projection",
      "payment_terms",
      "aging"
    ],
    "connectorOptions": [
      "stripe",
      "paypal",
      "wise",
      "bill",
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Final fixture10k+53k−43k=20k; forecast distinguished from bank balance",
      "negative": "Counting same collection as invoice and receipt is prevented",
      "testId": "skill.cash-forecast",
      "sourceAcceptance": "Separar confirmado de probable y partidas sin fecha; evitar sumar distintas monedas sin conversión explícita."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  },
  {
    "skillId": "agency-management-reporting",
    "moduleKey": "profitability",
    "moduleId": "M09",
    "actionId": "generateManagementSnapshot",
    "specialistKey": "rentabilidad",
    "route": "/a/:agencySlug/modules/profitability/workflows/agency-management-reporting",
    "label": {
      "en": "Management reporting",
      "es": "Paquete gerencial y exportaciones"
    },
    "primaryAction": {
      "en": "Build management report",
      "es": "Preparar reporte gerencial"
    },
    "deliverableSummary": "Paquete gerencial y exportaciones",
    "inputRequirement": "Tenant/legal entity, period, currency, basis and metric definitions",
    "inputsFromRepository": "Closed period state; trial balance; interface code table; account mapping; ar open items; approved hours; wip items.",
    "outputRequirement": "Persistent report snapshot, sources and downloadable export",
    "repositoryOutputs": [
      "management_pack",
      "mapping_coverage",
      "export_files",
      "kpi_summary",
      "variance_commentary"
    ],
    "calculatorDependencies": [
      "margin",
      "aging",
      "allocate"
    ],
    "connectorOptions": [
      "google-sheets",
      "excel",
      "quickbooks",
      "xero",
      "alegra",
      "netsuite",
      "siigo"
    ],
    "externalMode": "simulated_only",
    "acceptance": {
      "positive": "Exported totals equal query at snapshot revision and disclose synthetic data",
      "negative": "No unlabelled stale report or cross-tenant source appears",
      "testId": "skill.management-reporting",
      "sourceAcceptance": "Cada KPI trazable a datos/versiones y totales conciliados; exportación respeta permisos de agencia/cliente."
    },
    "completionRequires": [
      "typed_inputs",
      "server_validation",
      "persistent_versioned_outputs",
      "valid_fixture",
      "blocked_fixture",
      "refresh_persistence",
      "tenant_and_role_checks"
    ]
  }
] as const
