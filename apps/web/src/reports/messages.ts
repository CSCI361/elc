import { useAccount } from "../auth/context"

export const reportMessages = {
  reportTitle: [
    "Іс-шара туралы шағым",
    "Пожаловаться на событие",
    "Report this event",
  ],
  reportIntro: [
    "Жаңылыстыратын, тыйым салынған немесе қауіпті іс-шара туралы платформа модераторларына хабарлаңыз.",
    "Сообщите модераторам платформы о вводящем в заблуждение, запрещённом или опасном событии.",
    "Tell platform moderators about a misleading, prohibited or unsafe event.",
  ],
  category: ["Себебі", "Причина", "Reason"],
  misleading: [
    "Жаңылыстыратын ақпарат",
    "Вводящая в заблуждение информация",
    "Misleading information",
  ],
  prohibited: [
    "Тыйым салынған мазмұн",
    "Запрещённый контент",
    "Prohibited content",
  ],
  fraud: ["Алаяқтық", "Мошенничество", "Fraud"],
  safety: ["Қауіпсіздікке қатер", "Угроза безопасности", "Safety concern"],
  other: ["Басқа", "Другое", "Other"],
  details: ["Не болды?", "Что случилось?", "What happened?"],
  detailsHint: [
    "1000 таңбаға дейін. Жеке деректерді жазбаңыз.",
    "До 1000 символов. Не указывайте личные данные.",
    "Up to 1,000 characters. Do not include personal data.",
  ],
  submit: ["Шағым жіберу", "Отправить жалобу", "Send report"],
  submitted: [
    "Шағымыңыз модераторларға жіберілді. Қайта жіберсеңіз, ол жаңартылады.",
    "Жалоба отправлена модераторам. Повторная отправка обновит её.",
    "Your report was sent to moderators. Sending again updates it.",
  ],
  queueTitle: ["Іс-шара шағымдары", "Жалобы на события", "Event reports"],
  queueIntro: [
    "Ашық шағымдарды қарап, әрекетсіз жабыңыз немесе іс-шараны тоқтатқаннан кейін шара қолданылды деп белгілеңіз.",
    "Проверяйте открытые жалобы: закройте их без действий или отметьте принятые меры после приостановки события.",
    "Review open reports: dismiss them, or record action taken after suspending the event.",
  ],
  stateFilter: ["Күйі", "Состояние", "State"],
  open: ["Ашық", "Открыта", "Open"],
  dismissed: ["Әрекетсіз жабылды", "Закрыта без действий", "Dismissed"],
  actioned: ["Шара қолданылды", "Приняты меры", "Action taken"],
  all: ["Барлығы", "Все", "All"],
  empty: ["Шағымдар жоқ", "Жалоб нет", "No reports"],
  event: ["Іс-шара ID", "ID события", "Event ID"],
  eventStatus: ["Іс-шара күйі", "Статус события", "Event status"],
  eventSuspended: ["Тоқтатылған", "Приостановлено", "Suspended"],
  eventActive: ["Тоқтатылмаған", "Не приостановлено", "Not suspended"],
  openForEvent: [
    "Осы іс-шара бойынша ашық шағымдар",
    "Открытых жалоб на событие",
    "Open reports for this event",
  ],
  reporter: ["Шағымданушы ID", "ID автора жалобы", "Reporter ID"],
  submittedAt: ["Жіберілген", "Отправлена", "Submitted"],
  resolution: ["Шешім", "Решение", "Resolution"],
  reason: ["Шешім себебі", "Причина решения", "Resolution reason"],
  resolve: ["Шешімді сақтау", "Сохранить решение", "Save resolution"],
  reasonRequired: [
    "Шешім себебін жазыңыз.",
    "Укажите причину решения.",
    "Enter a resolution reason.",
  ],
  suspendFirst: [
    "Алдымен іс-шараны «Іс-шаралар» бөлімінде тоқтатыңыз.",
    "Сначала приостановите событие в разделе «События».",
    "Suspend the event in the Events section first.",
  ],
  manageEvent: ["Іс-шаралар бөліміне өту", "Перейти к событиям", "Open events"],
  auditHint: [
    "Шешім мен себебі аудит журналына жазылады.",
    "Решение и причина записываются в журнал аудита.",
    "The resolution and reason are recorded in the audit log.",
  ],
  first: ["Бірінші бет", "Первая страница", "First page"],
  next: ["Келесі бет", "Следующая страница", "Next page"],
  pagination: ["Шағым беттері", "Страницы жалоб", "Report pages"],
} satisfies Record<string, readonly [string, string, string]>

export type ReportMessageKey = keyof typeof reportMessages

export function useReportText() {
  const { locale } = useAccount()
  return {
    locale,
    t: (key: ReportMessageKey) =>
      reportMessages[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2],
  }
}
