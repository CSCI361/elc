import type { Locale } from "@elc/shared"
import { useAccount } from "@/auth/context"

const copy = {
  title: ["Хаттарды жеткізу", "Доставка писем", "Email deliveries"],
  detail: ["Жеткізу жазбасы", "Запись доставки", "Delivery record"],
  hint: [
    "PDF дайындау мен хат жеткізу күйлері бөлек көрсетіледі.",
    "Состояния подготовки PDF и доставки письма показаны отдельно.",
    "PDF preparation and email delivery have separate statuses.",
  ],
  denied: [
    "Платформаның қалпына келтіру рұқсаты қажет.",
    "Нужно разрешение на восстановление платформы.",
    "Platform recovery permission is required.",
  ],
  all: ["Барлығы", "Все", "All"],
  emailState: ["Хат күйі", "Состояние письма", "Email status"],
  pdfState: ["PDF күйі", "Состояние PDF", "PDF status"],
  kind: ["Хабарлама түрі", "Тип уведомления", "Notification type"],
  eventId: ["Іс-шара нөмірі", "Идентификатор события", "Event ID"],
  apply: ["Сүзгілерді қолдану", "Применить фильтры", "Apply filters"],
  reset: ["Бастапқы тізім", "К началу списка", "First page"],
  next: ["Келесі бет", "Следующая страница", "Next page"],
  reload: ["Жаңарту", "Обновить", "Refresh"],
  empty: [
    "Сүзгілерге сай жеткізу жазбасы жоқ",
    "Нет доставок по выбранным фильтрам",
    "No deliveries match these filters",
  ],
  invalid: [
    "Сүзгілерді тексеріңіз.",
    "Проверьте фильтры.",
    "Check the filters.",
  ],
  id: ["Жеткізу нөмірі", "Идентификатор доставки", "Delivery ID"],
  sourceId: ["Бастапқы әрекет", "Исходное действие", "Source action"],
  entityId: ["Нысан нөмірі", "Идентификатор объекта", "Entity ID"],
  recipientId: [
    "Алушының тіркелгісі",
    "Учетная запись получателя",
    "Recipient account",
  ],
  providerId: [
    "Провайдердегі нөмір",
    "Идентификатор провайдера",
    "Provider ID",
  ],
  providerStatus: ["Провайдер күйі", "Состояние провайдера", "Provider status"],
  attempts: ["Жіберу әрекеттері", "Попытки отправки", "Send attempts"],
  failures: [
    "Қатарынан болған қателер",
    "Последовательные ошибки",
    "Consecutive failures",
  ],
  lastError: ["Соңғы қате коды", "Код последней ошибки", "Last error code"],
  createdAt: ["Жасалған уақыт", "Время создания", "Created"],
  updatedAt: ["Жаңартылған уақыт", "Время обновления", "Updated"],
  completedAt: ["Аяқталған уақыт", "Время завершения", "Completed"],
  firstAttemptAt: [
    "Алғашқы жіберу әрекеті",
    "Первая попытка отправки",
    "First send attempt",
  ],
  lastAttemptAt: [
    "Соңғы жіберу әрекеті",
    "Последняя попытка отправки",
    "Last send attempt",
  ],
  nextAttemptAt: [
    "Келесі өңдеу уақыты",
    "Следующая обработка",
    "Next processing time",
  ],
  busyUntil: [
    "Өңдеу кезегінің аяқталуы",
    "Обработка занята до",
    "Processing reserved until",
  ],
  none: ["Жоқ", "Нет", "None"],
  recovery: [
    "Жеткізуді қалпына келтіру",
    "Восстановление доставки",
    "Recover delivery",
  ],
  reason: [
    "Қалпына келтіру себебі",
    "Причина восстановления",
    "Recovery reason",
  ],
  reasonHint: [
    "Себеп аудитте сақталады. Хат мәтінін немесе құпияларды енгізбеңіз.",
    "Причина сохраняется в аудите. Не вводите текст письма или секреты.",
    "The reason is recorded in the audit. Do not include message content or secrets.",
  ],
  mode: ["Әрекет", "Действие", "Action"],
  retry_preparation: [
    "Хатты қайта дайындау",
    "Повторить подготовку",
    "Retry preparation",
  ],
  retry_same_request: [
    "Сол жіберуді қайталау",
    "Повторить ту же отправку",
    "Retry the same send",
  ],
  reconcile: [
    "Провайдер күйін тексеру",
    "Проверить состояние у провайдера",
    "Check provider status",
  ],
  preparationHint: [
    "Әлі жіберілмеген хат ағымдағы деректерден қайта дайындалады.",
    "Еще не отправленное письмо будет заново подготовлено из текущих данных.",
    "An unsent message will be prepared again from current records.",
  ],
  sameHint: [
    "Бастапқы сұрау мен сол хат қайта қолданылады. Бұл әрекет алғашқы жіберуден кейін 23 сағат ішінде ғана қолжетімді.",
    "Используются исходный запрос и то же письмо. Действие доступно только в течение 23 часов после первой попытки.",
    "Reuses the original request and message. Available only within 23 hours of the first attempt.",
  ],
  reconcileHint: [
    "Провайдерден бар хаттың күйі сұралады. Хат қайта жіберілмейді.",
    "Запрашивается состояние существующего письма у провайдера. Письмо не отправляется повторно.",
    "Looks up the existing message at the provider. It does not send another email.",
  ],
  unavailable: [
    "Бұл күйде қалпына келтіру әрекеті жоқ. Соңғы күйді жаңартыңыз.",
    "Для этого состояния нет доступных действий. Обновите состояние.",
    "No recovery action is available in this state. Refresh for the latest status.",
  ],
  submit: [
    "Қалпына келтіруді кезекке қою",
    "Поставить восстановление в очередь",
    "Queue recovery",
  ],
  submitting: ["Сұрау жіберілуде…", "Отправка запроса…", "Submitting request…"],
  queued: [
    "Қалпына келтіру кезекке қойылды. Жеткізу нәтижесі төменде жаңартылады.",
    "Восстановление поставлено в очередь. Результат доставки обновится ниже.",
    "Recovery is queued. The delivery status will update below.",
  ],
  uncertain: [
    "Нәтиже расталмады. Сол сақталған сұрауды қайталаңыз.",
    "Результат не подтвержден. Повторите тот же сохраненный запрос.",
    "The result is unconfirmed. Retry the same saved request.",
  ],
  retrySame: [
    "Сақталған сұрауды қайталау",
    "Повторить сохраненный запрос",
    "Retry saved request",
  ],
  stale: [
    "Жеткізу күйі өзгерді. Жаңартылған күйді қарап, әрекетті қайта таңдаңыз.",
    "Состояние доставки изменилось. Проверьте обновленные данные и выберите действие снова.",
    "The delivery changed. Review its refreshed status before choosing an action again.",
  ],
  invalidReason: [
    "3–500 таңбадан тұратын себеп енгізіңіз.",
    "Введите причину длиной от 3 до 500 символов.",
    "Enter a reason between 3 and 500 characters.",
  ],
  storage: [
    "Браузер сұрауды сақтай алмады. Қойындының сақтау рұқсатын тексеріңіз.",
    "Браузер не смог сохранить запрос. Проверьте доступ к хранилищу вкладки.",
    "The browser could not save the request. Check this tab's storage access.",
  ],
  timeZone: [
    "Уақыт белдеуі: Asia/Almaty",
    "Часовой пояс: Asia/Almaty",
    "Time zone: Asia/Almaty",
  ],
  not_required: ["Қажет емес", "Не требуется", "Not required"],
  pending: ["Күтуде", "Ожидание", "Pending"],
  accepted: [
    "Провайдер қабылдады",
    "Принято провайдером",
    "Accepted by provider",
  ],
  delivered: ["Жеткізілді", "Доставлено", "Delivered"],
  bounced: ["Жеткізілмеді", "Отклонено получателем", "Bounced"],
  failed: ["Қате", "Ошибка", "Failed"],
  suppressed: ["Жіберу тоқтатылды", "Отправка остановлена", "Suppressed"],
  review_needed: ["Тексеру қажет", "Требуется проверка", "Needs review"],
  ready: ["Дайын", "Готово", "Ready"],
  tableHint: [
    "Кестені көлденең айналдыруға болады.",
    "Таблицу можно прокручивать по горизонтали.",
    "The table scrolls horizontally.",
  ],
} as const
export type DeliveryTextKey = keyof typeof copy
const index: Record<Locale, number> = { kk: 0, ru: 1, en: 2 }
export function useDeliveryText() {
  const { locale } = useAccount()
  return { locale, t: (key: DeliveryTextKey) => copy[key][index[locale]] }
}
