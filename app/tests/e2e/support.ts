import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { expect, type Page, type Response } from "@playwright/test"

import { fixtureUuid } from "../../lib/fixture-ids"

// Shared E2E helpers. The route/skill inventory comes from the contracts in
// the spec folder (rutas-y-pantallas.json), not from the implementation.

export const AUTH_STATE = "tests/e2e/.auth/presenter.json"
export const SLUG = "rayo-de-sol"
export const A = `/a/${SLUG}`
export const ids = {
  auroraJob: fixtureUuid("job_demo_aurora"),
  labJob: fixtureUuid("job_demo_lab"),
  norteJob: fixtureUuid("job_demo_norte"),
  auroraClient: fixtureUuid("client_demo_aurora"),
  norteClient: fixtureUuid("client_demo_norte"),
  briefFile: fixtureUuid("evidence_demo_brief"),
  norteFile: fixtureUuid("evidence_demo_norte_private"),
  rayoTenant: fixtureUuid("tenant_demo_rayo"),
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(HERE, "../..")
const SPEC_DIR = path.resolve(APP_DIR, "..")

type ContractRoute = { id: string; path: string; screen_family: string; shell: string; authorization: string }
type ContractModule = { key: string; navigation_group: { en: string; es: string } | string; skill_ids: string[] }
type Contract = {
  routes: ContractRoute[]
  modules: ContractModule[]
  workflow_bindings: { skill_id: string; module_key: string; path: string }[]
  expected_counts: { route_patterns: number; sidebar_entries_including_catalog: number }
}

export const CONTRACT: Contract = JSON.parse(readFileSync(path.join(SPEC_DIR, "rutas-y-pantallas.json"), "utf8"))

/** Demo access code from .env.local (never logged). */
export function accessCode(): string {
  if (process.env.AGEOS_DEMO_ACCESS_CODE) return process.env.AGEOS_DEMO_ACCESS_CODE
  const env = readFileSync(path.join(APP_DIR, ".env.local"), "utf8")
  const line = env.split("\n").find((l) => l.startsWith("AGEOS_DEMO_ACCESS_CODE="))
  if (!line) throw new Error("AGEOS_DEMO_ACCESS_CODE missing in .env.local")
  return line.slice("AGEOS_DEMO_ACCESS_CODE=".length).trim().replace(/^["']|["']$/g, "")
}

/** Sidebar paths (relative to /a/:slug) derived from the navigation contract. */
export function expectedSidebarPaths(): string[] {
  const modules = CONTRACT.modules
  const group = (m: ContractModule) => (typeof m.navigation_group === "string" ? m.navigation_group : m.navigation_group.en).toLowerCase()
  const byGroup = (g: string) => modules.filter((m) => group(m) === g).map((m) => `/modules/${m.key}`)
  return [
    "",
    "/assistant",
    "/inbox",
    "/jobs",
    ...byGroup("operations"),
    ...byGroup("finance"),
    ...byGroup("manage"),
    "/connections",
    "/library",
    "/settings",
    "/capabilities",
  ]
}

const NOT_FOUND = /this page could not be found|page not found|^404$|no se encontr[oó]/i
// "no Coming soon" (a requirement statement shown by the presenter) is not placeholder copy.
const PLACEHOLDER = /(?<!\bno |\bsin )\b(coming soon|pr[oó]ximamente)\b|lorem ipsum/i

export function collectPageErrors(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  return errors
}

/** Navigates and asserts a real, rendered, non-error screen with a meaningful h1. */
export async function expectScreen(page: Page, url: string, opts: { status?: number } = {}) {
  const res: Response | null = await page.goto(url, { waitUntil: "domcontentloaded" })
  const status = res?.status() ?? 0
  if (opts.status) {
    expect(status, `${url} status`).toBe(opts.status)
    return { status, heading: null as string | null }
  }
  expect(status, `${url} returned HTTP ${status}`).toBeLessThan(400)
  await expect(page.locator("nextjs-portal [data-nextjs-dialog]"), `${url} shows a Next.js error overlay`).toHaveCount(0)
  const h1 = page.getByRole("heading", { level: 1 }).first()
  await expect(h1, `${url} has no visible h1`).toBeVisible()
  const heading = ((await h1.textContent()) ?? "").trim()
  expect(heading.length, `${url} h1 is empty`).toBeGreaterThan(1)
  expect(heading, `${url} h1 looks like an error page`).not.toMatch(NOT_FOUND)
  const body = (await page.locator("main").first().textContent().catch(() => "")) ?? ""
  expect(body, `${url} shows placeholder copy`).not.toMatch(PLACEHOLDER)
  return { status, heading }
}

/** Waits until the client has hydrated enough for clicks to reach React handlers. */
export async function ready(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined)
}

/**
 * A foreign or unknown record must render the not-found screen without data.
 * HTTP 404 is required unless the segment streams (loading.tsx), where Next
 * can only send 200 with the not-found UI: returned as `soft` so the caller
 * can report it.
 */
export async function expectNotFound(page: Page, url: string, forbidden: RegExp) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded" })
  const status = res?.status() ?? 0
  await ready(page)
  await expect(page.locator("body")).not.toContainText(forbidden)
  if (status === 404) return { status, soft: false }
  expect(status, `${url}: expected 404 or a streamed not-found page`).toBe(200)
  await expect(page.getByRole("heading", { name: /^(404|This page could not be found\.?)$/ }).first(), `${url}: 200 without the not-found UI`).toBeVisible()
  return { status, soft: true }
}

/** First href on the current page matching `re` (for ids only the UI knows). */
export async function discoverHref(page: Page, from: string, re: RegExp): Promise<string | null> {
  await page.goto(from, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => undefined)
  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""))
  return hrefs.find((h) => re.test(h)) ?? null
}
