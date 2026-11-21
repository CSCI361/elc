type Entry = { owner: string; schema: object; data: unknown; at: number }

export const cacheLimit = 100
export const cacheMaxAge = 10 * 60_000
const entries = new Map<string, Entry>()

export function readCached(
  owner: string,
  path: string,
  schema: object,
  now = Date.now()
): unknown {
  const entry = entries.get(path)
  if (entry && entry.owner !== owner) entries.clear()
  if (
    !entry ||
    entry.owner !== owner ||
    entry.schema !== schema ||
    now - entry.at > cacheMaxAge
  )
    return undefined
  return entry.data
}

export function writeCached(
  owner: string,
  path: string,
  schema: object,
  data: unknown,
  now = Date.now()
) {
  for (const [key, entry] of entries)
    if (entry.owner !== owner) entries.delete(key)
  entries.delete(path)
  entries.set(path, { owner, schema, data, at: now })
  if (entries.size > cacheLimit) entries.delete(entries.keys().next().value!)
}

export function forgetCached(path: string) {
  entries.delete(path)
}

export function clearCached() {
  entries.clear()
}
