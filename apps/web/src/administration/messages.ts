import { useAccount } from "../auth/context"
const copy = {
  title: [
    "Платформаны басқару",
    "Управление платформой",
    "Platform administration",
  ],
  operations: [
    "Операциялық жазбалар",
    "Операционные записи",
    "Operational records",
  ],
  campaigns: ["Промоакциялар", "Промокампании", "Promotional campaigns"],
  reports: ["Шағымдар", "Жалобы", "Event reports"],
  accounts: ["Тіркелгілер", "Аккаунты", "Accounts"],
  events: ["Іс-шаралар", "События", "Events"],
  settings: ["Белсендіру алымы", "Сбор за активацию", "Activation fee"],
  search: ["Іздеу", "Поиск", "Search"],
  query: ["Аты, email немесе ID", "Имя, email или ID", "Name, email or ID"],
  eventQuery: [
    "Атауы, іс-шара не ұйымдастырушы ID",
    "Название, ID события или организатора",
    "Title, event or organizer ID",
  ],
  filter: ["Тоқтату күйі", "Приостановка", "Suspension"],
  all: ["Барлығы", "Все", "All"],
  active: ["Тоқтатылмаған", "Не приостановлен", "Not suspended"],
  suspended: ["Тоқтатылған", "Приостановлен", "Suspended"],
  name: ["Аты", "Имя", "Name"],
  email: ["Email", "Email", "Email"],
  status: ["Күйі", "Состояние", "Status"],
  action: ["Әрекет", "Действие", "Action"],
  review: ["Қарау", "Проверить", "Review"],
  next: ["Келесі бет", "Следующая страница", "Next page"],
  first: ["Бірінші бет", "Первая страница", "First page"],
  empty: ["Жазба табылмады.", "Записи не найдены.", "No records found."],
  reason: ["Әрекеттің себебі", "Причина действия", "Reason for this action"],
  suspend: ["Тоқтату", "Приостановить", "Suspend"],
  resume: ["Қалпына келтіру", "Возобновить", "Resume"],
  close: ["Жабу", "Закрыть", "Close"],
  saved: ["Өзгеріс сақталды.", "Изменение сохранено.", "Change saved."],
  reload: ["Жаңарту", "Обновить", "Reload"],
  denied: [
    "Бұл бөлімге рұқсат жоқ.",
    "Нет доступа к этому разделу.",
    "You do not have access to this section.",
  ],
  consequence: [
    "Тоқтату қолжетімділікті шектейді және офлайн көшірмелердің мерзімін аяқтайды. Тіркелгі тоқтатылса, оның сессиялары жабылады. Билеттер мен төлемдер сақталады.",
    "Приостановка ограничивает доступ и завершает срок офлайн-копий. Для аккаунта также завершаются сессии. Билеты и платежи сохраняются.",
    "Suspension restricts access and expires offline snapshots. Account suspension also ends its sessions. Tickets and payment records are retained.",
  ],
  audit: [
    "Себеп аудит журналында сақталады.",
    "Причина сохраняется в журнале аудита.",
    "The reason is recorded in the audit log.",
  ],
  fee: [
    "Жаңа белсендіру алымы, KZT",
    "Новый сбор за активацию, KZT",
    "New activation fee, KZT",
  ],
  saveFee: ["Алымды сақтау", "Сохранить сбор", "Save fee"],
  feeHint: [
    "Өзгеріс тек жаңа белсендіру төлемдеріне қолданылады. Бұрынғы төлемдер өзгермейді.",
    "Изменение применяется только к новым платежам за активацию. Существующие платежи не меняются.",
    "Changes apply only to new activation payments. Existing payments keep their recorded fee.",
  ],
  invalid: [
    "Өрістерді тексеріңіз.",
    "Проверьте поля.",
    "Check the form fields.",
  ],
  self: [
    "Өз тіркелгіңізді басқа модератор тексеруі керек.",
    "Ваш аккаунт должен проверить другой модератор.",
    "Another moderator must review your own account.",
  ],
  paid: [
    "Ақылы сатылымды белсендіру",
    "Активация платных продаж",
    "Paid-sales activation",
  ],
  paidSuspend: [
    "Ақылы сатылымды тоқтату",
    "Приостановить платные продажи",
    "Suspend paid sales",
  ],
  paidResume: [
    "Ақылы сатылымды қалпына келтіру",
    "Возобновить платные продажи",
    "Resume paid sales",
  ],
  paidHint: [
    "Бұл әрекет ақылы сатылымға ғана қолданылады. Белсендіру үшін қайта төлем алынбайды.",
    "Это действие относится только к платным продажам. Повторная плата за активацию не взимается.",
    "This action applies only to paid sales. It does not charge another activation fee.",
  ],
  paidUnavailable: [
    "Ұйымдастырушы ақылы сатылымды белсендіру тізімін әлі сақтамаған.",
    "Организатор ещё не сохранил данные для активации платных продаж.",
    "The organizer has not saved a paid-sales activation checklist yet.",
  ],
  acceptedTerms: ["Шарттар", "Условия", "Terms"],
  termsCurrent: [
    "Ағымдағы нұсқа қабылданған",
    "Принята текущая версия",
    "Current version accepted",
  ],
  termsEarlier: [
    "Бұрынғы нұсқа қабылданған",
    "Принята прежняя версия",
    "Earlier version accepted",
  ],
  notRecorded: ["Тіркелмеген", "Не записано", "Not recorded"],
  checkPassed: ["Сәтті өтті", "Пройдена", "Passed"],
  checkFailed: ["Өтпеді", "Не пройдена", "Failed"],
  checkPending: ["Күтілуде", "Ожидается", "Pending"],
} satisfies Record<string, readonly [string, string, string]>
export function useAdministrationText() {
  const { locale } = useAccount()
  return {
    locale,
    t: (key: keyof typeof copy) =>
      copy[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2],
  }
}
