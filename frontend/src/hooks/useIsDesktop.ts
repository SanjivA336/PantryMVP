import { useSyncExternalStore } from 'react'

// The app's mobile / desktop split (the `md` breakpoint, 768px), for the few
// places that need to know in code rather than with CSS classes.
const QUERY = '(min-width: 768px)'

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
