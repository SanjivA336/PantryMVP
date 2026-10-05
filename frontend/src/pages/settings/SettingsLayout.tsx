import { useEffect } from 'react'
import { Link, Outlet, useMatch, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import { usePageTitle } from '../../hooks/usePageTitle'
import type { Household, Member } from '../../types/entities'
import { SettingsList } from './SettingsList'
import type { SettingsContext } from './settingsContext'

const TITLES: Record<string, string> = {
  burrow: 'Burrow details',
  members: 'Members',
  activity: 'Activity',
  account: 'Account',
}

// The frame for every Settings page. On a phone it is one screen at a time: the
// list, and tapping a row goes to that screen with a back arrow. From the
// desktop breakpoint up it is two panes: the list always on the left, the chosen
// screen on the right (landing on "Burrow details" so the right side is never
// empty). It also fetches what the list and the screens share, once.
export function SettingsLayout() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isDesktop = useIsDesktop()
  const atList = !!useMatch({ path: '/households/:householdId/settings', end: true })
  const section = useMatch('/households/:householdId/settings/:section')?.params.section
  usePageTitle(section ? (TITLES[section] ?? 'Settings') : 'Settings')

  const { data: household, reload: reloadHousehold } = useHouseholdResource<Household>(
    householdId ? `/api/households/${householdId}` : null,
  )
  const {
    data: members,
    loading: membersLoading,
    error: membersError,
    reload: reloadMembers,
  } = useHouseholdResource<Member[]>(householdId ? `/api/households/${householdId}/members` : null)

  const isAdmin = (members ?? []).some((m) => m.user_id === user?.id && m.is_admin && m.is_active)

  useEffect(() => {
    if (atList && isDesktop) navigate('burrow', { replace: true })
  }, [atList, isDesktop, navigate])

  const ctx: SettingsContext = {
    household,
    reloadHousehold,
    members,
    membersLoading,
    membersError,
    reloadMembers,
    isAdmin,
  }

  return (
    <div className="md:grid md:grid-cols-[18rem_minmax(0,1fr)] md:items-start md:gap-10">
      <div className={atList ? 'block' : 'hidden md:block'}>
        <h2 className="mb-4 text-xl font-semibold">Settings</h2>
        <SettingsList ctx={ctx} />
      </div>

      {!atList && section && (
        <section className="min-w-0 md:max-w-xl">
          <Link
            to={`/households/${householdId}/settings`}
            className="mb-3 flex w-fit items-center gap-1 text-sm font-medium text-primary md:hidden"
          >
            <ChevronLeft size={16} strokeWidth={2} />
            Settings
          </Link>
          <h2 className="mb-4 text-xl font-semibold">{TITLES[section] ?? 'Settings'}</h2>
          <Outlet context={ctx} />
        </section>
      )}
    </div>
  )
}
