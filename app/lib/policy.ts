// Role → permission matrix. Shared so the UI can explain why an action is
// unavailable; every decision is re-evaluated on the server from the session's
// membership. A browser never grants itself a role or permission.

export const ROLES = [
  "owner",
  "account_manager",
  "finance_approver",
  "producer",
  "viewer",
] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  "workspace.view",
  "assistant.use",
  "clients.manage",
  "jobs.manage",
  "budget.propose",
  "approvals.decide",
  "time.log",
  "time.approve",
  "production.manage",
  "media.plan",
  "media.buy",
  "payables.manage",
  "payments.execute",
  "billing.manage",
  // Prepare a Demo-ledger journal/accrual/depreciation for finance approval (Core-3).
  "ledger.prepare",
  "ledger.post",
  "period.close",
  "reports.view",
  "config.manage",
  // Request a member role/scope change (approved by an owner, never self).
  "access.request",
  "connections.manage",
  "files.read",
  "files.write",
] as const
export type Permission = (typeof PERMISSIONS)[number]

const ALL: Permission[] = [...PERMISSIONS]

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL.filter((p) => p !== "payments.execute" && p !== "ledger.post"),
  account_manager: [
    "workspace.view",
    "assistant.use",
    "access.request",
    "clients.manage",
    "jobs.manage",
    "budget.propose",
    "time.log",
    "time.approve",
    "production.manage",
    "media.plan",
    "media.buy",
    "billing.manage",
    "reports.view",
    "files.read",
    "files.write",
  ],
  finance_approver: [
    "workspace.view",
    "assistant.use",
    "access.request",
    "approvals.decide",
    "payables.manage",
    "payments.execute",
    "billing.manage",
    "ledger.prepare",
    "ledger.post",
    "period.close",
    "reports.view",
    "files.read",
    "files.write",
  ],
  producer: [
    "workspace.view",
    "assistant.use",
    "time.log",
    "production.manage",
    "files.read",
    "files.write",
  ],
  viewer: ["workspace.view", "assistant.use", "reports.view", "files.read"],
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export const PLATFORM_ROLES = ["platform_operator", "platform_admin"] as const
export type PlatformRole = (typeof PLATFORM_ROLES)[number]
