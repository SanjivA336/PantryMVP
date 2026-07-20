import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
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
    return <p className="p-6 text-sm text-red-600">{error}</p>
  }

  if (households === null) {
    return <p className="p-6 text-sm">Loading…</p>
  }

  if (households.length === 1) {
    return <Navigate to={`/households/${households[0].id}`} replace />
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-primary)' }}>
        Your households
      </h1>
      {households.length === 0 && (
        <p className="text-sm text-gray-500">You're not in a household yet.</p>
      )}
      <ul className="flex flex-col gap-2">
        {households.map((household) => (
          <li key={household.id}>
            <Link
              to={`/households/${household.id}`}
              className="block rounded-md border border-gray-200 px-4 py-3 hover:border-gray-300"
            >
              {household.name}
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex gap-3 text-sm">
        <Link
          to="/households/new"
          className="font-medium"
          style={{ color: 'var(--color-primary)' }}
        >
          Create a household
        </Link>
        <Link
          to="/households/join"
          className="font-medium"
          style={{ color: 'var(--color-primary)' }}
        >
          Join with a code
        </Link>
      </div>
    </div>
  )
}
