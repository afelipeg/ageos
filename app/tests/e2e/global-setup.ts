import { mkdirSync } from "node:fs"
import path from "node:path"

import { chromium, type FullConfig } from "@playwright/test"

import { e2eDatabaseUrl, mintPersonaStates, resetCheckpoint } from "./e2e-env"
import { AUTH_STATE, accessCode } from "./support"

// 1. Against a dedicated E2E database (E2E_DATABASE_URL_MIGRATIONS): rebuild
//    the demo at `ready_for_scope_review` (unless E2E_RESET=0) and open one
//    session per synthetic persona.
// 2. Always: sign in through the real form as the presenter with the
//    server-held access code (typed, never printed) and store the cookie.
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3100"
  mkdirSync(path.dirname(AUTH_STATE), { recursive: true })
  if (e2eDatabaseUrl()) {
    if (process.env.E2E_RESET !== "0") resetCheckpoint("ready_for_scope_review")
    await mintPersonaStates(baseURL)
  }
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  try {
    const page = await browser.newPage({ baseURL })
    await page.goto("/sign-in?next=/a/rayo-de-sol", { waitUntil: "domcontentloaded" })
    await page.getByLabel(/Demo access code|Código de acceso demo/).fill(accessCode())
    await page.getByRole("button", { name: /^(Sign in|Ingresar)$/ }).click()
    // Match the pathname: the sign-in URL itself carries ?next=/a/rayo-de-sol.
    await page.waitForURL((u) => u.pathname === "/a/rayo-de-sol" || u.pathname.startsWith("/a/rayo-de-sol/"), { timeout: 60_000 })
    const cookies = await page.context().cookies()
    if (!cookies.some((c) => c.name === "ageos_session")) throw new Error("sign-in did not set the session cookie")
    await page.context().storageState({ path: AUTH_STATE })
  } finally {
    await browser.close()
  }
}
