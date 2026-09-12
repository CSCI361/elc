import { ApiFailure, requestHash } from "../db/transitions"
import type { Bindings } from "../env"
import { recoverTicketCredential } from "../tickets/credentials"
import type { ExportLocale } from "./labels"
import { renderTicketPdf, TICKET_PDF_VERSION } from "./pdf"
import { loadTicketPdfSource } from "./ticket-data"

type Environment = Pick<
  Bindings,
  "DB" | "FILES" | "APP_ORIGIN" | "TICKET_ENCRYPTION_KEY"
>
type Dependencies = { beforeReturn?: () => Promise<void> }

const contentHash = (source: Awaited<ReturnType<typeof loadTicketPdfSource>>) =>
  requestHash(TICKET_PDF_VERSION, {
    data: source.data,
    tokenHash: source.tokenHash,
  })

/** Every R2 read remains behind current purchaser/event:manage authorization. */
export async function downloadTicketPdf(
  env: Environment,
  actorId: string,
  ticketId: string,
  locale: ExportLocale,
  fontBytes: Uint8Array,
  dependencies: Dependencies = {}
) {
  let hook = dependencies.beforeReturn
  for (let attempt = 0; attempt < 3; attempt++) {
    const source = await loadTicketPdfSource(
      env.DB,
      env.APP_ORIGIN,
      actorId,
      ticketId,
      locale
    )
    const hash = await contentHash(source)
    const key = `private/ticket-pdfs/${encodeURIComponent(ticketId)}/${locale}/${hash}.pdf`
    const cached = await env.FILES.get(key)
    const bytes = cached
      ? new Uint8Array(await cached.arrayBuffer())
      : await renderTicketPdf(
          source.data,
          await recoverTicketCredential(
            ticketId,
            source.ciphertext,
            env.TICKET_ENCRYPTION_KEY
          ),
          fontBytes
        )
    await hook?.()
    hook = undefined
    // Rendering and R2 I/O may outlive a permission revocation or event/ticket update.
    if (
      (await contentHash(
        await loadTicketPdfSource(
          env.DB,
          env.APP_ORIGIN,
          actorId,
          ticketId,
          locale
        )
      )) !== hash
    )
      continue
    if (!cached) {
      await env.FILES.put(key, bytes, {
        httpMetadata: {
          contentType: "application/pdf",
          cacheControl: "private, no-store",
        },
        customMetadata: { contentHash: hash, renderer: TICKET_PDF_VERSION },
      })
      if (
        (await contentHash(
          await loadTicketPdfSource(
            env.DB,
            env.APP_ORIGIN,
            actorId,
            ticketId,
            locale
          )
        )) !== hash
      )
        continue
    }
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="elc-ticket-${locale}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    })
  }
  throw new ApiFailure(
    "CONFLICT",
    409,
    "The ticket changed during export. Download it again."
  )
}
