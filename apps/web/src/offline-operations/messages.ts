import { useAccount } from "../auth/context"

export const offlineMessages = {
  title: [
    "Офлайн тексеруді басқару",
    "Управление офлайн-проверкой",
    "Offline operations",
  ],
  events: ["Қолжетімді іс-шаралар", "Доступные события", "Available events"],
  intro: [
    "Құрылғыларды және серверге жіберілген кіру жазбаларын басқарыңыз.",
    "Управляйте устройствами и переданными на сервер записями о проходах.",
    "Manage devices and admission records reported to the server.",
  ],
  emptyEvents: [
    "Қолжетімді іс-шара жоқ. Іс-шара иесінің немесе тағайындалған қызметкердің рұқсаты қажет.",
    "Нет доступных событий. Требуются права владельца или назначенного сотрудника.",
    "No events are available. Event ownership or a staff assignment is required.",
  ],
  devices: ["Офлайн құрылғылар", "Офлайн-устройства", "Offline devices"],
  yourDevices: ["Сіздің құрылғыларыңыз", "Ваши устройства", "Your devices"],
  admissions: [
    "Кіру туралы есептер",
    "Сообщения о проходах",
    "Admission reports",
  ],
  ownDevices: [
    "Мұнда тек өз құрылғыларыңыз көрсетіледі. Құрылғыны іс-шара иесі немесе платформа әкімшісі бұғаттайды.",
    "Здесь показаны только ваши устройства. Отозвать регистрацию может владелец события или администратор платформы.",
    "Only your devices are shown. The event owner or a platform administrator can revoke a device.",
  ],
  provisional: [
    "Офлайн нәтижелер синхрондалғанша алдын ала нәтиже болып саналады. Ажыратылған құрылғылар басқа құрылғылардағы кіруді не рұқсаттың қайтарылғанын бірден білмейді.",
    "Офлайн-результаты предварительные до синхронизации. Отключённые устройства не узнают сразу о проходах на других устройствах или отзыве доступа.",
    "Offline results are provisional until synchronized. Disconnected devices cannot immediately learn about other admissions or revoked access.",
  ],
  lossHint: [
    "Жоғалған құрылғыдағы жіберілмеген жазбалар серверден қалпына келтірілмейді. Оқиғаны қолдау өтінішінде тіркеңіз. Жаңа құрылғы желіде кіріп, жаңа көшірме жүктеуі керек.",
    "Неотправленные записи с потерянного устройства нельзя восстановить с сервера. Зафиксируйте инцидент в обращении поддержки. Новое устройство должно войти онлайн и загрузить свежий снимок.",
    "Unsynchronized records on a lost device cannot be recovered from the server. Record the incident in a support case. A replacement device must sign in online and download a fresh snapshot.",
  ],
  incident: [
    "Оқиға туралы қолдауға жазу",
    "Сообщить об инциденте",
    "Open an incident support case",
  ],
  support: ["Қолдау", "Поддержка", "Support"],
  reload: ["Қайта жүктеу", "Обновить", "Reload"],
  first: ["Бірінші бет", "Первая страница", "First page"],
  next: ["Келесі бет", "Следующая страница", "Next page"],
  pagination: ["Беттер", "Страницы", "Pages"],
  emptyDevices: [
    "Бұл бетте құрылғы жоқ.",
    "На этой странице нет устройств.",
    "No devices on this page.",
  ],
  emptyReports: [
    "Бұл бетте жіберілген операция жоқ.",
    "На этой странице нет переданных операций.",
    "No reported operations on this page.",
  ],
  registered: ["Тіркелген", "Зарегистрировано", "Registered"],
  lastSync: [
    "Соңғы синхрондау",
    "Последняя синхронизация",
    "Last synchronization",
  ],
  never: [
    "Әлі синхрондалмаған",
    "Ещё не синхронизировано",
    "Not synchronized yet",
  ],
  revokedAt: ["Бұғатталған", "Регистрация отозвана", "Revoked"],
  active: ["Тіркеу белсенді", "Регистрация активна", "Registration active"],
  lost: ["Құрылғы жоғалған", "Устройство потеряно", "Device lost"],
  revoke: [
    "Құрылғыны бұғаттау",
    "Отозвать регистрацию устройства",
    "Revoke device",
  ],
  reason: ["Себеп", "Причина", "Reason"],
  reasonHint: [
    "1–500 таңба. Құпиясөздерді немесе билет кодтарын қоспаңыз.",
    "1–500 символов. Не указывайте пароли или коды билетов.",
    "1–500 characters. Do not include passwords or ticket credentials.",
  ],
  revokeHint: [
    "Бұғаттау тіркеуді өшірмейді және аудитте сақталады. Желіден тыс құрылғыдағы деректер қашықтан жойылмайды.",
    "Отзыв сохраняет регистрацию и запись аудита. Данные на отключённом устройстве не удаляются дистанционно.",
    "Revocation preserves the registration and audit record. It does not remotely erase a disconnected device.",
  ],
  review: [
    "Кіру есебін қарау",
    "Рассмотреть сообщение о проходе",
    "Review admission",
  ],
  resolution: ["Шешім", "Решение", "Resolution"],
  choose: ["Шешімді таңдаңыз", "Выберите решение", "Choose a resolution"],
  no_admission: ["Кіру болмаған", "Прохода не было", "No admission occurred"],
  admission_confirmed: [
    "Кіру расталды",
    "Проход подтверждён",
    "Admission confirmed",
  ],
  reviewHint: [
    "Себебін жазып, хабарланған кіруді анықтаңыз. Растау жарамды билеттің бұрынғы кіруін сақтайды немесе бір серверлік кіру жасайды. «Кіру болмаған» бұрынғы расталған кіруді қайтармайды; оған бөлек рұқсат қажет.",
    "Укажите причину и установите факт прохода. Подтверждение сохраняет существующий проход действительного билета или создаёт один серверный проход. «Прохода не было» не отменяет уже подтверждённый проход; для отмены нужно отдельное разрешение.",
    "Record a reason and determine whether the reported admission occurred. Confirmation keeps an existing eligible check-in or creates one server check-in. No admission occurred does not reverse an existing confirmed check-in; reversal requires separate authorization.",
  ],
  submitReview: ["Шешімді сақтау", "Сохранить решение", "Save review"],
  pending: ["Жіберілуде…", "Отправка…", "Submitting…"],
  uncertain: [
    "Сервердің нәтижесі белгісіз. Бастапқы сұрауды өзгертпей қайталаңыз. Бетті жаңарту бұл сұрауды ұмытады.",
    "Результат сервера неизвестен. Повторите исходный запрос без изменений. Перезагрузка страницы забудет этот запрос.",
    "The server result is uncertain. Retry the original request unchanged. Reloading the browser page will forget this request.",
  ],
  retry: [
    "Сол сұрауды қайталау",
    "Повторить тот же запрос",
    "Retry same request",
  ],
  saved: [
    "Сервер өзгерісті растады.",
    "Сервер подтвердил изменение.",
    "The server confirmed the change.",
  ],
  conflict: [
    "Жазба немесе рұқсат өзгерді. Ағымдағы деректерді қайта жүктеп, тексеріңіз.",
    "Запись или разрешения изменились. Обновите и проверьте текущие данные.",
    "The record or authorization changed. Reload and review current data.",
  ],
  unavailable: [
    "Ағымдағы деректер қолжетімсіз. Жазбалар мен әрекеттер қайта тексерілгенше жасырылды.",
    "Текущие данные недоступны. Записи и действия скрыты до повторной проверки.",
    "Current data is unavailable. Records and actions are hidden until they can be checked again.",
  ],
  deviceId: ["Құрылғы нөмірі", "Идентификатор устройства", "Device ID"],
  accountId: [
    "Қызметкер нөмірі",
    "Идентификатор сотрудника",
    "Staff account ID",
  ],
  operationId: ["Операция нөмірі", "Идентификатор операции", "Operation ID"],
  ticketId: ["Билет нөмірі", "Идентификатор билета", "Ticket ID"],
  orderId: ["Тапсырыс нөмірі", "Идентификатор заказа", "Order ID"],
  captured: [
    "Құрылғыда тіркелген",
    "Записано на устройстве",
    "Captured on device",
  ],
  reported: ["Серверге жіберілген", "Получено сервером", "Reported to server"],
  result: [
    "Синхрондау нәтижесі",
    "Результат синхронизации",
    "Synchronization result",
  ],
  reviewState: ["Қарау күйі", "Статус рассмотрения", "Review status"],
  none: ["Қарау қажет емес", "Рассмотрение не требуется", "No review required"],
  unresolved: ["Қаралмаған", "Не рассмотрено", "Unresolved"],
  resolved: ["Қаралған", "Рассмотрено", "Resolved"],
  reviewedAt: ["Қаралған уақыт", "Время рассмотрения", "Reviewed at"],
  reviewedBy: ["Қараған қызметкер", "Рассмотревший сотрудник", "Reviewed by"],
  checked_in: [
    "Сервер растаған кіру",
    "Проход подтверждён сервером",
    "Server-confirmed check-in",
  ],
  already_used: ["Бұрын қолданылған", "Уже использован", "Already used"],
  admission_blocked: [
    "Кіруге тыйым салынған",
    "Проход заблокирован",
    "Admission blocked",
  ],
  forbidden: ["Рұқсат жоқ", "Нет разрешения", "Permission denied"],
  invalid: ["Жарамсыз билет", "Недействительный билет", "Invalid ticket"],
  cancelled: ["Күші жойылған", "Отменён", "Cancelled"],
  refunded: ["Ақшасы қайтарылған", "Возвращён", "Refunded"],
  not_found: ["Табылмады", "Не найден", "Not found"],
  wrong_event: [
    "Басқа іс-шараның билеті",
    "Билет другого события",
    "Wrong event",
  ],
  unauthorized: ["Рұқсат жоқ", "Нет разрешения", "Unauthorized"],
  expired_snapshot: [
    "Көшірменің мерзімі өткен",
    "Снимок просрочен",
    "Snapshot expired",
  ],
  snapshot_expired: [
    "Көшірменің мерзімі өткен",
    "Снимок просрочен",
    "Snapshot expired",
  ],
  locally_reversed: [
    "Құрылғыда қайтарылған",
    "Отменено на устройстве",
    "Locally undone",
  ],
  reversed: ["Кіру қайтарылған", "Проход отменён", "Check-in reversed"],
  event_unavailable: [
    "Іс-шара қолжетімсіз",
    "Событие недоступно",
    "Event unavailable",
  ],
  clock_invalid: [
    "Құрылғы уақыты жарамсыз",
    "Недопустимое время устройства",
    "Invalid device clock",
  ],
} as const
export type OfflineMessage = keyof typeof offlineMessages
export function useOfflineText() {
  const { locale } = useAccount()
  return {
    locale,
    t: (key: OfflineMessage) =>
      offlineMessages[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2],
  }
}
