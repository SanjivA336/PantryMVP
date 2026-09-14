import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Service worker runs under `npm run dev` too, not just the build --
      // this whole app has been tested against the dev server all along,
      // and installability is easiest to verify there.
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'Burrow',
        short_name: 'Burrow',
        description: 'Household pantry tracking: inventory, shopping lists, cost splitting, and recipes.',
        // Matches --color-bg / --color-primary in index.css -- the app's
        // actual off-black/green identity, not generic PWA defaults.
        theme_color: '#0c0d0d',
        background_color: '#0c0d0d',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/pwa/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/pwa/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Default globPatterns already precache the built JS/CSS/HTML app
        // shell. Nothing here targets /api/* (a different origin in dev,
        // and deliberately never given a runtimeCaching rule even in prod)
        // -- API calls always hit the network fresh, never served stale
        // from a cache. The app shell loading instantly offline is the
        // actual PWA win; a data app like this one can't safely fake
        // offline data without a lot more (queuing, conflict resolution)
        // than this pass is scoped for.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
  // The repo keeps a single .env at the project root (shared with the
  // backend) instead of a separate frontend/.env — point Vite at it.
  envDir: path.resolve(__dirname, '..'),
  server: {
    port: 5173,
  },
})
