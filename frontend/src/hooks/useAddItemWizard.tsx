import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AddItemOpeningSheet } from '../components/AddItemOpeningSheet'
import { apiClient, ApiError } from '../lib/apiClient'
import { fetchResource, peekResource } from '../lib/resourceCache'
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
  // The order as fetched or created when opening, handed to the sheet so it
  // doesn't fetch it a second time.
  const [initialSession, setInitialSession] = useState<PurchaseSessionWithItems | undefined>()
  const [members, setMembers] = useState<Member[]>([])
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([])
  const [error, setError] = useState<string | null>(null)
  // True from the tap (or from reopening an order after a reload) until the real
  // sheet is ready, so something is on screen straight away.
  const [opening, setOpening] = useState(false)
  // Bumped by every open and every cancel; a setup that finds it has moved on
  // knows it was cancelled and stops.
  const attemptRef = useRef(0)

  const open = () => {
    if (!householdId) return
    setError(null)
    const membersPath = `/api/households/${householdId}/members`
    const locationsPath = `/api/households/${householdId}/storage-locations`
    const attempt = ++attemptRef.current
    setOpening(true)

    // The page you're on has usually loaded the members and storage locations
    // already, so use them as they are (instant) and only wait on the network when
    // we've never seen them. Either way they're refreshed quietly for next time.
    const knownMembers = peekResource<Member[]>(membersPath)
    const knownLocations = peekResource<StorageLocation[]>(locationsPath)
    const getMembers = knownMembers
      ? Promise.resolve(knownMembers)
      : fetchResource<Member[]>(membersPath)
    const getLocations = knownLocations
      ? Promise.resolve(knownLocations)
      : fetchResource<StorageLocation[]>(locationsPath)
    for (const path of [membersPath, locationsPath]) void fetchResource(path).catch(() => {})

    Promise.all([getMembers, getLocations])
      .then(async ([ms, locs]) => {
        if (attemptRef.current !== attempt) return
        setMembers(ms.filter((m) => m.is_active))
        setStorageLocations(locs)
        if (locs.length === 0) {
          setOpening(false)
          setError('Add a fridge, freezer, or pantry first -- an item has to go somewhere.')
          return
        }
        const session = await apiClient.post<PurchaseSessionWithItems>(
          `/api/households/${householdId}/purchase-sessions/manual`,
        )
        if (attemptRef.current !== attempt) {
          // Cancelled while the order was being created: don't leave an empty
          // draft behind.
          void apiClient
            .delete(`/api/households/${householdId}/purchase-sessions/${session.id}`)
            .catch(() => {})
          return
        }
        setInitialSession(session)
        setSessionId(session.id)
        setOpening(false)
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev)
          next.set(PARAM, session.id)
          return next
        })
      })
      .catch((err) => {
        if (attemptRef.current !== attempt) return
        setOpening(false)
        setError(err instanceof ApiError ? err.message : 'Something went wrong')
      })
  }

  const cancelOpening = () => {
    attemptRef.current += 1
    setOpening(false)
    setSearchParams((prev) => withoutParam(prev), { replace: true })
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
    const attempt = ++attemptRef.current
    let cancelled = false
    setOpening(true)

    Promise.all([
      fetchResource<Member[]>(`/api/households/${householdId}/members`),
      fetchResource<StorageLocation[]>(`/api/households/${householdId}/storage-locations`),
      apiClient.get<PurchaseSessionWithItems>(
        `/api/households/${householdId}/purchase-sessions/${existing}`,
      ),
    ])
      .then(([ms, locs, session]) => {
        if (cancelled || attemptRef.current !== attempt) return
        // Already finalized (a stale link) -- nothing left to resume, and
        // the id shouldn't linger in the URL for next time.
        if (session.status === 'FINALIZED') {
          setSearchParams((prev) => withoutParam(prev), { replace: true })
          return
        }
        setMembers(ms.filter((m) => m.is_active))
        setStorageLocations(locs)
        setInitialSession(session)
        setSessionId(session.id)
      })
      .catch(() => {
        // Bad/stale session id -- drop it quietly rather than surfacing an
        // error for a link nobody actually clicked on purpose.
        if (!cancelled && attemptRef.current === attempt) {
          setSearchParams((prev) => withoutParam(prev), { replace: true })
        }
      })
      .finally(() => {
        if (!cancelled && attemptRef.current === attempt) setOpening(false)
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
    setInitialSession(undefined)
    setSearchParams((prev) => withoutParam(prev), { replace: true })
    onChanged?.()
  }

  const modal =
    sessionId && householdId ? (
      <PurchaseWizardModal
        householdId={householdId}
        sessionId={sessionId}
        initialSession={initialSession}
        members={members}
        storageLocations={storageLocations}
        onClose={close}
        onFinalized={close}
        onCancelled={close}
      />
    ) : opening ? (
      <AddItemOpeningSheet onCancel={cancelOpening} />
    ) : null

  return { open, modal, error, dismissError: () => setError(null) }
}
