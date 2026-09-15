import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CircleHelp, LogOut, TriangleAlert } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { LogoutConfirmModal } from '../../components/LogoutConfirmModal'
import { Modal } from '../../components/Modal'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import type { Member } from '../../types/entities'
import { newPasswordSchema, type NewPasswordForm } from '../auth/schema'

const inputClass =
  'w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary'

// Wherever support requests actually go (a Google Form today) -- unset
// until that exists, in which case the link below just doesn't render.
const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL

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

  const canSave = !!me && !!nickname.trim() && nickname.trim() !== me.nickname

  const save = async () => {
    if (!me || !canSave) return
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
          placeholder={me?.nickname}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
        />
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void save()}
          className="shrink-0 rounded-control bg-primary px-3 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          Save
        </button>
      </div>
      <p className="mt-1.5 text-xs text-faint">
        {saved ? 'Saved.' : "How other members see you here. Doesn't change your email or login."}
      </p>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  )
}

// Distinct from the forgot-password flow (LoginPage's "Forgot password?" ->
// email link -> ResetPasswordPage): this one needs no email round trip at
// all, since being here already proves you're signed in -- updatePassword
// just calls Supabase directly with the active session. Collapsed behind a
// toggle rather than always-open fields, since it's a rare action next to
// the account's everyday info.
function ChangePasswordSection() {
  const { updatePassword } = useAuth()
  const [open, setOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordForm>({ resolver: zodResolver(newPasswordSchema) })

  const onSubmit = async (values: NewPasswordForm) => {
    setServerError(null)
    try {
      await updatePassword(values.password)
      reset()
      setSaved(true)
      setOpen(false)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit text-sm font-medium text-muted transition-colors hover:text-text hover:underline"
      >
        {saved ? 'Password changed.' : 'Change password'}
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <p className="text-sm font-medium text-muted">Change password</p>
      <div>
        <input
          type="password"
          placeholder="New password"
          className="w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary"
          {...register('password')}
        />
        {errors.password && <p className="mt-1.5 text-sm text-danger">{errors.password.message}</p>}
      </div>
      <div>
        <input
          type="password"
          placeholder="Confirm new password"
          className="w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary"
          {...register('confirmPassword')}
        />
        {errors.confirmPassword && (
          <p className="mt-1.5 text-sm text-danger">{errors.confirmPassword.message}</p>
        )}
      </div>
      {serverError && <p className="text-sm text-danger">{serverError}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            reset()
            setServerError(null)
          }}
          className="flex-1 rounded-control border border-subtle px-2 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {isSubmitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

export function AccountPage() {
  usePageTitle('Account')
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { householdId } = useParams<{ householdId: string }>()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleSignOut = async () => {
    setLoggingOut(true)
    try {
      await signOut()
      navigate('/login')
    } finally {
      setLoggingOut(false)
      setLogoutConfirmOpen(false)
    }
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

          <ChangePasswordSection />

          {/* Hidden entirely until a real form/inbox exists to send this
              to -- VITE_SUPPORT_URL unset means nothing to link to yet. */}
          {SUPPORT_URL && (
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-fit items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-text hover:underline"
            >
              <CircleHelp size={16} strokeWidth={1.75} />
              Contact support
            </a>
          )}

          <button
            type="button"
            onClick={() => setLogoutConfirmOpen(true)}
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

      {logoutConfirmOpen && (
        <LogoutConfirmModal
          loggingOut={loggingOut}
          onClose={() => setLogoutConfirmOpen(false)}
          onConfirm={() => void handleSignOut()}
        />
      )}

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
