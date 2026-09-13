import { useAccount } from "@/auth/context"

const messages = {
  title: ["Ұйымдастырушы профилі", "Профиль организатора", "Organizer profile"],
  hint: [
    "Бұл профильді іс-шараны белсендіру формасына өзіңіз таңдап енгізе аласыз. Профильді сақтау ешбір іс-шараны белсендірмейді.",
    "Этот профиль можно вручную подставить в форму активации события. Сохранение профиля не активирует события.",
    "You can choose to fill an event activation form from this profile. Saving the profile does not activate any event.",
  ],
  demo: [
    "Оқу жобасының имитациясы. Жалған заңды атау мен DEMO- төлем сілтемесін қолданыңыз. Нақты банк деректерін енгізбеңіз.",
    "Учебная имитация. Используйте вымышленное юридическое имя и ссылку DEMO-. Не вводите настоящие банковские реквизиты.",
    "Academic simulation. Use a fictional legal name and a DEMO- payout reference. Do not enter real bank credentials.",
  ],
  displayName: [
    "Ұйымдастырушының көрсетілетін аты",
    "Отображаемое имя организатора",
    "Organizer display name",
  ],
  legalName: [
    "Жалған заңды атау",
    "Вымышленное юридическое имя",
    "Simulated legal name",
  ],
  contact: [
    "Ұйымдастырушы байланысы",
    "Контакт организатора",
    "Organizer contact",
  ],
  dummyPayoutReference: [
    "Жалған төлем сілтемесі",
    "Учебная ссылка для выплат",
    "Dummy payout reference",
  ],
  payoutHint: [
    "DEMO- префиксінен кейін 3–60 латын әрпі, сан, астын сызу немесе дефис. Мысалы, DEMO-ORGANIZER.",
    "После DEMO- укажите 3–60 латинских букв, цифр, подчёркиваний или дефисов. Например, DEMO-ORGANIZER.",
    "After DEMO-, use 3–60 letters, digits, underscores or hyphens. For example, DEMO-ORGANIZER.",
  ],
  missing: [
    "Сақталған ұйымдастырушы профилі жоқ.",
    "Сохранённого профиля организатора нет.",
    "No organizer profile has been saved.",
  ],
  save: [
    "Ұйымдастырушы профилін сақтау",
    "Сохранить профиль организатора",
    "Save organizer profile",
  ],
  saving: ["Сақталуда…", "Сохранение…", "Saving…"],
  loading: ["Профиль жүктелуде…", "Загрузка профиля…", "Loading profile…"],
  saved: [
    "Ұйымдастырушы профилі сақталды.",
    "Профиль организатора сохранён.",
    "Organizer profile saved.",
  ],
  updated: ["Сақталған уақыт", "Сохранён", "Saved at"],
  revision: ["Қаралған нұсқа", "Проверяемая версия", "Reviewed revision"],
  denied: [
    "Профиль қолжетімсіз. Тіркелгіге кіру рұқсатын тексеріңіз.",
    "Профиль недоступен. Проверьте доступ к учётной записи.",
    "Profile unavailable. Check your account access.",
  ],
  retry: [
    "Профильді қайта жүктеу",
    "Повторить загрузку профиля",
    "Retry loading profile",
  ],
  reload: [
    "Өзгерістерді тастап, сақталған профильді жүктеу",
    "Отбросить изменения и загрузить сохранённый профиль",
    "Discard edits and load saved profile",
  ],
  stale: [
    "Сақталған профиль өзгерді. Өңдеуді жалғастыру үшін сақталған нұсқаны қайта жүктеңіз. Жауабы белгісіз сұрауды өзгеріссіз қайталауға болады.",
    "Сохранённый профиль изменился. Загрузите его перед дальнейшим редактированием. Запрос с неизвестным результатом можно повторить без изменений.",
    "The saved profile changed. Reload it before editing further. An uncertain request can be retried unchanged.",
  ],
  invalid: [
    "Барлық өрісті тексеріңіз. Байланыс кемінде 3 таңба, төлем сілтемесі DEMO- пішімінде болуы керек.",
    "Проверьте все поля. Контакт должен содержать не менее 3 символов, ссылка для выплат должна иметь формат DEMO-.",
    "Check every field. Contact needs at least 3 characters, and the payout reference must use the DEMO- format.",
  ],
  uncertain: [
    "Сақтау нәтижесі расталмады. Сол сұрауды қайталаңыз немесе өзгертілген деректермен жаңа сұрау жіберіңіз.",
    "Результат сохранения не подтверждён. Повторите тот же запрос или отправьте новый с изменёнными данными.",
    "The save result is unconfirmed. Retry the same request, or change the fields to submit a new request.",
  ],
  retrySave: [
    "Сол сақтау сұрауын қайталау",
    "Повторить то же сохранение",
    "Retry same save",
  ],
  useSaved: [
    "Сақталған ұйымдастырушы профилін қолдану",
    "Использовать сохранённый профиль организатора",
    "Use saved organizer profile",
  ],
  used: [
    "Сақталған профиль формаға енгізілді. Іс-шараны сақтау алдында оны тексеріңіз.",
    "Сохранённый профиль подставлен в форму. Проверьте его перед сохранением события.",
    "Saved profile filled into the form. Review it before saving the event.",
  ],
} as const

export function useOrganizerProfileText() {
  const { locale } = useAccount()
  return {
    locale,
    t: (key: keyof typeof messages) =>
      messages[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2],
  }
}
