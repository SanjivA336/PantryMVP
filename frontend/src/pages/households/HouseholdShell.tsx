import { useEffect, useState } from 'react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import {
  ChefHat,
  Home,
  LogOut,
  MoreHorizontal,
  Receipt,
  Refrigerator,
  Scale,
  ShoppingCart,
  Users,
  X,
} from 'lucide-react'
import { apiClient } from '../../lib/apiClient'
import { useAuth } from '../../hooks/useAuth'
import type { Household } from '../../types/entities'

const PRIMARY_NAV_ITEMS = [
  { to: '', label: 'Inventory', end: true, icon: Home },
  { to: 'shopping-list', label: 'Shopping List', icon: ShoppingCart },
  { to: 'recipes', label: 'Recipes', icon: ChefHat },
  { to: 'balances', label: 'Balances', icon: Scale },
]

const SECONDARY_NAV_ITEMS = [
  { to: 'scan-receipt', label: 'Scan Receipt', icon: Receipt },
  { to: 'members', label: 'Members', icon: Users },
  { to: 'storage', label: 'Storage', icon: Refrigerator },
]

const ALL_NAV_ITEMS = [...PRIMARY_NAV_ITEMS, ...SECONDARY_NAV_ITEMS]

export function HouseholdShell() {
  const { householdId } = useParams<{ householdId: string }>()
  const { signOut } = useAuth()
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
    <div className="min-h-screen bg-bg text-text md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-subtle bg-surface md:flex">
        <div className="p-5">
          <p className="truncate text-base font-semibold">{household?.name ?? 'Burrow'}</p>
          {household && (
            <p className="mt-0.5 font-mono text-xs tracking-wide text-faint">
              {household.join_code}
            </p>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {ALL_NAV_ITEMS.map((item) => (
            <SidebarLink key={item.label} {...item} />
          ))}
        </nav>

        <div className="border-t border-subtle p-3">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-3 rounded-control px-2 py-2 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <LogOut size={18} strokeWidth={1.75} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-subtle bg-surface px-4 py-3 md:hidden">
        <div>
          <p className="truncate text-sm font-semibold">{household?.name ?? 'Burrow'}</p>
          {household && (
            <p className="font-mono text-[11px] tracking-wide text-faint">
              {household.join_code}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-control p-2 text-muted hover:bg-surface-hover hover:text-text"
          aria-label="Sign out"
        >
          <LogOut size={18} strokeWidth={1.75} />
        </button>
      </header>

      <main className="flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-8 md:pt-8">
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
              {SECONDARY_NAV_ITEMS.map((item) => (
                <SidebarLink key={item.label} {...item} onClick={() => setMoreOpen(false)} />
              ))}
            </div>
          </div>
        </div>
      )}
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
