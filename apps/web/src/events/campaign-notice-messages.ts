import { useEventText } from "./messages"

const messages = {
  checking: [
    "Науқан тексерілуде…",
    "Проверяем кампанию…",
    "Checking campaign…",
  ],
  title: ["Науқан шарттары", "Условия кампании", "Campaign terms"],
  eligible: ["Қолданылатын билеттер", "Применимые билеты", "Eligible tickets"],
  until: ["Аяқталуы", "Действует до", "Valid until"],
  final: [
    "Жеңілдік пен қолжетімділік брондау кезінде серверде қайта тексеріледі.",
    "Скидка и доступность будут повторно проверены сервером при бронировании.",
    "The server checks the final discount and availability when you reserve tickets.",
  ],
  invalid: [
    "Бұл науқан қазір қолжетімсіз. Кодты тексеріңіз немесе оны алып тастаңыз.",
    "Эта кампания сейчас недоступна. Проверьте код или уберите его.",
    "This campaign is unavailable. Check the code or remove it.",
  ],
  failed: [
    "Науқанды тексеру мүмкін болмады. Қайталап көріңіз.",
    "Не удалось проверить кампанию. Повторите попытку.",
    "The campaign could not be checked. Retry to check it.",
  ],
  clear: ["Кодты алып тастау", "Убрать код", "Remove code"],
  retry: ["Қайталап көру", "Повторить", "Retry"],
  subtotal: [
    "Науқан жеңілдігіне дейінгі сома",
    "Сумма до скидки по акции",
    "Subtotal before campaign discount",
  ],
} as const

export function useCampaignNoticeText() {
  const { locale } = useEventText()
  const index = locale === "kk" ? 0 : locale === "ru" ? 1 : 2
  return { t: (key: keyof typeof messages) => messages[key][index] }
}
