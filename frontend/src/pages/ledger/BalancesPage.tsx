import { useParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'
import type { LedgerBalance, Member } from '../../types/entities'

export function BalancesPage() {
  const { householdId } = useParams<{ householdId: string }>()
  const { user } = useAuth()

  const {
    data: balances,
    loading: balancesLoading,
    error: balancesError,
    reload: reloadBalances,
  } = useHouseholdResource<LedgerBalance[]>(
    householdId ? `/api/households/${householdId}/ledger/balances` : null,
  )
  const { data: members, loading: membersLoading } = useHouseholdResource<Member[]>(
    householdId ? `/api/households/${householdId}/members` : null,
  )

  // Purchases/consumption on any device change balances immediately — this
  // keeps the numbers here from going stale without the user having to
  // manually refresh.
  useRealtimeSubscription('ledger_entries', householdId ?? null, reloadBalances)

  const nicknameById = new Map((members ?? []).map((m) => [m.id, m.nickname]))
  const myMemberId = (members ?? []).find((m) => m.user_id === user?.id)?.id

  const loading = balancesLoading || membersLoading

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Balances</h2>
      {balancesError && <p className="text-sm text-red-600">{balancesError}</p>}

      {loading ? (
        <p className="text-sm">Loading…</p>
      ) : !balances || balances.length === 0 ? (
        <p className="text-sm text-gray-500">All settled up — nobody owes anybody anything.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {balances.map((balance) => {
            const debtorName = nicknameById.get(balance.debtor_member_id) ?? 'Unknown member'
            const creditorName = nicknameById.get(balance.creditor_member_id) ?? 'Unknown member'
            const involvesMe =
              balance.debtor_member_id === myMemberId || balance.creditor_member_id === myMemberId
            return (
              <li
                key={`${balance.debtor_member_id}-${balance.creditor_member_id}`}
                className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3"
              >
                <span className={involvesMe ? 'font-medium' : ''}>
                  {debtorName} owes {creditorName}
                </span>
                <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                  {/* The backend keeps full Decimal precision internally and never
                      rounds it — this Number()/toFixed() is purely a display-layer
                      formatting choice, not a change to any stored or computed value. */}
                  ${Number(balance.amount).toFixed(2)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
