import type { Locale } from "@elc/shared"
import { useAccount } from "../auth/context"
const copy = {
  title: ["Іс-шаралар тарихы", "История событий", "Event history"],
  timeline: ["Әрекеттер тарихы", "Лента действий", "Activity timeline"],
  overviewHint: [
    "Аяқталған және жойылған іс-шаралар. Шолу күндері Asia/Almaty уақыт белдеуінде көрсетіледі.",
    "Завершенные и отмененные события. Даты обзора указаны в часовом поясе Asia/Almaty.",
    "Completed and cancelled events. Overview dates use the Asia/Almaty time zone.",
  ],
  all: ["Барлығы", "Все", "All"],
  search: ["Атауы бойынша іздеу", "Поиск по названию", "Search by title"],
  phase: ["Іс-шара күйі", "Состояние события", "Event phase"],
  completed: ["Аяқталған", "Завершено", "Completed"],
  cancelled: ["Жойылған", "Отменено", "Cancelled"],
  start: ["Басталу күні", "Дата с", "Start date"],
  end: ["Аяқталу күні", "Дата по", "End date"],
  apply: ["Сүзгілерді қолдану", "Применить фильтры", "Apply filters"],
  reset: ["Сүзгілерді тазарту", "Сбросить фильтры", "Reset filters"],
  listDateHint: [
    "Іс-шараның басталу күні бойынша, 180 күнге дейін.",
    "По дате начала события, до 180 дней.",
    "Filter by event start date, up to 180 days.",
  ],
  empty: [
    "Бұл сүзгілерге сай іс-шара жоқ",
    "Нет событий по выбранным фильтрам",
    "No events match these filters",
  ],
  emptyFilteredHint: [
    "Күндерді не күйді өзгертіңіз немесе сүзгілерді тазартыңыз.",
    "Измените даты или состояние либо сбросьте фильтры.",
    "Change the dates or phase, or reset the filters.",
  ],
  emptyFirst: [
    "Аяқталған іс-шаралар әзірге жоқ",
    "Завершенных событий пока нет",
    "No finished events yet",
  ],
  emptyFirstHint: [
    "Іс-шара аяқталғанда немесе жойылғанда, оның тапсырыстары, кірулері мен әрекеттері осында сақталады.",
    "Когда событие завершится или будет отменено, оно появится здесь вместе с заказами, проходами и действиями.",
    "When an event ends or is cancelled, it moves here with its orders, check-ins and activity.",
  ],
  emptyTimeline: [
    "Бұл кезеңде әрекет жоқ",
    "Нет действий за этот период",
    "No activity in this period",
  ],
  emptyTimelineHint: [
    "Ұзағырақ кезеңді немесе басқа әрекет түрін таңдаңыз.",
    "Выберите период длиннее или другой тип действий.",
    "Pick a longer period or another activity type.",
  ],
  denied: [
    "Тарих қолжетімсіз. Іс-шара иесінің немесе тарихты қарау құқығы қажет.",
    "История недоступна. Нужны права владельца или разрешение на просмотр истории.",
    "History is unavailable. Event ownership or history permission is required.",
  ],
  duplicateDenied: [
    "Көшірме жасау қолжетімсіз. Іс-шараны басқару құқығы қажет.",
    "Дублирование недоступно. Нужно разрешение на управление событием.",
    "Duplication is unavailable. Event management permission is required.",
  ],
  invalidFilters: [
    "Күндер мен сүзгілерді тексеріңіз. Кезең 180 күннен аспауы керек.",
    "Проверьте даты и фильтры. Период не должен превышать 180 дней.",
    "Check the dates and filters. The period must not exceed 180 days.",
  ],
  expires: [
    "Тарихты сақтау мерзімі",
    "Срок хранения истории",
    "History retention date",
  ],
  retentionHint: [
    "Шешілмеген жұмыс деректердің жойылуын кейінге қалдыруы мүмкін.",
    "Незавершенные процессы могут отложить удаление.",
    "Unresolved work may postpone deletion.",
  ],
  held: [
    "Сақтау мерзімі ұзартылған",
    "Удаление отложено",
    "Retention is on hold",
  ],
  refund: ["Қайтару", "Возврат", "Refund"],
  payment_reconciliation: [
    "Төлемді салыстыру",
    "Сверка платежа",
    "Payment reconciliation",
  ],
  financial_case: [
    "Қаржылық өтініш",
    "Финансовое обращение",
    "Financial support case",
  ],
  reported_admission: [
    "Кіру есебін тексеру",
    "Проверка отчета о проходе",
    "Reported admission review",
  ],
  overview: [
    "Тарих шолуына оралу",
    "К обзору истории",
    "Back to history overview",
  ],
  duplicate: [
    "Жоба ретінде көшіру",
    "Создать копию-черновик",
    "Duplicate as a draft",
  ],
  duplicateHint: [
    "Сипаттама, орын, билет баптаулары және отыру сызбасы көшіріледі. Тапсырыстар, билеттер, төлемдер, өтініштер, шақырулар мен рұқсаттар көшірілмейді.",
    "Копируются описание, место, настройки билетов и схема мест. Заказы, билеты, платежи, обращения, приглашения и разрешения не копируются.",
    "Copies descriptions, venue, ticket settings and seating layout. Orders, tickets, payments, support cases, invitations and permissions are excluded.",
  ],
  activation: [
    "Жаңа жоба сізге тиесілі болады. Ақылы сатылым жеке тексеру мен белсендіруді қажет етеді.",
    "Новый черновик будет принадлежать вам. Платные продажи потребуют отдельной проверки и активации.",
    "You will own the new draft. Paid sales require its own checks and activation.",
  ],
  salesWindow: [
    "Барлық билет түрлері төмендегі жаңа тіркеу мерзімін қолданады.",
    "Все типы билетов будут использовать новый период регистрации ниже.",
    "All ticket types use the new registration window below.",
  ],
  startsAt: [
    "Жаңа іс-шараның басталуы",
    "Начало нового события",
    "New event starts",
  ],
  endsAt: [
    "Жаңа іс-шараның аяқталуы",
    "Окончание нового события",
    "New event ends",
  ],
  registrationOpensAt: [
    "Тіркеудің ашылуы",
    "Открытие регистрации",
    "Registration opens",
  ],
  registrationClosesAt: [
    "Тіркеудің жабылуы",
    "Закрытие регистрации",
    "Registration closes",
  ],
  timeZone: ["Уақыт белдеуі", "Часовой пояс", "Time zone"],
  dateHint: [
    "Уақытты көрсетілген іс-шара белдеуімен енгізіңіз. Жазғы уақыт ауысуындағы қайталанатын не жоқ уақытты таңдамаңыз.",
    "Введите время в указанном часовом поясе события. Избегайте повторяющегося или отсутствующего времени при переводе часов.",
    "Enter times in the event's stated zone. Avoid repeated or nonexistent times during a clock change.",
  ],
  invalidTimes: [
    "Болашақ басталу уақытын және дұрыс мерзімдерді таңдаңыз. Тіркеу іс-шара басталғаннан кеш жабылмауы керек.",
    "Выберите будущее начало и корректные интервалы. Регистрация должна закрываться не позже начала события.",
    "Choose a future start and valid time ranges. Registration must close no later than the event starts.",
  ],
  ineligible: [
    "Тек аяқталған немесе жойылған, бұғатталмаған іс-шараны көшіруге болады.",
    "Можно копировать только прошедшее или отмененное событие, не заблокированное модерацией.",
    "Only ended or cancelled events that are not suspended can be duplicated.",
  ],
  creating: ["Жоба жасалуда…", "Создание черновика…", "Creating draft…"],
  uncertain: [
    "Нәтиже әлі расталмады. Сол сұрауды қайталап, жасалған жобаны тексеріңіз. Жаңа көшірме сұрауы жіберілмейді.",
    "Результат еще не подтвержден. Повторите тот же запрос, чтобы проверить созданный черновик. Новый запрос на копию не отправляется.",
    "The outcome is not confirmed. Retry the same request to check the created draft. This will not start another duplication request.",
  ],
  retrySame: [
    "Сол сұрауды қайталау",
    "Повторить тот же запрос",
    "Retry the same request",
  ],
  stale: [
    "Бастапқы іс-шара өзгерді. Деректер қайта жүктелді; жібермес бұрын оларды тексеріңіз.",
    "Исходное событие изменилось. Данные обновлены; проверьте их перед отправкой.",
    "The source event changed. Its data was reloaded; review it before submitting again.",
  ],
  storageUnavailable: [
    "Браузер сұрауды қауіпсіз сақтай алмады. Қойындының сақтау рұқсатын тексеріп, қайталаңыз.",
    "Браузер не смог сохранить запрос. Проверьте доступ к хранилищу вкладки и повторите.",
    "The browser could not save the request. Check this tab's storage access and retry.",
  ],
  range: ["Кезең", "Период", "Period"],
  seven: ["Соңғы 7 күн", "Последние 7 дней", "Latest 7 days"],
  thirty: ["Соңғы 30 күн", "Последние 30 дней", "Latest 30 days"],
  custom: ["Өз кезеңіңіз", "Свой период", "Custom period"],
  periodHint: [
    "Әдепкі кезең соңғы қолжетімді әрекеттен есептеледі. Күндер іс-шара уақыт белдеуінде көрсетіледі.",
    "Период по умолчанию отсчитывается от последнего доступного действия. Даты указаны в часовом поясе события.",
    "Presets end at the latest visible activity. Dates use the event's time zone.",
  ],
  activityType: ["Әрекет түрі", "Тип действия", "Activity type"],
  event: ["Іс-шара өзгерістері", "Изменения события", "Event changes"],
  ticket_type: [
    "Билеттер мен орындар",
    "Билеты и места",
    "Ticket types and seats",
  ],
  campaign: ["Науқандар", "Кампании", "Campaigns"],
  permission: [
    "Рұқсаттар мен шақырулар",
    "Разрешения и приглашения",
    "Permissions and invitations",
  ],
  moderation: ["Модерация", "Модерация", "Moderation"],
  payment: [
    "Төлемдер мен тапсырыстар",
    "Платежи и заказы",
    "Payments and orders",
  ],
  checkin: ["Кіруді тіркеу", "Регистрация прохода", "Check-ins"],
  support: ["Қолдау өтініштері", "Обращения поддержки", "Support cases"],
  payout: [
    "Ұйымдастырушы төлемдері",
    "Выплаты организатору",
    "Organizer payouts",
  ],
  offline: ["Офлайн жұмыс", "Офлайн-работа", "Offline activity"],
  other: ["Басқа әрекеттер", "Другие действия", "Other activity"],
  activationType: [
    "Ақылы сатылымды белсендіру",
    "Активация платных продаж",
    "Paid-sales activation",
  ],
  system: ["Жүйе", "Система", "System"],
  unknown: ["Автор белгісіз", "Автор неизвестен", "Unknown actor"],
  original: ["Бастапқы жазба", "Исходная запись", "Original record"],
  reference: ["Жазба сілтемесі", "Идентификатор записи", "Record reference"],
  source: ["Бастапқы іс-шара", "Исходное событие", "Source event"],
  capacity: ["Сыйымдылық", "Вместимость", "Capacity"],
  ticketTypes: ["Билет түрлері", "Типы билетов", "Ticket types"],
  snapshot: ["Жіберілген мерзімдер", "Отправленные сроки", "Submitted dates"],
} satisfies Record<string, readonly [string, string, string]>
export type HistoryMessageKey = keyof typeof copy
export function historyText(locale: Locale, key: HistoryMessageKey) {
  return copy[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2]
}
export function useHistoryText() {
  const { locale } = useAccount()
  return { locale, t: (key: HistoryMessageKey) => historyText(locale, key) }
}
