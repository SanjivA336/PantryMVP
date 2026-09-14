import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LogOut, TriangleAlert } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { Modal } from '../../components/Modal'
import { useAuth } from '../../hooks/useAuth'
import type { Member } from '../../types/entities'

const inputClass =
  'w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary'

function BurrowSettingsCard({ householdId }: { householdId: string }) {
  const { user } = useAuth()
  const [me, setMe] = useState<Member | null>(null)
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    apiClient.get<Member[]>(`/api/households/${householdId}/members`).then((members) => {
      const mine = members.find((m) => m.user_id === user?.id) ?? null
      setMe(mine)
      if (mine) setNickname(mine.nickname)
    })
  }, [householdId, user?.id])

  const save = async () => {
    if (!me || !nickname.trim() || nickname === me.nickname) return
    setError(null)
    setSaved(false)
    try {
      await apiClient.patch(`/api/households/${householdId}/members/${me.id}`, {
        nickname: nickname.trim(),
      })
      setMe({ ...me, nickname: nickname.trim() })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="rounded-card border border-subtle bg-surface p-4">
      <p className="mb-3 text-sm font-semibold text-muted">This burrow</p>
      <label className="mb-1.5 block text-sm font-medium text-muted">
        Your nickname in this household
      </label>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          className={inputClass}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </div>
      <p className="mt-1.5 text-xs text-faint">
        {saved ? 'Saved.' : "How other members see you here. Doesn't change your email or login."}
      </p>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  )
}

export function AccountPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { householdId } = useParams<{ householdId: string }>()

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

      {householdId && <BurrowSettingsCard householdId={householdId} />}

      <div className="rounded-card border border-subtle bg-surface p-4">
        <p className="mb-3 text-sm font-semibold text-muted">Global account</p>
        <div className="flex flex-col gap-4">
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
              in. This cannot be undone. If you own a kitchen, transfer ownership or delete it
              first.
            </p>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="rounded-control border border-danger/40 px-2 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
            >
              Delete my account
            </button>
          </div>
        </div>
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
