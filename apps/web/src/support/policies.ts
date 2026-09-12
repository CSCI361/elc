import {
  entityIdSchema,
  supportAudienceSchema,
  supportIssueCategorySchema,
  type SupportCategory,
  type SupportAudience,
  type OrderRefundResponse,
  type SupportCase,
} from "@elc/shared"
export type SupportContext = {
  eventId?: string
  orderId?: string
  ticketId?: string
  audience?: SupportAudience
  category?: SupportCategory
}
export function readSupportContext(search: string): SupportContext {
  const query = new URLSearchParams(search),
    context: SupportContext = {}
  for (const key of ["eventId", "orderId", "ticketId"] as const) {
    const value = query.get(key)
    if (value) {
      const parsed = entityIdSchema.safeParse(value)
      if (parsed.success) context[key] = parsed.data
    }
  }
  const audience = supportAudienceSchema.safeParse(query.get("audience"))
  if (audience.success) context.audience = audience.data
  const category = supportIssueCategorySchema.safeParse(query.get("category"))
  if (category.success) context.category = category.data
  return context
}
export function supportHref(context: SupportContext = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(context))
    if (value) query.set(key, value)
  return `/support/new${query.size ? `?${query}` : ""}`
}
export function supportCategories(
  context: SupportContext,
  audience: SupportAudience
) {
  const candidates: SupportCategory[] =
    audience === "attendee"
      ? [
          "ticket_delivery",
          "payment",
          "refund",
          "seating",
          "event_information",
          "check_in",
          "technical",
          "dispute",
          "compensation",
        ]
      : [
          "account",
          "activation",
          "payment",
          "technical",
          "dispute",
          "compensation",
        ]
  return candidates.filter(
    (value) =>
      !["refund", "dispute", "compensation"].includes(value) ||
      Boolean(context.orderId || context.ticketId)
  )
}
export function matchingRefundCase(value: SupportCase, orderId: string) {
  return (
    value.orderId === orderId &&
    value.audience === "attendee" &&
    value.category === "refund" &&
    value.status !== "resolved"
  )
}
export function financialActionAvailable(view: OrderRefundResponse) {
  return (
    view.canApprove &&
    view.voluntaryEligible &&
    !view.refund &&
    view.orderState === "completed" &&
    !view.admissionBlocked
  )
}
export function isSupportPath(path: string) {
  return (
    /^\/support(?:\/new|\/cases\/[^/]+)?$/.test(path) ||
    /^\/orders\/[^/]+\/refund$/.test(path)
  )
}
