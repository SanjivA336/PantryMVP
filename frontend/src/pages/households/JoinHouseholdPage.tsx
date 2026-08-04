import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiClient } from '../../lib/apiClient'
import type { Household } from '../../types/entities'
import { joinHouseholdSchema, type JoinHouseholdForm } from './schema'

export function JoinHouseholdPage() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<JoinHouseholdForm>({ resolver: zodResolver(joinHouseholdSchema) })

  const onSubmit = async (values: JoinHouseholdForm) => {
    setServerError(null)
    try {
      const household = await apiClient.post<Household>('/api/households/join', values)
      navigate(`/households/${household.id}`)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4 text-text">
      <div className="w-full max-w-sm rounded-card border border-subtle bg-surface p-7 shadow-card">
        <p className="mb-1 text-sm font-medium text-primary">Burrow</p>
        <h1 className="mb-6 text-2xl font-semibold">Join a household</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Join code</label>
            <input
              type="text"
              placeholder="ABCD2345"
              maxLength={8}
              className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm uppercase tracking-widest text-text outline-none placeholder:text-faint placeholder:normal-case placeholder:tracking-normal focus:border-primary"
              {...register('join_code')}
            />
            {errors.join_code && (
              <p className="mt-1.5 text-sm text-danger">{errors.join_code.message}</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Your nickname</label>
            <input
              type="text"
              placeholder="Alex"
              className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
              {...register('nickname')}
            />
            {errors.nickname && (
              <p className="mt-1.5 text-sm text-danger">{errors.nickname.message}</p>
            )}
          </div>
          {serverError && <p className="text-sm text-danger">{serverError}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-1 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {isSubmitting ? 'Joining…' : 'Join household'}
          </button>
        </form>
      </div>
    </div>
  )
}
