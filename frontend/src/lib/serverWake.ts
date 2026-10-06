// Tracks API requests that are taking suspiciously long, so the UI can tell
// people the server is probably waking up instead of looking frozen.
//
// Why this exists: the free hosting tier puts the backend to sleep when
// nobody's been around for a while, and the first request afterward can wait
// 30 to 60 seconds. A request still pending after SLOW_REQUEST_MS is far past
// anything normal (even heavy database calls finish well under it), so it's a
// reliable "the server is waking up" signal without a dedicated status check.
//
// A tiny external store rather than React state, because the thing being
// observed (apiClient's fetches) lives outside React. ServerWakingScreen
// subscribes through useSyncExternalStore.

export const SLOW_REQUEST_MS = 10_000

let slowCount = 0
// Set by the startup health check (see apiClient.warmUpServer) when the server has not
// answered it within a moment. This is the early signal: the slow-request timer above
// only fires after 10 seconds of a frozen-looking page.
let probeWaking = false
// When the server last answered us at all, in epoch milliseconds (0 = not yet this load).
let lastAwakeAt = 0
// True when the server has not answered the startup check for a long time even though
// the device has a connection: past "waking up", into "we can't reach it".
let unreachable = false
// True while the browser reports no connection at all.
let offline = typeof navigator !== 'undefined' ? !navigator.onLine : false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getIsServerSlow(): boolean {
  return slowCount > 0 || probeWaking
}

export function getIsUnreachable(): boolean {
  return unreachable
}

export function setUnreachable(next: boolean): void {
  if (unreachable === next) return
  unreachable = next
  emit()
}

export function getIsOffline(): boolean {
  return offline
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    offline = false
    emit()
  })
  window.addEventListener('offline', () => {
    offline = true
    emit()
  })
}

export function setProbeWaking(next: boolean): void {
  if (probeWaking === next) return
  probeWaking = next
  emit()
}

// Any answer from the server (even an error status) proves it is awake.
export function markServerAwake(): void {
  lastAwakeAt = Date.now()
}

export function msSinceServerAwake(): number {
  return Date.now() - lastAwakeAt
}

// Call when a request starts; call the returned function when it settles
// (success or failure). Safe to call the returned function more than once.
export function trackRequest(): () => void {
  let slow = false
  let finished = false

  const timer = setTimeout(() => {
    if (finished) return
    slow = true
    slowCount += 1
    emit()
  }, SLOW_REQUEST_MS)

  return () => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    if (slow) {
      slowCount -= 1
      emit()
    }
  }
}
