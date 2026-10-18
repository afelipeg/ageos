import { expect, test, type Page } from "@playwright/test"

import { A, expectScreen, ids } from "./support"

// Assistant acceptance in the browser (07 §10). Every test here writes
// conversations/runs (and A03 opens a job), so the whole file is @mutating:
// run it only against the dedicated E2E database, never the shared dev DB.

const MONEY_PCT = /[A-Z]{0,3}\$?\s?[\d,]+\.\d{2}\s·\s\d{1,3}(\.\d)?\s?%/
const PANEL_BUTTON = /Open AgeOS Assistant panel|Abrir el panel del Asistente AgeOS/
const COMPOSER = /Message AgeOS Assistant|Mensaje al Asistente AgeOS|Escriba/

async function dossierMargin(page: Page) {
  await expectScreen(page, `${A}/jobs/${ids.auroraJob}`)
  const panel = page.locator("main").getByText("Projected margin", { exact: true }).locator("..")
  const text = (await panel.textContent()) ?? ""
  const m = MONEY_PCT.exec(text)
  expect(m, `dossier margin not found in "${text}"`).not.toBeNull()
  return m![0]
}

async function send(page: Page, scope: ReturnType<Page["locator"]>, text: string) {
  const box = scope.getByRole("textbox", { name: COMPOSER }).first()
  await box.fill(text)
  await box.press("Enter")
}

test.describe("assistant @mutating", () => {
  test("A01/A02: panel and full page share one thread; margin equals the dossier; return to work keeps the tab", async ({ page }) => {
    test.setTimeout(180_000)
    const expected = await dossierMargin(page)
    await page.goto(`${A}/jobs/${ids.auroraJob}?tab=activity`)
    await page.getByRole("button", { name: PANEL_BUTTON }).first().click()
    const panel = page.getByRole("complementary").or(page.getByRole("dialog")).filter({ hasText: /AgeOS Assistant|Asistente AgeOS/ }).first()
    await expect(panel).toBeVisible()
    await send(page, panel, "Explain Aurora margin")
    const card = panel.getByText("Projected margin", { exact: true }).last().locator("xpath=ancestor::*[contains(@class,'card') or @data-slot='card'][1]")
    await expect(card).toBeVisible({ timeout: 60_000 })
    const marginRow = card.getByText(MONEY_PCT).first()
    await expect(marginRow).toHaveText(new RegExp(expected.replace(/[.$*+?^()[\]{}|\\]/g, "\\$&")))

    await panel.getByRole("button", { name: /Open full page|Abrir página completa/ }).click()
    await page.waitForURL(new RegExp(`${A}/assistant`))
    await expect(page.getByText(MONEY_PCT).first()).toHaveText(new RegExp(expected.replace(/[.$*+?^()[\]{}|\\]/g, "\\$&")))
    await expect(page.getByRole("button", { name: PANEL_BUTTON })).toHaveCount(0)
    await page.reload()
    await expect(page.getByText("Projected margin", { exact: true }).first()).toBeVisible()
    await page.getByRole("link", { name: /Return to work|Volver al trabajo/ }).or(page.getByRole("button", { name: /Return to work|Volver al trabajo/ })).first().click()
    await page.waitForURL(new RegExp(`${A}/jobs/${ids.auroraJob}\\?tab=activity`))
  })

  test("A03: create a job asks for missing fields, shows the exact proposal, and confirms once", async ({ page }) => {
    test.setTimeout(180_000)
    const name = `E2E assistant job ${Date.now()}`
    await expectScreen(page, `${A}/assistant`)
    await page.getByRole("button", { name: /New conversation|Nueva conversación/ }).first().click().catch(() => undefined)
    await send(page, page.locator("main"), "create a job")
    await expect(page.getByText(/Which client is this job for\?|¿Para qué cliente/).last()).toBeVisible({ timeout: 60_000 })
    await send(page, page.locator("main"), "Aurora Beverages")
    await expect(page.getByText(/What should the job be called|¿Cómo se debe llamar/).last()).toBeVisible({ timeout: 60_000 })
    await send(page, page.locator("main"), name)
    const confirm = page.getByRole("button", { name: /Confirm exact proposal|Confirmar la propuesta exacta/ }).last()
    await expect(confirm).toBeVisible({ timeout: 60_000 })
    await confirm.click()
    await expect(page.getByText(/Job created|Trabajo creado/).last()).toBeVisible({ timeout: 60_000 })
    await expect(confirm).toBeHidden()
    await expectScreen(page, `${A}/jobs?q=${encodeURIComponent(name)}`)
    await expect(page.getByText(name)).toHaveCount(1)
  })

  test("A16: unsupported text is answered honestly with the supported scenarios and runs nothing", async ({ page }) => {
    await expectScreen(page, `${A}/assistant`)
    await send(page, page.locator("main"), "write me a poem about the sea")
    await expect(page.getByText(/outside this scripted demo|fuera de esta demo/).last()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(/This demo supports the scenarios below|Esta demo admite/).last()).toBeVisible()
  })
})

test.describe("locale @mutating", () => {
  test("EN↔ES switch keeps the URL, query and screen; restores English", async ({ page }) => {
    const url = `${A}/jobs/${ids.auroraJob}?tab=activity`
    await expectScreen(page, url)
    const switchTo = async (label: RegExp) => {
      await page.getByRole("button", { name: /^(Profile|Perfil)$/ }).first().click()
      await page.getByRole("menuitemradio", { name: label }).click()
    }
    await switchTo(/^Español$/)
    await expect(page.getByRole("navigation", { name: "Navegación principal" })).toBeVisible()
    expect(page.url()).toContain(url)
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
    await switchTo(/^English$/)
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible()
    expect(page.url()).toContain(url)
  })
})
