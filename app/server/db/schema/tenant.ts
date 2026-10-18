import { type PgColumn, unique, uuid } from "drizzle-orm/pg-core"

import { agency } from "./platform"

// Every tenant table carries tenant_id NOT NULL plus UNIQUE (tenant_id, id),
// so child tables can reference parents through a composite foreign key that
// includes the tenant. A valid UUID from another agency therefore cannot be
// linked. RLS policies on tenant_id are installed by the security migration.

export const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => agency.id)

export const tenantUnique = (
  table: string,
  t: { tenantId: PgColumn; id: PgColumn }
) => unique(`${table}_tenant_id_uq`).on(t.tenantId, t.id)
