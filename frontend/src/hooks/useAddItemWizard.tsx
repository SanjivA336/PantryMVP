import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiClient, ApiError } from '../lib/apiClient'
import { PurchaseWizardModal } from '../pages/shopping-list/PurchaseWizardModal'
import type { Member, PurchaseSessionWithItems, StorageLocation } from '../types/entities'

const PARAM = 'addItem'

interface UseAddItemWizardResult {
  open: () => void
  modal: React.ReactNode
  error: string | null
  dismissError: () => void
}

function withoutParam(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete(PARAM)
  return next
}

// Shared by every "Add item" entry point (Inventory's own + button, the
// mobile shortcut menu) so opening it always means rendering the order
// wizard right where you already are -- never a route change, which would
// hide everything behind it and defeat the point of it being a modal at
// all. The session id lives in the current URL's ?addItem= param (not a
// dedicated route) purely so a refresh mid-order resumes it instead of
// losing track and starting a second, orphaned one.
export function useAddItemWizard(
  householdId: string | undefined,
  onChanged?: () => void,
): UseAddItemWizardResult {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([])
  const [error, setError] = useState<string | null>(null)

  const open = () => {
    if (!householdId) return
    setError(null)
    Promise.all([
      apiClient.get<Member[]>(`/api/households/${householdId}/members`),
      apiClient.get<StorageLocation[]>(`/api/households/${householdId}/storage-locations`),
    ])
      .then(async ([ms, locs]) => {
        setMembers(ms.filter((m) => m.is_active))
        setStorageLocations(locs)
        if (locs.length === 0) {
          setError('Add a fridge, freezer, or pantry first -- an item has to go somewhere.')
          return
        }
        const session = await apiClient.post<PurchaseSessionWithItems>(
          `/api/households/${householdId}/purchase-sessions/manual`,
        )
        setSessionId(session.id)
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev)
          next.set(PARAM, session.id)
          return next
        })
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'))
  }

  // Resumes a session already named in the current URL (e.g. a refresh
  // mid-order) without needing an explicit "open" click. Guarded against
  // React StrictMode's dev-only double-invoke of effects the same way
  // AddInventoryItemPage's own version of this used to (mount -> cleanup ->
  // mount again could otherwise race two lookups against each other).
  useEffect(() => {
    if (!householdId || sessionId) return
    const existing = searchParams.get(PARAM)
    if (!existing) return
    let cancelled = false

    Promise.all([
      apiClient.get<Member[]>(`/api/households/${householdId}/members`),
      apiClient.get<StorageLocation[]>(`/api/households/${householdId}/storage-locations`),
      apiClient.get<PurchaseSessionWithItems>(
        `/api/households/${householdId}/purchase-sessions/${existing}`,
      ),
    ])
      .then(([ms, locs, session]) => {
        if (cancelled) return
        // Already finalized (a stale link) -- nothing left to resume, and
        // the id shouldn't linger in the URL for next time.
        if (session.status === 'FINALIZED') {
          setSearchParams((prev) => withoutParam(prev), { replace: true })
          return
        }
        setMembers(ms.filter((m) => m.is_active))
        setStorageLocations(locs)
        setSessionId(session.id)
      })
      .catch(() => {
        // Bad/stale session id -- drop it quietly rather than surfacing an
        // error for a link nobody actually clicked on purpose.
        if (!cancelled) setSearchParams((prev) => withoutParam(prev), { replace: true })
      })

    return () => {
      cancelled = true
    }
    // Deliberately narrow -- only reacts to householdId settling, not to
    // searchParams/setSearchParams changing (including from this same
    // effect's own cleanup calls).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId])

  const close = () => {
    setSessionId(null)
    setSearchParams((prev) => withoutParam(prev), { replace: true })
    onChanged?.()
  }

  const modal =
    sessionId && householdId ? (
      <PurchaseWizardModal
        householdId={householdId}
        sessionId={sessionId}
        members={members}
        storageLocations={storageLocations}
        onClose={close}
        onFinalized={close}
        onCancelled={close}
      />
    ) : null

  return { open, modal, error, dismissError: () => setError(null) }
}
