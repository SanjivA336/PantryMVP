import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface ScrollSpySection {
  id: string
  label: string
  icon: LucideIcon
}

interface Props {
  sections: ScrollSpySection[]
}

// A floating, icon-only rail for jumping between stacked sections on a
// single scrollable page -- desktop only (hidden md:flex below), since
// there's no room for a fixed side rail on a phone-width screen.
export function ScrollSpy({ sections }: Props) {
  const [activeId, setActiveId] = useState(sections[0]?.id)

  useEffect(() => {
    const elements = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0) return

    // Shrinks the effective viewport to a thin band near the top of the
    // screen (20%-30% down) -- without this, a tall section stays
    // "intersecting" for its entire scroll length, which either flickers
    // between neighbors or leaves several marked active at once.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        const topMost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        )
        setActiveId(topMost.target.id)
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    )
    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [sections])

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav
      aria-label="Section navigation"
      className="fixed top-1/2 right-4 z-20 hidden -translate-y-1/2 flex-col gap-1 rounded-card border border-subtle bg-surface p-1.5 shadow-raised md:flex"
    >
      {sections.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => scrollToSection(id)}
          title={label}
          aria-label={label}
          aria-current={activeId === id ? 'true' : undefined}
          className={`rounded-control p-2 transition-colors ${
            activeId === id
              ? 'bg-primary-soft text-primary'
              : 'text-faint hover:bg-surface-hover hover:text-text'
          }`}
        >
          <Icon size={18} strokeWidth={1.75} />
        </button>
      ))}
    </nav>
  )
}
