import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The repo keeps a single .env at the project root (shared with the
  // backend) instead of a separate frontend/.env — point Vite at it.
  envDir: path.resolve(__dirname, '..'),
  server: {
    port: 5173,
  },
})
