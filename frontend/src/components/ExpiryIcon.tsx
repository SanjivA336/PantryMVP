import { Calendar, CalendarClock, CalendarX } from 'lucide-react'

export type ExpiryState = 'none' | 'ok' | 'soon' | 'expired'

interface Props {
  state: ExpiryState
  // Whole days from today: negative once expired. Only used for the label.
  daysUntil?: number
  size?: number
}

function label(state: ExpiryState, daysUntil: number | undefined): string {
  if (state === 'ok') return 'Has an expiry date'
  if (daysUntil === undefined) return state === 'soon' ? 'Expiring soon' : 'Expired'
  const n = Math.abs(daysUntil)
  const days = `${n} ${n === 1 ? 'day' : 'days'}`
  if (state === 'soon') return daysUntil === 0 ? 'Expires today' : `Expires in ${days}`
  return `Expired ${days} ago`
}

// A small calendar that says where an item stands on expiry without a line of
// text: blue = there is a date, amber = it's close, red = it's past. Each state
// also has its own glyph, so the meaning doesn't depend on telling colours
// apart. Renders nothing for an item with no date. The exact days are on the
// item's page and in the warnings list.
export function ExpiryIcon({ state, daysUntil, size = 15 }: Props) {
  if (state === 'none') return null

  const Icon = state === 'ok' ? Calendar : state === 'soon' ? CalendarClock : CalendarX
  const color = state === 'ok' ? 'text-info' : state === 'soon' ? 'text-warning' : 'text-danger'
  const text = label(state, daysUntil)

  return (
    <span className={`inline-flex shrink-0 ${color}`} title={text} role="img" aria-label={text}>
      <Icon size={size} strokeWidth={1.9} />
    </span>
  )
}
