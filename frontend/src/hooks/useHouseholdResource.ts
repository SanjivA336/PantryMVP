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
    if (!path) return
    let cancelled = false

    setLoading(true)
    apiClient
      .get<T>(path)
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
    }
  }, [path, reloadToken])

  return { data, loading, error, reload, setData }
}
