import { createCampaignSchema } from "@elc/shared"
import { dateFromInput, dateInput, parsePrice } from "../events/policies"

export type CampaignDraft = {
  name: string
  kind: "percentage" | "fixed"
  amount: string
  maxRedemptions: string
  starts: string
  ends: string
  ticketTypeIds: string[]
}

export function parseCampaignDraft(
  draft: CampaignDraft,
  eventId: string,
  timeZone: string,
  defaultWindow?: { startsAt: string; endsAt: string }
) {
  const amount = parsePrice(draft.amount)
  const startsAt =
    defaultWindow &&
    draft.starts === dateInput(defaultWindow.startsAt, timeZone)
      ? defaultWindow.startsAt
      : dateFromInput(draft.starts, timeZone)
  const endsAt =
    defaultWindow && draft.ends === dateInput(defaultWindow.endsAt, timeZone)
      ? defaultWindow.endsAt
      : dateFromInput(draft.ends, timeZone)
  const maxRedemptions = /^\d{1,16}$/.test(draft.maxRedemptions.trim())
    ? Number(draft.maxRedemptions)
    : NaN
  if (
    amount === null ||
    !startsAt ||
    !endsAt ||
    !Number.isSafeInteger(maxRedemptions)
  )
    return null
  const result = createCampaignSchema.safeParse({
    eventId,
    name: draft.name,
    discount:
      draft.kind === "percentage"
        ? { kind: "percentage", basisPoints: amount }
        : { kind: "fixed", amountMinor: amount },
    startsAt,
    endsAt,
    maxRedemptions,
    applicableTicketTypeIds: draft.ticketTypeIds,
    enabled: false,
  })
  return result.success ? result.data : null
}

/** A campaign QR contains only this application's canonical public event link. */
export function campaignLink(input: {
  url: string
  origin: string
  eventId: string
  code: string
  allowLocalDevelopment: boolean
}): { url: string; local: boolean } | null {
  try {
    const url = new URL(input.url)
    const origin = new URL(input.origin)
    const local =
      url.protocol === "http:" &&
      input.allowLocalDevelopment &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    const canonical = new URL(
      `/events/${encodeURIComponent(input.eventId)}`,
      origin.origin
    )
    canonical.searchParams.set("campaign", input.code)
    if (
      !input.code ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" && !local) ||
      url.origin !== origin.origin ||
      url.href !== canonical.href
    )
      return null
    return { url: url.href, local }
  } catch {
    return null
  }
}
