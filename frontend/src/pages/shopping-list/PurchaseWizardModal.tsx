import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Check, Plus, Trash2, X } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { CategoryDot } from '../../components/CategoryDot'
import { FieldTooltip } from '../../components/FieldTooltip'
import { Modal } from '../../components/Modal'
import { TypeSearchField, type TypeSearchFieldHandle } from '../../components/TypeSearchField'
import { UnitSelect } from '../../components/UnitSelect'
import { useAuth } from '../../hooks/useAuth'
import { FOOD_CATEGORY_LABELS } from '../../lib/foodCategories'
import type {
  FoodDefinition,
  InventoryItem,
  MeasurementPreference,
  Member,
  PurchaseSessionItem,
  PurchaseSessionWithItems,
  StorageLocation,
  Unit,
} from '../../types/entities'

interface Props {
  householdId: string
  sessionId: string
  members: Member[]
  storageLocations: StorageLocation[]
  onClose: () => void
  onFinalized: () => void
  onCancelled: () => void
}

// A full FoodDefinition once picked fresh from TypeSearchField, but only
// id/name/category once reconstructed from a saved session line (that's all
// a PurchaseSessionItem itself caches) -- the extra fields are only ever
// read at the moment a food is freshly picked, never on reload, so their
// absence there is never actually a problem (see the "customized" gating
// on each autofill effect below).
type FoodOption = Pick<FoodDefinition, 'id' | 'name'> & Partial<Omit<FoodDefinition, 'id' | 'name'>>

interface Draft {
  food: FoodOption | null
  nickname: string
  storageLocationId: string
  quantity: string
  unit: Unit | ''
  cost: string
  buyerId: string
  allowedMemberIds: string[]
  expiryDate: string
  bestByDate: string
}

type AutofillField = 'nickname' | 'expiry_date' | 'allowed_member_ids' | 'cost'

const inputClass =
  'w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary'
const fieldLabelClass = 'mb-1.5 block text-sm font-medium text-muted'

// Same field, but with a swappable border color -- used for fields that can
// show the "autofilled and not yet edited" indicator (a thin burrow-green
// border, cleared the instant the user edits the field, even back to the
// same value it already had).
const fieldClass = (autofilled: boolean) =>
  `w-full rounded-control border ${autofilled ? 'border-primary' : 'border-subtle'} bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary`

function todayPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function draftFromItem(
  item: PurchaseSessionItem,
  activeMemberIds: string[],
  stickyBuyer: string,
  stickyStorageLocationId: string,
): Draft {
  return {
    food: item.global_food_definition_id
      ? {
          id: item.global_food_definition_id,
          name: item.food_name ?? '',
          category: item.category ?? undefined,
        }
      : null,
    nickname: item.name_override ?? '',
    storageLocationId: item.storage_location_id ?? stickyStorageLocationId,
    quantity: item.quantity ?? '',
    unit: item.preferred_unit ?? '',
    cost: item.cost ?? '',
    buyerId: item.buyer_member_id ?? stickyBuyer,
    allowedMemberIds:
      item.allowed_member_ids.length > 0 ? item.allowed_member_ids : activeMemberIds,
    expiryDate: item.expiry_date ?? '',
    bestByDate: item.best_by_date ?? '',
  }
}

// A field that already has a real value when a line loads is treated as if
// the user set it themselves -- we can't tell "typed by hand" apart from
// "autofilled once and never touched" once it's persisted, and assuming the
// former is the safer default (never silently overwrite data that's
// already there). An empty field stays open to autofill, same as on a
// brand new blank line.
function initialCustomized(item: PurchaseSessionItem): Record<AutofillField, boolean> {
  return {
    nickname: !!item.name_override,
    expiry_date: !!item.expiry_date,
    allowed_member_ids: item.allowed_member_ids.length > 0,
    cost: !!item.cost && Number(item.cost) > 0,
  }
}

// The bar for "this line's real fields are all there" -- shared by manual
// entry's continuously-derived status and its submit-time validation.
// Optional fields (nickname, cost, both dates) never factor in.
function requiredFieldsFilled(draft: Draft): boolean {
  return (
    !!draft.food &&
    !!draft.storageLocationId &&
    !!draft.unit &&
    Number(draft.quantity) > 0 &&
    draft.allowedMemberIds.length > 0
  )
}

// Builds a PATCH body straight off whatever the draft currently holds, for
// manual entry's continuous autosave. Unlike saveCurrentLine (which blocks
// and reports the first missing required field), this only ever includes a
// field once it actually parses -- a line that's still mid-typing (a food
// picked but no quantity yet) saves the part that's real without tripping
// the backend's own validation (quantity/cost must parse as numbers when
// sent at all). status is whatever the current fields add up to via
// requiredFieldsFilled -- there's no separate "mark complete" click in this
// mode, the fields themselves decide.
function buildManualPatchBody(draft: Draft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    status: requiredFieldsFilled(draft) ? 'COMPLETE' : 'PENDING',
  }
  if (draft.food) {
    body.global_food_definition_id = draft.food.id
    body.name_override =
      draft.nickname.trim() && draft.nickname !== draft.food.name ? draft.nickname.trim() : null
  }
  if (draft.storageLocationId) body.storage_location_id = draft.storageLocationId
  const qty = Number(draft.quantity)
  if (draft.quantity !== '' && !Number.isNaN(qty) && qty > 0) body.quantity = draft.quantity
  if (draft.unit) body.preferred_unit = draft.unit
  const cost = Number(draft.cost)
  if (draft.cost === '' || (!Number.isNaN(cost) && cost >= 0)) body.cost = draft.cost || '0'
  if (draft.allowedMemberIds.length > 0) {
    body.allowed_member_ids = draft.allowedMemberIds
    body.accounting_type = draft.allowedMemberIds.length <= 1 ? 'PERSONAL' : 'SHARED'
  }
  if (draft.buyerId) body.buyer_member_id = draft.buyerId
  if (draft.expiryDate) body.expiry_date = draft.expiryDate
  if (draft.bestByDate) body.best_by_date = draft.bestByDate
  return body
}

export function PurchaseWizardModal({
  householdId,
  sessionId,
  members,
  storageLocations,
  onClose,
  onFinalized,
  onCancelled,
}: Props) {
  const { user } = useAuth()
  const activeMembers = useMemo(() => members.filter((m) => m.is_active), [members])
  const activeMemberIds = useMemo(() => activeMembers.map((m) => m.id), [activeMembers])
  const sortedActiveMembers = useMemo(
    () => [...activeMembers].sort((a, b) => a.nickname.localeCompare(b.nickname)),
    [activeMembers],
  )
  const myMemberId = useMemo(
    () => activeMembers.find((m) => m.user_id === user?.id)?.id,
    [activeMembers, user?.id],
  )

  const [session, setSession] = useState<PurchaseSessionWithItems | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [customized, setCustomized] = useState<Record<AutofillField, boolean>>({
    nickname: false,
    expiry_date: false,
    allowed_member_ids: false,
    cost: false,
  })
  const markCustomized = (field: AutofillField) =>
    setCustomized((prev) => (prev[field] ? prev : { ...prev, [field]: true }))
  // Both carry over to the next *new* blank line only -- a shelf-by-shelf
  // pass through one storage location, bought by the same person, without
  // re-picking either for every single item.
  const [stickyBuyer, setStickyBuyer] = useState<string>(myMemberId ?? activeMemberIds[0] ?? '')
  const [stickyStorageLocationId, setStickyStorageLocationId] = useState('')
  const [activeItems, setActiveItems] = useState<InventoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Shared by both presentations of the line list -- an inline collapsible
  // panel on desktop, a floating overlay on mobile (see the render below).
  // Defaults closed on both: Next/Previous at the bottom covers normal
  // sequential review, so the list is an occasional "jump to a specific
  // line" action rather than something that needs to be in the way by
  // default, especially on mobile where it can't sit beside the form at all.
  const [linesOpen, setLinesOpen] = useState(false)
  // Closing (the X, or the backdrop) always asks what to do with the
  // session rather than silently either keeping or discarding it -- see the
  // confirm modal below for the exact wording/options, which depend on
  // whether every line is already complete.
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const foodFieldRef = useRef<TypeSearchFieldHandle>(null)
  // Manual entry's autosave PATCHes fire straight from the currently open
  // draft (see syncManualLine below); when one lands, it updates `session`
  // itself so the LineList checkmarks and the header Submit button's
  // allComplete gate stay live. That would otherwise re-trigger the
  // draft-rebuild effect below and stomp the very edits the user is mid-way
  // through typing with the (identical, but now "fresh from the server")
  // values -- this flag tells that effect to skip exactly one such rebuild.
  const skipDraftResetRef = useRef(false)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const base = `/api/households/${householdId}/purchase-sessions/${sessionId}`

  // Fetched once for the "currently stored in" hint below the storage
  // picker -- no endpoint answers "which locations is food X in" directly,
  // so this is looked up client-side against the same active-item list
  // Inventory itself shows.
  useEffect(() => {
    apiClient
      .get<InventoryItem[]>(`/api/households/${householdId}/inventory-items?status=ACTIVE`)
      .then(setActiveItems)
      .catch(() => setActiveItems([]))
  }, [householdId])

  const loadSession = useCallback(
    async (keepSelection = true) => {
      const next = await apiClient.get<PurchaseSessionWithItems>(base)
      setSession(next)
      setSelectedId((prev) => {
        if (keepSelection && prev && next.items.some((i) => i.id === prev)) return prev
        const firstPending = next.items.find((i) => i.status === 'PENDING')
        return (firstPending ?? next.items[0])?.id ?? null
      })
      return next
    },
    [base],
  )

  useEffect(() => {
    loadSession(false).catch((err) =>
      setError(err instanceof ApiError ? err.message : 'Failed to load order'),
    )
  }, [loadSession])

  // Load the selected line's saved values into the working draft, resetting
  // the per-field "customized" tracking to match (see initialCustomized).
  useEffect(() => {
    if (!session || !selectedId) {
      setDraft(null)
      return
    }
    if (skipDraftResetRef.current) {
      skipDraftResetRef.current = false
      return
    }
    const item = session.items.find((i) => i.id === selectedId)
    if (item) {
      setDraft(draftFromItem(item, activeMemberIds, stickyBuyer, stickyStorageLocationId))
      setCustomized(initialCustomized(item))
    }
  }, [session, selectedId, activeMemberIds, stickyBuyer, stickyStorageLocationId])

  const selectedItem = session?.items.find((i) => i.id === selectedId) ?? null
  const selectedIndex = session?.items.findIndex((i) => i.id === selectedId) ?? -1
  const allComplete =
    !!session && session.items.length > 0 && session.items.every((i) => i.status !== 'PENDING')
  // Manual entry (the merged-in Add Item flow) autosaves continuously and
  // never gates anything on an explicit "mark complete" click -- see
  // syncManualLine. Auto-filled entry (shopping list today, receipt scan
  // later) keeps the original explicit-click-to-save gate, since the whole
  // point of that gate is making sure a person actually looked at what
  // autofill produced before it counts as reviewed.
  const isManual = session?.source === 'MANUAL'
  // Once a line's complete in auto-filled mode, its fields lock -- editing
  // requires clicking Incomplete first, which both unlocks and (per the
  // reload-from-server-truth effect above) reverts any stray edits back to
  // whatever was last actually saved. Without this, the fields and the
  // status could silently disagree: you could keep typing after Complete
  // and Submit would still fire using the old saved values, not what's on
  // screen.
  const locked = !isManual && selectedItem?.status === 'COMPLETE'

  const storedInLocations = useMemo(() => {
    if (!draft?.food) return []
    const foodName = draft.food.name
    const names = new Set(
      activeItems.filter((i) => i.food_type_name === foodName).map((i) => i.storage_location_name),
    )
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [draft?.food, activeItems])

  // Nickname follows the food's own name until the user types something
  // else on this line (see the field's own onChange, the other half of
  // this rule) -- picking a *different* food while it's still untouched
  // just refreshes it, same as never having been filled in at all.
  useEffect(() => {
    if (!draft?.food || customized.nickname) return
    const name = draft.food.name
    setDraft((prev) => (prev ? { ...prev, nickname: name } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.food?.id])

  // Same idea for expiry date, off the food's own shelf life. There's no
  // separate "best by" duration on a food definition, so that field stays
  // manual-entry-only regardless.
  useEffect(() => {
    if (!draft?.food || customized.expiry_date) return
    const value = draft.food.shelf_life_days ? todayPlusDays(draft.food.shelf_life_days) : ''
    setDraft((prev) => (prev ? { ...prev, expiryDate: value } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.food?.id])

  // The unit isn't gated on "customized" at all -- unlike the other fields,
  // there's no sense in which a unit choice for one food should survive a
  // switch to a different food (3 "cup" of flour and 3 "cup" of milk aren't
  // even the same kind of amount), so this always just resets to whatever
  // this household remembers (or defaults to) for the newly picked food.
  useEffect(() => {
    if (!draft?.food || !householdId) return
    const foodId = draft.food.id
    apiClient
      .get<MeasurementPreference>(
        `/api/households/${householdId}/inventory-items/measurement-preference?global_food_definition_id=${foodId}`,
      )
      .then((preference) => {
        setDraft((prev) => (prev ? { ...prev, unit: preference.unit } : prev))
      })
      .catch(() => {
        // Best-effort -- worst case the unit picker stays on its default
        // and the user picks manually.
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.food?.id, householdId])

  // Who's using this defaults off the food's own accounting_type_default
  // (typically-personal foods start with just you picked, typically-shared
  // ones start with everyone) until the user touches the roster themselves.
  useEffect(() => {
    if (!draft?.food || customized.allowed_member_ids) return
    const ids =
      draft.food.accounting_type_default === 'PERSONAL'
        ? myMemberId
          ? [myMemberId]
          : []
        : activeMemberIds
    setDraft((prev) => (prev ? { ...prev, allowedMemberIds: ids } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.food?.id, activeMemberIds, myMemberId])

  // "Same as last time": once both a food and a quantity are set, look up
  // the most recent past purchase of that exact food + quantity in this
  // household and offer its cost -- groceries you rebuy tend to cost
  // roughly the same each trip. Never overrides a cost the user has typed
  // themselves; a value that's still just sitting there from an earlier
  // autofill is fair game to replace, same as the clear button's "make it
  // eligible for a fresh suggestion" behavior.
  const costLookupRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!draft?.food || !householdId) return
    const qty = Number(draft.quantity)
    if (!draft.quantity || Number.isNaN(qty) || qty <= 0 || !draft.unit) return
    const foodId = draft.food.id
    const unit = draft.unit
    clearTimeout(costLookupRef.current)
    costLookupRef.current = setTimeout(async () => {
      try {
        const lastCost = await apiClient.get<string | null>(
          `/api/households/${householdId}/inventory-items/last-cost?global_food_definition_id=${foodId}&quantity=${qty}&unit=${unit}`,
        )
        if (lastCost !== null && !customized.cost) {
          setDraft((prev) => (prev ? { ...prev, cost: lastCost } : prev))
        }
      } catch {
        // Best-effort convenience autofill -- a failed lookup just means no
        // suggestion, not something worth showing an error for.
      }
    }, 400)
    return () => clearTimeout(costLookupRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.food?.id, draft?.quantity, draft?.unit, householdId, customized.cost])

  const patchSelected = async (body: Record<string, unknown>) => {
    if (!selectedId) return
    await apiClient.patch(`${base}/items/${selectedId}`, body)
  }

  // Validates and saves the currently open line as COMPLETE -- shared by
  // every action that needs "make sure this line's own data is locked in"
  // as a first step (the plain Complete button, but also Add another item
  // and the solo Submit button, both of which save the line they're
  // sitting on before doing anything else). Doesn't touch selection or
  // navigate anywhere on its own; callers decide what happens next.
  const saveCurrentLine = async (): Promise<boolean> => {
    if (!draft || !selectedId) return false
    if (!draft.food) {
      setError('Pick a food for this item.')
      return false
    }
    if (!draft.storageLocationId) {
      setError('Pick a storage location.')
      return false
    }
    if (!draft.unit) {
      setError('Pick a unit.')
      return false
    }
    if (!(Number(draft.quantity) > 0)) {
      setError('Quantity must be greater than zero.')
      return false
    }
    if (draft.allowedMemberIds.length === 0) {
      setError('Pick at least one person.')
      return false
    }

    setBusy(true)
    setError(null)
    try {
      await patchSelected({
        global_food_definition_id: draft.food.id,
        name_override:
          draft.nickname.trim() && draft.nickname !== draft.food.name
            ? draft.nickname.trim()
            : null,
        storage_location_id: draft.storageLocationId,
        quantity: draft.quantity,
        preferred_unit: draft.unit,
        cost: draft.cost || '0',
        allowed_member_ids: draft.allowedMemberIds,
        // Just PERSONAL vs SHARED, fully derived from the final roster
        // size -- there's no split-method choice to make (see
        // services/accounting.py's compute_item_shares for the one rule).
        accounting_type: draft.allowedMemberIds.length <= 1 ? 'PERSONAL' : 'SHARED',
        buyer_member_id: draft.buyerId || null,
        expiry_date: draft.expiryDate || null,
        best_by_date: draft.bestByDate || null,
        status: 'COMPLETE',
      })
      if (draft.buyerId) setStickyBuyer(draft.buyerId)
      setStickyStorageLocationId(draft.storageLocationId)
      return true
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
      return false
    } finally {
      setBusy(false)
    }
  }

  // Manual entry's save -- no validation, no error messages, just "persist
  // whatever's real right now" (see buildManualPatchBody). Applies the same
  // result to `session` locally instead of re-fetching it, both so this
  // never races a fast follow-up edit clobbering itself with a stale
  // response, and so it doesn't cost a round trip on every debounce tick.
  const syncManualLine = useCallback(async (): Promise<boolean> => {
    if (!isManual || !draft?.food || !selectedId) return true
    const body = buildManualPatchBody(draft)
    try {
      await apiClient.patch(`${base}/items/${selectedId}`, body)
      if (draft.buyerId) setStickyBuyer(draft.buyerId)
      if (draft.storageLocationId) setStickyStorageLocationId(draft.storageLocationId)
      skipDraftResetRef.current = true
      setSession((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((it) =>
                it.id === selectedId
                  ? {
                      ...it,
                      status: body.status as PurchaseSessionItem['status'],
                      global_food_definition_id: draft.food!.id,
                      food_name: draft.food!.name,
                      category: draft.food!.category ?? it.category,
                      cost: (body.cost as string | undefined) ?? it.cost,
                    }
                  : it,
              ),
            }
          : prev,
      )
      return true
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
      return false
    }
  }, [isManual, draft, selectedId, base])

  // Debounced continuous autosave -- fires ~600ms after the draft settles.
  // Explicit moments that need the very latest edits saved *right now*
  // (leaving the line, closing, submitting) flush this immediately instead
  // of waiting -- see flushManual below.
  useEffect(() => {
    if (!isManual) return
    clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      void syncManualLine()
    }, 600)
    return () => clearTimeout(autosaveTimerRef.current)
  }, [draft, isManual, syncManualLine])

  const flushManual = async (): Promise<boolean> => {
    if (!isManual) return true
    clearTimeout(autosaveTimerRef.current)
    return syncManualLine()
  }

  const markComplete = async () => {
    if (!(await saveCurrentLine())) return
    const next = await loadSession()
    // Advance to the next still-pending line.
    const nextPending = next.items.find((i) => i.status === 'PENDING')
    if (nextPending) setSelectedId(nextPending.id)
  }

  const markIncomplete = async () => {
    setBusy(true)
    setError(null)
    try {
      await patchSelected({ status: 'PENDING' })
      await loadSession()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const removeLine = async () => {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    try {
      await apiClient.delete(`${base}/items/${selectedId}`)
      await loadSession(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const addLine = async () => {
    setBusy(true)
    setError(null)
    try {
      const item = await apiClient.post<PurchaseSessionItem>(`${base}/items`)
      await loadSession()
      setSelectedId(item.id)
      setLinesOpen(false)
      foodFieldRef.current?.focus()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const submitOrder = async () => {
    if (isManual) {
      if (!(await flushManual())) return
      if (draft && !requiredFieldsFilled(draft)) {
        setError('Fill in the required fields for this item before submitting.')
        return
      }
    }
    setBusy(true)
    setError(null)
    try {
      await apiClient.post(`${base}/finalize`)
      onFinalized()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  // Saves the open line first if it's still pending, then does the rest --
  // shared by the multi-line "Add another item" button and the solo one
  // (see the render below), so both behave identically: whichever line
  // you're sitting on gets locked in before a new blank one appears. Manual
  // entry never blocks on this -- there's no "mark complete" to withhold,
  // so a flush (saving whatever's there, complete or not) is all it needs;
  // you're meant to be able to add several items up front and finish each
  // one later.
  const addAnotherItem = async () => {
    if (isManual) {
      if (!(await flushManual())) return
    } else if (selectedItem?.status === 'PENDING' && !(await saveCurrentLine())) {
      return
    }
    await addLine()
  }

  // The solo case's one-click "Submit" -- saves the open line (if it isn't
  // already) and immediately finalizes, collapsing what would otherwise be
  // a "mark complete, then separately submit the order" two-step into the
  // single action the old standalone Add Item page's own submit button was.
  // Manual entry's own validation lives in submitOrder itself (see above).
  const submitSolo = async () => {
    if (!isManual && selectedItem?.status === 'PENDING' && !(await saveCurrentLine())) return
    await submitOrder()
  }

  // Discards the whole order -- distinct from onClose (just dismiss the
  // modal, leave the draft to resume later): any line that came off the
  // shopping list gets restored there by the same backend delete this hits
  // (see purchase_sessions.delete_session), so cancelling isn't the same as
  // losing the intent to buy those things, just this particular pass at
  // reviewing them.
  const cancelOrder = async () => {
    setCancelling(true)
    setError(null)
    try {
      await apiClient.delete(base)
      onCancelled()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
      setCancelling(false)
    }
  }

  // Triggered by the X or the backdrop -- first sweeps out any line that
  // never got a food type (an "Add another item" the user backed out of
  // without filling in, including the one they're currently sitting on).
  // Those never carried real data, so they shouldn't force the save/
  // discard decision below on their own. Once they're gone: nothing left
  // at all means there was never a real order here, so just discard it
  // outright; anything real left means the previous pipeline applies.
  const attemptClose = async () => {
    if (!session) {
      setCloseConfirmOpen(true)
      return
    }
    if (isManual) await flushManual()
    // A line only counts as "blank" (silently discardable without asking)
    // if it truly has no food chosen yet. The currently open line is judged
    // off the live draft, not session truth -- it's the one line that can
    // hold real, not-yet-persisted data (auto-filled mode before an
    // explicit Complete; manual mode between keystrokes and the autosave
    // above landing). This is what used to go wrong: a fully-typed line
    // that was never marked complete looked identical to a truly-empty one
    // from the server's point of view, so it got swept the same way.
    const blankItems = session.items.filter((i) =>
      i.id === selectedId ? !draft?.food : !i.global_food_definition_id,
    )
    if (blankItems.length === 0) {
      setCloseConfirmOpen(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await Promise.all(blankItems.map((i) => apiClient.delete(`${base}/items/${i.id}`)))
      const next = await loadSession(false)
      setBusy(false)
      if (next.items.length === 0) {
        await cancelOrder()
      } else {
        setCloseConfirmOpen(true)
      }
    } catch (err) {
      setBusy(false)
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
      setCloseConfirmOpen(true)
    }
  }

  // Manual mode flushes the line being left before switching, so the line
  // list checkmarks and the header Submit gate don't lag behind what was
  // just typed. Auto-filled mode deliberately does *not* flush here --
  // leaving a still-pending line without completing it is exactly the
  // "revert to last saved state" case (see the reload-from-server-truth
  // effect above, which re-syncs the draft once `selectedId` changes).
  const goTo = (delta: 1 | -1) => {
    if (!session || selectedIndex < 0) return
    const next = session.items[selectedIndex + delta]
    if (!next) return
    if (isManual) {
      void flushManual().then(() => setSelectedId(next.id))
    } else {
      setSelectedId(next.id)
    }
  }

  const selectLine = (id: string) => {
    if (isManual) {
      void flushManual().then(() => setSelectedId(id))
    } else {
      setSelectedId(id)
    }
  }

  // Once there's just one line, the "which line" chrome (the header
  // toggle, Previous/Next) has nothing to actually do -- hiding it keeps a
  // solo add-item pass looking like a plain simple form, not a multi-item
  // system that just happens to have one entry in it yet.
  const multiLine = (session?.items.length ?? 0) > 1

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        disabled={busy}
        onClick={() => void attemptClose()}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-card border border-subtle bg-surface-2 shadow-raised">
        <div className="flex items-center justify-between gap-2 border-b border-subtle px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="shrink-0 text-base font-semibold">Order</h3>
            {multiLine && selectedItem && (
              <button
                type="button"
                onClick={() => setLinesOpen((v) => !v)}
                className="flex min-w-0 items-center gap-1 rounded-control border border-subtle bg-surface px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                <span className="truncate">
                  Line {selectedItem.position + 1} · {selectedItem.status.toLowerCase()}
                </span>
                {/* Mobile: this menu drops down/collapses, so a down chevron
                    that flips on open reads correctly. Desktop: it's a side
                    panel, so a left/right chevron (pointing the direction
                    it'll open/close) fits the sidebar-collapse convention
                    better than the same up/down arrow would. */}
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  className={`shrink-0 transition-transform md:hidden ${linesOpen ? 'rotate-180' : ''}`}
                />
                {linesOpen ? (
                  <ChevronLeft size={14} strokeWidth={2} className="hidden shrink-0 md:block" />
                ) : (
                  <ChevronRight size={14} strokeWidth={2} className="hidden shrink-0 md:block" />
                )}
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={!allComplete || busy}
              onClick={submitOrder}
              title={allComplete ? 'Submit order' : 'Complete every line first'}
              aria-label="Submit order"
              className="rounded-control p-1.5 text-primary transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent"
            >
              <Check size={18} strokeWidth={2.25} />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void attemptClose()}
              aria-label="Close"
              className="rounded-control p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {!session ? (
          <p className="p-6 text-sm text-muted">{error ?? 'Loading…'}</p>
        ) : (
          <div className="relative flex min-h-0 flex-1">
            {/* Desktop: an inline collapsible panel, toggled by the header
                button above -- never a floating overlay, there's room to
                just push the form over. */}
            {linesOpen && (
              <div className="hidden w-1/3 min-w-44 shrink-0 flex-col border-r border-subtle md:flex">
                <LineList
                  items={session.items}
                  selectedId={selectedId}
                  onSelect={selectLine}
                  onAdd={addLine}
                  busy={busy}
                />
              </div>
            )}

            {/* Mobile: a floating scrollable menu instead -- a side panel
                here would leave almost no room for the form itself. Tapping
                the header toggle again, or anywhere outside the menu,
                closes it. */}
            {linesOpen && (
              <div className="absolute inset-0 z-20 md:hidden">
                <button
                  type="button"
                  aria-label="Close line list"
                  onClick={() => setLinesOpen(false)}
                  className="absolute inset-0"
                />
                <div className="absolute inset-x-2 top-2 max-h-[60vh] overflow-hidden rounded-card border border-subtle bg-surface shadow-raised">
                  <LineList
                    items={session.items}
                    selectedId={selectedId}
                    onSelect={(id) => {
                      selectLine(id)
                      setLinesOpen(false)
                    }}
                    onAdd={addLine}
                    busy={busy}
                  />
                </div>
              </div>
            )}

            {/* The line's form */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {!draft || !selectedItem ? (
                <p className="text-sm text-muted">Pick a line to edit.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <fieldset
                    disabled={locked}
                    className="m-0 flex flex-col gap-3 border-0 p-0 disabled:opacity-60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <label className={fieldLabelClass}>Food type</label>
                        <TypeSearchField
                          ref={foodFieldRef}
                          value={draft.food}
                          onChange={(food) =>
                            setDraft({
                              ...draft,
                              food,
                              unit: food ? draft.unit || food.preferred_unit : draft.unit,
                            })
                          }
                        />
                        {draft.food?.category && (
                          <p className="mt-1.5 text-xs text-faint">
                            {FOOD_CATEGORY_LABELS[draft.food.category]}
                          </p>
                        )}
                      </div>
                      {multiLine && (
                        <button
                          type="button"
                          onClick={removeLine}
                          disabled={busy}
                          aria-label="Remove from order"
                          title="Remove from order"
                          className="mt-6 shrink-0 rounded-control p-1.5 text-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                        >
                          <Trash2 size={15} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>

                    <div>
                      <label className={fieldLabelClass}>Nickname (optional)</label>
                      <input
                        type="text"
                        placeholder={draft.food?.name ?? 'e.g. HEB milk'}
                        className={fieldClass(!customized.nickname && draft.nickname !== '')}
                        value={draft.nickname}
                        onChange={(e) => {
                          setDraft({ ...draft, nickname: e.target.value })
                          markCustomized('nickname')
                        }}
                      />
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className={fieldLabelClass}>
                          Quantity
                          <FieldTooltip text="This becomes both the amount you have right now and the 100% mark it's tracked against as you use it up." />
                        </label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          placeholder="Amount"
                          className={inputClass}
                          value={draft.quantity}
                          onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                        />
                      </div>
                      <div className="w-32">
                        <label className={fieldLabelClass}>Unit</label>
                        <UnitSelect
                          className={inputClass}
                          value={draft.unit}
                          placeholder="Unit…"
                          onChange={(unit) => setDraft({ ...draft, unit })}
                        />
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className={fieldLabelClass}>
                          Cost (optional)
                          <FieldTooltip text="Auto-filled from the last time you bought this exact food and quantity, if we've seen it before. Edit or clear it any time." />
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            className={fieldClass(!customized.cost && !!draft.cost)}
                            value={draft.cost}
                            onChange={(e) => {
                              setDraft({ ...draft, cost: e.target.value })
                              markCustomized('cost')
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setDraft({ ...draft, cost: '' })
                              // Un-mark rather than mark customized: the
                              // clear button's whole point is offering a
                              // fresh autofill suggestion next time the
                              // lookup fires, not declaring "hands off, I
                              // typed this."
                              setCustomized((prev) => ({ ...prev, cost: false }))
                            }}
                            title="Clear"
                            aria-label="Clear cost"
                            className="shrink-0 rounded-control p-2 text-faint transition-colors hover:bg-surface-hover hover:text-text"
                          >
                            <X size={16} strokeWidth={1.75} />
                          </button>
                        </div>
                      </div>
                      <div className="flex-1">
                        <label className={fieldLabelClass}>Buyer</label>
                        <select
                          className={inputClass}
                          value={draft.buyerId}
                          onChange={(e) => setDraft({ ...draft, buyerId: e.target.value })}
                        >
                          {activeMembers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.nickname}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className={fieldLabelClass}>Who's using this?</label>
                      <div
                        className={`grid grid-cols-3 gap-2 rounded-control border p-2 ${
                          !customized.allowed_member_ids && draft.food
                            ? 'border-primary'
                            : 'border-transparent'
                        }`}
                      >
                        {sortedActiveMembers.map((m) => {
                          const on = draft.allowedMemberIds.includes(m.id)
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                setDraft({
                                  ...draft,
                                  allowedMemberIds: on
                                    ? draft.allowedMemberIds.filter((x) => x !== m.id)
                                    : [...draft.allowedMemberIds, m.id],
                                })
                                markCustomized('allowed_member_ids')
                              }}
                              className={`flex h-10 items-center justify-center rounded-control border px-2 py-2 text-center text-sm font-medium transition-colors ${
                                on
                                  ? 'border-primary bg-primary-soft text-primary'
                                  : 'border-subtle bg-surface-2 text-muted hover:bg-surface-hover'
                              }`}
                            >
                              <span className="w-full truncate">{m.nickname}</span>
                            </button>
                          )
                        })}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setDraft({
                              ...draft,
                              allowedMemberIds: myMemberId ? [myMemberId] : [],
                            })
                            markCustomized('allowed_member_ids')
                          }}
                          className="rounded-control border border-subtle px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
                        >
                          Select me
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft({ ...draft, allowedMemberIds: activeMemberIds })
                            markCustomized('allowed_member_ids')
                          }}
                          className="rounded-control border border-subtle px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft({ ...draft, allowedMemberIds: [] })
                            markCustomized('allowed_member_ids')
                          }}
                          className="rounded-control border border-subtle px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
                        >
                          Deselect all
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className={fieldLabelClass}>Storage location</label>
                      <select
                        className={inputClass}
                        value={draft.storageLocationId}
                        onChange={(e) => setDraft({ ...draft, storageLocationId: e.target.value })}
                      >
                        <option value="">Storage…</option>
                        {storageLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                      {storedInLocations.length > 0 && (
                        <p className="mt-1.5 text-xs text-faint">
                          Currently stored in: {storedInLocations.join(', ')}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className={fieldLabelClass}>Expiry date (optional)</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="date"
                            className={fieldClass(!customized.expiry_date && !!draft.expiryDate)}
                            value={draft.expiryDate}
                            onChange={(e) => {
                              setDraft({ ...draft, expiryDate: e.target.value })
                              markCustomized('expiry_date')
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setDraft({ ...draft, expiryDate: '' })
                              markCustomized('expiry_date')
                            }}
                            title="Clear"
                            aria-label="Clear expiry date"
                            className="shrink-0 rounded-control p-2 text-faint transition-colors hover:bg-surface-hover hover:text-text"
                          >
                            <X size={16} strokeWidth={1.75} />
                          </button>
                        </div>
                      </div>
                      <div className="flex-1">
                        <label className={fieldLabelClass}>Best-by date (optional)</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="date"
                            className={inputClass}
                            value={draft.bestByDate}
                            onChange={(e) => setDraft({ ...draft, bestByDate: e.target.value })}
                          />
                          <button
                            type="button"
                            onClick={() => setDraft({ ...draft, bestByDate: '' })}
                            title="Clear"
                            aria-label="Clear best-by date"
                            className="shrink-0 rounded-control p-2 text-faint transition-colors hover:bg-surface-hover hover:text-text"
                          >
                            <X size={16} strokeWidth={1.75} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </fieldset>

                  {error && <p className="text-sm text-danger">{error}</p>}

                  {multiLine ? (
                    <div className="mt-1 flex gap-2">
                      {/* Manual entry has no complete/incomplete to toggle --
                          status is derived live off the fields themselves
                          (see requiredFieldsFilled), autosaved as you go. */}
                      {!isManual &&
                        (selectedItem.status === 'PENDING' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={markComplete}
                            className="flex-1 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
                          >
                            Complete
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={markIncomplete}
                            className="flex-1 rounded-control border border-subtle px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
                          >
                            Incomplete
                          </button>
                        ))}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void addAnotherItem()}
                        className="flex-1 rounded-control border border-primary px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft disabled:opacity-50"
                      >
                        Add another item
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        disabled={busy || (isManual && !requiredFieldsFilled(draft))}
                        onClick={() => void submitSolo()}
                        className="flex-1 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
                      >
                        Submit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void addAnotherItem()}
                        className="flex-1 rounded-control border border-primary px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft disabled:opacity-50"
                      >
                        Add another item
                      </button>
                    </div>
                  )}

                  {multiLine && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={selectedIndex <= 0}
                        onClick={() => goTo(-1)}
                        className="flex flex-1 items-center justify-center gap-1 rounded-control border border-subtle px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <ChevronLeft size={16} strokeWidth={2} />
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={selectedIndex < 0 || selectedIndex >= session.items.length - 1}
                        onClick={() => goTo(1)}
                        className="flex flex-1 items-center justify-center gap-1 rounded-control border border-subtle px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        Next
                        <ChevronRight size={16} strokeWidth={2} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {closeConfirmOpen && session && (
        <Modal title="Save this order for later?" onClose={() => setCloseConfirmOpen(false)}>
          <p className="mb-4 text-sm text-muted">
            {allComplete
              ? "Every line's ready to go -- submit it now, save it as a draft to pick back up later, or discard it."
              : 'Save it as a draft to pick back up later, or discard it.'}
            {session.source === 'SHOPPING_LIST' &&
              ' Discarding puts any lines from your shopping list back there, still checked off.'}
          </p>
          {error && <p className="mb-3 text-sm text-danger">{error}</p>}
          <div className="flex flex-col gap-2">
            {allComplete && (
              <button
                type="button"
                disabled={busy}
                onClick={submitOrder}
                className="rounded-control bg-primary px-3 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {busy ? 'Submitting…' : 'Submit now'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-control border border-subtle px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              Save for later
            </button>
            <button
              type="button"
              disabled={cancelling}
              onClick={cancelOrder}
              className="rounded-control border border-danger/40 px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
            >
              {cancelling ? 'Discarding…' : 'Discard'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function LineList({
  items,
  selectedId,
  onSelect,
  onAdd,
  busy,
}: {
  items: PurchaseSessionItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  busy: boolean
}) {
  return (
    <>
      <ul className="max-h-full flex-1 overflow-y-auto p-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              className={`flex w-full items-center gap-2 rounded-control px-2 py-2 text-left text-sm transition-colors ${
                item.id === selectedId
                  ? 'bg-primary-soft text-primary'
                  : 'text-muted hover:bg-surface-hover hover:text-text'
              }`}
            >
              <CategoryDot category={item.category} />
              <span className="min-w-0 flex-1 truncate">
                {item.food_name || item.raw_line_text || 'New item'}
              </span>
              {item.status !== 'PENDING' && (
                <Check
                  size={14}
                  strokeWidth={2.5}
                  className={`shrink-0 ${Number(item.cost) > 0 ? 'text-primary' : 'text-info'}`}
                />
              )}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onAdd}
        disabled={busy}
        className="m-2 flex w-[calc(100%-1rem)] items-center justify-center gap-1.5 rounded-control border border-dashed border-subtle px-2 py-2 text-sm font-medium text-muted transition-colors hover:border-subtle-strong hover:text-text disabled:opacity-50"
      >
        <Plus size={15} strokeWidth={2} />
        Add item to order
      </button>
    </>
  )
}
