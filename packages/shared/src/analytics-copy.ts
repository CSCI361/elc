import type { Locale } from "./common"
const copy = {
  title: [
    "Қосымша аналитика",
    "Необязательная аналитика",
    "Optional analytics",
  ],
  detail: [
    "Рұқсат берсеңіз, GA4 ашық беттерге кірулер мен тапсырысты бастауды өлшейді. Бұл таңдау тек осы сайтқа қолданылады. Оны кез келген уақытта өшіре аласыз.",
    "С вашего согласия GA4 измеряет посещения публичных страниц и начала оформления. Выбор действует только на этом сайте. Его можно изменить в любое время.",
    "With your permission, GA4 measures public-page visits and checkout starts. This choice applies only to this site. You can turn it off at any time.",
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
