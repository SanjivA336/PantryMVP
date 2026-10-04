import { useEffect, useRef, useState } from 'react'

// The indicator is dragged by a curve, not a straight line: it follows the
// finger closely at first and then gets progressively harder to pull, like a
// stretching rubber band (the same feel as Chrome's refresh). With
// pull = MAX_PULL * (1 - e^(-finger / STRETCH)) the first 100px of finger
// movement moves it about 48px, the next 100px only about 33px, the next
// 100px about 22px, and it never passes MAX_PULL.
//
// PULL_THRESHOLD is measured in indicator pixels, so reaching it takes about
// 285px of finger travel, a deliberate, long pull.
export const PULL_THRESHOLD = 100
const MAX_PULL = 150
const STRETCH = 260
// Where the indicator rests while the refresh runs.
const HOLD_HEIGHT = 64
// Refreshing here is instant (a page remount), so keep the spinner up long
// enough to read as "something happened" instead of a flicker.
const MIN_SPIN_MS = 700

// Finger distance to indicator height, with resistance that grows as you pull.
function resist(fingerDistance: number): number {
  return MAX_PULL * (1 - Math.exp(-fingerDistance / STRETCH))
}

// A pull must not start inside form fields, anything position:fixed (the
// bottom bar, modals, their backdrops), or a scrollable area that isn't at
// its top: in all of those the finger means something else.
function startsInBlockedArea(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== document.body) {
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    const style = getComputedStyle(el)
    if (style.position === 'fixed') return true
    const scrollsY = style.overflowY === 'auto' || style.overflowY === 'scroll'
    if (scrollsY && el.scrollTop > 0) return true
    el = el.parentElement
  }
  return false
}

// Pull down from the top of the page to refresh, on touch screens only. Native
// pull-to-refresh doesn't exist in an installed home-screen app, so without
// this there is no way to reload. `onRefresh` should re-fetch whatever is on
// screen; it is called once per completed pull.
export function usePullToRefresh(onRefresh: () => void) {
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Always call the latest callback without re-binding the touch listeners.
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return

    let tracking = false
    let active = false
    let busy = false
    let startX = 0
    let startY = 0
    let current = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const reset = () => {
      tracking = false
      active = false
      current = 0
      setDragging(false)
    }

    const onStart = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1 || window.scrollY > 0) return
      if (startsInBlockedArea(e.target)) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      tracking = true
      active = false
      current = 0
    }

    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (!active) {
        // Mostly sideways or upward: this isn't a pull, leave it alone.
        if (dy < 0 || Math.abs(dx) > Math.abs(dy)) {
          if (Math.abs(dx) > 10 || dy < -10) tracking = false
          return
        }
        if (dy < 8) return
        active = true
        setDragging(true)
      }
      if (window.scrollY > 0) {
        reset()
        setPull(0)
        return
      }
      current = resist(dy)
      setPull(current)
    }

    const onEnd = (cancelled: boolean) => {
      if (!tracking) return
      const completed = active && !cancelled && current >= PULL_THRESHOLD
      const wasActive = active
      reset()
      if (!wasActive) return
      if (!completed) {
        setPull(0)
        return
      }
      busy = true
      setRefreshing(true)
      setPull(HOLD_HEIGHT)
      onRefreshRef.current()
      timer = setTimeout(() => {
        busy = false
        setRefreshing(false)
        setPull(0)
      }, MIN_SPIN_MS)
    }

    const handleEnd = () => onEnd(false)
    const handleCancel = () => onEnd(true)

    // Passive: this never blocks scrolling. The page can't scroll upward from
    // the top and overscroll-behavior (index.css) turns off the native bounce,
    // so a downward drag at the top has nothing else to do.
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', handleEnd, { passive: true })
    window.addEventListener('touchcancel', handleCancel, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', handleCancel)
      clearTimeout(timer)
    }
  }, [])

  return { pull, dragging, refreshing }
}
