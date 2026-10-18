"use client"

import { useEffect, useRef } from "react"
import { usePathname, useSearchParams } from "next/navigation"

/**
 * Global page-load progress bar — a thin bar pinned to the top of the viewport
 * that appears the instant an in-app navigation starts and completes when the
 * new route has committed (YouTube / GitHub style). No third-party dependency.
 *
 * Ported from the framework-agnostic spec (page-load-progress-bar). The timings
 * and easing below are tuned values, not placeholders.
 *
 * Next.js App Router has no reliable "navigation started" event that fires
 * before the request, so START is detected two ways:
 *   - a capture-phase click listener on internal <Link> clicks (fires on click,
 *     before the request), and
 *   - `startTopProgress()`, an imperative helper for programmatic navigation
 *     (router.push after a form submit, sign-out, command palettes, …).
 * DONE is the pathname/search committing. Back/forward (popstate) is handled.
 *
 * The ramp is driven IMPERATIVELY (rAF writing the DOM width via a ref), NOT via
 * React state: a Next.js navigation is a React transition, and state updates
 * during a pending transition are deprioritized — which made a state-driven bar
 * jump 0→100 instead of ramping. Writing the ref each frame sidesteps that and,
 * per the spec, tracks the curve exactly with no competing transition. The bar
 * element stays mounted (opacity 0, width 0, aria-hidden, non-interactive) while
 * idle so the ref is always available; it is effectively "nothing" when idle.
 */

// ── Tuned constants (from the spec) ──
const CAP = 90 // % — asymptote while waiting; never 100 until the page lands
const TAU = 1100 // ms — ramp time constant
const MIN_VISIBLE = 400 // ms — minimum on-screen time (fast navs still read as a pass)
const GLIDE_MS = 350 // ms — glide the fill to 100%
const FADE_MS = 350 // ms — fade the bar out
const SAFETY_MS = 12000 // ms — force-finish so the bar can never be stranded

// Cross-instance handles so the route-watching effect and programmatic call
// sites can reach the current bar without re-registering listeners.
let startExternally: (() => void) | null = null
let finishExternally: (() => void) | null = null
// Fires the reload pass once per document load (the persistent layout component
// mounts once per full page load; client navs reuse it and never re-run mount).
let initialLoadShown = false

/** Start the bar for a navigation that produces no link click (router.push, redirects). */
export function startTopProgress() {
  startExternally?.()
}

function isModified(e: MouseEvent) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
}

/** The in-app destination this click will navigate to, or null if the bar must ignore it. */
function navigableTarget(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || isModified(e)) return null
  const anchor = (e.target as Element | null)?.closest?.("a")
  if (!anchor) return null
  if (anchor.target && anchor.target !== "_self") return null
  if (anchor.hasAttribute("download")) return null
  const href = anchor.getAttribute("href")
  if (!href || href.startsWith("#")) return null
  let url: URL
  try {
    url = new URL(href, window.location.href)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  // no-op: destination path AND query are identical to the current URL
  if (
    url.pathname === window.location.pathname &&
    url.search === window.location.search
  ) {
    return null
  }
  return url.pathname + url.search
}

export function TopProgressBar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const wrapRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<"idle" | "loading" | "waiting" | "closing">("idle")
  const startTimeRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const reducedRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    reducedRef.current =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

    const clearSeq = () => {
      seqRef.current.forEach(clearTimeout)
      seqRef.current = []
    }
    const seq = (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms)
      seqRef.current.push(id)
      return id
    }

    const reset = () => {
      stateRef.current = "idle"
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (safetyRef.current) clearTimeout(safetyRef.current)
      clearSeq()
      if (barRef.current) {
        barRef.current.style.transition = "none"
        barRef.current.style.width = "0%"
      }
      if (wrapRef.current) wrapRef.current.style.opacity = "0"
    }

    const finish = () => {
      if (stateRef.current !== "loading") return
      // DONE received — but keep the ramp running until the minimum on-screen
      // time is met, so a fast navigation still reads as a smooth pass and never
      // as a 0→100 jump. Only stop the ramp when the glide actually starts.
      stateRef.current = "waiting"
      if (safetyRef.current) clearTimeout(safetyRef.current)
      const elapsed = performance.now() - startTimeRef.current
      const wait = Math.max(0, MIN_VISIBLE - elapsed)
      seq(() => {
        stateRef.current = "closing"
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        if (barRef.current) {
          barRef.current.style.transition = `width ${GLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
          barRef.current.style.width = "100%"
        }
        seq(() => {
          if (wrapRef.current) {
            wrapRef.current.style.transition = `opacity ${FADE_MS}ms ease-out`
            wrapRef.current.style.opacity = "0"
          }
          seq(reset, FADE_MS)
        }, GLIDE_MS)
      }, wait)
    }

    const begin = () => {
      if (stateRef.current !== "idle") return // ignore overlapping starts
      clearSeq()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      stateRef.current = "loading"
      startTimeRef.current = performance.now()
      if (wrapRef.current) {
        wrapRef.current.style.transition = "none"
        wrapRef.current.style.opacity = "1"
      }
      if (barRef.current) {
        barRef.current.style.transition = "none"
        barRef.current.style.width = "0%"
      }
      safetyRef.current = setTimeout(finish, SAFETY_MS)
      if (reducedRef.current) {
        // Reduced motion: no per-frame ramp — hold near the cap until DONE.
        if (barRef.current) barRef.current.style.width = `${CAP}%`
        return
      }
      const tick = () => {
        // Ramp through "loading" and "waiting" (DONE-but-min-visible-not-met).
        if (stateRef.current !== "loading" && stateRef.current !== "waiting")
          return
        const elapsed = performance.now() - startTimeRef.current
        const pct = CAP * (1 - Math.exp(-elapsed / TAU))
        if (barRef.current) barRef.current.style.width = `${pct}%`
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    startExternally = begin
    finishExternally = finish

    const onClick = (e: MouseEvent) => {
      if (navigableTarget(e)) begin()
    }
    const onPopState = () => begin()

    document.addEventListener("click", onClick, { capture: true })
    window.addEventListener("popstate", onPopState)

    // Full page load / browser reload: run one brief pass on the first mount.
    // The component is already hydrated by now, so finish() immediately — the
    // min-visible hold makes it a quick, visible "loaded" pass, matching the way
    // a full reload shows the bar in template-2.
    if (!initialLoadShown) {
      initialLoadShown = true
      begin()
      finish()
    }

    return () => {
      document.removeEventListener("click", onClick, { capture: true })
      window.removeEventListener("popstate", onPopState)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (safetyRef.current) clearTimeout(safetyRef.current)
      clearSeq()
      startExternally = null
      finishExternally = null
      // Allow the reload pass to re-arm on a genuine remount (e.g. React
      // Strict Mode's dev double-mount); client navs never reach here.
      initialLoadShown = false
    }
  }, [])

  // DONE: the new route committed. Skip the initial mount.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    finishExternally?.()
  }, [pathname, searchParams])

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-0.5 opacity-0 will-change-[opacity]"
    >
      <div ref={barRef} className="h-full w-0 bg-primary will-change-[width]" />
    </div>
  )
}
