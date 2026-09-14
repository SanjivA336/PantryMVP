import { Modal } from './Modal'

interface Props {
  onConfirm: () => void
  onClose: () => void
  loggingOut?: boolean
}

export function LogoutConfirmModal({ onConfirm, onClose, loggingOut = false }: Props) {
  return (
    <Modal title="Log out?" onClose={onClose}>
      <p className="mb-4 text-sm text-muted">
        You'll need to sign back in to get back to your kitchens.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-control border border-subtle px-2 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loggingOut}
          className="flex-1 rounded-control bg-danger px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-danger/90 disabled:opacity-50"
        >
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </Modal>
  )
}
