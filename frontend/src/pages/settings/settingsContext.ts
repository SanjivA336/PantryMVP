import type { Household, Member } from '../../types/entities'

// What the Settings screens share. SettingsLayout fetches it once and hands it
// to whichever screen is showing (via the router's outlet context), so the list
// on the left and the screen on the right always agree.
export interface SettingsContext {
  household: Household | null
  reloadHousehold: () => void
  members: Member[] | null
  membersLoading: boolean
  membersError: string | null
  reloadMembers: () => void
  isAdmin: boolean
}
