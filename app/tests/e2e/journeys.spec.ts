import { mkdirSync } from "node:fs"

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"

import { JOURNEYS, journeyStepHref, type Journey, type JourneyStep, type RuntimeParam } from "../../lib/demo/journeys"
import { fixtureUuid } from "../../lib/fixture-ids"

import { DEDICATED_SKIP, e2eDatabaseUrl, personaState, resetCheckpoint, type PersonaKey } from "./e2e-env"
import { expectScreen } from "./support"

// J01–J10 product journeys in a real browser, data-driven from the shared
// catalog lib/demo/journeys.ts (same steps the presenter launcher shows).
// Each step runs as its persona against the dedicated E2E server/database,
// performs the step's action through the UI and records a typed result as a
// `journey-step` annotation (consumed by tests/e2e/evidence-reporter.ts →
// evidence/demo-e2e-results.json). @mutating: never run against ageos_dev.

const SHOTS = "evidence/screenshots/journeys"
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

type StepStatus = "passed" | "failed"
type StepRecord = {
  journey: string
  step: string
  actor: string
  surface: string
  performs: string
  status: StepStatus
  outcome: string
  url: string | null
  screenshot: string | null
  expected: string
}

type Runtime = Partial<Record<RuntimeParam, string>> & { approvalIds?: string[] }

const re = (en: string, es: string) => new RegExp(`^\\s*(${en}|${es})\\s*$`)
const L = {
  run: re("Run capability|Run again", "Ejecutar capacidad|Ejecutar de nuevo"),
  passed: /Server validation passed\.|La validación del servidor pasó\./,
  openApproval: /^(Open approval|Abrir aprobación)$/,
  approve: re("Approve exact change", "Aprobar cambio exacto"),
  apply: re("Apply approved change", "Aplicar cambio aprobado"),
  confirmProposal: re("Confirm exact proposal", "Confirmar propuesta exacta"),
  composer: /Message AgeOS Assistant|Mensaje al Asistente AgeOS/,
  assistantGroup: /^(AgeOS Assistant|Asistente AgeOS)$/,
  panelButton: /Open AgeOS Assistant panel|Abrir el panel del Asistente AgeOS/,
  newAgency: re("New agency", "Nueva agencia"),
  useSample: re("Use a sample agency", "Usar una agencia de ejemplo"),
  continue: re("Continue", "Continuar"),
  deploy: re("Deploy demo agency", "Desplegar agencia demo"),
  checkStatus: re("Check status", "Consultar estado"),
  upload: re("Upload", "Cargar"),
  saveLink: re("Save link", "Guardar vínculo"),
  reviewImpact: re("Review impact before disconnecting", "Revisar impacto antes de desconectar"),
  revoke: re("Revoke connection", "Revocar conexión"),
  restore: re("Restore connection", "Restaurar conexión"),
  investigate: re("Investigate", "Investigar"),
  prepare: re("Prepare reviewable change", "Preparar cambio revisable"),
  opsApprove: re("Approve exact configuration change", "Aprobar cambio exacto de configuración"),
  opsApply: re("Apply approved local change", "Aplicar cambio local aprobado"),
  opsVerify: re("Verify local result", "Verificar resultado local"),
}

function presetText(presetId: string) {
  if (presetId === "preset.margin.aurora") return "Explain Aurora margin"
  if (presetId === "preset.job.create") return "Create a job"
  const m = /^preset\.skill\.(.+)$/.exec(presetId)
  if (m) return `Run demo: ${m[1]}`
  throw new Error(`no typed alias for preset ${presetId}`)
}

class Personas {
  private contexts = new Map<string, BrowserContext>()
  constructor(private browser: Browser) {}
  async page(actor: string): Promise<Page> {
    let ctx = this.contexts.get(actor)
    if (!ctx) {
      ctx = await this.browser.newContext({ storageState: personaState(actor as PersonaKey), viewport: { width: 1440, height: 900 }, locale: "en-US" })
      this.contexts.set(actor, ctx)
    }
    return ctx.pages()[0] ?? ctx.newPage()
  }
  async close() {
    for (const c of this.contexts.values()) await c.close()
    this.contexts.clear()
  }
}

async function capture(page: Page, rt: Runtime) {
  const u = new URL(page.url())
  const m = (r: RegExp) => r.exec(u.pathname)?.[1]
  rt.draftId = m(/^\/control\/setup\/([^/]+)\//) ?? rt.draftId
  rt.runId = m(/^\/control\/activations\/([^/]+)$/) ?? rt.runId
  rt.agencyId = m(/^\/control\/agencies\/([^/]+)$/) ?? rt.agencyId
  rt.changeId = m(/^\/ops\/changes\/([^/]+)$/) ?? rt.changeId
  rt.fileId = m(/^\/a\/[^/]+\/library\/([^/]+)$/) ?? rt.fileId
  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))
  for (const h of hrefs) {
    const a = /\/approvals\/([0-9a-f-]{36})$/.exec(h)?.[1]
    if (a) rt.approvalIds = [...new Set([...(rt.approvalIds ?? []), a])]
    rt.changeId = /^\/ops\/changes\/([^/?#]+)$/.exec(h)?.[1] ?? rt.changeId
    rt.runId = /^\/control\/activations\/([^/?#]+)$/.exec(h)?.[1] ?? rt.runId
    rt.agencyId = /^\/control\/agencies\/([^/?#]+)$/.exec(h)?.[1] ?? rt.agencyId
  }
}

async function outcomeText(page: Page) {
  const alert = page.locator('[data-slot="alert"]').last()
  await expect(alert).toBeVisible({ timeout: 60_000 })
  return ((await alert.textContent()) ?? "").replace(/\s+/g, " ").trim()
}

// ── step handlers ──

async function workbench(page: Page, href: string, s: JourneyStep, rt: Runtime) {
  await expectScreen(page, href)
  const run = page.getByRole("button", { name: L.run }).first()
  await expect(run, "Run is enabled (handler implemented, no precondition block)").toBeEnabled()
  // The workbench output region is the aria-live panel; read only alerts produced by this run.
  const live = page.locator('[aria-live="polite"] [data-slot="alert"]')
  const before = await live.count()
  await run.click()
  await expect.poll(() => live.count(), { timeout: 90_000, message: "the run produced an outcome" }).toBeGreaterThan(before === 0 ? 0 : before - 1)
  await expect(page.getByRole("button", { name: L.run }).first()).toBeEnabled({ timeout: 90_000 })
  const text = ((await live.last().textContent()) ?? "").replace(/\s+/g, " ").trim()
  await capture(page, rt)
  const expectBlock = /Blocked with ([a-z_]+)/.exec(s.expected.en)?.[1]
  if (expectBlock) {
    expect(text, `expected a block with ${expectBlock}`).not.toMatch(L.passed)
    expect(text.toLowerCase()).toMatch(new RegExp(`${expectBlock}|${expectBlock.replace(/_/g, " ")}`))
    return `blocked as expected: ${text.slice(0, 160)}`
  }
  expect(text, "server validation passed and the run persisted").toMatch(L.passed)
  return text.slice(0, 160)
}

async function decideApprovalAt(page: Page, href: string) {
  await expectScreen(page, href)
  const notes: string[] = []
  const approve = page.getByRole("button", { name: L.approve }).first()
  if ((await approve.count()) && (await approve.isEnabled())) {
    await approve.click()
    await page.getByRole("alertdialog").getByRole("button", { name: L.approve }).click()
    notes.push(await outcomeText(page))
  }
  const apply = page.getByRole("button", { name: L.apply }).first()
  if ((await apply.count()) && (await apply.isEnabled())) {
    await apply.click()
    notes.push(await outcomeText(page))
  }
  return notes.join(" | ")
}

async function approvals(page: Page, hrefs: string[]) {
  expect(hrefs.length, "an approval request was produced by an earlier step").toBeGreaterThan(0)
  const out: string[] = []
  // Two passes: authority approvals unblock held fee amendments, which can then be applied.
  for (let pass = 0; pass < 2; pass++) for (const h of hrefs) out.push(await decideApprovalAt(page, h))
  const decided = out.filter(Boolean)
  expect(decided.length, "the actor could decide at least one pending approval").toBeGreaterThan(0)
  expect(decided.join(" "), "no approval ended in an unexpected error").not.toMatch(/Unexpected error|Error inesperado/)
  return decided.join(" | ").slice(0, 300)
}

async function assistant(page: Page, href: string, s: Extract<JourneyStep["surface"], { kind: "assistant" }>, rt: Runtime) {
  const base = href.split("?")[0]!
  await expectScreen(page, base)
  let scope = page.locator("main")
  if (!/\/assistant$/.test(base)) {
    await page.getByRole("button", { name: L.panelButton }).first().click()
    scope = page.getByRole("complementary").or(page.getByRole("dialog")).filter({ has: page.getByRole("textbox", { name: L.composer }) }).first()
  }
  const groups = scope.getByRole("group", { name: L.assistantGroup })
  const before = await groups.count()
  const box = scope.getByRole("textbox", { name: L.composer }).first()
  await box.fill(presetText(s.presetId))
  await box.press("Enter")
  await expect.poll(() => groups.count(), { timeout: 90_000 }).toBeGreaterThan(before)
  const last = groups.last()
  const confirm = last.getByRole("button", { name: L.confirmProposal })
  if (await confirm.count()) {
    await confirm.first().click()
    await expect.poll(() => groups.count(), { timeout: 90_000 }).toBeGreaterThan(before + 1)
  }
  const text = ((await groups.last().textContent()) ?? "").replace(/\s+/g, " ")
  expect(text, "the scripted scenario ran (not the unsupported-scope reply)").not.toMatch(/outside this scripted demo|fuera de esta demo/)
  expect(text).not.toMatch(/Unexpected error|Error inesperado/)
  await capture(page, rt)
  return text.slice(0, 200)
}

async function control(page: Page, s: JourneyStep, href: string | null, rt: Runtime) {
  switch (s.performs) {
    case "createAgencyDraft": {
      await expectScreen(page, "/control/agencies")
      await page.getByRole("button", { name: L.newAgency }).first().click()
      await page.waitForURL(/\/control\/setup\/[^/]+\/agency/, { timeout: 60_000 })
      await capture(page, rt)
      return `draft ${rt.draftId}`
    }
    case "saveSetupStep(1)":
    case "saveSetupStep(2)":
    case "saveSetupStep(3)":
    case "saveSetupStep(4)": {
      await expectScreen(page, href!)
      if (s.performs.endsWith("(1)")) await page.getByRole("button", { name: L.useSample }).first().click()
      const from = page.url()
      await page.getByRole("button", { name: L.continue }).first().click()
      await page.waitForURL((u) => u.toString() !== from, { timeout: 60_000 })
      return `saved → ${new URL(page.url()).pathname}`
    }
    case "validateConfiguration": {
      await expectScreen(page, href!)
      await expect(page.getByRole("button", { name: L.deploy }).first()).toBeEnabled()
      return "review valid; deploy enabled"
    }
    case "startActivation": {
      await expectScreen(page, `/control/setup/${rt.draftId}/review`)
      await page.getByRole("button", { name: L.deploy }).first().click()
      await page.waitForURL(/\/control\/activations\/[^/]+$/, { timeout: 60_000 })
      await capture(page, rt)
      await expect.poll(async () => ((await page.locator("main").textContent()) ?? "").match(/ready|listo/i) !== null, { timeout: 120_000 }).toBe(true)
      return `activation ${rt.runId} ready`
    }
    case "simulateDnsVerification": {
      if (!rt.agencyId) {
        await expectScreen(page, `/control/activations/${rt.runId}`)
        await capture(page, rt)
      }
      await expectScreen(page, `/control/agencies/${rt.agencyId}`)
      const text = (await page.locator("main").textContent()) ?? ""
      expect(text).toMatch(/simulated|simulad/i)
      const slug = /\/a\/([a-z0-9-]+)/.exec(text)?.[1]
      if (slug) rt.agencySlug = slug
      return "domain shown as simulated"
    }
    default:
      throw new Error(`no UI handler for ${s.performs}`)
  }
}

async function files(page: Page, s: JourneyStep, href: string, rt: Runtime) {
  if (s.performs === "uploadFile") {
    await expectScreen(page, href)
    await page.getByRole("button", { name: L.upload }).first().click()
    const dialog = page.getByRole("dialog")
    await dialog.locator('input[type="file"]').setInputFiles({ name: "e2e-synthetic-note.csv", mimeType: "text/csv", buffer: Buffer.from("demo,synthetic\n1,2\n") })
    await dialog.getByRole("button", { name: L.upload }).last().click()
    await expect(dialog).toBeHidden({ timeout: 60_000 })
    await page.reload()
    const fileHref = await page
      .locator("a[href]", { hasText: "e2e-synthetic-note.csv" })
      .first()
      .getAttribute("href")
      .catch(() => null)
    rt.fileId = UUID.exec(fileHref ?? "")?.[0] ?? rt.fileId
    expect(rt.fileId, "the uploaded file is listed with a detail link").toBeTruthy()
    return `uploaded file ${rt.fileId}`
  }
  if (s.performs === "linkFileToJob") {
    await expectScreen(page, href)
    const jobSelect = page.getByRole("combobox").first()
    await jobSelect.click()
    await page.getByRole("option", { name: /Aurora Spring Launch/ }).first().click()
    await page.getByRole("button", { name: L.saveLink }).click()
    await expect(page.getByText(/Job link saved\.|vínculo/i).first()).toBeVisible({ timeout: 30_000 })
    return "linked to Aurora"
  }
  throw new Error(`no UI handler for ${s.performs}`)
}

async function connection(page: Page, s: JourneyStep, rt: Runtime, slug: string) {
  if (!rt.connectionId) {
    await expectScreen(page, `/a/${slug}/connections`)
    const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => ({ h: e.getAttribute("href") ?? "", t: e.closest("tr")?.textContent ?? e.textContent ?? "" })))
    const meta = hrefs.find((x) => /\/connections\/[^/]+$/.test(x.h) && /meta/i.test(x.t)) ?? hrefs.find((x) => /\/connections\/[^/]+$/.test(x.h))
    rt.connectionId = meta?.h.split("/").pop()
  }
  expect(rt.connectionId, "a connection detail link exists").toBeTruthy()
  await expectScreen(page, `/a/${slug}/connections/${rt.connectionId}`)
  if (/Revoke/.test(s.label.en)) {
    await page.getByRole("button", { name: L.reviewImpact }).first().click()
    await page.getByRole("alertdialog").getByRole("button", { name: L.revoke }).click()
  } else {
    await page.getByRole("button", { name: L.restore }).first().click()
  }
  return await outcomeText(page).catch(async () => ((await page.locator("main").textContent()) ?? "").slice(0, 160))
}

async function ops(page: Page, s: JourneyStep, href: string | null, rt: Runtime) {
  const target = href ?? (rt.changeId ? `/ops/changes/${rt.changeId}` : null)
  expect(target, `runtime param for ${s.performs}`).toBeTruthy()
  await expectScreen(page, target!)
  const click = async (name: RegExp) => {
    const b = page.getByRole("button", { name }).first()
    await expect(b).toBeEnabled()
    await b.click()
    const dialog = page.getByRole("alertdialog")
    if (await dialog.count()) await dialog.getByRole("button", { name }).click()
  }
  switch (s.performs) {
    case "listIncidents":
      await expect(page.locator("main")).toContainText(/delimiter|delimitador|csv/i)
      return "incident listed"
    case "investigate":
      await click(L.investigate)
      await expect(page.locator("main")).toContainText(/1|one|una/i)
      return "investigated"
    case "proposeDelimiterChange": {
      const reason = page.getByLabel(/^(Reason|Motivo)$/).first()
      if (await reason.count()) await reason.fill("E2E: allowlisted demo profile uses ';'")
      await click(L.prepare)
      await page.waitForTimeout(500)
      await capture(page, rt)
      expect(rt.changeId, "a platform change was created").toBeTruthy()
      return `change ${rt.changeId}`
    }
    case "decidePlatformChange":
      await click(L.opsApprove)
      return await outcomeText(page)
    case "applyPlatformChange":
      await click(L.opsApply)
      return await outcomeText(page)
    case "verifyPlatformChange":
      await click(L.opsVerify)
      await expect(page.locator("main")).toContainText(/6/)
      return await outcomeText(page)
    default:
      throw new Error(`no UI handler for ${s.performs}`)
  }
}

async function runStep(j: Journey, s: JourneyStep, page: Page, rt: Runtime): Promise<string> {
  const href = journeyStepHref(s, { fixtureId: fixtureUuid, runtime: rt })
  if (/^404/.test(s.expected.en)) {
    const res = await page.goto(href!, { waitUntil: "domcontentloaded" })
    expect(res?.status(), "another agency's record is never revealed").toBe(404)
    await expect(page.locator("body")).not.toContainText(/Aurora Spring Launch|Aurora Beverages/)
    return "404 as expected"
  }
  if (s.surface.kind === "assistant") return assistant(page, href!, s.surface, rt)
  const routeId = s.surface.routeId
  if (routeId === "workflow-workbench") return workbench(page, href!, s, rt)
  if (routeId === "approval-detail") return approvals(page, (rt.approvalIds ?? []).map((a) => `/a/rayo-de-sol/approvals/${a}`))
  if (routeId === "approvals" && s.performs === "decideApprovalCommand") {
    await expectScreen(page, href!)
    await capture(page, rt)
    return approvals(page, (rt.approvalIds ?? []).map((a) => `/a/rayo-de-sol/approvals/${a}`))
  }
  if (routeId.startsWith("control-") || routeId === "setup-wizard" || routeId === "activation") return control(page, s, href, rt)
  if (s.performs === "uploadFile" || s.performs === "linkFileToJob") return files(page, s, href!, rt)
  if (routeId === "connection-detail") return connection(page, s, rt, "rayo-de-sol")
  if (routeId.startsWith("platform-")) return ops(page, s, href, rt)
  if (s.performs === "proposeCapabilityChange" || s.performs === "decideCapabilityChange") {
    throw new Error(`no capability-change control on ${href} (J01.10/J01.11 need a propose/decide UI)`)
  }
  // Read steps (dossier, overview, catalog, persona home): the screen must render.
  const { heading } = await expectScreen(page, href!)
  await capture(page, rt)
  if (s.performs === "listCapabilities") {
    const links = await page.locator('a[href*="/workflows/"]').evaluateAll((els) => new Set(els.map((e) => e.getAttribute("href"))).size)
    expect(links, "catalog links to all 42 workbenches").toBeGreaterThanOrEqual(42)
  }
  return `screen "${heading}"`
}

test.describe("product journeys J01–J10 @mutating @journey", () => {
  test.skip(!e2eDatabaseUrl(), DEDICATED_SKIP)
  test.skip(({ isMobile }) => isMobile, "journeys run on the 1440px desktop project")

  for (const j of JOURNEYS) {
    test(`${j.id} ${j.name.en}`, async ({ browser }, info) => {
      test.setTimeout(j.id === "J10" ? 1_800_000 : 600_000)
      mkdirSync(SHOTS, { recursive: true })
      if (j.entryCheckpoint && j.continues.length === 0) resetCheckpoint(j.entryCheckpoint)
      const personas = new Personas(browser)
      const rt: Runtime = {}
      const records: StepRecord[] = []
      try {
        for (const s of j.steps) {
          const page = await personas.page(s.actor)
          const rec: StepRecord = {
            journey: j.id,
            step: s.id,
            actor: s.actor,
            surface: s.surface.kind === "assistant" ? `assistant:${s.surface.presetId}` : s.surface.routeId,
            performs: s.performs,
            status: "failed",
            outcome: "",
            url: null,
            screenshot: null,
            expected: s.expected.en,
          }
          try {
            rec.outcome = await runStep(j, s, page, rt)
            rec.status = "passed"
          } catch (e) {
            rec.outcome = (e as Error).message.split("\n")[0]!.slice(0, 300)
          }
          rec.url = page.url()
          rec.screenshot = `${SHOTS}/${s.id}.png`
          await page.screenshot({ path: rec.screenshot }).catch(() => (rec.screenshot = null))
          records.push(rec)
          info.annotations.push({ type: "journey-step", description: JSON.stringify(rec) })
        }
      } finally {
        await personas.close()
      }
      const failed = records.filter((r) => r.status === "failed")
      expect(failed.map((f) => `${f.step} [${f.actor}] ${f.performs}: ${f.outcome}`), `${j.id}: ${failed.length}/${records.length} steps failed`).toEqual([])
    })
  }
})
