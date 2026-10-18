import { bigint, integer, timestamp, uuid } from "drizzle-orm/pg-core"

// Shared column builders. Money is always an integer of minor units
// (BIGINT) next to an explicit ISO currency column; never a float.

export const pk = () => uuid("id").primaryKey().defaultRandom()

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()

export const revision = () => integer("revision").notNull().default(1)

export const minor = (name: string) => bigint(name, { mode: "bigint" })
