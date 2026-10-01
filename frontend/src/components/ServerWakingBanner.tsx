import { useSyncExternalStore } from 'react'
import { LoaderCircle } from 'lucide-react'
import { getIsServerSlow, subscribe } from '../lib/serverWake'

// A non-blocking notice shown while an API request has been pending long
// enough that the server is probably waking from sleep (see lib/serverWake.ts).
// pointer-events-none so it never gets in the way of what's underneath.
export function ServerWakingBanner() {
  const isSlow = useSyncExternalStore(subscribe, getIsServerSlow)
  if (!isSlow) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4"
    >
      <div className="flex max-w-sm items-start gap-2.5 rounded-card border border-warning/30 bg-warning-soft px-3.5 py-2.5 shadow-card">
        <LoaderCircle
          size={16}
          strokeWidth={2}
          className="mt-0.5 shrink-0 animate-spin text-warning"
        />
        <div>
          <p className="text-sm font-medium text-warning">Getting things ready…</p>
          <p className="mt-0.5 text-xs text-muted">
            This can take up to a minute. Thanks for hanging in there.
          </p>
        </div>
      </div>
    </div>
  )
}
