import { TriangleAlert } from 'lucide-react'

interface Props {
  critical: number
  regular: number
  size?: number
}

function countLabel(n: number): string {
  return n > 9 ? '9+' : String(n)
}

// Shared red-critical/yellow-regular icon+count pair -- used by the header
// WarningsButton and, at a smaller size, by each inventory section's
// storage-location badge, so the two stay visually identical.
export function WarningCounts({ critical, regular, size = 16 }: Props) {
  if (critical + regular === 0) return null
  return (
    <>
      {critical > 0 && (
        <span className="flex items-center gap-1 text-danger">
          <TriangleAlert size={size} strokeWidth={2.25} />
          {countLabel(critical)}
        </span>
      )}
      {regular > 0 && (
        <span className="flex items-center gap-1 text-warning">
          <TriangleAlert size={size} strokeWidth={2.25} />
          {countLabel(regular)}
        </span>
      )}
    </>
  )
}
