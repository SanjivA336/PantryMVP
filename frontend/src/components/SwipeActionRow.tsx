import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Buttons laid out behind the row, flush right; revealed by swiping left.
  // `tabIndex` is 0 only while open, so keyboard focus never lands on a button
  // that's hidden behind the row.
  actions: (props: { tabIndex: number }) => ReactNode
  actionsWidth: number
  className?: string
  children: ReactNode
}

const DESKTOP_QUERY = '(min-width: 768px)'

// A row you swipe left to reveal action buttons behind it, for touch screens.
// Touch only: a mouse pointer never starts a drag, and from the app's desktop
// breakpoint up there's nothing to reveal (the buttons sit inline instead), so
// the gesture is off there too.
//
// The row only claims a *horizontal* drag. Vertical movement is left to the
// browser (touch-action: pan-y) so scrolling the list, and pull to refresh,
// are unaffected. One open row at a time is the parent's job (it owns `open`);
// tapping anywhere outside an open row closes it.
export function SwipeActionRow({
  open,
  onOpenChange,
  actions,
  actionsWidth,
  className = '',
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

  const clamp = (x: number) => Math.max(-actionsWidth, Math.min(0, x))

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
    setDragX(clamp(g.base + dx))
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

  return (
    <div ref={container} className={`relative overflow-hidden ${className}`}>
      <div
        className="absolute inset-y-0 right-0 flex md:hidden"
        style={{ width: actionsWidth }}
        aria-hidden={!open}
      >
        {actions({ tabIndex: open ? 0 : -1 })}
      </div>
      <div
        className="relative touch-pan-y bg-surface"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 200ms ease-out',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => finish(true)}
        onPointerCancel={() => finish(false)}
        onClickCapture={handleClickCapture}
      >
        {children}
      </div>
    </div>
  )
}
