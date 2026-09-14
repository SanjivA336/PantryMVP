import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface Props {
  value: string
  label: string
  size?: number
}

// Shared by the mobile header's compact join-code row and Burrow settings'
// full-size one -- same clipboard-write-then-flash-a-checkmark behavior,
// just sized differently for how much room each spot has.
export function CopyButton({ value, label, size = 12 }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context) -- a
      // silent no-op is fine for this low-stakes convenience action.
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // Callers sometimes wrap this in their own clickable region (the
        // mobile header's "switch kitchens" area) -- without this, copying
        // would also trigger whatever that region's own click does.
        e.stopPropagation()
        void copy()
      }}
      title={label}
      aria-label={label}
      className="rounded-control p-0.5 text-faint transition-colors hover:bg-surface-hover hover:text-text"
    >
      {copied ? <Check size={size} strokeWidth={2.25} /> : <Copy size={size} strokeWidth={1.75} />}
    </button>
  )
}
