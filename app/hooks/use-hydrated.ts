import { useSyncExternalStore } from "react"

// The gate opens once, at hydration, and never closes, so there is no store to
// listen to and the unsubscribe is a no-op. Module scope keeps the reference
// stable, so React never resubscribes.
function subscribe() {
  return () => {}
}

function getSnapshot() {
  return true
}

function getServerSnapshot() {
  return false
}

/**
 * Reports whether the client has hydrated yet: `false` on the server and during
 * the hydration render, `true` for every render after it.
 *
 * Use it to gate content that cannot be server rendered, either because it
 * measures browser-only layout (the data grids) or because its source of truth
 * only exists in the browser (next-themes reading stored preferences). Both
 * cases need the server HTML and the hydration pass to agree on a neutral
 * state, which is exactly what `getServerSnapshot` pins down.
 *
 * This replaces the `useState(false)` plus `useEffect(() => setIsReady(true))`
 * pattern, which sets state inside an effect and so costs an extra commit and
 * trips `react-hooks/set-state-in-effect` under the React Compiler.
 */
export function useHydrated() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
