import { localeSchema, type Locale } from "@elc/shared"

export const localeStorageKey = "elc.locale.v1"

export function resolveLocale(saved: string | null): Locale {
  const preference = localeSchema.safeParse(saved)
  return preference.success ? preference.data : "en"
}

export function readBrowserLocale(): Locale {
  try {
    return resolveLocale(localStorage.getItem(localeStorageKey))
  } catch {
    return resolveLocale(null)
  }
}

export function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(localeStorageKey, locale)
  } catch {
    /* The interface remains usable when browser storage is unavailable. */
  }
}
