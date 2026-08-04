import { validateKpContract } from "./kp_reference_contracts.mjs";

export const APP_PROTOTYPE_PLANNER_VERSION = "app-prototype-planner-v2";

const SCREEN_LIMIT = 24;
const TARGET_SCREEN_RANGE = Object.freeze({ min: 6, preferred: 12, max: 16 });
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
  const domainModel = buildPrototypeDomainModel(packageSemantic, packageProposal, roles, productFamily, t, sourceRefs);
  const context = {
    t,
    roles,
    productFamily,
    domainModel,
    semanticModel: packageSemantic,
    proposalModel: packageProposal,
    sourceRefs,
  };

  let screens;
  if (productFamily === "ecommerce") screens = ecommerceScreens(context);
  else if (productFamily === "erp") screens = erpScreens(context);
  else if (productFamily === "tms") screens = tmsScreens(context);
  else if (productFamily === "saas") screens = saasScreens(context);
  else if (productFamily === "mobile-app") screens = mobileAppScreens(context);
  else if (productFamily === "website") screens = websiteScreens(context);
  else if (productFamily === "marketplace") screens = marketplaceScreens(context);
  else if (productFamily === "fintech") screens = fintechScreens(context);
  else if (productFamily === "crm") screens = crmScreens(context);
  else screens = businessScreens(context);

  screens = selectScreensForPrototype(dedupeScreens(screens), context).slice(0, SCREEN_LIMIT);
  screens = wireScreenActions(screens, context);

  return {
    schemaVersion: "2.0",
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
    flows: buildSpecFlows(domainModel, screens),
    screens,
  };
}

export async function validateAppPrototypeSpec(spec) {
  const validation = await validateKpContract(spec?.schemaVersion === "1.0" ? "appPrototypeSpecV1" : "appPrototypeSpec", spec, { throwOnError: false });
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
    if (!screen.intent && spec?.schemaVersion !== "1.0") {
      findings.push({ code: "APP_PROTOTYPE_SCREEN_WITHOUT_INTENT", severity: "BLOCKER", message: `Screen is missing intent: ${screen.id}` });
    }
    if (!(screen.sourceRefs || []).length) {
      findings.push({ code: "APP_PROTOTYPE_SCREEN_WITHOUT_SOURCE_REF", severity: "BLOCKER", message: `Screen is missing sourceRefs: ${screen.id}` });
    }
    for (const action of screen.actions || []) {
      for (const targetScreenId of actionTargetIds(action)) {
        if (!screenSet.has(targetScreenId)) {
          findings.push({ code: "APP_PROTOTYPE_ACTION_TARGET_INVALID", severity: "BLOCKER", message: `Action ${screen.id}/${action.id} references unknown screen: ${targetScreenId}` });
        }
      }
      if (!action.type && spec?.schemaVersion !== "1.0") {
        findings.push({ code: "APP_PROTOTYPE_ACTION_TYPE_MISSING", severity: "BLOCKER", message: `Action ${screen.id}/${action.id} is missing type.` });
      }
      if (action.type === "navigate" && !screenSet.has(action.targetScreenId)) {
        findings.push({ code: "APP_PROTOTYPE_ACTION_TARGET_INVALID", severity: "BLOCKER", message: `Action ${screen.id}/${action.id} references unknown screen: ${action.targetScreenId}` });
      }
    }
    const genericPrimary = hasGenericPrimaryContent(screen);
    if (genericPrimary) {
      findings.push({ code: "APP_PROTOTYPE_GENERIC_PRIMARY_CONTENT", severity: "BLOCKER", message: `Screen uses generic primary content: ${screen.id}` });
    }
    if ((screen.content?.fields || []).some((field) => field.readonly === true && ["form", "login"].includes(screen.type))) {
      findings.push({ code: "APP_PROTOTYPE_FORM_NOT_EDITABLE", severity: "BLOCKER", message: `Editable screen contains readonly fields: ${screen.id}` });
    }
  }
  const linearRatio = linearActionRatio(spec?.screens || []);
  if ((spec?.screens || []).length > 8 && linearRatio > 0.7) {
    findings.push({ code: "APP_PROTOTYPE_ACTION_GRAPH_LINEARIZED", severity: "BLOCKER", message: `Primary navigate actions follow screen order in ${Math.round(linearRatio * 100)}% of screens.` });
  }
  const contentSignatures = (spec?.screens || []).map((screen) => JSON.stringify({
    layout: screen.layout || screen.content?.layout,
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

function buildPrototypeDomainModel(semanticModel = {}, proposalModel = {}, roles = [], productFamily = "business-app", t = DICTIONARY.en, sourceRefs = []) {
  const scopeItems = relevantScopeItems(semanticModel, proposalModel);
  const tasks = (semanticModel.tasks || []).filter((task) => !TECHNICAL_TERMS.test(textOf(task)));
  const capabilities = (semanticModel.capabilities || []).filter((capability) => !TECHNICAL_TERMS.test(textOf(capability)));
  const states = (semanticModel.states || []).map((state, index) => ({
    id: safeId(state.id || state.label || `state_${index + 1}`, `state_${index + 1}`),
    title: cleanText(state.label || state.id || `${t.status} ${index + 1}`, 80),
    sourceRefs: uniqueStrings([state.id, ...(state.sourceRefs || [])]).slice(0, 4),
  }));
  const integrations = (semanticModel.integrations || []).map((integration, index) => ({
    id: safeId(integration.id || integration.type || `integration_${index + 1}`, `integration_${index + 1}`),
    title: cleanText(integration.label || integration.name || integration.type || `Integration ${index + 1}`, 80),
    type: cleanText(integration.type || "", 48),
    sourceRefs: uniqueStrings([integration.id, ...(integration.sourceRefs || [])]).slice(0, 4),
  }));
  const entities = deriveDomainEntities(scopeItems, tasks, capabilities, productFamily, t);
  const searchable = searchableText(semanticModel, proposalModel);
  const hasAuth = /auth|login|profile|role|access|permission|identity|user|пользоват|роль|доступ|парол|kiritish|foydalanuv/i.test(searchable)
    || roles.length > 1;
  const hasAdminScope = roles.some((role) => role.kind === "admin")
    || /admin|administrator|owner|control panel|permissions|roles|audit|админ|администратор|права|роли|аудит|sozlama/i.test(searchable);
  const hasSellerScope = roles.some((role) => role.kind === "seller")
    || productFamily === "marketplace"
    || /seller|merchant|vendor|продав|sotuvchi/i.test(searchable);
  const hasOperatorScope = roles.some((role) => role.kind === "operator")
    || ["crm", "erp", "tms"].includes(productFamily)
    || /operator|support|manager|agent|оператор|менеджер|поддерж/i.test(searchable);
  const flows = derivePrototypeFlows(semanticModel, scopeItems, tasks, entities, roles, productFamily, sourceRefs, t);
  return {
    roles,
    entities,
    capabilities: capabilities.map((row, index) => ({
      id: safeId(row.id || row.feature || row.label || `capability_${index + 1}`, `capability_${index + 1}`),
      title: cleanText(row.feature || row.label || row.title || row.id || `${t.demo} ${index + 1}`, 80),
      detail: cleanText(row.detail || row.description || row.epic || row.truthStatus || t.projectDescription, 160),
      sourceRefs: uniqueStrings([row.id, ...(row.sourceRefs || [])]).slice(0, 4),
    })),
    flows,
    states,
    integrations,
    navigationCandidates: [],
    sourceRefs: uniqueStrings(sourceRefs.length ? sourceRefs : ["DERIVED-APP-PROTOTYPE"]),
    hasAuth,
    hasAdminScope,
    hasSellerScope,
    hasOperatorScope,
  };
}

function deriveDomainEntities(scopeItems = [], tasks = [], capabilities = [], productFamily = "business-app", t = DICTIONARY.en) {
  const rows = [...scopeItems, ...capabilities, ...tasks].filter((row) => !TECHNICAL_TERMS.test(textOf(row)));
  const familyFallbacks = {
    marketplace: [["product", t.product, t.catalog], ["order", t.tracking, t.checkout], ["seller", t.seller, t.workspace]],
    ecommerce: [["product", t.product, t.catalog], ["order", t.tracking, t.checkout], ["customer", t.customer, t.profile]],
    crm: [["lead", t.leads, t.pipeline], ["deal", t.pipeline, t.reports], ["client", t.clients, t.history]],
    erp: [["procurement", "Закупка", "Заявки, заказы и поставщики"], ["inventory", "Запасы", "Склады, остатки и движения"], ["finance", "Финансы", "Счета, платежи и бюджет"]],
    tms: [["shipment", "Перевозка", "Заказы, рейсы и маршруты"], ["fleet", "Автопарк", "Транспорт, водители и ТО"], ["client", t.clients, "SLA и договоры"]],
    saas: [["workspace", t.workspace, "Команды, проекты и записи"], ["record", "Запись", "Данные, статусы и история"], ["automation", "Автоматизация", "Триггеры и действия"]],
    "mobile-app": [["entry", "Запись", "Создание и просмотр данных"], ["content", "Контент", "Лента, подборки и избранное"], ["device", "Устройство", "Разрешения и синхронизация"]],
    website: [["page", "Страница", "Контент, SEO и публикация"], ["lead", "Заявка", "Форма и обработка обращения"], ["content", "Материал", "Кейсы, блог и события"]],
    "business-app": [["record", t.workspace, t.projectDescription], ["task", t.tasks, t.history], ["report", t.reports, t.analytics]],
  };
  const entityMap = new Map();
  for (const [index, row] of rows.entries()) {
    const text = textOf(row);
    const kind = entityKindFromText(text, productFamily);
    const title = cleanText(row.feature || row.label || row.task || row.epic || row.id || `${t.demo} ${index + 1}`, 80);
    const id = safeId(kind || title, `entity_${index + 1}`);
    const existing = entityMap.get(id);
    const value = {
      id,
      kind: kind || id,
      title,
      detail: cleanText(row.detail || row.subtask || row.epic || row.truthStatus || t.projectDescription, 160),
      sourceRefs: uniqueStrings([row.id, ...(row.sourceRefs || [])]).slice(0, 4),
    };
    if (existing) {
      existing.detail = existing.detail || value.detail;
      existing.sourceRefs = uniqueStrings([...existing.sourceRefs, ...value.sourceRefs]).slice(0, 4);
    } else {
      entityMap.set(id, value);
    }
  }
  if (!entityMap.size) {
    for (const [id, title, detail] of familyFallbacks[productFamily] || familyFallbacks["business-app"]) {
      entityMap.set(id, { id, kind: id, title, detail, sourceRefs: ["DERIVED-APP-PROTOTYPE"] });
    }
  }
  return [...entityMap.values()].slice(0, 6);
}

function derivePrototypeFlows(semanticModel = {}, scopeItems = [], tasks = [], entities = [], roles = [], productFamily = "business-app", sourceRefs = [], t = DICTIONARY.en) {
  const processes = semanticModel.processes || [];
  const actorRoleId = roles[0]?.id || "user";
  const rows = processes.length ? processes : scopeItems.length ? scopeItems.slice(0, 3) : tasks.slice(0, 3);
  if (!rows.length) {
    return [{
      id: "primary-flow",
      title: primaryFlowTitle(productFamily, t),
      actorRoleId,
      entryIntent: "overview",
      successIntent: "success",
      steps: [
        { id: "overview", intent: "Открыть рабочий обзор", entityId: entities[0]?.id || "record" },
        { id: "details", intent: "Проверить детали", entityId: entities[0]?.id || "record" },
        { id: "submit", intent: "Сохранить результат", entityId: entities[0]?.id || "record" },
      ],
      sourceRefs: uniqueStrings(sourceRefs.length ? sourceRefs : ["DERIVED-APP-PROTOTYPE"]),
    }];
  }
  return rows.slice(0, 3).map((row, index) => {
    const title = cleanText(row.label || row.feature || row.task || row.epic || row.id || primaryFlowTitle(productFamily, t), 100);
    const refs = uniqueStrings([row.id, ...(row.sourceRefs || []), ...sourceRefs.slice(0, 1)]).slice(0, 4);
    const nodeRefs = row.nodeRefs || [];
    const steps = nodeRefs.length
      ? nodeRefs.slice(0, 6).map((ref, stepIndex) => ({
          id: safeId(ref, `step_${stepIndex + 1}`),
          intent: cleanText(labelForRef(semanticModel, ref) || `${title} · ${stepIndex + 1}`, 120),
          entityId: entities[stepIndex % Math.max(1, entities.length)]?.id || "record",
        }))
      : [
          { id: "entry", intent: cleanText(title, 120), entityId: entities[0]?.id || "record" },
          { id: "review", intent: cleanText(row.detail || row.subtask || t.details, 120), entityId: entities[0]?.id || "record" },
          { id: "outcome", intent: t.success, entityId: entities[0]?.id || "record" },
        ];
    return {
      id: safeId(row.id || title || `flow_${index + 1}`, `flow_${index + 1}`),
      title,
      actorRoleId,
      entryIntent: "overview",
      successIntent: "success",
      steps,
      sourceRefs: refs.length ? refs : ["DERIVED-APP-PROTOTYPE"],
    };
  });
}

function buildSpecFlows(domainModel, screens) {
  const screenSet = new Set(screens.map((screen) => screen.id));
  return (domainModel.flows || []).slice(0, 4).map((flow) => {
    const entryScreenId = firstExistingScreenId(screenSet, familyEntryScreenIds(flow.id), screens[0]?.id);
    const successScreenIds = screens.filter((screen) => screen.type === "success").map((screen) => screen.id);
    const specFlow = {
      id: flow.id,
      title: flow.title,
      actorRoleId: flow.actorRoleId,
      entryScreenId,
      steps: flow.steps,
      sourceRefs: flow.sourceRefs,
    };
    if (successScreenIds.length) specFlow.successScreenIds = successScreenIds.slice(0, 3);
    const errorScreenIds = screens.filter((screen) => screen.type === "error_state").map((screen) => screen.id).slice(0, 3);
    if (errorScreenIds.length) specFlow.errorScreenIds = errorScreenIds;
    return specFlow;
  }).filter((flow) => flow.entryScreenId);
}

function familyEntryScreenIds() {
  return ["home", "dashboard", "workspace", "catalog", "leads", "records"];
}

function primaryFlowTitle(productFamily, t) {
  if (["marketplace", "ecommerce"].includes(productFamily)) return t.checkout;
  if (productFamily === "crm") return t.pipeline;
  if (productFamily === "fintech") return t.payment;
  if (productFamily === "website") return "Заявка с сайта";
  return t.workspace;
}

function entityKindFromText(value, productFamily) {
  const text = String(value || "").toLowerCase();
  if (/лид|lead/.test(text)) return "lead";
  if (/сделк|deal|pipeline/.test(text)) return "deal";
  if (/клиент|client|customer/.test(text)) return "client";
  if (/товар|product|catalog|каталог|assort/.test(text)) return "product";
  if (/заказ|order|checkout|delivery|достав/.test(text)) return "order";
  if (/оплат|payment|invoice|счет|сч[её]т|billing/.test(text)) return "payment";
  if (/документ|document|file|файл/.test(text)) return "document";
  if (/заявк|request|application/.test(text)) return "request";
  if (/склад|inventory|stock|warehouse|запас/.test(text)) return "inventory";
  if (/закуп|procurement|purchase|supplier/.test(text)) return "procurement";
  if (/рейс|перевоз|shipment|route|dispatch|fleet|transport/.test(text)) return "shipment";
  if (/задач|task|calendar/.test(text)) return "task";
  if (/отчет|report|analytics|аналит/.test(text)) return "report";
  if (productFamily === "crm") return "lead";
  if (["marketplace", "ecommerce"].includes(productFamily)) return "product";
  if (productFamily === "erp") return "procurement";
  if (productFamily === "tms") return "shipment";
  return "record";
}

function actionTargetIds(action = {}) {
  return uniqueStrings([
    action.targetScreenId,
    ...(action.outcomes || []).map((outcome) => outcome.targetScreenId),
  ]);
}

function hasGenericPrimaryContent(screen = {}) {
  const itemTitles = (screen.content?.items || []).slice(0, 3).map((item) => cleanText(item.title, 80).toLowerCase());
  const fieldLabels = (screen.content?.fields || []).slice(0, 3).map((field) => cleanText(field.label, 80).toLowerCase());
  const genericItemSet = new Set(["название", "статус", "далее", "title", "status", "next"]);
  const genericFieldSet = new Set(["описание", "статус", "id", "description", "status"]);
  return itemTitles.length >= 3 && itemTitles.every((title) => genericItemSet.has(title))
    || fieldLabels.length >= 3 && fieldLabels.every((label) => genericFieldSet.has(label));
}

function linearActionRatio(screens = []) {
  const checked = [];
  for (const [index, screen] of screens.entries()) {
    const action = (screen.actions || []).find((row) => ["navigate", undefined].includes(row.type) && row.targetScreenId);
    if (!action) continue;
    checked.push(action.targetScreenId === (screens[index + 1]?.id || screens[0]?.id));
  }
  return checked.length ? checked.filter(Boolean).length / checked.length : 0;
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

function ecommerceScreens(context) {
  const { t } = context;
  return catalogScreens(context, [
    ...sharedScreenDefinitions(t),
    ["home", "dashboard", t.home, "Персональная витрина интернет-магазина"],
    ["catalog", "product_grid", t.catalog, "Каталог товаров собственного магазина"],
    ["categories", "product_grid", "Категории", "Навигация по разделам ассортимента"],
    ["catalog_filters", "form", "Фильтры", "Цена, бренд, наличие и характеристики"],
    ["search_suggestions", "list", "Подсказки поиска", "Популярные категории и недавние запросы"],
    ["search_empty", "empty_state", "Ничего не найдено", "Альтернативные товары и категории"],
    ["product", "details", t.product, "Описание, цена, наличие и варианты товара"],
    ["product_gallery", "details", "Галерея товара", "Фотографии и выбранный вариант"],
    ["product_reviews", "list", "Отзывы", "Оценки покупателей и вопросы о товаре"],
    ["favorites", "product_grid", "Избранное", "Сохранённые товары"],
    ["compare", "list", "Сравнение", "Сопоставление характеристик товаров"],
    ["cart", "list", t.cart, "Товары, количество и стоимость"],
    ["cart_empty", "empty_state", "Корзина пуста", "Возврат к каталогу и рекомендациям"],
    ["checkout", "checkout", t.checkout, "Контакты получателя и оформление заказа"],
    ["delivery_address", "form", "Адрес доставки", "Добавление и проверка адреса"],
    ["delivery_method", "list", "Способ доставки", "Курьер, пункт выдачи или самовывоз"],
    ["pickup_points", "list", "Пункты выдачи", "Выбор точки получения на карте"],
    ["promo_code", "form", "Промокод", "Применение скидки магазина"],
    ["order_summary", "checkout", "Проверка заказа", "Товары, доставка, скидка и итог"],
    ["payment_methods", "list", "Способ оплаты", "Карта, наличные или онлайн-оплата"],
    ["payment", "payment", t.payment, "Подтверждение суммы и оплаты"],
    ["payment_processing", "stepper", "Оплата обрабатывается", "Проверка статуса платежа"],
    ["confirmation", "success", t.confirmation, "Заказ принят интернет-магазином"],
    ["orders", "history", "Мои заказы", "Активные и завершённые покупки"],
    ["order_details", "details", "Детали заказа", "Состав, доставка, оплата и документы"],
    ["tracking", "tracking", t.tracking, "Сборка, передача и доставка заказа"],
    ["return_request", "form", "Оформление возврата", "Товары, причина и способ возврата"],
    ["return_status", "tracking", "Статус возврата", "Проверка товара и возврат средств"],
    ["support", "list", "Поддержка", "Вопросы о заказах, товарах и доставке"],
    ["chat", "details", "Чат с магазином", "Диалог по заказу или возврату"],
    ["profile_orders", "history", "История покупок", "Повторный заказ и электронные чеки"],
    ["admin_dashboard", "dashboard", "Управление магазином", "Заказы, выручка и остатки", "admin"],
    ["admin_catalog", "product_grid", "Управление каталогом", "Товары, категории и публикация", "admin"],
    ["admin_product_create", "form", "Новый товар", "Контент, цена, варианты и остаток", "admin"],
    ["admin_product_edit", "form", "Редактирование товара", "Карточка, SEO и доступность", "admin"],
    ["admin_inventory", "list", "Остатки", "Наличие по складам и резервам", "admin"],
    ["admin_orders", "list", "Управление заказами", "Сборка, доставка и исключения", "admin"],
    ["admin_order_details", "details", "Заказ магазина", "Покупатель, товары и исполнение", "admin"],
    ["admin_promotions", "list", "Акции и промокоды", "Скидки, периоды и аудитории", "admin"],
    ["admin_customers", "list", "Покупатели", "Заказы, сегменты и согласия", "admin"],
    ["admin_analytics", "analytics", "Аналитика магазина", "Продажи, конверсия и средний чек", "admin"],
    ["admin_content", "settings", "Контент витрины", "Баннеры, подборки и страницы", "admin"],
    ["admin_settings", "settings", t.settings, "Оплата, доставка и правила магазина", "admin"],
  ]);
}

function erpScreens(context) {
  const { t } = context;
  return catalogScreens(context, [
    ...sharedScreenDefinitions(t, "operator"),
    ["dashboard", "dashboard", t.dashboard, "Закупки, запасы, финансы и отклонения", "operator"],
    ["activity_feed", "history", "Операционная лента", "Последние документы и изменения статусов", "operator"],
    ["quick_create", "form", "Быстрое создание", "Заявка, заказ, перемещение или расход", "operator"],
    ["procurement_requests", "list", "Заявки на закупку", "Потребности подразделений и приоритеты", "operator"],
    ["procurement_request_create", "form", "Новая заявка", "Номенклатура, количество и центр затрат", "operator"],
    ["procurement_request_details", "details", "Карточка заявки", "Позиции, инициатор и доступный бюджет", "operator"],
    ["procurement_approval", "stepper", "Согласование закупки", "Руководитель, бюджетный контроль и снабжение", "operator"],
    ["suppliers", "list", "Поставщики", "Условия, рейтинг и активные договоры", "operator"],
    ["supplier_details", "details", "Карточка поставщика", "Реквизиты, договоры и история поставок", "operator"],
    ["purchase_orders", "list", "Заказы поставщикам", "Открытые, подтверждённые и просроченные заказы", "operator"],
    ["purchase_order_create", "form", "Новый заказ поставщику", "Поставщик, позиции, цены и даты", "operator"],
    ["purchase_order_details", "details", "Заказ поставщику", "Поставка, оплата и связанные документы", "operator"],
    ["purchase_order_approval", "stepper", "Согласование заказа", "Проверка условий и лимитов", "operator"],
    ["goods_receipts", "list", "Приёмка товаров", "Ожидаемые и принятые поставки", "operator"],
    ["inventory", "list", "Номенклатура и остатки", "Свободный запас, резерв и доступность", "operator"],
    ["inventory_item", "details", "Карточка номенклатуры", "Единицы, партии, цены и движения", "operator"],
    ["stock_movements", "history", "Движения запасов", "Приходы, расходы и корректировки", "operator"],
    ["stock_transfer", "form", "Перемещение между складами", "Склад-источник, получатель и позиции", "operator"],
    ["stock_count", "stepper", "Инвентаризация", "Подсчёт, расхождения и корректировка", "operator"],
    ["warehouses", "list", "Склады", "Загрузка, ёмкость и ответственные", "operator"],
    ["warehouse_details", "details", "Карточка склада", "Зоны хранения и текущие остатки", "operator"],
    ["sales_orders", "list", "Заказы клиентов", "Резерв, комплектация и отгрузка", "operator"],
    ["sales_order_details", "details", "Заказ клиента", "Позиции, оплата и исполнение", "operator"],
    ["shipment_planning", "stepper", "Планирование отгрузки", "Комплектация, документы и передача", "operator"],
    ["finance_dashboard", "dashboard", "Финансы", "Денежный поток, задолженность и лимиты", "operator"],
    ["invoices", "list", "Счета и накладные", "Документы к оплате и сроки", "operator"],
    ["invoice_details", "details", "Карточка счёта", "Контрагент, проводки и связанные документы", "operator"],
    ["payment_register", "history", "Реестр платежей", "Плановые и проведённые операции", "operator"],
    ["expense_requests", "list", "Заявки на расходы", "Суммы, статьи и согласование", "operator"],
    ["budget_control", "analytics", "Контроль бюджета", "План, факт и доступные лимиты", "operator"],
    ["manufacturing_plan", "analytics", "Производственный план", "Потребность, загрузка и сроки", "operator"],
    ["work_orders", "list", "Производственные задания", "Очередь, выпуск и отклонения", "operator"],
    ["bill_of_materials", "details", "Спецификация изделия", "Материалы, нормы и версии", "operator"],
    ["maintenance", "list", "Обслуживание оборудования", "Регламентные работы и простои", "operator"],
    ["reports", "analytics", t.reports, "Сводные показатели ERP", "admin"],
    ["inventory_report", "analytics", "Отчёт по запасам", "Оборачиваемость, дефицит и излишки", "admin"],
    ["procurement_report", "analytics", "Отчёт по закупкам", "Сроки, цены и поставщики", "admin"],
    ["finance_report", "analytics", "Финансовый отчёт", "Доходы, расходы и задолженность", "admin"],
    ["roles", "settings", "Роли", "Функциональные роли подразделений", "admin"],
    ["permissions", "settings", "Права доступа", "Матрица модулей, организаций и складов", "admin"],
    ["integrations", "settings", "Интеграции", "Банк, бухгалтерия, ЭДО и внешние системы", "admin"],
    ["audit_log", "history", "Журнал аудита", "Документы, проводки и критичные изменения", "admin"],
    ["settings", "settings", t.settings, "Организации, справочники и учётная политика", "admin"],
  ]);
}

function tmsScreens(context) {
  const { t } = context;
  return catalogScreens(context, [
    ...sharedScreenDefinitions(t, "operator"),
    ["dashboard", "dashboard", t.dashboard, "Рейсы, транспорт, SLA и операционные отклонения", "operator"],
    ["activity_feed", "history", "Операционная лента", "Последние назначения, статусы и исключения", "operator"],
    ["quick_create", "form", "Быстрое создание", "Заказ, рейс, маршрут или инцидент", "operator"],
    ["transport_orders", "list", "Транспортные заказы", "Заявки на перевозку и приоритет исполнения", "operator"],
    ["transport_order_create", "form", "Новый транспортный заказ", "Груз, точки, сроки и требования", "operator"],
    ["transport_order_details", "details", "Карточка транспортного заказа", "Маршрут, груз, клиент и связанные рейсы", "operator"],
    ["shipments", "list", "Перевозки", "Плановые, активные и завершённые перевозки", "operator"],
    ["shipment_create", "form", "Новая перевозка", "Заказ, транспорт, водитель и временные окна", "operator"],
    ["shipment_details", "details", "Карточка перевозки", "Точки, статусы, документы и расходы", "operator"],
    ["shipment_status", "stepper", "Статус перевозки", "Подача, погрузка, маршрут и доставка", "operator"],
    ["shipment_tracking", "tracking", "Мониторинг перевозки", "Положение транспорта и прогноз прибытия", "operator"],
    ["dispatch_board", "list", "Диспетчерская", "Распределение заказов по рейсам и ресурсам", "operator"],
    ["dispatch_assignment", "form", "Назначение рейса", "Транспорт, водитель, маршрут и смена", "operator"],
    ["routes", "list", "Маршруты", "Шаблоны и активные маршруты перевозок", "operator"],
    ["route_plan", "stepper", "Планирование маршрута", "Точки, ограничения, расстояние и ETA", "operator"],
    ["route_map", "details", "Карта маршрута", "Текущая позиция, остановки и отклонения", "operator"],
    ["fleet", "list", "Автопарк", "Доступность, загрузка и техническое состояние", "operator"],
    ["vehicle_details", "details", "Карточка транспорта", "Параметры, пробег, документы и рейсы", "operator"],
    ["maintenance_schedule", "history", "График обслуживания", "ТО, ремонты и сроки допуска", "operator"],
    ["drivers", "list", "Водители", "Доступность, категории и текущие назначения", "operator"],
    ["driver_details", "details", "Карточка водителя", "Документы, рейтинг, смены и рейсы", "operator"],
    ["driver_schedule", "history", "График водителей", "Смены, отдых и доступные интервалы", "operator"],
    ["loads", "list", "Грузы", "Состав, параметры и требования к перевозке", "operator"],
    ["load_details", "details", "Карточка груза", "Места, вес, температура и ограничения", "operator"],
    ["warehouses", "list", "Склады и терминалы", "Точки погрузки, разгрузки и контакты", "operator"],
    ["dock_schedule", "history", "Расписание ворот", "Окна погрузки и занятость терминала", "operator"],
    ["transport_documents", "list", "Документы перевозки", "Накладные, путевые листы и акты", "operator"],
    ["waybill", "details", "Транспортная накладная", "Участники, груз, маршрут и подписи", "operator"],
    ["proof_of_delivery", "form", "Подтверждение доставки", "Фото, подпись, время и замечания", "operator"],
    ["rate_calculator", "form", "Расчёт тарифа", "Маршрут, транспорт, груз и дополнительные услуги", "operator"],
    ["invoices", "list", "Счета", "Начисления клиентам и статусы оплаты", "operator"],
    ["invoice_details", "details", "Карточка счёта", "Рейсы, тарифы, корректировки и оплата", "operator"],
    ["carrier_settlements", "history", "Расчёты с перевозчиками", "Начисления, удержания и выплаты", "operator"],
    ["incidents", "list", "Инциденты", "Опоздания, поломки и нарушения условий", "operator"],
    ["claims", "list", "Претензии", "Ущерб, документы и урегулирование", "operator"],
    ["clients", "list", t.clients, "Грузоотправители, получатели и договоры", "operator"],
    ["client_details", "details", "Карточка клиента", "Контакты, тарифы, SLA и история перевозок", "operator"],
    ["reports", "analytics", t.reports, "Сводные показатели транспортной логистики", "admin"],
    ["delivery_report", "analytics", "Отчёт по доставкам", "Сроки, SLA и причины отклонений", "admin"],
    ["fleet_report", "analytics", "Отчёт по автопарку", "Пробег, загрузка, простои и обслуживание", "admin"],
    ["profitability_report", "analytics", "Рентабельность рейсов", "Выручка, расходы и маржинальность", "admin"],
    ["integrations", "settings", "Интеграции", "GPS, карты, ЭДО, ERP и бухгалтерия", "admin"],
    ["roles", "settings", "Роли", "Диспетчеры, логисты, водители и бухгалтерия", "admin"],
    ["permissions", "settings", "Права доступа", "Матрица действий по филиалам и операциям", "admin"],
    ["audit_log", "history", "Журнал аудита", "Изменения маршрутов, тарифов и документов", "admin"],
    ["settings", "settings", t.settings, "Транспорт, статусы, тарифы и правила SLA", "admin"],
  ]);
}

function saasScreens(context) {
  const { t } = context;
  return catalogScreens(context, [
    ...sharedScreenDefinitions(t),
    ["dashboard", "dashboard", t.dashboard, "Активность, задачи, использование и быстрые действия"],
    ["activity_feed", "history", "Лента активности", "Изменения данных и действия команды"],
    ["quick_create", "form", "Быстрое создание", "Проект, запись, задача или автоматизация"],
    ["workspaces", "list", "Рабочие пространства", "Доступные пространства и последние обновления"],
    ["workspace_create", "form", "Новое пространство", "Название, шаблон и режим доступа"],
    ["workspace_details", "details", "Настройки пространства", "Участники, модули и параметры"],
    ["workspace_members", "list", "Участники пространства", "Роли, приглашения и статус доступа"],
    ["projects", "list", "Проекты", "Активные проекты, владельцы и прогресс"],
    ["project_create", "form", "Новый проект", "Название, шаблон, сроки и команда"],
    ["project_details", "details", "Карточка проекта", "Статус, участники и связанные записи"],
    ["records", "list", "Записи", "Рабочие объекты выбранного проекта"],
    ["record_filters", "form", "Фильтры записей", "Статус, владелец, период и метки"],
    ["record_create", "form", "Новая запись", "Основные поля, связи и ответственный"],
    ["record_details", "details", "Карточка записи", "Данные, обсуждение и связанные задачи"],
    ["record_history", "history", "История записи", "Изменения полей и действия участников"],
    ["tasks", "list", t.tasks, "Личные и командные задачи"],
    ["task_details", "details", "Карточка задачи", "Срок, исполнитель, чек-лист и обсуждение"],
    ["task_create", "form", "Новая задача", "Проект, приоритет, срок и исполнитель"],
    ["calendar", "history", "Календарь", "Задачи, события и контрольные даты"],
    ["automations", "list", "Автоматизации", "Активные правила и состояние запусков"],
    ["automation_create", "form", "Новая автоматизация", "Триггер, условия и последовательность действий"],
    ["automation_details", "details", "Сценарий автоматизации", "Логика, версия и связанные объекты"],
    ["automation_runs", "history", "История запусков", "Результаты, ошибки и время выполнения"],
    ["templates", "list", "Шаблоны", "Готовые структуры проектов и процессов"],
    ["template_details", "details", "Карточка шаблона", "Состав, автор и параметры применения"],
    ["files", "list", "Файлы", "Документы команды, версии и общий доступ"],
    ["reports", "analytics", t.reports, "Показатели проектов и процессов"],
    ["report_details", "analytics", "Детали отчёта", "Фильтры, разрезы и динамика"],
    ["team", "profile", "Команда", "Участники, нагрузка и статус доступа", "admin"],
    ["invite_member", "form", "Пригласить участника", "Почта, роль и рабочие пространства", "admin"],
    ["member_details", "profile", "Профиль участника", "Роль, команды, активность и сессии", "admin"],
    ["roles", "settings", "Роли", "Наборы полномочий для участников", "admin"],
    ["permissions", "settings", "Права доступа", "Матрица модулей и действий", "admin"],
    ["billing_overview", "dashboard", "Подписка и оплата", "Тариф, баланс, использование и следующий платёж", "admin"],
    ["plans", "list", "Тарифные планы", "Лимиты, функции и стоимость подписки", "admin"],
    ["subscription_checkout", "checkout", "Оформление подписки", "План, период, реквизиты и итог", "admin"],
    ["payment_methods", "list", "Способы оплаты", "Карты и платёжные реквизиты организации", "admin"],
    ["invoices", "list", "Счета", "История начислений и статусы оплаты", "admin"],
    ["invoice_details", "details", "Детали счёта", "Период, позиции, налоги и документы", "admin"],
    ["usage", "analytics", "Использование", "Пользователи, хранилище, автоматизации и API", "admin"],
    ["api_keys", "settings", "API-ключи", "Ключи доступа, области и срок действия", "admin"],
    ["webhooks", "settings", "Вебхуки", "События, адреса и история доставки", "admin"],
    ["integrations", "settings", "Интеграции", "Подключённые сервисы и каталог приложений", "admin"],
    ["audit_log", "history", "Журнал аудита", "Входы, права и критичные изменения", "admin"],
    ["settings", "settings", t.settings, "Организация, локаль, данные и политики", "admin"],
  ]);
}

function mobileAppScreens(context) {
  const { t } = context;
  return catalogScreens(context, [
    ...sharedScreenDefinitions(t),
    ["home", "dashboard", t.home, "Персональная сводка и основные действия"],
    ["feed", "list", "Лента", "Актуальные материалы и обновления"],
    ["discover", "product_grid", "Обзор", "Рекомендации и тематические подборки"],
    ["categories", "product_grid", "Категории", "Навигация по разделам приложения"],
    ["content_details", "details", "Карточка материала", "Содержание, метаданные и доступные действия"],
    ["favorites", "list", "Избранное", "Сохранённые материалы и записи"],
    ["recent", "history", "Недавнее", "Последние просмотры и действия"],
    ["collections", "list", "Подборки", "Личные и рекомендованные коллекции"],
    ["collection_details", "details", "Карточка подборки", "Состав, автор и обновления"],
    ["create_entry", "form", "Новая запись", "Данные, категория и вложения"],
    ["entry_details", "details", "Карточка записи", "Содержимое, статус и история"],
    ["edit_entry", "form", "Редактирование записи", "Поля, вложения и видимость"],
    ["submit_review", "checkout", "Проверка перед отправкой", "Итоговые данные и согласия"],
    ["submit_success", "success", "Запись отправлена", "Результат сохранён и доступен в истории"],
    ["inbox", "list", "Сообщения", "Диалоги и непрочитанные сообщения"],
    ["conversation", "details", "Диалог", "Переписка, вложения и статус доставки"],
    ["media_library", "product_grid", "Медиатека", "Фото, видео и документы пользователя"],
    ["media_upload", "form", "Загрузка файла", "Источник, предпросмотр и параметры"],
    ["scanner", "form", "Сканер", "Камера, распознавание и подтверждение результата"],
    ["location_picker", "form", "Выбор местоположения", "Адрес, точка на карте и комментарий"],
    ["map", "details", "Карта", "Объекты рядом, маршрут и выбранная точка"],
    ["downloads", "list", "Загрузки", "Материалы, доступные без интернета"],
    ["offline_state", "empty_state", "Нет подключения", "Доступные офлайн-данные и повторная синхронизация"],
    ["sync_status", "stepper", "Синхронизация", "Очередь изменений и состояние передачи"],
    ["app_permissions", "settings", "Разрешения приложения", "Камера, геолокация, уведомления и файлы"],
    ["connected_devices", "list", "Устройства", "Активные сессии и доверенные устройства"],
    ["appearance", "settings", "Оформление", "Тема, размер текста и отображение"],
    ["privacy", "settings", "Конфиденциальность", "Видимость данных и персональные согласия"],
    ["help", "list", "Помощь", "Ответы на вопросы и инструкции"],
    ["support_ticket", "form", "Обращение в поддержку", "Тема, описание и вложения"],
    ["feedback", "form", "Обратная связь", "Оценка приложения и комментарий"],
    ["update_required", "error_state", "Нужно обновление", "Переход к поддерживаемой версии приложения"],
    ["connection_error", "error_state", "Ошибка соединения", "Повтор запроса и сохранение введённых данных"],
    ["admin_dashboard", "dashboard", "Управление приложением", "Аудитория, активность и стабильность", "admin"],
    ["admin_content", "list", "Управление контентом", "Материалы, категории и публикация", "admin"],
    ["admin_content_create", "form", "Новый материал", "Контент, аудитория и время публикации", "admin"],
    ["admin_users", "list", "Пользователи", "Статусы, сегменты и ограничения", "admin"],
    ["admin_user_details", "details", "Карточка пользователя", "Профиль, устройства и активность", "admin"],
    ["admin_analytics", "analytics", "Аналитика приложения", "Активация, удержание и ключевые действия", "admin"],
    ["push_campaigns", "list", "Push-кампании", "Аудитории, расписание и результаты", "admin"],
    ["push_campaign_create", "form", "Новая push-кампания", "Сообщение, сегмент и время отправки", "admin"],
    ["feature_flags", "settings", "Управление функциями", "Релизы, аудитории и аварийное отключение", "admin"],
    ["app_versions", "history", "Версии приложения", "Релизы, обязательность и доля установки", "admin"],
    ["admin_settings", "settings", t.settings, "Контент, версии, интеграции и политики", "admin"],
  ]);
}

function websiteScreens(context) {
  const { t } = context;
  return catalogScreens(context, [
    ...sharedScreenDefinitions(t),
    ["home", "dashboard", t.home, "Главная страница с ключевым предложением и разделами"],
    ["about", "details", "О компании", "История, компетенции и факты о компании"],
    ["services", "list", "Услуги", "Каталог направлений и форматов работы"],
    ["service_details", "details", "Страница услуги", "Результат, процесс и связанные кейсы"],
    ["solutions", "list", "Решения", "Предложения по задачам и отраслям"],
    ["solution_details", "details", "Страница решения", "Сценарии, преимущества и состав"],
    ["case_studies", "product_grid", "Кейсы", "Проекты, отрасли и достигнутые результаты"],
    ["case_details", "details", "Страница кейса", "Задача, решение, процесс и показатели"],
    ["pricing", "list", "Тарифы", "Пакеты, состав и условия подключения"],
    ["faq", "list", "Вопросы и ответы", "Условия, процесс и частые уточнения"],
    ["blog", "product_grid", "Блог", "Статьи, новости и тематические подборки"],
    ["article", "details", "Статья", "Материал, автор, дата и связанные публикации"],
    ["authors", "list", "Авторы", "Эксперты и опубликованные материалы"],
    ["contacts", "details", "Контакты", "Офисы, реквизиты и каналы связи"],
    ["contact_form", "form", "Связаться с нами", "Контакты, тема и сообщение"],
    ["contact_success", "success", "Сообщение отправлено", "Подтверждение и ожидаемый срок ответа"],
    ["careers", "details", "Карьера", "Команда, культура и процесс найма"],
    ["jobs", "list", "Вакансии", "Открытые позиции, направления и локации"],
    ["job_details", "details", "Страница вакансии", "Задачи, требования и условия"],
    ["job_application", "form", "Отклик на вакансию", "Контакты, резюме и сопроводительное письмо"],
    ["job_application_success", "success", "Отклик отправлен", "Подтверждение получения заявки"],
    ["partners", "list", "Партнёры", "Технологические и бизнес-партнёры"],
    ["events", "list", "События", "Предстоящие вебинары и мероприятия"],
    ["event_details", "details", "Страница события", "Программа, спикеры и регистрация"],
    ["newsletter", "form", "Подписка на новости", "Почта, темы и согласие на рассылку"],
    ["newsletter_success", "success", "Подписка оформлена", "Подтверждение адреса и выбранных тем"],
    ["privacy_policy", "details", "Политика конфиденциальности", "Обработка данных и права пользователя"],
    ["terms", "details", "Условия использования", "Правила доступа и ответственность сторон"],
    ["cookies", "settings", "Настройки cookie", "Обязательные, аналитические и маркетинговые cookie"],
    ["not_found", "empty_state", "Страница не найдена", "Навигация к основным разделам сайта"],
    ["maintenance", "error_state", "Технические работы", "Статус обслуживания и время восстановления"],
    ["cms_dashboard", "dashboard", "Панель сайта", "Публикации, формы, трафик и задачи", "admin"],
    ["cms_pages", "list", "Страницы", "Структура, статусы и даты публикации", "admin"],
    ["cms_page_create", "form", "Новая страница", "Шаблон, адрес, заголовок и доступ", "admin"],
    ["cms_page_editor", "form", "Редактор страницы", "Секции, контент, предпросмотр и публикация", "admin"],
    ["cms_media", "product_grid", "Медиатека сайта", "Изображения, видео, документы и метаданные", "admin"],
    ["cms_navigation", "settings", "Навигация", "Меню, вложенность и служебные ссылки", "admin"],
    ["cms_forms", "list", "Формы", "Поля, маршрутизация и уведомления", "admin"],
    ["cms_submissions", "list", "Заявки с сайта", "Обращения, отклики и подписки", "admin"],
    ["cms_seo", "settings", "SEO", "Метаданные, индексация и карта сайта", "admin"],
    ["cms_redirects", "list", "Перенаправления", "Исходные адреса, назначения и статусы", "admin"],
    ["cms_localization", "settings", "Локализация", "Языки, переводы и готовность страниц", "admin"],
    ["cms_users", "list", "Редакторы", "Роли, доступ и последние изменения", "admin"],
    ["cms_analytics", "analytics", "Аналитика сайта", "Источники, страницы, конверсии и формы", "admin"],
    ["cms_integrations", "settings", "Интеграции сайта", "CRM, аналитика, рассылки и карты", "admin"],
    ["cms_settings", "settings", t.settings, "Домен, локали, SEO и публикация", "admin"],
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
  const { t, domainModel } = context;
  const primaryEntity = domainModel.entities[0] || { id: "record", title: t.workspace, detail: t.projectDescription };
  const secondaryEntity = domainModel.entities[1] || { id: "task", title: t.tasks, detail: t.history };
  const flowTitle = domainModel.flows[0]?.title || primaryEntity.title;
  const definitions = [
    ["onboarding", "onboarding", t.onboarding, productValueDescription(context), "buyer"],
    ["dashboard", "dashboard", t.dashboard, `${flowTitle}: ключевые показатели и действия`, "buyer"],
    ["workspace", "list", t.workspace, `${primaryEntity.title}: рабочий список и статусы`, "buyer"],
    [`${primaryEntity.id}_details`, "details", cleanText(primaryEntity.title, 72), primaryEntity.detail, "buyer"],
    [`${primaryEntity.id}_form`, "form", `${t.form}: ${cleanText(primaryEntity.title, 48)}`, `Создание или обновление: ${primaryEntity.detail}`, "buyer"],
    ["workflow", "stepper", flowTitle, "Шаги основного процесса и текущий результат", "buyer"],
    ["workflow_success", "success", t.success, `${flowTitle}: результат сохранён`, "buyer"],
    ["tasks", "list", t.tasks, `${secondaryEntity.title}: ближайшие действия и ответственность`, "buyer"],
  ];
  if (domainModel.integrations.length) definitions.push(["integrations", "settings", "Интеграции", "Подключения, влияющие на пользовательский сценарий", "admin"]);
  if (domainModel.hasAdminScope) {
    definitions.push(
      ["admin_workspace", "dashboard", `${t.admin} ${t.workspace}`, "Контроль процессов, ролей и исключений", "admin"],
      ["permissions", "settings", "Права доступа", "Матрица ролей и допустимых действий", "admin"],
      ["audit_log", "history", "Журнал аудита", "Критичные действия и изменения", "admin"],
    );
  }
  return catalogScreens(context, definitions);
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
  const hasAuth = context.domainModel.hasAuth;
  const hasPayment = hasSemanticIntegration(context.semanticModel, "payment") || /payment|pay|checkout|оплат|to'lov|платеж/i.test(text);
  const hasDelivery = hasSemanticIntegration(context.semanticModel, "delivery") || /delivery|shipping|достав|yetkaz/i.test(text);
  const hasSeller = context.domainModel.hasSellerScope;
  const hasOperator = context.domainModel.hasOperatorScope;
  const hasAdmin = context.domainModel.hasAdminScope;
  return screens.filter((row) => {
    if (/^(language|login|login_otp|password_reset|password_reset_done|profile|profile_edit|security|connected_devices)$/.test(row.id) && !hasAuth) return false;
    if (row.id === "payment" && !hasPayment && !["marketplace", "fintech"].includes(context.productFamily)) return false;
    if (row.id === "tracking" && !hasDelivery && context.productFamily !== "marketplace") return false;
    if (/^seller_/.test(row.id) && !hasSeller) return false;
    if (/^operator_/.test(row.id) && !hasOperator) return false;
    if (/^(admin_|cms_|roles$|permissions$|audit_log$|team$|user_details$|member_details$|invite_member$|billing_|plans$|subscription_|api_keys$|webhooks$|usage$|feature_flags$|app_versions$)/.test(row.id) && !hasAdmin) return false;
    return true;
  });
}

function selectScreensForPrototype(screens, context) {
  const candidates = applyConditionalScreens(screens, context)
    .filter((screen) => screen.id !== "design_system" && screenAllowedByDomain(screen, context));
  const byId = new Map(candidates.map((screen) => [screen.id, screen]));
  const selected = [];
  const addId = (id) => {
    const candidate = byId.get(id);
    if (candidate && !selected.some((screen) => screen.id === candidate.id)) selected.push(candidate);
  };
  const addIds = (ids) => ids.forEach(addId);
  const coreIds = coreScreenIdsFor(context);
  addIds(coreIds);
  const scored = candidates
    .filter((screen) => !selected.some((row) => row.id === screen.id))
    .map((screen) => ({ screen, score: screenRelevanceScore(screen, context) }))
    .sort((a, b) => b.score - a.score || a.screen.id.localeCompare(b.screen.id));
  const targetMax = targetScreenMax(context);
  for (const row of scored) {
    if (selected.length >= targetMax) break;
    if (row.score > 0 || selected.length < TARGET_SCREEN_RANGE.min) selected.push(row.screen);
  }
  if (selected.length < TARGET_SCREEN_RANGE.min) {
    for (const candidate of candidates) {
      if (selected.length >= TARGET_SCREEN_RANGE.min) break;
      if (!selected.some((screen) => screen.id === candidate.id)) selected.push(candidate);
    }
  }
  return trimScreensForTarget(ensureOutcomeScreens(selected, candidates, context), targetMax);
}

function screenAllowedByDomain(screen, context) {
  const id = screen.id;
  if (/^(admin_|cms_|roles$|permissions$|audit_log$|team$|user_details$|member_details$|invite_member$|billing_|plans$|subscription_|api_keys$|webhooks$|usage$|feature_flags$|app_versions$)/.test(id) && !context.domainModel.hasAdminScope) return false;
  if (/^seller_/.test(id) && !context.domainModel.hasSellerScope) return false;
  if (/^operator_/.test(id) && !context.domainModel.hasOperatorScope) return false;
  return true;
}

function coreScreenIdsFor(context) {
  const auth = context.domainModel.hasAuth ? ["login", "login_otp"] : [];
  const admin = context.domainModel.hasAdminScope;
  const map = {
    marketplace: ["onboarding", ...auth, "home", "catalog", "product", "cart", "checkout", "payment", "confirmation", "orders", "order_details", "tracking", "seller_workspace", "seller_products", "support", "profile"],
    ecommerce: ["onboarding", ...auth, "home", "catalog", "product", "cart", "checkout", "payment_methods", "payment", "confirmation", "orders", "order_details", "support", "profile"],
    fintech: ["onboarding", ...auth, "home", "limit_request", "verification", "offers", "contract_review", "contract_sign", "contract_success", "installments", "payment", "payment_success", "documents", "profile"],
    crm: ["onboarding", ...auth, "dashboard", "leads", "lead_details", "lead_create", "lead_qualify", "lead_convert", "pipeline", "tasks", "task_create", "calendar", "clients", "profile"],
    erp: ["onboarding", ...auth, "dashboard", "procurement_requests", "procurement_request_details", "procurement_approval", "purchase_orders", "inventory", "inventory_item", "finance_dashboard", "invoices", "reports"],
    tms: ["onboarding", ...auth, "dashboard", "transport_orders", "transport_order_details", "shipment_status", "shipment_tracking", "dispatch_board", "shipments", "fleet", "vehicle_details", "reports"],
    saas: ["onboarding", ...auth, "dashboard", "workspaces", "workspace_details", "projects", "project_create", "records", "record_details", "tasks", "automations", "reports"],
    "mobile-app": ["onboarding", ...auth, "home", "feed", "discover", "content_details", "create_entry", "submit_review", "submit_success", "inbox", "media_library", "app_permissions"],
    website: ["onboarding", "home", "services", "service_details", "case_studies", "contacts", "contact_form", "contact_success", "faq", "blog", "article"],
    "business-app": ["onboarding", ...auth, "dashboard", "workspace", `${context.domainModel.entities[0]?.id || "record"}_details`, `${context.domainModel.entities[0]?.id || "record"}_form`, "workflow", "workflow_success", "tasks"],
  };
  const ids = map[context.productFamily] || map["business-app"];
  const sellerIds = {
    marketplace: ["seller_workspace", "seller_products", "seller_orders", "seller_analytics"],
  };
  const adminIds = {
    marketplace: ["admin_workspace", "reports", "settings"],
    ecommerce: ["admin_dashboard", "admin_catalog", "admin_orders", "admin_analytics", "admin_settings"],
    crm: ["reports", "team", "roles", "permissions", "integrations", "settings"],
    erp: ["reports", "roles", "permissions", "integrations", "settings"],
    tms: ["reports", "integrations", "roles", "permissions", "settings"],
    saas: ["team", "billing_overview", "plans", "subscription_checkout", "integrations", "settings"],
    "mobile-app": ["admin_dashboard", "admin_content", "admin_users", "admin_analytics", "feature_flags"],
    website: ["cms_dashboard", "cms_pages", "cms_submissions", "cms_analytics", "cms_settings"],
    "business-app": ["admin_workspace", "permissions", "integrations", "audit_log"],
  };
  return uniqueStrings([
    ...ids,
    ...(context.domainModel.hasSellerScope ? (sellerIds[context.productFamily] || []) : []),
    ...(admin ? (adminIds[context.productFamily] || []) : []),
  ]);
}

function targetScreenMax(context) {
  const complexity = (context.domainModel.flows || []).length
    + Math.ceil((context.domainModel.entities || []).length / 2)
    + (context.roles.length > 1 ? 2 : 0)
    + (context.domainModel.hasAdminScope ? 2 : 0);
  if (context.productFamily === "marketplace" && context.domainModel.hasSellerScope) return TARGET_SCREEN_RANGE.max;
  return Math.min(TARGET_SCREEN_RANGE.max, Math.max(TARGET_SCREEN_RANGE.min, TARGET_SCREEN_RANGE.preferred + complexity - 2));
}

function screenRelevanceScore(screen, context) {
  let score = 0;
  const text = `${screen.id} ${screen.title} ${screen.description}`.toLowerCase();
  for (const entity of context.domainModel.entities || []) {
    const entityText = `${entity.id} ${entity.kind} ${entity.title}`.toLowerCase();
    if (entityText.split(/\s+/).some((token) => token.length > 3 && text.includes(token))) score += 3;
  }
  for (const capability of context.domainModel.capabilities || []) {
    const capabilityText = `${capability.title} ${capability.detail}`.toLowerCase();
    if (capabilityText.split(/\s+/).some((token) => token.length > 5 && text.includes(token))) score += 2;
  }
  if ((screen.sourceRefs || []).some((ref) => !String(ref).startsWith("DERIVED-"))) score += 2;
  if (["dashboard", "list", "details", "form", "stepper", "success"].includes(screen.type)) score += 1;
  if (/empty|error|password|language|design/.test(screen.id)) score -= 2;
  return score;
}

function ensureOutcomeScreens(selected, candidates, context) {
  const result = [...selected];
  if (!result.some((screen) => screen.type === "success")) {
    const success = candidates.find((screen) => screen.type === "success") || screen("success", "success", context.t.success, "Успешное завершение основного сценария", [firstRoleId(context.roles, "buyer")], context);
    if (!result.some((screen) => screen.id === success.id)) result.push(success);
  }
  return result;
}

function trimScreensForTarget(screens, targetMax) {
  if (screens.length <= targetMax) return screens;
  const protectedIndexes = new Set();
  screens.forEach((screen, index) => {
    if (index === 0 || screen.type === "success" || ["home", "dashboard", "workspace", "catalog", "leads"].includes(screen.id)) protectedIndexes.add(index);
  });
  const result = [];
  for (const [index, screen] of screens.entries()) {
    if (result.length < targetMax || protectedIndexes.has(index)) result.push(screen);
  }
  while (result.length > targetMax) {
    const removableIndex = result.findLastIndex((screen, index) => index > 0 && screen.type !== "success" && !["home", "dashboard", "workspace", "catalog", "leads"].includes(screen.id));
    if (removableIndex < 0) break;
    result.splice(removableIndex, 1);
  }
  return result.slice(0, targetMax);
}

function wireScreenActions(screens, context) {
  const ids = new Set(screens.map((screen) => screen.id));
  const first = screens[0]?.id || "";
  const find = (...candidates) => firstExistingScreenId(ids, candidates, first);
  return screens.map((screen) => {
    const actions = actionsForScreen(screen, ids, find, context);
    return {
      ...screen,
      content: normalizeItemActionTargets(screen.content, ids),
      actions: actions.length ? actions : [],
    };
  });
}

function normalizeItemActionTargets(content = {}, screenIds = new Set()) {
  if (!Array.isArray(content.items)) return content;
  return {
    ...content,
    items: content.items.map((item) => {
      if (!item.action?.targetScreenId || screenIds.has(item.action.targetScreenId)) return item;
      return {
        ...item,
        action: { id: item.action.id || `select-${item.id}`, type: "select", label: item.action.label || "Select", stateKey: "selectedItemId", value: item.id },
      };
    }),
  };
}

function actionsForScreen(screen, ids, find, context) {
  const t = context.t;
  const id = screen.id;
  if (screen.type === "success") return [{ id: "go-home", type: "navigate", label: t.done, targetScreenId: find("home", "dashboard", "workspace", "catalog", "leads") }];
  if (screen.type === "empty_state") return [{ id: "reset-view", type: "reset", label: "Сбросить фильтр", stateKey: `${id}.filter` }];
  if (screen.type === "error_state") return [{ id: "retry", type: "back", label: "Повторить" }];
  if (id === "onboarding") return [{ id: "start-flow", type: "navigate", label: context.domainModel.hasAuth ? t.login : t.open, targetScreenId: context.domainModel.hasAuth ? find("login") : find("home", "dashboard", "workspace", "catalog", "leads") }];
  if (id === "login") return [{ id: "submit-login", type: "submit", label: t.login, formId: "login-form", outcomes: [{ when: "demo-success", targetScreenId: find("login_otp", "home", "dashboard", "workspace") }] }];
  if (id === "login_otp") return [{ id: "verify-code", type: "submit", label: t.submit, formId: "otp-form", outcomes: [{ when: "demo-success", targetScreenId: find("home", "dashboard", "workspace", "catalog", "leads") }] }];
  if (/global_search|search/.test(id) && ids.has("search_results")) return [{ id: "run-search", type: "set_value", label: t.search, stateKey: `${id}.query`, value: screen.content?.fields?.[0]?.value || screen.title }];
  if (/filter/.test(id)) return [{ id: "apply-filter", type: "submit", label: "Применить", formId: `${id}-form`, outcomes: [{ when: "demo-success", targetScreenId: find(id.replace(/_?filters?$/, ""), "workspace", "leads", "catalog") }] }];
  if (/settings|security|permissions|roles|app_permissions/.test(id) || screen.layout === "settings-list") return [{ id: "save-settings", type: "copy_demo", label: t.done, value: "Настройки сохранены в demo state" }];
  if (/document/.test(id) && screen.type === "list") {
    return [{ id: "open-document-preview", type: "open_sheet", label: t.open, overlay: overlayForScreen(screen, "sheet") }];
  }
  if (screen.type === "form") {
    return [{ id: "submit-form", type: "submit", label: t.submit, formId: `${id}-form`, outcomes: [{ when: "demo-success", targetScreenId: find(successTargetFor(id), "workflow_success", "lead_convert", "contract_success", "submit_success", "contact_success", "confirmation", "dashboard", "workspace") }] }];
  }
  if (["checkout", "payment", "confirmation"].includes(screen.type)) {
    return [{ id: "confirm", type: "submit", label: screen.type === "payment" ? t.pay : t.submit, formId: `${id}-form`, outcomes: [{ when: "demo-success", targetScreenId: find("payment_success", "contract_success", "submit_success", "contact_success", "confirmation", "workflow_success") }] }];
  }
  if (screen.layout === "kanban") {
    return [{ id: "open-stage", type: "navigate", label: t.open, targetScreenId: find("pipeline_stage", "workflow_details", "deal_details", "lead_details", "workspace", "dashboard") }];
  }
  if (screen.type === "stepper" || screen.type === "tracking") {
    return [
      { id: "advance-step", type: "select", label: t.next, stateKey: `${id}.currentStep`, value: "next" },
      ...(ids.has(successTargetFor(id)) ? [{ id: "finish-flow", type: "navigate", label: t.done, targetScreenId: successTargetFor(id) }] : []),
    ];
  }
  if (["list", "product_grid", "dashboard", "analytics", "history"].includes(screen.type)) {
    return [{ id: "open-primary-record", type: "navigate", label: t.open, targetScreenId: find(detailsTargetFor(id, context), "product", "lead_details", "record_details", "order_details", "details", "workspace") }];
  }
  if (screen.type === "details" || screen.type === "profile") {
    const formTarget = formTargetFor(id, context);
    return [
      ...(ids.has(formTarget) ? [{ id: "edit-record", type: "navigate", label: t.configure, targetScreenId: formTarget }] : []),
      { id: "open-context", type: "open_sheet", label: t.open, overlay: overlayForScreen(screen, "sheet") },
    ];
  }
  return [];
}

function detailsTargetFor(id, context) {
  if (/catalog|product|favorite|merchant/.test(id)) return "product";
  if (/cart|checkout|order|payment/.test(id)) return "order_details";
  if (/lead|dashboard|activity/.test(id) && context.productFamily === "crm") return "lead_details";
  if (/task/.test(id)) return "task_details";
  if (/client/.test(id)) return "client_details";
  if (/procurement/.test(id)) return "procurement_request_details";
  if (/inventory/.test(id)) return "inventory_item";
  if (/transport/.test(id)) return "transport_order_details";
  if (/shipment/.test(id)) return "shipment_details";
  if (/workspace|record/.test(id)) return `${context.domainModel.entities[0]?.id || "record"}_details`;
  return "details";
}

function formTargetFor(id, context) {
  if (/lead/.test(id)) return "lead_create";
  if (/task/.test(id)) return "task_create";
  if (/product/.test(id)) return "admin_product_edit";
  if (/record|workspace/.test(id)) return `${context.domainModel.entities[0]?.id || "record"}_form`;
  return id.replace(/_details$/, "_form");
}

function successTargetFor(id) {
  if (/lead_qualify|lead_create|lead_assign/.test(id)) return "lead_convert";
  if (/contract|verification|limit|offer/.test(id)) return "contract_success";
  if (/payment/.test(id)) return "payment_success";
  if (/submit|entry|contact|newsletter|application/.test(id)) return id.includes("contact") ? "contact_success" : "submit_success";
  if (/checkout|order|cart/.test(id)) return "confirmation";
  return "workflow_success";
}

function overlayForScreen(screen, kind = "sheet") {
  return {
    id: safeId(`${screen.id}_${kind}`, "screen_overlay"),
    kind,
    title: cleanText(screen.title, 80),
    description: cleanText(screen.description, 160),
    items: (screen.content?.items || []).slice(0, 3),
    actions: [{ id: "close-overlay", type: "close_overlay", label: "Закрыть" }],
  };
}

function screen(id, type, title, description, roleIds, context, options = {}) {
  const sourceRefs = pickSourceRefs(context, id);
  const content = contentFor(id, type, title, description, context);
  const layout = content.layout || layoutForScreen(id, type);
  return {
    id,
    type,
    title: cleanText(title, 80),
    description: cleanText(localizeDescription(description, context.t), 180),
    roleIds: roleIds.filter(Boolean).length ? roleIds.filter(Boolean) : [firstRoleId(context.roles, "buyer")],
    sourceRefs,
    intent: intentForScreen(id, type, title, description),
    entityRef: entityRefForScreen(id, context),
    variant: defaultVariantFor(type),
    layout,
    flowRefs: flowRefsForScreen(id, context),
    localState: localStateForScreen(id, layout, content),
    variants: variantsForScreen(type),
    actions: options.action === false ? [] : [{ id: "continue", type: "navigate", label: options.action || actionLabel(type, context.t), targetScreenId: id }],
    content,
  };
}

function contentFor(id, type, title, description, context) {
  const scopeItems = relevantScopeItems(context.semanticModel, context.proposalModel);
  const taskRows = (context.semanticModel.tasks || []).filter((task) => !TECHNICAL_TERMS.test(textOf(task))).slice(0, 6);
  const states = (context.semanticModel.states || []).slice(0, 4);
  const semanticItems = (scopeItems.length ? scopeItems : taskRows).slice(0, 6).map((row, index) => ({
    id: safeId(row.id || row.feature || row.label || `item_${index + 1}`, `item_${index + 1}`),
    title: cleanText(row.feature || row.label || row.epic || row.task || `${context.t.demo} ${index + 1}`, 60),
    detail: cleanText(row.detail || row.subtask || row.phase || row.truthStatus || context.t.projectDescription, 120),
    status: statusFor(index),
    sourceRefs: uniqueStrings([row.id, ...(row.sourceRefs || [])]).slice(0, 4),
  }));
  const preset = screenContentPreset(id, type, title, description, context);
  const metrics = normalizeMetrics(preset.metrics || metricSetFor(id, type, context.t, context), context);
  const semanticSteps = (context.semanticModel.processes || []).flatMap((process) => process.nodeRefs || []).slice(0, 5).map((ref, index) => ({
    id: safeId(ref, `step_${index + 1}`),
    title: cleanText(labelForRef(context.semanticModel, ref) || `${context.t.demo} ${index + 1}`, 54),
    state: index === 0 ? "active" : index < 3 ? "pending" : "done",
  }));
  const layout = preset.layout || layoutForScreen(id, type);
  return {
    title: cleanText(title, 80),
    layout,
    metrics,
    items: withItemActions(preset.items || domainItemsForScreen(id, type, title, description, context, semanticItems), id, type, context),
    fields: normalizeFields(preset.fields || contextualFields(id, title, description, context.t, context), id),
    steps: preset.steps || (type === "stepper" && semanticSteps.length ? semanticSteps : contextualSteps(title, context.t, context)),
    tabs: preset.tabs || tabsForScreen(id, context.t),
    states: states.map((state) => cleanText(state.label || state.id, 42)),
    chart: preset.chart || chartForScreen(id, title, context),
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

function metricSetFor(id, type, t, context = {}) {
  if (["form", "login", "settings", "success", "empty_state", "error_state"].includes(type)) return [];
  const scopeCount = relevantScopeItems(context.semanticModel || {}, context.proposalModel || {}).length;
  const processCount = (context.semanticModel?.processes || []).length;
  const roleCount = context.roles?.length || 1;
  const activeItems = Math.max(1, scopeCount || (context.domainModel?.capabilities || []).length || (context.domainModel?.entities || []).length || 1);
  return [
    { label: t.tasks, value: String(activeItems), unit: "items", period: "scope", tone: "primary", derivation: "non-technical scope item count", sourceRefs: context.sourceRefs?.slice(0, 3) || [] },
    { label: "Flows", value: String(Math.max(1, processCount || 1)), unit: "flows", period: "prototype", tone: "success", derivation: "semantic process count", sourceRefs: context.sourceRefs?.slice(0, 3) || [] },
    { label: t.roles, value: String(Math.max(1, roleCount)), unit: "roles", period: "prototype", tone: "warning", derivation: "user role count", sourceRefs: context.sourceRefs?.slice(0, 3) || [] },
  ];
}

function domainItemsForScreen(id, type, title, description, context, semanticItems = []) {
  const related = relatedDomainItems(id, title, context, semanticItems);
  if (related.length) return screenContextItems(id, title, description, context, related);
  const entity = entityRefForScreen(id, context);
  const domainEntity = context.domainModel.entities.find((row) => row.id === entity) || context.domainModel.entities[0];
  const fallbackTitle = cleanText(domainEntity?.title || title, 58);
  const fallbackDetail = cleanText(domainEntity?.detail || description, 120);
  if (type === "success") return [{ id: "result", title: fallbackTitle, detail: "Результат доступен участникам процесса", status: "done" }];
  if (type === "empty_state") return [{ id: "empty-reason", title: "Нет подходящих записей", detail: "Фильтр можно сбросить или изменить условия", status: "pending" }];
  if (type === "error_state") return [{ id: "retry-context", title: "Запрос не завершён", detail: "Введённые demo-данные сохранены для повторной попытки", status: "warning" }];
  return [
    { id: "primary-context", title: fallbackTitle, detail: fallbackDetail, status: "active" },
    { id: "process-context", title: context.domainModel.flows[0]?.title || context.t.workspace, detail: "Связано с основным пользовательским процессом", status: "pending" },
    { id: "owner-context", title: context.roles[0]?.title || context.t.customer, detail: "Роль видит только доступные действия", status: "done" },
  ];
}

function screenContextItems(id, title, description, context, related = []) {
  const sourceRefs = uniqueStrings(related.flatMap((item) => item.sourceRefs || []).length
    ? related.flatMap((item) => item.sourceRefs || [])
    : context.sourceRefs.slice(0, 2));
  const contextRows = [
    {
      id: safeId(`${id}_intent`, "screen_intent"),
      title: cleanText(title, 72),
      detail: cleanText(description, 140),
      status: "active",
      sourceRefs,
    },
    {
      id: safeId(`${id}_role`, "screen_role"),
      title: cleanText(context.roles[0]?.title || context.t.customer, 72),
      detail: "Доступные действия соответствуют роли в demo flow",
      status: "done",
      sourceRefs,
    },
  ];
  return [...related.slice(0, 4), ...contextRows].slice(0, 6);
}

function relatedDomainItems(id, title, context, semanticItems = []) {
  const haystack = `${id} ${title}`.toLowerCase();
  const matched = semanticItems.filter((item) => {
    const text = `${item.title} ${item.detail}`.toLowerCase();
    return text.split(/\s+/).some((token) => token.length > 4 && haystack.includes(token))
      || haystack.split(/[_\s-]+/).some((token) => token.length > 4 && text.includes(token));
  });
  const source = matched.length ? matched : semanticItems;
  if (source.length) return source.slice(0, 6);
  return (context.domainModel.capabilities || []).slice(0, 6).map((capability, index) => ({
    id: capability.id || `capability_${index + 1}`,
    title: capability.title,
    detail: capability.detail,
    status: statusFor(index),
    sourceRefs: capability.sourceRefs,
  }));
}

function contextualFields(id, title, description, t, context = {}) {
  if (/login/.test(id)) {
    return [
      { id: "email", label: "Рабочая почта", value: "demo@company.uz", type: "email", required: true },
      { id: "password", label: "Пароль", value: "Demo2026!", type: "password", required: true },
    ];
  }
  if (/otp|verification_code/.test(id)) {
    return [{ id: "otp", label: "Код подтверждения", value: "4821", type: "otp", required: true, pattern: "^[0-9]{4,6}$" }];
  }
  if (/search/.test(id)) return [{ id: "query", label: t.search, value: cleanText(context.domainModel?.entities?.[0]?.title || title, 48), type: "search" }];
  if (/filter/.test(id)) {
    return [
      { id: "status", label: t.status, value: t.active, type: "select", options: [t.active, t.done, t.warning] },
      { id: "owner", label: context.roles?.[0]?.title || t.customer, value: context.roles?.[0]?.title || t.customer, type: "text" },
      { id: "period", label: "Период", value: "Последние 30 дней", type: "select", options: ["Сегодня", "Последние 7 дней", "Последние 30 дней"] },
    ];
  }
  const entity = context.domainModel?.entities?.find((row) => row.id === entityRefForScreen(id, context)) || context.domainModel?.entities?.[0];
  const entityTitle = cleanText(entity?.title || title, 48);
  return [
    { id: "name", label: entityTitle, value: cleanText(entity?.detail || description, 64), type: "text", required: true },
    { id: "owner", label: "Ответственный", value: context.roles?.[0]?.title || t.customer, type: "text", required: true },
    { id: "comment", label: "Комментарий", value: "Проверить данные перед отправкой", type: "textarea" },
  ];
}

function contextualSteps(title, t, context = {}) {
  const flow = context.domainModel?.flows?.[0];
  if (flow?.steps?.length) {
    return flow.steps.slice(0, 5).map((step, index) => ({
      id: step.id || `step_${index + 1}`,
      title: cleanText(step.intent || step.title || `${title}: ${index + 1}`, 60),
      state: index === 0 ? "done" : index === 1 ? "active" : "pending",
    }));
  }
  return [
    { id: "prepare", title: `${title}: подготовка данных`, state: "done" },
    { id: "review", title: `${title}: проверка решения`, state: "active" },
    { id: "result", title: `${title}: ${t.done}`, state: "pending" },
  ];
}

function tabsForScreen(id, t) {
  if (/form|create|edit|otp|reset|success|onboarding/.test(id)) return [];
  if (/history|activity/.test(id)) return [t.history, t.overview];
  if (/settings|security|role|permission/.test(id)) return [t.settings, t.overview];
  return [t.overview, t.history];
}

function chartForScreen(id, title, context = {}) {
  if (!/dashboard|analytics|report|forecast/.test(id)) return [];
  const scopeCount = Math.max(1, relevantScopeItems(context.semanticModel || {}, context.proposalModel || {}).length || 1);
  const flowCount = Math.max(1, (context.semanticModel?.processes || []).length || 1);
  const roleCount = Math.max(1, context.roles?.length || 1);
  return [scopeCount, scopeCount + flowCount, scopeCount + flowCount + roleCount, scopeCount + roleCount + 1, scopeCount + flowCount + roleCount + 2]
    .map((value) => Math.min(100, Math.max(18, value * 12)));
}

function normalizeFields(fields = [], screenId = "screen") {
  return fields.slice(0, 8).map((field, index) => ({
    id: safeId(field.id || field.label || `field_${index + 1}`, `${screenId}_field_${index + 1}`),
    label: cleanText(field.label || `Field ${index + 1}`, 80),
    value: cleanText(field.value || "", 180),
    type: normalizeFieldType(field.type, field.label),
    required: field.required !== false && index < 2,
    readonly: false,
    ...(field.pattern ? { pattern: String(field.pattern).slice(0, 120) } : {}),
    ...(Array.isArray(field.options) ? { options: field.options.map((option) => cleanText(option, 80)).slice(0, 12) } : {}),
  }));
}

function normalizeMetrics(metrics = [], context = {}) {
  return metrics.slice(0, 6).map((metric, index) => ({
    label: cleanText(metric.label || `Metric ${index + 1}`, 60),
    value: cleanText(metric.value || "0", 32),
    unit: cleanText(metric.unit || "demo", 32),
    period: cleanText(metric.period || "prototype", 48),
    tone: metric.tone || statusFor(index),
    derivation: cleanText(metric.derivation || "grounded demo value for prototype", 120),
    sourceRefs: uniqueStrings([...(metric.sourceRefs || []), ...(context.sourceRefs || []).slice(0, 1)]).slice(0, 4),
  }));
}

function normalizeFieldType(type, label = "") {
  const normalized = String(type || "").toLowerCase();
  if (["email", "password", "tel", "number", "search", "textarea", "select", "otp"].includes(normalized)) return normalized;
  if (/mail|почт|email/i.test(label)) return "email";
  if (/парол|password/i.test(label)) return "password";
  if (/тел|phone|номер/i.test(label)) return "tel";
  if (/сумм|amount|price|колич/i.test(label)) return "number";
  return "text";
}

function withItemActions(items = [], screenId, type, context) {
  return items.slice(0, 12).map((item, index) => {
    const id = safeId(item.id || item.title || `item_${index + 1}`, `${screenId}_item_${index + 1}`);
    return {
      ...item,
      id,
      title: cleanText(item.title || `${context.t.demo} ${index + 1}`, 80),
      detail: cleanText(item.detail || context.t.projectDescription, 160),
      status: item.status || statusFor(index),
      action: item.action || itemActionFor(screenId, type, id, context),
    };
  });
}

function itemActionFor(screenId, type, itemId, context) {
  if (["list", "product_grid", "dashboard", "analytics", "history"].includes(type)) {
    return { id: safeId(`open_${itemId}`, "open_item"), type: "navigate", label: context.t.open, targetScreenId: detailsTargetFor(screenId, context) };
  }
  if (/settings|permissions/.test(type) || /settings|permissions|security/.test(screenId)) {
    return { id: safeId(`toggle_${itemId}`, "toggle_item"), type: "toggle", label: context.t.configure, stateKey: `${screenId}.${itemId}` };
  }
  return { id: safeId(`select_${itemId}`, "select_item"), type: "select", label: context.t.open, stateKey: `${screenId}.selected`, value: itemId };
}

function intentForScreen(id, type, title, description) {
  if (id === "onboarding") return "Понять ценность продукта и начать сценарий";
  if (/login|otp|password/.test(id)) return "Подтвердить пользователя и открыть доступ";
  if (/filter/.test(id)) return "Сузить рабочий список по условиям";
  if (/search/.test(id)) return "Найти предметную запись в demo dataset";
  if (type === "dashboard") return "Оценить состояние продукта и перейти к приоритетной работе";
  if (["list", "product_grid", "history"].includes(type)) return `Выбрать запись: ${cleanText(title, 72)}`;
  if (type === "details") return `Проверить атрибуты объекта: ${cleanText(title, 72)}`;
  if (type === "form") return `Ввести и отправить данные: ${cleanText(title, 72)}`;
  if (type === "stepper" || type === "tracking") return `Проследить процесс: ${cleanText(title, 72)}`;
  if (type === "success") return `Подтвердить outcome: ${cleanText(title, 72)}`;
  if (type === "settings") return `Изменить настройку: ${cleanText(title, 72)}`;
  return cleanText(description || title, 120);
}

function entityRefForScreen(id, context) {
  const exact = (context.domainModel?.entities || []).find((entity) => id.includes(entity.id) || id.includes(entity.kind));
  if (exact) return exact.id;
  const inferred = entityKindFromText(id, context.productFamily);
  const byKind = (context.domainModel?.entities || []).find((entity) => entity.kind === inferred || entity.id === inferred);
  return byKind?.id || context.domainModel?.entities?.[0]?.id || "record";
}

function defaultVariantFor(type) {
  if (type === "empty_state") return "empty";
  if (type === "error_state") return "error";
  if (type === "stepper" || type === "tracking") return "in_progress";
  return "ready";
}

function variantsForScreen(type) {
  if (type === "form") return [{ id: "ready", trigger: "default" }, { id: "invalid", trigger: "demo-invalid" }, { id: "submitted", trigger: "demo-success" }];
  if (["list", "product_grid"].includes(type)) return [{ id: "ready", trigger: "default" }, { id: "empty", trigger: "demo-empty" }];
  if (type === "stepper" || type === "tracking") return [{ id: "in_progress", trigger: "default" }, { id: "done", trigger: "demo-success" }];
  if (type === "error_state") return [{ id: "error", trigger: "default" }, { id: "retrying", trigger: "demo-retry" }];
  return [{ id: "ready", trigger: "default" }];
}

function localStateForScreen(id, layout, content) {
  const state = {};
  if ((content.tabs || []).length) state.activeTab = safeId(content.tabs[0], "overview");
  if ((content.fields || []).length) {
    state.form = Object.fromEntries(content.fields.map((field) => [field.id, field.value || ""]));
  }
  if (/settings/.test(layout)) {
    state.toggles = Object.fromEntries((content.items || []).map((item) => [item.id, item.status === "done"]));
  }
  if (/list|grid|kanban|choice/.test(layout)) state.selectedItemId = content.items?.[0]?.id || "";
  return state;
}

function flowRefsForScreen(id, context) {
  const refs = (context.domainModel?.flows || []).filter((flow) => {
    const text = `${flow.title} ${(flow.steps || []).map((step) => step.intent).join(" ")}`.toLowerCase();
    return id.split(/[_-]/).some((token) => token.length > 3 && text.includes(token));
  }).map((flow) => flow.id);
  return refs.length ? refs.slice(0, 4) : (context.domainModel?.flows?.[0]?.id ? [context.domainModel.flows[0].id] : []);
}

function buildNavigation(screens, roles, productFamily, t) {
  const definitions = [
    { id: "foundation", title: foundationTitle(t), match: (id) => id === "design_system" },
    { id: "start", title: t.onboarding, match: (id) => /^(onboarding|language|login|password|verification|identity|selfie)/.test(id) },
    { id: "overview", title: t.overview, match: (id) => /^(home|dashboard|activity_feed|quick_create|notifications|notification_settings|global_search|search_results)/.test(id) },
    { id: "product", title: productFamily === "crm" ? t.leads : ["marketplace", "ecommerce"].includes(productFamily) ? t.catalog : t.workspace, match: () => false },
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
  let roles = (semanticModel.actors || [])
    .filter((actor) => !SYSTEM_ACTOR_TYPES.has(actor.type))
    .map((actor) => ({
      id: safeRoleId(actor.id || actor.label),
      title: cleanText(actor.label || actor.id || t.customer, 80),
      kind: actorKind(actor),
    }));
  roles = dedupeRoles(roles);
  const semanticText = JSON.stringify({
    actors: semanticModel.actors,
    scope: semanticModel.scopeItems,
    capabilities: semanticModel.capabilities,
    tasks: semanticModel.tasks,
    integrations: semanticModel.integrations,
  });
  const wantsAdmin = roles.some((role) => role.kind === "admin")
    || /admin|administrator|owner|permission|role|audit|админ|администратор|права|роли|аудит/i.test(semanticText);
  const wantsSeller = roles.some((role) => role.kind === "seller")
    || productFamily === "marketplace"
    || /seller|merchant|vendor|продав|sotuvchi/i.test(semanticText);
  const wantsOperator = roles.some((role) => role.kind === "operator")
    || ["crm", "erp", "tms"].includes(productFamily)
    || /operator|support|manager|agent|оператор|менеджер|поддерж/i.test(semanticText);
  if (productFamily === "ecommerce") {
    const buyer = roles.find((role) => role.kind === "buyer") || { id: "buyer", title: t.customer, kind: "buyer" };
    const admin = wantsAdmin ? (roles.find((role) => role.kind === "admin") || { id: "admin", title: t.admin, kind: "admin" }) : null;
    return dedupeRoles([buyer, admin].filter(Boolean));
  }
  if (["erp", "tms"].includes(productFamily)) {
    const operator = roles.find((role) => role.kind === "operator") || { id: "operator", title: t.operator, kind: "operator" };
    const admin = wantsAdmin ? (roles.find((role) => role.kind === "admin") || { id: "admin", title: t.admin, kind: "admin" }) : null;
    return dedupeRoles([operator, admin].filter(Boolean));
  }
  if (["saas", "mobile-app", "website"].includes(productFamily)) {
    const user = roles.find((role) => role.kind === "buyer") || { id: "user", title: t.customer, kind: "buyer" };
    const admin = wantsAdmin ? (roles.find((role) => role.kind === "admin") || { id: "admin", title: t.admin, kind: "admin" }) : null;
    return dedupeRoles([user, admin].filter(Boolean));
  }
  if (roles.length) return roles;
  if (productFamily === "crm") return dedupeRoles([{ id: "operator", title: t.operator, kind: "operator" }, ...(wantsAdmin ? [{ id: "admin", title: t.admin, kind: "admin" }] : [])]);
  if (productFamily === "marketplace") return dedupeRoles([{ id: "buyer", title: t.customer, kind: "buyer" }, ...(wantsSeller ? [{ id: "seller", title: t.seller, kind: "seller" }] : []), ...(wantsAdmin ? [{ id: "admin", title: t.admin, kind: "admin" }] : [])]);
  if (wantsOperator) return [{ id: "operator", title: t.operator, kind: "operator" }];
  return [{ id: "user", title: t.customer, kind: "buyer" }];
}

function actorKind(actor) {
  const text = textOf(actor);
  if (/seller|merchant|vendor|продав|sotuvchi/i.test(text)) return "seller";
  if (/admin|owner|control|админ/i.test(text)) return "admin";
  if (/operator|support|manager|agent|оператор|менеджер/i.test(text) || actor.type === "internal_operator") return "operator";
  return "buyer";
}

function detectProductFamily(proposalModel, semanticModel) {
  const explicitType = extractDeclaredProductType(proposalModel);
  const explicitFamily = productFamilyForDeclaredType(explicitType);
  if (explicitFamily) return explicitFamily;
  const declaredText = JSON.stringify({
    title: proposalModel.title,
    projectName: proposalModel.brief?.projectName,
    type: proposalModel.brief?.type,
  });
  if (/\berp\b|enterprise\s+resource\s+planning|procurement|inventory|warehouse|планировани[ея]\s+ресурс/i.test(declaredText)) return "erp";
  if (/\btms\b|transport\s+management|fleet\s+management|управлени[ея]\s+транспорт/i.test(declaredText)) return "tms";
  if (/\bsaas\b|software\s+as\s+a\s+service|subscription\s+platform/i.test(declaredText)) return "saas";
  if (/e-?commerce|online\s+store|internet\s+shop|интернет.?магазин|онлайн.?магазин/i.test(declaredText)) return "ecommerce";
  if (/marketplace|маркетплейс|маркет плейс/i.test(declaredText)) return "marketplace";
  if (/\bcrm\b|sales crm|crm[- ]?систем|система управления клиент/i.test(declaredText)) return "crm";
  if (/mobile\s+app|mobile\s+application|ios|android|мобильн\p{L}*\s+приложен/iu.test(declaredText)) return "mobile-app";
  if (/website|web\s*site|веб[- ]?сайт|вебсайт/i.test(declaredText)) return "website";
  if (/bnpl|fintech|finance|bank|loan|installment|рассроч|кредит|скоринг/i.test(declaredText)) return "fintech";
  const text = searchableText(semanticModel, proposalModel);
  if (/\berp\b|enterprise\s+resource\s+planning|procurement|purchase order|inventory|warehouse|закуп|склад|запас/i.test(text)) return "erp";
  if (/\btms\b|transport\s+management|fleet|shipment|dispatch|logistic|маршрут|автопарк/i.test(text)) return "tms";
  if (/\bsaas\b|software\s+as\s+a\s+service|subscription\s+platform|multi[- ]?tenant/i.test(text)) return "saas";
  if (/e-?commerce|online\s+store|internet\s+shop|интернет.?магазин|онлайн.?магазин/i.test(text)) return "ecommerce";
  if (/marketplace|маркетплейс|маркет плейс|seller|merchant|vendor|продавц/i.test(text)) return "marketplace";
  if (/\bcrm\b|lead|pipeline|sales|воронк|лид|сделк|client management/i.test(text)) return "crm";
  if (/mobile\s+app|mobile\s+application|ios|android|мобильн\p{L}*\s+приложен/iu.test(text)) return "mobile-app";
  if (/website|web\s*site|веб[- ]?сайт|вебсайт/i.test(text)) return "website";
  if (/bnpl|fintech|finance|bank|loan|installment|рассроч|кредит|оплат|скоринг|limit/i.test(text)) return "fintech";
  return "business-app";
}

function extractDeclaredProductType(proposalModel = {}) {
  const prompt = String(proposalModel.brief?.prompt || "");
  const match = prompt.match(/(?:^|[\r\n])\s*(?:тип\s+проекта|project\s+type|loyiha\s+turi)\s*[:=-]\s*([^\r\n;]+)/iu);
  return cleanText(match?.[1] || proposalModel.brief?.type || "", 120);
}

function productFamilyForDeclaredType(value = "") {
  const normalized = String(value).trim().toLowerCase();
  if (/\berp\b|enterprise\s+resource\s+planning|планировани[ея]\s+ресурс/.test(normalized)) return "erp";
  if (/\btms\b|transport\s+management|fleet\s+management|управлени[ея]\s+транспорт/.test(normalized)) return "tms";
  if (/\bcrm\b|customer\s+relationship|управлени[ея]\s+клиент/.test(normalized)) return "crm";
  if (/\bsaas\b|software\s+as\s+a\s+service/.test(normalized)) return "saas";
  if (/marketplace|маркетплейс|маркет\s+плейс/.test(normalized)) return "marketplace";
  if (/e-?commerce|online\s+store|internet\s+shop|интернет.?магазин|онлайн.?магазин/.test(normalized)) return "ecommerce";
  if (/mobile\s+product|mobile\s+app|mobile\s+application|ios|android|мобильн\p{L}*\s+приложен/u.test(normalized)) return "mobile-app";
  if (/^web\s+product$|^website$|^web\s*site$|веб[- ]?сайт|вебсайт/.test(normalized)) return "website";
  if (/custom\s+software\s+product|^other$|^другое$|^бошқа$|^boshqa$/.test(normalized)) return "business-app";
  if (/bnpl|fintech|finance|bank|loan|installment|рассроч|кредит|скоринг/.test(normalized)) return "fintech";
  return "";
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

function safeId(value, fallback = "item") {
  const raw = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "");
  const normalized = raw || fallback;
  const ascii = /^[a-z]/.test(normalized) ? normalized : `x_${normalized}`;
  return ascii.length >= 2 ? ascii.slice(0, 64) : `${ascii}_1`;
}

function hex(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(text) ? text.toUpperCase() : fallback;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function firstExistingScreenId(screenSet, candidates = [], fallback = "") {
  for (const id of candidates) {
    if (screenSet.has(id)) return id;
  }
  return fallback || [...screenSet][0] || "";
}

function productValueDescription(context) {
  const primaryFlow = context.domainModel.flows[0]?.title;
  const primaryEntity = context.domainModel.entities[0]?.title;
  return cleanText([primaryFlow, primaryEntity, context.proposalModel?.brief?.type || context.semanticModel?.project?.category]
    .filter(Boolean)
    .join(" · ") || context.t.projectDescription, 180);
}
