import type { Locale } from "@elc/shared"
import { useAccount } from "@/auth/context"
const copy = {
  support: ["Қолдау", "Поддержка", "Support"],
  help: ["Көмек сұрау", "Обратиться за помощью", "Get help"],
  title: ["Қолдау өтініштері", "Обращения в поддержку", "Support cases"],
  mine: ["Менің өтініштерім", "Мои обращения", "My cases"],
  staff: ["Қызметкерлер кезегі", "Очередь сотрудников", "Staff queue"],
  assigned: ["Маған тағайындалған", "Назначенные мне", "Assigned to me"],
  view: ["Көрініс", "Представление", "View"],
  filters: ["Сүзгілерді қолдану", "Применить фильтры", "Apply filters"],
  all: ["Барлығы", "Все", "All"],
  newCase: ["Жаңа өтініш", "Новое обращение", "New case"],
  empty: ["Өтініштер табылмады.", "Обращения не найдены.", "No cases found."],
  subject: ["Тақырып", "Тема", "Subject"],
  category: ["Санат", "Категория", "Category"],
  audience: ["Кімге", "Кому", "Contact"],
  attendee: [
    "Іс-шара ұйымдастырушысы",
    "Организатор события",
    "Event organizer",
  ],
  organizer_platform: [
    "Платформа қолдауы",
    "Поддержка платформы",
    "Platform support",
  ],
  message: ["Хабарлама", "Сообщение", "Message"],
  submit: ["Өтініш жіберу", "Создать обращение", "Create case"],
  send: ["Жауап жіберу", "Отправить ответ", "Send reply"],
  sent: [
    "Сақталды. Хабарландыру кезекке қойылды.",
    "Сохранено. Уведомление поставлено в очередь.",
    "Saved. Notification queued.",
  ],
  contextHint: [
    "Іс-шара немесе тапсырыс туралы сұрақты оның бетіндегі көмек сілтемесінен бастаңыз.",
    "Вопрос о событии или заказе начните со ссылки помощи на его странице.",
    "For an event or order question, use the help link on its page.",
  ],
  contextRequired: [
    "Іс-шараны, тапсырысты немесе билетті таңдаңыз.",
    "Выберите событие, заказ или билет.",
    "Choose an event, order, or ticket.",
  ],
  privacy: [
    "Құпиясөздерді, билет QR-кодтарын және төлем деректерін жібермеңіз.",
    "Не отправляйте пароли, QR-коды билетов и платежные данные.",
    "Keep passwords, ticket QR codes, and payment credentials out of messages.",
  ],
  conversation: [
    "Хабарламалар мен өзгерістер",
    "Сообщения и изменения",
    "Messages and changes",
  ],
  status: ["Күй", "Статус", "Status"],
  open: ["Ашық", "Открыто", "Open"],
  in_progress: ["Қаралуда", "В работе", "In progress"],
  waiting_for_customer: [
    "Клиент жауабын күтуде",
    "Ожидает ответа клиента",
    "Waiting for customer",
  ],
  resolved: ["Шешілді", "Решено", "Resolved"],
  statusSave: ["Күйді сақтау", "Сохранить статус", "Save status"],
  resolvedHint: [
    "Бұл өтініш жабылды. Қызметкер оны қайта аша алады.",
    "Обращение закрыто. Сотрудник может открыть его снова.",
    "This case is resolved. Staff can reopen it.",
  ],
  assignment: ["Орындаушы", "Исполнитель", "Assignee"],
  unassigned: ["Тағайындалмаған", "Не назначен", "Unassigned"],
  otherAssignee: [
    "Басқа қызметкер",
    "Другой сотрудник",
    "Another staff member",
  ],
  me: ["Мен", "Я", "Me"],
  assign: ["Орындаушыны сақтау", "Сохранить исполнителя", "Save assignee"],
  created: ["Өтініш ашылды", "Обращение создано", "Case created"],
  assignmentChange: [
    "Орындаушы өзгерді",
    "Исполнитель изменен",
    "Assignee changed",
  ],
  statusChange: ["Күй өзгерді", "Статус изменен", "Status changed"],
  latest: ["Соңғы жаңартулар", "Последние обновления", "Latest updates"],
  reference: ["Өтініш нөмірі", "Номер обращения", "Case reference"],
  payoutHeld: [
    "Осы тапсырыстың ұйымдастырушыға төлемі тексеру аяқталғанша тоқтатылды.",
    "Выплата организатору по этому заказу удерживается до завершения проверки.",
    "The organizer payout for this order is held while review is pending.",
  ],
  ticket_delivery: ["Билетті жеткізу", "Доставка билета", "Ticket delivery"],
  payment: ["Төлем", "Оплата", "Payment"],
  refund: ["Қайтару", "Возврат", "Refund"],
  seating: ["Орындар", "Места", "Seating"],
  event_information: [
    "Іс-шара туралы",
    "Информация о событии",
    "Event information",
  ],
  check_in: ["Іс-шараға кіру", "Проход на событие", "Admission"],
  account: ["Аккаунт", "Аккаунт", "Account"],
  activation: [
    "Ақылы сатылымды қосу",
    "Активация платных продаж",
    "Paid sales activation",
  ],
  technical: ["Техникалық мәселе", "Технический вопрос", "Technical issue"],
  dispute: ["Дау", "Спор", "Dispute"],
  compensation: ["Өтемақы", "Компенсация", "Compensation"],
  refundTitle: [
    "Тіркеу және қайтару",
    "Регистрация и возвраты",
    "Registration and refunds",
  ],
  requestRefund: ["Қайтаруды сұрау", "Запросить возврат", "Request refund"],
  requestCancellation: [
    "Тіркеуді жоюды сұрау",
    "Запросить отмену регистрации",
    "Request registration cancellation",
  ],
  approveRefund: [
    "Толық қайтаруды мақұлдау",
    "Одобрить полный возврат",
    "Approve full refund",
  ],
  cancelRegistration: [
    "Тіркеуді жою",
    "Отменить регистрацию",
    "Cancel registration",
  ],
  reason: ["Себеп", "Причина", "Reason"],
  refundHint: [
    "Іс-шара басталғанға дейін және кіру тіркелмесе ғана ерікті толық қайтару жасалады. Соңғы тексеруді сервер орындайды.",
    "Добровольный полный возврат возможен до начала события, если проход не зарегистрирован. Окончательные условия проверяются сервером.",
    "Voluntary refunds are full refunds before the event starts, with no recorded admission. The server checks eligibility again when approval is submitted.",
  ],
  refundCaseHint: [
    "Осы тапсырысқа тиесілі ашық қайтару өтінішінің нөмірін енгізіңіз. Қаржы құқығы хат алмасуға рұқсат бермейді.",
    "Укажите номер незакрытого запроса возврата по этому заказу. Финансовые права не дают доступа к переписке.",
    "Provide the unresolved refund case reference for this order. Financial permission does not grant access to its conversation.",
  ],
  refundUnavailable: [
    "Қазір ерікті қайтару немесе тіркеуді жою мүмкін емес. Қажет болса қолдауға жазыңыз.",
    "Добровольный возврат или отмена регистрации сейчас недоступны. При необходимости обратитесь в поддержку.",
    "Voluntary refund or registration cancellation is unavailable right now. Contact support if you need help.",
  ],
  refundDenied: [
    "Қайтаруды қарау үшін бөлек қаржылық құқық қажет.",
    "Для рассмотрения возврата нужны отдельные финансовые права.",
    "Refund review requires separate financial permission.",
  ],
  refundQueued: [
    "Толық қайтару мақұлданды және өңдеу кезегіне қойылды. Расталған күйді төменнен тексеріңіз.",
    "Полный возврат одобрен и поставлен в обработку. Подтвержденный статус появится ниже.",
    "The full refund was approved and queued for processing. Check its confirmed status below.",
  ],
  registrationCancelled: [
    "Тіркеу жойылды. Билеттер кіруге жарамсыз.",
    "Регистрация отменена. Билеты больше не допускают проход.",
    "Registration cancelled. Its tickets no longer allow admission.",
  ],
  refund_pending: [
    "Қайтару өңделуде",
    "Возврат обрабатывается",
    "Refund processing",
  ],
  refund_succeeded: [
    "Қайтару расталды",
    "Возврат подтвержден",
    "Refund confirmed",
  ],
  refund_failed: [
    "Қайтару сәтсіз аяқталды. Тексеру қажет.",
    "Возврат не выполнен. Нужна проверка.",
    "Refund failed. Review is required.",
  ],
  reconciliation: [
    "Төлем провайдерінің жауабы тексерілуде. Қайта қайтаруды бастамаңыз.",
    "Ответ платежного провайдера проверяется. Не создавайте повторный возврат.",
    "The payment provider response is being checked. Do not start another refund.",
  ],
  recoveryTitle: [
    "Қайтаруды қалпына келтіру",
    "Восстановление возврата",
    "Refund recovery",
  ],
  recoveryAuthority: [
    "Қалпына келтіру үшін іс-шара иесінің немесе қайтаруға жауапты қызметкердің құқығы қажет. Бұл құқық қолдау хат алмасуына қолжетімділіктен бөлек.",
    "Восстановление доступно владельцу события или сотруднику с правом возврата. Это право не зависит от доступа к переписке поддержки.",
    "Recovery requires event ownership or refund permission. This permission is separate from support conversation access.",
  ],
  recoveryDenied: [
    "Қалпына келтіру қолжетімсіз. Ағымдағы қайтару құқығы қажет.",
    "Восстановление недоступно. Нужны действующие права на возврат.",
    "Recovery is unavailable. Current refund permission is required.",
  ],
  recoveryPending: [
    "Қалпына келтіру кезекте немесе өңделуде.",
    "Восстановление в очереди или обрабатывается.",
    "Recovery is queued or processing.",
  ],
  recoveryQueued: [
    "Қалпына келтіру сұрауы кезекке қойылды. Бұл қайтаруды растамайды. Ағымдағы күйді төменнен тексеріңіз.",
    "Запрос восстановления поставлен в очередь. Это не подтверждение возврата. Проверьте текущий статус ниже.",
    "The recovery request was queued. This does not confirm a refund. Check its current status below.",
  ],
  recoveryUpdatedAt: ["Соңғы өзгеріс", "Последнее изменение", "Last updated"],
  recoveryBlocks: [
    "Қалпына келтіру кезінде кіруге және ұйымдастырушы төлеміне қойылған шектеулер сақталады.",
    "Во время восстановления ограничения на проход и выплату организатору сохраняются.",
    "Existing admission and organizer payout blocks remain in place while recovery runs.",
  ],
  recoveryConflict: [
    "Қайтару күйі өзгерді немесе басқа қалпына келтіру сұрауы кезекте тұр. Күйді жаңартыңыз.",
    "Статус возврата изменился или другой запрос восстановления уже в очереди. Обновите статус.",
    "The refund changed or another recovery is already queued. Refresh its status.",
  ],
  recoveryRequestUnconfirmed: [
    "Қалпына келтіру сұрауын растау мүмкін болмады. Келесі әрекетті таңдамас бұрын оның күйін жаңартыңыз.",
    "Не удалось подтвердить запрос восстановления. Обновите его статус перед следующим действием.",
    "The recovery request could not be confirmed. Refresh its status before choosing another action.",
  ],
  recoveryReconcile: [
    "Провайдердегі күйді тексеру",
    "Проверить статус у провайдера",
    "Reconcile provider status",
  ],
  recoveryReconcileHint: [
    "Провайдердегі күйді тексереді. Жаңа қайтару жасамайды.",
    "Проверяет статус у провайдера, не создавая новый возврат.",
    "Checks the provider's status without creating another refund.",
  ],
  recoveryRetry: [
    "Қабылданбаған сұрауды қайталау",
    "Повторить отклоненный запрос",
    "Retry rejected request",
  ],
  recoveryRetryHint: [
    "Провайдер алдыңғы сұрауды анық қабылдамай, қайтару жасамаған жағдайда ғана қолжетімді. Қайталау алдында провайдердегі күй қайта тексеріледі.",
    "Доступно только после однозначного отказа провайдера, если возврат не был создан. Перед повтором статус у провайдера проверяется заново.",
    "Available only after a definite provider rejection that created no refund. A fresh provider check runs before the retry.",
  ],
  recoveryUncertain: [
    "Алдыңғы сұраудың нәтижесі белгісіз болса, күйді тексеруді пайдаланыңыз. Қайтаруды қайталауға болмайды.",
    "Если исход предыдущего запроса неизвестен, используйте проверку статуса. Повторять возврат нельзя.",
    "If the earlier outcome is uncertain, use reconciliation. The refund cannot be retried.",
  ],
  total: ["Тапсырыс сомасы", "Сумма заказа", "Order total"],
  refundAmount: ["Қайтару сомасы", "Сумма возврата", "Refund amount"],
  originalFee: [
    "Бастапқы өңдеу алымы",
    "Исходная комиссия обработки",
    "Original processing fee",
  ],
  remainingFee: [
    "Қалған өңдеу алымы",
    "Оставшаяся комиссия обработки",
    "Remaining processing fee",
  ],
  payoutContribution: [
    "Ұйымдастырушы төлеміне есептелген сома",
    "Расчетная сумма к выплате организатору",
    "Estimated organizer payout contribution",
  ],
  cancelEvent: ["Іс-шараны тоқтату", "Отменить событие", "Cancel event"],
  cancelEventHint: [
    "Тоқтату тіркеу мен кіруді жабады және талап етілетін толық қайтаруларды өңдеуге қояды. Бұл әрекетті кері қайтару мүмкін емес.",
    "Отмена закроет регистрацию и проход и запустит обработку необходимых полных возвратов. Отмену нельзя обратить.",
    "Cancellation closes registration and admission and starts processing required full refunds. It cannot be undone.",
  ],
  cancelEventSubmit: [
    "Іс-шараны тоқтатып, қайтаруды бастау",
    "Отменить событие и начать возвраты",
    "Cancel event and start refunds",
  ],
  eventCancelled: [
    "Іс-шара тоқтатылды. Қажетті қайтарулар өңделеді; олардың расталған күйін тапсырыстардан тексеріңіз.",
    "Событие отменено. Необходимые возвраты обрабатываются; проверяйте их подтвержденный статус в заказах.",
    "Event cancelled. Required refunds are being processed; check their confirmed status on the orders.",
  ],
  noPrivateData: [
    "Қолжетімділік өзгерсе, бетті қайта жүктеңіз.",
    "Если доступ изменился, обновите страницу.",
    "Reload the page if your access has changed.",
  ],
} satisfies Record<string, readonly [string, string, string]>
export type SupportMessageKey = keyof typeof copy
export function supportText(locale: Locale, key: SupportMessageKey) {
  return copy[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2]
}
export function useSupportText() {
  const { locale } = useAccount()
  return { locale, t: (key: SupportMessageKey) => supportText(locale, key) }
}
