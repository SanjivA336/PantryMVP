import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { TriangleAlert } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { Modal } from '../../components/Modal'
import { useAuth } from '../../hooks/useAuth'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import {
  updateHouseholdSchema,
  type UpdateHouseholdForm,
} from '../households/schema'
import type { Household, Member } from '../../types/entities'

const inputClass =
  'w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary'

interface Props {
  members: Member[] | null
}

export function BurrowTab({ members }: Props) {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const {
    data: household,
    loading,
    error: loadError,
    reload,
  } = useHouseholdResource<Household>(householdId ? `/api/households/${householdId}` : null)
  const isAdmin = (members ?? []).some((m) => m.user_id === user?.id && m.is_admin && m.is_active)

  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateHouseholdForm>({ resolver: zodResolver(updateHouseholdSchema) })

  // Seed the form once the household loads -- reset (not defaultValues) so
  // it still picks up the fetched data even though the request resolves
  // after the initial render.
  useEffect(() => {
    if (household) reset({ name: household.name, address: household.address ?? '' })
  }, [household, reset])

  const onSave = async (values: UpdateHouseholdForm) => {
    setActionError(null)
    try {
      await apiClient.patch(`/api/households/${householdId}`, values)
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const confirmDelete = async () => {
    setActionError(null)
    setDeleting(true)
    try {
      await apiClient.delete(`/api/households/${householdId}`)
      navigate('/')
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
      setDeleting(false)
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>
  if (loadError) return <p className="text-sm text-danger">{loadError}</p>
  if (!household) return null

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-muted">Household name</p>
          <p className="text-text">{household.name}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted">Address</p>
          <p className="text-text">{household.address || 'Not set'}</p>
        </div>
        <p className="text-xs text-faint">Only admins can edit or delete this kitchen.</p>
      </div>
    )
  }

  return (
    <div className="flex max-w-md flex-col gap-6">
      <form onSubmit={handleSubmit(onSave)} className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Household name</label>
          <input type="text" className={inputClass} {...register('name')} />
          {errors.name && <p className="mt-1.5 text-sm text-danger">{errors.name.message}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Address (optional)
          </label>
          <input type="text" className={inputClass} {...register('address')} />
        </div>
        {actionError && <p className="text-sm text-danger">{actionError}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="self-start rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <div className="rounded-card border border-danger/30 bg-danger-soft p-4">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-danger">
          <TriangleAlert size={15} strokeWidth={2} />
          Danger zone
        </p>
        <p className="mb-3 text-xs text-muted">
          Deleting this kitchen permanently removes it, its inventory, and its history for every
          member. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="rounded-control border border-danger/40 px-2 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
        >
          Delete this kitchen
        </button>
      </div>

      {deleteOpen && (
        <Modal
          title="Delete this kitchen?"
          onClose={() => {
            setDeleteOpen(false)
            setDeleteConfirmText('')
          }}
        >
          <p className="mb-3 text-sm text-muted">
            This permanently deletes <span className="font-medium text-text">{household.name}</span>
            {' '}-- inventory, recipes, shopping list, and balance history for every member. Type
            the household name to confirm.
          </p>
          <input
            type="text"
            autoFocus
            placeholder={household.name}
            className={`${inputClass} mb-3`}
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
          />
          {actionError && <p className="mb-3 text-sm text-danger">{actionError}</p>}
          <button
            type="button"
            onClick={confirmDelete}
            disabled={deleteConfirmText.trim() !== household.name || deleting}
            className="w-full rounded-control bg-danger px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-danger/90 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Permanently delete'}
          </button>
        </Modal>
      )}
    </div>
  )
}
