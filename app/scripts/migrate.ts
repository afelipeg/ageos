// Applies Drizzle migrations as the schema owner role, then re-applies the
// security baseline (grants, append-only audit, tenant RLS) so new tables are
// covered. Usage: pnpm db:migrate [--test]
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const useTest = process.argv.includes("--test")
const url = useTest
  ? process.env.TEST_DATABASE_URL_MIGRATIONS
  : process.env.DATABASE_URL_MIGRATIONS

if (!url) {
  console.error(
    `Missing ${useTest ? "TEST_DATABASE_URL_MIGRATIONS" : "DATABASE_URL_MIGRATIONS"}`
  )
  process.exit(1)
}

const sql = postgres(url, { max: 1, onnotice: () => {} })

try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" })
  await sql`select ageos_apply_security()`
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from pg_policies where policyname = 'tenant_isolation'`
  console.log(`migrations applied (${useTest ? "test" : "dev"}); RLS policies: ${count}`)
} finally {
  await sql.end()
}
