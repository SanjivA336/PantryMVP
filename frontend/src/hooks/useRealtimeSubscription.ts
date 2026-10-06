import { useEffect, useRef } from 'react'
import { createCoalescer } from '../lib/coalesce'
import { supabase } from '../lib/supabaseClient'

// A burst of changes (finalizing an order with eight items is eight row changes
// in a few milliseconds) should cause one refresh, not eight. Wait this long
// after the last change, but never longer than MAX_WAIT_MS after the first, so a
// steady stream can't postpone the refresh forever.
const QUIET_MS = 400
const MAX_WAIT_MS = 2000

/**
 * Subscribes to Postgres row changes (insert/update/delete) for `table`,
 * scoped to one household, and calls `onChange` once things settle after a
 * change lands. The call sites here just use it to trigger a `reload()` from
 * useHouseholdResource rather than trying to hand-patch local state from
 * the change payload.
 *
 * `onChange` can be a fresh inline function on every render -- it's read via
 * a ref, not a hook dependency, specifically so the channel only
 * resubscribes when `table`/`householdId` actually change, never because
 * the caller happened to pass a new callback identity.
 *
 * Relies on migration 0011 (table added to the `supabase_realtime`
 * publication) and each table's existing RLS SELECT policy: Realtime
 * evaluates that same policy per connected user, so nothing extra is
 * needed here for household isolation.
 */
export function useRealtimeSubscription(
  table: string,
  householdId: string | null,
  onChange: () => void,
): void {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!householdId) return
    // StrictMode's dev-only double-invoke (mount -> cleanup -> mount again)
    // can leave a "zombie" channel from the first mount still joined for a
    // moment: supabase.removeChannel() sends an unjoin message over the
    // network, it doesn't take effect synchronously. Without this guard, a
    // change landing in that window fires `onChange` from both the zombie
    // and the real channel. Same class of race useHouseholdResource's
    // `cancelled` flag guards against for plain fetches.
    let active = true
    const coalescer = createCoalescer(
      () => {
        if (active) onChangeRef.current()
      },
      QUIET_MS,
      MAX_WAIT_MS,
    )

    const onRowChange = () => {
      if (active) coalescer.trigger()
    }

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
        onRowChange,
      )
      .subscribe()

    return () => {
      active = false
      coalescer.cancel()
      supabase.removeChannel(channel)
    }
  }, [table, householdId])
}
