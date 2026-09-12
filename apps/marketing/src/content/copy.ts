export const locales = ["kk", "ru", "en"] as const
export type Locale = (typeof locales)[number]

export const languageLinks = [
  { locale: "kk", label: "Қаз", name: "Қазақша", href: "/" },
  { locale: "ru", label: "Рус", name: "Русский", href: "/ru/" },
  { locale: "en", label: "Eng", name: "English", href: "/en/" },
] as const

type Copy = {
  title: string
  description: string
  skip: string
  home: string
  navigation: string
  language: string
  navWorkflow: string
  navAttendees: string
  navDemo: string
  openApp: string
  eyebrow: string
  heroLineOne: string
  heroLineTwo: string
  heroDescription: string
  heroSecondary: string
  heroNote: string
  ticketEyebrow: string
  ticketTitle: string
  ticketKind: string
  ticketFor: string
  ticketHolder: string
  ticketFormat: string
  ticketCaption: string
  ticketStamp: string
  strip: string[]
  workflowEyebrow: string
  workflowTitle: string
  workflowDescription: string
  steps: { title: string; description: string }[]
  attendeesEyebrow: string
  attendeesTitle: string
  attendeesDescription: string
  attendeeFeatures: { title: string; description: string }[]
  pricingEyebrow: string
  pricingTitle: string
  freeTitle: string
  freeLabel: string
  freeDescription: string
  paidTitle: string
  paidLabel: string
  paidDescription: string
  demoEyebrow: string
  demoTitle: string
  demoDescription: string
  demoStatus: string
  faqTitle: string
  questions: { question: string; answer: string }[]
  footerDescription: string
  footerPrivacy: string
  top: string
}

export const copy: Record<Locale, Copy> = {
  kk: {
    title: "elc · Іс-шаралар мен билеттер",
    description:
      "Қазақстандағы іс-шараларды тіркеу мен билеттерді басқаруға арналған elc оқу жобасымен танысыңыз. Тегін іс-шаралар, электронды билеттер және QR арқылы кіру.",
    skip: "Негізгі мазмұнға өту",
    home: "elc басты беті",
    navigation: "Негізгі навигация",
    language: "Тілді таңдау",
    navWorkflow: "Қалай жұмыс істейді",
    navAttendees: "Қатысушыларға",
    navDemo: "Демо туралы",
    openApp: "Демоны ашу",
    eyebrow: "Қазақстанға арналған оқу жобасы",
    heroLineOne: "Адамдарды",
    heroLineTwo: "біріктіріңіз.",
    heroDescription:
      "Іс-шараны тіркеуден бастап кіреберістегі билет тексеруге дейін. elc ұйымдастырушылар мен қатысушыларға арналған осы жолды бір қолданбада құруда.",
    heroSecondary: "Жұмыс барысын көру",
    heroNote: "Оқу прототипі. Нақты төлемдер жүргізілмейді.",
    ticketEyebrow: "Билет үлгісі",
    ticketTitle: "Сіздің іс-шараңыз",
    ticketKind: "Тегін тіркелу",
    ticketFor: "Қатысушы",
    ticketHolder: "Қонақтың аты-жөні",
    ticketFormat: "Телефонда немесе қағазда",
    ticketCaption: "Көрнекі үлгі. Бұл кіру билеті емес.",
    ticketStamp: "КЕЗДЕСЕМІЗ",
    strip: [
      "Тегін іс-шаралар",
      "Электронды билеттер",
      "QR арқылы кіру",
      "Қазақша · Русский · English",
    ],
    workflowEyebrow: "Ұйымдастырушының жолы",
    workflowTitle: "Жақсы кездесу\nнақты жоспардан басталады.",
    workflowDescription:
      "Жоба іс-шара дайындаудың негізгі қадамдарын біріктіреді. Қолданбада осы нұсқада дайын болған мүмкіндіктермен таныса аласыз.",
    steps: [
      {
        title: "Іс-шараны дайындаңыз",
        description:
          "Атауын, өтетін орнын және уақытын көрсетіңіз. Қолжетімділігін, сыйымдылығын және билет түрлерін таңдаңыз.",
      },
      {
        title: "Тіркелуді ашыңыз",
        description:
          "Қатысушыларға іс-шара сілтемесін жіберіңіз. Тегін билеттерді тіркеу үшін төлем деректері қажет емес.",
      },
      {
        title: "Билеттерді таратыңыз",
        description:
          "Қатысушының тіркелуі бір билетпен байланысады. Электронды және басып шығарылған нұсқалар бір кіруге арналған.",
      },
      {
        title: "Қонақтарды қарсы алыңыз",
        description:
          "Тағайындалған қызметкер мобильді қолданба арқылы QR кодты тексереді және қатысушының келгенін белгілейді.",
      },
    ],
    attendeesEyebrow: "Қатысушыларға",
    attendeesTitle: "Іс-шараға дайындық\nбилеттен басталады.",
    attendeesDescription:
      "Іс-шара туралы мәлімет, тіркелу және билет бір-бірімен байланысады. Билетке қолжетімділік расталған аккаунтқа тиесілі.",
    attendeeFeatures: [
      {
        title: "Іс-шараны қарап шығыңыз",
        description:
          "Тіркелмес бұрын өтетін орнын, уақытын және билет шарттарын біліңіз.",
      },
      {
        title: "Билетті өзіңізбен алыңыз",
        description:
          "QR билет телефоннан немесе A4 қағаздан көрсетіледі. Қағаз көшірме қосымша кіру құқығын бермейді.",
      },
      {
        title: "Тапсырысыңыз бойынша көмек алыңыз",
        description:
          "Қолдау өтініші тиісті іс-шараға, тапсырысқа немесе билетке байланысады.",
      },
    ],
    pricingEyebrow: "Түсінікті шарттар",
    pricingTitle: "Тегін іс-шара\nтегін болып қалады.",
    freeTitle: "Тегін іс-шаралар",
    freeLabel: "платформа төлемі",
    freeDescription:
      "Тегін билеттерді тарату үшін ақылы сатуды белсендіру қажет емес.",
    paidTitle: "Ақылы іс-шараның демо есебі",
    paidLabel: "әр іс-шараны белсендіру үлгісі",
    paidDescription:
      "Оқу үлгісінде ұйымдастырушыға 3% өңдеу комиссиясы есептеледі. Белсендіру, төлемдер және қайтарымдар тек сынақ режимінде көрсетіледі.",
    demoEyebrow: "Ашық айтатын бір жайт",
    demoTitle: "Бұл оқу жобасы.",
    demoDescription:
      "elc әлі әзірленіп жатыр. Демо нұсқа төлем, билет және кіру үдерістерін сынауға арналған. Нақты ақша аударылмайды, банк деректері немесе жеке басты растайтын құжаттар сұралмайды.",
    demoStatus: "Әзірлеу жалғасуда · Мүмкіндіктер кезеңмен қосылады",
    faqTitle: "Жиі қойылатын сұрақтар",
    questions: [
      {
        question: "elc кімдерге арналған?",
        answer:
          "Іс-шара өткізетін адамдарға, студенттік ұйымдарға және қауымдастықтарға арналған. Ұйымдастырушылар мен қатысушылар веб-қолданбаны, ал кіреберістегі тағайындалған қызметкерлер мобильді қолданбаны пайдаланады.",
      },
      {
        question: "Демо нұсқада нақты ақша төлене ме?",
        answer:
          "Жоқ. Ақылы сату, белсендіру төлемі және қайтарымдар провайдердің сынақ ортасында немесе белгіленген симуляцияда орындалады. Демо жазбалар нақты қаржылық операциялар емес.",
      },
      {
        question: "Билетті қағазға басып шығаруға бола ма?",
        answer:
          "Жобада A4 форматына арналған PDF билет қарастырылған. Телефондағы және қағаздағы нұсқалар бір QR дерегін қолданады, сондықтан олар екі бөлек билет болып саналмайды.",
      },
      {
        question: "Интернетсіз тексеру қалай жұмыс істейді?",
        answer:
          "Жобада алдын ала жүктелген дерекпен уақытша офлайн тексеру қарастырылған. Нәтижелер байланыс қалпына келгенде салыстырылады. Бір-біріне қосылмаған екі құрылғы адамның екі рет кіруіне толық тосқауыл қоя алмайды.",
      },
    ],
    footerDescription: "Қазақстандағы кездесулерге арналған оқу жобасы.",
    footerPrivacy: "Бұл бет аналитика сұрауларын жібермейді.",
    top: "Бет басына",
  },
  ru: {
    title: "elc · События и билеты",
    description:
      "Знакомство с elc, учебным проектом для регистрации на события и управления билетами в Казахстане. Бесплатные события, электронные билеты и вход по QR.",
    skip: "Перейти к содержанию",
    home: "Главная elc",
    navigation: "Основная навигация",
    language: "Выбор языка",
    navWorkflow: "Как это работает",
    navAttendees: "Участникам",
    navDemo: "О демо",
    openApp: "Открыть демо",
    eyebrow: "Учебный проект для Казахстана",
    heroLineOne: "Собирайте",
    heroLineTwo: "людей вместе.",
    heroDescription:
      "От регистрации на событие до проверки билета у входа. elc объединяет этот путь в одном приложении для организаторов и участников.",
    heroSecondary: "Посмотреть процесс",
    heroNote: "Учебный прототип. Без реальных платежей.",
    ticketEyebrow: "Образец билета",
    ticketTitle: "Ваше событие",
    ticketKind: "Бесплатная регистрация",
    ticketFor: "Участник",
    ticketHolder: "Имя гостя",
    ticketFormat: "На телефоне или на бумаге",
    ticketCaption: "Иллюстрация. Не является входным билетом.",
    ticketStamp: "ДО ВСТРЕЧИ",
    strip: [
      "Бесплатные события",
      "Электронные билеты",
      "Вход по QR",
      "Қазақша · Русский · English",
    ],
    workflowEyebrow: "Путь организатора",
    workflowTitle: "Хорошая встреча\nначинается с плана.",
    workflowDescription:
      "Проект объединяет основные этапы подготовки события. В приложении можно познакомиться с возможностями, готовыми в текущей версии.",
    steps: [
      {
        title: "Подготовьте событие",
        description:
          "Укажите название, место и время. Выберите доступность, вместимость и типы билетов.",
      },
      {
        title: "Откройте регистрацию",
        description:
          "Поделитесь ссылкой на событие. Для регистрации на бесплатные билеты платёжные данные не нужны.",
      },
      {
        title: "Выдайте билеты",
        description:
          "Регистрация участника связана с одним билетом. Электронная и печатная копии дают право на один вход.",
      },
      {
        title: "Встречайте гостей",
        description:
          "Назначенный сотрудник проверяет QR-код в мобильном приложении и отмечает прибытие участника.",
      },
    ],
    attendeesEyebrow: "Участникам",
    attendeesTitle: "Подготовка к встрече\nначинается с билета.",
    attendeesDescription:
      "Информация о событии, регистрация и билет связаны между собой. Доступ к билету принадлежит подтверждённому аккаунту.",
    attendeeFeatures: [
      {
        title: "Узнайте о событии",
        description:
          "Посмотрите место, время и условия билетов до регистрации.",
      },
      {
        title: "Возьмите билет с собой",
        description:
          "QR-билет можно показать на телефоне или листе A4. Бумажная копия не даёт дополнительного входа.",
      },
      {
        title: "Получите помощь по заказу",
        description:
          "Обращение в поддержку связано с нужным событием, заказом или билетом.",
      },
    ],
    pricingEyebrow: "Понятные условия",
    pricingTitle: "Бесплатное событие\nостаётся бесплатным.",
    freeTitle: "Бесплатные события",
    freeLabel: "плата платформе",
    freeDescription:
      "Для выдачи бесплатных билетов не нужно активировать платные продажи.",
    paidTitle: "Демо расчёт платного события",
    paidLabel: "пример активации одного события",
    paidDescription:
      "В учебной модели организатору начисляется комиссия 3% за обработку. Активация, платежи и возвраты показаны только в тестовом режиме.",
    demoEyebrow: "Важная деталь",
    demoTitle: "Это учебный проект.",
    demoDescription:
      "elc находится в разработке. Демо предназначено для проверки сценариев оплаты, выдачи билетов и входа. Реальные деньги не переводятся, банковские реквизиты и документы для проверки личности не запрашиваются.",
    demoStatus: "Разработка продолжается · Возможности появляются постепенно",
    faqTitle: "Частые вопросы",
    questions: [
      {
        question: "Для кого создаётся elc?",
        answer:
          "Для людей, студенческих организаций и сообществ, которые проводят события. Организаторы и участники используют веб-приложение, а назначенные сотрудники на входе работают в мобильном приложении.",
      },
      {
        question: "В демо списываются настоящие деньги?",
        answer:
          "Нет. Платные продажи, активация события и возвраты проходят в тестовой среде провайдера или в обозначенной симуляции. Демо записи не являются реальными финансовыми операциями.",
      },
      {
        question: "Можно ли распечатать билет?",
        answer:
          "В проекте предусмотрен PDF-билет для бумаги A4. Версии на телефоне и на бумаге используют одни QR-данные и не считаются двумя отдельными билетами.",
      },
      {
        question: "Как работает проверка без интернета?",
        answer:
          "В проекте предусмотрена временная офлайн-проверка по заранее загруженным данным. Результаты сверяются после восстановления связи. Два отключённых друг от друга устройства не могут полностью предотвратить повторный физический вход.",
      },
    ],
    footerDescription: "Учебный проект для встреч в Казахстане.",
    footerPrivacy: "Эта страница не отправляет запросы аналитики.",
    top: "Наверх",
  },
  en: {
    title: "elc · Events and tickets",
    description:
      "Meet elc, an academic project for event registration and ticketing in Kazakhstan. Free events, digital tickets and QR check-in.",
    skip: "Skip to content",
    home: "elc home",
    navigation: "Main navigation",
    language: "Choose language",
    navWorkflow: "How it works",
    navAttendees: "For attendees",
    navDemo: "About the demo",
    openApp: "Open the demo",
    eyebrow: "An academic project for Kazakhstan",
    heroLineOne: "Bring people",
    heroLineTwo: "together.",
    heroDescription:
      "From event registration to checking a ticket at the door. elc is bringing that journey into one application for organizers and attendees.",
    heroSecondary: "See the workflow",
    heroNote: "Academic prototype. No real payments.",
    ticketEyebrow: "Sample ticket",
    ticketTitle: "Your event",
    ticketKind: "Free registration",
    ticketFor: "Attendee",
    ticketHolder: "Guest name",
    ticketFormat: "On your phone or on paper",
    ticketCaption: "An illustration. Not a valid admission ticket.",
    ticketStamp: "SEE YOU THERE",
    strip: [
      "Free events",
      "Digital tickets",
      "QR check-in",
      "Қазақша · Русский · English",
    ],
    workflowEyebrow: "For organizers",
    workflowTitle: "A good gathering\nstarts with a plan.",
    workflowDescription:
      "The project connects the main steps of preparing an event. Open the application to explore the workflows available in this build.",
    steps: [
      {
        title: "Set up your event",
        description:
          "Add a name, venue and time. Choose visibility, capacity and ticket types.",
      },
      {
        title: "Open registration",
        description:
          "Share your event link. Free-ticket registration does not need payment details.",
      },
      {
        title: "Deliver the tickets",
        description:
          "Each registration belongs to a ticket. Its digital and printed copies represent the same admission.",
      },
      {
        title: "Welcome your guests",
        description:
          "Assigned staff use the mobile app to check QR tickets and record each arrival.",
      },
    ],
    attendeesEyebrow: "For attendees",
    attendeesTitle: "Ready for the event,\nwith a ticket in hand.",
    attendeesDescription:
      "Event details, registration and tickets stay connected. Access to a ticket belongs to the verified purchasing account.",
    attendeeFeatures: [
      {
        title: "Know where you are going",
        description:
          "Review the venue, time and ticket conditions before you register.",
      },
      {
        title: "Bring your ticket",
        description:
          "Show the QR ticket on your phone or an A4 printout. A paper copy does not create an extra admission.",
      },
      {
        title: "Get help with your order",
        description:
          "A support request stays connected to the relevant event, order or ticket.",
      },
    ],
    pricingEyebrow: "Clear terms",
    pricingTitle: "A free event\nstays free.",
    freeTitle: "Free events",
    freeLabel: "platform fee",
    freeDescription:
      "You do not need to activate paid sales to distribute free tickets.",
    paidTitle: "Paid-event demo calculation",
    paidLabel: "sample activation for one event",
    paidDescription:
      "The academic model deducts a 3% processing fee from organizer revenue. Activation, payments and refunds run only in a sandbox or simulation.",
    demoEyebrow: "A note before you explore",
    demoTitle: "This is an academic project.",
    demoDescription:
      "elc is in development. The demo is for trying payment, ticketing and admission workflows. It does not move real money or request bank credentials or identity documents.",
    demoStatus: "In development · Workflows are added in stages",
    faqTitle: "Common questions",
    questions: [
      {
        question: "Who is elc being built for?",
        answer:
          "People, student organizations and communities that run events. Organizers and attendees use the web application. Assigned staff use the mobile application at the entrance.",
      },
      {
        question: "Does the demo charge real money?",
        answer:
          "No. Paid sales, event activation and refunds use a provider sandbox or a labelled simulation. Demo records are not real financial transactions.",
      },
      {
        question: "Can a ticket be printed?",
        answer:
          "The project includes a PDF ticket designed for A4 paper. The phone and paper copies use the same QR credential and do not count as two separate tickets.",
      },
      {
        question: "What happens without an internet connection?",
        answer:
          "The project includes provisional offline checks using previously downloaded data. Results are reconciled after reconnection. Two disconnected devices cannot fully prevent the same person entering twice.",
      },
    ],
    footerDescription: "An academic project for gatherings in Kazakhstan.",
    footerPrivacy: "This page sends no analytics requests.",
    top: "Back to top",
  },
}
