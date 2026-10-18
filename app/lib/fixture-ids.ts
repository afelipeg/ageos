import { createHash } from "node:crypto"

// Stable internal UUIDs for seed fixture keys (job_demo_aurora → same UUID on
// every reset), so links, tests and evidence stay reproducible. The readable
// key is also stored in fixture_key columns.
export function fixtureUuid(key: string): string {
  const h = createHash("sha256").update(`ageos-fixture:${key}`).digest("hex")
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}
