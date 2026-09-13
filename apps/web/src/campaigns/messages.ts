import { useEventText } from "../events/messages"

const messages = {
  title: ["Науқандар", "Кампании", "Campaigns"],
  back: ["Іс-шараны өңдеу", "Редактировать событие", "Edit event"],
  create: [
    "Өшірулі науқан жасау",
    "Создать выключенную кампанию",
    "Create disabled campaign",
  ],
  intro: [
    "Науқан өшірулі күйде жасалады. Шарттарын тексеріп, оны бөлек қосыңыз.",
    "Кампания создаётся выключенной. Проверьте условия и включите её отдельно.",
    "Campaigns are created disabled. Review the terms, then enable them separately.",
  ],
  name: ["Науқан атауы", "Название кампании", "Campaign name"],
  kind: ["Жеңілдік түрі", "Тип скидки", "Discount type"],
  percentage: ["Пайыз", "Процент", "Percentage"],
  fixed: [
    "Тұрақты сома (KZT)",
    "Фиксированная сумма (KZT)",
    "Fixed amount (KZT)",
  ],
  amount: ["Жеңілдік", "Скидка", "Discount"],
  percentHint: [
    "1–100%, үтірден кейін 2 таңбаға дейін.",
    "1–100%, до 2 знаков после запятой.",
    "1–100%, with up to 2 decimal places.",
  ],
  fixedHint: [
    "Кемінде 0,01 KZT, үтірден кейін 2 таңбаға дейін.",
    "Не менее 0,01 KZT, до 2 знаков после запятой.",
    "At least 0.01 KZT, with up to 2 decimal places.",
  ],
  limit: ["Қолдану шегі", "Лимит применений", "Redemption limit"],
  limitHint: [
    "Оң бүтін сан. Әдепкіде 100.",
    "Положительное целое число. По умолчанию 100.",
    "A positive whole number. Defaults to 100.",
  ],
  starts: ["Басталуы", "Начало", "Starts"],
  ends: ["Аяқталуы", "Окончание", "Ends"],
  types: [
    "Қолданылатын билет түрлері",
    "Применимые типы билетов",
    "Applicable ticket types",
  ],
  noTypes: [
    "Алдымен іс-шараға билет түрлерін қосыңыз.",
    "Сначала добавьте типы билетов в событие.",
    "Add ticket types to the event first.",
  ],
  invalid: [
    "Атауын, жеңілдік шегін, оң бүтін лимитті, күндерді және кемінде бір билет түрін тексеріңіз. Аяқталуы басталуынан кейін болуы керек.",
    "Проверьте название, размер скидки, положительный целый лимит, даты и хотя бы один тип билета. Окончание должно быть позже начала.",
    "Check the name, discount limits, positive whole redemption limit, dates, and at least one ticket type. The end must follow the start.",
  ],
  enabled: ["Қосулы", "Включена", "Enabled"],
  disabled: ["Өшірулі", "Выключена", "Disabled"],
  upcoming: ["Әлі басталған жоқ", "Ещё не началась", "Not started"],
  open: ["Мерзімі ашық", "Период действия открыт", "Within validity window"],
  expired: ["Мерзімі аяқталды", "Срок истёк", "Expired"],
  review: ["Тексеру және бөлісу", "Проверить и поделиться", "Review and share"],
  enable: [
    "Шарттарды тексердім, қосу",
    "Условия проверены, включить",
    "Terms reviewed, enable",
  ],
  disable: ["Науқанды өшіру", "Выключить кампанию", "Disable campaign"],
  empty: ["Әзірге науқан жоқ.", "Кампаний пока нет.", "No campaigns yet."],
  previous: ["Алдыңғы бет", "Предыдущая страница", "Previous page"],
  next: ["Келесі бет", "Следующая страница", "Next page"],
  page: ["Бет", "Страница", "Page"],
  busy: ["Сақталуда…", "Сохранение…", "Saving…"],
  saved: [
    "Сақталды. Қосу алдында науқан шарттарын тексеріңіз.",
    "Сохранено. Перед включением проверьте условия кампании.",
    "Saved. Review the campaign terms before enabling.",
  ],
  changed: [
    "Іс-шара өзгерді. Жаңа әрекет алдында ағымдағы нұсқаны жүктеңіз. Жауабы белгісіз сұрауды сол батырмамен қайталауға болады.",
    "Событие изменилось. Загрузите текущую версию перед новым действием. Запрос с неизвестным результатом можно повторить той же кнопкой.",
    "The event changed. Load the current version before a new action. You can retry an uncertain request with the same button.",
  ],
  refresh: [
    "Ағымдағы нұсқаны жүктеу",
    "Загрузить текущую версию",
    "Load current version",
  ],
  readOnly: [
    "Іс-шара тоқтатылған. Науқан шарттарын тек қарауға болады.",
    "Событие отменено. Условия кампаний доступны только для просмотра.",
    "This event is cancelled. Campaign terms are read-only.",
  ],
  qr: ["Науқан QR коды", "QR-код кампании", "Campaign QR"],
  promotion: ["Жеңілдік науқаны", "Промокампания", "Promotional campaign"],
  notTicket: [
    "Бұл кіру билеті емес",
    "Это не входной билет",
    "Not an admission ticket",
  ],
  qrHint: [
    "Бұл код науқан бар іс-шара бетін ашады. Кіру үшін сатып алған билетті қолданыңыз.",
    "Код открывает страницу события с кампанией. Для входа используйте купленный билет.",
    "This code opens the event with the campaign. Use your purchased ticket for admission.",
  ],
  showQr: ["QR кодты көрсету", "Показать QR-код", "Show campaign QR"],
  download: [
    "Науқан QR кодын жүктеу (SVG)",
    "Скачать QR-код кампании (SVG)",
    "Download campaign QR (SVG)",
  ],
  copy: ["Сілтемені көшіру", "Скопировать ссылку", "Copy link"],
  copied: ["Сілтеме көшірілді.", "Ссылка скопирована.", "Link copied."],
  copyFailed: [
    "Автоматты көшіру орындалмады. Төмендегі сілтемені таңдап, көшіріңіз.",
    "Автоматическое копирование не удалось. Выделите и скопируйте ссылку ниже.",
    "Automatic copying failed. Select and copy the link below.",
  ],
  unsafe: [
    "Науқан сілтемесі осы сайттың қауіпсіз мекенжайына сәйкес келмейді. QR код жасау мүмкін емес.",
    "Ссылка кампании не соответствует безопасному адресу этого сайта. QR-код недоступен.",
    "The campaign link does not match this site's secure address. QR generation is unavailable.",
  ],
  local: [
    "Жергілікті әзірлеу ғана: HTTP сілтемесі басқа құрылғыда жұмыс істемейді.",
    "Только локальная разработка: HTTP-ссылка не работает на другом устройстве.",
    "Local development only: this HTTP link will not work on another device.",
  ],
  inactiveHint: [
    "Өшірулі немесе мерзімі жабық науқан жеңілдік бермейді.",
    "Выключенная кампания или закрытый период действия не дают скидку.",
    "A disabled campaign or closed validity window does not grant a discount.",
  ],
  link: ["Науқан сілтемесі", "Ссылка кампании", "Campaign link"],
  code: ["Науқан коды", "Код кампании", "Campaign code"],
} as const

export type CampaignMessage = keyof typeof messages
export function useCampaignText() {
  const { locale } = useEventText()
  const index = locale === "kk" ? 0 : locale === "ru" ? 1 : 2
  return { locale, t: (key: CampaignMessage) => messages[key][index] }
}
