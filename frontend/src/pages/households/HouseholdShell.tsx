import { useEffect, useState } from 'react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import { apiClient } from '../../lib/apiClient'
import type { Household } from '../../types/entities'

const NAV_ITEMS = [
  { to: '', label: 'Inventory', end: true },
  { to: 'balances', label: 'Balances' },
  { to: 'members', label: 'Members' },
  { to: 'storage', label: 'Storage' },
  { to: 'shopping-list', label: 'Shopping List' },
  { to: 'recipes', label: 'Recipes' },
  { to: 'scan-receipt', label: 'Scan Receipt' },
]

export function HouseholdShell() {
  const { householdId } = useParams<{ householdId: string }>()
  const [household, setHousehold] = useState<Household | null>(null)

  useEffect(() => {
    if (!householdId) return
    let cancelled = false

    apiClient
      .get<Household>(`/api/households/${householdId}`)
      .then((data) => {
        if (!cancelled) setHousehold(data)
      })
      .catch((err) => {
        // Swallow navigation-aborted fetches; anything else, log for now —
        // Phase 1 doesn't have a header-level error banner yet.
        if (!cancelled) console.error('Failed to load household', err)
      })

    return () => {
      cancelled = true
    }
  }, [householdId])

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-background)' }}>
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-primary)' }}>
          {household?.name ?? 'Burrow'}
        </h1>
        {household && <p className="text-xs text-gray-500">Join code: {household.join_code}</p>}
      </header>
      <nav className="flex gap-4 border-b border-gray-200 bg-white px-6 py-2 text-sm">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              isActive ? 'font-semibold' : 'text-gray-500 hover:text-gray-800'
            }
            style={({ isActive }) => (isActive ? { color: 'var(--color-primary)' } : undefined)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  )
}
