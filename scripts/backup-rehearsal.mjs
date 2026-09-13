import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { prepareRestoreStatements } from "./lib/backup-sql.mjs"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import {
  createBackup,
  digest,
  exportLifetimeMs,
  restoreBackup,
  verifyBackup,
} from "./lib/backup-core.mjs"

/**
 * @param {{
 *   retentionCleanup?: typeof import('../apps/api/src/retention/index').runRetentionCleanup,
 *   retentionBacklog?: typeof import('../apps/api/src/retention/backlog').getRetentionBacklog,
 *   authCleanup?: typeof import('../apps/api/src/auth/delivery').cleanupAuthEmailIntents,
 *   domains?: ReturnType<typeof import('./fixtures/backup-domains').createBackupDomains>,
 *   expectBlocked?: boolean
 * }} options
 */
export async function runBackupRehearsal({
  retentionCleanup,
  retentionBacklog,
  authCleanup,
  domains,
  expectBlocked = false,
} = {}) {
  // Every resource is ephemeral. No persist path, development secrets, remote
  // credentials, external delivery or live local database is used by this rehearsal.
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script:
        "export default { fetch() { return new Response('disposable recovery'); } }",
      compatibilityDate: "2026-09-12",
      d1Databases: ["SOURCE", "RESTORED"],
      r2Buckets: ["BACKUPS", "FILES"],
    })
  )
  const now = Date.now()
  const day = 86400000
  /** @type {Record<string, unknown>} */
  const output = {
    localOnly: true,
    providerTimeTravel: "pending",
    providerReconciliation: "synthetic",
  }
  try {
    const source = await runtime.getD1Database("SOURCE")
    const restored = await runtime.getD1Database("RESTORED")
    const backups = await runtime.getR2Bucket("BACKUPS")
    const files = await runtime.getR2Bucket("FILES")
    const migrations = new URL("../apps/api/migrations/", import.meta.url)
    const names = (await readdir(migrations))
      .filter((name) => name.endsWith(".sql"))
      .sort()
    for (const name of names) {
      const sql = await readFile(new URL(name, migrations), "utf8")
      const statements = sql
        .split("--> statement-breakpoint")
        .filter((part) => part.replace(/^\s*--.*$/gm, "").trim())
      if (statements.length)
        await source.batch(
          statements.map((statement) => source.prepare(statement))
        )
    }
    output.migrations = names.length
    await source
      .prepare(
        "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('rehearsal-owner','Rehearsal','rehearsal@example.invalid',1,?,?)"
      )
      .bind(now, now)
      .run()
    for (const [id, at] of [
      ["retained-event", now],
      ["expired-draft", now - 181 * day],
    ]) {
      await source
        .prepare(`INSERT INTO events(id,organizer_id,title,description,category,venue_name,venue_address,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,calendar_uid,reporting_id,created_at,updated_at)
      VALUES(?,'rehearsal-owner','Recovery fixture','Synthetic','Music','Hall','Address',?,?,?,?,10,?,?,?,?)`)
        .bind(
          id,
          at + day,
          at + 2 * day,
          at,
          at + day,
          `calendar-${id}`,
          `reporting-${id}`,
          at,
          at
        )
        .run()
    }
    await source
      .prepare(
        "INSERT INTO event_permissions(event_id,user_id,permission,granted_at) VALUES('retained-event','rehearsal-owner','ticket:scan',?)"
      )
      .bind(now)
      .run()
    await source
      .prepare(
        "INSERT INTO offline_devices(id,account_id,event_id,label,registered_at) VALUES('device','rehearsal-owner','retained-event','Synthetic scanner',?)"
      )
      .bind(now - 1000)
      .run()
    await source
      .prepare(`INSERT INTO offline_snapshots(id,account_id,device_id,event_id,issued_at,expires_at,event_ends_at,ticket_count,key_id,manifest_json)
    VALUES('snapshot','rehearsal-owner','device','retained-event',?,?,?,0,'synthetic',NULL)`)
      .bind(now - 1000, now + 4 * 3600000 - 1000, now + 2 * day)
      .run()
    const immutableManifest = JSON.stringify({
      snapshotId: "snapshot",
      keyId: "synthetic",
      ticketCount: 0,
    })
    await source
      .prepare(
        "UPDATE offline_snapshots SET manifest_json=? WHERE id='snapshot'"
      )
      .bind(immutableManifest)
      .run()
    await domains?.seed({ source, files, now })
    await source
      .prepare(
        "INSERT INTO outbox(id,kind,entity_id,payload_json,created_at,next_attempt_at,completed_at) VALUES('completed-job','synthetic','retained-event','{}',?,?,?)"
      )
      .bind(now - 31 * day, now - 31 * day, now - 31 * day)
      .run()
    await source
      .prepare(
        "INSERT INTO retention_object_jobs(id,bucket,mode,object_key,created_at,next_attempt_at) VALUES('expired-file-job','files','key','private/support-files/expired-attachment',?,?)"
      )
      .bind(now - day, now - day)
      .run()
    await files.put(
      "private/support-files/retained-attachment",
      "retained image"
    )
    await files.put("private/support-files/expired-attachment", "expired image")
    const backupAdapter = {
      remote: false,
      policy: async () => ({
        private: true,
        expiresAfterSeconds: exportLifetimeMs / 1000,
      }),
      bookmark: async () => null, // Miniflare has no provider Time Travel.
      exportSql: async () =>
        Buffer.from(
          (
            await source
              .prepare("PRAGMA miniflare_d1_export(?,?,?);")
              .bind(false, false)
              .raw()
          )[0].join("\n")
        ),
      put: async (key, bytes, type) =>
        backups.put(key, bytes, {
          httpMetadata: { contentType: type, cacheControl: "no-store" },
        }),
      get: async (key) => {
        const object = await backups.get(key)
        return object ? Buffer.from(await object.arrayBuffer()) : null
      },
    }
    const exported = await createBackup({
      adapter: backupAdapter,
      sourceId: "disposable-source",
      reason: "pre-migration",
      now: () => now,
    })
    const manifest = JSON.parse(
      await (await backups.get(exported.manifestKey)).text()
    )
    const bytes = await backupAdapter.get(manifest.sqlKey)
    verifyBackup(manifest, bytes, "disposable-source", now)
    output.checksumVerified = digest(bytes) === manifest.sha256
    await domains?.afterExport()
    // Prove restore obtains the export contents rather than the current source.
    await source
      .prepare(
        "UPDATE events SET title='Changed after export' WHERE id='retained-event'"
      )
      .run()
    let paused = false
    const stages = []
    const control = {
      journal: async (entry) => stages.push(entry.stage),
      pause: async () => {
        paused = true
      },
      probePause: async () => ({
        mutations: paused,
        offlineSync: paused,
        consumers: paused,
        privateReads: paused,
        inFlightDrained: paused,
      }),
      protectCurrent: async () => {
        const protectedExport = await createBackup({
          adapter: backupAdapter,
          sourceId: "disposable-source",
          reason: "pre-restore",
          now: () => now + 1,
        })
        assert.ok(protectedExport.manifestKey)
        return { complete: true, manifestKey: protectedExport.manifestKey }
      },
      restoreSql: async (sql) => {
        assert.equal(paused, true)
        const tables = await restored
          .prepare(
            "SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name NOT GLOB '_cf_*'"
          )
          .first()
        assert.equal(tables.n, 0)
        await restored.batch(
          prepareRestoreStatements(sql.toString("utf8")).map((statement) =>
            restored.prepare(statement)
          )
        )
        const schemaQuery =
          "SELECT type,name FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' ORDER BY type,name"
        assert.deepEqual(
          (await restored.prepare(schemaQuery).all()).results,
          (await source.prepare(schemaQuery).all()).results
        )
        output.schemaObjectsRestored = true
        await assert.rejects(
          restored
            .prepare(
              "UPDATE offline_snapshots SET manifest_json='{}' WHERE id='snapshot'"
            )
            .run()
        )
        output.transitionGuardsRestored = true
        assert.equal(
          (
            await restored
              .prepare("SELECT title FROM events WHERE id='retained-event'")
              .first()
          ).title,
          "Recovery fixture"
        )
      },
      cleanup: async () => {
        assert.equal(paused, true)
        if (retentionCleanup) {
          for (let pass = 0; pass < 20; pass++) {
            if (authCleanup) await authCleanup({ DB: restored }, now)
            const result = await retentionCleanup(
              { DB: restored, FILES: files },
              now
            )
            if (
              retentionBacklog
                ? (await retentionBacklog(restored, now)).clear
                : Object.values(result).every((count) => count === 0)
            )
              break
            if (pass === 19)
              throw new Error("Retention did not drain within rehearsal bound")
          }
          const unfinished = await restored
            .prepare(
              "SELECT count(*) AS n FROM retention_object_jobs WHERE completed_at IS NULL"
            )
            .first()
          assert.equal(unfinished.n, 0)
          if (retentionBacklog)
            assert.equal((await retentionBacklog(restored, now)).clear, true)
          output.retention = "production-module"
        } else {
          // Node-only smoke rehearsal. The focused Vite test injects production cleanup.
          await files.delete("private/support-files/expired-attachment")
          await restored.batch([
            restored
              .prepare(
                "DELETE FROM events WHERE id='expired-draft' AND publication_state='draft' AND updated_at <= ?"
              )
              .bind(now - 180 * day),
            restored
              .prepare(
                "DELETE FROM outbox WHERE completed_at IS NOT NULL AND completed_at <= ?"
              )
              .bind(now - 30 * day),
          ])
          output.retention = "bounded-fixture-only"
        }
        assert.equal(
          await files.get("private/support-files/expired-attachment"),
          null
        )
        assert.equal(
          (
            await restored
              .prepare(
                "SELECT count(*) AS n FROM events WHERE id='expired-draft'"
              )
              .first()
          ).n,
          0
        )
        return { complete: true, pendingObjects: 0 }
      },
      invalidateSnapshots: async () => {
        const columns = await restored
          .prepare("PRAGMA table_info(offline_snapshots)")
          .all()
        if (!columns.results.some((column) => column.name === "invalidated_at"))
          throw new Error("Snapshot invalidation migration is required")
        await restored
          .prepare(
            "UPDATE offline_snapshots SET invalidated_at=? WHERE invalidated_at IS NULL"
          )
          .bind(now)
          .run()
        const record = await restored
          .prepare(
            "SELECT invalidated_at,manifest_json FROM offline_snapshots WHERE id='snapshot'"
          )
          .first()
        assert.equal(record.invalidated_at, now)
        assert.equal(record.manifest_json, immutableManifest)
        return { complete: true }
      },
      reconcile: async () => {
        assert.equal(paused, true)
        const integrity = await restored
          .prepare("PRAGMA foreign_key_check")
          .all()
        assert.deepEqual(integrity.results, [])
        assert.ok(
          (
            await restored
              .prepare("SELECT count(*) AS n FROM offline_devices")
              .first()
          ).n >= 1
        )
        if (!domains)
          assert.equal(
            (await restored.prepare("SELECT count(*) AS n FROM outbox").first())
              .n,
            0
          )
        assert.equal(
          await (
            await files.get("private/support-files/retained-attachment")
          ).text(),
          "retained image"
        )
        if (domains) {
          const reconciled = await domains.reconcile({ restored, files, now })
          output.domainReconciliation = reconciled.evidence
          output.providerReconciliation =
            "production-helpers-synthetic-provider"
          assert.deepEqual(
            (await restored.prepare("PRAGMA foreign_key_check").all()).results,
            []
          )
          return reconciled
        }
        return {
          ...Object.fromEntries(
            ["payments", "refunds", "admissions", "deliveries", "files"].map(
              (key) => [key, { complete: true, unresolved: 0 }]
            )
          ),
          dataLossReport:
            "Synthetic title edit after export was lost in the restored copy and retained in the pre-restore protected SQL export. No real payments, deliveries or admissions exist in these disposable resources.",
        }
      },
      resume: async () => {
        paused = false
      },
    }
    const recovering = restoreBackup({
      adapter: control,
      manifest,
      bytes,
      sourceId: "disposable-source",
      targetId: "disposable-restored",
      now: () => now + 2,
      resume: true,
    })
    if (expectBlocked) {
      assert.ok(domains, "A blocked domain rehearsal requires domain fixtures")
      await assert.rejects(
        recovering,
        /Recovery reconciliation or data-loss review is incomplete/
      )
      assert.equal(paused, true)
      assert.equal(stages.includes("ready-for-resume"), false)
      assert.equal(stages.includes("resumed"), false)
      output.stages = stages
      output.recoveryBlocked = true
      output.maintenanceStillPaused = true
      output.passed = true
      return output
    }
    const recovered = await recovering
    assert.equal(recovered.state, "resumed")
    assert.equal(paused, false)
    assert.equal(
      (
        await source
          .prepare("SELECT title FROM events WHERE id='retained-event'")
          .first()
      ).title,
      "Changed after export"
    )
    assert.equal(
      (await restored.prepare("SELECT count(*) AS n FROM events").first()).n,
      1
    )
    output.stages = stages
    output.sourcePreserved = true
    output.expiredFixtureRemoved = true
    output.staleSnapshotInvalidated = true
    output.immutableFilesRetained = true
    output.foreignKeysValid = true
    output.dataLossRecorded = true
    output.exportExpirationEnforced =
      assert.throws(() =>
        verifyBackup(
          manifest,
          bytes,
          "disposable-source",
          now + exportLifetimeMs
        )
      ) === undefined
    output.passed = true
    return output
  } finally {
    await runtime.dispose()
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(JSON.stringify(await runBackupRehearsal(), null, 2))
}
