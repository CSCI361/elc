import { useAccount } from "../auth/context"
const copy = {
  title: ["Операциялық жазбалар", "Операционные записи", "Operational records"],
  kind: ["Жазба түрі", "Тип записей", "Record type"],
  orders: ["Тапсырыстар", "Заказы", "Orders"],
  payments: ["Төлемдер", "Платежи", "Payments"],
  audit: ["Аудит", "Аудит", "Audit"],
  query: [
    "Нақты ID немесе аудит әрекеті",
    "Точный ID или действие аудита",
    "Exact ID or audit action",
  ],
  hint: [
    "Тапсырыс ID, төлем не провайдер ID, аудит нысаны немесе сұрау ID арқылы іздеңіз.",
    "Ищите по ID заказа, платежа или провайдера, объекта аудита либо запроса.",
    "Search by order ID, payment or provider ID, audit entity or request ID.",
  ],
  eventId: ["Іс-шара ID", "ID события", "Event ID"],
  accountId: [
    "Сатып алушы немесе әрекет жасаған тіркелгі ID",
    "ID покупателя или автора действия",
    "Purchaser or actor account ID",
  ],
  actor: ["Әрекет жасаған тіркелгі", "Автор действия", "Actor account"],
  subject: ["Нысан ID", "ID объекта", "Subject ID"],
  correlation: ["Сұрау ID", "ID запроса", "Request ID"],
  created: ["Жазылған уақыт", "Время записи", "Recorded at"],
  zone: [
    "Уақыт Asia/Almaty белдеуінде көрсетіледі.",
    "Время указано в часовом поясе Asia/Almaty.",
    "Times use Asia/Almaty.",
  ],
  total: ["Тапсырыс сомасы", "Сумма заказа", "Order total"],
  discount: ["Жеңілдік", "Скидка", "Discount"],
  fee: ["Өңдеу алымы", "Сбор за обработку", "Processing fee"],
  amount: ["Төлем сомасы", "Сумма платежа", "Payment amount"],
  refunded: ["Қайтарым сомасы", "Сумма возврата", "Refund amount"],
  refundStatus: ["Қайтарым күйі", "Статус возврата", "Refund status"],
  dispatch: ["Провайдерге жіберу", "Отправка провайдеру", "Provider dispatch"],
  prepared: ["Дайындалған", "Подготовлена", "Prepared"],
  dispatched: ["Жіберілген", "Отправлена", "Dispatched"],
  uncertain: ["Нәтижесі белгісіз", "Результат неизвестен", "Outcome uncertain"],
  reconciled: ["Салыстырылған", "Сверена", "Reconciled"],
  providerPayment: [
    "Провайдер төлемінің ID",
    "ID платежа провайдера",
    "Provider payment ID",
  ],
  providerOrder: [
    "Провайдер тапсырысының ID",
    "ID заказа провайдера",
    "Provider order ID",
  ],
  purpose: ["Төлем мақсаты", "Назначение платежа", "Payment purpose"],
  ticket_order: ["Билет тапсырысы", "Заказ билетов", "Ticket order"],
  event_activation: [
    "Іс-шараны белсендіру",
    "Активация события",
    "Event activation",
  ],
  export: [
    "Осы бетті CSV-ге шығару",
    "Экспорт этой страницы в CSV",
    "Export this page as CSV",
  ],
  exportHint: [
    "Экспорт ағымдағы сүзгілер бойынша 20 жазбаға дейін қамтиды. CSV сомалары тиынмен көрсетіледі: 100 = 1 KZT.",
    "Экспорт содержит до 20 записей по текущим фильтрам. Суммы в CSV указаны в тиынах: 100 = 1 KZT.",
    "The export includes up to 20 records matching the current filters. CSV amounts use tiyn: 100 = KZT 1.",
  ],
  downloaded: ["Жүктеу басталды.", "Загрузка началась.", "Download started."],
  none: ["Тіркелмеген", "Не записано", "Not recorded"],
} satisfies Record<string, readonly [string, string, string]>
export function useOperationsText() {
  const { locale } = useAccount()
  return {
    locale,
    t: (key: keyof typeof copy) =>
      copy[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2],
  }
}
