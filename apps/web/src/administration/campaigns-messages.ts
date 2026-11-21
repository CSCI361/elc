import { useAccount } from "../auth/context"
export const campaignAdministrationMessages = {
  title: ["Промоакциялар", "Промокампании", "Promotional campaigns"],
  intro: [
    "Сақталған іс-шаралардағы промоакция шарттары мен қолданылуын қараңыз.",
    "Просматривайте условия и использование промокампаний сохранённых событий.",
    "Review campaign terms and usage across retained events.",
  ],
  q: [
    "Атауы немесе промоакция ID",
    "Название или ID кампании",
    "Campaign name or ID",
  ],
  eventId: ["Іс-шара ID", "ID события", "Event ID"],
  organizerId: ["Ұйымдастырушы ID", "ID организатора", "Organizer ID"],
  enabledFilter: ["Қосылу күйі", "Включение", "Enabled status"],
  all: ["Барлығы", "Все", "All"],
  enabled: ["Қосылған", "Включена", "Enabled"],
  disabled: ["Өшірілген", "Выключена", "Disabled"],
  search: ["Іздеу", "Найти", "Search"],
  reset: ["Сүзгілерді тазарту", "Сбросить фильтры", "Reset filters"],
  first: ["Бірінші бет", "Первая страница", "First page"],
  next: ["Келесі бет", "Следующая страница", "Next page"],
  reload: ["Қайта жүктеу", "Обновить", "Reload"],
  empty: [
    "Бұл сүзгілерге сәйкес промоакция жоқ",
    "По выбранным фильтрам кампаний нет",
    "No campaigns match these filters",
  ],
  campaignId: ["Промоакция ID", "ID кампании", "Campaign ID"],
  event: ["Іс-шара", "Событие", "Event"],
  discount: ["Жеңілдік", "Скидка", "Discount"],
  starts: ["Басталуы", "Начало", "Starts"],
  ends: ["Аяқталуы", "Окончание", "Ends"],
  limit: ["Қолдану шегі", "Лимит использований", "Redemption limit"],
  holds: ["Уақытша резервтер", "Временные резервы", "Active holds"],
  committed: [
    "Аяқталған қолданулар",
    "Завершённые использования",
    "Committed redemptions",
  ],
  usageHint: [
    "Әр аяқталған тапсырыс бір қолдану болып есептеледі. Ақша қайтарылса немесе тіркелу тоқтатылса да, ол қолданылған болып қалады. Уақытша резервтер бөлек көрсетілген.",
    "Каждый завершённый заказ считается одним использованием. Возврат или отмена регистрации не восстанавливают его. Временные резервы показаны отдельно.",
    "Each completed order consumes one redemption. Refunds and registration cancellations keep it consumed. Temporary holds are shown separately.",
  ],
  eligibilityHint: [
    "Қосылған промоакцияға да мерзім, билет және сату шарттары қолданылады.",
    "Даже включённая кампания зависит от срока действия, билета и условий продаж.",
    "An enabled campaign still depends on its validity window, ticket and sales conditions.",
  ],
  updated: ["Жаңартылған", "Обновлено", "Updated"],
  generated: [
    "Сервер деректерінің уақыты",
    "Время серверных данных",
    "Server snapshot",
  ],
  zone: [
    "Уақыт Asia/Almaty белдеуінде көрсетіледі.",
    "Время указано в часовом поясе Asia/Almaty.",
    "Times use Asia/Almaty.",
  ],
  orders: [
    "Осы промоакцияның тапсырыстары",
    "Заказы этой кампании",
    "Attributed orders",
  ],
  audit: ["Промоакция аудиті", "Аудит кампании", "Campaign audit"],
  pagination: ["Промоакция беттері", "Страницы кампаний", "Campaign pages"],
  invalid: [
    "URL сүзгілері жарамсыз. Сүзгілерді тазалап, қайта іздеңіз.",
    "Недопустимые фильтры в URL. Сбросьте их и повторите поиск.",
    "Invalid URL filters. Reset them and search again.",
  ],
} satisfies Record<string, readonly [string, string, string]>
export function useCampaignAdministrationText() {
  const { locale } = useAccount()
  return {
    locale,
    t: (key: keyof typeof campaignAdministrationMessages) =>
      campaignAdministrationMessages[key][
        locale === "kk" ? 0 : locale === "ru" ? 1 : 2
      ],
  }
}
