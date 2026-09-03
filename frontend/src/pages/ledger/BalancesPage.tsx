import { useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Handshake, LayoutDashboard, Users } from 'lucide-react'
import { ScrollSpy } from '../../components/ScrollSpy'
import { useAuth } from '../../hooks/useAuth'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'
import type {
  LedgerBalance,
  LedgerEntryDetail,
  Member,
  Settlement,
  SettlementRecord,
} from '../../types/entities'
import { BalancesDashboard } from './BalancesDashboard'
import { MembersSection } from './MembersSection'
import { SettlementsSection } from './SettlementsSection'

const SPY_SECTIONS = [
  { id: 'members', label: 'Members', icon: Users },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'settlements', label: 'Settlements', icon: Handshake },
]

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
  const {
    data: entries,
    loading: entriesLoading,
    reload: reloadEntries,
  } = useHouseholdResource<LedgerEntryDetail[]>(
    householdId ? `/api/households/${householdId}/ledger/entries` : null,
  )
  const {
    data: settlements,
    loading: settlementsLoading,
    reload: reloadSettlements,
  } = useHouseholdResource<Settlement[]>(
    householdId ? `/api/households/${householdId}/ledger/settlements` : null,
  )
  const {
    data: settlementRecords,
    loading: recordsLoading,
    reload: reloadRecords,
  } = useHouseholdResource<SettlementRecord[]>(
    householdId ? `/api/households/${householdId}/ledger/settlement-records` : null,
  )

  const reloadAll = useCallback(() => {
    reloadBalances()
    reloadEntries()
    reloadSettlements()
    reloadRecords()
  }, [reloadBalances, reloadEntries, reloadSettlements, reloadRecords])
  // A purchase/consumption on any device changes balances, the dashboard's
  // charts, and the settle-up plan all at once; a recorded (or reversed)
  // payment moves the same numbers. One reload for both channels keeps the
  // three sections from silently going stale independently.
  useRealtimeSubscription('ledger_entries', householdId ?? null, reloadAll)
  useRealtimeSubscription('settlement_records', householdId ?? null, reloadAll)

  return (
    <div className="flex flex-col gap-10">
      <h2 className="text-xl font-semibold">Balances</h2>
      {balancesError && <p className="text-sm text-danger">{balancesError}</p>}

      <ScrollSpy sections={SPY_SECTIONS} />

      <section id="members" className="scroll-mt-6">
        <h3 className="mb-3 text-sm font-semibold text-muted">Members</h3>
        <MembersSection
          members={members}
          balances={balances}
          entries={entries}
          loading={balancesLoading || membersLoading}
          myUserId={user?.id}
        />
      </section>

      <section id="dashboard" className="scroll-mt-6">
        <h3 className="mb-3 text-sm font-semibold text-muted">Dashboard</h3>
        <BalancesDashboard
          entries={entries}
          balances={balances}
          settlements={settlementRecords}
          members={members}
          loading={entriesLoading || recordsLoading}
        />
      </section>

      <section id="settlements" className="scroll-mt-6">
        <h3 className="mb-3 text-sm font-semibold text-muted">Settlements</h3>
        <SettlementsSection
          householdId={householdId ?? ''}
          settlements={settlements}
          settlementRecords={settlementRecords}
          members={members}
          loading={settlementsLoading || recordsLoading}
          onChange={reloadAll}
        />
      </section>
    </div>
  )
}
