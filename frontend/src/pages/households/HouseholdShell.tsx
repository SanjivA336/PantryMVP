import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import {
  Check,
  ChefHat,
  Clock,
  Copy,
  Home,
  LogOut,
  MoreHorizontal,
  Receipt,
  Scale,
  Settings,
  ShoppingCart,
  UserCircle,
  X,
} from 'lucide-react'
import { apiClient } from '../../lib/apiClient'
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

const PRIMARY_NAV_ITEMS = [
  { to: '', label: 'Inventory', end: true, icon: Home },
  { to: 'shopping-list', label: 'Shopping List', icon: ShoppingCart },
  { to: 'balances', label: 'Balances', icon: Scale },
  { to: 'history', label: 'History', icon: Clock },
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

export function HouseholdShell() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const isDeveloper = useIsDeveloper()
  const [household, setHousehold] = useState<Household | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    if (!householdId) return
    let cancelled = false

    apiClient
      .get<Household>(`/api/households/${householdId}`)
      .then((data) => {
        if (!cancelled) setHousehold(data)
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to load household', err)
      })

    return () => {
      cancelled = true
    }
  }, [householdId])

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
                  <CopyCodeButton code={household.join_code} />
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
      <header className="flex items-center justify-between border-b border-subtle bg-surface px-4 py-3 md:hidden">
        <div>
          <p className="truncate text-sm font-semibold">{household?.name ?? 'Burrow'}</p>
          {household && (
            <div className="mt-0.5 flex items-center gap-1">
              <p className="font-mono text-[11px] tracking-wide text-faint">
                {household.join_code}
              </p>
              <CopyCodeButton code={household.join_code} />
            </div>
          )}
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
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-control p-2 text-muted hover:bg-surface-hover hover:text-text"
            aria-label="Sign out"
          >
            <LogOut size={18} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pb-24 pt-5 md:overflow-y-auto md:px-8 md:pb-8 md:pt-8">
        <div className="mx-auto w-full max-w-5xl">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t border-subtle bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <BottomTabLink key={item.label} {...item} />
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted"
        >
          <MoreHorizontal size={22} strokeWidth={1.75} />
          More
        </button>
      </nav>

      {/* Mobile "more" sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-card border-t border-subtle bg-surface-2 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-raised">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-muted">More</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="rounded-control p-1.5 text-muted hover:bg-surface-hover hover:text-text"
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              {isDeveloper &&
                SECONDARY_NAV_ITEMS.map((item) => (
                  <SidebarLink key={item.label} {...item} onClick={() => setMoreOpen(false)} />
                ))}
              <hr className="my-2 border-t border-subtle" />
              {RECIPES_NAV_ITEMS.map((item) => (
                <SidebarLink key={item.label} {...item} onClick={() => setMoreOpen(false)} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context) -- a
      // silent no-op is fine for this low-stakes convenience action.
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // The sidebar's desktop header wraps this in a clickable "switch
        // kitchens" region -- without this, copying the code would also
        // navigate away.
        e.stopPropagation()
        void copy()
      }}
      title="Copy join code"
      aria-label="Copy join code"
      className="rounded-control p-0.5 text-faint transition-colors hover:bg-surface-hover hover:text-text"
    >
      {copied ? <Check size={12} strokeWidth={2.25} /> : <Copy size={12} strokeWidth={1.75} />}
    </button>
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
        `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
          isActive ? 'text-primary' : 'text-muted'
        }`
      }
    >
      <Icon size={22} strokeWidth={1.75} />
      {label}
    </NavLink>
  )
}
