import {
  accountResponseSchema,
  offlineDeviceSchema,
  offlineSnapshotManifestSchema,
  scannerEventSchema,
  offlineSyncResponseSchema,
} from "@elc/shared"
import { ServiceError } from "../transport"
import { parseAdmissionQr } from "../model"
import { OfflineFailure, offlinePolicy } from "./model"
import { tokenDigest } from "./verifier"
import type { OfflineApi } from "./api"
import type { OfflineVault } from "./vault"
import type { OfflineStore } from "./store"

/** Wall and monotonic time must advance together while this process is running. */
export class ClockWatch {
  private previous: { wall: number; monotonic: number } | null = null
  sample(wall: number, monotonic: number): boolean {
    const previous = this.previous
    this.previous = { wall, monotonic }
    if (!previous) return false
    return (
      wall - previous.wall + offlinePolicy.rollbackTolerance <
      Math.max(0, monotonic - previous.monotonic)
    )
  }
  reset() {
    this.previous = null
  }
}
export class OfflineController {
  private readonly vault: OfflineVault
  private readonly api: OfflineApi
  private readonly id: () => string
  private readonly monotonic: () => number
  private readonly onFreshAnchor: () => void
  constructor(
    vault: OfflineVault,
    api: OfflineApi,
    id: () => string,
    monotonic = () => performance.now(),
    onFreshAnchor = () => {}
  ) {
    this.vault = vault
    this.api = api
    this.id = id
    this.monotonic = monotonic
    this.onFreshAnchor = onFreshAnchor
  }
  private async prove(
    accountId: string,
    current: () => void,
    store: OfflineStore
  ) {
    try {
      const account = accountResponseSchema.parse(await this.api.account())
      current()
      if (account.user.id !== accountId || !account.user.emailVerified)
        throw new OfflineFailure("wrong_account")
    } catch (error) {
      if (
        (error instanceof ServiceError &&
          [401, 403].includes(error.status ?? 0)) ||
        (error instanceof OfflineFailure && error.code === "wrong_account")
      )
        await store.lock()
      throw error
    }
  }
  async refresh(accountId: string, eventId: string, label: string) {
    return this.vault.run(accountId, async (store, current) => {
      await this.prove(accountId, current, store)
      try {
        const event = scannerEventSchema.parse(await this.api.event(eventId))
        current()
        if (
          event.id !== eventId ||
          !event.permissions.includes("ticket:scan") ||
          event.cancelledAt ||
          event.suspendedAt
        ) {
          await store.invalidateEvent(eventId)
          throw new OfflineFailure("snapshot_unavailable")
        }
        const registration = await store.deviceRegistration(eventId, label)
        // Replaying registration retrieves current device revocation without creating another device.
        const device = offlineDeviceSchema.parse(
          await this.api.register(
            eventId,
            registration.registration_request_id,
            registration.label
          )
        )
        current()
        await store.saveDevice(eventId, device)
        if (device.revokedAt) throw new OfflineFailure("device_revoked")
        const requestedAt = this.monotonic()
        const manifest = offlineSnapshotManifestSchema.parse(
          await this.api.snapshot(eventId, device.id, this.id())
        )
        current()
        const pages: unknown[] = []
        for (const descriptor of manifest.pages) {
          pages.push(
            await this.api.page(eventId, manifest.snapshotId, descriptor.page)
          )
          current()
        }
        // Include the entire request and page download time. This conservatively overestimates server time instead of extending snapshot validity by network latency.
        const estimate =
          Date.parse(manifest.issuedAt) +
          Math.max(0, this.monotonic() - requestedAt)
        await store.installSnapshot(
          manifest,
          pages,
          event,
          Math.floor(estimate)
        )
        this.onFreshAnchor()
        return store.status(eventId)
      } catch (error) {
        if (
          error instanceof ServiceError &&
          [401, 403, 404, 409, 410].includes(error.status ?? 0)
        )
          await store.invalidateEvent(eventId)
        throw error
      }
    })
  }
  /** Uploading a previous journal does not require a current scanner assignment. The server records denial. */
  async sync(accountId: string, selectedEventId?: string) {
    return this.vault.run(accountId, async (store, current) => {
      await this.prove(accountId, current, store)
      const eventIds = selectedEventId
        ? [selectedEventId]
        : await store.pendingEventIds()
      let remaining = 8
      for (const eventId of eventIds) {
        while (remaining-- > 0) {
          current()
          const batch = await store.sealBatch(eventId)
          if (!batch) break
          // An uncertain request stays sealed with exactly the same batch and operation IDs for replay.
          const response = await this.api.sync(eventId, batch)
          current()
          await store.acknowledge(eventId, response)
          if (
            offlineSyncResponseSchema
              .parse(response)
              .results.some((result) => result.result === "forbidden")
          )
            await store.invalidateEvent(eventId)
        }
        if (remaining <= 0) break
      }
    })
  }
  async beginOnline(
    accountId: string,
    eventId: string,
    token: string,
    operationId: string
  ) {
    const digest = tokenDigest(token)
    const active = await this.vault.restore()
    if (!active) return { operationId, locallyBlocked: false }
    if (active !== accountId) {
      await this.vault.signOut()
      return { operationId, locallyBlocked: false }
    }
    return this.vault.run(accountId, (store) =>
      store.beginOnline(eventId, digest, operationId)
    )
  }
  async finishOnline(
    accountId: string,
    eventId: string,
    operationId: string,
    result: string | null
  ) {
    if ((await this.vault.restore()) !== accountId) return
    return this.vault.run(accountId, (store) =>
      store.finishOnline(eventId, operationId, result)
    )
  }
  scan(accountId: string, eventId: string, raw: string) {
    const credential = parseAdmissionQr(raw)
    const digest = credential ? tokenDigest(credential.token) : null
    return this.vault.run(accountId, (store) => store.scan(eventId, digest))
  }
  undo(accountId: string, eventId: string, scanId: string) {
    return this.vault.run(accountId, (store) => store.undo(eventId, scanId))
  }
  status(accountId: string, eventId: string) {
    return this.vault.run(accountId, (store) => store.status(eventId))
  }
  events(accountId: string) {
    return this.vault.run(accountId, (store) => store.events())
  }
  attendees(accountId: string, eventId: string, query: string) {
    return this.vault.run(accountId, (store) => store.attendees(eventId, query))
  }
  unsafeClock(accountId: string) {
    return this.vault.run(accountId, (store) => store.markClockUnsafe())
  }
}
