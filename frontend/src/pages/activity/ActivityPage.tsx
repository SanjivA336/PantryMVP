import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowRightLeft,
  Handshake,
  PackagePlus,
  PackageX,
  Pencil,
  Receipt,
  RotateCcw,
  Trash2,
  UserMinus,
  UserPlus,
  Utensils,
} from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { EmptyState } from '../../components/EmptyState'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'
import { UNIT_LABELS } from '../../lib/units'
import type { ActivityEvent, ActivityType, Unit } from '../../types/entities'

const PAGE_SIZE = 50

// Coarse buckets over the raw ActivityType set -- a full 9-type dropdown is
// more granularity than browsing wants. The per-type taxonomy still exists
// underneath (and is what notification opt-ins will use); this just groups
// it for the feed's own filter.
const FILTERS: { key: string; label: string; types: ActivityType[] }[] = [
  { key: 'all', label: 'All', types: [] },
  {
    key: 'items',
    label: 'Items',
    types: ['ITEM_ADDED', 'ITEM_CONSUMED', 'ITEM_REMOVED', 'ITEM_MOVED', 'USAGE_CORRECTED'],
  },
  {
    key: 'money',
    label: 'Money',
    types: ['COST_CORRECTED', 'SETTLEMENT_RECORDED', 'SETTLEMENT_REVERSED'],
  },
  { key: 'people', label: 'People', types: ['MEMBER_JOINED', 'MEMBER_LEFT'] },
]

const REMOVAL_VERB: Record<string, string> = {
  USED_UP: 'was used up',
  DISCARDED: 'was thrown out',
  EXPIRED: 'was marked expired',
  LOST: 'was marked lost',
}

function unitLabel(raw: unknown): string {
  return raw && (UNIT_LABELS as Record<string, string>)[raw as Unit]
    ? (UNIT_LABELS as Record<string, string>)[raw as Unit]
    : String(raw ?? '')
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function iconFor(event: ActivityEvent) {
  switch (event.type) {
    case 'ITEM_ADDED':
      return PackagePlus
    case 'ITEM_CONSUMED':
      return Utensils
    case 'ITEM_REMOVED':
      return event.detail.reason === 'USED_UP' ? PackageX : Trash2
    case 'ITEM_MOVED':
      return ArrowRightLeft
    case 'COST_CORRECTED':
      return Receipt
    case 'USAGE_CORRECTED':
      return Pencil
    case 'SETTLEMENT_RECORDED':
      return Handshake
    case 'SETTLEMENT_REVERSED':
      return RotateCcw
    case 'MEMBER_JOINED':
      return UserPlus
    case 'MEMBER_LEFT':
      return UserMinus
  }
}

// A four-color severity scheme, independent of the icon shape above:
//   green  (primary) -- something was gained or resolved: an item arrived,
//                        someone joined, a debt got paid off.
//   red    (danger)  -- something went away or got undone: an item left
//                        inventory (for any reason -- used up counts the
//                        same as thrown out, since either way it's gone),
//                        a member left/was removed, a settlement reversed.
//   amber  (warning) -- usage and corrections: nothing was fully gained or
//                        lost, but a record changed (consumed some of an
//                        item, a cost or usage figure got fixed).
//   blue   (info)    -- pure relocation: an item moved shelves, no gain or
//                        loss either way.
function colorFor(event: ActivityEvent): string {
  switch (event.type) {
    case 'ITEM_ADDED':
    case 'MEMBER_JOINED':
    case 'SETTLEMENT_RECORDED':
      return 'text-primary'
    case 'ITEM_REMOVED':
    case 'MEMBER_LEFT':
    case 'SETTLEMENT_REVERSED':
      return 'text-danger'
    case 'ITEM_CONSUMED':
    case 'COST_CORRECTED':
    case 'USAGE_CORRECTED':
      return 'text-warning'
    case 'ITEM_MOVED':
      return 'text-info'
  }
}

// `subject` is pre-rendered by the caller -- either a plain bold string, or
// (when this event has a still-resolvable item to point at) a link, so the
// click target is exactly the item's name rather than the entire row.
function describe(event: ActivityEvent, subject: ReactNode): ReactNode {
  const actor = event.actor_nickname ?? 'Someone'
  const d = event.detail

  switch (event.type) {
    case 'ITEM_ADDED':
      return (
        <>
          <b>{actor}</b> added {subject}
          {d.quantity ? ` · ${d.quantity} ${unitLabel(d.unit)}` : ''}
          {d.storage_location ? ` to ${d.storage_location}` : ''}
        </>
      )
    case 'ITEM_CONSUMED':
      return (
        <>
          <b>{actor}</b> used {String(d.amount ?? '')} {unitLabel(d.unit)} of {subject}
        </>
      )
    case 'ITEM_REMOVED':
      return (
        <>
          {subject} {REMOVAL_VERB[String(d.reason)] ?? 'was removed'}
        </>
      )
    case 'ITEM_MOVED':
      return (
        <>
          <b>{actor}</b> moved {subject} from {String(d.from_location)} to {String(d.to_location)}
        </>
      )
    case 'COST_CORRECTED':
      return (
        <>
          <b>{actor}</b> corrected {subject} cost: ${String(d.previous_cost)} → $
          {String(d.new_cost)}
        </>
      )
    case 'USAGE_CORRECTED':
      return (
        <>
          <b>{actor}</b> corrected a usage entry on {subject}
        </>
      )
    case 'SETTLEMENT_RECORDED':
      return (
        <>
          <b>{actor}</b> recorded a payment: {String(d.payer)} → {String(d.payee)}{' '}
          <b>${Number(d.amount ?? 0).toFixed(2)}</b>
        </>
      )
    case 'SETTLEMENT_REVERSED':
      return (
        <>
          <b>{actor}</b> reversed a payment: {String(d.payer)} → {String(d.payee)} $
          {Number(d.amount ?? 0).toFixed(2)}
        </>
      )
    case 'MEMBER_JOINED':
      return (
        <>
          <b>{actor}</b> joined the household
        </>
      )
    case 'MEMBER_LEFT':
      return d.removed_by_admin ? (
        <>
          <b>{actor}</b> removed {subject}
        </>
      ) : (
        <>{subject} left the household</>
      )
  }
}

export function ActivityPage() {
  const { householdId } = useParams<{ householdId: string }>()
  const [filterKey, setFilterKey] = useState('all')
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const typeParams = useMemo(() => {
    const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0]
    return filter.types.map((t) => `type=${t}`).join('&')
  }, [filterKey])

  const buildUrl = useCallback(
    (before?: string) => {
      if (!householdId) return null
      const params = [`limit=${PAGE_SIZE}`]
      if (typeParams) params.push(typeParams)
      if (before) params.push(`before=${encodeURIComponent(before)}`)
      return `/api/households/${householdId}/activity?${params.join('&')}`
    },
    [householdId, typeParams],
  )

  // Full reload -- on mount, on filter change, and whenever realtime says a
  // row landed. Paging (below) appends instead.
  const reload = useCallback(() => {
    const url = buildUrl()
    if (!url) return
    setLoading(true)
    apiClient
      .get<ActivityEvent[]>(url)
      .then((rows) => {
        setEvents(rows)
        setHasMore(rows.length === PAGE_SIZE)
        setError(null)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [buildUrl])

  useEffect(() => {
    reload()
  }, [reload])

  useRealtimeSubscription('household_activity', householdId ?? null, reload)

  const loadMore = () => {
    const oldest = events[events.length - 1]
    const url = buildUrl(oldest?.created_at)
    if (!url) return
    setLoadingMore(true)
    apiClient
      .get<ActivityEvent[]>(url)
      .then((rows) => {
        setEvents((prev) => [...prev, ...rows])
        setHasMore(rows.length === PAGE_SIZE)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'))
      .finally(() => setLoadingMore(false))
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Activity</h2>
        <p className="mt-1 text-sm text-muted">Everything that's happened in this household.</p>
      </div>

      <div className="flex gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilterKey(f.key)}
            className={`rounded-pill px-3 py-1 text-sm font-medium transition-colors ${
              filterKey === f.key
                ? 'bg-primary-soft text-primary'
                : 'text-muted hover:bg-surface-hover hover:text-text'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : events.length === 0 ? (
        <EmptyState icon={Utensils} title="Nothing here yet." />
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {events.map((event) => {
              const Icon = iconFor(event)
              const itemHref =
                typeof event.detail.item_id === 'string'
                  ? `/households/${householdId}/inventory-items/${event.detail.item_id}`
                  : null
              // Only the item's own name is a click target -- linking the
              // whole row made it too easy to navigate away by accident
              // when all you meant to do was scan the feed.
              const subject = itemHref ? (
                <Link
                  to={itemHref}
                  className="font-bold text-text hover:text-primary hover:underline"
                >
                  {event.subject_name ?? 'an item'}
                </Link>
              ) : (
                <b>{event.subject_name ?? 'an item'}</b>
              )
              return (
                <li
                  key={event.id}
                  className="flex items-start gap-2.5 rounded-card border border-subtle bg-surface px-3 py-2.5 shadow-card"
                >
                  <span className={`mt-0.5 shrink-0 ${colorFor(event)}`}>
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1 text-sm">{describe(event, subject)}</span>
                  <span className="shrink-0 text-xs text-faint">
                    {relativeTime(event.created_at)}
                  </span>
                </li>
              )
            })}
          </ul>
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="self-center rounded-control border border-subtle px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
