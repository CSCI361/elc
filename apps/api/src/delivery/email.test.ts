import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import { Buffer } from "node:buffer"
import {
  createResendEmailAdapter,
  emailLimits,
  emailRequestSchema,
  EmailTransportError,
  freezeEmailRequest,
  type EmailRequest,
} from "./email"

const providerId = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
const anotherProviderId = "37e4414c-5e25-4dbc-a071-43552a4bd53b"
const started = 1_800_000_000_000
const input = {
  deliveryId: "delivery-123",
  idempotencyKey: "elc-email/delivery-123",
  from: "elc Demo <tickets@example.test>",
  to: "attendee@example.test",
  subject: "Ваш билет / Билетіңіз / Your ticket",
  text: "Academic demonstration.\nYour ticket is attached.",
}
const pdf = (size = 32) => {
  const bytes = Buffer.alloc(size, 32)
  bytes.write("%PDF-1.7\n")
  return bytes.toString("base64")
}
const request = (): EmailRequest =>
  freezeEmailRequest({
    ...input,
    attachments: [{ filename: "ticket-123.pdf", content: pdf() }],
  })
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
const lookupResponse = (status = "delivered") => ({
  id: providerId,
  object: "email",
  from: input.from,
  to: [input.to],
  last_event: status,
  text: "PRIVATE PROVIDER BODY",
  html: "<p>PRIVATE</p>",
  headers: { secret: "PRIVATE HEADER" },
})
const stub = (
  implementation: typeof fetch = async () => response({ id: providerId })
) => vi.fn(implementation)
const adapter = (fetcher: typeof fetch, now: () => number = () => started) =>
  createResendEmailAdapter(
    { apiKey: "re_test_secret_never_log" },
    { fetch: fetcher, now }
  )
const fail = async (
  promise: Promise<unknown>,
  code: string,
  disposition: string,
  httpStatus: number | null = null
) => {
  const error = await promise.catch((value: unknown) => value)
  expect(error).toBeInstanceOf(EmailTransportError)
  expect(error).toMatchObject({ code, disposition, httpStatus })
  expect(String(error)).toBe(
    `EmailTransportError: Email transport failed: ${code}`
  )
  expect(error).not.toHaveProperty("cause")
  return error
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("frozen email request contract", () => {
  it("clones and deeply freezes the exact payload without trimming or changing it", () => {
    const raw = {
      ...input,
      attachments: [{ filename: "ticket.pdf", content: pdf() }],
    }
    const frozen = freezeEmailRequest(raw)
    expect(frozen).toEqual(raw)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.attachments)).toBe(true)
    expect(Object.isFrozen(frozen.attachments![0])).toBe(true)
    raw.subject = "A changed subject"
    raw.attachments[0]!.content = "changed"
    expect(frozen.subject).toBe(input.subject)
    expect(frozen.attachments![0]!.content).toBe(pdf())
    expect(() => Reflect.set(frozen, "subject", "another")).not.toThrow()
    expect(frozen.subject).toBe(input.subject)
  })
  it.each([
    { from: "elc <sender@example.test>\r\nBcc: stranger@example.test" },
    { from: "one@example.test, two@example.test" },
    { to: "attendee@example.test\nCc: stranger@example.test" },
    { to: ["one@example.test", "two@example.test"] },
    { subject: "Hello\r\nBcc: stranger@example.test" },
    { subject: "Invisible\u0085header" },
    { subject: "Invisible\u2028header" },
    { text: "Null\u0000body" },
    { deliveryId: "../another" },
    { idempotencyKey: "rotated-key" },
    { headers: { Bcc: "stranger@example.test" } },
    { html: "<p>unexpected body</p>" },
    { attachments: [{ filename: "../ticket.pdf", content: pdf() }] },
    {
      attachments: [
        { filename: "ticket.pdf\r\nContent-Type: text/html", content: pdf() },
      ],
    },
    { attachments: [{ filename: "ticket.exe", content: pdf() }] },
    {
      attachments: [
        { filename: "ticket.pdf", path: "https://private.example.test" },
      ],
    },
    {
      attachments: [
        {
          filename: "ticket.pdf",
          content: Buffer.from("not a PDF").toString("base64"),
        },
      ],
    },
    { attachments: [{ filename: "ticket.pdf", content: `${pdf()}\n` }] },
  ])("rejects unsafe or unsupported fields %#", (change) => {
    expect(emailRequestSchema.safeParse({ ...input, ...change }).success).toBe(
      false
    )
    expect(() => freezeEmailRequest({ ...input, ...change })).toThrow(
      EmailTransportError
    )
  })
  it("bounds UTF-8 text, attachment count, decoded file size and total base64 size", () => {
    expect(
      emailRequestSchema.safeParse({
        ...input,
        text: "界".repeat(Math.floor(emailLimits.textUtf8Bytes / 3)),
      }).success
    ).toBe(true)
    expect(
      emailRequestSchema.safeParse({
        ...input,
        text: "界".repeat(Math.floor(emailLimits.textUtf8Bytes / 3) + 1),
      }).success
    ).toBe(false)
    const six = Array.from({ length: 6 }, (_, index) => ({
      filename: `ticket-${index}.pdf`,
      content: pdf(),
    }))
    expect(
      emailRequestSchema.safeParse({ ...input, attachments: six }).success
    ).toBe(true)
    expect(
      emailRequestSchema.safeParse({
        ...input,
        attachments: [...six, { filename: "ticket-7.pdf", content: pdf() }],
      }).success
    ).toBe(false)
    expect(
      emailRequestSchema.safeParse({
        ...input,
        attachments: [
          {
            filename: "ticket.pdf",
            content: pdf(emailLimits.attachmentDecodedBytes + 1),
          },
        ],
      }).success
    ).toBe(false)
    const maximum = pdf(emailLimits.attachmentDecodedBytes)
    expect(
      emailRequestSchema.safeParse({
        ...input,
        attachments: [{ filename: "ticket.pdf", content: maximum }],
      }).success
    ).toBe(true)
    expect(
      emailRequestSchema.safeParse({
        ...input,
        attachments: Array.from({ length: 6 }, (_, index) => ({
          filename: `ticket-${index}.pdf`,
          content: maximum,
        })),
      }).success
    ).toBe(false)
    expect(
      emailRequestSchema.safeParse({ ...input, attachments: [six[0], six[0]] })
        .success
    ).toBe(false)
  })
  it("rejects noncanonical base64 padding bits", () => {
    const canonical = pdf(31)
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    const lastData = canonical.length - 3
    const changed =
      canonical.slice(0, lastData) +
      alphabet[alphabet.indexOf(canonical[lastData]!) + 1] +
      "=="
    expect(
      emailRequestSchema.safeParse({
        ...input,
        attachments: [{ filename: "ticket.pdf", content: changed }],
      }).success
    ).toBe(false)
  })
})

describe("Resend send transport", () => {
  it("posts exactly one bounded request to the fixed origin with its stable key and returns acceptance only", async () => {
    const fetcher = stub()
    const frozen = request()
    const result = await adapter(fetcher).send(frozen, {
      firstAttemptAt: started,
    })
    expect(result).toEqual({
      provider: "resend",
      deliveryId: input.deliveryId,
      providerEmailId: providerId,
      status: "accepted",
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, options] = fetcher.mock.calls[0]!
    expect(url).toBe("https://api.resend.com/emails")
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer re_test_secret_never_log",
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
    })
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(options!.body as string)).toEqual({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      attachments: frozen.attachments,
    })
    expect(Object.keys(result).sort()).toEqual([
      "deliveryId",
      "provider",
      "providerEmailId",
      "status",
    ])
  })
  it.each([undefined, "", "bad\r\nkey"])(
    "does no I/O without usable credentials %#",
    async (apiKey) => {
      const fetcher = stub()
      const client = createResendEmailAdapter(
        { apiKey },
        { fetch: fetcher, now: () => started }
      )
      await fail(
        client.send(request(), { firstAttemptAt: started }),
        "UNAVAILABLE",
        "unavailable"
      )
      await fail(
        client.lookup(providerId, request()),
        "UNAVAILABLE",
        "unavailable"
      )
      expect(fetcher).not.toHaveBeenCalled()
    }
  )
  it.each([23 * 3600_000, 24 * 3600_000, 7 * 24 * 3600_000])(
    "refuses automatic sending at or after the 23-hour boundary: %i",
    async (age) => {
      const fetcher = stub()
      await fail(
        adapter(fetcher, () => started + age).send(request(), {
          firstAttemptAt: started,
        }),
        "SEND_WINDOW_EXPIRED",
        "review_needed"
      )
      expect(fetcher).not.toHaveBeenCalled()
    }
  )
  it("allows the same frozen request just before the cutoff without changing its key or body", async () => {
    const fetcher = stub()
    let clock = started
    const client = adapter(fetcher, () => clock)
    const frozen = request()
    await client.send(frozen, { firstAttemptAt: started })
    clock += emailLimits.automaticSendWindowMs - 1
    await client.send(frozen, {
      firstAttemptAt: started,
      lastAttemptAt: started,
    })
    expect(fetcher.mock.calls[1]![1]?.body).toBe(
      fetcher.mock.calls[0]![1]?.body
    )
    expect(fetcher.mock.calls[1]![1]?.headers).toEqual(
      fetcher.mock.calls[0]![1]?.headers
    )
  })
  it("refuses backwards and invalid time, including persisted last attempts and regressions within an adapter", async () => {
    const fetcher = stub()
    let clock = started + 1000
    const client = adapter(fetcher, () => clock)
    await client.send(request(), { firstAttemptAt: started })
    clock--
    await fail(
      client.send(request(), { firstAttemptAt: started }),
      "CLOCK_UNSAFE",
      "review_needed"
    )
    await fail(
      adapter(fetcher, () => started - 1).send(request(), {
        firstAttemptAt: started,
      }),
      "CLOCK_UNSAFE",
      "review_needed"
    )
    await fail(
      adapter(fetcher).send(request(), {
        firstAttemptAt: started,
        lastAttemptAt: started + 1,
      }),
      "CLOCK_UNSAFE",
      "review_needed"
    )
    await fail(
      adapter(fetcher).send(request(), { firstAttemptAt: Number.NaN }),
      "CLOCK_UNSAFE",
      "review_needed"
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it("rejects an expired send lease before contacting the provider", async () => {
    const fetcher = stub()
    await fail(
      adapter(fetcher).send(request(), {
        firstAttemptAt: started,
        leaseExpiresAt: started,
      }),
      "SEND_LEASE_EXPIRED",
      "retryable"
    )
    expect(fetcher).not.toHaveBeenCalled()
    await adapter(fetcher).send(request(), {
      firstAttemptAt: started,
      leaseExpiresAt: started + 1,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    [500, { message: "SECRET" }, "PROVIDER_UNCERTAIN", "uncertain"],
    [503, { message: "SECRET" }, "PROVIDER_UNCERTAIN", "uncertain"],
    [408, {}, "PROVIDER_UNCERTAIN", "uncertain"],
    [
      429,
      { name: "rate_limit_exceeded", message: "SECRET" },
      "RATE_LIMITED",
      "retryable",
    ],
    [
      409,
      { name: "concurrent_idempotent_requests", message: "SECRET" },
      "IDEMPOTENCY_BUSY",
      "retryable",
    ],
    [
      409,
      { name: "invalid_idempotent_request", message: "SECRET" },
      "IDEMPOTENCY_MISMATCH",
      "review_needed",
    ],
    [
      409,
      { name: "unknown_conflict", message: "SECRET" },
      "PROVIDER_REJECTED",
      "permanent",
    ],
    [
      400,
      { name: "validation_error", message: "SECRET" },
      "PROVIDER_REJECTED",
      "permanent",
    ],
    [401, { message: "SECRET" }, "PROVIDER_REJECTED", "permanent"],
    [403, { message: "SECRET" }, "PROVIDER_REJECTED", "permanent"],
    [404, { message: "SECRET" }, "PROVIDER_REJECTED", "permanent"],
    [422, { message: "SECRET" }, "PROVIDER_REJECTED", "permanent"],
  ] as const)(
    "classifies HTTP %i without exposing provider content (%s)",
    async (status, body, code, disposition) => {
      const fetcher = stub(async () => response(body, status))
      const error = await fail(
        adapter(fetcher).send(request(), { firstAttemptAt: started }),
        code,
        disposition,
        status
      )
      expect(JSON.stringify(error)).not.toContain("SECRET")
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  )
  it("does not retry or rotate the key after an idempotency mismatch", async () => {
    const fetcher = stub(async () =>
      response({ name: "invalid_idempotent_request" }, 409)
    )
    await fail(
      adapter(fetcher).send(request(), { firstAttemptAt: started }),
      "IDEMPOTENCY_MISMATCH",
      "review_needed",
      409
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(
      new Headers(fetcher.mock.calls[0]![1]?.headers).get("Idempotency-Key")
    ).toBe(input.idempotencyKey)
  })
  it("treats a thrown network error as uncertain without leaking its message", async () => {
    const fetcher = stub(async () => {
      throw new Error("SECRET authorization body recipient")
    })
    await fail(
      adapter(fetcher).send(request(), { firstAttemptAt: started }),
      "NETWORK_UNCERTAIN",
      "uncertain"
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([
    {},
    { id: "not-a-provider-id" },
    { id: `${providerId}/secret` },
    { id: null },
  ])("treats a malformed successful response as uncertain %#", async (body) => {
    await fail(
      adapter(stub(async () => response(body))).send(request(), {
        firstAttemptAt: started,
      }),
      "INVALID_PROVIDER_RESPONSE",
      "uncertain"
    )
  })
  it("rejects invalid JSON and oversized successful responses without retaining their content", async () => {
    await fail(
      adapter(stub(async () => new Response("PRIVATE not JSON"))).send(
        request(),
        { firstAttemptAt: started }
      ),
      "INVALID_PROVIDER_RESPONSE",
      "uncertain",
      200
    )
    await fail(
      adapter(
        stub(async () =>
          response({ id: providerId, message: "P".repeat(5000) })
        )
      ).send(request(), { firstAttemptAt: started }),
      "INVALID_PROVIDER_RESPONSE",
      "uncertain",
      200
    )
  })
  it("enforces the ten-second deadline even if a transport ignores abort", async () => {
    vi.useFakeTimers()
    const fetcher = stub(() => new Promise<Response>(() => {}))
    const pending = fail(
      adapter(fetcher).send(request(), { firstAttemptAt: started }),
      "TIMEOUT",
      "uncertain"
    )
    await vi.advanceTimersByTimeAsync(9999)
    expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it("keeps the timeout active while consuming a successful response body", async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const fetcher = stub(
      async () => new Response(new ReadableStream({ start() {}, cancel }))
    )
    const pending = fail(
      adapter(fetcher).send(request(), { firstAttemptAt: started }),
      "TIMEOUT",
      "uncertain"
    )
    await vi.advanceTimersByTimeAsync(emailLimits.timeoutMs)
    await pending
    expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})

describe("Resend lookup binding and delivery status", () => {
  it.each([
    "bounced",
    "canceled",
    "clicked",
    "complained",
    "delivered",
    "delivery_delayed",
    "failed",
    "opened",
    "queued",
    "scheduled",
    "sent",
    "suppressed",
  ])(
    "returns the provider's %s status without treating acceptance as delivery",
    async (status) => {
      const fetcher = stub(async () => response(lookupResponse(status)))
      const result = await adapter(fetcher).lookup(providerId, request())
      expect(result).toEqual({
        provider: "resend",
        deliveryId: input.deliveryId,
        providerEmailId: providerId,
        status,
      })
      expect(fetcher.mock.calls[0]).toMatchObject([
        `https://api.resend.com/emails/${providerId}`,
        { method: "GET", redirect: "error" },
      ])
      expect(fetcher.mock.calls[0]![1]).not.toHaveProperty("body")
      expect(
        new Headers(fetcher.mock.calls[0]![1]?.headers).has("Idempotency-Key")
      ).toBe(false)
      expect(JSON.stringify(result)).not.toContain("PRIVATE")
    }
  )
  it.each([
    { id: anotherProviderId },
    { from: "Another <stranger@example.test>" },
    { to: ["stranger@example.test"] },
  ])(
    "requires the returned ID and mailbox binding to match %#",
    async (change) => {
      const fetcher = stub(async () =>
        response({ ...lookupResponse(), ...change })
      )
      await fail(
        adapter(fetcher).lookup(providerId, request()),
        "PROVIDER_BINDING_MISMATCH",
        "review_needed"
      )
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  )
  it.each([
    { to: [input.to, "stranger@example.test"] },
    { last_event: "new_unrecognized_status" },
    { last_event: null },
    { from: "bad\r\nheader" },
  ])("treats malformed lookup payloads as uncertain %#", async (change) => {
    await fail(
      adapter(
        stub(async () => response({ ...lookupResponse(), ...change }))
      ).lookup(providerId, request()),
      "INVALID_PROVIDER_RESPONSE",
      "uncertain"
    )
  })
  it("compares mailbox domains case-insensitively while retaining local-part identity", async () => {
    const fetcher = stub(async () =>
      response({
        ...lookupResponse(),
        from: "Provider-formatted name <tickets@EXAMPLE.TEST>",
        to: ["attendee@EXAMPLE.TEST"],
      })
    )
    expect((await adapter(fetcher).lookup(providerId, request())).status).toBe(
      "delivered"
    )
    await fail(
      adapter(
        stub(async () =>
          response({ ...lookupResponse(), to: ["ATTENDEE@example.test"] })
        )
      ).lookup(providerId, request()),
      "PROVIDER_BINDING_MISMATCH",
      "review_needed"
    )
  })
  it("refuses invalid provider IDs before constructing a URL and never resends a missing email", async () => {
    const fetcher = stub(async () =>
      response({ name: "not_found", message: "PRIVATE" }, 404)
    )
    await fail(
      adapter(fetcher).lookup(`${providerId}/../../elsewhere`, request()),
      "INVALID_PROVIDER_ID",
      "permanent"
    )
    expect(fetcher).not.toHaveBeenCalled()
    await fail(
      adapter(fetcher).lookup(providerId, request()),
      "PROVIDER_REJECTED",
      "permanent",
      404
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]![1]?.method).toBe("GET")
  })
  it("continues read-only reconciliation after the send window without an implicit resend", async () => {
    const fetcher = stub(async () => response(lookupResponse("sent")))
    expect(
      (
        await adapter(fetcher, () => started + 7 * 24 * 3600_000).lookup(
          providerId,
          request()
        )
      ).status
    ).toBe("sent")
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
