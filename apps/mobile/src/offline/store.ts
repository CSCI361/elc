import {
  offlineDeviceSchema,
  offlineSnapshotManifestSchema,
  offlineSyncResponseSchema,
  offlineSyncUnitSchema,
  scannerEventSchema,
  syncOfflineScansSchema,
  offlineOperationResultSchema,
  type OfflineOperationResult,
  type OfflineSnapshotPage,
  type ScannerEvent,
} from "@elc/shared"
import { offlineSchema, type LocalDatabase, type SqlSession } from "./database"
import {
  anchoredTime,
  OfflineFailure,
  offlinePolicy,
  retentionTime,
  type BatchRow,
  type DeviceRow,
  type LocalOutcome,
  type LocalScanResult,
  type OfflineStatus,
  type PendingBatch,
  type SnapshotRow,
  type SnapshotTicket,
  type UnitRow,
  type VaultRow,
} from "./model"

export type SnapshotVerifier = (
  manifest: unknown,
  pages: unknown[],
  expected: { accountId: string; eventId: string; deviceId: string },
  now: number
) => Promise<OfflineSnapshotPage["tickets"] | null>
type Dependencies = {
  now: () => number
  id: () => string
  verify: SnapshotVerifier
  monotonic?: () => number
}

/** Access is bound to one account; callers obtain this store through the online-unlock vault. */
export class OfflineStore {
  private readonly db: LocalDatabase
  readonly accountId: string
  readonly environment: string
  private readonly dependencies: Dependencies
  private readonly verified = new Map<string, Map<string, SnapshotTicket>>()
  constructor(
    db: LocalDatabase,
    accountId: string,
    environment: string,
    dependencies: Dependencies
  ) {
    this.db = db
    this.accountId = accountId
    this.environment = environment
    this.dependencies = dependencies
  }
  async initialize() {
    await this.db.write(async (sql) => {
      await sql.exec(offlineSchema)
      await sql.run(
        "INSERT OR IGNORE INTO vault (singleton, account_id, environment) VALUES (1, ?, ?)",
        [this.accountId, this.environment]
      )
      await this.vault(sql, false)
    })
  }
  private async vault(sql: SqlSession, requireUnlocked = true) {
    const vault = await sql.first<VaultRow>(
      "SELECT * FROM vault WHERE singleton = 1"
    )
    if (
      !vault ||
      vault.account_id !== this.accountId ||
      vault.environment !== this.environment
    )
      throw new OfflineFailure("wrong_account")
    if (requireUnlocked && vault.locked) throw new OfflineFailure("locked")
    return vault
  }
  async unlockAfterOnlineProof(accountId: string) {
    if (accountId !== this.accountId) throw new OfflineFailure("wrong_account")
    await this.db.write(async (sql) => {
      await this.vault(sql, false)
      await sql.run("UPDATE vault SET locked = 0 WHERE singleton = 1")
    })
  }
  async lock() {
    this.verified.clear()
    await this.db.write(async (sql) => {
      await this.vault(sql, false)
      await sql.run("DELETE FROM snapshots")
      await sql.run("UPDATE vault SET locked = 1 WHERE singleton = 1")
    })
  }
  async close() {
    this.verified.clear()
    await this.db.close()
  }
  async assertUnlocked() {
    await this.db.read(async (sql) => {
      await this.vault(sql)
    })
  }
  async beginOnline(
    eventId: string,
    tokenHash: string,
    operationId: string
  ): Promise<{ operationId: string; locallyBlocked: boolean }> {
    if (!/^[a-f0-9]{64}$/.test(tokenHash))
      throw new OfflineFailure("invalid_response")
    return this.db.write(async (sql) => {
      const vault = await this.vault(sql)
      const pending = await sql.first(
        "SELECT 1 FROM local_admissions a JOIN units u ON u.scan_id = a.scan_id WHERE a.event_id = ? AND a.token_hash = ? AND u.stage <> 'acknowledged'",
        [eventId, tokenHash]
      )
      if (pending) return { operationId, locallyBlocked: true }
      const previous = await sql.first<{ operation_id: string; state: string }>(
        "SELECT operation_id, state FROM online_barriers WHERE event_id = ? AND token_hash = ?",
        [eventId, tokenHash]
      )
      if (previous?.state === "pending")
        return { operationId: previous.operation_id, locallyBlocked: false }
      if (
        !(await sql.first("SELECT 1 FROM devices WHERE event_id = ?", [
          eventId,
        ]))
      )
        return { operationId, locallyBlocked: false }
      await sql.run(
        "INSERT INTO online_barriers (event_id, token_hash, operation_id, state, created_at) VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(event_id, token_hash) DO UPDATE SET operation_id = excluded.operation_id, state = 'pending', created_at = excluded.created_at, acknowledged_at = NULL",
        [
          eventId,
          tokenHash,
          operationId,
          retentionTime(vault, this.dependencies.now()),
        ]
      )
      return { operationId, locallyBlocked: false }
    })
  }
  async finishOnline(
    eventId: string,
    operationId: string,
    result: string | null
  ) {
    await this.db.write(async (sql) => {
      const vault = await this.vault(sql)
      if (result === "forbidden") {
        await sql.run("DELETE FROM snapshots WHERE event_id = ?", [eventId])
        this.verified.clear()
      }
      const state =
        result === "checked_in" || result === "already_used"
          ? "checked_in"
          : [
                "invalid",
                "wrong_event",
                "cancelled",
                "refunded",
                "admission_blocked",
                "snapshot_expired",
              ].includes(result ?? "")
            ? "blocked"
            : null
      if (state)
        await sql.run(
          "UPDATE online_barriers SET state = ?, acknowledged_at = ? WHERE event_id = ? AND operation_id = ?",
          [
            state,
            retentionTime(vault, this.dependencies.now()),
            eventId,
            operationId,
          ]
        )
      else
        await sql.run(
          "DELETE FROM online_barriers WHERE event_id = ? AND operation_id = ?",
          [eventId, operationId]
        )
    })
  }
  async pendingEventIds(): Promise<string[]> {
    await this.cleanup()
    return this.db.read(async (sql) => {
      await this.vault(sql)
      return (
        await sql.all<{ event_id: string }>(
          "SELECT DISTINCT event_id FROM units WHERE stage <> 'acknowledged' ORDER BY event_id"
        )
      ).map((row) => row.event_id)
    })
  }
  async attendees(eventId: string, query: string): Promise<SnapshotTicket[]> {
    await this.cleanup()
    return this.db.read(async (sql) => {
      const vault = await this.vault(sql)
      const snapshot = await sql.first<SnapshotRow>(
        "SELECT * FROM snapshots WHERE event_id = ?",
        [eventId]
      )
      const tickets =
        snapshot &&
        (await this.verifiedTickets(
          snapshot,
          retentionTime(vault, this.dependencies.now())
        ))
      if (!tickets) throw new OfflineFailure("snapshot_unavailable")
      const normalized = query.trim().toLocaleLowerCase().slice(0, 100)
      return [...tickets.values()]
        .filter((ticket) =>
          ticket.attendeeName.toLocaleLowerCase().includes(normalized)
        )
        .slice(0, 50)
    })
  }
  async markClockUnsafe() {
    await this.db.write(async (sql) => {
      await this.vault(sql, false)
      await sql.run("UPDATE vault SET clock_unsafe = 1 WHERE singleton = 1")
      await sql.run("DELETE FROM snapshots")
    })
    this.verified.clear()
  }
  private async currentClock(sql: SqlSession, vault: VaultRow, wall: number) {
    const unsafe =
      vault.clock_unsafe ||
      wall + offlinePolicy.rollbackTolerance < vault.wall_high_water
    await sql.run(
      "UPDATE vault SET wall_high_water = MAX(wall_high_water, ?), clock_unsafe = ? WHERE singleton = 1",
      [wall, unsafe ? 1 : 0]
    )
    return { now: retentionTime(vault, wall), unsafe: !!unsafe }
  }
  async cleanup() {
    await this.db.write(async (sql) => {
      const vault = await this.vault(sql, false)
      const { now, unsafe } = await this.currentClock(
        sql,
        vault,
        this.dependencies.now()
      )
      await sql.run(
        "DELETE FROM snapshots WHERE expires_at <= ? OR ? = 1 OR ? = 1",
        [now, unsafe ? 1 : 0, vault.locked]
      )
      const aging = await sql.all<{ batch_id: string }>(
        "SELECT DISTINCT batch_id FROM units WHERE acknowledged_at IS NULL AND captured_at <= ? AND batch_id IS NOT NULL",
        [now - offlinePolicy.journalLifetime]
      )
      for (const batch of aging) {
        // Keep surviving sealed units immutable; a new batch may replay them with the same unit IDs.
        await sql.run("UPDATE units SET batch_id = NULL WHERE batch_id = ?", [
          batch.batch_id,
        ])
        await sql.run("DELETE FROM batches WHERE request_id = ?", [
          batch.batch_id,
        ])
      }
      await sql.run(
        "DELETE FROM attempts WHERE operation_id IN (SELECT scan_id FROM units WHERE acknowledged_at IS NOT NULL AND acknowledged_at <= ?)",
        [now - offlinePolicy.acknowledgedLifetime]
      )
      await sql.run(
        "DELETE FROM units WHERE (acknowledged_at IS NOT NULL AND acknowledged_at <= ?) OR (acknowledged_at IS NULL AND captured_at <= ?)",
        [
          now - offlinePolicy.acknowledgedLifetime,
          now - offlinePolicy.journalLifetime,
        ]
      )
      await sql.run(
        "DELETE FROM batches WHERE NOT EXISTS (SELECT 1 FROM units WHERE batch_id = batches.request_id)"
      )
      await sql.run(
        "DELETE FROM online_barriers WHERE (acknowledged_at IS NULL AND created_at <= ?) OR (acknowledged_at IS NOT NULL AND acknowledged_at <= ?)",
        [
          now - offlinePolicy.journalLifetime,
          now - offlinePolicy.acknowledgedLifetime,
        ]
      )
      await sql.run("DELETE FROM attempts WHERE captured_at <= ?", [
        now - offlinePolicy.journalLifetime,
      ])
    })
    await this.db.checkpoint()
    this.verified.clear()
  }
  async deviceRegistration(eventId: string, label: string) {
    return this.db.write(async (sql) => {
      await this.vault(sql)
      await sql.run(
        "INSERT OR IGNORE INTO devices (event_id, registration_request_id, label) VALUES (?, ?, ?)",
        [eventId, this.dependencies.id(), label]
      )
      const row = (await sql.first<DeviceRow>(
        "SELECT * FROM devices WHERE event_id = ?",
        [eventId]
      ))!
      if (row.revoked_at !== null) throw new OfflineFailure("device_revoked")
      return row
    })
  }
  async saveDevice(eventId: string, raw: unknown) {
    const device = offlineDeviceSchema.parse(raw)
    if (device.accountId !== this.accountId || device.eventId !== eventId)
      throw new OfflineFailure("wrong_account")
    await this.db.write(async (sql) => {
      await this.vault(sql)
      const row = await sql.first<DeviceRow>(
        "SELECT * FROM devices WHERE event_id = ?",
        [eventId]
      )
      if (!row || (row.device_id && row.device_id !== device.id))
        throw new OfflineFailure("invalid_response")
      await sql.run(
        "UPDATE devices SET device_id = ?, revoked_at = ? WHERE event_id = ?",
        [
          device.id,
          device.revokedAt ? Date.parse(device.revokedAt) : null,
          eventId,
        ]
      )
      if (device.revokedAt)
        await sql.run("DELETE FROM snapshots WHERE event_id = ?", [eventId])
    })
  }
  /** Called only with a freshly authenticated snapshot response. Pending journal rows are preserved. */
  async installSnapshot(
    rawManifest: unknown,
    pages: unknown[],
    rawEvent: unknown,
    serverEstimate = Date.parse(
      offlineSnapshotManifestSchema.parse(rawManifest).issuedAt
    )
  ) {
    const verificationStarted = this.dependencies.monotonic?.() ?? 0
    const manifest = offlineSnapshotManifestSchema.parse(rawManifest)
    const event = scannerEventSchema.parse(rawEvent)
    if (
      event.id !== manifest.eventId ||
      event.endsAt !== manifest.eventEndsAt ||
      !event.permissions.includes("ticket:scan") ||
      event.cancelledAt ||
      event.suspendedAt
    )
      throw new OfflineFailure("invalid_snapshot")
    const tickets = await this.dependencies.verify(
      manifest,
      pages,
      {
        accountId: this.accountId,
        eventId: event.id,
        deviceId: manifest.deviceId,
      },
      serverEstimate
    )
    if (!tickets) throw new OfflineFailure("invalid_snapshot")
    serverEstimate += Math.max(
      0,
      (this.dependencies.monotonic?.() ?? verificationStarted) -
        verificationStarted
    )
    if (serverEstimate >= Date.parse(manifest.expiresAt))
      throw new OfflineFailure("invalid_snapshot")
    const wall = this.dependencies.now()
    await this.db.write(async (sql) => {
      await this.vault(sql)
      const device = await sql.first<DeviceRow>(
        "SELECT * FROM devices WHERE event_id = ?",
        [event.id]
      )
      if (
        !device ||
        device.device_id !== manifest.deviceId ||
        device.revoked_at !== null
      )
        throw new OfflineFailure("device_revoked")
      await sql.run("DELETE FROM snapshots WHERE event_id = ?", [event.id])
      await sql.run(
        "INSERT INTO snapshots (event_id, snapshot_id, device_id, manifest_json, pages_json, event_json, issued_at, expires_at, received_wall_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          event.id,
          manifest.snapshotId,
          manifest.deviceId,
          JSON.stringify(manifest),
          JSON.stringify(pages),
          JSON.stringify(event),
          Date.parse(manifest.issuedAt),
          Date.parse(manifest.expiresAt),
          wall,
        ]
      )
      for (const ticket of tickets) {
        await sql.run(
          "INSERT INTO snapshot_tickets (event_id, ticket_id, token_hash, payload_json) VALUES (?, ?, ?, ?)",
          [event.id, ticket.ticketId, ticket.tokenHash, JSON.stringify(ticket)]
        )
        // A fresh authorized snapshot may reflect a server-side correction after acknowledgement.
        if (
          ticket.state === "valid" &&
          !ticket.admissionBlocked &&
          !ticket.activeCheckInId
        ) {
          await sql.run(
            "DELETE FROM online_barriers WHERE event_id = ? AND token_hash = ? AND acknowledged_at IS NOT NULL AND acknowledged_at < ?",
            [event.id, ticket.tokenHash, Date.parse(manifest.issuedAt)]
          )
          await sql.run(
            "DELETE FROM local_admissions WHERE event_id = ? AND token_hash = ? AND scan_id IN (SELECT scan_id FROM units WHERE acknowledged_at IS NOT NULL AND acknowledged_at < ?)",
            [event.id, ticket.tokenHash, Date.parse(manifest.issuedAt)]
          )
        }
      }
      await sql.run(
        "UPDATE vault SET trusted_server_at = ?, trusted_wall_at = ?, wall_high_water = ?, clock_unsafe = 0 WHERE singleton = 1",
        [serverEstimate, wall, wall]
      )
    })
    this.verified.clear()
    this.verified.set(
      manifest.snapshotId,
      new Map(tickets.map((ticket) => [ticket.tokenHash, ticket]))
    )
  }
  async invalidateEvent(eventId: string) {
    await this.db.write(async (sql) => {
      await this.vault(sql)
      await sql.run("DELETE FROM snapshots WHERE event_id = ?", [eventId])
    })
    this.verified.clear()
  }
  private async verifiedTickets(snapshot: SnapshotRow, now: number) {
    if (now < snapshot.issued_at || now >= snapshot.expires_at) return null
    const cached = this.verified.get(snapshot.snapshot_id)
    if (cached) return cached
    const tickets = await this.dependencies.verify(
      JSON.parse(snapshot.manifest_json),
      JSON.parse(snapshot.pages_json),
      {
        accountId: this.accountId,
        eventId: snapshot.event_id,
        deviceId: snapshot.device_id,
      },
      now
    )
    if (!tickets) return null
    const mapped = new Map(tickets.map((ticket) => [ticket.tokenHash, ticket]))
    this.verified.set(snapshot.snapshot_id, mapped)
    return mapped
  }
  async scan(
    eventId: string,
    tokenHash: string | null
  ): Promise<LocalScanResult> {
    const operationId = this.dependencies.id()
    const wall = this.dependencies.now()
    return this.db.write(async (sql) => {
      const vault = await this.vault(sql)
      const clock = await this.currentClock(sql, vault, wall)
      const snapshot = await sql.first<SnapshotRow>(
        "SELECT * FROM snapshots WHERE event_id = ?",
        [eventId]
      )
      const device = await sql.first<DeviceRow>(
        "SELECT * FROM devices WHERE event_id = ?",
        [eventId]
      )
      let result: LocalOutcome = "snapshot_unavailable"
      let ticket: SnapshotTicket | undefined
      if (clock.unsafe) result = "clock_unsafe"
      else if (tokenHash === null || !/^[a-f0-9]{64}$/.test(tokenHash))
        result = "invalid_qr"
      else if (
        snapshot &&
        device?.device_id === snapshot.device_id &&
        device.revoked_at === null
      ) {
        const tickets = await this.verifiedTickets(
          snapshot,
          anchoredTime(vault, wall)
        )
        if (tickets) {
          const event = scannerEventSchema.parse(
            JSON.parse(snapshot.event_json)
          )
          ticket = tickets.get(tokenHash)
          if (!ticket) result = "unknown_ticket"
          else if (ticket.state === "cancelled") result = "cancelled"
          else if (ticket.state === "refunded") result = "refunded"
          else if (
            (await sql.first(
              "SELECT 1 FROM online_barriers WHERE event_id = ? AND token_hash = ? AND state = 'blocked'",
              [eventId, tokenHash]
            )) ||
            ticket.admissionBlocked ||
            event.cancelledAt ||
            event.suspendedAt ||
            clock.now >= Date.parse(event.endsAt)
          )
            result = "admission_blocked"
          else if (
            (await sql.first(
              "SELECT 1 FROM online_barriers WHERE event_id = ? AND token_hash = ?",
              [eventId, tokenHash]
            )) ||
            ticket.state === "checked_in" ||
            ticket.activeCheckInId ||
            (await sql.first(
              "SELECT 1 FROM local_admissions WHERE event_id = ? AND token_hash = ?",
              [eventId, tokenHash]
            ))
          )
            result = "already_used"
          else result = "provisional"
        }
      }
      await sql.run(
        "INSERT INTO attempts (operation_id, event_id, result, captured_at, ticket_id) VALUES (?, ?, ?, ?, ?)",
        [operationId, eventId, result, clock.now, ticket?.ticketId ?? null]
      )
      if (result === "provisional" && ticket && snapshot && device?.device_id) {
        const sequence = device.sequence + 1
        const scan = {
          kind: "scan" as const,
          operationId,
          snapshotId: snapshot.snapshot_id,
          snapshotVersion: 1 as const,
          deviceTimestamp: new Date(clock.now).toISOString(),
          deviceSequence: sequence,
          ticketId: ticket.ticketId,
          tokenHash: ticket.tokenHash,
        }
        await sql.run("UPDATE devices SET sequence = ? WHERE event_id = ?", [
          sequence,
          eventId,
        ])
        await sql.run(
          "INSERT INTO units (scan_id, event_id, device_id, ticket_id, token_hash, sequence, scan_json, captured_at, captured_wall_at, stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
          [
            operationId,
            eventId,
            device.device_id,
            ticket.ticketId,
            ticket.tokenHash,
            sequence,
            JSON.stringify(scan),
            clock.now,
            wall,
          ]
        )
        await sql.run(
          "INSERT INTO local_admissions (event_id, token_hash, scan_id) VALUES (?, ?, ?)",
          [eventId, ticket.tokenHash, operationId]
        )
      }
      return {
        operationId,
        result,
        snapshotId: snapshot?.snapshot_id ?? null,
        snapshotIssuedAt: snapshot
          ? new Date(snapshot.issued_at).toISOString()
          : null,
        undoAvailable: result === "provisional",
      }
    })
  }
  async undo(eventId: string, scanId: string) {
    const outcome = await this.db.write(async (sql) => {
      const vault = await this.vault(sql)
      const wall = this.dependencies.now()
      const clock = await this.currentClock(sql, vault, wall)
      if (clock.unsafe) return { error: "clock_unsafe" as const }
      const row = await sql.first<UnitRow>(
        "SELECT * FROM units WHERE scan_id = ? AND event_id = ?",
        [scanId, eventId]
      )
      if (!row || row.stage !== "pending")
        throw new OfflineFailure("already_sealed")
      if (row.undo_json) return { undo: JSON.parse(row.undo_json) }
      const device = (await sql.first<DeviceRow>(
        "SELECT * FROM devices WHERE event_id = ?",
        [eventId]
      ))!
      const scan = JSON.parse(row.scan_json)
      const undo = {
        kind: "undo",
        operationId: this.dependencies.id(),
        originalOperationId: scanId,
        snapshotId: scan.snapshotId,
        snapshotVersion: 1,
        deviceTimestamp: new Date(
          Math.max(clock.now, row.captured_at)
        ).toISOString(),
        deviceSequence: device.sequence + 1,
      }
      offlineSyncUnitSchema.parse({ scan, undo })
      await sql.run("UPDATE units SET undo_json = ? WHERE scan_id = ?", [
        JSON.stringify(undo),
        scanId,
      ])
      await sql.run("UPDATE devices SET sequence = ? WHERE event_id = ?", [
        undo.deviceSequence,
        eventId,
      ])
      await sql.run("DELETE FROM local_admissions WHERE scan_id = ?", [scanId])
      return { undo }
    })
    if (outcome.error) throw new OfflineFailure(outcome.error)
    return outcome.undo
  }
  async sealBatch(eventId: string): Promise<PendingBatch | null> {
    return this.db.write(async (sql) => {
      const vault = await this.vault(sql)
      const existing = await sql.first<BatchRow>(
        "SELECT * FROM batches WHERE event_id = ? AND acknowledged_at IS NULL ORDER BY created_at, request_id LIMIT 1",
        [eventId]
      )
      if (existing)
        return syncOfflineScansSchema.parse(JSON.parse(existing.payload_json))
      const rows = await sql.all<UnitRow>(
        "SELECT * FROM units WHERE event_id = ? AND (stage = 'pending' OR (stage = 'sealed' AND batch_id IS NULL)) ORDER BY sequence LIMIT ?",
        [eventId, offlinePolicy.maximumBatchUnits]
      )
      if (!rows.length) return null
      const payload = syncOfflineScansSchema.parse({
        requestId: this.dependencies.id(),
        accountId: this.accountId,
        deviceId: rows[0]!.device_id,
        units: rows.map((row) => ({
          scan: JSON.parse(row.scan_json),
          ...(row.undo_json ? { undo: JSON.parse(row.undo_json) } : {}),
        })),
      })
      await sql.run(
        "INSERT INTO batches (request_id, event_id, device_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
        [
          payload.requestId,
          eventId,
          payload.deviceId,
          JSON.stringify(payload),
          retentionTime(vault, this.dependencies.now()),
        ]
      )
      for (const row of rows) {
        if (row.stage === "pending")
          await sql.run(
            "UPDATE units SET stage = 'sealed', batch_id = ? WHERE scan_id = ? AND stage = 'pending'",
            [payload.requestId, row.scan_id]
          )
        else
          await sql.run(
            "UPDATE units SET batch_id = ? WHERE scan_id = ? AND stage = 'sealed' AND batch_id IS NULL",
            [payload.requestId, row.scan_id]
          )
      }
      return payload
    })
  }
  async acknowledge(eventId: string, raw: unknown) {
    const response = offlineSyncResponseSchema.parse(raw)
    if (response.eventId !== eventId)
      throw new OfflineFailure("invalid_response")
    await this.db.write(async (sql) => {
      await this.vault(sql)
      const batch = await sql.first<BatchRow>(
        "SELECT * FROM batches WHERE request_id = ? AND event_id = ?",
        [response.requestId, eventId]
      )
      if (
        !batch ||
        response.deviceId !== batch.device_id ||
        response.results.some(
          (result) =>
            Date.parse(result.serverTimestamp) >
            Date.parse(response.acknowledgedAt)
        )
      )
        throw new OfflineFailure("invalid_response")
      const payload = syncOfflineScansSchema.parse(
        JSON.parse(batch.payload_json)
      )
      const expected = payload.units.flatMap((unit) =>
        unit.undo
          ? [unit.scan.operationId, unit.undo.operationId]
          : [unit.scan.operationId]
      )
      if (
        response.results.length !== expected.length ||
        new Set(response.results.map((result) => result.operationId)).size !==
          expected.length ||
        response.results.some(
          (result) =>
            !expected.includes(result.operationId) ||
            (result.result === "checked_in" && !result.checkInId)
        )
      )
        throw new OfflineFailure("invalid_response")
      for (const unit of payload.units)
        if (
          unit.undo &&
          response.results.some(
            (result) =>
              [unit.scan.operationId, unit.undo!.operationId].includes(
                result.operationId
              ) &&
              (result.result !== "locally_reversed" ||
                result.checkInId !== null)
          )
        )
          throw new OfflineFailure("invalid_response")
      if (batch.acknowledged_at !== null) return
      for (const unit of payload.units) {
        const results = response.results.filter(
          (result) =>
            result.operationId === unit.scan.operationId ||
            result.operationId === unit.undo?.operationId
        )
        await sql.run(
          "UPDATE units SET stage = 'acknowledged', acknowledged_at = ?, result_json = ? WHERE scan_id = ? AND stage = 'sealed'",
          [
            Date.parse(response.acknowledgedAt),
            JSON.stringify(results),
            unit.scan.operationId,
          ]
        )
      }
      await sql.run(
        "UPDATE batches SET acknowledged_at = ?, response_json = ? WHERE request_id = ?",
        [
          Date.parse(response.acknowledgedAt),
          JSON.stringify(response),
          response.requestId,
        ]
      )
      await sql.run("UPDATE devices SET last_sync_at = ? WHERE event_id = ?", [
        Date.parse(response.acknowledgedAt),
        eventId,
      ])
    })
  }
  async status(eventId: string): Promise<OfflineStatus> {
    await this.cleanup()
    return this.db.read(async (sql) => {
      const vault = await this.vault(sql)
      const snapshot = await sql.first<SnapshotRow>(
        "SELECT * FROM snapshots WHERE event_id = ?",
        [eventId]
      )
      const device = await sql.first<DeviceRow>(
        "SELECT * FROM devices WHERE event_id = ?",
        [eventId]
      )
      const counts = (await sql.first<{
        pending: number
        provisional: number
        sealed: number
        oldest: number | null
      }>(
        "SELECT COALESCE(SUM(stage <> 'acknowledged'), 0) AS pending, COALESCE(SUM(stage <> 'acknowledged' AND undo_json IS NULL), 0) AS provisional, COALESCE(SUM(stage = 'sealed'), 0) AS sealed, MIN(CASE WHEN stage <> 'acknowledged' THEN captured_at END) AS oldest FROM units WHERE event_id = ?",
        [eventId]
      ))!
      const conflict = (await sql.first<{ total: number }>(
        "SELECT count(*) AS total FROM units, json_each(units.result_json) result WHERE event_id = ? AND json_extract(result.value, '$.conflict') = 1",
        [eventId]
      ))!
      const rows = await sql.all<{ result_json: string }>(
        "SELECT result_json FROM units WHERE event_id = ? AND result_json IS NOT NULL ORDER BY acknowledged_at DESC, sequence DESC LIMIT 10",
        [eventId]
      )
      const onlinePending = (await sql.first<{ n: number }>(
        "SELECT count(*) AS n FROM online_barriers WHERE event_id = ? AND state = 'pending'",
        [eventId]
      ))!.n
      const oldest = counts.oldest
      const results: OfflineOperationResult[] = rows.flatMap((row) =>
        (JSON.parse(row.result_json) as unknown[]).map((result) =>
          offlineOperationResultSchema.parse(result)
        )
      )
      const manifest =
        snapshot &&
        (await this.verifiedTickets(
          snapshot,
          retentionTime(vault, this.dependencies.now())
        ))
          ? offlineSnapshotManifestSchema.parse(
              JSON.parse(snapshot.manifest_json)
            )
          : null
      const event = manifest
        ? scannerEventSchema.parse(JSON.parse(snapshot!.event_json))
        : null
      const estimatedServerNow = retentionTime(vault, this.dependencies.now())
      return {
        eventId,
        estimatedServerNow,
        admissionAvailable:
          !!event &&
          !vault.clock_unsafe &&
          !device?.revoked_at &&
          !event.cancelledAt &&
          !event.suspendedAt &&
          estimatedServerNow < Date.parse(event.endsAt),
        snapshot: manifest,
        event: manifest
          ? scannerEventSchema.parse(JSON.parse(snapshot!.event_json))
          : null,
        pendingCount: counts.pending,
        uncertainOnlineCount: onlinePending,
        provisionalCount: counts.provisional,
        sealedCount: counts.sealed,
        conflictCount: conflict.total,
        lastSyncAt: device?.last_sync_at ?? null,
        oldestPendingAt: oldest,
        deletionDeadline:
          oldest === null ? null : oldest + offlinePolicy.journalLifetime,
        warning:
          oldest !== null &&
          retentionTime(vault, this.dependencies.now()) - oldest >=
            offlinePolicy.syncWarningAfter,
        clockUnsafe: !!vault.clock_unsafe,
        deviceRevoked:
          device?.revoked_at !== null && device?.revoked_at !== undefined,
        recentResults: results.slice(0, 10),
      }
    })
  }
  async events(): Promise<ScannerEvent[]> {
    await this.cleanup()
    return this.db.read(async (sql) => {
      const vault = await this.vault(sql)
      const rows = await sql.all<SnapshotRow>(
        "SELECT * FROM snapshots ORDER BY event_id"
      )
      const events: ScannerEvent[] = []
      for (const snapshot of rows)
        if (
          await this.verifiedTickets(
            snapshot,
            retentionTime(vault, this.dependencies.now())
          )
        )
          events.push(scannerEventSchema.parse(JSON.parse(snapshot.event_json)))
      return events
    })
  }
}
