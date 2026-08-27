import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, TriangleAlert } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { Modal } from '../../components/Modal'
import { useAuth } from '../../hooks/useAuth'

const inputClass =
  'w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary'

export function AccountPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const confirmDelete = async () => {
    setError(null)
    setDeleting(true)
    try {
      await apiClient.delete('/api/users/me')
      await signOut()
      navigate('/login')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
      setDeleting(false)
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-6">
      <h2 className="text-xl font-semibold">Account</h2>

      <div>
        <p className="text-sm font-medium text-muted">Email</p>
        <p className="text-text">{user?.email}</p>
      </div>

      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="flex w-fit items-center gap-2 rounded-control border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
      >
        <LogOut size={16} strokeWidth={1.75} />
        Log out
      </button>

      <div className="rounded-card border border-danger/30 bg-danger-soft p-4">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-danger">
          <TriangleAlert size={15} strokeWidth={2} />
          Danger zone
        </p>
        <p className="mb-3 text-xs text-muted">
          Deleting your account permanently removes it and signs you out of every kitchen you're
          in. This cannot be undone. If you own a kitchen, transfer ownership or delete it first.
        </p>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="rounded-control border border-danger/40 px-2 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
        >
          Delete my account
        </button>
      </div>

      {deleteOpen && (
        <Modal
          title="Delete your account?"
          onClose={() => {
            setDeleteOpen(false)
            setConfirmText('')
            setError(null)
          }}
        >
          <p className="mb-3 text-sm text-muted">
            This permanently deletes your account and removes you from every kitchen. Type your
            email to confirm.
          </p>
          <input
            type="text"
            autoFocus
            placeholder={user?.email}
            className={`${inputClass} mb-3`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          {error && <p className="mb-3 text-sm text-danger">{error}</p>}
          <button
            type="button"
            onClick={confirmDelete}
            disabled={confirmText.trim() !== user?.email || deleting}
            className="w-full rounded-control bg-danger px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-danger/90 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Permanently delete'}
          </button>
        </Modal>
      )}
    </div>
  )
}
