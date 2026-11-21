import { useAccount } from "@/auth/context"

const messages = {
  title: ["Тіркелімдер", "Регистрации", "Registrations"],
  tickets: ["Қатысушылар", "Участники", "Attendees"],
  orders: ["Тапсырыстар", "Заказы", "Orders"],
  checkins: ["Кіру жазбалары", "Проходы", "Check-ins"],
  search: [
    "Аты немесе нөмірі бойынша іздеу",
    "Поиск по имени или идентификатору",
    "Search by name or ID",
  ],
  searchHint: [
    "Аты, билет, тапсырыс немесе кіру жазбасының нөмірі. 200 таңбаға дейін.",
    "Имя, идентификатор билета, заказа или прохода. До 200 символов.",
    "Name, ticket, order, or check-in ID. Up to 200 characters.",
  ],
  apply: ["Іздеу", "Найти", "Search"],
  reset: ["Сүзгілерді тазарту", "Сбросить фильтры", "Reset filters"],
  first: ["Бірінші бет", "Первая страница", "First page"],
  next: ["Келесі бет", "Следующая страница", "Next page"],
  navigation: ["Жазба түрлері", "Типы записей", "Record views"],
  pagination: ["Жазба беттері", "Страницы записей", "Record pages"],
  empty: [
    "Бұл сүзгілерге сәйкес жазба жоқ.",
    "Нет записей по выбранным фильтрам.",
    "No records match these filters.",
  ],
  invalid: [
    "Сүзгілер жарамсыз. Іздеу мен жазба нөмірлерін тексеріңіз немесе сүзгілерді тазалаңыз.",
    "Недопустимые фильтры. Проверьте поиск и идентификаторы или сбросьте фильтры.",
    "Invalid filters. Check the search and record IDs, or reset the filters.",
  ],
  denied: [
    "Жазбалар қолжетімсіз. Осы іс-шараны басқару немесе тарихын қарау рұқсаты қажет.",
    "Записи недоступны. Нужно разрешение на управление этим событием или просмотр его истории.",
    "Records are unavailable. Permission to manage this event or read its history is required.",
  ],
  reload: ["Қайта жүктеу", "Обновить", "Reload"],
  snapshot: [
    "Деректердің алынған уақыты",
    "Данные на момент",
    "Snapshot as of",
  ],
  snapshotHint: [
    "Бұл беттегі күй серверден алынған сәтке сәйкес. Желі қалпына келгенде қайта жүктеңіз.",
    "Состояние на этой странице соответствует моменту ответа сервера. Обновите после восстановления связи.",
    "These states reflect the server response time. Reload after connectivity returns.",
  ],
  rows: [
    "Осы беттегі жазбалар",
    "Записей на этой странице",
    "Rows on this page",
  ],
  retentionHint: [
    "Шешілмеген жұмыс жазбалардың жойылуын кейінге қалдыруы мүмкін.",
    "Незавершённые процессы могут отложить удаление записей.",
    "Unresolved work may postpone record deletion.",
  ],
  manage: ["Іс-шараны өңдеу", "Редактировать событие", "Edit event"],
  history: ["Әрекеттер тарихы", "Лента действий", "Activity timeline"],
  analytics: ["Аналитика", "Аналитика", "Analytics"],
  support: ["Қолдау өтініштері", "Обращения поддержки", "Support cases"],
  refundAction: [
    "Қайтару немесе тіркелуді тоқтату",
    "Возврат или отмена регистрации",
    "Refund or cancel registration",
  ],
  orderId: ["Тапсырыс нөмірі", "Идентификатор заказа", "Order ID"],
  ticketId: ["Билет нөмірі", "Идентификатор билета", "Ticket ID"],
  checkinId: ["Кіру жазбасының нөмірі", "Идентификатор прохода", "Check-in ID"],
  orderDetail: ["Тапсырысты қарау", "Посмотреть заказ", "View order"],
  orderTickets: ["Тапсырыс билеттері", "Билеты заказа", "Order tickets"],
  ticketDetail: ["Билетті қарау", "Посмотреть билет", "View ticket"],
  ticketCheckins: [
    "Билеттің кіру жазбалары",
    "Проходы по билету",
    "Ticket check-ins",
  ],
  ticketType: ["Билет түрі", "Тип билета", "Ticket type"],
  state: ["Күйі", "Состояние", "State"],
  pending: ["Күтілуде", "Ожидает", "Pending"],
  completed: ["Аяқталған", "Завершён", "Completed"],
  expired: ["Мерзімі аяқталған", "Срок истёк", "Expired"],
  abandoned: ["Аяқталмаған", "Оставлен", "Abandoned"],
  cancelled: ["Тоқтатылған", "Отменён", "Cancelled"],
  refunded: ["Қайтарылған", "Возвращён", "Refunded"],
  valid: ["Жарамды", "Действителен", "Valid"],
  checked_in: ["Кіру тіркелген", "Проход зарегистрирован", "Checked in"],
  created: ["Жасалған уақыт", "Создан", "Created"],
  completedAt: ["Аяқталған уақыт", "Завершён", "Completed at"],
  quantity: ["Тапсырыстағы саны", "Количество в заказе", "Order quantity"],
  ticketCount: ["Шығарылған билеттер", "Выпущенные билеты", "Issued tickets"],
  originalAmounts: [
    "Тапсырыстың бастапқы сомалары",
    "Исходные суммы заказа",
    "Original order amounts",
  ],
  amountsHint: [
    "Бұл сомалар төлемнің түскенін растамайды. Тапсырыс пен қайтару күйлері бөлек көрсетіледі.",
    "Эти суммы не подтверждают получение оплаты. Состояния заказа и возврата показаны отдельно.",
    "These amounts do not confirm receipt of payment. Order and refund states are shown separately.",
  ],
  subtotal: ["Жеңілдікке дейін", "До скидки", "Subtotal"],
  discount: ["Жеңілдік", "Скидка", "Discount"],
  total: ["Тапсырыс сомасы", "Сумма заказа", "Order total"],
  fee: [
    "Бастапқы өңдеу комиссиясы",
    "Исходная комиссия обработки",
    "Original processing fee",
  ],
  campaign: ["Науқан", "Кампания", "Campaign"],
  refund: ["Қайтару", "Возврат", "Refund"],
  refundAmount: ["Қайтару сомасы", "Сумма возврата", "Refund amount"],
  refund_pending: [
    "Қайтару күтілуде",
    "Возврат ожидает обработки",
    "Refund pending",
  ],
  refund_succeeded: [
    "Қайтару аяқталды",
    "Возврат выполнен",
    "Refund succeeded",
  ],
  refund_failed: [
    "Қайтару орындалмады",
    "Возврат не выполнен",
    "Refund failed",
  ],
  noRefund: [
    "Қайтару жазбасы жоқ",
    "Нет записи о возврате",
    "No refund record",
  ],
  blocked: [
    "Кіруге тыйым салынған",
    "Проход заблокирован",
    "Admission blocked",
  ],
  offline: [
    "Офлайн кіру есебі әлі тексерілмеген. Бұл сервер растаған кіру емес.",
    "Отчёт об офлайн-проходе ещё не проверен. Это не подтверждённый сервером проход.",
    "An offline admission report is unresolved. It is not a server-confirmed check-in.",
  ],
  seat: ["Орын", "Место", "Seat"],
  accessible: ["Қолжетімді орын", "Доступное место", "Accessible seat"],
  generalAdmission: [
    "Белгіленген орынсыз",
    "Без назначенного места",
    "No assigned seat",
  ],
  capturedAt: ["Тіркелген уақыт", "Время фиксации", "Captured at"],
  committedAt: [
    "Сервер растаған уақыт",
    "Подтверждён сервером",
    "Committed at",
  ],
  activeCheckin: [
    "Белсенді кіру жазбасы",
    "Действующий проход",
    "Active check-in",
  ],
  reversed: [
    "Кіру жазбасы кері қайтарылған",
    "Проход отменён",
    "Reversed check-in",
  ],
  reversedAt: ["Кері қайтарылған уақыт", "Время отмены прохода", "Reversed at"],
  reversedBy: [
    "Кері қайтарған пайдаланушы",
    "Кто отменил проход",
    "Reversed by",
  ],
  reversalReason: [
    "Кері қайтару себебі",
    "Причина отмены прохода",
    "Reversal reason",
  ],
  revision: ["Нұсқа", "Версия", "Revision"],
  removeOrder: [
    "Тапсырыс сүзгісін алып тастау",
    "Убрать фильтр заказа",
    "Remove order filter",
  ],
  removeTicket: [
    "Билет сүзгісін алып тастау",
    "Убрать фильтр билета",
    "Remove ticket filter",
  ],
} as const

export type RecordsMessage = keyof typeof messages
export function useRecordsText() {
  const { locale } = useAccount()
  return {
    locale,
    t: (key: RecordsMessage) =>
      messages[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2],
  }
}
