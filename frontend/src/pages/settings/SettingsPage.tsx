import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import type { Member } from '../../types/entities'
import { BurrowTab } from './BurrowTab'
import { MembersTab } from './MembersTab'

type Tab = 'burrow' | 'members'

const TABS: { key: Tab; label: string }[] = [
  { key: 'burrow', label: 'Burrow' },
  { key: 'members', label: 'Members' },
]

export function SettingsPage() {
  const { householdId } = useParams<{ householdId: string }>()
  const [tab, setTab] = useState<Tab>('burrow')

  // Fetched once here rather than separately in each tab -- since only one
  // tab is ever mounted at a time, switching tabs used to re-fetch the same
  // members list from scratch every time with nothing shared between them.
  const {
    data: members,
    loading: membersLoading,
    error: membersError,
    reload: reloadMembers,
  } = useHouseholdResource<Member[]>(
    householdId ? `/api/households/${householdId}/members` : null,
  )

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold">Settings</h2>

      <div className="flex gap-2">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-control border px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-subtle bg-surface-2 text-muted hover:bg-surface-hover'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'burrow' ? (
        <BurrowTab members={members} />
      ) : (
        <MembersTab
          members={members}
          loading={membersLoading}
          error={membersError}
          reload={reloadMembers}
        />
      )}
    </div>
  )
}
