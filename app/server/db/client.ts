import "server-only"

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { env } from "@/server/env"

import * as schema from "./schema"

export type Db = PostgresJsDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export type Executor = Db | Tx

// One pooled client per server process (reused across hot reloads in dev).
const globalForDb = globalThis as unknown as {
  ageosSql?: ReturnType<typeof postgres>
  ageosDb?: Db
}

export function db(): Db {
  if (!globalForDb.ageosDb) {
    globalForDb.ageosSql = postgres(env().DATABASE_URL, {
      max: 10,
      prepare: false,
    })
    globalForDb.ageosDb = drizzle(globalForDb.ageosSql, { schema })
  }
  return globalForDb.ageosDb
}
