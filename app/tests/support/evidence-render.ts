// Pure renderers shared by the Vitest assistant acceptance suite and the
// Playwright evidence reporter. No server imports: input is recorded results.

export type CaseStatus = "passed" | "failed" | "skipped" | "not_run" | "pending"

export type AssistantCase = {
  id: string // A01..A18
  title: string
  status: CaseStatus
  layer: "domain/driver (vitest)" | "browser (playwright)"
  test: string
  detail?: string
}

export const ASSISTANT_CASES: Record<string, string> = {
  A01: "Sidebar → page; header → panel; expand/return keep one thread and orchestrator, no duplicate run",
  A02: "“Explain Aurora margin” (+ES): 45% → 35% after extra hours → 43.5% only after the amendment; sources and checkpoint",
  A03: "Create a job with a missing parameter: asks, validates, proposes, confirms, saves one job",
  A04: "Media plan USD 30,000: computed lines and approval before activation",
  A05: "Meta campaign from the plan: plan revision/demo account, controls and sim_* receipt",
  A06: "Catalog and specialist delegation cover the 42 IDs; a delegation runs a real audited command",
  A07: "Viewer asks for a payment; self-approval: server-side block, no effect, no forbidden data",
  A08: "Revision changes after confirm/approve: blocked, new revision required",
  A09: "Agency/role change; foreign conversation URL: no leak of messages, sources, files or events",
  A10: "Navigate after starting “this job”: original snapshot, action target unchanged",
  A11: "Double submit / reconnect / retry: one run, one command, one effect",
  A12: "Reload, close panel, Stop and resume: persisted state; no repeated steps; committed effects visible",
  A13: "Timeout after a simulated effect: outcome unknown and reconciliation of the existing operation",
  A14: "Malicious file / unknown fixture: untrusted data, allowed parser or scope notice, no elevation",
  A15: "Revoked access to a saved source: history restricted to current authorization",
  A16: "Unknown alias, ambiguous case or out-of-checkpoint: offers available cases, changes nothing",
  A17: "Tampering with history / tool output / approval from the browser: server rejects",
  A18: "390/768/1440 px, keyboard, EN/ES and theme: accessible controls, context kept, demo visible",
}

/** Worst status wins: failed > passed > skipped/not_run. */
export function mergeStatus(a: CaseStatus | undefined, b: CaseStatus): CaseStatus {
  if (!a) return b
  if (a === "failed" || b === "failed") return "failed"
  if (a === "passed" || b === "passed") return "passed"
  return a
}

export function renderAssistantAcceptance(cases: AssistantCase[], meta: { generatedAt: string; driver: string; sources: string[] }): string {
  const byId = new Map<string, AssistantCase[]>()
  for (const c of cases) byId.set(c.id, [...(byId.get(c.id) ?? []), c])
  const lines = [
    "# Assistant acceptance — A01–A18 (scripted driver)",
    "",
    `Generated ${meta.generatedAt} from recorded test results (${meta.sources.join(", ")}). Driver: ${meta.driver}. No model or provider is called; every case below is a test that ran, or is marked not run.`,
    "",
    "| ID | Case | Result | Layer · test | Detail |",
    "|---|---|---|---|---|",
  ]
  for (const id of Object.keys(ASSISTANT_CASES)) {
    const rows = byId.get(id) ?? []
    const status = rows.reduce<CaseStatus | undefined>((s, r) => mergeStatus(s, r.status), undefined) ?? "not_run"
    const where = rows.length ? rows.map((r) => `${r.layer}: \`${r.test}\` — ${r.title}`).join("<br>") : "—"
    const detail = rows.map((r) => r.detail).filter(Boolean).join("<br>") || ""
    lines.push(`| ${id} | ${ASSISTANT_CASES[id]} | **${status}** | ${where} | ${detail.replace(/\|/g, "\\|")} |`)
  }
  lines.push("", "`not_run` means no executed test covers the case yet in the recorded runs; it is not a pass.")
  return lines.join("\n") + "\n"
}
