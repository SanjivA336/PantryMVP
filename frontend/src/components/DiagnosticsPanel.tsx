import { useEffect, useState } from 'react'
import {
  formatLog,
  fullSnapshot,
  setDiagnosticsOn,
  useDiagnosticsLog,
  useDiagnosticsOn,
} from '../lib/diagnostics'

// The readout itself. Mounted once at the app root and shown whenever the saved
// flag is on, so it is still there after closing and reopening the app, which
// is what lets it capture a layout problem that only exists at launch.
function Panel() {
  const [now, setNow] = useState(fullSnapshot)
  const [copied, setCopied] = useState(false)
  const entries = useDiagnosticsLog()

  useEffect(() => {
    const timer = setInterval(() => setNow(fullSnapshot()), 1000)
    return () => clearInterval(timer)
  }, [])

  const log = formatLog(entries)

  return (
    <div className="fixed inset-x-2 top-14 z-50 rounded-card border border-subtle bg-surface/95 p-3 text-text shadow-raised">
      <pre className="max-h-[52dvh] overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-snug">
        {`CHANGE LOG (since launch; a new line each time a value changes)\n${log}\n\nNOW\n${now}`}
      </pre>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(`${log}\n\n${now}`).then(() => setCopied(true))
          }}
          className="rounded-control bg-primary px-3 py-1.5 text-sm font-semibold text-bg"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={() => setDiagnosticsOn(false)}
          className="rounded-control border border-subtle px-3 py-1.5 text-sm text-muted"
        >
          Close (turns off)
        </button>
      </div>
    </div>
  )
}

export function DiagnosticsHost() {
  return useDiagnosticsOn() ? <Panel /> : null
}
