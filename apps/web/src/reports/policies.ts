import {
  resolveEventReportRequestSchema,
  submitEventReportRequestSchema,
  type EventReportCategory,
  type EventReportQueueQuery,
} from "@elc/shared"

export type ReportDraft =
  | { ok: true; body: { category: EventReportCategory; details: string } }
  | { ok: false }

export type ResolutionKind = "dismissed" | "actioned"
export type ResolutionProblem = "reasonRequired" | "suspendFirst"
export type ResolutionDraft =
  | {
      ok: true
      body: {
        expectedRevision: number
        resolution: ResolutionKind
        reason: string
      }
    }
  | { ok: false; error: ResolutionProblem }

export interface ResolvableReport {
  revision: number
  eventSuspended: boolean
}

const validationRequestId = "validation"

export function reportDraft(category: string, details: string): ReportDraft {
  const parsed = submitEventReportRequestSchema.safeParse({
    requestId: validationRequestId,
    category,
    details,
  })
  if (!parsed.success) return { ok: false }
  return {
    ok: true,
    body: { category: parsed.data.category, details: parsed.data.details },
  }
}

export function resolutionDraft(
  report: ResolvableReport,
  resolution: ResolutionKind,
  reason: string
): ResolutionDraft {
  const parsed = resolveEventReportRequestSchema.safeParse({
    requestId: validationRequestId,
    expectedRevision: report.revision,
    resolution,
    reason,
  })
  if (!parsed.success) return { ok: false, error: "reasonRequired" }
  if (parsed.data.resolution === "actioned" && !report.eventSuspended)
    return { ok: false, error: "suspendFirst" }
  return {
    ok: true,
    body: {
      expectedRevision: parsed.data.expectedRevision,
      resolution: parsed.data.resolution,
      reason: parsed.data.reason,
    },
  }
}

export function reportQueuePath({
  state,
  cursor,
}: {
  state: EventReportQueueQuery["state"]
  cursor?: string
}): string {
  const params = new URLSearchParams({ state })
  if (cursor) params.set("cursor", cursor)
  return `/admin/event-reports?${params}`
}
