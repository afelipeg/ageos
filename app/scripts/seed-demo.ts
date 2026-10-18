// Seeds (or with --reset, re-seeds) only the demo tenants. Runs as the schema
// owner role. Usage: pnpm db:seed:demo | pnpm db:reset:demo | pnpm db:reset:demo:intake
// [--test] [--mode=ready_for_scope_review|from_intake]
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "@/server/db/schema"
import { seedDemo, seedModeFromArgv, seedSummary } from "@/server/seed/demo-seed"

const useTest = process.argv.includes("--test")
const reset = process.argv.includes("--reset")
const mode = seedModeFromArgv(process.argv)
const url = useTest ? process.env.TEST_DATABASE_URL_MIGRATIONS : process.env.DATABASE_URL_MIGRATIONS
if (!url) {
  console.error("Missing DATABASE_URL_MIGRATIONS")
  process.exit(1)
}
const sql = postgres(url, { max: 1, onnotice: () => {} })
try {
  const db = drizzle(sql, { schema })
  const res = await seedDemo(db, { storageDir: process.env.AGEOS_STORAGE_DIR ?? ".data/private-files", reset, mode, actor: null })
  const summary = await seedSummary(db)
  console.log(
    res.seeded
      ? `demo seed applied (${reset ? "reset" : "fresh"}, ${res.mode}): ${summary.jobs} jobs, ${summary.users} demo personas` +
          (res.skippedExtensions.length ? `; skipped extensions: ${res.skippedExtensions.map((x) => x.name).join(", ")}` : "")
      : "demo tenants already seeded; use pnpm db:reset:demo to rebuild them"
  )
} finally {
  await sql.end()
}
