import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"

import type * as s from "@/server/db/schema"
import type { SeedMode } from "@/server/seed/demo-seed"

export type SeedDb = PostgresJsDatabase<typeof s>
export type SeedTx = Parameters<Parameters<SeedDb["transaction"]>[0]>[0]

/** Stable ids shared by every seed extension (see demo-seed.ts). */
export type SeedIds = {
  F: (key: string) => string
  RAYO: string
  NORTE: string
  owner: string
  operator: string
  finance: string
  producer: string
  viewer: string
  norteOwner: string
  storageDir: string
  /** Seed checkpoint: extensions skip journey-progress rows in `from_intake`. */
  mode: SeedMode
}
