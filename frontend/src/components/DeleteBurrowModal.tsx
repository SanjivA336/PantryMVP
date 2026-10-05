import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient, ApiError } from '../lib/apiClient'
import { Modal } from './Modal'
import type { Household } from '../types/entities'

const inputClass =
  'w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary'

// Permanently deletes a burrow after you type its name. Used from the Settings
// list's "Delete this burrow" row; on success it returns you to your burrows.
export function DeleteBurrowModal({
  household,
  onClose,
}: {
  household: Household
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmDelete = async () => {
    setError(null)
    setDeleting(true)
    try {
      await apiClient.delete(`/api/households/${household.id}`)
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
      setDeleting(false)
    }
  }

  return (
    <Modal title="Delete this burrow?" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">
        This permanently deletes <span className="font-medium text-text">{household.name}</span>,
        including its inventory, recipes, shopping list, and balance history for every member. This
        cannot be undone. Type the burrow's name to confirm.
      </p>
      <input
        type="text"
        autoFocus
        placeholder={household.name}
        className={`${inputClass} mb-3`}
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
      />
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <button
        type="button"
        onClick={confirmDelete}
        disabled={confirmText.trim() !== household.name || deleting}
        className="w-full rounded-control bg-danger px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-danger/90 disabled:opacity-50"
      >
        {deleting ? 'Deleting…' : 'Permanently delete'}
      </button>
    </Modal>
  )
}
