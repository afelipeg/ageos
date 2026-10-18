import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

// Migrates the dedicated test database and rebuilds the demo tenants once per
// test run. Never touches DATABASE_URL (dev).
export default async function setup() {
  try {
    process.loadEnvFile(".env.local")
  } catch {
    // CI provides the variables directly.
  }
  const env = process.env
  const url = env.TEST_DATABASE_URL_MIGRATIONS
  if (!url) throw new Error("TEST_DATABASE_URL_MIGRATIONS is required for tests")
  if (url === env.DATABASE_URL_MIGRATIONS) throw new Error("Refusing to run tests against the dev database")
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" })
    await sql`select ageos_apply_security()`
  } finally {
    await sql.end()
  }
}
