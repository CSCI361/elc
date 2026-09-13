import type { Language } from "../copy"
const en = {
  pendingLocal:
    "A provisional admission is pending on this device. Synchronize it before scanning this ticket online.",
  duplicate:
    "This ticket is already admitted or awaiting confirmation. Do not admit it again.",
  uncertainOnline:
    "Unconfirmed online scans. Scan the same QR while connected to retry its original operation.",
  workspace: "Offline scanner",
  prepare: "Prepare or refresh offline snapshot",
  back: "Back",
  events: "Assigned events",
  refresh: "Refresh events",
  more: "More events",
  noEvents:
    "No usable snapshots are stored. Connect with your verified scanner account to prepare one.",
  online: "Connected. Scans require server confirmation.",
  offline:
    "Offline. Admissions are provisional until the server accepts the journal.",
  snapshot: "Snapshot",
  expires: "Expires",
  pending: "Pending uploads",
  provisional: "Provisional admissions",
  conflicts: "Conflicts requiring review",
  sync: "Sync pending scans",
  undo: "Undo this unsynced admission",
  undoDone:
    "Local admission undone. The scan and undo will be uploaded together.",
  provisionalResult: "Provisional admission recorded on this device",
  unknown: "Ticket is absent from the signed snapshot. Do not admit.",
  unavailable:
    "No usable offline snapshot. Connect and refresh before admitting anyone.",
  clockUnsafe:
    "The device clock moved backwards. Offline admission is disabled until a fresh authenticated snapshot is downloaded.",
  syncFailed:
    "Sync or refresh did not finish. Pending scans remain encrypted on this device. Retry when connected.",
  unavailableStorage:
    "Encrypted offline storage is unavailable. Use a SQLCipher-enabled development build and a configured public signing key.",
  deadline: "Unsynced data is deleted after seven days. Deletion deadline",
  warning:
    "Scans have waited more than 24 hours. Connect now to upload them before deletion.",
  retention:
    "Signing out removes attendee snapshots and locks the encrypted pending journal. Sign in online with this same account to recover it within seven days. Acknowledged scan data is deleted after 24 hours.",
  privacy:
    "Snapshot names and ticket hashes stay in encrypted storage. Raw QR credentials are never stored.",
  cached: "Continue with this device's current offline account",
  close: "Close offline workspace",
  account: "Offline account ID",
  search: "Search cached attendees",
  results: "Latest server results",
  label: "elc scanner device",
  locked:
    "Sign in online with the same verified account to recover the journal.",
  ready: "Verified snapshot saved. Pending journal preserved.",
  syncDone: "Sync cycle finished. Any remaining batches will be retried.",
  cancelled: "This event cannot admit attendees.",
  lastSync: "Last sync",
  offlineAttendees:
    "Cached attendee names. Admission status must be checked by scanning the ticket.",
  noMatches: "No matching attendee in this snapshot.",
}
type OfflineCopy = typeof en
const ru: OfflineCopy = {
  pendingLocal:
    "На устройстве есть предварительный проход. Синхронизируйте его перед онлайн-сканированием этого билета.",
  duplicate:
    "Этот билет уже использован или ожидает подтверждения. Не допускайте повторный проход.",
  uncertainOnline:
    "Неподтверждённые онлайн-сканы. Сканируйте тот же QR при подключении, чтобы повторить исходную операцию.",
  workspace: "Офлайн-сканер",
  prepare: "Подготовить или обновить офлайн-снимок",
  back: "Назад",
  events: "Назначенные мероприятия",
  refresh: "Обновить мероприятия",
  more: "Ещё",
  noEvents:
    "Нет доступного сохранённого снимка. Подключитесь с подтверждённым аккаунтом сканера, чтобы подготовить его.",
  online: "Есть подключение. Каждый проход подтверждает сервер.",
  offline:
    "Нет подключения. Проходы предварительные до принятия журнала сервером.",
  snapshot: "Снимок",
  expires: "Действует до",
  pending: "Ожидают отправки",
  provisional: "Предварительные проходы",
  conflicts: "Конфликты для проверки",
  sync: "Отправить накопленные сканы",
  undo: "Отменить этот неотправленный проход",
  undoDone: "Локальный проход отменён. Скан и отмена отправятся вместе.",
  provisionalResult: "Предварительный проход записан на этом устройстве",
  unknown: "Билета нет в подписанном снимке. Не пропускайте посетителя.",
  unavailable:
    "Нет пригодного офлайн-снимка. Подключитесь и обновите его до допуска посетителей.",
  clockUnsafe:
    "Часы устройства переведены назад. Офлайн-проход отключён до загрузки нового снимка после подтверждения аккаунта.",
  syncFailed:
    "Отправка или обновление не завершены. Сканы остаются зашифрованными на устройстве. Повторите при подключении.",
  unavailableStorage:
    "Зашифрованное офлайн-хранилище недоступно. Нужна сборка с SQLCipher и настроенным открытым ключом подписи.",
  deadline: "Неотправленные данные удаляются через семь дней. Крайний срок",
  warning:
    "Сканы ожидают более 24 часов. Подключитесь и отправьте их до удаления.",
  retention:
    "Выход удаляет снимки посетителей и блокирует зашифрованный журнал. Войдите онлайн в тот же аккаунт, чтобы восстановить его в течение семи дней. Подтверждённые данные сканов удаляются через 24 часа.",
  privacy:
    "Имена и хеши билетов хранятся зашифрованными. Исходные QR-данные не сохраняются.",
  cached: "Продолжить с текущим офлайн-аккаунтом устройства",
  close: "Закрыть офлайн-раздел",
  account: "ID офлайн-аккаунта",
  search: "Поиск в сохранённых посетителях",
  results: "Последние ответы сервера",
  label: "Устройство сканера elc",
  locked:
    "Войдите онлайн в тот же подтверждённый аккаунт, чтобы восстановить журнал.",
  ready: "Проверенный снимок сохранён. Журнал ожидающих сканов сохранён.",
  syncDone:
    "Цикл отправки завершён. Оставшиеся пакеты будут отправлены повторно.",
  cancelled: "На это мероприятие нельзя допускать посетителей.",
  lastSync: "Последняя отправка",
  offlineAttendees:
    "Сохранённые имена посетителей. Проверяйте право прохода сканированием билета.",
  noMatches: "В этом снимке нет подходящего посетителя.",
}
const kk: OfflineCopy = {
  pendingLocal:
    "Бұл құрылғыда алдын ала кіру бар. Билетті онлайн сканерлемес бұрын оны синхрондаңыз.",
  duplicate:
    "Бұл билет пайдаланылған немесе растауды күтуде. Қайта кіргізбеңіз.",
  uncertainOnline:
    "Расталмаған онлайн скандар. Бастапқы әрекетті қайталау үшін желіге қосылып, сол QR кодын сканерлеңіз.",
  workspace: "Офлайн сканер",
  prepare: "Офлайн көшірмені дайындау немесе жаңарту",
  back: "Артқа",
  events: "Тағайындалған іс-шаралар",
  refresh: "Іс-шараларды жаңарту",
  more: "Тағы",
  noEvents:
    "Жарамды сақталған көшірме жоқ. Оны дайындау үшін расталған сканер аккаунтымен желіге қосылыңыз.",
  online: "Желіге қосылған. Әр кіруді сервер растайды.",
  offline:
    "Желі жоқ. Сервер журналды қабылдағанға дейін кірулер алдын ала тіркеледі.",
  snapshot: "Көшірме",
  expires: "Жарамдылық мерзімі",
  pending: "Жіберілмеген скандар",
  provisional: "Алдын ала тіркелген кірулер",
  conflicts: "Тексеруді қажет ететін қайшылықтар",
  sync: "Жиналған скандарды жіберу",
  undo: "Осы жіберілмеген кіруді болдырмау",
  undoDone:
    "Жергілікті кіру болдырылмады. Скан мен болдырмау бірге жіберіледі.",
  provisionalResult: "Алдын ала кіру осы құрылғыға жазылды",
  unknown: "Билет қол қойылған көшірмеде жоқ. Келушіні кіргізбеңіз.",
  unavailable:
    "Жарамды офлайн көшірме жоқ. Келушілерді кіргізбес бұрын желіге қосылып, оны жаңартыңыз.",
  clockUnsafe:
    "Құрылғы сағаты артқа ауысты. Аккаунт расталып, жаңа көшірме жүктелгенше офлайн кіру өшірілді.",
  syncFailed:
    "Жіберу немесе жаңарту аяқталмады. Скандар құрылғыда шифрланып сақталады. Желіге қосылғанда қайталаңыз.",
  unavailableStorage:
    "Шифрланған офлайн сақтау қолжетімсіз. SQLCipher қосылған жинақ және бапталған ашық қолтаңба кілті қажет.",
  deadline: "Жіберілмеген деректер жеті күннен кейін жойылады. Соңғы мерзім",
  warning:
    "Скандар 24 сағаттан астам күтуде. Жойылмас бұрын желіге қосылып, жіберіңіз.",
  retention:
    "Шығу келушілер көшірмелерін жояды және шифрланған журналды бұғаттайды. Оны жеті күн ішінде қалпына келтіру үшін сол аккаунтқа онлайн кіріңіз. Расталған скан деректері 24 сағаттан кейін жойылады.",
  privacy:
    "Аттар мен билет хештері шифрланған сақтау орнында қалады. Бастапқы QR деректері сақталмайды.",
  cached: "Құрылғының ағымдағы офлайн аккаунтымен жалғастыру",
  close: "Офлайн бөлімді жабу",
  account: "Офлайн аккаунт ID",
  search: "Сақталған келушілерді іздеу",
  results: "Сервердің соңғы жауаптары",
  label: "elc сканер құрылғысы",
  locked:
    "Журналды қалпына келтіру үшін сол расталған аккаунтқа онлайн кіріңіз.",
  ready: "Тексерілген көшірме сақталды. Күтудегі журнал сақталды.",
  syncDone: "Жіберу айналымы аяқталды. Қалған топтамалар қайта жіберіледі.",
  cancelled: "Бұл іс-шараға келушілерді кіргізуге болмайды.",
  lastSync: "Соңғы жіберу",
  offlineAttendees:
    "Сақталған келушілер аттары. Кіру құқығын билетті сканерлеп тексеріңіз.",
  noMatches: "Бұл көшірмеде сәйкес келуші жоқ.",
}
export const offlineCopies: Record<Language, OfflineCopy> = { en, ru, kk }
export type { OfflineCopy }
