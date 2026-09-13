import type { Locale } from "@elc/shared"
import { useAccount } from "../auth/context"

const copy = {
  title: ["Іс-шара аналитикасы", "Аналитика события", "Event analytics"],
  simulation: [
    "KZT · Симуляция. Нақты ақша қозғалысы жоқ.",
    "KZT · Симуляция. Без движения реальных денег.",
    "KZT · Simulation. No real money movement.",
  ],
  selectEvent: ["Іс-шара", "Событие", "Event"],
  availableEvents: [
    "Қолжетімді есептер",
    "Доступные отчеты",
    "Available reports",
  ],
  reportsIntro: [
    "Есебін көруге рұқсат етілген іс-шараны таңдаңыз.",
    "Выберите событие, отчет которого вам доступен.",
    "Choose an event whose report you can access.",
  ],
  searchEvents: ["Іс-шараны іздеу", "Поиск события", "Search events"],
  search: ["Іздеу", "Найти", "Search"],
  openReport: ["Есепті ашу", "Открыть отчет", "Open report"],
  noReports: [
    "Іздеуге сәйкес қолжетімді есеп жоқ.",
    "Нет доступных отчетов по этому запросу.",
    "No available reports match this search.",
  ],
  range: ["Кезең", "Период", "Period"],
  days7: ["Соңғы 7 күн", "Последние 7 дней", "Last 7 days"],
  days30: ["Соңғы 30 күн", "Последние 30 дней", "Last 30 days"],
  custom: ["Өз кезеңім", "Свой период", "Custom period"],
  start: ["Басталу күні", "Начальная дата", "Start date"],
  end: ["Аяқталу күні", "Конечная дата", "End date"],
  apply: ["Сүзгілерді қолдану", "Применить фильтры", "Apply filters"],
  ticketType: ["Билет түрі", "Тип билета", "Ticket type"],
  allTypes: ["Барлық билет түрлері", "Все типы билетов", "All ticket types"],
  moreTypes: [
    "Басқа билет түрлері",
    "Другие типы билетов",
    "More ticket types",
  ],
  firstTypes: [
    "Алғашқы билет түрлері",
    "Первые типы билетов",
    "First ticket types",
  ],
  moreEvents: ["Басқа іс-шаралар", "Другие события", "More events"],
  firstEvents: ["Алғашқы іс-шаралар", "Первые события", "First events"],
  calendarHint: [
    "Бүгінгі күнді қоса, іс-шараның уақыт белдеуіндегі күндер. Өз кезеңіңіз 180 күннен аспауы керек.",
    "Календарные дни в часовом поясе события, включая сегодня. Свой период не может превышать 180 дней.",
    "Calendar days in the event's time zone, including today. Custom periods can span at most 180 days.",
  ],
  invalidPeriod: [
    "Дұрыс күндерді таңдаңыз: басталу күні аяқталу күнінен кеш болмауы керек; ең көбі 180 күн.",
    "Выберите корректные даты: начало не позже конца, максимум 180 дней.",
    "Choose valid dates with the start on or before the end, at most 180 days.",
  ],
  periodSummary: ["Кезең қорытындысы", "Итоги периода", "Period totals"],
  generatedAt: ["Есеп жасалған уақыт", "Время отчета", "Report generated"],
  reportingZone: [
    "Есептің уақыт белдеуі",
    "Часовой пояс отчета",
    "Reporting time zone",
  ],
  basis: [
    "Сатылымдар тапсырыс аяқталған күніне, қайтарулар расталған күніне жатады. Бұрынғы сатылымдар қайтарылса, кезеңнің таза түсімі теріс болуы мүмкін.",
    "Продажи учитываются по дате завершения заказа, возвраты по дате подтверждения. Возврат прежних покупок может сделать чистую выручку периода отрицательной.",
    "Sales use order completion dates; refunds use confirmation dates. Refunds of earlier purchases can make a period's net revenue negative.",
  ],
  current: [
    "Іс-шараның ағымдағы күйі",
    "Текущее состояние события",
    "Current event state",
  ],
  currentHint: [
    "Күн сүзгісі бұл көрсеткіштерге қолданылмайды. Билет түрінің сүзгісі қолданылады.",
    "Фильтр дат не меняет эти показатели. Фильтр типа билета применяется.",
    "The date filter does not change these counts. The ticket-type filter applies.",
  ],
  capacityTitle: [
    "Сыйымдылық және билеттер",
    "Вместимость и билеты",
    "Capacity and tickets",
  ],
  attendanceTitle: ["Қатысу", "Посещаемость", "Attendance"],
  attendanceHint: [
    "Тек жарамды, кіруге тыйым салынбаған билеттер мен белсенді расталған кірулер. Жойылған және қайтарылған билеттер есептелмейді.",
    "Только действующие билеты без запрета на проход и активные подтвержденные проходы. Отмененные и возвращенные билеты исключены.",
    "Eligible tickets and active confirmed admissions only. Cancelled, refunded and admission-blocked tickets are excluded.",
  ],
  soldPercent: ["Сатылған үлес", "Доля проданных", "Percentage sold"],
  attendancePercent: ["Қатысу үлесі", "Доля посетивших", "Attendance rate"],
  zeroCapacity: [
    "Сыйымдылық нөлге тең: 0%.",
    "Нулевая вместимость: 0%.",
    "Zero capacity: 0%.",
  ],
  noEligible: [
    "Қатысуға жарамды билет жоқ: 0%.",
    "Нет билетов, допустимых к проходу: 0%.",
    "No eligible tickets: 0%.",
  ],
  offline: ["Офлайн кіру деректері", "Офлайн-проходы", "Offline admissions"],
  unresolvedOfflineReports: [
    "Қаралмаған хабарланған офлайн оқиғалар",
    "Неразобранные переданные офлайн-инциденты",
    "Reported offline incidents awaiting review",
  ],
  unsynchronized: [
    "Синхрондалмаған сканерлеулер",
    "Несинхронизированные сканирования",
    "Unsynchronized scans",
  ],
  unknown: ["Белгісіз", "Неизвестно", "Unknown"],
  offlineHint: [
    "Сервер ажыратылған құрылғылардағы сканерлеулер санын білмейді. Бұл деректер расталған қатысуға қосылмайды.",
    "Сервер не знает число сканирований на отключенных устройствах. Они не включены в подтвержденную посещаемость.",
    "The server cannot count scans on disconnected devices. These are separate from confirmed attendance.",
  ],
  otherPayments: ["Бөлек төлемдер", "Отдельные платежи", "Separate payments"],
  otherHint: [
    "Осы кезеңдегі іс-шараның барлық билет түрлеріне қатысты төлемдер. Билет түрінің сүзгісі қолданылмайды; билет түсіміне қосылмайды.",
    "Платежи события за выбранный период по всем типам билетов. Фильтр типа не применяется; в билетную выручку не включаются.",
    "Event payments in this period across all ticket types. The ticket-type filter does not apply; these are separate from ticket revenue.",
  ],
  feeHint: [
    "Өңдеу алымын ұйымдастырушы төлейді. Болжамды төлем = таза билет түсімі − өңдеу алымы + алымның қайтарымы. Бұл нақты төлем емес.",
    "Комиссию обработки оплачивает организатор. Оценка выплаты = чистая билетная выручка − комиссия + возврат комиссии. Это не выполненная выплата.",
    "The organizer pays processing fees. Estimated payout = net ticket revenue − processing fees + fee reversals. This is an estimate, not a completed payout.",
  ],
  dailySales: [
    "Күнделікті бастапқы билет сатылымы",
    "Первоначальные продажи билетов по дням",
    "Daily original ticket sales",
  ],
  dailyNet: [
    "Күнделікті таза билет түсімі",
    "Чистая билетная выручка по дням",
    "Daily net ticket revenue",
  ],
  dailyTable: [
    "Күнделікті сатылымдар кестесі",
    "Таблица продаж по дням",
    "Daily sales table",
  ],
  byType: ["Билет түрлері бойынша", "По типам билетов", "By ticket type"],
  byCampaign: ["Науқандар бойынша", "По кампаниям", "By campaign"],
  table: ["Деректер кестесі", "Таблица данных", "Data table"],
  date: ["Күн", "Дата", "Date"],
  name: ["Атауы", "Название", "Name"],
  empty: [
    "Осы бетте дерек жоқ.",
    "На этой странице нет данных.",
    "No records on this page.",
  ],
  next: ["Келесі бет", "Следующая страница", "Next page"],
  first: ["Бірінші бет", "Первая страница", "First page"],
  pageHint: [
    "Диаграмма мен кесте бір беттегі деректерді көрсетеді. Қорытынды барлық беттерді қамтиды.",
    "Диаграмма и таблица показывают одну страницу. Итоги включают все страницы.",
    "The chart and table show the same page. Period totals include all pages.",
  ],
  horizontal: [
    "Кестені көлденең айналдыруға болады.",
    "Таблицу можно прокручивать по горизонтали.",
    "Scroll the table horizontally to see every column.",
  ],
  completedOrders: [
    "Аяқталған тапсырыстар",
    "Завершенные заказы",
    "Completed orders",
  ],
  ticketsIssued: [
    "Берілген билеттер, тегін билеттермен бірге",
    "Выданные билеты, включая бесплатные",
    "Tickets issued, including free tickets",
  ],
  grossMinor: [
    "Бастапқы жалпы билет сомасы",
    "Первоначальная сумма билетов",
    "Original gross ticket sales",
  ],
  discountMinor: ["Жеңілдіктер", "Скидки", "Discounts"],
  refundedTickets: [
    "Қайтарылған билеттер",
    "Возвращенные билеты",
    "Refunded tickets",
  ],
  ticketRefundMinor: [
    "Расталған билет қайтарымдары",
    "Подтвержденные возвраты билетов",
    "Confirmed ticket refunds",
  ],
  netTicketRevenueMinor: [
    "Таза билет түсімі",
    "Чистая билетная выручка",
    "Net ticket revenue",
  ],
  processingFeeMinor: [
    "Ұйымдастырушы төлейтін өңдеу алымы",
    "Комиссия обработки за счет организатора",
    "Organizer-paid processing fees",
  ],
  processingFeeReversalMinor: [
    "Өңдеу алымының қайтарымы",
    "Возврат комиссии обработки",
    "Processing fee reversals",
  ],
  estimatedPayoutMinor: [
    "Ұйымдастырушыға болжамды төлем",
    "Оценка выплаты организатору",
    "Estimated organizer payout",
  ],
  committedRedemptions: [
    "Расталған науқан қолданулары",
    "Зафиксированные применения кампании",
    "Committed campaign redemptions",
  ],
  capacity: [
    "Бапталған сыйымдылық",
    "Настроенная вместимость",
    "Configured capacity",
  ],
  enabledInventory: [
    "Қосылған орындар",
    "Включенные места",
    "Enabled inventory",
  ],
  remainingInventory: [
    "Қалған қолжетімді орындар",
    "Оставшиеся доступные места",
    "Remaining available inventory",
  ],
  reservedInventory: [
    "Уақытша сақталған орындар",
    "Временно зарезервированные места",
    "Reserved inventory",
  ],
  issuedTickets: [
    "Барлық берілген билеттер",
    "Все выданные билеты",
    "All issued tickets",
  ],
  nonCancelledNonRefundedTickets: [
    "Жойылмаған және қайтарылмаған билеттер",
    "Билеты без отмены и возврата",
    "Non-cancelled, non-refunded tickets",
  ],
  cancelledTickets: [
    "Жойылған билеттер",
    "Отмененные билеты",
    "Cancelled tickets",
  ],
  eligibleAttendance: [
    "Қатысуға жарамды билеттер",
    "Билеты, допустимые к проходу",
    "Eligible attendance tickets",
  ],
  confirmedAttendance: [
    "Расталған белсенді кірулер",
    "Подтвержденные активные проходы",
    "Confirmed active attendance",
  ],
  absent: ["Әлі келмегендер", "Еще не пришли", "Absent holders"],
  activationFeesMinor: [
    "Іс-шараны белсендіру алымдары",
    "Сборы за активацию события",
    "Event activation fees",
  ],
  activationRefundsMinor: [
    "Белсендіру алымдарының қайтарымы",
    "Возвраты сборов за активацию",
    "Activation fee refunds",
  ],
  unfulfilledCompensationMinor: [
    "Орындалмаған төлемдер бойынша өтемақы",
    "Компенсация невыполненных платежей",
    "Unfulfilled-payment compensation",
  ],
  attendeeProcessingChargesMinor: [
    "Қатысушының өңдеу төлемдері",
    "Платежи участника за обработку",
    "Attendee processing charges",
  ],
  refundedAttendeeChargesMinor: [
    "Қатысушыға қайтарылған алымдар",
    "Возвращенные участнику сборы",
    "Refunded attendee charges",
  ],
} satisfies Record<string, readonly [string, string, string]>
export type AnalyticsTextKey = keyof typeof copy
export function analyticsText(locale: Locale, key: AnalyticsTextKey) {
  return copy[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2]
}
export function useAnalyticsText() {
  const { locale } = useAccount()
  return { locale, t: (key: AnalyticsTextKey) => analyticsText(locale, key) }
}
