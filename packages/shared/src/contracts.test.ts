import { describe, expect, it } from "vite-plus/test"

import {
  admissionPayloadSchema,
  analyticsQuerySchema,
  calendarUid,
  calendarIdentitySchema,
  canVoluntarilyRefund,
  createCampaignSchema,
  createEventSchema,
  createSupportMessageSchema,
  createTicketTypeSchema,
  deriveEventPhase,
  ga4EventSchema,
  hasEventPermission,
  isReservationExpired,
  offlineSnapshotExpiresAt,
  offlineSnapshotSchema,
  orderItemSchema,
  policy,
  reservationExpiresAt,
  startCheckoutSchema,
  supportUploadSchema,
  synchronizeScansSchema,
  verifiedProviderEventSchema,
} from "./index"

const eventInput = {
  title: "Almaty community event",
  description: "An event at the demonstration hall.",
  category: "community",
  venueName: "Demo hall",
  venueAddress: "Almaty",
  startsAt: "2026-10-01T13:00:00Z",
  endsAt: "2026-10-01T15:00:00Z",
  capacity: 80,
  registrationOpensAt: "2026-09-01T00:00:00Z",
  registrationClosesAt: "2026-10-01T13:00:00Z",
}

describe("ticketing request contracts", () => {
  it("applies locale-independent event defaults and rejects invalid time windows", () => {
    expect(createEventSchema.parse(eventInput)).toMatchObject({
      timeZone: "Asia/Almaty",
      visibility: "public",
      seatingMode: "general_admission",
      maxTicketsPerOrder: 6,
    })
    expect(
      createEventSchema.safeParse({
        ...eventInput,
        endsAt: eventInput.startsAt,
      }).success
    ).toBe(false)
    expect(
      createEventSchema.safeParse({ ...eventInput, timeZone: "Not/AZone" })
        .success
    ).toBe(false)
    expect(
      createEventSchema.safeParse({ ...eventInput, timeZone: "+05:00" }).success
    ).toBe(false)
    expect(
      createEventSchema.safeParse({ ...eventInput, maxTicketsPerOrder: 81 })
        .success
    ).toBe(false)
  })

  it("requires a predefined layout for assigned seating", () => {
    expect(
      createEventSchema.safeParse({ ...eventInput, seatingMode: "assigned" })
        .success
    ).toBe(false)
    expect(
      createEventSchema.safeParse({
        ...eventInput,
        seatingMode: "assigned",
        venueLayoutId: "elc-demo-hall",
      }).success
    ).toBe(true)
  })

  it("keeps zero-total orders distinct from free ticket types", () => {
    const ticket = {
      eventId: "event-1",
      name: "Standard",
      kind: "paid",
      priceMinor: 100,
      quantity: 10,
      salesStartAt: eventInput.registrationOpensAt,
      salesEndAt: eventInput.registrationClosesAt,
    }
    expect(createTicketTypeSchema.safeParse(ticket).success).toBe(true)
    expect(
      createTicketTypeSchema.safeParse({ ...ticket, priceMinor: 0 }).success
    ).toBe(false)
    expect(
      createTicketTypeSchema.safeParse({ ...ticket, kind: "free" }).success
    ).toBe(false)
  })

  it("starts campaigns disabled and requires a separate enable action", () => {
    const campaign = {
      eventId: "event-1",
      name: "Early campaign",
      startsAt: eventInput.registrationOpensAt,
      endsAt: eventInput.registrationClosesAt,
      applicableTicketTypeIds: ["standard"],
    }
    expect(createCampaignSchema.parse(campaign)).toMatchObject({
      discount: { kind: "percentage", basisPoints: 1_000 },
      maxRedemptions: 100,
      enabled: false,
    })
    expect(
      createCampaignSchema.safeParse({ ...campaign, enabled: true }).success
    ).toBe(false)
  })

  it("rejects injected prices, mismatched attendee counts, and duplicate selected seats", () => {
    const checkout = {
      requestId: "checkout-1",
      eventId: "event-1",
      items: [
        {
          ticketTypeId: "standard",
          quantity: 1,
          attendeeNames: ["Attendee"],
          seatIds: ["A1"],
        },
      ],
    }
    expect(startCheckoutSchema.safeParse(checkout).success).toBe(true)
    expect(
      startCheckoutSchema.safeParse({ ...checkout, totalMinor: 1 }).success
    ).toBe(false)
    expect(
      startCheckoutSchema.safeParse({
        ...checkout,
        items: [
          {
            ticketTypeId: "standard",
            quantity: 2,
            attendeeNames: ["Attendee"],
          },
        ],
      }).success
    ).toBe(false)
    expect(
      startCheckoutSchema.safeParse({
        ...checkout,
        items: [
          ...checkout.items,
          {
            ticketTypeId: "premium",
            quantity: 1,
            attendeeNames: ["Second"],
            seatIds: ["A1"],
          },
        ],
      }).success
    ).toBe(false)
  })

  it("rejects inconsistent order item snapshots", () => {
    const item = {
      id: "item-1",
      ticketTypeId: "standard",
      ticketTypeName: "Standard",
      quantity: 2,
      unitPriceMinor: 100,
      subtotalMinor: 200,
      discountMinor: 10,
      totalMinor: 190,
      currency: "KZT",
      seats: [],
    }
    expect(orderItemSchema.safeParse(item).success).toBe(true)
    expect(
      orderItemSchema.safeParse({ ...item, totalMinor: 200 }).success
    ).toBe(false)
    expect(
      orderItemSchema.safeParse({ ...item, subtotalMinor: 199 }).success
    ).toBe(false)
  })

  it("distinguishes refund confirmations from successful ticket payments", () => {
    const refundEvent = {
      kind: "refund",
      providerEventId: "provider-event-1",
      providerPaymentId: "provider-payment-1",
      providerRefundId: "provider-refund-1",
      paymentAttemptId: "payment-1",
      refundId: "refund-1",
      state: "succeeded",
      amountMinor: 900_000,
      currency: "KZT",
    }
    expect(verifiedProviderEventSchema.parse(refundEvent).kind).toBe("refund")
    expect(
      verifiedProviderEventSchema.safeParse({ ...refundEvent, kind: "payment" })
        .success
    ).toBe(false)
  })
})

describe("state, access and time policies", () => {
  it("derives event phase with exact boundaries and cancellation precedence", () => {
    const event = { ...eventInput, cancelledAt: null }
    expect(deriveEventPhase(event, "2026-10-01T12:59:59Z")).toBe("upcoming")
    expect(deriveEventPhase(event, event.startsAt)).toBe("active")
    expect(deriveEventPhase(event, event.endsAt)).toBe("completed")
    expect(
      deriveEventPhase(
        { ...event, cancelledAt: "2026-09-20T00:00:00Z" },
        event.startsAt
      )
    ).toBe("cancelled")
  })

  it("expires holds at ten minutes without a retry-based extension", () => {
    const created = "2026-09-20T00:00:00Z"
    const expiry = reservationExpiresAt(created)
    expect(expiry).toBe("2026-09-20T00:10:00.000Z")
    expect(isReservationExpired(expiry, "2026-09-20T00:09:59Z")).toBe(false)
    expect(isReservationExpired(expiry, expiry)).toBe(true)
  })

  it("requires the matching account, event, active assignment and exact permission", () => {
    const assignment = {
      id: "staff-1",
      userId: "scanner-1",
      eventId: "event-1",
      permissions: ["ticket:scan" as const],
      revokedAt: null,
    }
    expect(
      hasEventPermission([assignment], "scanner-1", "event-1", "ticket:scan")
    ).toBe(true)
    expect(
      hasEventPermission([assignment], "scanner-1", "event-2", "ticket:scan")
    ).toBe(false)
    expect(
      hasEventPermission([assignment], "other-user", "event-1", "ticket:scan")
    ).toBe(false)
    expect(
      hasEventPermission(
        [assignment],
        "scanner-1",
        "event-1",
        "refund:initiate"
      )
    ).toBe(false)
    expect(
      hasEventPermission(
        [{ ...assignment, revokedAt: "2026-09-20T00:00:00Z" }],
        "scanner-1",
        "event-1",
        "ticket:scan"
      )
    ).toBe(false)
  })

  it("blocks voluntary refunds at event start or when admission is active or unresolved", () => {
    const refund = {
      eventStartsAt: eventInput.startsAt,
      now: "2026-10-01T12:59:59Z",
      hasActiveCheckIn: false,
      hasUnresolvedOfflineAdmission: false,
    }
    expect(canVoluntarilyRefund(refund)).toBe(true)
    expect(canVoluntarilyRefund({ ...refund, now: eventInput.startsAt })).toBe(
      false
    )
    expect(canVoluntarilyRefund({ ...refund, hasActiveCheckIn: true })).toBe(
      false
    )
    expect(
      canVoluntarilyRefund({ ...refund, hasUnresolvedOfflineAdmission: true })
    ).toBe(false)
  })
})

describe("offline, calendar, support and analytics contracts", () => {
  it("rejects campaign links as admission payloads", () => {
    expect(
      admissionPayloadSchema.safeParse(
        "https://example.test/events/1?campaign=promo"
      ).success
    ).toBe(false)
    expect(
      admissionPayloadSchema.safeParse({
        kind: "elc_campaign",
        version: 1,
        token: "a".repeat(32),
      }).success
    ).toBe(false)
    expect(
      admissionPayloadSchema.safeParse({
        kind: "elc_admission",
        version: 1,
        token: "a".repeat(32),
      }).success
    ).toBe(true)
  })

  it("caps offline snapshots at four hours and two hours after event end", () => {
    expect(
      offlineSnapshotExpiresAt("2026-10-01T10:00:00Z", eventInput.endsAt)
    ).toBe("2026-10-01T14:00:00.000Z")
    expect(
      offlineSnapshotExpiresAt("2026-10-01T14:00:00Z", eventInput.endsAt)
    ).toBe("2026-10-01T17:00:00.000Z")
    const snapshot = {
      version: 1,
      snapshotId: "snapshot-1",
      accountId: "staff-1",
      deviceId: "device-1",
      eventId: "event-1",
      issuedAt: "2026-10-01T14:00:00Z",
      expiresAt: "2026-10-01T17:00:00Z",
      eventEndsAt: eventInput.endsAt,
      tickets: [],
      signature: "test-structure-only",
    }
    expect(offlineSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(
      offlineSnapshotSchema.safeParse({
        ...snapshot,
        expiresAt: "2026-10-01T18:00:00Z",
      }).success
    ).toBe(false)
    expect(
      offlineSnapshotSchema.safeParse({ ...snapshot, rawAdmissionTokens: [] })
        .success
    ).toBe(false)
  })

  it("preserves scan and undo operation IDs while rejecting duplicate batch IDs", () => {
    const scan = {
      kind: "scan",
      operationId: "scan-1",
      snapshotId: "snapshot-1",
      snapshotVersion: 1,
      deviceTimestamp: "2026-10-01T14:00:00Z",
      ticketId: "ticket-1",
      tokenHash: "a".repeat(64),
    }
    const batch = {
      accountId: "staff-1",
      deviceId: "device-1",
      eventId: "event-1",
      operations: [scan],
    }
    expect(synchronizeScansSchema.safeParse(batch).success).toBe(true)
    expect(
      synchronizeScansSchema.safeParse({ ...batch, operations: [scan, scan] })
        .success
    ).toBe(false)
    expect(
      synchronizeScansSchema.safeParse({
        ...batch,
        operations: [
          scan,
          {
            kind: "undo",
            operationId: "undo-1",
            originalOperationId: "scan-1",
            snapshotId: "snapshot-1",
            snapshotVersion: 1,
            deviceTimestamp: "2026-10-01T14:00:01Z",
          },
        ],
      }).success
    ).toBe(true)
  })

  it("keeps calendar IDs stable for an event and distinct for a duplicated event", () => {
    expect(calendarUid("event-1")).toBe(calendarUid("event-1"))
    expect(calendarUid("event-2")).not.toBe(calendarUid("event-1"))
    expect(calendarUid("event\r\nUID:injected")).not.toContain("\n")
    expect(
      calendarIdentitySchema.safeParse({
        uid: calendarUid("ә".repeat(128)),
        sequence: 0,
        status: "CONFIRMED",
        updatedAt: "2026-09-20T00:00:00Z",
      }).success
    ).toBe(true)
  })

  it("limits support upload declarations and message attachment counts", () => {
    const upload = {
      caseId: "case-1",
      fileName: "ticket.pdf",
      mimeType: "application/pdf",
      sizeBytes: policy.supportFileMaxBytes,
    }
    expect(supportUploadSchema.safeParse(upload).success).toBe(true)
    expect(
      supportUploadSchema.safeParse({
        ...upload,
        sizeBytes: policy.supportFileMaxBytes + 1,
      }).success
    ).toBe(false)
    expect(
      supportUploadSchema.safeParse({
        ...upload,
        mimeType: "application/javascript",
      }).success
    ).toBe(false)
    const message = {
      requestId: "message-1",
      caseId: "case-1",
      text: "Help",
      attachmentIds: ["a", "b", "c"],
    }
    expect(createSupportMessageSchema.safeParse(message).success).toBe(true)
    expect(
      createSupportMessageSchema.safeParse({
        ...message,
        attachmentIds: ["a", "b", "c", "d"],
      }).success
    ).toBe(false)
    expect(
      createSupportMessageSchema.safeParse({
        ...message,
        text: " ",
        attachmentIds: [],
      }).success
    ).toBe(false)
  })

  it("limits reports to 180 inclusive calendar days and excludes GA4 personal fields", () => {
    const query = {
      eventId: "event-1",
      startsOn: "2026-01-01",
      endsOn: "2026-06-29",
    }
    expect(analyticsQuerySchema.safeParse(query).success).toBe(true)
    expect(
      analyticsQuerySchema.safeParse({ ...query, endsOn: "2026-06-30" }).success
    ).toBe(false)
    expect(
      analyticsQuerySchema.safeParse({ ...query, endsOn: "2025-12-31" }).success
    ).toBe(false)
    const event = {
      name: "view_item",
      eventReportingId: "rpt_event1234",
      locale: "kk",
      pageKind: "public_event",
    }
    expect(ga4EventSchema.safeParse(event).success).toBe(true)
    expect(
      ga4EventSchema.safeParse({
        ...event,
        attendeeEmail: "person@example.test",
      }).success
    ).toBe(false)
    expect(
      ga4EventSchema.safeParse({ ...event, campaignToken: "redeemable" })
        .success
    ).toBe(false)
  })
})
