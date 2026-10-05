// How a stored amount is *shown*: at most 2 decimal places, with trailing zeros
// dropped. Display only. Never feed this into an input field or back to the
// server: a rounded value saved over the real one would silently lose precision.
//
//   2.000    -> "2"
//   1.500    -> "1.5"
//   3.8      -> "3.8"
//   0.333333 -> "0.33"
//   0.004    -> "<0.01"   (a real, tiny amount should not read as "0")
//
// Intl.NumberFormat does the rounding and the zero-trimming in one step.
// Grouping is off so 1000 stays "1000", matching how recipe amounts already show.
const formatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  useGrouping: false,
})

export function formatQuantity(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return String(value)
  if (n !== 0 && Math.abs(n) < 0.005) return n > 0 ? '<0.01' : '>-0.01'
  return formatter.format(n)
}
