import { X } from 'lucide-react'

// Shown the instant "Add item" is tapped (or an order in progress is being
// reopened after a reload), while the real order sheet is still being set up. It
// has the same frame as that sheet, so the swap to the real thing doesn't jump.
// The close button stops the setup; see useAddItemWizard's cancelOpening.
export function AddItemOpeningSheet({ onCancel }: { onCancel: () => void }) {
  return (
    <div
      data-opening-sheet
      className="fixed inset-x-0 top-0 z-40 flex h-[var(--app-height)] items-center justify-center md:inset-0 md:h-auto md:p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative flex h-full w-full max-w-4xl flex-col overflow-hidden bg-surface-2 md:h-[85vh] md:rounded-card md:border md:border-subtle md:shadow-raised">
        <div className="flex items-center justify-between gap-2 border-b border-subtle px-4 pb-3 pt-[calc(0.75rem+var(--safe-top)+var(--offline-banner-h,0px))] md:py-3">
          <h3 className="text-base font-semibold">Order</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="rounded-control p-1.5 text-muted hover:bg-surface-hover hover:text-text"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <div
            aria-hidden
            className="size-7 animate-spin rounded-full border-2 border-subtle border-t-primary"
          />
          <p className="text-sm text-muted">Getting your order ready…</p>
        </div>
      </div>
    </div>
  )
}
