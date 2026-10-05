import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import {
  ChefHat,
  Home,
  Receipt,
  Scale,
  Settings,
  ShoppingCart,
} from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { BurrowLogo } from '../../components/BurrowLogo'
import { CopyButton } from '../../components/CopyButton'
import { Modal } from '../../components/Modal'
import { MobileShortcutMenu } from '../../components/MobileShortcutMenu'
import { PullToRefreshIndicator } from '../../components/PullToRefreshIndicator'
import { SupportLink } from '../../components/SupportLink'
import { AddItemWizardContext } from '../../context/addItemWizard'
import { ShellChromeContext } from '../../context/shellChrome'
import { useAddItemWizard } from '../../hooks/useAddItemWizard'
import { useIsDeveloper } from '../../hooks/useIsDeveloper'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import type { Household } from '../../types/entities'
// Activity now lives inside Settings (see SettingsList) rather
// than as its own destination -- it's a look-back log, not a daily action,
// so it doesn't need a permanent slot in the primary nav on either platform.
const PRIMARY_NAV_ITEMS = [
  { to: '', label: 'Inventory', end: true, icon: Home },
  { to: 'shopping-list', label: 'Shopping List', icon: ShoppingCart },
  { to: 'balances', label: 'Balances', icon: Scale },
]

// Experimental (AI/OCR-backed, real inference cost) -- hidden from the nav
// entirely unless useIsDeveloper() says otherwise. The backend enforces
// this independently (require_developer); hiding it here is just so it
// doesn't dangle in front of everyone else.
const SECONDARY_NAV_ITEMS = [{ to: 'scan-receipt', label: 'Scan Receipt', icon: Receipt }]

// Recipes lives in its own section, set off by a divider from the rest of
// the household's nav -- it's a personal recipe box now (see the per-user
// recipes migration), not household data, so it reads as a separate
// destination rather than one more of the household's daily tabs.
const RECIPES_NAV_ITEMS = [{ to: 'recipes', label: 'Recipes', icon: ChefHat }]

// With Activity moved into Settings, exactly 4 destinations are left
// (Inventory, Shopping List, Balances, Recipes) -- a clean direct-tab bottom
// bar with no "More" sheet or top-bar relocation needed for any of them.
const MOBILE_BOTTOM_NAV_ITEMS = [...PRIMARY_NAV_ITEMS, ...RECIPES_NAV_ITEMS]

export function HouseholdShell() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()
  const isDeveloper = useIsDeveloper()
  const [household, setHousehold] = useState<Household | null>(null)
  // Deliberately one bucket for "doesn't exist" and "exists but you're not a
  // member" -- the backend already collapses these into the same 403
  // (require_household_membership can't tell them apart either: a bad id
  // just has zero members, same as one you were never added to), and there's
  // no reason to hand back that distinction to whoever's poking at a
  // household id in the URL. A genuine network/server failure gets its own
  // message instead of this one, since telling someone "you don't have
  // access" for what's actually a dropped connection would be wrong, not
  // just imprecise.
  const [accessError, setAccessError] = useState(false)
  const [loadError, setLoadError] = useState(false)
  // Pull-to-refresh bumps this; it is the key on <Outlet />, so the current
  // page remounts and every fetch and live subscription on it starts over.
  // (Any half-typed form on the page is lost, which is why modals block it.)
  const [refreshKey, setRefreshKey] = useState(0)
  // Editing screens hide the phone tab bar and pin their own Save bar there
  // instead (see hooks/useHideTabBar).
  const [tabBarHidden, setTabBarHidden] = useState(false)
  const chrome = useMemo(() => ({ setTabBarHidden }), [])
  // The household's one add-item flow (see context/addItemWizard). It lives here,
  // above every page, so there is only ever one copy that reopens an in-progress
  // order from the address.
  const onAddItemChanged = useRef<(() => void) | null>(null)
  const addItemWizard = useAddItemWizard(householdId, () => onAddItemChanged.current?.())
  const openAddItem = useRef(addItemWizard.open)
  useEffect(() => {
    openAddItem.current = addItemWizard.open
  })
  const addItemApi = useMemo(
    () => ({
      open: () => openAddItem.current(),
      setOnChanged: (callback: (() => void) | null) => {
        onAddItemChanged.current = callback
      },
    }),
    [],
  )
  const { pull, dragging, refreshing } = usePullToRefresh(() => setRefreshKey((k) => k + 1))

  useEffect(() => {
    if (!householdId) return
    let cancelled = false
    setAccessError(false)
    setLoadError(false)

    apiClient
      .get<Household>(`/api/households/${householdId}`)
      .then((data) => {
        if (!cancelled) setHousehold(data)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load household', err)
        if (err instanceof ApiError && err.code === '403') {
          setAccessError(true)
        } else {
          setLoadError(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [householdId])

  if (accessError || loadError) {
    return (
      <div className="flex min-h-app items-center justify-center bg-bg p-4 text-text">
        <div className="w-full max-w-sm rounded-card border border-subtle bg-surface p-7 text-center shadow-card">
          <p className="mb-1 text-sm font-medium text-primary">Burrow</p>
          <h1 className="mb-3 text-xl font-semibold">
            {accessError ? "This burrow isn't available" : "Couldn't load this burrow"}
          </h1>
          <p className="mb-5 text-sm text-muted">
            {accessError
              ? 'It may not exist, or you may not have access to it. Double-check the link, or ask whoever invited you for a fresh one.'
              : 'Something went wrong reaching the server. Check your connection and try again.'}
          </p>
          <Link
            to="/"
            className="inline-block w-full rounded-control bg-primary px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover"
          >
            Back to your burrows
          </Link>
        </div>
      </div>
    )
  }

  return (
    <AddItemWizardContext.Provider value={addItemApi}>
      <div className="min-h-app bg-bg text-text md:flex md:h-dvh md:overflow-hidden">
        {/* Desktop sidebar -- fixed height, never scrolls as a whole; only the
            nav links scroll internally if they ever overflow (the household
            name/code header and the settings/sign-out footer stay pinned). */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-subtle bg-surface md:flex">
          <div className="flex shrink-0 items-start gap-2 p-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => navigate('/', { state: { forcePicker: true } })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate('/', { state: { forcePicker: true } })
                }
              }}
              title="Switch burrows"
              className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-control p-2 transition-colors hover:bg-surface-hover"
            >
              <BurrowLogo className="h-9 w-9 shrink-0 text-text transition-colors group-hover:text-primary" />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold transition-colors group-hover:text-primary">
                  {household?.name ?? 'Burrow'}
                </p>
                {household && (
                  <div className="mt-0.5 flex items-center gap-1">
                    <p className="font-mono text-xs tracking-wide text-faint">
                      {household.join_code}
                    </p>
                    <CopyButton value={household.join_code} label="Copy join code" />
                  </div>
                )}
              </div>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <SidebarLink key={item.label} {...item} />
            ))}
            {isDeveloper &&
              SECONDARY_NAV_ITEMS.map((item) => <SidebarLink key={item.label} {...item} />)}
            <hr className="my-2 border-t border-subtle" />
            {RECIPES_NAV_ITEMS.map((item) => (
              <SidebarLink key={item.label} {...item} />
            ))}
          </nav>

          <div className="shrink-0 border-t border-subtle p-3">
            <SupportLink className="mb-1 rounded-control px-2 py-2 hover:bg-surface-hover" />
            <div className="flex items-center gap-2">
              <NavLink
                to="settings"
                className={({ isActive }) =>
                  `flex flex-1 items-center gap-2 rounded-control px-2 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-soft text-primary'
                      : 'text-muted hover:bg-surface-hover hover:text-text'
                  }`
                }
              >
                <Settings size={18} strokeWidth={1.75} />
                Settings
              </NavLink>
            </div>
          </div>
        </aside>

        {/* Mobile top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-subtle bg-surface px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:hidden">
          <div
            role="button"
            tabIndex={0}
            onClick={() => navigate('/', { state: { forcePicker: true } })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                navigate('/', { state: { forcePicker: true } })
              }
            }}
            title="Switch burrows"
            className="group -m-1 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control p-1 transition-colors hover:bg-surface-hover"
          >
            <BurrowLogo className="h-7 w-7 shrink-0 text-text transition-colors group-hover:text-primary" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold transition-colors group-hover:text-primary">
                {household?.name ?? 'Burrow'}
              </p>
              {household && (
                <div className="mt-0.5 flex items-center gap-1">
                  <p className="font-mono text-[11px] tracking-wide text-faint">
                    {household.join_code}
                  </p>
                  <CopyButton value={household.join_code} label="Copy join code" />
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <NavLink
              to="settings"
              aria-label="Settings"
              className={({ isActive }) =>
                `rounded-control p-2 transition-colors ${
                  isActive ? 'text-primary' : 'text-muted hover:bg-surface-hover hover:text-text'
                }`
              }
            >
              <Settings size={18} strokeWidth={1.75} />
            </NavLink>
          </div>
        </header>

        <main className="flex-1 px-4 pb-[calc(6rem+var(--bottom-bar-gap))] pt-5 md:overflow-y-auto md:px-8 md:pb-8 md:pt-8">
          <PullToRefreshIndicator pull={pull} dragging={dragging} refreshing={refreshing} />
          <div className="mx-auto w-full max-w-5xl">
            <ShellChromeContext.Provider value={chrome}>
              <Outlet key={refreshKey} />
            </ShellChromeContext.Provider>
          </div>
        </main>

        {/* Mobile bottom tab bar -- three real flex sections, not two tab
            groups plus a separately-positioned floating FAB. The two tab
            groups are each `flex-1`, so they always split the remaining width
            exactly evenly regardless of label length, which puts the middle
            slot dead center for free -- no separate "center it in the
            viewport" math to keep in sync with the bar's own layout. */}
        {!tabBarHidden && (
          <nav className="tab-bar fixed inset-x-0 bottom-0 z-20 flex h-[calc(4rem+var(--bottom-bar-gap))] items-stretch border-t border-subtle bg-surface pb-[var(--bottom-bar-gap)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden">
            <div className="flex flex-1">
              {MOBILE_BOTTOM_NAV_ITEMS.slice(0, 2).map((item) => (
                <BottomTabLink key={item.label} {...item} />
              ))}
            </div>
            <div className="relative flex w-16 shrink-0 items-center justify-center">
              {householdId && <MobileShortcutMenu householdId={householdId} />}
            </div>
            <div className="flex flex-1">
              {MOBILE_BOTTOM_NAV_ITEMS.slice(2).map((item) => (
                <BottomTabLink key={item.label} {...item} />
              ))}
            </div>
          </nav>
        )}

        {addItemWizard.modal}
        {addItemWizard.error && (
          <Modal title="Can't add an item yet" onClose={addItemWizard.dismissError}>
            <p className="text-sm text-muted">{addItemWizard.error}</p>
          </Modal>
        )}
      </div>
    </AddItemWizardContext.Provider>
  )
}

interface NavItemProps {
  to: string
  label: string
  end?: boolean
  icon: typeof Home
  onClick?: () => void
}

function SidebarLink({ to, label, end, icon: Icon, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-control px-2 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-primary-soft text-primary'
            : 'text-muted hover:bg-surface-hover hover:text-text'
        }`
      }
    >
      <Icon size={18} strokeWidth={1.75} />
      {label}
    </NavLink>
  )
}

// Icon-only on purpose. The text label is kept as the accessible name (and a
// tooltip on hover/long-press), so screen readers still announce each tab, and
// NavLink marks the current page with aria-current.
function BottomTabLink({ to, label, end, icon: Icon }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        `flex flex-1 items-center justify-center transition-colors duration-150 ${
          isActive ? 'text-primary' : 'text-muted hover:text-text'
        }`
      }
    >
      <Icon
        size={26}
        strokeWidth={1.75}
        className="transition-transform duration-150 hover:scale-110"
      />
    </NavLink>
  )
}
