import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiClient } from '../../lib/apiClient'
import type { Household } from '../../types/entities'
import { createHouseholdSchema, type CreateHouseholdForm } from './schema'

export function CreateHouseholdPage() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateHouseholdForm>({ resolver: zodResolver(createHouseholdSchema) })

  const onSubmit = async (values: CreateHouseholdForm) => {
    setServerError(null)
    try {
      const household = await apiClient.post<Household>('/api/households', values)
      navigate(`/households/${household.id}`)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-2xl font-semibold" style={{ color: 'var(--color-primary)' }}>
          Create a household
        </h1>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Household name</label>
            <input
              type="text"
              placeholder="3BR Apartment on Main St"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              {...register('name')}
            />
            {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Address (optional)</label>
            <input
              type="text"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              {...register('address')}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Your nickname</label>
            <input
              type="text"
              placeholder="Alex"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              {...register('nickname')}
            />
            {errors.nickname && (
              <p className="mt-1 text-sm text-red-600">{errors.nickname.message}</p>
            )}
          </div>
          {serverError && <p className="text-sm text-red-600">{serverError}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md px-4 py-2 font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {isSubmitting ? 'Creating…' : 'Create household'}
          </button>
        </form>
      </div>
    </div>
  )
}
