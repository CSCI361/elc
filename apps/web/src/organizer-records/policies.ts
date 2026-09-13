import {
  organizerRecordsQuerySchema,
  type OrganizerRecordsKind,
  type OrganizerRecordsQuery,
  type OrganizerRecordsResponse,
} from "@elc/shared"

export function recordsQuery(search: string): OrganizerRecordsQuery | null {
  const params = new URLSearchParams(search)
  const allowed = ["kind", "q", "orderId", "ticketId", "cursor", "limit"]
  if (
    [...params.keys()].some(
      (key) => !allowed.includes(key) || params.getAll(key).length !== 1
    )
  )
    return null
  const result = organizerRecordsQuerySchema.safeParse(
    Object.fromEntries([...params].filter(([, value]) => value !== ""))
  )
  return result.success ? result.data : null
}

export function recordsSearch(query: OrganizerRecordsQuery): string {
  const parsed = organizerRecordsQuerySchema.parse(query)
  return new URLSearchParams(
    Object.entries(parsed).flatMap(([key, value]) =>
      value === undefined || value === "" ? [] : [[key, String(value)]]
    )
  ).toString()
}
export const recordsBase = (eventId: string) =>
  `/organizer/events/${encodeURIComponent(eventId)}/registrations`
export const recordsHref = (eventId: string, query: OrganizerRecordsQuery) =>
  `${recordsBase(eventId)}?${recordsSearch(query)}`
export function recordsPage(
  query: OrganizerRecordsQuery,
  cursor?: string
): OrganizerRecordsQuery {
  return { ...query, cursor }
}
export function recordsTab(
  query: OrganizerRecordsQuery,
  kind: OrganizerRecordsKind
): OrganizerRecordsQuery {
  return { ...query, kind, cursor: undefined }
}
/** A linked record is an exact filter; a previous name search must not hide it. */
export function recordsDrilldown(
  query: OrganizerRecordsQuery,
  target: {
    kind: OrganizerRecordsKind
    orderId?: string
    ticketId?: string
  }
): OrganizerRecordsQuery {
  return {
    kind: target.kind,
    q: "",
    limit: query.limit,
    orderId: target.orderId,
    ticketId: target.ticketId,
  }
}
export function recordsReset(
  query: OrganizerRecordsQuery
): OrganizerRecordsQuery {
  return { kind: query.kind, q: "", limit: query.limit }
}

export function recordsLinks(
  eventId: string,
  capabilities: OrganizerRecordsResponse["capabilities"],
  orderId?: string
) {
  const id = encodeURIComponent(eventId)
  return [
    ...(capabilities.manage
      ? [{ label: "manage" as const, href: `/organizer/events/${id}` }]
      : []),
    ...(capabilities.history
      ? [{ label: "history" as const, href: `/organizer/events/${id}/history` }]
      : []),
    ...(capabilities.analytics
      ? [{ label: "analytics" as const, href: `/events/${id}/analytics` }]
      : []),
    ...(capabilities.support
      ? [
          {
            label: "support" as const,
            href: `/support?view=staff&eventId=${id}`,
          },
        ]
      : []),
    ...(capabilities.refund && orderId
      ? [
          {
            label: "refundAction" as const,
            href: `/orders/${encodeURIComponent(orderId)}/refund`,
          },
        ]
      : []),
  ]
}
