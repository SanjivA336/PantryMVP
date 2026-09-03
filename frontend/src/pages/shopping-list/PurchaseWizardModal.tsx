import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Plus, Trash2, X } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { CategoryDot } from '../../components/CategoryDot'
import { FoodSearchInput } from '../../components/FoodSearchInput'
import { UNITS_BY_DIMENSION, UNIT_LABELS, guessDimension } from '../../lib/units'
import type {
  FoodDefinition,
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
}

interface Draft {
  food: (Pick<FoodDefinition, 'id' | 'name'> & Partial<Pick<FoodDefinition, 'category'>>) | null
  storageLocationId: string
  quantity: string
  unit: Unit | ''
  cost: string
  buyerId: string
  allowedMemberIds: string[]
}

const inputClass =
  'w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary'

function draftFromItem(
  item: PurchaseSessionItem,
  activeMemberIds: string[],
  stickyBuyer: string,
): Draft {
  return {
    food: item.global_food_definition_id
      ? {
          id: item.global_food_definition_id,
          name: item.food_name ?? '',
          category: item.category ?? undefined,
        }
      : null,
    storageLocationId: item.storage_location_id ?? '',
    quantity: item.quantity ?? '',
    unit: item.preferred_unit ?? '',
    cost: item.cost ?? '',
    buyerId: item.buyer_member_id ?? stickyBuyer,
    allowedMemberIds:
      item.allowed_member_ids.length > 0 ? item.allowed_member_ids : activeMemberIds,
  }
}

export function PurchaseWizardModal({
  householdId,
  sessionId,
  members,
  storageLocations,
  onClose,
  onFinalized,
}: Props) {
  const activeMembers = useMemo(() => members.filter((m) => m.is_active), [members])
  const activeMemberIds = useMemo(() => activeMembers.map((m) => m.id), [activeMembers])

  const [session, setSession] = useState<PurchaseSessionWithItems | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [stickyBuyer, setStickyBuyer] = useState<string>(activeMemberIds[0] ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const base = `/api/households/${householdId}/purchase-sessions/${sessionId}`

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

  // Load the selected line's saved values into the working draft.
  useEffect(() => {
    if (!session || !selectedId) {
      setDraft(null)
      return
    }
    const item = session.items.find((i) => i.id === selectedId)
    if (item) setDraft(draftFromItem(item, activeMemberIds, stickyBuyer))
  }, [session, selectedId, activeMemberIds, stickyBuyer])

  const selectedItem = session?.items.find((i) => i.id === selectedId) ?? null
  const allComplete =
    !!session && session.items.length > 0 && session.items.every((i) => i.status !== 'PENDING')

  const patchSelected = async (body: Record<string, unknown>) => {
    if (!selectedId) return
    await apiClient.patch(`${base}/items/${selectedId}`, body)
  }

  const markComplete = async () => {
    if (!draft || !selectedId) return
    if (!draft.food) return setError('Pick a food for this item.')
    if (!draft.storageLocationId) return setError('Pick a storage location.')
    if (!draft.unit) return setError('Pick a unit.')
    if (!(Number(draft.quantity) > 0)) return setError('Quantity must be greater than zero.')
    if (draft.allowedMemberIds.length === 0) return setError('Pick at least one person.')

    setBusy(true)
    setError(null)
    try {
      await patchSelected({
        global_food_definition_id: draft.food.id,
        storage_location_id: draft.storageLocationId,
        quantity: draft.quantity,
        preferred_unit: draft.unit,
        cost: draft.cost || '0',
        allowed_member_ids: draft.allowedMemberIds,
        buyer_member_id: draft.buyerId || null,
        status: 'COMPLETE',
      })
      if (draft.buyerId) setStickyBuyer(draft.buyerId)
      const next = await loadSession()
      // Advance to the next still-pending line.
      const nextPending = next.items.find((i) => i.status === 'PENDING')
      if (nextPending) setSelectedId(nextPending.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const submitOrder = async () => {
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

  const unitOptions = draft?.food
    ? UNITS_BY_DIMENSION[guessDimension((draft.unit || 'count') as Unit)]
    : UNITS_BY_DIMENSION.COUNT

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-card border border-subtle bg-surface-2 shadow-raised">
        <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
          <h3 className="text-base font-semibold">Order</h3>
          <div className="flex items-center gap-1">
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
              onClick={onClose}
              aria-label="Close"
              className="rounded-control p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {!session ? (
          <p className="p-6 text-sm text-muted">{error ?? 'Loading…'}</p>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* Left: line list */}
            <div className="flex w-1/3 min-w-44 flex-col border-r border-subtle">
              <ul className="flex-1 overflow-y-auto p-2">
                {session.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.id)}
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
                        <Check size={14} strokeWidth={2.5} className="shrink-0 text-primary" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={addLine}
                disabled={busy}
                className="m-2 flex items-center justify-center gap-1.5 rounded-control border border-dashed border-subtle px-2 py-2 text-sm font-medium text-muted transition-colors hover:border-subtle-strong hover:text-text disabled:opacity-50"
              >
                <Plus size={15} strokeWidth={2} />
                Add item to order
              </button>
            </div>

            {/* Right: the line's form */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {!draft || !selectedItem ? (
                <p className="text-sm text-muted">Pick a line on the left.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-faint">
                      Line {selectedItem.position + 1} · {selectedItem.status.toLowerCase()}
                    </span>
                    <button
                      type="button"
                      onClick={removeLine}
                      disabled={busy}
                      aria-label="Remove from order"
                      title="Remove from order"
                      className="rounded-control p-1 text-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 size={15} strokeWidth={1.75} />
                    </button>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted">Food</label>
                    <FoodSearchInput
                      value={draft.food}
                      onChange={(food) =>
                        setDraft({
                          ...draft,
                          food,
                          unit: food ? draft.unit || food.preferred_unit : draft.unit,
                        })
                      }
                    />
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="mb-1.5 block text-sm font-medium text-muted">Amount</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className={inputClass}
                        value={draft.quantity}
                        onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                      />
                    </div>
                    <div className="w-24">
                      <label className="mb-1.5 block text-sm font-medium text-muted">Unit</label>
                      <select
                        className={inputClass}
                        value={draft.unit}
                        onChange={(e) => setDraft({ ...draft, unit: e.target.value as Unit })}
                      >
                        <option value="">—</option>
                        {unitOptions.map((u) => (
                          <option key={u} value={u}>
                            {UNIT_LABELS[u]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="mb-1.5 block text-sm font-medium text-muted">Cost</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className={inputClass}
                        value={draft.cost}
                        onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1.5 block text-sm font-medium text-muted">Buyer</label>
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
                    <label className="mb-1.5 block text-sm font-medium text-muted">
                      Storage location
                    </label>
                    <select
                      className={inputClass}
                      value={draft.storageLocationId}
                      onChange={(e) => setDraft({ ...draft, storageLocationId: e.target.value })}
                    >
                      <option value="">—</option>
                      {storageLocations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted">
                      Who's using this?
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {activeMembers.map((m) => {
                        const on = draft.allowedMemberIds.includes(m.id)
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                allowedMemberIds: on
                                  ? draft.allowedMemberIds.filter((x) => x !== m.id)
                                  : [...draft.allowedMemberIds, m.id],
                              })
                            }
                            className={`rounded-control border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                              on
                                ? 'border-primary bg-primary-soft text-primary'
                                : 'border-subtle bg-surface-2 text-muted hover:bg-surface-hover'
                            }`}
                          >
                            {m.nickname}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {error && <p className="text-sm text-danger">{error}</p>}

                  {selectedItem.status === 'PENDING' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={markComplete}
                      className="mt-1 self-start rounded-control bg-primary px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
                    >
                      Mark complete
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={markIncomplete}
                      className="mt-1 self-start rounded-control border border-subtle px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
                    >
                      Mark incomplete
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
