import { createHash } from "node:crypto"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"])

/** Seed request identifiers stay stable so a retried run replays instead of duplicating. */
function stableRequestId(key) {
  const hex = createHash("sha256").update(`elc-local-seed:${key}`).digest("hex")
  const variant = (8 | (Number.parseInt(hex[16], 16) & 3)).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function assertLocalOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error("Seeding is restricted to a local http origin.")
  }
  if (url.protocol !== "http:" || !LOCAL_HOSTS.has(url.hostname))
    throw new Error("Seeding is restricted to a local http origin.")
  return url.origin
}

function freeEvent(
  {
    key,
    title,
    description,
    category,
    venueName,
    venueAddress,
    daysAhead,
    startHourUtc,
    durationHours,
    capacity,
    maxTicketsPerOrder,
    ticketName,
  },
  now
) {
  const startOfDay = Math.floor(now / DAY) * DAY
  const startsAt = startOfDay + daysAhead * DAY + startHourUtc * HOUR
  const opensAt = new Date(now - HOUR).toISOString()
  const closesAt = new Date(startsAt - HOUR).toISOString()
  return {
    key,
    body: {
      title,
      description,
      category,
      venueName,
      venueAddress,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + durationHours * HOUR).toISOString(),
      timeZone: "Asia/Almaty",
      visibility: "public",
      seatingMode: "general_admission",
      capacity,
      maxTicketsPerOrder,
      registrationOpensAt: opensAt,
      registrationClosesAt: closesAt,
      refundInstructions:
        "Free registration. Cancel from your orders page before the event starts.",
    },
    ticketTypes: [
      {
        key: "general",
        name: ticketName,
        description: "Free entry for the local demonstration.",
        kind: "free",
        priceMinor: 0,
        currency: "KZT",
        quantity: capacity,
        salesStartAt: opensAt,
        salesEndAt: closesAt,
        hidden: false,
      },
    ],
  }
}

export function buildSeedPlan(now) {
  const accounts = [
    {
      role: "organizer",
      name: "Demo Organizer",
      email: "demo-organizer@example.test",
    },
    {
      role: "attendee",
      name: "Demo Attendee",
      email: "demo-attendee@example.test",
    },
    {
      role: "scanner",
      name: "Demo Scanner",
      email: "demo-scanner@example.test",
    },
    {
      role: "moderator",
      name: "Demo Moderator",
      email: "demo-moderator@example.test",
    },
  ]
  const events = [
    freeEvent(
      {
        key: "developer-meetup",
        title: "Almaty developer meetup (demo)",
        description:
          "A local demonstration event for trying discovery, free registration, tickets and check-in.",
        category: "Technology",
        venueName: "Demo coworking hall",
        venueAddress: "Abay Avenue 1, Almaty (demonstration address)",
        daysAhead: 7,
        startHourUtc: 13,
        durationHours: 3,
        capacity: 60,
        maxTicketsPerOrder: 4,
        ticketName: "General admission",
      },
      now
    ),
    freeEvent(
      {
        key: "student-film-night",
        title: "Student film night (demo)",
        description:
          "A second demonstration event for organizer history, analytics and support workflows.",
        category: "Film",
        venueName: "Demo university auditorium",
        venueAddress: "Satpayev Street 22, Almaty (demonstration address)",
        daysAhead: 14,
        startHourUtc: 14,
        durationHours: 2,
        capacity: 40,
        maxTicketsPerOrder: 2,
        ticketName: "Free seat",
      },
      now
    ),
  ]
  const requestIds = Object.fromEntries(
    events.flatMap((event) => [
      [`event:${event.key}`, stableRequestId(`event:${event.key}`)],
      ...event.ticketTypes.map((type) => [
        `ticketType:${event.key}:${type.key}`,
        stableRequestId(`ticketType:${event.key}:${type.key}`),
      ]),
      [`publish:${event.key}`, stableRequestId(`publish:${event.key}`)],
    ])
  )
  return {
    accounts,
    events,
    grants: {
      platform: {
        moderator: [
          "platform:moderate",
          "platform:support",
          "platform:configure",
        ],
      },
      event: { scanner: ["ticket:scan", "checkin:reverse"] },
    },
    requestIds,
  }
}
