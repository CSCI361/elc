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
      "elc Қазақстандағы іс-шараларға тіркеуді және билет таратуды жеңілдетеді. Тегін іс-шаралар, электронды билеттер және QR арқылы кіру.",
    skip: "Негізгі мазмұнға өту",
    home: "elc басты беті",
    navigation: "Негізгі навигация",
    language: "Тілді таңдау",
    navWorkflow: "Қалай жұмыс істейді",
    navAttendees: "Қатысушыларға",
    openApp: "elc-ті ашу",
    eyebrow: "Қазақстандағы іс-шараларға билеттер",
    heroLineOne: "Адамдарды",
    heroLineTwo: "біріктіріңіз.",
    heroDescription:
      "Іс-шараны тіркеуден бастап кіреберістегі билет тексеруге дейін. elc ұйымдастырушылар мен қатысушыларға арналған осы жолды бір қолданбада құруда.",
    heroSecondary: "Жұмыс барысын көру",
    heroNote: "Бастау тегін. Тек ақылы билет сатқанда төлейсіз.",
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
    paidTitle: "Ақылы іс-шара мысалы",
    paidLabel: "әр іс-шараны белсендіру үлгісі",
    paidDescription:
      "Билет сатудан түскен ақшадан 3% өңдеу комиссиясы ұсталады.",
    demoEyebrow: "Бастау оңай",
    demoTitle: "Алғашқы іс-шараңызды бүгін жасаңыз.",
    demoDescription:
      "Тегін іс-шара жасау мен билет тарату үшін ештеңе төлемейсіз. Ақылы сатуды қажет болғанда ғана қосасыз.",
    faqTitle: "Жиі қойылатын сұрақтар",
    questions: [
      {
        question: "elc кімдерге арналған?",
        answer:
          "Іс-шара өткізетін адамдарға, студенттік ұйымдарға және қауымдастықтарға арналған. Ұйымдастырушылар мен қатысушылар веб-қолданбаны, ал кіреберістегі тағайындалған қызметкерлер мобильді қолданбаны пайдаланады.",
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
    footerDescription: "Қазақстандағы іс-шараларға билеттер",
    footerPrivacy: "Аналитика міндетті емес және рұқсат бергенше өшірулі.",
    top: "Бет басына",
  },
  ru: {
    title: "elc · События и билеты",
    description:
      "elc помогает вести регистрацию на события и выдачу билетов в Казахстане. Бесплатные события, электронные билеты и вход по QR.",
    skip: "Перейти к содержанию",
    home: "Главная elc",
    navigation: "Основная навигация",
    language: "Выбор языка",
    navWorkflow: "Как это работает",
    navAttendees: "Участникам",
    openApp: "Открыть elc",
    eyebrow: "Билеты на события в Казахстане",
    heroLineOne: "Собирайте",
    heroLineTwo: "людей вместе.",
    heroDescription:
      "От регистрации на событие до проверки билета у входа. elc объединяет этот путь в одном приложении для организаторов и участников.",
    heroSecondary: "Посмотреть процесс",
    heroNote: "Начать бесплатно. Платите, только когда продаёте билеты.",
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
    paidTitle: "Пример платного события",
    paidLabel: "пример активации одного события",
    paidDescription:
      "С выручки от билетов удерживается комиссия 3% за обработку.",
    demoEyebrow: "Можно начинать",
    demoTitle: "Создайте первое событие сегодня.",
    demoDescription:
      "Бесплатные события и билеты ничего не стоят. Платные продажи включаются, только когда они нужны.",
    faqTitle: "Частые вопросы",
    questions: [
      {
        question: "Для кого создаётся elc?",
        answer:
          "Для людей, студенческих организаций и сообществ, которые проводят события. Организаторы и участники используют веб-приложение, а назначенные сотрудники на входе работают в мобильном приложении.",
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
    footerDescription: "Билеты на события по всему Казахстану",
    footerPrivacy: "Аналитика необязательна и выключена до вашего согласия.",
    top: "Наверх",
  },
  en: {
    title: "elc · Events and tickets",
    description:
      "elc makes event registration and ticketing simple in Kazakhstan. Free events, digital tickets and QR check-in.",
    skip: "Skip to content",
    home: "elc home",
    navigation: "Main navigation",
    language: "Choose language",
    navWorkflow: "How it works",
    navAttendees: "For attendees",
    openApp: "Open elc",
    eyebrow: "Event tickets for Kazakhstan",
    heroLineOne: "Bring people",
    heroLineTwo: "together.",
    heroDescription:
      "From event registration to checking a ticket at the door. elc is bringing that journey into one application for organizers and attendees.",
    heroSecondary: "See the workflow",
    heroNote: "Free to start. Pay only when you sell tickets.",
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
    paidTitle: "Paid event example",
    paidLabel: "sample activation for one event",
    paidDescription: "A 3% processing fee is deducted from ticket revenue.",
    demoEyebrow: "Ready when you are",
    demoTitle: "Create your first event today.",
    demoDescription:
      "Free events and tickets cost nothing. Turn on paid sales only when you need them.",
    faqTitle: "Common questions",
    questions: [
      {
        question: "Who is elc being built for?",
        answer:
          "People, student organizations and communities that run events. Organizers and attendees use the web application. Assigned staff use the mobile application at the entrance.",
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
    footerDescription: "Tickets for events across Kazakhstan",
    footerPrivacy: "Analytics is optional and stays off until you allow it.",
    top: "Back to top",
  },
}
