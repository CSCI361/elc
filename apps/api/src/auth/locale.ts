import { localeSchema, type Locale } from "@elc/shared"
import type { Bindings } from "../env"
import { AuthDeliveryError } from "./email"

/** Supported explicit language preferences only; a wildcard keeps the product default. */
export function authEmailLocale(
  savedLocale: unknown,
  acceptLanguage?: string | null
): Locale {
  const saved = localeSchema.safeParse(savedLocale)
  if (saved.success) return saved.data
  if (
    !acceptLanguage ||
    acceptLanguage.length > 4096 ||
    acceptLanguage.split("").some((character) => {
      const code = character.charCodeAt(0)
      return code !== 9 && (code < 32 || code === 127)
    })
  )
    return "kk"
  const preferences = acceptLanguage.split(",")
  if (preferences.length > 32) return "kk"
  let selected: Locale = "kk",
    selectedQuality = 0
  for (const preference of preferences) {
    const match =
      /^([a-z]{1,8}(?:-[a-z0-9]{1,8})*|\*)(?:[ \t]*;[ \t]*q[ \t]*=[ \t]*(0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?))?$/i.exec(
        preference.trim()
      )
    if (!match) continue
    const candidate = localeSchema.safeParse(
        match[1]!.toLowerCase().split("-")[0]
      ),
      quality = match[2] === undefined ? 1 : Number(match[2])
    if (candidate.success && quality > selectedQuality) {
      selected = candidate.data
      selectedQuality = quality
    }
  }
  return selected
}

/** userId comes from Better Auth's callback user, never the request body or session actor. */
export async function loadAuthEmailLocale(
  db: Bindings["DB"],
  userId: string,
  acceptLanguage?: string | null
): Promise<Locale> {
  try {
    const profile = await db
      .prepare("SELECT locale FROM profiles WHERE user_id = ? LIMIT 1")
      .bind(userId)
      .first<{ locale: string }>()
    return authEmailLocale(profile?.locale, acceptLanguage)
  } catch {
    // A failed account lookup must not silently select a conflicting browser locale.
    throw new AuthDeliveryError("EMAIL_DELIVERY_FAILED")
  }
}
