import { apiClient } from './apiClient'

// One shared copy of every API resource the app has loaded, keyed by its URL.
//
// Why it exists: pages used to keep their own private copy and refetch on every
// visit (the member list was fetched in about seven places), and every reload
// blanked the screen to "Loading…" first. With the server a round trip or two
// away, that is what made navigation feel slow. Now a screen shows the copy it
// already has immediately and refreshes it in the background ("stale while
// revalidate").
//
// Rules this keeps:
//  - Requests for the same URL that overlap share one network call.
//  - The newest request wins: a slow older response never overwrites newer data.
//  - Anything fetched in the last FRESH_MS is not fetched again (several parts of
//    one screen asking for the same thing at the same moment cost one request).
//    A forced reload (after a change, or a live update from another device)
//    always goes to the network.
//  - Everything is thrown away on sign-out, so one account's data can never be
//    shown to the next person on the same device.

const FRESH_MS = 2000
const MAX_ENTRIES = 200

interface Entry {
  data: unknown
  // 0 means "known to be out of date": shown, but refetched on the next ask.
  fetchedAt: number
}

const entries = new Map<string, Entry>()
const listeners = new Map<string, Set<() => void>>()
const inFlight = new Map<string, Promise<unknown>>()
const newestRequest = new Map<string, number>()
let requestCounter = 0
// Bumped on sign-out so a response that was still on its way back cannot put
// the previous account's data into the fresh cache.
let generation = 0

function notify(path: string) {
  listeners.get(path)?.forEach((listener) => listener())
}

function store(path: string, data: unknown, fetchedAt: number) {
  entries.delete(path) // re-inserting moves it to the "most recent" end
  entries.set(path, { data, fetchedAt })
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest !== undefined) {
      entries.delete(oldest)
      notify(oldest)
    }
  }
  notify(path)
}

export function peekResource<T>(path: string): T | undefined {
  return entries.get(path)?.data as T | undefined
}

export function subscribeResource(path: string, listener: () => void): () => void {
  let set = listeners.get(path)
  if (!set) {
    set = new Set()
    listeners.set(path, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(path)
  }
}

// Replaces what is shown for `path` without a network call (an optimistic
// update). It does not count as a fresh fetch, so the next ask still refetches
// and the server's answer wins.
export function setResource<T>(path: string, data: T) {
  store(path, data, entries.get(path)?.fetchedAt ?? 0)
}

export function deleteResource(path: string) {
  if (entries.delete(path)) notify(path)
}

export function fetchResource<T>(path: string, options: { force?: boolean } = {}): Promise<T> {
  if (!options.force) {
    const existing = entries.get(path)
    if (existing && Date.now() - existing.fetchedAt < FRESH_MS) {
      return Promise.resolve(existing.data as T)
    }
    const pending = inFlight.get(path)
    if (pending) return pending as Promise<T>
  }

  const id = ++requestCounter
  const startedIn = generation
  newestRequest.set(path, id)
  const promise: Promise<T> = apiClient
    .get<T>(path)
    .then((data) => {
      if (startedIn === generation && newestRequest.get(path) === id) {
        store(path, data, Date.now())
      }
      return data
    })
    .finally(() => {
      if (inFlight.get(path) === promise) inFlight.delete(path)
    })
  inFlight.set(path, promise)
  return promise
}

// "Everything on screen may be out of date": keep showing it, but make the next
// ask refetch (used by pull-to-refresh).
export function invalidateResources() {
  for (const entry of entries.values()) entry.fetchedAt = 0
}

// Refetches everything a mounted screen is currently showing (used when the connection
// comes back, to replace anything that went out of date while offline). Resources no
// screen is showing are left alone; they refetch when they are next opened.
export function refetchActiveResources() {
  for (const path of listeners.keys()) void fetchResource(path, { force: true }).catch(() => {})
}

export function clearResourceCache() {
  generation += 1
  const paths = [...entries.keys()]
  entries.clear()
  inFlight.clear()
  newestRequest.clear()
  paths.forEach(notify)
}
