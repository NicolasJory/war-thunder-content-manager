/**
 * Traductions — anglais, français, russe, chinois simplifié.
 *
 * Anglais par défaut : le public de War Thunder Live est international et le
 * contenu du site lui-même est en anglais.
 *
 * Pas de librairie. Un dictionnaire par langue, plus une interpolation minimale
 * `{nom}`. Cette interpolation n'est pas cosmétique : en chinois le nombre se
 * place AU MILIEU de l'expression (« 第 3 页 » et non « 页 3 »), donc concaténer
 * un libellé et un chiffre produit du charabia. Toute chaîne portant une valeur
 * variable passe donc par un jeton.
 *
 * `en` est la source de vérité : les autres langues sont typées `Record<Key,
 * string>`, donc une clé oubliée est une erreur de compilation, jamais un texte
 * manquant à l'écran. Le test `smoke:ui` vérifie en plus que chaque langue porte
 * exactement les mêmes jetons `{…}` que l'anglais — une traduction qui perd un
 * `{n}` afficherait une phrase amputée sans que rien ne le signale.
 */

export const LANGS = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "ru", label: "Русский" },
  { code: "zh", label: "中文" },
] as const;

export type Lang = (typeof LANGS)[number]["code"];

const en = {
  appName: "War Thunder Content Manager",
  brandTop: "War Thunder",
  brandBottom: "Content Manager",
  monogram: "WT",
  contentCamouflages: "Camouflages",
  contentType: "Content",

  // Barre latérale
  tabBrowse: "Browse",
  tabInstalled: "Installed",
  soon: "Soon",
  navSights: "Sights",
  navSounds: "Sound mods",
  gameFolder: "Game folder",
  open: "Open",
  change: "Change",
  openSkinsFolder: "Open UserSkins",
  changeFolder: "Change folder",
  language: "Language",

  // Installation
  install: "Install",
  installing: "Installing…",
  uninstall: "Uninstall",
  uninstalling: "Removing…",
  downloading: "Downloading",
  extracting: "Extracting",
  storing: "Storing in UserSkins",
  installTitle: "Install this camouflage",
  installNamed: "Install {name}",
  installNameLabel: "Folder name",
  installNameHelp:
    "This is the name the game shows in its skin list. Pick something you will recognise.",
  installNameTaken: "A folder with this name already exists and will be replaced.",
  installNameInvalid: "This name cannot be used.",
  cancel: "Cancel",
  confirm: "Confirm",

  // Recherche et filtres
  hashtag: "Hashtag",
  hashtagPlaceholder: "mirage, ww2, anime…",
  search: "Search",
  sortBy: "Sort by",
  sortPopular: "Most popular",
  sortRecent: "Most recent",
  sortDownloads: "Most downloaded",
  sortComments: "Most commented",
  all: "All",
  filterCountry: "Country",
  filterType: "Type",
  filterClass: "Class",
  filterVehicle: "Vehicle",
  reset: "Reset",
  resetFilters: "Reset filters",
  noMatch: "No match",
  noResults: "No results",
  noResultsHashtag: "This hashtag may not exist. Vehicle filters are more reliable.",
  noResultsFilters: "Try widening the filters.",
  previous: "Previous",
  next: "Next",
  page: "Page {n}",
  endOfList: "End of the list.",
  removeFilter: "Clear this filter",
  clearSearch: "Clear the search",
  filtersFailed:
    "Filters could not be loaded from Live. Browsing, sorting and installing still work.",
  hashtagNote:
    "Hashtags are written by the authors, so coverage is uneven — vehicle filters are more reliable.",
  searchingOn: "Searching on {tag}",

  // Cartes et fiche
  noPreview: "no preview",
  imageCount: "{n} images",
  imagePosition: "preview {n} / {total}",
  likes: "Likes",
  views: "Views",
  downloads: "Downloads",
  comments: "Comments",
  previousImage: "Previous image",
  nextImage: "Next image",
  close: "Close",
  resetZoom: "reset",
  viewOnLive: "View on WT Live",
  localOnly: "Installed locally, visible to you alone. Nothing is sent to the game server.",
  otherCreations: "More by author",
  loadingCreations: "Loading this author's creations…",
  noOtherCreations: "No other camouflage by this author.",
  uploadedOn: "uploaded {date}",

  // Auteur
  byAuthor: "Camouflages by {name}",
  authorPage: "See author page",
  backToBrowse: "Back to browsing",
  authorEmpty: "This author has no camouflage on this page.",
  authorNote:
    "An author's feed also holds screenshots and videos; only installable camouflages are listed.",

  // Installés
  installedTitle: "Installed camouflages",
  installedEmpty: "No camouflage installed by the application.",
  installedEmptyHelp:
    "Only folders placed by the application. Those already in UserSkins are never touched.",
  installedOn: "Installed on",
  refresh: "Refresh",
  favorites: "Favourites",
  addFavorite: "Add to favourites",
  removeFavorite: "Remove from favourites",
  favoritesEmpty: "No favourite author yet.",
  favoritesHelp: "Add an author from their page to follow what they publish.",
  share: "Share",
  installWithSize: "Install ({size})",
  favorite: "Favourite",
  shareCopied: "Link copied to the clipboard.",
  copyAppLink: "Copy app link",
  appLinkCopied: "App link copied. It opens straight in the application.",
  linkOpened: "Opened from a link.",
  linkNotFound: "This link does not point to anything the application can open.",
  pasteHint: "You can also paste a War Thunder Live link here.",
  addedOn: "added {date}",
  refreshing: "Refreshing…",
  updateAvailable: "Update available",
  updateNow: "Update",
  foreignTitle: "Already in UserSkins",
  foreignHelp: "Folders the application did not place. They are listed for information and are never modified or deleted.",
  foreignCount: "{n} folders",
  lastChecked: "checked {date}",
  never: "never",
  installedCount: "{n} camouflages · {size} in UserSkins",
  content: "Content",
  folderName: "Folder",

  // Lien externe
  externalTitle: "Leave the application?",
  externalBody: "This link opens in your web browser, outside the application.",
  externalOpen: "Open in browser",

  // Configuration
  firstRun: "First run",
  setupTitle: "Where is War Thunder installed?",
  setupIntro:
    "Point to the root folder of the game. Camouflages are installed into its UserSkins subfolder.",
  setupField: "Game folder",
  browse: "Browse…",
  detecting: "Looking for the installation through Steam…",
  foundViaSteam: "Found through Steam. Destination:",
  skinsDestination: "Camouflages will go to",
  checking: "Checking…",
  continueLabel: "Continue",
  setupFootnote:
    "Installed content is visible to you alone, locally. It is never sent to the game server.",
  invalidFolder: "Invalid folder.",

  // Divers
  loading: "Loading…",
  retry: "Retry",
  installedToast: "{name} installed.",
  uninstalledToast: "{name} removed.",
  installFailed: "Install failed: {reason}",
  uninstallFailed: "Removal failed: {reason}",

  // Erreurs remontées par le main (codes de shared/errors.ts)
  E_NO_GAMEDIR: "The game folder is not configured.",
  E_API: "War Thunder Live did not answer as expected.",
  E_FILTERS_BLOCK: "Live changed its page layout: filters could not be read.",
  E_DOWNLOAD: "Download failed.",
  E_BAD_SOURCE: "This file is not served by War Thunder Live. Download refused.",
  E_DOWNLOAD_TOO_BIG: "This archive exceeds the size the application accepts.",
  E_DOWNLOAD_STALLED: "The download stopped responding.",
  E_ARCHIVE_TOO_BIG: "This archive expands far beyond what the application accepts.",
  E_EMPTY_ARCHIVE: "The archive is empty, there is nothing to install.",
  E_OUTSIDE_DEST: "The archive tried to write outside UserSkins. Install aborted.",
  E_BAD_NAME: "This folder name cannot be used.",
  E_BAD_URL: "Invalid link.",
  E_BAD_SCHEME: "This link uses a scheme the application refuses to open.",
  E_UNKNOWN_CONTENT: "Unknown content type.",
  E_UNKNOWN_SORT: "Unknown sort order.",
  E_NO_INSTALLER: "This content type cannot be installed yet.",
  E_NO_SIGHTS_DIR: "Could not find your War Thunder sights folder. Launch the game once so it creates it.",
  E_UNKNOWN_LAYOUT: "This archive is not laid out in a way the app can place. Install it by hand if you need it.",
  E_BAD_ARGS: "The application sent a malformed request. Nothing was changed.",
  E_TOO_FAST: "Too many links opened at once. Try again in a moment.",
  E_NOT_INSTALLED:
    "This content is not tracked as installed by the application, so it was not touched.",
  V_EMPTY: "No folder given.",
  V_NOT_FOUND: "This folder does not exist.",
  V_NOT_DIR: "This is not a folder.",
  V_NO_MARKERS:
    "No .vromfs.bin file here, so this does not look like a War Thunder installation.",
  pickTitle: "War Thunder installation folder",
  pickButton: "Choose",
} as const;

export type Key = keyof typeof en;

const fr: Record<Key, string> = {
  appName: "War Thunder Content Manager",
  brandTop: "War Thunder",
  brandBottom: "Content Manager",
  monogram: "WT",
  contentCamouflages: "Camouflages",
  contentType: "Contenu",

  tabBrowse: "Parcourir",
  tabInstalled: "Installés",
  soon: "Bientôt",
  navSights: "Viseurs",
  navSounds: "Mods son",
  gameFolder: "Dossier du jeu",
  open: "Ouvrir",
  change: "Changer",
  openSkinsFolder: "Ouvrir UserSkins",
  changeFolder: "Changer de dossier",
  language: "Langue",

  install: "Installer",
  installing: "Installation…",
  uninstall: "Désinstaller",
  uninstalling: "Retrait…",
  downloading: "Téléchargement",
  extracting: "Extraction",
  storing: "Rangement dans UserSkins",
  installTitle: "Installer ce camouflage",
  installNamed: "Installer {name}",
  installNameLabel: "Nom du dossier",
  installNameHelp:
    "C'est le nom que le jeu affiche dans sa liste des skins. Choisis quelque chose que tu reconnaîtras.",
  installNameTaken: "Un dossier de ce nom existe déjà et sera remplacé.",
  installNameInvalid: "Ce nom ne peut pas être utilisé.",
  cancel: "Annuler",
  confirm: "Confirmer",

  hashtag: "Hashtag",
  hashtagPlaceholder: "mirage, ww2, anime…",
  search: "Chercher",
  sortBy: "Trier par",
  sortPopular: "Les plus populaires",
  sortRecent: "Les plus récents",
  sortDownloads: "Les plus téléchargés",
  sortComments: "Les plus commentés",
  all: "Tous",
  filterCountry: "Pays",
  filterType: "Type de véhicule",
  filterClass: "Classe",
  filterVehicle: "Véhicule",
  reset: "Réinitialiser",
  resetFilters: "Réinitialiser les filtres",
  noMatch: "Aucune correspondance",
  noResults: "Aucun résultat",
  noResultsHashtag:
    "Ce hashtag n'existe peut-être pas. Les filtres véhicule restent plus fiables.",
  noResultsFilters: "Essaie d'élargir les filtres.",
  previous: "Précédent",
  next: "Suivant",
  page: "Page {n}",
  endOfList: "Fin de la liste.",
  removeFilter: "Retirer ce filtre",
  clearSearch: "Effacer la recherche",
  filtersFailed:
    "Les filtres n'ont pas pu être chargés depuis Live. La navigation, le tri et l'installation restent disponibles.",
  hashtagNote:
    "Les hashtags sont saisis par les auteurs, la couverture est donc inégale — les filtres véhicule restent plus fiables.",
  searchingOn: "Recherche sur {tag}",

  noPreview: "pas d'aperçu",
  imageCount: "{n} images",
  imagePosition: "aperçu {n} / {total}",
  likes: "J'aime",
  views: "Vues",
  downloads: "Téléch.",
  comments: "Comm.",
  previousImage: "Image précédente",
  nextImage: "Image suivante",
  close: "Fermer",
  resetZoom: "réinitialiser",
  viewOnLive: "Voir sur WT Live",
  localOnly:
    "Installé localement, visible de toi seul. Rien n'est transmis au serveur de jeu.",
  otherCreations: "Autres créations",
  loadingCreations: "Chargement des créations de l'auteur…",
  noOtherCreations: "Aucun autre camouflage de cet auteur.",
  uploadedOn: "mis en ligne le {date}",

  byAuthor: "Camouflages de {name}",
  authorPage: "Voir la page auteur",
  backToBrowse: "Retour à la navigation",
  authorEmpty: "Cet auteur n'a aucun camouflage sur cette page.",
  authorNote:
    "Le feed d'un auteur contient aussi des captures et des vidéos ; seuls les camouflages installables sont listés.",

  installedTitle: "Camouflages installés",
  installedEmpty: "Aucun camouflage installé par l'application.",
  installedEmptyHelp:
    "Seuls les dossiers posés par l'application. Ceux déjà présents dans UserSkins ne sont jamais touchés.",
  installedOn: "Installé le",
  refresh: "Rafraîchir",
  favorites: "Favoris",
  addFavorite: "Ajouter aux favoris",
  removeFavorite: "Retirer des favoris",
  favoritesEmpty: "Aucun auteur en favori pour le moment.",
  favoritesHelp: "Ajoute un auteur depuis sa page pour suivre ce qu'il publie.",
  share: "Partager",
  installWithSize: "Installer ({size})",
  favorite: "Favori",
  shareCopied: "Lien copié dans le presse-papiers.",
  copyAppLink: "Copier le lien app",
  appLinkCopied: "Lien app copié. Il ouvre directement l'application.",
  linkOpened: "Ouvert depuis un lien.",
  linkNotFound: "Ce lien ne pointe vers rien que l'application sache ouvrir.",
  pasteHint: "Tu peux aussi coller ici un lien War Thunder Live.",
  addedOn: "ajouté le {date}",
  refreshing: "Rafraîchissement…",
  updateAvailable: "Mise à jour disponible",
  updateNow: "Mettre à jour",
  foreignTitle: "Déjà dans UserSkins",
  foreignHelp: "Dossiers que l'application n'a pas posés. Ils sont listés pour information et ne sont jamais modifiés ni supprimés.",
  foreignCount: "{n} dossiers",
  lastChecked: "vérifié {date}",
  never: "jamais",
  installedCount: "{n} camouflages · {size} dans UserSkins",
  content: "Contenu",
  folderName: "Dossier",

  externalTitle: "Quitter l'application ?",
  externalBody: "Ce lien s'ouvre dans ton navigateur, en dehors de l'application.",
  externalOpen: "Ouvrir dans le navigateur",

  firstRun: "Premier lancement",
  setupTitle: "Où est installé War Thunder ?",
  setupIntro:
    "Indique le dossier racine du jeu. Les camouflages seront installés dans son sous-dossier UserSkins.",
  setupField: "Dossier du jeu",
  browse: "Parcourir…",
  detecting: "Recherche de l'installation via Steam…",
  foundViaSteam: "Trouvé via Steam. Destination :",
  skinsDestination: "Destination des camouflages",
  checking: "Vérification…",
  continueLabel: "Continuer",
  setupFootnote:
    "Les contenus installés sont visibles de toi seul, en local. Ils ne sont jamais transmis au serveur de jeu.",
  invalidFolder: "Dossier invalide.",

  loading: "Chargement…",
  retry: "Réessayer",
  installedToast: "{name} installé.",
  uninstalledToast: "{name} désinstallé.",
  installFailed: "Échec de l'installation : {reason}",
  uninstallFailed: "Échec de la désinstallation : {reason}",

  E_NO_GAMEDIR: "Le dossier du jeu n'est pas configuré.",
  E_API: "War Thunder Live n'a pas répondu comme attendu.",
  E_FILTERS_BLOCK:
    "Live a changé la structure de sa page : les filtres n'ont pas pu être lus.",
  E_DOWNLOAD: "Le téléchargement a échoué.",
  E_BAD_SOURCE: "Ce fichier n'est pas servi par War Thunder Live. Téléchargement refusé.",
  E_DOWNLOAD_TOO_BIG: "Cette archive dépasse la taille acceptée par l'application.",
  E_DOWNLOAD_STALLED: "Le téléchargement ne répond plus.",
  E_ARCHIVE_TOO_BIG:
    "Cette archive se décompresse bien au-delà de ce que l'application accepte.",
  E_EMPTY_ARCHIVE: "L'archive est vide, il n'y a rien à installer.",
  E_OUTSIDE_DEST:
    "L'archive a tenté d'écrire hors de UserSkins. Installation interrompue.",
  E_BAD_NAME: "Ce nom de dossier ne peut pas être utilisé.",
  E_BAD_URL: "Lien invalide.",
  E_BAD_SCHEME: "Ce lien utilise un schéma que l'application refuse d'ouvrir.",
  E_UNKNOWN_CONTENT: "Type de contenu inconnu.",
  E_UNKNOWN_SORT: "Tri inconnu.",
  E_NO_INSTALLER: "Ce type de contenu n'est pas encore installable.",
  E_NO_SIGHTS_DIR: "Dossier des viseurs introuvable. Lance le jeu une fois pour qu'il le crée.",
  E_UNKNOWN_LAYOUT: "Cette archive n'a pas une structure que l'application sache placer. Installe-la à la main si tu y tiens.",
  E_BAD_ARGS: "L'application a envoyé une requête malformée. Rien n'a été modifié.",
  E_TOO_FAST: "Trop de liens ouverts d'un coup. Réessaie dans un instant.",
  E_NOT_INSTALLED:
    "Ce contenu n'est pas suivi comme installé par l'application : il n'a pas été touché.",
  V_EMPTY: "Aucun dossier fourni.",
  V_NOT_FOUND: "Ce dossier n'existe pas.",
  V_NOT_DIR: "Ceci n'est pas un dossier.",
  V_NO_MARKERS:
    "Aucun fichier .vromfs.bin ici : ça ne ressemble pas à une installation War Thunder.",
  pickTitle: "Dossier d'installation de War Thunder",
  pickButton: "Choisir",
};

const ru: Record<Key, string> = {
  appName: "War Thunder Content Manager",
  brandTop: "War Thunder",
  brandBottom: "Content Manager",
  monogram: "WT",
  contentCamouflages: "Камуфляжи",
  contentType: "Содержимое",


  tabBrowse: "Обзор",
  tabInstalled: "Установленные",
  soon: "Скоро",
  navSights: "Прицелы",
  navSounds: "Звуковые моды",
  gameFolder: "Папка игры",
  open: "Открыть",
  change: "Изменить",
  openSkinsFolder: "Открыть UserSkins",
  changeFolder: "Сменить папку",
  language: "Язык",

  install: "Установить",
  installing: "Установка…",
  uninstall: "Удалить",
  uninstalling: "Удаление…",
  downloading: "Загрузка",
  extracting: "Распаковка",
  storing: "Размещение в UserSkins",
  installTitle: "Установить этот камуфляж",
  installNamed: "Установить «{name}»",
  installNameLabel: "Имя папки",
  installNameHelp:
    "Это имя игра показывает в списке камуфляжей. Выберите то, что легко узнаете.",
  installNameTaken: "Папка с таким именем уже существует и будет заменена.",
  installNameInvalid: "Такое имя использовать нельзя.",
  cancel: "Отмена",
  confirm: "Подтвердить",

  hashtag: "Хэштег",
  hashtagPlaceholder: "mirage, ww2, anime…",
  search: "Искать",
  sortBy: "Сортировка",
  sortPopular: "Популярные",
  sortRecent: "Новые",
  sortDownloads: "Часто загружаемые",
  sortComments: "Часто комментируемые",
  all: "Все",
  filterCountry: "Страна",
  filterType: "Тип техники",
  filterClass: "Класс",
  filterVehicle: "Техника",
  reset: "Сбросить",
  resetFilters: "Сбросить фильтры",
  noMatch: "Совпадений нет",
  noResults: "Ничего не найдено",
  noResultsHashtag: "Такого хэштега может не быть. Фильтры по технике надёжнее.",
  noResultsFilters: "Попробуйте ослабить фильтры.",
  previous: "Назад",
  next: "Вперёд",
  page: "Страница {n}",
  endOfList: "Конец списка.",
  removeFilter: "Снять этот фильтр",
  clearSearch: "Очистить поиск",
  filtersFailed:
    "Не удалось загрузить фильтры с Live. Просмотр, сортировка и установка по-прежнему работают.",
  hashtagNote:
    "Хэштеги проставляют сами авторы, поэтому покрытие неравномерное — фильтры по технике надёжнее.",
  searchingOn: "Поиск по {tag}",

  noPreview: "нет превью",
  imageCount: "{n} изобр.",
  imagePosition: "превью {n} / {total}",
  likes: "Лайки",
  views: "Просмотры",
  downloads: "Загрузки",
  comments: "Комментарии",
  previousImage: "Предыдущее изображение",
  nextImage: "Следующее изображение",
  close: "Закрыть",
  resetZoom: "сбросить",
  viewOnLive: "Открыть на WT Live",
  localOnly:
    "Установлено локально и видно только вам. На игровой сервер ничего не передаётся.",
  otherCreations: "Другие работы",
  loadingCreations: "Загрузка работ автора…",
  noOtherCreations: "У этого автора нет других камуфляжей.",
  uploadedOn: "опубликовано {date}",

  byAuthor: "Камуфляжи автора {name}",
  authorPage: "Страница автора",
  backToBrowse: "Вернуться к обзору",
  authorEmpty: "На этой странице у автора нет камуфляжей.",
  authorNote:
    "В ленте автора есть также скриншоты и видео; здесь показаны только камуфляжи, которые можно установить.",

  installedTitle: "Установленные камуфляжи",
  installedEmpty: "Приложение пока ничего не установило.",
  installedEmptyHelp:
    "Только папки, созданные приложением. Те, что уже были в UserSkins, оно не трогает.",
  installedOn: "Установлено",
  refresh: "Обновить",
  favorites: "Избранное",
  addFavorite: "Добавить в избранное",
  removeFavorite: "Убрать из избранного",
  favoritesEmpty: "Пока нет избранных авторов.",
  favoritesHelp: "Добавьте автора с его страницы, чтобы следить за новыми работами.",
  share: "Поделиться",
  installWithSize: "Установить ({size})",
  favorite: "В избранном",
  shareCopied: "Ссылка скопирована в буфер обмена.",
  copyAppLink: "Скопировать ссылку приложения",
  appLinkCopied: "Ссылка приложения скопирована. Она открывается прямо в приложении.",
  linkOpened: "Открыто по ссылке.",
  linkNotFound: "Эта ссылка не ведёт ни к чему, что приложение умеет открыть.",
  pasteHint: "Сюда также можно вставить ссылку War Thunder Live.",
  addedOn: "добавлено {date}",
  refreshing: "Обновление…",
  updateAvailable: "Доступно обновление",
  updateNow: "Обновить",
  foreignTitle: "Уже в UserSkins",
  foreignHelp: "Папки, которые приложение не создавало. Они показаны для справки и никогда не изменяются и не удаляются.",
  foreignCount: "{n} папок",
  lastChecked: "проверено {date}",
  never: "никогда",
  installedCount: "{n} камуфляжей · {size} в UserSkins",
  content: "Содержимое",
  folderName: "Папка",

  externalTitle: "Выйти из приложения?",
  externalBody: "Эта ссылка откроется в браузере, за пределами приложения.",
  externalOpen: "Открыть в браузере",

  firstRun: "Первый запуск",
  setupTitle: "Где установлена War Thunder?",
  setupIntro:
    "Укажите корневую папку игры. Камуфляжи устанавливаются в её подпапку UserSkins.",
  setupField: "Папка игры",
  browse: "Обзор…",
  detecting: "Поиск установленной игры через Steam…",
  foundViaSteam: "Найдено через Steam. Назначение:",
  skinsDestination: "Камуфляжи попадут в",
  checking: "Проверка…",
  continueLabel: "Продолжить",
  setupFootnote:
    "Установленное содержимое видно только вам, локально. На игровой сервер оно не передаётся.",
  invalidFolder: "Недопустимая папка.",

  loading: "Загрузка…",
  retry: "Повторить",
  installedToast: "«{name}» установлен.",
  uninstalledToast: "«{name}» удалён.",
  installFailed: "Не удалось установить: {reason}",
  uninstallFailed: "Не удалось удалить: {reason}",

  E_NO_GAMEDIR: "Папка игры не настроена.",
  E_API: "War Thunder Live ответил не так, как ожидалось.",
  E_FILTERS_BLOCK: "Live изменил структуру страницы: фильтры прочитать не удалось.",
  E_DOWNLOAD: "Загрузка не удалась.",
  E_BAD_SOURCE: "Этот файл раздаётся не с War Thunder Live. Загрузка отклонена.",
  E_DOWNLOAD_TOO_BIG: "Архив превышает размер, который принимает приложение.",
  E_DOWNLOAD_STALLED: "Загрузка перестала отвечать.",
  E_ARCHIVE_TOO_BIG:
    "При распаковке архив занимает намного больше, чем принимает приложение.",
  E_EMPTY_ARCHIVE: "Архив пуст, устанавливать нечего.",
  E_OUTSIDE_DEST:
    "Архив попытался записать файлы за пределы UserSkins. Установка прервана.",
  E_BAD_NAME: "Такое имя папки использовать нельзя.",
  E_BAD_URL: "Недопустимая ссылка.",
  E_BAD_SCHEME: "Приложение не открывает ссылки с такой схемой.",
  E_UNKNOWN_CONTENT: "Неизвестный тип содержимого.",
  E_UNKNOWN_SORT: "Неизвестный порядок сортировки.",
  E_NO_INSTALLER: "Этот тип содержимого пока нельзя установить.",
  E_NO_SIGHTS_DIR: "Папка прицелов не найдена. Запустите игру один раз, чтобы она её создала.",
  E_UNKNOWN_LAYOUT: "Структуру этого архива приложение разместить не умеет. При необходимости установите вручную.",
  E_BAD_ARGS: "Приложение отправило некорректный запрос. Ничего не изменено.",
  E_TOO_FAST: "Слишком много ссылок сразу. Повторите через мгновение.",
  E_NOT_INSTALLED:
    "Приложение не считает это содержимое установленным, поэтому ничего не тронуло.",
  V_EMPTY: "Папка не указана.",
  V_NOT_FOUND: "Такой папки не существует.",
  V_NOT_DIR: "Это не папка.",
  V_NO_MARKERS:
    "Здесь нет файлов .vromfs.bin — на установленную War Thunder это не похоже.",
  pickTitle: "Папка установки War Thunder",
  pickButton: "Выбрать",
};

const zh: Record<Key, string> = {
  appName: "War Thunder Content Manager",
  brandTop: "War Thunder",
  brandBottom: "Content Manager",
  monogram: "WT",
  contentCamouflages: "涂装",
  contentType: "内容",


  tabBrowse: "浏览",
  tabInstalled: "已安装",
  soon: "即将推出",
  navSights: "瞄准镜",
  navSounds: "音效模组",
  gameFolder: "游戏文件夹",
  open: "打开",
  change: "更改",
  openSkinsFolder: "打开 UserSkins",
  changeFolder: "更改文件夹",
  language: "语言",

  install: "安装",
  installing: "正在安装…",
  uninstall: "卸载",
  uninstalling: "正在移除…",
  downloading: "正在下载",
  extracting: "正在解压",
  storing: "正在放入 UserSkins",
  installTitle: "安装此涂装",
  installNamed: "安装《{name}》",
  installNameLabel: "文件夹名称",
  installNameHelp: "这是游戏涂装列表中显示的名称。请取一个你能认出来的名字。",
  installNameTaken: "同名文件夹已存在，将被替换。",
  installNameInvalid: "无法使用该名称。",
  cancel: "取消",
  confirm: "确认",

  hashtag: "话题标签",
  hashtagPlaceholder: "mirage、ww2、anime…",
  search: "搜索",
  sortBy: "排序方式",
  sortPopular: "最受欢迎",
  sortRecent: "最新发布",
  sortDownloads: "下载最多",
  sortComments: "评论最多",
  all: "全部",
  filterCountry: "国家",
  filterType: "载具类型",
  filterClass: "类别",
  filterVehicle: "载具",
  reset: "重置",
  resetFilters: "重置筛选",
  noMatch: "无匹配项",
  noResults: "没有结果",
  noResultsHashtag: "该标签可能不存在。按载具筛选更可靠。",
  noResultsFilters: "试试放宽筛选条件。",
  previous: "上一页",
  next: "下一页",
  page: "第 {n} 页",
  endOfList: "已到列表末尾。",
  removeFilter: "清除此筛选",
  clearSearch: "清除搜索",
  filtersFailed: "无法从 Live 载入筛选条件。浏览、排序和安装仍然可用。",
  hashtagNote: "话题标签由作者自行填写，覆盖并不均匀——按载具筛选更可靠。",
  searchingOn: "正在搜索 {tag}",

  noPreview: "无预览",
  imageCount: "{n} 张图片",
  imagePosition: "预览 {n} / {total}",
  likes: "点赞",
  views: "浏览量",
  downloads: "下载量",
  comments: "评论",
  previousImage: "上一张图片",
  nextImage: "下一张图片",
  close: "关闭",
  resetZoom: "重置",
  viewOnLive: "在 WT Live 上查看",
  localOnly: "仅安装在本地，只有你能看到。不会发送到游戏服务器。",
  otherCreations: "其他作品",
  loadingCreations: "正在载入该作者的作品…",
  noOtherCreations: "该作者没有其他涂装。",
  uploadedOn: "发布于 {date}",

  byAuthor: "{name} 的涂装",
  authorPage: "查看作者页面",
  backToBrowse: "返回浏览",
  authorEmpty: "该作者在本页没有涂装。",
  authorNote: "作者的动态中还包含截图和视频；此处只列出可安装的涂装。",

  installedTitle: "已安装的涂装",
  installedEmpty: "本应用尚未安装任何涂装。",
  installedEmptyHelp: "仅显示由本应用放入的文件夹。UserSkins 中原有的文件夹不会被改动。",
  installedOn: "安装于",
  refresh: "刷新",
  favorites: "收藏",
  addFavorite: "加入收藏",
  removeFavorite: "取消收藏",
  favoritesEmpty: "还没有收藏的作者。",
  favoritesHelp: "在作者页面加入收藏，即可关注他的新作品。",
  share: "分享",
  installWithSize: "安装（{size}）",
  favorite: "收藏",
  shareCopied: "链接已复制到剪贴板。",
  copyAppLink: "复制应用链接",
  appLinkCopied: "应用链接已复制，可直接在应用中打开。",
  linkOpened: "已通过链接打开。",
  linkNotFound: "此链接不指向应用能够打开的内容。",
  pasteHint: "也可以在此粘贴 War Thunder Live 链接。",
  addedOn: "收藏于 {date}",
  refreshing: "正在刷新…",
  updateAvailable: "有可用更新",
  updateNow: "更新",
  foreignTitle: "UserSkins 中已有的内容",
  foreignHelp: "并非本应用放入的文件夹。此处仅作参考，绝不会被修改或删除。",
  foreignCount: "{n} 个文件夹",
  lastChecked: "检查于 {date}",
  never: "从未",
  installedCount: "{n} 个涂装 · UserSkins 中占用 {size}",
  content: "内容",
  folderName: "文件夹",

  externalTitle: "离开应用？",
  externalBody: "该链接将在浏览器中打开，离开本应用。",
  externalOpen: "在浏览器中打开",

  firstRun: "首次启动",
  setupTitle: "War Thunder 安装在哪里？",
  setupIntro: "请指向游戏的根文件夹。涂装会安装到其下的 UserSkins 子文件夹。",
  setupField: "游戏文件夹",
  browse: "浏览…",
  detecting: "正在通过 Steam 查找安装位置…",
  foundViaSteam: "已通过 Steam 找到。目标位置：",
  skinsDestination: "涂装将安装到",
  checking: "正在检查…",
  continueLabel: "继续",
  setupFootnote: "已安装的内容仅在本地，只有你能看到，绝不会发送到游戏服务器。",
  invalidFolder: "文件夹无效。",

  loading: "载入中…",
  retry: "重试",
  installedToast: "已安装《{name}》。",
  uninstalledToast: "已移除《{name}》。",
  installFailed: "安装失败：{reason}",
  uninstallFailed: "移除失败：{reason}",

  E_NO_GAMEDIR: "尚未设置游戏文件夹。",
  E_API: "War Thunder Live 的响应不符合预期。",
  E_FILTERS_BLOCK: "Live 更改了页面结构，无法读取筛选条件。",
  E_DOWNLOAD: "下载失败。",
  E_BAD_SOURCE: "该文件并非由 War Thunder Live 提供，已拒绝下载。",
  E_DOWNLOAD_TOO_BIG: "该压缩包超出本应用允许的大小。",
  E_DOWNLOAD_STALLED: "下载已无响应。",
  E_ARCHIVE_TOO_BIG: "该压缩包解压后远超本应用允许的大小。",
  E_EMPTY_ARCHIVE: "压缩包是空的，没有可安装的内容。",
  E_OUTSIDE_DEST: "压缩包试图写入 UserSkins 之外的位置，安装已中止。",
  E_BAD_NAME: "无法使用该文件夹名称。",
  E_BAD_URL: "链接无效。",
  E_BAD_SCHEME: "本应用不会打开使用该协议的链接。",
  E_UNKNOWN_CONTENT: "未知的内容类型。",
  E_UNKNOWN_SORT: "未知的排序方式。",
  E_NO_INSTALLER: "该内容类型暂时无法安装。",
  E_NO_SIGHTS_DIR: "找不到瞄准镜文件夹。请先启动一次游戏，让它创建该文件夹。",
  E_UNKNOWN_LAYOUT: "本应用无法识别该压缩包的结构。如有需要请手动安装。",
  E_BAD_ARGS: "应用发送了格式错误的请求，未做任何更改。",
  E_TOO_FAST: "同时打开的链接过多，请稍后再试。",
  E_NOT_INSTALLED: "本应用未将此内容记录为已安装，因此没有改动任何文件。",
  V_EMPTY: "未指定文件夹。",
  V_NOT_FOUND: "该文件夹不存在。",
  V_NOT_DIR: "这不是一个文件夹。",
  V_NO_MARKERS: "此处没有 .vromfs.bin 文件，看起来不是 War Thunder 的安装目录。",
  pickTitle: "War Thunder 安装文件夹",
  pickButton: "选择",
};

export const DICTS: Record<Lang, Record<Key, string>> = { en, fr, ru, zh };

/**
 * Locale BCP-47 par langue, pour Intl. Ce n'est pas cosmétique : Intl donne le
 * bon séparateur décimal (18.4 MB / 18,4 Mo), la bonne abréviation d'unité
 * (MB / Mo / МБ) et la bonne notation compacte (9.7K / 9,7 k / 9,7 тыс.).
 * Réécrire ça à la main serait faux dans au moins une langue.
 */
export const LOCALE: Record<Lang, string> = {
  en: "en",
  fr: "fr",
  ru: "ru",
  zh: "zh-CN",
};

const STORAGE_KEY = "wtcm.lang";

export function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGS.some((l) => l.code === saved)) return saved as Lang;
  } catch {
    // navigation privée ou stockage bloqué : on retombe sur la valeur par défaut
  }
  return "en";
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* le choix ne vaudra que pour la session */
  }
}

export type Vars = Record<string, string | number>;

/**
 * Remplace les jetons `{nom}`. Un jeton sans valeur fournie est laissé tel quel
 * plutôt que remplacé par « undefined » : un texte visiblement incomplet se
 * remarque et se corrige, un « undefined » ressemble à un bug de données.
 */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : whole
  );
}

export function translator(lang: Lang) {
  const dict = DICTS[lang] ?? DICTS.en;
  return (key: Key, vars?: Vars): string => interpolate(dict[key] ?? DICTS.en[key], vars);
}

export type T = ReturnType<typeof translator>;
