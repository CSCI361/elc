import type { Locale, ScannerEvent } from "@elc/shared"

export type Language = Locale

const en = {
  signInTitle: "Ticket check-in",
  signInIntro:
    "For event staff. Sign in with the account the organizer added to the event.",
  email: "Email",
  password: "Password",
  signIn: "Sign in",
  or: "or",
  google: "Continue with Google",
  webAccount: "No account, or forgot your password?",
  openWebsite: "Open elc in the browser",
  signInError: "Wrong email or password. Try again.",
  verifyTitle: "Confirm your email",
  verifyBody:
    "Open the link we sent to your email, then come back here and tap Done.",
  verifyDone: "Done",
  online: "Online",
  offline: "Offline",
  account: "Account",
  eventsTitle: "Your events",
  eventsIntro: "Events where you check tickets.",
  noEvents:
    "No events yet. Ask the organizer to add you to their event's staff.",
  offlineEvents:
    "No internet. These events have a guest list saved on this phone.",
  noSavedEvents: "No internet, and no guest lists are saved on this phone.",
  loadError: "Couldn't load events. Pull down to try again.",
  more: "Show more",
  live: "Happening now",
  today: "Today",
  ended: "Ended",
  cancelled: "Cancelled",
  suspended: "Suspended",
  checkedInOf: "{checked} of {total} checked in",
  savedOffline: "Saved offline",
  back: "Events",
  scanTab: "Scan",
  guestsTab: "Guests",
  needsReview: "Offline check-ins waiting for the organizer's review: {count}.",
  cameraTitle: "Allow camera access",
  cameraBody: "The camera reads the QR code on each ticket.",
  allowCamera: "Allow camera",
  cameraDenied: "Camera access is off. Turn it on in Settings.",
  openSettings: "Open Settings",
  scanHint: "Point the camera at the ticket's QR code",
  checking: "Checking…",
  endedNotice: "This event has ended. Tickets can't be checked any more.",
  cancelledNotice: "This event was cancelled. Don't let anyone in.",
  suspendedNotice: "This event is suspended. Ask the organizer what to do.",
  noPermission:
    "You can't check tickets for this event. Ask the organizer for access.",
  noConnection:
    "No internet, and this event's guest list isn't saved on this phone.",
  letIn: "Let them in",
  checkedInDone: "Ticket checked in.",
  savedOnPhone: "Saved on this phone. It's sent when you're back online.",
  alreadyUsed: "Already checked in",
  alreadyUsedBody: "This ticket was used before. Don't let them in again.",
  invalid: "Not a valid ticket",
  wrongEvent: "Ticket for another event",
  ticketCancelled: "Ticket cancelled",
  ticketRefunded: "Ticket refunded",
  blocked: "Entry blocked",
  forbidden: "No access to this event",
  snapshotExpired: "Saved guest list expired",
  locallyReversed: "Check-in undone on this phone",
  doNotAdmit: "Don't let them in.",
  notOnList: "Not on the saved guest list",
  notOnListBody:
    "Don't let them in. Check the ticket again when you're online.",
  clockChanged: "The phone's clock was changed",
  clockChangedBody:
    "Offline checking is off until you go online and update the guest list.",
  notTicket: "Not an elc ticket",
  notTicketBody:
    "This QR code isn't a ticket. Event links can't be used for entry.",
  noAnswer: "No answer from the server",
  noAnswerBody:
    "The check may have gone through. Tap Try again to get the result.",
  requestError: "Something went wrong. Try again.",
  localPending:
    "This ticket was scanned offline on this phone and isn't sent yet. Send the saved check-ins first.",
  next: "Scan next",
  retry: "Try again",
  undo: "Undo this check-in",
  undoDone: "Check-in undone. The change is sent with the saved check-ins.",
  offlineTitle: "Works without internet",
  offlineIntro:
    "Save the guest list to this phone. If the internet drops, you can keep checking tickets, and they're sent when you're back online.",
  saveList: "Save guest list",
  updateList: "Update list",
  savedAt: "Saved at {time}. Works until {until}.",
  waiting: "Check-ins waiting to send: {count}",
  sendNow: "Send now",
  listSaved: "Guest list saved.",
  sent: "Saved check-ins sent.",
  offlineFailed:
    "Couldn't finish. Your check-ins are safe on this phone. Try again when you're online.",
  offlineUnavailable:
    "Offline mode isn't available in this version of the app.",
  offlineLocked:
    "Sign in with the same account to send the check-ins saved on this phone.",
  oldScans:
    "Some check-ins have waited over a day. Send them before {date}, or they're deleted.",
  conflicts: "Check-ins waiting for the organizer's review: {count}.",
  deviceRevoked: "The organizer turned off offline checking on this phone.",
  uncertainOnline:
    "Checks with no answer yet: {count}. Scan the same ticket again while online.",
  searchGuests: "Search by name",
  noGuests: "No guests found.",
  guestsError: "Couldn't load guests. Try again.",
  savedListNote:
    "From the guest list saved at {time}. Scan the ticket to be sure.",
  notIn: "Not in yet",
  checkedIn: "Checked in",
  statusCancelled: "Cancelled",
  statusRefunded: "Refunded",
  statusBlocked: "Blocked",
  seat: "Section {section} · Row {row} · Seat {number}",
  accessibleSeat: "Accessible seat",
  undoCheckIn: "Undo check-in",
  reason: "Why are you undoing it?",
  cancel: "Cancel",
  undoneOnline: "Check-in undone. They can be checked in again.",
  undoUncertain: "No answer from the server. Tap Try again.",
  language: "Language",
  signOut: "Sign out",
  signOutNote:
    "Signing out deletes saved guest lists from this phone. Check-ins that weren't sent stay locked until you sign in to this account again, for up to 7 days.",
  signOutFailed:
    "Couldn't sign out. Connect to the internet and try again before you hand this phone to someone else.",
  deviceLabel: "elc scanner phone",
}

export type Copy = Record<keyof typeof en, string>

const ru: Copy = {
  signInTitle: "Проверка билетов",
  signInIntro:
    "Для сотрудников мероприятия. Войдите в аккаунт, который организатор добавил к мероприятию.",
  email: "Электронная почта",
  password: "Пароль",
  signIn: "Войти",
  or: "или",
  google: "Войти через Google",
  webAccount: "Нет аккаунта или забыли пароль?",
  openWebsite: "Открыть elc в браузере",
  signInError: "Неверная почта или пароль. Попробуйте ещё раз.",
  verifyTitle: "Подтвердите почту",
  verifyBody:
    "Откройте ссылку из письма, затем вернитесь сюда и нажмите «Готово».",
  verifyDone: "Готово",
  online: "В сети",
  offline: "Нет сети",
  account: "Аккаунт",
  eventsTitle: "Ваши мероприятия",
  eventsIntro: "Мероприятия, где вы проверяете билеты.",
  noEvents:
    "Пока нет мероприятий. Попросите организатора добавить вас в команду мероприятия.",
  offlineEvents:
    "Нет интернета. Показаны мероприятия, список гостей которых сохранён на телефоне.",
  noSavedEvents: "Нет интернета, а на телефоне нет сохранённых списков гостей.",
  loadError:
    "Не удалось загрузить мероприятия. Потяните вниз, чтобы повторить.",
  more: "Показать ещё",
  live: "Идёт сейчас",
  today: "Сегодня",
  ended: "Завершено",
  cancelled: "Отменено",
  suspended: "Приостановлено",
  checkedInOf: "Вошли {checked} из {total}",
  savedOffline: "Сохранено офлайн",
  back: "Мероприятия",
  scanTab: "Сканер",
  guestsTab: "Гости",
  needsReview: "Офлайн-проходов ждут проверки организатора: {count}.",
  cameraTitle: "Разрешите доступ к камере",
  cameraBody: "Камера считывает QR-код с каждого билета.",
  allowCamera: "Разрешить камеру",
  cameraDenied: "Доступ к камере выключен. Включите его в Настройках.",
  openSettings: "Открыть Настройки",
  scanHint: "Наведите камеру на QR-код билета",
  checking: "Проверяем…",
  endedNotice: "Мероприятие завершено. Билеты больше не проверяются.",
  cancelledNotice: "Мероприятие отменено. Никого не пропускайте.",
  suspendedNotice:
    "Мероприятие приостановлено. Уточните у организатора, что делать.",
  noPermission:
    "У вас нет доступа к проверке билетов на этом мероприятии. Попросите его у организатора.",
  noConnection:
    "Нет интернета, а список гостей этого мероприятия не сохранён на телефоне.",
  letIn: "Можно пропустить",
  checkedInDone: "Билет отмечен.",
  savedOnPhone: "Сохранено на телефоне. Отправится, когда появится интернет.",
  alreadyUsed: "Уже прошёл",
  alreadyUsedBody: "По этому билету уже входили. Не пропускайте повторно.",
  invalid: "Билет недействителен",
  wrongEvent: "Билет на другое мероприятие",
  ticketCancelled: "Билет отменён",
  ticketRefunded: "Билет возвращён",
  blocked: "Вход заблокирован",
  forbidden: "Нет доступа к мероприятию",
  snapshotExpired: "Сохранённый список устарел",
  locallyReversed: "Проход отменён на этом телефоне",
  doNotAdmit: "Не пропускайте.",
  notOnList: "Нет в сохранённом списке",
  notOnListBody:
    "Не пропускайте. Проверьте билет ещё раз, когда появится интернет.",
  clockChanged: "Часы телефона изменены",
  clockChangedBody:
    "Офлайн-проверка выключена, пока вы не выйдете в сеть и не обновите список гостей.",
  notTicket: "Это не билет elc",
  notTicketBody:
    "Этот QR-код не билет. По ссылкам на мероприятие войти нельзя.",
  noAnswer: "Сервер не ответил",
  noAnswerBody:
    "Проверка могла пройти. Нажмите «Повторить», чтобы узнать результат.",
  requestError: "Что-то пошло не так. Попробуйте ещё раз.",
  localPending:
    "Этот билет отсканирован офлайн на этом телефоне и ещё не отправлен. Сначала отправьте сохранённые проходы.",
  next: "Следующий билет",
  retry: "Повторить",
  undo: "Отменить этот проход",
  undoDone:
    "Проход отменён. Изменение отправится вместе с сохранёнными проходами.",
  offlineTitle: "Работает без интернета",
  offlineIntro:
    "Сохраните список гостей на телефон. Если пропадёт интернет, вы сможете дальше проверять билеты, а проходы отправятся, когда связь вернётся.",
  saveList: "Сохранить список гостей",
  updateList: "Обновить список",
  savedAt: "Сохранено в {time}. Действует до {until}.",
  waiting: "Ждут отправки: {count}",
  sendNow: "Отправить",
  listSaved: "Список гостей сохранён.",
  sent: "Сохранённые проходы отправлены.",
  offlineFailed:
    "Не удалось завершить. Проходы сохранены на телефоне. Повторите, когда появится интернет.",
  offlineUnavailable: "Офлайн-режим недоступен в этой версии приложения.",
  offlineLocked:
    "Войдите в тот же аккаунт, чтобы отправить проходы, сохранённые на телефоне.",
  oldScans:
    "Некоторые проходы ждут больше суток. Отправьте их до {date}, иначе они удалятся.",
  conflicts: "Проходов ждут проверки организатора: {count}.",
  deviceRevoked: "Организатор отключил офлайн-проверку на этом телефоне.",
  uncertainOnline:
    "Проверок без ответа сервера: {count}. Отсканируйте тот же билет, когда появится интернет.",
  searchGuests: "Поиск по имени",
  noGuests: "Гости не найдены.",
  guestsError: "Не удалось загрузить гостей. Попробуйте ещё раз.",
  savedListNote:
    "Из списка, сохранённого в {time}. Чтобы знать точно, отсканируйте билет.",
  notIn: "Ещё не пришёл",
  checkedIn: "Прошёл",
  statusCancelled: "Отменён",
  statusRefunded: "Возвращён",
  statusBlocked: "Заблокирован",
  seat: "Сектор {section} · Ряд {row} · Место {number}",
  accessibleSeat: "Доступное место",
  undoCheckIn: "Отменить проход",
  reason: "Почему отменяете?",
  cancel: "Отмена",
  undoneOnline: "Проход отменён. Гостя можно отметить снова.",
  undoUncertain: "Сервер не ответил. Нажмите «Повторить».",
  language: "Язык",
  signOut: "Выйти",
  signOutNote:
    "При выходе сохранённые списки гостей удаляются с телефона. Неотправленные проходы останутся заблокированными, пока вы снова не войдёте в этот аккаунт, но не дольше 7 дней.",
  signOutFailed:
    "Не удалось выйти. Подключитесь к интернету и повторите, прежде чем передать телефон другому человеку.",
  deviceLabel: "Телефон сканера elc",
}

const kk: Copy = {
  signInTitle: "Билет тексеру",
  signInIntro:
    "Іс-шара қызметкерлеріне арналған. Ұйымдастырушы іс-шараға қосқан аккаунтпен кіріңіз.",
  email: "Электрондық пошта",
  password: "Құпиясөз",
  signIn: "Кіру",
  or: "немесе",
  google: "Google арқылы кіру",
  webAccount: "Аккаунтыңыз жоқ па, әлде құпиясөзді ұмыттыңыз ба?",
  openWebsite: "elc-ті браузерде ашу",
  signInError: "Пошта немесе құпиясөз қате. Қайталап көріңіз.",
  verifyTitle: "Поштаңызды растаңыз",
  verifyBody:
    "Хаттағы сілтемені ашыңыз, содан кейін осында оралып, «Дайын» түймесін басыңыз.",
  verifyDone: "Дайын",
  online: "Желіде",
  offline: "Желі жоқ",
  account: "Аккаунт",
  eventsTitle: "Іс-шараларыңыз",
  eventsIntro: "Билет тексеретін іс-шараларыңыз.",
  noEvents:
    "Әзірге іс-шара жоқ. Ұйымдастырушыдан сізді іс-шара командасына қосуды сұраңыз.",
  offlineEvents:
    "Интернет жоқ. Қонақтар тізімі осы телефонда сақталған іс-шаралар көрсетілген.",
  noSavedEvents: "Интернет жоқ, ал телефонда сақталған қонақтар тізімі жоқ.",
  loadError: "Іс-шаралар жүктелмеді. Қайталау үшін экранды төмен тартыңыз.",
  more: "Тағы көрсету",
  live: "Қазір өтіп жатыр",
  today: "Бүгін",
  ended: "Аяқталды",
  cancelled: "Болдырылмады",
  suspended: "Уақытша тоқтатылды",
  checkedInOf: "Кірді: {checked} / {total}",
  savedOffline: "Офлайн сақталған",
  back: "Іс-шаралар",
  scanTab: "Сканер",
  guestsTab: "Қонақтар",
  needsReview: "Ұйымдастырушының тексеруін күтетін офлайн кірулер: {count}.",
  cameraTitle: "Камераға рұқсат беріңіз",
  cameraBody: "Камера әр билеттегі QR кодты оқиды.",
  allowCamera: "Камераға рұқсат беру",
  cameraDenied: "Камераға рұқсат өшірулі. Оны Баптаулардан қосыңыз.",
  openSettings: "Баптауларды ашу",
  scanHint: "Камераны билеттің QR кодына бағыттаңыз",
  checking: "Тексеріліп жатыр…",
  endedNotice: "Іс-шара аяқталды. Билеттер енді тексерілмейді.",
  cancelledNotice: "Іс-шара болдырылмады. Ешкімді кіргізбеңіз.",
  suspendedNotice:
    "Іс-шара уақытша тоқтатылды. Не істеу керегін ұйымдастырушыдан сұраңыз.",
  noPermission:
    "Бұл іс-шарада билет тексеруге рұқсатыңыз жоқ. Оны ұйымдастырушыдан сұраңыз.",
  noConnection:
    "Интернет жоқ, ал бұл іс-шараның қонақтар тізімі телефонда сақталмаған.",
  letIn: "Кіргізуге болады",
  checkedInDone: "Билет белгіленді.",
  savedOnPhone: "Телефонда сақталды. Интернет қосылғанда жіберіледі.",
  alreadyUsed: "Билет пайдаланылған",
  alreadyUsedBody: "Бұл билетпен бұрын кірген. Қайта кіргізбеңіз.",
  invalid: "Билет жарамсыз",
  wrongEvent: "Билет басқа іс-шараға арналған",
  ticketCancelled: "Билеттің күші жойылған",
  ticketRefunded: "Билеттің ақшасы қайтарылған",
  blocked: "Кіруге тыйым салынған",
  forbidden: "Бұл іс-шараға рұқсат жоқ",
  snapshotExpired: "Сақталған тізімнің мерзімі өтті",
  locallyReversed: "Бұл телефонда кіру белгісі алынды",
  doNotAdmit: "Кіргізбеңіз.",
  notOnList: "Сақталған тізімде жоқ",
  notOnListBody: "Кіргізбеңіз. Интернет қосылғанда билетті қайта тексеріңіз.",
  clockChanged: "Телефон сағаты өзгертілген",
  clockChangedBody:
    "Желіге қосылып, қонақтар тізімін жаңартқанша офлайн тексеру өшірулі.",
  notTicket: "Бұл elc билеті емес",
  notTicketBody: "Бұл QR код билет емес. Іс-шара сілтемесімен кіруге болмайды.",
  noAnswer: "Сервер жауап бермеді",
  noAnswerBody:
    "Тексеру өтіп кетуі мүмкін. Нәтижесін білу үшін «Қайталау» түймесін басыңыз.",
  requestError: "Бірдеңе дұрыс болмады. Қайталап көріңіз.",
  localPending:
    "Бұл билет осы телефонда офлайн сканерленген, бірақ әлі жіберілмеген. Алдымен сақталған кірулерді жіберіңіз.",
  next: "Келесі билет",
  retry: "Қайталау",
  undo: "Бұл кіруді болдырмау",
  undoDone: "Кіру болдырылмады. Өзгеріс сақталған кірулермен бірге жіберіледі.",
  offlineTitle: "Интернетсіз де жұмыс істейді",
  offlineIntro:
    "Қонақтар тізімін телефонға сақтап қойыңыз. Интернет үзілсе де, билеттерді тексере бересіз, ал кірулер байланыс қалпына келгенде жіберіледі.",
  saveList: "Қонақтар тізімін сақтау",
  updateList: "Тізімді жаңарту",
  savedAt: "Сақталған уақыты: {time}. {until} дейін жарамды.",
  waiting: "Жіберуді күтіп тұр: {count}",
  sendNow: "Жіберу",
  listSaved: "Қонақтар тізімі сақталды.",
  sent: "Сақталған кірулер жіберілді.",
  offlineFailed:
    "Аяқтау мүмкін болмады. Кірулер телефонда сақтаулы. Интернет қосылғанда қайталаңыз.",
  offlineUnavailable: "Қолданбаның бұл нұсқасында офлайн режим жоқ.",
  offlineLocked:
    "Телефонда сақталған кірулерді жіберу үшін сол аккаунтқа кіріңіз.",
  oldScans:
    "Кейбір кірулер бір тәуліктен астам жіберілмей тұр. Оларды {date} дейін жіберіңіз, әйтпесе жойылады.",
  conflicts: "Ұйымдастырушының тексеруін күтетін кірулер: {count}.",
  deviceRevoked: "Ұйымдастырушы бұл телефонда офлайн тексеруді өшірді.",
  uncertainOnline:
    "Сервер жауап бермеген тексерулер: {count}. Интернет бар кезде сол билетті қайта сканерлеңіз.",
  searchGuests: "Аты бойынша іздеу",
  noGuests: "Қонақ табылмады.",
  guestsError: "Қонақтар жүктелмеді. Қайталап көріңіз.",
  savedListNote:
    "Сақталған тізім, уақыты: {time}. Нақты білу үшін билетті сканерлеңіз.",
  notIn: "Әлі келмеген",
  checkedIn: "Кірген",
  statusCancelled: "Күші жойылған",
  statusRefunded: "Ақшасы қайтарылған",
  statusBlocked: "Бұғатталған",
  seat: "Сектор {section} · {row}-қатар · {number}-орын",
  accessibleSeat: "Мүмкіндігі шектеулі жандарға арналған орын",
  undoCheckIn: "Кіруді болдырмау",
  reason: "Неге болдырмайсыз?",
  cancel: "Бас тарту",
  undoneOnline: "Кіру болдырылмады. Қонақты қайта белгілеуге болады.",
  undoUncertain: "Сервер жауап бермеді. «Қайталау» түймесін басыңыз.",
  language: "Тіл",
  signOut: "Шығу",
  signOutNote:
    "Шыққанда сақталған қонақтар тізімі телефоннан жойылады. Жіберілмеген кірулер осы аккаунтқа қайта кіргенше бұғатталып тұрады, бірақ 7 күннен аспайды.",
  signOutFailed:
    "Шығу мүмкін болмады. Телефонды басқа адамға бермес бұрын интернетке қосылып, қайталаңыз.",
  deviceLabel: "elc сканер телефоны",
}

export const copies: Record<Language, Copy> = { en, ru, kk }

export const languageNames: Record<Language, string> = {
  kk: "Қазақша",
  ru: "Русский",
  en: "English",
}

export const fill = (
  template: string,
  values: Record<string, string | number>
) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  )

export const intlLocale = (language: Language) =>
  language === "kk" ? "kk-KZ" : language === "ru" ? "ru-RU" : "en-GB"

export function eventWhen(
  event: Pick<ScannerEvent, "startsAt" | "timeZone">,
  language: Language
) {
  const options = { timeZone: event.timeZone }
  const start = new Date(event.startsAt)
  const day = new Intl.DateTimeFormat(intlLocale(language), {
    ...options,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(start)
  const time = new Intl.DateTimeFormat(intlLocale(language), {
    ...options,
    hour: "2-digit",
    minute: "2-digit",
  }).format(start)
  return `${day} · ${time}`
}
