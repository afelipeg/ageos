import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { fixtureUuid } from "@/lib/fixture-ids"
import { resolveAgencyContext, type AgencyContext } from "@/server/auth/context"
import type { SessionInfo } from "@/server/auth/session"
import * as schema from "@/server/db/schema"
import { seedDemo } from "@/server/seed/demo-seed"

// Test helpers. The owner connection is used only to (re)build fixtures;
// everything under test runs through the application role (DATABASE_URL).

let ownerSql: ReturnType<typeof postgres> | null = null

export function ownerDb() {
  if (!ownerSql) ownerSql = postgres(process.env.DATABASE_URL_MIGRATIONS!, { max: 2, onnotice: () => {} })
  return drizzle(ownerSql, { schema })
}

export async function closeOwnerDb() {
  await ownerSql?.end()
  ownerSql = null
}

export async function resetDemo() {
  await seedDemo(ownerDb(), { storageDir: process.env.AGEOS_STORAGE_DIR!, reset: true })
}

export const id = fixtureUuid

export async function sessionFor(userKey: string): Promise<SessionInfo> {
  const [u] = await ownerDb().select().from(schema.appUser).where(eq(schema.appUser.id, fixtureUuid(userKey)))
  if (!u) throw new Error(`no user ${userKey}`)
  return {
    sessionId: fixtureUuid(`session:${userKey}`),
    presenter: false,
    presenterUserId: null,
    user: {
      id: u.id,
      fixtureKey: u.fixtureKey,
      displayName: u.displayName,
      email: u.email,
      locale: u.locale === "es" ? "es" : "en",
      kind: u.kind,
      platformRole: u.platformRole,
      demoPersona: u.demoPersona,
    },
  }
}

export async function ctxFor(userKey: string, slug = "rayo-de-sol"): Promise<AgencyContext> {
  const ctx = await resolveAgencyContext(await sessionFor(userKey), slug)
  if (!ctx) throw new Error(`${userKey} has no membership in ${slug}`)
  return ctx
}

let counter = 0
export const key = (label: string) => `test:${label}:${Date.now()}:${counter++}`
