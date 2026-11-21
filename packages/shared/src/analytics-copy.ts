import type { Locale } from "./common"
const copy = {
  title: [
    "Қосымша аналитика",
    "Необязательная аналитика",
    "Optional analytics",
  ],
  detail: [
    "Сайтты жақсарту үшін кірулерді санауға рұқсат бересіз бе? Жарнама жоқ, кез келген уақытта өзгерте аласыз.",
    "Разрешите считать посещения, чтобы мы улучшали сайт. Без рекламы, изменить можно в любой момент.",
    "Can we count visits to improve the site? No ads, and you can change this anytime.",
  ],
  allow: ["Аналитикаға рұқсат беру", "Разрешить аналитику", "Allow analytics"],
  deny: ["Өшірулі қалдыру", "Оставить выключенной", "Keep analytics off"],
  withdraw: ["Аналитиканы өшіру", "Выключить аналитику", "Turn analytics off"],
  granted: [
    "Аналитикаға рұқсат берілді.",
    "Аналитика разрешена.",
    "Analytics is allowed.",
  ],
  denied: ["Аналитика өшірулі.", "Аналитика выключена.", "Analytics is off."],
} satisfies Record<string, readonly [string, string, string]>
export function analyticsConsentText(locale: Locale, key: keyof typeof copy) {
  return copy[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2]
}
