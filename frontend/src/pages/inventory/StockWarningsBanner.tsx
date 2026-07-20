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
    <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm">
      {outOfStock.length > 0 && (
        <p>
          <span className="font-medium text-red-600">Out of stock: </span>
          {outOfStock.map((w) => w.food_name).join(', ')}
        </p>
      )}
      {lowStock.length > 0 && (
        <p>
          <span className="font-medium text-amber-700">Running low: </span>
          {lowStock
            .map((w) => `${w.food_name} (${w.remaining_quantity} ${w.preferred_unit} left)`)
            .join(', ')}
        </p>
      )}
    </div>
  )
}
