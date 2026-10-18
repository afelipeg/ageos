import { existsSync } from "node:fs"

import { expect, test, type Page } from "@playwright/test"

import { fixtureUuid } from "../../lib/fixture-ids"

import { DEDICATED_SKIP, e2eDatabaseUrl, personaState } from "./e2e-env"
import { A, CONTRACT, collectPageErrors, discoverHref, expectNotFound, expectScreen, ids } from "./support"

// Crawls all 31 route patterns of rutas-y-pantallas.json with real params
// (stable fixture ids, or ids discovered from the authorized list screens),
// asserting HTTP < 400, no Next error overlay, a meaningful h1, no placeholder
// copy and no uncaught page errors. Read-only: only GET navigations.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const rx = (s: string) => new RegExp(s.replace(/UUID/g, UUID))

type Resolver = (page: Page) => Promise<string[] | { skip: string }>

const discovered =
  (from: string, pattern: string, why: string): Resolver =>
  async (page) => {
    const href = await discoverHref(page, from, rx(pattern))
    return href ? [href] : { skip: `no ${why} link on ${from} at the current checkpoint` }
  }

const RESOLVERS: Record<string, Resolver> = {
  landing: async () => ["/"],
  "sign-in": async () => ["/sign-in"],
  "control-agencies": async () => ["/control/agencies"],
  "control-agency": discovered("/control/agencies", "^/control/agencies/[^/?#]+$", "agency detail"),
  "setup-wizard": async (page) => {
    const direct = await discoverHref(page, "/control/agencies", rx("^/control/setup/[^/]+/[^/?#]+"))
    if (direct) return [direct]
    const agency = await discoverHref(page, "/control/agencies", rx("^/control/agencies/[^/?#]+$"))
    const nested = agency ? await discoverHref(page, agency, rx("^/control/setup/[^/]+/[^/?#]+")) : null
    return nested ? [nested] : { skip: "no setup draft link reachable from /control/agencies" }
  },
  activation: async (page) => {
    const agency = await discoverHref(page, "/control/agencies", rx("^/control/agencies/[^/?#]+$"))
    const href = agency ? await discoverHref(page, agency, rx("^/control/activations/[^/?#]+$")) : null
    return href ? [href] : { skip: "no activation run link reachable from the agency detail" }
  },
  "workspace-home": async () => [A],
  assistant: async () => [`${A}/assistant`],
  inbox: async () => [`${A}/inbox`],
  jobs: async () => [`${A}/jobs`],
  "job-dossier": async () => [`${A}/jobs/${ids.auroraJob}`, `${A}/jobs/${ids.labJob}`],
  "client-detail": async () => [`${A}/clients/${ids.auroraClient}`],
  "module-desk": async () => CONTRACT.modules.map((m) => `${A}/modules/${m.key}`),
  "workflow-workbench": async () => CONTRACT.workflow_bindings.map((w) => `${A}/modules/${w.module_key}/workflows/${w.skill_id}`),
  "business-record": discovered(`${A}/jobs/${ids.auroraJob}`, `^${A}/records/[^/]+/[^/?#]+$`, "business record"),
  capabilities: async () => [`${A}/capabilities`],
  approvals: async () => [`${A}/approvals`],
  "approval-detail": discovered(`${A}/approvals`, `^${A}/approvals/UUID$`, "approval"),
  runs: async () => [`${A}/runs`],
  "run-detail": discovered(`${A}/runs`, `^${A}/runs/UUID$`, "run"),
  connections: async () => [`${A}/connections`],
  "connection-detail": discovered(`${A}/connections`, `^${A}/connections/[^/?#]+$`, "connection"),
  library: async () => [`${A}/library`],
  "file-detail": async () => [`${A}/library/${ids.briefFile}`],
  settings: async (page) => {
    const sections = new Set<string>([`${A}/settings/brand`])
    await page.goto(`${A}/settings/brand`, { waitUntil: "domcontentloaded" }).catch(() => undefined)
    const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))
    for (const h of hrefs) if (new RegExp(`^${A}/settings/[a-z-]+$`).test(h)) sections.add(h)
    return [...sections]
  },
  explore: async () => [`${A}/explore`],
  report: discovered(`${A}/explore`, `^${A}/reports/[^/?#]+$`, "report"),
  "presenter-controls": async () => ["/demo/presenter"],
}

const PLATFORM = new Set(["platform-home", "platform-incident", "platform-change"])

test.describe("route contract", () => {
  test("the contract declares exactly 31 route patterns and every one has a resolver or platform check", () => {
    expect(CONTRACT.routes).toHaveLength(CONTRACT.expected_counts.route_patterns)
    expect(CONTRACT.routes).toHaveLength(31)
    const unresolved = CONTRACT.routes.filter((r) => !RESOLVERS[r.id] && !PLATFORM.has(r.id)).map((r) => r.id)
    expect(unresolved).toEqual([])
  })
})

test.describe("crawl all route patterns as the agency presenter", () => {
  for (const route of CONTRACT.routes.filter((r) => !PLATFORM.has(r.id))) {
    test(`${route.id} ${route.path}`, async ({ page }) => {
      test.setTimeout(route.id === "workflow-workbench" ? 600_000 : route.id === "module-desk" ? 240_000 : 120_000)
      const errors = collectPageErrors(page)
      const urls = await RESOLVERS[route.id]!(page)
      if (!Array.isArray(urls)) test.skip(true, urls.skip)
      const failures: string[] = []
      for (const url of urls as string[]) {
        try {
          await expectScreen(page, url)
        } catch (e) {
          failures.push(`${url}: ${(e as Error).message.split("\n")[0]}`)
        }
      }
      expect(failures, failures.join("\n")).toEqual([])
      expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toEqual([])
    })
  }
})

test.describe("platform routes are isolated from the agency session", () => {
  for (const url of ["/ops", "/ops/incidents/00000000-0000-4000-8000-000000000000", "/ops/changes/00000000-0000-4000-8000-000000000000"]) {
    test(`agency owner session gets 404 on ${url}`, async ({ page }) => {
      await expectScreen(page, url, { status: 404 })
    })
  }

  test("platform operator crawl of /ops and the incident detail (persona session, dedicated E2E DB)", async ({ browser }) => {
    test.skip(!e2eDatabaseUrl() || !existsSync(personaState("user_demo_platform_operator")), DEDICATED_SKIP)
    const context = await browser.newContext({ storageState: personaState("user_demo_platform_operator") })
    const page = await context.newPage()
    try {
      await expectScreen(page, "/ops")
      await expectScreen(page, `/ops/incidents/${fixtureUuid("ops_csv_delimiter_mismatch")}`)
      const change = await discoverHref(page, "/ops", /^\/ops\/changes\/[^/?#]+$/)
      if (change) await expectScreen(page, change)
      // The platform persona has no agency membership: the ERP never inherits /ops privileges.
      const res = await page.goto(A, { waitUntil: "domcontentloaded" })
      expect(res?.status()).toBe(404)
    } finally {
      await context.close()
    }
  })
})

test.describe("cross-tenant deep links resolve to not-found, never to another agency's data", () => {
  for (const [label, url] of [
    ["Norte job under Rayo", `${A}/jobs/${ids.norteJob}`],
    ["Norte client under Rayo", `${A}/clients/${ids.norteClient}`],
    ["Norte file under Rayo", `${A}/library/${ids.norteFile}`],
    ["Norte agency slug", "/a/norte-studio"],
  ] as const) {
    test(label, async ({ page }, info) => {
      const r = await expectNotFound(page, url, /Maple Fictional Foods|Private Norte launch|norte-private-brief/)
      if (r.soft) info.annotations.push({ type: "soft-404", description: `${url} rendered the not-found UI with HTTP 200 (streamed segment)` })
    })
  }
})
