import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { CategoryDot } from '../../components/CategoryDot'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import { FOOD_CATEGORY_LABELS } from '../../lib/foodCategories'
import {
  DIMENSION_LABELS,
  UNIT_SYSTEM_LABELS,
  guessDimension,
  guessSystem,
  resolveUnit,
} from '../../lib/units'
import type {
  InventoryItem,
  Member,
  PurchaseCorrection,
  StorageLocation,
  UnitSystem,
} from '../../types/entities'

const inputClass =
  'w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary'

const fieldLabelClass = 'mb-1.5 block text-sm font-medium text-muted'

export function InventoryItemDetailPage() {
  const { householdId, itemId } = useParams<{ householdId: string; itemId: string }>()
  const navigate = useNavigate()
  const {
    data: item,
    loading,
    error,
    reload,
  } = useHouseholdResource<InventoryItem>(
    householdId && itemId ? `/api/households/${householdId}/inventory-items/${itemId}` : null,
  )

  const [members, setMembers] = useState<Member[]>([])
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([])
  const [corrections, setCorrections] = useState<PurchaseCorrection[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!householdId) return
    apiClient.get<Member[]>(`/api/households/${householdId}/members`).then(setMembers)
    apiClient
      .get<StorageLocation[]>(`/api/households/${householdId}/storage-locations`)
      .then(setStorageLocations)
  }, [householdId])

  useEffect(() => {
    if (!householdId || !itemId) return
    apiClient
      .get<PurchaseCorrection[]>(
        `/api/households/${householdId}/inventory-items/${itemId}/corrections`,
      )
      .then(setCorrections)
      .catch(() => setCorrections([]))
  }, [householdId, itemId, item?.debt_frozen_at])

  const patch = async (body: Record<string, unknown>) => {
    setActionError(null)
    setSaving(true)
    try {
      await apiClient.patch(`/api/households/${householdId}/inventory-items/${itemId}`, body)
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>
  if (error || !item) return <p className="text-sm text-danger">{error ?? 'Item not found'}</p>

  const isFrozen = item.debt_frozen_at !== null
  const dimension = guessDimension(item.preferred_unit)
  const currentSystem = guessSystem(item.preferred_unit)

  const chooseUnitSystem = (system: UnitSystem) => {
    if (system === currentSystem) return
    void patch({ preferred_unit: resolveUnit(dimension, system) })
  }

  const toggleMember = (memberId: string) => {
    const current = item.allowed_member_ids
    const next = current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId]
    void patch({ allowed_member_ids: next })
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          to={`/households/${householdId}`}
          className="mb-1 flex items-center gap-1 text-xs font-medium text-muted hover:text-text"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          Inventory
        </Link>
        <div className="flex items-center gap-2">
          <CategoryDot category={item.category} />
          <h2 className="text-xl font-semibold">{item.food_name}</h2>
        </div>
        <p className="mt-1 text-xs text-faint">
          {item.category && FOOD_CATEGORY_LABELS[item.category]} · {DIMENSION_LABELS[dimension]}
          {item.food_name !== item.food_type_name && <> · {item.food_type_name}</>}
        </p>
      </div>

      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      {/* Food type/dimension are never editable here -- only the metric/
          customary system within whatever dimension the food already is. */}
      {dimension !== 'COUNT' && (
        <div>
          <label className={fieldLabelClass}>Measurement system</label>
          <div className="flex gap-2">
            {(['METRIC', 'CUSTOMARY'] as UnitSystem[]).map((system) => (
              <button
                key={system}
                type="button"
                disabled={saving}
                onClick={() => chooseUnitSystem(system)}
                className={`rounded-control border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  currentSystem === system
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-subtle bg-surface-2 text-muted hover:bg-surface-hover'
                }`}
              >
                {UNIT_SYSTEM_LABELS[system]}
              </button>
            ))}
          </div>
        </div>
      )}

      <CostAndQuantitySection
        item={item}
        householdId={householdId!}
        itemId={itemId!}
        onChanged={reload}
      />

      <div>
        <label className={fieldLabelClass}>Who's using this?</label>
        <div className="flex flex-wrap gap-2 rounded-control border border-transparent p-2">
          {members.map((member) => {
            const selected = item.allowed_member_ids.includes(member.id)
            return (
              <button
                key={member.id}
                type="button"
                disabled={isFrozen || saving}
                onClick={() => toggleMember(member.id)}
                className={`flex items-center gap-1.5 rounded-control border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-subtle bg-surface-2 text-muted hover:bg-surface-hover'
                }`}
              >
                {selected && <Check size={14} strokeWidth={2.5} />}
                {member.nickname}
              </button>
            )
          })}
        </div>
        {isFrozen && (
          <p className="mt-1.5 text-xs text-faint">
            This item's cost has already been settled, so who it's split between is locked in.
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={fieldLabelClass}>Expiry date</label>
          <input
            type="date"
            className={inputClass}
            defaultValue={item.expiry_date ?? ''}
            onBlur={(e) => {
              const value = e.target.value || null
              if (value !== item.expiry_date) void patch({ expiry_date: value })
            }}
          />
        </div>
        <div className="flex-1">
          <label className={fieldLabelClass}>Best-by date</label>
          <input
            type="date"
            className={inputClass}
            defaultValue={item.best_by_date ?? ''}
            onBlur={(e) => {
              const value = e.target.value || null
              if (value !== item.best_by_date) void patch({ best_by_date: value })
            }}
          />
        </div>
      </div>

      <div>
        <label className={fieldLabelClass}>Storage location</label>
        <select
          className={inputClass}
          value={item.storage_location_id}
          onChange={(e) => void patch({ storage_location_id: e.target.value })}
        >
          {storageLocations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={fieldLabelClass}>Nickname</label>
        <input
          type="text"
          className={inputClass}
          placeholder={item.food_type_name}
          defaultValue={item.name_override ?? ''}
          onBlur={(e) => {
            const value = e.target.value.trim() || null
            if (value !== item.name_override) void patch({ name_override: value })
          }}
        />
      </div>

      {corrections.length > 0 && (
        <div>
          <label className={fieldLabelClass}>Correction history</label>
          <ul className="flex flex-col gap-2">
            {corrections.map((c) => (
              <li
                key={c.id}
                className="rounded-control border border-subtle bg-surface-2 px-3 py-2 text-xs text-muted"
              >
                {c.new_cost !== null && (
                  <p>
                    Cost: {c.previous_cost} → {c.new_cost}
                  </p>
                )}
                {c.new_total_quantity !== null && (
                  <p>
                    Amount: {c.previous_total_quantity} → {c.new_total_quantity}
                  </p>
                )}
                {c.note && <p className="italic">"{c.note}"</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate(`/households/${householdId}`)}
        className="self-start text-sm text-muted hover:text-text hover:underline"
      >
        Done
      </button>
    </div>
  )
}

function CostAndQuantitySection({
  item,
  householdId,
  itemId,
  onChanged,
}: {
  item: InventoryItem
  householdId: string
  itemId: string
  onChanged: () => void
}) {
  const isFrozen = item.debt_frozen_at !== null
  const [correcting, setCorrecting] = useState(false)
  const [newCost, setNewCost] = useState(item.cost)
  const [newQuantity, setNewQuantity] = useState(item.total_quantity)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const saveDirectEdit = async (field: 'cost' | 'total_quantity', value: string) => {
    setError(null)
    try {
      await apiClient.patch(`/api/households/${householdId}/inventory-items/${itemId}`, {
        [field]: value,
      })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const submitCorrection = async () => {
    setError(null)
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { note: note.trim() || null }
      if (newCost !== item.cost) body.new_cost = newCost
      if (newQuantity !== item.total_quantity) body.new_total_quantity = newQuantity
      await apiClient.post(
        `/api/households/${householdId}/inventory-items/${itemId}/corrections`,
        body,
      )
      setCorrecting(false)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isFrozen) {
    return (
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={fieldLabelClass}>Cost</label>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            defaultValue={item.cost}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== item.cost) {
                void saveDirectEdit('cost', e.target.value)
              }
            }}
          />
        </div>
        <div className="flex-1">
          <label className={fieldLabelClass}>Amount ({item.preferred_unit})</label>
          <input
            type="number"
            step="any"
            className={inputClass}
            defaultValue={item.total_quantity}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== item.total_quantity) {
                void saveDirectEdit('total_quantity', e.target.value)
              }
            }}
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    )
  }

  return (
    <div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={fieldLabelClass}>Cost</label>
          <p className="text-text">${item.cost}</p>
        </div>
        <div className="flex-1">
          <label className={fieldLabelClass}>Amount</label>
          <p className="text-text">
            {item.total_quantity} {item.preferred_unit}
          </p>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-faint">
        Already settled -- use a correction to fix a mistake rather than editing directly.
      </p>

      {!correcting ? (
        <button
          type="button"
          onClick={() => setCorrecting(true)}
          className="mt-2 text-sm font-medium text-primary hover:underline"
        >
          Report a mistake
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-2 rounded-card border border-subtle bg-surface p-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className={fieldLabelClass}>Actual cost</label>
              <input
                type="number"
                step="0.01"
                className={inputClass}
                value={newCost}
                onChange={(e) => setNewCost(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className={fieldLabelClass}>Actual amount</label>
              <input
                type="number"
                step="any"
                className={inputClass}
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
              />
            </div>
          </div>
          <textarea
            rows={2}
            placeholder="Note (optional) -- e.g. typo'd the receipt"
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={submitCorrection}
              className="rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save correction'}
            </button>
            <button
              type="button"
              onClick={() => setCorrecting(false)}
              className="rounded-control px-2 py-2 text-sm font-medium text-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
