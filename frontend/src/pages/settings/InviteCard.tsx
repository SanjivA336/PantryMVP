import { Share2 } from 'lucide-react'
import { CopyButton } from '../../components/CopyButton'
import type { Household } from '../../types/entities'

// The burrow's join code, front and centre: inviting someone is the main thing a
// shared-household app asks of its owner. Copy puts the code on the clipboard;
// Share opens the phone's own share sheet (Messages, WhatsApp, ...) and only
// appears where the browser supports it.
export function InviteCard({ household }: { household: Household }) {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

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
    </div>
  )
}
