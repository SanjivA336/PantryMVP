import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Member } from '../types/entities'

interface CommonProps {
  members: Member[]
  // Marks a value the app filled in and the user hasn't touched yet (a thin
  // green border, the same cue the other autofilled fields use).
  autofilled?: boolean
}

interface MultiProps extends CommonProps {
  mode: 'multi'
  value: string[]
  onChange: (ids: string[]) => void
}

interface SingleProps extends CommonProps {
  mode: 'single'
  value: string
  onChange: (id: string) => void
}

const triggerClass =
  'flex w-full items-center justify-between gap-2 rounded-control border border-subtle bg-field px-2 py-2 text-left text-sm text-text shadow-field outline-none focus:border-primary'

// Pick people from a household's members. Two shapes:
//   multi:  an "Everyone" toggle plus a "Choose people" button that opens a grid,
//           for "who's using this?";
//   single: one button showing the chosen person, for "who bought it?".
// Both open the same popover grid: alphabetical, three to a row, with a short
// last row centred. Tapping outside (or pressing Escape) closes it.
export function MemberPicker(props: MultiProps | SingleProps) {
  const { members, autofilled = false } = props
  const sorted = useMemo(
    () => [...members].sort((a, b) => a.nickname.localeCompare(b.nickname)),
    [members],
  )
  const [open, setOpen] = useState(false)
  // A state (not a ref) so the popover renders once the anchor actually exists.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (props.mode === 'single') {
    const chosen = sorted.find((m) => m.id === props.value)
    return (
      <>
        <button
          ref={setAnchor}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`${triggerClass} ${autofilled ? 'border-primary' : ''}`}
        >
          <span className="min-w-0 truncate">{chosen?.nickname ?? 'Pick…'}</span>
          <ChevronDown size={16} strokeWidth={1.75} className="shrink-0 text-faint" />
        </button>
        {open && anchor && (
          <MemberGrid
            anchor={anchor}
            members={sorted}
            isSelected={(id) => id === props.value}
            onPick={(id) => {
              props.onChange(id)
              setOpen(false)
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    )
  }

  const { value, onChange } = props
  const count = value.length
  const allSelected = sorted.length > 0 && sorted.every((m) => value.includes(m.id))
  const onlyOne = count === 1 ? sorted.find((m) => m.id === value[0]) : undefined

  return (
    <>
      <div
        ref={setAnchor}
        className={`flex gap-2 rounded-control border p-1 ${autofilled ? 'border-primary' : 'border-transparent'}`}
      >
        <button
          type="button"
          aria-pressed={allSelected}
          onClick={() => onChange(allSelected ? [] : sorted.map((m) => m.id))}
          className={`shrink-0 rounded-control border px-3 py-2 text-sm font-medium transition-colors ${
            allSelected
              ? 'border-primary bg-primary-soft text-primary'
              : 'border-subtle bg-surface text-muted hover:bg-surface-hover hover:text-text'
          }`}
        >
          Everyone
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`${triggerClass} min-w-0 flex-1 ${open ? 'border-primary' : ''}`}
        >
          <span className="min-w-0 truncate">{onlyOne ? onlyOne.nickname : 'Choose people'}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {count > 1 && (
              <span className="rounded-pill bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-primary">
                {count}
              </span>
            )}
            <ChevronDown size={16} strokeWidth={1.75} className="text-faint" />
          </span>
        </button>
      </div>
      {count === 0 && <p className="mt-1.5 text-xs text-danger">Pick at least one person.</p>}
      {open && anchor && (
        <MemberGrid
          anchor={anchor}
          members={sorted}
          isSelected={(id) => value.includes(id)}
          onPick={(id) =>
            onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
          }
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

interface GridProps {
  anchor: HTMLElement
  members: Member[]
  isSelected: (id: string) => boolean
  onPick: (id: string) => void
  onClose: () => void
}

// The popover. It is position: fixed (so a scrolling form can't clip it),
// as wide as the form, and opens below its anchor, or above when there isn't
// room below. It lines up with the nearest ancestor marked `data-sheet-scroll`
// (the sheet's scrolling area) and re-places itself if that scrolls or resizes.
function MemberGrid({ anchor, members, isSelected, onPick, onClose }: GridProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const scroller = anchor.closest<HTMLElement>('[data-sheet-scroll]')
    const place = () => {
      const a = anchor.getBoundingClientRect()
      const s = scroller?.getBoundingClientRect()
      const left = s ? s.left + 16 : Math.max(8, a.left)
      const width = s ? s.width - 32 : Math.min(a.width, window.innerWidth - 16)
      const height = ref.current?.offsetHeight ?? 0
      const roomBelow = (s ? s.bottom : window.innerHeight) - a.bottom - 8
      const roomAbove = a.top - (s ? s.top : 0) - 8
      const openUp = roomBelow < height && roomAbove > roomBelow
      setPos({ left, width, top: openUp ? a.top - height - 8 : a.bottom + 8 })
    }
    place()
    // Once more after the first paint: the grid's height depends on the width
    // it was just given.
    const frame = requestAnimationFrame(place)
    scroller?.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(frame)
      scroller?.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
  }, [anchor, members.length])

  return (
    <>
      {/* An invisible catcher for taps outside the grid. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        ref={ref}
        role="dialog"
        aria-label="Choose people"
        className="fixed z-50 max-h-[45vh] overflow-y-auto rounded-card border border-subtle bg-surface-2 p-2 shadow-raised"
        style={{
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          width: pos?.width ?? 300,
          visibility: pos ? 'visible' : 'hidden',
        }}
      >
        {/* Three to a row; a partial last row is centred by flex-wrap + justify-center. */}
        <div className="flex flex-wrap justify-center gap-2">
          {members.map((m) => {
            const on = isSelected(m.id)
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() => onPick(m.id)}
                className={`flex h-10 basis-[calc((100%-1rem)/3)] items-center justify-center rounded-control border px-2 text-sm font-medium transition-colors ${
                  on
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-subtle bg-surface text-muted hover:bg-surface-hover hover:text-text'
                }`}
              >
                <span className="w-full truncate text-center">{m.nickname}</span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
