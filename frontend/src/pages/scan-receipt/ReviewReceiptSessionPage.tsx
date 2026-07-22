import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiClient, ApiError } from '../../lib/apiClient'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import { FoodSearchInput } from '../../components/FoodSearchInput'
import type {
  AccountingType,
  FoodDefinition,
  Member,
  ReceiptImportSessionWithItems,
  StorageLocation,
} from '../../types/entities'

interface ItemEdit {
  food: Pick<FoodDefinition, 'id' | 'name'> | null
  storageLocationId: string
  quantity: string
  unit: string
  cost: string
  accountingType: AccountingType
  allowedMemberIds: string[]
}

export function ReviewReceiptSessionPage() {
  const { householdId, sessionId } = useParams<{ householdId: string; sessionId: string }>()
  const navigate = useNavigate()
  const {
    data: session,
    loading,
    error: loadError,
    reload,
  } = useHouseholdResource<ReceiptImportSessionWithItems>(
    householdId && sessionId
      ? `/api/households/${householdId}/receipt-import-sessions/${sessionId}`
      : null,
  )
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [edits, setEdits] = useState<Record<string, ItemEdit>>({})
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!householdId) return
    apiClient
      .get<StorageLocation[]>(`/api/households/${householdId}/storage-locations`)
      .then(setStorageLocations)
    apiClient
      .get<Member[]>(`/api/households/${householdId}/members`)
      .then((data) => setMembers(data.filter((m) => m.is_active)))
  }, [householdId])

  useEffect(() => {
    if (!session || members.length === 0) return
    setEdits((prev) => {
      const next = { ...prev }
      for (const item of session.items) {
        if (next[item.id]) continue
        next[item.id] = {
          food: item.global_food_definition_id
            ? { id: item.global_food_definition_id, name: item.food_name ?? item.parsed_name ?? '' }
            : null,
          storageLocationId: item.storage_location_id ?? '',
          quantity: item.quantity ?? item.parsed_quantity ?? '1',
          unit: item.preferred_unit ?? item.parsed_unit ?? '',
          cost: item.cost ?? item.parsed_price ?? '0',
          accountingType: item.accounting_type ?? 'PERSONAL',
          allowedMemberIds:
            item.allowed_member_ids.length > 0 ? item.allowed_member_ids : members.map((m) => m.id),
        }
      }
      return next
    })
  }, [session, members])

  const updateEdit = (itemId: string, patch: Partial<ItemEdit>) =>
    setEdits((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }))

  const toggleMember = (itemId: string, memberId: string) => {
    const current = edits[itemId]?.allowedMemberIds ?? []
    updateEdit(itemId, {
      allowedMemberIds: current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    })
  }

  const runProcess = async () => {
    setActionError(null)
    setBusy(true)
    try {
      await apiClient.post(
        `/api/households/${householdId}/receipt-import-sessions/${sessionId}/process`,
      )
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const submitItem = async (itemId: string, status: 'CONFIRMED' | 'SKIPPED') => {
    setActionError(null)
    const edit = edits[itemId]
    if (status === 'CONFIRMED' && !edit?.food) {
      setActionError('Pick a food for this item first')
      return
    }
    // The OCR parser never extracts a unit (receipts rarely spell it out),
    // so this is empty by default -- catch it here with a clear message
    // rather than letting it through to a confusing per-item failure at
    // Finalize time, once several other items may already be confirmed.
    if (status === 'CONFIRMED' && !edit.storageLocationId) {
      setActionError('Pick a storage location for this item first')
      return
    }
    if (status === 'CONFIRMED' && !edit.unit.trim()) {
      setActionError('Enter a unit for this item first (e.g. "count", "g")')
      return
    }
    if (status === 'CONFIRMED' && !(Number(edit.quantity) > 0)) {
      setActionError('Quantity must be greater than 0')
      return
    }
    try {
      await apiClient.patch(
        `/api/households/${householdId}/receipt-import-sessions/${sessionId}/items/${itemId}`,
        status === 'CONFIRMED'
          ? {
              global_food_definition_id: edit.food!.id,
              storage_location_id: edit.storageLocationId,
              quantity: edit.quantity,
              preferred_unit: edit.unit,
              cost: edit.cost,
              accounting_type: edit.accountingType,
              allowed_member_ids: edit.allowedMemberIds,
              status,
            }
          : { status },
      )
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const finalize = async () => {
    setActionError(null)
    setBusy(true)
    try {
      await apiClient.post(
        `/api/households/${householdId}/receipt-import-sessions/${sessionId}/finalize`,
      )
      navigate(`/households/${householdId}`)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-sm">Loading…</p>
  if (loadError || !session)
    return <p className="text-sm text-red-600">{loadError ?? 'Receipt scan not found'}</p>

  if (session.status === 'PENDING' || session.status === 'PROCESSING') {
    return (
      <div className="mx-auto max-w-lg">
        <h2 className="mb-4 text-lg font-semibold">Scanning receipt…</h2>
        {actionError && <p className="mb-2 text-sm text-red-600">{actionError}</p>}
        <button
          type="button"
          onClick={runProcess}
          disabled={busy}
          className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {busy ? 'Working…' : 'Check status'}
        </button>
      </div>
    )
  }

  if (session.status === 'FAILED') {
    return (
      <div className="mx-auto max-w-lg">
        <h2 className="mb-4 text-lg font-semibold">Scan failed</h2>
        <p className="mb-4 text-sm text-red-600">{session.error_message ?? 'Unknown error'}</p>
        {actionError && <p className="mb-2 text-sm text-red-600">{actionError}</p>}
        <button
          type="button"
          onClick={runProcess}
          disabled={busy}
          className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {busy ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    )
  }

  if (session.status === 'FINALIZED') {
    return (
      <div className="mx-auto max-w-lg">
        <h2 className="mb-4 text-lg font-semibold">Receipt imported</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {session.items.map((item) => (
            <li key={item.id} className="rounded-md border border-gray-200 bg-white px-4 py-3">
              {item.status === 'IMPORTED' ? `Imported: ${item.food_name}` : 'Skipped'}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const allReviewed = session.items.every((item) => item.status !== 'NEEDS_REVIEW')

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h2 className="text-lg font-semibold">Review scanned items</h2>
      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      <ul className="flex flex-col gap-3">
        {session.items.map((item) => {
          const edit = edits[item.id]
          if (!edit) return null
          const reviewed = item.status !== 'NEEDS_REVIEW'
          return (
            <li
              key={item.id}
              className={`rounded-md border p-4 ${
                reviewed ? 'border-gray-100 bg-gray-50 opacity-60' : 'border-gray-200 bg-white'
              }`}
            >
              <p className="mb-2 text-xs text-gray-400">Scanned as: "{item.raw_line_text}"</p>
              {reviewed ? (
                <p className="text-sm font-medium">
                  {item.status === 'CONFIRMED' ? edit.food?.name : 'Skipped'}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <FoodSearchInput
                    value={edit.food}
                    onChange={(food) => updateEdit(item.id, { food })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="number"
                      step="any"
                      placeholder="Qty"
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={edit.quantity}
                      onChange={(e) => updateEdit(item.id, { quantity: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="Unit"
                      className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={edit.unit}
                      onChange={(e) => updateEdit(item.id, { unit: e.target.value })}
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Cost"
                      className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={edit.cost}
                      onChange={(e) => updateEdit(item.id, { cost: e.target.value })}
                    />
                    <select
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={edit.storageLocationId}
                      onChange={(e) => updateEdit(item.id, { storageLocationId: e.target.value })}
                    >
                      <option value="">Storage…</option>
                      {storageLocations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={edit.accountingType}
                      onChange={(e) =>
                        updateEdit(item.id, { accountingType: e.target.value as AccountingType })
                      }
                    >
                      <option value="PERSONAL">Personal</option>
                      <option value="SHARED_CONSUMABLE">Shared</option>
                      <option value="UNIT_BASED">Unit-based</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {members.map((member) => (
                      <label key={member.id} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={edit.allowedMemberIds.includes(member.id)}
                          onChange={() => toggleMember(item.id, member.id)}
                        />
                        {member.nickname}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => submitItem(item.id, 'CONFIRMED')}
                      className="rounded-md px-3 py-1 text-sm font-medium text-white"
                      style={{ backgroundColor: 'var(--color-primary)' }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => submitItem(item.id, 'SKIPPED')}
                      className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={finalize}
        disabled={!allReviewed || busy}
        className="self-start rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {busy ? 'Importing…' : 'Finalize'}
      </button>
    </div>
  )
}
