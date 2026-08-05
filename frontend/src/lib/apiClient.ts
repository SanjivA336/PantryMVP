import { supabase } from './supabaseClient'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

if (!API_BASE_URL) {
  throw new Error('Missing VITE_API_BASE_URL — check your .env file.')
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
// we only do it for GET — a lost POST/PATCH/DELETE might have actually
// reached the server, and blindly retrying a mutation risks duplicating it.
const GET_RETRY_ATTEMPTS = 2

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(url, init)
    } catch (err) {
      // An aborted request (our own timeout firing) should never be
      // retried — retrying would just wait out a second full timeout
      // before the caller ever sees an error.
      if (init.method !== 'GET' || attempt >= GET_RETRY_ATTEMPTS || (err as Error)?.name === 'AbortError') {
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    throw new ApiError('NO_SESSION', 'You must be signed in to do that.')
  }

  // Only used by the AI recipe endpoints today — a local Ollama call can
  // take 10-20+ seconds, well past what's reasonable to let a normal CRUD
  // request hang for, so this is opt-in per call rather than a global default.
  const controller = timeoutMs !== undefined ? new AbortController() : undefined
  const timeoutId =
    controller !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined

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
    throw new ApiError('NETWORK', 'Could not reach the server. Check your connection and try again.')
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
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
    throw new ApiError(
      envelope.error?.code ?? String(response.status),
      envelope.error?.message ?? 'Request failed',
    )
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
