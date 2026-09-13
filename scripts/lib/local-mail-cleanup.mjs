import { Miniflare, convertV4MiniflareOptions } from "miniflare"

/** Remove only mail owned by the caller's exact local fixture account selection. */
export async function cleanupLocalFixtureMail(query, usersSql, persistPath) {
  const deliveries = `SELECT id FROM email_deliveries WHERE recipient_id IN (${usersSql})`
  const result = await query(
    `SELECT key FROM delivery_payload_objects WHERE delivery_id IN (${deliveries}) UNION SELECT payload_key AS key FROM email_deliveries WHERE id IN (${deliveries}) AND payload_key IS NOT NULL`
  )
  const keys = result
    .flatMap((page) => page.results ?? [])
    .map((row) => row.key)
  if (keys.length) {
    if (
      keys.some(
        (key) =>
          !/^private\/email-deliveries\/[A-Za-z0-9_-]+\/[a-f0-9]{64}\.json$/.test(
            key
          )
      )
    )
      throw new Error("Unexpected fixture mail object key")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script:
          "export default { fetch() { return new Response('local mailbox cleanup') } }",
        compatibilityDate: "2026-09-12",
        r2Buckets: { FILES: "elc-local-files" },
        r2Persist: persistPath,
      })
    )
    try {
      const files = await runtime.getR2Bucket("FILES")
      for (let i = 0; i < keys.length; i += 100)
        await files.delete(keys.slice(i, i + 100))
    } finally {
      await runtime.dispose()
    }
  }
  await query(
    [
      `DELETE FROM delivery_fanout WHERE source_id IN (SELECT source_id FROM email_deliveries WHERE id IN (${deliveries}))`,
      `DELETE FROM outbox WHERE id IN (SELECT source_id FROM email_deliveries WHERE id IN (${deliveries})) OR (kind='email.send' AND entity_id IN (${deliveries}))`,
      `DELETE FROM delivery_payload_objects WHERE delivery_id IN (${deliveries})`,
      `DELETE FROM auth_email_intents WHERE delivery_id IN (${deliveries})`,
      `DELETE FROM email_deliveries WHERE id IN (${deliveries})`,
    ].join("; ") + ";"
  )
}
