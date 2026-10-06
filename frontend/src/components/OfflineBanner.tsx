import { useEffect, useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'
import { warmUpServer } from '../lib/apiClient'
import { refetchActiveResources } from '../lib/resourceCache'
import { getIsOffline, subscribe } from '../lib/serverWake'

// Height of the banner's text row, below the safe area.
const BANNER_ROW = '1.75rem'

// A slim bar shown while the browser reports no connection. Unlike the "getting things
// ready" screens it does not block anything: with no connection the app can still show
// what it loaded earlier, and the bar says why that may be out of date.
//
// Pinned to the very top, so it pads itself by the safe-area inset (--safe-top): the
// text sits below the iPhone's clock and Dynamic Island, not under them. It ignores
// touches, and while it is showing the layouts that sit at the top of the screen add
// matching space (--offline-banner-h and --offline-banner-total, used in their top
// padding) so it never covers a button. From the desktop breakpoint up it is a small
// pill at the top centre instead of a full-width bar.
export function OfflineBanner() {
  const offline = useSyncExternalStore(subscribe, getIsOffline)

  useEffect(() => {
    if (!offline) return
    const root = document.documentElement
    root.style.setProperty('--offline-banner-h', BANNER_ROW)
    root.style.setProperty('--offline-banner-total', `calc(var(--safe-top) + ${BANNER_ROW})`)
    return () => {
      root.style.removeProperty('--offline-banner-h')
      root.style.removeProperty('--offline-banner-total')
    }
  }, [offline])

  // Back online: make sure the server is awake, and refresh what is on screen.
  useEffect(() => {
    const onOnline = () => {
      warmUpServer()
      refetchActiveResources()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-offline-banner
      className="pointer-events-none fixed inset-x-0 top-0 z-[55] border-b border-warning/35 bg-warning-soft pt-[var(--safe-top)] text-warning md:inset-x-auto md:left-1/2 md:top-2 md:-translate-x-1/2 md:rounded-full md:border md:pt-0 md:shadow-raised"
    >
      <p className="flex h-7 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-xs font-medium">
        <WifiOff size={13} strokeWidth={2} aria-hidden />
        You're offline. Changes can't be saved.
      </p>
    </div>
  )
}
