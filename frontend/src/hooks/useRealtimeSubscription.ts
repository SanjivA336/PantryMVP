import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'

/**
 * Subscribes to Postgres row changes (insert/update/delete) for `table`,
 * scoped to one household, and calls `onChange` whenever one lands — the
 * call sites here just use it to trigger a `reload()` from
 * useHouseholdResource rather than trying to hand-patch local state from
 * the change payload.
 *
 * `onChange` must be stable across renders (e.g. useHouseholdResource's
 * `reload`, which is already wrapped in useCallback) — an inline arrow
 * function would resubscribe the channel on every render.
 *
 * Relies on migration 0011 (table added to the `supabase_realtime`
 * publication) and each table's existing RLS SELECT policy — Realtime
 * evaluates that same policy per connected user, so nothing extra is
 * needed here for household isolation.
 */
export function useRealtimeSubscription(
  table: string,
  householdId: string | null,
  onChange: () => void,
): void {
  useEffect(() => {
    if (!householdId) return
    // StrictMode's dev-only double-invoke (mount -> cleanup -> mount again)
    // can leave a "zombie" channel from the first mount still joined for a
    // moment — supabase.removeChannel() sends an unjoin message over the
    // network, it doesn't take effect synchronously. Without this guard, a
    // change landing in that window fires `onChange` from both the zombie
    // and the real channel. Same class of race useHouseholdResource's
    // `cancelled` flag guards against for plain fetches.
    let active = true

    const channel = supabase
      .channel(`${table}:${householdId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          if (active) onChange()
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [table, householdId, onChange])
}
