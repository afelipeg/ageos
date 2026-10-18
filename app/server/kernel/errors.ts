// Typed domain errors. `code` is stable (UI and assistant map it to localized
// copy); `details` carries only data the actor is allowed to see.

export type DomainErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "revision_conflict"
  | "idempotency_conflict"
  | "blocked_by_rule"
  | "approval_required"
  | "approval_stale"
  | "self_approval"
  | "approver_not_eligible"
  | "capability_disabled"
  | "capability_pending"
  | "insufficient_funds"
  | "client_authority_missing"
  | "connection_revoked"
  | "rate_limited"
  | "internal"

export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly details: Record<string, unknown>
  readonly status: number

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = "DomainError"
    this.code = code
    this.details = details
    this.status = STATUS[code]
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details }
  }
}

const STATUS: Record<DomainErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  revision_conflict: 409,
  idempotency_conflict: 409,
  blocked_by_rule: 422,
  approval_required: 409,
  approval_stale: 409,
  self_approval: 403,
  approver_not_eligible: 403,
  capability_disabled: 409,
  capability_pending: 501,
  insufficient_funds: 422,
  client_authority_missing: 422,
  connection_revoked: 409,
  rate_limited: 429,
  internal: 500,
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError
}

/** Serializable failure for server actions and route handlers. */
export type Failure = {
  ok: false
  error: { code: DomainErrorCode; message: string; details: Record<string, unknown> }
}

export function toFailure(e: unknown): Failure {
  if (isDomainError(e)) return { ok: false, error: e.toJSON() }
  console.error("[ageos] unexpected error", e)
  return {
    ok: false,
    error: { code: "internal", message: "Unexpected error", details: {} },
  }
}
