import { defineConfig } from "drizzle-kit"

// Migrations run as the schema owner role (DATABASE_URL_MIGRATIONS). The app
// connects with a separate role without BYPASSRLS (DATABASE_URL).
export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL_MIGRATIONS ?? "",
  },
  strict: true,
})
