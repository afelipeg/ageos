// Generates docs/qa/coverage-matrix.md from the contracts and the RECORDED
// evidence (never from expectations):
//   route → screen family → primary actions → service/data → permission → tests → last result
//   skill → handler/service → permission → positive/negative/replay (harness) → assistant → browser J10
// Run: pnpm exec tsx tests/support/write-coverage-matrix.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { CAPABILITY_CONTRACTS } from "../../lib/capabilities/catalog.generated"
import { GOVERNANCE } from "../../lib/capabilities/governance"

const APP = process.cwd()
const read = <T>(p: string): T | null => {
  try {
    return JSON.parse(readFileSync(path.join(APP, p), "utf8")) as T
  } catch {
    return null
  }
}

type Route = { id: string; path: string; screen_family: string; authorization: string; primary_actions?: string[]; data_bindings?: string[] }
const contract = read<{ routes: Route[] }>("../rutas-y-pantallas.json")!
const harness = read<{ generatedAt: string; skills: Record<string, { positive: string; negative: string; replay?: string; notes: string[] }> }>("evidence/skill-verification.json")
const coverage = read<{ generatedAt: string; skills: { skillId: string; covered: boolean; runStatus: string; scenarioId: string | null }[] }>("evidence/assistant-tool-coverage.json")
const e2e = read<{ generatedAt: string; database: string | null; routes: { title: string; project: string; status: string }[]; skills: Record<string, { ui: { status: string } }> }>("evidence/demo-e2e-results.json")

const ROUTE_TESTS: Record<string, string[]> = {
  "job-dossier": ["e2e routes.spec (Aurora, demo-lab)", "e2e routes.spec cross-tenant 404", "vitest isolation-governance (getJobDossier)", "e2e journeys J02/J04/J07"],
  "client-detail": ["e2e routes.spec", "e2e cross-tenant 404", "vitest isolation-governance (getClientDetail)"],
  "approval-detail": ["e2e routes.spec (discovered id)", "e2e journeys J04.6", "vitest kernel/audit-deferred-approval", "vitest isolation-governance (Norte cannot open)"],
  approvals: ["e2e routes.spec", "e2e journeys J07.4", "vitest isolation-governance (listApprovals)"],
  "run-detail": ["e2e routes.spec (discovered id)", "vitest isolation-governance (runs invisible cross-tenant)"],
  "file-detail": ["e2e routes.spec (brief)", "e2e cross-tenant 404", "vitest isolation-governance (download route 200/404)", "e2e journeys J08.2"],
  library: ["e2e routes.spec", "e2e journeys J08.1 (upload)"],
  "connection-detail": ["e2e routes.spec (discovered id)", "e2e journeys J08.3/J08.7", "vitest isolation-governance (revoke/restore)"],
  "workflow-workbench": ["e2e routes.spec (all 42)", "e2e journeys J02–J06, J10 (Run)", "vitest skills-acceptance (42 × positive/negative/replay)"],
  "module-desk": ["e2e routes.spec (all 9)", "e2e shell.spec sidebar"],
  assistant: ["e2e routes.spec", "e2e assistant.spec A01/A03/A16 @mutating", "vitest assistant-acceptance A02–A17", "vitest audit-assistant-*"],
  "workspace-home": ["e2e routes.spec", "e2e shell.spec", "e2e visual.spec"],
  "platform-home": ["e2e routes.spec (owner → 404)", "e2e journeys J09.1"],
  "platform-incident": ["e2e routes.spec (owner → 404)", "e2e journeys J09.2/J09.3"],
  "platform-change": ["e2e routes.spec (owner → 404)", "e2e journeys J09.4–J09.6"],
  "setup-wizard": ["e2e routes.spec (discovered)", "e2e journeys J01.2–J01.6"],
  activation: ["e2e routes.spec (discovered)", "e2e journeys J01.7"],
  "control-agencies": ["e2e routes.spec", "e2e journeys J01.1"],
  "control-agency": ["e2e routes.spec (discovered)", "e2e journeys J01.8"],
  "sign-in": ["e2e routes.spec", "e2e shell.spec sign-in gate", "e2e global-setup (real access-code login)"],
}

const routeResult = (r: Route) => {
  const rows = e2e?.routes.filter((x) => x.title.includes(`${r.id} ${r.path}`) || (r.id.startsWith("platform-") && /404 on \/ops/.test(x.title))) ?? []
  if (!rows.length) return "not run"
  return [...new Set(rows.map((x) => `${x.status} (${x.project})`))].join(", ")
}

const lines: string[] = [
  "# QA coverage matrix",
  "",
  `Generated ${new Date().toISOString()} by \`tests/support/write-coverage-matrix.ts\` from the contracts and recorded evidence: harness ${harness?.generatedAt ?? "not run"}, assistant coverage ${coverage?.generatedAt ?? "not run"}, browser E2E ${e2e?.generatedAt ?? "not run"} (database: ${e2e?.database ?? "shared dev server, read-only specs"}).`,
  "",
  "## Routes (31 patterns)",
  "",
  "| Route | Path | Screen family | Primary actions | Data / services | Authorization | Tests | Last browser result |",
  "|---|---|---|---|---|---|---|---|",
  ...contract.routes.map(
    (r) =>
      `| ${r.id} | \`${r.path}\` | ${r.screen_family} | ${(r.primary_actions ?? []).join(", ")} | ${(r.data_bindings ?? []).join(", ")} | ${r.authorization} | ${(ROUTE_TESTS[r.id] ?? ["e2e routes.spec"]).join("<br>")} | ${routeResult(r)} |`
  ),
  "",
  "## Skills (ERP-01..ERP-42)",
  "",
  "Positive/negative/replay come from `tests/integration/skills-acceptance.test.ts` (fresh seed + re-run, every repositoryOutputs key, persisted run + events, negative blocked by the named rule with a whole-database no-side-effect check). Assistant = `tests/integration/assistant-acceptance.test.ts` sweep. Browser = J10 step in `tests/e2e/journeys.spec.ts`.",
  "",
  "| ERP | Skill | Module | View → execute permission | Approval | Positive | Negative | Replay | Assistant | Browser J10 |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...CAPABILITY_CONTRACTS.map((c, i) => {
    const erp = `ERP-${String(i + 1).padStart(2, "0")}`
    const g = GOVERNANCE[c.skillId]!
    const h = harness?.skills[c.skillId]
    const a = coverage?.skills.find((s) => s.skillId === c.skillId)
    const ui = e2e?.skills?.[erp]?.ui.status ?? "not run"
    return `| ${erp} | ${c.skillId} | ${c.moduleKey} | ${g.viewPermission} → ${g.executePermission} | ${g.approval.mode}${g.approval.eligibleRoles ? ` (${g.approval.eligibleRoles.join("/")})` : ""} | ${h?.positive ?? "not run"} | ${h?.negative ?? "not run"} | ${h?.replay ?? "not run"} | ${a ? (a.covered ? `covered (${a.runStatus})` : `NOT covered (${a.runStatus})`) : "not run"} | ${ui} |`
  }),
  "",
  "## Cross-cutting suites",
  "",
  "| Concern | Test file | What it asserts |",
  "|---|---|---|",
  "| Audit B02/B03 | tests/integration/audit-runner-idempotency.test.ts | replay = same request only; conflict on other payload/revision; replay re-checks permission; concurrent double submit = 1 run, 1 effect, no SQL error |",
  "| Audit B04/B05 | tests/integration/audit-assistant-cancel-resume.test.ts | Stop/interrupt honored mid-step; crash after commit → retry/resume never duplicates; lease blocks a second worker; foreign resume = not_found |",
  "| Audit B06 | tests/integration/audit-po-evidence.test.ts | PO evidence must exist, be own-tenant, reviewed, client PO kind, same job, unchanged hash; blocked attempts leave no rows |",
  "| Audit B07 | tests/integration/audit-deferred-approval.test.ts | held approval re-checked at execution: expiry, disabled capability, lost permission, material change |",
  "| Audit B08 | tests/integration/audit-assistant-history.test.ts | revoked reports.view hides persisted margin + sources (restricted marker); restore shows again; owner-scoped thread |",
  "| Audit B09 | tests/integration/audit-job-reference-race.test.ts | concurrent opens for two clients → unique display references |",
  "| Audit F05/F07 | tests/unit/audit-f05-money-sort.test.tsx, tests/unit/format.test.tsx | exact money sort by currency then minor units; invalid → —; agency-zone timestamps with label; business dates never shift |",
  "| Isolation & governance | tests/integration/isolation-governance.test.ts | Rayo vs Norte via domain + real route handlers (search, download, assistant routes, approvals, runs); viewer writes; self-approval; stale revision; revoked scope; insufficient budget; duplicates; strict body; cross-origin |",
  "| Kernel | tests/integration/kernel.test.ts | RLS, margin figures, exact-payload approvals, SoD, client authority, concurrency, runner, simulated provider |",
  "| Browser | tests/e2e/*.spec.ts | see evidence/test-results.md |",
]

mkdirSync(path.join(APP, "docs/qa"), { recursive: true })
writeFileSync(path.join(APP, "docs/qa/coverage-matrix.md"), lines.join("\n") + "\n")
console.log("docs/qa/coverage-matrix.md written")
