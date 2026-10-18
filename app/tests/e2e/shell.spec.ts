import { expect, test } from "@playwright/test"

import { A, CONTRACT, expectScreen, expectedSidebarPaths, ready } from "./support"

// Shell: the 17 sidebar destinations, default dark theme + persistent toggle,
// keyboard basics, header search dialog, sign-in gate. Read-only (the theme
// lives in the browser's localStorage of a throwaway context).

const NAV = /^(Main navigation|Navegación principal)$/

test.describe("sidebar", () => {
  test("has exactly the 17 contract destinations and each opens its screen as the active entry", async ({ page }) => {
    test.setTimeout(300_000)
    await expectScreen(page, A)
    await ready(page)
    const nav = page.getByRole("navigation", { name: NAV })
    const expected = expectedSidebarPaths()
    expect(expected).toHaveLength(CONTRACT.expected_counts.sidebar_entries_including_catalog)
    const hrefs = await nav.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))
    for (const p of expected) {
      const want = `${A}${p}`
      const hit = hrefs.filter((h) => (p === "/settings" ? h.startsWith(`${want}/`) : h === want))
      expect(hit.length, `sidebar entry for ${want}`).toBeGreaterThanOrEqual(1)
    }
    const failures: string[] = []
    for (const p of expected) {
      const want = `${A}${p}`
      const link = nav.locator(p === "/settings" ? `a[href^="${want}/"]` : `a[href="${want}"]`).last()
      try {
        await link.click()
        await page.waitForURL((u) => u.pathname === want || u.pathname.startsWith(`${want}/`), { timeout: 60_000 })
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
        await expect(link).toHaveAttribute("aria-current", "page")
      } catch (e) {
        failures.push(`${want}: ${(e as Error).message.split("\n")[0]}`)
      }
    }
    expect(failures, failures.join("\n")).toEqual([])
  })

  test("back/forward keep the route and the active entry", async ({ page }) => {
    await expectScreen(page, `${A}/jobs`)
    await expectScreen(page, `${A}/capabilities`)
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`${A}/jobs$`))
    await expect(page.getByRole("navigation", { name: NAV }).locator(`a[href="${A}/jobs"]`)).toHaveAttribute("aria-current", "page")
    await page.goForward()
    await expect(page).toHaveURL(new RegExp(`${A}/capabilities$`))
  })
})

test.describe("theme", () => {
  const DARK = /(^|\s)dark(\s|$)/

  /**
   * Records <html> class/color-scheme at the first animation frame that has
   * rendered content (the first frame a user could see), before React hydrates.
   */
  const firstFrameProbe = () => {
    const w = window as unknown as { __firstFrame?: { cls: string; scheme: string; bg: string; children: number } }
    const probe = () => {
      const html = document.documentElement
      const children = document.body?.childElementCount ?? 0
      if (!children) return requestAnimationFrame(probe)
      w.__firstFrame = { cls: html.className, scheme: getComputedStyle(html).colorScheme, bg: getComputedStyle(document.body).backgroundColor, children }
    }
    requestAnimationFrame(probe)
  }
  const firstFrame = (page: import("@playwright/test").Page) =>
    page
      .waitForFunction(() => (window as unknown as { __firstFrame?: unknown }).__firstFrame)
      .then((h) => h.jsonValue() as Promise<{ cls: string; scheme: string; bg: string; children: number }>)
  const luminance = (rgb: string) => {
    const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ["255", "255", "255"]).map(Number)
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }

  test("server HTML applies the dark default before any body markup can paint (deterministic FOUC guard)", async ({ request }) => {
    for (const url of ["/sign-in", A]) {
      const html = await (await request.get(url, { headers: { cookie: "" } })).text()
      const htmlTag = /<html[^>]*>/.exec(html)?.[0] ?? ""
      const themeScript = html.search(/localStorage\.getItem|"theme"[^<]{0,200}classList/)
      const body = html.indexOf("<body")
      const darkOnHtml = /class="[^"]*\bdark\b/.test(htmlTag)
      expect(
        darkOnHtml || (themeScript >= 0 && themeScript < body),
        `${url}: <html> has no server "dark" class and the theme script runs after <body> starts (index ${themeScript} vs body ${body}) — a frame can paint light first`
      ).toBe(true)
    }
  })

  test("first visit with no stored theme is dark before paint (no light flash), even when the OS prefers light", async ({ browser }) => {
    for (const url of ["/sign-in", A]) {
      const context = await browser.newContext({
        storageState: url === A ? "tests/e2e/.auth/presenter.json" : { cookies: [], origins: [] },
        colorScheme: "light",
      })
      await context.addInitScript(() => localStorage.removeItem("theme"))
      await context.addInitScript(firstFrameProbe)
      const page = await context.newPage()
      try {
        await page.goto(url)
        const f = await firstFrame(page)
        expect(f.cls, `${url}: html.dark missing at first frame`).toMatch(DARK)
        expect(f.scheme, `${url}: color-scheme at first frame`).toContain("dark")
        expect(luminance(f.bg), `${url}: first-frame background ${f.bg} is light`).toBeLessThan(60)
        await expect(page.locator("html")).toHaveClass(DARK)
      } finally {
        await context.close()
      }
    }
  })

  test("toggle to light persists across reload and navigation, and back to dark", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "tests/e2e/.auth/presenter.json", colorScheme: "dark" })
    const page = await context.newPage()
    try {
      await page.goto(A)
      await page.evaluate(() => localStorage.removeItem("theme"))
      await page.reload()
      await expect(page.locator("html")).toHaveClass(DARK)
      await page.getByRole("button", { name: /Switch to light theme|Cambiar a tema claro/ }).first().click()
      await expect(page.locator("html")).not.toHaveClass(DARK)
      expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light")
      await context.addInitScript(firstFrameProbe)
      await page.reload()
      const f = await firstFrame(page)
      expect(f.cls, "stored light choice must apply before paint after reload").not.toMatch(DARK)
      await page.goto(`${A}/jobs`)
      await expect(page.locator("html")).not.toHaveClass(DARK)
      await page.getByRole("navigation", { name: NAV }).locator(`a[href="${A}/capabilities"]`).click()
      await page.waitForURL(new RegExp(`${A}/capabilities$`))
      await expect(page.locator("html")).not.toHaveClass(DARK)
      await page.getByRole("button", { name: /Switch to dark theme|Cambiar a tema oscuro/ }).first().click()
      await expect(page.locator("html")).toHaveClass(DARK)
      expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark")
    } finally {
      await context.close()
    }
  })

  test("public sign-in page also offers the toggle", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, colorScheme: "light" })
    const page = await context.newPage()
    try {
      await page.goto("/sign-in")
      await expect(page.getByRole("button", { name: /Switch to light theme|Cambiar a tema claro/ })).toBeVisible()
    } finally {
      await context.close()
    }
  })
})

test.describe("keyboard", () => {
  test("Tab reaches the sidebar links with a visible focus indicator and Enter navigates", async ({ page }) => {
    await expectScreen(page, A)
    await ready(page)
    const nav = page.getByRole("navigation", { name: NAV })
    let focusedHref: string | null = null
    for (let i = 0; i < 25 && !focusedHref; i++) {
      await page.keyboard.press("Tab")
      focusedHref = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return el?.closest('[role="navigation"]') && el.tagName === "A" ? el.getAttribute("href") : null
      })
    }
    expect(focusedHref, "Tab never reached a sidebar link").not.toBeNull()
    const ring = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement as Element)
      return { outline: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow }
    })
    expect(ring.outline !== "none" || ring.shadow !== "none", `no visible focus ring: ${JSON.stringify(ring)}`).toBe(true)
    await page.keyboard.press("Enter")
    await page.waitForURL((u) => u.pathname === focusedHref)
    await expect(nav).toBeVisible()
  })

  test("header search opens as a dialog with focus inside and Escape closes it, returning focus", async ({ page }) => {
    await expectScreen(page, A)
    await ready(page)
    const trigger = page.getByRole("button", { name: /^(Search|Buscar)/ }).first()
    await trigger.click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("combobox").or(dialog.getByRole("textbox")).first()).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})

test.describe("sign-in gate", () => {
  test("an anonymous visitor is redirected to sign-in and a wrong code is rejected", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    try {
      await page.goto(`${A}/jobs`)
      await expect(page).toHaveURL(/\/sign-in\?next=/)
      await page.getByLabel(/Demo access code|Código de acceso demo/).fill("definitely-not-the-code")
      await page.getByRole("button", { name: /^(Sign in|Ingresar)$/ }).click()
      await expect(page.getByText(/That access code is not valid|Ese código de acceso no es válido/)).toBeVisible()
      await expect(page).toHaveURL(/\/sign-in/)
    } finally {
      await context.close()
    }
  })
})
