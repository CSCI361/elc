import type { Locale } from "./common"

export const localeNames: Record<Locale, string> = {
  kk: "Қазақша",
  ru: "Русский",
  en: "English",
}

const english = {
  language: "Language",
  skipToContent: "Skip to content",
  account: "My account",
  signIn: "Sign in",
  signUp: "Create account",
  signOut: "Sign out",
  signOutAll: "Sign out of all other sessions",
  welcomeTitle: "Good to have you here.",
  welcomeDescription:
    "One account for your tickets, your events, and the moments you share.",
  welcomeNote: "Made for getting together in Kazakhstan.",
  brandCaption: "More moments. Together.",
  signInTitle: "Welcome back",
  signInDescription: "Sign in to access your tickets and manage your events.",
  signUpTitle: "Make room for your next event",
  signUpDescription:
    "Create an account, verify your email, and you are ready to join.",
  fullName: "Full name",
  email: "Email address",
  password: "Password",
  newPassword: "New password",
  confirmPassword: "Confirm password",
  passwordHint: "Use 8–128 characters.",
  showPassword: "Show password",
  hidePassword: "Hide password",
  forgotPassword: "Forgot password?",
  noAccount: "New to elc?",
  haveAccount: "Already have an account?",
  continueGoogle: "Continue with Google",
  orEmail: "or use your email",
  googleUnavailable: "Google sign-in is currently unavailable.",
  emailUnavailable:
    "Email delivery is currently unavailable. Please try again later to register, verify your email, or reset your password.",
  verificationTitle: "Check your inbox",
  verificationDescription:
    "Open the verification link in your email, then return here to sign in. The link is valid for one hour.",
  resendDescription:
    "Enter your account email to request a new verification link.",
  resendVerification: "Resend verification email",
  verificationSent:
    "If this address needs verification, a new link has been sent. Check your inbox and spam folder.",
  verifiedTitle: "Your email is verified",
  verifiedDescription: "You can now sign in to your account.",
  forgotTitle: "Let's get you back in",
  forgotDescription:
    "Enter your account email. We will send you a link to choose a new password.",
  sendResetLink: "Send reset link",
  resetSent:
    "If an account uses this address, a password reset link has been sent. Check your inbox and spam folder.",
  resetTitle: "Choose a new password",
  resetDescription:
    "Your other sessions will be signed out after your password changes.",
  resetPassword: "Save new password",
  passwordReset:
    "Your password has been updated. Sign in with your new password.",
  resetInvalid:
    "This password reset link is invalid or has expired. Request a new link.",
  verificationInvalid:
    "This verification link is invalid or has expired. Request a new verification email.",
  backToSignIn: "Back to sign in",
  pending: "Please wait…",
  loadingAccount: "Checking your account…",
  activeAccount: "Verified account",
  accountTitle: "Your account, ready to go",
  accountDescription: "Manage the details that travel with you across elc.",
  accountDetails: "Account details",
  emailVerified: "Email verified",
  languagePreference: "Preferred language",
  languagePreferenceHint:
    "Saved to your account and used when you sign in on another device.",
  preferenceSaved: "Language preference saved.",
  security: "Account security",
  securityDescription:
    "Send a password reset email to change your password. Changing it signs out your other sessions.",
  otherSessionsRevoked: "Your other sessions have been signed out.",
  signedInAs: "Signed in as",
  alreadySignedIn: "You are already signed in.",
  continueToAccount: "Go to my account",
  accessDenied:
    "This account cannot access the application right now. Sign out or try again later.",
  retry: "Try again",
  errorNetwork: "We could not connect. Check your connection and try again.",
  errorGeneric: "This request could not be completed. Try again.",
  errorCredentials: "The email address or password is incorrect.",
  errorUnverified:
    "Verify your email before signing in. You can request a new verification link below.",
  errorPasswordMismatch: "The passwords do not match.",
  errorPasswordLength: "Your password must contain 8–128 characters.",
  errorRateLimit: "Too many attempts. Wait a minute, then try again.",
  errorEmail: "Enter a valid email address.",
  errorGoogle:
    "Google sign-in could not be completed. Try again or use your email.",
  errorSession: "Your session has ended. Sign in again.",
  pageNotFound: "This page is not here",
  pageNotFoundDescription:
    "The link may have changed. You can return to your account or sign in.",
  home: "Home",
  privacyNote: "Your tickets stay with the account that purchased them.",
  footerNote: "elc · Academic release · Kazakhstan",
  lightTheme: "Use light theme",
  darkTheme: "Use dark theme",
}

export type AuthMessages = { [Key in keyof typeof english]: string }

export const authMessages: Record<Locale, AuthMessages> = {
  en: english,
  kk: {
    language: "Тіл",
    skipToContent: "Мазмұнға өту",
    account: "Менің аккаунтым",
    signIn: "Кіру",
    signUp: "Аккаунт ашу",
    signOut: "Шығу",
    signOutAll: "Басқа сеанстардан шығу",
    welcomeTitle: "Қош келдіңіз!",
    welcomeDescription:
      "Билеттеріңіз, іс-шараларыңыз және бірге өткізетін сәттеріңіз үшін бір аккаунт.",
    welcomeNote: "Қазақстандағы кездесулер үшін жасалған.",
    brandCaption: "Бірге өткізетін сәттер көп болсын.",
    signInTitle: "Қайта оралуыңызбен",
    signInDescription:
      "Билеттеріңізді көру және іс-шараларыңызды басқару үшін кіріңіз.",
    signUpTitle: "Келесі іс-шараңызға қадам жасаңыз",
    signUpDescription: "Аккаунт ашып, электрондық поштаңызды растаңыз.",
    fullName: "Аты-жөніңіз",
    email: "Электрондық пошта",
    password: "Құпиясөз",
    newPassword: "Жаңа құпиясөз",
    confirmPassword: "Құпиясөзді қайталаңыз",
    passwordHint: "8–128 таңба қолданыңыз.",
    showPassword: "Құпиясөзді көрсету",
    hidePassword: "Құпиясөзді жасыру",
    forgotPassword: "Құпиясөзді ұмыттыңыз ба?",
    noAccount: "elc-ке алғаш рет келдіңіз бе?",
    haveAccount: "Аккаунтыңыз бар ма?",
    continueGoogle: "Google арқылы жалғастыру",
    orEmail: "немесе пошта арқылы",
    googleUnavailable: "Google арқылы кіру қазір қолжетімсіз.",
    emailUnavailable:
      "Хат жіберу қазір қолжетімсіз. Аккаунт ашу, поштаны растау немесе құпиясөзді қалпына келтіру үшін кейінірек қайталаңыз.",
    verificationTitle: "Поштаңызды тексеріңіз",
    verificationDescription:
      "Хаттағы растау сілтемесін ашып, аккаунтқа кіру үшін осында оралыңыз. Сілтеме бір сағат жарамды.",
    resendDescription:
      "Жаңа растау сілтемесін алу үшін аккаунт поштаңызды енгізіңіз.",
    resendVerification: "Растау хатын қайта жіберу",
    verificationSent:
      "Егер бұл мекенжайды растау қажет болса, жаңа сілтеме жіберілді. Кіріс хаттар мен спам қалтасын тексеріңіз.",
    verifiedTitle: "Поштаңыз расталды",
    verifiedDescription: "Енді аккаунтыңызға кіре аласыз.",
    forgotTitle: "Аккаунтқа қолжетімділікті қалпына келтірейік",
    forgotDescription:
      "Аккаунт поштаңызды енгізіңіз. Жаңа құпиясөз орнатуға арналған сілтеме жібереміз.",
    sendResetLink: "Қалпына келтіру сілтемесін жіберу",
    resetSent:
      "Егер осы мекенжаймен аккаунт тіркелген болса, құпиясөзді қалпына келтіру сілтемесі жіберілді. Кіріс хаттар мен спам қалтасын тексеріңіз.",
    resetTitle: "Жаңа құпиясөз таңдаңыз",
    resetDescription: "Құпиясөз өзгергеннен кейін басқа сеанстарыңыз жабылады.",
    resetPassword: "Жаңа құпиясөзді сақтау",
    passwordReset: "Құпиясөзіңіз жаңартылды. Жаңа құпиясөзбен кіріңіз.",
    resetInvalid:
      "Қалпына келтіру сілтемесі жарамсыз немесе мерзімі өткен. Жаңа сілтеме сұраңыз.",
    verificationInvalid:
      "Растау сілтемесі жарамсыз немесе мерзімі өткен. Жаңа растау хатын сұраңыз.",
    backToSignIn: "Кіру бетіне оралу",
    pending: "Күте тұрыңыз…",
    loadingAccount: "Аккаунт тексерілуде…",
    activeAccount: "Расталған аккаунт",
    accountTitle: "Аккаунтыңыз дайын",
    accountDescription: "elc-тегі жеке деректеріңізді басқарыңыз.",
    accountDetails: "Аккаунт деректері",
    emailVerified: "Пошта расталған",
    languagePreference: "Қалаған тіл",
    languagePreferenceHint:
      "Аккаунтыңызда сақталады және басқа құрылғыдан кіргенде қолданылады.",
    preferenceSaved: "Тіл таңдауы сақталды.",
    security: "Аккаунт қауіпсіздігі",
    securityDescription:
      "Құпиясөзді өзгерту үшін қалпына келтіру хатын жіберіңіз. Құпиясөз өзгергенде басқа сеанстар жабылады.",
    otherSessionsRevoked: "Басқа сеанстарыңыз жабылды.",
    signedInAs: "Кірген аккаунт",
    alreadySignedIn: "Сіз аккаунтқа кіргенсіз.",
    continueToAccount: "Аккаунтыма өту",
    accessDenied:
      "Бұл аккаунт үшін қолданбаға қолжетімділік қазір шектелген. Аккаунттан шығыңыз немесе кейінірек қайталаңыз.",
    retry: "Қайталау",
    errorNetwork:
      "Қосылу мүмкін болмады. Интернет байланысын тексеріп, қайталаңыз.",
    errorGeneric: "Сұрау орындалмады. Қайталап көріңіз.",
    errorCredentials: "Пошта немесе құпиясөз қате.",
    errorUnverified:
      "Кірмес бұрын поштаңызды растаңыз. Төменнен жаңа растау сілтемесін сұрай аласыз.",
    errorPasswordMismatch: "Құпиясөздер сәйкес келмейді.",
    errorPasswordLength: "Құпиясөз 8–128 таңбадан тұруы керек.",
    errorRateLimit: "Әрекет тым көп. Бір минут күтіп, қайталаңыз.",
    errorEmail: "Жарамды пошта мекенжайын енгізіңіз.",
    errorGoogle:
      "Google арқылы кіру аяқталмады. Қайталаңыз немесе поштаңызды қолданыңыз.",
    errorSession: "Сеанс аяқталды. Қайта кіріңіз.",
    pageNotFound: "Бұл бет табылмады",
    pageNotFoundDescription:
      "Сілтеме өзгерген болуы мүмкін. Аккаунтыңызға оралыңыз немесе жүйеге кіріңіз.",
    home: "Басты бет",
    privacyNote: "Билеттер оларды сатып алған аккаунтқа тиесілі болады.",
    footerNote: "elc · Оқу жобасы · Қазақстан",
    lightTheme: "Ашық тақырыпты қосу",
    darkTheme: "Қараңғы тақырыпты қосу",
  },
  ru: {
    language: "Язык",
    skipToContent: "Перейти к содержимому",
    account: "Мой аккаунт",
    signIn: "Войти",
    signUp: "Создать аккаунт",
    signOut: "Выйти",
    signOutAll: "Завершить другие сеансы",
    welcomeTitle: "Рады вас видеть.",
    welcomeDescription: "Один аккаунт для ваших билетов, событий и встреч.",
    welcomeNote: "Для встреч и событий в Казахстане.",
    brandCaption: "Больше моментов вместе.",
    signInTitle: "С возвращением",
    signInDescription:
      "Войдите, чтобы открыть билеты и управлять своими событиями.",
    signUpTitle: "Навстречу следующему событию",
    signUpDescription: "Создайте аккаунт и подтвердите электронную почту.",
    fullName: "Имя и фамилия",
    email: "Электронная почта",
    password: "Пароль",
    newPassword: "Новый пароль",
    confirmPassword: "Повторите пароль",
    passwordHint: "От 8 до 128 символов.",
    showPassword: "Показать пароль",
    hidePassword: "Скрыть пароль",
    forgotPassword: "Забыли пароль?",
    noAccount: "Впервые в elc?",
    haveAccount: "Уже есть аккаунт?",
    continueGoogle: "Продолжить с Google",
    orEmail: "или через почту",
    googleUnavailable: "Вход через Google сейчас недоступен.",
    emailUnavailable:
      "Отправка писем сейчас недоступна. Попробуйте зарегистрироваться, подтвердить почту или восстановить пароль позже.",
    verificationTitle: "Проверьте почту",
    verificationDescription:
      "Откройте ссылку в письме, затем вернитесь сюда и войдите. Ссылка действует один час.",
    resendDescription:
      "Укажите почту аккаунта, чтобы получить новую ссылку для подтверждения.",
    resendVerification: "Отправить подтверждение ещё раз",
    verificationSent:
      "Если этому адресу нужно подтверждение, новая ссылка отправлена. Проверьте входящие и папку «Спам».",
    verifiedTitle: "Почта подтверждена",
    verifiedDescription: "Теперь вы можете войти в свой аккаунт.",
    forgotTitle: "Вернём доступ к аккаунту",
    forgotDescription:
      "Укажите почту аккаунта. Мы отправим ссылку для создания нового пароля.",
    sendResetLink: "Отправить ссылку",
    resetSent:
      "Если аккаунт с таким адресом существует, ссылка для сброса пароля отправлена. Проверьте входящие и папку «Спам».",
    resetTitle: "Придумайте новый пароль",
    resetDescription: "После изменения пароля другие сеансы будут завершены.",
    resetPassword: "Сохранить новый пароль",
    passwordReset: "Пароль обновлён. Войдите с новым паролем.",
    resetInvalid:
      "Ссылка недействительна или срок её действия истёк. Запросите новую ссылку.",
    verificationInvalid:
      "Ссылка подтверждения недействительна или срок её действия истёк. Запросите новое письмо.",
    backToSignIn: "Вернуться ко входу",
    pending: "Подождите…",
    loadingAccount: "Проверяем аккаунт…",
    activeAccount: "Подтверждённый аккаунт",
    accountTitle: "Ваш аккаунт готов",
    accountDescription: "Управляйте своими данными в elc.",
    accountDetails: "Данные аккаунта",
    emailVerified: "Почта подтверждена",
    languagePreference: "Предпочитаемый язык",
    languagePreferenceHint:
      "Сохраняется в аккаунте и применяется при входе на другом устройстве.",
    preferenceSaved: "Язык сохранён.",
    security: "Безопасность аккаунта",
    securityDescription:
      "Отправьте письмо для сброса пароля, чтобы изменить его. После изменения другие сеансы будут завершены.",
    otherSessionsRevoked: "Другие сеансы завершены.",
    signedInAs: "Вы вошли как",
    alreadySignedIn: "Вы уже вошли в аккаунт.",
    continueToAccount: "Перейти в мой аккаунт",
    accessDenied:
      "Этот аккаунт сейчас не может пользоваться приложением. Выйдите или попробуйте позже.",
    retry: "Попробовать снова",
    errorNetwork:
      "Не удалось подключиться. Проверьте соединение и попробуйте снова.",
    errorGeneric: "Не удалось выполнить запрос. Попробуйте снова.",
    errorCredentials: "Неверная почта или пароль.",
    errorUnverified:
      "Подтвердите почту перед входом. Ниже можно запросить новую ссылку.",
    errorPasswordMismatch: "Пароли не совпадают.",
    errorPasswordLength: "Пароль должен содержать от 8 до 128 символов.",
    errorRateLimit:
      "Слишком много попыток. Подождите минуту и попробуйте снова.",
    errorEmail: "Введите корректный адрес почты.",
    errorGoogle:
      "Не удалось завершить вход через Google. Попробуйте снова или войдите по почте.",
    errorSession: "Сеанс завершён. Войдите снова.",
    pageNotFound: "Страница не найдена",
    pageNotFoundDescription:
      "Возможно, ссылка изменилась. Перейдите в аккаунт или войдите.",
    home: "Главная",
    privacyNote: "Билеты принадлежат аккаунту, с которого их купили.",
    footerNote: "elc · Учебный проект · Казахстан",
    lightTheme: "Включить светлую тему",
    darkTheme: "Включить тёмную тему",
  },
}
