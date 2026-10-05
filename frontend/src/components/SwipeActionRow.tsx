import { useEffect, useRef, useState, type ReactNode } from 'react'
import { withResistance } from '../lib/swipeResistance'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The action buttons, laid out in a row to the right of the tile. Include any
  // gaps in `actionsWidth`. `tabIndex` is 0 only while open, so keyboard focus
  // never lands on a button that is off-screen.
  actions: (props: { tabIndex: number }) => ReactNode
  // Total width the actions take up (buttons plus gaps), in px.
  actionsWidth: number
  // Styles for the tile itself (border, rounding, background, shadow). The
  // actions are separate cards beside it, so the container has no chrome.
  tileClassName?: string
  children: ReactNode
}

const DESKTOP_QUERY = '(min-width: 768px)'

// A row you swipe left to reveal action buttons beside it, for touch screens.
// The tile and its actions sit in one strip that slides as a unit, so the
// actions come in from the right as their own cards (like swiping a message in
// Mail) and are clipped away while the row is closed.
//
// Touch only: a mouse pointer never starts a drag, and from the app's desktop
// breakpoint up there's nothing to reveal (the buttons sit inline instead), so
// the gesture is off there too. The row only claims a *horizontal* drag; vertical
// movement is left to the browser (touch-action: pan-y), so scrolling the list
// and pull to refresh are unaffected. One open row at a time is the parent's job
// (it owns `open`); tapping anywhere outside an open row closes it.
export function SwipeActionRow({
  open,
  onOpenChange,
  actions,
  actionsWidth,
  tileClassName = '',
  children,
}: Props) {
  const [dragX, setDragX] = useState<number | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ x: number; y: number; base: number; active: boolean } | null>(null)
  const suppressClick = useRef(false)

  // Close when a touch lands outside this row.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (container.current && !container.current.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onOpenChange])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || window.matchMedia(DESKTOP_QUERY).matches) return
    gesture.current = { x: e.clientX, y: e.clientY, base: open ? -actionsWidth : 0, active: false }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.active) {
      // Mostly vertical: it's a scroll, leave it alone for good.
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null
        return
      }
      if (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy)) return
      // No setPointerCapture needed: a touch pointer is already tied to the
      // element it landed on, so the moves keep arriving here.
      g.active = true
    }
    setDragX(withResistance(g.base + dx, actionsWidth))
  }

  const finish = (commit: boolean) => {
    const g = gesture.current
    gesture.current = null
    if (!g?.active) return
    // A drag ends in a click event on whatever is under the finger; swallow it
    // so letting go of a swipe doesn't also open the item.
    suppressClick.current = true
    setTimeout(() => {
      suppressClick.current = false
    }, 0)
    const final = dragX ?? g.base
    setDragX(null)
    onOpenChange(commit ? final < -actionsWidth / 2 : open)
  }

  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      e.stopPropagation()
      e.preventDefault()
      return
    }
    // Tapping an open row closes it instead of opening the item.
    if (open) {
      e.stopPropagation()
      e.preventDefault()
      onOpenChange(false)
    }
  }

  const offset = dragX ?? (open ? -actionsWidth : 0)
  const dragging = dragX !== null

  // `overflow-hidden` clips the actions away to the right while closed; from the
  // desktop breakpoint up it is lifted so the cards keep their shadow.
  return (
    <div ref={container} className="relative overflow-hidden md:overflow-visible">
      <div
        className="flex md:w-full!"
        style={{
          width: `calc(100% + ${actionsWidth}px)`,
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 220ms ease-out',
        }}
      >
        <div
          className={`touch-pan-y bg-surface md:w-full! ${tileClassName}`}
          style={{ width: `calc(100% - ${actionsWidth}px)` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={() => finish(true)}
          onPointerCancel={() => finish(false)}
          onClickCapture={handleClickCapture}
        >
          {children}
        </div>
        <div
          className="flex gap-2 pl-2 md:hidden"
          style={{ width: actionsWidth }}
          aria-hidden={!open}
        >
          {actions({ tabIndex: open ? 0 : -1 })}
        </div>
      </div>
    </div>
  )
}
