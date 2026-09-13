import type {
  OfflineOperationResult,
  OfflineSnapshotManifest,
  OfflineSyncUnit,
  ScannerEvent,
} from "@elc/shared"

export const offlinePolicy = {
  acknowledgedLifetime: 24 * 60 * 60_000,
  journalLifetime: 7 * 24 * 60 * 60_000,
  syncWarningAfter: 24 * 60 * 60_000,
  refreshInterval: 60_000,
  cleanupInterval: 30_000,
  // A correction of the device clock requires a fresh online time anchor.
  rollbackTolerance: 1000,
  maximumBatchUnits: 25,
} as const

export class OfflineFailure extends Error {
  readonly code:
    | "locked"
    | "wrong_account"
    | "clock_unsafe"
    | "snapshot_unavailable"
    | "device_revoked"
    | "already_sealed"
    | "invalid_response"
    | "invalid_snapshot"
    | "encryption_unavailable"
  constructor(code: OfflineFailure["code"]) {
    super(`Offline operation unavailable: ${code}`)
    this.code = code
  }
}
export type VaultRow = {
  account_id: string
  environment: string
  locked: number
  wall_high_water: number
  trusted_server_at: number | null
  trusted_wall_at: number | null
  clock_unsafe: number
}
export type DeviceRow = {
  event_id: string
  registration_request_id: string
  label: string
  device_id: string | null
  revoked_at: number | null
  sequence: number
  last_sync_at: number | null
}
export type SnapshotRow = {
  event_id: string
  snapshot_id: string
  device_id: string
  manifest_json: string
  pages_json: string
  event_json: string
  issued_at: number
  expires_at: number
  received_wall_at: number
}
export type UnitRow = {
  scan_id: string
  event_id: string
  device_id: string
  ticket_id: string
  token_hash: string
  sequence: number
  scan_json: string
  undo_json: string | null
  captured_at: number
  captured_wall_at: number
  stage: "pending" | "sealed" | "acknowledged"
  batch_id: string | null
  acknowledged_at: number | null
  result_json: string | null
}
export type BatchRow = {
  request_id: string
  event_id: string
  device_id: string
  payload_json: string
  created_at: number
  acknowledged_at: number | null
  response_json: string | null
}
export type SnapshotTicket = {
  ticketId: string
  tokenHash: string
  state: "valid" | "checked_in" | "cancelled" | "refunded"
  admissionBlocked: boolean
  activeCheckInId: string | null
  attendeeName: string
  seat: unknown
}
export type LocalOutcome =
  | "provisional"
  | "already_used"
  | "cancelled"
  | "refunded"
  | "admission_blocked"
  | "unknown_ticket"
  | "invalid_qr"
  | "snapshot_unavailable"
  | "clock_unsafe"
export type LocalScanResult = {
  operationId: string
  result: LocalOutcome
  snapshotId: string | null
  snapshotIssuedAt: string | null
  undoAvailable: boolean
}
export type PendingBatch = {
  requestId: string
  accountId: string
  deviceId: string
  units: OfflineSyncUnit[]
}
export type OfflineStatus = {
  eventId: string
  admissionAvailable: boolean
  estimatedServerNow: number
  snapshot: OfflineSnapshotManifest | null
  event: ScannerEvent | null
  pendingCount: number
  uncertainOnlineCount: number
  provisionalCount: number
  sealedCount: number
  conflictCount: number
  lastSyncAt: number | null
  oldestPendingAt: number | null
  deletionDeadline: number | null
  warning: boolean
  clockUnsafe: boolean
  deviceRevoked: boolean
  recentResults: OfflineOperationResult[]
}

/** Estimate elapsed time from a signed server anchor; retain raw wall time separately. */
export function anchoredTime(vault: VaultRow, wall: number): number {
  if (
    vault.clock_unsafe ||
    wall + offlinePolicy.rollbackTolerance < vault.wall_high_water ||
    vault.trusted_server_at === null ||
    vault.trusted_wall_at === null
  )
    throw new OfflineFailure("clock_unsafe")
  return vault.trusted_server_at + Math.max(0, wall - vault.trusted_wall_at)
}
export function retentionTime(vault: VaultRow, wall: number): number {
  if (vault.trusted_server_at === null || vault.trusted_wall_at === null)
    return wall
  return (
    vault.trusted_server_at +
    Math.max(0, Math.max(wall, vault.wall_high_water) - vault.trusted_wall_at)
  )
}
