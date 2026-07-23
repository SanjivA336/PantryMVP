import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, X } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { FieldTooltip } from '../../components/FieldTooltip'
import { TypeSearchField } from '../../components/TypeSearchField'
import { useAuth } from '../../hooks/useAuth'
import { FOOD_CATEGORY_LABELS } from '../../lib/foodCategories'
import type { FoodDefinition, InventoryItem, Member, StorageLocation } from '../../types/entities'
import {
  addInventoryItemSchema,
  type AddInventoryItemForm,
  type AddInventoryItemFormInput,
} from './schema'

const inputClass =
  'w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary'

function todayPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

export function AddInventoryItemPage() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [food, setFood] = useState<FoodDefinition | null>(null)
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [serverError, setServerError] = useState<string | null>(null)
  const [nickname, setNickname] = useState('')
  const [nicknameCustomized, setNicknameCustomized] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AddInventoryItemFormInput, unknown, AddInventoryItemForm>({
    resolver: zodResolver(addInventoryItemSchema),
    defaultValues: { allowed_member_ids: [], accounting_type: 'PERSONAL' },
  })

  useEffect(() => {
    if (!householdId) return
    apiClient
      .get<StorageLocation[]>(`/api/households/${householdId}/storage-locations`)
      .then(setStorageLocations)
    apiClient.get<Member[]>(`/api/households/${householdId}/members`).then((data) => {
      const active = data.filter((m) => m.is_active)
      setMembers(active)
      setValue(
        'allowed_member_ids',
        active.map((m) => m.id),
      )
    })
  }, [householdId, setValue])

  useEffect(() => {
    if (!food) return
    setValue('preferred_unit', food.preferred_unit)
    // The nickname tracks the type's name until the user deliberately types
    // something different -- see onNicknameChange below for the other half
    // of this rule.
    if (!nicknameCustomized) setNickname(food.name)
    // Default expiry from the type's own shelf life, but only expiry --
    // there's no separate "best by" duration on a food definition, so that
    // field stays manual-entry-only. One-time set on pick, not continuously
    // re-applied, so the user can freely edit or clear it afterward.
    if (food.shelf_life_days) {
      setValue('expiry_date', todayPlusDays(food.shelf_life_days))
    }
    // The food's own default only seeds *who's pre-selected* -- a food
    // that's typically personal starts with just you picked, one that's
    // typically shared starts with everyone. accounting_type is always
    // derived from that selection (see the effect below), never set
    // independently.
    if (food.accounting_type_default === 'PERSONAL') {
      const me = members.find((m) => m.user_id === user?.id)
      setValue('allowed_member_ids', me ? [me.id] : [])
    } else {
      setValue(
        'allowed_member_ids',
        members.map((m) => m.id),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [food])

  const onNicknameChange = (rawValue: string) => {
    setNickname(rawValue)
    setNicknameCustomized(rawValue !== '' && rawValue !== food?.name)
  }

  // "Same as last time": once both a food and a quantity are set, look up
  // the most recent past purchase of that exact food + quantity in this
  // household and offer its cost -- groceries you rebuy tend to cost
  // roughly the same each trip, and this needs no new stored data, just a
  // lookup against purchases you already have. Never overrides a cost
  // you've already typed (or one that came from a previous lookup and was
  // then cleared via the x button, which resets it to '' and makes it
  // eligible for a fresh suggestion).
  const quantityValue = watch('quantity')
  const costLookupRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!food || !householdId) return
    const qty = Number(quantityValue)
    if (!quantityValue || Number.isNaN(qty) || qty <= 0) return
    clearTimeout(costLookupRef.current)
    costLookupRef.current = setTimeout(async () => {
      try {
        const lastCost = await apiClient.get<string | null>(
          `/api/households/${householdId}/inventory-items/last-cost?global_food_definition_id=${food.id}&quantity=${qty}`,
        )
        if (lastCost !== null && !getValues('cost')) {
          setValue('cost', lastCost)
        }
      } catch {
        // Best-effort convenience autofill -- a failed lookup just means no
        // suggestion, not something worth showing an error for.
      }
    }, 400)
    return () => clearTimeout(costLookupRef.current)
  }, [food, quantityValue, householdId, getValues, setValue])

  const selectedMemberIds = watch('allowed_member_ids') ?? []
  const accountingType = watch('accounting_type')

  // Splitting only makes sense once more than one person is involved --
  // picking a single person (or just yourself) to use an item and
  // separately deciding "don't split the cost" would be the same choice
  // twice, so the split-type field only appears (and only matters) once a
  // second person is added, and collapses back to PERSONAL otherwise.
  useEffect(() => {
    if (selectedMemberIds.length <= 1 && accountingType !== 'PERSONAL') {
      setValue('accounting_type', 'PERSONAL')
    } else if (selectedMemberIds.length > 1 && accountingType === 'PERSONAL') {
      setValue('accounting_type', 'SHARED_CONSUMABLE')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMemberIds.length])

  const toggleMember = (memberId: string) => {
    const current = selectedMemberIds
    setValue(
      'allowed_member_ids',
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
    )
  }

  const selectAllMembers = () =>
    setValue(
      'allowed_member_ids',
      members.map((m) => m.id),
    )
  const deselectAllMembers = () => setValue('allowed_member_ids', [])
  const selectOnlyMe = () => {
    const me = members.find((m) => m.user_id === user?.id)
    setValue('allowed_member_ids', me ? [me.id] : [])
  }

  const onSubmit = async (values: AddInventoryItemForm) => {
    if (!food) {
      setServerError('Pick a food type first')
      return
    }
    setServerError(null)
    try {
      await apiClient.post<InventoryItem>(`/api/households/${householdId}/inventory-items`, {
        global_food_definition_id: food.id,
        storage_location_id: values.storage_location_id,
        quantity: values.quantity,
        preferred_unit: values.preferred_unit,
        cost: values.cost ?? 0,
        expiry_date: values.expiry_date || null,
        best_by_date: values.best_by_date || null,
        allowed_member_ids: values.allowed_member_ids,
        accounting_type: values.accounting_type,
        name_override: nickname.trim() && nickname !== food.name ? nickname.trim() : null,
      })
      navigate(`/households/${householdId}`)
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h2 className="mb-4 text-xl font-semibold">Add an item</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Food type</label>
          <TypeSearchField value={food} onChange={setFood} />
          {food && (
            <p className="mt-1.5 text-xs text-faint">
              {FOOD_CATEGORY_LABELS[food.category]} · {food.preferred_unit}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Nickname (optional)
          </label>
          <input
            type="text"
            placeholder={food?.name ?? 'e.g. HEB milk'}
            className={inputClass}
            value={nickname}
            onChange={(e) => onNicknameChange(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-muted">
            Quantity
            <FieldTooltip text="This becomes both the amount you have right now and the 100% mark it's tracked against as you use it up." />
          </label>
          <div className="flex">
            <input
              type="number"
              step="any"
              placeholder="Amount"
              className="w-full rounded-control rounded-r-none border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:z-10 focus:border-primary"
              {...register('quantity')}
            />
            <input
              type="text"
              readOnly
              className="w-24 shrink-0 rounded-control rounded-l-none border border-l-0 border-subtle bg-surface px-2 py-2 text-sm text-muted outline-none"
              {...register('preferred_unit')}
            />
          </div>
          {errors.quantity && (
            <p className="mt-1.5 text-sm text-danger">{errors.quantity.message}</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Storage location</label>
          <select className={inputClass} {...register('storage_location_id')}>
            <option value="">Select…</option>
            {storageLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
          {errors.storage_location_id && (
            <p className="mt-1.5 text-sm text-danger">{errors.storage_location_id.message}</p>
          )}
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-muted">
              Expiry date (optional)
            </label>
            <div className="flex items-center gap-1.5">
              <input type="date" className={inputClass} {...register('expiry_date')} />
              <button
                type="button"
                onClick={() => setValue('expiry_date', '')}
                title="Clear"
                aria-label="Clear expiry date"
                className="shrink-0 rounded-control p-2 text-faint transition-colors hover:bg-surface-hover hover:text-text"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-muted">
              Best-by date (optional)
            </label>
            <div className="flex items-center gap-1.5">
              <input type="date" className={inputClass} {...register('best_by_date')} />
              <button
                type="button"
                onClick={() => setValue('best_by_date', '')}
                title="Clear"
                aria-label="Clear best-by date"
                className="shrink-0 rounded-control p-2 text-faint transition-colors hover:bg-surface-hover hover:text-text"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Who's using this?</label>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => {
              const selected = selectedMemberIds.includes(member.id)
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleMember(member.id)}
                  className={`flex items-center gap-1.5 rounded-control border px-3 py-2 text-sm font-medium transition-colors ${
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
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={selectOnlyMe}
              className="rounded-control border border-subtle px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              Select me
            </button>
            <button
              type="button"
              onClick={selectAllMembers}
              className="rounded-control border border-subtle px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={deselectAllMembers}
              className="rounded-control border border-subtle px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              Deselect all
            </button>
          </div>
          {errors.allowed_member_ids && (
            <p className="mt-1.5 text-sm text-danger">{errors.allowed_member_ids.message}</p>
          )}
          {selectedMemberIds.length > 1 && (
            <div className="mt-3">
              <label className="mb-1.5 block text-sm font-medium text-muted">Split type</label>
              <select className={inputClass} {...register('accounting_type')}>
                <option value="SHARED_CONSUMABLE">Shared — split evenly, no usage tracking</option>
                <option value="UNIT_BASED">
                  Unit-based — split evenly, but charge extra to whoever goes over their share
                </option>
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-muted">
            Cost (optional)
            <FieldTooltip text="Auto-filled from the last time you bought this exact food and quantity, if we've seen it before -- edit or clear it any time." />
          </label>
          <div className="flex items-center gap-1.5">
            <input type="number" step="0.01" className={inputClass} {...register('cost')} />
            <button
              type="button"
              onClick={() => setValue('cost', '')}
              title="Clear"
              aria-label="Clear cost"
              className="shrink-0 rounded-control p-2 text-faint transition-colors hover:bg-surface-hover hover:text-text"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {serverError && <p className="text-sm text-danger">{serverError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {isSubmitting ? 'Adding…' : 'Add item'}
        </button>
      </form>
    </div>
  )
}
