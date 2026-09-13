import {
  inventoryResponseSchema,
  type Locale,
  type StartCheckout,
} from "@elc/shared"

export type Inventory = ReturnType<typeof inventoryResponseSchema.parse>
export type Seat = Inventory["seats"][number]
/** The app only needs its own attempt ID from the provider's return URL. */
export function withoutPaymentSecrets(input: URL): string {
  const url = new URL(input)
  url.searchParams.delete("customer_session_token")
  if (url.pathname === "/payments/return") {
    const attempt = url.searchParams.get("attempt")
    url.search = ""
    if (attempt) url.searchParams.set("attempt", attempt)
    url.hash = ""
  }
  const returnTo = url.searchParams.get("returnTo")
  if (returnTo?.startsWith("/payments/return?")) {
    url.searchParams.set(
      "returnTo",
      withoutPaymentSecrets(new URL(returnTo, url.origin))
    )
  }
  return `${url.pathname}${url.search}${url.hash}`
}
export function ticketSalesOpen(
  type: Inventory["ticketTypes"][number],
  paidSalesActive: boolean,
  now: number
) {
  return (
    (type.kind === "free" || paidSalesActive) &&
    Date.parse(type.salesStartAt) <= now &&
    Date.parse(type.salesEndAt) > now
  )
}
export function purchasableSeats(
  inventory: Inventory,
  paidSalesActive: boolean,
  now: number
): Seat[] {
  const openTypes = new Set(
    inventory.ticketTypes
      .filter((type) => ticketSalesOpen(type, paidSalesActive, now))
      .map((type) => type.id)
  )
  return inventory.seats.map((seat) =>
    seat.state === "available" && !openTypes.has(seat.ticketTypeId ?? "")
      ? { ...seat, state: "unavailable" }
      : seat
  )
}
export function isEventPath(path: string) {
  return (
    path === "/" ||
    path === "/events" ||
    path === "/orders" ||
    /^\/(events|orders|tickets|payments)\/[^/]+$/.test(path) ||
    /^\/organizer\/events(?:\/[^/]+(?:\/(access|campaigns|registrations))?)?$/.test(
      path
    )
  )
}
export function safePaymentUrl(
  value: string | null,
  origin: string
): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && url.origin === origin))
      ? url.href
      : null
  } catch {
    return null
  }
}
export function money(minor: number, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 2,
  }).format(minor / 100)
}
export function parsePrice(value: string): number | null {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) return null
  const [whole = "0", fraction = ""] = value.trim().replace(",", ".").split(".")
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null
}
export function remainingSeconds(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000))
}
export function clockText(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
export function dateText(iso: string, timeZone: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso))
}
export function dateInput(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`
}
/** Resolve wall-clock input in the event's zone, independent of browser time zone. */
export function dateFromInput(value: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const wall = Date.parse(`${value}:00Z`)
  if (!Number.isFinite(wall)) return null
  let timestamp = wall
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const formatted = dateInput(new Date(timestamp).toISOString(), timeZone)
      timestamp += wall - Date.parse(`${formatted}:00Z`)
    }
    const result = new Date(timestamp).toISOString()
    return dateInput(result, timeZone) === value ? result : null
  } catch {
    return null
  }
}
export function selectedBasket(
  seats: readonly Seat[],
  selectedIds: readonly string[],
  names: Readonly<Record<string, string>>
): StartCheckout["items"] {
  const groups = new Map<string, StartCheckout["items"][number]>()
  for (const id of new Set(selectedIds)) {
    const seat = seats.find((value) => value.id === id)
    if (
      !seat ||
      seat.state !== "available" ||
      !seat.enabled ||
      !seat.ticketTypeId
    )
      throw new Error("INVENTORY_UNAVAILABLE")
    const name = names[id]?.trim()
    if (!name) throw new Error("INVALID_INPUT")
    const group = groups.get(seat.ticketTypeId) ?? {
      ticketTypeId: seat.ticketTypeId,
      quantity: 0,
      seatIds: [],
      attendeeNames: [],
    }
    group.quantity += 1
    group.seatIds?.push(id)
    group.attendeeNames.push(name)
    groups.set(seat.ticketTypeId, group)
  }
  return [...groups.values()]
}
