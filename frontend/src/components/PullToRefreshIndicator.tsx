import { RefreshCw } from 'lucide-react'
import { PULL_THRESHOLD } from '../hooks/usePullToRefresh'

interface Props {
  pull: number
  dragging: boolean
  refreshing: boolean
}

// A strip that grows as the page is pulled down, with a refresh icon that
// turns as you approach the threshold and spins while the refresh runs. It
// sits in the page flow above the content (not on top of it), so the content
// is pushed down the way a native pull-to-refresh does.
export function PullToRefreshIndicator({ pull, dragging, refreshing }: Props) {
  const progress = Math.min(pull / PULL_THRESHOLD, 1)
  return (
    <div
      className="flex items-center justify-center overflow-hidden md:hidden"
      style={{ height: pull, transition: dragging ? 'none' : 'height 200ms ease-out' }}
      role={refreshing ? 'status' : undefined}
    >
      <RefreshCw
        size={20}
        strokeWidth={2}
        className={`text-primary ${refreshing ? 'animate-spin' : ''}`}
        style={{
          opacity: refreshing ? 1 : progress,
          transform: refreshing ? undefined : `rotate(${progress * 270}deg)`,
        }}
      />
      {refreshing && <span className="sr-only">Refreshing</span>}
    </div>
  )
}
