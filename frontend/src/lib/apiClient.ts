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
      signal: controller?.signal,
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
    throw err
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }

  const envelope: Envelope<T> = await response.json()

  if (envelope.status === 'error' || !response.ok) {
    throw new ApiError(
      envelope.error?.code ?? String(response.status),
      envelope.error?.message ?? 'Request failed',
    )
  }

  return envelope.data as T
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
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
