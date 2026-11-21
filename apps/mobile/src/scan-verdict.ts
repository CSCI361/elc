import type { ScanResponse } from "@elc/shared"
import type { Copy } from "./copy"
import type { LocalOutcome } from "./offline/model"

export type ScanMessage =
  | "invalidQr"
  | "notConfirmed"
  | "requestError"
  | "localPending"
export type Verdict = {
  tone: "success" | "danger" | "warning" | "neutral"
  title: keyof Copy
  body: keyof Copy | null
}

const refuse = (
  title: keyof Copy,
  body: keyof Copy = "doNotAdmit"
): Verdict => ({
  tone: "danger",
  title,
  body,
})

const online: Record<ScanResponse["result"], Verdict> = {
  checked_in: { tone: "success", title: "letIn", body: "checkedInDone" },
  already_used: refuse("alreadyUsed", "alreadyUsedBody"),
  invalid: refuse("invalid"),
  wrong_event: refuse("wrongEvent"),
  cancelled: refuse("ticketCancelled"),
  refunded: refuse("ticketRefunded"),
  admission_blocked: refuse("blocked"),
  forbidden: refuse("forbidden"),
  snapshot_expired: refuse("snapshotExpired"),
  locally_reversed: refuse("locallyReversed"),
}

const offline: Record<LocalOutcome, Verdict> = {
  provisional: { tone: "success", title: "letIn", body: "savedOnPhone" },
  already_used: refuse("alreadyUsed", "alreadyUsedBody"),
  cancelled: refuse("ticketCancelled"),
  refunded: refuse("ticketRefunded"),
  admission_blocked: refuse("blocked"),
  unknown_ticket: refuse("notOnList", "notOnListBody"),
  invalid_qr: refuse("notTicket", "notTicketBody"),
  snapshot_unavailable: refuse("snapshotExpired", "notOnListBody"),
  clock_unsafe: refuse("clockChanged", "clockChangedBody"),
}

const messages: Record<ScanMessage, Verdict> = {
  invalidQr: refuse("notTicket", "notTicketBody"),
  notConfirmed: { tone: "warning", title: "noAnswer", body: "noAnswerBody" },
  requestError: { tone: "danger", title: "requestError", body: null },
  localPending: { tone: "warning", title: "localPending", body: null },
}

export function scanVerdict(scan: {
  response?: ScanResponse["result"]
  local?: LocalOutcome
  undone?: boolean
  message?: ScanMessage
}): Verdict | null {
  if (scan.response) return online[scan.response]
  if (scan.local)
    return scan.undone
      ? { tone: "neutral", title: "undoDone", body: null }
      : offline[scan.local]
  return scan.message ? messages[scan.message] : null
}
