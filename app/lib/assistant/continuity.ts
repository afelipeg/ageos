// Pure helpers for page ↔ panel continuity (drafts, thread selection,
// return-to-work). Kept framework-free so they are unit tested directly.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isThreadId(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v)
}

/** Draft key: one unsent draft per agency, user and thread ("new" before the first send). */
export function draftKey(slug: string, viewerId: string | null, threadId: string | null): string {
  return `${slug}:${viewerId ?? "anon"}:${threadId ?? "new"}`
}

/**
 * Validates an internal "return to work" target: same origin, inside the
 * current agency, never the assistant page itself. Keeps path, search and hash.
 */
export function safeReturnTo(target: string | null | undefined, slug: string, origin = "http://agency.local"): string | null {
  if (!target || typeof target !== "string" || target.length > 2000) return null
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return null
  let url: URL
  try {
    url = new URL(target, origin)
  } catch {
    return null
  }
  if (url.origin !== new URL(origin).origin) return null
  const base = `/a/${slug}`
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return null
  if (url.pathname === `${base}/assistant` || url.pathname.startsWith(`${base}/assistant/`)) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Request generation guard: every selection change bumps the generation; a
 * response is applied only if it belongs to the generation it was sent in.
 */
export function createGenerationGuard() {
  let gen = 0
  return {
    current: () => gen,
    bump: () => ++gen,
    isCurrent: (g: number) => g === gen,
  }
}
