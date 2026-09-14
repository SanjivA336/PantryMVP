import { useMemo, useState, type ComponentType } from 'react'
import { Plus, ShoppingCart, Utensils } from 'lucide-react'
import { apiClient, ApiError } from '../lib/apiClient'
import { FoodSearchInput } from './FoodSearchInput'
import { Modal } from './Modal'
import { useAddItemWizard } from '../hooks/useAddItemWizard'
import { useAuth } from '../hooks/useAuth'
import { useHouseholdResource } from '../hooks/useHouseholdResource'
import { UseItemModal } from '../pages/inventory/UseItemModal'
import type { FoodDefinition, InventoryItem, Member, StockWarning } from '../types/entities'

interface Props {
  householdId: string
}

type Panel = 'use' | 'shop' | null

interface Shortcut {
  key: string
  label: string
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  onSelect: () => void
}

// Tried matching the FAB's resting diameter to the bar's own height (64px)
// -- measured with Playwright and confirmed it backfired: the *open* size
// (a further 8px bigger, to still read as "growing") no longer fits inside
// the 64px bar at all, overflowing 3.5px above and 4.5px below -- and since
// the bar is pinned to the actual viewport edge, that bottom overflow
// renders truly off-screen, not just visually crowded. Back to sizes that
// fit inside the bar in both states, with headroom for the open one.
const FAB_SIZE_REST = 56
const FAB_SIZE_OPEN = 64

// Shortcuts fan out across this arc (measured in the usual math convention:
// 0deg = straight right, 90deg = straight up, 180deg = straight left), never
// reaching all the way to 0/180 so the outermost nodes stay comfortably
// above the bar instead of leveling out with the button. Adding a 4th (or
// 5th) shortcut is just another entry in the array below -- arcPosition
// spaces however many there are evenly across this same range.
const ARC_START_DEG = 150
const ARC_END_DEG = 30
const ARC_RADIUS = 92

function arcPosition(index: number, count: number) {
  const angleDeg =
    count === 1 ? 90 : ARC_START_DEG - ((ARC_START_DEG - ARC_END_DEG) * index) / (count - 1)
  const angleRad = (angleDeg * Math.PI) / 180
  return {
    x: ARC_RADIUS * Math.cos(angleRad),
    y: -ARC_RADIUS * Math.sin(angleRad),
  }
}

// FIRST DRAFT -- a real, working version of the radial shortcut menu (center
// FAB, shortcuts fanning out in an arc above it) sketched out in the
// conversation, not just a mockup. Expect to come back and adjust: which 3
// actions live here, how "Add item" should behave (currently just navigates
// to the full page -- see the conversation for why a lighter modal version
// was the eventual idea), animation timing/easing, icon choices.
//
// Rendered as an actual flex child in HouseholdShell's bottom bar (its own
// dedicated middle slot, between two equal-width groups of two tabs each)
// rather than a separately-positioned floating overlay -- that guarantees
// this sits exactly centered between the two tab groups for free, since
// both groups are `flex-1` and split the remaining width equally, instead
// of trusting two independent "center it in the viewport" calculations (one
// for the bar's tabs, one for this) to agree. Mobile-only by design (see
// HouseholdShell) -- desktop already has everything one click away.
export function MobileShortcutMenu({ householdId }: Props) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const addItemWizard = useAddItemWizard(householdId)

  const close = () => {
    setOpen(false)
    setPanel(null)
  }

  const shortcuts: Shortcut[] = [
    {
      key: 'add-item',
      label: 'Add item',
      icon: Plus,
      onSelect: () => {
        close()
        addItemWizard.open()
      },
    },
    {
      key: 'use-item',
      label: 'Use item',
      icon: Utensils,
      onSelect: () => {
        setOpen(false)
        setPanel('use')
      },
    },
    {
      key: 'add-to-list',
      label: 'Add to list',
      icon: ShoppingCart,
      onSelect: () => {
        setOpen(false)
        setPanel('shop')
      },
    },
  ]

  return (
    <>
      {/* Backdrop -- a lighter dim than a real modal's, just enough to say
          "this is what's in focus," not full-screen darkening. `fixed`
          escapes this component's own slot in the bar to cover the whole
          viewport regardless. Always mounted (not conditionally rendered)
          so it can fade both ways instead of popping. */}
      <button
        type="button"
        aria-label="Close shortcuts"
        onClick={close}
        tabIndex={open ? 0 : -1}
        className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 md:hidden ${
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Sized to the FAB's resting box and never resized itself -- every
          arc node's "zero position" (left-1/2 top-1/2) lands exactly on the
          button's own center this way, no matter how the button's own size
          changes on open. Positioned by its parent slot in HouseholdShell's
          bottom bar (`relative flex items-center justify-center`) -- this
          only needs `relative` for the arc nodes' own absolute anchor. */}
      <div
        className="relative z-30 flex items-center justify-center"
        style={{ height: FAB_SIZE_REST, width: FAB_SIZE_REST }}
      >
        {shortcuts.map((s, i) => {
          const { x, y } = arcPosition(i, shortcuts.length)
          const Icon = s.icon
          return (
            <div
              key={s.key}
              style={{
                transform: `translate(-50%, -50%) translate(${open ? x : 0}px, ${open ? y : 0}px) scale(${open ? 1 : 0.3})`,
                opacity: open ? 1 : 0,
                // Left-to-right stagger on the way out; reversed (and
                // quicker) on the way back in so the menu folds up in the
                // same order it unfolded, just backwards.
                transitionDelay: open ? `${i * 60}ms` : `${(shortcuts.length - 1 - i) * 40}ms`,
              }}
              // A fixed width matters here, not just styling -- this box
              // is absolutely positioned inside the 56px FAB anchor, and
              // without an explicit width, the browser's shrink-to-fit
              // sizing for `width: auto` only gets to consider the sliver
              // of "available width" to the right of its left-1/2 anchor
              // *inside that 56px parent* (the transform that later moves
              // it out to its arc position is purely visual and happens
              // too late to change this), which was forcing every label
              // longer than a couple letters to wrap.
              className="absolute left-1/2 top-1/2 flex w-20 flex-col items-center gap-1 transition-all duration-300 ease-out"
            >
              <button
                type="button"
                disabled={!open}
                onClick={s.onSelect}
                title={s.label}
                aria-label={s.label}
                className="pointer-events-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-subtle bg-surface-2 text-text shadow-raised transition-colors hover:bg-surface-hover"
              >
                <Icon size={18} strokeWidth={2} />
              </button>
              <span
                className="text-center text-xs font-medium text-text"
                style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}
              >
                {s.label}
              </span>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close shortcuts' : 'Open shortcuts'}
          aria-expanded={open}
          // shrink-0 matters here: this button is a normal-flow flex item
          // of the fixed-56px-wide anchor box below it, and width is the
          // main axis for a row-direction flex container -- without this,
          // the browser was flex-shrinking the button's explicit width
          // back down to fit that 56px box every render, while height
          // (the cross axis, never shrunk by flex-shrink) grew as
          // intended. Same box, same bug either axis could have hit.
          className="pointer-events-auto relative z-10 flex shrink-0 items-center justify-center rounded-full bg-primary text-bg shadow-raised transition-all duration-200 hover:bg-primary-hover"
          style={{
            height: open ? FAB_SIZE_OPEN : FAB_SIZE_REST,
            width: open ? FAB_SIZE_OPEN : FAB_SIZE_REST,
          }}
        >
          <Plus
            size={open ? 28 : 24}
            strokeWidth={2.25}
            className={`transition-transform duration-200 ${open ? 'rotate-45' : ''}`}
          />
        </button>
      </div>

      {panel === 'use' && (
        <QuickUseModal householdId={householdId} onClose={() => setPanel(null)} />
      )}
      {panel === 'shop' && (
        <QuickAddToListModal householdId={householdId} onClose={() => setPanel(null)} />
      )}
      {addItemWizard.modal}
      {addItemWizard.error && (
        <Modal title="Can't add an item yet" onClose={addItemWizard.dismissError}>
          <p className="text-sm text-muted">{addItemWizard.error}</p>
        </Modal>
      )}
    </>
  )
}

function QuickUseModal({ householdId, onClose }: { householdId: string; onClose: () => void }) {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<InventoryItem | null>(null)

  const { data: items, loading } = useHouseholdResource<InventoryItem[]>(
    `/api/households/${householdId}/inventory-items?status=ACTIVE`,
  )
  const { data: members } = useHouseholdResource<Member[]>(`/api/households/${householdId}/members`)
  const myMemberId = useMemo(
    () => members?.find((m) => m.user_id === user?.id)?.id,
    [members, user?.id],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!items) return []
    if (!q) return items
    return items.filter((i) => i.food_name.toLowerCase().includes(q))
  }, [items, query])

  if (picked) {
    return (
      <UseItemModal
        item={picked}
        householdId={householdId}
        myMemberId={myMemberId}
        onClose={onClose}
        onConsumed={onClose}
      />
    )
  }

  return (
    <Modal title="Use an item" onClose={onClose}>
      <input
        type="text"
        autoFocus
        placeholder="Search your inventory…"
        className="mb-3 w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted">Nothing matches that.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setPicked(item)}
                  className="w-full rounded-control px-2 py-2 text-left text-sm text-text transition-colors hover:bg-surface-hover"
                >
                  {item.food_name}
                  {item.name_override && (
                    <span className="text-faint"> · {item.food_type_name}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

const STOCK_REASON_LABEL: Record<string, string> = {
  OUT_OF_STOCK: 'Out of stock',
  LOW_STOCK: 'Running low',
}

function QuickAddToListModal({
  householdId,
  onClose,
}: {
  householdId: string
  onClose: () => void
}) {
  const [food, setFood] = useState<
    (Pick<FoodDefinition, 'id' | 'name'> & Partial<Pick<FoodDefinition, 'category'>>) | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<string | null>(null)

  // The same low/out-of-stock signal the full shopping list's own "Suggest
  // List" button bulk-adds from -- here it's a picklist instead, one tap
  // adds just that one item (POST .../suggest/{variant_id}, the single-item
  // counterpart to that bulk action) and removes it from this list, rather
  // than committing everything at once.
  const {
    data: suggestions,
    loading: suggestionsLoading,
    setData: setSuggestions,
  } = useHouseholdResource<StockWarning[]>(`/api/households/${householdId}/shopping-list/suggest`)

  const addSuggested = async (warning: StockWarning) => {
    setError(null)
    setAdding(true)
    try {
      await apiClient.post(
        `/api/households/${householdId}/shopping-list/suggest/${warning.household_food_variant_id}`,
      )
      setAdded(warning.food_name)
      setSuggestions(
        (prev) =>
          prev?.filter((w) => w.household_food_variant_id !== warning.household_food_variant_id) ??
          null,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setAdding(false)
    }
  }

  const submit = async () => {
    if (!food) return
    setError(null)
    setAdding(true)
    try {
      await apiClient.post(`/api/households/${householdId}/shopping-list/items`, {
        global_food_definition_id: food.id,
        section_id: null,
      })
      setAdded(food.name)
      setFood(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setAdding(false)
    }
  }

  return (
    <Modal title="Add to shopping list" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {suggestionsLoading ? (
          <p className="text-sm text-muted">Checking what's running low…</p>
        ) : (
          suggestions &&
          suggestions.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-faint">Running low or out -- tap to add</p>
              <ul className="flex flex-col gap-1">
                {suggestions.map((w) => (
                  <li key={w.household_food_variant_id}>
                    <button
                      type="button"
                      disabled={adding}
                      onClick={() => addSuggested(w)}
                      className="flex w-full items-center justify-between gap-2 rounded-control border border-subtle bg-surface-2 px-3 py-2 text-left text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-50"
                    >
                      {w.food_name}
                      <span
                        className={`shrink-0 text-xs ${
                          w.type === 'OUT_OF_STOCK' ? 'text-danger' : 'text-warning'
                        }`}
                      >
                        {STOCK_REASON_LABEL[w.type] ?? w.type}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}

        <div>
          <p className="mb-1.5 text-xs text-faint">Or search for something else</p>
          <FoodSearchInput
            value={food}
            onChange={(next) => {
              setFood(next)
              setAdded(null)
            }}
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {added && !error && (
          <p className="text-sm text-primary">Added {added}. Pick another, or close this.</p>
        )}
        <button
          type="button"
          disabled={!food || adding}
          onClick={submit}
          className="rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add to list'}
        </button>
      </div>
    </Modal>
  )
}
