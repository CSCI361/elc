import type { Locale } from "@elc/shared"

export type LegalPage = "privacy" | "terms"

interface LegalSection {
  heading: string
  body: readonly string[]
}

interface LegalDocument {
  title: string
  updated: string
  intro: string
  sections: readonly LegalSection[]
}

const updated: Record<Locale, string> = {
  kk: "Жаңартылған күні: 2026 жылғы 21 қараша",
  ru: "Обновлено: 21 ноября 2026 г.",
  en: "Updated 21 November 2026",
}

const labels: Record<LegalPage, Record<Locale, string>> = {
  privacy: { kk: "Құпиялылық", ru: "Конфиденциальность", en: "Privacy" },
  terms: { kk: "Пайдалану шарттары", ru: "Условия", en: "Terms" },
}

const privacy: Record<Locale, Omit<LegalDocument, "updated">> = {
  en: {
    title: "Privacy policy",
    intro:
      "This page explains what information elc collects when you use the website and the check-in app, why we need it and who can see it.",
    sections: [
      {
        heading: "What we collect",
        body: [
          "Account: your name, email address and language. Your password is never stored as plain text, only as a secure hash.",
          "Google sign-in: if you choose it, Google shares your name, email address and profile picture with us.",
          "Orders and tickets: the events you register for, the attendee names you enter, your tickets and your check-ins.",
          "Organizer profile: contact details, legal name and payout reference.",
          "Support: the messages and files you send in a support case.",
          "Security: your active sign-in sessions with their IP address and browser.",
        ],
      },
      {
        heading: "Payments",
        body: [
          "Payments go through our payment provider, Polar. We never see or store your card details.",
        ],
      },
      {
        heading: "Why we use it",
        body: [
          "To run your account, issue and check tickets, help organizers manage their events, answer support requests, send emails about your account and tickets, and keep elc secure.",
        ],
      },
      {
        heading: "Who can see it",
        body: [
          "Organizers and the staff they assign see attendee, order and check-in details for their own events only. elc staff see what they need for moderation and support.",
          "These services help us run elc: Cloudflare for hosting and storage, Resend for email, Polar for payments, and Google for sign-in and, only if you allow it, analytics. We do not sell your data.",
        ],
      },
      {
        heading: "Cookies and analytics",
        body: [
          "Cookies keep you signed in and remember your choices. Google Analytics starts only after you allow it in Cookie settings, and you can turn it off there at any time.",
        ],
      },
      {
        heading: "How long we keep it",
        body: [
          "Events, orders, tickets, check-ins and support cases: 180 days after the event ends or is cancelled.",
          "Accounts with no activity: 180 days after the last sign-in.",
          "Server logs and backups: 30 days.",
        ],
      },
      {
        heading: "Your choices",
        body: [
          "On the Account page you can change your name and language and sign out of other devices. To get a copy of your data or have it deleted, write to us through Support.",
        ],
      },
      {
        heading: "Changes",
        body: [
          "When this policy changes, we update this page and the date at the top.",
        ],
      },
    ],
  },
  ru: {
    title: "Политика конфиденциальности",
    intro:
      "Здесь объясняется, какие данные собирает elc, когда вы пользуетесь сайтом и приложением для проверки билетов, зачем они нужны и кто их видит.",
    sections: [
      {
        heading: "Какие данные мы собираем",
        body: [
          "Аккаунт: имя, адрес электронной почты и язык. Пароль не хранится в открытом виде, только как защищённый хеш.",
          "Вход через Google: если вы его выбираете, Google передаёт нам ваше имя, адрес почты и фото профиля.",
          "Заказы и билеты: события, на которые вы регистрируетесь, имена участников, которые вы указываете, ваши билеты и отметки о входе.",
          "Профиль организатора: контактные данные, юридическое имя и реквизит для выплат.",
          "Поддержка: сообщения и файлы, которые вы отправляете в обращениях.",
          "Безопасность: активные сеансы входа с их IP-адресом и браузером.",
        ],
      },
      {
        heading: "Платежи",
        body: [
          "Платежи проходят через платёжный сервис Polar. Мы не видим и не храним данные вашей карты.",
        ],
      },
      {
        heading: "Зачем они нужны",
        body: [
          "Чтобы работал ваш аккаунт, выдавать и проверять билеты, помогать организаторам вести события, отвечать на обращения, присылать письма об аккаунте и билетах и защищать elc.",
        ],
      },
      {
        heading: "Кто их видит",
        body: [
          "Организаторы и назначенные ими сотрудники видят участников, заказы и отметки о входе только своих событий. Сотрудники elc видят то, что нужно для модерации и поддержки.",
          "Для работы elc мы пользуемся сервисами: Cloudflare — хостинг и хранение данных, Resend — письма, Polar — платежи, Google — вход и, только с вашего согласия, аналитика. Мы не продаём ваши данные.",
        ],
      },
      {
        heading: "Cookie и аналитика",
        body: [
          "Cookie нужны, чтобы вы оставались в аккаунте, а сайт помнил ваш выбор. Google Analytics включается только после вашего согласия в настройках cookie, и там же его можно отключить в любой момент.",
        ],
      },
      {
        heading: "Сколько хранятся данные",
        body: [
          "События, заказы, билеты, отметки о входе и обращения: 180 дней после окончания или отмены события.",
          "Неактивные аккаунты: 180 дней после последнего входа.",
          "Журналы сервера и резервные копии: 30 дней.",
        ],
      },
      {
        heading: "Ваши возможности",
        body: [
          "На странице аккаунта можно изменить имя и язык и выйти на других устройствах. Чтобы получить копию своих данных или удалить их, напишите нам в поддержку.",
        ],
      },
      {
        heading: "Изменения",
        body: [
          "Если политика изменится, мы обновим эту страницу и дату вверху.",
        ],
      },
    ],
  },
  kk: {
    title: "Құпиялылық саясаты",
    intro:
      "Бұл бетте elc сайты мен билет тексеру қосымшасын пайдаланғанда қандай деректердің жиналатыны, олардың не үшін қажет екені және оларды кімнің көре алатыны түсіндіріледі.",
    sections: [
      {
        heading: "Қандай деректер жиналады",
        body: [
          "Аккаунт: атыңыз, электрондық поштаңыз және тіліңіз. Құпиясөзіңіз ашық түрде сақталмайды, жүйеде оның тек қорғалған хэші болады.",
          "Google арқылы кіру: осы тәсілді таңдасаңыз, Google бізге атыңызды, электрондық поштаңызды және профиль суретіңізді береді.",
          "Тапсырыстар мен билеттер: тіркелген іс-шараларыңыз, өзіңіз жазған қатысушы есімдері, билеттеріңіз және іс-шараға кіргеніңіз туралы белгілер.",
          "Ұйымдастырушы профилі: байланыс деректері, заңды атауы және төлем алу реквизиті.",
          "Қолдау: өтініштерде жіберген хабарламаларыңыз бен файлдарыңыз.",
          "Қауіпсіздік: белсенді сеанстарыңыз, олардың IP мекенжайы мен браузері.",
        ],
      },
      {
        heading: "Төлемдер",
        body: [
          "Төлемдерді Polar төлем қызметі қабылдайды. Банк картаңыздың деректерін біз көрмейміз және сақтамаймыз.",
        ],
      },
      {
        heading: "Деректер не үшін керек",
        body: [
          "Деректер аккаунтыңыздың жұмысына, билет беру мен тексеруге, ұйымдастырушылардың іс-шараларын басқаруына, өтініштерге жауап беруге, аккаунт пен билеттер туралы хат жіберуге және elc қауіпсіздігін сақтауға қажет.",
        ],
      },
      {
        heading: "Деректерді кім көреді",
        body: [
          "Ұйымдастырушылар мен олар тағайындаған қызметкерлер тек өз іс-шараларының қатысушыларын, тапсырыстарын және кіру белгілерін көреді. elc қызметкерлері модерация мен қолдауға керек деректерді ғана көреді.",
          "elc жұмысына мына қызметтер қатысады: Cloudflare – сайт пен деректерді сақтау, Resend – хат жіберу, Polar – төлем қабылдау, Google – аккаунтқа кіру және, рұқсат берсеңіз ғана, сайт талдауы. Деректеріңізді ешкімге сатпаймыз.",
        ],
      },
      {
        heading: "Cookie файлдары және талдау",
        body: [
          "Cookie файлдарының көмегімен аккаунттан шықпай тұрасыз, ал сайт таңдауларыңызды есте сақтайды. Google Analytics сіз Cookie баптауларында рұқсат бергеннен кейін ғана іске қосылады, оны сол жерден кез келген уақытта өшіре аласыз.",
        ],
      },
      {
        heading: "Деректер қанша уақыт сақталады",
        body: [
          "Іс-шаралар, тапсырыстар, билеттер, кіру белгілері мен өтініштер: іс-шара аяқталғаннан немесе болдырылмағаннан кейін 180 күн.",
          "Пайдаланылмаған аккаунттар: соңғы кіргеннен кейін 180 күн.",
          "Сервер журналдары мен сақтық көшірмелер: 30 күн.",
        ],
      },
      {
        heading: "Сіздің мүмкіндіктеріңіз",
        body: [
          "Аккаунт бетінде атыңыз бен тіліңізді өзгертіп, басқа құрылғылардан шыға аласыз. Деректеріңіздің көшірмесін алғыңыз немесе оларды жойғыңыз келсе, Қолдау бөліміне жазыңыз.",
        ],
      },
      {
        heading: "Өзгерістер",
        body: ["Саясат өзгерсе, осы бетті және жоғарыдағы күнді жаңартамыз."],
      },
    ],
  },
}

const terms: Record<Locale, Omit<LegalDocument, "updated">> = {
  en: {
    title: "Terms of use",
    intro: "By using elc you agree to these terms.",
    sections: [
      {
        heading: "Your account",
        body: [
          "Give accurate information and keep your password to yourself. You are responsible for what happens in your account.",
        ],
      },
      {
        heading: "Organizers",
        body: [
          "Organizers are responsible for their events: the description, the date and venue, the refund policy and following the law.",
          "Paid tickets can be sold only after paid sales are switched on for the event.",
        ],
      },
      {
        heading: "Tickets",
        body: [
          "Each ticket lets one person in once. A printed ticket and the ticket on your phone are the same ticket.",
          "Refunds follow the organizer's refund policy. A cancelled or refunded ticket stops working.",
        ],
      },
      {
        heading: "Rules",
        body: [
          "Do not publish misleading or illegal events, misuse other people's data or try to disrupt the service. We may suspend events and accounts that break these rules.",
        ],
      },
      {
        heading: "Availability",
        body: [
          "We work to keep elc running, but we cannot promise that it will always be available or free of errors.",
        ],
      },
      {
        heading: "Changes and contact",
        body: [
          "We may update these terms and will change the date at the top. If you have questions, write to us through Support.",
        ],
      },
    ],
  },
  ru: {
    title: "Условия использования",
    intro: "Пользуясь elc, вы соглашаетесь с этими условиями.",
    sections: [
      {
        heading: "Ваш аккаунт",
        body: [
          "Указывайте верные данные и никому не сообщайте пароль. Вы отвечаете за действия в своём аккаунте.",
        ],
      },
      {
        heading: "Организаторы",
        body: [
          "Организатор отвечает за своё событие: описание, дату и место, условия возврата и соблюдение закона.",
          "Продавать платные билеты можно только после того, как для события включены платные продажи.",
        ],
      },
      {
        heading: "Билеты",
        body: [
          "Каждый билет даёт один вход одному человеку. Распечатанный билет и билет в телефоне — это один и тот же билет.",
          "Возврат проводится по условиям возврата организатора. Отменённый или возвращённый билет перестаёт действовать.",
        ],
      },
      {
        heading: "Правила",
        body: [
          "Не публикуйте ложные или незаконные события, не используйте чужие данные во вред и не пытайтесь нарушить работу сервиса. Мы можем приостановить события и аккаунты, которые нарушают эти правила.",
        ],
      },
      {
        heading: "Доступность",
        body: [
          "Мы стараемся, чтобы elc работал без перебоев, но не можем гарантировать, что сервис всегда будет доступен и без ошибок.",
        ],
      },
      {
        heading: "Изменения и связь",
        body: [
          "Мы можем обновлять эти условия и будем менять дату вверху. Если есть вопросы, напишите нам в поддержку.",
        ],
      },
    ],
  },
  kk: {
    title: "Пайдалану шарттары",
    intro: "elc-ті пайдалансаңыз, осы шарттармен келіскен болып саналасыз.",
    sections: [
      {
        heading: "Аккаунтыңыз",
        body: [
          "Деректеріңізді дұрыс көрсетіңіз және құпиясөзіңізді ешкімге айтпаңыз. Аккаунтыңызда болатын әрекеттерге өзіңіз жауап бересіз.",
        ],
      },
      {
        heading: "Ұйымдастырушылар",
        body: [
          "Ұйымдастырушы өз іс-шарасына жауап береді: сипаттамасы, күні мен өтетін орны, қайтару шарттары және заң талаптарының сақталуы.",
          "Ақылы билеттерді іс-шарада ақылы сатылым қосылғаннан кейін ғана сатуға болады.",
        ],
      },
      {
        heading: "Билеттер",
        body: [
          "Әр билет бір адамды іс-шараға бір рет кіргізеді. Басып шығарылған билет пен телефондағы билет – бір билет.",
          "Ақша ұйымдастырушының қайтару шарттарына сай қайтарылады. Болдырылмаған немесе ақшасы қайтарылған билет жарамсыз болады.",
        ],
      },
      {
        heading: "Ережелер",
        body: [
          "Жалған немесе заңсыз іс-шара жарияламаңыз, басқа адамдардың деректерін теріс пайдаланбаңыз және қызметтің жұмысын бұзуға тырыспаңыз. Осы ережелерді бұзған іс-шаралар мен аккаунттардың жұмысы тоқтатылуы мүмкін.",
        ],
      },
      {
        heading: "Қолжетімділік",
        body: [
          "elc-тің үздіксіз жұмыс істеуіне тырысамыз, бірақ қызметтің әрдайым қолжетімді және қатесіз болатынына кепілдік бере алмаймыз.",
        ],
      },
      {
        heading: "Өзгерістер мен байланыс",
        body: [
          "Шарттар өзгеруі мүмкін, ондайда жоғарыдағы күнді жаңартамыз. Сұрақтарыңыз болса, Қолдау бөліміне жазыңыз.",
        ],
      },
    ],
  },
}

export function legalDocument(locale: Locale, page: LegalPage): LegalDocument {
  const documents = page === "privacy" ? privacy : terms
  return { ...documents[locale], updated: updated[locale] }
}

export function legalLabel(locale: Locale, page: LegalPage): string {
  return labels[page][locale]
}
