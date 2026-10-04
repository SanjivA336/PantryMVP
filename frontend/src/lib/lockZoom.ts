// True when Burrow runs from the home screen (an installed app) rather than a
// browser tab. `display-mode: standalone` is the standard check;
// `navigator.standalone` is the older iOS-only flag that some versions still
// need.
export function isInstalledApp(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

// Blocks pinch-zoom, but only in the installed app: a website should stay
// zoomable for people who rely on it, while an app screen is a fixed layout.
//
// iOS Safari ignores `user-scalable=no` in the viewport tag for pinch gestures
// in most contexts, so the dependable half is cancelling its proprietary
// `gesturestart` / `gesturechange` events. The viewport tag change is a
// best-effort extra, and index.css adds `touch-action: pan-x pan-y` for the
// standards-based path. Double-tap zoom and focus-zoom are handled in
// index.css (touch-action and 16px form fields).
export function lockZoomWhenInstalled(): void {
  if (!isInstalledApp()) return

  const viewport = document.querySelector('meta[name="viewport"]')
  const content = viewport?.getAttribute('content')
  if (viewport && content && !content.includes('user-scalable')) {
    viewport.setAttribute('content', `${content}, maximum-scale=1, user-scalable=no`)
  }

  const block = (event: Event) => event.preventDefault()
  document.addEventListener('gesturestart', block)
  document.addEventListener('gesturechange', block)
}
