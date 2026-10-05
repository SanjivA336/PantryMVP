// "Oct 1", or "Oct 1, 2025" when it isn't this year. `date` is a plain
// YYYY-MM-DD (no time zone), so it's parsed as a local date, never shifted.
export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
