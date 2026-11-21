import type { Locale } from "@elc/shared"
import { money } from "./policies"

export interface DateParts {
  month: string
  day: string
  weekday: string
  time: string
}

const spaces = /[  ]/g

export function dateParts(
  iso: string,
  timeZone: string,
  locale: Locale
): DateParts {
  const date = new Date(iso)
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone, ...options })
      .format(date)
      .replace(spaces, " ")
  return {
    month: part({ month: "short" }),
    day: part({ day: "numeric" }),
    weekday: part({ weekday: "short" }),
    time: part({ hour: "numeric", minute: "2-digit" }),
  }
}

export const EVENT_CATEGORIES = [
  "Music",
  "Film",
  "Theatre",
  "Technology",
  "Business",
  "Education",
  "Sports",
  "Community",
] as const

const categoryNames: Record<
  (typeof EVENT_CATEGORIES)[number],
  Record<Locale, string>
> = {
  Music: { kk: "Музыка", ru: "Музыка", en: "Music" },
  Film: { kk: "Кино", ru: "Кино", en: "Film" },
  Theatre: { kk: "Театр", ru: "Театр", en: "Theatre" },
  Technology: { kk: "Технология", ru: "Технологии", en: "Technology" },
  Business: { kk: "Бизнес", ru: "Бизнес", en: "Business" },
  Education: { kk: "Білім беру", ru: "Образование", en: "Education" },
  Sports: { kk: "Спорт", ru: "Спорт", en: "Sports" },
  Community: { kk: "Қауымдастық", ru: "Сообщество", en: "Community" },
}

export function categoryLabel(category: string, locale: Locale): string {
  return category in categoryNames
    ? categoryNames[category as keyof typeof categoryNames][locale]
    : category
}

const freeLabels: Record<Locale, string> = {
  kk: "Тегін",
  ru: "Бесплатно",
  en: "Free",
}

export function priceText(minor: number, locale: Locale): string {
  return minor === 0 ? freeLabels[locale] : money(minor, locale)
}
