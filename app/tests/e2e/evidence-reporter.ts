import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter"

import { CAPABILITY_CONTRACTS } from "../../lib/capabilities/catalog.generated"
import { JOURNEYS } from "../../lib/demo/journeys"
import { mergeStatus, renderAssistantAcceptance, type AssistantCase, type CaseStatus } from "../support/evidence-render"

// Writes Milestone C evidence from what actually ran:
//   evidence/demo-e2e-results.json  J01–J10 (per step), ERP-01..42 (harness
//                                   positive/negative + J10 UI run), routes,
//                                   visual matrix, assistant cases, totals
//   evidence/demo-e2e-report.md     the same, readable
//   evidence/assistant-acceptance.md A01–A18 merged with the Vitest record
//                                   (evidence/assistant-acceptance.json)
// A case that did not run is `not_run`, never passed.

type StepRecord = { journey: string; step: string; actor: string; surface: string; performs: string; status: "passed" | "failed"; outcome: string; url: string | null; screenshot: string | null; expected: string }
type Row = { file: string; title: string; project: string; status: CaseStatus; durationMs: number; error: string | null; annotations: { type: string; description?: string }[] }

// Only an explicit evidence run (E2E_EVIDENCE=1, the certification command)
// writes evidence/; any other run (subset, -g, probe) previews under .data/.
const EVIDENCE = path.resolve(process.cwd(), process.env.E2E_EVIDENCE === "1" ? "evidence" : ".data/e2e-output/evidence-preview")
const status = (r: TestResult): CaseStatus => (r.status === "passed" ? "passed" : r.status === "skipped" ? "skipped" : "failed")

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(path.resolve(process.cwd(), "evidence", file), "utf8")) as T
  } catch {
    return null
  }
}

export default class EvidenceReporter implements Reporter {
  private rows: Row[] = []
  private config: FullConfig | null = null
  private startedAt = new Date()

  onBegin(config: FullConfig) {
    this.config = config
    this.startedAt = new Date()
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const file = path.relative(process.cwd(), test.location.file)
    this.rows.push({
      file,
      title: test.titlePath().slice(3).join(" › ") || test.title,
      project: test.parent.project()?.name ?? "",
      status: status(result),
      durationMs: result.duration,
      error: result.error?.message?.split("\n")[0]?.slice(0, 300) ?? null,
      // test.info().annotations surface on both the test and the result: dedupe.
      annotations: [...new Map([...test.annotations, ...result.annotations].map((a) => [`${a.type}:${a.description ?? ""}`, a])).values()],
    })
  }

  onEnd(result: FullResult) {
    // `playwright test --list` or an aborted start runs no test: keep the last evidence.
    if (!this.rows.length) return
    mkdirSync(EVIDENCE, { recursive: true })
    const baseURL = String(this.config?.projects[0]?.use.baseURL ?? "")
    const db = process.env.E2E_DATABASE_URL_MIGRATIONS ? new URL(process.env.E2E_DATABASE_URL_MIGRATIONS).pathname.slice(1) : null

    // Journeys
    const steps = this.rows.flatMap((r) => r.annotations.filter((a) => a.type === "journey-step").map((a) => JSON.parse(a.description!) as StepRecord))
    const journeys = Object.fromEntries(
      JOURNEYS.map((j) => {
        const row = this.rows.find((r) => r.file.endsWith("journeys.spec.ts") && r.title.includes(`${j.id} `))
        const s = steps.filter((x) => x.journey === j.id)
        return [
          j.id,
          {
            name: j.name.en,
            status: row ? row.status : "not_run",
            stepsPassed: s.filter((x) => x.status === "passed").length,
            stepsTotal: j.steps.length,
            test: "tests/e2e/journeys.spec.ts",
            error: row?.error ?? null,
            steps: s,
          },
        ]
      })
    )

    // ERP-01..42: Vitest harness record + the J10 browser run of each workbench
    const harness = readJson<{ generatedAt: string; skills: Record<string, { positive: string; negative: string; replay?: string; notes: string[] }> }>("skill-verification.json")
    const skills = Object.fromEntries(
      CAPABILITY_CONTRACTS.map((c, i) => {
        const erp = `ERP-${String(i + 1).padStart(2, "0")}`
        const h = harness?.skills[c.skillId]
        const ui = steps.find((x) => x.journey === "J10" && x.step === `J10.${i + 1}`)
        return [
          erp,
          {
            skillId: c.skillId,
            moduleKey: c.moduleKey,
            positive: h?.positive ?? "not_run",
            negative: h?.negative ?? "not_run",
            replay: h?.replay ?? "not_run",
            harness: { test: "tests/integration/skills-acceptance.test.ts", ranAt: harness?.generatedAt ?? null, notes: h?.notes ?? [] },
            ui: ui ? { status: ui.status, outcome: ui.outcome, screenshot: ui.screenshot, test: "tests/e2e/journeys.spec.ts (J10)" } : { status: "not_run" },
          },
        ]
      })
    )

    const routes = this.rows.filter((r) => r.file.endsWith("routes.spec.ts")).map((r) => ({ title: r.title, project: r.project, status: r.status, error: r.error }))
    const visual = this.rows.flatMap((r) => r.annotations.filter((a) => a.type === "visual").map((a) => JSON.parse(a.description!)))
    const assistantRows: AssistantCase[] = this.rows.flatMap((r) => {
      const ids = new Set<string>(r.title.match(/\bA(0[1-9]|1[0-8])\b/g) ?? [])
      if (r.file.endsWith("visual.spec.ts") || /@mobile/.test(r.title)) ids.add("A18")
      return [...ids].map((id) => ({ id, title: `${r.title} [${r.project}]`, status: r.status, layer: "browser (playwright)" as const, test: r.file, detail: r.error ?? undefined }))
    })
    const totals = this.rows.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {})

    const results = {
      generatedAt: new Date().toISOString(),
      startedAt: this.startedAt.toISOString(),
      overall: result.status,
      baseURL,
      database: db,
      command: process.env.E2E_COMMAND ?? "pnpm exec playwright test",
      totals,
      journeys,
      skills,
      routes,
      visual,
      assistant: assistantRows,
      tests: this.rows.map((r) => ({ file: r.file, title: r.title, project: r.project, status: r.status, durationMs: r.durationMs, error: r.error })),
    }
    writeFileSync(path.join(EVIDENCE, "demo-e2e-results.json"), JSON.stringify(results, null, 2) + "\n")

    // Report
    const j = Object.entries(journeys)
    const s = Object.entries(skills)
    const count = (f: (x: (typeof s)[number][1]) => boolean) => s.filter(([, v]) => f(v)).length
    const md = [
      "# AgeOS demo E2E report",
      "",
      `Generated ${results.generatedAt} · server ${baseURL || "?"} · database ${db ?? "not a dedicated e2e database (mutating specs skipped)"} · Playwright overall: **${result.status}**`,
      "",
      `Totals: ${Object.entries(totals).map(([k, v]) => `${k} ${v}`).join(" · ")}`,
      "",
      "## Journeys J01–J10",
      "",
      "| Journey | Result | Steps passed | First failures |",
      "|---|---|---|---|",
      ...j.map(([id, v]) => `| ${id} ${v.name} | **${v.status}** | ${v.stepsPassed}/${v.stepsTotal} | ${v.steps.filter((x) => x.status === "failed").slice(0, 3).map((x) => `${x.step}: ${x.outcome}`.replace(/\|/g, "\\|")).join("<br>")} |`),
      "",
      "## ERP-01..ERP-42",
      "",
      `Harness (Vitest, isolated DB): positive passed ${count((v) => v.positive === "passed")}/42 · negative passed ${count((v) => v.negative === "passed")}/42 · browser J10 run passed ${count((v) => v.ui.status === "passed")}/42.`,
      "",
      "| ERP | Skill | Positive | Negative | Replay | Browser (J10) |",
      "|---|---|---|---|---|---|",
      ...s.map(([erp, v]) => `| ${erp} | ${v.skillId} | ${v.positive} | ${v.negative} | ${v.replay} | ${v.ui.status}${"outcome" in v.ui && v.ui.status !== "passed" ? ` — ${String(v.ui.outcome).slice(0, 90).replace(/\|/g, "\\|")}` : ""} |`),
      "",
      "## Routes, visual matrix, assistant",
      "",
      `Routes: ${routes.filter((r) => r.status === "passed").length} passed / ${routes.length} (skipped ${routes.filter((r) => r.status === "skipped").length}).`,
      `Visual (screen × project): ${visual.filter((v) => v.status === "passed").length}/${visual.length} passed; screenshots under evidence/screenshots/<project>/.`,
      `Assistant browser cases: ${assistantRows.filter((r) => r.status === "passed").length}/${assistantRows.length} passed (see assistant-acceptance.md).`,
      "",
      "Limitations: results describe this run only. `not_run`/`skipped` are not passes. Mutating specs run only against a dedicated e2e database.",
    ].join("\n")
    writeFileSync(path.join(EVIDENCE, "demo-e2e-report.md"), md + "\n")

    // Assistant acceptance: merge the Vitest record with browser cases.
    const domain = readJson<{ generatedAt: string; driver: string; cases: AssistantCase[] }>("assistant-acceptance.json")
    const merged = [...(domain?.cases ?? []), ...assistantRows]
    const merge = new Map<string, CaseStatus>()
    for (const c of merged) merge.set(c.id, mergeStatus(merge.get(c.id), c.status))
    if (existsSync(EVIDENCE)) {
      writeFileSync(
        path.join(EVIDENCE, "assistant-acceptance.md"),
        renderAssistantAcceptance(merged, {
          generatedAt: new Date().toISOString(),
          driver: domain?.driver ?? "scripted",
          sources: [domain ? `Vitest ${domain.generatedAt}` : "no Vitest record", `Playwright ${results.generatedAt}`],
        })
      )
    }
  }
}
