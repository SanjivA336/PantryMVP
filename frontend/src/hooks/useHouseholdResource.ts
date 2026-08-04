import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../lib/apiClient'

/**
 * Fetches a household-scoped API resource on mount and whenever `path`
 * changes, with a `reload()` for after mutations.
 *
 * Guards against React StrictMode's dev-only double-invoke of effects (mount
 * -> cleanup -> mount again): without the `cancelled` check, the first
 * invocation's in-flight fetch can resolve *after* the second invocation has
 * already reset `loading` to true, flashing loaded content back to a loading
 * state. Also guards the equivalent race when `path` changes mid-fetch.
 */
export function useHouseholdResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((t) => t + 1), [])

  useEffect(() => {
    if (!path) {
      // Without this, a resource whose path is conditionally (and
      // sometimes permanently) null -- e.g. one only fetched on a
      // different route -- would leave loading stuck at its true initial
      // value forever, since the effect returns before ever settling it.
      setLoading(false)
      return
    }
    let cancelled = false
    const controller = new AbortController()

    setLoading(true)
    apiClient
      .get<T>(path, { signal: controller.signal })
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      // Lets a request that's no longer wanted (path changed again, or the
      // component unmounted) actually stop instead of running to
      // completion in the background just to have its result discarded.
      controller.abort()
    }
  }, [path, reloadToken])

  return { data, loading, error, reload, setData }
}
