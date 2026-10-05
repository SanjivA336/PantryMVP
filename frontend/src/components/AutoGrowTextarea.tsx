import { useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

// A textarea that is as tall as its text: it starts at one row and grows as you
// type, so a long sentence is fully visible instead of scrolling sideways inside
// a one-line box. Takes the same props as a plain <textarea>.
export function AutoGrowTextarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // scrollHeight leaves out the border but the box's height includes it
    // (border-box), so add it back or the last couple of pixels get cut off.
    const border = el.offsetHeight - el.clientHeight
    el.style.height = `${el.scrollHeight + border}px`
  }

  // Whenever the text changes...
  useLayoutEffect(fit, [props.value])
  // ...and when the width changes (rotation), since that changes where lines wrap.
  useEffect(() => {
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  return <textarea ref={ref} rows={1} className={`resize-none overflow-hidden ${className}`} {...props} />
}
