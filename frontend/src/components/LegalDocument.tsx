import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LegalBlock, LegalDocument as LegalDoc } from '../legal/types'

// Splits a string into plain text, **bold** runs and bare URLs. The trailing
// character class stops a URL from swallowing the full stop that ends the
// sentence it sits in.
const INLINE_TOKEN = /(\*\*[^*]+\*\*|https?:\/\/\S*[^\s.,;)])/g

function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE_TOKEN).filter(Boolean)
  return (
    <>
      {parts.map((part, i): ReactNode => {
        if (part.startsWith('**')) {
          return (
            <strong key={i} className="font-semibold text-text">
              {part.slice(2, -2)}
            </strong>
          )
        }
        if (part.startsWith('http')) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:text-primary-hover hover:underline"
            >
              {part}
            </a>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// Consecutive bullet blocks become one <ul>, so the data stays a flat list
// (easy to generate from the Word source) while the markup is still valid.
function renderBlocks(blocks: LegalBlock[]): ReactNode[] {
  const out: ReactNode[] = []
  let bullets: string[] = []

  const flushBullets = (key: string) => {
    if (bullets.length === 0) return
    out.push(
      <ul key={key} className="mb-4 ml-5 list-disc space-y-2 text-sm leading-relaxed text-muted">
        {bullets.map((b, i) => (
          <li key={i}>
            <Inline text={b} />
          </li>
        ))}
      </ul>,
    )
    bullets = []
  }

  blocks.forEach((block, i) => {
    if (block.type === 'bullet') {
      bullets.push(block.text)
      return
    }
    flushBullets(`ul-${i}`)

    if (block.type === 'h2') {
      out.push(
        <h2 key={i} className="mb-2 mt-8 text-lg font-semibold text-text">
          {block.text}
        </h2>,
      )
    } else if (block.type === 'p') {
      out.push(
        <p key={i} className="mb-4 text-sm leading-relaxed text-muted">
          <Inline text={block.text} />
        </p>,
      )
    } else {
      out.push(
        <div key={i} className="mb-4 overflow-x-auto rounded-card border border-subtle">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <thead className="bg-surface-2 text-text">
              <tr>
                {block.header.map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-muted">
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-subtle align-top">
                  {row.map((cell, c) => (
                    <td key={c} className="px-3 py-2">
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
    }
  })
  flushBullets('ul-end')
  return out
}

interface Props {
  doc: LegalDoc
  // The sibling document, offered as a link so a reader can hop between the
  // two without going back through the app.
  other: { label: string; to: string }
}

export function LegalDocument({ doc, other }: Props) {
  return (
    <div className="min-h-app bg-bg px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-text">
      <div className="mx-auto w-full max-w-2xl py-6">
        <div className="mb-6 flex items-center justify-between gap-3 text-sm">
          <Link to="/" className="font-medium text-primary hover:text-primary-hover">
            Burrow
          </Link>
          <Link to={other.to} className="font-medium text-muted hover:text-text hover:underline">
            {other.label}
          </Link>
        </div>

        <div className="rounded-card border border-subtle bg-surface p-6 shadow-card sm:p-8">
          <h1 className="text-2xl font-semibold">{doc.title}</h1>
          <p className="mb-6 mt-1 border-b border-subtle pb-4 text-sm text-faint">
            Last updated: {doc.updated}
          </p>
          {renderBlocks(doc.blocks)}
        </div>
      </div>
    </div>
  )
}
