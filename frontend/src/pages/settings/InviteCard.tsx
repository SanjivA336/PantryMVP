import { useState } from 'react'
import { RefreshCw, Share2 } from 'lucide-react'
import { CopyButton } from '../../components/CopyButton'
import { Modal } from '../../components/Modal'
import { apiClient } from '../../lib/apiClient'
import type { Household } from '../../types/entities'

// The burrow's join code, front and centre: inviting someone is the main thing a
// shared-household app asks of its owner. Copy puts the code on the clipboard;
// Share opens the phone's own share sheet (Messages, WhatsApp, ...) and only
// appears where the browser supports it. Admins also get "Make a new code", which
// replaces the code (never automatically): the old one stops working at once, so it
// is the way to lock out someone who was removed but still knows it.
interface Props {
  household: Household
  canRegenerate: boolean
  onRegenerated: (household: Household) => void
}

export function InviteCard({ household, canRegenerate, onRegenerated }: Props) {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const regenerate = async () => {
    setRegenerating(true)
    setError(null)
    try {
      const updated = await apiClient.post<Household>(
        `/api/households/${household.id}/regenerate-join-code`,
      )
      onRegenerated(updated)
      setConfirmOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setRegenerating(false)
    }
  }

  const share = async () => {
    try {
      await navigator.share({
        title: `Join ${household.name} on Burrow`,
        text: `Join ${household.name} on Burrow with the code ${household.join_code}.`,
        url: `${window.location.origin}/households/join`,
      })
    } catch {
      // Closing the share sheet counts as an error in some browsers; nothing to do.
    }
  }

  return (
    <div className="rounded-card border border-subtle bg-surface p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
        Invite someone
      </p>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-2xl font-semibold tracking-widest text-text">
          {household.join_code}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <CopyButton value={household.join_code} label="Copy join code" size={18} />
          {canShare && (
            <button
              type="button"
              onClick={() => void share()}
              className="flex items-center gap-1.5 rounded-control bg-primary px-3 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover"
            >
              <Share2 size={15} strokeWidth={2} />
              Share
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-faint">Anyone with this code can join this burrow.</p>
      {canRegenerate && (
        <button
          type="button"
          onClick={() => {
            setError(null)
            setConfirmOpen(true)
          }}
          className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-text"
        >
          <RefreshCw size={13} strokeWidth={1.75} />
          Make a new code
        </button>
      )}

      {confirmOpen && (
        <Modal title="Make a new code?" onClose={() => setConfirmOpen(false)}>
          <p className="mb-2 text-sm text-muted">
            <span className="font-mono font-semibold text-text">{household.join_code}</span> will
            stop working right away. Anyone you've already invited will need the new code.
          </p>
          <p className="mb-4 text-sm text-muted">People already in this burrow aren't affected.</p>
          {error && <p className="mb-3 text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="flex-1 rounded-control border border-subtle px-2 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void regenerate()}
              disabled={regenerating}
              className="flex-1 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {regenerating ? 'Making…' : 'Make new code'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
