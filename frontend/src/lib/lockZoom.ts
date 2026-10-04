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
// iOS Safari ignores `user-scalable=no` in the viewport tag for pinch gestures,
// so the dependable half is cancelling its proprietary `gesturestart` /
// `gesturechange` events; index.css adds `touch-action: pan-x pan-y` for the
// standards-based path. Double-tap zoom and focus-zoom are handled in
// index.css (touch-action and 16px form fields).
//
// This deliberately does NOT edit the viewport meta tag at runtime (an earlier
// version did). That was suspected of causing a dark strip under the tab bar in
// the installed iOS app, though the strip turned out to survive its removal, so
// it isn't the proven cause. The tag stays as written in index.html.
//
// TEMPORARILY OFF while chasing the dark strip under the iOS tab bar: set to
// true to block pinch-zoom in the installed app again. (index.css has a matching
// `touch-action: pan-x pan-y` rule for the installed app, also commented out.)
const ZOOM_LOCK_ENABLED = false

export function lockZoomWhenInstalled(): void {
  if (!ZOOM_LOCK_ENABLED || !isInstalledApp()) return

  const block = (event: Event) => event.preventDefault()
  document.addEventListener('gesturestart', block)
  document.addEventListener('gesturechange', block)
}
