import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

interface BaseAction {
  label: string
}
type EmptyStateAction = (BaseAction & { to: string }) | (BaseAction & { onClick: () => void })

interface Props {
  icon: IconComponent
  title: string
  // Optional second line -- e.g. "Add a storage location before adding items."
  hint?: string
  // Optional primary CTA. `to` renders a router Link, `onClick` a button.
  action?: EmptyStateAction
}

// The one dashed-outline "nothing here yet" placeholder, used everywhere a
// list/collection can be empty (inventory, storage, recipes, shopping list,
// activity, members, receipts). Keeps the markup identical across the app
// instead of eight near-copies.
export function EmptyState({ icon: Icon, title, hint, action }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-subtle p-10 text-center">
      <Icon size={28} strokeWidth={1.5} className="text-faint" />
      <p className="text-sm text-muted">{title}</p>
      {hint && <p className="-mt-1.5 max-w-xs text-xs text-faint">{hint}</p>}
      {action &&
        ('to' in action ? (
          <Link
            to={action.to}
            className="mt-1 rounded-control bg-primary px-3 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover"
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-1 rounded-control bg-primary px-3 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover"
          >
            {action.label}
          </button>
        ))}
    </div>
  )
}
