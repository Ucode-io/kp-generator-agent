import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_PROTOTYPE_RENDERER_VERSION = "app-prototype-v5";
const RENDERER_DIR = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(RENDERER_DIR, "..", "assets", "app-prototype", "fonts");
const fontCache = new Map();

const svgIcon = (paths, size = 20, strokeWidth = 1.9) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  back: svgIcon('<path d="M15 18l-6-6 6-6"/>', 20, 2.2),
  home: svgIcon('<path d="M3 10.2L12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>', 22),
  shop: svgIcon('<path d="M3 9h18l-1.4 10.2a2 2 0 0 1-2 1.8H6.4a2 2 0 0 1-2-1.8z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>', 22),
  plus: svgIcon('<path d="M12 5v14M5 12h14"/>', 22, 2.2),
  wallet: svgIcon('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1"/><rect x="3" y="7.5" width="18" height="12.5" rx="2.5"/><circle cx="16.5" cy="14" r="1.4" fill="currentColor" stroke="none"/>', 22),
  user: svgIcon('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>', 22),
  search: svgIcon('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 18, 2),
  grid: svgIcon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', 22),
  list: svgIcon('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r=".8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r=".8" fill="currentColor" stroke="none"/>', 22),
  document: svgIcon('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', 22),
  pencil: svgIcon('<path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M14.5 6.5l3 3"/>', 22),
  clock: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.3 2"/>', 22),
  pin: svgIcon('<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>', 22),
  card: svgIcon('<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h3"/>', 22),
  trend: svgIcon('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>', 22),
  settings: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z"/>', 22, 1.8),
  bolt: svgIcon('<path d="M13.5 2L5 13.5h5.5L10 22l8.5-11.5H13z"/>', 28),
  lock: svgIcon('<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>', 22),
  check: svgIcon('<path d="M4.5 12.5l5 5L19.5 7"/>', 40, 2.2),
  warning: svgIcon('<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>', 40, 2),
};
const STATUS_SIGNAL_ICON = '<svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor" aria-hidden="true"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="4.5" y="5" width="3" height="6" rx="1"/><rect x="9" y="2.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="0" width="3" height="11" rx="1"/></svg>';
const STATUS_BATTERY_ICON = '<svg width="24" height="12" viewBox="0 0 24 12" fill="none" aria-hidden="true"><rect x=".5" y=".5" width="20" height="11" rx="3.2" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="15" height="8" rx="2" fill="currentColor"/><path d="M22 4v4a2.2 2.2 0 0 0 0-4z" fill="currentColor" opacity=".5"/></svg>';

const UI = {
  "ru-RU": {
    prototype: "Интерактивный прототип",
    screens: "Экраны",
    selected: "Текущий экран",
    back: "Назад",
    demo: "Демо-данные",
    open: "Открыть",
    searchProducts: "Поиск товаров",
    favorites: "Избранное",
    addToFavorites: "Добавить в избранное",
    removeFromFavorites: "Убрать из избранного",
    addedToFavorites: "Добавлено в избранное",
    removedFromFavorites: "Удалено из избранного",
    favoritesEmpty: "В избранном пока ничего нет",
    favoritesEmptyDetail: "Добавляйте товары сердечком в каталоге или карточке товара",
    status: "Статус",
    active: "Активно",
    pending: "В работе",
    done: "Готово",
    warning: "Внимание",
    primaryAction: "Основное действие",
  },
  "uz-Latn": {
    prototype: "Interaktiv prototip",
    screens: "Ekranlar",
    selected: "Joriy ekran",
    back: "Orqaga",
    demo: "Demo ma'lumotlar",
    open: "Ochish",
    searchProducts: "Mahsulotlarni qidirish",
    favorites: "Saralanganlar",
    addToFavorites: "Saralanganlarga qo'shish",
    removeFromFavorites: "Saralanganlardan olib tashlash",
    addedToFavorites: "Saralanganlarga qo'shildi",
    removedFromFavorites: "Saralanganlardan olib tashlandi",
    favoritesEmpty: "Saralanganlar hozircha bo'sh",
    favoritesEmptyDetail: "Katalog yoki mahsulot sahifasidagi yurakchani bosing",
    status: "Holat",
    active: "Faol",
    pending: "Jarayonda",
    done: "Tayyor",
    warning: "E'tibor",
    primaryAction: "Asosiy amal",
  },
  en: {
    prototype: "Interactive prototype",
    screens: "Screens",
    selected: "Current screen",
    back: "Back",
    demo: "Demo data",
    open: "Open",
    searchProducts: "Search products",
    favorites: "Favorites",
    addToFavorites: "Add to favorites",
    removeFromFavorites: "Remove from favorites",
    addedToFavorites: "Added to favorites",
    removedFromFavorites: "Removed from favorites",
    favoritesEmpty: "No favorites yet",
    favoritesEmptyDetail: "Use the heart in the catalog or product page to save an item",
    status: "Status",
    active: "Active",
    pending: "In progress",
    done: "Done",
    warning: "Attention",
    primaryAction: "Primary action",
  },
};

export async function renderAppPrototypeToFile(spec, filePath) {
  const html = renderAppPrototypeHtml(spec);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, html, "utf8");
  return { html, path: filePath };
}

export function renderAppPrototypeHtml(spec) {
  const locale = spec.locale || "en";
  const ui = UI[locale] || UI.en;
  const theme = sanitizeTheme(spec.theme);
  const screens = spec.screens || [];
  const mediaById = new Map((spec.media?.images || []).map((image) => [image.id, image]));
  const preloadUrls = [...new Set((spec.media?.images || []).map((image) => safeImageUrl(image.url)).filter(Boolean))];
  const firstScreenId = screens[0]?.id || "";
  const bottomNavIds = resolveBottomNavScreenIds(spec);
  const json = safeScriptJson({
    firstScreenId,
    entryScreenIds: [...new Set([firstScreenId, ...bottomNavIds].filter(Boolean))],
    screens: screens.map((screen) => ({
      id: screen.id,
      title: screen.title,
      description: screen.description,
      type: screen.type,
      layout: screen.layout || screen.content?.layout || "",
      actions: screen.actions || [],
      itemActions: (screen.content?.items || []).map((item) => item.action).filter(Boolean),
      localState: screen.localState || {},
    })),
  });
  return [
    "<!doctype html>",
    `<html lang="${htmlAttr(locale)}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data: https://images.unsplash.com; font-src data:; style-src &#39;unsafe-inline&#39;; script-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">',
    '<meta name="referrer" content="no-referrer">',
    ...preloadUrls.map((url) => `<link rel="preload" as="image" href="${htmlAttr(url)}" fetchpriority="high">`),
    `<title>${e(spec.project?.name || ui.prototype)} · ${e(ui.prototype)}</title>`,
    "<style>",
    css(theme),
    "</style>",
    "</head>",
    "<body>",
    `<main class="prototype-shell" style="--brand-primary:${theme.primary};--brand-secondary:${theme.secondary};--brand-on-primary:${theme.onPrimary};--bg:${theme.background};--surface:${theme.surface};--success:${theme.success};--warning:${theme.warning};--error:${theme.error};">`,
    renderSidebar(spec, ui),
    '<section class="stage" aria-live="polite">',
    '<div class="stage-copy">',
    `<p class="eyebrow">${e(ui.prototype)}</p>`,
    `<h1>${e(spec.project?.name || "Digital product")}</h1>`,
    `<p id="screen-description">${e(screens[0]?.description || spec.project?.description || "")}</p>`,
    "</div>",
    '<div class="phone-wrap">',
    '<div class="phone" role="application" aria-label="Mobile prototype">',
    `<div class="phone-chrome"><span>9:41</span><span class="phone-status-icons">${STATUS_SIGNAL_ICON}${STATUS_BATTERY_ICON}</span></div>`,
    '<div class="dynamic-island"></div>',
    '<div class="mobile-app">',
    '<header class="app-bar">',
    '<button class="icon-button" type="button" data-back aria-label="' + e(ui.back) + '">' + ICONS.back + '</button>',
    '<div><strong id="screen-title">' + e(screens[0]?.title || "") + '</strong></div>',
    '<span class="avatar">' + e(initials(spec.project?.name)) + '</span>',
    "</header>",
    '<div class="screens">',
    screens.map((screen, index) => renderScreen(screen, ui, index === 0, mediaById)).join(""),
    "</div>",
    renderBottomNav(spec, ui, bottomNavIds),
    '<div class="overlay-root" data-overlay-root hidden></div>',
    '<div class="demo-toast" data-demo-toast hidden></div>',
    "</div>",
    "</div>",
    "</div>",
    "</section>",
    "</main>",
    `<script id="prototype-data" type="application/json">${json}</script>`,
    "<script>",
    fixedInteractionScript(),
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");
}

function renderSidebar(spec, ui) {
  return [
    '<aside class="sidebar">',
    '<div class="brand-row">',
    `<span class="logo-mark">${e(initials(spec.project?.name))}</span>`,
    `<div><strong>${e(spec.project?.name || "App")}</strong><p>${e(spec.project?.type || ui.prototype)}</p></div>`,
    "</div>",
    `<p class="nav-label">${e(ui.screens)}</p>`,
    '<nav class="nav-groups" aria-label="Prototype screens">',
    (spec.navigation || []).map((group) => [
      '<section class="nav-group">',
      `<h2>${e(group.title)}</h2>`,
      (group.screenIds || []).map((id) => {
        const screen = (spec.screens || []).find((row) => row.id === id);
        return `<a class="nav-link" href="#${htmlAttr(id)}" data-screen-link="${htmlAttr(id)}"><span>${e(screen?.title || id)}</span><small>${e(screen?.type || "")}</small></a>`;
      }).join(""),
      "</section>",
    ].join("")).join(""),
    "</nav>",
    "</aside>",
  ].join("");
}

function resolveBottomNavScreenIds(spec) {
  const familyCandidates = {
    marketplace: ["home", "catalog", "cart", "orders", "profile"],
    ecommerce: ["home", "catalog", "cart", "orders", "profile"],
    fintech: ["home", "merchants", "qr_scanner", "installments", "profile"],
    crm: ["dashboard", "leads", "quick_create", "tasks", "profile"],
    erp: ["dashboard", "procurement_requests", "inventory", "invoices", "reports"],
    tms: ["dashboard", "transport_orders", "shipments", "fleet", "reports"],
    saas: ["dashboard", "workspaces", "projects", "tasks", "settings"],
    "mobile-app": ["home", "feed", "discover", "inbox", "profile"],
    "business-app": ["dashboard", "workspace", "quick_create", "tasks", "profile"],
  };
  const available = new Set((spec.screens || []).map((screen) => screen.id));
  const preferred = spec.sourceContext?.experienceFamily === "real-estate"
    ? ["home", "property_catalog", "ai_search", "favorites", "profile"]
    : familyCandidates[spec.project?.type] || familyCandidates["business-app"];
  const ids = preferred.filter((id) => available.has(id));
  for (const id of (spec.navigation || []).flatMap((group) => group.screenIds || [])) {
    if (ids.length >= 5) break;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 5);
}

function renderBottomNav(spec, ui, resolvedIds = null) {
  const ids = resolvedIds || resolveBottomNavScreenIds(spec);
  return [
    '<nav class="bottom-nav" aria-label="Mobile navigation">',
    ids.map((id, index) => {
      const screen = (spec.screens || []).find((row) => row.id === id);
      const central = index === 2;
      return `<a class="${central ? "central-action" : ""}" href="#${htmlAttr(id)}" data-screen-link="${htmlAttr(id)}" aria-label="${e(screen?.title || ui.open)}"><span>${iconFor(screen?.type, id)}</span>${central ? "" : `<strong>${e(shortLabel(screen?.title || ui.open))}</strong>`}</a>`;
    }).join(""),
    "</nav>",
  ].join("");
}

function renderScreen(screen, ui, active, mediaById) {
  return [
    `<section class="screen${active ? " is-active" : ""}" data-screen="${htmlAttr(screen.id)}" data-screen-title="${htmlAttr(screen.title)}" data-screen-description="${htmlAttr(screen.description)}" data-layout="${htmlAttr(screen.layout || screen.content?.layout || "")}">`,
    '<div class="screen-scroll">',
    renderScreenBody(screen, ui, mediaById),
    renderActions(screen, ui),
    "</div>",
    "</section>",
  ].join("");
}

function renderScreenBody(screen, ui, mediaById) {
  const layout = screen.content?.layout || "";
  if (layout === "property-home") return renderPropertyHome(screen, ui, mediaById);
  if (layout === "property-grid") return renderPropertyGrid(screen, ui, mediaById);
  if (layout === "property-details") return renderPropertyDetails(screen, ui, mediaById);
  if (layout === "assistant-chat" || layout === "seller-chat") return renderConversation(screen, ui, mediaById, layout);
  if (layout === "scope-board") return renderScopeBoard(screen, ui, mediaById);
  if (layout === "storefront-home") return renderStorefrontHome(screen, ui, mediaById);
  if (layout === "commerce-catalog") return renderCommerceCatalog(screen, ui, mediaById);
  if (layout === "commerce-product") return renderCommerceProduct(screen, ui, mediaById);
  if (layout === "commerce-cart") return renderCommerceCart(screen, ui, mediaById);
  if (layout === "commerce-checkout") return renderCommerceCheckout(screen, ui, mediaById);
  if (layout === "commerce-payment") return renderCommercePayment(screen, ui);
  if (layout === "commerce-orders") return renderCommerceOrders(screen, ui);
  if (layout === "commerce-order-details") return renderCommerceOrderDetails(screen, ui, mediaById);
  if (layout === "seller-dashboard") return renderSellerDashboard(screen, ui, mediaById);
  if (screen.id === "design_system") return renderDesignSystem(screen, ui);
  if (layout === "choice-grid") return renderChoiceGrid(screen, ui);
  if (layout === "otp") return renderOtp(screen, ui);
  if (layout === "search") return renderSearch(screen, ui);
  if (layout === "activity") return renderActivity(screen, ui);
  if (layout === "quick-create") return renderQuickCreate(screen, ui);
  if (layout === "kanban") return renderKanban(screen, ui);
  if (layout === "calendar") return renderCalendar(screen, ui);
  if (layout === "analytics") return renderAnalytics(screen, ui);
  if (layout === "permission-matrix") return renderPermissionMatrix(screen, ui);
  if (layout === "integration-grid") return renderIntegrations(screen, ui);
  if (layout === "settings-list") return renderSettingsList(screen, ui);
  if (layout === "entity-list" || layout === "task-list" || layout === "team-list") return renderEntityList(screen, ui);
  if (layout === "document-list") return renderDocumentList(screen, ui);
  if (layout === "note-list") return renderNoteList(screen, ui);
  if (layout === "filter-form") return renderFilterForm(screen, ui);
  if (layout === "quote") return renderQuote(screen, ui);
  if (screen.type === "onboarding") return renderOnboarding(screen, ui, mediaById);
  if (screen.type === "login") return renderLogin(screen, ui);
  if (screen.type === "dashboard" || screen.type === "analytics") return renderDashboard(screen, ui, mediaById);
  if (screen.type === "product_grid") return renderProductGrid(screen, ui, mediaById);
  if (screen.type === "details") return renderDetails(screen, ui, mediaById);
  if (screen.type === "form") return renderForm(screen, ui);
  if (screen.type === "stepper" || screen.type === "tracking") return renderStepper(screen, ui);
  if (screen.type === "checkout" || screen.type === "payment") return renderCheckout(screen, ui);
  if (screen.type === "profile" || screen.type === "settings") return renderProfile(screen, ui);
  if (screen.type === "success") return renderSuccess(screen, ui);
  if (screen.type === "empty_state" || screen.type === "error_state") return renderState(screen, ui);
  return renderList(screen, ui);
}

function renderOnboarding(screen, ui, mediaById) {
  const photo = renderPhoto(mediaById, screen.content?.imageId, "hero-photo");
  return `<div class="hero-panel photo-hero">${photo}<div class="photo-shade"></div><div class="hero-copy"><span>${iconFor(screen.type, screen.id)}</span><h2>${e(screen.title)}</h2><p>${e(screen.description)}</p></div></div>${renderMetricGrid(screen.content?.metrics || [])}${renderListRows(screen.content?.items || [], ui)}`;
}

function renderLogin(screen, ui) {
  const fields = screen.content?.fields || [];
  return `<div class="auth-mark">${ICONS.lock}<strong>${e(screen.title)}</strong><p>${e(screen.description)}</p></div><form class="form-card" id="${htmlAttr(formIdFor(screen))}" novalidate>${renderFields(fields)}</form>`;
}

function renderDashboard(screen, ui, mediaById) {
  const photo = screen.content?.imageId ? `<div class="dashboard-photo">${renderPhoto(mediaById, screen.content.imageId, "dashboard-image")}<span>${e(screen.content?.note || screen.description)}</span></div>` : "";
  return `${photo}${renderMetricGrid(screen.content?.metrics || [])}${renderBarChart(screen.content?.chart || [])}${renderTabs(screen.content?.tabs || [])}${renderListRows(screen.content?.items || [], ui)}`;
}

function renderProductGrid(screen, ui, mediaById) {
  const items = screen.content?.items || [];
  return `${renderProductSearch(ui)}${renderProductCards(items, screen, ui, mediaById)}`;
}

function renderStorefrontHome(screen, ui, mediaById) {
  const hero = `<div class="storefront-hero">${renderPhoto(mediaById, screen.content?.imageId, "storefront-image")}<div><span>${ICONS.bolt}</span><strong>${e(screen.content?.note || screen.description)}</strong><button type="button" data-screen-link="catalog">${e(ui.open)}</button></div></div>`;
  const categories = renderCategoryChips(screen.content?.categories || []);
  return `${hero}${categories}<div class="section-heading commerce-heading"><strong>${e(screen.content?.sectionTitle || ui.searchProducts)}</strong><span>4</span></div>${renderProductCards(screen.content?.items || [], screen, ui, mediaById)}`;
}

function renderCommerceCatalog(screen, ui, mediaById) {
  const search = screen.id === "catalog"
    ? `<div class="catalog-search-tools">${renderProductSearch(ui)}<button type="button" class="favorites-shortcut" data-screen-link="favorites" aria-label="${htmlAttr(ui.favorites)}">♥</button></div>`
    : renderProductSearch(ui);
  const empty = screen.id === "favorites"
    ? `<div class="favorites-empty" data-favorites-empty ${screen.content?.items?.length ? "hidden" : ""}>${ICONS.shop}<strong>${e(ui.favoritesEmpty)}</strong><p>${e(ui.favoritesEmptyDetail)}</p></div>`
    : "";
  return `${search}${renderCategoryChips(screen.content?.categories || [])}${renderProductCards(screen.content?.items || [], screen, ui, mediaById)}${empty}`;
}

function renderProductSearch(ui) {
  return `<div class="search-row active-search">${ICONS.search}<input type="search" value="" placeholder="${htmlAttr(ui.searchProducts)}" aria-label="${htmlAttr(ui.searchProducts)}" data-search-input></div>`;
}

function renderCategoryChips(categories) {
  if (!categories.length) return "";
  return `<div class="category-chips">${categories.slice(0, 5).map((category, index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-demo-state>${e(category)}</button>`).join("")}</div>`;
}

function renderProductCards(items, screen, ui, mediaById) {
  return `<div class="product-grid">${items.slice(0, 6).map((item, index) => {
    const itemId = item.id || `product_${index + 1}`;
    const favorite = Boolean(item.favorite);
    return `<article class="product-card" data-product-id="${htmlAttr(itemId)}" data-product-title="${htmlAttr(item.title)}" data-product-detail="${htmlAttr(item.detail)}" data-product-price="${htmlAttr(item.price || "")}" data-product-rating="${htmlAttr(item.rating || "")}"><button type="button" class="product-card-main" data-row-action="${htmlAttr(item.action?.type || "select")}" data-row-target="${htmlAttr(item.action?.targetScreenId || "")}" data-select-id="${htmlAttr(itemId)}" aria-label="${htmlAttr(item.action?.label || `${ui.open}: ${item.title || ui.demo}`)}"><div class="product-visual">${renderPhoto(mediaById, item.imageId || screen.content?.imageId, "product-image") || iconFor(screen.type, screen.id)}</div><h3>${e(item.title)}</h3><p>${e(item.detail)}</p><div class="product-meta">${item.price ? `<strong>${e(item.price)}</strong>` : ""}${item.rating ? `<span>★ ${e(item.rating)}</span>` : '<span aria-hidden="true">→</span>'}</div></button><button type="button" class="product-favorite${favorite ? " is-selected" : ""}" data-favorite-id="${htmlAttr(itemId)}" data-favorite-initial="${favorite ? "true" : "false"}" data-add-label="${htmlAttr(ui.addToFavorites)}" data-remove-label="${htmlAttr(ui.removeFromFavorites)}" data-added-message="${htmlAttr(ui.addedToFavorites)}" data-removed-message="${htmlAttr(ui.removedFromFavorites)}" aria-label="${htmlAttr(favorite ? ui.removeFromFavorites : ui.addToFavorites)}" aria-pressed="${favorite ? "true" : "false"}">${favorite ? "♥" : "♡"}</button></article>`;
  }).join("")}</div>`;
}

function renderCommerceProduct(screen, ui, mediaById) {
  const photo = renderPhoto(mediaById, screen.content?.imageId, "commerce-product-image");
  const variants = (screen.content?.variants || []).map((variant, index) => `<button type="button" class="${index === 0 ? "selected" : ""}" data-demo-state>${e(variant)}</button>`).join("");
  const favorite = Boolean(screen.content?.favorite);
  return `<div class="commerce-product-photo">${photo}</div><div class="commerce-product-head"><div><span>★ ${e(screen.content?.rating || "4,9")}</span><strong>${e(screen.content?.price || "")}</strong></div><button type="button" class="product-detail-favorite${favorite ? " is-selected" : ""}" data-favorite-id="${htmlAttr(screen.content?.productId || "product")}" data-favorite-initial="${favorite ? "true" : "false"}" data-add-label="${htmlAttr(ui.addToFavorites)}" data-remove-label="${htmlAttr(ui.removeFromFavorites)}" data-added-message="${htmlAttr(ui.addedToFavorites)}" data-removed-message="${htmlAttr(ui.removedFromFavorites)}" aria-label="${htmlAttr(favorite ? ui.removeFromFavorites : ui.addToFavorites)}" aria-pressed="${favorite ? "true" : "false"}">${favorite ? "♥" : "♡"}</button></div>${variants ? `<div class="variant-chips">${variants}</div>` : ""}${renderKeyValueRows(screen.content?.items || [])}`;
}

function renderCommerceCart(screen, ui, mediaById) {
  const items = screen.content?.items || [];
  return `<div class="cart-items">${items.map((item) => `<article><div class="cart-thumb">${renderPhoto(mediaById, item.imageId || screen.content?.imageId, "cart-image") || ICONS.shop}</div><div><strong>${e(item.title)}</strong><p>${e(item.detail)}</p><b>${e(item.price || "")}</b></div><div class="quantity-control"><button type="button" data-demo-state aria-label="Decrease">−</button><span>${e(item.quantity || 1)}</span><button type="button" data-demo-state aria-label="Increase">+</button></div></article>`).join("")}</div>${renderCommerceSummary(screen.content?.summary || [])}`;
}

function renderCommerceCheckout(screen, ui, mediaById) {
  const item = screen.content?.items?.[0];
  const orderPreview = item ? `<div class="checkout-preview"><div class="cart-thumb">${renderPhoto(mediaById, item.imageId || screen.content?.imageId, "checkout-image") || ICONS.shop}</div><div><strong>${e(item.title)}</strong><p>${e(item.detail)}</p><b>${e(item.price || "")}</b></div></div>` : "";
  return `${orderPreview}<form class="form-card commerce-form" id="${htmlAttr(formIdFor(screen))}" novalidate>${renderFields(screen.content?.fields || [])}</form>${renderCommerceSummary(screen.content?.summary || [])}`;
}

function renderCommercePayment(screen, ui) {
  return `<div class="payment-card-preview"><span>${ICONS.card}</span><div><strong>•••• 4242</strong><p>${e(screen.description)}</p></div></div><form class="form-card commerce-form payment-form" id="${htmlAttr(formIdFor(screen))}" novalidate>${renderFields(screen.content?.fields || [])}</form>${renderCommerceSummary(screen.content?.summary || [])}`;
}

function renderCommerceOrders(screen, ui) {
  return renderListRows(screen.content?.items || [], ui);
}

function renderCommerceOrderDetails(screen, ui, mediaById) {
  const item = screen.content?.items?.[0];
  const orderItem = item ? `<div class="checkout-preview"><div class="cart-thumb">${renderPhoto(mediaById, item.imageId || screen.content?.imageId, "order-image") || ICONS.shop}</div><div><strong>${e(item.title)}</strong><p>${e(item.detail)}</p><b>${e(item.price || "")}</b></div></div>` : "";
  return `<div class="order-status-card">${ICONS.clock}<div><span>${e(ui.status)}</span><strong>${e(screen.content?.orderStatus || ui.active)}</strong></div></div>${orderItem}${renderCommerceSummary(screen.content?.summary || [])}`;
}

function renderSellerDashboard(screen, ui, mediaById) {
  const photo = screen.content?.imageId ? `<div class="dashboard-photo">${renderPhoto(mediaById, screen.content.imageId, "seller-dashboard-image")}<span>${e(screen.description)}</span></div>` : "";
  return `${photo}${renderMetricGrid(screen.content?.metrics || [])}${renderListRows(screen.content?.items || [], ui)}`;
}

function renderKeyValueRows(items) {
  if (!items.length) return "";
  return `<div class="key-value-rows">${items.map((item) => `<div><span>${e(item.title)}</span><strong>${e(item.detail)}</strong></div>`).join("")}</div>`;
}

function renderCommerceSummary(rows) {
  if (!rows.length) return "";
  return `<div class="commerce-summary">${rows.map(([label, value], index) => `<div class="${index === rows.length - 1 ? "total" : ""}"><span>${e(label)}</span><strong>${e(value)}</strong></div>`).join("")}</div>`;
}

function renderDetails(screen, ui, mediaById) {
  const photo = renderPhoto(mediaById, screen.content?.imageId, "detail-photo");
  return `<div class="detail-cover ${photo ? "has-photo" : ""}">${photo}<div class="detail-copy"><span>${iconFor(screen.type, screen.id)}</span><h2>${e(screen.title)}</h2><p>${e(screen.description)}</p></div></div>${renderMetricGrid(screen.content?.metrics || [])}${renderListRows(screen.content?.items || [], ui)}`;
}

function renderPropertyHome(screen, ui, mediaById) {
  return [
    '<div class="property-greeting"><div><span>Добрый день 👋</span><strong>Найдите свой дом</strong></div><button type="button" data-demo-state aria-label="Уведомления">' + ICONS.warning + '</button></div>',
    `<div class="search-row property-search">${ICONS.search}<span>Район, ЖК или адрес</span><button type="button" data-demo-state aria-label="Фильтры">${ICONS.settings}</button></div>`,
    renderTabs(screen.content?.tabs || []),
    '<div class="section-heading"><strong>Рекомендуем</strong><span>По вашим интересам</span></div>',
    renderPropertyCards(screen.content?.items || [], ui, mediaById),
  ].join("");
}

function renderPropertyGrid(screen, ui, mediaById) {
  return `<div class="search-row property-search">${ICONS.search}<span>Район, ЖК или адрес</span><button type="button" data-demo-state aria-label="Фильтры">${ICONS.settings}</button></div>${renderTabs(screen.content?.tabs || [])}${renderPropertyCards(screen.content?.items || [], ui, mediaById)}`;
}

function renderPropertyCards(items, ui, mediaById) {
  return `<div class="property-cards">${items.slice(0, 5).map((item, index) => `<button type="button" class="property-card" data-row-action="${htmlAttr(item.action?.type || "select")}" data-row-target="${htmlAttr(item.action?.targetScreenId || "")}" data-select-id="${htmlAttr(item.id || `property_${index + 1}`)}"><div class="property-photo">${renderPhoto(mediaById, item.imageId, "property-card-image")}<span class="featured">Featured</span><i>♡</i></div><div class="property-card-copy"><strong>${e(item.title)}</strong><b>${e(propertyPrice(item.detail))}</b><p>${e(item.detail)}</p><span>${ICONS.home} 3 &nbsp; ${ICONS.card} 2 &nbsp; 95 м²</span></div></button>`).join("")}</div>`;
}

function renderPropertyDetails(screen, ui, mediaById) {
  const items = screen.content?.items || [];
  return `<div class="property-detail-photo">${renderPhoto(mediaById, screen.content?.imageId, "property-detail-image")}<span class="photo-count">1/3</span><div class="photo-dots"><i></i><i></i><i></i></div></div><div class="property-detail-head"><div><h2>${e(screen.title)}</h2><p>${e(screen.description)}</p></div><b>★ 4.8</b></div>${renderMetricGrid(screen.content?.metrics || [])}${renderTabs(screen.content?.tabs || [])}${renderListRows(items, ui)}`;
}

function renderConversation(screen, ui, mediaById, layout) {
  const assistant = layout === "assistant-chat";
  const items = screen.content?.items || [];
  return `<div class="chat-context">${assistant ? ICONS.bolt : ICONS.user}<div><strong>${e(assistant ? "ИИ-помощник" : items[0]?.title || screen.title)}</strong><p>${e(assistant ? "Ищет по платформе и внешним источникам · онлайн" : "По объекту · онлайн")}</p></div><button type="button" data-demo-state aria-label="Позвонить">${ICONS.user}</button></div><div class="chat-thread">${items.map((item, index) => `<article class="${index % 2 ? "mine" : "theirs"}"><strong>${e(item.title)}</strong><p>${e(item.detail)}</p>${item.imageId && index === items.length - 1 ? renderPhoto(mediaById, item.imageId, "chat-result-image") : ""}</article>`).join("")}</div><div class="chat-composer"><input type="text" value="" placeholder="${e(assistant ? "Опишите, что вы ищете..." : "Напишите сообщение...")}" aria-label="Сообщение"><button type="button" data-demo-state aria-label="Отправить">${ICONS.back}</button></div>`;
}

function renderScopeBoard(screen, ui, mediaById) {
  return `<div class="scope-visual">${renderPhoto(mediaById, screen.content?.imageId, "scope-image")}<div><span>Из карты продукта</span><strong>${e(screen.title)}</strong><p>${e(screen.description)}</p></div></div>${renderMetricGrid(screen.content?.metrics || [])}<div class="scope-board">${(screen.content?.items || []).map((item, index) => `<button type="button" data-row-action="select" data-select-id="${htmlAttr(item.id || `scope_${index + 1}`)}"><i>${index + 1}</i><div><strong>${e(item.title)}</strong><p>${e(item.detail)}</p></div><span>${e(statusLabel(item.status, ui))}</span></button>`).join("")}</div>`;
}

function renderPhoto(mediaById, imageId, className) {
  const image = mediaById?.get(imageId);
  const url = safeImageUrl(image?.url);
  if (!url) return "";
  return `<span class="photo-frame ${htmlAttr(className || "")}" data-image-state="pending"><span class="photo-fallback">${ICONS.shop}</span><img src="${htmlAttr(url)}" alt="${htmlAttr(image.alt || "Тематическое изображение")}" loading="lazy" decoding="async" data-prototype-image></span>`;
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "images.unsplash.com" ? url.toString() : "";
  } catch {
    return "";
  }
}

function propertyPrice(detail) {
  return String(detail || "").match(/\$[\d,.]+/)?.[0] || "По запросу";
}

function renderForm(screen, ui) {
  const fields = screen.content?.fields || [];
  return `<form class="form-card" id="${htmlAttr(formIdFor(screen))}" novalidate>${renderFields(fields)}<div class="notice" data-form-status>${e(screen.content?.note || ui.demo)}</div></form>`;
}

function renderStepper(screen, ui) {
  const steps = screen.content?.steps || [];
  return `<div class="timeline">${steps.map((step, index) => `<div class="timeline-row ${htmlAttr(step.state || "pending")}"><i>${index + 1}</i><div><strong>${e(step.title)}</strong><p>${e(statusLabel(step.state, ui))}</p></div></div>`).join("")}</div>${renderListRows(screen.content?.items || [], ui)}`;
}

function renderCheckout(screen, ui) {
  return `<div class="checkout-card"><h2>${e(screen.title)}</h2>${renderListRows((screen.content?.items || []).slice(0, 3), ui)}<div class="total-row"><span>${e(ui.demo)}</span><strong>${e(screen.content?.note || "•••")}</strong></div></div>`;
}

function renderProfile(screen, ui) {
  return `<div class="profile-card"><span class="large-avatar">${e(screen.title.slice(0, 2).toUpperCase())}</span><h2>${e(screen.title)}</h2><p>${e(screen.description)}</p></div>${renderListRows(screen.content?.items || [], ui)}`;
}

function renderSuccess(screen, ui) {
  return `<div class="hero-panel success-panel"><span>${ICONS.check}</span><h2>${e(screen.title)}</h2><p>${e(screen.description)}</p></div>`;
}

function renderState(screen, ui) {
  const error = screen.type === "error_state";
  return `<div class="hero-panel ${error ? "error-panel" : "empty-panel"}"><span>${error ? ICONS.warning : ICONS.search}</span><h2>${e(screen.title)}</h2><p>${e(screen.description || ui.demo)}</p></div>`;
}

function renderChoiceGrid(screen, ui) {
  return `<div class="choice-list">${(screen.content?.items || []).map((item, index) => `<button type="button" class="${index === 0 ? "selected" : ""}" data-select-id="${htmlAttr(item.id || `choice_${index + 1}`)}" aria-pressed="${index === 0 ? "true" : "false"}"><span class="choice-code">${e(String(item.title || ui.demo).slice(0, 2).toUpperCase())}</span><div><strong>${e(item.title || ui.demo)}</strong><p>${e(item.detail || "")}</p></div><i>${index === 0 ? ICONS.check : ""}</i></button>`).join("")}</div>`;
}

function renderOtp(screen, ui) {
  const digits = String(screen.content?.fields?.[0]?.value || "4821").replace(/\D+/g, "").slice(0, 6).split("");
  const safeDigits = digits.length >= 4 ? digits : ["4", "8", "2", "1"];
  return `<div class="auth-mark">${ICONS.lock}<strong>${e(screen.title)}</strong><p>${e(screen.description)}</p></div><form class="otp-form" id="${htmlAttr(formIdFor(screen))}" novalidate><div class="otp-boxes">${safeDigits.map((digit, index) => `<input type="text" inputmode="numeric" autocomplete="${index === 0 ? "one-time-code" : "off"}" maxlength="1" pattern="[0-9]" value="${htmlAttr(digit)}" required aria-label="${e(`Цифра кода ${index + 1}`)}">`).join("")}</div></form>`;
}

function renderSearch(screen, ui) {
  const query = screen.content?.fields?.[0]?.value || screen.title;
  return `<div class="search-row active-search">${ICONS.search}<input type="search" value="${htmlAttr(query)}" aria-label="${e(ui.open)}" data-search-input><button type="button" data-search-clear aria-label="Clear">×</button></div>${renderTabs(screen.content?.tabs || [])}${renderEntityRows(screen.content?.items || [], ui)}`;
}

function renderActivity(screen, ui) {
  return `${renderTabs(screen.content?.tabs || [])}<div class="activity-timeline">${(screen.content?.items || []).map((item, index) => `<article><i class="${htmlAttr(item.status || "active")}">${iconFor(screen.type, screen.id)}</i><div><strong>${e(item.title)}</strong><p>${e(item.detail)}</p></div><time>${String(index + 9).padStart(2, "0")}:${index % 2 ? "15" : "40"}</time></article>`).join("")}</div>`;
}

function renderQuickCreate(screen, ui) {
  return `<div class="quick-grid">${(screen.content?.items || []).slice(0, 4).map((item) => `<article><span>${iconFor("form", item.title)}</span><strong>${e(item.title)}</strong><p>${e(item.detail)}</p></article>`).join("")}</div>`;
}

function renderKanban(screen, ui) {
  return `${renderMetricGrid(screen.content?.metrics || [])}${renderTabs(screen.content?.tabs || [])}<div class="kanban-board">${(screen.content?.items || []).slice(0, 4).map((item, index) => `<section><header><i class="kanban-dot tone-${index}"></i><strong>${e(item.title)}</strong></header><p>${e(item.detail)}</p><div class="mini-deal"><b>${e(["Atlas", "Nova", "Orient", "Samarqand"][index] || ui.demo)}</b><span>${e(statusLabel(item.status, ui))}</span></div></section>`).join("")}</div>`;
}

function renderCalendar(screen, ui) {
  const days = Array.from({ length: 28 }, (_, index) => index + 1);
  return `${renderTabs(screen.content?.tabs || [])}<div class="calendar-card"><header><strong>Август 2026</strong><span>‹ &nbsp; ›</span></header><div class="weekdays">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => `<b>${day}</b>`).join("")}</div><div class="calendar-days">${days.map((day) => `<span class="${day === 3 ? "today" : [5, 8, 12, 19].includes(day) ? "has-event" : ""}">${day}</span>`).join("")}</div></div>${renderListRows(screen.content?.items || [], ui)}`;
}

function renderAnalytics(screen, ui) {
  return `${renderMetricGrid(screen.content?.metrics || [])}${renderTabs(screen.content?.tabs || [])}${renderBarChart(screen.content?.chart || [])}${renderListRows(screen.content?.items || [], ui)}`;
}

function renderPermissionMatrix(screen, ui) {
  return `${renderTabs(screen.content?.tabs || [])}<div class="permission-head"><span>Раздел</span><b>R</b><b>W</b><b>X</b></div><div class="permission-list">${(screen.content?.items || []).map((item, index) => `<article><div><strong>${e(item.title)}</strong><p>${e(item.detail)}</p></div><i class="on">✓</i><i class="${index < 2 ? "on" : ""}">${index < 2 ? "✓" : "−"}</i><i class="${index === 0 ? "on" : ""}">${index === 0 ? "✓" : "−"}</i></article>`).join("")}</div>`;
}

function renderIntegrations(screen, ui) {
  return `${renderTabs(screen.content?.tabs || [])}<div class="integration-grid">${(screen.content?.items || []).slice(0, 4).map((item) => `<article><span>${iconFor("settings", item.title)}</span><strong>${e(item.title)}</strong><p>${e(item.detail)}</p><em class="badge ${htmlAttr(item.status || "active")}">${e(statusLabel(item.status, ui))}</em></article>`).join("")}</div>`;
}

function renderSettingsList(screen, ui) {
  return `${renderTabs(screen.content?.tabs || [])}<div class="settings-list">${(screen.content?.items || []).map((item, index) => `<article><span>${iconFor("settings", item.title)}</span><div><strong>${e(item.title)}</strong><p>${e(item.detail)}</p></div><button type="button" class="toggle ${item.status === "done" ? "on" : ""}" data-toggle-id="${htmlAttr(item.id || `setting_${index + 1}`)}" aria-pressed="${item.status === "done" ? "true" : "false"}" aria-label="${e(item.title)}"></button></article>`).join("")}</div>`;
}

function renderEntityList(screen, ui) {
  return `${renderMetricGrid(screen.content?.metrics || [])}${renderTabs(screen.content?.tabs || [])}${renderEntityRows(screen.content?.items || [], ui)}`;
}

function renderEntityRows(items, ui) {
  return `<div class="entity-rows">${items.slice(0, 6).map((item, index) => `<button type="button" class="entity-row" data-row-action="${htmlAttr(item.action?.type || "select")}" data-row-target="${htmlAttr(item.action?.targetScreenId || "")}" data-select-id="${htmlAttr(item.id || `row_${index + 1}`)}"><span class="entity-avatar">${e(initials(item.title))}</span><div><strong>${e(item.title)}</strong><p>${e(item.detail)}</p></div>${renderStatusBadge(item, ui, "em")}</button>`).join("")}</div>`;
}

function renderDocumentList(screen, ui) {
  return `${renderTabs(screen.content?.tabs || [])}<div class="document-list">${(screen.content?.items || []).map((item, index) => `<article><span>${ICONS.document}</span><div><strong>${e(item.title)}</strong><p>${e(item.detail)}</p></div><button type="button" data-menu-id="${htmlAttr(item.id || `doc_${index + 1}`)}" data-menu-title="${htmlAttr(item.title)}" data-menu-detail="${htmlAttr(item.detail)}" aria-label="${e(ui.open)}">•••</button></article>`).join("")}</div>`;
}

function renderNoteList(screen, ui) {
  return `${renderTabs(screen.content?.tabs || [])}<div class="note-list">${(screen.content?.items || []).map((item) => `<article><p>${e(item.title)}</p><span>${e(item.detail)}</span></article>`).join("")}</div>`;
}

function renderFilterForm(screen, ui) {
  return `<div class="filter-summary"><strong>${e(screen.title)}</strong><span data-filter-summary>${e(screen.content?.items?.[0]?.detail || ui.demo)}</span></div><form class="form-card filter-card" id="${htmlAttr(formIdFor(screen))}" novalidate>${renderFields(screen.content?.fields || [])}</form>`;
}

function renderQuote(screen, ui) {
  return `<div class="quote-head"><span>${ICONS.document}</span><div><strong>Atlas Trade</strong><p>${e(screen.description)}</p></div></div><div class="checkout-card">${renderListRows(screen.content?.items || [], ui)}<div class="total-row"><span>Итого</span><strong>${e(String(screen.content?.note || "").replace(/^Итого:\s*/i, ""))}</strong></div></div>`;
}

function renderFields(fields) {
  return fields.map((field) => {
    const id = field.id || safeDomId(field.label || "field");
    const required = field.required ? " required" : "";
    const pattern = field.pattern ? ` pattern="${htmlAttr(field.pattern)}"` : "";
    const baseAttrs = `name="${htmlAttr(id)}" data-field-id="${htmlAttr(id)}"${required}${pattern}`;
    const value = htmlAttr(field.value || "");
    if (field.type === "textarea") return `<label>${e(field.label || "")}<textarea ${baseAttrs}>${e(field.value || "")}</textarea><small class="field-error" data-field-error></small></label>`;
    if (field.type === "select") {
      const options = (field.options?.length ? field.options : [field.value || "Demo"]).map((option) => `<option${option === field.value ? " selected" : ""}>${e(option)}</option>`).join("");
      return `<label>${e(field.label || "")}<select ${baseAttrs}>${options}</select><small class="field-error" data-field-error></small></label>`;
    }
    const inputType = field.type === "otp" ? "text" : field.type || "text";
    const inputMode = field.type === "otp" ? ' inputmode="numeric"' : "";
    return `<label>${e(field.label || "")}<input type="${htmlAttr(inputType)}" value="${value}" ${baseAttrs}${inputMode}><small class="field-error" data-field-error></small></label>`;
  }).join("");
}

function renderBarChart(values) {
  if (!values.length) return "";
  return `<div class="bar-chart" aria-label="Chart">${values.slice(0, 8).map((value, index) => `<span style="--bar:${Math.max(12, Math.min(100, Number(value) || 0))}%"><i></i><b>${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс", ""][index]}</b></span>`).join("")}</div>`;
}

function renderDesignSystem(screen, ui) {
  return [
    '<div class="ds-intro">',
    `<h2>${e(screen.title)}</h2><p>${e(screen.description)}</p>`,
    '</div>',
    '<section class="ds-section"><h3>Цветовые токены</h3><div class="ds-token-grid">',
    designToken("primary-swatch", "Primary", "#2A2570"),
    designToken("primary-dark-swatch", "Primary Dark", "#1E1A52"),
    designToken("tint-swatch", "Primary Light", "#F3F2FC"),
    designToken("background-swatch", "Background", "#F6F7F8"),
    designToken("surface-swatch", "Surface", "#FFFFFF"),
    designToken("text-swatch", "Main Text", "#111827"),
    designToken("success-swatch", "Success", "#22C55E"),
    designToken("warning-swatch", "Warning", "#F59E0B"),
    designToken("error-swatch", "Error", "#EF4444"),
    designToken("info-swatch", "Info", "#3B82F6"),
    '</div></section>',
    '<section class="ds-section"><h3>Кнопки</h3>',
    '<div class="button-stack">',
    `<button type="button" class="ui-button primary" data-demo-state>${e(ui.primaryAction)}</button>`,
    '<button type="button" class="ui-button soft" data-demo-state>Второстепенное</button>',
    '<button type="button" class="ui-button ghost" data-demo-state>Контурная</button>',
    '<div class="compact-row"><button type="button" class="ui-button ghost compact" data-demo-state>Смотреть</button><button type="button" class="ui-button soft compact" data-demo-state>Изменить</button></div>',
    '<button type="button" class="ui-button" disabled>Недоступно</button>',
    '</div>',
    '</section>',
    '<section class="ds-section"><h3>Бейджи и состояния</h3>',
    `<div class="ds-badges"><span class="badge">${e(ui.active)}</span><span class="badge pending">${e(ui.pending)}</span><span class="badge done">${e(ui.done)}</span><span class="badge warning">${e(ui.warning)}</span></div>`,
    '<div class="ds-alert success-alert"><strong>Успешно</strong><p>Действие выполнено и сохранено</p></div>',
    '<div class="ds-alert warning-alert"><strong>Требуется внимание</strong><p>Проверьте данные перед продолжением</p></div>',
    '</section>',
    '<section class="ds-section"><h3>Типографика</h3><div class="ds-type-sample">',
    '<strong class="ds-display">12 450 000</strong><span>Display · 31px / 700</span>',
    '<strong class="ds-title">Заголовок экрана</strong><span>Title · 17px / 650</span>',
    '<strong class="ds-body">Строка интерфейса</strong><span>Body · 14.5px / 600</span>',
    '<p>Вспомогательный текст и подписи</p><span>Caption · 12.5px / 400</span>',
    '</div></section>',
  ].join("");
}

function designToken(className, name, value) {
  return `<article class="ds-token"><span class="ds-swatch ${className}"></span><strong>${e(name)}</strong><small>${e(value)}</small></article>`;
}

function renderList(screen, ui) {
  return `${renderTabs(screen.content?.tabs || [])}${renderListRows(screen.content?.items || [], ui)}`;
}

function renderMetricGrid(metrics) {
  if (!metrics.length) return "";
  return `<div class="metric-grid">${metrics.slice(0, 4).map((metric) => `<article class="metric ${htmlAttr(metric.tone || "")}"><span>${e(metric.label)}</span><strong>${e(metric.value)}</strong></article>`).join("")}</div>`;
}

function renderTabs(tabs) {
  if (!tabs.length) return "";
  return `<div class="tabs" role="tablist">${tabs.slice(0, 3).map((tab, index) => `<button type="button" role="tab" data-tab-id="${htmlAttr(safeDomId(tab))}" aria-selected="${index === 0 ? "true" : "false"}" class="${index === 0 ? "active" : ""}">${e(tab)}</button>`).join("")}</div><div class="tab-panel" data-tab-panel>${e(tabs[0])}</div>`;
}

function renderListRows(items, ui) {
  if (!items.length) return "";
  return `<div class="list-rows">${items.slice(0, 6).map((item, index) => `<button type="button" class="list-row" data-row-action="${htmlAttr(item.action?.type || "select")}" data-row-target="${htmlAttr(item.action?.targetScreenId || "")}" data-select-id="${htmlAttr(item.id || `row_${index + 1}`)}"><div><strong>${e(item.title)}</strong><p>${e(item.detail)}</p></div>${renderStatusBadge(item, ui)}</button>`).join("")}</div>`;
}

function renderActions(screen, ui) {
  const actions = (screen.actions || []).slice(0, 2);
  if (!actions.length) return "";
  return `<div class="action-row">${actions.map((action, index) => `<button type="button" class="ui-button ${index === 0 ? "primary" : "ghost"}" data-action-id="${htmlAttr(action.id)}" data-action-type="${htmlAttr(action.type || "navigate")}" data-action-target="${htmlAttr(action.targetScreenId || "")}" ${action.disabledReason ? `disabled title="${htmlAttr(action.disabledReason)}"` : ""} aria-label="${e(action.label || ui.primaryAction)}">${e(action.label)}</button>`).join("")}</div>`;
}

function renderStatusBadge(item, ui, tagName = "span") {
  if (!item?.status) return "";
  const tag = tagName === "em" ? "em" : "span";
  return `<${tag} class="badge ${htmlAttr(item.status)}">${e(item.statusLabel || statusLabel(item.status, ui))}</${tag}>`;
}

function formIdFor(screen) {
  if (screen.id === "login") return "login-form";
  if (screen.id === "login_otp") return "otp-form";
  return `${screen.id}-form`;
}

function safeDomId(value = "item") {
  const normalized = String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "");
  return (normalized || "item").slice(0, 64);
}

function css() {
  return `
${prototypeFontFaces()}
*{box-sizing:border-box;letter-spacing:0!important}
html,body{margin:0;min-height:100%;font-family:Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:#EEF0F3;color:#111827;font-feature-settings:"ss01";-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{overflow:hidden}
.prototype-shell{--r-surface:20px;--r-inner:14px;--primary:var(--brand-primary);--primary-dark:color-mix(in srgb,var(--brand-primary) 72%,var(--brand-secondary));--primary-deep:color-mix(in srgb,var(--brand-primary) 48%,#0B0F16);--primary-glow:color-mix(in srgb,var(--brand-primary) 72%,#fff);--primary-tint:color-mix(in srgb,var(--brand-primary) 8%,#fff);--primary-light:color-mix(in srgb,var(--brand-primary) 18%,#fff);--border:#E5E7EB;--hairline:rgba(17,24,39,.07);--text-2:#6B7280;--text-3:#9CA3AF;--shadow:0 1px 1px rgba(17,24,39,.03),0 4px 12px rgba(17,24,39,.05);--shadow-lg:0 2px 4px rgba(17,24,39,.04),0 12px 32px rgba(17,24,39,.08);height:100vh;display:grid;grid-template-columns:280px minmax(0,1fr);background:#EEF0F3}
.sidebar{height:100vh;padding:22px 0 40px;border-right:1px solid var(--border);background:#fff;overflow:auto}
.sidebar::-webkit-scrollbar{width:6px}.sidebar::-webkit-scrollbar-thumb{background:#E5E7EB;border-radius:9px}
.brand-row{display:flex;align-items:center;gap:11px;padding:0 18px 20px;margin:0}
.logo-mark,.avatar,.large-avatar{display:grid;place-items:center;background:linear-gradient(145deg,var(--primary),var(--primary-dark));color:var(--brand-on-primary);font-weight:700}
.logo-mark{width:38px;height:38px;border-radius:12px;font-size:16px;box-shadow:0 4px 12px color-mix(in srgb,var(--primary) 32%,transparent)}
.brand-row>div{min-width:0}.brand-row strong{display:block;max-width:195px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;line-height:1.22;font-weight:700;color:#111827}
.brand-row p,.nav-label,.stage-copy p,.app-bar p,.list-rows p,.product-grid p,.timeline-row p,.detail-cover p,.profile-card p,.hero-panel p{margin:0;color:var(--text-2)}
.brand-row p{font-size:11.5px;font-weight:400;margin-top:1px}
.nav-label{padding:16px 18px 6px;margin:0;font-size:10.5px;text-transform:uppercase;font-weight:600;color:var(--text-3)}
.nav-group{margin:0 0 8px}
.nav-group h2{margin:0;padding:0 18px 6px;font-size:10.5px;text-transform:uppercase;color:var(--text-3);font-weight:600}
.nav-link{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 8px;padding:8px 10px;border-radius:9px;color:#374151;text-decoration:none;font-weight:400;font-size:13.5px;line-height:1.35;transition:background .12s}
.nav-link small{margin-left:auto;font-size:10px;color:var(--text-3);font-weight:600}
.nav-link:hover{background:#F6F7F8}
.nav-link.is-active{background:var(--primary-tint);color:var(--primary-dark);font-weight:600}
.nav-link.is-active small{color:var(--primary)}
.stage{min-width:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:32px;overflow:hidden;background:#EEF0F3}
.stage-copy{text-align:center;max-width:520px}
.eyebrow{display:none}
.stage-copy h1{margin:0 0 5px;font-size:19px;line-height:1.25;font-weight:650;color:#111827;max-width:none}
.stage-copy p{font-size:12.5px;line-height:1.5;font-weight:400;max-width:520px;color:var(--text-2)}
.phone-wrap{width:343px;height:743px;position:relative;flex:0 0 auto}
.phone{position:absolute;inset:0 auto auto 0;width:390px;height:844px;min-width:390px;min-height:844px;border:12px solid #0B0F16;border-radius:54px;background:#fff;box-shadow:0 0 0 1.5px rgba(255,255,255,.14) inset,0 40px 80px -20px rgba(11,15,22,.42),0 8px 24px rgba(11,15,22,.14);overflow:hidden;transform:scale(.88);transform-origin:top left}
.phone-chrome{position:absolute;top:0;left:0;right:0;height:54px;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:16px 30px 0;color:#111827;font-size:13px;font-weight:600;pointer-events:none}
.phone-status-icons{display:flex;align-items:center;gap:6px}
.dynamic-island{position:absolute;top:11px;left:50%;width:118px;height:33px;transform:translateX(-50%);border-radius:99px;background:#0B0F16;z-index:60}
.mobile-app{height:100%;border-radius:0;background:#F6F7F8;overflow:hidden;display:grid;grid-template-rows:106px minmax(0,1fr) 78px;position:relative}
.app-bar{display:flex;align-items:center;gap:12px;padding:58px 18px 12px;background:#fff;border-bottom:1px solid var(--border);position:relative;z-index:20;min-height:106px}
.icon-button{width:36px;height:36px;border:0;border-radius:12px;background:#F6F7F8;color:#111827;display:grid;place-items:center;cursor:pointer;transition:transform .12s,background .12s}
.icon-button[hidden]{display:none!important}
.icon-button:hover{background:#EDEFF2}.icon-button:active{transform:scale(.92)}
.app-bar>div{min-width:0;flex:1}
.app-bar strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:17px;line-height:1.2;font-weight:650;color:#111827}
.avatar{width:36px;height:36px;border-radius:12px;font-size:13px}
.screens{position:relative;min-height:0;overflow:hidden}
.screen{position:absolute;inset:0;opacity:0;transform:translateX(20px);pointer-events:none;transition:opacity .24s ease,transform .24s ease}
.screen.is-active{opacity:1;transform:translateX(0);pointer-events:auto}
.screen-scroll{height:100%;overflow:auto;overscroll-behavior:contain;padding:18px 18px 46px}
.screen-scroll::-webkit-scrollbar{width:0}
.bottom-nav{display:grid;grid-template-columns:repeat(5,1fr);gap:2px;background:rgba(255,255,255,.9);backdrop-filter:saturate(180%) blur(20px);border-top:1px solid var(--border);padding:9px 6px 12px;position:relative;z-index:25}
.bottom-nav a{min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:4px;text-decoration:none;color:#9AA1AC;font-size:10.5px;font-weight:600;transition:color .12s}
.bottom-nav a.is-active{color:var(--primary)}
.bottom-nav a>span{height:23px;display:grid;place-items:center;line-height:1}.bottom-nav strong{max-width:66px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;font-weight:600}
.bottom-nav .central-action{position:relative}.bottom-nav .central-action>span{width:56px;height:56px;margin-top:-26px;border-radius:20px;color:var(--brand-on-primary);background:linear-gradient(145deg,var(--primary-glow),var(--primary) 60%,var(--primary-dark));box-shadow:0 0 0 5px #fff,0 8px 20px color-mix(in srgb,var(--primary) 25%,transparent)}
.mobile-app.is-auth-flow{grid-template-rows:106px minmax(0,1fr) 0}.mobile-app.is-auth-flow .bottom-nav{visibility:hidden;overflow:hidden;padding:0;border:0;pointer-events:none}
.hero-panel,.detail-cover,.profile-card,.checkout-card,.form-card{padding:16px;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}
.hero-panel{min-height:184px;display:flex;flex-direction:column;justify-content:flex-end;background:linear-gradient(145deg,var(--primary-glow),var(--primary) 60%,var(--primary-dark));color:var(--brand-on-primary)}
.hero-panel>span{width:44px;height:44px;display:grid;place-items:center}.hero-panel>span svg{width:36px;height:36px}
.hero-panel h2,.detail-cover h2,.profile-card h2,.checkout-card h2{margin:8px 0 10px;font-size:24px;line-height:1.16;font-weight:700;color:inherit}
.hero-panel p{color:currentColor;opacity:.82}
.success-panel{background:linear-gradient(135deg,var(--success),#0f766e)}
.error-panel{background:linear-gradient(135deg,var(--error),#991b1b)}
.metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}
.metric{padding:14px;border-radius:var(--r-inner);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}
.metric span{display:block;color:var(--text-2);font-size:11.5px;font-weight:600}
.metric strong{display:block;margin-top:8px;font-size:24px;line-height:1;font-weight:700;color:#111827}
.metric.success strong{color:var(--success)}
.metric.warning strong{color:var(--warning)}
.tabs{display:flex;gap:8px;margin:12px 0}
.tabs button{height:34px;padding:0 12px;border:1px solid var(--border);border-radius:999px;background:#fff;color:var(--text-2);font-weight:600;font-size:13px;font-family:inherit}
.tabs button.active{background:#111827;color:#fff;border-color:#111827}
.tab-panel{min-height:32px;margin:-4px 0 10px;padding:8px 11px;border-radius:11px;background:#fff;border:1px solid var(--hairline);color:var(--text-2);font-size:11.5px;font-weight:600}
.list-rows{display:grid;gap:0;margin-top:12px;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);overflow:hidden;box-shadow:var(--shadow)}
.list-row{width:100%;display:flex;align-items:center;justify-content:space-between;text-align:left;gap:13px;padding:14px 16px;background:#fff;border:0;border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s;font-family:inherit}
.list-row:active,.list-row.is-selected{background:#F6F7F8}
.list-row:last-child{border-bottom:0}
.list-rows strong{display:block;font-size:14.5px;line-height:1.25;font-weight:600;color:#111827}
.list-rows p{margin-top:2px;font-size:12.5px;line-height:1.35;font-weight:400;color:var(--text-2)}
.badge{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;background:var(--primary-tint);color:var(--primary);font-size:11.5px;font-weight:600;line-height:1.3;white-space:nowrap}
.badge.done{background:#DCFCE7;color:#15803D}
.badge.pending{background:#FEF3C7;color:#B45309}
.badge.warning{background:#FEE2E2;color:#DC2626}
.product-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.product-card{min-width:0;position:relative;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow);overflow:hidden;transition:transform .12s,box-shadow .12s}
.product-card:hover{box-shadow:var(--shadow-lg)}.product-card:active{transform:scale(.985)}
.product-card-main{width:100%;height:100%;display:flex;flex-direction:column;padding:12px;border:0;background:transparent;text-align:left;font-family:inherit;cursor:pointer}.product-card-main:focus-visible{outline:3px solid var(--primary-light);outline-offset:-3px}
.product-favorite{position:absolute;top:18px;right:18px;z-index:4;width:31px;height:31px;display:grid;place-items:center;border:1px solid rgba(17,24,39,.09);border-radius:11px;background:rgba(255,255,255,.94);color:var(--primary);font:700 19px/1 Manrope,sans-serif;box-shadow:0 3px 10px rgba(15,23,42,.14);cursor:pointer;transition:transform .12s,background .12s,color .12s}.product-favorite:active{transform:scale(.9)}.product-favorite.is-selected{background:var(--primary);border-color:var(--primary);color:var(--brand-on-primary)}
.product-visual{height:76px;border-radius:var(--r-inner);background:var(--primary-tint);border:1px solid var(--primary-light);display:grid;place-items:center;color:var(--primary)}
.product-visual svg{width:28px;height:28px}
.product-grid h3{margin:10px 0 4px;font-size:13.5px;line-height:1.25;font-weight:600;color:#374151}
.product-meta{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:auto;padding-top:9px;color:var(--primary)}.product-meta strong{min-width:0;font-size:11.5px;line-height:1.25}.product-meta span{flex:none;font-size:10.5px;font-weight:700}
.favorites-empty{min-height:230px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px 22px;text-align:center;color:var(--text-2)}.favorites-empty[hidden]{display:none}.favorites-empty>svg{width:38px;height:38px;margin-bottom:14px;color:var(--primary)}.favorites-empty strong{color:#111827;font-size:16px}.favorites-empty p{max-width:250px;margin:7px 0 0;font-size:12px;line-height:1.45}
.search-row{height:42px;margin-bottom:12px;padding:0 14px;border-radius:var(--r-inner);background:#fff;border:1px solid var(--border);display:flex;align-items:center;gap:8px;color:var(--text-2);font-weight:500}
.catalog-search-tools{display:grid;grid-template-columns:minmax(0,1fr) 42px;gap:8px;margin-bottom:12px}.catalog-search-tools .search-row{margin-bottom:0}.favorites-shortcut{width:42px;height:42px;display:grid;place-items:center;border:1px solid var(--primary-light);border-radius:var(--r-inner);background:var(--primary-tint);color:var(--primary);font:700 20px/1 Manrope,sans-serif;cursor:pointer}.favorites-shortcut:active{transform:scale(.94)}
.storefront-hero{position:relative;height:156px;overflow:hidden;border-radius:var(--r-surface);background:var(--primary-dark);color:#fff;box-shadow:var(--shadow)}.storefront-hero>.photo-frame{position:absolute;inset:0}.storefront-hero:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(20,17,58,.92),rgba(20,17,58,.25))}.storefront-hero>div:last-child{position:relative;z-index:2;width:78%;height:100%;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end;padding:17px}.storefront-hero svg{width:25px;height:25px}.storefront-hero strong{margin:8px 0 12px;font-size:15px;line-height:1.35}.storefront-hero button{height:32px;padding:0 12px;border:0;border-radius:10px;background:#fff;color:var(--primary-dark);font:700 11px/1 Manrope,sans-serif;cursor:pointer}.commerce-heading{margin-top:16px}.category-chips{display:flex;gap:7px;margin:12px 0;overflow:auto;scrollbar-width:none}.category-chips::-webkit-scrollbar{display:none}.category-chips button,.variant-chips button{flex:none;height:34px;padding:0 12px;border:1px solid var(--border);border-radius:999px;background:#fff;color:var(--text-2);font:600 11.5px/1 Manrope,sans-serif;cursor:pointer}.category-chips button.active,.category-chips button.is-selected,.variant-chips button.selected,.variant-chips button.is-selected{border-color:var(--primary);background:var(--primary-tint);color:var(--primary)}
.commerce-product-photo{height:260px;margin:-18px -18px 0;overflow:hidden;background:var(--primary-tint)}.commerce-product-image{height:100%}.commerce-product-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 0 12px}.commerce-product-head>div{display:flex;flex-direction:column;gap:5px}.commerce-product-head span{color:#B45309;font-size:12px;font-weight:700}.commerce-product-head strong{font-size:22px;line-height:1.15}.commerce-product-head>button{width:42px;height:42px;border:1px solid var(--border);border-radius:14px;background:#fff;color:var(--primary);font-size:23px;cursor:pointer;transition:background .12s,color .12s,transform .12s}.commerce-product-head>button:active{transform:scale(.92)}.commerce-product-head>button.is-selected{border-color:var(--primary);background:var(--primary);color:var(--brand-on-primary)}.variant-chips{display:flex;gap:8px;margin-bottom:14px}.key-value-rows{overflow:hidden;border:1px solid var(--hairline);border-radius:var(--r-surface);background:#fff;box-shadow:var(--shadow)}.key-value-rows>div{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:13px 15px;border-bottom:1px solid var(--border)}.key-value-rows>div:last-child{border-bottom:0}.key-value-rows span{color:var(--text-2);font-size:12px}.key-value-rows strong{max-width:62%;text-align:right;font-size:12px;line-height:1.35}
.cart-items{display:grid;gap:10px}.cart-items article,.checkout-preview{display:grid;grid-template-columns:68px minmax(0,1fr) auto;align-items:center;gap:11px;padding:12px;border:1px solid var(--hairline);border-radius:var(--r-surface);background:#fff;box-shadow:var(--shadow)}.cart-thumb{width:68px;height:68px;display:grid;place-items:center;overflow:hidden;border-radius:13px;background:var(--primary-tint);color:var(--primary)}.cart-thumb svg{width:24px;height:24px}.cart-items article>div:nth-child(2),.checkout-preview>div:last-child{min-width:0}.cart-items strong,.checkout-preview strong{display:block;font-size:13px;line-height:1.3}.cart-items p,.checkout-preview p{margin:3px 0 6px;color:var(--text-2);font-size:10.5px;line-height:1.35}.cart-items b,.checkout-preview b{font-size:12px}.quantity-control{display:flex;align-items:center;gap:6px}.quantity-control button{width:27px;height:27px;border:1px solid var(--border);border-radius:9px;background:#fff;color:var(--primary);font-size:16px;cursor:pointer}.quantity-control span{font-size:11px;font-weight:700}.commerce-summary{display:grid;gap:9px;margin-top:14px;padding:15px;border:1px solid var(--hairline);border-radius:var(--r-surface);background:#fff;box-shadow:var(--shadow)}.commerce-summary>div{display:flex;justify-content:space-between;gap:14px;color:var(--text-2);font-size:12px}.commerce-summary>div.total{margin-top:3px;padding-top:11px;border-top:1px solid var(--border);color:#111827;font-size:15px}.commerce-form{margin-top:12px}.payment-card-preview{display:flex;align-items:center;gap:13px;padding:16px;border-radius:var(--r-surface);background:linear-gradient(145deg,var(--primary-glow),var(--primary) 60%,var(--primary-dark));color:var(--brand-on-primary);box-shadow:var(--shadow-lg)}.payment-card-preview>span{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:rgba(255,255,255,.14)}.payment-card-preview strong{font-size:15px}.payment-card-preview p{margin:3px 0 0;color:currentColor;opacity:.72;font-size:10.5px}.payment-form{grid-template-columns:1fr 1fr}.payment-form label:first-child{grid-column:1/-1}.order-status-card{display:flex;align-items:center;gap:12px;padding:14px;margin-bottom:12px;border-radius:var(--r-surface);background:var(--primary-tint);color:var(--primary)}.order-status-card>svg{width:28px;height:28px}.order-status-card span,.order-status-card strong{display:block}.order-status-card span{font-size:10.5px;color:var(--text-2)}.order-status-card strong{margin-top:2px;font-size:14px}
.detail-cover{background:var(--primary-dark);color:var(--brand-on-primary)}.detail-cover>span{display:block;color:currentColor}.detail-cover>span svg{width:28px;height:28px}
.detail-cover p{color:currentColor;opacity:.75}
.photo-frame{position:relative;display:block;width:100%;height:100%;overflow:hidden;background:linear-gradient(135deg,var(--primary-tint),#E8ECF4)}.photo-frame .photo-fallback{position:absolute;inset:0;display:grid;place-items:center;color:var(--primary);z-index:0}.photo-frame img{position:relative;z-index:1;display:block;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .18s ease}.photo-frame.image-loaded img{opacity:1}.photo-frame.image-fallback-active img{display:none}.product-visual{overflow:hidden}.product-image{border-radius:inherit}.product-image img{transition:opacity .18s ease,transform .25s ease}.product-card:hover .product-image img{transform:scale(1.035)}
.photo-hero{position:relative;isolation:isolate;overflow:hidden;padding:0;color:#fff}.photo-hero .hero-photo{position:absolute;inset:0;width:100%;height:100%;z-index:-2}.photo-hero .photo-shade{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(11,15,22,.28),rgba(11,15,22,.72) 58%,rgba(11,15,22,.94))}.hero-copy{padding:54px 18px 18px;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.72)}.hero-copy>span{display:grid;width:42px;height:42px;place-items:center}.dashboard-photo{height:128px;position:relative;margin-bottom:12px;border-radius:var(--r-surface);overflow:hidden;background:var(--primary-dark);box-shadow:var(--shadow)}.dashboard-photo .photo-frame{position:absolute;inset:0}.dashboard-photo:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,23,42,.12),rgba(15,23,42,.84))}.dashboard-photo>span:last-child{position:absolute;z-index:3;left:15px;right:15px;bottom:13px;color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.72);font-size:12px;font-weight:650;line-height:1.35}
.detail-cover.has-photo{position:relative;min-height:218px;overflow:hidden;padding:0;color:#fff}.detail-cover.has-photo>.detail-photo{position:absolute;inset:0}.detail-cover.has-photo:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,23,42,.18),rgba(15,23,42,.9))}.detail-copy{position:relative;z-index:2}.detail-cover.has-photo .detail-copy{position:absolute;left:16px;right:16px;bottom:16px;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.72)}.detail-copy>span{color:#fff}
.property-greeting{display:flex;align-items:center;justify-content:space-between;margin:0 0 14px}.property-greeting>div{display:grid;gap:3px}.property-greeting span{font-size:12px;color:var(--text-2)}.property-greeting strong{font-size:20px;line-height:1.2}.property-greeting button,.property-search button,.chat-context button{width:42px;height:42px;display:grid;place-items:center;border:0;border-radius:14px;background:#fff;color:#111827;box-shadow:var(--shadow);cursor:pointer}.property-greeting button svg,.property-search button svg,.chat-context button svg{width:18px;height:18px}.property-search{height:50px;margin-bottom:10px}.property-search>span{flex:1}.property-search button{width:40px;height:40px;margin-right:-7px;background:var(--primary-dark);color:var(--brand-on-primary);box-shadow:none}.section-heading{display:flex;align-items:baseline;justify-content:space-between;margin:15px 0 9px}.section-heading strong{font-size:16px}.section-heading span{font-size:10.5px;color:var(--text-2)}
.property-cards{display:grid;gap:12px}.property-card{display:block;width:100%;padding:0;overflow:hidden;text-align:left;border:1px solid var(--hairline);border-radius:22px;background:#fff;box-shadow:var(--shadow);font-family:inherit;cursor:pointer}.property-card:active{transform:scale(.99)}.property-photo{position:relative;height:168px;background:var(--primary-tint)}.property-card-image{position:absolute;inset:0}.property-photo .featured{position:absolute;z-index:3;top:12px;left:12px;padding:6px 9px;border-radius:999px;background:rgba(255,255,255,.9);font-size:10px;font-weight:700}.property-photo>i{position:absolute;z-index:3;right:12px;top:12px;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:#fff;color:#C9502D;font-style:normal;font-size:18px}.property-card-copy{position:relative;padding:13px 14px 14px}.property-card-copy>strong{display:block;padding-right:70px;font-size:14px;line-height:1.25}.property-card-copy>b{position:absolute;right:14px;top:13px;font-size:13px}.property-card-copy>p{margin:5px 0 9px;color:var(--text-2);font-size:11px}.property-card-copy>span{display:flex;align-items:center;color:#5D6457;font-size:10.5px}.property-card-copy>span svg{width:14px;height:14px}.property-detail-photo{height:238px;position:relative;margin:-18px -18px 0;overflow:hidden;background:var(--primary-tint)}.property-detail-image{position:absolute;inset:0}.photo-count{position:absolute;z-index:3;right:14px;bottom:12px;padding:4px 7px;border-radius:999px;background:rgba(15,23,42,.72);color:#fff;font-size:10px;font-weight:700}.photo-dots{position:absolute;z-index:3;left:15px;bottom:15px;display:flex;gap:5px}.photo-dots i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.58)}.photo-dots i:first-child{background:#fff}.property-detail-head{display:flex;align-items:flex-start;gap:12px;padding:16px 0 5px}.property-detail-head>div{min-width:0;flex:1}.property-detail-head h2{margin:0;font-size:20px;line-height:1.2}.property-detail-head p{margin:5px 0 0;color:var(--text-2);font-size:11.5px;line-height:1.4}.property-detail-head>b{padding:7px 9px;border-radius:999px;background:#fff;color:#A64929;font-size:11px;white-space:nowrap}
.chat-context{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:12px;border-radius:18px;background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}.chat-context>svg{width:28px;height:28px;color:var(--primary)}.chat-context>div{min-width:0;flex:1}.chat-context strong{font-size:13.5px}.chat-context p{margin:2px 0 0;color:var(--text-2);font-size:10px}.chat-thread{display:flex;min-height:315px;flex-direction:column;gap:10px}.chat-thread article{max-width:88%;padding:11px 12px;border-radius:18px 18px 18px 5px;background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}.chat-thread article.mine{align-self:flex-end;border-radius:18px 18px 5px 18px;background:var(--primary-dark);color:var(--brand-on-primary)}.chat-thread strong{display:block;margin-bottom:3px;font-size:10px;opacity:.68}.chat-thread p{margin:0;font-size:12.5px;line-height:1.45}.chat-result-image{height:112px;margin-top:9px;border-radius:12px}.chat-composer{display:flex;gap:8px;margin-top:14px}.chat-composer input{min-width:0;flex:1;height:46px;padding:0 14px;border:1px solid var(--border);border-radius:15px;background:#fff;font:inherit;font-size:12px}.chat-composer button{width:46px;height:46px;display:grid;place-items:center;border:0;border-radius:15px;background:var(--primary-dark);color:var(--brand-on-primary);cursor:pointer}.chat-composer button svg{transform:rotate(180deg)}
.scope-visual{position:relative;min-height:158px;overflow:hidden;border-radius:var(--r-surface);background:var(--primary-dark);color:#fff}.scope-visual>.photo-frame{position:absolute;inset:0}.scope-visual:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(15,23,42,.92),rgba(15,23,42,.38))}.scope-visual>div:last-child{position:relative;z-index:2;width:75%;padding:20px}.scope-visual span{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em!important;opacity:.72}.scope-visual strong{display:block;margin:8px 0 5px;font-size:19px;line-height:1.2}.scope-visual p{margin:0;font-size:11px;line-height:1.4;opacity:.8}.scope-board{display:grid;gap:8px}.scope-board>button{display:flex;align-items:center;gap:10px;width:100%;padding:11px;border:1px solid var(--hairline);border-radius:15px;background:#fff;text-align:left;font-family:inherit;box-shadow:var(--shadow);cursor:pointer}.scope-board>button>i{width:28px;height:28px;display:grid;place-items:center;flex:none;border-radius:10px;background:var(--primary-tint);color:var(--primary);font-size:11px;font-style:normal;font-weight:700}.scope-board>button>div{min-width:0;flex:1}.scope-board strong{display:block;font-size:12.5px}.scope-board p{margin:3px 0 0;color:var(--text-2);font-size:10.5px;line-height:1.3}.scope-board>button>span{font-size:9px;color:var(--text-3)}.scope-board>button.is-selected{border-color:var(--primary);background:var(--primary-tint)}
.form-card{display:grid;gap:12px}
.form-card label{display:grid;gap:6px;color:#4b5870;font-size:12px;font-weight:600}
.form-card input,.form-card select,.form-card textarea{width:100%;min-width:0;border:1px solid var(--border);border-radius:var(--r-inner);padding:0 12px;color:#111827;background:#fff;font-weight:600;font-family:inherit}
.form-card input,.form-card select{height:42px}.form-card textarea{min-height:78px;padding-top:10px;resize:none}.form-card input:invalid,.form-card textarea:invalid,.form-card select:invalid{border-color:var(--error)}.field-error{min-height:12px;color:var(--error);font-size:10.5px;font-weight:600}
.notice{padding:14px 16px;border-radius:var(--r-inner);background:var(--primary-tint);color:var(--primary-dark);font-weight:600;border:1px solid var(--primary-light)}
.notice.success{background:#DCFCE7;color:#15803D;border-color:rgba(22,163,74,.24)}
.timeline{display:grid;gap:10px}
.timeline-row{display:flex;gap:13px;padding:14px 16px;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}
.timeline-row i{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#F6F7F8;font-style:normal;font-weight:700;color:#6B7280;font-variant-numeric:tabular-nums}
.timeline-row.active i{background:var(--primary);color:var(--brand-on-primary)}
.timeline-row.done i{background:var(--success);color:#fff}
.timeline-row strong{font-size:14px;font-weight:600;color:#162033}
.checkout-card .list-rows{box-shadow:none;margin-top:8px;border-color:var(--border)}
.checkout-card .list-rows article{padding-inline:0;border-bottom:1px solid var(--border);border-radius:0}
.total-row{display:flex;justify-content:space-between;margin-top:14px;font-size:18px;font-weight:500;color:#111827}
.large-avatar{width:72px;height:72px;margin-bottom:14px;border-radius:24px}
.auth-mark{padding:18px 10px 20px;text-align:center}.auth-mark>svg{width:34px;height:34px;color:var(--primary)}.auth-mark strong{display:block;margin-top:8px;font-size:20px;font-weight:650;color:#111827}.auth-mark p{margin:4px auto 0;max-width:260px;font-size:12.5px;line-height:1.45;color:var(--text-2)}
.choice-list{display:grid;gap:10px}.choice-list button{min-height:70px;display:grid;grid-template-columns:44px minmax(0,1fr) 24px;align-items:center;text-align:left;gap:12px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--r-surface);background:#fff;box-shadow:var(--shadow);font-family:inherit}.choice-list button.selected{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-tint)}.choice-code{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;background:var(--primary-tint);color:var(--primary);font-size:12px;font-weight:700}.choice-list strong{font-size:14px;font-weight:650;color:#111827}.choice-list p{margin-top:2px;font-size:12px;color:var(--text-2)}.choice-list i{color:var(--success)}.choice-list i svg{width:21px;height:21px}
.otp-form{display:block}.otp-boxes{display:flex;justify-content:center;gap:9px;margin:0 0 18px}.otp-boxes input{width:48px;height:54px;padding:0;text-align:center;border:1px solid var(--primary-light);border-radius:14px;background:#fff;color:#111827;font:650 22px/1 Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:var(--shadow);outline:0}.otp-boxes input:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-tint)}
.active-search{border-color:var(--primary-light);box-shadow:0 0 0 2px var(--primary-tint)}.active-search input{min-width:0;flex:1;border:0;background:transparent;color:#111827;font-size:13.5px;font-weight:600;font-family:inherit;outline:0}.active-search button{width:26px;height:26px;border:0;background:transparent;color:var(--text-3);font-size:20px;line-height:1;cursor:pointer}
.activity-timeline{position:relative;display:grid;margin-top:10px}.activity-timeline:before{content:"";position:absolute;left:25px;top:24px;bottom:24px;width:1px;background:var(--border)}.activity-timeline article{position:relative;display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:start;gap:10px;padding:12px 0}.activity-timeline i{z-index:1;width:38px;height:38px;display:grid;place-items:center;border-radius:13px;background:var(--primary-tint);color:var(--primary)}.activity-timeline i.done{background:#DCFCE7;color:#15803D}.activity-timeline i.warning{background:#FEE2E2;color:#DC2626}.activity-timeline i svg{width:18px;height:18px}.activity-timeline strong{display:block;font-size:13.5px;font-weight:650;color:#111827}.activity-timeline p{margin-top:3px;font-size:11.5px;line-height:1.35;color:var(--text-2)}.activity-timeline time{padding-top:3px;color:var(--text-3);font-size:10.5px}
.quick-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.quick-grid article{min-height:138px;padding:15px;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}.quick-grid article>span{width:40px;height:40px;display:grid;place-items:center;border-radius:13px;background:var(--primary-tint);color:var(--primary)}.quick-grid article>span svg{width:20px;height:20px}.quick-grid strong{display:block;margin-top:18px;font-size:14px;font-weight:650;color:#111827}.quick-grid p{margin-top:4px;font-size:11.5px;line-height:1.35;color:var(--text-2)}
.kanban-board{display:grid;grid-template-columns:1fr 1fr;gap:9px}.kanban-board>section{min-width:0;padding:12px;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}.kanban-board header{display:flex;align-items:center;gap:7px}.kanban-board header strong{font-size:12.5px;font-weight:650;color:#111827}.kanban-dot{width:8px;height:8px;border-radius:50%;background:#3B82F6}.kanban-dot.tone-1{background:#F59E0B}.kanban-dot.tone-2{background:#8B5CF6}.kanban-dot.tone-3{background:#22C55E}.kanban-board>section>p{min-height:32px;margin:7px 0 10px;font-size:10.5px;line-height:1.35;color:var(--text-2)}.mini-deal{padding:9px;border-radius:11px;background:#F7F8FA}.mini-deal b,.mini-deal span{display:block}.mini-deal b{font-size:11.5px;font-weight:650;color:#111827}.mini-deal span{margin-top:3px;font-size:9.5px;color:var(--text-3)}
.calendar-card{padding:14px;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}.calendar-card>header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.calendar-card>header strong{font-size:14px;font-weight:650}.calendar-card>header span{color:var(--primary);font-weight:700}.weekdays,.calendar-days{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center}.weekdays b{padding:4px 0;color:var(--text-3);font-size:9.5px;font-weight:600}.calendar-days span{position:relative;height:31px;display:grid;place-items:center;border-radius:9px;color:#344054;font-size:11.5px}.calendar-days span.today{background:var(--primary);color:var(--brand-on-primary);font-weight:700}.calendar-days span.has-event:after{content:"";position:absolute;bottom:3px;width:3px;height:3px;border-radius:50%;background:var(--primary)}
.bar-chart{height:150px;display:flex;align-items:flex-end;gap:7px;padding:18px 14px 10px;margin:12px 0;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}.bar-chart>span{height:100%;min-width:0;flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px}.bar-chart i{width:100%;height:var(--bar);display:block;border-radius:8px 8px 3px 3px;background:linear-gradient(180deg,var(--primary-glow),var(--primary));opacity:.9}.bar-chart b{color:var(--text-3);font-size:9px;font-weight:600}
.permission-head,.permission-list article{display:grid;grid-template-columns:minmax(0,1fr) 26px 26px 26px;align-items:center;gap:5px}.permission-head{padding:0 12px 7px;color:var(--text-3);font-size:9.5px;text-transform:uppercase}.permission-head b{text-align:center}.permission-list{overflow:hidden;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}.permission-list article{padding:12px;border-bottom:1px solid var(--border)}.permission-list article:last-child{border-bottom:0}.permission-list strong{font-size:12.5px;font-weight:650;color:#111827}.permission-list p{margin-top:2px;font-size:10px;line-height:1.3;color:var(--text-2)}.permission-list i{width:22px;height:22px;display:grid;place-items:center;border-radius:7px;background:#F2F4F7;color:var(--text-3);font-style:normal;font-size:11px}.permission-list i.on{background:#DCFCE7;color:#15803D}
.integration-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.integration-grid article{min-width:0;min-height:150px;padding:14px;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}.integration-grid article>span{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:var(--primary-tint);color:var(--primary)}.integration-grid article>span svg{width:19px;height:19px}.integration-grid strong{display:block;margin-top:12px;font-size:12.5px;font-weight:650;color:#111827}.integration-grid p{min-height:30px;margin:4px 0 9px;font-size:10.5px;line-height:1.35;color:var(--text-2)}.integration-grid em{font-style:normal}
.settings-list,.entity-rows,.document-list{overflow:hidden;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}.settings-list article,.entity-row,.document-list article{min-width:0;width:100%;display:flex;align-items:center;text-align:left;gap:11px;padding:13px;border:0;border-bottom:1px solid var(--border);background:#fff;font-family:inherit}.settings-list article:last-child,.entity-row:last-child,.document-list article:last-child{border-bottom:0}.settings-list article>span,.document-list article>span{width:36px;height:36px;flex:none;display:grid;place-items:center;border-radius:12px;background:#F2F4F7;color:#667085}.settings-list article>span svg,.document-list article>span svg{width:18px;height:18px}.settings-list article>div,.entity-row>div,.document-list article>div{min-width:0;flex:1}.settings-list strong,.entity-rows strong,.document-list strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:650;color:#111827}.settings-list p,.entity-rows p,.document-list p{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;color:var(--text-2)}.toggle{width:34px;height:20px;flex:none;border:0;padding:0;border-radius:999px;background:#D0D5DD;position:relative;cursor:pointer}.toggle:after{content:"";position:absolute;width:16px;height:16px;left:2px;top:2px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18)}.toggle.on{background:var(--success)}.toggle.on:after{left:16px}
.entity-avatar{width:40px;height:40px;flex:none;display:grid;place-items:center;border-radius:14px;background:var(--primary-tint);color:var(--primary);font-size:11px;font-weight:700}.entity-rows em{font-style:normal}.document-list button{width:28px;height:28px;border:0;background:transparent;color:var(--text-2);font-weight:700;cursor:pointer}.note-list{display:grid;grid-template-columns:1fr 1fr;gap:9px}.note-list article{min-height:116px;padding:14px;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}.note-list p{font-size:12.5px;line-height:1.4;font-weight:600;color:#111827}.note-list span{display:block;margin-top:14px;font-size:10px;line-height:1.35;color:var(--text-3)}
.filter-summary{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;margin-bottom:10px;border-radius:var(--r-inner);background:var(--primary-tint);color:var(--primary-dark)}.filter-summary strong{font-size:12.5px;font-weight:650}.filter-summary span{text-align:right;font-size:10.5px}.filter-card input{background:#F8FAFC}.quote-head{display:flex;gap:12px;align-items:center;padding:14px;margin-bottom:10px;border-radius:var(--r-surface);background:var(--primary-dark);color:var(--brand-on-primary)}.quote-head>span{width:40px;height:40px;display:grid;place-items:center;border-radius:13px;background:rgba(255,255,255,.12)}.quote-head strong{font-size:14px;font-weight:650}.quote-head p{margin-top:3px;font-size:10.5px;color:currentColor;opacity:.72}
.action-row{display:flex;gap:10px;margin:16px 16px 0}
.ui-button{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:52px;border:0;border-radius:var(--r-inner);padding:0 16px;font-family:inherit;font-size:15.5px;font-weight:600;cursor:pointer;transition:transform .12s,filter .12s,background .12s}
.ui-button.primary{background:linear-gradient(135deg,var(--primary-glow) 0%,var(--primary) 55%,var(--primary-dark) 100%);color:var(--brand-on-primary)}
.ui-button.soft{background:var(--primary-tint);color:var(--primary-dark);border:1px solid var(--primary-light)}
.ui-button.ghost{background:#fff;color:#111827;border:1px solid var(--border)}
.ui-button.compact{width:auto;height:42px;border-radius:11px;padding:0 16px;font-size:13.5px}
.ui-button:hover:not(:disabled){filter:brightness(1.08)}.ui-button:active:not(:disabled){transform:scale(.985);filter:brightness(.94)}
.ui-button:disabled{background:#F6F7F8;color:var(--text-3);border:1px solid var(--border);cursor:default}
.overlay-root{position:absolute;inset:0;z-index:80;display:grid;align-items:end;background:rgba(15,23,42,.24);padding:18px}.overlay-root[hidden]{display:none}.overlay-panel{width:100%;max-height:70%;overflow:auto;padding:16px;border-radius:22px 22px 34px 34px;background:#fff;box-shadow:0 -12px 32px rgba(15,23,42,.18)}.overlay-panel[role="dialog"]{align-self:center;border-radius:22px}.overlay-panel h3{margin:0;font-size:18px;line-height:1.25;color:#111827}.overlay-panel p{margin:5px 0 12px;color:var(--text-2);font-size:12.5px;line-height:1.4}.overlay-panel .list-rows{box-shadow:none}.demo-toast{position:absolute;left:22px;right:22px;bottom:92px;z-index:90;pointer-events:none;padding:12px 14px;border-radius:14px;background:#111827;color:#fff;font-size:12px;font-weight:650;text-align:center;box-shadow:0 10px 28px rgba(15,23,42,.22)}.demo-toast[hidden]{display:none}
.ds-intro{padding:2px 0 4px}.ds-intro h2{margin:0;font-size:21px;line-height:1.25;font-weight:700;color:#111827}.ds-intro p{margin:4px 0 0;font-size:12.5px;line-height:1.45;color:var(--text-2)}
.ds-section{margin-top:14px}.ds-section h3{margin:0 0 10px;font-size:15.5px;line-height:1.3;font-weight:650;color:#111827}
.ds-token-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.ds-token{min-width:0}.ds-swatch{display:block;height:48px;border-radius:var(--r-inner);border:1px solid var(--border)}.ds-token strong{display:block;margin-top:5px;font-size:11.5px;line-height:1.25;font-weight:650;color:#111827}.ds-token small{display:block;margin-top:1px;font-size:10.5px;color:var(--text-2)}
.primary-swatch{background:var(--primary)}.primary-dark-swatch{background:var(--primary-dark)}.tint-swatch{background:var(--primary-tint)}.background-swatch{background:#F6F7F8}.surface-swatch{background:#fff}.text-swatch{background:#111827}.success-swatch{background:#22C55E}.warning-swatch{background:#F59E0B}.error-swatch{background:#EF4444}.info-swatch{background:#3B82F6}
.button-stack{display:grid;gap:10px}.compact-row{display:flex;gap:8px}.ds-badges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.ds-alert{padding:12px 14px;margin-top:8px;border-radius:var(--r-inner);border:1px solid transparent}.ds-alert strong{font-size:13px;font-weight:700}.ds-alert p{margin:2px 0 0;font-size:12px;line-height:1.4}.success-alert{background:#ECFDF5;border-color:#DCFCE7;color:#15803D}.warning-alert{background:#FFFBEB;border-color:#FEF3C7;color:#92400E}
.ds-type-sample{display:grid;gap:3px;padding:14px;border-radius:var(--r-surface);background:#fff;border:1px solid var(--hairline);box-shadow:var(--shadow)}.ds-type-sample strong{display:block;color:#111827}.ds-type-sample span{font-size:10.5px;color:var(--text-3)}.ds-type-sample p{margin:9px 0 0;font-size:12.5px;color:var(--text-2)}.ds-display{font-size:31px;line-height:1.15;font-weight:700}.ds-title{margin-top:9px;font-size:17px;font-weight:650}.ds-body{margin-top:9px;font-size:14.5px;font-weight:600}
html.kp-embed-phone,html.kp-embed-phone body{width:100%;height:100%;min-height:100%;overflow:hidden;background:#EEF1F5}
html.kp-embed-phone .prototype-shell{display:block;width:100%;height:100vh;min-height:100vh;background:transparent}
html.kp-embed-phone .sidebar,html.kp-embed-phone .stage-copy{display:none!important}
html.kp-embed-phone .stage{display:grid;width:100%;height:100vh;min-height:100vh;place-items:center;padding:24px;overflow:hidden;background:#EEF1F5}
html.kp-embed-phone .phone-wrap{width:343px;height:743px}
html.kp-embed-phone .phone{transform:scale(.88)}
@media (max-height:900px){.stage{gap:12px;padding:16px}.phone-wrap{width:304px;height:658px}.phone{transform:scale(.78)}.hero-panel{min-height:150px}}
@media (max-height:700px){.stage-copy{display:none}.phone-wrap{width:273px;height:591px}.phone{transform:scale(.70)}}
@media (max-width:1100px){.prototype-shell{grid-template-columns:1fr}.sidebar{display:none}}
@media (max-width:480px){body{overflow:auto}.prototype-shell{min-height:100vh;height:auto}.stage{height:auto;min-height:100vh;padding:16px}.stage-copy{display:none}.phone-wrap{width:304px;height:658px}.phone{transform:scale(.78)}}`;
}

function fixedInteractionScript() {
  return `
(function(){
  if(new URLSearchParams(window.location.search).get('embed') === 'phone') document.documentElement.classList.add('kp-embed-phone');
  var data = JSON.parse(document.getElementById('prototype-data').textContent);
  var historyStack = [];
  var runtimeState = {};
  data.screens.forEach(function(screen){runtimeState[screen.id] = JSON.parse(JSON.stringify(screen.localState || {}));});
  var favoriteIds = new Set(Array.from(document.querySelectorAll('[data-favorite-initial="true"]')).map(function(node){return node.dataset.favoriteId;}).filter(Boolean));
  window.__prototypeEvents = [];
  function byId(id){return document.querySelector('[data-screen="'+CSS.escape(id)+'"]');}
  function activeScreen(){return document.querySelector('.screen.is-active');}
  function currentScreenId(){return activeScreen()?.dataset.screen || data.firstScreenId;}
  function meta(id){return data.screens.find(function(row){return row.id === id;}) || {};}
  function record(type, detail){window.__prototypeEvents.push({type:type, detail:detail || '', screenId:currentScreenId(), at:Date.now()});}
  function syncFavoriteButtons(){
    document.querySelectorAll('[data-favorite-id]').forEach(function(button){
      var selected = favoriteIds.has(button.dataset.favoriteId);
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.setAttribute('aria-label', selected ? button.dataset.removeLabel || 'Remove from favorites' : button.dataset.addLabel || 'Add to favorites');
      button.textContent = selected ? '♥' : '♡';
    });
  }
  function updateFavoritesEmpty(){
    var screen = byId('favorites');
    if(!screen) return;
    var count = screen.querySelectorAll('.product-grid .product-card').length;
    var empty = screen.querySelector('[data-favorites-empty]');
    if(empty) empty.hidden = count > 0;
  }
  function favoriteSourceCard(id, trigger){
    return trigger?.closest?.('.product-card') || document.querySelector('[data-screen="catalog"] .product-card[data-product-id="'+CSS.escape(id)+'"]') || document.querySelector('.product-card[data-product-id="'+CSS.escape(id)+'"]');
  }
  function toggleFavorite(button){
    var id = button?.dataset.favoriteId;
    if(!id) return;
    var selected = !favoriteIds.has(id);
    if(selected) favoriteIds.add(id); else favoriteIds.delete(id);
    var favoritesGrid = byId('favorites')?.querySelector('.product-grid');
    var favoriteCard = favoritesGrid?.querySelector('.product-card[data-product-id="'+CSS.escape(id)+'"]');
    if(selected && favoritesGrid && !favoriteCard){
      var source = favoriteSourceCard(id, button);
      if(source) favoritesGrid.appendChild(source.cloneNode(true));
    }
    if(!selected && favoriteCard) favoriteCard.remove();
    syncFavoriteButtons();
    updateFavoritesEmpty();
    showToast(selected ? button.dataset.addedMessage || 'Added to favorites' : button.dataset.removedMessage || 'Removed from favorites');
    record(selected ? 'favorite_add' : 'favorite_remove', id);
  }
  function copyProductImage(source, target){
    var sourceImage = source?.querySelector?.('img[data-prototype-image]');
    var targetImage = target?.querySelector?.('img[data-prototype-image]');
    if(!sourceImage || !targetImage) return;
    targetImage.src = sourceImage.src;
    targetImage.alt = sourceImage.alt;
    targetImage.hidden = false;
  }
  function selectProduct(row){
    var card = row?.closest?.('.product-card');
    if(!card) return;
    var id = card.dataset.productId;
    var title = card.dataset.productTitle || '';
    var detail = card.dataset.productDetail || '';
    var price = card.dataset.productPrice || '';
    var rating = card.dataset.productRating || '';
    var productScreen = byId('product');
    var productMeta = meta('product');
    productMeta.title = title || productMeta.title;
    productMeta.description = detail || productMeta.description;
    if(productScreen){
      productScreen.dataset.screenTitle = productMeta.title;
      productScreen.dataset.screenDescription = productMeta.description;
      var ratingNode = productScreen.querySelector('.commerce-product-head span');
      var priceNode = productScreen.querySelector('.commerce-product-head strong');
      if(ratingNode && rating) ratingNode.textContent = '★ '+rating;
      if(priceNode && price) priceNode.textContent = price;
      var favorite = productScreen.querySelector('[data-favorite-id]');
      if(favorite) favorite.dataset.favoriteId = id;
      copyProductImage(card, productScreen.querySelector('.commerce-product-photo'));
    }
    ['cart','checkout','order_details'].forEach(function(screenId){
      var screen = byId(screenId);
      var itemTitle = screen?.querySelector('.cart-items strong,.checkout-preview strong');
      var itemPrice = screen?.querySelector('.cart-items b,.checkout-preview b');
      if(itemTitle && title) itemTitle.textContent = title;
      if(itemPrice && price) itemPrice.textContent = price;
      copyProductImage(card, screen);
    });
    document.querySelectorAll('[data-screen="cart"] .commerce-summary strong,[data-screen="checkout"] .commerce-summary strong,[data-screen="payment"] .commerce-summary strong,[data-screen="order_details"] .commerce-summary strong').forEach(function(node){if(/\\d/.test(node.textContent || '') && price) node.textContent = price;});
    syncFavoriteButtons();
    record('product_select', id);
  }
  function handleDemoState(control){
    var group = control.closest('.category-chips,.variant-chips');
    if(group){
      group.querySelectorAll('button').forEach(function(button){var selected = button === control;button.classList.toggle('active', selected);button.classList.toggle('selected', selected);button.classList.toggle('is-selected', selected);});
    } else if(control.closest('.quantity-control')) {
      var value = control.parentElement?.querySelector('span');
      var current = Math.max(1, Number(value?.textContent || 1));
      if(/increase/i.test(control.getAttribute('aria-label') || '')) current += 1;
      if(/decrease/i.test(control.getAttribute('aria-label') || '')) current = Math.max(1, current - 1);
      if(value) value.textContent = String(current);
    } else control.classList.toggle('is-selected');
    record('demo_state', control.getAttribute('aria-label') || control.textContent || 'control');
  }
  function activate(id, push){
    if(!byId(id)) id = data.firstScreenId;
    var current = activeScreen();
    if(push && current && current.dataset.screen !== id) historyStack.push(current.dataset.screen);
    document.querySelectorAll('.screen').forEach(function(node){node.classList.toggle('is-active', node.dataset.screen === id);});
    document.querySelectorAll('[data-screen-link]').forEach(function(node){node.classList.toggle('is-active', node.dataset.screenLink === id);});
    var screen = meta(id);
    document.getElementById('screen-title').textContent = screen.title || id;
    document.getElementById('screen-description').textContent = screen.description || '';
    var backButton = document.querySelector('[data-back]');
    if(backButton) backButton.hidden = (data.entryScreenIds || [data.firstScreenId]).includes(id);
    document.querySelector('.mobile-app')?.classList.toggle('is-auth-flow', /^(onboarding|language|login|login_otp|password_reset|password_reset_done)$/.test(id));
    if(location.hash.slice(1) !== id) history.replaceState(null, '', '#'+id);
    window.__kpPrototypeImagesReady = waitForPrototypeImages(byId(id), 8000);
    record('navigate', id);
  }
  function actionFor(button){
    var screen = meta(currentScreenId());
    var actionId = button.dataset.actionId;
    return (screen.actions || []).find(function(action){return action.id === actionId;}) || {
      id: actionId || 'navigate',
      type: button.dataset.actionType || 'navigate',
      label: button.textContent || '',
      targetScreenId: button.dataset.actionTarget || ''
    };
  }
  function dispatch(action, trigger){
    if(!action || trigger?.disabled) return;
    if(action.type === 'navigate'){activate(action.targetScreenId, true);return;}
    if(action.type === 'back'){activate(historyStack.pop() || data.firstScreenId, false);record('back');return;}
    if(action.type === 'submit'){submitAction(action, trigger);return;}
    if(action.type === 'toggle'){toggleAction(action, trigger);return;}
    if(action.type === 'select'){selectAction(action, trigger);return;}
    if(action.type === 'set_tab'){setTab(trigger, action.tabId || action.value);return;}
    if(action.type === 'set_value'){setValueAction(action, trigger);return;}
    if(action.type === 'open_sheet' || action.type === 'open_dialog'){openOverlay(action.overlay || overlayFromTrigger(trigger), action.type === 'open_dialog' ? 'dialog' : 'sheet', trigger);return;}
    if(action.type === 'close_overlay'){closeOverlay();return;}
    if(action.type === 'reset'){resetScreen(action.stateKey);return;}
    if(action.type === 'copy_demo'){showToast(String(action.value || action.label || 'Demo'));record('copy_demo', action.id);return;}
  }
  function submitAction(action, trigger){
    var form = document.getElementById(action.formId || '') || trigger.closest('.screen')?.querySelector('form');
    if(form && !validateForm(form)){record('validation_failed', action.id);return;}
    if(form) {
      var status = form.querySelector('[data-form-status]');
      if(status) status.textContent = action.pendingState || 'Demo state saved';
    }
    var outcome = (action.outcomes || []).find(function(row){return row.when === 'demo-success';}) || (action.outcomes || [])[0] || {};
    record('submit', action.id);
    if(outcome.targetScreenId) activate(outcome.targetScreenId, true);
    else showToast(action.label || 'Done');
  }
  function validateForm(form){
    var valid = true;
    form.querySelectorAll('[data-field-error]').forEach(function(node){node.textContent = '';});
    form.querySelectorAll('input,textarea,select').forEach(function(field){
      var message = '';
      if(field.required && !String(field.value || '').trim()) message = 'Заполните поле';
      else if(field.pattern) {
        try { if(!(new RegExp(field.pattern)).test(field.value || '')) message = 'Проверьте формат'; } catch (_) {}
      }
      field.setAttribute('aria-invalid', message ? 'true' : 'false');
      var error = field.parentElement?.querySelector('[data-field-error]');
      if(error) error.textContent = message;
      if(message) valid = false;
    });
    return valid;
  }
  function toggleAction(action, trigger){
    var toggle = trigger?.matches?.('[data-toggle-id]') ? trigger : trigger?.closest?.('[data-toggle-id]');
    if(!toggle) toggle = activeScreen()?.querySelector('[data-toggle-id]');
    if(!toggle) return;
    var on = !toggle.classList.contains('on');
    toggle.classList.toggle('on', on);
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    runtimeState[currentScreenId()] = runtimeState[currentScreenId()] || {};
    runtimeState[currentScreenId()][action.stateKey || toggle.dataset.toggleId] = on;
    record('toggle', toggle.dataset.toggleId || action.id);
  }
  function selectAction(action, trigger){
    var screen = activeScreen();
    if(action.value === 'next'){
      var active = screen?.querySelector('.timeline-row.active');
      var next = active?.nextElementSibling;
      if(next){active.classList.remove('active');active.classList.add('done');next.classList.remove('pending');next.classList.add('active');record('step_next', action.id);return;}
    }
    var selected = trigger?.closest?.('[data-select-id]') || screen?.querySelector('[data-select-id]');
    if(selected){
      var group = selected.closest('.choice-list,.entity-rows,.list-rows') || screen;
      group.querySelectorAll('[data-select-id]').forEach(function(node){node.classList.toggle('selected', node === selected);node.classList.toggle('is-selected', node === selected);node.setAttribute('aria-pressed', node === selected ? 'true' : 'false');});
      runtimeState[currentScreenId()] = runtimeState[currentScreenId()] || {};
      runtimeState[currentScreenId()].selectedItemId = selected.dataset.selectId;
      record('select', selected.dataset.selectId);
    }
  }
  function setValueAction(action, trigger){
    var screen = activeScreen();
    var input = screen?.querySelector('[data-search-input],input,textarea,select');
    if(input && action.value !== undefined) input.value = action.value;
    filterRows(screen, input?.value || '');
    showToast(action.label || 'Updated');
    record('set_value', action.stateKey || action.id);
  }
  function setTab(tab, explicitId){
    if(!tab) return;
    var group = tab.closest('.tabs');
    if(!group) return;
    group.querySelectorAll('button').forEach(function(node){var active = explicitId ? node.dataset.tabId === explicitId : node === tab;node.classList.toggle('active', active);node.setAttribute('aria-selected', active ? 'true' : 'false');});
    var activeTab = group.querySelector('.active') || tab;
    var panel = group.nextElementSibling?.matches('[data-tab-panel]') ? group.nextElementSibling : null;
    if(panel) panel.textContent = activeTab.textContent + ' · demo dataset updated';
    runtimeState[currentScreenId()] = runtimeState[currentScreenId()] || {};
    runtimeState[currentScreenId()].activeTab = activeTab.dataset.tabId || activeTab.textContent;
    record('tab', runtimeState[currentScreenId()].activeTab);
  }
  function filterRows(screen, query){
    var text = String(query || '').trim().toLowerCase();
    var rows = screen?.querySelectorAll('[data-row-action]');
    var visible = 0;
    rows?.forEach(function(row){
      var match = !text || row.textContent.toLowerCase().includes(text);
      var target = row.closest('.product-card') || row;
      target.hidden = !match;
      if(match) visible += 1;
    });
    var summary = screen?.querySelector('[data-filter-summary]');
    if(summary) summary.textContent = visible + ' demo rows';
    runtimeState[currentScreenId()] = runtimeState[currentScreenId()] || {};
    runtimeState[currentScreenId()].query = query;
    record('filter', text);
  }
  function overlayFromTrigger(trigger){
    return {
      title: trigger?.dataset.menuTitle || 'Demo actions',
      description: trigger?.dataset.menuDetail || 'Preview and safe demo operations',
      items: [{title:'Preview', detail:'Open bottom sheet', status:'active'}, {title:'Copy demo link', detail:'No external request', status:'done'}],
      actions: [{id:'close-overlay', type:'close_overlay', label:'Закрыть'}]
    };
  }
  function openOverlay(overlay, kind, trigger){
    var root = document.querySelector('[data-overlay-root]');
    if(!root) return;
    var items = (overlay?.items || []).slice(0,3).map(function(item){return '<button type="button" class="list-row" data-demo-state><div><strong>'+escapeHtml(item.title || '')+'</strong><p>'+escapeHtml(item.detail || '')+'</p></div><span class="badge '+escapeHtml(item.status || 'active')+'">'+escapeHtml(item.status || 'demo')+'</span></button>';}).join('');
    root.innerHTML = '<div class="overlay-panel" role="dialog" aria-modal="true" aria-label="'+escapeHtml(overlay?.title || 'Dialog')+'"><h3>'+escapeHtml(overlay?.title || 'Demo')+'</h3><p>'+escapeHtml(overlay?.description || '')+'</p><div class="list-rows">'+items+'</div><div class="action-row"><button type="button" class="ui-button primary" data-close-overlay>Закрыть</button></div></div>';
    root.hidden = false;
    root.dataset.returnFocus = trigger ? '1' : '';
    root.querySelector('button')?.focus();
    record(kind || 'overlay', overlay?.title || '');
  }
  function closeOverlay(){
    var root = document.querySelector('[data-overlay-root]');
    if(root){root.hidden = true;root.innerHTML = '';}
    record('close_overlay');
  }
  function resetScreen(stateKey){
    var screen = activeScreen();
    screen?.querySelectorAll('[data-search-input]').forEach(function(input){input.value='';filterRows(screen, '');});
    screen?.querySelectorAll('[data-field-error]').forEach(function(node){node.textContent='';});
    showToast('Demo state reset');
    record('reset', stateKey || '');
  }
  function showToast(message){
    var toast = document.querySelector('[data-demo-toast]');
    if(!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function(){toast.hidden = true;}, 1600);
  }
  function escapeHtml(value){
    return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function bindPrototypeImage(image){
    if(image.__kpPrototypeImagePromise) return image.__kpPrototypeImagePromise;
    image.__kpPrototypeImagePromise = new Promise(function(resolve){
      var settled = false;
      function finish(status){
        if(settled) return;
        settled = true;
        image.dataset.imageStatus = status;
        var frame = image.closest('.photo-frame');
        if(frame){
          frame.dataset.imageState = status;
          frame.classList.toggle('image-loaded', status === 'loaded');
          frame.classList.toggle('image-fallback-active', status !== 'loaded');
        }
        if(status !== 'loaded') image.hidden = true;
        resolve(status);
      }
      image.addEventListener('load', function(){finish(image.naturalWidth > 0 ? 'loaded' : 'failed');}, {once:true});
      image.addEventListener('error', function(){finish('failed');}, {once:true});
      if(image.complete) finish(image.naturalWidth > 0 ? 'loaded' : 'failed');
    });
    return image.__kpPrototypeImagePromise;
  }
  function imageSummary(images, timedOut){
    var loaded = images.filter(function(image){return image.dataset.imageStatus === 'loaded' && image.naturalWidth > 0;}).length;
    var failed = images.filter(function(image){return image.dataset.imageStatus === 'failed' || (image.complete && image.naturalWidth === 0);}).length;
    return {total:images.length, loaded:loaded, failed:failed, pending:Math.max(0, images.length-loaded-failed), timedOut:Boolean(timedOut)};
  }
  function waitForPrototypeImages(root, timeoutMs){
    var scope = root && root.querySelectorAll ? root : document;
    var images = Array.from(scope.querySelectorAll('[data-prototype-image]'));
    images.forEach(function(image){image.loading = 'eager';});
    if(!images.length) return Promise.resolve(imageSummary(images, false));
    var complete = Promise.all(images.map(bindPrototypeImage)).then(function(){return imageSummary(images, false);});
    var timeout = new Promise(function(resolve){setTimeout(function(){resolve(imageSummary(images, true));}, Math.max(1000, Number(timeoutMs) || 8000));});
    return Promise.race([complete, timeout]);
  }
  window.__kpWaitForPrototypeImages = waitForPrototypeImages;
  document.querySelectorAll('[data-prototype-image]').forEach(bindPrototypeImage);
  document.addEventListener('click', function(event){
    var action = event.target.closest('[data-action-id]');
    if(action){event.preventDefault();dispatch(actionFor(action), action);return;}
    var link = event.target.closest('[data-screen-link]');
    if(link){event.preventDefault();activate(link.dataset.screenLink, true);return;}
    var tab = event.target.closest('.tabs button');
    if(tab){event.preventDefault();dispatch({type:'set_tab', id:'tab', label:tab.textContent, tabId:tab.dataset.tabId}, tab);return;}
    var toggle = event.target.closest('[data-toggle-id]');
    if(toggle){event.preventDefault();dispatch({type:'toggle', id:'toggle', label:toggle.getAttribute('aria-label') || '', stateKey:toggle.dataset.toggleId}, toggle);return;}
    var menu = event.target.closest('[data-menu-id]');
    if(menu){event.preventDefault();dispatch({type:'open_sheet', id:'document-menu', label:'Open', overlay:overlayFromTrigger(menu)}, menu);return;}
    var close = event.target.closest('[data-close-overlay]');
    if(close){event.preventDefault();closeOverlay();return;}
    var favorite = event.target.closest('[data-favorite-id]');
    if(favorite){event.preventDefault();event.stopPropagation();toggleFavorite(favorite);return;}
    var row = event.target.closest('[data-row-action]');
    if(row){event.preventDefault();if(row.dataset.rowTarget === 'product') selectProduct(row);if(row.dataset.rowTarget){dispatch({type:'navigate', id:'row-open', label:row.textContent, targetScreenId:row.dataset.rowTarget}, row);}else{dispatch({type:'select', id:'row-select', label:row.textContent, stateKey:'selected', value:row.dataset.selectId}, row);}return;}
    var select = event.target.closest('.choice-list [data-select-id]');
    if(select){event.preventDefault();dispatch({type:'select', id:'select', label:select.textContent, stateKey:'selected', value:select.dataset.selectId}, select);return;}
    var clear = event.target.closest('[data-search-clear]');
    if(clear){event.preventDefault();var screen = activeScreen();var input = screen?.querySelector('[data-search-input]');if(input){input.value='';filterRows(screen,'');input.focus();}return;}
    var demo = event.target.closest('[data-demo-state]');
    if(demo){event.preventDefault();handleDemoState(demo);return;}
  });
  document.addEventListener('input', function(event){
    if(event.target.matches('[data-search-input]')) filterRows(activeScreen(), event.target.value);
    if(event.target.matches('.otp-boxes input')){
      event.target.value = String(event.target.value || '').replace(/\\D/g, '').slice(-1);
      if(event.target.value) event.target.nextElementSibling?.focus();
    }
  });
  document.addEventListener('keydown', function(event){
    if(event.key === 'Escape') closeOverlay();
  });
  document.querySelector('[data-overlay-root]').addEventListener('click', function(event){
    if(event.target.matches('[data-overlay-root]')) closeOverlay();
  });
  document.querySelector('[data-back]').addEventListener('click', function(){activate(historyStack.pop() || data.firstScreenId, false);});
  window.addEventListener('hashchange', function(){activate(location.hash.slice(1), false);});
  syncFavoriteButtons();
  updateFavoritesEmpty();
  activate(location.hash.slice(1) || data.firstScreenId, false);
})();`;
}

function statusLabel(status, ui) {
  if (status === "done") return ui.done;
  if (status === "pending") return ui.pending;
  if (status === "warning") return ui.warning;
  return ui.active;
}

function prototypeFontFaces() {
  return [
    ["Manrope", "400 800", "manrope-cyrillic.woff2", "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"],
    ["Manrope", "400 800", "manrope-latin.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
    ["Manrope", "400 800", "manrope-latin-ext.woff2", "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"],
  ].map(([family, weight, fileName, unicodeRange]) => (
    `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url("${fontDataUri(fileName)}") format("woff2");unicode-range:${unicodeRange}}`
  )).join("\n");
}

function fontDataUri(fileName) {
  if (!fontCache.has(fileName)) {
    const filePath = path.join(FONT_DIR, fileName);
    fontCache.set(fileName, `data:font/woff2;base64,${fsSync.readFileSync(filePath).toString("base64")}`);
  }
  return fontCache.get(fileName);
}

function iconFor(type = "", id = "") {
  const key = String(id || "");
  if (/^(home|dashboard)$/.test(key)) return ICONS.home;
  if (key === "cart") return ICONS.shop;
  if (/(catalog|product|merchant|seller_products|favorites|compare)/.test(key)) return ICONS.shop;
  if (/(quick_create|_create$|add|qr_scanner)/.test(key)) return ICONS.plus;
  if (/(profile|client_details|user_details|team)/.test(key)) return ICONS.user;
  if (/(payment|installment|limit|wallet|cashback|contract)/.test(key)) return ICONS.wallet;
  if (/(tracking|delivery|pickup)/.test(key)) return ICONS.pin;
  if (/(analytics|report|forecast)/.test(key)) return ICONS.trend;
  if (/(settings|security|permissions|roles|integration|moderation)/.test(key)) return ICONS.settings;
  if (/(document|quote|statement)/.test(key)) return ICONS.document;
  if (/(history|activity|calendar|schedule|audit)/.test(key)) return ICONS.clock;
  if (/(search|filter)/.test(key)) return ICONS.search;
  if (/(checkout|cart|order_summary)/.test(key)) return ICONS.card;
  const byType = {
    onboarding: ICONS.bolt,
    login: ICONS.lock,
    dashboard: ICONS.grid,
    analytics: ICONS.trend,
    product_grid: ICONS.shop,
    details: ICONS.document,
    list: ICONS.list,
    form: ICONS.pencil,
    stepper: ICONS.clock,
    checkout: ICONS.card,
    payment: ICONS.wallet,
    tracking: ICONS.pin,
    history: ICONS.clock,
    profile: ICONS.user,
    settings: ICONS.settings,
    success: ICONS.check,
    empty_state: ICONS.search,
    error_state: ICONS.warning,
  };
  return byType[type] || ICONS.grid;
}

function shortLabel(value) {
  const words = String(value || "").trim().split(/\s+/);
  return words.slice(0, 2).join(" ").slice(0, 18);
}

function initials(value = "") {
  const letters = String(value || "APP").replace(/[^A-Za-zА-Яа-я0-9 ]+/g, " ").trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("");
  return (letters || "A").toUpperCase().slice(0, 2);
}

function sanitizeTheme(theme = {}) {
  const primary = hex(theme.primary, "#1A54FE");
  return {
    primary,
    secondary: hex(theme.secondary, "#0A0A0F"),
    onPrimary: contrastText(primary),
    background: hex(theme.background, "#F6F7F8"),
    surface: hex(theme.surface, "#FFFFFF"),
    success: hex(theme.success, "#13A36B"),
    warning: hex(theme.warning, "#F59E0B"),
    error: hex(theme.error, "#EF4444"),
  };
}

function contrastText(background) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(background.slice(index, index + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? "#FFFFFF" : "#111827";
}

function hex(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(text) ? text.toUpperCase() : fallback;
}

function safeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function e(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlAttr(value = "") {
  return e(value).replace(/'/g, "&#39;");
}
