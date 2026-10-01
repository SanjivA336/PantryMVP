import { CircleHelp } from 'lucide-react'

// Wherever support requests actually go (a Google Form today). Unset means
// there's nothing to link to yet, in which case every SupportLink just
// doesn't render, rather than showing one that goes nowhere.
const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL

interface Props {
  className?: string
  iconSize?: number
}

export function SupportLink({ className = '', iconSize = 16 }: Props) {
  if (!SUPPORT_URL) return null

  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-text ${className}`}
    >
      <CircleHelp size={iconSize} strokeWidth={1.75} />
      Contact support
    </a>
  )
}
