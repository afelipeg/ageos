// Runs Vitest against an isolated per-agent test database, never dev.
// Usage: pnpm test:agent <core1|core2|core3|platform|assistant|screens|qa|coord> [vitest args...]
//
// Each run rebuilds the agent database from scratch along the same path the
// integration migration will take:
//   1. drop and recreate the `public` and `drizzle` schemas of ageos_test_<agent>;
//   2. copy the committed migrations to .data/drizzle-wip/<agent> and let
//      drizzle-kit generate one extra migration for the in-progress schema;
//   3. apply all of them, then the security baseline (grants, RLS, append-only);
//   4. run vitest with TEST_DATABASE_URL* pointing at that database.
// `drizzle-kit push` is not used: against an existing database it plans to drop
// and re-add the composite unique/FK constraints (Postgres truncates names to
// 63 characters), fails on the first dependent constraint and still exits 0.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const AGENTS = ["core1", "core2", "core3", "platform", "assistant", "screens", "qa", "coord"]
const [agent, ...rest] = process.argv.slice(2)
if (!agent || !AGENTS.includes(agent)) {
  console.error(`Usage: pnpm test:agent <${AGENTS.join("|")}> [vitest args]`)
  process.exit(2)
}
const dbName = `ageos_test_${agent}`
const swap = (url: string | undefined) => {
  if (!url) throw new Error("TEST_DATABASE_URL* missing in .env.local")
  const u = new URL(url)
  u.pathname = `/${dbName}`
  return u.toString()
}
const owner = swap(process.env.TEST_DATABASE_URL_MIGRATIONS)
const app = swap(process.env.TEST_DATABASE_URL)
if (owner === process.env.DATABASE_URL_MIGRATIONS) throw new Error("Refusing to touch the dev database")

// 1. Fresh schemas (the database itself is kept: its owner has no rights on
// other databases and agents may hold idle connections to it).
const reset = postgres(owner, { max: 1, onnotice: () => {} })
const [{ current }] = await reset<{ current: string }[]>`select current_database() as current`
if (current !== dbName) throw new Error(`Connected to ${current}, expected ${dbName}`)
await reset.unsafe("drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;")
await reset.end()

// 2. Committed migrations + one generated migration for work in progress.
const wip = `.data/drizzle-wip/${agent}`
if (existsSync(wip)) rmSync(wip, { recursive: true, force: true })
mkdirSync(wip, { recursive: true })
cpSync("./drizzle", wip, { recursive: true })
const gen = spawnSync(
  "pnpm",
  ["exec", "drizzle-kit", "generate", "--dialect=postgresql", "--schema=./server/db/schema/index.ts", `--out=${wip}`, "--name=agent_wip"],
  { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 120_000 },
)
if (gen.status !== 0) {
  console.error("drizzle-kit generate failed (a schema file may be mid-edit, or a rename needs an interactive answer):")
  console.error(gen.stdout, gen.stderr)
  process.exit(gen.status ?? 1)
}
const extra = readdirSync(wip).filter((f) => f.endsWith("_agent_wip.sql"))
console.log(`[test:agent] ${dbName}: committed migrations + ${extra.length ? extra.join(", ") : "no schema changes"}`)

// 3. Apply and secure.
const sql = postgres(owner, { max: 1, onnotice: () => {} })
try {
  await migrate(drizzle(sql), { migrationsFolder: wip })
  await sql`select ageos_apply_security()`
} catch (error) {
  console.error(`[test:agent] migration failed on ${dbName}:`, error)
  process.exit(1)
} finally {
  await sql.end()
}

// 4. Tests.
const res = spawnSync("pnpm", ["exec", "vitest", "run", ...rest], {
  stdio: "inherit",
  env: {
    ...process.env,
    TEST_DATABASE_URL: app,
    TEST_DATABASE_URL_MIGRATIONS: owner,
    AGEOS_STORAGE_DIR: `.data/test-${agent}-files`,
  },
})
process.exit(res.status ?? 1)
