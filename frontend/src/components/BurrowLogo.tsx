import logoSource from '../assets/logo.svg?raw'

// The raw SVG source (Vite's `?raw` import), recolored to `currentColor` and
// resized to fill its container -- injected as real inline SVG so it can
// follow hover state via a wrapping element's `text-*` class, the same way
// lucide-react's icons already do. An <img> can't do this: its pixels are
// opaque to CSS, so its color could never follow the sidebar's hover state.
// Safe to inject as-is (dangerouslySetInnerHTML) since it's our own
// build-time asset, never user- or runtime-supplied content.
const coloredLogo = logoSource
  .replace(/#ffffff/gi, 'currentColor')
  .replace(/width="[\d.]+"/, 'width="100%"')
  .replace(/height="[\d.]+"/, 'height="100%"')

export function BurrowLogo({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: coloredLogo }}
    />
  )
}
