import { useSyncExternalStore } from 'react'
import { BurrowLogo } from './BurrowLogo'
import { getIsServerSlow, subscribe } from '../lib/serverWake'

// A full-screen loading screen shown while an API request has been pending long
// enough that the server is probably waking from sleep (see lib/serverWake.ts).
// Centred on every screen size, and it covers the page on purpose: while the
// server is asleep nothing on screen can load anyway, and a frozen-looking page
// is the thing this exists to prevent. It disappears by itself the moment the
// slow request finishes.
//
// Height comes from --app-height rather than `inset-0`, so in the installed iOS
// app it covers the whole screen from the first frame (see index.css).
export function ServerWakingScreen() {
  const isSlow = useSyncExternalStore(subscribe, getIsServerSlow)
  if (!isSlow) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-fade-in fixed inset-x-0 top-0 z-[60] flex h-[var(--app-height)] flex-col items-center justify-center gap-6 bg-bg px-6 text-center text-text"
    >
      <BurrowLogo className="h-20 w-20 animate-pulse text-primary" />
      <div>
        <p className="text-lg font-semibold">Getting things ready…</p>
        <p className="mt-1.5 max-w-xs text-balance text-sm text-muted">
          This can take up to a minute. Thanks for hanging in there.
        </p>
      </div>
    </div>
  )
}
