// Sentry's ErrorBoundary fallback (see main.tsx) for a React render-time
// crash it couldn't recover from -- reloading is the only real remedy at
// this point, since whatever component tree broke is already unmounted.
export function CrashFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4 text-text">
      <div className="w-full max-w-sm rounded-card border border-subtle bg-surface p-7 text-center shadow-card">
        <p className="mb-1 text-sm font-medium text-primary">Burrow</p>
        <h1 className="mb-3 text-xl font-semibold">Something went wrong</h1>
        <p className="mb-5 text-sm text-muted">
          Sorry about that -- reloading the page usually fixes it.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full rounded-control bg-primary px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover"
        >
          Reload
        </button>
      </div>
    </div>
  )
}
