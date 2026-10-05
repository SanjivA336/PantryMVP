import { useOutletContext } from 'react-router-dom'
import { MembersTab } from './MembersTab'
import type { SettingsContext } from './settingsContext'

// The Members screen: the existing members list, fed by what SettingsLayout
// already fetched.
export function MembersScreen() {
  const { members, membersLoading, membersError, reloadMembers } =
    useOutletContext<SettingsContext>()
  return (
    <MembersTab
      members={members}
      loading={membersLoading}
      error={membersError}
      reload={reloadMembers}
    />
  )
}
