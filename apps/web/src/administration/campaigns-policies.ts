import {
  platformCampaignsQuerySchema,
  type PlatformCampaignsQuery,
} from "@elc/shared"

/** Reject ambiguous/unknown URL fields before loading any campaign records. */
export function campaignFilters(search: string): PlatformCampaignsQuery | null {
  const params = new URLSearchParams(search)
  const allowed = ["q", "eventId", "organizerId", "enabled", "cursor", "limit"]
  if (
    [...params.keys()].some(
      (key) => !allowed.includes(key) || params.getAll(key).length !== 1
    )
  )
    return null
  const parsed = platformCampaignsQuerySchema.safeParse(
    Object.fromEntries([...params].filter(([, value]) => value !== ""))
  )
  return parsed.success ? { ...parsed.data, limit: 20 } : null
}
export function campaignSearch(query: PlatformCampaignsQuery) {
  const parsed = platformCampaignsQuerySchema.parse({ ...query, limit: 20 })
  return new URLSearchParams(
    Object.entries(parsed).flatMap(([key, value]) =>
      value === undefined || value === "" ? [] : [[key, String(value)]]
    )
  ).toString()
}
export function campaignPage(query: PlatformCampaignsQuery, cursor?: string) {
  return { ...query, cursor }
}
export function campaignOrdersHref(id: string, eventId: string) {
  return `/admin/operations?${new URLSearchParams({ kind: "orders", campaignId: id, eventId })}`
}
export function campaignAuditHref(id: string, eventId: string) {
  return `/admin/operations?${new URLSearchParams({ kind: "audit", q: id, eventId })}`
}

export function campaignSubmission(fields: {
  q: string
  eventId: string
  organizerId: string
  enabled: string
}): PlatformCampaignsQuery | null {
  const parsed = platformCampaignsQuerySchema.safeParse({
    q: fields.q.trim(),
    eventId: fields.eventId.trim() || undefined,
    organizerId: fields.organizerId.trim() || undefined,
    enabled: fields.enabled,
    limit: 20,
  })
  return parsed.success ? parsed.data : null
}
