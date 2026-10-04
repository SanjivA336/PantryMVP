import { trackRequest } from './serverWake'
import { supabase } from './supabaseClient'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim()

if (!API_BASE_URL) {
  throw new Error('Missing VITE_API_BASE_URL. Check your .env file.')
}

// Fire-and-forget request to the backend's health check, sent as soon as the
// app loads (even on the login page). On the free hosting tier the backend
// sleeps when idle; waking it while someone is still typing their password
// means it's usually ready by their first real request, so most people never
// see the "waking up" banner at all. no-cors because the response is never
// read, only the wake-up matters; /health is exempt from rate limiting and
// doesn't touch the database.
export function warmUpServer(): void {
  fetch(`${API_BASE_URL}/health`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {
    // Nothing to do: if the server is down, the first real request reports it.
  })
}

interface Envelope<T> {
  status: 'success' | 'error'
  data: T | null
  error: { code: string; message: string } | null
  timestamp: string
}

export class ApiError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

// A hard page reload occasionally hits the network before the browser has
// fully re-established itself (observed via Playwright: `TypeError: Failed
// to fetch` on the first request right after `location.reload()`), and a
// page that fires several concurrent GETs at once (e.g. household + items +
// warnings all loading together) can occasionally trip a transient
// connection-pool hiccup on the dev backend. Retrying is safe here because
// we only do it for GET: a lost POST/PATCH/DELETE might have actually
// reached the server, and blindly retrying a mutation risks duplicating it.
const GET_RETRY_ATTEMPTS = 2

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(url, init)
    } catch (err) {
      // An aborted request (our own timeout firing) should never be
      // retried: retrying would just wait out a second full timeout
      // before the caller ever sees an error.
      if (
        init.method !== 'GET' ||
        attempt >= GET_RETRY_ATTEMPTS ||
        (err as Error)?.name === 'AbortError'
      ) {
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
}

async function request<T>(path: string, options: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    throw new ApiError('NO_SESSION', 'You must be signed in to do that.')
  }

  // Only used by the AI recipe endpoints today: a local Ollama call can
  // take 10-20+ seconds, well past what's reasonable to let a normal CRUD
  // request hang for, so this is opt-in per call rather than a global default.
  const controller = timeoutMs !== undefined ? new AbortController() : undefined
  const timeoutId =
    controller !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined

  // Lets the UI say "waking up the server" if this hangs (see serverWake.ts).
  // Skipped for requests with their own explicit timeout: today that's only
  // the AI endpoints, which are slow by nature and not a sign of a sleeping
  // server.
  const endTracking = timeoutMs === undefined ? trackRequest() : undefined

  let response: Response
  try {
    response = await fetchWithRetry(`${API_BASE_URL}${path}`, {
      ...options,
      // The internal timeout controller (POST-only, see opts.timeoutMs)
      // takes priority when present; otherwise fall back to whatever signal
      // the caller passed in directly (e.g. GET's own cancellation signal
      // below) -- these two never overlap in practice today, since only
      // GET accepts an external signal and only POST uses a timeout.
      signal: controller?.signal ?? options.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...options.headers,
      },
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'That took too long to respond. Please try again.')
    }
    // A raw browser-level network failure (e.g. the dev server was mid
    // -reload, or the connection dropped) -- wrapped into the same ApiError
    // shape as every other failure mode so callers never see a bare
    // TypeError, and can filter this transient class of error out when it's
    // not worth surfacing (see RecipesPage, which treats it the same as
    // "nothing loaded yet" rather than an alarming error banner).
    throw new ApiError(
      'NETWORK',
      'Could not reach the server. Check your connection and try again.',
    )
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    endTracking?.()
  }

  let envelope: Envelope<T>
  try {
    envelope = await response.json()
  } catch {
    // A non-JSON error body (a dead backend, a proxy's own error page)
    // would otherwise throw a raw SyntaxError instead of the app's own
    // ApiError, which every caller already knows how to handle.
    throw new ApiError(String(response.status), 'Request failed')
  }

  if (envelope.status === 'error' || !response.ok) {
    const code = envelope.error?.code ?? String(response.status)
    // A 401 here means the backend rejected this token outright -- expired,
    // malformed, or (see core/auth.py's get_current_user_id) the account it
    // names no longer exists at all. Whatever the reason, the local session
    // is stale and every other call on this page is about to fail the same
    // way, so clear it now rather than leaving the caller to show a raw
    // error with no way out -- AuthGuard reacts to the session going null
    // and bounces to /login on its own. `scope: 'local'` only clears this
    // browser's copy, no network call: there's nothing meaningful left to
    // invalidate server-side for a token whose account may already be gone.
    if (response.status === 401) {
      void supabase.auth.signOut({ scope: 'local' })
    }
    throw new ApiError(code, envelope.error?.message ?? 'Request failed')
  }

  return envelope.data as T
}

export const apiClient = {
  get: <T>(path: string, opts?: { signal?: AbortSignal }) =>
    request<T>(path, { method: 'GET', signal: opts?.signal }),
  post: <T>(path: string, body?: unknown, opts?: { timeoutMs?: number }) =>
    request<T>(
      path,
      {
        method: 'POST',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      opts?.timeoutMs,
    ),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
