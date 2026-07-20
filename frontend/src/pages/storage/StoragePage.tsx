import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiClient, ApiError } from '../../lib/apiClient'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import type { StorageLocation } from '../../types/entities'
import { storageLocationSchema, type StorageLocationForm } from './schema'

const TYPE_OPTIONS: StorageLocationForm['type'][] = [
  'FRIDGE',
  'FREEZER',
  'PANTRY',
  'GARDEN',
  'OTHER',
]

export function StoragePage() {
  const { householdId } = useParams<{ householdId: string }>()
  const {
    data: locations,
    loading,
    error: loadError,
    reload,
  } = useHouseholdResource<StorageLocation[]>(
    householdId ? `/api/households/${householdId}/storage-locations` : null,
  )
  const [actionError, setActionError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<StorageLocationForm>({ resolver: zodResolver(storageLocationSchema) })

  const onCreate = async (values: StorageLocationForm) => {
    setActionError(null)
    try {
      await apiClient.post(`/api/households/${householdId}/storage-locations`, values)
      reset()
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const onDelete = async (location: StorageLocation) => {
    setActionError(null)
    try {
      await apiClient.delete(`/api/households/${householdId}/storage-locations/${location.id}`)
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="mb-2 text-lg font-semibold">Add a storage location</h2>
        <form onSubmit={handleSubmit(onCreate)} className="flex flex-wrap items-start gap-3">
          <div>
            <input
              type="text"
              placeholder="Name (e.g. Garage Fridge)"
              className="rounded-md border border-gray-300 px-3 py-2"
              {...register('name')}
            />
            {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <select className="rounded-md border border-gray-300 px-3 py-2" {...register('type')}>
            {TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Description (optional)"
            className="rounded-md border border-gray-300 px-3 py-2"
            {...register('description')}
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md px-4 py-2 font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            Add
          </button>
        </form>
      </div>

      {(loadError || actionError) && (
        <p className="text-sm text-red-600">{loadError ?? actionError}</p>
      )}

      <div>
        <h2 className="mb-2 text-lg font-semibold">Storage locations</h2>
        {loading ? (
          <p className="text-sm">Loading…</p>
        ) : !locations || locations.length === 0 ? (
          <p className="text-sm text-gray-500">No storage locations yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {locations.map((location) => (
              <li
                key={location.id}
                className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3"
              >
                <div>
                  <span className="font-medium">{location.name}</span>
                  <span className="ml-2 text-xs text-gray-400">{location.type}</span>
                  {location.description && (
                    <p className="text-sm text-gray-500">{location.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(location)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
