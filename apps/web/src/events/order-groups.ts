interface GroupableOrder {
  eventStartsAt: string
  state: string
}

const activeStates = new Set(["pending", "completed"])

export function groupOrders<T extends GroupableOrder>(
  items: readonly T[],
  now: number
): { upcoming: T[]; past: T[] } {
  const startOf = (item: T) => Date.parse(item.eventStartsAt)
  const isUpcoming = (item: T) =>
    activeStates.has(item.state) && startOf(item) >= now
  return {
    upcoming: items.filter(isUpcoming).sort((a, b) => startOf(a) - startOf(b)),
    past: items
      .filter((item) => !isUpcoming(item))
      .sort((a, b) => startOf(b) - startOf(a)),
  }
}
