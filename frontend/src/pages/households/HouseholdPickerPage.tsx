import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ChevronRight, Home, LogOut, Plus } from 'lucide-react'
import { apiClient } from '../../lib/apiClient'
import { LogoutConfirmModal } from '../../components/LogoutConfirmModal'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import type { Household } from '../../types/entities'

export function HouseholdPickerPage() {
  usePageTitle('Your Households')
  const { signOut } = useAuth()
  const [households, setHouseholds] = useState<Household[] | null>(null)
  const [error, setError] = useState<string | null>(null)
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
  // Set by the sidebar's "switch kitchens" button (see HouseholdShell) so a
  // deliberate click here always shows the picker, even with just one
  // household -- the auto-redirect below is meant only as a shortcut past
  // an empty choice right after login, not something that should make this
  // button feel broken for anyone with a single household.
  const location = useLocation()
  const forcePicker = Boolean((location.state as { forcePicker?: boolean } | null)?.forcePicker)

  useEffect(() => {
    apiClient
      .get<Household[]>('/api/households')
      .then(setHouseholds)
      .catch((err) => setError(err instanceof Error ? err.message : 'Something went wrong'))
  }, [])

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6">
        <p className="text-sm text-danger">{error}</p>
        <button
          type="button"
          onClick={() => setLogoutConfirmOpen(true)}
          className="flex items-center gap-2 rounded-control border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
        >
          <LogOut size={16} strokeWidth={1.75} />
          Log out
        </button>
        {logoutConfirmOpen && (
          <LogoutConfirmModal
            loggingOut={loggingOut}
            onClose={() => setLogoutConfirmOpen(false)}
            onConfirm={() => void handleSignOut()}
          />
        )}
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

  if (households.length === 1 && !forcePicker) {
    return <Navigate to={`/households/${households[0].id}`} replace />
  }

  return (
    <div className="min-h-screen bg-bg p-6 text-text">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 pt-12">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-sm font-medium text-primary">Burrow</p>
            <h1 className="text-2xl font-semibold">Your households</h1>
          </div>
          <button
            type="button"
            onClick={() => setLogoutConfirmOpen(true)}
            title="Log out"
            aria-label="Log out"
            className="flex shrink-0 items-center gap-1.5 rounded-control border border-subtle px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <LogOut size={14} strokeWidth={1.75} />
            Log out
          </button>
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

      {logoutConfirmOpen && (
        <LogoutConfirmModal
          loggingOut={loggingOut}
          onClose={() => setLogoutConfirmOpen(false)}
          onConfirm={() => void handleSignOut()}
        />
      )}
    </div>
  )
}
