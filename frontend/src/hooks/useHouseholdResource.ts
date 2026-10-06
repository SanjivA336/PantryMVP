import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  deleteResource,
  fetchResource,
  peekResource,
  setResource,
  subscribeResource,
} from '../lib/resourceCache'

export type SetResource<T> = (next: T | null | ((previous: T | null) => T | null)) => void

/**
 * Loads a household-scoped API resource on mount and whenever `path` changes,
 * with a `reload()` for after changes.
 *
 * The data lives in a shared cache (see lib/resourceCache) rather than in this
 * component, so:
 *  - a screen that has seen this resource before shows it immediately and
 *    refreshes it quietly in the background, instead of starting from a blank
 *    "Loading…";
 *  - `loading` is true only while there is nothing to show yet. A `reload()`
 *    (after an action, or when another device changes something live) swaps in
 *    the new data without blanking the screen first;
 *  - every component asking for the same URL sees the same data, and several
 *    asking at once cost one request.
 *
 * `setData` replaces what everyone sees without a network call, for optimistic
 * updates (show the result of an action now, undo it if the server refuses).
 * The next reload still brings the server's answer.
 */
export function useHouseholdResource<T>(path: string | null) {
  const subscribe = useCallback(
    (listener: () => void) => (path ? subscribeResource(path, listener) : () => {}),
    [path],
  )
  const getSnapshot = useCallback(() => (path ? peekResource<T>(path) : undefined), [path])
  const cached = useSyncExternalStore(subscribe, getSnapshot)

  // Tied to the path it happened on, so changing path never shows the old
  // path's error.
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const forceNext = useRef(false)

  const reload = useCallback(() => {
    forceNext.current = true
    setReloadToken((token) => token + 1)
  }, [])

  useEffect(() => {
    if (!path) return
    // Only a reload() skips the "fetched moments ago" shortcut; a plain mount
    // or path change can use it.
    const force = forceNext.current
    forceNext.current = false
    let cancelled = false

    fetchResource<T>(path, { force }).then(
      () => {
        if (!cancelled) setFailure(null)
      },
      (err) => {
        if (!cancelled) {
          setFailure({ path, message: err instanceof Error ? err.message : 'Failed to load' })
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [path, reloadToken])

  const setData = useCallback<SetResource<T>>(
    (next) => {
      if (!path) return
      const previous = peekResource<T>(path) ?? null
      const value = typeof next === 'function' ? (next as (p: T | null) => T | null)(previous) : next
      if (value === null) deleteResource(path)
      else setResource(path, value)
    },
    [path],
  )

  const error = failure && failure.path === path ? failure.message : null
  const loading = path !== null && cached === undefined && error === null

  return { data: cached ?? null, loading, error, reload, setData }
}
