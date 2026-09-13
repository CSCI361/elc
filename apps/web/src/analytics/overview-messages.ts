import type { Locale } from "@elc/shared"
import { useAccount } from "../auth/context"

const copy = {
  title: [
    "Ұйымдастырушының жалпы есебі",
    "Общая аналитика организатора",
    "Organizer overview",
  ],
  intro: [
    "Қазір көруге рұқсатыңыз бар барлық іс-шаралардың жиынтық деректері.",
    "Сводные данные всех событий, к которым у вас сейчас есть доступ к аналитике.",
    "Combined records for every event you can currently report on.",
  ],
  scope: [
    "Сүзгіге сәйкес қолжетімді іс-шаралар",
    "Доступные события по фильтру",
    "Authorized matching events",
  ],
  scopeHint: [
    "Қорытынды мен күнделікті деректер барлық сәйкес іс-шараларды қамтиды. Төмендегі бет ауысуы тек іс-шаралар кестесіне қатысты.",
    "Итоги и ежедневные данные включают все подходящие события. Пагинация ниже меняет только таблицу событий.",
    "Totals and daily rows include every matching event. Paging below changes only the event breakdown.",
  ],
  dates: [
    "Бүгінгі күнді қоса, Asia/Almaty уақыт белдеуіндегі күндер. Өз кезеңіңіз 180 күннен аспауы керек.",
    "Календарные дни в Asia/Almaty, включая сегодня. Свой период не может превышать 180 дней.",
    "Calendar days in Asia/Almaty, including today. Custom periods can span at most 180 days.",
  ],
  current: [
    "Барлық сәйкес іс-шаралардың ағымдағы күйі",
    "Текущее состояние всех подходящих событий",
    "Current state of all matching events",
  ],
  currentHint: [
    "Күн сүзгісі ағымдағы сыйымдылық пен қатысуға әсер етпейді. Іс-шара атауының сүзгісі қолданылады.",
    "Фильтр дат не меняет текущую вместимость и посещаемость. Фильтр названия события применяется.",
    "The date filter does not change current capacity or attendance. The event-title filter applies.",
  ],
  otherHint: [
    "Таңдалған кезеңдегі бөлек төлемдер. Олар билет түсіміне қосылмайды.",
    "Отдельные платежи за выбранный период. Они не включены в билетную выручку.",
    "Separate payments in the selected period. They are excluded from ticket revenue.",
  ],
  payouts: [
    "Тіркелген симуляциялық төлемдер",
    "Записанные симулированные выплаты",
    "Recorded simulated payouts",
  ],
  payoutHint: [
    "Төлемдер аяқталған күніне, түзетулер тіркелген күніне жатады. Болжамды төлем бөлек көрсетіледі. Банк аударымы жасалмайды.",
    "Выплаты учитываются по дате завершения, корректировки по дате записи. Оценка выплаты показана отдельно. Банковских переводов нет.",
    "Payouts use their completion date; adjustments use their recorded date. Estimated payout is shown separately. No bank transfer occurs.",
  ],
  completedCount: [
    "Тіркелген төлемдер саны",
    "Количество записанных выплат",
    "Recorded payout count",
  ],
  completedMinor: [
    "Тіркелген төлем сомасы",
    "Сумма записанных выплат",
    "Recorded payout amount",
  ],
  adjustmentCount: [
    "Түзетулер саны",
    "Количество корректировок",
    "Adjustment count",
  ],
  adjustmentMinor: [
    "Тіркелген түзетулер",
    "Записанные корректировки",
    "Recorded adjustments",
  ],
  netMinor: [
    "Түзетулерден кейінгі тіркелген сома",
    "Записанная сумма после корректировок",
    "Recorded amount after adjustments",
  ],
  byEvent: ["Іс-шаралар бойынша", "По событиям", "Event breakdown"],
  byEventHint: [
    "Сомалар Asia/Almaty уақыт белдеуіндегі таңдалған кезеңге жатады. Жеке есеп іс-шараның уақыт белдеуін қолданады.",
    "Суммы относятся к выбранному периоду в Asia/Almaty. Отдельный отчет использует часовой пояс события.",
    "Amounts use the selected Asia/Almaty period. Each individual report uses its event's time zone.",
  ],
  narrow: [
    "Сома дәл есептеу шегінен асты. Кезеңді немесе іс-шара атауының сүзгісін тарылтыңыз.",
    "Итог превышает предел точного расчета. Сократите период или уточните фильтр названия события.",
    "The total exceeds the exact reporting limit. Narrow the period or event-title filter.",
  ],
  invalid: [
    "Күндер немесе бет сілтемесі жарамсыз. Сүзгілерді қолданыңыз немесе бірінші бетті қайта жүктеңіз.",
    "Неверные даты или ссылка страницы. Примените фильтры или загрузите первую страницу заново.",
    "The dates or page cursor are invalid. Apply filters or reload the first page.",
  ],
  refresh: [
    "Жалпы есепті жаңарту",
    "Обновить общую аналитику",
    "Refresh overview",
  ],
} satisfies Record<string, readonly [string, string, string]>
export type OverviewTextKey = keyof typeof copy
export function overviewText(locale: Locale, key: OverviewTextKey) {
  return copy[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2]
}
export function useOverviewText() {
  const { locale } = useAccount()
  return { locale, t: (key: OverviewTextKey) => overviewText(locale, key) }
}
