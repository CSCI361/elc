import type { Locale } from "@elc/shared"
import { EventApiError } from "../events/api"

const copy = {
  files: ["Файлдар", "Файлы", "Attachments"],
  choose: ["Файлдарды таңдау", "Выбрать файлы", "Choose files"],
  limits: [
    "JPEG, PNG немесе PDF. Әр файл 5 MiB дейін; бір хабарламада 3 файлға дейін.",
    "JPEG, PNG или PDF. До 5 MiB на файл и 3 файлов в сообщении.",
    "JPEG, PNG or PDF. Up to 5 MiB per file and 3 files per message.",
  ],
  private: [
    "Файлдар тек хабарлама жіберілгеннен кейін өтінішке қосылады. Жүктелген файлдар 23 сағаттан кейін жарамсыз болады.",
    "Файлы добавляются в обращение только после отправки сообщения. Загруженные файлы действуют 23 часа.",
    "Files join the conversation when the message is sent. Uploaded files expire after 23 hours.",
  ],
  limit: [
    "Бір хабарламаға 3 файл ғана қосуға болады. Артық файлдар жүктелмеді.",
    "В сообщении может быть только 3 файла. Лишние файлы не загружены.",
    "A message can contain only 3 files. Extra files were not uploaded.",
  ],
  uploading: [
    "Жүктеу және тексеру…",
    "Загрузка и проверка…",
    "Uploading and checking…",
  ],
  ready: ["Жіберуге дайын", "Готов к отправке", "Ready to send"],
  rejected: [
    "Файл қабылданбады. Оны алып тастап, басқа файл таңдаңыз.",
    "Файл отклонен. Удалите его и выберите другой.",
    "File rejected. Remove it and choose another file.",
  ],
  retry: ["Жүктеуді қайталау", "Повторить загрузку", "Retry upload"],
  remove: ["Алып тастау", "Удалить", "Remove"],
  removing: ["Алып тасталуда…", "Удаление…", "Removing…"],
  removeFailed: [
    "Файлды алып тастау расталмады. Қайталап көріңіз.",
    "Удаление файла не подтверждено. Повторите попытку.",
    "File removal was not confirmed. Try removing it again.",
  ],
  pendingFiles: [
    "Жібермес бұрын файлдардың тексерілуін күтіңіз немесе қабылданбаған файлдарды алып тастаңыз.",
    "Перед отправкой дождитесь проверки файлов или удалите отклоненные файлы.",
    "Wait for file checks or remove failed files before sending.",
  ],
  uncertain: [
    "Хабарламаның жіберілгені расталмады. Мәтін мен файлдар сақталды. Нәтижені тексеру үшін сол хабарламаны қайталаңыз.",
    "Отправка сообщения не подтверждена. Текст и файлы сохранены. Повторите то же сообщение, чтобы проверить результат.",
    "Message delivery was not confirmed. Your text and files are kept. Retry the same message to confirm its result.",
  ],
  retryMessage: [
    "Хабарламаны қайталау",
    "Повторить сообщение",
    "Retry message",
  ],
  download: ["Жүктеп алу", "Скачать", "Download"],
  downloading: ["Жүктеп алынуда…", "Скачивание…", "Downloading…"],
  expired: [
    "Файлдың мерзімі өтті. Оны алып тастап, қайта жүктеңіз.",
    "Срок файла истек. Удалите его и загрузите заново.",
    "This file expired. Remove it and upload it again.",
  ],
  FILE_TOO_LARGE: [
    "Файл 5 MiB-тан аспауы керек.",
    "Файл не должен превышать 5 MiB.",
    "The file must be at most 5 MiB.",
  ],
  FILE_TYPE_UNSUPPORTED: [
    "JPEG, PNG немесе PDF файлын таңдаңыз.",
    "Выберите файл JPEG, PNG или PDF.",
    "Choose a JPEG, PNG or PDF file.",
  ],
  FILE_TYPE_MISMATCH: [
    "Файлдың мазмұны көрсетілген түріне сәйкес келмейді.",
    "Содержимое файла не соответствует указанному типу.",
    "The file contents do not match its declared type.",
  ],
  FILE_INVALID: [
    "Сервер файлды оқи алмады. Жарамды JPEG, PNG немесе PDF таңдаңыз.",
    "Сервер не смог прочитать файл. Выберите корректный JPEG, PNG или PDF.",
    "The server could not read this file. Choose a valid JPEG, PNG or PDF.",
  ],
  FILE_COMPLEXITY_LIMIT: [
    "Файлды тексеру мүмкін емес: өлшемі немесе күрделілігі тым жоғары.",
    "Файл слишком сложный или имеет слишком большие размеры для проверки.",
    "The file is too complex or its dimensions are too large to inspect.",
  ],
  PDF_UNSAFE: [
    "PDF ішінде шифрлау немесе рұқсат етілмеген белсенді мазмұн бар.",
    "PDF содержит шифрование или запрещенное активное содержимое.",
    "The PDF contains encryption or disallowed active content.",
  ],
  PDF_UNSUPPORTED: [
    "Бұл PDF құрылымын тексеру мүмкін емес. Басқа файл таңдаңыз.",
    "Эту структуру PDF невозможно проверить. Выберите другой файл.",
    "This PDF structure cannot be inspected. Choose another file.",
  ],
  failure: [
    "Файл операциясы аяқталмады. Қайта көріңіз.",
    "Операция с файлом не завершена. Повторите попытку.",
    "The file operation did not finish. Try again.",
  ],
} satisfies Record<string, readonly [string, string, string]>
export type AttachmentTextKey = keyof typeof copy
export function attachmentSize(locale: Locale, bytes: number) {
  const unit = bytes < 1024 ? "B" : bytes < 1048576 ? "KiB" : "MiB"
  const value = bytes / (unit === "B" ? 1 : unit === "KiB" ? 1024 : 1048576)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)} ${unit}`
}
export function attachmentText(locale: Locale, key: AttachmentTextKey) {
  return copy[key][locale === "kk" ? 0 : locale === "ru" ? 1 : 2]
}
export function attachmentErrorKey(
  error: unknown,
  code?: string | null
): AttachmentTextKey {
  if (
    (code && Object.hasOwn(copy, code) && code.startsWith("FILE_")) ||
    code === "PDF_UNSAFE" ||
    code === "PDF_UNSUPPORTED"
  )
    return code as AttachmentTextKey
  if (error instanceof EventApiError && error.status === 413)
    return "FILE_TOO_LARGE"
  if (error instanceof EventApiError && error.status === 400)
    return "FILE_INVALID"
  return "failure"
}
