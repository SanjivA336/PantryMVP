import { useEffect } from 'react'

// Every routed page calls this with its own name -- falsy (a name that
// hasn't loaded yet, e.g. a recipe title still in flight) leaves the
// previous title alone rather than flashing a bare "Burrow" mid-load.
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return
    const previous = document.title
    document.title = `${title} · Burrow`
    return () => {
      document.title = previous
    }
  }, [title])
}
