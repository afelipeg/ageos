import type { Permission, Role } from "@/lib/policy"

export type Localized = { readonly en: string; readonly es: string }

export type ModuleKey =
  | "setup"
  | "clients-contracts"
  | "work-production"
  | "media-planning"
  | "media-buying"
  | "suppliers-payments"
  | "billing-collections"
  | "accounting-close"
  | "profitability"

export type NavigationGroup = "operations" | "finance" | "manage"

export type ModuleDefinition = {
  readonly id: string
  readonly key: ModuleKey | string
  readonly label: Localized
  readonly navigationGroup: NavigationGroup | string
  readonly skillIds: readonly string[]
  readonly icon: string
  readonly reuiReferences: readonly string[]
}

/** Verbatim scope contract from cobertura-42-skills.json (generated). */
export type CapabilityContract = {
  readonly skillId: string
  readonly moduleKey: string
  readonly moduleId: string
  readonly actionId: string
  readonly specialistKey: string
  readonly route: string
  readonly label: Localized
  readonly primaryAction: Localized
  readonly deliverableSummary: string
  readonly inputRequirement: string
  readonly inputsFromRepository: string
  readonly outputRequirement: string
  readonly repositoryOutputs: readonly string[]
  readonly calculatorDependencies: readonly string[]
  readonly connectorOptions: readonly string[]
  readonly externalMode: string
  readonly acceptance: {
    readonly positive: string
    readonly negative: string
    readonly testId: string
    readonly sourceAcceptance: string
  }
  readonly completionRequires: readonly string[]
}

// ── Typed input DSL ──
// One field spec drives both the workbench form and the server-side Zod
// schema, so the page and the assistant validate against the same contract.

export type FieldType =
  | "text"
  | "textarea"
  | "enum"
  | "money"
  | "integer"
  | "minutes"
  | "date"
  | "month"
  | "bps"
  | "boolean"
  | "job"
  | "client"
  | "supplier"
  | "connection"
  | "file"
  // Evidence record (reviewed client PO, acceptance…): value is the evidence id.
  | "evidence"
  | "member"

export type FieldSpec = {
  readonly key: string
  readonly type: FieldType
  readonly label: Localized
  readonly required: boolean
  readonly help?: Localized
  /** enum options */
  readonly options?: readonly { readonly value: string; readonly label: Localized }[]
  /** integer/minutes/bps bounds; money bounds are in minor units */
  readonly min?: number
  readonly max?: number
  /** text max length */
  readonly maxLength?: number
  /** Example value shown as an editable default (fixture-aligned). */
  readonly example?: string | number | boolean
}

export type ApprovalMode = "none" | "confirmation" | "approval"

export type ApprovalPolicy = {
  readonly mode: ApprovalMode
  /** Roles eligible to approve when mode === "approval". */
  readonly eligibleRoles?: readonly Role[]
  /** Requester (and proposal creator) may never approve. */
  readonly separationOfDuties: boolean
  readonly note: Localized
}

export type CapabilityGovernance = {
  readonly viewPermission: Permission
  readonly executePermission: Permission
  readonly approval: ApprovalPolicy
  /** Capability IDs that must stay enabled while this one is enabled. */
  readonly dependsOn: readonly string[]
  /** Governance-critical capability that an agency cannot disable. */
  readonly mandatory: boolean
  /** handler or query that implements the contract action */
  readonly handlerKind: "command" | "query"
}

/**
 * registered: contract + route + inputs are in the catalog (all 42).
 * handler_implemented: a server handler executes the action with validation,
 *   persistence and tests.
 * scenario_verified: its E2E scenario (instruction 2) passed with evidence.
 */
export type HandlerStatus = "registered" | "handler_implemented" | "scenario_verified"
