import type { Locale } from "@elc/shared"
import { useAccount } from "@/auth/context"
const copy = {
  title: [
    "Ұйымдастырушы төлемдері",
    "Выплаты организатору",
    "Organizer payouts",
  ],
  eligibility: [
    "Есептеу басталатын уақыт",
    "Дата начала расчета",
    "Payout eligibility begins",
  ],
  eligibilityHint: [
    "Төлем іс-шара аяқталғаннан кейін жеті күн өткенде есептелуі мүмкін.",
    "Выплата может быть рассчитана через семь дней после окончания события.",
    "A payout can be recorded seven days after the event ends.",
  ],
  holdsHint: [
    "Шешілмеген қайтару, дау немесе өтемақы өтініші бар тапсырыстың толық үлесі ұсталады. Күтілген немесе сәтсіз қайтару да ұсталымды сақтайды.",
    "Вся сумма вклада заказа удерживается при незакрытом возврате, споре или запросе компенсации. Ожидающий или неудачный возврат также сохраняет удержание.",
    "An unresolved refund, dispute, or compensation case holds the order's entire contribution. A pending or failed refund also keeps that contribution held.",
  ],
  summary: ["Ағымдағы қорытынды", "Текущая сводка", "Current summary"],
  amount: ["Сома", "Сумма", "Amount"],
  metric: ["Көрсеткіш", "Показатель", "Measure"],
  completedPaymentsMinor: [
    "Расталған билет төлемдері",
    "Подтвержденные платежи за билеты",
    "Confirmed ticket payments",
  ],
  confirmedRefundsMinor: [
    "Расталған қайтарулар",
    "Подтвержденные возвраты",
    "Confirmed refunds",
  ],
  remainingProcessingFeesMinor: [
    "Қалған өңдеу алымдары",
    "Оставшиеся комиссии обработки",
    "Remaining processing fees",
  ],
  estimatedContributionMinor: [
    "Ұйымдастырушының есептік үлесі",
    "Расчетный вклад организатору",
    "Estimated organizer contribution",
  ],
  simulatedPaidMinor: [
    "Бастапқы төлемдер жиыны",
    "Итог исходных выплат",
    "Original payouts total",
  ],
  adjustmentMinor: [
    "Кейінгі қайтару түзетулері",
    "Последующие корректировки возвратов",
    "Later refund adjustments",
  ],
  outstandingMinor: [
    "Әлі төленбеген есептік үлес",
    "Еще не выплаченный расчетный вклад",
    "Outstanding contribution",
  ],
  heldMinor: ["Ұсталған үлес", "Удерживаемый вклад", "Held contribution"],
  availableMinor: [
    "Келесі төлемге қолжетімді",
    "Доступно для следующей выплаты",
    "Available for the next payout",
  ],
  records: ["Тіркелген төлемдер", "Записанные выплаты", "Recorded payouts"],
  empty: ["Төлемдер әзірге жоқ", "Выплат пока нет", "No payouts yet"],
  emptyHint: [
    "Ақылы іс-шара аяқталғаннан кейін жеті күн өткенде төлем осында тіркеледі.",
    "Выплата записывается здесь через семь дней после окончания платного события.",
    "A payout is recorded here seven days after a paid event ends.",
  ],
  recordsHint: [
    "Бастапқы төлем жазбалары өзгермейді. Кейін расталған қайтару бөлек теріс түзету ретінде көрсетіледі.",
    "Исходные записи выплат не изменяются. Позже подтвержденный возврат отображается отдельной отрицательной корректировкой.",
    "Original payout records do not change. A later confirmed refund appears as a separate negative adjustment.",
  ],
  recordedAt: ["Тіркелген уақыт", "Дата записи", "Recorded at"],
  orderCount: ["Тапсырыстар саны", "Количество заказов", "Order count"],
  breakdown: ["Тапсырыстар бойынша", "По заказам", "Order breakdown"],
  orderReference: ["Тапсырыс нөмірі", "Номер заказа", "Order reference"],
  paidMinor: ["Билет төлемі", "Платеж за билеты", "Ticket payment"],
  processingFeeMinor: ["Өңдеу алымы", "Комиссия обработки", "Processing fee"],
  contributionMinor: [
    "Бастапқы үлес",
    "Исходный вклад",
    "Original contribution",
  ],
  adjustment: [
    "Қайтару түзетуі",
    "Корректировка возврата",
    "Refund adjustment",
  ],
  adjustmentDate: ["Түзету уақыты", "Дата корректировки", "Adjustment date"],
  none: ["Жоқ", "Нет", "None"],
  reference: ["Төлем нөмірі", "Номер выплаты", "Payout reference"],
  loading: [
    "Төлем есебі жүктелуде…",
    "Загрузка отчета о выплатах…",
    "Loading payout report…",
  ],
  denied: [
    "Бұл есеп қолжетімсіз. Іс-шара иесі немесе аналитиканы қарау құқығы қажет.",
    "Отчет недоступен. Нужны права владельца события или просмотра аналитики.",
    "This report is unavailable. Event ownership or analytics permission is required.",
  ],
  horizontal: [
    "Толық кестені көру үшін көлденең жылжытыңыз.",
    "Прокрутите по горизонтали, чтобы увидеть всю таблицу.",
    "Scroll horizontally to view the full table.",
  ],
} satisfies Record<string, readonly [string, string, string]>
export type PayoutMessageKey = keyof typeof copy
export function payoutText(locale: Locale, key: PayoutMessageKey) {
  return copy[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2]
}
export function usePayoutText() {
  const { locale } = useAccount()
  return { locale, t: (key: PayoutMessageKey) => payoutText(locale, key) }
}
