import { expect, test, type Page } from "@playwright/test"

import { e2eDatabaseUrl } from "./e2e-env"
import { A, expectScreen, ids } from "./support"

// @visual matrix: key screens × {EN, ES} × {dark, light} × {1440, 390}. The
// project decides locale/theme/viewport (playwright.config.ts metadata).
// Asserts the screen renders, the theme class and language are the requested
// ones, and no page-level horizontal overflow; saves one screenshot per
// screen and project under evidence/screenshots/<project>/. Switching to ES
// writes the presenter's locale preference, so ES projects need the
// dedicated E2E database (the language is restored to EN afterwards).

const SCREENS: [string, string][] = [
  ["overview", A],
  ["jobs", `${A}/jobs`],
  ["job-dossier-aurora", `${A}/jobs/${ids.auroraJob}`],
  ["desk-clients-contracts", `${A}/modules/clients-contracts`],
  ["desk-media-buying", `${A}/modules/media-buying`],
  ["workbench-fee-contracts", `${A}/modules/clients-contracts/workflows/agency-fee-contracts`],
  ["workbench-payment-run", `${A}/modules/suppliers-payments/workflows/agency-payment-run`],
  ["capabilities", `${A}/capabilities`],
  ["approvals", `${A}/approvals`],
  ["runs", `${A}/runs`],
  ["library", `${A}/library`],
  ["connections", `${A}/connections`],
  ["explore", `${A}/explore`],
  ["assistant", `${A}/assistant`],
]

// Always rendered in the header (desktop and phone), so it proves the language on both.
const TOGGLE = { en: "Toggle sidebar", es: "Mostrar u ocultar menú" }

async function switchLocale(page: Page, to: "en" | "es") {
  await page.goto(A)
  const current = (await page.getByRole("button", { name: TOGGLE.es }).count()) ? "es" : "en"
  if (current === to) return
  await page.getByRole("button", { name: /^(Profile|Perfil)$/ }).first().click()
  await page.getByRole("menuitemradio", { name: to === "es" ? /^Español$/ : /^English$/ }).click()
  await expect(page.getByRole("button", { name: TOGGLE[to] }).first()).toBeVisible({ timeout: 30_000 })
}

test.describe("visual matrix @visual", () => {
  test("key screens render in the project's language, theme and viewport", async ({ page }, info) => {
    test.setTimeout(600_000)
    const meta = info.project.metadata as { locale?: "en" | "es"; theme?: "dark" | "light" }
    const locale = meta.locale ?? "en"
    const theme = meta.theme ?? "dark"
    test.skip(locale === "es" && !e2eDatabaseUrl(), "ES switches the presenter's saved locale: dedicated E2E database only")
    await page.addInitScript((t) => {
      try {
        if (t === "light") localStorage.setItem("theme", "light")
        else localStorage.removeItem("theme")
      } catch {
        /* storage unavailable */
      }
    }, theme)
    if (locale === "es") await switchLocale(page, "es")
    const failures: string[] = []
    try {
      for (const [name, url] of SCREENS) {
        const shot = `evidence/screenshots/${info.project.name}/${name}.png`
        let status = "passed"
        let detail = ""
        try {
          await expectScreen(page, url)
          const html = page.locator("html")
          if (theme === "dark") await expect(html).toHaveClass(/(^|\s)dark(\s|$)/)
          else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/)
          await expect(page.getByRole("button", { name: TOGGLE[locale] }).first()).toBeVisible()
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
          expect(overflow, "no page-level horizontal overflow").toBeLessThanOrEqual(1)
        } catch (e) {
          status = "failed"
          detail = (e as Error).message.split("\n")[0]!.slice(0, 240)
          failures.push(`${name}: ${detail}`)
        }
        await page.waitForLoadState("networkidle").catch(() => undefined)
        await page.screenshot({ path: shot }).catch(() => undefined)
        info.annotations.push({
          type: "visual",
          description: JSON.stringify({ project: info.project.name, screen: name, url, locale, theme, viewport: page.viewportSize(), status, detail, screenshot: shot }),
        })
      }
    } finally {
      if (locale === "es") await switchLocale(page, "en").catch(() => undefined)
    }
    expect(failures, failures.join("\n")).toEqual([])
  })
})
