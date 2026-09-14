// One-off generator for the PWA icon set, run manually via
// `node scripts/gen-pwa-icons.cjs` whenever the brand mark changes --
// rasterizes the real app logo (src/assets/logo.svg) with Playwright/
// Chromium instead of pulling in an image-processing dependency just for
// this. Not part of the build; output is committed straight into public/pwa.
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const OUT_DIR = path.join(__dirname, '..', 'public', 'pwa')
const LOGO_PATH = path.join(__dirname, '..', 'src', 'assets', 'logo.svg')

const BG = '#0c0d0d' // --color-bg
const FG = '#3ecf8e' // --color-primary

const logoRaw = fs.readFileSync(LOGO_PATH, 'utf8').replace(/#ffffff/gi, FG)

function page(size, logoScale, background) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:${background};overflow:hidden;}
    .wrap{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${background};}
    .logo{width:${Math.round(size * logoScale)}px;height:${Math.round(size * logoScale)}px;}
    svg{width:100%;height:100%;display:block;}
  </style></head><body><div class="wrap"><div class="logo">${logoRaw}</div></div></body></html>`
}

async function shot(browser, size, logoScale, background, filename) {
  const p = await browser.newPage({ viewport: { width: size, height: size } })
  await p.setViewportSize({ width: size, height: size })
  await p.setContent(page(size, logoScale, background))
  await p.waitForTimeout(50)
  await p.screenshot({ path: path.join(OUT_DIR, filename), omitBackground: false })
  await p.close()
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()

  // "any" purpose -- logo fills most of the canvas, safe for launchers that
  // show it unmasked.
  await shot(browser, 192, 0.68, BG, 'icon-192.png')
  await shot(browser, 512, 0.68, BG, 'icon-512.png')

  // "maskable" purpose -- OSes crop these to their own shape (circle,
  // squircle, ...), so the mark sits well inside the ~80%-diameter safe
  // zone the spec recommends.
  await shot(browser, 192, 0.45, BG, 'icon-maskable-192.png')
  await shot(browser, 512, 0.45, BG, 'icon-maskable-512.png')

  // iOS ignores maskable/transparency nuance and applies its own rounded-
  // square mask -- a plain solid-background icon at its expected size.
  await shot(browser, 180, 0.62, BG, 'apple-touch-icon.png')

  await browser.close()
  console.log('Icons written to', OUT_DIR)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
