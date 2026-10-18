import "server-only"

import { NextResponse, type NextRequest } from "next/server"

import type { AgencyContext } from "@/server/auth/context"
import { agencyContextForApi } from "@/server/auth/request"
import { DomainError, isDomainError } from "@/server/kernel/errors"

// JSON route-handler wrapper: resolves the agency actor from the session (404
// for non-members, never revealing other agencies), rejects cross-origin
// mutations, and maps domain errors to stable codes.

export async function withAgencyApi(
  req: NextRequest,
  agencySlug: string,
  fn: (ctx: AgencyContext) => Promise<unknown>
) {
  try {
    if (req.method !== "GET") {
      const origin = req.headers.get("origin")
      if (origin && new URL(origin).host !== req.headers.get("host")) {
        throw new DomainError("forbidden", "Cross-origin request rejected")
      }
    }
    const ctx = await agencyContextForApi(agencySlug)
    if (!ctx) {
      return NextResponse.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
    }
    const body = await fn(ctx)
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } })
  } catch (e) {
    if (isDomainError(e)) return NextResponse.json({ error: e.toJSON() }, { status: e.status })
    if (e && typeof e === "object" && "issues" in e) {
      return NextResponse.json({ error: { code: "validation", message: "Invalid request", details: {} } }, { status: 422 })
    }
    console.error("[ageos] api error", e)
    return NextResponse.json({ error: { code: "internal", message: "Unexpected error" } }, { status: 500 })
  }
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text()
  if (text.length > 20_000) throw new DomainError("validation", "Request too large")
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new DomainError("validation", "Invalid JSON")
  }
}
