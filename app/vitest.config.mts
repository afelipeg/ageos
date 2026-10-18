import path from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// Unit tests run in jsdom; integration tests (tests/integration, opt in with
// `// @vitest-environment node`) use the dedicated test database from
// TEST_DATABASE_URL*, never the dev database.
export default defineConfig(() => {
  const env = loadLocalEnv()
  return {
    plugins: [react()],
    resolve: {
      tsconfigPaths: true,
      alias: { "server-only": path.resolve(__dirname, "tests/server-only-stub.ts") },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      globalSetup: ["./tests/global-setup.ts"],
      include: ["**/*.{test,spec}.{ts,tsx}"],
      exclude: ["node_modules", ".next", "tests/e2e/**"],
      fileParallelism: false,
      testTimeout: 30000,
      hookTimeout: 60000,
      env: {
        ...Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined)),
        DATABASE_URL: env.TEST_DATABASE_URL ?? "",
        DATABASE_URL_MIGRATIONS: env.TEST_DATABASE_URL_MIGRATIONS ?? "",
        TEST_DATABASE_URL: env.TEST_DATABASE_URL ?? "",
        TEST_DATABASE_URL_MIGRATIONS: env.TEST_DATABASE_URL_MIGRATIONS ?? "",
        AGEOS_STORAGE_DIR: env.AGEOS_STORAGE_DIR?.startsWith(".data/test-") ? env.AGEOS_STORAGE_DIR : ".data/test-private-files",
      },
    },
  }
})

function loadLocalEnv(): Record<string, string | undefined> {
  try {
    process.loadEnvFile(".env.local")
  } catch {
    // CI provides the variables directly.
  }
  return { ...process.env }
}
