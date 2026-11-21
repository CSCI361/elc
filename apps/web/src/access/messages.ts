import type { Locale } from "@elc/shared"
import { useAccount } from "@/auth/context"

const copy = {
  title: [
    "Қызметкерлер және шақырулар",
    "Сотрудники и приглашения",
    "Staff and invitations",
  ],
  ownerOnly: [
    "Қолжетімділікті тек іс-шара иесі басқарады.",
    "Доступом управляет только владелец события.",
    "Only the event owner can manage access.",
  ],
  staff: ["Іс-шара қызметкерлері", "Сотрудники события", "Event staff"],
  staffHint: [
    "Тіркелген және поштасын растаған аккаунттың мекенжайын енгізіңіз. Құқықтар тек осы іс-шараға беріледі; олар платформаға немесе жеке іс-шара билетін сатып алуға рұқсат бермейді.",
    "Укажите адрес зарегистрированного аккаунта с подтвержденной почтой. Права действуют только для этого события; они не дают доступа к платформе или покупке билетов закрытого события.",
    "Enter an existing account with a verified email. These permissions apply only to this event; they do not grant platform access or private-event ticket purchasing.",
  ],
  explicitHint: [
    "Іс-шара иесіне де сканерлеу, кіруді қайтару және тексеру құқықтары бөлек берілуі керек.",
    "Владельцу также нужны явные права на сканирование, отмену прохода и проверку проходов.",
    "The owner also needs explicit permissions to scan, reverse admission, or review check-ins.",
  ],
  addStaff: [
    "Қызметкер құқықтарын беру",
    "Назначить права сотрудника",
    "Assign staff permissions",
  ],
  permissions: ["Құқықтар", "Права", "Permissions"],
  email: ["Электрондық пошта", "Электронная почта", "Email address"],
  save: ["Құқықтарды сақтау", "Сохранить права", "Save permissions"],
  saved: ["Құқықтар сақталды.", "Права сохранены.", "Permissions saved."],
  noPermissions: [
    "Белсенді құқықтар жоқ",
    "Нет активных прав",
    "No active permissions",
  ],
  revokeHint: [
    "Құқық таңдалмаса, сақтау осы аккаунттың барлық жеке берілген құқықтарын жояды.",
    "Если ничего не выбрано, сохранение отзовет все явно назначенные права этого аккаунта.",
    "Saving with no permissions selected revokes this account's explicit permissions.",
  ],
  revokeAll: ["Таңдауды тазалау", "Снять выбор", "Clear selection"],
  noStaff: ["Қызметкерлер әзірге жоқ", "Сотрудников пока нет", "No staff yet"],
  noStaffHint: [
    "Билет сканерлеу немесе қолдауға жауап беру үшін адамдарды email арқылы қосыңыз.",
    "Добавьте людей по email, чтобы они сканировали билеты или отвечали в поддержке.",
    "Add people by email so they can scan tickets or answer support.",
  ],
  staffMissing: [
    "Бұл мекенжайға сәйкес аккаунт табылмады. Қызметкер алдымен тіркелуі керек.",
    "Аккаунт с этим адресом не найден. Сотруднику нужно сначала зарегистрироваться.",
    "No account with this email was found. The staff member must register first.",
  ],
  invitations: [
    "Жеке іс-шараға шақырулар",
    "Приглашения в закрытое событие",
    "Private-event invitations",
  ],
  invitationHint: [
    "Қонақ шақыруды сол мекенжайы расталған аккаунтпен қабылдайды. Сілтемелер пошта арқылы жеткізу кезегіне қойылады.",
    "Гость принимает приглашение аккаунтом с тем же подтвержденным адресом. Ссылки ставятся в очередь для доставки по почте.",
    "Guests accept with an account whose verified email matches the invitation. Links are queued for email delivery.",
  ],
  privateOnly: [
    "Шақырулар тек жеке, белсенді іс-шараларға жасалады.",
    "Приглашения создаются только для доступных закрытых событий.",
    "Invitations can be created only for available private events.",
  ],
  publishFirst: [
    "Қонақтар шақыруды іс-шара жарияланғаннан кейін қабылдай алады.",
    "Гости смогут принять приглашение после публикации события.",
    "Guests can accept after the event is published.",
  ],
  invite: [
    "Шақыруды кезекке қою",
    "Поставить приглашение в очередь",
    "Queue invitation",
  ],
  queued: [
    "Шақыру жеткізу кезегіне қойылды.",
    "Приглашение поставлено в очередь доставки.",
    "Invitation queued for delivery.",
  ],
  noInvitations: [
    "Шақырулар әзірге жоқ",
    "Приглашений пока нет",
    "No invitations yet",
  ],
  reissue: [
    "Жаңа шақыру шығару",
    "Выдать новое приглашение",
    "Reissue invitation",
  ],
  reissueHint: [
    "Жаңа шақыру бұрынғы сілтеме мен қабылданған қолжетімділікті бірден жояды. Қонақ жаңа шақыруды қабылдауы керек.",
    "Новое приглашение сразу отзывает старую ссылку и ранее принятый доступ. Гостю нужно принять новое приглашение.",
    "Reissuing immediately revokes the old link and any accepted access. The guest must accept the new invitation.",
  ],
  revoke: [
    "Шақыруды қайтарып алу",
    "Отозвать приглашение",
    "Revoke invitation",
  ],
  revokedNotice: [
    "Шақыру және оның қолжетімділігі қайтарылды.",
    "Приглашение и доступ по нему отозваны.",
    "The invitation and its access were revoked.",
  ],
  pending: ["Қабылдауды күтуде", "Ожидает принятия", "Awaiting acceptance"],
  accepted: ["Қабылданды", "Принято", "Accepted"],
  expired: ["Мерзімі өткен", "Истекло", "Expired"],
  revoked: ["Қайтарылды", "Отозвано", "Revoked"],
  deadline: ["Қабылдау мерзімі", "Срок принятия", "Acceptance deadline"],
  acceptedOn: ["Қабылданған күні", "Дата принятия", "Accepted on"],
  more: ["Келесі бет", "Следующая страница", "Next page"],
  first: ["Бірінші бет", "Первая страница", "First page"],
  invitationTitle: [
    "Іс-шараға шақыру",
    "Приглашение на событие",
    "Event invitation",
  ],
  invitationIntro: [
    "Шақыру жіберілген мекенжайы расталған аккаунтпен кіріңіз. Ұйымдастырушы қолжетімділікті кейін қайтарып ала алады.",
    "Войдите в аккаунт с подтвержденным адресом, на который отправлено приглашение. Организатор может позже отозвать доступ.",
    "Sign in with the verified email that received this invitation. The organizer can later revoke access.",
  ],
  accept: ["Шақыруды қабылдау", "Принять приглашение", "Accept invitation"],
  acceptedNotice: [
    "Шақыру қабылданды. Іс-шараны аша аласыз.",
    "Приглашение принято. Вы можете открыть событие.",
    "Invitation accepted. You can open the event.",
  ],
  unavailable: [
    "Шақыруды қабылдау мүмкін болмады. Аккаунт мекенжайын тексеріп, бастапқы шақыруды қайта ашыңыз немесе ұйымдастырушыдан жаңасын сұраңыз.",
    "Не удалось принять приглашение. Проверьте адрес аккаунта и откройте исходное приглашение заново или попросите организатора выдать новое.",
    "This invitation could not be accepted. Check your account email and reopen the original invitation, or ask the organizer for a new one.",
  ],
  missing: [
    "Поштадағы бастапқы шақыру сілтемесін ашыңыз. Бұл бетті жаңартсаңыз, шақыруды қайта ашу керек.",
    "Откройте исходную ссылку из приглашения. Если вы обновили эту страницу, откройте приглашение заново.",
    "Open the original invitation link from your email. If you refreshed this page, reopen the invitation.",
  ],
  keepTab: [
    "Осы бетті ашық қалдырыңыз. Басқа бетте тіркеліп немесе кіріп болғаннан кейін осында оралып, аккаунтты тексеріңіз.",
    "Оставьте эту вкладку открытой. После регистрации или входа в другой вкладке вернитесь сюда и проверьте аккаунт.",
    "Keep this tab open. After registering or signing in in another tab, return here and check your account.",
  ],
  otherSignIn: [
    "Басқа кіру тәсілдері",
    "Другие способы входа",
    "Other sign-in options",
  ],
  checkAccount: ["Аккаунтты тексеру", "Проверить аккаунт", "Check account"],
  switchAccount: [
    "Басқа аккаунтпен кіру",
    "Войти другим аккаунтом",
    "Use another account",
  ],
  verifyRequired: [
    "Шақыруды қабылдау үшін аккаунттың поштасын растаңыз.",
    "Подтвердите почту аккаунта, чтобы принять приглашение.",
    "Verify your account email before accepting the invitation.",
  ],
  accountUnavailable: [
    "Аккаунт қазір қолжетімсіз. Қайта тексеріңіз немесе басқа аккаунтпен кіріңіз.",
    "Аккаунт сейчас недоступен. Проверьте снова или войдите другим аккаунтом.",
    "This account is unavailable. Check again or sign in with another account.",
  ],
  "event:manage": ["Іс-шараны басқару", "Управлять событием", "Manage event"],
  "support:manage": [
    "Іс-шара қолдауын басқару",
    "Управлять поддержкой события",
    "Manage event support",
  ],
  "refund:initiate": [
    "Қайтаруды бастау",
    "Инициировать возвраты",
    "Initiate refunds",
  ],
  "ticket:scan": ["Билеттерді сканерлеу", "Сканировать билеты", "Scan tickets"],
  "checkin:reverse": ["Кіруді қайтару", "Отменять проход", "Reverse admission"],
  "checkin:review": [
    "Кіру тарихын тексеру",
    "Проверять проходы",
    "Review check-ins",
  ],
  "analytics:read": [
    "Аналитиканы қарау",
    "Смотреть аналитику",
    "View analytics",
  ],
  "history:read": [
    "Іс-шара тарихын қарау",
    "Смотреть историю события",
    "View event history",
  ],
} satisfies Record<string, readonly [string, string, string]>

export type AccessMessageKey = keyof typeof copy
export function accessText(locale: Locale, key: AccessMessageKey) {
  return copy[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2]
}
export function useAccessText() {
  const { locale } = useAccount()
  return { locale, t: (key: AccessMessageKey) => accessText(locale, key) }
}
