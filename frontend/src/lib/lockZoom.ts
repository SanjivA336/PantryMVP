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
// This deliberately does NOT edit the viewport meta tag at runtime. An earlier
// version did, and in the installed iOS app the page then stopped short of the
// bottom of the screen (a dark strip under the tab bar) with every safe-area
// inset reading 0, as if `viewport-fit=cover` had been ignored. Rewriting the
// tag was the prime suspect, so it was removed; the tag now stays exactly as
// written in index.html.
export function lockZoomWhenInstalled(): void {
  if (!isInstalledApp()) return

  const block = (event: Event) => event.preventDefault()
  document.addEventListener('gesturestart', block)
  document.addEventListener('gesturechange', block)
}
