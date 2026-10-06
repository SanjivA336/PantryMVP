// Turns a burst of "something changed" signals into one call.
//
// `trigger()` waits until `quietMs` have passed with no further trigger, then
// calls `fire` once. If triggers keep arriving, it still fires `maxWaitMs` after
// the first one of the burst, so a steady stream can't postpone it forever.
// `cancel()` drops anything pending (used when the thing listening goes away).
export interface Coalescer {
  trigger: () => void
  cancel: () => void
}

export function createCoalescer(fire: () => void, quietMs: number, maxWaitMs: number): Coalescer {
  let timer: ReturnType<typeof setTimeout> | undefined
  let firstAt = 0

  const run = () => {
    timer = undefined
    firstAt = 0
    fire()
  }

  return {
    trigger() {
      const now = Date.now()
      if (timer === undefined) firstAt = now
      else clearTimeout(timer)
      timer = setTimeout(run, Math.max(0, Math.min(quietMs, firstAt + maxWaitMs - now)))
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      firstAt = 0
    },
  }
}
