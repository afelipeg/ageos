import { defineConfig, devices } from "@playwright/test"

// Browser E2E for AgeOS. Runs against an ALREADY RUNNING server
// (E2E_BASE_URL, default the shared dev server on :3100); it never starts one.
// Uses the system Google Chrome (channel "chrome"); no browser download.
//
// Read-only specs (any server):   pnpm exec playwright test --grep-invert @mutating
// Certification (dedicated DB, coordinator):
//   E2E_BASE_URL=http://localhost:3200 \
//   E2E_DATABASE_URL_MIGRATIONS=<owner url>/ageos_test_e2e \
//   E2E_STORAGE_DIR=<same AGEOS_STORAGE_DIR as the server> \
//   pnpm exec playwright test
// Specs tagged @mutating (journeys, assistant, locale) skip unless
// E2E_DATABASE_URL_MIGRATIONS names a dedicated e2e database.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100"
const dedicated = Boolean(process.env.E2E_DATABASE_URL_MIGRATIONS)
const desktop = { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } }
const phone = {
  channel: "chrome",
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: devices["Pixel 7"].userAgent,
}

export default defineConfig({
  testDir: "./tests/e2e",
  // Artifacts (traces, error-context page snapshots) go under the gitignored
  // .data/: Tailwind's source scan reads every non-ignored file, and a saved
  // page snapshot once injected an invalid class that broke globals.css.
  outputDir: "./.data/e2e-output",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  // One worker on the dedicated database: journeys reset checkpoints and the
  // ES project changes the presenter's saved locale.
  workers: Number(process.env.E2E_WORKERS ?? (dedicated ? 1 : 2)),
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: ".data/e2e-output/playwright-results.json" }], ["./tests/e2e/evidence-reporter.ts"]],
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
    storageState: "tests/e2e/.auth/presenter.json",
    locale: "en-US",
    timezoneId: "America/Mexico_City",
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // 1440 · EN · dark (default): routes, shell, journeys, assistant, visual.
    { name: "desktop", use: desktop, metadata: { locale: "en", theme: "dark" } },
    { name: "desktop-light", use: desktop, metadata: { locale: "en", theme: "light" }, grep: /@visual/ },
    { name: "desktop-es", use: desktop, metadata: { locale: "es", theme: "dark" }, grep: /@visual/ },
    // 390 · phone: shell Sheet, assistant Sheet, overflow, screenshots, visual.
    { name: "mobile", use: phone, metadata: { locale: "en", theme: "dark" }, grep: /@mobile|@screens|@visual/ },
    { name: "mobile-light-es", use: phone, metadata: { locale: "es", theme: "light" }, grep: /@visual/ },
  ],
})
