import { expect, test } from "@playwright/test"

import { A, expectScreen, expectedSidebarPaths, ids, ready } from "./support"

// @mobile: navigation Sheet and assistant panel on a 390px phone (open,
// Escape, focus return, no page-level horizontal overflow).
// @screens: evidence screenshots for desktop and mobile. Read-only: opening
// the assistant panel only loads the persisted thread (GET).

const SHOTS = "evidence/screenshots"

test.describe("mobile shell @mobile", () => {
  test.skip(({ isMobile }) => !isMobile, "phone viewport only")

  test("navigation Sheet opens with all 17 destinations, closes on Escape and returns focus", async ({ page }) => {
    await expectScreen(page, A)
    await ready(page)
    const trigger = page.getByRole("button", { name: /Toggle sidebar|Mostrar u ocultar menú/ }).first()
    await trigger.click()
    const sheet = page.getByRole("dialog", { name: /Main navigation|Navegación principal/ })
    await expect(sheet).toBeVisible()
    const hrefs = await sheet.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))
    for (const p of expectedSidebarPaths()) {
      const want = `${A}${p}`
      expect(hrefs.some((h) => (p === "/settings" ? h.startsWith(`${want}/`) : h === want)), `mobile nav entry ${want}`).toBe(true)
    }
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test("choosing a destination in the Sheet navigates and closes it", async ({ page }) => {
    await expectScreen(page, A)
    await ready(page)
    await page.getByRole("button", { name: /Toggle sidebar|Mostrar u ocultar menú/ }).first().click()
    const sheet = page.getByRole("dialog", { name: /Main navigation|Navegación principal/ })
    await sheet.locator(`a[href="${A}/jobs"]`).click()
    await page.waitForURL(new RegExp(`${A}/jobs$`))
    await expect(sheet).toBeHidden()
  })

  test("assistant panel opens as an accessible Sheet and Escape closes it", async ({ page }) => {
    await expectScreen(page, `${A}/jobs/${ids.auroraJob}`)
    await ready(page)
    const open = page.getByRole("button", { name: /Open AgeOS Assistant panel|Abrir el panel del Asistente AgeOS/ }).first()
    await open.click()
    const panel = page.getByRole("dialog").filter({ hasText: /Assistant|Asistente/ }).first()
    await expect(panel).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(panel).toBeHidden()
    await expect(open).toBeFocused()
  })

  for (const url of [A, `${A}/jobs`, `${A}/jobs/${ids.auroraJob}`, `${A}/modules/clients-contracts`, `${A}/capabilities`, `${A}/assistant`]) {
    test(`no page-level horizontal overflow at 390px: ${url}`, async ({ page }) => {
      await expectScreen(page, url)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, "tables must scroll inside their region, not the page").toBeLessThanOrEqual(1)
    })
  }
})

test.describe("evidence screenshots @screens", () => {
  const shoot = async (page: import("@playwright/test").Page, project: string, name: string) => {
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await page.screenshot({ path: `${SHOTS}/${project}-${name}.png`, fullPage: false })
  }

  test("shell overview, module desk, job dossier, capabilities", async ({ page }, info) => {
    test.setTimeout(180_000)
    await expectScreen(page, A)
    await shoot(page, info.project.name, "01-overview-shell")
    await expectScreen(page, `${A}/modules/clients-contracts`)
    await shoot(page, info.project.name, "02-module-desk-clients-contracts")
    await expectScreen(page, `${A}/jobs/${ids.auroraJob}`)
    await shoot(page, info.project.name, "03-job-dossier-aurora")
    await expectScreen(page, `${A}/capabilities`)
    await shoot(page, info.project.name, "04-capabilities-catalog")
  })

  test("assistant full page and right panel", async ({ page }, info) => {
    test.setTimeout(120_000)
    await expectScreen(page, `${A}/assistant`)
    await shoot(page, info.project.name, "05-assistant-page")
    await expectScreen(page, `${A}/jobs/${ids.auroraJob}`)
    await page.getByRole("button", { name: /Open AgeOS Assistant panel|Abrir el panel del Asistente AgeOS/ }).first().click()
    await page.waitForTimeout(400)
    await shoot(page, info.project.name, "06-assistant-right-panel")
  })

  test("mobile navigation sheet", async ({ page, isMobile }, info) => {
    test.skip(!isMobile, "phone viewport only")
    await expectScreen(page, A)
    await ready(page)
    await page.getByRole("button", { name: /Toggle sidebar|Mostrar u ocultar menú/ }).first().click()
    await page.waitForTimeout(300)
    await shoot(page, info.project.name, "07-mobile-navigation-sheet")
  })
})
