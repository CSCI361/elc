import { z } from "zod"
import { localeSchema, supportStatusSchema, type Locale } from "@elc/shared"

const utf8 = new TextEncoder()
function validText(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (code >= 0xd800 && code <= 0xdfff) return false
    if ([9, 10, 13].includes(code)) continue
    if (code < 32 || (code >= 127 && code <= 159)) return false
  }
  return true
}
const id = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) =>
      value === value.trim() &&
      value !== "." &&
      value !== ".." &&
      validText(value) &&
      !/\s/u.test(value)
  )
const title = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0 && validText(value))
const money = z.int().nonnegative()
const event = { eventId: id, eventTitle: title }
const ticketInput = z
  .strictObject({
    kind: z.literal("order.tickets"),
    ...event,
    orderId: id,
    amountMinor: money,
    ticketCount: z.int().min(1).max(100_000),
    attachmentCount: z.int().min(1).max(6),
    part: z.int().min(1),
    parts: z.int().min(1),
  })
  .superRefine((value, context) => {
    if (
      value.part > value.parts ||
      value.parts > value.ticketCount ||
      value.attachmentCount > value.ticketCount ||
      (value.parts === 1 && value.attachmentCount !== value.ticketCount) ||
      value.ticketCount > value.parts * 6 ||
      value.attachmentCount + value.parts - 1 > value.ticketCount ||
      value.ticketCount - value.attachmentCount > (value.parts - 1) * 6
    )
      context.addIssue({
        code: "custom",
        message:
          "Ticket attachment and message counts must describe one complete order delivery.",
      })
  })
const supportInput = z
  .strictObject({
    kind: z.literal("support.changed"),
    caseId: id,
    action: z.enum(["created", "message", "assignment", "status"]),
    status: supportStatusSchema.optional(),
  })
  .superRefine((value, context) => {
    if ((value.action === "status") !== (value.status !== undefined))
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Only a status-change notice includes the canonical status.",
      })
  })
const payoutInput = z
  .strictObject({
    kind: z.literal("payout.status"),
    ...event,
    status: z.enum(["completed", "adjusted", "held"]),
    amountMinor: z.int(),
  })
  .superRefine((value, context) => {
    if (
      (value.status === "adjusted" && value.amountMinor > 0) ||
      (value.status !== "adjusted" && value.amountMinor < 0)
    )
      context.addIssue({
        code: "custom",
        path: ["amountMinor"],
        message:
          "Payout amounts are nonnegative; linked refund adjustments are nonpositive.",
      })
  })
export const notificationInputSchema = z.discriminatedUnion("kind", [
  ticketInput,
  z.strictObject({
    kind: z.literal("payment.failed"),
    ...event,
    paymentAttemptId: id,
    amountMinor: money,
  }),
  z.strictObject({ kind: z.literal("event.updated"), ...event }),
  z.strictObject({ kind: z.literal("event.cancelled"), ...event }),
  z.strictObject({
    kind: z.literal("refund.completed"),
    ...event,
    paymentAttemptId: id,
    amountMinor: money,
  }),
  payoutInput,
  supportInput,
  z.strictObject({
    kind: z.literal("activation.completed"),
    ...event,
    feeMinor: money,
  }),
  z.strictObject({ kind: z.literal("order.cancelled"), ...event, orderId: id }),
])
export type NotificationInput = z.infer<typeof notificationInputSchema>
export type NotificationContext = Readonly<{
  appOrigin: string
  locale?: Locale | null
}>
export type NotificationText = Readonly<{ subject: string; text: string }>
export class NotificationTemplateError extends Error {
  constructor() {
    super("The canonical notification input is invalid.")
    this.name = "NotificationTemplateError"
  }
}
export function notificationLocale(value: unknown): Locale {
  const parsed = localeSchema.safeParse(value)
  return parsed.success ? parsed.data : "kk"
}
function localHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]")
    return true
  const octets = host.split(".").map(Number)
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  )
    return false
  return (
    octets[0] === 127 ||
    octets[0] === 10 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
  )
}
function appOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (
      (value !== url.origin && value !== `${url.origin}/`) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && localHost(url.hostname)))
    )
      return null
    return url.origin
  } catch {
    return null
  }
}
const contextSchema = z.strictObject({
  appOrigin: z
    .string()
    .max(2048)
    .refine((value) => appOrigin(value) !== null),
  locale: z.unknown().optional(),
})

/** BigInt quotient/remainder preserves every minor unit even at Number.MAX_SAFE_INTEGER. */
export function formatNotificationKzt(minor: number, locale: Locale): string {
  if (!Number.isSafeInteger(minor)) throw new NotificationTemplateError()
  const language = notificationLocale(locale)
  const value = BigInt(minor)
  const absolute = value < 0n ? -value : value
  const whole = new Intl.NumberFormat(
    language === "kk" ? "kk-KZ" : language === "ru" ? "ru-RU" : "en-GB",
    { maximumFractionDigits: 0 }
  ).format(absolute / 100n)
  return `${value < 0n ? "-" : ""}${whole}${language === "en" ? "." : ","}${String(absolute % 100n).padStart(2, "0")} KZT`
}
const english = {
  demo: "elc academic demo.",
  sandbox: "This is a sandbox transaction. No real money is transferred.",
  payoutDemo: "This payout is a simulation. No bank transfer is made.",
  event: "Event",
  account:
    "Sign in with the account that owns this order to view its current status and tickets:",
  payment: "Sign in to view the payment and refund status:",
  organizer: "Sign in to review the event's current settings:",
  eventLink: "Open the event page. Sign in if access is required:",
  calendar: "After signing in, download the updated calendar file here:",
  calendarNote:
    "Calendar imports may create a separate entry. Replace the earlier entry if your calendar does not update it automatically.",
  orderSubject: "Your tickets",
  failedSubject: "Payment attempt failed",
  updatedSubject: "Event details updated",
  cancelledSubject: "Event cancelled",
  refundSubject: "Sandbox refund confirmed",
  payoutSubject: "Simulated payout update",
  supportSubject: "Support case updated",
  activationSubject: "Paid-event activation completed",
  orderCancelledSubject: "Order cancelled",
  orderConfirmed: "Your order is confirmed.",
  free: "Registration is free.",
  total: "The sandbox order total is",
  failure:
    "The sandbox payment attempt did not complete. Review its status before starting another attempt.",
  attempted: "The attempted amount was",
  eventUpdated:
    "The organizer has updated this event. Review the current details before attending.",
  eventCancelled:
    "This event has been cancelled. Its tickets can no longer be used for admission. Refund progress, where applicable, is tracked separately in your account.",
  refunded: "The sandbox refund was confirmed for",
  activated:
    "Paid-event activation was completed for this event. Check the current settings for its present sales eligibility.",
  activationFee: "The confirmed sandbox activation fee was",
  orderCancelled:
    "Your order has been cancelled. Its tickets are no longer valid. Check your account for any separate refund status.",
  payoutCompleted: "A simulated payout was recorded for",
  payoutAdjusted: "A refund changed the simulated payout balance by",
  payoutHeld: "The simulated amount currently on hold is",
  payoutLink: "Sign in to view the simulated payout ledger:",
  supportCreated: "A support case has been opened.",
  supportMessage: "A new reply has been saved in the support case.",
  supportAssignment: "The support case's assignment has changed.",
  supportStatus: "The support case status is now",
  supportLink: "Sign in to read the case and respond:",
  statuses: {
    open: "open",
    in_progress: "in progress",
    waiting_for_customer: "waiting for the customer's reply",
    resolved: "resolved",
  },
}
type Messages = typeof english
const russian: Messages = {
  demo: "Учебная демонстрация elc.",
  sandbox: "Это тестовая операция. Реальные деньги не переводятся.",
  payoutDemo: "Эта выплата смоделирована. Банковского перевода нет.",
  event: "Мероприятие",
  account:
    "Войдите в аккаунт, которому принадлежит заказ, чтобы посмотреть его текущий статус и билеты:",
  payment: "Войдите, чтобы проверить статус платежа и возврата:",
  organizer: "Войдите, чтобы проверить текущие настройки мероприятия:",
  eventLink:
    "Откройте страницу мероприятия. Войдите, если для доступа нужен аккаунт:",
  calendar: "После входа скачайте обновлённый файл календаря:",
  calendarNote:
    "Импорт может создать отдельную запись. Замените прежнюю запись, если календарь не обновляет её автоматически.",
  orderSubject: "Ваши билеты",
  failedSubject: "Платёж не завершён",
  updatedSubject: "Данные мероприятия изменены",
  cancelledSubject: "Мероприятие отменено",
  refundSubject: "Тестовый возврат подтверждён",
  payoutSubject: "Изменение смоделированной выплаты",
  supportSubject: "Обновление обращения в поддержку",
  activationSubject: "Активация платного мероприятия завершена",
  orderCancelledSubject: "Заказ отменён",
  orderConfirmed: "Ваш заказ подтверждён.",
  free: "Регистрация бесплатная.",
  total: "Тестовая сумма заказа составляет",
  failure:
    "Тестовый платёж не завершён. Проверьте его статус перед новой попыткой оплаты.",
  attempted: "Сумма попытки оплаты составляет",
  eventUpdated:
    "Организатор изменил данные мероприятия. Перед посещением проверьте актуальную информацию.",
  eventCancelled:
    "Мероприятие отменено. Билеты больше не дают права на вход. Если предусмотрен возврат, его ход отражается отдельно в вашем аккаунте.",
  refunded: "Тестовый возврат подтверждён на сумму",
  activated:
    "Активация платного мероприятия завершена. Проверьте в настройках, доступны ли продажи сейчас.",
  activationFee: "Подтверждённый тестовый сбор за активацию составил",
  orderCancelled:
    "Ваш заказ отменён. Его билеты больше не действуют. Статус возможного возврата указан отдельно в аккаунте.",
  payoutCompleted: "Смоделированная выплата записана на сумму",
  payoutAdjusted: "Возврат изменил баланс смоделированной выплаты на",
  payoutHeld: "Сейчас удерживается смоделированная сумма",
  payoutLink: "Войдите, чтобы посмотреть журнал смоделированных выплат:",
  supportCreated: "Создано обращение в поддержку.",
  supportMessage: "В обращении сохранён новый ответ.",
  supportAssignment: "Назначение ответственного за обращение изменено.",
  supportStatus: "Текущий статус обращения:",
  supportLink: "Войдите, чтобы прочитать обращение и ответить:",
  statuses: {
    open: "открыто",
    in_progress: "в работе",
    waiting_for_customer: "ожидает ответа клиента",
    resolved: "решено",
  },
}
const kazakh: Messages = {
  demo: "elc оқу демонстрациясы.",
  sandbox: "Бұл сынақ операциясы. Нақты ақша аударылмайды.",
  payoutDemo: "Бұл төлем үлгіленген. Банк аударымы жасалмайды.",
  event: "Іс-шара",
  account:
    "Тапсырыстың ағымдағы күйі мен билеттерін көру үшін оған тиесілі аккаунтқа кіріңіз:",
  payment: "Төлем мен қайтарымның күйін көру үшін аккаунтқа кіріңіз:",
  organizer: "Іс-шараның ағымдағы баптауларын көру үшін аккаунтқа кіріңіз:",
  eventLink:
    "Іс-шараның бетін ашыңыз. Қолжетімділік үшін қажет болса, аккаунтқа кіріңіз:",
  calendar:
    "Аккаунтқа кіргеннен кейін күнтізбенің жаңартылған файлын жүктеңіз:",
  calendarNote:
    "Импорт бөлек жазба жасауы мүмкін. Күнтізбе оны автоматты түрде жаңартпаса, бұрынғы жазбаны ауыстырыңыз.",
  orderSubject: "Билеттеріңіз",
  failedSubject: "Төлем аяқталмады",
  updatedSubject: "Іс-шара деректері жаңартылды",
  cancelledSubject: "Іс-шара тоқтатылды",
  refundSubject: "Сынақ қайтарымы расталды",
  payoutSubject: "Үлгіленген төлем жаңарды",
  supportSubject: "Қолдау өтініші жаңартылды",
  activationSubject: "Ақылы іс-шара белсендірілді",
  orderCancelledSubject: "Тапсырыс тоқтатылды",
  orderConfirmed: "Тапсырысыңыз расталды.",
  free: "Тіркелу тегін.",
  total: "Тапсырыстың сынақ сомасы:",
  failure:
    "Сынақ төлемі аяқталмады. Қайта төлем жасамас бұрын оның күйін тексеріңіз.",
  attempted: "Төлем әрекетінің сомасы:",
  eventUpdated:
    "Ұйымдастырушы іс-шара деректерін өзгертті. Келмес бұрын жаңартылған ақпаратты тексеріңіз.",
  eventCancelled:
    "Іс-шара тоқтатылды. Билеттер енді кіруге құқық бермейді. Қайтарым көзделген болса, оның барысы аккаунтта бөлек көрсетіледі.",
  refunded: "Сынақ қайтарымы расталған сома:",
  activated:
    "Ақылы іс-шара белсендірілді. Қазір сатылымға рұқсат бар-жоғын баптаулардан тексеріңіз.",
  activationFee: "Расталған сынақ белсендіру алымы:",
  orderCancelled:
    "Тапсырысыңыз тоқтатылды. Оның билеттері енді жарамсыз. Қайтарым болса, оның күйі аккаунтта бөлек көрсетіледі.",
  payoutCompleted: "Үлгіленген төлем тіркелген сома:",
  payoutAdjusted: "Қайтарымнан кейін үлгіленген төлем теңгерімінің өзгерісі:",
  payoutHeld: "Қазір ұсталып тұрған үлгіленген сома:",
  payoutLink: "Үлгіленген төлемдер журналын көру үшін аккаунтқа кіріңіз:",
  supportCreated: "Қолдау қызметіне өтініш ашылды.",
  supportMessage: "Өтініште жаңа жауап сақталды.",
  supportAssignment: "Өтінішке жауапты маман өзгерді.",
  supportStatus: "Өтініштің ағымдағы күйі:",
  supportLink: "Өтінішті оқып, жауап беру үшін аккаунтқа кіріңіз:",
  statuses: {
    open: "ашық",
    in_progress: "қарастырылуда",
    waiting_for_customer: "клиенттің жауабын күтуде",
    resolved: "шешілді",
  },
}
const messages: Record<Locale, Messages> = {
  kk: kazakh,
  ru: russian,
  en: english,
}
function russianNumber(
  count: number,
  one: string,
  few: string,
  many: string
): string {
  const last = count % 10,
    lastTwo = count % 100
  return last === 1 && lastTwo !== 11
    ? one
    : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)
      ? few
      : many
}
function ticketSentences(
  input: Extract<NotificationInput, { kind: "order.tickets" }>,
  locale: Locale
): string {
  if (locale === "kk")
    return `Тапсырысыңызда ${input.ticketCount} билет бар. Бұл хатқа ${input.attachmentCount} билеттің PDF файлы тіркелген. Бұл ${input.parts} хаттың ішіндегі ${input.part}-нөмірлі хат.`
  if (locale === "ru")
    return `В заказе ${input.ticketCount} ${russianNumber(input.ticketCount, "билет", "билета", "билетов")}. Это письмо содержит ${input.attachmentCount} ${russianNumber(input.attachmentCount, "PDF-файл", "PDF-файла", "PDF-файлов")} с билетами. Это письмо ${input.part} из ${input.parts} по одному заказу.`
  return `Your order contains ${input.ticketCount} ${input.ticketCount === 1 ? "ticket" : "tickets"}. This email contains ${input.attachmentCount} ticket ${input.attachmentCount === 1 ? "PDF" : "PDFs"}. This is message ${input.part} of ${input.parts} for this order.`
}
function safeSubject(prefix: string, eventTitle?: string): string {
  const normalized = (eventTitle ?? "").replace(/\s+/gu, " ").trim()
  const value = normalized ? `${prefix}: ${normalized}` : prefix
  if (value.length <= 200) return value
  // Bound UTF-16 length to the transport's limit without splitting a surrogate pair.
  let result = ""
  for (const character of value) {
    if (result.length + character.length > 197) return `${result}...`
    result += character
  }
  return result
}

/** Pure text rendering. All links are generated from a validated application origin and encoded IDs. */
export function renderNotification(
  raw: NotificationInput,
  rawContext: NotificationContext
): NotificationText {
  const parsed = notificationInputSchema.safeParse(raw)
  const context = contextSchema.safeParse(rawContext)
  if (!parsed.success || !context.success) throw new NotificationTemplateError()
  const input = parsed.data
  const locale = notificationLocale(context.data.locale)
  const t = messages[locale]
  const origin = appOrigin(context.data.appOrigin)!
  const link = (...segments: string[]) =>
    `${origin}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`
  const amount = (minor: number) => formatNotificationKzt(minor, locale)
  let subject: string, body: string[]
  if (input.kind === "support.changed") {
    subject = safeSubject(t.supportSubject)
    const action =
      input.action === "created"
        ? t.supportCreated
        : input.action === "message"
          ? t.supportMessage
          : input.action === "assignment"
            ? t.supportAssignment
            : `${t.supportStatus} ${t.statuses[input.status!]}.`
    body = [
      action,
      `${t.supportLink}\n${link("support", "cases", input.caseId)}`,
    ]
  } else {
    const eventLine = `${t.event}:\n${input.eventTitle}`
    const eventUrl = link("events", input.eventId)
    const calendarUrl = `${link("api", "events", input.eventId, "calendar.ics")}?locale=${locale}`
    switch (input.kind) {
      case "order.tickets":
        subject = safeSubject(t.orderSubject, input.eventTitle)
        body = [
          t.orderConfirmed,
          eventLine,
          ticketSentences(input, locale),
          input.amountMinor
            ? `${t.total} ${amount(input.amountMinor)}.`
            : t.free,
          ...(input.amountMinor ? [t.sandbox] : []),
          `${t.account}\n${link("orders", input.orderId)}`,
        ]
        break
      case "payment.failed":
        subject = safeSubject(t.failedSubject, input.eventTitle)
        body = [
          t.failure,
          eventLine,
          `${t.attempted} ${amount(input.amountMinor)}.`,
          t.sandbox,
          `${t.payment}\n${link("payments", input.paymentAttemptId)}`,
        ]
        break
      case "event.updated":
        subject = safeSubject(t.updatedSubject, input.eventTitle)
        body = [
          t.eventUpdated,
          eventLine,
          `${t.eventLink}\n${eventUrl}`,
          `${t.calendar}\n${calendarUrl}`,
          t.calendarNote,
        ]
        break
      case "event.cancelled":
        subject = safeSubject(t.cancelledSubject, input.eventTitle)
        body = [
          t.eventCancelled,
          eventLine,
          `${t.eventLink}\n${eventUrl}`,
          `${t.calendar}\n${calendarUrl}`,
          t.calendarNote,
        ]
        break
      case "refund.completed":
        subject = safeSubject(t.refundSubject, input.eventTitle)
        body = [
          `${t.refunded} ${amount(input.amountMinor)}.`,
          eventLine,
          t.sandbox,
          `${t.payment}\n${link("payments", input.paymentAttemptId)}`,
        ]
        break
      case "payout.status":
        subject = safeSubject(t.payoutSubject, input.eventTitle)
        body = [
          `${input.status === "completed" ? t.payoutCompleted : input.status === "adjusted" ? t.payoutAdjusted : t.payoutHeld} ${amount(input.amountMinor)}.`,
          eventLine,
          t.payoutDemo,
          `${t.payoutLink}\n${link("organizer", "events", input.eventId, "payouts")}`,
        ]
        break
      case "activation.completed":
        subject = safeSubject(t.activationSubject, input.eventTitle)
        body = [
          t.activated,
          eventLine,
          `${t.activationFee} ${amount(input.feeMinor)}.`,
          t.sandbox,
          `${t.organizer}\n${link("organizer", "events", input.eventId)}`,
        ]
        break
      case "order.cancelled":
        subject = safeSubject(t.orderCancelledSubject, input.eventTitle)
        body = [
          t.orderCancelled,
          eventLine,
          `${t.account}\n${link("orders", input.orderId)}`,
        ]
        break
    }
  }
  const text = [t.demo, ...body].join("\n\n")
  if (subject.length > 200 || utf8.encode(text).length > 64 * 1024)
    throw new NotificationTemplateError()
  return Object.freeze({ subject, text })
}
