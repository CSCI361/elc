import { useEventText } from "./messages"

const messages = {
  title: ["Іс-шара суреттері", "Изображения события", "Event images"],
  previewEvent: [
    "Іс-шараны алдын ала қарау",
    "Предпросмотр события",
    "Preview event",
  ],
  previewNotice: [
    "Ұйымдастырушыға арналған алдын ала қарау. Бұл бетте билет сатып алу мүмкін емес.",
    "Предпросмотр для организатора. Купить билеты на этой странице нельзя.",
    "Organizer preview. Ticket purchases are disabled on this page.",
  ],
  backToEditor: [
    "Өңдеуге оралу",
    "Вернуться к редактированию",
    "Back to editor",
  ],
  previewTickets: [
    "Билеттерді алдын ала қарау",
    "Предпросмотр билетов",
    "Ticket preview",
  ],
  gallery: ["Фотогалерея", "Фотогалерея", "Photo gallery"],
  limits: [
    "5 суретке дейін. JPEG немесе PNG, әрқайсысы 5 МиБ-тан аспасын. 4 миллион пиксельге дейін, әр қыры 8192 пиксельден аспасын.",
    "До 5 изображений. JPEG или PNG, не более 5 МиБ каждое. До 4 миллионов пикселей, каждая сторона не более 8192 пикселей.",
    "Up to 5 images. JPEG or PNG, at most 5 MiB each. Up to 4 million pixels, with neither edge over 8192 pixels.",
  ],
  intro: [
    "Бірінші сурет іс-шара мұқабасы болады.",
    "Первое изображение станет обложкой события.",
    "The first image is the event cover.",
  ],
  draftFirst: [
    "Суреттерді қосу үшін алдымен іс-шара жобасын сақтаңыз.",
    "Сначала сохраните черновик события, затем добавьте изображения.",
    "Save the event draft first, then add images.",
  ],
  choose: ["Сурет файлы", "Файл изображения", "Image file"],
  pickFile: [
    "JPEG не PNG таңдаңыз",
    "Выберите JPEG или PNG",
    "Choose a JPEG or PNG",
  ],
  alt: ["Сурет сипаттамасы", "Описание изображения", "Image description"],
  altHint: [
    "Экраннан оқу құралдары үшін суреттегі маңызды ақпаратты сипаттаңыз. 500 таңбаға дейін.",
    "Опишите важное содержимое для пользователей экранных дикторов. До 500 символов.",
    "Describe the important content for people using screen readers. Up to 500 characters.",
  ],
  preview: [
    "Жүктелетін суретті алдын ала қарау",
    "Предпросмотр перед загрузкой",
    "Selected image preview",
  ],
  upload: ["Суретті жүктеу", "Загрузить изображение", "Upload image"],
  uploading: ["Сақталуда…", "Сохранение…", "Saving…"],
  save: ["Галереяны сақтау", "Сохранить галерею", "Save gallery"],
  saved: ["Галерея сақталды.", "Галерея сохранена.", "Gallery saved."],
  cover: ["Мұқаба", "Обложка", "Cover"],
  earlier: ["Алға жылжыту", "Переместить раньше", "Move earlier"],
  later: ["Артқа жылжыту", "Переместить позже", "Move later"],
  remove: ["Суретті алып тастау", "Убрать изображение", "Remove image"],
  empty: ["Суреттер әзірге жоқ", "Фотографий пока нет", "No photos yet"],
  unsaved: [
    "Реті, сипаттамалары және өшірулер галереяны сақтағаннан кейін қолданылады.",
    "Порядок, описания и удаления применятся после сохранения галереи.",
    "Order, descriptions and removals take effect when you save the gallery.",
  ],
  saveFirst: [
    "Келесі суретті жүктемес бұрын галерея өзгерістерін сақтаңыз.",
    "Сохраните изменения галереи перед загрузкой следующего изображения.",
    "Save gallery changes before uploading another image.",
  ],
  full: [
    "5 сурет қосылған. Жаңасын жүктеу үшін біреуін алып тастап, галереяны сақтаңыз.",
    "Добавлено 5 изображений. Чтобы загрузить новое, уберите одно и сохраните галерею.",
    "All 5 image slots are used. Remove an image and save the gallery to upload another.",
  ],
  invalidFile: [
    "Көлемі 5 МиБ-тан аспайтын JPEG немесе PNG файлын таңдаңыз.",
    "Выберите JPEG или PNG размером не более 5 МиБ.",
    "Choose a JPEG or PNG file no larger than 5 MiB.",
  ],
  invalidAlt: [
    "Әр суретке 1–500 таңбадан тұратын сипаттама қосыңыз.",
    "Добавьте к каждому изображению описание от 1 до 500 символов.",
    "Add a description of 1–500 characters to each image.",
  ],
  invalidImage: [
    "Бұл суретті өңдеу мүмкін емес. Көрсетілген өлшемдерге сай басқа JPEG немесе PNG файлын таңдаңыз.",
    "Не удалось обработать изображение. Выберите другой JPEG или PNG в указанных пределах.",
    "This image could not be processed. Choose another JPEG or PNG within the stated limits.",
  ],
  failedImage: [
    "Сурет қолжетімсіз",
    "Изображение недоступно",
    "Image unavailable",
  ],
  retry: ["Қайталап көру", "Повторить", "Retry"],
  retryHint: [
    "Байланыс үзілсе, осы әрекетті қауіпсіз қайталауға болады.",
    "Если связь прервалась, эту операцию можно безопасно повторить.",
    "If the connection was interrupted, you can safely retry this operation.",
  ],
  reload: [
    "Соңғы галереяны жүктеу",
    "Загрузить актуальную галерею",
    "Load latest gallery",
  ],
  reloadHint: [
    "Соңғы галереяны жүктеу сақталмаған өзгерістерді алып тастайды.",
    "Загрузка актуальной галереи отменит несохранённые изменения.",
    "Loading the latest gallery discards unsaved changes.",
  ],
  changed: [
    "Іс-шара басқа жерде өзгертілген. Өңдеуді жалғастыру үшін соңғы галереяны жүктеңіз.",
    "Событие изменилось в другом месте. Загрузите актуальную галерею перед продолжением.",
    "The event changed elsewhere. Load the latest gallery before continuing.",
  ],
  refreshFailed: [
    "Өзгеріс сақталды, бірақ жаңа галереяны жүктеу мүмкін болмады. Қайталап көріңіз.",
    "Изменение сохранено, но актуальную галерею загрузить не удалось. Повторите попытку.",
    "The change was saved, but the updated gallery could not be loaded. Retry to load it.",
  ],
  clear: [
    "Таңдалған файлды алып тастау",
    "Убрать выбранный файл",
    "Clear selected file",
  ],
} as const
export function useImageText() {
  const { locale } = useEventText()
  const index = locale === "kk" ? 0 : locale === "ru" ? 1 : 2
  return { t: (key: keyof typeof messages) => messages[key][index] }
}
