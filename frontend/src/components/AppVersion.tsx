import { useRef, useState } from 'react'
import { DiagnosticsPanel } from './DiagnosticsPanel'

interface Props {
  className?: string
}

// "Burrow — v0.9.1": the app's name and version (from package.json, baked in
// at build time). Small and quiet on purpose: it's there so anyone reporting a
// problem can say which version they were on. Tapping it five times in a row
// opens a diagnostics readout (screen size, safe areas) for debugging layout on
// a real phone.
export function AppVersion({ className = '' }: Props) {
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const taps = useRef({ count: 0, last: 0 })

  const handleTap = () => {
    const now = Date.now()
    taps.current.count = now - taps.current.last < 800 ? taps.current.count + 1 : 1
    taps.current.last = now
    if (taps.current.count >= 5) {
      taps.current.count = 0
      setShowDiagnostics(true)
    }
  }

  return (
    <>
      <p onClick={handleTap} className={`select-none text-xs text-muted ${className}`}>
        Burrow — v{__APP_VERSION__}
      </p>
      {showDiagnostics && <DiagnosticsPanel onClose={() => setShowDiagnostics(false)} />}
    </>
  )
}
