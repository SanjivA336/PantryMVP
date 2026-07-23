import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ChevronRight, Home, Plus } from 'lucide-react'
import { apiClient } from '../../lib/apiClient'
import type { Household } from '../../types/entities'

export function HouseholdPickerPage() {
  const [households, setHouseholds] = useState<Household[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiClient
      .get<Household[]>('/api/households')
      .then(setHouseholds)
      .catch((err) => setError(err instanceof Error ? err.message : 'Something went wrong'))
  }, [])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <p className="text-sm text-danger">{error}</p>
      </div>
    )
  }

  if (households === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    )
  }

  if (households.length === 1) {
    return <Navigate to={`/households/${households[0].id}`} replace />
  }

  return (
    <div className="min-h-screen bg-bg p-6 text-text">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 pt-12">
        <div>
          <p className="mb-1 text-sm font-medium text-primary">Burrow</p>
          <h1 className="text-2xl font-semibold">Your households</h1>
        </div>

        {households.length === 0 ? (
          <p className="rounded-card border border-subtle bg-surface p-5 text-sm text-muted">
            You're not in a household yet — create one or join with a code below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {households.map((household) => (
              <li key={household.id}>
                <Link
                  to={`/households/${household.id}`}
                  className="flex items-center gap-3 rounded-card border border-subtle bg-surface p-4 shadow-card transition-colors hover:border-subtle-strong hover:bg-surface-hover"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                    <Home size={18} strokeWidth={1.75} />
                  </div>
                  <span className="flex-1 font-medium">{household.name}</span>
                  <ChevronRight size={18} strokeWidth={1.75} className="text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            to="/households/new"
            className="flex flex-1 items-center justify-center gap-2 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover"
          >
            <Plus size={16} strokeWidth={2} />
            Create a household
          </Link>
          <Link
            to="/households/join"
            className="flex flex-1 items-center justify-center gap-2 rounded-control border border-subtle bg-surface px-2 py-2 text-sm font-semibold text-text transition-colors hover:bg-surface-hover"
          >
            Join with a code
          </Link>
        </div>
      </div>
    </div>
  )
}
