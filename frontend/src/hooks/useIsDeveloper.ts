import { useAuth } from './useAuth'

// Mirrors the backend's DEVELOPER_USER_IDS (see backend/app/core/auth.py) --
// same root .env file, VITE_-prefixed so Vite exposes it to client code.
// This only ever controls what's *shown*; the real enforcement is the
// backend's require_developer/is_developer checks, so a user id being
// visible in the built bundle isn't a security concern here.
const DEVELOPER_USER_IDS = new Set(
  (import.meta.env.VITE_DEVELOPER_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
)

export function useIsDeveloper(): boolean {
  const { user } = useAuth()
  return !!user && DEVELOPER_USER_IDS.has(user.id)
}
