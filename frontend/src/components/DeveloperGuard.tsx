import { Navigate, Outlet, useParams } from 'react-router-dom'
import { useIsDeveloper } from '../hooks/useIsDeveloper'

// Route-level counterpart to hiding a nav link/button: someone who guesses
// or bookmarks an experimental feature's URL directly still can't reach the
// page, not just the entry point to it. The backend enforces this for real
// (see require_developer) -- this is purely so a non-developer never even
// sees the page render before an API call would have failed.
export function DeveloperGuard() {
  const { householdId } = useParams<{ householdId: string }>()
  const isDeveloper = useIsDeveloper()

  if (!isDeveloper) {
    return <Navigate to={`/households/${householdId}`} replace />
  }

  return <Outlet />
}
