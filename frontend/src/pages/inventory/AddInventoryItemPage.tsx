import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiClient, ApiError } from '../../lib/apiClient'
import { FoodSearchInput } from '../../components/FoodSearchInput'
import type { FoodDefinition, InventoryItem, Member, StorageLocation } from '../../types/entities'
import {
  addInventoryItemSchema,
  type AddInventoryItemForm,
  type AddInventoryItemFormInput,
} from './schema'

export function AddInventoryItemPage() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()
  const [food, setFood] = useState<FoodDefinition | null>(null)
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AddInventoryItemFormInput, unknown, AddInventoryItemForm>({
    resolver: zodResolver(addInventoryItemSchema),
    defaultValues: { allowed_member_ids: [] },
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
    if (food) setValue('preferred_unit', food.preferred_unit)
  }, [food, setValue])

  const selectedMemberIds = watch('allowed_member_ids') ?? []

  const toggleMember = (memberId: string) => {
    const current = selectedMemberIds
    setValue(
      'allowed_member_ids',
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
    )
  }

  const onSubmit = async (values: AddInventoryItemForm) => {
    if (!food) {
      setServerError('Pick a food first')
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
      })
      navigate(`/households/${householdId}`)
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h2 className="mb-4 text-lg font-semibold">Add an item</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Food</label>
          <FoodSearchInput value={food} onChange={setFood} />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">Quantity</label>
            <input
              type="number"
              step="any"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              {...register('quantity')}
            />
            {errors.quantity && (
              <p className="mt-1 text-sm text-red-600">{errors.quantity.message}</p>
            )}
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">Unit</label>
            <input
              type="text"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              {...register('preferred_unit')}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Storage location</label>
          <select
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            {...register('storage_location_id')}
          >
            <option value="">Select…</option>
            {storageLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
          {errors.storage_location_id && (
            <p className="mt-1 text-sm text-red-600">{errors.storage_location_id.message}</p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Cost (optional)</label>
          <input
            type="number"
            step="0.01"
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            {...register('cost')}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">Expiry date (optional)</label>
            <input
              type="date"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              {...register('expiry_date')}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">Best-by date (optional)</label>
            <input
              type="date"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              {...register('best_by_date')}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Who can use this?</label>
          <div className="flex flex-col gap-1">
            {members.map((member) => (
              <label key={member.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedMemberIds.includes(member.id)}
                  onChange={() => toggleMember(member.id)}
                />
                {member.nickname}
              </label>
            ))}
          </div>
          {errors.allowed_member_ids && (
            <p className="mt-1 text-sm text-red-600">{errors.allowed_member_ids.message}</p>
          )}
        </div>

        {serverError && <p className="text-sm text-red-600">{serverError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md px-4 py-2 font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {isSubmitting ? 'Adding…' : 'Add item'}
        </button>
      </form>
    </div>
  )
}
