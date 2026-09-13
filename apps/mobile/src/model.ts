import {
  admissionPayloadSchema,
  scanResponseSchema,
  type ScanResponse,
  type ScannerEvent,
  localeSchema,
  type Locale,
} from "@elc/shared"

export type PendingScan = {
  eventId: string
  operationId: string
  credential: { kind: "elc_admission"; version: 1; token: string }
}
export function parseAdmissionQr(raw: string) {
  try {
    if (raw.length > 2048) return null
    const parsed = admissionPayloadSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
/** An uncertain transport outcome retains this exact request for explicit retry. */
export function prepareOnlineScan(
  eventId: string,
  raw: string,
  operationId: string
): PendingScan | null {
  const credential = parseAdmissionQr(raw)
  return credential ? { eventId, operationId, credential } : null
}
export function confirmedScanResponse(
  raw: unknown,
  operationId: string
): ScanResponse | null {
  const parsed = scanResponseSchema.safeParse(raw)
  if (
    !parsed.success ||
    parsed.data.operationId !== operationId ||
    (parsed.data.result === "checked_in" && !parsed.data.checkInId)
  )
    return null
  return parsed.data
}
export function eventCanScan(event: ScannerEvent, now: number): boolean {
  return (
    event.permissions.includes("ticket:scan") &&
    event.cancelledAt === null &&
    event.suspendedAt === null &&
    Date.parse(event.endsAt) > now
  )
}
export const canReverse = (event: ScannerEvent) =>
  event.permissions.includes("checkin:reverse")

export function selectDeviceLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const locale = localeSchema.safeParse(
      language.toLowerCase().split(/[-_]/)[0]
    )
    if (locale.success) return locale.data
  }
  return "kk"
}
