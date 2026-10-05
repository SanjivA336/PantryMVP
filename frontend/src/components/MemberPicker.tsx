import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { Member } from '../types/entities'

interface CommonProps {
  members: Member[]
  // Marks a value the app filled in and the user hasn't touched yet (a thin
  // green border, the same cue the other autofilled fields use).
  autofilled?: boolean
  // Where the opened list should appear. By default it drops open directly
  // beneath the control; pass an element to put it somewhere else instead (the
  // Buyer control sits in a half-width column, so its list opens in a
  // full-width slot below the row).
  panelContainer?: HTMLElement | null
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
//   multi:  an "Everyone" toggle plus a "Choose people" button, for "who's
//           using this?";
//   single: one button showing the chosen person, for "who bought it?".
// Pressing the button opens the list of people right beneath it, like an
// accordion, and pressing it again hides it. The list is alphabetical, three to
// a row, with a short last row centred. Multi stays open while you pick; single
// closes as soon as you choose someone.
export function MemberPicker(props: MultiProps | SingleProps) {
  const { members, autofilled = false, panelContainer } = props
  const sorted = useMemo(
    () => [...members].sort((a, b) => a.nickname.localeCompare(b.nickname)),
    [members],
  )
  const [open, setOpen] = useState(false)

  const panel = open ? (
    <MemberList
      members={sorted}
      isSelected={(id) => (props.mode === 'single' ? id === props.value : props.value.includes(id))}
      onPick={(id) => {
        if (props.mode === 'single') {
          props.onChange(id)
          setOpen(false)
        } else {
          props.onChange(
            props.value.includes(id) ? props.value.filter((x) => x !== id) : [...props.value, id],
          )
        }
      }}
    />
  ) : null
  // In its own slot if one was given, otherwise right here under the control.
  const renderedPanel = panel && panelContainer ? createPortal(panel, panelContainer) : panel

  if (props.mode === 'single') {
    const chosen = sorted.find((m) => m.id === props.value)
    return (
      <>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`${triggerClass} ${autofilled ? 'border-primary' : ''}`}
        >
          <span className="min-w-0 truncate">{chosen?.nickname ?? 'Pick…'}</span>
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {renderedPanel}
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
            <ChevronDown
              size={16}
              strokeWidth={1.75}
              className={`text-faint transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </span>
        </button>
      </div>
      {count === 0 && <p className="mt-1.5 text-xs text-danger">Pick at least one person.</p>}
      {renderedPanel}
    </>
  )
}

interface ListProps {
  members: Member[]
  isSelected: (id: string) => boolean
  onPick: (id: string) => void
}

// The opened list. It's ordinary content in the form (it pushes what's below it
// down), so it needs no floating or positioning; it just scrolls itself into
// view if it opened near the bottom of a scrolling area.
function MemberList({ members, isSelected, onPick }: ListProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Choose people"
      className="animate-fade-in mt-2 rounded-control border border-subtle bg-surface p-2"
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
                  : 'border-subtle bg-surface-2 text-muted hover:bg-surface-hover hover:text-text'
              }`}
            >
              <span className="w-full truncate text-center">{m.nickname}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
