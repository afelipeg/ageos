import { spawnSync } from "node:child_process"
import { createHmac, randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import postgres from "postgres"

import { fixtureUuid } from "../../lib/fixture-ids"

// Dedicated-E2E environment. Mutating specs (journeys, assistant, locale)
// run ONLY when E2E_DATABASE_URL_MIGRATIONS points at a database whose name
// contains "e2e" (e.g. ageos_test_e2e) — the same database the server under
// test (E2E_BASE_URL, `next start`) uses. Nothing here ever touches ageos_dev.

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const APP_DIR = path.resolve(HERE, "../..")
export const AUTH_DIR = path.join(APP_DIR, "tests/e2e/.auth")

export const PERSONAS = [
  "user_demo_owner",
  "user_demo_operator",
  "user_demo_finance",
  "user_demo_producer",
  "user_demo_viewer",
  "user_demo_norte_owner",
  "user_demo_platform_operator",
  "user_demo_platform_admin",
] as const
export type PersonaKey = (typeof PERSONAS)[number]

export const personaState = (k: PersonaKey | "presenter") => path.join(AUTH_DIR, `${k}.json`)

function localEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  try {
    const line = readFileSync(path.join(APP_DIR, ".env.local"), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`))
    return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
  } catch {
    return undefined
  }
}

/** Owner URL of the dedicated E2E database, or null (mutating specs skip). */
export function e2eDatabaseUrl(): string | null {
  const url = process.env.E2E_DATABASE_URL_MIGRATIONS
  if (!url) return null
  const name = new URL(url).pathname.replace(/^\//, "")
  if (!/e2e/.test(name) || name === "ageos_dev") throw new Error(`E2E_DATABASE_URL_MIGRATIONS must name a dedicated e2e database (got "${name}")`)
  return url
}

export const DEDICATED_SKIP = "mutating spec: set E2E_DATABASE_URL_MIGRATIONS to the dedicated e2e database used by the server under test"

/** Rebuilds the demo tenants of the E2E database at a checkpoint (seed script, owner role). */
export function resetCheckpoint(mode: "ready_for_scope_review" | "from_intake") {
  const url = e2eDatabaseUrl()
  if (!url) throw new Error(DEDICATED_SKIP)
  const res = spawnSync(
    "pnpm",
    ["exec", "tsx", "--conditions=react-server", "--env-file-if-exists=.env.local", "scripts/seed-demo.ts", "--reset", `--mode=${mode}`],
    {
      cwd: APP_DIR,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL_MIGRATIONS: url, AGEOS_STORAGE_DIR: process.env.E2E_STORAGE_DIR ?? ".data/e2e-files" },
    }
  )
  if (res.status !== 0) throw new Error(`checkpoint reset (${mode}) failed: ${(res.stderr || res.stdout).slice(-500)}`)
  return res.stdout.trim()
}

/**
 * Opens one server session per synthetic persona in the E2E database, exactly
 * as the presenter's persona switch does (presenter = demo owner), and writes a
 * Playwright storage state per persona. Tokens never leave the test machine.
 */
export async function mintPersonaStates(baseURL: string) {
  const url = e2eDatabaseUrl()
  if (!url) return false
  const secret = localEnv("AGEOS_SESSION_SECRET")
  if (!secret) throw new Error("AGEOS_SESSION_SECRET (same as the server under test) is required to open persona sessions")
  mkdirSync(AUTH_DIR, { recursive: true })
  const host = new URL(baseURL).hostname
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    for (const key of PERSONAS) {
      const token = randomBytes(32).toString("base64url")
      const expiresAt = new Date(Date.now() + 10 * 3600 * 1000)
      await sql`insert into app_session (token_hash, user_id, presenter_user_id, expires_at)
                values (${createHmac("sha256", secret).update(token).digest("hex")}, ${fixtureUuid(key)}, ${fixtureUuid("user_demo_owner")}, ${expiresAt})`
      writeFileSync(
        personaState(key),
        JSON.stringify({
          cookies: [{ name: "ageos_session", value: token, domain: host, path: "/", expires: Math.floor(expiresAt.getTime() / 1000), httpOnly: true, secure: false, sameSite: "Lax" }],
          origins: [],
        })
      )
    }
  } finally {
    await sql.end()
  }
  return true
}
