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
// to fetch` on the first request right after `location.reload()`). Retrying
// once is safe here because we only do it for GET — a lost POST/PATCH/DELETE
// might have actually reached the server, and blindly retrying a mutation
// risks duplicating it.
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    if (init.method !== 'GET') throw err
    await new Promise((resolve) => setTimeout(resolve, 300))
    return fetch(url, init)
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    throw new ApiError('NO_SESSION', 'You must be signed in to do that.')
  }

  const response = await fetchWithRetry(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  })

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
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
