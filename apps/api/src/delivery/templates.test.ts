import { describe, expect, it, vi } from "vite-plus/test"
import type { Locale } from "@elc/shared"
import { freezeEmailRequest } from "./email"
import {
  formatNotificationKzt,
  notificationInputSchema,
  notificationLocale,
  NotificationTemplateError,
  renderNotification,
  type NotificationContext,
  type NotificationInput,
} from "./templates"

const origin = "https://app.example.test"
const event = { eventId: "event-123", eventTitle: "Көктем / Весна / Spring" }
const tickets = {
  kind: "order.tickets",
  ...event,
  orderId: "order-123",
  amountMinor: 900_001,
  ticketCount: 2,
  attachmentCount: 2,
  part: 1,
  parts: 1,
} as const
const fixtures: NotificationInput[] = [
  tickets,
  {
    kind: "payment.failed",
    ...event,
    paymentAttemptId: "payment-123",
    amountMinor: 900_001,
  },
  { kind: "event.updated", ...event },
  { kind: "event.cancelled", ...event },
  {
    kind: "refund.completed",
    ...event,
    paymentAttemptId: "payment-123",
    amountMinor: 900_001,
  },
  {
    kind: "payout.status",
    ...event,
    status: "completed",
    amountMinor: 855_001,
  },
  { kind: "support.changed", caseId: "case-123", action: "message" },
  { kind: "activation.completed", ...event, feeMinor: 500_000 },
  { kind: "order.cancelled", ...event, orderId: "order-123" },
]
const localeCases = [
  {
    locale: "kk",
    demo: "elc оқу демонстрациясы.",
    subject: "Билеттеріңіз",
    sandbox: "Нақты ақша аударылмайды.",
    payout: "Банк аударымы жасалмайды.",
  },
  {
    locale: "ru",
    demo: "Учебная демонстрация elc.",
    subject: "Ваши билеты",
    sandbox: "Реальные деньги не переводятся.",
    payout: "Банковского перевода нет.",
  },
  {
    locale: "en",
    demo: "elc academic demo.",
    subject: "Your tickets",
    sandbox: "No real money is transferred.",
    payout: "No bank transfer is made.",
  },
] as const
const render = (input: NotificationInput, locale: Locale = "en") =>
  renderNotification(input, { appOrigin: origin, locale })
const unsafe = (input: unknown, context: unknown = { appOrigin: origin }) =>
  renderNotification(input as NotificationInput, context as NotificationContext)

describe("canonical localized notification text", () => {
  it.each(localeCases)(
    "renders all nine notices in saved $locale and fits the frozen email contract",
    ({ locale, demo, subject, sandbox, payout }) => {
      for (const input of fixtures) {
        const rendered = render(input, locale)
        expect(rendered.text.startsWith(`${demo}\n\n`)).toBe(true)
        expect(Object.keys(rendered).sort()).toEqual(["subject", "text"])
        expect(Object.isFrozen(rendered)).toBe(true)
        if ("eventTitle" in input)
          expect(rendered.text).toContain(`\n${event.eventTitle}\n`)
        if (
          [
            "order.tickets",
            "payment.failed",
            "refund.completed",
            "activation.completed",
          ].includes(input.kind)
        )
          expect(rendered.text).toContain(sandbox)
        if (input.kind === "payout.status")
          expect(rendered.text).toContain(payout)
        const payload = freezeEmailRequest({
          deliveryId: "delivery-123",
          idempotencyKey: "elc-email/delivery-123",
          from: "elc Demo <tickets@example.test>",
          to: "attendee@example.test",
          ...rendered,
          ...(input.kind === "order.tickets"
            ? {
                attachments: Array.from(
                  { length: input.attachmentCount },
                  (_, index) => ({
                    filename: `ticket-${index}.pdf`,
                    content: btoa("%PDF-1.7\ncanonical fixture"),
                  })
                ),
              }
            : {}),
        })
        expect(payload.subject).toBe(rendered.subject)
        expect(payload.text).toBe(rendered.text)
      }
      expect(render(tickets, locale).subject).toBe(
        `${subject}: ${event.eventTitle}`
      )
    }
  )

  it.each([undefined, null, "de", "RU", "ru-RU", "", 7, {}])(
    "falls back to Kazakh for unsupported saved locale %#",
    (locale) => {
      expect(notificationLocale(locale)).toBe("kk")
      expect(unsafe(tickets, { appOrigin: origin, locale })).toEqual(
        render(tickets, "kk")
      )
    }
  )
  it("does not select a different language from the event title or process locale", () => {
    for (const locale of ["kk", "ru", "en"] as const) {
      expect(notificationLocale(locale)).toBe(locale)
      expect(
        render({ ...tickets, eventTitle: "An English-only title" }, locale)
          .subject
      ).toMatch(
        new RegExp(
          `^${localeCases.find((item) => item.locale === locale)!.subject}:`
        )
      )
    }
  })
  it("preserves entered title text while removing subject line separators", () => {
    const eventTitle = "  Көктем\r\nSpring\tBcc: nothing\u2028Весна\u2029  "
    const result = render({ ...tickets, eventTitle })
    expect(result.subject).toBe(
      "Your tickets: Көктем Spring Bcc: nothing Весна"
    )
    expect(result.subject).not.toMatch(/[\r\n\t\u2028\u2029]/u)
    expect(result.text).toContain(`Event:\n${eventTitle}\n\n`)
  })
  it("bounds a long subject without cutting a Unicode pair or the original title", () => {
    const eventTitle = "🎟️".repeat(66)
    const result = render({ ...tickets, eventTitle })
    expect(result.subject.length).toBeLessThanOrEqual(200)
    expect(result.subject.endsWith("...")).toBe(true)
    expect(
      new TextDecoder().decode(new TextEncoder().encode(result.subject))
    ).toBe(result.subject)
    expect(result.text).toContain(`\n${eventTitle}\n`)
  })
  it("returns a fixed error without exposing the bad field or value", () => {
    try {
      unsafe({ ...tickets, admissionCredential: "PRIVATE-SECRET" })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationTemplateError)
      expect(String(error)).toBe(
        "NotificationTemplateError: The canonical notification input is invalid."
      )
      expect(error).not.toHaveProperty("cause")
      expect(JSON.stringify(error)).not.toContain("PRIVATE")
    }
  })
  it("renders without calling a network transport", () => {
    const fetch = vi.spyOn(globalThis, "fetch")
    try {
      fixtures.forEach((input) => render(input))
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
})

describe("exact KZT minor units", () => {
  it.each([
    [0, "0.00 KZT"],
    [1, "0.01 KZT"],
    [99, "0.99 KZT"],
    [100, "1.00 KZT"],
    [900_001, "9,000.01 KZT"],
    [-900_001, "-9,000.01 KZT"],
    [Number.MAX_SAFE_INTEGER, "90,071,992,547,409.91 KZT"],
  ] as const)(
    "formats %s without floating-point rounding",
    (minor, formatted) => {
      expect(formatNotificationKzt(minor, "en")).toBe(formatted)
    }
  )
  it.each(["kk", "ru"] as const)(
    "uses %s grouping and decimal punctuation",
    (locale) => {
      expect(
        formatNotificationKzt(900_001, locale).replace(/[\u00a0\u202f]/gu, " ")
      ).toBe("9 000,01 KZT")
      expect(formatNotificationKzt(1, locale)).toBe("0,01 KZT")
    }
  )
  it.each([1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects noncanonical money %#",
    (value) => {
      expect(() => formatNotificationKzt(value, "en")).toThrow(
        NotificationTemplateError
      )
      expect(() => unsafe({ ...tickets, amountMinor: value })).toThrow(
        NotificationTemplateError
      )
    }
  )
  it("describes a free order without suggesting a payment occurred", () => {
    const result = render({ ...tickets, amountMinor: 0 })
    expect(result.text).toContain("Registration is free.")
    expect(result.text).not.toContain("sandbox transaction")
    expect(result.text).not.toContain("order total")
  })
  it("accepts signed payout adjustments and rejects wrong-sign financial facts", () => {
    expect(
      render({
        kind: "payout.status",
        ...event,
        status: "adjusted",
        amountMinor: -125,
      }).text
    ).toContain("balance by -1.25 KZT.")
    for (const input of [
      { ...tickets, amountMinor: -1 },
      { kind: "activation.completed", ...event, feeMinor: -1 },
      {
        kind: "refund.completed",
        ...event,
        paymentAttemptId: "payment-123",
        amountMinor: -1,
      },
      { kind: "payout.status", ...event, status: "adjusted", amountMinor: 1 },
      { kind: "payout.status", ...event, status: "completed", amountMinor: -1 },
      { kind: "payout.status", ...event, status: "held", amountMinor: -1 },
    ])
      expect(() => unsafe(input)).toThrow(NotificationTemplateError)
  })
})

describe("canonical fields and generated application links", () => {
  it.each([
    { eventTitle: "" },
    { eventTitle: " \n\t" },
    { eventTitle: "x".repeat(201) },
    { eventTitle: "title\u0000" },
    { eventTitle: "title\u0085" },
    { eventTitle: "title\ud800" },
    { eventTitle: "title\udc00" },
    { eventId: ".." },
    { eventId: "." },
    { eventId: " padded" },
    { eventId: "event\n123" },
    { eventId: "event\ud800" },
    { eventId: "x".repeat(129) },
    { url: "https://elsewhere.example.test" },
    { admissionCredential: "secret" },
    { ticketToken: "secret" },
    { refundReason: "private reason" },
    { html: "<p>injected</p>" },
    { email: "private@example.test" },
  ])("rejects invalid or unnecessary canonical fields %#", (change) => {
    expect(
      notificationInputSchema.safeParse({ ...tickets, ...change }).success
    ).toBe(false)
    expect(() => unsafe({ ...tickets, ...change })).toThrow(
      NotificationTemplateError
    )
  })
  it.each([
    "https://app.example.test",
    "https://app.example.test/",
    "https://app.example.test:8443",
    "http://localhost:5173",
    "http://elc.localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
    "http://10.1.2.3:5173",
    "http://192.168.1.2:5173",
    "http://172.16.0.2:5173",
    "http://172.31.255.254:5173",
  ])("allows configured HTTPS or local HTTP origin %s", (appOrigin) => {
    expect(
      renderNotification(tickets, { appOrigin, locale: "en" }).text
    ).toContain(`${new URL(appOrigin).origin}/orders/order-123`)
  })
  it.each([
    "http://app.example.test",
    "http://localhost.example.test",
    "http://172.15.0.1",
    "http://172.32.0.1",
    "https://name:password@app.example.test",
    "https://app.example.test/path",
    "https://app.example.test/?secret=value",
    "https://app.example.test/#token=value",
    "//app.example.test",
    "javascript:alert(1)",
    "file:///local",
    " https://app.example.test",
    "https://app.example.test/../",
    "https://app.example.test?",
    "https://app.example.test#",
    "http://2130706433",
    "http://127.1",
  ])(
    "rejects a noncanonical origin or an origin with extra URL data %#",
    (appOrigin) => {
      expect(() => renderNotification(tickets, { appOrigin })).toThrow(
        NotificationTemplateError
      )
    }
  )
  it("encodes entity IDs as individual path segments on the configured origin", () => {
    const eventId = "evt/one?#&%"
    const result = render(
      { kind: "event.cancelled", eventId, eventTitle: "An event" },
      "ru"
    )
    expect(result.text).toContain(`${origin}/events/evt%2Fone%3F%23%26%25`)
    expect(result.text).toContain(
      `${origin}/api/events/evt%2Fone%3F%23%26%25/calendar.ics?locale=ru`
    )
    expect(
      result.text
        .match(/https:\/\/[^\s]+/gu)
        ?.map((value) => new URL(value).origin)
    ).toEqual([origin, origin])
    expect(render({ ...tickets, orderId: "order/a?b" }).text).toContain(
      `${origin}/orders/order%2Fa%3Fb`
    )
    expect(
      render({ kind: "support.changed", caseId: "case/a#b", action: "message" })
        .text
    ).toContain(`${origin}/support/cases/case%2Fa%23b`)
  })
  it("uses implemented authenticated page routes without tokens or invented return URLs", () => {
    const expected = [
      "/orders/order-123",
      "/payments/payment-123",
      "/events/event-123",
      "/events/event-123",
      "/payments/payment-123",
      "/organizer/events/event-123/payouts",
      "/support/cases/case-123",
      "/organizer/events/event-123",
      "/orders/order-123",
    ]
    fixtures.forEach((input, index) => {
      const result = render(input)
      expect(result.text).toContain(`${origin}${expected[index]}`)
      expect(result.text).toContain("Sign in")
      expect(result.text).not.toMatch(
        /returnTo=|[?&#](?:token|key|secret|credential)=/iu
      )
    })
  })
  it("links cancelled events to their current calendar export without claiming calendar or refund completion", () => {
    const result = render({ kind: "event.cancelled", ...event })
    expect(result.text).toContain(
      `${origin}/api/events/event-123/calendar.ics?locale=en`
    )
    expect(result.text).toContain(
      "After signing in, download the updated calendar file"
    )
    expect(result.text).toContain("Replace the earlier entry")
    expect(result.text).toContain(
      "Refund progress, where applicable, is tracked separately"
    )
    expect(result.text).not.toContain("refund was confirmed")
  })
  it("describes activation as a recorded fact and points to current sales eligibility", () => {
    const result = render({
      kind: "activation.completed",
      ...event,
      feeMinor: 500_000,
    })
    expect(result.text).toContain(
      "Check the current settings for its present sales eligibility."
    )
    expect(result.text).toContain("5,000.00 KZT")
  })
})

describe("ticket delivery parts and private support notices", () => {
  it.each([
    [1, 1, 1, "1 билет.", "1 PDF-файл"],
    [2, 2, 1, "2 билета.", "2 PDF-файла"],
    [5, 5, 1, "5 билетов.", "5 PDF-файлов"],
    [11, 5, 2, "11 билетов.", "5 PDF-файлов"],
    [21, 3, 4, "21 билет.", "3 PDF-файла"],
  ] as const)(
    "describes the total and attached PDFs in Russian for %s tickets",
    (ticketCount, attachmentCount, parts, ticketSentence, pdfSentence) => {
      const result = render(
        { ...tickets, ticketCount, attachmentCount, part: parts, parts },
        "ru"
      )
      expect(result.text).toContain(ticketSentence)
      expect(result.text).toContain(pdfSentence)
      expect(result.text).toContain(
        `Это письмо ${parts} из ${parts} по одному заказу.`
      )
    }
  )
  it("uses singular English counts and supports orders split beyond six tickets", () => {
    expect(
      render({ ...tickets, ticketCount: 1, attachmentCount: 1 }).text
    ).toContain(
      "Your order contains 1 ticket. This email contains 1 ticket PDF."
    )
    expect(
      render({
        ...tickets,
        ticketCount: 7,
        attachmentCount: 1,
        part: 2,
        parts: 2,
      }).text
    ).toContain("message 2 of 2")
  })
  it.each([
    { ticketCount: 0 },
    { ticketCount: 100_001 },
    { attachmentCount: 0 },
    { attachmentCount: 7 },
    { part: 0 },
    { part: 2 },
    { parts: 3 },
    { attachmentCount: 1 },
    { ticketCount: 13, attachmentCount: 6, parts: 2 },
    { ticketCount: 12, attachmentCount: 1, parts: 2 },
    { ticketCount: 7, attachmentCount: 6, parts: 3 },
  ])("rejects impossible attachment or part counts %#", (change) => {
    expect(() => unsafe({ ...tickets, ...change })).toThrow(
      NotificationTemplateError
    )
  })
  it.each(["created", "message", "assignment"] as const)(
    "keeps %s support updates generic and linked to the protected case",
    (action) => {
      const input = {
        kind: "support.changed",
        caseId: "case-123",
        action,
      } as const
      const result = render(input)
      expect(result.subject).toBe("Support case updated")
      expect(result.text).toContain(`${origin}/support/cases/case-123`)
      for (const extra of [
        { caseSubject: "PRIVATE-SUBJECT" },
        { message: "PRIVATE-MESSAGE" },
        { authorName: "PRIVATE-AUTHOR" },
        { attachmentName: "PRIVATE-FILE" },
        { eventTitle: "PRIVATE-EVENT" },
        { status: "open" },
      ])
        expect(() => unsafe({ ...input, ...extra })).toThrow(
          NotificationTemplateError
        )
    }
  )
  it.each(["open", "in_progress", "waiting_for_customer", "resolved"] as const)(
    "translates the canonical support status %s in every language",
    (status) => {
      for (const { locale } of localeCases) {
        const text = render(
          {
            kind: "support.changed",
            caseId: "case-123",
            action: "status",
            status,
          },
          locale
        ).text
        expect(text).not.toContain("undefined")
        expect(text).not.toContain("waiting_for_customer")
        expect(text).not.toContain("in_progress")
      }
    }
  )
  it("requires the canonical status on a status-change notice", () => {
    expect(() =>
      unsafe({ kind: "support.changed", caseId: "case-123", action: "status" })
    ).toThrow(NotificationTemplateError)
    expect(() =>
      unsafe({
        kind: "support.changed",
        caseId: "case-123",
        action: "status",
        status: "private status text",
      })
    ).toThrow(NotificationTemplateError)
  })
})
