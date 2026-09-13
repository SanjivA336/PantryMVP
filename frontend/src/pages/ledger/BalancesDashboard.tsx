import { useMemo, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { Modal } from '../../components/Modal'
import type { LedgerEntryDetail, Member } from '../../types/entities'

interface Props {
  entries: LedgerEntryDetail[] | null
  members: Member[] | null
  loading: boolean
}

// Cycled by member index -- reuses the existing food-category color tokens
// as a convenient, already-distinct palette rather than inventing a
// dedicated set of per-member colors for this one chart.
const LINE_COLORS = [
  'var(--color-category-beverages)',
  'var(--color-category-proteins)',
  'var(--color-category-fruits)',
  'var(--color-category-seasonings-spices)',
  'var(--color-category-vegetables-herbs)',
  'var(--color-category-snacks-sweets)',
]

const CARD_CLASS =
  'flex flex-col gap-3 rounded-card border border-subtle bg-surface p-4 shadow-card'

function EmptyChart({ label }: { label: string }) {
  return <p className="py-6 text-center text-sm text-muted">{label}</p>
}

interface Point {
  t: number
  v: number
}

function NetBalanceOverTimeChart({
  entries,
  members,
}: {
  entries: LedgerEntryDetail[]
  members: Member[]
}) {
  const nicknameById = useMemo(() => new Map(members.map((m) => [m.id, m.nickname])), [members])

  const seriesByMember = useMemo(() => {
    const sorted = [...entries].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
    const running = new Map<string, number>()
    const points = new Map<string, Point[]>()
    const push = (memberId: string, t: number, delta: number) => {
      const next = (running.get(memberId) ?? 0) + delta
      running.set(memberId, next)
      points.set(memberId, [...(points.get(memberId) ?? []), { t, v: next }])
    }
    for (const entry of sorted) {
      const t = new Date(entry.created_at).getTime()
      const amount = Number(entry.amount)
      push(entry.creditor_member_id, t, amount)
      push(entry.debtor_member_id, t, -amount)
    }
    return points
  }, [entries])

  const memberIds = [...seriesByMember.keys()]
  if (memberIds.length === 0) return <EmptyChart label="No activity yet." />

  const allPoints = [...seriesByMember.values()].flat()
  const minT = Math.min(...allPoints.map((p) => p.t))
  const maxT = Math.max(...allPoints.map((p) => p.t))
  const minV = Math.min(0, ...allPoints.map((p) => p.v))
  const maxV = Math.max(0, ...allPoints.map((p) => p.v))

  const W = 600
  const H = 200
  const PAD = 10
  // preserveAspectRatio="none" lets this stretch to fill the card's actual
  // width responsively -- fine for a simple trend line where exact aspect
  // ratio doesn't matter, avoids needing to recompute the viewBox on resize.
  const xScale = (t: number) =>
    maxT === minT ? W / 2 : PAD + ((t - minT) / (maxT - minT)) * (W - PAD * 2)
  const yScale = (v: number) =>
    maxV === minV ? H / 2 : H - PAD - ((v - minV) / (maxV - minV)) * (H - PAD * 2)
  const zeroY = yScale(0)

  return (
    <div className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-48 w-full">
        <line
          x1={PAD}
          y1={zeroY}
          x2={W - PAD}
          y2={zeroY}
          stroke="var(--color-subtle)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        {memberIds.map((memberId, i) => (
          <polyline
            key={memberId}
            fill="none"
            stroke={LINE_COLORS[i % LINE_COLORS.length]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={(seriesByMember.get(memberId) ?? [])
              .map((p) => `${xScale(p.t)},${yScale(p.v)}`)
              .join(' ')}
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {memberIds.map((memberId, i) => (
          <span key={memberId} className="flex items-center gap-1.5 text-xs text-muted">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: LINE_COLORS[i % LINE_COLORS.length] }}
            />
            {nicknameById.get(memberId) ?? 'Unknown member'}
          </span>
        ))}
      </div>
    </div>
  )
}

// Shared by both "top items" cards below -- a ranked bar list, capped to
// `limit` rows when given (the card's own compact preview) or uncapped (the
// "see all" modal each card opens into).
function ItemBarList({
  items,
  formatValue,
  limit,
}: {
  items: [string, number][]
  formatValue: (n: number) => string
  limit?: number
}) {
  const shown = limit ? items.slice(0, limit) : items
  const maxValue = items[0]?.[1] ?? 0

  return (
    <div className="flex flex-col gap-2.5">
      {shown.map(([name, value]) => (
        <div key={name}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted">{name}</span>
            <span className="shrink-0 font-medium text-text">{formatValue(value)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-2">
            <div
              className="h-full rounded-pill bg-primary"
              style={{ width: `${maxValue ? (value / maxValue) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// One food's total spend across every PURCHASE/OVERAGE entry that resolved
// to it -- entries are per-(debtor,creditor) shares, not per-purchase, so
// this is total money that moved because of that food, not its sticker
// price times how many times it was bought.
function useTopItemsBySpend(entries: LedgerEntryDetail[]) {
  return useMemo(() => {
    const totals = new Map<string, number>()
    for (const entry of entries) {
      if (!entry.food_name) continue
      totals.set(entry.food_name, (totals.get(entry.food_name) ?? 0) + Number(entry.amount))
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])
  }, [entries])
}

// Distinct purchase events per food, not entry count -- a single purchase
// of a food shared by everyone in a 4-person household produces 3 PURCHASE
// ledger entries (one per non-buyer), so counting entries directly would
// make a household's size look like how often it buys something.
function useTopItemsByFrequency(entries: LedgerEntryDetail[]) {
  return useMemo(() => {
    const purchaseIdsByFood = new Map<string, Set<string>>()
    for (const entry of entries) {
      if (entry.reason !== 'PURCHASE' || !entry.food_name || !entry.source_purchase_event_id)
        continue
      const set = purchaseIdsByFood.get(entry.food_name) ?? new Set<string>()
      set.add(entry.source_purchase_event_id)
      purchaseIdsByFood.set(entry.food_name, set)
    }
    return [...purchaseIdsByFood.entries()]
      .map(([name, ids]) => [name, ids.size] as [string, number])
      .sort((a, b) => b[1] - a[1])
  }, [entries])
}

function TopItemsBySpendCard({ entries }: { entries: LedgerEntryDetail[] }) {
  const [expanded, setExpanded] = useState(false)
  const items = useTopItemsBySpend(entries)
  const formatValue = (n: number) => `$${n.toFixed(2)}`

  if (items.length === 0) return <EmptyChart label="No purchases on record yet." />

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="-m-1 rounded-control p-1 text-left transition-colors hover:bg-surface-hover"
      >
        <ItemBarList items={items} formatValue={formatValue} limit={5} />
      </button>
      {expanded && (
        <Modal title="Top items by spend" onClose={() => setExpanded(false)}>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <ItemBarList items={items} formatValue={formatValue} />
          </div>
        </Modal>
      )}
    </>
  )
}

function MostFrequentlyBoughtCard({ entries }: { entries: LedgerEntryDetail[] }) {
  const [expanded, setExpanded] = useState(false)
  const items = useTopItemsByFrequency(entries)
  const formatValue = (n: number) => (n === 1 ? '1 time' : `${n} times`)

  if (items.length === 0) return <EmptyChart label="No purchases on record yet." />

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="-m-1 rounded-control p-1 text-left transition-colors hover:bg-surface-hover"
      >
        <ItemBarList items={items} formatValue={formatValue} limit={5} />
      </button>
      {expanded && (
        <Modal title="Most frequently bought" onClose={() => setExpanded(false)}>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <ItemBarList items={items} formatValue={formatValue} />
          </div>
        </Modal>
      )}
    </>
  )
}

export function BalancesDashboard({ entries, members, loading }: Props) {
  if (loading) return <p className="text-sm text-muted">Loading…</p>

  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-subtle p-10 text-center">
        <BarChart3 size={28} strokeWidth={1.5} className="text-faint" />
        <p className="text-sm text-muted">Nothing to chart yet. Add a purchase to get started.</p>
      </div>
    )
  }

  const activeMembers = (members ?? []).filter((m) => m.is_active)

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className={`${CARD_CLASS} md:col-span-2`}>
        <h3 className="text-sm font-semibold text-muted">Net balance over time</h3>
        <NetBalanceOverTimeChart entries={entries} members={activeMembers} />
      </div>
      <div className={CARD_CLASS}>
        <h3 className="text-sm font-semibold text-muted">Top items by spend</h3>
        <TopItemsBySpendCard entries={entries} />
      </div>
      <div className={CARD_CLASS}>
        <h3 className="text-sm font-semibold text-muted">Most frequently bought</h3>
        <MostFrequentlyBoughtCard entries={entries} />
      </div>
    </div>
  )
}
