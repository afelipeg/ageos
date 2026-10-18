"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { draftKey, isThreadId, safeReturnTo } from "@/lib/assistant/continuity"
import type { AssistantContextHint, AssistantStateView, ConversationView, MessageView, SuggestionView } from "@/lib/assistant/types"

// One conversation runtime for the agency layout. The full page and the
// right-hand panel both render from this state, so navigating, opening,
// closing or expanding never forks the thread. The server owns history: this
// provider only sends new turns, preset ids and confirmation clicks.
//
// Continuity rules (F02/F03/F04/F08):
// - One unsent draft per agency/user/thread, kept here (survives page ↔ panel,
//   close/reopen); cleared only when the server accepts the send.
// - The selected thread is `?thread=` on the full page and a remembered
//   preference elsewhere; a deep link to a foreign id shows not-found, never
//   another thread.
// - Every selection change bumps a generation; a late response from an older
//   selection is persisted on the server but never replaces the current view.
// - Return to work restores pathname + search + hash, validated in the agency.

type PinnedRecord = { type: "job"; id: string; label: string } | null

type View = AssistantStateView & { viewerId?: string }

type AssistantState = {
  slug: string
  conversation: ConversationView | null
  messages: MessageView[]
  suggestions: SuggestionView[]
  loading: boolean
  sending: boolean
  error: string | null
  /** The requested thread does not exist or is not yours (uniform not-found). */
  threadNotFound: boolean
  panelOpen: boolean
  pinned: PinnedRecord
  context: AssistantContextHint
  /** Route to return to after expanding the panel into the full page. */
  returnTo: string | null
  draft: string
}

type AssistantActions = {
  openPanel: (opts?: { pin?: PinnedRecord; prefill?: string }) => void
  closePanel: () => void
  expand: () => void
  returnToWork: () => void
  send: (input: { text?: string; presetId?: string }) => Promise<boolean>
  confirm: (proposalId: string, digest: string) => Promise<void>
  cancelRun: () => Promise<void>
  resumeRun: () => Promise<void>
  newConversation: () => Promise<void>
  openConversation: (id: string) => Promise<void>
  setPinned: (pin: PinnedRecord) => void
  setDraft: (v: string) => void
  /** Bumped when a prefill should move focus into the composer. */
  focusToken: number
  isAssistantPage: boolean
  refresh: () => Promise<void>
}

const Ctx = createContext<(AssistantState & AssistantActions) | null>(null)

const panelKey = (slug: string) => `ageos:assistant-panel:${slug}`
const threadKey = (slug: string) => `ageos:assistant-thread:${slug}`
const returnKey = (slug: string) => `ageos:assistant-return:${slug}`

function deriveContext(pathname: string, slug: string, pinned: PinnedRecord): AssistantContextHint {
  const base = `/a/${slug}`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : ""
  const parts = rest.split("/").filter(Boolean)
  const hint: AssistantContextHint = { route: pathname, moduleKey: null, record: null }
  if (parts[0] === "modules" && parts[1]) hint.moduleKey = parts[1]
  if (parts[0] === "jobs" && parts[1]) hint.record = { type: "job", id: parts[1] }
  if (pinned) hint.record = { type: pinned.type, id: pinned.id }
  return hint
}

class ApiError extends Error {
  code: string | undefined
  status: number
  constructor(message: string, code: string | undefined, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(body?.error?.message ?? res.statusText, body?.error?.code, res.status)
  return body as T
}

const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) window.localStorage.removeItem(key)
      else window.localStorage.setItem(key, value)
    } catch {
      /* storage unavailable: preference not remembered */
    }
  },
  session(key: string, value?: string | null): string | null {
    try {
      if (value === undefined) return window.sessionStorage.getItem(key)
      if (value === null) window.sessionStorage.removeItem(key)
      else window.sessionStorage.setItem(key, value)
    } catch {
      /* ignore */
    }
    return null
  },
}

export function AssistantProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const assistantPath = `/a/${slug}/assistant`
  const isAssistantPage = pathname === assistantPath
  const urlThread = isAssistantPage ? searchParams.get("thread") : null

  const [conversation, setConversation] = useState<ConversationView | null>(null)
  const [messages, setMessages] = useState<MessageView[]>([])
  const [suggestions, setSuggestions] = useState<SuggestionView[]>([])
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [threadNotFound, setThreadNotFound] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [pinned, setPinned] = useState<PinnedRecord>(null)
  const [returnTo, setReturnTo] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pendingKeys, setPendingKeys] = useState<string[]>([])
  const [focusToken, setFocusToken] = useState(0)

  // Generation guard + current selection, readable from async callbacks.
  const gen = useRef(0)
  const selected = useRef<string | null>(null)
  const resumed = useRef(new Set<string>())

  const context = useMemo(() => deriveContext(pathname, slug, pinned), [pathname, slug, pinned])
  const base = `/api/a/${slug}/assistant`
  const currentKey = draftKey(slug, viewerId, conversation?.id ?? null)

  const applyView = useCallback(
    (view: View) => {
      setConversation(view.conversation)
      setMessages(view.messages)
      setSuggestions(view.suggestions ?? [])
      setThreadNotFound(false)
      if (view.viewerId) setViewerId(view.viewerId)
      selected.current = view.conversation?.id ?? null
      if (view.conversation?.id) store.set(threadKey(slug), view.conversation.id)
    },
    [slug]
  )

  /** Applies a response only if no newer selection happened since `g`. */
  const applyIfCurrent = useCallback(
    (g: number, view: View) => {
      if (g !== gen.current) return false
      applyView(view)
      return true
    },
    [applyView]
  )

  const syncUrl = useCallback(
    (id: string | null) => {
      if (!isAssistantPage) return
      const current = new URLSearchParams(window.location.search).get("thread")
      if (id && current !== id) router.replace(`${assistantPath}?thread=${id}`, { scroll: false })
    },
    [assistantPath, isAssistantPage, router]
  )

  const load = useCallback(
    async (thread: string | null, strict: boolean) => {
      // `loading` starts true for the first load; later loads keep the current
      // view until the new one is applied.
      const g = ++gen.current
      let target = thread
      try {
        for (;;) {
          try {
            const q = target ? `?thread=${encodeURIComponent(target)}` : ""
            const view = await api<View>(`${base}/state${q}`)
            if (applyIfCurrent(g, view)) {
              setError(null)
              syncUrl(view.conversation?.id ?? null)
            }
            return
          } catch (e) {
            if (g !== gen.current) return
            if (e instanceof ApiError && e.code === "not_found" && target) {
              if (strict) {
                // Deep link to a thread that is not yours: uniform not-found, no fallback.
                setConversation(null)
                setMessages([])
                selected.current = null
                setThreadNotFound(true)
                setError(null)
                return
              }
              // A remembered selection that no longer resolves falls back to the latest thread.
              store.set(threadKey(slug), null)
              target = null
              continue
            }
            setError((e as Error).message)
            return
          }
        }
      } finally {
        if (g === gen.current) setLoading(false)
      }
    },
    [applyIfCurrent, base, slug, syncUrl]
  )

  const refresh = useCallback(() => load(selected.current, false), [load])

  // Initial load per agency: ?thread= (strict) > remembered selection > latest.
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    const remembered = store.get(threadKey(slug))
    if (urlThread) {
      selected.current = urlThread
      void load(urlThread, true)
    } else void load(isThreadId(remembered) ? remembered : null, false)
    // Browser-only preferences are read after mount (no SSR mismatch).
    void Promise.resolve().then(() => {
      setPanelOpen(store.get(panelKey(slug)) === "open")
      setReturnTo(safeReturnTo(store.session(returnKey(slug)), slug, window.location.origin))
    })
  }, [load, slug, urlThread])

  // The URL is the source of truth on the full page: follow ?thread= changes
  // (paste, back/forward) and reflect the current selection when absent.
  useEffect(() => {
    if (!booted.current || !isAssistantPage) return
    if (urlThread && urlThread !== selected.current) void load(urlThread, true)
    else if (!urlThread && selected.current) syncUrl(selected.current)
  }, [isAssistantPage, load, syncUrl, urlThread])

  // A run left `running` without a live worker is reconciled once, from its
  // last checkpoint, with the same idempotency keys (no duplicate effects).
  const resumeRun = useCallback(async () => {
    const run = conversation?.activeRun
    if (!conversation || !run) return
    const g = gen.current
    try {
      const view = await api<View>(`${base}/runs/${run.id}/resume`, { method: "POST", body: JSON.stringify({ conversationId: conversation.id }) })
      applyIfCurrent(g, view)
    } catch (e) {
      if (g === gen.current) setError((e as Error).message)
    }
  }, [applyIfCurrent, base, conversation])

  useEffect(() => {
    const run = conversation?.activeRun
    if (!run?.resumable || resumed.current.has(run.id) || pendingKeys.length) return
    resumed.current.add(run.id)
    void resumeRun()
  }, [conversation?.activeRun, pendingKeys.length, resumeRun])

  const markPending = (key: string, on: boolean) => setPendingKeys((prev) => (on ? [...new Set([...prev, key])] : prev.filter((k) => k !== key)))

  const setDraft = useCallback((v: string) => setDrafts((prev) => ({ ...prev, [currentKey]: v })), [currentKey])

  const actions: AssistantActions = {
    isAssistantPage,
    focusToken,
    refresh,
    setPinned,
    setDraft,
    resumeRun,
    openPanel: (opts) => {
      if (opts?.pin !== undefined) setPinned(opts.pin)
      if (opts?.prefill) {
        setDrafts((prev) => ({ ...prev, [currentKey]: opts.prefill! }))
        setFocusToken((n) => n + 1)
      }
      if (isAssistantPage) return
      setPanelOpen(true)
      store.set(panelKey(slug), "open")
    },
    closePanel: () => {
      setPanelOpen(false)
      store.set(panelKey(slug), "closed")
    },
    expand: () => {
      if (!isAssistantPage) {
        const from = safeReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`, slug, window.location.origin)
        setReturnTo(from)
        store.session(returnKey(slug), from)
      }
      const id = selected.current
      router.push(id ? `${assistantPath}?thread=${id}` : assistantPath)
    },
    returnToWork: () => {
      const target = safeReturnTo(returnTo, slug, window.location.origin) ?? `/a/${slug}`
      setPanelOpen(true)
      store.set(panelKey(slug), "open")
      router.push(target)
    },
    send: async ({ text, presetId }) => {
      const key = currentKey
      if (pendingKeys.includes(key)) return false
      const g = gen.current
      const conversationId = selected.current
      markPending(key, true)
      setError(null)
      const clientMessageId = crypto.randomUUID()
      try {
        const view = await api<View>(`${base}/messages`, {
          method: "POST",
          body: JSON.stringify({ conversationId, clientMessageId, text, presetId, context }),
        })
        // Accepted: the draft of the thread it was typed in is consumed.
        if (text) setDrafts((prev) => ({ ...prev, [key]: "" }))
        if (applyIfCurrent(g, view)) syncUrl(view.conversation?.id ?? null)
        router.refresh()
        return true
      } catch (e) {
        if (g === gen.current) setError((e as Error).message)
        return false
      } finally {
        markPending(key, false)
      }
    },
    confirm: async (proposalId, digest) => {
      const key = currentKey
      if (!conversation || pendingKeys.includes(key)) return
      const g = gen.current
      markPending(key, true)
      try {
        const view = await api<View>(`${base}/proposals/${proposalId}/confirm`, {
          method: "POST",
          body: JSON.stringify({ conversationId: conversation.id, digest, clientMessageId: crypto.randomUUID() }),
        })
        applyIfCurrent(g, view)
        router.refresh()
      } catch (e) {
        if (g === gen.current) setError((e as Error).message)
      } finally {
        markPending(key, false)
      }
    },
    cancelRun: async () => {
      if (!conversation?.activeRun) return
      const g = gen.current
      try {
        const view = await api<View>(`${base}/runs/${conversation.activeRun.id}/cancel`, { method: "POST", body: JSON.stringify({ conversationId: conversation.id }) })
        applyIfCurrent(g, view)
        router.refresh()
      } catch (e) {
        if (g === gen.current) setError((e as Error).message)
      }
    },
    newConversation: async () => {
      const g = ++gen.current
      try {
        const view = await api<View>(`${base}/conversations`, { method: "POST", body: JSON.stringify({}) })
        if (applyIfCurrent(g, view)) {
          setError(null)
          syncUrl(view.conversation?.id ?? null)
        }
      } catch (e) {
        if (g === gen.current) setError((e as Error).message)
      }
    },
    openConversation: async (id) => {
      const g = ++gen.current
      try {
        const view = await api<View>(`${base}/conversations/${id}`)
        if (applyIfCurrent(g, view)) {
          setError(null)
          syncUrl(id)
        }
      } catch (e) {
        if (g === gen.current) setError((e as Error).message)
      }
    },
  }

  const value = {
    slug,
    conversation,
    messages,
    suggestions,
    loading,
    sending: pendingKeys.includes(currentKey),
    error,
    threadNotFound,
    panelOpen: panelOpen && !isAssistantPage,
    pinned,
    context,
    returnTo,
    draft: drafts[currentKey] ?? "",
    ...actions,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAssistant() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useAssistant must be used inside AssistantProvider")
  return v
}
