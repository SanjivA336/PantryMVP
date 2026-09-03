import { useMemo, useState } from 'react'
import { Scale } from 'lucide-react'
import { EmptyState } from '../../components/EmptyState'
import { Modal } from '../../components/Modal'
import type { LedgerBalance, LedgerEntryDetail, Member } from '../../types/entities'

function formatAmount(n: number): string {
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`
}

interface Props {
  members: Member[] | null
  balances: LedgerBalance[] | null
  entries: LedgerEntryDetail[] | null
  loading: boolean
  myUserId: string | undefined
}

export function MembersSection({ members, balances, entries, loading, myUserId }: Props) {
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date')

  const activeMembers = useMemo(() => (members ?? []).filter((m) => m.is_active), [members])
  const myMemberId = activeMembers.find((m) => m.user_id === myUserId)?.id

  const netByMemberId = useMemo(() => {
    const net = new Map<string, number>()
    for (const balance of balances ?? []) {
      net.set(
        balance.creditor_member_id,
        (net.get(balance.creditor_member_id) ?? 0) + Number(balance.amount),
      )
      net.set(
        balance.debtor_member_id,
        (net.get(balance.debtor_member_id) ?? 0) - Number(balance.amount),
      )
    }
    return net
  }, [balances])

  const nicknameById = useMemo(
    () => new Map(activeMembers.map((m) => [m.id, m.nickname])),
    [activeMembers],
  )

  const breakdown = useMemo(() => {
    if (!selectedMember || !entries) return []
    const relevant = entries
      .filter(
        (e) =>
          e.creditor_member_id === selectedMember.id || e.debtor_member_id === selectedMember.id,
      )
      .map((entry) => {
        const isCreditor = entry.creditor_member_id === selectedMember.id
        return {
          entry,
          signedAmount: isCreditor ? Number(entry.amount) : -Number(entry.amount),
          counterpartyId: isCreditor ? entry.debtor_member_id : entry.creditor_member_id,
        }
      })
    return relevant.sort((a, b) =>
      sortBy === 'amount'
        ? Math.abs(b.signedAmount) - Math.abs(a.signedAmount)
        : new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime(),
    )
  }, [selectedMember, entries, sortBy])

  return (
    <div className="flex flex-col gap-5">
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : activeMembers.length === 0 ? (
        <EmptyState icon={Scale} title="No members yet." />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {activeMembers.map((member) => {
            const net = netByMemberId.get(member.id) ?? 0
            const isMe = member.id === myMemberId
            const colorClass = net > 0 ? 'text-primary' : net < 0 ? 'text-danger' : 'text-muted'
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => setSelectedMember(member)}
                className="flex flex-col gap-1 rounded-card border border-subtle bg-surface p-4 text-left shadow-card transition-colors hover:border-subtle-strong hover:bg-surface-hover"
              >
                <span className="text-sm font-medium">
                  {member.nickname}
                  {isMe && <span className="ml-1 text-xs text-faint">(you)</span>}
                </span>
                <span className={`text-lg font-semibold ${colorClass}`}>
                  {net === 0 ? 'Settled up' : formatAmount(net)}
                </span>
                <span className="text-xs text-faint">
                  {net > 0 ? 'owed to them' : net < 0 ? 'they owe' : ''}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {selectedMember && (
        <Modal
          title={`${selectedMember.nickname}'s balance`}
          onClose={() => setSelectedMember(null)}
        >
          <div className="mb-3 flex items-center gap-2 text-xs">
            <span className="text-faint">Sort by:</span>
            <button
              type="button"
              onClick={() => setSortBy('date')}
              className={`rounded-control border px-2 py-1 font-medium transition-colors ${
                sortBy === 'date'
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-subtle bg-surface-2 text-muted hover:bg-surface-hover'
              }`}
            >
              Date
            </button>
            <button
              type="button"
              onClick={() => setSortBy('amount')}
              className={`rounded-control border px-2 py-1 font-medium transition-colors ${
                sortBy === 'amount'
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-subtle bg-surface-2 text-muted hover:bg-surface-hover'
              }`}
            >
              Amount
            </button>
          </div>

          {breakdown.length === 0 ? (
            <p className="text-sm text-muted">No purchases or usage on record yet.</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
              {breakdown.map(({ entry, signedAmount, counterpartyId }) => {
                const counterpartyName = nicknameById.get(counterpartyId) ?? 'Unknown member'
                const title =
                  signedAmount >= 0
                    ? `${counterpartyName} owes this to ${selectedMember.nickname}`
                    : `${selectedMember.nickname} owes this to ${counterpartyName}`
                return (
                  <li
                    key={entry.id}
                    title={title}
                    className="flex items-center justify-between rounded-control border border-subtle bg-surface-2 px-3 py-2 text-sm"
                  >
                    <span className="text-text">
                      {entry.food_name ?? (entry.reason === 'ADJUSTMENT' ? 'Adjustment' : 'Item')}
                    </span>
                    <span className={signedAmount >= 0 ? 'text-primary' : 'text-danger'}>
                      {formatAmount(signedAmount)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Modal>
      )}
    </div>
  )
}
