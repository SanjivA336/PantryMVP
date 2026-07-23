import { TriangleAlert } from 'lucide-react'
import type { StockWarning } from '../../types/entities'

interface Props {
  stockWarnings: StockWarning[]
}

// Out-of-stock foods have no ACTIVE item left to attach a badge to (that's
// the whole point of "zero on hand"), so they're surfaced here instead of
// per-row like expiry warnings.
export function StockWarningsBanner({ stockWarnings }: Props) {
  if (stockWarnings.length === 0) return null

  const outOfStock = stockWarnings.filter((w) => w.type === 'OUT_OF_STOCK')
  const lowStock = stockWarnings.filter((w) => w.type === 'LOW_STOCK')

  return (
    <div className="flex flex-col gap-2 rounded-card border border-warning/25 bg-warning-soft p-4 text-sm">
      <div className="flex items-center gap-2 text-warning">
        <TriangleAlert size={16} strokeWidth={2} />
        <span className="font-medium">Stock warnings</span>
      </div>
      {outOfStock.length > 0 && (
        <p className="text-text">
          <span className="font-medium text-danger">Out of stock: </span>
          {outOfStock.map((w) => w.food_name).join(', ')}
        </p>
      )}
      {lowStock.length > 0 && (
        <p className="text-text">
          <span className="font-medium text-warning">Running low: </span>
          {lowStock
            .map((w) => `${w.food_name} (${w.remaining_quantity} ${w.preferred_unit} left)`)
            .join(', ')}
        </p>
      )}
    </div>
  )
}
