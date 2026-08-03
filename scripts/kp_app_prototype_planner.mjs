import { validateKpContract } from "./kp_reference_contracts.mjs";

export const APP_PROTOTYPE_PLANNER_VERSION = "app-prototype-planner-v1";

const SCREEN_LIMIT = 60;
const MIN_SCREEN_COUNT = 48;
const SUPPORTED_LOCALES = new Set(["uz-Latn", "ru-RU", "en"]);
const SYSTEM_ACTOR_TYPES = new Set(["system_actor", "unknown"]);
const TECHNICAL_TERMS = /\b(api|database|db|cache|infrastructure|server|backend|devops|ci\/cd|kubernetes)\b/i;

const DICTIONARY = {
  "ru-RU": {
    roles: "Роли",
    customer: "Клиент",
    operator: "Оператор",
    admin: "Админ",
    seller: "Продавец",
    workspace: "Рабочее место",
    overview: "Обзор",
    onboarding: "Старт",
    login: "Вход",
    home: "Главная",
    catalog: "Каталог",
    product: "Карточка",
    cart: "Корзина",
    checkout: "Оформление",
    payment: "Оплата",
    confirmation: "Подтверждение",
    tracking: "Статус заказа",
    profile: "Профиль",
    dashboard: "Дашборд",
    leads: "Лиды",
    leadDetails: "Карточка лида",
    pipeline: "Воронка",
    tasks: "Задачи",
    clients: "Клиенты",
    reports: "Отчеты",
    settings: "Настройки",
    list: "Список",
    details: "Детали",
    form: "Форма",
    history: "История",
    analytics: "Аналитика",
    success: "Готово",
    notifications: "Уведомления",
    search: "Поиск",
    next: "Далее",
    open: "Открыть",
    submit: "Отправить",
    pay: "Оплатить",
    done: "Готово",
    configure: "Настроить",
    projectDescription: "Интерактивный прототип клиентского приложения",
    demo: "Демо",
    status: "Статус",
    active: "Активно",
  },
  "uz-Latn": {
    roles: "Rollar",
    customer: "Mijoz",
    operator: "Operator",
    admin: "Admin",
    seller: "Sotuvchi",
    workspace: "Ish joyi",
    overview: "Umumiy",
    onboarding: "Boshlash",
    login: "Kirish",
    home: "Bosh sahifa",
    catalog: "Katalog",
    product: "Mahsulot",
    cart: "Savat",
    checkout: "Rasmiylashtirish",
    payment: "To'lov",
    confirmation: "Tasdiq",
    tracking: "Buyurtma holati",
    profile: "Profil",
    dashboard: "Dashboard",
    leads: "Lidlar",
    leadDetails: "Lid kartasi",
    pipeline: "Voronka",
    tasks: "Vazifalar",
    clients: "Mijozlar",
    reports: "Hisobotlar",
    settings: "Sozlamalar",
    list: "Ro'yxat",
    details: "Tafsilot",
    form: "Forma",
    history: "Tarix",
    analytics: "Analitika",
    success: "Tayyor",
    notifications: "Bildirishnomalar",
    search: "Qidiruv",
    next: "Keyingi",
    open: "Ochish",
    submit: "Yuborish",
    pay: "To'lash",
    done: "Tayyor",
    configure: "Sozlash",
    projectDescription: "Mijoz ilovasining interaktiv prototipi",
    demo: "Demo",
    status: "Holat",
    active: "Faol",
  },
  en: {
    roles: "Roles",
    customer: "Customer",
    operator: "Operator",
    admin: "Admin",
    seller: "Seller",
    workspace: "Workspace",
    overview: "Overview",
    onboarding: "Start",
    login: "Sign in",
    home: "Home",
    catalog: "Catalog",
    product: "Product",
    cart: "Cart",
    checkout: "Checkout",
    payment: "Payment",
    confirmation: "Confirmation",
    tracking: "Order status",
    profile: "Profile",
    dashboard: "Dashboard",
    leads: "Leads",
    leadDetails: "Lead details",
    pipeline: "Pipeline",
    tasks: "Tasks",
    clients: "Clients",
    reports: "Reports",
    settings: "Settings",
    list: "List",
    details: "Details",
    form: "Form",
    history: "History",
    analytics: "Analytics",
    success: "Done",
    notifications: "Notifications",
    search: "Search",
    next: "Next",
    open: "Open",
    submit: "Submit",
    pay: "Pay",
    done: "Done",
    configure: "Configure",
    projectDescription: "Interactive client application prototype",
    demo: "Demo",
    status: "Status",
    active: "Active",
  },
};

export async function buildAndValidateAppPrototypeSpec(input = {}) {
  const spec = buildAppPrototypeSpec(input);
  await validateAppPrototypeSpec(spec);
  return spec;
}

export function buildAppPrototypeSpec({
  requestId,
  publicId,
  locale,
  proposalModel = {},
  semanticModel = {},
  proposalPackage = {},
  visualStyleProfile = {},
  themeTokens = null,
} = {}) {
  const safeLocale = SUPPORTED_LOCALES.has(locale) ? locale : resolveLocale(proposalModel, semanticModel);
  const t = DICTIONARY[safeLocale] || DICTIONARY.en;
  const packageSemantic = proposalPackage.semanticModel || semanticModel || {};
  const packageProposal = proposalPackage.proposalModel || proposalModel || {};
  const project = packageSemantic.project || {};
  const productFamily = detectProductFamily(packageProposal, packageSemantic);
  const roles = resolveRoles(packageSemantic, productFamily, t);
  const sourceRefs = sourceRefsFor(packageSemantic, packageProposal);
  const context = {
    t,
    roles,
    productFamily,
    semanticModel: packageSemantic,
    proposalModel: packageProposal,
    sourceRefs,
  };

  let screens = productFamily === "marketplace"
    ? marketplaceScreens(context)
    : productFamily === "fintech"
      ? fintechScreens(context)
      : productFamily === "crm"
        ? crmScreens(context)
        : businessScreens(context);

  screens = enforceScreenCount(dedupeScreens(screens), context).slice(0, SCREEN_LIMIT);
  screens = connectScreenActions(screens, context);

  return {
    schemaVersion: "1.0",
    requestId: requestId || packageSemantic.requestId || packageProposal.requestId || "KP-LOCAL",
    publicId,
    locale: safeLocale,
    project: {
      name: cleanText(project.name || packageProposal.title || packageProposal.brief?.projectName || "Digital product", 120),
      type: productFamily,
      description: cleanText(project.category || packageProposal.brief?.type || t.projectDescription, 260),
    },
    theme: normalizeTheme(visualStyleProfile, themeTokens),
    navigation: buildNavigation(screens, roles, productFamily, t),
    screens,
  };
}

export async function validateAppPrototypeSpec(spec) {
  const validation = await validateKpContract("appPrototypeSpec", spec, { throwOnError: false });
  const findings = [...validation.errors.map((error) => ({
    code: "APP_PROTOTYPE_SCHEMA_INVALID",
    severity: "BLOCKER",
    message: `${error.path} ${error.message}`,
  }))];
  const screenIds = spec?.screens?.map((screen) => screen.id) || [];
  const screenSet = new Set(screenIds);
  if (screenSet.size !== screenIds.length) {
    findings.push({ code: "APP_PROTOTYPE_SCREEN_IDS_DUPLICATED", severity: "BLOCKER", message: "Screen ids must be unique." });
  }
  const navRefs = (spec?.navigation || []).flatMap((group) => group.screenIds || []);
  const navSet = new Set(navRefs);
  for (const id of navRefs) {
    if (!screenSet.has(id)) findings.push({ code: "APP_PROTOTYPE_NAVIGATION_INVALID", severity: "BLOCKER", message: `Navigation references unknown screen: ${id}` });
  }
  for (const id of screenIds) {
    if (!navSet.has(id)) findings.push({ code: "APP_PROTOTYPE_NAVIGATION_MISSING_SCREEN", severity: "BLOCKER", message: `Screen is missing from navigation: ${id}` });
  }
  if (navSet.size !== navRefs.length || navRefs.length !== screenIds.length) {
    findings.push({ code: "APP_PROTOTYPE_NAVIGATION_NOT_EXACT", severity: "BLOCKER", message: "Navigation must include each screen exactly once." });
  }
  for (const screen of spec?.screens || []) {
    for (const action of screen.actions || []) {
      if (!screenSet.has(action.targetScreenId)) {
        findings.push({ code: "APP_PROTOTYPE_ACTION_TARGET_INVALID", severity: "BLOCKER", message: `Action ${screen.id}/${action.id} references unknown screen: ${action.targetScreenId}` });
      }
    }
  }
  const contentSignatures = (spec?.screens || []).map((screen) => JSON.stringify({
    layout: screen.content?.layout,
    metrics: screen.content?.metrics,
    items: screen.content?.items,
    fields: screen.content?.fields,
    steps: screen.content?.steps,
    tabs: screen.content?.tabs,
    chart: screen.content?.chart,
  }));
  const uniqueContentRatio = contentSignatures.length
    ? new Set(contentSignatures).size / contentSignatures.length
    : 0;
  if (uniqueContentRatio < 0.8) {
    findings.push({
      code: "APP_PROTOTYPE_SCREEN_CONTENT_REPETITIVE",
      severity: "BLOCKER",
      message: `Only ${Math.round(uniqueContentRatio * 100)}% of screens have distinct content.`,
    });
  }
  const qa = {
    status: findings.some((finding) => finding.severity === "BLOCKER") ? "FAIL" : "PASS",
    findings,
  };
  if (qa.status !== "PASS") {
    const error = new Error(`APP_PROTOTYPE_SPEC_INVALID: ${findings.map((finding) => finding.message).join("; ")}`);
    error.code = "APP_PROTOTYPE_SPEC_INVALID";
    error.qa = qa;
    throw error;
  }
  return qa;
}

function marketplaceScreens(context) {
  const { t } = context;
  return catalogScreens(context, [
    ...sharedScreenDefinitions(t),
    ["home", "dashboard", t.home, "Персональная витрина и быстрые действия"],
    ["catalog", "product_grid", t.catalog, "Поиск и выбор товаров"],
    ["categories", "product_grid", "Категории", "Навигация по ассортименту и подборкам"],
    ["catalog_filters", "form", "Фильтры", "Цена, категория, наличие и рейтинг"],
    ["search_suggestions", "list", "Подсказки поиска", "Популярные и недавние запросы"],
    ["search_empty", "empty_state", "Ничего не найдено", "Рекомендации при пустой выдаче"],
    ["product", "details", t.product, "Карточка товара с ключевыми параметрами"],
    ["product_gallery", "details", "Галерея товара", "Фото, варианты и ключевые характеристики"],
    ["product_reviews", "list", "Отзывы", "Оценки покупателей и ответы продавца"],
    ["favorites", "product_grid", "Избранное", "Сохраненные товары и подборки"],
    ["compare", "list", "Сравнение", "Сопоставление характеристик выбранных товаров"],
    ["cart", "list", t.cart, "Состав заказа перед оформлением"],
    ["cart_empty", "empty_state", "Корзина пуста", "Возврат к персональным рекомендациям"],
    ["checkout", "checkout", t.checkout, "Контакты, доставка и подтверждение"],
    ["delivery_address", "form", "Адрес доставки", "Добавление и проверка адреса"],
    ["delivery_method", "list", "Способ доставки", "Курьер, пункт выдачи или самовывоз"],
    ["pickup_points", "list", "Пункты выдачи", "Выбор удобного пункта получения"],
    ["promo_code", "form", "Промокод", "Применение скидки к заказу"],
    ["order_summary", "checkout", "Проверка заказа", "Итоговый состав, доставка и сумма"],
    ["payment_methods", "list", "Способ оплаты", "Карта, рассрочка или баланс"],
    ["payment", "payment", t.payment, "Подтверждение суммы и способа оплаты"],
    ["payment_processing", "stepper", "Оплата обрабатывается", "Промежуточный статус платежа"],
    ["confirmation", "success", t.confirmation, "Заказ принят в обработку"],
    ["orders", "history", "Мои заказы", "Активные и завершенные покупки"],
    ["order_details", "details", "Детали заказа", "Состав, оплата и действия по заказу"],
    ["tracking", "tracking", t.tracking, "Статусы исполнения заказа"],
    ["return_request", "form", "Оформление возврата", "Причина, товары и способ возврата"],
    ["return_status", "tracking", "Статус возврата", "Этапы проверки и возврата средств"],
    ["support", "list", "Поддержка", "Частые вопросы и каналы связи"],
    ["chat", "details", "Чат с поддержкой", "Диалог по заказу или возврату"],
    ["profile_orders", "history", "Покупки профиля", "История заказов и повторная покупка"],
    ["seller_workspace", "dashboard", `${t.seller} ${t.workspace}`, "Сводка по товарам, заказам и выручке", "seller"],
    ["seller_products", "product_grid", "Товары продавца", "Каталог, остатки и статусы публикации", "seller"],
    ["seller_product_create", "form", "Новый товар", "Контент, цена, варианты и остатки", "seller"],
    ["seller_orders", "list", "Заказы продавца", "Очередь сборки и передачи в доставку", "seller"],
    ["seller_order_details", "details", "Заказ продавца", "Позиции, покупатель и исполнение", "seller"],
    ["seller_analytics", "analytics", "Аналитика продавца", "Выручка, конверсия и товары", "seller"],
    ["admin_workspace", "analytics", `${t.admin} ${t.workspace}`, "Контроль качества и операционные метрики", "admin"],
    ["moderation", "list", "Модерация", "Проверка карточек и спорного контента", "admin"],
    ["reports", "analytics", t.reports, "Продажи, возвраты и качество сервиса", "admin"],
    ["settings", "settings", t.settings, "Параметры магазина и уведомлений", "admin"],
  ]);
}

function fintechScreens(context) {
  const { t } = context;
  return catalogScreens(context, [
    ...sharedScreenDefinitions(t),
    ["home", "dashboard", t.home, "Лимит, ближайший платеж и быстрые действия"],
    ["limit_overview", "details", "Доступный лимит", "Использованный остаток и условия"],
    ["limit_request", "form", "Заявка на лимит", "Данные для предварительной проверки"],
    ["personal_data", "form", "Личные данные", "Контакты и сведения для проверки"],
    ["identity_documents", "form", "Документ", "Паспортные данные и срок действия"],
    ["selfie", "form", "Селфи", "Подтверждение личности пользователя"],
    ["verification", "stepper", "Проверка", "Этапы идентификации и решения"],
    ["verification_wait", "stepper", "Проверяем данные", "Ожидание автоматического решения"],
    ["verification_manual", "stepper", "Ручная проверка", "Дополнительная проверка специалистом"],
    ["verification_failed", "error_state", "Нужны уточнения", "Исправление данных и повторная отправка"],
    ["offers", "list", "Предложения", "Доступные варианты рассрочки"],
    ["offer_details", "details", "Условия предложения", "Срок, платеж и полная стоимость"],
    ["calculator", "form", "Калькулятор", "Расчет платежа по сумме и сроку"],
    ["contract_review", "details", "Проверка договора", "Ключевые условия перед подписанием"],
    ["contract_sign", "form", "Подписание", "Подтверждение договора одноразовым кодом"],
    ["contract_success", "success", "Договор оформлен", "Лимит или покупка успешно активированы"],
    ["installments", "list", "Рассрочки", "Активные и закрытые договоры"],
    ["installment_details", "details", "Детали рассрочки", "Остаток, срок и действия по договору"],
    ["schedule", "history", "График платежей", "Будущие и выполненные платежи"],
    ["payment_methods", "list", "Способ оплаты", "Сохраненные карты и добавление новой"],
    ["payment", "payment", t.payment, "Подтверждение платежа по договору"],
    ["payment_processing", "stepper", "Платеж обрабатывается", "Проверка статуса операции"],
    ["payment_success", "success", "Платеж выполнен", "Квитанция и обновленный график"],
    ["history", "history", t.history, "Все операции по счету"],
    ["transaction_details", "details", "Детали операции", "Сумма, дата, статус и квитанция"],
    ["statements", "history", "Выписки", "Формирование и скачивание документов"],
    ["cashback", "dashboard", "Кешбэк", "Баланс вознаграждений и предложения"],
    ["qr_payment", "payment", "Оплата по QR", "Проверка получателя и суммы"],
    ["qr_scanner", "form", "Сканер QR", "Наведение камеры и ручной ввод"],
    ["merchants", "product_grid", "Магазины", "Партнеры и доступные предложения"],
    ["merchant_details", "details", "Карточка магазина", "Условия, адреса и доступные товары"],
    ["support", "list", "Поддержка", "Частые вопросы и обращения"],
    ["chat", "details", "Чат поддержки", "Диалог по договору или платежу"],
    ["documents", "list", "Документы", "Договоры, выписки и согласия"],
    ["document_details", "details", "Просмотр документа", "Реквизиты и действия с документом"],
    ["limits_settings", "settings", "Настройки лимита", "Уведомления и ограничения операций"],
    ["operator_workspace", "dashboard", `${t.operator} ${t.workspace}`, "Очередь проверок и обращений", "operator"],
    ["admin_workspace", "analytics", `${t.admin} ${t.workspace}`, "Риски, качество и операционные показатели", "admin"],
    ["reports", "analytics", t.reports, "Портфель, платежи и просрочка", "admin"],
    ["settings", "settings", t.settings, "Правила продукта и интеграции", "admin"],
    ["audit_log", "history", "Журнал аудита", "Критичные действия и изменения", "admin"],
  ]);
}

function crmScreens(context) {
  const { t } = context;
  return catalogScreens(context, [
    ...sharedScreenDefinitions(t, "operator"),
    ["dashboard", "dashboard", t.dashboard, "Продажи, задачи и ключевые отклонения", "operator"],
    ["activity_feed", "history", "Лента активности", "Последние события по клиентам и сделкам", "operator"],
    ["quick_create", "form", "Быстрое создание", "Лид, задача, контакт или сделка", "operator"],
    ["leads", "list", t.leads, "Рабочий список обращений", "operator"],
    ["lead_filters", "form", "Фильтры лидов", "Источник, ответственный, статус и дата", "operator"],
    ["lead_create", "form", "Новый лид", "Контакты, источник и следующий шаг", "operator"],
    ["lead_details", "details", t.leadDetails, "Контекст обращения и история коммуникаций", "operator"],
    ["lead_edit", "form", "Редактирование лида", "Актуализация контактов и параметров", "operator"],
    ["lead_history", "history", "История лида", "Изменения, звонки и сообщения", "operator"],
    ["lead_documents", "list", "Документы лида", "Файлы, предложения и согласия", "operator"],
    ["lead_notes", "list", "Заметки", "Рабочий контекст команды", "operator"],
    ["lead_qualify", "stepper", "Квалификация", "Потребность, бюджет и готовность", "operator"],
    ["lead_assign", "form", "Назначить ответственного", "Передача лида сотруднику или команде", "operator"],
    ["lead_convert", "success", "Лид квалифицирован", "Создание клиента и сделки", "operator"],
    ["pipeline", "stepper", t.pipeline, "Этапы обработки сделок", "operator"],
    ["pipeline_stage", "list", "Этап воронки", "Сделки выбранного этапа", "operator"],
    ["pipeline_move", "form", "Смена этапа", "Причина и следующее действие", "operator"],
    ["pipeline_forecast", "analytics", "Прогноз продаж", "Ожидаемая выручка и вероятность", "operator"],
    ["deal_details", "details", "Карточка сделки", "Сумма, этап, контакты и задачи", "operator"],
    ["deal_products", "list", "Состав сделки", "Продукты, количество и скидки", "operator"],
    ["deal_quote", "checkout", "Коммерческое предложение", "Состав, сумма и условия для клиента", "operator"],
    ["deal_approval", "stepper", "Согласование сделки", "Проверка скидки и нестандартных условий", "operator"],
    ["deal_won", "success", "Сделка выиграна", "Фиксация результата и следующих действий", "operator"],
    ["deal_lost", "form", "Сделка проиграна", "Причина отказа и конкуренты", "operator"],
    ["tasks", "list", t.tasks, "План работы сотрудника и команды", "operator"],
    ["task_details", "details", "Карточка задачи", "Срок, приоритет и связанный объект", "operator"],
    ["task_create", "form", "Новая задача", "Исполнитель, срок и напоминание", "operator"],
    ["calendar", "history", "Календарь", "Звонки, встречи и дедлайны", "operator"],
    ["clients", "list", t.clients, "Клиентская база", "operator"],
    ["client_details", "details", "Карточка клиента", "Контакты, сделки и активность", "operator"],
    ["client_contacts", "list", "Контакты клиента", "Лица, роли и каналы связи", "operator"],
    ["client_history", "history", "История клиента", "Все события и изменения", "operator"],
    ["reports", "analytics", t.reports, "Показатели продаж и конверсия", "admin"],
    ["report_sales", "analytics", "Отчет по продажам", "Выручка, план и динамика", "admin"],
    ["report_conversion", "analytics", "Конверсия воронки", "Переходы и потери между этапами", "admin"],
    ["report_team", "analytics", "Эффективность команды", "Нагрузка и результативность", "admin"],
    ["team", "profile", "Команда", "Сотрудники, роли и ответственность", "admin"],
    ["roles", "settings", "Роли", "Наборы прав для сотрудников", "admin"],
    ["permissions", "settings", "Права доступа", "Матрица действий и ограничений", "admin"],
    ["integrations", "settings", "Интеграции", "Телефония, почта и внешние сервисы", "admin"],
    ["settings", "settings", t.settings, "Справочники, статусы и правила", "admin"],
  ]);
}

function businessScreens(context) {
  const { t } = context;
  return catalogScreens(context, [
    ...sharedScreenDefinitions(t),
    ["dashboard", "dashboard", t.dashboard, "Главные показатели и действия"],
    ["activity_feed", "history", "Лента активности", "Последние события и изменения"],
    ["quick_create", "form", "Быстрое создание", "Новая запись или задача"],
    ["workspace", "list", t.workspace, "Ежедневный рабочий список"],
    ["workspace_filters", "form", "Фильтры", "Статус, ответственный и период"],
    ["workspace_empty", "empty_state", "Нет записей", "Пустое состояние рабочего списка"],
    ["details", "details", t.details, "Карточка объекта и связанные данные"],
    ["details_history", "history", "История изменений", "События по выбранному объекту"],
    ["details_documents", "list", "Связанные документы", "Файлы и версии по объекту"],
    ["form", "form", t.form, "Создание или обновление записи"],
    ["form_review", "checkout", "Проверка данных", "Итог перед отправкой"],
    ["workflow", "stepper", "Процесс", "Основной сценарий от заявки до результата"],
    ["workflow_queue", "list", "Очередь процесса", "Объекты, ожидающие обработки"],
    ["workflow_details", "details", "Этап процесса", "Контекст и доступные действия"],
    ["workflow_approval", "stepper", "Согласование", "Маршрут проверки и решения"],
    ["workflow_rejected", "error_state", "Нужны исправления", "Причина возврата и повторная отправка"],
    ["workflow_success", "success", "Процесс завершен", "Результат сохранен и доступен участникам"],
    ["tasks", "list", t.tasks, "Задачи пользователя и команды"],
    ["task_details", "details", "Карточка задачи", "Срок, приоритет и связанный объект"],
    ["task_create", "form", "Новая задача", "Исполнитель, срок и напоминание"],
    ["calendar", "history", "Календарь", "События, встречи и сроки"],
    ["clients", "list", t.clients, "Список клиентов и партнеров"],
    ["client_details", "details", "Карточка клиента", "Контакты, объекты и активность"],
    ["client_create", "form", "Новый клиент", "Основные данные и контакты"],
    ["client_history", "history", "История клиента", "Взаимодействия и изменения"],
    ["documents", "list", "Документы", "Файлы, статусы и версии"],
    ["document_details", "details", "Просмотр документа", "Реквизиты и действия"],
    ["history", "history", t.history, "Общий журнал изменений"],
    ["analytics", "analytics", t.analytics, "Операционные показатели", "admin"],
    ["reports", "analytics", t.reports, "Сводные отчеты по процессам", "admin"],
    ["report_details", "analytics", "Детали отчета", "Разрезы и динамика показателей", "admin"],
    ["team", "profile", "Команда", "Сотрудники и ответственность", "admin"],
    ["user_details", "profile", "Профиль сотрудника", "Роль, доступ и активность", "admin"],
    ["roles", "settings", "Роли", "Наборы прав пользователей", "admin"],
    ["permissions", "settings", "Права доступа", "Матрица действий и ограничений", "admin"],
    ["integrations", "settings", "Интеграции", "Подключенные внешние сервисы", "admin"],
    ["integration_details", "details", "Настройка интеграции", "Параметры и состояние подключения", "admin"],
    ["admin_workspace", "dashboard", `${t.admin} ${t.workspace}`, "Контроль процессов и исключений", "admin"],
    ["audit_log", "history", "Журнал аудита", "Критичные действия и изменения", "admin"],
    ["settings", "settings", t.settings, "Параметры, роли и справочники", "admin"],
    ["help", "list", "Помощь", "Инструкции и обращения"],
  ]);
}

function sharedScreenDefinitions(t, primaryRole = "buyer") {
  return [
    ["onboarding", "onboarding", t.onboarding, "Ценность продукта и быстрый старт", primaryRole],
    ["language", "list", "Язык", "Выбор языка интерфейса", primaryRole],
    ["login", "login", t.login, "Безопасный вход в приложение", primaryRole],
    ["login_otp", "form", "Код подтверждения", "Проверка одноразового кода", primaryRole],
    ["password_reset", "form", "Восстановление доступа", "Получение ссылки или кода", primaryRole],
    ["password_reset_done", "success", "Доступ восстановлен", "Новый пароль успешно сохранен", primaryRole],
    ["notifications", "list", t.notifications, "Важные события и обновления", primaryRole],
    ["notification_settings", "settings", "Настройки уведомлений", "Каналы и типы сообщений", primaryRole],
    ["global_search", "form", t.search, "Поиск по основным объектам", primaryRole],
    ["search_results", "list", "Результаты поиска", "Подходящие разделы и записи", primaryRole],
    ["profile", "profile", t.profile, "Личные данные и настройки", primaryRole],
    ["profile_edit", "form", "Редактирование профиля", "Контакты и основные данные", primaryRole],
    ["security", "settings", "Безопасность", "Пароль, устройства и активные сессии", primaryRole],
    ["design_system", "settings", "Дизайн-система", "Токены, типографика, кнопки и состояния интерфейса", primaryRole, false],
  ];
}

function catalogScreens(context, definitions) {
  return definitions.map(([id, type, title, description, roleKind = "buyer", action]) => screen(
    id,
    type,
    title,
    description,
    [firstRoleId(context.roles, roleKind)],
    context,
    action === false ? { action: false } : action ? { action } : {},
  ));
}

function applyConditionalScreens(screens, context) {
  const text = searchableText(context.semanticModel, context.proposalModel);
  const hasAuth = /auth|login|profile|role|access|permission|identity|user|пользоват|роль|доступ|kiritish|foydalanuv/i.test(text)
    || context.roles.length > 1;
  const hasPayment = hasSemanticIntegration(context.semanticModel, "payment") || /payment|pay|checkout|оплат|to'lov|платеж/i.test(text);
  const hasDelivery = hasSemanticIntegration(context.semanticModel, "delivery") || /delivery|shipping|достав|yetkaz/i.test(text);
  const hasSeller = context.roles.some((role) => role.kind === "seller") || /seller|merchant|vendor|продав|sotuvchi/i.test(text);
  const hasOperator = context.roles.some((role) => role.kind === "operator") || /operator|support|moderator|оператор|поддерж/i.test(text);
  const hasAdmin = context.roles.some((role) => role.kind === "admin") || /admin|control|settings|админ|настрой|созлам/i.test(text);
  const ids = new Set(screens.map((screen) => screen.id));
  return screens.filter((row) => {
    if (row.id === "login" && !hasAuth && context.productFamily !== "crm") return false;
    if (row.id === "payment" && !hasPayment && !["marketplace", "fintech"].includes(context.productFamily)) return false;
    if (row.id === "tracking" && !hasDelivery && context.productFamily !== "marketplace") return false;
    if (row.id === "seller_workspace" && !hasSeller) return false;
    if (row.id === "operator_workspace" && !hasOperator) return false;
    if (row.id === "admin_workspace" && !hasAdmin && !ids.has("seller_workspace")) return false;
    return true;
  });
}

function enforceScreenCount(screens, context) {
  const result = [...screens];
  const fallback = businessScreens(context);
  for (const candidate of fallback) {
    if (result.length >= MIN_SCREEN_COUNT) break;
    if (!result.some((screen) => screen.id === candidate.id)) result.push(candidate);
  }
  if (result.length < MIN_SCREEN_COUNT) {
    const { t } = context;
    result.push(screen("empty_state", "empty_state", "Пустое состояние", "Сценарий отсутствия данных", [firstRoleId(context.roles, "buyer")], context));
    result.push(screen("error_state", "error_state", "Ошибка", "Сценарий восстановления после сбоя", [firstRoleId(context.roles, "buyer")], context));
    result.push(screen("success", "success", t.success, "Успешное завершение процесса", [firstRoleId(context.roles, "buyer")], context));
  }
  return result;
}

function connectScreenActions(screens, context) {
  return screens.map((screen, index) => {
    if (!screen.actions.length) return screen;
    const next = screens[index + 1] || screens[0];
    const targetAction = screen.actions[0];
    return {
      ...screen,
      actions: [{ ...targetAction, targetScreenId: next.id }],
    };
  });
}

function screen(id, type, title, description, roleIds, context, options = {}) {
  const sourceRefs = pickSourceRefs(context, id);
  return {
    id,
    type,
    title: cleanText(title, 80),
    description: cleanText(localizeDescription(description, context.t), 180),
    roleIds: roleIds.filter(Boolean).length ? roleIds.filter(Boolean) : [firstRoleId(context.roles, "buyer")],
    sourceRefs,
    actions: options.action === false ? [] : [{ id: "continue", label: options.action || actionLabel(type, context.t), targetScreenId: id }],
    content: contentFor(id, type, title, description, context),
  };
}

function contentFor(id, type, title, description, context) {
  const scopeItems = relevantScopeItems(context.semanticModel, context.proposalModel);
  const taskRows = (context.semanticModel.tasks || []).filter((task) => !TECHNICAL_TERMS.test(textOf(task))).slice(0, 6);
  const states = (context.semanticModel.states || []).slice(0, 4);
  const semanticItems = (scopeItems.length ? scopeItems : taskRows).slice(0, 6).map((row, index) => ({
    title: cleanText(row.feature || row.label || row.epic || row.id || `${context.t.demo} ${index + 1}`, 60),
    detail: cleanText(row.detail || row.label || row.phase || row.truthStatus || "Demo state", 120),
    status: statusFor(index),
  }));
  const preset = screenContentPreset(id, type, title, description, context);
  const metrics = preset.metrics || [
    { label: context.t.tasks, value: String(Math.max(3, taskRows.length || semanticItems.length)), tone: "primary" },
    { label: "Flow", value: String(Math.max(1, (context.semanticModel.processes || []).length || 1)), tone: "success" },
    { label: context.t.roles, value: String(Math.max(1, context.roles.length)), tone: "warning" },
  ];
  const semanticSteps = (context.semanticModel.processes || []).flatMap((process) => process.nodeRefs || []).slice(0, 5).map((ref, index) => ({
    title: cleanText(labelForRef(context.semanticModel, ref) || `${context.t.demo} ${index + 1}`, 54),
    state: index === 0 ? "active" : index < 3 ? "pending" : "done",
  }));
  return {
    title: cleanText(title, 80),
    layout: preset.layout || layoutForScreen(id, type),
    metrics,
    items: preset.items || (id === "onboarding" && semanticItems.length ? semanticItems : contextualItems(title, description, context.t)),
    fields: preset.fields || contextualFields(id, title, description, context.t),
    steps: preset.steps || (type === "stepper" && semanticSteps.length ? semanticSteps : contextualSteps(title, context.t)),
    tabs: preset.tabs || tabsForScreen(id, context.t),
    states: states.map((state) => cleanText(state.label || state.id, 42)),
    chart: preset.chart || chartForScreen(id, title),
    note: preset.note || cleanText(description, 120),
  };
}

function screenContentPreset(id, type, title, description, context) {
  if (context.productFamily === "crm") return crmContentPreset(id, title, description, context.t);
  return {
    layout: layoutForScreen(id, type),
    metrics: metricSetFor(id, type, context.t),
  };
}

function crmContentPreset(id, title, description, t) {
  const row = (rowTitle, detail, status = "active") => ({ title: rowTitle, detail, status });
  const field = (label, value) => ({ label, value });
  const step = (stepTitle, state = "pending") => ({ title: stepTitle, state });
  const presets = {
    onboarding: {
      layout: "onboarding",
      metrics: [{ label: "Лиды", value: "48", tone: "primary" }, { label: "Сделки", value: "2,8 млрд", tone: "success" }, { label: "Задачи", value: "8", tone: "warning" }],
      items: [row("Единая клиентская база", "Лиды, контакты и компании", "done"), row("Управление воронкой", "Этапы, прогноз и согласования", "active"), row("Работа команды", "Задачи, календарь и отчёты", "pending")],
      tabs: [],
    },
    language: {
      layout: "choice-grid",
      items: [row("Русский", "Выбранный язык", "done"), row("O'zbekcha", "Lotin yozuvi"), row("English", "International")],
      tabs: [],
    },
    login: {
      layout: "login",
      fields: [field("Рабочая почта", "manager@company.uz"), field("Пароль", "••••••••")],
      items: [row("Безопасный вход", "Сессия защищена", "done")],
      tabs: [],
    },
    login_otp: {
      layout: "otp",
      fields: [field("Код подтверждения", "4 8 2 1")],
      items: [row("Код отправлен", "+998 90 ••• •• 42", "done"), row("Повторная отправка", "Доступна через 00:38", "pending")],
      tabs: [],
    },
    password_reset: {
      layout: "recovery",
      fields: [field("Рабочая почта", "manager@company.uz")],
      items: [row("Ссылка для восстановления", "Действует 15 минут", "active")],
      tabs: [],
    },
    password_reset_done: { layout: "success", items: [row("Новый пароль сохранён", "Можно войти в CRM", "done")], tabs: [] },
    notifications: {
      layout: "activity",
      items: [
        row("Новый лид с сайта", "ООО «Atlas Trade» · 2 мин", "active"),
        row("Просрочена задача", "Позвонить Азизе Каримовой · 18 мин", "warning"),
        row("Сделка перешла на согласование", "CRM внедрение · 1 ч", "pending"),
        row("Клиент открыл КП", "Nova Retail · 3 ч", "done"),
      ],
      tabs: ["Все", "Важные", "Задачи"],
    },
    notification_settings: {
      layout: "settings-list",
      items: [row("Новые лиды", "Push и email", "done"), row("Просроченные задачи", "Push", "done"), row("Изменения сделок", "Email", "active"), row("Еженедельный отчёт", "Отключено", "pending")],
      tabs: ["События", "Каналы"],
    },
    global_search: {
      layout: "search",
      fields: [field("Поисковый запрос", "Atlas")],
      items: [row("Atlas Trade", "Клиент · Ташкент", "done"), row("CRM для Atlas", "Сделка · 180 млн UZS", "pending"), row("Азиза Каримова", "Контакт · ЛПР", "active")],
      tabs: ["Все", "Лиды", "Сделки"],
    },
    search_results: {
      layout: "entity-list",
      items: [row("Atlas Trade", "Клиент · 3 активные сделки", "done"), row("CRM для Atlas", "Переговоры · 180 млн UZS", "pending"), row("Позвонить в Atlas", "Задача · сегодня, 15:00", "warning")],
      tabs: ["Все 8", "Клиенты 2", "Сделки 3"],
    },
    profile: {
      layout: "profile",
      items: [row("Должность", "Sales manager", "active"), row("Команда", "Enterprise sales", "done"), row("Рабочий номер", "+998 71 200 00 00", "active")],
      tabs: ["Профиль", "Активность"],
    },
    profile_edit: {
      layout: "form",
      fields: [field("Имя", "Александр Волков"), field("Телефон", "+998 90 123 45 67"), field("Должность", "Sales manager")],
      tabs: [],
    },
    security: {
      layout: "settings-list",
      items: [row("Двухфакторная защита", "Подключена", "done"), row("Активные сессии", "2 устройства", "active"), row("Последняя смена пароля", "12 июля 2026", "pending")],
      tabs: ["Защита", "Сессии"],
    },
    dashboard: {
      layout: "dashboard",
      metrics: [{ label: "Выручка", value: "1,84 млрд", tone: "primary" }, { label: "Новые лиды", value: "24", tone: "success" }, { label: "Задачи", value: "8", tone: "warning" }, { label: "Конверсия", value: "31%", tone: "primary" }],
      items: [row("CRM для Atlas Trade", "Переговоры · 180 млн UZS", "pending"), row("Продление Nova Retail", "КП отправлено · 96 млн UZS", "active"), row("Звонок с Orient Group", "Сегодня, 16:30", "warning")],
      tabs: ["Сегодня", "Неделя", "Месяц"],
      chart: [42, 58, 47, 72, 64, 86, 78],
    },
    activity_feed: {
      layout: "activity",
      items: [row("Создан лид", "Atlas Trade · Сардор Юсупов · 09:42", "done"), row("Звонок завершён", "Nova Retail · 6 мин · 10:15", "active"), row("Этап сделки изменён", "Переговоры → КП · 11:08", "pending"), row("Добавлена заметка", "Orient Group · 12:24", "active")],
      tabs: ["Все", "Мои", "Команда"],
    },
    quick_create: {
      layout: "quick-create",
      items: [row("Новый лид", "Контакт и источник", "active"), row("Новая сделка", "Клиент, сумма и этап", "pending"), row("Новая задача", "Срок и исполнитель", "warning"), row("Новый контакт", "Телефон и компания", "done")],
      tabs: [],
    },
    leads: {
      layout: "entity-list",
      metrics: [{ label: "Новые", value: "24", tone: "primary" }, { label: "Без ответа", value: "6", tone: "warning" }, { label: "Сегодня", value: "11", tone: "success" }],
      items: [row("Азиза Каримова", "Atlas Trade · Форма сайта · 10:42", "active"), row("Рустам Ахмедов", "Nova Retail · Рекомендация · 09:18", "pending"), row("Дилшод Умаров", "Orient Group · Telegram · вчера", "warning"), row("Малика Саидова", "Samarqand Textile · Звонок · вчера", "done")],
      tabs: ["Все 48", "Новые 24", "Мои 17"],
    },
    lead_filters: {
      layout: "filter-form",
      fields: [field("Источник", "Форма сайта"), field("Ответственный", "Александр Волков"), field("Статус", "Новый, В работе"), field("Период", "Последние 30 дней")],
      items: [row("Активные фильтры", "4 условия · найдено 17 лидов", "done")],
      tabs: [],
    },
    lead_create: {
      layout: "form",
      fields: [field("Имя", "Азиза Каримова"), field("Компания", "Atlas Trade"), field("Телефон", "+998 90 450 21 10"), field("Источник", "Форма сайта")],
      tabs: [],
    },
    lead_edit: {
      layout: "form",
      fields: [field("Имя", "Азиза Каримова"), field("Компания", "Atlas Trade"), field("Статус", "В работе"), field("Следующий шаг", "Подготовить демонстрацию")],
      tabs: [],
    },
    lead_details: {
      layout: "record-details",
      metrics: [{ label: "Оценка", value: "82", tone: "success" }, { label: "Касаний", value: "6", tone: "primary" }],
      items: [row("Компания", "Atlas Trade · Retail", "active"), row("Контакт", "+998 90 450 21 10", "done"), row("Источник", "Форма сайта · 3 августа", "active"), row("Следующий шаг", "Демонстрация · завтра 11:00", "pending")],
      tabs: ["Обзор", "История", "Файлы"],
    },
    lead_history: {
      layout: "activity",
      items: [row("Звонок", "Исходящий · 6 минут · сегодня 10:15", "done"), row("Статус изменён", "Новый → В работе · вчера 17:40", "active"), row("Email отправлен", "Презентация продукта · вчера 16:05", "pending")],
      tabs: ["Все", "Звонки", "Письма"],
    },
    lead_documents: {
      layout: "document-list",
      items: [row("Презентация CRM.pdf", "2,4 МБ · обновлено сегодня", "done"), row("Бриф клиента.docx", "840 КБ · 2 августа", "active"), row("Черновик КП.pdf", "1,1 МБ · требует проверки", "warning")],
      tabs: ["Все", "КП", "Вложения"],
    },
    lead_notes: {
      layout: "note-list",
      items: [row("Нужна интеграция с телефонией", "Александр · сегодня 10:24", "active"), row("Бюджет согласует директор", "Сардор · вчера 17:10", "pending"), row("Повторный контакт после демо", "Александр · 1 августа", "done")],
      tabs: ["Все", "Мои"],
    },
    lead_qualify: {
      layout: "stepper",
      steps: [step("Контакт подтверждён", "done"), step("Потребность определена", "done"), step("Бюджет согласован", "active"), step("Срок принятия решения", "pending")],
      items: [row("Итоговая оценка", "82 из 100 · высокий потенциал", "done")],
      tabs: [],
    },
    lead_assign: {
      layout: "form",
      fields: [field("Ответственный", "Александр Волков"), field("Команда", "Enterprise sales"), field("Причина", "Экспертиза в retail")],
      tabs: [],
    },
    lead_convert: { layout: "success", items: [row("Клиент создан", "Atlas Trade", "done"), row("Сделка создана", "CRM внедрение · 180 млн UZS", "done")], tabs: [] },
    pipeline: {
      layout: "kanban",
      metrics: [{ label: "В работе", value: "2,8 млрд", tone: "primary" }, { label: "Прогноз", value: "1,2 млрд", tone: "success" }, { label: "Риск", value: "320 млн", tone: "warning" }],
      items: [row("Новые", "12 сделок · 540 млн", "active"), row("Квалификация", "8 сделок · 760 млн", "pending"), row("КП", "5 сделок · 920 млн", "warning"), row("Переговоры", "3 сделки · 610 млн", "done")],
      tabs: ["Enterprise", "SMB"],
    },
    pipeline_stage: {
      layout: "entity-list",
      items: [row("CRM для Atlas Trade", "180 млн UZS · Александр", "pending"), row("Nova Retail Cloud", "96 млн UZS · Сардор", "active"), row("Orient Group Support", "74 млн UZS · Малика", "warning")],
      tabs: ["КП 5", "Просрочено 1"],
    },
    pipeline_move: {
      layout: "form",
      fields: [field("Новый этап", "Переговоры"), field("Причина", "Клиент подтвердил интерес"), field("Следующее действие", "Согласовать условия")],
      tabs: [],
    },
    pipeline_forecast: {
      layout: "analytics",
      metrics: [{ label: "Прогноз", value: "1,2 млрд", tone: "success" }, { label: "План", value: "1,5 млрд", tone: "primary" }, { label: "Разрыв", value: "-18%", tone: "warning" }],
      items: [row("Август", "720 млн UZS · вероятность 74%", "done"), row("Сентябрь", "410 млн UZS · вероятность 58%", "pending"), row("Октябрь", "290 млн UZS · вероятность 36%", "warning")],
      chart: [38, 54, 49, 68, 76, 63, 84],
      tabs: ["Месяц", "Квартал"],
    },
    deal_details: {
      layout: "record-details",
      metrics: [{ label: "Сумма", value: "180 млн", tone: "primary" }, { label: "Вероятность", value: "70%", tone: "success" }],
      items: [row("Клиент", "Atlas Trade", "done"), row("Этап", "Переговоры", "pending"), row("Ответственный", "Александр Волков", "active"), row("Закрытие", "28 августа 2026", "warning")],
      tabs: ["Обзор", "Товары", "Задачи"],
    },
    deal_products: {
      layout: "document-list",
      items: [row("CRM Core", "20 пользователей · 96 млн UZS", "done"), row("Телефония", "Интеграция · 32 млн UZS", "active"), row("Внедрение", "Настройка и обучение · 52 млн UZS", "pending")],
      tabs: ["Состав", "Скидки"],
    },
    deal_quote: {
      layout: "quote",
      items: [row("CRM Core", "96 000 000 UZS", "done"), row("Интеграции", "32 000 000 UZS", "active"), row("Внедрение", "52 000 000 UZS", "pending")],
      note: "Итого: 180 000 000 UZS",
      tabs: [],
    },
    deal_approval: {
      layout: "stepper",
      steps: [step("Руководитель продаж", "done"), step("Финансовый контроль", "active"), step("Коммерческий директор", "pending")],
      items: [row("Скидка", "8% · в пределах полномочий", "done")],
      tabs: [],
    },
    deal_won: { layout: "success", items: [row("Сумма зафиксирована", "180 млн UZS", "done"), row("Проект создан", "Старт 12 августа", "done")], tabs: [] },
    deal_lost: {
      layout: "form",
      fields: [field("Причина", "Выбран конкурент"), field("Конкурент", "Другое CRM-решение"), field("Комментарий", "Вернуться к клиенту через 6 месяцев")],
      tabs: [],
    },
    tasks: {
      layout: "task-list",
      metrics: [{ label: "Сегодня", value: "8", tone: "primary" }, { label: "Просрочено", value: "3", tone: "warning" }, { label: "Готово", value: "14", tone: "success" }],
      items: [row("Позвонить Азизе Каримовой", "Atlas Trade · сегодня 11:00", "warning"), row("Отправить обновлённое КП", "Nova Retail · сегодня 14:30", "pending"), row("Подготовить демо", "Orient Group · завтра 10:00", "active"), row("Проверить договор", "Samarqand Textile · выполнено", "done")],
      tabs: ["Мои", "Команда", "Завершённые"],
    },
    task_details: {
      layout: "record-details",
      items: [row("Срок", "Сегодня, 11:00", "warning"), row("Связанный лид", "Азиза Каримова · Atlas Trade", "active"), row("Приоритет", "Высокий", "warning"), row("Ответственный", "Александр Волков", "done")],
      tabs: ["Детали", "Комментарии"],
    },
    task_create: {
      layout: "form",
      fields: [field("Название", "Провести демонстрацию"), field("Исполнитель", "Александр Волков"), field("Срок", "4 августа, 11:00"), field("Напоминание", "За 30 минут")],
      tabs: [],
    },
    calendar: {
      layout: "calendar",
      items: [row("10:00 · Демо Atlas Trade", "Видеовстреча · Александр", "active"), row("13:30 · Звонок Nova Retail", "Телефон · Сардор", "pending"), row("16:00 · Планёрка продаж", "Переговорная 2", "done")],
      tabs: ["День", "Неделя", "Месяц"],
    },
    clients: {
      layout: "entity-list",
      metrics: [{ label: "Всего", value: "248", tone: "primary" }, { label: "Активные", value: "186", tone: "success" }, { label: "В риске", value: "12", tone: "warning" }],
      items: [row("Atlas Trade", "Retail · 3 сделки · 460 млн UZS", "done"), row("Nova Retail", "E-commerce · 2 сделки · 210 млн UZS", "active"), row("Orient Group", "Services · 1 сделка · 74 млн UZS", "pending"), row("Samarqand Textile", "Manufacturing · без активности 21 день", "warning")],
      tabs: ["Все", "Активные", "В риске"],
    },
    client_details: {
      layout: "record-details",
      metrics: [{ label: "LTV", value: "640 млн", tone: "primary" }, { label: "Сделки", value: "3", tone: "success" }],
      items: [row("Индустрия", "Retail", "active"), row("Главный контакт", "Азиза Каримова · директор", "done"), row("Последняя активность", "Сегодня, 10:15", "active"), row("Статус", "Ключевой клиент", "done")],
      tabs: ["Обзор", "Сделки", "Контакты"],
    },
    client_contacts: {
      layout: "entity-list",
      items: [row("Азиза Каримова", "Директор · ЛПР · +998 90 450 21 10", "done"), row("Бекзод Алиев", "IT-директор · Эксперт", "active"), row("Нодира Юлдашева", "Финансы · Согласование", "pending")],
      tabs: ["Все 3", "ЛПР 1"],
    },
    client_history: {
      layout: "activity",
      items: [row("Встреча проведена", "Демонстрация CRM · сегодня 10:00", "done"), row("КП отправлено", "Версия 2 · 2 августа", "active"), row("Контакт добавлен", "Бекзод Алиев · 1 августа", "pending")],
      tabs: ["Все", "Сделки", "Контакты"],
    },
    reports: reportPreset("Продажи", "2,8 млрд", [42, 58, 66, 54, 76, 81, 88]),
    report_sales: reportPreset("Выручка", "1,84 млрд", [35, 44, 51, 63, 59, 78, 92]),
    report_conversion: reportPreset("Конверсия", "31%", [82, 68, 54, 41, 31, 24, 18]),
    report_team: reportPreset("План команды", "87%", [48, 61, 57, 72, 68, 84, 91]),
    team: {
      layout: "team-list",
      items: [row("Александр Волков", "Enterprise · план 94%", "done"), row("Сардор Юсупов", "SMB · план 86%", "active"), row("Малика Саидова", "Enterprise · план 78%", "pending"), row("Дилшод Умаров", "SMB · 3 просроченные задачи", "warning")],
      tabs: ["Команда", "Нагрузка"],
    },
    roles: {
      layout: "settings-list",
      items: [row("Менеджер продаж", "18 пользователей · 24 права", "done"), row("Руководитель отдела", "4 пользователя · 38 прав", "active"), row("Администратор", "2 пользователя · полный доступ", "warning")],
      tabs: ["Роли", "Пользователи"],
    },
    permissions: {
      layout: "permission-matrix",
      items: [row("Лиды", "Просмотр · Создание · Изменение", "done"), row("Сделки", "Просмотр · Изменение · Экспорт", "done"), row("Отчёты", "Просмотр · без экспорта", "pending"), row("Настройки", "Доступ запрещён", "warning")],
      tabs: ["Менеджер", "Руководитель"],
    },
    integrations: {
      layout: "integration-grid",
      items: [row("IP-телефония", "Подключено · 12 линий", "done"), row("Корпоративная почта", "Подключено · синхронизация", "done"), row("Telegram", "Требует авторизации", "warning"), row("1С", "Настройка обмена", "pending")],
      tabs: ["Все", "Подключённые"],
    },
    settings: {
      layout: "settings-list",
      items: [row("Воронки и этапы", "2 воронки · 11 этапов", "active"), row("Поля и справочники", "48 пользовательских полей", "done"), row("Автоматизация", "7 активных правил", "pending"), row("Импорт и экспорт", "Последний импорт 2 августа", "active")],
      tabs: ["CRM", "Автоматизация"],
    },
  };
  return presets[id] || {};
}

function reportPreset(label, value, chart) {
  return {
    layout: "analytics",
    metrics: [{ label, value, tone: "primary" }, { label: "К плану", value: "87%", tone: "success" }, { label: "Динамика", value: "+12%", tone: "success" }],
    items: [
      { title: "Enterprise", detail: "54% результата · рост 18%", status: "done" },
      { title: "SMB", detail: "33% результата · рост 7%", status: "active" },
      { title: "Новые продажи", detail: "13% результата · ниже плана", status: "warning" },
    ],
    chart,
    tabs: ["Динамика", "Структура"],
  };
}

function layoutForScreen(id, type) {
  if (id === "design_system") return "design-system";
  if (/language/.test(id)) return "choice-grid";
  if (/otp|verification_code/.test(id)) return "otp";
  if (/global_search/.test(id)) return "search";
  if (/filter/.test(id)) return "filter-form";
  if (/notification|activity|history|audit/.test(id)) return "activity";
  if (/pipeline$|workflow_queue/.test(id)) return "kanban";
  if (/calendar/.test(id)) return "calendar";
  if (/permission/.test(id)) return "permission-matrix";
  if (/integration/.test(id) && type !== "details") return "integration-grid";
  if (/document|statement/.test(id) && type === "list") return "document-list";
  if (/quick_create/.test(id)) return "quick-create";
  if (/analytics|report|forecast/.test(id) || type === "analytics") return "analytics";
  if (type === "settings") return "settings-list";
  if (type === "details") return "record-details";
  if (type === "list") return "entity-list";
  return type;
}

function metricSetFor(id, type, t) {
  const seed = [...String(id)].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  if (["form", "login", "settings", "success", "empty_state", "error_state"].includes(type)) return [];
  return [
    { label: t.overview, value: String(12 + (seed % 37)), tone: "primary" },
    { label: t.done, value: `${54 + (seed % 39)}%`, tone: "success" },
    { label: t.tasks, value: String(2 + (seed % 11)), tone: "warning" },
  ];
}

function contextualItems(title, description, t) {
  return [
    { title: cleanText(title, 58), detail: cleanText(description, 110), status: "active" },
    { title: t.status, detail: `${cleanText(title, 48)} · ${t.active}`, status: "done" },
    { title: t.next, detail: `${t.open}: ${cleanText(title, 48)}`, status: "pending" },
  ];
}

function contextualFields(id, title, description, t) {
  return [
    { label: cleanText(title, 48), value: cleanText(description, 64) },
    { label: t.status, value: t.active },
    { label: "ID", value: String(id).replace(/_/g, "-").toUpperCase().slice(0, 28) },
  ];
}

function contextualSteps(title, t) {
  return [
    { title: `${title}: ${t.onboarding}`, state: "done" },
    { title: `${title}: ${t.status}`, state: "active" },
    { title: `${title}: ${t.done}`, state: "pending" },
  ];
}

function tabsForScreen(id, t) {
  if (/form|create|edit|otp|reset|success|onboarding/.test(id)) return [];
  if (/history|activity/.test(id)) return [t.history, t.overview];
  if (/settings|security|role|permission/.test(id)) return [t.settings, t.overview];
  return [t.overview, t.history];
}

function chartForScreen(id, title) {
  if (!/dashboard|analytics|report|forecast/.test(id)) return [];
  const seed = [...`${id}${title}`].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return Array.from({ length: 7 }, (_, index) => 30 + ((seed + index * 17) % 61));
}

function buildNavigation(screens, roles, productFamily, t) {
  const definitions = [
    { id: "foundation", title: foundationTitle(t), match: (id) => id === "design_system" },
    { id: "start", title: t.onboarding, match: (id) => /^(onboarding|language|login|password|verification|identity|selfie)/.test(id) },
    { id: "overview", title: t.overview, match: (id) => /^(home|dashboard|activity_feed|quick_create|notifications|notification_settings|global_search|search_results)/.test(id) },
    { id: "product", title: productFamily === "crm" ? t.leads : productFamily === "marketplace" ? t.catalog : t.workspace, match: () => false },
    { id: "operations", title: productFamily === "crm" ? t.workspace : t.history, match: (id) => /(task|calendar|client|order|return|tracking|payment|history|document|statement|schedule)/.test(id) },
    { id: "management", title: roles.some((role) => role.kind === "seller") ? t.seller : t.settings, match: (id) => /(profile|security|support|chat|help|seller|admin|operator|moderation|report|analytics|team|roles|permissions|integration|audit|settings)/.test(id) },
  ];
  const buckets = new Map(definitions.map((definition) => [definition.id, []]));
  for (const screen of screens) {
    const matched = definitions.find((definition) => definition.id !== "product" && definition.match(screen.id));
    buckets.get(matched?.id || "product").push(screen.id);
  }
  const groups = definitions
    .map((definition) => ({ id: definition.id, title: definition.title, screenIds: buckets.get(definition.id) }))
    .filter((group) => group.screenIds.length);
  return groups.length ? groups : [{ id: "main", title: t.overview, screenIds: screens.map((screen) => screen.id) }];
}

function foundationTitle(t) {
  if (t === DICTIONARY["ru-RU"]) return "Основа";
  if (t === DICTIONARY["uz-Latn"]) return "Asos";
  return "Foundation";
}

function resolveRoles(semanticModel, productFamily, t) {
  const roles = (semanticModel.actors || [])
    .filter((actor) => !SYSTEM_ACTOR_TYPES.has(actor.type))
    .map((actor) => ({
      id: safeRoleId(actor.id || actor.label),
      title: cleanText(actor.label || actor.id || t.customer, 80),
      kind: actorKind(actor),
    }));
  if (roles.length) return dedupeRoles(roles);
  if (productFamily === "crm") return [{ id: "operator", title: t.operator, kind: "operator" }, { id: "admin", title: t.admin, kind: "admin" }];
  if (productFamily === "marketplace") return [{ id: "buyer", title: t.customer, kind: "buyer" }, { id: "seller", title: t.seller, kind: "seller" }, { id: "admin", title: t.admin, kind: "admin" }];
  return [{ id: "user", title: t.customer, kind: "buyer" }, { id: "admin", title: t.admin, kind: "admin" }];
}

function actorKind(actor) {
  const text = textOf(actor);
  if (/seller|merchant|vendor|продав|sotuvchi/i.test(text)) return "seller";
  if (/admin|owner|control|админ/i.test(text)) return "admin";
  if (/operator|support|manager|agent|оператор|менеджер/i.test(text) || actor.type === "internal_operator") return "operator";
  return "buyer";
}

function detectProductFamily(proposalModel, semanticModel) {
  const declaredText = JSON.stringify({
    title: proposalModel.title,
    projectName: proposalModel.brief?.projectName,
    type: proposalModel.brief?.type,
    prompt: proposalModel.brief?.prompt,
  });
  if (/\bcrm\b|sales crm|crm[- ]?систем|система управления клиент/i.test(declaredText)) return "crm";
  if (/marketplace|маркетплейс|маркет плейс|e-?commerce|интернет.?магазин/i.test(declaredText)) return "marketplace";
  if (/bnpl|fintech|finance|bank|loan|installment|рассроч|кредит|скоринг/i.test(declaredText)) return "fintech";
  const text = searchableText(semanticModel, proposalModel);
  if (/\bcrm\b|lead|pipeline|sales|воронк|лид|сделк|client management/i.test(text)) return "crm";
  if (/marketplace|маркетплейс|маркет плейс|e-?commerce|internet magazin|интернет.?магазин|catalog|cart|seller|merchant|vendor|товар|корзин/i.test(text)) return "marketplace";
  if (/bnpl|fintech|finance|bank|loan|installment|рассроч|кредит|оплат|скоринг|limit/i.test(text)) return "fintech";
  return "business-app";
}

function normalizeTheme(profile = {}, tokens = null) {
  const accents = profile.accents || {};
  const canvas = profile.canvas || {};
  const source = tokens || {};
  return {
    primary: hex(source.primary || accents.decorativePrimary || accents.primary, "#1A54FE"),
    secondary: hex(source.secondary || accents.decorativeSecondary || accents.secondary, "#0A0A0F"),
    background: hex(source.background || canvas.background, "#F6F7F8"),
    surface: hex(source.surface || canvas.surface1, "#FFFFFF"),
    success: "#13A36B",
    warning: "#F59E0B",
    error: "#EF4444",
  };
}

function sourceRefsFor(semanticModel, proposalModel) {
  return [
    ...(semanticModel.scopeItems || []),
    ...(semanticModel.capabilities || []),
    ...(semanticModel.tasks || []),
    ...(proposalModel.scope || []),
  ].map((row) => row.id).filter(Boolean);
}

function pickSourceRefs(context, id) {
  const scope = relevantScopeItems(context.semanticModel, context.proposalModel);
  const matched = scope.filter((row) => textOf(row).toLowerCase().includes(id.replace(/_/g, " "))).map((row) => row.id);
  return uniqueStrings([...(matched.length ? matched : context.sourceRefs.slice(0, 2)), `DERIVED-APP-PROTOTYPE-${context.productFamily.toUpperCase()}`]).slice(0, 4);
}

function relevantScopeItems(semanticModel, proposalModel) {
  const rows = (semanticModel.scopeItems?.length ? semanticModel.scopeItems : proposalModel.scope) || [];
  return rows.filter((row) => !["deferred", "out_of_scope"].includes(String(row.inclusion || "").toLowerCase()) && !TECHNICAL_TERMS.test(textOf(row)));
}

function resolveLocale(proposalModel, semanticModel) {
  const locale = proposalModel.brief?.locale || semanticModel.project?.locale || semanticModel.sourceLanguage || "uz-Latn";
  return SUPPORTED_LOCALES.has(locale) ? locale : "uz-Latn";
}

function labelForRef(semanticModel, ref) {
  const [collection, id] = String(ref || "").split("/");
  const rows = semanticModel[collection] || [];
  return rows.find((row) => row.id === id)?.label || "";
}

function searchableText(semanticModel = {}, proposalModel = {}) {
  return JSON.stringify({
    title: proposalModel.title,
    brief: proposalModel.brief,
    project: semanticModel.project,
    actors: semanticModel.actors,
    scope: semanticModel.scopeItems || proposalModel.scope,
    capabilities: semanticModel.capabilities,
    tasks: semanticModel.tasks,
    integrations: semanticModel.integrations,
  });
}

function hasSemanticIntegration(semanticModel, type) {
  return (semanticModel.integrations || []).some((row) => String(row.type || "").toLowerCase() === type);
}

function dedupeScreens(screens) {
  const seen = new Set();
  return screens.filter((screen) => {
    if (seen.has(screen.id)) return false;
    seen.add(screen.id);
    return true;
  });
}

function dedupeRoles(roles) {
  const seen = new Set();
  return roles.filter((role) => {
    if (seen.has(role.id)) return false;
    seen.add(role.id);
    return true;
  });
}

function firstRoleId(roles, kind) {
  return roles.find((role) => role.kind === kind)?.id || roles[0]?.id || "user";
}

function actionLabel(type, t) {
  if (["payment", "checkout"].includes(type)) return type === "payment" ? t.pay : t.submit;
  if (["details", "product_grid", "list"].includes(type)) return t.open;
  if (["settings", "form"].includes(type)) return t.configure;
  return t.next;
}

function demoItems(t) {
  return [
    { title: `${t.demo} 1`, detail: t.overview, status: "active" },
    { title: `${t.demo} 2`, detail: t.history, status: "pending" },
    { title: `${t.demo} 3`, detail: t.settings, status: "done" },
  ];
}

function demoFields(t) {
  return [
    { label: t.customer, value: "Demo user" },
    { label: "Status", value: "Active" },
    { label: t.notifications, value: "On" },
  ];
}

function demoSteps(t) {
  return [
    { title: t.onboarding, state: "done" },
    { title: t.form, state: "active" },
    { title: t.success, state: "pending" },
  ];
}

function statusFor(index) {
  return ["active", "pending", "done", "warning"][index % 4];
}

function cleanText(value, max = 120) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    || "Demo";
}

function localizeDescription(value, t) {
  return String(value || t.projectDescription);
}

function textOf(value) {
  return [value?.id, value?.label, value?.title, value?.feature, value?.detail, value?.epic, value?.type].filter(Boolean).join(" ");
}

function safeRoleId(value) {
  return String(value || "user").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "") || "user";
}

function hex(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(text) ? text.toUpperCase() : fallback;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
