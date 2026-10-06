import {
  markServerAwake,
  msSinceServerAwake,
  setProbeWaking,
  setUnreachable,
  trackRequest,
} from './serverWake'
import { supabase } from './supabaseClient'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim()

if (!API_BASE_URL) {
  throw new Error('Missing VITE_API_BASE_URL. Check your .env file.')
}

// Checks whether the backend is awake, as soon as the app loads (even on the login
// page), and starts waking it if it was asleep.
//
// On the free hosting tier the backend sleeps when idle and the first request after
// that can wait 30 to 60 seconds. Waiting for a real request to hang for 10 seconds
// before saying anything left the app looking frozen, so this asks the health check
// up front and, if there is no answer within PROBE_GRACE_MS, shows the "getting
// things ready" screen right away. It keeps asking until the server answers, and the
// screen disappears at that moment.
//
// The answer is read (not sent with no-cors) because the API allows this site's
// origin. /health is exempt from rate limiting and doesn't touch the database.
//
// An offline phone is not a sleeping server: if the browser says it is offline the
// check stops (the slim offline banner covers that case) and tries again when the
// connection comes back. If the server has not answered after PROBE_GIVE_UP_MS it is
// no longer "waking up": the screen switches to "we couldn't connect", and the check
// carries on every PROBE_SLOW_RETRY_MS until it gets through. retryConnection() asks
// right away (the "Try again" button).
const PROBE_GRACE_MS = 1_500
const PROBE_ATTEMPT_TIMEOUT_MS = 5_000
const PROBE_RETRY_MS = 2_000
const PROBE_GIVE_UP_MS = 90_000
const PROBE_SLOW_RETRY_MS = 10_000
// The free tier sleeps after about 15 minutes idle; checking again after a quarter of
// that is cheap and keeps the early signal for people who come back to an open tab.
const IDLE_RECHECK_MS = 5 * 60_000

let probing = false
let retryNow: (() => void) | undefined

export function warmUpServer(): void {
  if (probing) return
  probing = true
  const startedAt = Date.now()
  let answered = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const showTimer = setTimeout(() => {
    if (!answered) setProbeWaking(true)
  }, PROBE_GRACE_MS)

  const finish = () => {
    probing = false
    retryNow = undefined
    clearTimeout(showTimer)
    clearTimeout(retryTimer)
    setProbeWaking(false)
    setUnreachable(false)
  }

  const attempt = async () => {
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), PROBE_ATTEMPT_TIMEOUT_MS)
    try {
      const response = await fetch(`${API_BASE_URL}/health`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      clearTimeout(abortTimer)
      if (response.ok) {
        answered = true
        markServerAwake()
        finish()
        return
      }
    } catch {
      clearTimeout(abortTimer)
    }

    if (!navigator.onLine) {
      finish()
      window.addEventListener('online', warmUpServer, { once: true })
      return
    }

    const gaveUp = Date.now() - startedAt > PROBE_GIVE_UP_MS
    if (gaveUp) {
      setProbeWaking(false)
      setUnreachable(true)
    }
    retryTimer = setTimeout(() => void attempt(), gaveUp ? PROBE_SLOW_RETRY_MS : PROBE_RETRY_MS)
  }

  retryNow = () => {
    clearTimeout(retryTimer)
    void attempt()
  }
  void attempt()
}

// The "Try again" button: check the server right now instead of waiting for the next
// scheduled check.
export function retryConnection(): void {
  retryNow?.()
}

// Checks again when the tab comes back to the foreground after a while, so someone
// returning to an open tab gets the early signal too. Returns the cleanup function.
export function watchForIdleReturn(): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible' && msSinceServerAwake() > IDLE_RECHECK_MS) {
      warmUpServer()
    }
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => document.removeEventListener('visibilitychange', onVisible)
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

  // Whatever the status, an answer means the server is awake.
  markServerAwake()

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
