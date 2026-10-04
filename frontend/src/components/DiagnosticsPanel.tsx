import { useEffect, useState } from 'react'
import { isInstalledApp } from '../lib/lockZoom'

// Measures a CSS value by placing an invisible fixed element and reading it
// back. Fixed positioning is the point: it shows where the browser puts things
// relative to the layout viewport, which is exactly what goes wrong on iOS.
function probe(css: string): DOMRect {
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;width:1px;${css}`
  document.body.appendChild(el)
  const rect = el.getBoundingClientRect()
  el.remove()
  return rect
}

function inset(side: 'top' | 'bottom' | 'left' | 'right'): number {
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;padding-${side}:env(safe-area-inset-${side})`
  document.body.appendChild(el)
  const value = parseFloat(getComputedStyle(el)[`padding${side[0].toUpperCase()}${side.slice(1)}` as 'paddingTop'])
  el.remove()
  return Number.isNaN(value) ? -1 : value
}

function snapshot(): string {
  const vv = window.visualViewport
  const nav = document.querySelector<HTMLElement>('nav.fixed')
  const navRect = nav?.getBoundingClientRect()
  const meta = document.querySelector('meta[name="viewport"]')?.getAttribute('content')
  const num = (n: number | undefined) => (n === undefined ? 'n/a' : Math.round(n * 100) / 100)
  const lines: [string, string | number][] = [
    ['version', __APP_VERSION__],
    ['installed app (standalone)', isInstalledApp() ? 'yes' : 'no'],
    ['display-mode standalone', String(matchMedia('(display-mode: standalone)').matches)],
    ['navigator.standalone', String((navigator as Navigator & { standalone?: boolean }).standalone)],
    ['viewport meta', meta ?? 'none'],
    ['--- sizes (CSS px) ---', ''],
    ['screen w x h', `${screen.width} x ${screen.height}`],
    ['innerWidth x innerHeight', `${innerWidth} x ${innerHeight}`],
    ['outerHeight', outerHeight],
    ['visualViewport w x h', vv ? `${num(vv.width)} x ${num(vv.height)}` : 'n/a'],
    ['visualViewport offsetTop', num(vv?.offsetTop)],
    ['visualViewport scale', num(vv?.scale)],
    ['100vh / 100dvh', `${probe('top:0;height:100vh').height} / ${probe('top:0;height:100dvh').height}`],
    ['100svh / 100lvh', `${probe('top:0;height:100svh').height} / ${probe('top:0;height:100lvh').height}`],
    ['fixed bottom:0 element bottom edge', probe('bottom:0;height:1px').bottom],
    ['--- safe-area insets ---', ''],
    ['top / bottom', `${inset('top')} / ${inset('bottom')}`],
    ['left / right', `${inset('left')} / ${inset('right')}`],
    ['--- page ---', ''],
    ['scrollY', num(scrollY)],
    ['document scrollHeight', document.documentElement.scrollHeight],
    ['body scrollHeight', document.body.scrollHeight],
    ['tab bar top / bottom', navRect ? `${num(navRect.top)} / ${num(navRect.bottom)}` : 'not on this page'],
    ['devicePixelRatio', devicePixelRatio],
    ['pointer: coarse', String(matchMedia('(pointer: coarse)').matches)],
  ]
  return lines.map(([k, v]) => (v === '' ? k : `${k}: ${v}`)).join('\n')
}

// A readout of what the browser reports about screen size and safe areas, for
// tracking down layout problems that only show up on a real phone. Opened by
// tapping the version label five times; screenshot it or copy it.
export function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState(snapshot)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const refresh = () => setText(snapshot())
    window.addEventListener('resize', refresh)
    window.addEventListener('scroll', refresh, { passive: true })
    window.visualViewport?.addEventListener('resize', refresh)
    window.visualViewport?.addEventListener('scroll', refresh)
    const timer = setInterval(refresh, 1000)
    return () => {
      window.removeEventListener('resize', refresh)
      window.removeEventListener('scroll', refresh)
      window.visualViewport?.removeEventListener('resize', refresh)
      window.visualViewport?.removeEventListener('scroll', refresh)
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="fixed inset-x-3 top-16 z-50 rounded-card border border-subtle bg-surface p-4 text-text shadow-raised">
      <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug">
        {text}
      </pre>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true))
          }}
          className="rounded-control bg-primary px-3 py-1.5 text-sm font-semibold text-bg"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-control border border-subtle px-3 py-1.5 text-sm text-muted"
        >
          Close
        </button>
      </div>
    </div>
  )
}
