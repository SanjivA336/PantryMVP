import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import {
  ChefHat,
  Home,
  LogOut,
  Receipt,
  Scale,
  Settings,
  ShoppingCart,
  UserCircle,
} from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { CopyButton } from '../../components/CopyButton'
import { LogoutConfirmModal } from '../../components/LogoutConfirmModal'
import { MobileShortcutMenu } from '../../components/MobileShortcutMenu'
import { useAuth } from '../../hooks/useAuth'
import { useIsDeveloper } from '../../hooks/useIsDeveloper'
import type { Household } from '../../types/entities'
import logoSource from '../../assets/logo.svg?raw'

// The raw SVG source (Vite's `?raw` import), recolored to `currentColor` and
// resized to fill its container -- injected as real inline SVG so it can
// follow hover state via a wrapping element's `text-*` class, the same way
// lucide-react's icons already do. An <img> can't do this: its pixels are
// opaque to CSS, so its color could never follow the sidebar's hover state.
// Safe to inject as-is (dangerouslySetInnerHTML) since it's our own
// build-time asset, never user- or runtime-supplied content.
const coloredLogo = logoSource
  .replace(/#ffffff/gi, 'currentColor')
  .replace(/width="[\d.]+"/, 'width="100%"')
  .replace(/height="[\d.]+"/, 'height="100%"')

function BurrowLogo({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: coloredLogo }}
    />
  )
}

// Activity now lives inside Settings (see SettingsPage's third tab) rather
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
  const { signOut } = useAuth()
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
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleSignOut = async () => {
    setLoggingOut(true)
    try {
      await signOut()
    } finally {
      setLoggingOut(false)
      setLogoutConfirmOpen(false)
    }
  }

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
      <div className="flex min-h-screen items-center justify-center bg-bg p-4 text-text">
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
    <div className="min-h-screen bg-bg text-text md:flex md:h-screen md:overflow-hidden">
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
            title="Switch kitchens"
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
            <NavLink
              to="account"
              title="Account"
              aria-label="Account"
              className={({ isActive }) =>
                `flex shrink-0 items-center justify-center rounded-control p-2.5 transition-colors ${
                  isActive
                    ? 'bg-primary-soft text-primary'
                    : 'text-muted hover:bg-surface-hover hover:text-text'
                }`
              }
            >
              <UserCircle size={18} strokeWidth={1.75} />
            </NavLink>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between gap-2 border-b border-subtle bg-surface px-4 py-3 md:hidden">
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
          title="Switch kitchens"
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
          <NavLink
            to="account"
            aria-label="Account"
            title="Account"
            className={({ isActive }) =>
              `rounded-control p-2 transition-colors ${
                isActive ? 'text-primary' : 'text-muted hover:bg-surface-hover hover:text-text'
              }`
            }
          >
            <UserCircle size={18} strokeWidth={1.75} />
          </NavLink>
          <button
            type="button"
            onClick={() => setLogoutConfirmOpen(true)}
            className="rounded-control p-2 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
            aria-label="Sign out"
          >
            <LogOut size={18} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {logoutConfirmOpen && (
        <LogoutConfirmModal
          loggingOut={loggingOut}
          onClose={() => setLogoutConfirmOpen(false)}
          onConfirm={() => void handleSignOut()}
        />
      )}

      <main className="flex-1 px-4 pb-24 pt-5 md:overflow-y-auto md:px-8 md:pb-8 md:pt-8">
        <div className="mx-auto w-full max-w-5xl">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom tab bar -- three real flex sections, not two tab
          groups plus a separately-positioned floating FAB. The two tab
          groups are each `flex-1`, so they always split the remaining width
          exactly evenly regardless of label length, which puts the middle
          slot dead center for free -- no separate "center it in the
          viewport" math to keep in sync with the bar's own layout. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex h-16 items-stretch border-t border-subtle bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
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
    </div>
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

function BottomTabLink({ to, label, end, icon: Icon }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors duration-150 ${
          isActive ? 'text-primary' : 'text-muted hover:text-text'
        }`
      }
    >
      <Icon
        size={22}
        strokeWidth={1.75}
        className="transition-transform duration-150 hover:scale-110"
      />
      {label}
    </NavLink>
  )
}
