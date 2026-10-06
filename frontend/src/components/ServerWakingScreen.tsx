import { useEffect, useState, useSyncExternalStore } from 'react'
import { BurrowLogo } from './BurrowLogo'
import { retryConnection } from '../lib/apiClient'
import { getIsServerSlow, getIsUnreachable, subscribe } from '../lib/serverWake'

// Full-screen messages about the server, centred on every screen size. They cover the
// page on purpose: while the server is asleep or unreachable nothing on screen can load
// anyway, and a frozen-looking page is the thing this exists to prevent.
//
//  - "Getting things ready": the server looks to be waking from sleep (see
//    lib/serverWake.ts). It disappears by itself the moment the server answers.
//  - "We couldn't connect": the server has not answered for a long time even though the
//    internet works. It keeps checking quietly and clears itself when the server answers;
//    "Try again" checks immediately. (A device with no internet gets the slim offline
//    banner instead, see OfflineBanner.)
//
// Height comes from --app-height rather than `inset-0`, so in the installed iOS app it
// covers the whole screen from the first frame (see index.css).
const screenClass =
  'animate-fade-in fixed inset-x-0 top-0 z-[60] flex h-[var(--app-height)] flex-col items-center justify-center gap-6 bg-bg px-6 text-center text-text'

export function ServerWakingScreen() {
  const isSlow = useSyncExternalStore(subscribe, getIsServerSlow)
  const unreachable = useSyncExternalStore(subscribe, getIsUnreachable)
  const [trying, setTrying] = useState(false)

  // "Try again" shows "Trying…" for a moment so the tap visibly did something.
  useEffect(() => {
    if (!trying) return
    const timer = setTimeout(() => setTrying(false), 2_500)
    return () => clearTimeout(timer)
  }, [trying])

  if (unreachable) {
    return (
      <div role="alert" className={screenClass}>
        <BurrowLogo className="h-20 w-20 text-muted" />
        <div>
          <p className="text-lg font-semibold">We couldn't connect to the server</p>
          <p className="mt-1.5 max-w-xs text-balance text-sm text-muted">
            Your internet looks fine, but Burrow isn't answering. This is usually brief.
          </p>
        </div>
        <button
          type="button"
          disabled={trying}
          onClick={() => {
            setTrying(true)
            retryConnection()
          }}
          className="rounded-control bg-primary px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {trying ? 'Trying…' : 'Try again'}
        </button>
      </div>
    )
  }

  if (!isSlow) return null

  return (
    <div role="status" aria-live="polite" className={screenClass}>
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
