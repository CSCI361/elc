import { apiErrorSchema, supportUploadResponseSchema } from "@elc/shared"
import { EventApiError, segment } from "../events/api"

export function supportAccessLost(error: unknown) {
  return (
    error instanceof EventApiError && [401, 403, 404].includes(error.status)
  )
}
export async function supportResponseError(response: Response, body?: unknown) {
  const parsed = apiErrorSchema.safeParse(
    body ?? (await response.json().catch(() => null))
  )
  return new EventApiError(
    parsed.success ? parsed.data.error.code : "INTERNAL_ERROR",
    response.status,
    parsed.success ? parsed.data.error.requestId : undefined
  )
}
export async function uploadSupportFile(
  caseId: string,
  requestId: string,
  file: File,
  signal: AbortSignal
) {
  const form = new FormData()
  form.set("requestId", requestId)
  form.set("file", file)
  const response = await fetch(
    `/api/support/cases/${segment(caseId)}/attachments`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      body: form,
      signal,
    }
  )
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok && response.status !== 422)
    throw await supportResponseError(response, body)
  const result = supportUploadResponseSchema.parse(body)
  if (result.attachment.caseId !== caseId)
    throw new EventApiError("INVALID_RESPONSE", 502)
  return result.attachment
}
