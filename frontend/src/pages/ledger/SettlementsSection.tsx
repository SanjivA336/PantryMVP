import { useMemo } from 'react'
import { ArrowRight, PartyPopper } from 'lucide-react'
import type { Member, Settlement } from '../../types/entities'

interface Props {
  settlements: Settlement[] | null
  members: Member[] | null
  loading: boolean
}

export function SettlementsSection({ settlements, members, loading }: Props) {
  const nicknameById = useMemo(
    () => new Map((members ?? []).map((m) => [m.id, m.nickname])),
    [members],
  )

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        The fewest transfers that would settle every balance -- not necessarily the same as any
        single purchase on record.
      </p>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !settlements || settlements.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-subtle p-10 text-center">
          <PartyPopper size={28} strokeWidth={1.5} className="text-faint" />
          <p className="text-sm text-muted">Everyone's settled up.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {settlements.map((settlement, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-card border border-subtle bg-surface px-4 py-3 shadow-card"
            >
              <span className="font-medium">
                {nicknameById.get(settlement.debtor_member_id) ?? 'Unknown member'}
              </span>
              <ArrowRight size={16} strokeWidth={2} className="shrink-0 text-faint" />
              <span className="font-medium">
                {nicknameById.get(settlement.creditor_member_id) ?? 'Unknown member'}
              </span>
              <span className="ml-auto text-lg font-semibold text-primary">
                ${Number(settlement.amount).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
