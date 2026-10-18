import "server-only"

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

// Private file storage. Development uses a local directory outside public/
// (AGEOS_STORAGE_DIR, default .data/private-files). Bytes are only served by
// an authorized route handler after a tenant-scoped metadata lookup; nothing
// here is web-accessible. A Vercel deployment swaps this adapter for private
// Blob storage behind the same interface.

export interface PrivateStorage {
  put(tenantId: string, objectId: string, bytes: Uint8Array): Promise<{ storageKey: string; sha256: string; size: number }>
  get(tenantId: string, storageKey: string): Promise<Uint8Array>
  /** Creates (idempotently) the tenant's private prefix; used by agency activation. */
  prepareTenant(tenantId: string): Promise<{ prefix: string; adapter: string; publicAccess: false }>
}

const SAFE = /^[0-9a-f-]{36}$/i

function root(): string {
  return path.resolve(process.cwd(), process.env.AGEOS_STORAGE_DIR ?? ".data/private-files")
}

function resolveKey(tenantId: string, storageKey: string): string {
  const [t, o] = storageKey.split("/")
  if (!t || !o || t !== tenantId || !SAFE.test(t) || !SAFE.test(o)) throw new Error("Invalid storage key")
  const full = path.resolve(root(), t, o)
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage path")
  return full
}

export const privateDisk: PrivateStorage = {
  async put(tenantId, objectId, bytes) {
    if (!SAFE.test(tenantId) || !SAFE.test(objectId)) throw new Error("Invalid ids")
    const storageKey = `${tenantId}/${objectId}`
    const full = resolveKey(tenantId, storageKey)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, bytes, { flag: "wx" }).catch(async (e: NodeJS.ErrnoException) => {
      // Objects are immutable: a new version gets a new objectId.
      if (e.code === "EEXIST") throw new Error("Object already exists")
      throw e
    })
    return { storageKey, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength }
  },
  async get(tenantId, storageKey) {
    return new Uint8Array(await readFile(resolveKey(tenantId, storageKey)))
  },
  async prepareTenant(tenantId) {
    if (!SAFE.test(tenantId)) throw new Error("Invalid ids")
    const dir = path.resolve(root(), tenantId)
    if (!dir.startsWith(root() + path.sep)) throw new Error("Invalid storage path")
    await mkdir(dir, { recursive: true })
    return { prefix: `${tenantId}/`, adapter: "private-disk", publicAccess: false as const }
  },
}
