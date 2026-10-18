// Wire types shared by the scripted driver (server) and the conversation UI
// (page + panel). Message parts are a closed, typed union rendered by an
// allowlisted renderer: no HTML, JSX or code ever travels as a message. The
// only "language" payload is `openui_view.source`, composed by the server from
// fixed templates and validated again in the browser against a closed library.

export type Localized = { en: string; es: string }

export type AssistantContextHint = {
  route: string
  moduleKey: string | null
  record: { type: "job"; id: string } | null
}

export type SourceRefView = {
  recordType: string
  recordId: string
  revision: number | null
  label: string
  href: string
  asOf: string
  basis?: string | null
  currency?: string | null
}

export type SuggestionView = {
  presetId: string
  label: Localized
  description?: Localized
  /** Module key for grouping in the scenario catalog (null = featured journeys). */
  group?: string | null
  /** Shown as a starter chip in the composer. */
  featured?: boolean
  /** Catalog scenario id (ERP-01..ERP-42 or S-*). */
  scenarioId?: string
}

/** Typed display value: money stays exact (minor units as a decimal string). */
export type DisplayValue =
  | { kind: "money"; minor: string; currency: string }
  | { kind: "bps"; bps: number | null }
  | { kind: "minutes"; minutes: number }
  | { kind: "count"; count: number }
  | { kind: "text"; text: string }

export const OPENUI_VIEW_VERSION = "openui-view@1" as const

export type OpenUIViewPart = {
  type: "openui_view"
  version: typeof OPENUI_VIEW_VERSION
  /** Fixed server template that produced `source`. */
  template: "margin_dashboard" | "capability_result"
  skillId: string
  title: Localized
  /** OpenUI Lang program composed by the server from the template + authorized data. */
  source: string
  asOf: string
  currency: string | null
  revision: number | null
  /** Readable alternative rendered when the visual cannot be shown. */
  fallback: { label: Localized; value: DisplayValue }[]
}

export type MessagePart =
  | { type: "text"; template: string; params?: Record<string, string | number | null> }
  | { type: "user_text"; text: string }
  | {
      type: "margin_result"
      job: { id: string; name: string; jobNumber: string; displayReference: string; href: string }
      basis: string
      asOf: string
      currency: string
      agencyFeeMinor: string
      agencyCostMinor: string
      managedMediaMinor: string
      marginMinor: string
      marginBps: number | null
      laborMinutes: number
      definition: string
      jobRevision: number
    }
  | { type: "sources"; refs: SourceRefView[] }
  | {
      type: "input_request"
      field: string
      label: Localized
      options: { value: string; label: string }[]
      runId: string
      /** Field type from the workbench contract (lib/capabilities/input-fields.ts). */
      fieldType?: string
      help?: Localized
      /** Free-text fields: the reply goes through the composer. */
      freeText?: boolean
    }
  | {
      type: "proposal"
      proposalId: string
      digest: string
      state: string
      title: Localized
      rows: { label: Localized; before: string | null; after: string }[]
      impact: { label: Localized; value: string }[]
      requires: "confirmation" | "approval"
      expiresNote?: Localized
      skillId?: string
    }
  | {
      type: "receipt"
      title: Localized
      lines: { label: Localized; value: string; href?: string }[]
      commandId: string | null
      replayed: boolean
    }
  | { type: "blocked"; code: string; message: Localized; details?: Record<string, unknown> }
  | { type: "suggestions"; heading: Localized; items: SuggestionView[] }
  | {
      type: "delegation"
      subagentKey: string
      skillIds: string[]
      objective: Localized
      state: string
      runHref: string | null
    }
  | { type: "trace"; steps: { stepId: string; stepType: string; outcome: string; label: Localized }[] }
  | {
      /** A capability whose handler is not implemented yet: honest registered state. */
      type: "capability_status"
      skillId: string
      label: Localized
      status: "registered" | "disabled"
      actionId: string
      workbenchHref: string
    }
  | {
      /** Outcome of a delegated capability run (query or command). */
      type: "capability_result"
      skillId: string
      label: Localized
      state: "succeeded" | "blocked" | "failed"
      runHref: string
      replayed: boolean
      outputs: { key: string; summary: string }[]
    }
  | {
      /** An approval request created by the command; decided only in Approvals. */
      type: "approval_request"
      approvalId: string
      proposalId: string | null
      skillId: string
      title: Localized
      state: string
      eligibleRoles: string[]
      href: string
    }
  | OpenUIViewPart
  | {
      /** Server-side redaction: content withheld under the viewer's current permissions. */
      type: "restricted"
      reason: "permission" | "record_unavailable"
      permission?: string
      count?: number
    }

export type MessageView = {
  id: string
  role: "user" | "assistant"
  parts: MessagePart[]
  sequence: number
  createdAt: string
  scenarioId: string | null
}

export type RunView = {
  id: string
  scenarioId: string
  scenarioVersion: string
  status: string
  currentStep: string | null
  /**
   * The run is `running` but no worker holds a live lease (crash, lost
   * response or step budget reached): the client may call resume, which
   * continues from the last checkpoint with the same idempotency keys.
   */
  resumable: boolean
}

export type ConversationView = {
  id: string
  title: string
  updatedAt: string
  activeRun: RunView | null
  suggestions: SuggestionView[]
  history: { id: string; title: string; updatedAt: string }[]
}

export type AssistantStateView = {
  conversation: ConversationView | null
  messages: MessageView[]
  suggestions: SuggestionView[]
}
