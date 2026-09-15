import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'
import { CrashFallback } from './components/CrashFallback.tsx'

// A no-op until VITE_SENTRY_DSN is actually set -- no account needed for
// local dev. Sentry's browser SDK auto-captures uncaught errors and
// unhandled promise rejections on its own once initialized; the
// ErrorBoundary below additionally catches React render-time crashes,
// which those global handlers don't reliably see.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
