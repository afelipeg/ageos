import { Badge } from "@/components/reui/badge"

// One mapping from domain states to ReUI Badge tones. The label is always
// text (never color alone); callers pass the localized label.
const TONE: Record<string, "success-light" | "info-light" | "warning-light" | "destructive-light" | "primary-light" | "outline"> = {
  ready: "success-light",
  approved: "success-light",
  succeeded: "success-light",
  completed: "success-light",
  executed: "success-light",
  connected_demo: "success-light",
  current: "success-light",
  resolved: "success-light",
  in_progress: "info-light",
  open: "info-light",
  executing: "info-light",
  running: "info-light",
  submitted: "primary-light",
  awaiting_approval: "primary-light",
  awaiting_confirmation: "primary-light",
  waiting_input: "primary-light",
  waiting_confirmation: "primary-light",
  draft: "outline",
  registered: "outline",
  superseded: "outline",
  consumed: "outline",
  ready_to_close: "warning-light",
  stale: "warning-light",
  blocked: "warning-light",
  attention: "warning-light",
  pending_dns: "warning-light",
  outcome_unknown: "warning-light",
  handler_implemented: "info-light",
  scenario_verified: "success-light",
  revoked: "destructive-light",
  rejected: "destructive-light",
  failed: "destructive-light",
  closed: "outline",
  cancelled: "outline",
  interrupted: "outline",
  changes_requested: "warning-light",
}

export function StateBadge({ state, label }: { state: string; label: string }) {
  return <Badge variant={TONE[state] ?? "outline"}>{label}</Badge>
}
