import { z } from "zod"
import { accountResponseSchema } from "@elc/shared"
import { SerialQueue, type LocalDatabase } from "./database"
import { OfflineFailure } from "./model"
import { OfflineStore, type SnapshotVerifier } from "./store"
import { tokenDigest } from "./verifier"

export interface ProtectedStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}
type Dependencies = {
  storage: ProtectedStorage
  open: (filename: string, key: string) => Promise<LocalDatabase>
  randomKey: () => Promise<string>
  now: () => number
  monotonic?: () => number
  id: () => string
  verify: SnapshotVerifier
  account: () => Promise<unknown>
}
const registrySchema = z.array(
  z.strictObject({
    accountId: z.string().min(1),
    tag: z.string().regex(/^[a-f0-9]{32}$/),
  })
)
/** Keys and account markers use platform-protected storage. SQLCipher files contain all attendee data. */
export class OfflineVault {
  private readonly queue = new SerialQueue()
  private readonly dependencies: Dependencies
  private readonly namespace: string
  private readonly environment: string
  private active: OfflineStore | null = null
  private generation = 0
  constructor(
    environment: "local" | "preview" | "demo",
    apiOrigin: string,
    dependencies: Dependencies
  ) {
    this.environment = environment
    this.namespace = `elc-offline-${environment}-${tokenDigest(apiOrigin).slice(0, 16)}`
    this.dependencies = dependencies
  }
  private async registry() {
    const value = await this.dependencies.storage.get(
      `${this.namespace}-registry`
    )
    return value === null ? [] : registrySchema.parse(JSON.parse(value))
  }
  private async open(accountId: string, create: boolean) {
    const registry = await this.registry()
    const tag = tokenDigest(`${this.namespace}\n${accountId}`).slice(0, 32)
    const registered = registry.find((item) => item.accountId === accountId)
    if (registered && registered.tag !== tag)
      throw new OfflineFailure("encryption_unavailable")
    const keyName = `${this.namespace}-key-${tag}`
    let key = await this.dependencies.storage.get(keyName)
    if (!key) {
      // A lost key must not replace an existing journal with an empty database.
      if (registered || !create)
        throw new OfflineFailure("encryption_unavailable")
      key = await this.dependencies.randomKey()
      if (!/^[a-f0-9]{64}$/.test(key))
        throw new OfflineFailure("encryption_unavailable")
      await this.dependencies.storage.set(keyName, key)
    }
    if (!registered) {
      if (!create) throw new OfflineFailure("encryption_unavailable")
      registry.push({ accountId, tag })
      await this.dependencies.storage.set(
        `${this.namespace}-registry`,
        JSON.stringify(registry)
      )
    }
    const db = await this.dependencies.open(
      `elc-offline-${this.environment}-${tag}.db`,
      key
    )
    const store = new OfflineStore(
      db,
      accountId,
      this.environment,
      this.dependencies
    )
    try {
      await store.initialize()
      await store.cleanup()
      return store
    } catch (error) {
      await store.close()
      throw error
    }
  }
  private assertGeneration(generation: number) {
    if (generation !== this.generation) throw new OfflineFailure("locked")
  }
  private async detach() {
    // Removing this marker first makes a crash during logout fail closed on the next launch.
    const persistedAccount = await this.dependencies.storage.get(
      `${this.namespace}-active`
    )
    await this.dependencies.storage.remove(`${this.namespace}-active`)
    const old =
      this.active ??
      (persistedAccount ? await this.open(persistedAccount, false) : null)
    this.active = null
    if (old) {
      try {
        await old.lock()
      } finally {
        await old.close()
      }
    }
  }
  connect(expectedAccountId: string): Promise<string> {
    const generation = ++this.generation
    return this.queue.run(async () => {
      this.assertGeneration(generation)
      const account = accountResponseSchema.parse(
        await this.dependencies.account()
      )
      this.assertGeneration(generation)
      if (
        account.user.id !== expectedAccountId ||
        !account.user.emailVerified
      ) {
        await this.detach()
        throw new OfflineFailure("wrong_account")
      }
      if (this.active?.accountId !== expectedAccountId) {
        await this.detach()
        this.active = await this.open(expectedAccountId, true)
      }
      this.assertGeneration(generation)
      await this.active.unlockAfterOnlineProof(expectedAccountId)
      this.assertGeneration(generation)
      await this.dependencies.storage.set(
        `${this.namespace}-active`,
        expectedAccountId
      )
      this.assertGeneration(generation)
      return expectedAccountId
    })
  }
  restore(): Promise<string | null> {
    const generation = this.generation
    return this.queue.run(async () => {
      this.assertGeneration(generation)
      const accountId = await this.dependencies.storage.get(
        `${this.namespace}-active`
      )
      if (!accountId) return null
      if (!this.active) this.active = await this.open(accountId, false)
      this.assertGeneration(generation)
      try {
        await this.active.assertUnlocked()
      } catch (error) {
        if (error instanceof OfflineFailure && error.code === "locked") {
          await this.detach()
          return null
        }
        throw error
      }
      return accountId
    })
  }
  run<T>(
    accountId: string,
    work: (store: OfflineStore, current: () => void) => Promise<T>
  ): Promise<T> {
    const generation = this.generation
    return this.queue.run(async () => {
      const current = () => {
        this.assertGeneration(generation)
        if (!this.active || this.active.accountId !== accountId)
          throw new OfflineFailure("wrong_account")
      }
      current()
      await this.active!.assertUnlocked()
      return work(this.active!, current)
    })
  }
  signOut(): Promise<void> {
    ++this.generation
    return this.queue.run(() => this.detach())
  }
  /** Inactive accounts are opened only for deletion, never for UI access or upload. */
  cleanup(): Promise<void> {
    return this.queue.run(async () => {
      const registry = await this.registry()
      for (const item of registry) {
        if (item.accountId === this.active?.accountId)
          await this.active.cleanup()
        else {
          const store = await this.open(item.accountId, false)
          try {
            await store.lock()
            await store.cleanup()
          } finally {
            await store.close()
          }
        }
      }
    })
  }
}
