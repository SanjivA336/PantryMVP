import { useSyncExternalStore } from 'react'
import { isInstalledApp } from './lockZoom'

// Layout diagnostics for problems that only show up on a real phone (the dark
// strip under the iOS tab bar, for one). Two parts:
//   - a recorder that starts at app launch and logs the screen/viewport numbers
//     every time they change, so a layout that "fixes itself" after a while
//     leaves a trail of what changed and when;
//   - an on/off flag (saved in localStorage, so it survives closing the app)
//     that shows the panel. Tapping the version label five times flips it.

const FLAG_KEY = 'burrow-diagnostics'
const MAX_LOG = 25

const flagListeners = new Set<() => void>()

function readFlag(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === '1'
  } catch {
    return false
  }
}

export function setDiagnosticsOn(on: boolean): void {
  try {
    if (on) localStorage.setItem(FLAG_KEY, '1')
    else localStorage.removeItem(FLAG_KEY)
  } catch {
    // Storage blocked: the panel just won't persist across launches.
  }
  flagListeners.forEach((listener) => listener())
}

export function toggleDiagnostics(): void {
  setDiagnosticsOn(!readFlag())
}

export function useDiagnosticsOn(): boolean {
  return useSyncExternalStore(
    (listener) => {
      flagListeners.add(listener)
      return () => flagListeners.delete(listener)
    },
    readFlag,
    () => false,
  )
}

// Measures a CSS value by placing an invisible fixed element and reading it
// back. Fixed positioning is the point: it shows where the browser puts things
// relative to the layout viewport, which is what goes wrong on iOS.
function probe(css: string): DOMRect {
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;width:1px;${css}`
  document.body.appendChild(el)
  const rect = el.getBoundingClientRect()
  el.remove()
  return rect
}

type Side = 'Top' | 'Bottom' | 'Left' | 'Right'

function inset(side: Side): number {
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;padding-${side.toLowerCase()}:env(safe-area-inset-${side.toLowerCase()})`
  document.body.appendChild(el)
  const value = parseFloat(getComputedStyle(el)[`padding${side}`])
  el.remove()
  return Number.isNaN(value) ? -1 : value
}

const round = (n: number | undefined) => (n === undefined ? 'n/a' : Math.round(n * 100) / 100)

// The numbers that matter for the strip, on one line, for the change log.
function brief(): string {
  const vv = window.visualViewport
  const nav = document.querySelector<HTMLElement>('nav.fixed')?.getBoundingClientRect()
  return [
    `inner ${innerWidth}x${innerHeight}`,
    `screen ${screen.width}x${screen.height}`,
    `vv ${round(vv?.width)}x${round(vv?.height)} top${round(vv?.offsetTop)}`,
    `100dvh ${probe('top:0;height:100dvh').height}`,
    `appH ${probe('top:0;height:var(--app-height)').height}`,
    `fixedBottom ${probe('bottom:0;height:1px').bottom}`,
    `insets T${inset('Top')} B${inset('Bottom')}`,
    `scrollY ${round(scrollY)}`,
    `docH ${document.documentElement.scrollHeight}`,
    `tabBar ${nav ? `${round(nav.top)}-${round(nav.bottom)}` : 'none'}`,
    `path ${location.pathname.replace(/[0-9a-f-]{36}/g, ':id')}`,
  ].join(' | ')
}

// Everything, one value per line, for the "now" section.
export function fullSnapshot(): string {
  const vv = window.visualViewport
  const meta = document.querySelector('meta[name="viewport"]')?.getAttribute('content')
  const rows: [string, string | number][] = [
    ['version', __APP_VERSION__],
    ['installed app', isInstalledApp() ? 'yes' : 'no'],
    ['navigator.standalone', String((navigator as Navigator & { standalone?: boolean }).standalone)],
    ['viewport meta', meta ?? 'none'],
    ['screen', `${screen.width} x ${screen.height}`],
    ['inner', `${innerWidth} x ${innerHeight} (outerHeight ${outerHeight})`],
    ['visualViewport', vv ? `${round(vv.width)} x ${round(vv.height)}, offsetTop ${round(vv.offsetTop)}, scale ${round(vv.scale)}` : 'n/a'],
    ['100vh / dvh / svh / lvh', [probe('top:0;height:100vh'), probe('top:0;height:100dvh'), probe('top:0;height:100svh'), probe('top:0;height:100lvh')].map((r) => r.height).join(' / ')],
    ['--app-height resolves to', probe('top:0;height:var(--app-height)').height],
    ['fixed bottom:0 lands at', probe('bottom:0;height:1px').bottom],
    ['safe-area insets T/B/L/R', `${inset('Top')} / ${inset('Bottom')} / ${inset('Left')} / ${inset('Right')}`],
    ['scrollY / docH / bodyH', `${round(scrollY)} / ${document.documentElement.scrollHeight} / ${document.body.scrollHeight}`],
    ['pixel ratio', devicePixelRatio],
  ]
  return rows.map(([k, v]) => `${k}: ${v}`).join('\n')
}

interface LogEntry {
  at: number
  text: string
}

const startedAt = Date.now()
const log: LogEntry[] = []
const logListeners = new Set<() => void>()
let lastBrief = ''

function record(reason: string): void {
  const text = brief()
  if (text === lastBrief) return
  lastBrief = text
  log.push({ at: Date.now() - startedAt, text: `${reason}: ${text}` })
  if (log.length > MAX_LOG) log.shift()
  logListeners.forEach((listener) => listener())
}

// Call once at launch (main.tsx). Cheap: a one-line measurement that only
// writes to the log when something changed.
export function startDiagnosticsRecording(): void {
  record('launch')
  window.addEventListener('load', () => record('load'))
  window.addEventListener('resize', () => record('resize'))
  window.addEventListener('orientationchange', () => record('rotate'))
  window.visualViewport?.addEventListener('resize', () => record('vv-resize'))
  window.visualViewport?.addEventListener('scroll', () => record('vv-scroll'))
  let scrollTimer: ReturnType<typeof setTimeout> | undefined
  window.addEventListener(
    'scroll',
    () => {
      clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => record('scroll'), 200)
    },
    { passive: true },
  )
  // Catches changes that fire no event (route changes, native relayout).
  setInterval(() => record('tick'), 1000)
}

let logSnapshot: readonly LogEntry[] = []
export function useDiagnosticsLog(): readonly LogEntry[] {
  return useSyncExternalStore(
    (listener) => {
      logListeners.add(listener)
      return () => logListeners.delete(listener)
    },
    () => {
      if (logSnapshot.length !== log.length || logSnapshot[logSnapshot.length - 1] !== log[log.length - 1]) {
        logSnapshot = [...log]
      }
      return logSnapshot
    },
    () => [],
  )
}

export function formatLog(entries: readonly LogEntry[]): string {
  return entries.map((e) => `[+${(e.at / 1000).toFixed(1)}s] ${e.text}`).join('\n')
}
