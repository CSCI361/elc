import { localeSchema, type Locale } from "@elc/shared"

export const localeStorageKey = "elc.locale.v1"

export function resolveLocale(
  saved: string | null,
  languages: readonly string[]
): Locale {
  const preference = localeSchema.safeParse(saved)
  if (preference.success) return preference.data
  for (const language of languages) {
    const candidate = localeSchema.safeParse(
      language.toLowerCase().split(/[-_]/)[0]
    )
    if (candidate.success) return candidate.data
  }
  return "kk"
}

export function readBrowserLocale(): Locale {
  try {
    return resolveLocale(
      localStorage.getItem(localeStorageKey),
      navigator.languages
    )
  } catch {
    return resolveLocale(null, navigator.languages)
  }
}

export function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(localeStorageKey, locale)
  } catch {
    /* The interface remains usable when browser storage is unavailable. */
  }
}
