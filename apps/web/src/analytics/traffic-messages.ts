import { useAccount } from "../auth/context"

const copy = {
  title: ["GA4 трафигі", "Трафик GA4", "GA4 traffic"],
  hint: [
    "Келісім мен қайталанған кірулер нәтижеге әсер етеді. Бұл жиынтық салыстыру, адамдар бойынша дәл конверсия емес.",
    "На показатели влияют согласие и повторные посещения. Это сравнение агрегатов, а не точная конверсия по людям.",
    "Consent and repeat visits affect these figures. This is an aggregate comparison, not an exact conversion rate per person.",
  ],
  unavailable: [
    "Трафик деректері қолжетімсіз. elc сатылым есебі қолжетімді.",
    "Данные трафика недоступны. Отчет о продажах elc остается доступным.",
    "Traffic data is unavailable. The elc sales report remains available.",
  ],
  missing: [
    "GA4 есептері әлі бапталмаған.",
    "Отчеты GA4 еще не настроены.",
    "GA4 reporting has not been configured yet.",
  ],
  loading: ["Трафик жүктелуде…", "Загрузка трафика…", "Loading traffic…"],
  retry: ["Трафикті жаңарту", "Обновить трафик", "Refresh traffic"],
  fetched: [
    "Соңғы сәтті жүктеу",
    "Последняя успешная загрузка",
    "Last successful fetch",
  ],
  delay: [
    "GA4 деректері кешігуі мүмкін. Есеп бір сағатқа сақталады.",
    "Данные GA4 могут поступать с задержкой. Отчет кешируется на один час.",
    "GA4 data may be delayed. Reports are cached for one hour.",
  ],
  zone: [
    "GA4 күндері Asia/Almaty бойынша есептеледі. elc күндері іс-шараның белдеуін қолданады; күндік шекаралары сәйкес келмеуі мүмкін.",
    "Дни GA4 рассчитываются по Asia/Almaty. elc использует часовой пояс события; границы дней могут отличаться.",
    "GA4 days use Asia/Almaty. elc uses the event's time zone, so their daily boundaries may differ.",
  ],
  allTypes: [
    "GA4 барлық билет түрлерін қамтиды. Билет түрі сүзгісі төмендегі elc тапсырыстарына ғана қолданылады.",
    "GA4 охватывает все типы билетов. Фильтр типа билета применяется только к заказам elc ниже.",
    "GA4 covers all ticket types. The ticket-type filter applies only to the elc orders below.",
  ],
  quality: [
    "GA4 бұл есепке шектеулер, іріктеу немесе топтастыру қолданған. Сандар жуық мәндер болуы мүмкін.",
    "GA4 применил пороги, выборку или группировку. Показатели могут быть приблизительными.",
    "GA4 applied thresholds, sampling, or grouping. These figures may be approximate.",
  ],
  pageViews: ["Бет қаралымдары", "Просмотры страниц", "Page views"],
  eventViews: ["Іс-шара қаралымдары", "Просмотры события", "Event views"],
  campaignVisits: [
    "Науқаннан кірулер",
    "Посещения по кампании",
    "Campaign visits",
  ],
  checkoutStarts: ["Тапсырысты бастау", "Начала оформления", "Checkout starts"],
  completedOrders: [
    "elc аяқталған тапсырыстары",
    "Завершенные заказы elc",
    "Completed elc orders",
  ],
  date: ["Күні", "Дата", "Date"],
  campaign: ["Науқан", "Кампания", "Campaign"],
  daily: ["Күндік GA4 трафигі", "Трафик GA4 по дням", "Daily GA4 traffic"],
  campaigns: [
    "Осы беттегі науқандар",
    "Кампании на этой странице",
    "Campaigns on this page",
  ],
} satisfies Record<string, readonly [string, string, string]>
export function useTrafficText() {
  const { locale } = useAccount()
  return {
    locale,
    t: (key: keyof typeof copy) =>
      copy[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2],
  }
}
