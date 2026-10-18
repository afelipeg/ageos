// Seed extension owned by Platform (configuration drafts, import profiles,
// platform incidents, presenter fixtures). Runs inside the demo seed transaction.
import { eq } from "drizzle-orm"

import * as s from "@/server/db/schema"

import type { SeedIds, SeedTx } from "./types"

/**
 * Presenter fixture (05-guion "Preparación" step 3): a Rayo de Sol / Estudio
 * Solar configuration draft r2 parked at Review (steps 1–4 saved), copied from
 * the published r1 so deploying it is a real activation run that recovers the
 * existing workspace and opens /a/rayo-de-sol. It changes no capability (an
 * active agency's capability change needs owner approval with SoD).
 */
export async function seedPlatform(tx: SeedTx, ids: SeedIds): Promise<void> {
  const [r1] = await tx.select().from(s.configurationRevision).where(eq(s.configurationRevision.id, ids.F("config_rayo_r1"))).limit(1)
  if (!r1) return
  await tx.insert(s.configurationRevision).values({
    id: ids.F("config_rayo_r2_draft"),
    tenantId: ids.RAYO,
    number: 2,
    state: "draft",
    schemaVersion: r1.schemaVersion,
    agencyProfile: r1.agencyProfile as object,
    operations: r1.operations as object,
    connections: r1.connections as object,
    brandAccess: r1.brandAccess as object,
    enabledCapabilities: r1.enabledCapabilities,
    approvalPolicy: r1.approvalPolicy as object,
    limits: r1.limits as object,
    lastCompletedStep: 4,
    basedOnRevisionId: r1.id,
    createdBy: ids.owner,
  })
}
