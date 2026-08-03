import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutVisualization } from "./kp_diagram_layout.mjs";
import { renderVisualization } from "./kp_diagram_renderer.mjs";
import {
  assertSafeRendererText,
  escapeHtmlAttribute,
  escapeHtmlText,
  safeDomId,
} from "./kp_render_safety.mjs";
import {
  formatRendererUnit,
  localizeRendererText,
  normalizeRendererLocale,
  rendererIntlLocale,
  rendererPageBadges,
  rendererPageEyebrows,
  rendererPageTitles,
  rendererTimePrefix,
  resolveProposalRendererLocale,
} from "./kp_pdf_reference_locale.mjs";
import { canonicalizeTeamPlan } from "./kp_team_capacity.mjs";
import { buildProductDeliveryInventory } from "./kp_product_map_model.mjs";
import { ROADMAP_WORKSTREAM_PAGE_LIMIT } from "./kp_visualization_planner.mjs";

export const KP_PDF_REFERENCE_RENDERER_VERSION = "reference-driven-v5";

const FUNCTION_SCHEDULE_ROWS_PER_PAGE = 14;

const RENDERER_DIR = path.dirname(fileURLToPath(import.meta.url));
const UDEVS_BACKGROUND_DIR = path.resolve(RENDERER_DIR, "..", "assets", "kp-backgrounds");
const UDEVS_BACKGROUND_FILES = Object.freeze({
  cover: "udevs-reference-cover-background.png",
  content: "udevs-reference-content-white-background.png",
  contentSoft: "udevs-reference-content-soft-background.png",
});
const backgroundDataUriCache = new Map();
const KP_FONT_DIR = path.resolve(RENDERER_DIR, "..", "assets", "kp-fonts");
const KP_FONT_FILES = Object.freeze({
  "sora-400": "sora-400.ttf",
  "sora-600": "sora-600.ttf",
  "sora-700": "sora-700.ttf",
  "sora-800": "sora-800.ttf",
  "work-sans-400": "work-sans-400.ttf",
  "work-sans-500": "work-sans-500.ttf",
  "work-sans-600": "work-sans-600.ttf",
});
const fontDataUriCache = new Map();

function udevsBackgroundDataUri(kind) {
  if (backgroundDataUriCache.has(kind)) return backgroundDataUriCache.get(kind);
  const fileName = UDEVS_BACKGROUND_FILES[kind];
  if (!fileName) throw new Error(`Unknown Udevs background kind: ${kind}`);
  const value = `data:image/png;base64,${readFileSync(path.join(UDEVS_BACKGROUND_DIR, fileName)).toString("base64")}`;
  backgroundDataUriCache.set(kind, value);
  return value;
}

function kpFontDataUri(key) {
  if (fontDataUriCache.has(key)) return fontDataUriCache.get(key);
  const fileName = KP_FONT_FILES[key];
  if (!fileName) throw new Error(`Unknown KP font asset: ${key}`);
  const value = `data:font/ttf;base64,${readFileSync(path.join(KP_FONT_DIR, fileName)).toString("base64")}`;
  fontDataUriCache.set(key, value);
  return value;
}

function kpFontFaceRules() {
  return [
    ["Sora", 400, "sora-400"],
    ["Sora", 600, "sora-600"],
    ["Sora", 700, "sora-700"],
    ["Sora", 800, "sora-800"],
    ["Work Sans", 400, "work-sans-400"],
    ["Work Sans", 500, "work-sans-500"],
    ["Work Sans", 600, "work-sans-600"],
  ].map(([family, weight, key]) => `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;src:url("${kpFontDataUri(key)}") format("truetype")}`).join("\n");
}

const DEFAULT_TOTAL_PAGES = 21;
const LAYOUT_FAMILIES = new Set([
  "cover_asymmetric",
  "chapter_opener",
  "editorial_split",
  "value_thread",
  "evidence_story",
  "evidence_table",
  "connected_graph",
  "quadrant",
  "proportional_series",
  "capacity_matrix",
  "timeline",
  "commercial_hero",
  "decision_close",
]);
const PAGE_KINDS = Object.freeze([
  "cover",
  "opening_manifesto",
  "chapter_why_now",
  "problem",
  "market_research",
  "market_sizing",
  "analog_research",
  "launch_boundary",
  "chapter_product",
  "product_map",
  "design_project",
  "primary_flow",
  "architecture",
  "org_structure",
  "swot",
  "client_dependencies",
  "chapter_delivery",
  "function_price",
  "team",
  "roadmap",
  "project_price",
  "payments",
  "close",
]);
const PAGE_INTENTS = Object.freeze([
  "cover",
  "opening_thesis",
  "why_now",
  "problem",
  "market",
  "tam_sam_som",
  "analog_research",
  "ownership_boundary",
  "product_system",
  "product_mind_map",
  "design_project",
  "bpmn_flow",
  "architecture",
  "organization_structure",
  "swot",
  "client_dependencies",
  "delivery_logic",
  "function_price",
  "team_size",
  "roadmap",
  "project_price",
  "payment_stages",
  "close",
]);
const PAGE_COMPOSITION_BY_KIND = Object.freeze({
  cover: "split",
  opening_manifesto: "dark",
  chapter_why_now: "dark",
  chapter_product: "dark",
  architecture: "dark",
  chapter_delivery: "dark",
  close: "dark",
});
const PAGE_EYEBROWS = Object.freeze([
  "COMMERCIAL PROPOSAL",
  "DECISION SUMMARY",
  "WHY NOW",
  "PROBLEM",
  "MARKET EVIDENCE",
  "MARKET SIZING",
  "ANALOG RESEARCH",
  "LAUNCH BOUNDARY",
  "PRODUCT SYSTEM",
  "PRODUCT MAP",
  "DESIGN DIRECTION",
  "PRIMARY FLOW",
  "ARCHITECTURE",
  "ORGANIZATION STRUCTURE",
  "SWOT",
  "CLIENT DEPENDENCIES",
  "DELIVERY LOGIC",
  "FUNCTION ALLOCATION",
  "TEAM CAPACITY",
  "DEVELOPMENT STAGES",
  "PROJECT PRICE",
  "PAYMENT SCHEDULE",
  "DECISION CLOSE",
]);
const DEFAULT_PAGE_TITLES = Object.freeze([
  "Commercial proposal",
  "Four decisions turn the brief into a launch plan.",
  "Why this decision matters now.",
  "Where value breaks at the handoffs.",
  "Evidence before expansion.",
  "Market sizing logic and assumptions.",
  "What to learn, not copy.",
  "Own the control state. Integrate the rails.",
  "The product becomes one operating system.",
  "One accountable product core.",
  "A visual system with an approval path.",
  "The primary journey must be explicit.",
  "A trusted core with visible partner boundaries.",
  "Organization structure.",
  "Strategic advantages, constraints, and responses.",
  "Client inputs that unlock delivery.",
  "Delivery is a sequence of accepted outcomes.",
  "Function allocation reconciled to the commercial baseline.",
  "Capacity matched to the delivery window.",
  "Time spans, dependencies, and acceptance gates.",
  "One project price with explicit boundaries.",
  "Payments tied to accepted outcomes.",
  "Decisions, owners, and the next action.",
]);
const PRIVATE_TEXT_PATTERN = /(?:file|telegram|data):\/\/|(?:^|\s)(?:\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\)|\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b|\bSRC-[A-Za-z0-9._-]+\b/i;
const BIDI_OVERRIDE_PATTERN = /[\u202A-\u202E\u2066-\u2069]/;
const FORBIDDEN_OUTPUT_PATTERN = /\b(?:lorem ipsum|placeholder|brandbook-ready|internal note|todo|tbd)\b|\bvalidated\s+[a-z0-9 _-]+\s+page\b/i;
const CURRENCY_PRICE_PATTERN = /(?:\b[A-Z]{3}\b|US\$|\$)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/i;
const FONT_BY_CLASS = Object.freeze({
  neo_grotesk_sans: "Arial, Helvetica, sans-serif",
  humanist_sans: "Trebuchet MS, Arial, sans-serif",
  geometric_sans: "Avenir Next, Arial, sans-serif",
  transitional_serif: "Georgia, Times New Roman, serif",
  display_serif: "Georgia, Times New Roman, serif",
  monospace: "SFMono-Regular, Menlo, Consolas, monospace",
  mixed: "Arial, Helvetica, sans-serif",
  unknown: "Arial, Helvetica, sans-serif",
});

export function resolveStyleTokens(styleProfile = {}) {
  const canvas = styleProfile.canvas || {};
  const accents = styleProfile.accents || {};
  const typography = styleProfile.typography || {};
  const displayFallback = resolveFontStack(typography.displayClass || typography.displayFontToken);
  const bodyFallback = resolveFontStack(typography.bodyClass || typography.bodyFontToken || "humanist_sans");
  const metadataFallback = resolveFontStack(typography.metadataClass || typography.metadataFontToken || "monospace");
  const decorativePrimary = strictColor(accents.decorativePrimary, accents.primary || "#0052FF", "/accents/decorativePrimary");
  const decorativeSecondary = strictColor(accents.decorativeSecondary, accents.secondary || canvas.textPrimary || "#0D1117", "/accents/decorativeSecondary");
  const backgroundStyle = styleProfile.layout?.backgroundStyle === "udevs_screenshot"
    ? "udevs_screenshot"
    : "dynamic_brand";
  const lightPalette = resolveLightPagePalette({
    canvas,
    primary: decorativePrimary,
    secondary: decorativeSecondary,
    preferSecondaryText: backgroundStyle === "udevs_screenshot",
  });
  const darkPalette = resolveDarkPagePalette({
    primary: decorativePrimary,
    secondary: decorativeSecondary,
  });
  const splitPalette = Object.freeze({ ...darkPalette });
  return Object.freeze({
    ...lightPalette,
    decorativePrimary,
    decorativeSecondary,
    decorativeTertiary: decorativeSecondary,
    backgroundStyle,
    compositions: Object.freeze({
      light: Object.freeze(lightPalette),
      dark: Object.freeze(darkPalette),
      split: splitPalette,
    }),
    displayStack: safeCssFontStack(typography.displayStack, displayFallback),
    bodyStack: safeCssFontStack(typography.bodyStack, bodyFallback),
    metadataStack: safeCssFontStack(typography.metadataStack, metadataFallback),
    // Reference URLs provide brand expression, not component geometry.
    // These values stay renderer-owned even if an external profile contains
    // padding/radius fields.
    pagePaddingX: 64,
    pagePaddingTop: 46,
    pagePaddingBottom: 34,
    radiusSm: 8,
    radiusMd: 12,
    radiusLg: 18,
  });
}

function resolveLightPagePalette({ canvas = {}, primary, secondary, preferSecondaryText = false }) {
  const requestedBackground = strictColor(canvas.background, "#FFFFFF", "/canvas/background");
  const background = relativeLuminanceHex(requestedBackground) >= 0.72 ? requestedBackground : "#FFFFFF";
  const requestedText = strictColor(canvas.textPrimary, "#171717", "/canvas/textPrimary");
  const text = firstExactContrastColor(
    preferSecondaryText
      ? [secondary, requestedText, "#07080D", primary, "#000000"]
      : [primary, secondary, requestedText, "#171717", "#000000"],
    [background],
    4.75,
  );
  const requestedSurface = strictColor(canvas.surface1, mixHex(background, primary, 0.035), "/canvas/surface1");
  const requestedSurface2 = strictColor(canvas.surface2, mixHex(background, primary, 0.07), "/canvas/surface2");
  const surface = ensureSurfaceContrast(
    relativeLuminanceHex(requestedSurface) >= 0.62 ? requestedSurface : mixHex(background, primary, 0.035),
    text,
    background,
    4.75,
  );
  const surface2 = ensureSurfaceContrast(
    relativeLuminanceHex(requestedSurface2) >= 0.58 ? requestedSurface2 : mixHex(background, primary, 0.07),
    text,
    background,
    4.75,
  );
  const textBackgrounds = [background, surface, surface2];
  const mutedCandidate = strictColor(canvas.textSecondary, mixHex(text, background, 0.28), "/canvas/textSecondary");
  const requestedRule = strictColor(canvas.rule, mixHex(background, text, 0.14), "/canvas/rule");
  const rule = contrastRatioHex(requestedRule, background) >= 1.18
    ? requestedRule
    : mixHex(background, text, 0.16);
  return semanticPalette({
    background,
    surface,
    surface2,
    text,
    muted: ensureTextContrast(mutedCandidate, textBackgrounds, text, 4.5),
    rule,
    element: primary,
    secondaryText: text,
  });
}

function resolveDarkPagePalette({ primary, secondary }) {
  const darkChoice = chooseDarkBackground(primary, secondary);
  const background = darkChoice.background;
  const element = darkChoice.source === "primary" ? secondary : primary;
  const text = firstExactContrastColor(["#FFFFFF", secondary, primary, "#000000"], [background], 4.75);
  const surface = ensureSurfaceContrast(mixHex(background, text, 0.055), text, background, 4.75);
  const surface2 = ensureSurfaceContrast(mixHex(background, text, 0.095), text, background, 4.75);
  const textBackgrounds = [background, surface, surface2];
  const secondaryText = textBackgrounds.every((color) => contrastRatioHex(element, color) >= 4.5)
    ? element
    : text;
  return semanticPalette({
    background,
    surface,
    surface2,
    text,
    muted: ensureTextContrast(mixHex(text, background, 0.28), textBackgrounds, text, 4.5),
    rule: mixHex(background, text, 0.2),
    element,
    secondaryText,
  });
}

function semanticPalette({
  background,
  surface,
  surface2,
  text,
  muted,
  rule,
  element,
  secondaryText,
}) {
  const elementSoft = mixHex(background, element, 0.12);
  const textOnAccent = firstExactContrastColor([text, "#000000", "#FFFFFF"], [element], 4.5);
  const textOnAccentSoft = firstExactContrastColor([text, "#000000", "#FFFFFF"], [elementSoft], 4.5);
  return {
    background,
    surface,
    surface2,
    text,
    textOnAccent,
    textOnAccentSoft,
    muted,
    rule,
    primary: element,
    brandDeep: text,
    secondary: secondaryText,
    warning: text,
    critical: text,
    positive: text,
  };
}

function chooseDarkBackground(primary, secondary) {
  const candidates = [
    { color: secondary, source: "secondary", priority: 0 },
    { color: primary, source: "primary", priority: 1 },
  ].map((candidate) => ({
    ...candidate,
    luminance: relativeLuminanceHex(candidate.color),
    whiteContrast: contrastRatioHex(candidate.color, "#FFFFFF"),
  }));
  const exact = candidates
    .filter((candidate) => candidate.whiteContrast >= 4.75)
    .sort((left, right) => left.priority - right.priority || left.luminance - right.luminance)[0];
  if (exact) return { background: exact.color, source: exact.source };

  const base = candidates.sort((left, right) => left.luminance - right.luminance || left.priority - right.priority)[0];
  for (let step = 1; step <= 18; step += 1) {
    const candidate = mixHex(base.color, "#000000", step / 20);
    if (contrastRatioHex(candidate, "#FFFFFF") >= 4.75) {
      return { background: candidate, source: base.source };
    }
  }
  return { background: "#171717", source: "neutral" };
}

function firstExactContrastColor(candidates, backgrounds, minimum = 4.75) {
  const surfaces = array(backgrounds).map((color) => strictColor(color, "#FFFFFF", "internal"));
  for (const value of candidates) {
    const candidate = strictColor(value, "#000000", "internal");
    if (surfaces.every((background) => contrastRatioHex(candidate, background) >= minimum)) return candidate;
  }
  return ensureTextContrast(candidates[0], surfaces, candidates.at(-1) || "#000000", minimum);
}

function ensureSurfaceContrast(surfaceColor, textColor, fallbackBackground, minimum = 4.6) {
  const surface = strictColor(surfaceColor, "#FFFFFF", "internal");
  const text = strictColor(textColor, "#000000", "internal");
  const fallback = strictColor(fallbackBackground, "#FFFFFF", "internal");
  if (contrastRatioHex(text, surface) >= minimum) return surface;
  for (let step = 1; step <= 10; step += 1) {
    const candidate = mixHex(surface, fallback, step / 10);
    if (contrastRatioHex(text, candidate) >= minimum) return candidate;
  }
  return fallback;
}

function pageCompositionForKind(pageKind = "", tokens = null) {
  if (tokens?.backgroundStyle === "udevs_screenshot") return "light";
  return PAGE_COMPOSITION_BY_KIND[String(pageKind || "")] || "light";
}

function pageStyleTokens(tokens, pageKind) {
  const composition = pageCompositionForKind(pageKind, tokens);
  const palette = tokens?.compositions?.[composition] || tokens;
  return {
    ...tokens,
    ...palette,
    decorativePrimary: palette.background,
    decorativeSecondary: palette.primary,
    decorativeTertiary: palette.primary,
  };
}

export function buildReferenceDrivenProposalHtml(input = {}) {
  const normalized = normalizeRendererInput(input);
  validatePlan(normalized.presentationPlan);
  const totalPages = normalized.presentationPlan.pageCount;
  const tokens = resolveStyleTokens(normalized.visualStyleProfile);
  const content = buildContentContext(normalized, tokens);
  assertRendererLocaleCoherence(content, normalized.visualizationSpecs);
  const safeStyleProfile = safeDiagramStyleProfile(normalized.visualStyleProfile, tokens);
  const dynamicRules = [];
  const specByPage = indexVisualizationSpecs(normalized.visualizationSpecs, normalized.presentationPlan);
  assertFunctionSchedulePlanCoverage(normalized.presentationPlan, content);
  const pages = normalized.presentationPlan.pages.map((pagePlan) => renderPageFromPlan(pagePlan, {
    ...normalized,
    tokens,
    content,
    safeStyleProfile,
    dynamicRules,
    totalPages,
    visualizationSpec: specByPage.get(pagePlan.pageNumber) || null,
  }));
  if (pages.length !== totalPages) {
    throw rendererError("DOM_PAGE_COUNT_MISMATCH", "The renderer did not create the planned page count");
  }
  const nonce = crypto.randomBytes(24).toString("base64");
  const csp = [
    "default-src 'none'",
    "img-src data: blob:",
    "font-src data:",
    "style-src 'nonce-" + nonce + "'",
    "script-src 'nonce-" + nonce + "'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const styles = referenceDrivenStyles(normalized.visualStyleProfile, dynamicRules);
  const readinessScript = renderReadinessScript();
  const description = l(content, "Commercial proposal prepared for client review.");
  const html = [
    "<!doctype html>",
    '<html lang="' + escapeHtmlAttribute(content.locale) + '">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="author" content="Udevs">',
    '<meta name="description" content="' + escapeHtmlAttribute(description) + '">',
    "<title>" + e(content.projectTitle) + "</title>",
    '<meta http-equiv="Content-Security-Policy" content="' + escapeHtmlAttribute(csp) + '">',
    '<style nonce="' + escapeHtmlAttribute(nonce) + '">' + styles + "</style>",
    "</head>",
    "<body>",
    '<main class="proposal" data-renderer-version="' + KP_PDF_REFERENCE_RENDERER_VERSION + '">',
    pages.join("\n"),
    "</main>",
    '<script nonce="' + escapeHtmlAttribute(nonce) + '">' + readinessScript + "</script>",
    "</body>",
    "</html>",
  ].join("");
  if (FORBIDDEN_OUTPUT_PATTERN.test(extractVisibleText(html))) {
    throw rendererError("CONTENT_RENDER_PLACEHOLDER_FORBIDDEN", "The rendered proposal contains forbidden placeholder copy");
  }
  return html;
}

function assertFunctionSchedulePlanCoverage(presentationPlan, content) {
  const pages = array(presentationPlan?.pages).filter((page) => page.kind === "function_price");
  if (!pages.length) return;
  const rowCount = array(content.functionSchedule).length || array(content.functionPrice).length;
  const expectedPageCount = Math.max(1, Math.ceil(rowCount / FUNCTION_SCHEDULE_ROWS_PER_PAGE));
  const validSegments = pages.length === expectedPageCount && pages.every((page, index) => (
    Number(page.segmentIndex || 1) === index + 1
    && Number(page.segmentCount || 1) === expectedPageCount
  ));
  if (!validSegments) {
    throw rendererError(
      "CONTENT_FUNCTION_PRICE_SEGMENT_INVALID",
      `Function-schedule pages do not cover ${rowCount} canonical product-map terminal rows`,
    );
  }
}

export function renderPageFromPlan(pagePlan, inputs = {}) {
  validatePagePlan(pagePlan, inputs.presentationPlan?.pageCount || DEFAULT_TOTAL_PAGES);
  const pageNumber = pagePlan.pageNumber;
  const totalPages = Number(inputs.totalPages || inputs.presentationPlan?.pageCount || DEFAULT_TOTAL_PAGES);
  const content = inputs.content || buildContentContext(normalizeRendererInput(inputs), inputs.tokens || resolveStyleTokens(inputs.visualStyleProfile || {}));
  const baseTokens = inputs.tokens || resolveStyleTokens(inputs.visualStyleProfile || {});
  const composition = pageCompositionForKind(pagePlan.kind, baseTokens);
  const tokens = pageStyleTokens(baseTokens, pagePlan.kind);
  const dynamicRules = inputs.dynamicRules || [];
  const visualizationSpec = inputs.visualizationSpec || findVisualizationSpec(inputs.visualizationSpecs, pageNumber);
  const isVisualizationPage = Boolean(pagePlan.visualizationSpecId || pagePlan.visualizationId);
  if (isVisualizationPage && !visualizationSpec) {
    throw rendererError("CONTRACT_VISUALIZATION_SPEC_INVALID", "Missing VisualizationSpec for page " + pageNumber);
  }
  if (!isVisualizationPage && visualizationSpec) {
    throw rendererError("CONTRACT_VISUALIZATION_SPEC_INVALID", "Unexpected VisualizationSpec for page " + pageNumber);
  }
  if (visualizationSpec && visualizationSpec.pageNumber !== pageNumber) {
    throw rendererError("CONTRACT_VISUALIZATION_SPEC_INVALID", "VisualizationSpec page does not match PresentationPlan");
  }
  const plannedSpecId = pagePlan.visualizationSpecId || pagePlan.visualizationId || null;
  const actualSpecId = visualizationSpec ? (visualizationSpec.visualizationSpecId || visualizationSpec.id) : null;
  if (plannedSpecId && actualSpecId !== plannedSpecId) {
    throw rendererError("CONTRACT_VISUALIZATION_SPEC_INVALID", "VisualizationSpec identity does not match PresentationPlan");
  }

  const title = resolvePageTitle(pagePlan, content, visualizationSpec);
  const badge = resolvePageBadge(pagePlan, content, visualizationSpec);
  const body = isVisualizationPage
    ? renderSemanticPage(visualizationSpec, pagePlan, safeDiagramStyleProfile(inputs.visualStyleProfile || {}, tokens), dynamicRules, content)
    : renderContentPage(pagePlan, content, tokens, dynamicRules);
  const family = strictLayoutFamily(pagePlan.layoutFamily);
  const storyIndex = pageKindIndex(pagePlan.kind);
  const intentClass = safeDomId(pagePlan.intent || pagePlan.kind || PAGE_INTENTS[storyIndex]);
  const explicitlyRequested = array(pagePlan.selectionReasons).includes("explicitly_requested_in_prompt");
  const pageEyebrow = rendererPageEyebrows(content.locale)[storyIndex];
  const pageKickerHtml = pagePlan.kind === "cover"
    ? '<span class="cover-title-kicker">' + e(l(content, "DECISION DOCUMENT")) + "</span>"
    : '<span class="page-kicker">' + e(pageEyebrow) + "</span>";
  const coverTitleClass = pagePlan.kind === "cover"
    ? title.length > 112
      ? " cover-title-extra-long"
      : title.length > 72
        ? " cover-title-long"
        : title.length > 42
        ? " cover-title-medium"
        : " cover-title-short"
    : "";
  const backgroundClass = baseTokens.backgroundStyle === "udevs_screenshot" ? " background-udevs-screenshot" : "";
  const titleMarkup = pagePlan.kind === "cover"
    ? '<span class="cover-title-prefix">' + e(l(content, "Commercial proposal")) + ' — </span><span class="cover-title-project">' + renderTitleMarkup(title) + "</span>"
    : renderTitleMarkup(title);
  const pageSummary = referencePageSummary(pagePlan, content);
  const pageSummaryMarkup = pageSummary ? '<p class="page-summary">' + e(pageSummary) + "</p>" : "";
  const footerHtml = inputs.prototypeUrl
    ? '<div class="page-footer"><span>' + e(content.projectTitle) + '</span><a class="prototype-link" href="' + escapeHtmlAttribute(inputs.prototypeUrl) + '" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">☎</span>' + e(prototypeLinkLabel(content.locale)) + '</a><strong>' + padPage(pageNumber) + "</strong></div>"
    : '<div class="page-footer"><span>' + e(content.projectTitle) + '</span><strong>' + padPage(pageNumber) + "</strong></div>";
  const pageHtml = [
    '<section class="page kp-page composition-' + composition + backgroundClass + " layout-" + family + " intent-" + intentClass + '" data-page-number="' + pageNumber + '" data-page-kind="' + escapeHtmlAttribute(pagePlan.kind) + '" data-page-composition="' + composition + '" data-explicitly-requested="' + String(explicitlyRequested) + '" data-layout-family="' + family + '">',
    '<header class="page-header"><span>' + e(content.projectTitle) + '</span><strong>' + padPage(pageNumber) + " / " + totalPages + "</strong></header>",
    '<div class="page-title-row"><div>' + pageKickerHtml + '<h1 class="page-title' + coverTitleClass + '">' + titleMarkup + "</h1>" + pageSummaryMarkup + '</div><span class="page-badge">' + e(badge) + "</span></div>",
    '<div class="page-body">' + body + "</div>",
    footerHtml,
    "</section>",
  ].join("");
  assertRenderedPageContent(pagePlan, pageHtml, {
    content,
    visualizationSpec,
    pageTitle: title,
  });
  return pageHtml;
}

export function assertRenderedPageContent(pagePlan, pageHtml, { content = {}, visualizationSpec = null, pageTitle = "" } = {}) {
  const pageNumber = Number(pagePlan?.pageNumber || 0);
  const pageKind = String(pagePlan?.kind || "");
  const isVisualizationPage = Boolean(pagePlan?.visualizationSpecId || pagePlan?.visualizationId);
  const visible = extractVisibleText(pageHtml);
  if (FORBIDDEN_OUTPUT_PATTERN.test(visible)) {
    throw rendererError("CONTENT_RENDER_PLACEHOLDER_FORBIDDEN", "Page " + pageNumber + " contains placeholder copy");
  }
  if (visible.length < (isVisualizationPage ? 70 : 140)) {
    throw rendererError("CONTENT_PAGE_REQUIRED_PAYLOAD_MISSING", "Page " + pageNumber + " does not contain enough client-visible content");
  }
  if (!pageTitle || !visible.includes(normalizeVisible(pageTitle))) {
    throw rendererError("CONTENT_PAGE_TITLE_MISSING", "Page " + pageNumber + " does not contain its required title");
  }
  if (isVisualizationPage) {
    if (!visualizationSpec || !/class="viz-canvas/.test(pageHtml)) {
      throw rendererError("CONTENT_PAGE_REQUIRED_PAYLOAD_MISSING", "Page " + pageNumber + " is missing its semantic visualization");
    }
  }
  if (visualizationSpec?.kind === "nested_market") {
    const levelCount = (level) => (pageHtml.match(new RegExp('data-market-level="' + level + '"', "g")) || []).length;
    const methodologyCount = (pageHtml.match(/data-market-methodology="true"/g) || []).length;
    const disclosureCount = (pageHtml.match(/data-market-scenario-disclosure="true"/g) || []).length;
    if (!/class="market-sizing-layout(?:\s|")/.test(pageHtml)
      || !/class="viz-canvas market-sizing-funnel/.test(pageHtml)
      || ["tam", "sam", "som"].some((level) => levelCount(level) !== 1)
      || methodologyCount !== 1
      || disclosureCount !== 1
      || /class="sizing-worksheet/.test(pageHtml)) {
      throw rendererError("CONTENT_MARKET_SIZING_STRUCTURE_INVALID", "The TAM/SAM/SOM page requires one three-level model, one methodology block, and one transparent disclosure");
    }
    const pending = visualizationSpec.variant === "formula_pending" || visualizationSpec.dataState === "pending";
    if (pending) {
      const formulaNodeCount = (pageHtml.match(/data-node-id="FORMULA-(?:TAM|SAM|SOM)"/g) || []).length;
      const missingDisclosureCount = (pageHtml.match(/data-market-missing-inputs="true"/g) || []).length;
      if (formulaNodeCount !== 3 || missingDisclosureCount !== 1 || /data-market-value=/.test(pageHtml)) {
        throw rendererError("CONTENT_MARKET_SIZING_PENDING_INVALID", "Pending market sizing must show three formulas and one missing-input disclosure without invented values");
      }
    } else {
      const tam = array(visualizationSpec.nodes).find((node) => node.id === "MARKET-TAM");
      const sam = array(visualizationSpec.nodes).find((node) => node.id === "MARKET-SAM");
      const scenarios = array(visualizationSpec.nodes).filter((node) => String(node.id || "").startsWith("MARKET-SOM-"));
      const scenarioCount = (pageHtml.match(/class="market-scenario(?:\s|")/g) || []).length;
      if (!tam?.metric || !sam?.metric || !scenarios.length || scenarioCount !== scenarios.length || scenarioCount > 3) {
        throw rendererError("CONTENT_MARKET_SIZING_NUMERIC_INVALID", "Numeric market sizing requires TAM, SAM, and one to three SOM scenarios");
      }
      for (const node of [tam, sam, ...scenarios]) {
        if (!visible.includes(normalizeVisible(formatMarketValue(node.metric, content)))) {
          throw rendererError("CONTENT_MARKET_SIZING_NUMERIC_INVALID", "A market metric was omitted from the rendered page");
        }
      }
    }
  }
  const visibleWithoutCoverBudget = pageKind === "cover"
    ? extractVisibleText(pageHtml.replace(/<div class="metric cover-budget"[\s\S]*?<\/div>/i, ""))
    : visible;
  if (pageNumber === 1 && CURRENCY_PRICE_PATTERN.test(visibleWithoutCoverBudget)) {
    throw rendererError("PDF_COVER_PRICE_FORBIDDEN", "The cover must not display a project price");
  }
  if (content.hasProjectPrice && !["function_price", "project_price", "payments", "close"].includes(pageKind)) {
    const lockedPrice = normalizeVisible(formatMinor(content.projectPriceMinor, content.currency, content.currencyExponent, content));
    if (visibleWithoutCoverBudget.includes(lockedPrice)) {
      throw rendererError("CONTENT_PROJECT_PRICE_EARLY", "The locked project total is visible before the commercial section");
    }
  }
  if (pageKind === "function_price") {
    const rows = functionScheduleRowsForPage(content, pagePlan);
    const renderedRowCount = (pageHtml.match(/class="function-price-row"/g) || []).length;
    const renderedHeaderCount = (pageHtml.match(/class="function-price-head"/g) || []).length;
    const uniqueIds = new Set(rows.map((row) => row.id));
    if (!rows.length) {
      if (!/class="missing-state panel-soft"/.test(pageHtml)
        || /class="function-price-table|class="function-price-head|class="function-price-row/.test(pageHtml)
        || /class="function-price-total|class="scenario-banner/.test(pageHtml)) {
        throw rendererError("CONTENT_FUNCTION_PRICE_STRUCTURE_INVALID", "An unavailable function schedule requires one honest missing state without pricing UI");
      }
    } else {
    if (renderedRowCount !== rows.length || renderedHeaderCount !== 1 || uniqueIds.size !== rows.length || /class="allocation-bar|class="function-price-total|class="scenario-banner/.test(pageHtml)) {
      throw rendererError("CONTENT_FUNCTION_PRICE_STRUCTURE_INVALID", "The function schedule requires one five-column table row per product-map terminal block and no pricing summary");
    }
    if (!rows.every((row) => visible.includes(normalizeVisible(row.name)) && visible.includes(normalizeVisible(row.deadline)))) {
      throw rendererError("CONTENT_FUNCTION_PRICE_MISSING", "The function schedule omitted a product-map block label or delivery window");
    }
    const structuralCellCounts = ["function-price-index", "function-price-epic", "function-price-task", "function-price-subtask", "function-price-deadline"]
      .map((className) => (pageHtml.match(new RegExp('class="' + className + '(?:\\s|\")', "g")) || []).length);
    if (structuralCellCounts.some((count) => count !== rows.length)) {
      throw rendererError("CONTENT_FUNCTION_PRICE_STRUCTURE_INVALID", "Every function schedule row requires index, epic, task, subtask, and delivery window");
    }
    }
  }
  if (pageKind === "team") {
    const allocatedRoles = content.team?.roles || [];
    const hasBreakdown = allocatedRoles.some((row) => row.peakFte !== null || row.fteMonths !== null);
    if (hasBreakdown && allocatedRoles.some((row) => row.peakFte === null || row.fteMonths === null)) {
      throw rendererError("CONTENT_TEAM_CAPACITY_MISMATCH", "Page 17 contains a partial role-capacity breakdown");
    }
    const capacityPlan = teamCapacityPlan(content);
    if (hasBreakdown && !capacityPlan) {
      throw rendererError("CONTENT_TEAM_CAPACITY_MISMATCH", "The Team Size page requires a complete time-phased capacity plan");
    }
    if (capacityPlan) {
      const costPlan = teamCostPlan(content, capacityPlan);
      const renderedMetrics = (pageHtml.match(/data-team-metric="(?:people|roles|duration|budget_total)"/g) || []).length;
      const renderedRows = (pageHtml.match(/data-geometry-role="team_role_row"/g) || []).length;
      const renderedQuantityCells = (pageHtml.match(/data-geometry-role="team_quantity"/g) || []).length;
      const renderedDurationCells = (pageHtml.match(/data-geometry-role="team_duration"/g) || []).length;
      const renderedRateCells = (pageHtml.match(/data-geometry-role="team_rate"/g) || []).length;
      const renderedAmountCells = (pageHtml.match(/data-geometry-role="team_amount"/g) || []).length;
      const renderedScenarioWarnings = (pageHtml.match(/data-warning-status="scenario"/g) || []).length;
      const headerCells = (pageHtml.match(/class="team-capacity-head"[^>]*>(?:<span>[^<]*<\/span>){5}<\/div>/g) || []).length;
      if (renderedMetrics !== 4 || renderedRows !== capacityPlan.rows.length || renderedQuantityCells !== capacityPlan.rows.length
        || renderedDurationCells !== capacityPlan.rows.length || renderedRateCells !== capacityPlan.rows.length
        || renderedAmountCells !== capacityPlan.rows.length || renderedScenarioWarnings !== 1 || headerCells !== 1) {
        throw rendererError("CONTENT_TEAM_CAPACITY_STRUCTURE_INVALID", "The Team Size page requires four summary metrics and one employee, quantity, months, monthly-rate, and amount cell per role");
      }
      const rowMonths = capacityPlan.rows.flatMap((row) => row.months);
      const rowCapacityValid = capacityPlan.rows.every((row) => nearlyEqual(row.months.reduce((sum, value) => sum + value, 0), row.fteMonths)
        && nearlyEqual(Math.max(...row.months), row.peakFte)
        && row.months.every((value) => value >= 0));
      const monthlyTotal = capacityPlan.monthlyTotals.reduce((sum, value) => sum + value, 0);
      const expectedTotal = nullableNumber(content.team.fteMonths) ?? capacityPlan.rows.reduce((sum, row) => sum + row.fteMonths, 0);
      if (!rowCapacityValid || !nearlyEqual(rowMonths.reduce((sum, value) => sum + value, 0), monthlyTotal) || !nearlyEqual(monthlyTotal, expectedTotal)
        || !nearlyEqual(Math.max(...capacityPlan.monthlyTotals), content.team.peakFte)) {
        throw rendererError("CONTENT_TEAM_CAPACITY_RECONCILIATION_INVALID", "The Team Size rows must reconcile role quantities, active months, FTE-months, and aggregate capacity");
      }
      const allocatedMinor = costPlan.rows.reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
      if (costPlan.totalMinor !== null && allocatedMinor !== costPlan.totalMinor) {
        throw rendererError("CONTENT_TEAM_COST_RECONCILIATION_INVALID", "Team role amounts must reconcile exactly to the displayed project or budget total");
      }
    }
  }
  if (pageKind === "org_structure") {
    const rootCount = (pageHtml.match(/class="org-node org-root"/g) || []).length;
    if (/class="org-chart org-chart-people/.test(pageHtml)) {
      const managerCount = (pageHtml.match(/class="org-node org-manager-node"/g) || []).length;
      const personCount = (pageHtml.match(/class="org-person"(?:\s|>)/g) || []).length;
      const personConnectorCount = (pageHtml.match(/class="org-connector org-person-connector"/g) || []).length;
      if (rootCount !== 1 || managerCount !== 1 || personCount < 2 || personCount > 8 || personConnectorCount !== personCount) {
        throw rendererError("CONTENT_ORG_STRUCTURE_INVALID", "The delivery people chain requires one root, one manager, bounded role cards, and explicit connectors");
      }
    } else {
      const branchCount = (pageHtml.match(/class="org-branch"/g) || []).length;
      const childCount = (pageHtml.match(/class="org-child"/g) || []).length;
      const branchConnectorCount = (pageHtml.match(/class="org-connector org-branch-connector"/g) || []).length;
      const childConnectorCount = (pageHtml.match(/class="org-connector org-child-connector"/g) || []).length;
      if (rootCount !== 1 || branchCount !== 3 || childCount < 3 || branchConnectorCount !== branchCount || childConnectorCount !== childCount) {
        throw rendererError("CONTENT_ORG_STRUCTURE_INVALID", "The organization page requires one root, three branches, visible leaves, and explicit connectors");
      }
    }
  }
  if (pageKind === "client_dependencies") {
    const rows = array(content.clientDependencies);
    const renderedRowCount = (pageHtml.match(/class="client-dependency-row"/g) || []).length;
    const renderedStatusCount = (pageHtml.match(/class="client-dependency-checkbox/g) || []).length;
    const renderedGroupCount = (pageHtml.match(/class="client-dependency-group"/g) || []).length;
    const unsupportedRows = rows.filter((row) => !row.sourceIds?.length && !row.derivationRuleId);
    if (!rows.length) {
      if (!/class="client-dependencies-empty panel"/.test(pageHtml)
        || /class="client-dependencies-table|class="client-dependency-row|class="client-dependency-checkbox/.test(pageHtml)) {
        throw rendererError("CONTENT_CLIENT_DEPENDENCIES_INVALID", "Unavailable client dependencies require one honest empty state without invented rows");
      }
    } else if (rows.length < 3 || rows.length > 8 || renderedRowCount !== rows.length || renderedStatusCount !== rows.length || renderedGroupCount < 2) {
      throw rendererError("CONTENT_CLIENT_DEPENDENCIES_INVALID", "The client-dependencies page requires a bounded grouped dependency/status table");
    }
    if (unsupportedRows.length) {
      throw rendererError("CONTENT_CLIENT_DEPENDENCIES_UNGROUNDED", "Every client dependency requires source provenance or a transparent derivation rule");
    }
    if ((rows.length && (!visible.includes(l(content, "Dependency")) || !visible.includes(l(content, "Ready")))) || /\bNot done\b|Не\s+сделано|Bajarilmagan/iu.test(visible)) {
      throw rendererError("CONTENT_CLIENT_DEPENDENCIES_STATUS_INVALID", "Client-dependency statuses must be explicit without inventing a blanket not-done state");
    }
  }
  if (pageKind === "product_map" && visualizationSpec?.variant !== "pending") {
    const rootCount = (pageHtml.match(/data-node-type="core"/g) || []).length;
    const domainCount = (pageHtml.match(/data-node-type="domain"/g) || []).length;
    const capabilityCount = (pageHtml.match(/data-node-type="capability"/g) || []).length;
    const subfunctionCount = (pageHtml.match(/data-node-type="subfunction"/g) || []).length;
    const expectedSubfunctions = (visualizationSpec.nodes || []).filter((node) => node.type === "subfunction").length;
    const connectorCount = (pageHtml.match(/data-geometry-role="edge"/g) || []).length;
    if (visualizationSpec.variant !== "left_to_right_tree" || rootCount !== 1 || domainCount < 1 || capabilityCount < 1
      || subfunctionCount !== expectedSubfunctions || connectorCount !== Math.max(0, (visualizationSpec.nodes || []).length - 1)) {
      throw rendererError("CONTENT_PRODUCT_MAP_INVALID", "The mind-map page requires one left-hand root and a connected direction/function/subfunction hierarchy");
    }
  }
  if (pageKind === "roadmap" && visualizationSpec?.variant === "gantt") {
    const scale = visualizationSpec.timeScale;
    const firstTick = scale ? timeAxisTickLabel(scale.unit, scale.start, content.locale) : "";
    const lastTick = scale ? timeAxisTickLabel(scale.unit, scale.end, content.locale) : "";
    const expectedPhases = array(visualizationSpec.nodes).filter((node) => node.type === "phase").length;
    const expectedWorkstreams = array(visualizationSpec.nodes).filter((node) => node.type === "task").length;
    const phaseBands = (pageHtml.match(/class="roadmap-phase-band(?:\s|")/g) || []).length;
    const workstreamRows = (pageHtml.match(/class="roadmap-workstream-row(?:\s|")/g) || []).length;
    const workstreamBars = (pageHtml.match(/class="roadmap-workstream-bar(?:\s|")/g) || []).length;
    const gateLines = (pageHtml.match(/class="roadmap-gate-line(?:\s|")/g) || []).length;
    const gateCards = (pageHtml.match(/class="roadmap-gate-card(?:\s|")/g) || []).length;
    if (!/class="viz-gantt-axis roadmap-week-track"/.test(pageHtml) || !visible.includes(firstTick) || !visible.includes(lastTick)) {
      throw rendererError("CONTENT_ROADMAP_SCALE_MISSING", "Page 18 is missing its visible Gantt time scale");
    }
    if (!/class="viz-canvas viz-roadmap roadmap-stage-chart"/.test(pageHtml)
      || phaseBands !== expectedPhases
      || workstreamRows !== expectedWorkstreams
      || workstreamBars !== expectedWorkstreams
      || gateLines !== expectedPhases
      || gateCards !== expectedPhases
      || /<svg\b/i.test(pageHtml)
      || /class="viz-gantt-label(?:\s|")/.test(pageHtml)) {
      throw rendererError("CONTENT_ROADMAP_STRUCTURE_INVALID", "The Development Stages page requires stage bands, one row per segmented product-map block, and one planning gate per stage");
    }
    const expectedWorkstreamIds = array(visualizationSpec.nodes).filter((node) => node.type === "task").map((node) => String(node.id));
    if (!expectedWorkstreamIds.every((id) => pageHtml.includes('data-node-id="' + escapeHtmlAttribute(id) + '"'))) {
      throw rendererError("CONTENT_ROADMAP_SCOPE_COVERAGE_MISMATCH", "The Development Stages page omitted a product-map workstream");
    }
    if (!/data-warning-status="scenario"/.test(pageHtml)) {
      throw rendererError("CONTENT_ROADMAP_TRUTH_STATUS_INVALID", "Modeled roadmap workstreams and gates require one visible planning-scenario disclosure");
    }
  }
  if (pageKind === "project_price") {
    if (content.hasProjectPrice && !visible.includes(normalizeVisible(formatMinor(content.projectPriceMinor, content.currency, content.currencyExponent, content)))) {
      throw rendererError("CONTENT_PROJECT_PRICE_MISSING", "Page 19 omitted the locked project total");
    }
    const capacityPlan = teamCapacityPlan(content);
    const expectedRows = capacityPlan && capacityPlan.rows.length >= 4 && capacityPlan.rows.length <= 8 ? capacityPlan.rows.length : 1;
    const ledgerCount = (pageHtml.match(/data-project-price-table="true"/g) || []).length;
    const headCount = (pageHtml.match(/class="project-price-head"/g) || []).length;
    const rowCount = (pageHtml.match(/data-price-row="true"/g) || []).length;
    const totalCount = (pageHtml.match(/data-project-price-total="true"/g) || []).length;
    const scenarioCount = (pageHtml.match(/data-price-scenario-disclosure="true"/g) || []).length;
    const fieldCounts = ["item", "quantity", "duration", "unit_rate", "amount"]
      .map((field) => (pageHtml.match(new RegExp('data-price-field="' + field + '"', "g")) || []).length);
    const unknownRateCount = (pageHtml.match(/data-price-field="unit_rate" data-value-status="unknown"/g) || []).length;
    const unknownAmountCount = (pageHtml.match(/data-price-field="amount" data-value-status="unknown"/g) || []).length;
    const renderedTotalMinor = pageHtml.match(/data-project-price-total-minor="([0-9]*)"/)?.[1] || "";
    const rendersRoleCapacityRows = capacityPlan && capacityPlan.rows.length >= 4 && capacityPlan.rows.length <= 8;
    const roleCapacityMetadataValid = !rendersRoleCapacityRows || capacityPlan.rows.every((row, index) => pageHtml.includes(
      'data-role-index="' + (index + 1) + '" data-role-peak-fte="' + formatTeamDataValue(row.peakFte) + '" data-role-fte-months="' + formatTeamDataValue(row.fteMonths) + '"',
    ));
    if (ledgerCount !== 1 || headCount !== 1 || rowCount !== expectedRows || totalCount !== 1 || scenarioCount !== 1
      || fieldCounts.some((count) => count !== expectedRows + 1)
      || unknownRateCount !== expectedRows || unknownAmountCount !== expectedRows
      || !roleCapacityMetadataValid
      || /class="(?:price-hero|boundary-list)(?:\s|")/.test(pageHtml)) {
      throw rendererError("CONTENT_PROJECT_PRICE_STRUCTURE_INVALID", "The Project Price page requires the same canonical role capacity used by Team Size, one planning disclosure, unknown per-role rates and amounts, and one clearly classified total");
    }
    if (content.hasProjectPrice && renderedTotalMinor !== String(content.projectPriceMinor)) {
      throw rendererError("CONTENT_PROJECT_PRICE_RECONCILIATION_INVALID", "The Project Price total must equal the CommercialLock project total");
    }
    const renderedBudgetMinor = pageHtml.match(/data-client-budget-minor="([0-9]*)"/)?.[1] || "";
    if (!content.hasProjectPrice && content.hasClientBudget && (renderedBudgetMinor !== String(content.clientBudgetMinor)
      || !visible.includes(normalizeVisible(formatMinor(content.clientBudgetMinor, content.currency, content.currencyExponent, content))))) {
      throw rendererError("CONTENT_BUDGET_TOTAL_MISSING", "The client budget must remain visible as a separate brief input when no project quote exists");
    }
    const amountCopy = projectPriceCopy(content.locale);
    if (!visible.includes(normalizeVisible(projectPriceTotalLabel(content, amountCopy)))
      || (content.projectAmountKind !== "confirmed_quote" && visible.includes(normalizeVisible(amountCopy.confirmedTotal)))) {
      throw rendererError("CONTENT_PROJECT_TOTAL_KIND_MISMATCH", "The rendered total label must match the classified amount kind and must not confirm a budget as a quote");
    }
    if (capacityPlan && !capacityPlan.rows.every((row) => visible.includes(normalizeVisible(row.role)))) {
      throw rendererError("CONTENT_PROJECT_PRICE_STRUCTURE_INVALID", "The Project Price page omitted a locked planning role");
    }
    const currencyUnknown = content.currencyStatus === "unknown" || content.currency === "XXX";
    if (currencyUnknown && (!visible.toLocaleLowerCase().includes(normalizeVisible(projectPriceCopy(content.locale).currencyNotSupplied).toLocaleLowerCase()) || /\bXXX\b/.test(visible) || !/data-currency-status="unknown"/.test(pageHtml))) {
      throw rendererError("CONTENT_PROJECT_PRICE_CURRENCY_INVALID", "Unknown currency must remain visibly undisclosed without rendering a currency code");
    }
  }
  if (pageKind === "payments") {
    for (const row of content.payments) {
      if (!visible.includes(normalizeVisible(formatMinor(row.amountMinor, content.currency, content.currencyExponent, content))) || !visible.includes(formatBasisPoints(row.percentBasisPoints, content))) {
        throw rendererError("CONTENT_PAYMENT_SCHEDULE_MISSING", "Page 20 omitted a locked payment amount or percentage");
      }
    }
    if (!visible.includes(l(content, "Scheduled total"))) {
      throw rendererError("CONTENT_PAYMENT_SCHEDULE_MISSING", "Page 20 is missing the scheduled total");
    }
  }
  if (pageKind === "close" && (!visible.includes(l(content, "Decision")) || !visible.includes(l(content, "Owner")) || !visible.includes(l(content, "Status")) || (!visible.includes(l(content, "Next action")) && !visible.includes(l(content, "NEXT ACTION"))) || (pageHtml.match(/class="decision-status"/g) || []).length !== 3)) {
    throw rendererError("CONTENT_CLOSE_REQUIRED_PAYLOAD_MISSING", "The close page requires decisions, owners, explicit statuses, and a next action");
  }
  return true;
}

function timeAxisTickLabel(unit, value, locale = "en") {
  const prefix = rendererTimePrefix(unit, locale);
  return prefix + value;
}

function pagePaletteDeclarations(palette = {}) {
  return [
    ["background", palette.background],
    ["surface", palette.surface],
    ["surface-2", palette.surface2],
    ["text", palette.text],
    ["text-on-element", palette.textOnAccent],
    ["text-on-element-soft", palette.textOnAccentSoft],
    ["muted", palette.muted],
    ["rule", palette.rule],
    ["element", palette.primary],
    ["brand-deep", palette.brandDeep],
    ["secondary-text", palette.secondary],
    ["warning", palette.warning],
    ["critical", palette.critical],
    ["positive", palette.positive],
  ].map(([name, value]) => "--kp-page-" + name + ":" + value).join(";");
}

function pageCssVariableTokens(tokens) {
  return {
    ...tokens,
    background: "var(--kp-page-background)",
    surface: "var(--kp-page-surface)",
    surface2: "var(--kp-page-surface-2)",
    text: "var(--kp-page-text)",
    textOnAccent: "var(--kp-page-text-on-element)",
    textOnAccentSoft: "var(--kp-page-text-on-element-soft)",
    muted: "var(--kp-page-muted)",
    rule: "var(--kp-page-rule)",
    primary: "var(--kp-page-element)",
    decorativePrimary: "var(--kp-page-background)",
    decorativeSecondary: "var(--kp-page-element)",
    decorativeTertiary: "var(--kp-page-element)",
    brandDeep: "var(--kp-page-brand-deep)",
    secondary: "var(--kp-page-secondary-text)",
    warning: "var(--kp-page-warning)",
    critical: "var(--kp-page-critical)",
    positive: "var(--kp-page-positive)",
  };
}

export function referenceDrivenStyles(styleProfile = {}, dynamicRules = []) {
  const resolved = resolveStyleTokens(styleProfile);
  const t = pageCssVariableTokens(resolved);
  const lightPalette = resolved.compositions.light;
  const darkPalette = resolved.compositions.dark;
  const splitPalette = resolved.compositions.split;
  const udevsScreenshotRules = resolved.backgroundStyle === "udevs_screenshot"
    ? [
        '.page.background-udevs-screenshot,.kp-page.background-udevs-screenshot{background-color:#FFFFFF;background-image:url("' + udevsBackgroundDataUri("content") + '");background-repeat:no-repeat;background-position:center;background-size:cover}',
        '.page.background-udevs-screenshot[data-page-kind="product_map"],.page.background-udevs-screenshot[data-page-kind="client_dependencies"],.page.background-udevs-screenshot[data-page-kind="team"],.kp-page.background-udevs-screenshot[data-page-kind="product_map"],.kp-page.background-udevs-screenshot[data-page-kind="client_dependencies"],.kp-page.background-udevs-screenshot[data-page-kind="team"]{background-color:#F7F8FC;background-image:url("' + udevsBackgroundDataUri("contentSoft") + '")}',
        '.page.background-udevs-screenshot[data-page-kind="cover"],.kp-page.background-udevs-screenshot[data-page-kind="cover"]{background-image:url("' + udevsBackgroundDataUri("cover") + '")}',
        ".page.background-udevs-screenshot::before,.page.background-udevs-screenshot::after{display:none}",
        ".page.background-udevs-screenshot>.page-header,.page.background-udevs-screenshot>.page-title-row,.page.background-udevs-screenshot>.page-body{position:relative;z-index:1}",
        ".page.background-udevs-screenshot>.page-footer{z-index:1}",
      ]
    : [];
  const css = [
    kpFontFaceRules(),
    "@page{size:15in 10in;margin:0}",
    ":root{--kp-brand-primary:" + resolved.decorativePrimary + ";--kp-brand-secondary:" + resolved.decorativeSecondary + ";--kp-brand-accent:" + resolved.decorativeSecondary + ";--kp-brand-background:" + lightPalette.background + ";--kp-brand-surface:" + lightPalette.surface + ";" + pagePaletteDeclarations(lightPalette) + "}",
    '.page[data-page-composition="light"],.kp-page[data-page-composition="light"]{' + pagePaletteDeclarations(lightPalette) + "}",
    '.page[data-page-composition="dark"],.kp-page[data-page-composition="dark"]{' + pagePaletteDeclarations(darkPalette) + "}",
    '.page[data-page-composition="split"],.kp-page[data-page-composition="split"]{' + pagePaletteDeclarations(splitPalette) + "}",
    "*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
    "html,body{margin:0;padding:0;width:1440px;background:" + t.background + ";color:" + t.text + ";font-family:" + t.bodyStack + "}",
    ".proposal{width:1440px}",
    ".page,.kp-page{box-sizing:border-box;position:relative;overflow:hidden;width:1440px;height:960px;padding:" + t.pagePaddingTop + "px " + t.pagePaddingX + "px " + t.pagePaddingBottom + "px;background:" + t.background + ";color:" + t.text + ";break-after:page;page-break-after:always}",
    ".page:last-child,.kp-page:last-child{break-after:auto;page-break-after:auto}",
    "@media print{html,body{width:15in!important;min-width:15in!important;margin:0!important;padding:0!important}.proposal{display:block!important;width:15in!important;margin:0!important;padding:0!important}.page,.kp-page{width:15in!important;min-width:15in!important;max-width:15in!important;height:10in!important;min-height:10in!important;max-height:10in!important;margin:0!important;break-inside:avoid!important;page-break-inside:avoid!important;break-after:page!important;page-break-after:always!important}.page:last-child,.kp-page:last-child{break-after:auto!important;page-break-after:auto!important}}",
    ".page::before{content:'';position:absolute;right:-160px;top:-220px;width:580px;height:580px;border-radius:50%;background:radial-gradient(circle," + alphaHex(t.decorativeTertiary, 0.18) + " 0%,transparent 68%);pointer-events:none}",
    ".page::after{content:'';position:absolute;left:-210px;bottom:-290px;width:520px;height:520px;border-radius:44% 56% 63% 37%;background:radial-gradient(circle," + alphaHex(t.decorativeTertiary, 0.10) + " 0%,transparent 70%);transform:rotate(-14deg);pointer-events:none}",
    ...udevsScreenshotRules,
    '.page[data-page-composition="split"]::after{left:0;right:0;bottom:0;width:100%;height:30%;border-radius:0;background:var(--kp-page-element);transform:none}',
    '.page[data-page-composition="split"]>.page-header,.page[data-page-composition="split"]>.page-title-row,.page[data-page-composition="split"]>.page-body,.page[data-page-composition="split"]>.page-footer{position:relative;z-index:1}',
    '.page[data-page-composition="split"]>.page-footer{border-top-color:color-mix(in srgb,var(--kp-page-text-on-element) 55%,transparent);background:var(--kp-page-element);color:var(--kp-page-text-on-element)}',
    ".page-header{height:34px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid " + t.rule + ";color:" + t.muted + ";font:700 10px/1 " + t.metadataStack + ";letter-spacing:.13em}",
    ".page-title-row{min-height:154px;display:flex;justify-content:space-between;gap:40px;align-items:flex-start;padding-top:24px}",
    ".page-title-row>div{max-width:1030px}",
    ".page-kicker{display:block;margin-bottom:10px;color:" + t.secondary + ";font:700 10px/1 " + t.metadataStack + ";letter-spacing:.14em}",
    ".page-title{margin:0;font-family:" + t.displayStack + ";font-size:45px;line-height:1.04;letter-spacing:-.035em;font-weight:700;text-wrap:balance}",
    ".page-title-token{white-space:nowrap}",
    ".page-badge{max-width:270px;padding:8px 11px;border:1px solid " + t.rule + ";border-radius:" + t.radiusSm + "px;color:" + t.muted + ";font:700 10px/1.25 " + t.metadataStack + ";text-align:right}",
    ".page-body{position:relative;height:670px;min-height:0}",
    ".page-footer{position:absolute;left:" + t.pagePaddingX + "px;right:" + t.pagePaddingX + "px;bottom:22px;display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid " + t.rule + ";color:" + t.muted + ";font:700 9px/1 " + t.metadataStack + ";letter-spacing:.08em}",
    ".prototype-link{display:inline-flex;align-items:center;gap:5px;color:" + t.secondary + ";text-decoration:none;font:700 9px/1 " + t.metadataStack + ";letter-spacing:.04em}",
    ".prototype-link span{font-size:11px;line-height:1}",
    ".panel{border:1px solid " + t.rule + ";border-radius:" + t.radiusMd + "px;background:" + t.surface + "}",
    ".panel-soft{border:1px solid " + t.rule + ";border-radius:" + t.radiusMd + "px;background:" + t.surface2 + "}",
    ".eyebrow{color:" + t.secondary + ";font:700 10px/1.1 " + t.metadataStack + ";letter-spacing:.12em}",
    ".muted{color:" + t.muted + "}",
    ".status{width:max-content;padding:5px 8px;border:1px solid " + t.rule + ";border-radius:999px;color:" + t.muted + ";font:700 9px/1 " + t.metadataStack + "}",
    ".status-positive{color:" + t.positive + ";border-color:" + alphaHex(t.positive, .45) + "}",
    ".status-warning{color:" + t.warning + ";border-color:" + alphaHex(t.warning, .45) + "}",
    ".status-critical{color:" + t.critical + ";border-color:" + alphaHex(t.critical, .45) + "}",
    ".inline-sources{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:12px}",
    ".inline-sources>.inline-source-label{color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.06em}",
    ".source-chip{display:inline-flex;align-items:center;max-width:310px;padding:5px 8px;border:1px solid " + t.rule + ";border-radius:999px;color:" + t.secondary + ";font:700 8px/1.15 " + t.metadataStack + ";overflow-wrap:anywhere;text-decoration:none}",
    ".inline-sources.compact{margin-top:6px;gap:4px}",
    ".inline-sources.compact>.inline-source-label{display:none}",
    ".inline-sources.compact>.source-chip{display:inline-flex;padding:4px 7px;font-size:8px}",
    ".missing-state{height:100%;display:grid;grid-template-columns:.82fr 1.18fr;gap:42px;align-items:center;padding:38px}",
    ".missing-state>div:first-child strong{display:block;font:700 30px/1.08 " + t.displayStack + "}",
    ".missing-state>div:first-child p{margin:16px 0 0;color:" + t.muted + ";font-size:15px;line-height:1.5}",
    ".question-list{display:grid;gap:10px}",
    ".question-row{display:grid;grid-template-columns:32px 1fr;gap:12px;padding:13px 0;border-top:1px solid " + t.rule + "}",
    ".question-row span{color:" + t.warning + ";font:700 10px/1 " + t.metadataStack + "}",
    ".question-row strong{font-size:13px;line-height:1.35}",
    ".cover-grid{height:100%;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(300px,.7fr);grid-template-rows:minmax(0,1fr) 146px;gap:18px;align-items:stretch}",
    ".cover-main{position:relative;isolation:isolate;overflow:hidden;padding:40px;display:flex;flex-direction:column;justify-content:space-between;border:1px solid " + t.rule + ";border-radius:" + t.radiusLg + "px;background:linear-gradient(145deg," + t.surface2 + " 0%," + t.surface + " 100%)}",
    ".cover-main::after{content:'';position:absolute;z-index:-1;right:-116px;bottom:-182px;width:420px;height:420px;border:1px solid " + alphaHex(t.primary, .28) + ";border-radius:50%;box-shadow:0 0 0 48px " + alphaHex(t.primary, .06) + ",0 0 0 96px " + alphaHex(t.primary, .035) + "}",
    ".cover-main-head{display:flex;align-items:center;justify-content:space-between;gap:24px}",
    ".cover-sequence{display:grid;place-items:center;width:42px;height:42px;border:1px solid " + alphaHex(t.primary, .5) + ";border-radius:50%;color:" + t.secondary + ";font:700 10px/1 " + t.metadataStack + "}",
    ".cover-promise{max-width:750px;margin:26px 0;color:" + t.text + ";font:700 31px/1.2 " + t.displayStack + ";letter-spacing:-.025em;text-wrap:balance}",
    ".cover-main-copy{max-width:680px;display:grid;grid-template-columns:34px 1fr;gap:16px;align-items:start}",
    ".cover-main-copy::before{content:'';display:block;height:2px;margin-top:9px;background:" + t.primary + "}",
    ".cover-main-copy p{margin:0;color:" + t.muted + ";font-size:13px;line-height:1.5}",
    ".cover-meta{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}",
    ".cover-meta.has-budget{grid-template-columns:repeat(4,minmax(0,1fr))}",
    ".cover-meta .metric{position:relative;min-height:146px;padding:20px 20px 16px;border:1px solid " + t.rule + ";border-top:3px solid " + t.primary + ";border-radius:" + t.radiusMd + "px;background:" + t.surface + "}",
    ".cover-meta .metric::before{position:absolute;right:16px;top:14px;color:" + alphaHex(t.secondary, .7) + ";font:700 9px/1 " + t.metadataStack + ";letter-spacing:.08em}",
    ".cover-meta .metric:nth-child(1)::before{content:'01'}",
    ".cover-meta .metric:nth-child(2)::before{content:'02'}",
    ".cover-meta .metric:nth-child(3)::before{content:'03'}",
    ".cover-meta .metric:nth-child(4)::before{content:'04'}",
    ".cover-meta .metric strong{max-width:90%;margin-top:17px;font-size:23px;overflow-wrap:anywhere}",
    ".cover-meta.has-budget .metric strong{font-size:21px}",
    ".cover-budget-currency{display:block;margin-top:5px;color:" + t.warning + ";font:700 8px/1.2 " + t.metadataStack + ";letter-spacing:.03em}",
    ".cover-meta .inline-sources{margin-top:7px}",
    ".metric{min-height:106px;padding:17px;border-top:2px solid " + t.primary + ";background:" + alphaHex(t.surface, .78) + "}",
    ".metric span{display:block;color:" + t.muted + ";font:700 9px/1.2 " + t.metadataStack + ";letter-spacing:.08em}",
    ".metric strong{display:block;margin-top:15px;font:700 22px/1.12 " + t.displayStack + "}",
    ".cover-side{position:relative;overflow:hidden;min-height:0;padding:30px;display:flex;flex-direction:column;justify-content:space-between;background:" + t.surface + "}",
    // Watermark numerals use the deep brand tone: a vivid light accent (e.g.
    // bright yellow) at 30% alpha would be nearly invisible on the canvas.
    ".cover-side-index{margin:-10px 0 8px;color:" + alphaHex(t.brandDeep, .3) + ";font:700 104px/.9 " + t.displayStack + ";letter-spacing:-.07em}",
    ".cover-side strong{display:block;margin-top:13px;font:700 29px/1.12 " + t.displayStack + ";overflow-wrap:anywhere}",
    ".cover-side-copy{margin:20px 0 0;color:" + t.muted + ";font-size:12px;line-height:1.48}",
    ".cover-side-signal{display:flex;gap:7px;align-items:center;padding-top:18px;border-top:1px solid " + t.rule + "}",
    ".cover-side-signal span{width:8px;height:8px;border:1px solid " + t.primary + ";border-radius:50%}",
    ".cover-side-signal span:first-child{width:28px;border-radius:999px;background:" + t.primary + "}",
    ".thread-layout{height:100%;display:flex;flex-direction:column;justify-content:center}",
    ".thread-line{position:relative;display:grid;grid-template-columns:repeat(4,1fr);gap:18px}",
    ".thread-line::before{content:'';position:absolute;left:8%;right:8%;top:34px;height:2px;background:" + t.rule + "}",
    ".thread-item{position:relative;padding-top:64px}",
    ".thread-item::before{content:'';position:absolute;top:25px;left:0;width:18px;height:18px;border:3px solid " + t.primary + ";border-radius:50%;background:" + t.background + "}",
    ".thread-item span{color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + "}",
    ".thread-item strong{display:block;margin-top:10px;font-size:17px;line-height:1.2}",
    ".thread-item p{margin:9px 0 0;color:" + t.muted + ";font-size:12px;line-height:1.42}",
    ".chapter-layout{height:100%;display:grid;grid-template-columns:260px 1fr;gap:64px;align-items:center}",
    ".chapter-index{font:700 154px/.8 " + t.displayStack + ";color:" + alphaHex(t.primary, .45) + "}",
    ".chapter-copy strong{display:block;max-width:850px;font:700 34px/1.14 " + t.displayStack + "}",
    ".chapter-copy p{max-width:830px;margin:24px 0 0;color:" + t.muted + ";font-size:16px;line-height:1.55}",
    ".driver-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:34px}",
    ".driver{padding-top:14px;border-top:1px solid " + t.rule + "}",
    ".driver span{color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + "}",
    ".driver strong{display:block;margin-top:10px;font-size:13px;line-height:1.38}",
    ".handoff-layout{height:100%;display:grid;grid-template-columns:.72fr 1.28fr;gap:48px;align-items:center}",
    ".handoff-thesis{padding:28px}",
    ".handoff-thesis strong{font:700 25px/1.18 " + t.displayStack + "}",
    ".handoff-thesis p{margin:18px 0 0;color:" + t.muted + ";font-size:14px;line-height:1.5}",
    ".handoff-list{display:grid;gap:10px}",
    ".handoff-row{display:grid;grid-template-columns:56px 1fr 130px;gap:16px;align-items:center;padding:15px 0;border-top:1px solid " + t.rule + "}",
    ".handoff-row span{color:" + t.secondary + ";font:700 10px/1 " + t.metadataStack + "}",
    ".handoff-row strong{font-size:14px}",
    ".handoff-row p{margin:5px 0 0;color:" + t.muted + ";font-size:11px;line-height:1.35}",
    ".handoff-row small{color:" + t.warning + ";font:700 9px/1.2 " + t.metadataStack + ";text-align:right}",
    ".evidence-layout{height:100%;display:grid;grid-template-columns:1.05fr .95fr;gap:24px}",
    ".evidence-hero{padding:30px;display:flex;flex-direction:column;justify-content:space-between}",
    ".evidence-hero strong{font:700 30px/1.14 " + t.displayStack + "}",
    ".evidence-hero p{color:" + t.muted + ";font-size:14px;line-height:1.52}",
    ".evidence-metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}",
    ".evidence-list{display:grid;align-content:start}",
    ".evidence-row{padding:18px;border-top:1px solid " + t.rule + "}",
    ".evidence-row:first-child{border-top:0}",
    ".evidence-row span{color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + "}",
    ".evidence-row strong{display:block;margin-top:7px;font-size:14px;line-height:1.35}",
    ".evidence-row p{margin:7px 0 0;color:" + t.muted + ";font-size:11px;line-height:1.38}",
    ".evidence-detail{margin-top:7px;color:" + t.muted + ";font-size:11px;line-height:1.38}",
    ".analog-layout{height:100%;display:grid;grid-template-columns:.95fr 1.05fr;gap:18px}",
    ".analog-panel{padding:22px;overflow:hidden}",
    ".analog-list{display:grid;align-content:start;margin-top:12px}",
    ".analog-source,.analog-learning{padding:10px 0;border-top:1px solid " + t.rule + "}",
    ".analog-source:first-child,.analog-learning:first-child{border-top:0}",
    ".analog-source strong{display:block;font-size:11px}",
    ".analog-source p{margin:4px 0;color:" + t.muted + ";font:700 9px/1.25 " + t.metadataStack + ";overflow-wrap:anywhere}",
    ".analog-source span{color:" + t.positive + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.06em}",
    ".analog-learning{display:grid;grid-template-columns:30px 1fr;gap:8px 12px}",
    ".analog-learning>span{grid-row:1/3;color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + "}",
    ".analog-learning strong{font-size:11px;line-height:1.25}",
    ".analog-learning p{margin:0;color:" + t.muted + ";font-size:9px;line-height:1.25}",
    ".analog-learning .inline-sources{grid-column:2;margin-top:0}",
    ".analog-title{display:block;margin-top:24px;font:700 28px/1.12 " + t.displayStack + "}",
    ".analog-summary{margin:18px 0;color:" + t.muted + ";font-size:13px;line-height:1.5}",
    ".analog-disclosure{margin:14px 0 0;padding-top:12px;border-top:1px solid " + t.rule + ";color:" + t.muted + ";font-size:10px;line-height:1.35}",
    ".table-layout{height:100%;display:flex;flex-direction:column}",
    ".table-head,.table-row{display:grid;grid-template-columns:.85fr 1.15fr 1.15fr .55fr;gap:18px;align-items:center}",
    ".table-head{padding:11px 16px;color:" + t.muted + ";font:700 9px/1 " + t.metadataStack + ";letter-spacing:.08em}",
    ".table-row{min-height:91px;padding:14px 16px;border-top:1px solid " + t.rule + "}",
    ".table-row strong{font-size:13px;line-height:1.3}",
    ".table-row p{margin:0;color:" + t.muted + ";font-size:11px;line-height:1.38}",
    ".table-row span{font:700 9px/1.25 " + t.metadataStack + ";color:" + t.secondary + "}",
    ".design-layout{height:100%;display:grid;grid-template-columns:.92fr 1.08fr;gap:24px}",
    ".style-specimen{padding:30px;display:flex;flex-direction:column;justify-content:space-between}",
    ".style-specimen strong{font:700 34px/1 " + t.displayStack + "}",
    ".style-specimen p{color:" + t.muted + ";font-size:13px;line-height:1.5}",
    ".swatches{display:flex;gap:10px}",
    ".swatch{width:70px;height:70px;border:1px solid " + t.rule + ";border-radius:" + t.radiusSm + "px}",
    ".approval-list{display:grid;align-content:center}",
    ".approval-row{display:grid;grid-template-columns:42px 1fr;gap:16px;padding:18px;border-top:1px solid " + t.rule + "}",
    ".approval-row span{color:" + t.secondary + ";font:700 10px/1 " + t.metadataStack + "}",
    ".approval-row strong{font-size:14px}",
    ".approval-row p{margin:7px 0 0;color:" + t.muted + ";font-size:11px;line-height:1.38}",
    ".semantic-layout{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}",
    ".semantic-note{width:1120px;display:grid;grid-template-columns:180px 1fr auto;gap:16px;align-items:center;padding:10px 14px;border-left:3px solid " + t.secondary + ";background:" + alphaHex(t.surface2, .72) + "}",
    ".semantic-note span{color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + ";letter-spacing:.08em}",
    ".semantic-note p{margin:0;color:" + t.muted + ";font-size:11px;line-height:1.35}",
    ".semantic-layout-product-map{justify-content:flex-start;gap:8px}",
    ".semantic-layout-product-map .semantic-note{width:100%}",
    ".semantic-layout-bpmn{justify-content:flex-start;gap:8px}",
    ".semantic-layout-bpmn .semantic-note{width:100%}",
    ".market-sizing-layout{height:100%;display:grid;grid-template-columns:minmax(0,.76fr) minmax(0,1.24fr);gap:42px;align-items:stretch}",
    ".market-story{min-width:0;display:flex;flex-direction:column;justify-content:space-between;padding:18px 0 14px}",
    ".market-thesis{max-width:390px;padding-left:18px;border-left:3px solid " + t.primary + "}",
    ".market-thesis>span,.market-discipline>span,.market-context>span,.market-methodology>span{display:block;color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + ";letter-spacing:.11em;text-transform:uppercase}",
    ".market-thesis>strong{display:block;margin-top:16px;font:700 25px/1.12 " + t.displayStack + ";letter-spacing:-.025em;text-wrap:balance}",
    ".market-thesis>p{margin:14px 0 0;color:" + t.muted + ";font-size:12px;line-height:1.48}",
    ".market-discipline{max-width:410px;padding:18px 20px;border:1px solid " + t.rule + ";border-radius:" + t.radiusMd + "px;background:" + alphaHex(t.surface2, .82) + "}",
    ".market-discipline>strong{display:block;margin-top:12px;font:700 18px/1.18 " + t.displayStack + ";letter-spacing:-.015em}",
    ".market-discipline>p{margin:10px 0 0;color:" + t.muted + ";font-size:10px;line-height:1.42}",
    ".market-missing-inputs{display:grid;gap:7px;margin-top:13px;padding-top:10px;border-top:1px solid " + t.rule + "}",
    ".market-missing-input{display:grid;grid-template-columns:22px 1fr;gap:8px;align-items:start}",
    ".market-missing-input>span{color:" + t.warning + ";font:700 8px/1.3 " + t.metadataStack + "}",
    ".market-missing-input>p{margin:0;color:" + t.text + ";font-size:9px;line-height:1.28}",
    ".market-model{min-width:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:12px;padding:17px 18px 15px;border:1px solid " + t.rule + ";border-radius:" + t.radiusLg + "px;background:linear-gradient(145deg," + t.surface2 + "," + t.surface + ")}",
    ".market-context{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:10px;border-bottom:1px solid " + t.rule + "}",
    ".market-context>strong{max-width:68%;font-size:11px;line-height:1.35;text-align:right}",
    ".market-sizing-funnel{width:100%!important;height:100%!important;min-height:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:11px;background:transparent!important;color:" + t.text + "!important}",
    ".market-level{position:relative;isolation:isolate;min-height:92px;display:flex;align-items:center;justify-content:center;padding:16px 42px;color:" + t.text + ";text-align:center}",
    ".market-level::before{content:'';position:absolute;z-index:-1;inset:0;clip-path:polygon(4% 0,96% 0,100% 100%,0 100%);background:" + alphaHex(t.primary, .16) + ";box-shadow:inset 0 0 0 1px " + alphaHex(t.primary, .42) + "}",
    ".market-level-tam{width:100%}",
    ".market-level-sam{width:78%}",
    ".market-level-sam::before{background:" + alphaHex(t.secondary, .14) + ";box-shadow:inset 0 0 0 1px " + alphaHex(t.secondary, .48) + "}",
    ".market-level-som{width:58%;min-height:102px}",
    ".market-level-som::before{background:" + alphaHex(t.warning, .11) + ";box-shadow:inset 0 0 0 1px " + alphaHex(t.warning, .46) + "}",
    ".market-level-copy{min-width:0;max-width:100%}",
    ".market-level-copy>span{display:block;color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + ";letter-spacing:.12em}",
    ".market-level-copy>strong{display:block;margin-top:8px;font:700 24px/.98 " + t.displayStack + ";letter-spacing:-.025em;overflow-wrap:anywhere}",
    ".market-level-copy>p{margin:7px 0 0;color:" + t.muted + ";font-size:8.5px;line-height:1.3;overflow-wrap:anywhere}",
    ".market-sizing-layout[data-market-state='pending'] .market-level-copy>strong{font-size:14px;line-height:1.2;letter-spacing:-.01em}",
    ".market-scenarios{display:grid;gap:5px;margin-top:8px}",
    ".market-scenario{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding-top:5px;border-top:1px solid " + alphaHex(t.warning, .28) + ";text-align:left}",
    ".market-scenario:first-child{padding-top:0;border-top:0}",
    ".market-scenario>span{min-width:0;color:" + t.muted + ";font:700 8px/1.2 " + t.metadataStack + ";overflow-wrap:anywhere}",
    ".market-scenario>strong{font:700 10px/1 " + t.displayStack + ";white-space:nowrap}",
    ".market-methodology{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px 16px;align-items:start;padding-top:11px;border-top:1px solid " + t.rule + "}",
    ".market-methodology>p{margin:0;color:" + t.muted + ";font-size:9px;line-height:1.35}",
    ".market-methodology .inline-sources{grid-column:2;margin-top:0}",
    ".market-scenario-disclosure{grid-column:1/-1;display:grid;grid-template-columns:180px 1fr;gap:18px;align-items:center;padding:10px 14px;border-left:3px solid " + t.warning + ";background:" + alphaHex(t.surface2, .72) + "}",
    ".market-scenario-disclosure>span{color:" + t.warning + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.08em}",
    ".market-scenario-disclosure>p{margin:0;color:" + t.muted + ";font-size:9px;line-height:1.35}",
    ".org-layout{height:100%;display:grid;grid-template-rows:minmax(0,1fr) 58px;gap:12px}",
    ".org-chart{position:relative;min-height:0;overflow:hidden;padding:20px 28px 18px;background:" + alphaHex(t.surface, .84) + "}",
    ".org-root-wrap{position:relative;height:116px;display:flex;justify-content:center;align-items:flex-start}",
    ".org-connector{position:absolute;display:block;pointer-events:none}",
    ".org-root-connector{left:50%;bottom:0;height:34px;border-left:2px solid " + alphaHex(t.primary, .78) + "}",
    ".org-node{position:relative;z-index:2;display:flex;min-width:0;flex-direction:column;justify-content:center;border:1px solid " + alphaHex(t.primary, .58) + ";border-radius:" + t.radiusMd + "px;background:" + alphaHex(t.background, .97) + ";box-shadow:0 12px 30px " + alphaHex(t.background, .2) + "}",
    ".org-node small{color:" + t.secondary + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.1em;text-transform:uppercase}",
    ".org-node strong{display:block;margin-top:8px;color:" + t.text + ";font-size:14px;line-height:1.18;overflow-wrap:anywhere}",
    ".org-node p{margin:6px 0 0;color:" + t.muted + ";font-size:9px;line-height:1.25;overflow-wrap:anywhere}",
    ".org-root{width:390px;min-height:82px;padding:15px 22px;text-align:center;border-width:2px;background:" + alphaHex(t.surface2, .96) + "}",
    ".org-root strong{font:700 22px/1.08 " + t.displayStack + ";letter-spacing:-.025em}",
    ".org-branches{position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px;padding-top:34px}",
    ".org-branches::before{content:'';position:absolute;left:16.666%;right:16.666%;top:0;border-top:2px solid " + alphaHex(t.primary, .78) + "}",
    ".org-branch{position:relative;min-width:0}",
    ".org-branch-connector{left:50%;top:-34px;height:34px;border-left:2px solid " + alphaHex(t.primary, .78) + "}",
    ".org-branch-node{min-height:78px;padding:13px 16px;border-top-width:3px}",
    ".org-branch-node::after{content:'';position:absolute;left:50%;bottom:-23px;height:23px;border-left:1px solid " + alphaHex(t.rule, .95) + "}",
    ".org-children{position:relative;display:grid;gap:10px;margin-top:46px}",
    ".org-children-count-1{grid-template-columns:1fr}",
    ".org-children-count-2{grid-template-columns:repeat(2,minmax(0,1fr))}",
    ".org-children-count-3{grid-template-columns:repeat(3,minmax(0,1fr))}",
    ".org-children::before{content:'';position:absolute;top:-23px;border-top:1px solid " + alphaHex(t.rule, .95) + "}",
    ".org-children-count-1::before{left:50%;right:50%}",
    ".org-children-count-2::before{left:25%;right:25%}",
    ".org-children-count-3::before{left:16.666%;right:16.666%}",
    ".org-child{position:relative;min-width:0}",
    ".org-child-connector{left:50%;top:-23px;height:23px;border-left:1px solid " + alphaHex(t.rule, .95) + "}",
    ".org-child-node{min-height:88px;height:100%;padding:12px 11px;text-align:center;border-color:" + alphaHex(t.rule, .95) + ";box-shadow:none}",
    ".org-child-node strong{font-size:11px;line-height:1.2}",
    ".org-child-node p{font-size:8px;line-height:1.22}",
    ".org-node-pending{border-style:dashed;border-color:" + alphaHex(t.warning, .68) + "}",
    // Delivery people chain: CEO -> project manager -> execution roles.
    ".org-chart-people{display:flex;flex-direction:column;justify-content:center}",
    ".org-chart-people .org-root-wrap{height:118px}",
    ".org-chart-people .org-root{width:340px;min-height:80px}",
    ".org-manager-wrap{position:relative;height:122px;display:flex;justify-content:center;align-items:flex-start}",
    ".org-manager-node{width:340px;min-height:84px;padding:14px 20px;text-align:center;border-top-width:3px;background:" + alphaHex(t.surface2, .9) + "}",
    ".org-manager-node strong{font-size:16px}",
    ".org-manager-connector{left:50%;bottom:0;height:34px;border-left:2px solid " + alphaHex(t.primary, .78) + "}",
    ".org-people-grid{position:relative;display:grid;gap:12px;padding-top:30px}",
    ".org-people-grid::before{content:'';position:absolute;top:0;border-top:2px solid " + alphaHex(t.primary, .5) + "}",
    ".org-people-count-2{grid-template-columns:repeat(2,minmax(0,1fr))}",
    ".org-people-count-2::before{left:25%;right:25%}",
    ".org-people-count-3{grid-template-columns:repeat(3,minmax(0,1fr))}",
    ".org-people-count-3::before{left:16.666%;right:16.666%}",
    ".org-people-count-4{grid-template-columns:repeat(4,minmax(0,1fr))}",
    ".org-people-count-4::before{left:12.5%;right:12.5%}",
    ".org-people-count-5{grid-template-columns:repeat(5,minmax(0,1fr))}",
    ".org-people-count-5::before{left:10%;right:10%}",
    ".org-people-count-6{grid-template-columns:repeat(6,minmax(0,1fr))}",
    ".org-people-count-6::before{left:8.333%;right:8.333%}",
    ".org-people-count-7{grid-template-columns:repeat(7,minmax(0,1fr))}",
    ".org-people-count-7::before{left:7.142%;right:7.142%}",
    ".org-people-count-8{grid-template-columns:repeat(8,minmax(0,1fr))}",
    ".org-people-count-8::before{left:6.25%;right:6.25%}",
    ".org-person{position:relative;min-width:0}",
    ".org-person-connector{left:50%;top:-30px;height:30px;border-left:1px solid " + alphaHex(t.rule, .95) + "}",
    ".org-person-node{min-height:118px;height:100%;padding:13px 11px;text-align:center;border-color:" + alphaHex(t.rule, .95) + ";box-shadow:none}",
    ".org-person-node strong{font-size:11.5px;line-height:1.2;overflow-wrap:normal;word-break:keep-all;hyphens:none}",
    ".org-person-node p{font-size:8.5px;line-height:1.25}",
    ".org-manager-node strong{overflow-wrap:normal;word-break:keep-all;hyphens:none}",
    ".org-evidence{display:grid;grid-template-columns:190px 1fr auto;gap:16px;align-items:center;padding:10px 14px;border-left:3px solid " + t.primary + ";background:" + alphaHex(t.surface2, .76) + "}",
    ".org-evidence>span{color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + ";letter-spacing:.08em}",
    ".org-evidence>p{margin:0;color:" + t.muted + ";font-size:10.5px;line-height:1.3}",
    ".org-evidence .inline-sources{margin:0;justify-content:flex-end}",
    ".viz-canvas{position:relative;border:1px solid " + t.rule + ";border-radius:" + t.radiusMd + "px;overflow:hidden}",
    ".semantic-layout-product-map .viz-canvas{border:0;box-shadow:inset 0 0 0 1px " + t.rule + "}",
    ".viz-groups{position:absolute;inset:0;z-index:1}",
    ".viz-edges{position:absolute;left:0;top:0;z-index:2}",
    ".viz-edge-labels{position:absolute;left:0;top:0;z-index:3}",
    ".viz-nodes{position:absolute;left:0;top:0;z-index:4}",
    ".viz-node{position:absolute;display:flex;flex-direction:column;justify-content:center;gap:5px;padding:11px 13px;border:2px solid;border-radius:" + t.radiusSm + "px;background:" + t.background + ";font-size:13px;line-height:1.18}",
    ".viz-node span{overflow-wrap:normal;word-break:normal;hyphens:none}",
    ".viz-node small{font:700 9px/1 " + t.metadataStack + ";color:" + t.muted + "}",
    ".viz-mindmap{background:linear-gradient(90deg," + alphaHex(t.surface2, .34) + " 0," + alphaHex(t.background, .96) + " 38%," + alphaHex(t.background, .99) + " 100%)!important}",
    ".viz-mindmap .viz-edges path{stroke-linecap:round;stroke-linejoin:round;opacity:.92}",
    // Infographic mind map: each branch carries its own accent color through
    // node tint, border, and connector; depth is read through fill weight.
    ".viz-mindmap-node{padding:6px 10px;border-width:1.5px;border-radius:" + Math.max(10, t.radiusSm + 2) + "px;background:" + alphaHex(t.background, .97) + ";font-size:14px;line-height:1.12;box-shadow:none;overflow:hidden}",
    ".viz-mindmap-node span{display:block;overflow-wrap:normal;word-break:normal;hyphens:none}",
    ".viz-mindmap-node small{display:none}",
    ".viz-mindmap .viz-node-core{padding-left:14px;border-width:2.5px;background:" + t.surface2 + ";font-size:15px;font-weight:800;box-shadow:0 0 0 5px var(--viz-node-tint," + alphaHex(t.surface2, .5) + ")}",
    ".viz-mindmap .viz-node-domain{border-left-width:5px;background:" + t.surface + ";font-weight:700}",
    ".viz-mindmap .viz-node-capability{border-color:var(--viz-node-soft,var(--viz-node-color));background:" + t.background + ";font-weight:650}",
    ".viz-mindmap .viz-node-subfunction{border-width:1px;border-color:var(--viz-node-soft,var(--viz-node-color));background:" + t.surface2 + ";color:" + t.muted + "}",
    // Compact (zoomed-out) scale keeps a 12-row decomposition on one page.
    ".viz-mindmap-dense .viz-mindmap-node{padding:4px 8px;border-radius:8px;font-size:11px;line-height:1.16}",
    ".viz-mindmap-dense .viz-node-core{padding-left:11px;font-size:12.5px;box-shadow:0 0 0 4px var(--viz-node-tint," + alphaHex(t.surface2, .5) + ")}",
    ".viz-bpmn{background:linear-gradient(90deg," + alphaHex(t.surface2, .52) + " 0," + alphaHex(t.background, .98) + " 22%," + alphaHex(t.background, .99) + " 100%)!important}",
    ".viz-bpmn .viz-groups{z-index:1}",
    ".viz-bpmn-lanes{position:absolute;inset:0}",
    ".viz-bpmn-lane{position:absolute;border-top:1px solid " + alphaHex(t.rule, .88) + ";border-bottom:1px solid " + alphaHex(t.rule, .45) + ";background:" + alphaHex(t.surface, .18) + "}",
    ".viz-bpmn-lane:nth-child(even){background:" + alphaHex(t.surface2, .25) + "}",
    ".viz-bpmn-lane::after{content:'';position:absolute;left:var(--viz-lane-label-width);top:0;bottom:0;border-left:2px solid var(--viz-lane-color);opacity:.52}",
    ".viz-bpmn-lane-label{position:absolute;left:0;top:0;bottom:0;width:var(--viz-lane-label-width);display:flex;flex-direction:column;justify-content:center;gap:8px;padding:0 16px;background:" + alphaHex(t.surface2, .7) + "}",
    ".viz-bpmn-lane-label small{color:" + t.text + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.1em}",
    ".viz-bpmn-lane-label strong{color:" + t.text + ";font-size:11px;line-height:1.18;overflow-wrap:normal;word-break:normal;hyphens:none}",
    ".viz-bpmn .viz-edges{z-index:2;overflow:visible}",
    ".viz-bpmn .viz-edges path{stroke-linecap:round;stroke-linejoin:round}",
    ".viz-bpmn .viz-edge-risk{stroke-width:2.4}",
    ".viz-bpmn .viz-edge-labels{z-index:3}",
    ".viz-bpmn-edge-label{position:absolute;display:flex;align-items:center;justify-content:center;padding:2px 7px;border:1px solid;border-radius:999px;background:" + alphaHex(t.background, .98) + ";font:700 12px/1 " + t.metadataStack + ";white-space:nowrap}",
    ".viz-bpmn .viz-nodes{z-index:4}",
    ".viz-bpmn-node{padding:8px 9px;border-width:1.5px;border-radius:" + Math.max(8, t.radiusSm) + "px;background:" + alphaHex(t.background, .98) + ";font-size:12.5px;line-height:1.18;text-align:center;box-shadow:none;overflow:hidden}",
    ".viz-bpmn-node span{display:block;overflow-wrap:normal;word-break:normal;hyphens:none}",
    ".viz-bpmn-node-risk{background:" + alphaHex(t.surface2, .76) + "}",
    ".viz-bpmn .viz-node-start_event,.viz-bpmn .viz-node-end_event,.viz-bpmn .viz-node-gateway{display:grid;grid-template-rows:40px minmax(0,1fr);align-items:start;justify-items:center;gap:2px;padding:0 3px;border:0!important;border-radius:0;background:transparent;overflow:hidden}",
    ".viz-bpmn .viz-node-start_event::before,.viz-bpmn .viz-node-end_event::before{content:'';grid-row:1;width:34px;height:34px;align-self:center;border:2px solid var(--viz-node-color);border-radius:50%;background:" + t.background + "}",
    ".viz-bpmn .viz-node-end_event::before{border:4px double var(--viz-node-color)}",
    ".viz-bpmn .viz-node-gateway::before{content:'';grid-row:1;width:34px;height:34px;align-self:center;border:2px solid var(--viz-node-color);background:" + t.background + ";transform:rotate(45deg)}",
    ".viz-bpmn .viz-node-start_event span,.viz-bpmn .viz-node-end_event span,.viz-bpmn .viz-node-gateway span{grid-row:2;align-self:start;font-size:12px;line-height:1.08;text-align:center}",
    ".viz-architecture .viz-groups{z-index:1}",
    ".viz-architecture-legend{position:absolute;left:0;top:0;right:0;height:72px;display:grid;grid-template-columns:184px repeat(5,1fr);background:" + alphaHex(t.surface2, .92) + ";border-bottom:1px solid " + t.rule + "}",
    ".viz-architecture-legend-title{display:flex;flex-direction:column;justify-content:center;padding:0 18px;border-right:1px solid " + t.rule + "}",
    ".viz-architecture-legend-title small{color:" + t.secondary + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.1em}",
    ".viz-architecture-legend-title strong{margin-top:7px;font-size:12px;line-height:1.1}",
    ".viz-architecture-legend-item{display:flex;flex-direction:column;justify-content:center;margin:13px 9px;padding:0 11px;border-top:2px solid}",
    ".viz-architecture-legend-item small{color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + "}",
    ".viz-architecture-legend-item strong{margin-top:7px;font-size:10px;line-height:1.15}",
    ".viz-architecture-layers{position:absolute;inset:0}",
    ".viz-architecture-layer{position:absolute;left:0;display:grid;grid-template-columns:184px 1fr;border-top:1px solid " + alphaHex(t.rule, .82) + "}",
    ".viz-architecture-layer:nth-child(even){background:" + alphaHex(t.surface2, .28) + "}",
    ".viz-architecture-layer-label{display:flex;flex-direction:column;justify-content:center;padding:0 18px;border-right:1px solid " + alphaHex(t.rule, .82) + "}",
    ".viz-architecture-layer-label small{color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + "}",
    ".viz-architecture-layer-label strong{margin-top:8px;color:" + t.text + ";font-size:11px;line-height:1.15}",
    ".viz-architecture .viz-edges{z-index:3}",
    ".viz-architecture .viz-nodes{z-index:4}",
    ".viz-architecture .viz-node{padding:7px 10px;border-width:1.5px;background:" + t.background + ";font-size:12px;line-height:1.12;box-shadow:0 7px 18px " + alphaHex(t.background, .24) + ";overflow:hidden}",
    ".viz-architecture .viz-node small{font-size:8px}",
    ".viz-gantt-axis,.viz-gantt-labels,.viz-gantt-grid{position:absolute;inset:0;pointer-events:none}",
    ".viz-gantt-axis{z-index:2}",
    ".viz-gantt-axis span{position:absolute;top:10px;color:" + t.muted + ";font:700 9px/1 " + t.metadataStack + ";text-align:center}",
    ".viz-gantt-grid{z-index:1}",
    ".viz-gantt-grid span{position:absolute;top:34px;border-left:1px solid " + alphaHex(t.rule, .72) + "}",
    ".viz-gantt-labels{z-index:5}",
    ".viz-gantt-label{position:absolute;display:flex;flex-direction:column;justify-content:center;padding-right:16px}",
    ".viz-gantt-label strong{font-size:12px;line-height:1.2}",
    ".viz-gantt-label small{margin-top:5px;color:" + t.muted + ";font:700 9px/1 " + t.metadataStack + "}",
    ".roadmap-stage-layout{width:100%;height:100%;min-height:0;display:grid;grid-template-rows:52px minmax(0,1fr) 42px;gap:8px;align-content:stretch;align-items:stretch;justify-content:stretch}",
    ".roadmap-stage-intro{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;align-items:stretch}",
    ".roadmap-stage-thesis{display:flex;align-items:center;gap:16px;padding:0 18px;border-left:3px solid " + t.primary + ";background:" + alphaHex(t.surface2, .62) + "}",
    ".roadmap-stage-thesis span{flex:0 0 auto;color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + ";letter-spacing:.1em}",
    ".roadmap-stage-thesis p{margin:0;color:" + t.text + ";font-size:12px;line-height:1.35}",
    ".roadmap-duration-fact{display:grid;grid-template-columns:116px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 12px;border:1px solid " + t.rule + ";border-top:3px solid " + t.primary + ";border-radius:" + t.radiusSm + "px;background:" + alphaHex(t.surface, .9) + "}",
    ".roadmap-duration-fact>span{color:" + t.muted + ";font:700 8px/1.1 " + t.metadataStack + ";letter-spacing:.08em}",
    ".roadmap-duration-fact>strong{font:700 18px/1 " + t.displayStack + ";white-space:nowrap}",
    ".roadmap-duration-fact .inline-sources{justify-content:flex-end;margin:0}",
    ".roadmap-stage-chart{width:100%;height:100%;min-height:0;display:grid;grid-template-columns:288px minmax(0,1fr);border-radius:" + t.radiusMd + "px;background:" + alphaHex(t.surface, .9) + "}",
    ".roadmap-label-column,.roadmap-timeline-column{display:grid;grid-template-rows:48px 26px repeat(" + ROADMAP_WORKSTREAM_PAGE_LIMIT + ",32px) 78px;min-width:0;min-height:0}",
    ".roadmap-label-column{border-right:1px solid " + t.rule + ";background:" + alphaHex(t.surface2, .34) + "}",
    ".roadmap-label-cell{display:flex;min-width:0;flex-direction:column;justify-content:center;padding:0 15px;border-bottom:1px solid " + alphaHex(t.rule, .78) + "}",
    ".roadmap-label-cell>span{color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.08em}",
    ".roadmap-label-cell>strong{margin-top:4px;color:" + t.text + ";font-size:10.5px;line-height:1.16;overflow-wrap:anywhere}",
    ".roadmap-label-cell>small{margin-top:3px;color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + "}",
    ".roadmap-workstream-label{display:grid;grid-template-columns:22px minmax(0,1fr) 42px;column-gap:8px;align-items:center;padding:0 12px}",
    ".roadmap-workstream-label>span{min-width:0;margin:0;white-space:nowrap}",
    ".roadmap-workstream-label>strong{min-width:0;margin:0;font-size:9px;line-height:1.05;white-space:normal;overflow-wrap:anywhere}",
    ".roadmap-workstream-label>small{min-width:0;margin:0;justify-self:end;white-space:nowrap}",
    ".roadmap-label-heading{background:" + alphaHex(t.surface2, .76) + "}",
    ".roadmap-label-heading>strong{margin-top:0;color:" + t.secondary + ";font:700 9px/1.2 " + t.metadataStack + ";letter-spacing:.08em}",
    ".roadmap-label-gates{justify-content:flex-start;padding-top:20px;border-bottom:0;background:" + alphaHex(t.surface2, .54) + "}",
    ".roadmap-timeline-column{position:relative;overflow:hidden}",
    ".roadmap-phase-track{position:relative;border-bottom:1px solid " + t.rule + ";background:" + alphaHex(t.surface2, .42) + "}",
    ".roadmap-phase-band{position:absolute;top:4px;height:40px;display:flex;min-width:0;flex-direction:column;justify-content:center;padding:5px 10px;border:1px solid;border-top-width:3px;border-radius:" + t.radiusSm + "px;background:" + alphaHex(t.background, .96) + ";overflow:hidden}",
    ".roadmap-phase-band strong{display:block;min-width:0;color:" + t.text + ";font-size:9.5px;line-height:1.08;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".roadmap-phase-band small{margin-top:4px;color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + ";white-space:nowrap}",
    ".roadmap-week-track.viz-gantt-axis{position:relative;inset:auto;z-index:3;display:flex;border-bottom:1px solid " + t.rule + ";background:" + alphaHex(t.surface, .74) + "}",
    ".roadmap-week-track.viz-gantt-axis span{position:static;top:auto;display:flex;min-width:0;flex:1 1 0;align-items:center;justify-content:center;border-left:1px solid " + alphaHex(t.rule, .6) + ";color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + ";text-align:center}",
    ".roadmap-week-track.viz-gantt-axis span:first-child{border-left:0}",
    ".roadmap-workstream-row{position:relative;min-width:0;border-bottom:1px solid " + alphaHex(t.rule, .76) + ";background:" + alphaHex(t.surface, .46) + "}",
    ".roadmap-workstream-row:nth-child(even){background:" + alphaHex(t.surface2, .2) + "}",
    ".roadmap-week-grid{position:absolute;inset:0;z-index:1;display:flex;pointer-events:none}",
    ".roadmap-grid-cell{flex:1 1 0;border-left:1px solid " + alphaHex(t.rule, .5) + "}",
    ".roadmap-grid-cell:first-child{border-left:0}",
    ".roadmap-workstream-bar{position:absolute;z-index:2;top:50%;height:18px;display:flex;align-items:center;justify-content:flex-end;padding:0 7px;border:1px solid;border-radius:999px;color:" + t.background + ";overflow:hidden;transform:translateY(-50%)}",
    ".roadmap-workstream-bar small{font:700 8px/1 " + t.metadataStack + ";white-space:nowrap}",
    ".roadmap-gate-outcomes{position:relative;border-bottom:0;background:" + alphaHex(t.surface2, .42) + "}",
    ".roadmap-gate-card{position:absolute;top:0;height:78px;display:flex;align-items:flex-start;justify-content:center;padding:34px 8px 6px;text-align:center}",
    ".roadmap-gate-card p{max-width:190px;margin:0;color:" + t.muted + ";font-size:8px;line-height:1.18;overflow-wrap:anywhere}",
    ".roadmap-gate-layer{position:absolute;inset:0;z-index:4;pointer-events:none}",
    ".roadmap-gate-line{position:absolute;top:48px;bottom:55px;border-left:1px solid}",
    ".roadmap-gate-line strong{position:absolute;left:-14px;bottom:-15px;display:grid;width:29px;height:29px;place-items:center;border:2px solid;border-color:inherit;border-radius:50%;background:" + t.background + ";color:" + t.text + ";font:700 8px/1 " + t.metadataStack + "}",
    ".roadmap-gate-line:last-child strong{left:-28px}",
    ".roadmap-stage-disclosure{display:grid;grid-template-columns:270px minmax(0,1fr);gap:18px;align-items:center;padding:9px 14px;border-left:3px solid " + t.warning + ";background:" + alphaHex(t.warning, .08) + "}",
    ".roadmap-stage-disclosure>span{color:" + t.warning + ";font:700 8px/1.12 " + t.metadataStack + ";letter-spacing:.075em}",
    ".roadmap-stage-disclosure>p{margin:0;color:" + t.muted + ";font-size:9.5px;line-height:1.28}",
    ".quadrant-grid{height:100%;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12px}",
    ".quadrant{padding:22px;border-top:3px solid " + t.primary + "}",
    ".quadrant:nth-child(2){border-top-color:" + t.warning + "}",
    ".quadrant:nth-child(3){border-top-color:" + t.positive + "}",
    ".quadrant:nth-child(4){border-top-color:" + t.critical + "}",
    ".quadrant span{color:" + t.muted + ";font:700 9px/1 " + t.metadataStack + "}",
    ".quadrant strong{display:block;margin-top:10px;font:700 19px/1.15 " + t.displayStack + "}",
    ".quadrant p{margin:12px 0 0;color:" + t.muted + ";font-size:11px;line-height:1.4}",
    ".client-dependencies-layout{height:100%;display:grid;grid-template-rows:92px minmax(0,1fr);gap:12px}",
    ".client-dependencies-summary{display:grid;grid-template-columns:116px 146px 146px minmax(0,1fr);gap:10px}",
    ".client-dependency-metric{display:flex;min-width:0;flex-direction:column;justify-content:space-between;padding:13px 14px;border:1px solid " + t.rule + ";border-top:3px solid " + t.primary + ";border-radius:" + t.radiusSm + "px;background:" + alphaHex(t.surface, .86) + "}",
    ".client-dependency-metric:nth-child(2){border-top-color:" + t.warning + "}",
    ".client-dependency-metric:nth-child(3){border-top-color:" + t.primary + "}",
    ".client-dependency-metric span{color:" + t.muted + ";font:700 8px/1.15 " + t.metadataStack + ";letter-spacing:.04em}",
    ".client-dependency-metric strong{font:700 27px/.95 " + t.displayStack + "}",
    ".client-dependencies-principle{display:flex;min-width:0;flex-direction:column;justify-content:center;padding:14px 18px;border-left:3px solid " + t.primary + ";background:" + alphaHex(t.surface2, .72) + "}",
    ".client-dependencies-principle strong{font-size:11.5px;line-height:1.28}",
    ".client-dependencies-principle p{margin:6px 0 0;color:" + t.muted + ";font-size:9.5px;line-height:1.3}",
    ".client-dependencies-table{min-height:0;overflow:hidden;display:grid;align-content:start;background:" + alphaHex(t.surface, .88) + "}",
    ".client-dependencies-head,.client-dependency-row,.client-dependency-group{display:grid;grid-template-columns:minmax(0,1fr) 210px 280px;align-items:center}",
    ".client-dependencies-head{min-height:37px;padding:0 16px;border-bottom:1px solid " + t.rule + ";color:" + t.muted + ";font:700 8.5px/1 " + t.metadataStack + ";letter-spacing:.1em;text-transform:uppercase}",
    ".client-dependencies-head span:nth-child(2){padding-left:12px}",
    ".client-dependencies-head span:last-child{text-align:right}",
    ".client-dependency-group{min-height:27px;padding:0 16px;border-top:1px solid " + alphaHex(t.primary, .38) + ";border-bottom:1px solid " + t.rule + ";background:" + alphaHex(t.surface2, .78) + "}",
    ".client-dependency-group:first-of-type{border-top:0}",
    ".client-dependency-group strong{grid-column:1/3;color:" + t.secondary + ";font:700 8.5px/1 " + t.metadataStack + ";letter-spacing:.09em}",
    ".client-dependency-group span{justify-self:end;color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + "}",
    ".client-dependency-row{min-height:50px;padding:6px 16px;border-bottom:1px solid " + t.rule + "}",
    ".client-dependency-row:last-child{border-bottom:0}",
    ".client-dependency-name{min-width:0;padding-right:20px}",
    ".client-dependency-name>strong{display:block;font-size:11.5px;line-height:1.22;overflow-wrap:anywhere}",
    ".client-dependency-detail{margin:3px 0 0;color:" + t.muted + ";font-size:8.5px;line-height:1.2}",
    ".client-dependency-name .inline-sources{margin-top:3px}",
    // Checklist box in the status column: every row is a client-side input by
    // definition, so the state reads as an unchecked/checked box.
    ".client-dependency-checkbox{position:relative;display:block;width:16px;height:16px;border:1.5px solid " + alphaHex(t.secondary, .55) + ";border-radius:4px;background:" + alphaHex(t.surface2, .5) + "}",
    ".client-dependency-checkbox.is-checked{border-color:" + t.positive + ";background:" + t.positive + "}",
    ".client-dependency-checkbox.is-checked::after{content:'';position:absolute;left:5px;top:2px;width:4px;height:8px;border:solid " + t.background + ";border-width:0 2px 2px 0;transform:rotate(45deg)}",
    ".client-dependency-owner{min-width:0;padding:0 12px;display:flex;align-items:center}",
    ".client-dependency-owner strong{display:block;font-size:9.5px;line-height:1.2;overflow-wrap:anywhere}",
    ".client-dependency-state{display:flex;align-items:center;justify-content:flex-end}",
    ".client-dependencies-empty{display:flex;height:100%;flex-direction:column;align-items:center;justify-content:center;padding:40px;text-align:center}",
    ".client-dependencies-empty strong{font:700 25px/1.15 " + t.displayStack + "}",
    ".client-dependencies-empty p{max-width:620px;margin:14px 0 0;color:" + t.muted + ";font-size:12px;line-height:1.45}",
    ".function-price-layout{height:100%;display:block}",
    ".function-price-table{height:100%;min-height:0;overflow:hidden;display:grid;align-content:start;background:" + alphaHex(t.surface, .9) + "}",
    ".scenario-banner{padding:9px 12px;border-bottom:1px solid " + t.rule + ";color:" + t.warning + ";font:700 9px/1.2 " + t.metadataStack + ";letter-spacing:.02em}",
    ".currency-note{padding:9px 12px;border-bottom:1px solid " + t.rule + ";color:" + t.muted + ";font:700 9px/1.2 " + t.metadataStack + "}",
    ".function-price-head,.function-price-row{display:grid;grid-template-columns:44px 180px 250px minmax(0,1fr) 110px;gap:14px;align-items:center;padding:0 16px}",
    ".function-price-head{min-height:38px;border-bottom:1px solid " + t.rule + ";background:" + alphaHex(t.surface2, .72) + ";color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.08em;text-transform:uppercase}",
    ".function-price-head span:last-child{justify-self:stretch;text-align:center}",
    ".function-price-row{min-height:58px;border-bottom:1px solid " + t.rule + "}",
    ".function-price-row:last-child{border-bottom:0}",
    ".function-price-index{color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + ";letter-spacing:.04em}",
    ".function-price-epic{min-width:0;color:" + t.muted + ";font:700 8.5px/1.24 " + t.metadataStack + ";overflow-wrap:anywhere}",
    ".function-price-task{min-width:0;font-size:10.5px;line-height:1.22;overflow-wrap:anywhere}",
    ".function-price-subtask{min-width:0;color:" + t.muted + ";font-size:8.75px;line-height:1.25;overflow-wrap:anywhere}",
    ".function-price-deadline{display:block;justify-self:stretch;color:" + t.secondary + ";font:700 8.5px/1.2 " + t.metadataStack + ";letter-spacing:.02em;text-align:center}",
    ".function-price-table-compact .function-price-head{min-height:32px}",
    ".function-price-table-compact .function-price-row{min-height:42px}",
    ".function-price-table-compact .function-price-task{font-size:9.5px}",
    ".function-price-table-compact .function-price-subtask{font-size:8px;line-height:1.15}",
    ".function-price-table-dense{grid-template-rows:30px;grid-auto-rows:minmax(0,1fr);align-content:stretch}",
    ".function-price-table-dense .function-price-head{min-height:0;height:auto;padding-top:2px;padding-bottom:2px}",
    ".function-price-table-dense .function-price-row{min-height:0;height:auto;padding-top:2px;padding-bottom:2px}",
    ".function-price-table-dense .function-price-epic,.function-price-table-dense .function-price-task,.function-price-table-dense .function-price-subtask,.function-price-table-dense .function-price-deadline{font-size:8px;line-height:1.12}",
    ".team-capacity-layout{height:100%;display:grid;grid-template-rows:88px minmax(0,1fr) 58px;gap:12px}",
    ".team-capacity-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}",
    ".team-capacity-metric{position:relative;overflow:hidden;padding:13px 16px 11px;border:1px solid " + t.rule + ";border-top:3px solid " + t.primary + ";border-radius:" + t.radiusSm + "px;background:" + alphaHex(t.surface, .88) + "}",
    ".team-capacity-metric::after{content:'';position:absolute;right:-24px;bottom:-36px;width:92px;height:92px;border:1px solid " + alphaHex(t.primary, .16) + ";border-radius:50%}",
    ".team-capacity-metric span{position:relative;z-index:1;display:block;color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.08em;text-transform:uppercase}",
    ".team-capacity-metric strong{position:relative;z-index:1;display:block;margin-top:11px;font:700 25px/1 " + t.displayStack + ";letter-spacing:-.025em}",
    ".team-capacity-metric small{position:relative;z-index:1;display:block;margin-top:5px;color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.04em}",
    ".team-capacity-metric.is-peak{border-top-color:" + t.primary + ";background:" + alphaHex(t.primary, .08) + "}",
    ".team-capacity-metric.is-peak strong{color:" + t.secondary + "}",
    ".team-capacity-table{min-height:0;overflow:hidden;display:flex;flex-direction:column}",
    ".team-capacity-disclosure{flex:0 0 29px;display:flex;align-items:center;padding:0 14px;border-bottom:1px solid " + t.rule + ";color:" + t.secondary + ";background:" + alphaHex(t.primary, .055) + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.075em;text-transform:uppercase}",
    ".team-capacity-head,.team-capacity-row,.team-capacity-total{display:grid;grid-template-columns:2.1fr .65fr .65fr 1fr 1.05fr;column-gap:0;align-items:center;padding:0 14px}",
    ".team-capacity-head{flex:0 0 35px;border-bottom:1px solid " + t.rule + ";color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.08em;text-transform:uppercase}",
    ".team-capacity-row{flex:1 1 0;min-height:49px;border-bottom:1px solid " + t.rule + "}",
    ".team-capacity-role{min-width:0}",
    ".team-capacity-role strong{display:block;font-size:10.5px;line-height:1.16;overflow-wrap:anywhere}",
    ".team-capacity-role small{display:block;margin-top:4px;color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.03em}",
    ".team-quantity,.team-duration,.team-rate,.team-amount{text-align:right}",
    ".team-rate{color:" + t.muted + "}",
    ".team-amount{font-weight:700}",
    ".team-capacity-total{flex:0 0 48px;background:" + alphaHex(t.surface2, .7) + "}",
    ".team-capacity-total-label{grid-column:1/5}",
    ".team-capacity-total-label strong{display:block;font:700 8.5px/1 " + t.metadataStack + ";letter-spacing:.045em;text-transform:uppercase}",
    ".team-capacity-total-label small{display:block;margin-top:4px;color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + "}",
    ".team-cost-total{grid-column:5;text-align:right}",
    ".team-capacity-note{display:grid;grid-template-columns:180px 1fr auto;gap:16px;align-items:center;padding:10px 14px;border-left:3px solid " + t.primary + ";background:" + alphaHex(t.surface2, .76) + "}",
    ".team-capacity-note>span{color:" + t.secondary + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.09em}",
    ".team-capacity-note>strong{font-size:9px;line-height:1.25}",
    ".team-capacity-note>small{color:" + t.muted + ";font:700 8px/1.2 " + t.metadataStack + ";text-align:right}",
    ".project-price-layout{height:100%;display:grid;grid-template-rows:minmax(0,1fr) 82px;gap:12px}",
    ".project-price-ledger{min-height:0;overflow:hidden;display:flex;flex-direction:column;border:1px solid " + t.rule + ";border-radius:" + t.radiusMd + "px;background:" + alphaHex(t.surface, .94) + "}",
    ".project-price-summary{flex:0 0 68px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center;padding:0 18px;border-bottom:1px solid " + t.rule + ";background:linear-gradient(90deg," + t.surface2 + "," + t.surface + ")}",
    ".project-price-summary-copy{min-width:0}",
    ".project-price-summary-copy span{display:block;color:" + t.secondary + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.1em;text-transform:uppercase}",
    ".project-price-summary-copy strong{display:block;margin-top:7px;font:700 20px/1.05 " + t.displayStack + ";letter-spacing:-.02em}",
    ".project-price-summary-meta{display:flex;align-items:center;gap:10px;color:" + t.muted + ";font:700 8.5px/1 " + t.metadataStack + ";white-space:nowrap}",
    ".project-price-summary-meta span{padding:7px 10px;border:1px solid " + alphaHex(t.primary, .24) + ";border-radius:999px;background:" + alphaHex(t.background, .72) + "}",
    ".project-price-scenario{flex:0 0 30px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid " + t.rule + ";border-left:3px solid " + t.warning + ";color:" + t.warning + ";background:" + alphaHex(t.warning, .055) + ";font:700 8px/1.2 " + t.metadataStack + ";letter-spacing:.035em}",
    ".project-price-head,.project-price-row,.project-price-total{display:grid;grid-template-columns:minmax(0,38fr) minmax(80px,10fr) minmax(105px,13fr) minmax(150px,20fr) minmax(155px,19fr);column-gap:0;align-items:stretch}",
    ".project-price-head{flex:0 0 40px;border-bottom:1px solid " + t.rule + ";background:" + alphaHex(t.surface2, .7) + ";color:" + t.muted + ";font:700 8px/1.15 " + t.metadataStack + ";letter-spacing:.07em;text-transform:uppercase}",
    ".project-price-cell{min-width:0;display:flex;align-items:center;padding:0 13px;border-left:1px solid " + alphaHex(t.rule, .82) + ";overflow-wrap:anywhere}",
    ".project-price-cell:first-child{border-left:0}",
    ".project-price-head .project-price-cell:nth-child(n+2){justify-content:flex-end;text-align:right}",
    ".project-price-rows{min-height:0;flex:1 1 auto;display:flex;flex-direction:column}",
    ".project-price-row{flex:1 1 0;min-height:47px;border-bottom:1px solid " + t.rule + ";font-size:9.5px;line-height:1.2}",
    ".project-price-row:nth-child(even){background:" + alphaHex(t.surface2, .22) + "}",
    ".project-price-rows-single .project-price-row{flex:0 0 82px}",
    ".project-price-item{gap:10px;font-weight:700}",
    ".project-price-item-index{flex:0 0 24px;color:" + t.secondary + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.04em}",
    ".project-price-number{justify-content:flex-end;text-align:right;font:700 9px/1 " + t.metadataStack + ";font-variant-numeric:tabular-nums}",
    ".project-price-unknown{justify-content:flex-end;color:" + t.muted + ";font-size:8px;line-height:1.15;text-align:right}",
    ".project-price-total{flex:0 0 60px;border-top:2px solid " + t.primary + ";background:" + alphaHex(t.primary, .095) + "}",
    ".project-price-total-label{grid-column:1/5;display:flex;min-width:0;align-items:center;justify-content:space-between;gap:18px;padding:0 16px}",
    ".project-price-total-label strong{font:700 11px/1.1 " + t.displayStack + "}",
    ".project-price-total-label .inline-sources{margin:0}",
    ".project-price-total-value{grid-column:5;display:flex;min-width:0;flex-direction:column;align-items:flex-end;justify-content:center;padding:0 13px;border-left:1px solid " + alphaHex(t.rule, .82) + ";text-align:right}",
    ".project-price-total-value strong{font:700 21px/1 " + t.displayStack + ";letter-spacing:-.025em;white-space:nowrap;font-variant-numeric:tabular-nums}",
    ".project-price-total-value small{margin-top:5px;color:" + t.warning + ";font:700 8px/1 " + t.metadataStack + ";white-space:nowrap}",
    ".project-price-disclosure{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));overflow:hidden;border:1px solid " + t.rule + ";border-radius:" + t.radiusSm + "px;background:" + alphaHex(t.surface2, .64) + "}",
    ".project-price-term{min-width:0;display:flex;flex-direction:column;justify-content:center;padding:10px 14px;border-left:1px solid " + t.rule + "}",
    ".project-price-term:first-child{border-left:0}",
    ".project-price-term span{color:" + t.muted + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.075em;text-transform:uppercase}",
    ".project-price-term strong{margin-top:7px;font-size:8.5px;line-height:1.2;overflow-wrap:anywhere}",
    ".project-price-term.is-warning strong{color:" + t.warning + "}",
    ".payment-layout{height:100%;display:grid;grid-template-rows:1fr auto;gap:14px}",
    ".payment-head,.payment-row{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(150px,.7fr) minmax(170px,.8fr);gap:18px;align-items:center}",
    ".payment-head{padding:10px 16px;color:" + t.muted + ";font:700 9px/1 " + t.metadataStack + "}",
    ".payment-head>span:not(:first-child){text-align:right}",
    ".payment-row{min-height:85px;padding:13px 16px;border-top:1px solid " + t.rule + "}",
    ".payment-row strong{font-size:13px}",
    ".payment-row p{margin:5px 0 0;color:" + t.muted + ";font-size:10px;line-height:1.32}",
    ".payment-row>span{font:700 11px/1.25 " + t.metadataStack + ";text-align:right}",
    // Cumulative indicator: a strip under each stage fills further after
    // every accepted payment and reaches 100% on the final one.
    ".payment-progress{grid-column:1/-1;height:5px;margin-top:10px;border-radius:999px;background:" + alphaHex(t.primary, .12) + ";overflow:hidden}",
    ".payment-progress>span{display:block;height:100%;border-radius:999px;background:" + alphaHex(t.primary, .78) + "}",
    ".payment-total{display:grid;grid-template-columns:1fr auto auto;gap:24px;align-items:center;padding:16px 18px;border:1px solid " + t.rule + ";border-radius:" + t.radiusSm + "px}",
    ".payment-total span{color:" + t.muted + ";font-size:11px}",
    ".payment-total strong{font:700 18px/1 " + t.displayStack + "}",
    ".decision-layout{height:100%;display:grid;grid-template-columns:1.25fr .75fr;gap:22px}",
    ".decision-list{display:grid;align-content:start}",
    ".decision-row{display:grid;grid-template-columns:.85fr 1.15fr 1.15fr .55fr;gap:18px;align-items:center;min-height:92px;padding:14px 16px;border-top:1px solid " + t.rule + "}",
    ".decision-row:first-child{border-top:0}",
    ".decision-row span{color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + "}",
    ".decision-row strong{font-size:13px;line-height:1.35}",
    ".decision-row p{margin:0;color:" + t.muted + ";font-size:11px;line-height:1.35}",
    ".next-action{min-height:0;padding:24px;display:flex;flex-direction:column}",
    ".next-action strong{font:700 28px/1.14 " + t.displayStack + "}",
    ".next-action>p{margin:14px 0 16px;color:" + t.muted + ";font-size:11px;line-height:1.42}",
    ".next-action .status{border-color:" + t.primary + ";color:" + t.secondary + "}",
    ".close-blockers{min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:6px;align-content:start;padding-top:12px;border-top:1px solid " + t.rule + "}",
    ".close-blocker{min-width:0;padding:7px 8px;border-left:2px solid " + t.warning + ";background:" + alphaHex(t.warning, .06) + "}",
    ".close-blocker>span{display:block;color:" + t.warning + ";font:700 8px/1 " + t.metadataStack + ";letter-spacing:.06em}",
    ".close-blocker>strong{display:block;margin-top:4px;font:700 8.5px/1.2 " + t.bodyStack + ";overflow-wrap:anywhere}",
    ".close-assumptions{padding-top:12px;border-top:1px solid " + t.rule + "}",
    ".close-assumptions>span{color:" + t.secondary + ";font:700 9px/1 " + t.metadataStack + ";letter-spacing:.08em}",
    ".close-assumptions p{margin:7px 0 0;font-size:10px;line-height:1.2}",
    ".layout-cover_asymmetric{display:flex;flex-direction:column}",
    ".layout-cover_asymmetric .page-header{flex:0 0 34px}",
    ".layout-cover_asymmetric .page-title-row{flex:0 0 auto;min-height:146px;padding-top:30px}",
    ".layout-cover_asymmetric .page-kicker{display:none}",
    ".layout-cover_asymmetric .page-body{flex:1 1 auto;height:auto;min-height:0;margin-bottom:42px}",
    ".layout-cover_asymmetric .page-title{max-width:1040px;font-size:68px;line-height:1;letter-spacing:-.045em}",
    ".layout-cover_asymmetric .page-title.cover-title-medium{font-size:54px;line-height:1.02}",
    ".layout-cover_asymmetric .page-title.cover-title-long{font-size:43px;line-height:1.05;letter-spacing:-.035em}",
    ".layout-cover_asymmetric .page-title.cover-title-extra-long{font-size:34px;line-height:1.08;letter-spacing:-.025em}",
    ".layout-chapter_opener .page-title-row{min-height:128px}",
    ".layout-chapter_opener .page-title{font-size:34px;color:" + t.muted + "}",
    ".layout-evidence_table .page-title{max-width:900px}",
    ".layout-commercial_hero .page-title{font-size:40px}",
    ".layout-decision_close::before{background:radial-gradient(circle," + alphaHex(t.decorativeTertiary, .16) + " 0%,transparent 68%)}",
    /* Udevs proposal visual system: source-matched typography, spacing,
       surfaces, and accent hierarchy. Data and semantic geometry stay intact. */
    'html,body{font-family:"Work Sans",Arial,sans-serif;color:' + t.text + "}",
    '.page,.kp-page{padding:48px 72px 34px;font-family:"Work Sans",Arial,sans-serif}',
    ".page-header{height:24px;border-bottom:0;color:" + t.text + ';font:600 13px/1 "Work Sans",Arial,sans-serif;letter-spacing:0;text-transform:uppercase}',
    ".page-header>strong{color:" + t.muted + ';font:400 12px/1 "Work Sans",Arial,sans-serif;letter-spacing:.03em}',
    ".page-title-row{position:relative;min-height:132px;padding-top:42px;align-items:flex-start}",
    ".page-title-row::before{content:'';position:absolute;left:0;top:20px;width:36px;height:5px;border-radius:0;background:" + t.primary + "}",
    ".page-title-row>div{max-width:1030px}",
    ".page-kicker{display:none}",
    '.page-title{max-width:1040px;font-family:"Sora",Arial,sans-serif;font-size:38px;line-height:1.08;font-weight:800;letter-spacing:-.02em;text-wrap:balance}',
    ".page-badge{max-width:300px;margin-top:-29px;padding:0;border:0;border-radius:0;background:transparent;color:" + t.muted + ';font:500 11px/1.25 "Work Sans",Arial,sans-serif;letter-spacing:0;text-transform:none}',
    ".page-body{height:710px}",
    '.page-footer{left:72px;right:72px;bottom:18px;height:14px;padding:0;border:0;opacity:0;font:400 9px/1 "Work Sans",Arial,sans-serif}',
    ".panel,.panel-soft,.viz-canvas{border-color:" + t.rule + ";border-radius:14px;background:" + t.surface + ";box-shadow:0 16px 34px -24px " + alphaHex(t.primary, .38) + "}",
    ".eyebrow{font-family:\"Work Sans\",Arial,sans-serif;letter-spacing:.12em}",
    ".source-chip,.status{font-family:\"Work Sans\",Arial,sans-serif}",
    ".semantic-note,.org-evidence,.team-capacity-note,.roadmap-stage-disclosure{border-left-color:" + t.primary + ";background:" + alphaHex(t.surface2, .72) + "}",

    ".layout-cover_asymmetric{box-shadow:inset 0 -4px " + t.primary + "}",
    ".layout-cover_asymmetric .page-header{flex:0 0 24px}",
    ".layout-cover_asymmetric .page-title-row{flex:0 0 360px;min-height:360px;padding-top:170px}",
    ".layout-cover_asymmetric .page-title-row::before{display:none}",
    ".layout-cover_asymmetric .page-title{max-width:1050px;color:" + t.primary + ';font-family:"Sora",Arial,sans-serif;font-size:68px;line-height:1.05;font-weight:800;letter-spacing:-.02em}',
    ".layout-cover_asymmetric .page-title.cover-title-medium{font-size:62px;line-height:1.06}",
    ".layout-cover_asymmetric .page-title.cover-title-long{font-size:52px;line-height:1.06}",
    ".layout-cover_asymmetric .page-title.cover-title-extra-long{font-size:44px;line-height:1.08}",
    ".layout-cover_asymmetric .page-badge{margin-top:0}",
    ".layout-cover_asymmetric .page-body{height:auto;margin:0 0 42px}",
    ".cover-grid{height:100%;grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) 112px;gap:16px}",
    ".cover-main{grid-column:1;position:relative;overflow:visible;padding:20px 0;justify-content:center;border:0;border-radius:0;background:transparent;box-shadow:none}",
    ".cover-main::after{display:none}",
    ".cover-main-head{position:static;margin-bottom:20px}",
    ".cover-main-head .eyebrow{display:flex;align-items:center;gap:8px;color:" + t.primary + ';font:600 13px/1 "Work Sans",Arial,sans-serif;letter-spacing:.14em}',
    ".cover-main-head .eyebrow::before{content:'';width:6px;height:6px;border-radius:50%;background:" + t.primary + "}",
    ".cover-sequence{display:none}",
    '.cover-promise{max-width:760px;margin:0;color:' + t.muted + ';font:400 17px/1.65 "Work Sans",Arial,sans-serif;letter-spacing:0;text-wrap:pretty}',
    ".cover-main-copy{display:none}",
    ".cover-side{display:none}",
    ".cover-meta,.cover-meta.has-budget{grid-column:1;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}",
    ".cover-meta .metric{min-height:112px;display:flex;flex-direction:column;justify-content:center;padding:18px 22px;border:1px solid " + t.rule + ";border-radius:14px;background:" + t.surface + ";box-shadow:0 12px 28px -20px " + alphaHex(t.primary, .34) + "}",
    ".cover-meta .metric::before{display:none}",
    ".cover-meta .metric strong,.cover-meta.has-budget .metric strong{order:-1;max-width:100%;margin:0;color:" + t.primary + ';font:800 25px/1.1 "Sora",Arial,sans-serif}',
    ".cover-meta .metric span{margin-top:8px;color:" + t.muted + ';font:400 12.5px/1.2 "Work Sans",Arial,sans-serif;letter-spacing:0;text-transform:none}',
    ".cover-meta .inline-sources{margin-top:6px}",

    ".viz-canvas{background:" + alphaHex(t.surface, .96) + "}",
    ".viz-mindmap,.viz-bpmn{background:" + alphaHex(t.surface, .96) + "!important}",
    ".viz-node,.viz-mindmap-node,.viz-bpmn-node{background:" + t.surface + ";border-radius:10px;box-shadow:0 6px 16px -13px " + alphaHex(t.primary, .4) + "}",
    ".viz-mindmap .viz-node-core{color:" + t.textOnAccent + ";background:" + t.primary + ";border-color:" + t.primary + ";box-shadow:none}",
    ".viz-mindmap .viz-node-domain{border:1px solid " + t.rule + ";border-left:4px solid " + t.primary + ";background:" + t.surface + "}",
    ".viz-mindmap .viz-node-capability,.viz-mindmap .viz-node-subfunction{border-color:" + t.rule + ";background:" + t.surface + "}",
    ".viz-bpmn-lane:nth-child(odd){background:" + alphaHex(t.surface2, .64) + "}",
    ".viz-bpmn-lane:nth-child(even){background:" + alphaHex(t.primary, .07) + "}",
    ".viz-bpmn-lane-label{background:transparent}",
    ".viz-bpmn-node-risk{background:" + t.surface + "}",

    ".org-chart{background:" + alphaHex(t.surface, .9) + "}",
    ".org-node{border-color:" + t.rule + ";border-radius:10px;background:" + t.surface + ";box-shadow:0 8px 20px -16px " + alphaHex(t.primary, .32) + "}",
    ".org-root,.org-manager-node{color:" + t.textOnAccent + ";border-color:" + t.primary + ";background:" + t.primary + "}",
    ".org-root small,.org-root strong,.org-root p,.org-manager-node small,.org-manager-node strong,.org-manager-node p{color:" + t.textOnAccent + "}",
    ".org-branch-node{border-top-color:" + t.primary + "}",

    ".client-dependencies-summary{grid-template-columns:116px 146px 146px minmax(0,1fr)}",
    ".client-dependency-metric{border:1px solid " + t.rule + ";border-radius:10px;background:" + t.surface + "}",
    ".client-dependency-metric:nth-child(2){color:" + t.textOnAccent + ";border-color:" + t.primary + ";background:" + t.primary + "}",
    ".client-dependency-metric:nth-child(2) span,.client-dependency-metric:nth-child(2) strong{color:" + t.textOnAccent + "}",
    ".client-dependencies-principle{border-left:0;background:transparent}",
    ".client-dependencies-table{border:0;background:transparent;box-shadow:none}",
    ".client-dependencies-head{border:0;background:transparent}",
    ".client-dependency-group{border:0;background:transparent}",
    ".client-dependency-row{margin:2px 0;padding:7px 16px;border:1px solid " + t.rule + ";border-radius:10px;background:" + t.surface + "}",
    ".client-dependency-checkbox{width:auto;height:auto;padding:6px 12px;border:0;border-radius:999px;color:" + t.primary + ";background:" + alphaHex(t.primary, .16) + ';font:500 11px/1 "Work Sans",Arial,sans-serif;white-space:nowrap}',
    ".client-dependency-checkbox.is-checked{color:" + t.textOnAccent + ";background:" + t.primary + "}",
    ".client-dependency-checkbox.is-checked::after{display:none}",

    ".function-price-table{border:0;background:transparent;box-shadow:none}",
    ".function-price-head{border-bottom:1px solid " + t.rule + ";background:transparent}",
    ".function-price-row{border-bottom:1px solid " + t.rule + "}",

    ".team-capacity-metric{border:1px solid " + t.rule + ";border-radius:10px;background:" + t.surface + "}",
    ".team-capacity-metric::after{display:none}",
    ".team-capacity-metric.is-peak{color:" + t.textOnAccent + ";border-color:" + t.primary + ";background:" + t.primary + "}",
    ".team-capacity-metric.is-peak span,.team-capacity-metric.is-peak strong,.team-capacity-metric.is-peak small{color:" + t.textOnAccent + "}",
    ".team-capacity-table{border:0;background:transparent;box-shadow:none}",
    ".team-capacity-disclosure{display:none}",
    ".team-capacity-row{margin:2px 0;border:0;border-radius:10px;background:" + t.surface + "}",
    ".team-capacity-total{color:" + t.textOnAccent + ";border-radius:10px;background:" + t.primary + "}",
    ".team-capacity-total *,.team-capacity-total-label small{color:" + t.textOnAccent + ";border-color:transparent;background:transparent}",

    ".roadmap-stage-thesis,.roadmap-stage-disclosure{border-left-color:" + t.primary + "}",
    ".roadmap-stage-chart{border-color:" + t.rule + ";background:" + t.surface + "}",
    ".roadmap-label-column,.roadmap-label-heading,.roadmap-label-gates,.roadmap-phase-track,.roadmap-gate-outcomes{background:" + alphaHex(t.surface2, .68) + "}",
    ".roadmap-workstream-row,.roadmap-workstream-row:nth-child(even){background:" + alphaHex(t.surface, .78) + "}",

    ".payment-layout>.panel{border:0;background:transparent;box-shadow:none}",
    ".payment-head{padding:10px 17px 8px;text-transform:uppercase}",
    ".payment-row{min-height:64px;margin:10px 0 0;padding:12px 16px;border:1px solid " + t.rule + ";border-radius:12px;background:" + alphaHex(t.surface2, .72) + "}",
    ".payment-row:last-child{color:" + t.textOnAccent + ";border-color:" + t.primary + ";background:" + t.primary + "}",
    ".payment-row:last-child p,.payment-row:last-child>span{color:" + t.textOnAccent + "}",
    ".payment-progress{display:none}",
    ".payment-total{padding:20px 0 0;border:0;border-top:1px solid " + t.rule + ";border-radius:0;background:transparent}",
    ".payment-total strong{color:" + t.primary + ';font:800 31px/1.15 "Sora",Arial,sans-serif}',

    /* Reference-detail pass: source copy hierarchy, flatter backgrounds,
       and page-specific table/architecture treatments. */
    ".page-badge{visibility:hidden}",
    '.page-summary{max-width:920px;margin:8px 0 0;color:' + t.muted + ';font:400 14.5px/1.45 "Work Sans",Arial,sans-serif;text-wrap:pretty}',

    ".layout-cover_asymmetric .page-title-row{flex-basis:360px;min-height:360px;padding-top:112px}",
    ".layout-cover_asymmetric .page-title{color:" + t.text + "}",
    ".cover-title-prefix{color:" + t.text + "}",
    ".cover-title-project{color:" + t.primary + "}",
    '.cover-title-kicker{display:flex;align-items:center;gap:8px;margin-bottom:20px;color:' + t.primary + ';font:600 13px/1 "Work Sans",Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase}',
    ".cover-title-kicker::before{content:'';width:6px;height:6px;border-radius:50%;background:" + t.primary + "}",
    ".cover-main{justify-content:flex-start;padding:72px 0 20px}",
    ".cover-main-head{display:none}",
    '.cover-promise{max-width:880px;font-size:17px;line-height:1.62}',

    ".viz-bpmn .viz-node-gateway{overflow:visible!important}",
    ".viz-bpmn .viz-node-gateway::before{width:32px;height:32px}",
    ".viz-bpmn .viz-node-start_event,.viz-bpmn .viz-node-end_event{overflow:visible!important}",
    '.viz-bpmn [data-semantic-role="partner"]{--viz-node-color:#6D82AE!important;border-color:#6D82AE!important;background:#F8FAFF!important;color:' + t.text + "!important}",
    '.viz-bpmn-lane[data-semantic-role="partner"]{--viz-lane-color:#8EA0C5!important}',
    ".viz-bpmn .viz-edge-partner{stroke:#6D82AE!important}",
    ".viz-bpmn .viz-edge-risk,.viz-bpmn .viz-edge-positive{stroke:#526B9D!important}",
    '.viz-bpmn .viz-bpmn-node-risk{--viz-node-color:#526B9D!important;border-color:#526B9D!important;background:#F7F9FF!important;color:' + t.text + "!important}",
    '.viz-bpmn marker[id$="-partner"] path{fill:#6D82AE!important}',
    '.viz-bpmn marker[id$="-risk"] path,.viz-bpmn marker[id$="-positive"] path{fill:#526B9D!important}',
    '.viz-bpmn .viz-node-end_event{--viz-node-color:#526B9D!important;color:' + t.brandDeep + "!important}",
    ".viz-bpmn .viz-node-end_event::before{width:32px;height:32px;border:2px solid #526B9D;box-shadow:0 0 0 3px #FFFFFF,0 0 0 5px #9DB2DD;background:#EEF3FF}",
    '.viz-bpmn .viz-node-end_event span{color:' + t.brandDeep + ';font-weight:600}',
    '.viz-bpmn .viz-node-gateway span{position:absolute;left:50%;top:45px;grid-row:auto!important;z-index:2;width:auto;max-width:80px;padding:3px 6px;border:1px solid #D7E1F4;border-radius:999px;background:#FFFFFF;color:#526B9D;font:600 10.5px/1 "Work Sans",Arial,sans-serif;box-shadow:0 5px 14px -10px #526B9D;transform:translateX(-50%)}',
    '.viz-bpmn .viz-bpmn-edge-label{border-color:#AFC0E2!important;background:#F7F9FF!important;color:#425B8E!important;font-weight:600}',

    '.page[data-page-kind="architecture"] .semantic-layout{justify-content:center;gap:0}',
    '.page[data-page-kind="architecture"] .semantic-note{display:none}',
    ".viz-architecture{overflow:visible;border:0!important;border-radius:0;background:transparent!important;box-shadow:none!important}",
    ".viz-architecture-legend{display:none}",
    ".viz-architecture-layer,.viz-architecture-layer:nth-child(even){display:block;border:0;background:transparent}",
    ".viz-architecture-layer-label{position:absolute;left:0;right:0;top:0;height:24px;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:4px;padding:0;border:0}",
    '.viz-architecture-layer-label small,.viz-architecture-layer-label strong{margin:0;color:' + t.primary + ';font:600 10.5px/1 "Work Sans",Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase}',
    ".viz-architecture-layer-label small::after{content:' ·'}",
    ".viz-architecture .viz-node{padding:8px 16px!important;border:1px solid #E4E4E0!important;border-style:solid!important;border-radius:10px;background:" + t.surface2 + "!important;color:" + t.text + ';font:400 12.5px/1.25 "Work Sans",Arial,sans-serif;box-shadow:0 6px 16px -13px ' + alphaHex(t.primary, .25) + "!important}",
    '.viz-architecture .viz-node[data-node-type="application"]{border-color:' + t.primary + "!important;background:" + t.primary + "!important;color:" + t.textOnAccent + "!important;font-weight:700}",
    ".viz-architecture .viz-node .viz-badge{display:none}",
    ".viz-architecture .viz-edges{display:none}",
    ".viz-architecture-layer:not(:last-child)::after{content:'';position:absolute;left:50%;bottom:-1px;width:1px;height:12px;background:#C7C7C3;transform:translateX(-.5px)}",
    ".viz-architecture-layer:not(:last-child)::before{content:'';position:absolute;left:50%;bottom:-5px;border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid #C7C7C3;transform:translateX(-6px)}",

    '.page[data-page-kind="client_dependencies"] .client-dependencies-layout{grid-template-rows:54px minmax(0,1fr);gap:14px}',
    '.page[data-page-kind="client_dependencies"] .client-dependencies-summary{display:flex;align-items:stretch;gap:14px}',
    '.page[data-page-kind="client_dependencies"] .client-dependencies-principle{display:none}',
    '.page[data-page-kind="client_dependencies"] .client-dependency-metric{min-width:154px;height:54px;flex-direction:row;align-items:center;justify-content:flex-start;gap:6px;padding:10px 18px;border:1px solid ' + t.rule + ';border-radius:10px;box-shadow:0 6px 16px -13px ' + alphaHex(t.primary, .25) + "}",
    '.page[data-page-kind="client_dependencies"] .client-dependency-metric strong{order:-1;font:800 20px/1 "Sora",Arial,sans-serif}',
    '.page[data-page-kind="client_dependencies"] .client-dependency-metric span{font:400 12.5px/1.2 "Work Sans",Arial,sans-serif;letter-spacing:0}',
    '.page[data-page-kind="client_dependencies"] .client-dependencies-head,.page[data-page-kind="client_dependencies"] .client-dependency-row{grid-template-columns:2.2fr 1.6fr .9fr}',
    '.page[data-page-kind="client_dependencies"] .client-dependencies-head{min-height:34px;padding:7px 4px;border-bottom:0;font-size:11px}',
    '.page[data-page-kind="client_dependencies"] .client-dependency-group{display:flex;min-height:24px;align-items:flex-end;justify-content:space-between;padding:7px 4px 2px}',
    '.page[data-page-kind="client_dependencies"] .client-dependency-group strong{font-size:11.5px}',
    '.page[data-page-kind="client_dependencies"] .client-dependency-row{min-height:48px;margin:4px 0 0;padding:9px 14px;border:0;border-radius:10px;box-shadow:0 6px 16px -13px ' + alphaHex(t.primary, .2) + "}",
    '.page[data-page-kind="client_dependencies"] .client-dependency-name>strong{font-size:13.5px}',
    '.page[data-page-kind="client_dependencies"] .client-dependency-owner strong{color:' + t.muted + ';font-size:12.5px;font-weight:400}',
    '.page[data-page-kind="client_dependencies"] .client-dependency-checkbox{padding:4px 10px;color:' + t.brandDeep + ';background:' + alphaHex(t.primary, .16) + ';font-size:11.5px}',

    '.page[data-page-kind="team"] .team-capacity-layout{height:auto;display:grid;grid-template-rows:76px auto;align-content:start;gap:14px}',
    '.page[data-page-kind="team"] .team-capacity-note,.page[data-page-kind="team"] .team-capacity-disclosure{display:none}',
    '.page[data-page-kind="team"] .team-capacity-metrics{display:grid;gap:14px}',
    '.page[data-page-kind="team"] .team-capacity-metric{padding:12px 18px;border:0;border-radius:10px;box-shadow:0 6px 16px -13px ' + alphaHex(t.primary, .25) + "}",
    '.page[data-page-kind="team"] .team-capacity-metric span{font:400 12px/1.15 "Work Sans",Arial,sans-serif;letter-spacing:0;text-transform:none}',
    '.page[data-page-kind="team"] .team-capacity-metric strong{margin-top:6px;font:800 20px/1 "Sora",Arial,sans-serif}',
    '.page[data-page-kind="team"] .team-capacity-metric small{display:none}',
    '.page[data-page-kind="team"] .team-capacity-table{width:100%;height:auto;display:flex;overflow:visible;border:0;background:transparent;box-shadow:none}',
    '.page[data-page-kind="team"] .team-capacity-head,.page[data-page-kind="team"] .team-capacity-row,.page[data-page-kind="team"] .team-capacity-total{display:grid;grid-template-columns:2.1fr .65fr .65fr 1fr 1.05fr;column-gap:0;align-items:center;padding:0 14px}',
    '.page[data-page-kind="team"] .team-capacity-head{flex:0 0 34px;border-bottom:1px solid ' + t.rule + ';color:' + t.muted + ';font:700 10.5px/1 "Work Sans",Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase}',
    '.page[data-page-kind="team"] .team-capacity-head span:not(:first-child){text-align:right}',
    '.page[data-page-kind="team"] .team-capacity-row{flex:0 0 48px;min-height:48px;margin-top:6px;border:0;border-radius:10px;background:' + t.surface + ';box-shadow:0 6px 16px -13px ' + alphaHex(t.primary, .2) + "}",
    '.page[data-page-kind="team"] .team-capacity-role strong{font:700 13.5px/1.15 "Sora",Arial,sans-serif}',
    '.page[data-page-kind="team"] .team-capacity-role small{display:none}',
    '.page[data-page-kind="team"] .team-quantity,.page[data-page-kind="team"] .team-duration,.page[data-page-kind="team"] .team-rate,.page[data-page-kind="team"] .team-amount{font:600 12.5px/1 "Work Sans",Arial,sans-serif;text-align:right}',
    '.page[data-page-kind="team"] .team-rate{color:' + t.muted + '}',
    '.page[data-page-kind="team"] .team-amount{color:' + t.secondary + ';font-weight:700}',
    '.page[data-page-kind="team"] .team-capacity-total{flex:0 0 48px;margin-top:8px;border-radius:10px;color:' + t.textOnAccent + ';background:' + t.primary + '}',
    '.page[data-page-kind="team"] .team-capacity-total-label{grid-column:1/5}',
    '.page[data-page-kind="team"] .team-capacity-total-label strong{display:block;font:700 10px/1 "Work Sans",Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase}',
    '.page[data-page-kind="team"] .team-capacity-total-label small{display:block;margin-top:4px;color:' + alphaHex(t.textOnAccent, .82) + ';font:600 8.5px/1 "Work Sans",Arial,sans-serif}',
    '.page[data-page-kind="team"] .team-cost-total{grid-column:5;color:' + t.textOnAccent + ';font:800 14px/1 "Sora",Arial,sans-serif;text-align:right}',
    ...dynamicRules,
    // Chromium exports blurred shadows as soft-mask image layers. macOS
    // Quartz/PDFKit can composite those layers as opaque brand-color
    // rectangles, so keep shadows in HTML previews and flatten them only for
    // print/PDF. This rule intentionally comes after dynamic rules and uses
    // matching specificity for component-level !important declarations.
    "@media print{.proposal>.page,.proposal>.page::before,.proposal>.page::after,.proposal>.page *,.proposal>.page *::before,.proposal>.page *::after,.proposal>.kp-page,.proposal>.kp-page::before,.proposal>.kp-page::after,.proposal>.kp-page *,.proposal>.kp-page *::before,.proposal>.kp-page *::after{box-shadow:none!important}}",
  ];
  return css.join("\n");
}

function normalizeRendererInput(input) {
  const proposalPackage = input.proposalPackage || null;
  return {
    proposalModel: input.proposalModel || proposalPackage?.proposalModel || {},
    semanticModel: input.semanticModel || proposalPackage?.semanticModel || {},
    commercialLock: input.commercialLock || proposalPackage?.commercialLock || null,
    visualStyleProfile: input.visualStyleProfile || input.styleProfile || proposalPackage?.visualStyleProfile || {},
    presentationPlan: input.presentationPlan || proposalPackage?.presentationPlan || null,
    visualizationSpecs: input.visualizationSpecs || proposalPackage?.visualizationSpecs || [],
    prototypeUrl: safePrototypeUrl(input.prototypeUrl || input.appPrototype?.publicUrl || ""),
  };
}

function prototypeLinkLabel(locale = "en") {
  if (locale === "ru-RU") return "Открыть интерактивный прототип";
  if (locale === "uz-Latn") return "Interaktiv prototipni ochish";
  return "Open interactive prototype";
}

function safePrototypeUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function validatePlan(plan) {
  if (!plan || !Number.isInteger(plan.pageCount) || plan.pageCount < 2 || plan.pageCount > 50 || !Array.isArray(plan.pages) || plan.pages.length !== plan.pageCount) {
    throw rendererError("CONTRACT_PRESENTATION_PLAN_INVALID", "v5 renderer requires a validated adaptive PresentationPlan");
  }
  const numbers = plan.pages.map((page) => page.pageNumber);
  if (numbers.some((number, index) => number !== index + 1) || new Set(numbers).size !== plan.pageCount) {
    throw rendererError("CONTRACT_PRESENTATION_PLAN_INVALID", "PresentationPlan page numbers must be sequential from 1");
  }
  plan.pages.forEach((page) => validatePagePlan(page, plan.pageCount));
}

function validatePagePlan(pagePlan, totalPages = DEFAULT_TOTAL_PAGES) {
  const pageNumber = Number(pagePlan?.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > totalPages) {
    throw rendererError("CONTRACT_PRESENTATION_PLAN_INVALID", "Page number is outside the planned story contract");
  }
  const kind = pagePlan.kind || pagePlan.pageKind;
  const storyIndex = pageKindIndex(kind);
  if (storyIndex < 0) {
    throw rendererError("CONTRACT_PRESENTATION_PLAN_INVALID", "Page " + pagePlan.pageNumber + " has an unknown page kind");
  }
  if (pagePlan.intent && pagePlan.intent !== PAGE_INTENTS[storyIndex]) {
    throw rendererError("CONTRACT_PRESENTATION_PLAN_INVALID", "Page " + pagePlan.pageNumber + " has an incompatible page intent");
  }
  strictLayoutFamily(pagePlan.layoutFamily);
}

function indexVisualizationSpecs(specs, presentationPlan) {
  const map = new Map();
  for (const spec of Array.isArray(specs) ? specs : []) {
    const pageNumber = Number(spec?.pageNumber);
    if (map.has(pageNumber)) {
      throw rendererError("CONTRACT_VISUALIZATION_SPEC_INVALID", "Duplicate VisualizationSpec for page " + pageNumber);
    }
    map.set(pageNumber, spec);
  }
  const planned = new Map((presentationPlan?.pages || []).filter((page) => page.visualizationSpecId).map((page) => [Number(page.pageNumber), page.visualizationSpecId]));
  for (const [pageNumber, specId] of planned) {
    if (!map.has(pageNumber) || (map.get(pageNumber).visualizationSpecId || map.get(pageNumber).id) !== specId) {
      throw rendererError("CONTRACT_VISUALIZATION_SPEC_INVALID", "Missing VisualizationSpec for page " + pageNumber);
    }
  }
  for (const pageNumber of map.keys()) {
    if (!planned.has(pageNumber)) {
      throw rendererError("CONTRACT_VISUALIZATION_SPEC_INVALID", "VisualizationSpec is not permitted on page " + pageNumber);
    }
  }
  return map;
}

function pageKindIndex(kind = "") {
  const index = PAGE_KINDS.indexOf(String(kind || ""));
  if (index < 0) throw rendererError("CONTRACT_PRESENTATION_PLAN_INVALID", "Unknown page kind: " + kind);
  return index;
}

function findVisualizationSpec(specs, pageNumber) {
  return (Array.isArray(specs) ? specs : []).find((spec) => Number(spec?.pageNumber) === Number(pageNumber)) || null;
}

function referenceHostLabel(value = "") {
  try {
    return new URL(String(value)).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function buildContentContext({ proposalModel = {}, semanticModel = {}, commercialLock = null, visualStyleProfile = {}, presentationPlan = null }, tokens) {
  const isLockedModel = proposalModel.commercialLockState === "locked" || Boolean(proposalModel.commercialLockHash);
  if (isLockedModel && !commercialLock) {
    throw rendererError("CONTRACT_COMMERCIAL_LOCK_INVALID", "A locked proposal must be rendered with its CommercialLock");
  }
  if (commercialLock && proposalModel.commercialLockHash && commercialLock.lockHash !== proposalModel.commercialLockHash) {
    throw rendererError("COMMERCIAL_LOCK_CHANGED", "CommercialLock does not match the proposal model");
  }
  const locale = resolveProposalRendererLocale(proposalModel, semanticModel);
  // A named analog ("... как Shopify") is a product benchmark; a bare client
  // site URL ("КП для <url>") is only a brand reference and must not be
  // presented as a product analog anywhere in the deck.
  const hasNamedAnalog = array(semanticModel.analogs).length > 0
    || array(proposalModel.analogs).length > 0
    || Boolean(proposalModel.groundedBrief?.analog?.name?.value);
  const brandReferenceHost = referenceHostLabel(
    proposalModel.brandProfile?.themeSource?.reference
    || proposalModel.groundedBrief?.brandReference?.url?.value
    || "",
  );
  const projectNameStatus = String(proposalModel.groundedBrief?.projectName?.status || "").toLowerCase();
  const groundedProjectTitle = projectNameStatus === "explicit" ? proposalModel.groundedBrief?.projectName?.value : "";
  const rawProjectTitle = groundedProjectTitle || semanticModel.project?.name || proposalModel.title || proposalModel.brief?.projectName || localizeRendererText("Commercial proposal", locale);
  const explicitProjectTitle = projectNameStatus === "explicit" || (!projectNameStatus && Boolean(proposalModel.brief?.projectName));
  const projectTitle = clientText(explicitProjectTitle ? rawProjectTitle : localizeKnown(rawProjectTitle, locale),
    160,
  );
  if (CURRENCY_PRICE_PATTERN.test(projectTitle)) {
    throw rendererError("CONTENT_CLIENT_VALUE_MUTATED", "Project title must not contain a commercial price");
  }
  const currency = resolveCurrency(commercialLock?.currency || semanticModel.commercial?.currency || proposalModel.pricing?.currency || "XXX");
  const currencyExponent = Number.isInteger(commercialLock?.currencyExponent) ? commercialLock.currencyExponent : 2;
  const projectPriceMinor = commercialLock
    ? safeMinor(commercialLock.projectPriceMinor, "projectPriceMinor")
    : majorToMinor(semanticModel.commercial?.projectPrice ?? proposalModel.pricing?.projectPrice ?? proposalModel.pricing?.total, currencyExponent);
  const clientBudgetMinor = majorToMinor(
    proposalModel.pricing?.budgetAmount ?? semanticModel.commercial?.budgetAmount ?? proposalModel.groundedBrief?.budget?.amount?.value,
    currencyExponent,
  );
  const hasProjectPrice = Number.isSafeInteger(projectPriceMinor) && projectPriceMinor > 0;
  const hasClientBudget = Number.isSafeInteger(clientBudgetMinor) && clientBudgetMinor > 0;
  const functionPrice = normalizeFunctionPrice(commercialLock, semanticModel, proposalModel, currencyExponent, locale);
  // Keep the commercial allocation intact, but render delivery pages from the
  // same terminal inventory as the product mind map. This avoids multiplying
  // locked amounts when one priced function expands into several subfunctions.
  const functionSchedule = normalizeFunctionSchedule(semanticModel, functionPrice, locale);
  const functionPriceSubtotalMinor = commercialLock
    ? safeMinor(commercialLock.functionPriceSubtotalMinor, "functionPriceSubtotalMinor")
    : functionPrice.length
      ? functionPrice.reduce((sum, row) => sum + row.amountMinor, 0)
      : null;
  // Payments reconcile against the locked project price when one exists, or
  // against the client's explicitly stated budget (planning-scenario basis).
  const paymentBasisMinor = Number(commercialLock?.pricing?.paymentBasisMinor) > 0
    ? safeMinor(commercialLock.pricing.paymentBasisMinor, "paymentBasisMinor")
    : hasProjectPrice
      ? projectPriceMinor
      : hasClientBudget
        ? clientBudgetMinor
        : 0;
  const payments = normalizePayments(commercialLock, semanticModel, proposalModel, currencyExponent, paymentBasisMinor, locale);
  const durationMonths = finitePositive(commercialLock?.durationMonths ?? semanticModel.project?.durationMonths ?? proposalModel.durationMonths ?? proposalModel.timeline?.durationMonths);
  const durationWeeks = finitePositive(commercialLock?.durationWeeks ?? semanticModel.project?.durationWeeks ?? proposalModel.durationWeeks ?? proposalModel.timeline?.durationWeeks);
  const scope = normalizeScope(semanticModel, proposalModel, locale);
  const team = normalizeTeam(commercialLock, semanticModel, proposalModel, locale, durationMonths);
  const organizationStructure = normalizeOrganizationStructure(proposalModel, semanticModel, locale, projectTitle);
  const sources = normalizeSources(proposalModel.sources || semanticModel.sources || [], locale);
  const claims = normalizeClaims(proposalModel.claimLedger || [], locale);
  const marketResearch = proposalModel.marketResearch || {};
  const analogs = normalizeAnalogs(semanticModel, proposalModel, locale);
  const swot = normalizeSwot(semanticModel, proposalModel, locale);
  const currencyStatus = String(proposalModel.groundedBrief?.budget?.currency?.status || proposalModel.pricing?.currencyStatus || "unknown");
  const projectAmountTruthStatus = normalizeTruthStatus(
    proposalModel.pricing?.amountTruthStatus,
    proposalModel.groundedBrief?.budget?.amount?.status,
    semanticModel.commercial?.truthStatus,
  );
  const projectAmountKind = normalizeProjectAmountKind(
    proposalModel.pricing?.amountKind || semanticModel.commercial?.projectAmountKind,
  );
  const displayAmountKind = hasProjectPrice
    ? projectAmountKind
    : hasClientBudget
      ? "budget_constraint"
      : "unknown";
  const commercialTerms = normalizeCommercialTerms(proposalModel, locale);
  const decisionOwners = normalizeDecisionOwners(proposalModel, semanticModel, locale);
  const clientDependencies = normalizeClientDependencies(proposalModel, semanticModel, locale, {
    commercialTerms,
    currencyStatus,
    projectAmountTruthStatus,
    projectAmountKind,
    decisionOwners,
    isMarketplace: /marketplace/i.test([proposalModel.brief?.type, semanticModel.project?.category, proposalModel.title].filter(Boolean).join(" ")),
  });
  const narrative = normalizeNarrative(proposalModel, locale);
  const exclusions = normalizeStringRows(proposalModel.pricing?.exclusions, 8, 150).map((row) => localizeKnown(row, locale));
  const externalCosts = normalizeExternalCosts(commercialLock, proposalModel, currency, currencyExponent, locale);
  const analogPalette = visualStyleProfile.status === "fallback_partial"
    && (visualStyleProfile.provenance || []).some((row) => row?.sourceKind === "analog_url");
  const referenceMode = analogPalette ? "analog_palette" : (proposalModel.visualReferences?.mode || "none");
  const content = {
    locale,
    intlLocale: rendererIntlLocale(locale),
    projectTitle,
    hasNamedAnalog,
    brandReferenceHost,
    projectType: clientText(localizeKnown(proposalModel.brief?.type || semanticModel.project?.category || "Digital product", locale), 90),
    currency,
    currencyExponent,
    projectPriceMinor,
    paymentBasisMinor,
    hasProjectPrice,
    clientBudgetMinor,
    hasClientBudget,
    functionPrice,
    functionSchedule,
    functionPriceSubtotalMinor,
    payments,
    scope,
    team,
    organizationStructure,
    durationMonths,
    durationWeeks,
    sources,
    claims,
    marketResearch,
    market: semanticModel.market || {},
    analogs,
    swot,
    clientDependencies,
    narrative,
    exclusions,
    externalCosts,
    currencyStatus,
    projectAmountTruthStatus,
    projectAmountKind: displayAmountKind,
    commercialTerms,
    decisionOwners,
    isMarketplace: /marketplace/i.test([proposalModel.brief?.type, semanticModel.project?.category, proposalModel.title].filter(Boolean).join(" ")),
    referenceMode,
    presentationKinds: new Set((presentationPlan?.pages || []).map((page) => page.kind)),
    styleProfile: visualStyleProfile,
    tokens,
  };
  return content;
}

function renderContentPage(pagePlan, content, tokens, dynamicRules) {
  const renderers = {
    cover: renderCover,
    opening_manifesto: renderOpeningDecisionThesis,
    chapter_why_now: renderWhyNow,
    problem: renderProblem,
    market_research: renderMarketEvidence,
    analog_research: renderAnalogs,
    chapter_product: renderProductChapter,
    design_project: renderDesignDirection,
    org_structure: renderOrganizationStructure,
    swot: renderSwot,
    client_dependencies: renderClientDependencies,
    chapter_delivery: renderDeliveryChapter,
    function_price: renderFunctionPrice,
    team: renderTeam,
    project_price: renderProjectPrice,
    payments: renderPayments,
    close: renderClose,
  };
  const renderer = renderers[pagePlan.kind];
  if (!renderer) {
    throw rendererError("CONTENT_PAGE_INTENT_UNSUPPORTED", "No content renderer exists for page " + pagePlan.pageNumber);
  }
  return renderer(content, tokens, dynamicRules, pagePlan);
}

function renderCover(content, _tokens, _dynamicRules, pagePlan = {}) {
  const promise = coverReferenceDescription(content.locale);
  const duration = content.durationMonths ? formatRendererUnit(content.durationMonths, "month", content.locale) : content.durationWeeks ? formatRendererUnit(content.durationWeeks, "week", content.locale) : l(content, "Schedule to confirm");
  const scope = content.scope.length ? String(content.scope.length) : l(content, "To confirm");
  const clientSiteReference = !content.hasNamedAnalog && content.brandReferenceHost;
  const referenceMetricLabel = clientSiteReference ? l(content, "Client site") : l(content, "Reference product");
  const reference = content.hasNamedAnalog
    ? content.analogs[0]?.label || l(content, "Not supplied")
    : content.brandReferenceHost || content.analogs[0]?.label || l(content, "Not supplied");
  const confirmedScopeStatuses = new Set(["explicit", "verified", "confirmed", "single_source", "multi_source"]);
  const scopeLabel = content.scope.length && content.scope.every((row) => confirmedScopeStatuses.has(String(row.truthStatus || "").toLowerCase()))
    ? l(content, "Key functions")
    : l(content, "Recommended functions");
  const briefSourceIds = content.sources.filter((source) => /client[_ -]?brief|prompt/i.test(source.rawType)).map((source) => source.id).slice(0, 1);
  const referenceSourceIds = content.analogs[0]?.sourceIds?.length ? content.analogs[0].sourceIds : briefSourceIds;
  // The hero deliberately shows no money: the client budget is an input
  // constraint, not a headline value, and the product owner asked for the
  // cover to stay commercial-free.
  return [
    '<div class="cover-grid">',
    '<div class="cover-main panel-soft">',
    '<div class="cover-main-head"><span class="eyebrow">' + e(l(content, "DECISION DOCUMENT")) + '</span><span class="cover-sequence">01</span></div>',
    '<p class="cover-promise">' + e(promise) + "</p>",
    '<div class="cover-main-copy"><p>' + e(l(content, "The proposal separates confirmed inputs, recommendations, partner dependencies, and decisions still required before kickoff.")) + "</p></div>",
    "</div>",
    '<div class="cover-side panel">',
    '<div><div class="cover-side-index">01</div><span class="eyebrow">' + e(l(content, "COMMERCIAL PROPOSAL")) + '</span><strong>' + e(content.projectType) + "</strong></div>",
    '<p class="cover-side-copy">' + e(l(content, "The proposal brings the product scope, delivery plan, and commercial terms into one concise client document.")) + "</p>",
    '<div class="cover-side-signal"><span></span><span></span><span></span></div>',
    "</div>",
    '<div class="cover-meta">',
    metricFact(l(content, "Delivery window"), duration, pagePlan.sourceIds, "cover-delivery-window", content),
    metric(scopeLabel, scope),
    metricFact(referenceMetricLabel, reference, referenceSourceIds, "cover-reference-product", content),
    "</div>",
    "</div>",
  ].join("");
}

function coverReferenceDescription(locale) {
  const normalized = normalizeRendererLocale(locale);
  if (normalized === "ru-RU") {
    return "Сфокусированный план запуска продукта, ключевых функций, реализации и коммерческого решения для Udevs. Предложение объединяет подтверждённые данные, рекомендации, партнёрские зависимости и решения, необходимые до старта.";
  }
  if (normalized === "uz-Latn") {
    return "Udevs uchun mahsulotni ishga tushirish, asosiy funksiyalar, amalga oshirish va tijorat qaroriga yo‘naltirilgan reja. Taklif tasdiqlangan ma’lumotlar, tavsiyalar, hamkor bog‘liqliklari va ish boshlanishidan oldingi qarorlarni birlashtiradi.";
  }
  return "A focused plan for the product launch, core functions, delivery, and commercial decision for Udevs. The proposal brings together confirmed inputs, recommendations, partner dependencies, and the decisions required before kickoff.";
}

function renderOpeningDecisionThesis(content) {
  const items = [
    { stage: "01", title: l(content, "Product boundary"), detail: l(content, "Confirm the key functions and what remains outside the first delivery.") },
    { stage: "02", title: l(content, "Operating ownership"), detail: l(content, "Agree who owns buyer, seller, administration, support, and external handoffs.") },
    { stage: "03", title: l(content, "Delivery acceptance"), detail: l(content, "Define the accepted result and accountable owner for every stage.") },
    { stage: "04", title: l(content, "Commercial baseline"), detail: l(content, "Use one project amount and agree open commercial terms before signature.") },
  ];
  return '<div class="thread-layout"><div class="thread-line">' + items.map((item) => [
    '<div class="thread-item">',
    "<span>" + e(item.stage) + "</span>",
    "<strong>" + e(item.title) + "</strong>",
    "<p>" + e(item.detail) + "</p>",
    "</div>",
  ].join("")).join("") + '</div><p class="muted">' + e(l(content, "The following pages turn these decisions into a product structure, process, delivery plan, and commercial terms.")) + "</p></div>";
}

function renderWhyNow(content) {
  const thesis = meaningfulNarrative(content.narrative.whyNow)
    || l(content, "The decision is timely only when product promise, operating ownership, and acceptance evidence are resolved together.");
  const drivers = [];
  for (const trend of array(content.marketResearch?.trends).slice(0, 3)) {
    const localizedTrend = clientText(localizeKnown(typeof trend === "string" ? trend : trend.label || trend.text || trend.title, content.locale), 180);
    if (!isHighConfidenceLocaleMismatch(localizedTrend, content.locale)) drivers.push(localizedTrend);
  }
  for (const claim of content.claims) {
    if (drivers.length >= 3) break;
    if (!isHighConfidenceLocaleMismatch(claim.text, content.locale)) drivers.push(claim.text);
  }
  while (drivers.length < 3) {
    drivers.push([
      l(content, "Confirm the highest-value user journey before expanding scope."),
      l(content, "Resolve ownership at partner and operational handoffs."),
      l(content, "Tie delivery progress to evidence the client can accept."),
    ][drivers.length]);
  }
  return chapter("03", thesis, l(content, "Evidence-backed signals are separated from decisions that still require client confirmation."), drivers);
}

function renderProblem(content, _tokens, _dynamicRules, pagePlan = {}) {
  const thesis = meaningfulNarrative(content.narrative.problemStatement)
    || l(content, "Value breaks when adjacent owners read different states, rules, or acceptance evidence.");
  const rows = content.scope.slice(0, 5);
  if (!rows.length) {
    return missingState(
      content,
      l(content, "The primary handoff sequence is not supplied."),
      l(content, "A credible problem statement requires the actual actors, state changes, and failure points."),
      [l(content, "Who initiates the primary journey?"), l(content, "Which state is authoritative?"), l(content, "Where do partner callbacks enter?"), l(content, "Who resolves exceptions?")],
    );
  }
  const thesisSources = inlineSources(array(pagePlan.sourceIds), content, { compact: true });
  return [
    '<div class="handoff-layout">',
    '<div class="handoff-thesis panel-soft"><span class="eyebrow">' + e(l(content, "HANDOFF RISK")) + '</span><strong>' + e(thesis) + '</strong>' + thesisSources + '<p>' + e(l(content, "Each row is tied to the scope model, and recommendations remain visibly marked.")) + "</p></div>",
    '<div class="handoff-list">',
    rows.map((row, index) => '<div class="handoff-row"><span>' + padPage(index + 1) + '</span><div><strong>' + e(row.label) + '</strong><p>' + e(row.detail || row.epic || l(content, "Acceptance detail to confirm.")) + '</p></div><small>' + e(ownershipLabel(row.ownership, content)) + " · " + e(truthLabel(row.truthStatus, content)) + "</small></div>").join(""),
    "</div>",
    "</div>",
  ].join("");
}

function renderMarketEvidence(content) {
  const rawPositioning = content.marketResearch?.positioning || content.marketResearch?.thesis || meaningfulNarrative(content.narrative.executiveSummary);
  const positioning = clientText(
    rawPositioning && !isHighConfidenceLocaleMismatch(localizeKnown(rawPositioning, content.locale), content.locale)
      ? localizeKnown(rawPositioning, content.locale)
      : l(content, "Market evidence has not yet established a quantified expansion thesis."),
    520,
  );
  const signals = content.claims
    .filter((claim) => claim.sourceIds.length)
    .slice(0, 3)
    .map((claim) => ({
      id: claim.id,
      label: evidenceClaimLabel(claim, content),
      title: claim.text,
      detail: inlineSources(claim.sourceIds, content, { compact: true }),
      sourceIds: claim.sourceIds,
    }));
  for (const trend of array(content.marketResearch?.trends).slice(0, 2)) {
    if (signals.length >= 4) break;
    const localizedTrend = localizeKnown(typeof trend === "string" ? trend : trend.label || trend.text || trend.title, content.locale);
    if (isHighConfidenceLocaleMismatch(localizedTrend, content.locale)) continue;
    signals.push({
      label: l(content, "Recommendation"),
      title: clientText(localizedTrend, 180),
      detail: e(l(content, "Validate relevance before adding it to the product scope.")),
      sourceIds: [],
    });
  }
  if (!signals.length) {
    signals.push({
      label: l(content, "Evidence state"),
      title: l(content, "No verified market source is attached."),
      detail: l(content, "Quantified market claims remain outside the proposal until a source, geography, and period are approved."),
    });
  }
  return [
    '<div class="evidence-layout">',
    '<div class="evidence-hero panel-soft"><span class="eyebrow">' + e(l(content, "MARKET THESIS")) + '</span><strong>' + e(positioning) + '</strong><p>' + e(l(content, "Evidence frames the decision; benchmark features do not become committed scope automatically.")) + '</p><div class="evidence-metrics">' + metric(l(content, "Supported facts"), String(signals.filter((row) => row.label === l(content, "Supported fact")).length)) + metric(l(content, "Recommendations"), String(signals.filter((row) => row.label === l(content, "Recommendation")).length)) + "</div></div>",
    '<div class="evidence-list panel">' + signals.map((row, index) => '<div class="evidence-row"' + factualClaimAttributes(row.sourceIds, row.id || "market-signal-" + (index + 1)) + '><span>' + e(row.label) + '</span><strong>' + e(row.title) + '</strong><div class="evidence-detail">' + row.detail + "</div></div>").join("") + "</div>",
    "</div>",
  ].join("");
}

function renderAnalogs(content, _tokens, _dynamicRules, pagePlan = {}) {
  const readableSources = content.sources
    .filter((row) => row.display && ["read", "provided", "verified", "grounded"].includes(row.status))
    .filter(isAnalogRendererSource)
    .slice(0, 5);
  const referenceSources = readableSources.length
    ? readableSources
    : content.sources.filter((row) => row.display && /analog|link/i.test(row.rawType)).slice(0, 2);
  const trendLearnings = array(content.marketResearch?.trends)
    .map((row) => localizeKnown(typeof row === "string" ? row : row.label || row.text || row.title, content.locale))
    .filter(Boolean);
  const supported = content.analogs
    .filter((row) => row.sourceIds.length && ["verified", "single_source"].includes(row.truthStatus))
    .filter((row) => !isHighConfidenceLocaleMismatch(row.learning, content.locale))
    .slice(0, 3);
  const recommendations = [...new Set(trendLearnings)]
    .filter((row) => !supported.some((item) => item.learning === row))
    .slice(0, Math.max(0, 3 - supported.length));
  const rows = [
    ...supported.map((row) => ({ id: row.id, label: evidenceClaimLabel(row, content), text: row.learning, sourceIds: row.sourceIds })),
    ...recommendations.map((text) => ({ label: l(content, "Recommendation"), text, sourceIds: [] })),
  ];
  if (!rows.length) rows.push({ label: l(content, "Evidence state"), text: l(content, "No verified product claim is included until readable research evidence is available."), sourceIds: pagePlan.sourceIds || [] });
  const referenceProductSourceIds = content.analogs[0]?.sourceIds?.length
    ? content.analogs[0].sourceIds
    : array(pagePlan.sourceIds);
  const referenceProductClaim = factualClaimAttributes(referenceProductSourceIds, "analog-reference-product", { container: false });
  return [
    '<div class="analog-layout">',
    '<div class="analog-panel panel" data-claim-container="true"><span class="eyebrow">' + e(l(content, "REFERENCE PRODUCT")) + '</span><strong class="analog-title"' + referenceProductClaim + '>' + e(content.analogs[0]?.label || content.projectType) + '</strong><p class="analog-summary">' + e(readableSources.length ? l(content, "Only source-supported observations are presented as facts.") : l(content, "The reference is recorded, but no unsupported product claim is presented as fact.")) + '</p>' + inlineSources(referenceProductSourceIds.length ? referenceProductSourceIds : referenceSources.map((row) => row.id), content) + "</div>",
    '<div class="analog-panel panel-soft"><span class="eyebrow">' + e(l(content, "LEARNINGS AND RECOMMENDATIONS")) + '</span><div class="analog-list">' + rows.map((row, index) => '<div class="analog-learning"' + factualClaimAttributes(row.sourceIds, row.id || "analog-learning-" + (index + 1)) + '><span>' + padPage(index + 1) + '</span><strong>' + e(row.text) + '</strong><p>' + e(row.label) + '</p>' + inlineSources(row.sourceIds, content, { compact: true }) + "</div>").join("") + '</div><p class="analog-disclosure">' + e(l(content, "Recommendations do not become committed product scope without client approval.")) + "</p></div>",
    "</div>",
  ].join("");
}

function renderProductChapter(content) {
  const statement = meaningfulNarrative(content.narrative.valueProposition)
    || l(content, "A coherent product makes every surface read and write one accountable operating state.");
  const drivers = [
    content.scope.length ? scopeItemsLabel(content, content.scope.length) : l(content, "Scope structure requires confirmation"),
    partnerBoundariesLabel(content, content.scope.filter((row) => row.ownership === "partner_integrated").length),
    deferredCapabilitiesLabel(content, content.scope.filter((row) => row.ownership === "deferred").length),
  ];
  return chapter("09", statement, l(content, "The following pages separate product relationships, design decisions, process flow, and trust boundaries."), drivers);
}

function renderDesignDirection(content, tokens, dynamicRules) {
  const colors = [tokens.background, tokens.surface, tokens.primary, tokens.warning, tokens.critical];
  const swatches = colors.map((color, index) => {
    const className = addDynamicRule("swatch-" + index, "background:" + color, dynamicRules);
    return '<span class="swatch ' + className + '"></span>';
  }).join("");
  const referenceMessage = content.referenceMode === "explicit_full"
    ? l(content, "Composition and visual grammar follow the selected reference profile.")
    : content.referenceMode === "explicit_partial"
      ? l(content, "Only supplied identity constraints are applied; the remaining composition is neutral.")
      : content.referenceMode === "analog_palette"
        ? l(content, "The proposal palette is derived from the requested product analog and remains a provisional design direction.")
      : l(content, "No client visual reference is claimed; a neutral proposal system is used.");
  const stages = [
    [l(content, "Direction"), l(content, "Confirm reference authority, tone, and the visual decisions that may be reused.")],
    [l(content, "UX structure"), l(content, "Approve page hierarchy, key journeys, and required decision evidence.")],
    [l(content, "UI system"), l(content, "Approve tokens, components, semantic states, and responsive behavior.")],
    [l(content, "Handoff"), l(content, "Accept the design baseline, exception states, and implementation package.")],
  ];
  return [
    '<div class="design-layout">',
    '<div class="style-specimen panel-soft"><span class="eyebrow">' + e(l(content, "VISUAL SYSTEM")) + '</span><strong>Aa / 01</strong><p>' + e(referenceMessage) + '</p><div class="swatches">' + swatches + '</div><span class="status">' + e(content.referenceMode === "none" ? l(content, "Neutral visual direction") : content.referenceMode === "analog_palette" ? l(content, "Analog palette recorded") : l(content, "Reference source recorded")) + "</span></div>",
    '<div class="approval-list panel">' + stages.map((row, index) => '<div class="approval-row"><span>' + padPage(index + 1) + '</span><div><strong>' + e(row[0]) + '</strong><p>' + e(row[1]) + "</p></div></div>").join("") + "</div>",
    "</div>",
  ].join("");
}

function renderOrganizationStructure(content) {
  const structure = content.organizationStructure;
  if (structure.variant === "people_chain") return renderDeliveryPeopleChain(content, structure);
  const isGrounded = structure.mode === "grounded_public_org" && structure.status === "grounded";
  const sourceIds = [...new Set([
    ...array(structure.sourceIds),
    ...structure.branches.flatMap((branch) => [
      ...array(branch.sourceIds),
      ...branch.children.flatMap((child) => array(child.sourceIds)),
    ]),
  ].map(String).filter(Boolean))];
  const evidenceLabel = isGrounded
    ? l(content, "PUBLIC ORGANIZATION VIEW")
    : structure.status === "pending"
      ? l(content, "ORGANIZATION INPUTS REQUIRED")
      : l(content, "RECOMMENDED ROLE MODEL");
  const evidenceDetail = structure.disclosure || (isGrounded
    ? l(content, "The hierarchy reflects cited public evidence and does not extend reporting lines beyond those sources.")
    : structure.status === "pending"
      ? l(content, "Confirm accountable groups and role relationships before presenting an organization hierarchy as fact.")
      : l(content, "The hierarchy groups known product actors; it is a proposed role model, not a claim about the company's internal reporting lines."));
  const rootAttributes = organizationNodeAttributes(structure, "root");
  const branches = structure.branches.map((branch, branchIndex) => {
    const children = branch.children.slice(0, 3);
    const childMarkup = children.map((child, childIndex) => {
      const pendingClass = child.truthStatus === "unknown" ? " org-node-pending" : "";
      const detail = child.detail || truthLabel(child.truthStatus, content);
      return [
        '<div class="org-child">',
        '<span class="org-connector org-child-connector"></span>',
        '<div class="org-node org-child-node' + pendingClass + '"' + organizationNodeAttributes(child, "leaf") + '>',
        '<small>' + e(l(content, "Role")) + " " + padPage(childIndex + 1) + "</small>",
        '<strong>' + e(child.label) + "</strong>",
        '<p>' + e(detail) + "</p>",
        "</div>",
        "</div>",
      ].join("");
    }).join("");
    return [
      '<div class="org-branch">',
      '<span class="org-connector org-branch-connector"></span>',
      '<div class="org-node org-branch-node"' + organizationNodeAttributes(branch, "branch") + '>',
      '<small>' + e(l(content, "Group")) + " " + padPage(branchIndex + 1) + "</small>",
      '<strong>' + e(branch.label) + "</strong>",
      '<p>' + e(branch.detail || branchChildrenLabel(content, children.length)) + "</p>",
      "</div>",
      '<div class="org-children org-children-count-' + children.length + '">' + childMarkup + "</div>",
      "</div>",
    ].join("");
  }).join("");
  return [
    '<div class="org-layout">',
    '<div class="org-chart panel">',
    '<div class="org-root-wrap">',
    '<div class="org-node org-root"' + rootAttributes + '><small>' + e(l(content, "Organization")) + '</small><strong>' + e(structure.rootLabel) + '</strong><p>' + e(isGrounded ? l(content, "Source-backed public structure") : structure.status === "pending" ? l(content, "Structure to confirm") : l(content, "Proposed responsibility model")) + "</p></div>",
    '<span class="org-connector org-root-connector"></span>',
    "</div>",
    '<div class="org-branches">' + branches + "</div>",
    "</div>",
    '<div class="org-evidence"><span>' + e(evidenceLabel) + '</span><p>' + e(evidenceDetail) + "</p>" + inlineSources(sourceIds, content, { compact: true }) + "</div>",
    "</div>",
  ].join("");
}

function renderDeliveryPeopleChain(content, structure) {
  const roles = structure.roles.slice(0, 8);
  const roleCards = roles.map((role, index) => [
    '<div class="org-person">',
    '<span class="org-connector org-person-connector"></span>',
    '<div class="org-node org-person-node"' + organizationNodeAttributes(role, "person") + '>',
    '<small>' + e(l(content, "Role")) + " " + padPage(index + 1) + "</small>",
    '<strong>' + e(role.label) + "</strong>",
    '<p>' + e(role.detail) + "</p>",
    "</div>",
    "</div>",
  ].join("")).join("");
  return [
    '<div class="org-layout">',
    '<div class="org-chart org-chart-people panel">',
    '<div class="org-root-wrap">',
    '<div class="org-node org-root"' + organizationNodeAttributes(structure, "root") + '><small>' + e(l(content, "Leadership")) + '</small><strong>' + e(structure.rootLabel) + '</strong><p>' + e(structure.rootDetail || l(content, "Delivery leadership and escalations")) + "</p></div>",
    '<span class="org-connector org-root-connector"></span>',
    "</div>",
    '<div class="org-manager-wrap">',
    '<div class="org-node org-manager-node"' + organizationNodeAttributes(structure.manager, "manager") + '><small>' + e(l(content, "Project management")) + '</small><strong>' + e(structure.manager.label) + '</strong><p>' + e(structure.manager.detail) + "</p></div>",
    '<span class="org-connector org-manager-connector"></span>',
    "</div>",
    '<div class="org-people-grid org-people-count-' + roles.length + '">' + roleCards + "</div>",
    "</div>",
    '<div class="org-evidence"><span>' + e(l(content, "PROPOSED DELIVERY REPORTING LINE")) + '</span><p>' + e(structure.disclosure) + "</p>" + inlineSources(array(structure.sourceIds), content, { compact: true }) + "</div>",
    "</div>",
  ].join("");
}

function organizationNodeAttributes(node, type) {
  return ' data-geometry-role="org_node"'
    + ' data-node-id="' + escapeHtmlAttribute(node.id || "ORG-" + type.toUpperCase()) + '"'
    + ' data-node-type="' + escapeHtmlAttribute(type) + '"'
    + ' data-semantic-role="' + escapeHtmlAttribute(["root", "manager"].includes(type) ? "owned" : "neutral") + '"'
    + ' data-truth-status="' + escapeHtmlAttribute(node.truthStatus || "unknown") + '"';
}

function renderSwot(content) {
  const quadrants = ["strength", "weakness", "opportunity", "threat"];
  const fallback = {
    strength: l(content, "Which confirmed capability or operating advantage must acceptance protect?"),
    weakness: l(content, "Which missing input or dependency can block a credible launch?"),
    opportunity: l(content, "Which evidence-backed user or market signal deserves an early test?"),
    threat: l(content, "Which external dependency needs a fallback owner and response?"),
  };
  return '<div class="quadrant-grid">' + quadrants.map((quadrant) => {
    const rows = content.swot.filter((row) => row.quadrant === quadrant);
    const text = rows.length ? rows.map((row) => row.label).join(" · ") : fallback[quadrant];
    const response = rows.find((row) => row.response)?.response || operatingResponse(quadrant, rows.length > 0, content);
    return '<div class="quadrant panel" data-swot-quadrant="' + quadrant + '"><span>' + e(rows.length ? truthLabel(rows[0].truthStatus, content) : l(content, "Decision question")) + '</span><strong>' + e(quadrantLabel(quadrant, content)) + '</strong><p>' + e(text) + '</p><p><span class="eyebrow">' + e(l(content, "RECOMMENDED RESPONSE")) + "</span> " + e(response) + "</p></div>";
  }).join("") + "</div>";
}

function renderClientDependencies(content) {
  const rows = array(content.clientDependencies);
  const readinessCounts = rows.reduce((counts, row) => {
    counts[clientDependencyReadinessBucket(row.status)] += 1;
    return counts;
  }, { ready: 0, waiting: 0, blocked: 0 });
  const categories = ["access", "integrations", "ownership"];
  const groupedRows = categories.map((category) => {
    const categoryRows = rows.filter((row) => row.category === category);
    if (!categoryRows.length) return "";
    return [
      '<div class="client-dependency-group" data-geometry-role="dependency_group" data-group-id="CLIENT-DEPENDENCY-GROUP-' + escapeHtmlAttribute(category) + '"><strong>' + e(clientDependencyCategoryLabel(category, content)) + '</strong><span>' + e(String(categoryRows.length)) + "</span></div>",
      categoryRows.map((row) => {
        const sources = row.sourceIds?.length ? inlineSources(row.sourceIds, content, { compact: true }) : "";
        const detail = row.detail ? '<p class="client-dependency-detail">' + e(row.detail) + "</p>" : "";
        const sourceIds = row.sourceIds?.length ? ' data-source-ids="' + escapeHtmlAttribute(row.sourceIds.join(",")) + '"' : "";
        const readinessBucket = clientDependencyReadinessBucket(row.status);
        const owner = row.owner || l(content, "Client owner to appoint");
        const checked = readinessBucket === "ready";
        const readinessLabel = readinessBucket === "ready"
          ? l(content, "Ready")
          : readinessBucket === "blocked"
            ? l(content, "Blocked")
            : l(content, "Waiting / not provided").split("/")[0].trim();
        return [
          '<div class="client-dependency-row" data-geometry-role="dependency_row" data-node-id="' + escapeHtmlAttribute(row.id) + '" data-node-type="dependency" data-semantic-role="' + escapeHtmlAttribute(row.status) + '" data-readiness-bucket="' + readinessBucket + '" data-truth-status="' + escapeHtmlAttribute(row.truthStatus || "unknown") + '"' + sourceIds + ">",
          '<div class="client-dependency-name"><strong>' + e(row.label) + "</strong>" + detail + sources + "</div>",
          '<div class="client-dependency-owner"><strong>' + e(owner) + "</strong></div>",
          '<div class="client-dependency-state"><span class="client-dependency-checkbox' + (checked ? " is-checked" : "") + '" data-checked="' + (checked ? "true" : "false") + '">' + e(readinessLabel) + "</span></div>",
          "</div>",
        ].join("");
      }).join(""),
    ].join("");
  }).join("");
  return [
    '<div class="client-dependencies-layout">',
    '<div class="client-dependencies-summary" data-dependency-row-count="' + rows.length + '" data-ready-count="' + readinessCounts.ready + '" data-waiting-count="' + readinessCounts.waiting + '" data-blocked-count="' + readinessCounts.blocked + '">',
    '<div class="client-dependency-metric" data-readiness-counter="ready"><span>' + e(l(content, "Ready")) + '</span><strong>' + e(String(readinessCounts.ready)) + "</strong></div>",
    '<div class="client-dependency-metric" data-readiness-counter="waiting"><span>' + e(l(content, "Waiting / not provided")) + '</span><strong>' + e(String(readinessCounts.waiting)) + "</strong></div>",
    '<div class="client-dependency-metric" data-readiness-counter="blocked"><span>' + e(l(content, "Blocked")) + '</span><strong>' + e(String(readinessCounts.blocked)) + "</strong></div>",
    '<div class="client-dependencies-principle"><strong>' + e(l(content, "Only non-public access, credentials, approvals, and client-owned inputs are listed here.")) + '</strong><p>' + e(l(content, "Public company information and researchable facts are resolved by the proposal team.")) + "</p></div>",
    "</div>",
    rows.length
      ? '<div class="client-dependencies-table panel"><div class="client-dependencies-head"><span>' + e(l(content, "Dependency")) + '</span><span>' + e(l(content, "Owner")) + '</span><span>' + e(l(content, "Ready")) + "</span></div>" + groupedRows + "</div>"
      : '<div class="client-dependencies-empty panel"><strong>' + e(l(content, "No client dependencies identified.")) + '</strong><p>' + e(l(content, "Confirm each open item before it reaches the delivery critical path.")) + "</p></div>",
    "</div>",
  ].join("");
}

function clientDependencyReadinessBucket(status) {
  if (["provided", "not_applicable"].includes(status)) return "ready";
  if (status === "blocked") return "blocked";
  return "waiting";
}

function clientDependencyCategoryLabel(category, content) {
  const labels = {
    access: "ACCESS AND INFRASTRUCTURE",
    integrations: "INTEGRATIONS AND CREDENTIALS",
    ownership: "CLIENT OWNERSHIP AND ACCEPTANCE",
  };
  return l(content, labels[category] || "CLIENT OWNERSHIP AND ACCEPTANCE");
}



function renderDeliveryChapter(content) {
  const statement = meaningfulNarrative(content.narrative.deliveryApproach)
    || l(content, "Delivery advances through accepted evidence, not through elapsed calendar time alone.");
  const drivers = [
    content.durationWeeks ? deliveryWindowLabel(content, content.durationWeeks, "week") : content.durationMonths ? deliveryWindowLabel(content, content.durationMonths, "month") : l(content, "Delivery window requires confirmation"),
    content.team.roles.length ? rolesIdentifiedLabel(content, content.team.roles.length) : l(content, "Team roles require confirmation"),
    content.payments.length ? paymentStagesLabel(content, content.payments.length) : l(content, "Payment stages require confirmation"),
  ];
  return chapter("15", statement, l(content, "Scope, capacity, roadmap, price, and payment stages are shown as one reconciled planning baseline."), drivers);
}

function renderFunctionPrice(content, _tokens, _dynamicRules, pagePlan = {}) {
  const pageRows = functionScheduleRowsForPage(content, pagePlan);
  if (!pageRows.length) {
    return [
      '<div class="function-price-layout">',
      missingState(content, l(content, "Function schedule is not supplied."), l(content, "A complete list of functional blocks and delivery windows is required before the schedule can be presented."), [l(content, "Confirm the functional inventory."), l(content, "Confirm dependencies between blocks."), l(content, "Confirm the delivery window for each block.")]),
      "</div>",
    ].join("");
  }
  const offset = (Math.max(1, Number(pagePlan.segmentIndex) || 1) - 1) * FUNCTION_SCHEDULE_ROWS_PER_PAGE;
  const rows = pageRows.map((row, index) => {
    const sourceIds = row.sourceIds?.length ? ' data-source-ids="' + escapeHtmlAttribute(row.sourceIds.join(",")) + '"' : "";
    return [
      '<div class="function-price-row" data-geometry-role="function_price_row" data-node-id="' + escapeHtmlAttribute(row.id) + '" data-node-type="function_price" data-truth-status="' + escapeHtmlAttribute(row.truthStatus || "unknown") + '" data-inclusion="' + escapeHtmlAttribute(row.scopeStatus || "to_confirm") + '"' + sourceIds + '>',
      '<span class="function-price-index">' + e(String(offset + index + 1).padStart(2, "0")) + "</span>",
      '<span class="function-price-epic">' + e(row.epic) + "</span>",
      '<strong class="function-price-task">' + e(row.name) + "</strong>",
      '<span class="function-price-subtask">' + e(row.detail) + "</span>",
      '<span class="function-price-deadline">' + e(row.deadline) + "</span>",
      "</div>",
    ].join("");
  }).join("");
  const densityClass = pageRows.length > 16
    ? " function-price-table-dense"
    : pageRows.length > 8
      ? " function-price-table-compact"
      : "";
  return [
    '<div class="function-price-layout">',
    '<div class="function-price-table panel' + densityClass + '">',
    '<div class="function-price-head"><span>#</span><span>' + e(l(content, "Epic")) + '</span><span>' + e(l(content, "Main task")) + '</span><span>' + e(l(content, "Subtask")) + '</span><span>' + e(l(content, "Deadline")) + "</span></div>",
    rows,
    "</div>",
    "</div>",
  ].join("");
}

function renderTeam(content) {
  if (!content.team.roles.length) {
    return missingState(
      content,
      l(content, "Team capacity is not supplied."),
      l(content, "A role list and time-phased capacity are required before staffing can be presented."),
      [l(content, "Confirm accountable delivery roles."), l(content, "Confirm peak FTE and FTE-months by role."), l(content, "Confirm the active period for each role.")],
    );
  }
  const plan = teamCapacityPlan(content);
  if (!plan) {
    return missingState(
      content,
      l(content, "A role list and time-phased capacity are required before staffing can be presented."),
      l(content, "Delivery roles are identified; per-role capacity remains to confirm."),
      [l(content, "Confirm peak FTE and FTE-months by role."), l(content, "Confirm the active period for each role.")],
    );
  }
  const costPlan = teamCostPlan(content, plan);
  const roleRows = costPlan.rows.map((row, roleIndex) => [
    '<div class="team-capacity-row" data-geometry-role="team_role_row" data-role-index="' + (roleIndex + 1) + '" data-role-peak-fte="' + escapeHtmlAttribute(formatTeamDataValue(row.quantity)) + '" data-role-fte-months="' + escapeHtmlAttribute(formatTeamDataValue(row.fteMonths)) + '" data-team-amount-minor="' + (row.amountMinor === null ? "" : row.amountMinor) + '">',
    '<div class="team-capacity-role"><strong>' + e(row.role) + '</strong><small>' + e(formatTeamFte(row.fteMonths, content) + " " + l(content, "FTE-months")) + "</small></div>",
    '<span class="team-quantity" data-geometry-role="team_quantity" data-fte="' + escapeHtmlAttribute(formatTeamDataValue(row.quantity)) + '">' + e(formatTeamFte(row.quantity, content)) + "</span>",
    '<span class="team-duration" data-geometry-role="team_duration" data-active-months="' + escapeHtmlAttribute(formatTeamDataValue(row.activeMonths)) + '">' + e(formatTeamFte(row.activeMonths, content)) + "</span>",
    '<span class="team-rate" data-geometry-role="team_rate" data-team-rate-minor="' + (row.rateMinor === null ? "" : row.rateMinor) + '">' + e(row.rateMinor === null ? teamUiText(content, "toConfirm") : formatMinor(row.rateMinor, content.currency, content.currencyExponent, content)) + "</span>",
    '<strong class="team-amount" data-geometry-role="team_amount" data-team-amount-minor="' + (row.amountMinor === null ? "" : row.amountMinor) + '">' + e(row.amountMinor === null ? teamUiText(content, "toConfirm") : formatMinor(row.amountMinor, content.currency, content.currencyExponent, content)) + "</strong>",
    "</div>",
  ].join("")).join("");
  const capacityEnvelope = plan.peakFte;
  const peopleValue = content.team.people === null ? teamUiText(content, "toConfirm") : formatTeamFte(content.team.people, content);
  const peopleTruth = normalizeTruthStatus(content.team.peopleTruthStatus, content.team.truthStatus);
  const peopleLabel = CONFIRMED_TRUTH_STATUSES.has(peopleTruth) ? teamUiText(content, "confirmedPeople") : teamUiText(content, "plannedPeople");
  const durationValue = content.durationMonths
    ? formatRendererUnit(content.durationMonths, "month", content.locale)
    : l(content, "Schedule to confirm");
  const totalValue = costPlan.totalMinor === null
    ? teamUiText(content, "toConfirm")
    : formatMinor(costPlan.totalMinor, content.currency, content.currencyExponent, content);
  const metricMarkup = [
    teamCapacityMetric("people", peopleLabel, peopleValue, teamUiText(content, "staffingScenario")),
    teamCapacityMetric("roles", teamUiText(content, "roles"), formatTeamFte(plan.rows.length, content), teamUiText(content, "deliveryTeam")),
    teamCapacityMetric("duration", l(content, "Delivery window"), durationValue, l(content, "Client brief")),
    teamCapacityMetric("budget_total", teamUiText(content, "teamBudget"), totalValue, teamUiText(content, "distributedByCapacity"), true, plan.peakFte),
  ].join("");
  const note = costPlan.rateMinor === null
    ? teamUiText(content, "costPending")
    : teamUiText(content, "costFormula", {
      total: totalValue,
      fteMonths: formatTeamFte(plan.fteMonths, content),
      rate: formatMinor(costPlan.rateMinor, content.currency, content.currencyExponent, content),
    });
  return [
    '<div class="team-capacity-layout" data-team-month-count="' + plan.monthCount + '" data-team-matrix-truth-status="' + escapeHtmlAttribute(plan.truthStatus) + '" data-team-total-minor="' + (costPlan.totalMinor === null ? "" : costPlan.totalMinor) + '" data-team-peak-fte="' + escapeHtmlAttribute(formatTeamDataValue(plan.peakFte)) + '">',
    '<div class="team-capacity-metrics">' + metricMarkup + "</div>",
    '<div class="team-capacity-disclosure" data-warning-status="scenario">' + e(l(content, "Planning scenario · confirmation required")) + "</div>",
    '<div class="team-capacity-table panel">',
    '<div class="team-capacity-head"><span>' + e(teamUiText(content, "employee")) + "</span><span>" + e(teamUiText(content, "quantity")) + "</span><span>" + e(teamUiText(content, "months")) + "</span><span>" + e(teamUiText(content, "monthlyRate")) + "</span><span>" + e(teamUiText(content, "amount")) + "</span></div>",
    roleRows,
    '<div class="team-capacity-total" data-team-total-minor="' + (costPlan.totalMinor === null ? "" : costPlan.totalMinor) + '"><div class="team-capacity-total-label"><strong>' + e(teamUiText(content, "teamTotal")) + '</strong><small>' + e(formatTeamFte(plan.fteMonths, content) + " " + l(content, "FTE-months")) + '</small></div><strong class="team-cost-total">' + e(totalValue) + "</strong></div>",
    "</div>",
    '<div class="team-capacity-note" data-team-capacity-envelope="' + escapeHtmlAttribute(formatTeamDataValue(capacityEnvelope)) + '"><span>' + e(teamUiText(content, "capacityLogic")) + "</span><strong>" + e(note) + "</strong><small>" + e(teamUiText(content, "monthlyModel")) + "</small></div>",
    "</div>",
  ].join("");
}

export function teamCostPlan(content = {}, capacityPlan = null) {
  const plan = capacityPlan || teamCapacityPlan(content);
  if (!plan?.rows?.length) return { rows: [], totalMinor: null, rateMinor: null };
  const candidateTotal = content.hasProjectPrice
    ? content.projectPriceMinor
    : content.hasClientBudget
      ? content.clientBudgetMinor
      : null;
  const totalMinor = Number.isSafeInteger(candidateTotal) && candidateTotal > 0 ? candidateTotal : null;
  const totalFteMonths = plan.rows.reduce((sum, row) => sum + Number(row.fteMonths || 0), 0);
  const weights = plan.rows.map((row) => Math.max(0, Number(row.fteMonths || 0)));
  const amounts = totalMinor === null || totalFteMonths <= 0
    ? weights.map(() => null)
    : allocateTeamCostMinor(totalMinor, weights);
  const blendedRateMinor = totalMinor === null || totalFteMonths <= 0
    ? null
    : Math.round(totalMinor / totalFteMonths);
  return {
    totalMinor,
    rateMinor: blendedRateMinor,
    rows: plan.rows.map((row, index) => {
      const quantity = Number(row.peakFte || 0);
      const fteMonths = Number(row.fteMonths || 0);
      const amountMinor = amounts[index];
      return {
        role: row.role,
        quantity: roundTeamFte(quantity),
        activeMonths: roundTeamFte(quantity > 0 ? fteMonths / quantity : 0),
        fteMonths: roundTeamFte(fteMonths),
        rateMinor: amountMinor === null || fteMonths <= 0 ? null : Math.round(amountMinor / fteMonths),
        amountMinor,
      };
    }),
  };
}

function allocateTeamCostMinor(totalMinor, weights) {
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0 || totalWeight <= 0) return weights.map(() => null);
  const rows = weights.map((weight, index) => {
    const exact = (totalMinor * weight) / totalWeight;
    const amount = Math.floor(exact);
    return { index, amount, remainder: exact - amount };
  });
  let remaining = totalMinor - rows.reduce((sum, row) => sum + row.amount, 0);
  const order = [...rows].sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) order[index % order.length].amount += 1;
  return rows.sort((left, right) => left.index - right.index).map((row) => row.amount);
}

function teamCapacityMetric(id, label, value, detail, peak = false, numericValue = null) {
  const numericAttribute = numericValue === null ? "" : ' data-fte="' + escapeHtmlAttribute(formatTeamDataValue(numericValue)) + '"';
  return '<div class="team-capacity-metric' + (peak ? " is-peak" : "") + '" data-team-metric="' + escapeHtmlAttribute(id) + '"' + numericAttribute + '><span>' + e(label) + "</span><strong>" + e(value) + "</strong><small>" + e(detail) + "</small></div>";
}

function teamCapacityPlan(content) {
  const duration = Number(content?.durationMonths);
  const roles = array(content?.team?.roles);
  if (!Number.isInteger(duration) || duration < 2 || duration > 6 || !roles.length || roles.length > 9) return null;
  const truthStatus = CONFIRMED_TRUTH_STATUSES.has(normalizeTruthStatus(content.team?.truthStatus))
    ? "modeled"
    : normalizeTruthStatus(content.team?.truthStatus) || "modeled";
  const rows = [];
  for (const role of roles) {
    const months = array(role.monthlyFte).map((value) => roundTeamFte(value));
    if (months.length !== duration || months.some((value) => value < 0)) return null;
    const peakFte = roundTeamFte(Math.max(...months));
    const fteMonths = roundTeamFte(months.reduce((sum, value) => sum + value, 0));
    if (peakFte <= 0 || !nearlyEqual(peakFte, role.peakFte) || !nearlyEqual(fteMonths, role.fteMonths)) return null;
    rows.push({
      role: role.role,
      peakFte,
      fteMonths,
      focus: teamDeliveryFocus(role.role, content),
      months,
    });
  }
  const monthlyTotals = Array.from({ length: duration }, (_, monthIndex) => roundTeamFte(rows.reduce((sum, row) => sum + row.months[monthIndex], 0)));
  const peakFte = Math.max(...monthlyTotals);
  const peakMonthIndex = monthlyTotals.indexOf(peakFte);
  const rowsTotal = roundTeamFte(rows.reduce((sum, row) => sum + row.fteMonths, 0));
  const lockedTotal = nullableNumber(content.team?.fteMonths);
  const lockedPeak = nullableNumber(content.team?.peakFte);
  const lockedMonthlyTotals = array(content.team?.monthlyTotals);
  if ((lockedTotal !== null && !nearlyEqual(rowsTotal, lockedTotal))
    || (lockedPeak !== null && !nearlyEqual(peakFte, lockedPeak))
    || (lockedMonthlyTotals.length && (lockedMonthlyTotals.length !== duration || lockedMonthlyTotals.some((value, index) => !nearlyEqual(value, monthlyTotals[index]))))) return null;
  return {
    monthCount: duration,
    rows,
    monthlyTotals,
    peakFte,
    peakMonthIndex,
    fteMonths: lockedTotal ?? rowsTotal,
    truthStatus,
  };
}

function teamDeliveryFocus(role, content) {
  const value = String(role || "").toLowerCase();
  if (/product|pm|mahsulot|продукт|менеджер/iu.test(value)) return teamUiText(content, "focusProduct");
  if (/architect|arxitektor|архитектор|team\s*lead|teamlead|yechim/iu.test(value)) return teamUiText(content, "focusArchitecture");
  if (/design|designer|ui\/ux|ux|дизайн|dizayn/iu.test(value)) return teamUiText(content, "focusDesign");
  if (/backend|back-end|бекенд|бэкенд/iu.test(value)) return teamUiText(content, "focusBackend");
  if (/frontend|front-end|фронтенд/iu.test(value)) return teamUiText(content, "focusFrontend");
  if (/(?:^|\W)(qa|quality|test|testing|sifat|тест)(?:\W|$)/iu.test(value)) return teamUiText(content, "focusQa");
  if (/devops|release|релиз/iu.test(value)) return teamUiText(content, "focusDevops");
  return teamUiText(content, "focusDelivery");
}

const TEAM_UI_COPY = Object.freeze({
  en: Object.freeze({
    employee: "Employee",
    quantity: "Quantity",
    months: "Months",
    monthlyRate: "Monthly rate",
    amount: "Amount",
    teamTotal: "Team total",
    teamBudget: "Team budget",
    distributedByCapacity: "distributed by FTE-months",
    costPending: "Monthly rates and role amounts require a project total.",
    costFormula: "{total} is allocated across {fteMonths} FTE-months; blended monthly rate: {rate}.",
    role: "Role",
    deliveryFocus: "Delivery focus",
    peak: "PEAK",
    confirmedPeople: "Confirmed people",
    plannedPeople: "Planned people",
    staffingScenario: "staffing scenario",
    roles: "Roles",
    deliveryTeam: "delivery team",
    reconciledTotal: "reconciled total",
    peakMonth: "Peak / M{month}",
    concurrentFte: "concurrent FTE",
    monthlyTotal: "Monthly total",
    capacityLogic: "CAPACITY LOGIC",
    monthlyModel: "MONTHLY PLANNING MODEL",
    capacityNote: "{total} FTE-months reconcile across the matrix; the monthly team peak is {envelope} FTE.",
    toConfirm: "To confirm",
    focusProduct: "Backlog and product decisions",
    focusArchitecture: "System and integrations",
    focusDesign: "Flows and prototype",
    focusBackend: "Core services and business logic",
    focusFrontend: "Buyer, seller and admin surfaces",
    focusQa: "Quality and release evidence",
    focusDevops: "Environments and observability",
    focusDelivery: "Delivery ownership and execution",
  }),
  "ru-RU": Object.freeze({
    employee: "Сотрудник",
    quantity: "Количество",
    months: "Месяцы",
    monthlyRate: "Ставка в месяц",
    amount: "Сумма",
    teamTotal: "Итого по команде",
    teamBudget: "Бюджет команды",
    distributedByCapacity: "распределён по FTE-месяцам",
    costPending: "Для расчёта ставок и сумм по ролям требуется сумма проекта.",
    costFormula: "{total} распределено на {fteMonths} FTE-месяца; расчётная месячная ставка — {rate}.",
    role: "Роль",
    deliveryFocus: "Фокус работы",
    peak: "ПИК",
    confirmedPeople: "Подтверждённая численность",
    plannedPeople: "Плановая численность",
    staffingScenario: "сценарий команды",
    roles: "Роли",
    deliveryTeam: "команда реализации",
    reconciledTotal: "сверенный итог",
    peakMonth: "Пик / М{month}",
    concurrentFte: "одновременный FTE",
    monthlyTotal: "Итого по месяцам",
    capacityLogic: "ЛОГИКА РЕСУРСОВ",
    monthlyModel: "ПОМЕСЯЧНАЯ МОДЕЛЬ",
    capacityNote: "Матрица сверена с {total} FTE-месяца; месячный пик команды — {envelope} FTE.",
    toConfirm: "Подтвердить",
    focusProduct: "Бэклог и продуктовые решения",
    focusArchitecture: "Система и интеграции",
    focusDesign: "Сценарии и прототип",
    focusBackend: "Основные сервисы и бизнес-логика",
    focusFrontend: "Интерфейсы покупателя, продавца и админа",
    focusQa: "Качество и доказательства релиза",
    focusDevops: "Среды и наблюдаемость",
    focusDelivery: "Ответственность и реализация",
  }),
  "uz-Latn": Object.freeze({
    employee: "Xodim",
    quantity: "Miqdor",
    months: "Oylar",
    monthlyRate: "Oylik stavka",
    amount: "Summa",
    teamTotal: "Jamoa bo‘yicha jami",
    teamBudget: "Jamoa budjeti",
    distributedByCapacity: "FTE-oy bo‘yicha taqsimlangan",
    costPending: "Rollar stavkasi va summasini hisoblash uchun loyiha summasi kerak.",
    costFormula: "{total} {fteMonths} FTE-oyga taqsimlandi; hisobiy oylik stavka — {rate}.",
    role: "Rol",
    deliveryFocus: "Ish yo'nalishi",
    peak: "PIK",
    confirmedPeople: "Tasdiqlangan xodimlar soni",
    plannedPeople: "Rejalashtirilgan xodimlar",
    staffingScenario: "jamoa ssenariysi",
    roles: "Rollar",
    deliveryTeam: "amalga oshirish jamoasi",
    reconciledTotal: "solishtirilgan jami",
    peakMonth: "Eng yuqori / {month}-oy",
    concurrentFte: "bir vaqtdagi FTE",
    monthlyTotal: "Oylar bo'yicha jami",
    capacityLogic: "RESURS MANTIG'I",
    monthlyModel: "OYLIK REJALASHTIRISH MODELI",
    capacityNote: "Matritsa {total} FTE-oy bilan solishtirilgan; jamoaning oylik eng yuqori yuklamasi {envelope} FTE.",
    toConfirm: "Tasdiqlash kerak",
    focusProduct: "Beklog va mahsulot qarorlari",
    focusArchitecture: "Tizim va integratsiyalar",
    focusDesign: "Jarayonlar va prototip",
    focusBackend: "Asosiy servislar va biznes mantiqi",
    focusFrontend: "Xaridor, sotuvchi va admin interfeyslari",
    focusQa: "Sifat va reliz dalillari",
    focusDevops: "Muhitlar va kuzatuvchanlik",
    focusDelivery: "Mas'uliyat va amalga oshirish",
  }),
});

function teamUiText(content, key, replacements = {}) {
  const locale = localeId(content);
  const dictionary = TEAM_UI_COPY[locale] || TEAM_UI_COPY.en;
  let value = dictionary[key] || TEAM_UI_COPY.en[key] || key;
  for (const [name, replacement] of Object.entries(replacements)) {
    value = value.replaceAll("{" + name + "}", String(replacement));
  }
  return value;
}

function teamCapacityTitle(content, plan) {
  if (!plan) return null;
  const costPlan = teamCostPlan(content, plan);
  if (costPlan.totalMinor !== null) {
    const total = formatMinor(costPlan.totalMinor, content.currency, content.currencyExponent, content);
    if (localeId(content) === "ru-RU") return "Расчётное распределение бюджета по составу и загрузке команды: " + total + ".";
    if (localeId(content) === "uz-Latn") return "Budjet jamoa tarkibi va yuklamasi bo‘yicha hisobiy taqsimlandi: " + total + ".";
    return "Planning budget allocation by team composition and workload: " + total + ".";
  }
  const month = plan.peakMonthIndex + 1;
  const peak = formatTeamFte(plan.peakFte, content);
  if (localeId(content) === "ru-RU") return "Пиковая загрузка команды — месяц " + month + ": " + peak + " FTE.";
  if (localeId(content) === "uz-Latn") return "Jamoa yuklamasi " + month + "-oyda eng yuqori: " + peak + " FTE.";
  return "Month " + month + " is the capacity peak: " + peak + " FTE.";
}

function formatTeamFte(value, content = {}) {
  const number = finiteNumber(value);
  return number === null
    ? teamUiText(content, "toConfirm")
    : new Intl.NumberFormat(content.intlLocale || rendererIntlLocale(content.locale), { maximumFractionDigits: 3 }).format(number);
}

function formatTeamDataValue(value) {
  const number = finiteNumber(value);
  if (number === null) return "";
  return String(roundTeamFte(number));
}

function roundTeamFte(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function nearlyEqual(left, right, epsilon = 1e-6) {
  return Math.abs(Number(left) - Number(right)) <= epsilon;
}

function renderProjectPrice(content, _tokens, _dynamicRules, pagePlan = {}) {
  const copy = projectPriceCopy(content.locale);
  const capacityPlan = teamCapacityPlan(content);
  const rows = projectPriceLedgerRows(content, capacityPlan, copy);
  const displayTotalMinor = content.hasProjectPrice
    ? content.projectPriceMinor
    : content.hasClientBudget
      ? content.clientBudgetMinor
      : null;
  const hasDisplayTotal = Number.isSafeInteger(displayTotalMinor) && displayTotalMinor > 0;
  const price = hasDisplayTotal
    ? formatMinor(displayTotalMinor, content.currency, content.currencyExponent, content)
    : copy.notSupplied;
  const currencyKnown = content.currencyStatus === "explicit" && content.currency !== "XXX";
  const currencyAssumed = content.currencyStatus === "assumed" && content.currency !== "XXX";
  const currencyState = currencyKnown
    ? content.currency
    : currencyAssumed
      ? content.currency + " · " + copy.workingAssumption
      : copy.notSupplied;
  const currencyStatus = currencyKnown ? "explicit" : currencyAssumed ? "assumed" : "unknown";
  const totalLabel = projectPriceTotalLabel(content, copy);
  const planningDisclosure = content.projectAmountKind === "budget_constraint"
    ? `${copy.planningDisclosure} ${copy.budgetNotQuote}`
    : copy.planningDisclosure;
  const stageMeta = [
    content.durationMonths ? formatRendererUnit(content.durationMonths, "month", content.locale) : copy.durationPending,
    capacityPlan ? copy.roleCount(capacityPlan.rows.length) : copy.capacityPending,
    capacityPlan ? formatTeamFte(capacityPlan.fteMonths, content) + " " + copy.fteMonths : "",
  ].filter(Boolean);
  const terms = [
    { label: copy.currency, value: currencyState, warning: !currencyKnown },
    { label: copy.tax, value: content.commercialTerms.tax || copy.open },
    {
      label: copy.external,
      value: content.commercialTerms.externalCosts || (content.externalCosts.length
        ? content.externalCosts.slice(0, 1).map((row) => row.name + " · " + row.amount).join("")
        : copy.confirmSeparately),
    },
    {
      label: copy.contract,
      value: content.commercialTerms.warrantySupportIpSupplied && content.commercialTerms.validity
        ? [...new Set([content.commercialTerms.validity, content.commercialTerms.warranty, content.commercialTerms.support, content.commercialTerms.ip])].join(" · ")
        : copy.open,
    },
  ];
  const rowMarkup = rows.map((row, index) => [
    '<div class="project-price-row" data-price-row="true" data-geometry-role="project_price_row" data-node-id="' + escapeHtmlAttribute(row.id) + '" data-truth-status="' + escapeHtmlAttribute(row.truthStatus) + '"' + (row.roleIndex ? ' data-role-index="' + row.roleIndex + '" data-role-peak-fte="' + escapeHtmlAttribute(formatTeamDataValue(row.peakFte)) + '" data-role-fte-months="' + escapeHtmlAttribute(formatTeamDataValue(row.fteMonths)) + '"' : "") + '>',
    '<div class="project-price-cell project-price-item" data-price-field="item"><span class="project-price-item-index">' + padPage(index + 1) + '</span><strong>' + e(row.label) + "</strong></div>",
    '<div class="project-price-cell project-price-number" data-price-field="quantity">' + e(row.quantity) + "</div>",
    '<div class="project-price-cell project-price-number" data-price-field="duration">' + e(row.duration) + "</div>",
    '<div class="project-price-cell project-price-unknown" data-price-field="unit_rate" data-value-status="unknown">' + e(row.rate) + "</div>",
    '<div class="project-price-cell project-price-unknown" data-price-field="amount" data-value-status="unknown">' + e(row.amount) + "</div>",
    "</div>",
  ].join("")).join("");
  return [
    '<div class="project-price-layout">',
    '<div class="project-price-ledger" data-project-price-table="true">',
    '<div class="project-price-summary"><div class="project-price-summary-copy"><span>' + e(copy.summaryEyebrow) + '</span><strong>' + e(copy.summaryTitle) + '</strong></div><div class="project-price-summary-meta">' + stageMeta.map((value) => '<span>' + e(value) + "</span>").join("") + "</div></div>",
    '<div class="project-price-scenario" data-warning-status="scenario" data-price-scenario-disclosure="true">' + e(planningDisclosure) + "</div>",
    '<div class="project-price-head">' + [copy.item, copy.quantity, copy.duration, copy.unitRate, copy.amount].map((label, index) => '<span class="project-price-cell" data-price-field="' + ["item", "quantity", "duration", "unit_rate", "amount"][index] + '">' + e(label) + "</span>").join("") + "</div>",
    '<div class="project-price-rows' + (rows.length === 1 ? " project-price-rows-single" : "") + '">' + rowMarkup + "</div>",
    '<div class="project-price-total" data-project-price-total="true" data-project-price-total-minor="' + (content.hasProjectPrice ? String(content.projectPriceMinor) : "") + '" data-client-budget-minor="' + (content.hasClientBudget ? String(content.clientBudgetMinor) : "") + '" data-currency-status="' + currencyStatus + '" data-project-amount-kind="' + escapeHtmlAttribute(content.projectAmountKind) + '" data-claim-container="true"><div class="project-price-total-label"><strong>' + e(totalLabel) + '</strong>' + inlineSources(pagePlan.sourceIds, content, { compact: true }) + '</div><div class="project-price-total-value"><strong' + factualClaimAttributes(pagePlan.sourceIds, content.projectAmountKind === "budget_constraint" ? "brief-budget" : "project-total", { container: false }) + '>' + e(price) + "</strong></div></div>",
    "</div>",
    '<div class="project-price-disclosure">' + terms.map((row) => '<div class="project-price-term' + (row.warning ? " is-warning" : "") + '"' + (row.label === copy.currency ? ' data-currency-status="' + currencyStatus + '"' : "") + '><span>' + e(row.label) + '</span><strong>' + e(row.value) + "</strong></div>").join("") + "</div>",
    "</div>",
  ].join("");
}

function projectPriceLedgerRows(content, capacityPlan, copy) {
  if (capacityPlan && capacityPlan.rows.length >= 4 && capacityPlan.rows.length <= 8) {
    return capacityPlan.rows.map((row, index) => ({
      id: "PROJECT-PRICE-ROLE-" + (index + 1),
      roleIndex: index + 1,
      label: row.role,
      peakFte: row.peakFte,
      fteMonths: row.fteMonths,
      quantity: formatTeamFte(row.peakFte, content) + " FTE",
      duration: formatTeamFte(row.fteMonths, content),
      rate: copy.unknownMark,
      amount: copy.unknownMark,
      truthStatus: capacityPlan.truthStatus || "assumed",
    }));
  }
  return [{
    id: "PROJECT-PRICE-DELIVERY",
    label: copy.projectDelivery,
    quantity: copy.oneProject,
    duration: content.durationMonths ? formatRendererUnit(content.durationMonths, "month", content.locale) : copy.notSupplied,
    rate: copy.unknownMark,
    amount: copy.unknownMark,
    truthStatus: "unknown",
  }];
}

function projectPriceCopy(locale) {
  const normalized = normalizeRendererLocale(locale);
  if (normalized === "uz-Latn") {
    return {
      title: "Brifdagi loyiha summasi va xarajatlar tuzilmasi.",
      badge: "1 ta tasdiqlangan jami summa",
      summaryEyebrow: "LOYIHA BOSQICHI",
      summaryTitle: "Loyihani ishga tushirish",
      roleCount: (count) => count + " ta rejalashtirilgan rol",
      capacityPending: "Quvvatni aniqlash kerak",
      durationPending: "Muddatni aniqlash kerak",
      fteMonths: "FTE-oy",
      item: "Rol / xarajat bandi",
      quantity: "Eng yuqori FTE",
      duration: "FTE-oy",
      unitRate: "Oylik stavka",
      amount: "Rol summasi",
      notSupplied: "Taqdim etilmagan",
      notItemized: "Ajratilmagan",
      unknownMark: "—",
      workingAssumption: "ishchi faraz",
      confirmedTotal: "Tasdiqlangan loyiha summasi",
      budgetTotal: "Brifdagi budjet miqdori",
      planningTotal: "Rejalashtirilgan loyiha summasi",
      budgetBadge: "Brifdagi budjet",
      planningBadge: "Rejalashtirilgan jami summa",
      totalPending: "Loyiha summasi aniqlanadi",
      planningDisclosure: "Jamoa qatorlari rejalashtirilgan quvvatni ko‘rsatadi; stavka va rol kesimidagi summalar tasdiqlanmagan.",
      budgetNotQuote: "Mijoz budjeti tijorat taklifi narxi emas.",
      currency: "Valyuta",
      currencyNotSupplied: "Valyuta Taqdim etilmagan",
      currencyAssumption: "Valyuta — ishchi faraz",
      tax: "Soliq / QQS",
      external: "Tashqi / takroriy xarajatlar",
      contract: "Amal qilish / kafolat / yordam / IP",
      open: "Ochiq shart",
      confirmSeparately: "Alohida tasdiqlanadi",
      projectDelivery: "Loyihani ishlab chiqish",
      oneProject: "1 loyiha",
    };
  }
  if (normalized === "ru-RU") {
    return {
      title: "Сумма проекта из брифа и структура затрат.",
      badge: "1 подтверждённая итоговая сумма",
      summaryEyebrow: "ЭТАП ПРОЕКТА",
      summaryTitle: "Запуск проекта",
      roleCount: (count) => count + " плановых ролей",
      capacityPending: "Мощность уточнить",
      durationPending: "Срок уточнить",
      fteMonths: "FTE-месяца",
      item: "Роль / статья затрат",
      quantity: "Пиковая FTE",
      duration: "FTE-месяцы",
      unitRate: "Ставка в месяц",
      amount: "Сумма по роли",
      notSupplied: "Не предоставлена",
      notItemized: "Не распределена",
      unknownMark: "—",
      workingAssumption: "рабочее допущение",
      confirmedTotal: "Подтверждённая сумма проекта",
      budgetTotal: "Бюджет из брифа",
      planningTotal: "Плановая сумма проекта",
      budgetBadge: "Бюджет из брифа",
      planningBadge: "Плановая итоговая сумма",
      totalPending: "Сумма проекта уточняется",
      planningDisclosure: "Строки команды показывают плановую мощность; ставки и суммы по ролям не подтверждены.",
      budgetNotQuote: "Бюджет клиента не является подтверждённой ценой предложения.",
      currency: "Валюта",
      currencyNotSupplied: "Валюта не предоставлена",
      currencyAssumption: "Валюта — рабочее допущение",
      tax: "Налоги / НДС",
      external: "Внешние / регулярные затраты",
      contract: "Срок действия / гарантия / поддержка / IP",
      open: "Открыто",
      confirmSeparately: "Согласовать отдельно",
      projectDelivery: "Разработка проекта",
      oneProject: "1 проект",
    };
  }
  return {
    title: "Brief project total and cost structure.",
    badge: "1 confirmed project total",
    summaryEyebrow: "PROJECT STAGE",
    summaryTitle: "Project launch",
    roleCount: (count) => count + " planned roles",
    capacityPending: "Capacity to confirm",
    durationPending: "Duration to confirm",
    fteMonths: "FTE-months",
    item: "Role / cost item",
    quantity: "Peak FTE",
    duration: "FTE-months",
    unitRate: "Monthly rate",
    amount: "Role amount",
    notSupplied: "Not supplied",
    notItemized: "Not itemized",
    unknownMark: "—",
    workingAssumption: "working assumption",
    confirmedTotal: "Confirmed project total",
    budgetTotal: "Budget stated in the brief",
    planningTotal: "Planning project total",
    budgetBadge: "Brief budget",
    planningBadge: "Planning total",
    totalPending: "Project total to confirm",
    planningDisclosure: "Team rows show planned capacity; role rates and role amounts are not confirmed.",
    budgetNotQuote: "The client budget is not a confirmed proposal price.",
    currency: "Currency",
    currencyNotSupplied: "Currency Not supplied",
    currencyAssumption: "Currency is a working assumption",
    tax: "Tax / VAT",
    external: "External / recurring costs",
    contract: "Validity / warranty / support / IP",
    open: "Open",
    confirmSeparately: "Confirm separately",
    projectDelivery: "Project delivery",
    oneProject: "1 project",
  };
}

function renderPayments(content, _tokens, dynamicRules = []) {
  if (!content.payments.length) {
    return [
      '<div class="payment-layout">',
      scenarioBanner(content, [], "unknown", { payment: true }),
      missingState(content, l(content, "Payment schedule is not supplied."), l(content, "A project total alone is not a payment schedule. Every stage needs an amount, share, and acceptance trigger."), [l(content, "Confirm payment stages."), l(content, "Attach exact amounts and shares."), l(content, "Define the accepted outcome that releases each payment.")]),
      '<div class="payment-total"><span>' + e(l(content, "Scheduled total")) + '</span><strong>' + e(l(content, "Not supplied")) + '</strong><span>' + e(l(content, "Commercial input required")) + "</span></div>",
      "</div>",
    ].join("");
  }
  let cumulativeBasisPoints = 0;
  const rows = content.payments.map((row, index) => {
    cumulativeBasisPoints += row.percentBasisPoints;
    // The cumulative indicator fills a little further after every stage and
    // reaches 100% on the final payment.
    const progressPercent = (Math.min(10000, cumulativeBasisPoints) / 100).toFixed(2);
    return '<div class="payment-row" data-payment-truth-status="' + escapeHtmlAttribute(row.truthStatus || "unknown") + '"><div><strong>' + e(padPage(index + 1) + " · " + row.name) + '</strong><p>' + e(row.acceptance || l(content, "Acceptance trigger to confirm")) + '</p></div><span>' + e(formatBasisPoints(row.percentBasisPoints, content)) + '</span><span>' + e(formatMinor(row.amountMinor, content.currency, content.currencyExponent, content)) + '</span><div class="payment-progress" aria-hidden="true"><span style="width:' + progressPercent + '%"></span></div></div>';
  }).join("");
  const total = content.payments.reduce((sum, row) => sum + row.amountMinor, 0);
  const percentTotal = content.payments.reduce((sum, row) => sum + row.percentBasisPoints, 0);
  const reconciled = content.paymentBasisMinor > 0 && total === content.paymentBasisMinor && percentTotal === 10000;
  const markup = [
    '<div class="payment-layout" data-payment-schedule="true">',
    '<div class="panel">' + commercialCurrencyNote(content) + scenarioBanner(content, content.payments, "", { payment: true }) + '<div class="payment-head"><span>' + e(l(content, "Payment / acceptance")) + '</span><span>' + e(l(content, "Share (rounded to 0.01%)")) + '</span><span>' + e(l(content, "Amount")) + "</span></div>" + rows + "</div>",
    '<div class="payment-total"><span>' + e(l(content, "Scheduled total")) + " · " + e(reconciled ? l(content, "100.00% after rounding") : l(content, "requires reconciliation")) + '</span><strong>' + e(formatMinor(total, content.currency, content.currencyExponent, content)) + '</strong><span>· ' + e(formatBasisPoints(percentTotal, content)) + "</span></div>",
    "</div>",
  ].join("");
  // The per-stage progress widths are inline styles; hoist them into scoped
  // dynamic rules so the document keeps its no-inline-style CSP invariant.
  return hoistTrustedInlineStyles(markup, "payments", dynamicRules);
}

function renderClose(content) {
  const paymentScheduleRequired = content.presentationKinds.has("payments");
  const paymentScheduleReady = !paymentScheduleRequired || (
    content.payments.length > 0
    && content.paymentBasisMinor > 0
    && content.payments.reduce((sum, row) => sum + row.amountMinor, 0) === content.paymentBasisMinor
  );
  const commercialBlockers = [
    !content.hasProjectPrice ? l(content, "Project quote") : "",
    content.currencyStatus !== "explicit" || content.currency === "XXX" ? l(content, "Currency") : "",
    !content.commercialTerms.tax ? l(content, "Tax / VAT") : "",
    !content.commercialTerms.validity ? l(content, "Quote validity") : "",
    !content.commercialTerms.externalCosts ? l(content, "External and recurring costs") : "",
    !content.commercialTerms.warranty ? l(content, "Warranty") : "",
    !content.commercialTerms.support ? l(content, "Support") : "",
    !content.commercialTerms.ip ? l(content, "Intellectual property") : "",
    !paymentScheduleReady ? l(content, "Payment schedule") : "",
  ].filter(Boolean).map((label) => ({ kind: "commercial", label, owner: content.decisionOwners?.commercial || l(content, "Client commercial owner") }));
  const dependencyBlockers = content.clientDependencies
    .filter((row) => clientDependencyReadinessBucket(row.status) !== "ready")
    .map((row) => ({ kind: "dependency", label: row.label, owner: row.owner || l(content, "Client owner to appoint") }));
  const blockers = [...commercialBlockers, ...dependencyBlockers];
  const commercialReady = commercialBlockers.length === 0;
  const dependenciesReady = dependencyBlockers.length === 0;
  const closeReady = commercialReady && dependenciesReady;
  const decisions = [
    {
      decision: l(content, "Decision · Scope baseline"),
      detail: content.scope.length ? approveScopeLabel(content, content.scope.length) : l(content, "Supply and approve the launch scope."),
      owner: clientText(content.decisionOwners?.scope || l(content, "Client sponsor"), 100),
      status: content.decisionOwners?.scope ? l(content, "Ready for decision") : l(content, "Owner to appoint"),
    },
    {
      decision: l(content, "Decision · Commercial terms"),
      detail: commercialReady
        ? paymentScheduleRequired
          ? l(content, "Confirm currency, tax/VAT, quote validity, warranty, support and IP; then approve the price and payment stages.")
          : l(content, "Confirm currency, tax/VAT, quote validity, warranty, support and IP; then approve the project price.")
        : l(content, "Resolve every open commercial item shown on this page and the project-price page."),
      owner: clientText(content.decisionOwners?.commercial || l(content, "Client commercial owner"), 100),
      status: !commercialReady ? l(content, "Input required") : content.decisionOwners?.commercial ? l(content, "Ready for decision") : l(content, "Owner to appoint"),
    },
    {
      decision: l(content, "Decision · Delivery ownership"),
      detail: dependenciesReady
        ? content.team.roles.length ? l(content, "Confirm named participants, kickoff date, and acceptance cadence.") : l(content, "Approve delivery roles and accountable owners.")
        : l(content, "Provide the open client inputs and appoint their accountable owners."),
      owner: clientText(content.decisionOwners?.delivery || l(content, "Udevs delivery lead"), 100),
      status: !dependenciesReady ? l(content, "Input required") : content.decisionOwners?.delivery ? l(content, "Ready to assign") : l(content, "Owner to appoint"),
    },
  ];
  const nextAction = closeReady
    ? meaningfulNarrative(content.narrative.closingStatement) || l(content, "Run one decision review: approve scope, commercial terms, owners, and the kickoff evidence baseline.")
    : l(content, "Resolve every open item below before commercial approval.");
  const blockerMarkup = blockers.map((row) => [
    '<div class="close-blocker" data-close-blocker="true" data-blocker-kind="' + row.kind + '">',
    '<span>' + e(l(content, row.kind === "commercial" ? "COMMERCIAL" : "CLIENT DEPENDENCY")) + '</span>',
    '<strong>' + e(row.label) + '</strong>',
    '</div>',
  ].join("")).join("");
  return [
    '<div class="decision-layout" data-close-ready="' + closeReady + '" data-close-blocker-count="' + blockers.length + '">',
    '<div class="decision-list panel"><div class="table-head"><span>' + e(l(content, "Decision")) + '</span><span>' + e(l(content, "Required outcome")) + '</span><span>' + e(l(content, "Owner")) + '</span><span>' + e(l(content, "Status")) + "</span></div>" + decisions.map((row) => '<div class="decision-row"><span>' + e(row.decision) + '</span><strong>' + e(row.detail) + '</strong><p>' + e(row.owner) + '</p><span class="decision-status">' + e(row.status) + '</span></div>').join("") + "</div>",
    '<div class="next-action panel-soft"><span class="eyebrow">' + e(l(content, "NEXT ACTION")) + '</span><strong>' + e(l(content, closeReady ? "Decision meeting" : "Open blockers")) + '</strong><p>' + e(nextAction) + '</p>' + (blockers.length ? '<div class="close-blockers">' + blockerMarkup + '</div>' : '<div class="close-assumptions"><span>' + e(l(content, "MEETING OUTCOME")) + '</span><p>' + e(l(content, "Approved product scope")) + '</p><p>' + e(l(content, "Named decision owners")) + '</p><p>' + e(l(content, "Agreed kickoff date")) + "</p></div>") + '</div>',
    "</div>",
  ].join("");
}

function renderSemanticPage(spec, pagePlan, styleProfile, dynamicRules, content) {
  const displaySpec = localizeVisualizationSpec(spec, content.locale);
  if (spec.kind === "gantt" && spec.variant === "gantt") {
    return renderDevelopmentStagesPage(displaySpec, pagePlan, styleProfile, dynamicRules, content);
  }
  if (spec.kind === "nested_market") {
    return renderMarketSizingPage(displaySpec, pagePlan, content);
  }
  const isProductMap = displaySpec.kind === "hub_spoke" && displaySpec.variant === "left_to_right_tree";
  const isBpmn = displaySpec.kind === "bpmn";
  const canvas = isProductMap || isBpmn ? { width: 1296, height: 646 } : { width: 1120, height: 540 };
  const layout = layoutVisualization(displaySpec, canvas);
  const rendered = renderVisualization(displaySpec, layout, styleProfile, { locale: content.locale });
  const safeMarkup = hoistTrustedInlineStyles(rendered, "viz-" + pagePlan.pageNumber, dynamicRules);
  const summary = semanticSummary(spec, pagePlan.pageNumber, content);
  const expandedClass = isProductMap ? " semantic-layout-product-map" : isBpmn ? " semantic-layout-bpmn" : "";
  return '<div class="semantic-layout' + expandedClass + '">' + safeMarkup + '<div class="semantic-note"><span>' + e(summary.label) + '</span><p>' + e(summary.detail) + '</p>' + inlineSources(pagePlan.sourceIds, content, { compact: true }) + "</div></div>";
}

function renderMarketSizingPage(spec, pagePlan, content) {
  const copy = marketSizingCopy(content.locale);
  const pending = spec.variant === "formula_pending" || spec.dataState === "pending";
  const tam = array(spec.nodes).find((node) => node.id === (pending ? "FORMULA-TAM" : "MARKET-TAM"));
  const sam = array(spec.nodes).find((node) => node.id === (pending ? "FORMULA-SAM" : "MARKET-SAM"));
  const somNodes = pending
    ? array(spec.nodes).filter((node) => node.id === "FORMULA-SOM")
    : array(spec.nodes).filter((node) => String(node.id || "").startsWith("MARKET-SOM-")).slice(0, 3);
  if (!tam || !sam || somNodes.length < 1) {
    throw rendererError("CONTENT_MARKET_SIZING_STRUCTURE_INVALID", "TAM/SAM/SOM requires one semantic node for every market level");
  }
  const context = pending
    ? copy.contextPending
    : [tam.metric?.geography, tam.metric?.period, tam.metric?.currency].filter(Boolean).join(" · ");
  const questionNodes = array(spec.nodes).filter((node) => node.type === "question");
  const missingInputs = pending
    ? '<div class="market-missing-inputs market-sizing-pending-inputs" data-market-missing-inputs="true">' + questionNodes.map((node, index) => '<div class="market-missing-input" data-node-id="' + escapeHtmlAttribute(node.id) + '" data-truth-status="' + escapeHtmlAttribute(node.truthStatus || "unknown") + '"><span>Q' + (index + 1) + '</span><p>' + e(node.label) + "</p></div>").join("") + "</div>"
    : "";
  const story = [
    '<div class="market-story">',
    '<div class="market-thesis market-sizing-thesis"><span>' + e(copy.thesisKicker) + '</span><strong>' + e(pending ? copy.pendingThesis : copy.numericThesis) + '</strong><p>' + e(pending ? copy.pendingThesisDetail : copy.numericThesisDetail) + "</p></div>",
    '<div class="market-discipline market-sizing-discipline"><span>' + e(copy.disciplineKicker) + '</span><strong>' + e(copy.disciplineTitle) + '</strong><p>' + e(pending ? copy.pendingDisciplineDetail : copy.numericDisciplineDetail) + "</p>" + missingInputs + "</div>",
    "</div>",
  ].join("");
  const sourceIds = [...new Set([tam, sam, ...somNodes].flatMap((node) => array(node.sourceIds).map(String).filter(Boolean)))];
  const modeledMethodology = clientText(array(content.market?.methodology).slice(0, 3).join(" "), 360);
  const benchmarkDisclosure = array(content.market?.methodology).find((item) => /benchmark|ориентир|geografiya|geography/iu.test(String(item || "")));
  const tamLevel = renderMarketLevel("tam", tam, pending, content, copy);
  const samLevel = renderMarketLevel("sam", sam, pending, content, copy);
  const somLevel = renderMarketSomLevel(somNodes, pending, content, copy);
  const model = [
    '<div class="market-model">',
    '<div class="market-context"><span>' + e(copy.contextKicker) + '</span><strong>' + e(context || copy.contextPending) + "</strong></div>",
    '<div class="viz-canvas market-sizing-funnel" data-viz-id="' + escapeHtmlAttribute(spec.visualizationSpecId) + '" data-viz-kind="nested_market" data-viz-variant="' + escapeHtmlAttribute(spec.variant) + '" data-data-state="' + escapeHtmlAttribute(spec.dataState) + '">' + tamLevel + samLevel + somLevel + "</div>",
    '<div class="market-methodology market-sizing-methodology" data-market-methodology="true"><span>' + e(copy.methodKicker) + '</span><p>' + e(pending ? copy.pendingMethodology : modeledMethodology || copy.numericMethodology) + "</p>" + inlineSources(sourceIds, content, { compact: true }) + "</div>",
    "</div>",
  ].join("");
  const numericDisclosure = [copy.scenarioDisclosure, benchmarkDisclosure].filter(Boolean).join(" ");
  const disclosure = '<div class="market-scenario-disclosure" data-market-scenario-disclosure="true" data-warning-status="' + (pending ? "pending" : "scenario") + '"><span>' + e(pending ? copy.pendingDisclosureKicker : copy.scenarioDisclosureKicker) + '</span><p>' + e(pending ? copy.pendingDisclosure : numericDisclosure) + "</p></div>";
  return '<div class="market-sizing-layout" data-market-state="' + (pending ? "pending" : "numeric") + '">' + story + model + disclosure + "</div>";
}

function renderMarketLevel(level, node, pending, content, copy) {
  const label = level.toUpperCase();
  const truthStatus = node.truthStatus || (pending ? "recommended" : "unknown");
  const sourceIds = array(node.sourceIds).map(String).filter(Boolean);
  const valueAttributes = pending ? "" : ' data-market-value="' + escapeHtmlAttribute(String(node.metric?.value || "")) + '"';
  const claimAttributes = pending || !["explicit", "verified", "single_source"].includes(truthStatus) ? "" : factualClaimAttributes(sourceIds, "market-" + level, { container: false });
  const primary = pending ? node.label : formatMarketValue(node.metric, content);
  const evidenceLabel = truthStatus === "assumed"
    ? l(content, "Assumption")
    : ["explicit", "verified", "single_source"].includes(truthStatus)
      ? evidenceClaimLabel({ truthStatus, claimNature: node.claimNature }, content)
      : "";
  const detail = pending
    ? copy.formulaDetail[level]
    : level === "sam" && finitePositive(node.metric?.shareOfParent)
      ? [formatMarketPercent(node.metric.shareOfParent, content) + " · " + copy.ofTam, evidenceLabel].filter(Boolean).join(" · ")
      : [node.metric?.geography, node.metric?.period, evidenceLabel].filter(Boolean).join(" · ");
  return '<div class="market-level market-level-' + level + '" data-market-level="' + level + '" data-geometry-role="market_level" data-node-id="' + escapeHtmlAttribute(node.id) + '" data-node-type="market_level" data-semantic-role="' + escapeHtmlAttribute(node.semanticRole || "neutral") + '" data-truth-status="' + escapeHtmlAttribute(truthStatus) + '"' + valueAttributes + '><div class="market-level-copy"><span>' + e(label) + '</span><strong' + claimAttributes + '>' + e(primary) + '</strong><p>' + e(detail) + "</p></div></div>";
}

function renderMarketSomLevel(nodes, pending, content, copy) {
  const node = nodes[0];
  if (pending) return renderMarketLevel("som", node, true, content, copy);
  const scenarios = nodes.map((scenario, index) => {
    const sourceIds = array(scenario.sourceIds).map(String).filter(Boolean);
    const label = marketScenarioLabel(scenario, index, copy);
    const share = finitePositive(scenario.metric?.shareOfParent) ? formatMarketPercent(scenario.metric.shareOfParent, content) : copy.modeledScenario;
    const claimAttributes = ["explicit", "verified", "single_source"].includes(scenario.truthStatus) ? factualClaimAttributes(sourceIds, "market-som-" + (index + 1), { container: false }) : "";
    return '<div class="market-scenario" data-scenario-id="' + escapeHtmlAttribute(scenario.id) + '" data-node-id="' + escapeHtmlAttribute(scenario.id) + '" data-truth-status="' + escapeHtmlAttribute(scenario.truthStatus || "assumed") + '" data-market-value="' + escapeHtmlAttribute(String(scenario.metric?.value || "")) + '"><span>' + e(label + " · " + share + " · " + l(content, "Assumption")) + '</span><strong' + claimAttributes + '>' + e(formatMarketValue(scenario.metric, content)) + "</strong></div>";
  }).join("");
  return '<div class="market-level market-level-som" data-market-level="som" data-geometry-role="market_level" data-node-id="MARKET-SOM" data-node-type="market_level" data-semantic-role="positive" data-truth-status="scenario"><div class="market-level-copy"><span>SOM</span><div class="market-scenarios">' + scenarios + "</div></div></div>";
}

function marketScenarioLabel(node, index, copy) {
  const parts = String(node.label || "").split(" · ").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[1] : copy.scenario + " " + (index + 1);
}

function formatMarketValue(metric, content = {}) {
  const value = finitePositive(metric?.value);
  if (value === null) return l(content, "To confirm");
  const formatted = new Intl.NumberFormat(content.intlLocale || rendererIntlLocale(content.locale), {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 2,
  }).format(value);
  return metric?.currency ? String(metric.currency).toUpperCase() + " " + formatted : formatted;
}

function formatMarketPercent(value, content = {}) {
  const share = finitePositive(value);
  if (share === null) return l(content, "Share to confirm");
  return new Intl.NumberFormat(content.intlLocale || rendererIntlLocale(content.locale), {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(share);
}

function marketSizingCopy(locale) {
  const normalized = normalizeRendererLocale(locale);
  if (normalized === "ru-RU") return {
    pendingTitle: "Строим проверяемую модель TAM, SAM и SOM без выдуманных сумм.",
    numericTitle: "Превращаем объём рынка в измеримое решение о запуске.",
    thesisKicker: "ГИПОТЕЗА ДЛЯ РЕШЕНИЯ",
    pendingThesis: "Сначала фиксируем границу. Затем рассчитываем объём.",
    numericThesis: "Рыночная гипотеза становится основой решения.",
    pendingThesisDetail: "TAM, SAM и SOM должны использовать одну географию, период и валюту.",
    numericThesisDetail: "Каждый уровень сужает предыдущий и сохраняет единый контекст расчёта.",
    disciplineKicker: "ДИСЦИПЛИНА МОДЕЛИ",
    disciplineTitle: "Покажите формулу. Проверьте источник. Затем оцените сценарий.",
    pendingDisciplineDetail: "Пока входные данные не подтверждены, значения намеренно не рассчитываются.",
    numericDisciplineDetail: "Факты, производные значения и сценарные допущения остаются различимыми.",
    contextKicker: "КОНТЕКСТ РАСЧЁТА",
    contextPending: "География · период · валюта — подтвердить",
    methodKicker: "МЕТОД И ИСТОЧНИКИ",
    pendingMethodology: "TAM задаёт весь адресуемый рынок; SAM — обслуживаемую долю TAM; SOM — отдельный сценарий захвата доли SAM.",
    numericMethodology: "TAM → SAM → SOM — вложенная модель. Доли сверяются с родительским уровнем; источники относятся только к поддержанным значениям.",
    pendingDisclosureKicker: "ДАННЫЕ НЕ ПОДМЕНЕНЫ",
    pendingDisclosure: "Рыночные суммы не показаны, потому что надёжный знаменатель и единый контекст пока не подтверждены.",
    scenarioDisclosureKicker: "СЦЕНАРНОЕ ОГРАНИЧЕНИЕ",
    scenarioDisclosure: "Значения SOM — отдельные сценарии захвата рынка, а не числа для сложения. Выберите один сценарий после проверки входных данных.",
    formulaDetail: { tam: "Общий адресуемый рынок", sam: "Обслуживаемый сегмент TAM", som: "Сценарий захвата доли SAM" },
    ofTam: "от TAM",
    modeledScenario: "модельный сценарий",
    scenario: "Сценарий",
  };
  if (normalized === "uz-Latn") return {
    pendingTitle: "TAM, SAM va SOM uchun tekshiriladigan bozor modelini quramiz.",
    numericTitle: "Bozor hajmini o‘lchanadigan ishga tushirish qaroriga aylantiramiz.",
    thesisKicker: "QAROR GIPOTEZASI",
    pendingThesis: "Avval chegarani belgilaymiz. Keyin hajmni hisoblaymiz.",
    numericThesis: "Bozor gipotezasi qaror uchun o‘lchanadigan asosga aylanadi.",
    pendingThesisDetail: "TAM, SAM va SOM bir xil geografiya, davr va valyutada hisoblanishi kerak.",
    numericThesisDetail: "Har bir daraja avvalgisini toraytiradi va hisob kontekstini bir xil saqlaydi.",
    disciplineKicker: "MODEL INTIZOMI",
    disciplineTitle: "Formulani ko‘rsating. Manbani tekshiring. Keyin ssenariyni baholang.",
    pendingDisciplineDetail: "Kirish ma’lumotlari tasdiqlanmaguncha qiymatlar ataylab hisoblanmaydi.",
    numericDisciplineDetail: "Faktlar, hosila qiymatlar va ssenariy farazlari bir-biridan ajratiladi.",
    contextKicker: "HISOB KONTEKSTI",
    contextPending: "Geografiya · davr · valyuta — tasdiqlanadi",
    methodKicker: "METOD VA MANBALAR",
    pendingMethodology: "TAM barcha manzilli bozorni; SAM — TAMning xizmat ko‘rsatiladigan qismini; SOM — SAM ulushini egallash ssenariysini ifodalaydi.",
    numericMethodology: "TAM → SAM → SOM — ichma-ich model. Ulushlar ota daraja bilan solishtiriladi; manbalar faqat tasdiqlangan qiymatlarga biriktiriladi.",
    pendingDisclosureKicker: "MA’LUMOT O‘YLAB TOPILMADI",
    pendingDisclosure: "Ishonchli bozor bazasi va yagona hisob konteksti tasdiqlanmagani uchun bozor summalari ko‘rsatilmagan.",
    scenarioDisclosureKicker: "SSENARIY CHEGARASI",
    scenarioDisclosure: "SOM qiymatlari alohida bozor ulushini egallash ssenariylaridir va bir-biriga qo‘shilmaydi. Kirishlar tekshirilgach bitta ssenariy tanlanadi.",
    formulaDetail: { tam: "Umumiy manzilli bozor", sam: "TAMning xizmat ko‘rsatiladigan segmenti", som: "SAM ulushini egallash ssenariysi" },
    ofTam: "TAMdan",
    modeledScenario: "model ssenariysi",
    scenario: "Ssenariy",
  };
  return {
    pendingTitle: "Build a verifiable TAM, SAM, and SOM model without invented values.",
    numericTitle: "Turn market size into a measurable launch decision.",
    thesisKicker: "DECISION HYPOTHESIS",
    pendingThesis: "Define the boundary first. Calculate the volume second.",
    numericThesis: "The market hypothesis becomes a measurable decision input.",
    pendingThesisDetail: "TAM, SAM, and SOM must use one geography, period, and currency.",
    numericThesisDetail: "Each level narrows the one above it while preserving a consistent calculation context.",
    disciplineKicker: "MODEL DISCIPLINE",
    disciplineTitle: "Show the formula. Validate the source. Then assess the scenario.",
    pendingDisciplineDetail: "Values remain intentionally uncalculated until the required inputs are confirmed.",
    numericDisciplineDetail: "Facts, derived values, and scenario assumptions remain visibly distinct.",
    contextKicker: "MODEL CONTEXT",
    contextPending: "Geography · period · currency — to confirm",
    methodKicker: "METHOD AND SOURCES",
    pendingMethodology: "TAM is the total addressable market; SAM is the serviceable share of TAM; SOM is a capture-rate scenario within SAM.",
    numericMethodology: "TAM → SAM → SOM is a nested model. Shares reconcile to their parent level; sources attach only to supported values.",
    pendingDisclosureKicker: "NO VALUES INVENTED",
    pendingDisclosure: "Market amounts are withheld because a reliable denominator and one consistent calculation context are not yet confirmed.",
    scenarioDisclosureKicker: "SCENARIO BOUNDARY",
    scenarioDisclosure: "SOM values are alternative capture scenarios, not additive totals. Select one scenario after validating the inputs.",
    formulaDetail: { tam: "Total addressable market", sam: "Serviceable segment of TAM", som: "Capture-rate scenario within SAM" },
    ofTam: "of TAM",
    modeledScenario: "modeled scenario",
    scenario: "Scenario",
  };
}

function renderDevelopmentStagesPage(spec, pagePlan, styleProfile, dynamicRules, content) {
  const tokens = resolveStyleTokens(styleProfile);
  const copy = developmentStagesCopy(content.locale, content.isMarketplace);
  const scale = normalizeDevelopmentScale(spec.timeScale);
  const phases = array(spec.nodes)
    .filter((node) => node?.type === "phase")
    .filter((node) => Number.isFinite(Number(node?.time?.start)) && Number.isFinite(Number(node?.time?.end)))
    .map((node) => ({
      ...node,
      start: Math.max(scale.start, Math.min(scale.end, Math.floor(Number(node.time.start)))),
      end: Math.max(scale.start, Math.min(scale.end, Math.floor(Number(node.time.end)))),
    }))
    .map((node) => ({ ...node, end: Math.max(node.start, node.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!phases.length) {
    throw rendererError("CONTENT_ROADMAP_STRUCTURE_INVALID", "The Development Stages page requires at least one bounded stage");
  }

  const totalUnits = scale.end - scale.start + 1;
  const phaseColors = [tokens.primary, tokens.warning, tokens.secondary, tokens.positive];
  const phaseGeometry = phases.map((phase, index) => {
    const left = ((phase.start - scale.start) / totalUnits) * 100;
    const width = ((phase.end - phase.start + 1) / totalUnits) * 100;
    const inset = Math.min(.28, Math.max(.08, width * .025));
    return {
      phase,
      color: phaseColors[index % phaseColors.length],
      left,
      width,
      bandLeft: left + inset,
      bandWidth: Math.max(.2, width - inset * 2),
      gateLeft: Math.min(99.78, ((phase.end - scale.start + 1) / totalUnits) * 100),
    };
  });
  const workstreamColors = [tokens.primary, tokens.warning, tokens.secondary, tokens.primary, tokens.warning, tokens.critical, tokens.positive];
  const workstreams = array(spec.nodes)
    .filter((node) => node?.type === "task" && Number.isFinite(Number(node?.time?.start)) && Number.isFinite(Number(node?.time?.end)))
    .map((node, index) => ({
      ...node,
      start: Math.max(scale.start, Math.min(scale.end, Math.floor(Number(node.time.start)))),
      end: Math.max(scale.start, Math.min(scale.end, Math.floor(Number(node.time.end)))),
      color: workstreamColors[index % workstreamColors.length],
    }))
    .map((node) => ({ ...node, end: Math.max(node.start, node.end) }));
  if (!workstreams.length || workstreams.length > ROADMAP_WORKSTREAM_PAGE_LIMIT) {
    throw rendererError("CONTENT_ROADMAP_STRUCTURE_INVALID", `The Development Stages page requires one to ${ROADMAP_WORKSTREAM_PAGE_LIMIT} product-map workstreams`);
  }
  const ticks = Array.from({ length: totalUnits }, (_, index) => scale.start + index);
  const grid = ticks.map(() => '<span class="roadmap-grid-cell"></span>').join("");

  const phaseMarkup = phaseGeometry.map(({ phase, color, bandLeft, bandWidth }) => [
    '<div class="roadmap-phase-band" data-geometry-role="semantic_node" data-node-id="' + escapeHtmlAttribute(phase.id) + '" data-node-type="phase" data-semantic-role="' + escapeHtmlAttribute(phase.semanticRole || "neutral") + '" data-truth-status="' + escapeHtmlAttribute(phase.truthStatus || "assumed") + '" data-inclusion="' + escapeHtmlAttribute(phase.inclusion || "recommended") + '" style="left:' + percentValue(bandLeft) + '%;width:' + percentValue(bandWidth) + '%;border-color:' + color + ';background:' + tokens.background + '">',
    '<strong>' + e(phase.label) + '</strong>',
    '<small>' + e(developmentRangeLabel(scale.unit, phase.start, phase.end, content.locale)) + "</small>",
    "</div>",
  ].join("")).join("");

  const workstreamLabels = workstreams.map((row, index) => [
    '<div class="roadmap-label-cell roadmap-workstream-label">',
    '<span>' + String(index + 1).padStart(2, "0") + "</span>",
    '<strong>' + e(row.label) + '</strong>',
    '<small>' + e(developmentRangeLabel(scale.unit, row.start, row.end, content.locale)) + "</small>",
    "</div>",
  ].join("")).join("");

  const workstreamRows = workstreams.map((row) => {
    const left = ((row.start - scale.start) / totalUnits) * 100;
    const width = ((row.end - row.start + 1) / totalUnits) * 100;
    const inset = Math.min(.34, Math.max(.08, width * .018));
    return [
      '<div class="roadmap-workstream-row">',
      '<div class="roadmap-week-grid">' + grid + "</div>",
      '<span class="roadmap-workstream-bar" data-geometry-role="roadmap_workstream" data-node-id="' + escapeHtmlAttribute(row.id) + '" data-node-type="task" data-semantic-role="' + escapeHtmlAttribute(row.semanticRole || "owned") + '" data-truth-status="' + escapeHtmlAttribute(row.truthStatus || "assumed") + '" data-inclusion="' + escapeHtmlAttribute(row.inclusion || "recommended") + '" style="left:' + percentValue(left + inset) + '%;width:' + percentValue(Math.max(.2, width - inset * 2)) + '%;border-color:' + row.color + ';background:' + row.color + ';color:' + readableTextColor(row.color, tokens.text, tokens.background) + '"><small>' + e(developmentRangeLabel(scale.unit, row.start, row.end, content.locale)) + "</small></span>",
      "</div>",
    ].join("");
  }).join("");

  const gateLines = phaseGeometry.map(({ color, gateLeft }, index) => '<span class="roadmap-gate-line" data-geometry-role="roadmap_gate" data-truth-status="assumed" style="left:' + percentValue(gateLeft) + '%;border-color:' + color + '"><strong>G' + (index + 1) + "</strong></span>").join("");
  const gateCards = phaseGeometry.map(({ left, width }, index) => '<div class="roadmap-gate-card" data-geometry-role="roadmap_gate_outcome" data-truth-status="assumed" style="left:' + percentValue(left) + '%;width:' + percentValue(width) + '%"><p>' + e(developmentGateOutcome(copy, index, phaseGeometry.length)) + "</p></div>").join("");
  const tickMarkup = ticks.map((tick) => '<span>' + e(timeAxisTickLabel(scale.unit, tick, content.locale)) + "</span>").join("");
  const duration = content.durationMonths
    ? formatRendererUnit(content.durationMonths, "month", content.locale)
    : content.durationWeeks
      ? formatRendererUnit(content.durationWeeks, "week", content.locale)
      : formatRendererUnit(totalUnits, scale.unit, content.locale);
  const sourceMarkup = inlineSources(pagePlan.sourceIds, content, { compact: true });
  const durationClaim = sourceMarkup ? factualClaimAttributes(pagePlan.sourceIds, "roadmap-delivery-duration", { container: false }) : "";
  const durationContainer = sourceMarkup ? ' data-claim-container="true"' : "";
  const intro = [
    '<div class="roadmap-stage-intro">',
    '<div class="roadmap-stage-thesis"><span>' + e(copy.parallelLabel) + '</span><p>' + e(copy.thesis(workstreams.length, phaseGeometry.length)) + "</p></div>",
    '<div class="roadmap-duration-fact"' + durationContainer + '><span>' + e(copy.briefDuration) + '</span><strong' + durationClaim + '>' + e(duration) + "</strong>" + sourceMarkup + "</div>",
    "</div>",
  ].join("");
  const roadmapGridClass = addDynamicRule(
    "roadmap-grid-" + pagePlan.pageNumber,
    "grid-template-rows:48px 26px repeat(" + workstreams.length + ",minmax(0,1fr)) 78px",
    dynamicRules,
  );
  const chart = [
    '<div class="viz-canvas viz-roadmap roadmap-stage-chart" data-viz-id="' + escapeHtmlAttribute(spec.visualizationSpecId) + '" data-viz-kind="gantt" data-viz-variant="gantt" data-data-state="' + escapeHtmlAttribute(spec.dataState) + '">',
    '<div class="roadmap-label-column ' + roadmapGridClass + '">',
    '<div class="roadmap-label-cell roadmap-label-heading"><strong>' + e(copy.stages) + "</strong></div>",
    '<div class="roadmap-label-cell"><span>' + e(copy.planningScale) + '</span><strong>' + e(formatRendererUnit(totalUnits, scale.unit, content.locale)) + "</strong></div>",
    workstreamLabels,
    '<div class="roadmap-label-cell roadmap-label-gates"><span>' + e(copy.gates) + '</span><strong>' + e(copy.targetOutcomes) + "</strong></div>",
    "</div>",
    '<div class="roadmap-timeline-column ' + roadmapGridClass + '">',
    '<div class="roadmap-phase-track">' + phaseMarkup + "</div>",
    '<div class="viz-gantt-axis roadmap-week-track">' + tickMarkup + "</div>",
    workstreamRows,
    '<div class="roadmap-gate-outcomes">' + gateCards + "</div>",
    '<div class="roadmap-gate-layer">' + gateLines + "</div>",
    "</div>",
    "</div>",
  ].join("");
  const disclosure = '<div class="roadmap-stage-disclosure" data-warning-status="scenario"><span>' + e(copy.scenario) + '</span><p>' + e(copy.disclosure) + "</p></div>";
  const safeMarkup = hoistTrustedInlineStyles(intro + chart + disclosure, "roadmap-" + pagePlan.pageNumber, dynamicRules);
  return '<div class="semantic-layout roadmap-stage-layout">' + safeMarkup + "</div>";
}

function normalizeDevelopmentScale(timeScale = {}) {
  const start = Math.floor(Number(timeScale.start));
  const end = Math.floor(Number(timeScale.end));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start + 1 > 52) {
    throw rendererError("CONTENT_ROADMAP_SCALE_MISSING", "Development Stages requires a bounded time scale of at most 52 units");
  }
  return { start, end, unit: String(timeScale.unit || "week") };
}

function developmentWorkstreams(copy, scale) {
  const total = scale.end - scale.start + 1;
  const startAt = (fraction) => Math.min(scale.end, scale.start + Math.floor(total * fraction));
  const endAt = (fraction) => Math.max(scale.start, Math.min(scale.end, scale.start + Math.ceil(total * fraction) - 1));
  const spans = [
    [0, .25],
    [0, .5],
    [0, .25],
    [.125, .75],
    [.25, .75],
    [.5, .9375],
    [.75, 1],
  ];
  return copy.workstreams.map((label, index) => {
    const start = startAt(spans[index][0]);
    const end = Math.max(start, endAt(spans[index][1]));
    return { label, start, end };
  });
}

function developmentGateOutcome(copy, index, count) {
  if (index === count - 1) return copy.gateOutcomes[3];
  if (count === 3 && index === 1) return copy.gateOutcomes[1];
  return copy.gateOutcomes[Math.min(index, 2)];
}

function developmentRangeLabel(unit, start, end, locale) {
  return timeAxisTickLabel(unit, start, locale) + "–" + timeAxisTickLabel(unit, end, locale);
}

function percentValue(value) {
  return Number(value.toFixed(3)).toString();
}

function developmentStagesCopy(locale, isMarketplace) {
  const normalized = normalizeRendererLocale(locale);
  if (normalized === "ru-RU") return {
    parallelLabel: "ПАРАЛЛЕЛЬНАЯ РАБОТА",
    thesis: (streams, gates) => streams + " рабочих потоков сходятся в " + gates + " плановых точках контроля.",
    briefDuration: "СРОК ИЗ БРИФА",
    stages: "ЭТАПЫ РАЗРАБОТКИ",
    planningScale: "ПЛАНОВАЯ ШКАЛА",
    gates: "КОНТРОЛЬНЫЕ ТОЧКИ",
    targetOutcomes: "Плановые результаты",
    scenario: "ПЛАНОВЫЙ СЦЕНАРИЙ · ДЛЯ СОГЛАСОВАНИЯ",
    disclosure: "Параллельность потоков, границы этапов и результаты контрольных точек смоделированы. Подтверждён только общий срок из брифа.",
    workstreams: [
      "Состав и операционная модель",
      "Исследование продукта и прототип",
      "Архитектура и среды",
      isMarketplace ? "Разработка ядра маркетплейса" : "Разработка ядра продукта",
      "Интеграции и операционные инструменты",
      "QA, безопасность и стабилизация",
      "UAT, запуск и передача",
    ],
    gateOutcomes: ["Состав и модель готовы", "Прототип и архитектура готовы", "Бета готова к приёмке", "Запуск и передача готовы"],
  };
  if (normalized === "uz-Latn") return {
    parallelLabel: "PARALLEL ISHLAR",
    thesis: (streams, gates) => streams + " ta ish oqimi " + gates + " ta reja nazorat nuqtasida birlashadi.",
    briefDuration: "BRIF MUDDATI",
    stages: "ISHLAB CHIQISH BOSQICHLARI",
    planningScale: "REJA SHKALASI",
    gates: "NAZORAT NUQTALARI",
    targetOutcomes: "Rejalashtirilgan natijalar",
    scenario: "REJALASHTIRISH SSENARIYSI · MIJOZ BILAN KELISHILADI",
    disclosure: "Ish oqimlarining parallelligi, bosqich chegaralari va nazorat natijalari modellashtirilgan. Faqat brifdagi umumiy muddat tasdiqlangan.",
    workstreams: [
      "Tarkib va ish modeli",
      "Mahsulot tahlili va prototip",
      "Arxitektura va muhitlar",
      isMarketplace ? "Marketpleys yadrosini ishlab chiqish" : "Mahsulot yadrosini ishlab chiqish",
      "Integratsiyalar va operatsion vositalar",
      "QA, xavfsizlik va mustahkamlash",
      "UAT, ishga tushirish va topshirish",
    ],
    gateOutcomes: ["Tarkib va model tayyor", "Prototip va arxitektura tayyor", "Beta qabulga tayyor", "Ishga tushirish va topshirish tayyor"],
  };
  return {
    parallelLabel: "PARALLEL DELIVERY",
    thesis: (streams, gates) => streams + " workstreams converge at " + gates + " planning gates.",
    briefDuration: "BRIEF DURATION",
    stages: "DEVELOPMENT STAGES",
    planningScale: "PLANNING SCALE",
    gates: "ACCEPTANCE GATES",
    targetOutcomes: "Target outcomes",
    scenario: "PLANNING SCENARIO · FOR CLIENT REVIEW",
    disclosure: "Workstream overlaps, stage boundaries, and gate outcomes are modeled. Only the total duration from the brief is source-supported.",
    workstreams: [
      "Scope and operating model",
      "Product discovery and prototype",
      "Architecture and environments",
      isMarketplace ? "Marketplace core engineering" : "Core product engineering",
      "Integrations and operational tooling",
      "QA, security, and hardening",
      "UAT, launch, and handover",
    ],
    gateOutcomes: ["Scope and model ready", "Prototype and architecture ready", "Beta ready for acceptance", "Launch and handover ready"],
  };
}

function developmentStagesTitle(locale, duration) {
  const normalized = normalizeRendererLocale(locale);
  if (normalized === "ru-RU") return "Этапы разработки на " + duration + ".";
  if (normalized === "uz-Latn") return duration + "lik ishlab chiqish bosqichlari.";
  return "Development stages across " + duration + ".";
}

function developmentGateCountLabel(locale, count) {
  const normalized = normalizeRendererLocale(locale);
  if (normalized === "ru-RU") return "Плановых точек контроля: " + count;
  if (normalized === "uz-Latn") return count + " ta reja nazorat nuqtasi";
  return count + " planning gates";
}

function semanticSummary(spec, pageNumber, content) {
  const pending = spec.dataState === "pending" || ["pending", "questions", "formula_pending"].includes(spec.variant);
  if (spec.kind === "nested_market") {
    return pending
      ? { label: l(content, "TO CONFIRM"), detail: l(content, "Market formulas are visible without invented values. Approve all required inputs before using the model.") }
      : { label: l(content, "MODELED MARKET"), detail: l(content, "Nested levels express subset logic; SOM values are scenarios, never an additive forecast.") };
  }
  if (spec.kind === "ownership_boundary") {
    return pending
      ? { label: l(content, "BOUNDARY QUESTIONS"), detail: l(content, "Confirm the owned control state, partner callbacks, and capabilities explicitly deferred from launch.") }
      : { label: l(content, "OWNERSHIP MODEL"), detail: l(content, "Owned control, partner-enabled services, and deferred scope remain distinct relationship types.") };
  }
  if (spec.kind === "hub_spoke") {
    return pending
      ? { label: l(content, "SCOPE TO CONFIRM"), detail: l(content, "Confirm the product root, functional directions, functions, and subfunctions before approval.") }
      : { label: l(content, "PRODUCT HIERARCHY"), detail: l(content, "The product root stays at the left; every direction, function, and subfunction expands to the right.") };
  }
  if (spec.kind === "bpmn") {
    const segmentSuffix = Number(spec.segmentCount) > 1 ? ` · ${spec.segmentIndex}/${spec.segmentCount}` : "";
    return pending
      ? { label: l(content, "PROCESS QUESTIONS") + segmentSuffix, detail: l(content, "Confirm actors, tasks, real decisions, exception routes, and accepted outcomes before approving this process.") }
      : { label: l(content, "PRIMARY FLOW") + segmentSuffix, detail: l(content, "The directed flow shows actors, decisions, outcomes, and exception ownership.") };
  }
  if (spec.kind === "architecture") {
    const recommended = array(spec.nodes).some((node) => ["recommended", "inferred", "assumed"].includes(String(node.truthStatus || "").toLowerCase()));
    return pending
      ? { label: l(content, "CONTEXT TO CONFIRM"), detail: l(content, "Confirm channels, trusted application boundary, operational data needs, and partner dependencies.") }
      : { label: recommended ? l(content, "Recommendation") : l(content, "TRUST BOUNDARY"), detail: l(content, "Channels reach the trusted product core; data remains inside and partner services remain outside.") };
  }
  const scale = spec.timeScale || {};
  const span = Number.isFinite(Number(scale.start)) && Number.isFinite(Number(scale.end))
    ? formatRendererUnit(String(scale.start) + "-" + String(scale.end), scale.unit || "period", content.locale)
    : content.durationWeeks
      ? formatRendererUnit(content.durationWeeks, "week", content.locale)
      : content.durationMonths
        ? formatRendererUnit(content.durationMonths, "month", content.locale)
        : l(content, "duration to confirm");
  return pending
    ? { label: l(content, "ROADMAP QUESTIONS"), detail: l(content, "Roadmap duration") + " · " + span + ". " + l(content, "Confirm real phase spans, dependencies, and acceptance gates.") }
    : { label: l(content, "DELIVERY SCALE"), detail: l(content, "Roadmap duration") + " · " + span + ". " + l(content, "Bars use the inclusive time scale and preserve dependencies.") };
}

function resolvePageTitle(pagePlan, content, spec) {
  if (pagePlan.kind === "project_price") return projectPriceCopy(content.locale).title;
  if (pagePlan.kind === "architecture") return referenceSectionTitle("architecture", content.locale);
  if (pagePlan.kind === "client_dependencies") return referenceSectionTitle("client_dependencies", content.locale);
  if (pagePlan.kind === "team") return referenceSectionTitle("team", content.locale);
  if (pagePlan.kind === "function_price") return referenceSectionTitle("function_price", content.locale);
  if (pagePlan.title) return clientText(localizeKnown(pagePlan.title, content.locale), 120);
  if (pagePlan.kind === "cover") return content.projectTitle;
  if (pagePlan.kind === "market_sizing" && spec?.kind === "nested_market") {
    const copy = marketSizingCopy(content.locale);
    return spec.variant === "formula_pending" || spec.dataState === "pending" ? copy.pendingTitle : copy.numericTitle;
  }
  if (pagePlan.kind === "primary_flow" && spec && (spec.dataState === "pending" || ["pending", "questions"].includes(spec.variant))) {
    return l(content, "Process questions before approval.");
  }
  if (pagePlan.kind === "roadmap" && spec?.timeScale) {
    const duration = content.durationMonths
      ? formatRendererUnit(content.durationMonths, "month", content.locale)
      : content.durationWeeks
        ? formatRendererUnit(content.durationWeeks, "week", content.locale)
        : formatRendererUnit(Number(spec.timeScale.end) - Number(spec.timeScale.start) + 1, spec.timeScale.unit || "period", content.locale);
    return developmentStagesTitle(content.locale, duration);
  }
  return rendererPageTitles(content.locale)[pageKindIndex(pagePlan.kind)];
}

function referenceSectionTitle(kind, locale) {
  const normalized = normalizeRendererLocale(locale);
  const copy = normalized === "ru-RU"
    ? { architecture: "Архитектура", client_dependencies: "Зависимости от клиента", team: "Ресурсы команды", function_price: "Функциональные блоки и сроки" }
    : normalized === "uz-Latn"
      ? { architecture: "Arxitektura", client_dependencies: "Mijozga bog‘liq talablar", team: "Jamoa resurslari", function_price: "Funksional bloklar va muddatlar" }
      : { architecture: "Architecture", client_dependencies: "Client dependencies", team: "Team resources", function_price: "Functional blocks and timelines" };
  return copy[kind] || kind;
}

function referencePageSummary(pagePlan, content) {
  const locale = normalizeRendererLocale(content.locale);
  if (pagePlan.kind === "architecture") {
    if (locale === "ru-RU") return "Надёжное ядро с явными границами партнёрских сервисов. Каналы обращаются к доверенному ядру; данные остаются внутри, партнёрские сервисы — снаружи.";
    if (locale === "uz-Latn") return "Hamkor servislar chegaralari aniq ko‘rsatilgan ishonchli yadro. Kanallar ishonchli yadroga murojaat qiladi; ma’lumotlar ichkarida, hamkor servislar tashqarida qoladi.";
    return "A trusted core with visible partner boundaries. Channels reach the trusted core; data remains inside and partner services remain outside.";
  }
  if (pagePlan.kind === "client_dependencies") {
    if (locale === "ru-RU") return "Что необходимо от Udevs для реализации. Здесь перечислены только непубличные доступы, учётные данные, согласования и материалы в зоне клиента.";
    if (locale === "uz-Latn") return "Amalga oshirish uchun Udevsdan nimalar kerak. Bu yerda faqat ommaviy bo‘lmagan kirishlar, hisob ma’lumotlari, kelishuvlar va mijoz zonasidagi materiallar keltirilgan.";
    return "What Udevs needs for delivery. Only non-public access, credentials, approvals, and client-owned inputs are listed here.";
  }
  if (pagePlan.kind === "team") {
    return teamCapacityTitle(content, teamCapacityPlan(content)) || "";
  }
  return "";
}

function resolvePageBadge(pagePlan, content, spec) {
  if (spec) {
    if (spec.dataState === "pending") return l(content, "Requires confirmation");
    if (spec.dataState === "grounded" || spec.dataState === "verified") return l(content, "Supported by evidence");
    const labels = {
      nested_market: "Market model inputs",
      ownership_boundary: "Responsibility model",
      hub_spoke: "Recommended product structure",
      bpmn: "Recommended process",
      architecture: "Architecture inputs",
      gantt: "Delivery planning model",
    };
    if (spec.kind === "gantt" && spec.variant === "gantt") {
      const phaseCount = array(spec.nodes).filter((node) => node.type === "phase").length;
      const label = developmentGateCountLabel(content.locale, phaseCount);
      return Number(spec.segmentCount) > 1 ? `${label} · ${spec.segmentIndex}/${spec.segmentCount}` : label;
    }
    const label = l(content, labels[spec.kind] || "Inputs and recommendations");
    return ["hub_spoke", "bpmn"].includes(spec.kind) && Number(spec.segmentCount) > 1
      ? `${label} · ${spec.segmentIndex}/${spec.segmentCount}`
      : label;
  }
  if (pagePlan.kind === "org_structure") {
    if (content.organizationStructure.status === "grounded" && content.organizationStructure.mode === "grounded_public_org") return l(content, "Public organization view");
    if (content.organizationStructure.status === "pending") return l(content, "Requires confirmation");
    return l(content, "Recommended role model");
  }
  if (pagePlan.kind === "function_price") {
    const total = array(content.functionSchedule).length || array(content.functionPrice).length;
    const label = functionGroupsLabel(content, total);
    return Number(pagePlan.segmentCount) > 1 ? `${label} · ${pagePlan.segmentIndex}/${pagePlan.segmentCount}` : label;
  }
  if (pagePlan.kind === "team") {
    const plan = teamCapacityPlan(content);
    if (plan) return rolesLabel(content, content.team.roles.length) + " · " + formatRendererUnit(plan.monthCount, "month", content.locale);
    return content.team.roles.length ? rolesLabel(content, content.team.roles.length) : l(content, "Capacity to confirm");
  }
  if (pagePlan.kind === "project_price") return projectPriceBadge(content, projectPriceCopy(content.locale));
  if (pagePlan.kind === "payments") return content.payments.length ? paymentStagesShortLabel(content, content.payments.length) : l(content, "Schedule to confirm");
  return rendererPageBadges(content.locale)[pageKindIndex(pagePlan.kind)];
}

function normalizeFunctionPrice(lock, semanticModel, proposalModel, exponent, locale) {
  const semanticRows = array(semanticModel.commercial?.functionPrice);
  const proposalRows = array(proposalModel.functionPrice);
  const scopeRows = array(proposalModel.scope).length ? array(proposalModel.scope) : array(semanticModel.scopeItems);
  if (lock) {
    return array(lock.functionPrice).map((row, index) => {
      const proposalRow = findProvenanceRow(row, index, proposalRows);
      const semanticRow = findProvenanceRow(row, index, semanticRows, "label");
      const scopeRow = findFunctionPriceScopeRow(row, proposalRow, scopeRows, index, lock.functionPrice.length);
      const truthStatus = normalizeTruthStatus(row.truthStatus, proposalRow?.truthStatus, semanticRow?.truthStatus, row.status, proposalRow?.status);
      return {
        id: String(row.id || "FP-" + (index + 1)),
        name: clientText(localizeRendererText(row.name || row.label || proposalRow?.name || semanticRow?.label || "Function " + (index + 1), locale), 120),
        epic: clientText(localizeRendererText(proposalRow?.epic || scopeRow?.epic || "To confirm", locale), 100),
        detail: clientText(localizeRendererText(proposalRow?.detail || scopeRow?.detail || "To confirm", locale), 170),
        deadline: clientText(localizeRendererText(proposalRow?.phase || proposalRow?.deadline || scopeRow?.phase || scopeRow?.deadline || "To confirm", locale), 70),
        scopeStatus: normalizeFunctionScopeStatus(proposalRow, scopeRow),
        amountMinor: safeMinor(row.amountMinor, "functionPrice[" + index + "].amountMinor"),
        truthStatus,
        sourceIds: [...new Set([
          ...array(row.sourceIds),
          ...array(proposalRow?.sourceIds),
          ...array(semanticRow?.sourceIds),
        ].map(String).filter(Boolean))].slice(0, 4),
        derivationRuleId: row.derivationRuleId || proposalRow?.derivationRuleId || semanticRow?.derivationRuleId || null,
      };
    });
  }
  const rows = semanticRows.length ? semanticRows : proposalRows;
  return rows.map((row, index) => {
    const proposalRow = findProvenanceRow(row, index, proposalRows, row.label ? "label" : "name");
    const scopeRow = findFunctionPriceScopeRow(row, proposalRow, scopeRows, index, rows.length);
    return {
      id: String(row.id || "FP-" + (index + 1)),
      name: clientText(localizeRendererText(row.name || row.label || proposalRow?.name || scopeRow?.feature || "Function " + (index + 1), locale), 120),
      epic: clientText(localizeRendererText(row.epic || proposalRow?.epic || scopeRow?.epic || "To confirm", locale), 100),
      detail: clientText(localizeRendererText(row.detail || proposalRow?.detail || scopeRow?.detail || "To confirm", locale), 170),
      deadline: clientText(localizeRendererText(row.phase || row.deadline || proposalRow?.phase || proposalRow?.deadline || scopeRow?.phase || scopeRow?.deadline || "To confirm", locale), 70),
      scopeStatus: normalizeFunctionScopeStatus(proposalRow || row, scopeRow),
      amountMinor: majorToMinor(row.amount ?? row.total ?? row.price ?? row.cost, exponent),
      truthStatus: normalizeTruthStatus(row.truthStatus, row.status, proposalRow?.truthStatus, proposalRow?.status),
      sourceIds: [...new Set([...array(row.sourceIds), ...array(proposalRow?.sourceIds)].map(String).filter(Boolean))].slice(0, 4),
      derivationRuleId: row.derivationRuleId || proposalRow?.derivationRuleId || null,
    };
  }).filter((row) => row.amountMinor !== null);
}

function normalizeFunctionSchedule(semanticModel, commercialRows, locale) {
  const inventory = buildProductDeliveryInventory(semanticModel);
  if (!inventory.length) return array(commercialRows);
  const rows = array(commercialRows);
  const rowForLeaf = (leaf) => {
    const functionKey = normalizeFunctionMatchLabel(leaf.functionLabel);
    const epicKey = normalizeFunctionMatchLabel(leaf.epic);
    return rows.find((row) => normalizeFunctionMatchLabel(row.name) === functionKey
      && (!epicKey || normalizeFunctionMatchLabel(row.epic) === epicKey))
      || rows.find((row) => normalizeFunctionMatchLabel(row.name) === functionKey)
      || null;
  };
  return inventory.map((leaf, index) => {
    const commercial = rowForLeaf(leaf);
    const terminalLabel = leaf.subfunctionLabel || leaf.functionLabel;
    const hasDistinctSubfunction = Boolean(leaf.subfunctionId && normalizeFunctionMatchLabel(terminalLabel) !== normalizeFunctionMatchLabel(leaf.functionLabel));
    return {
      id: String(leaf.id || `PRODUCT-DELIVERY-${index + 1}`),
      name: clientText(localizeRendererText(leaf.functionLabel || commercial?.name || `Function ${index + 1}`, locale), 120),
      epic: clientText(localizeRendererText(leaf.epic || commercial?.epic || "To confirm", locale), 100),
      detail: clientText(localizeRendererText(hasDistinctSubfunction ? terminalLabel : commercial?.detail || terminalLabel || "To confirm", locale), 170),
      deadline: clientText(localizeRendererText(leaf.deadline || leaf.phase || commercial?.deadline || "To confirm", locale), 70),
      scopeStatus: normalizeFunctionScopeStatus(leaf, commercial),
      amountMinor: null,
      truthStatus: normalizeTruthStatus(leaf.truthStatus, commercial?.truthStatus),
      sourceIds: [...new Set([...array(leaf.sourceIds), ...array(commercial?.sourceIds)].map(String).filter(Boolean))].slice(0, 4),
      derivationRuleId: leaf.derivationRuleId || commercial?.derivationRuleId || "PRODUCT-DELIVERY-INVENTORY-V1",
      productFunctionId: leaf.functionId || null,
      productLeafId: leaf.id || null,
    };
  });
}

function functionScheduleRowsForPage(content, pagePlan = {}) {
  const allRows = array(content.functionSchedule).length ? array(content.functionSchedule) : array(content.functionPrice);
  const segmentCount = Math.max(1, Number(pagePlan.segmentCount) || 1);
  const segmentIndex = Math.max(1, Number(pagePlan.segmentIndex) || 1);
  if (segmentCount === 1) return allRows;
  const expectedCount = Math.max(1, Math.ceil(allRows.length / FUNCTION_SCHEDULE_ROWS_PER_PAGE));
  if (segmentIndex > expectedCount || segmentCount !== expectedCount) {
    throw rendererError("CONTENT_FUNCTION_PRICE_SEGMENT_INVALID", `Function-schedule segment ${segmentIndex}/${segmentCount} does not match ${allRows.length} terminal rows`);
  }
  const start = (segmentIndex - 1) * FUNCTION_SCHEDULE_ROWS_PER_PAGE;
  return allRows.slice(start, start + FUNCTION_SCHEDULE_ROWS_PER_PAGE);
}

function findFunctionPriceScopeRow(row, proposalRow, scopeRows, index, inventoryLength) {
  const explicitScopeId = String(row?.scopeId || proposalRow?.scopeId || "").trim();
  if (explicitScopeId) {
    const byId = scopeRows.find((scope) => String(scope?.id || "").trim() === explicitScopeId);
    if (byId) return byId;
  }
  const labels = [row?.name, row?.label, proposalRow?.name, proposalRow?.label, proposalRow?.feature]
    .map(normalizeFunctionMatchLabel)
    .filter(Boolean);
  for (const label of labels) {
    const matches = scopeRows.filter((scope) => [scope?.feature, scope?.name, scope?.label].map(normalizeFunctionMatchLabel).includes(label));
    if (matches.length === 1) return matches[0];
  }
  return scopeRows.length === inventoryLength ? scopeRows[index] || null : null;
}

function normalizeFunctionMatchLabel(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function normalizeFunctionScopeStatus(primary = {}, scope = {}) {
  primary = primary || {};
  scope = scope || {};
  const value = String(primary.inclusion || primary.priority || primary.scopeStatus || scope.inclusion || scope.priority || scope.scopeStatus || "").trim().toLowerCase();
  const hasGroundedProvenance = array(primary.sourceIds).length > 0 || array(scope.sourceIds).length > 0;
  if (/out[_ -]?of[_ -]?scope|excluded|вне|tashqar/.test(value)) return "out_of_scope";
  if (/defer|later|отлож|keyin/.test(value)) return "deferred";
  if (/recommend|propos|tavsiya|рекоменд/.test(value)) return "recommended";
  if (/requested|explicit|запрош|so['’]?ral/.test(value)) return hasGroundedProvenance ? "requested" : "to_confirm";
  if (/in[_ -]?scope|include|включ|kirit/.test(value)) return hasGroundedProvenance ? "in_scope" : "to_confirm";
  const truthStatus = normalizeTruthStatus(primary.truthStatus, primary.status, scope.truthStatus, scope.status);
  return CONFIRMED_TRUTH_STATUSES.has(truthStatus) && hasGroundedProvenance ? "in_scope" : truthStatus === "recommended" ? "recommended" : "to_confirm";
}

function normalizePayments(lock, semanticModel, proposalModel, exponent, projectPriceMinor, locale) {
  const semanticRows = array(semanticModel.commercial?.payments);
  const proposalRows = array(proposalModel.payments);
  const provenanceRows = [...semanticRows, ...proposalRows];
  if (lock) {
    return [...array(lock.payments)].sort((a, b) => Number(a.order) - Number(b.order)).map((row, index) => {
      const provenance = findProvenanceRow(row, index, provenanceRows);
      return {
        id: String(row.id || "PAY-" + (index + 1)),
        name: clientText(localizeKnown(row.name || row.label || "Payment " + (index + 1), locale), 100),
        amountMinor: safeMinor(row.amountMinor, "payments[" + index + "].amountMinor"),
        percentBasisPoints: safeBasisPoints(row.percentBasisPoints, "payments[" + index + "].percentBasisPoints"),
        order: Number(row.order ?? index + 1),
        acceptance: clientText(localizeKnown(row.acceptance || row.due || "Acceptance trigger to confirm", locale), 160),
        truthStatus: normalizeTruthStatus(row.truthStatus, row.status, provenance?.truthStatus, provenance?.status),
      };
    });
  }
  const rows = semanticRows.length ? semanticRows : proposalRows;
  return rows.map((row, index) => {
    const amountMinor = majorToMinor(row.amount ?? row.total, exponent);
    let basis = row.percentBasisPoints;
    if (!Number.isSafeInteger(Number(basis)) && finiteNumber(row.percent) !== null) basis = Math.round(Number(row.percent) * 100);
    if (!Number.isSafeInteger(Number(basis)) && amountMinor !== null && projectPriceMinor > 0) basis = Math.round((amountMinor * 10000) / projectPriceMinor);
    return {
      id: String(row.id || "PAY-" + (index + 1)),
      name: clientText(localizeKnown(row.name || row.label || row.period || row.milestone || "Payment " + (index + 1), locale), 100),
      amountMinor,
      percentBasisPoints: Number.isSafeInteger(Number(basis)) ? Number(basis) : 0,
      order: Number(row.order ?? index + 1),
      acceptance: clientText(localizeKnown(row.acceptance || row.due || "Acceptance trigger to confirm", locale), 160),
      truthStatus: normalizeTruthStatus(row.truthStatus, row.status),
    };
  }).filter((row) => row.amountMinor !== null);
}

function normalizeScope(semanticModel, proposalModel, locale) {
  const rows = array(semanticModel.scopeItems).length
    ? semanticModel.scopeItems
    : array(semanticModel.scope?.scopeItems).length
      ? semanticModel.scope.scopeItems
      : array(proposalModel.scope);
  return rows.map((row, index) => {
    const source = Array.isArray(row)
      ? { epic: row[0], feature: row[1], detail: row[2], phase: row[3], inclusion: row[4] }
      : row || {};
    return {
      id: String(source.id || "SCOPE-" + (index + 1)),
      label: clientText(localizeKnown(source.label || source.feature || source.name || source.epic || "Scope item " + (index + 1), locale), 110),
      epic: clientText(localizeKnown(source.epic || source.domain || "Product", locale), 80),
      detail: clientText(localizeKnown(source.detail || source.description || source.phase || "", locale), 180),
      inclusion: String(source.inclusion || "in_scope"),
      ownership: String(source.ownership || "unknown"),
      truthStatus: String(source.truthStatus || "unknown"),
      sourceIds: array(source.sourceIds).map(String).filter(Boolean),
      derivationRuleId: source.derivationRuleId || null,
    };
  });
}

function normalizeTeam(lock, semanticModel, proposalModel, locale, durationMonths) {
  const semanticTeam = semanticModel.team || {};
  const proposalTeam = proposalModel.teamPlan || {};
  const semanticRoles = array(semanticTeam.roles);
  const proposalRoles = array(proposalTeam.roleAllocations).length ? proposalTeam.roleAllocations : array(proposalTeam.roles);
  const provenanceRoles = [...semanticRoles, ...proposalRoles];
  const teamPlan = lock?.teamPlan || (semanticRoles.length ? semanticTeam : proposalTeam);
  const canonical = canonicalizeTeamPlan(teamPlan, { durationMonths });
  const canonicalRows = canonical.roleAllocations.length
    ? canonical.roleAllocations
    : canonical.roles.map((role) => ({ role }));
  return {
    people: nullableNumber(canonical.people),
    peopleTruthStatus: normalizeTruthStatus(teamPlan.peopleTruthStatus, teamPlan.truthStatus, semanticTeam.peopleTruthStatus, semanticTeam.truthStatus, proposalTeam.peopleTruthStatus, proposalTeam.truthStatus),
    monthCount: canonical.monthCount,
    monthlyTotals: canonical.monthlyTotals,
    peakMonth: canonical.peakMonth,
    fteMonths: nullableNumber(canonical.fteMonths),
    peakFte: nullableNumber(canonical.peakFte),
    truthStatus: normalizeTruthStatus(canonical.truthStatus, semanticTeam.truthStatus, proposalTeam.truthStatus),
    roles: canonicalRows.map((source, index) => {
      const provenance = findProvenanceRow(source, index, provenanceRoles, "role");
      return {
        role: clientText(localizeKnown(source.role || source.name || "Role " + (index + 1), locale), 90),
        people: nullableNumber(source.people),
        monthlyFte: array(source.monthlyFte).map(Number),
        fteMonths: nullableNumber(source.fteMonths),
        peakFte: nullableNumber(source.peakFte ?? source.fte ?? source.qty),
        truthStatus: normalizeTruthStatus(source.truthStatus, source.status, provenance?.truthStatus, provenance?.status, canonical.truthStatus),
      };
    }),
  };
}

function normalizeOrganizationStructure(proposalModel, semanticModel, locale, projectTitle) {
  const supplied = proposalModel.organizationStructure && typeof proposalModel.organizationStructure === "object"
    ? proposalModel.organizationStructure
    : null;
  // A supplied structure is rendered as branches: either the grounded public
  // organization or the recommended client-platform role model (root = the
  // client's organization, branches = administration / partner / user roles).
  if (supplied && array(supplied.branches).length) {
    const rootSourceIds = normalizedSourceIds(supplied.sourceIds);
    const rawBranches = array(supplied.branches).slice(0, 3);
    const branches = rawBranches.map((branch, branchIndex) => {
      const branchSourceIds = normalizedSourceIds(branch?.sourceIds, rootSourceIds);
      const rawChildren = array(branch?.children).slice(0, 3);
      const children = rawChildren.length
        ? rawChildren.map((child, childIndex) => ({
            id: safeDomId(String(child?.id || `ORG-B${branchIndex + 1}-R${childIndex + 1}`)),
            label: clientText(localizeKnown(child?.label || child?.name || l({ locale }, "Role details to confirm"), locale), 72),
            detail: clientText(localizeKnown(child?.detail || child?.description || "", locale), 90),
            truthStatus: normalizeTruthStatus(child?.truthStatus, child?.status, branch?.truthStatus, supplied.truthStatus),
            sourceIds: normalizedSourceIds(child?.sourceIds, branchSourceIds),
            derivationRuleId: child?.derivationRuleId || branch?.derivationRuleId || supplied.derivationRuleId || null,
          }))
        : [pendingOrganizationRole(branchIndex, locale)];
      return {
        id: safeDomId(String(branch?.id || `ORG-BRANCH-${branchIndex + 1}`)),
        label: clientText(localizeKnown(branch?.label || branch?.name || l({ locale }, "Accountable group to confirm"), locale), 72),
        detail: clientText(localizeKnown(branch?.detail || branch?.description || "", locale), 100),
        truthStatus: normalizeTruthStatus(branch?.truthStatus, branch?.status, supplied.truthStatus),
        sourceIds: branchSourceIds,
        derivationRuleId: branch?.derivationRuleId || supplied.derivationRuleId || null,
        children,
      };
    });
    while (branches.length < 3) branches.push(pendingOrganizationBranch(branches.length, locale));
    const requestedMode = supplied.mode === "grounded_public_org" ? "grounded_public_org" : "proposed_role_model";
    const allSourceIds = [...new Set([
      ...rootSourceIds,
      ...branches.flatMap((branch) => [...branch.sourceIds, ...branch.children.flatMap((child) => child.sourceIds)]),
    ])];
    const normalizedStatus = normalizeOrganizationStatus(supplied.status, requestedMode, allSourceIds.length > 0);
    const hasPendingNode = branches.some((branch) => branch.truthStatus === "unknown" || branch.children.some((child) => child.truthStatus === "unknown"));
    return {
      id: safeDomId(String(supplied.id || "ORG-ROOT")),
      mode: requestedMode,
      status: normalizedStatus === "grounded" && hasPendingNode ? "mixed" : normalizedStatus,
      rootLabel: clientText(localizeKnown(supplied.rootLabel || supplied.label || projectTitle || l({ locale }, "Organization"), locale), 100),
      truthStatus: normalizeTruthStatus(supplied.truthStatus, supplied.status),
      sourceIds: allSourceIds,
      derivationRuleId: supplied.derivationRuleId || null,
      disclosure: clientText(localizeKnown(supplied.disclosure || "", locale), 320),
      branches,
    };
  }

  const actors = array(semanticModel.actors)
    .filter((actor) => actor && actor.type !== "system_actor")
    .slice(0, 9);
  const branchDefinitions = [
    { id: "ORG-GROUP-INTERNAL", label: "Administration and operations", types: new Set(["internal_operator"]) },
    { id: "ORG-GROUP-USERS", label: "Product users", types: new Set(["end_user"]) },
    { id: "ORG-GROUP-PARTNERS", label: "External partners", types: new Set(["partner_actor", "unknown"]) },
  ];
  const branches = branchDefinitions.map((definition, branchIndex) => {
    const matchingActors = actors.filter((actor) => definition.types.has(actor.type)).slice(0, 3);
    const children = matchingActors.length
      ? matchingActors.map((actor, childIndex) => ({
          id: safeDomId(String(actor.id || `${definition.id}-ROLE-${childIndex + 1}`)),
          label: clientText(localizeKnown(actor.label || actor.name || l({ locale }, "Role details to confirm"), locale), 72),
          detail: l({ locale }, "Known product actor"),
          truthStatus: normalizeTruthStatus(actor.truthStatus, actor.status, "recommended"),
          sourceIds: normalizedSourceIds(actor.sourceIds),
          derivationRuleId: actor.derivationRuleId || "ORG-ACTOR-GROUPING-V1",
        }))
      : [pendingOrganizationRole(branchIndex, locale)];
    return {
      id: definition.id,
      label: l({ locale }, definition.label),
      detail: l({ locale }, "Proposed responsibility group"),
      truthStatus: matchingActors.length ? "recommended" : "unknown",
      sourceIds: [...new Set(matchingActors.flatMap((actor) => normalizedSourceIds(actor.sourceIds)))],
      derivationRuleId: "ORG-ACTOR-GROUPING-V1",
      children,
    };
  });
  const sourceIds = [...new Set(branches.flatMap((branch) => [...branch.sourceIds, ...branch.children.flatMap((child) => child.sourceIds)]))];
  return {
    id: "ORG-ROOT",
    mode: "proposed_role_model",
    status: actors.length ? "proposed" : "pending",
    rootLabel: clientText(projectTitle || l({ locale }, "Organization"), 100),
    truthStatus: actors.length ? "recommended" : "unknown",
    sourceIds,
    derivationRuleId: actors.length ? "ORG-ACTOR-GROUPING-V1" : "ORG-QUESTIONS-V1",
    disclosure: actors.length
      ? l({ locale }, "The hierarchy groups known product actors; it is a proposed role model, not a claim about the company's internal reporting lines.")
      : l({ locale }, "A proposed role structure is shown transparently until public organization evidence is available."),
    branches,
  };
}

function deliveryPeopleChainStructure(proposalModel, locale, projectTitle) {
  // Narrow role cards must never split a hyphenated token like
  // "Release-инженер" across lines, so hyphens become non-breaking.
  const noBreakHyphens = (value) => String(value).replace(/(\S)-(\S)/gu, "$1‑$2");
  const roles = array(proposalModel.teamPlan?.roleAllocations)
    .map((row) => noBreakHyphens(clientText(localizeKnown(String(row?.role || ""), locale), 72)))
    .filter(Boolean);
  if (roles.length < 3) return null;
  const managerIndex = roles.findIndex((role) => /(?:^|[\s(/])(?:pm|project\s*manager|product\s*manager)(?:$|[\s)/])|менеджер|menejer/iu.test(role));
  const manager = managerIndex >= 0 ? roles[managerIndex] : roles[0];
  const reports = roles.filter((_, index) => index !== (managerIndex >= 0 ? managerIndex : 0)).slice(0, 8);
  if (reports.length < 2) return null;
  return {
    id: "ORG-ROOT",
    mode: "proposed_role_model",
    variant: "people_chain",
    status: "proposed",
    rootLabel: "CEO",
    rootDetail: l({ locale }, "Delivery leadership and escalations"),
    truthStatus: "recommended",
    sourceIds: [],
    derivationRuleId: "ORG-DELIVERY-PEOPLE-CHAIN-V1",
    disclosure: l({ locale }, "The hierarchy shows the proposed delivery-team reporting line for this project; it is not a claim about the client's internal structure."),
    projectLabel: clientText(projectTitle || l({ locale }, "Organization"), 100),
    manager: {
      id: "ORG-MANAGER",
      label: manager,
      detail: l({ locale }, "Coordinates scope, plan, team and acceptance"),
      truthStatus: "recommended",
    },
    roles: reports.map((role, index) => ({
      id: `ORG-PERSON-${index + 1}`,
      label: role,
      detail: teamDeliveryFocus(role, { locale }),
      truthStatus: "recommended",
    })),
    branches: [],
  };
}

function pendingOrganizationBranch(index, locale) {
  return {
    id: `ORG-BRANCH-PENDING-${index + 1}`,
    label: l({ locale }, "Accountable group to confirm"),
    detail: l({ locale }, "Organization input required"),
    truthStatus: "unknown",
    sourceIds: [],
    derivationRuleId: "ORG-QUESTIONS-V1",
    children: [pendingOrganizationRole(index, locale)],
  };
}

function pendingOrganizationRole(index, locale) {
  return {
    id: `ORG-ROLE-PENDING-${index + 1}`,
    label: l({ locale }, "Role details to confirm"),
    detail: l({ locale }, "No actor confirmed for this group."),
    truthStatus: "unknown",
    sourceIds: [],
    derivationRuleId: "ORG-QUESTIONS-V1",
  };
}

function normalizedSourceIds(primary, fallback = []) {
  const own = array(primary).map(String).filter(Boolean);
  return [...new Set(own.length ? own : array(fallback).map(String).filter(Boolean))];
}

function normalizeOrganizationStatus(status, mode, hasSources) {
  const value = String(status || "").trim().toLowerCase();
  if (/pending|unknown|missing|research_required/.test(value)) return "pending";
  if (/grounded|verified|complete|public/.test(value) && mode === "grounded_public_org" && hasSources) return "grounded";
  if (mode === "grounded_public_org" && hasSources) return "grounded";
  return "proposed";
}

function normalizeSources(rows, locale) {
  const seen = new Set();
  return array(rows).map((source, index) => {
    const label = safeSourceLabel(source.label || source.title || source.type || "Evidence source", locale);
    return {
      id: String(source.id || "SOURCE-" + (index + 1)),
      label,
      type: clientText(localizeKnown(String(source.type || "evidence").replaceAll("_", " "), locale), 50),
      display: safeDisplayUrl(source.displayUrl || source.url || source.source || source.sourceRef),
      href: safeSourceHref(source.url || source.source || source.sourceRef || source.displayUrl),
      status: String(source.status || "unknown").toLowerCase(),
      rawType: String(source.type || "evidence"),
      researchTopic: String(source.researchTopic || source.topic || "").toLowerCase(),
    };
  }).filter((source) => {
    const key = source.id + "|" + source.display.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function normalizeClaims(rows, locale) {
  return array(rows).map((claim) => ({
    id: String(claim.id || ""),
    text: clientText(localizeKnown(claim.text || claim.claim || "", locale), 260),
    truthStatus: String(claim.truthStatus || claim.status || "unknown"),
    claimNature: normalizeEvidenceNature(claim.claimNature, claim.text || claim.claim),
    sourceIds: array(claim.sourceIds).map(String).filter(Boolean),
    derivationRuleId: claim.derivationRuleId || null,
  })).filter((claim) => claim.text).slice(0, 12);
}

function normalizeAnalogs(semanticModel, proposalModel, locale) {
  const rows = array(semanticModel.analogs).length
    ? semanticModel.analogs
    : array(proposalModel.analogs).length
      ? proposalModel.analogs
      : array(proposalModel.analogResearch);
  return rows.map((row, index) => ({
    id: String(row.id || "ANALOG-" + (index + 1)),
    label: clientText(localizeKnown(row.label || row.name || row.title || "Analog " + (index + 1), locale), 90),
    learning: clientText(localizeKnown(row.learning || row.insight || row.summary || "Benchmark learning requires validation.", locale), 240),
    scopeEffect: ["benchmark_only", "validate", "do_not_copy"].includes(row.scopeEffect) ? row.scopeEffect : "benchmark_only",
    display: safeDisplayUrl(row.displayUrl || row.url || row.source),
    truthStatus: String(row.truthStatus || row.status || "unknown"),
    claimNature: normalizeEvidenceNature(row.claimNature, row.learning || row.insight || row.summary),
    sourceIds: array(row.sourceIds).map(String).filter(Boolean),
    derivationRuleId: row.derivationRuleId || null,
  }));
}

function normalizeSwot(semanticModel, proposalModel, locale) {
  const semanticRows = array(semanticModel.swot);
  if (semanticRows.length) {
    return semanticRows.map((row, index) => ({
      quadrant: normalizeQuadrant(row.quadrant),
      label: clientText(localizeKnown(row.label || row.text || "SWOT item " + (index + 1), locale), 200),
      response: row.response ? clientText(localizeKnown(row.response, locale), 180) : null,
      truthStatus: String(row.truthStatus || "unknown"),
    }));
  }
  if (Array.isArray(proposalModel.swot)) {
    return proposalModel.swot.map((row, index) => {
      const source = Array.isArray(row) ? { quadrant: row[0], label: row[1] } : row || {};
      return {
        quadrant: normalizeQuadrant(source.quadrant || source.kind || source.type),
        label: clientText(localizeKnown(source.label || source.text || source.detail || source.description || "SWOT item " + (index + 1), locale), 200),
        response: source.response ? clientText(localizeKnown(source.response, locale), 180) : null,
        truthStatus: String(source.truthStatus || "unknown"),
      };
    });
  }
  return Object.entries(proposalModel.swot || {}).flatMap(([quadrant, values]) => array(values).map((value) => ({
    quadrant: normalizeQuadrant(quadrant),
    label: clientText(localizeKnown(typeof value === "string" ? value : value.label || value.text, locale), 200),
    response: typeof value === "object" && value?.response ? clientText(localizeKnown(value.response, locale), 180) : null,
    truthStatus: typeof value === "object" ? String(value.truthStatus || "unknown") : "unknown",
  })));
}

function normalizeClientDependencies(proposalModel, semanticModel, locale, context = {}) {
  const suppliedRows = [
    ...clientDependencyInputRows(proposalModel.clientDependencies),
    ...clientDependencyInputRows(proposalModel.groundedBrief?.clientDependencies),
    ...clientDependencyInputRows(semanticModel.clientDependencies),
  ].map((row, index) => normalizeClientDependencyRow(row, index, locale)).filter(Boolean);

  const defaults = defaultClientDependencies(proposalModel, semanticModel, locale, context);
  // A real client-readiness inventory is authoritative for this page. Do not
  // dilute a complete supplied list with generic defaults that can displace
  // its Product Owner or acceptance owner rows.
  const rows = suppliedRows.length >= 3 ? suppliedRows : suppliedRows.length ? [...suppliedRows, ...defaults] : defaults;
  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.category}:${String(row.label || "").trim().toLowerCase()}`;
    if (!row.label || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  const categoryOrder = new Map([["access", 0], ["integrations", 1], ["ownership", 2]]);
  const statusOrder = new Map([["blocked", 0], ["required", 1], ["in_progress", 2], ["to_confirm", 3], ["provided", 4], ["not_applicable", 5]]);
  const sorted = deduped.sort((a, b) => {
    const categoryDifference = (categoryOrder.get(a.category) ?? 9) - (categoryOrder.get(b.category) ?? 9);
    return categoryDifference || (statusOrder.get(a.status) ?? 9) - (statusOrder.get(b.status) ?? 9);
  });
  const selected = ["access", "integrations", "ownership"]
    .map((category) => sorted.find((row) => row.category === category))
    .filter(Boolean);
  for (const row of sorted.filter((candidate) => /product owner|decision owner|sponsor|acceptance owner|testing team|uat/iu.test(`${candidate.label} ${candidate.owner}`))) {
    if (selected.length >= 8) break;
    if (!selected.includes(row)) selected.push(row);
  }
  for (const row of sorted) {
    if (selected.length >= 8) break;
    if (!selected.includes(row)) selected.push(row);
  }
  return selected.sort((a, b) => (categoryOrder.get(a.category) ?? 9) - (categoryOrder.get(b.category) ?? 9));
}

function clientDependencyInputRows(value, inheritedCategory = "") {
  if (Array.isArray(value)) {
    return value.flatMap((row) => {
      if (row && typeof row === "object" && !Array.isArray(row)) return [{ ...row, category: row.category || inheritedCategory }];
      return typeof row === "string" ? [{ label: row, category: inheritedCategory }] : [];
    });
  }
  if (!value || typeof value !== "object") return [];
  if (value.label || value.name || value.dependency || value.title) {
    return [{ ...value, category: value.category || inheritedCategory }];
  }
  if (Array.isArray(value.rows) || Array.isArray(value.items) || Array.isArray(value.dependencies)) {
    return clientDependencyInputRows(value.rows || value.items || value.dependencies, value.category || inheritedCategory);
  }
  return Object.entries(value).flatMap(([category, rows]) => clientDependencyInputRows(rows, category));
}

function normalizeClientDependencyRow(row, index, locale) {
  const source = row && typeof row === "object" ? row : {};
  const label = clientText(localizeKnown(source.label || source.name || source.dependency || source.title || "", locale), 120);
  if (!label) return null;
  const sourceIds = array(source.sourceIds).map(String).filter(Boolean).slice(0, 3);
  const truthStatus = normalizeTruthStatus(source.truthStatus, source.provenance?.truthStatus, source.status);
  let status = normalizeClientDependencyStatus(source.status || source.readiness || source.state, truthStatus);
  if (status === "provided" && !CONFIRMED_TRUTH_STATUSES.has(truthStatus) && sourceIds.length === 0) status = "to_confirm";
  return {
    id: String(source.id || "CLIENT-DEPENDENCY-" + (index + 1)),
    category: normalizeClientDependencyCategory(source.category || source.group || source.section, label),
    label,
    detail: source.detail || source.description || source.requirement
      ? clientText(localizeKnown(source.detail || source.description || source.requirement, locale), 180)
      : "",
    owner: clientText(localizeKnown(source.owner || source.responsible || source.accountable || "", locale), 100),
    status,
    timing: normalizeClientDependencyTiming(source.timing || source.deadline || source.when, status),
    truthStatus,
    sourceIds,
    derivationRuleId: source.derivationRuleId || (sourceIds.length ? null : "CLIENT-DEPENDENCY-SUPPLIED-V1"),
  };
}

function defaultClientDependencies(proposalModel, semanticModel, locale, context = {}) {
  const base = (category, label, status, timing, suffix, extra = {}) => ({
    id: "CLIENT-DEPENDENCY-" + suffix,
    category,
    label: clientText(localizeKnown(label, locale), 120),
    detail: "",
    status,
    timing,
    truthStatus: "recommended",
    sourceIds: [],
    derivationRuleId: "CLIENT-DEPENDENCY-READINESS-V1",
    ...extra,
  });
  const decisionOwnerReady = Boolean(context.decisionOwners?.scope || context.decisionOwners?.delivery);
  const partnerScope = [...array(proposalModel.scope), ...array(semanticModel.scopeItems)]
    .filter((row) => row?.ownership === "partner_integrated" && CONFIRMED_TRUTH_STATUSES.has(normalizeTruthStatus(row.truthStatus, row.status)));
  const partnerSourceIds = [...new Set(partnerScope.flatMap((row) => array(row.sourceIds).map(String).filter(Boolean)))].slice(0, 3);
  return [
    base("access", "Domain and DNS access", "required", "before_kickoff", "DOMAIN", { owner: localizeKnown("Client infrastructure owner", locale) }),
    base("access", "Hosting or cloud access", "required", "before_kickoff", "HOSTING", { owner: localizeKnown("Client infrastructure owner", locale) }),
    base("access", "Store or platform administration access", "required", "before_kickoff", "PLATFORM", { owner: localizeKnown("Client platform owner", locale) }),
    base("integrations", "Integration credentials", partnerScope.length ? "required" : "to_confirm", "before_integration", "INTEGRATIONS", partnerSourceIds.length ? {
      truthStatus: "recommended",
      sourceIds: partnerSourceIds,
      derivationRuleId: "CLIENT-DEPENDENCY-PARTNER-SCOPE-V1",
      owner: localizeKnown("Client integration owner", locale),
    } : { owner: localizeKnown("Client integration owner", locale) }),
    base("ownership", "Product catalog and content", "required", "before_kickoff", "CATALOG", { owner: localizeKnown("Client product owner", locale) }),
    base("ownership", "Brand assets and content", "required", "before_kickoff", "BRAND", { owner: localizeKnown("Client brand owner", locale) }),
    base("ownership", "Client decision owner", decisionOwnerReady ? "provided" : "required", "before_kickoff", "DECISION", decisionOwnerReady ? { owner: context.decisionOwners.scope || context.decisionOwners.delivery, truthStatus: "explicit", derivationRuleId: "CLIENT-DEPENDENCY-DECISION-OWNER-V1" } : { owner: localizeKnown("Client sponsor", locale) }),
    base("ownership", "Acceptance-test participants", "required", "before_acceptance", "UAT", { owner: localizeKnown("Client QA / UAT owner", locale) }),
  ];
}

function normalizeClientDependencyCategory(value, label = "") {
  const text = `${value || ""} ${label || ""}`.toLowerCase();
  if (/integrat|api|credential|payment|shipping|fulfil/.test(text)) return "integrations";
  if (/access|infra|server|host|cloud|domain|dns|platform|store/.test(text)) return "access";
  return "ownership";
}

function normalizeClientDependencyStatus(value, truthStatus = "unknown") {
  const text = String(value || "").trim().toLowerCase();
  if (/not[_ -]?applicable|n\/a|не\s+примен|tegishli\s+emas/.test(text)) return "not_applicable";
  if (/blocked|blocker|блокир|заблок|to['’]?siq|blok/.test(text)) return "blocked";
  if (/progress|working|в\s+работ|jarayon/.test(text)) return "in_progress";
  if (/provided|confirmed|ready|done|предостав|подтверж|готов|taqdim|tasdiq|tayyor/.test(text)) return "provided";
  if (/required|input|required_from_client|not[_ -]?ready|missing|нуж|треб|kerak|kutil/.test(text)) return "required";
  if (CONFIRMED_TRUTH_STATUSES.has(truthStatus)) return "provided";
  return "to_confirm";
}

function normalizeClientDependencyTiming(value, status = "to_confirm") {
  const text = String(value || "").trim().toLowerCase();
  if (/accept|uat|при[её]м|qabul/.test(text)) return "before_acceptance";
  if (/integrat|api|интеграц|integrats/.test(text)) return "before_integration";
  if (status === "not_applicable") return "not_applicable";
  return "before_kickoff";
}

function normalizeNarrative(model, locale) {
  const narrative = model.narrative || {};
  return {
    executiveSummary: clientText(localizeKnown(narrative.executiveSummary || model.executiveSummary || "", locale), 900),
    problemStatement: clientText(localizeKnown(narrative.problemStatement || model.problemStatement || "", locale), 900),
    valueProposition: clientText(localizeKnown(narrative.valueProposition || model.solutionNarrative || "", locale), 900),
    whyNow: clientText(localizeKnown(narrative.whyNow || "", locale), 900),
    deliveryApproach: clientText(localizeKnown(narrative.deliveryApproach || "", locale), 900),
    closingStatement: clientText(localizeKnown(narrative.closingStatement || "", locale), 900),
  };
}

function normalizeExternalCosts(lock, proposalModel, currency, exponent, locale) {
  if (lock) {
    return array(lock.pricing?.externalRows).map((row, index) => ({
      name: clientText(localizeKnown(row.name || row.component || "External item " + (index + 1), locale), 90),
      amount: formatMinor(safeMinor(row.amountMinor, "externalRows[" + index + "].amountMinor"), currency, exponent, { locale }),
      included: Boolean(row.includedInProjectPrice),
    }));
  }
  return array(proposalModel.pricing?.externalRows || proposalModel.pricing?.infraExternal).map((row, index) => ({
    name: clientText(localizeKnown(row.name || row.component || "External item " + (index + 1), locale), 90),
    amount: finiteNumber(row.amount ?? row.cost) === null ? localizeRendererText("Amount to confirm", locale) : formatMinor(majorToMinor(row.amount ?? row.cost, exponent), currency, exponent, { locale }),
    included: Boolean(row.includedInProjectPrice),
  }));
}

function normalizeCommercialTerms(proposalModel, locale) {
  const roots = [proposalModel.commercialTerms, proposalModel.contractTerms, proposalModel.commercialAssumptions, proposalModel.pricing?.terms].filter((row) => row && typeof row === "object");
  const valueFor = (...keys) => {
    for (const root of roots) {
      for (const key of keys) {
        const value = root[key];
        if (value !== undefined && value !== null && String(value).trim()) return clientText(localizeKnown(value, locale), 180);
      }
    }
    return "";
  };
  const tax = valueFor("taxVat", "taxVAT", "tax", "vat", "taxTreatment");
  const validity = valueFor("quoteValidity", "validity", "validUntil", "offerValidity");
  const warrantySupport = valueFor("warrantySupport", "warrantyAndSupport");
  const warranty = valueFor("warranty", "warrantyTerms") || warrantySupport;
  const support = valueFor("support", "supportTerms", "postLaunchSupport") || warrantySupport;
  const ip = valueFor("ip", "ipTerms", "intellectualProperty");
  const externalCosts = valueFor("externalCosts", "thirdPartyCosts", "recurringCosts", "externalAndRecurringCosts");
  return {
    tax,
    validity,
    warranty,
    support,
    ip,
    externalCosts,
    warrantySupportIpSupplied: Boolean(warranty && support && ip),
    allRequiredSupplied: Boolean(tax && validity && warranty && support && ip && externalCosts),
  };
}

function normalizeDecisionOwners(proposalModel, semanticModel, locale) {
  const roots = [proposalModel.decisionOwners, proposalModel.groundedBrief?.decisionOwners, semanticModel.decisionOwners]
    .filter((row) => row && typeof row === "object");
  const valueFor = (...keys) => {
    for (const root of roots) {
      for (const key of keys) {
        const candidate = root[key];
        const value = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate.value : candidate;
        const status = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? String(candidate.status || "explicit").toLowerCase() : "explicit";
        if (value !== undefined && value !== null && String(value).trim() && !["unknown", "missing", "not_supplied"].includes(status)) {
          return clientText(localizeKnown(value, locale), 100);
        }
      }
    }
    return "";
  };
  return {
    scope: valueFor("scope", "scopeOwner", "product", "productOwner"),
    commercial: valueFor("commercial", "commercialOwner", "finance", "financeOwner"),
    delivery: valueFor("delivery", "deliveryOwner", "project", "projectOwner"),
  };
}

function safeDiagramStyleProfile(profile, tokens) {
  return {
    ...profile,
    canvas: {
      ...(profile.canvas || {}),
      background: tokens.background,
      surface1: tokens.surface,
      surface2: tokens.surface2,
      textPrimary: tokens.text,
      textSecondary: tokens.muted,
      rule: tokens.rule,
    },
    accents: {
      ...(profile.accents || {}),
      primary: tokens.primary,
      secondary: tokens.secondary,
      positive: tokens.positive,
      warning: tokens.warning,
      critical: tokens.critical,
      decorativePrimary: tokens.background,
      decorativeSecondary: tokens.primary,
      decorativeTertiary: tokens.primary,
    },
  };
}

function hoistTrustedInlineStyles(markup, scope, dynamicRules) {
  let index = 0;
  return String(markup).replace(/<([A-Za-z][A-Za-z0-9:-]*)([^<>]*?)\sstyle="([^"]*)"([^<>]*?)>/g, (whole, tagName, before, style, after) => {
    const declaration = validateTrustedStyleDeclaration(style);
    const className = addDynamicRule(scope + "-" + (++index), declaration, dynamicRules);
    let attributes = String(before || "") + String(after || "");
    if (/\sclass="[^"]*"/.test(attributes)) {
      attributes = attributes.replace(/\sclass="([^"]*)"/, (match, existing) => ' class="' + escapeHtmlAttribute(existing + " " + className) + '"');
    } else {
      attributes += ' class="' + className + '"';
    }
    return "<" + tagName + attributes + ">";
  });
}

function validateTrustedStyleDeclaration(style) {
  const allowed = new Set(["left", "top", "width", "height", "border-color", "border-style", "background", "color", "--viz-node-color", "--viz-node-tint", "--viz-node-soft", "--viz-lane-color", "--viz-lane-label-width"]);
  const pieces = String(style || "").split(";").map((piece) => piece.trim()).filter(Boolean);
  if (!pieces.length) throw rendererError("DOM_UNSAFE_MARKUP", "Empty trusted style declaration");
  const normalized = [];
  for (const piece of pieces) {
    const separator = piece.indexOf(":");
    const property = piece.slice(0, separator).trim();
    const value = piece.slice(separator + 1).trim();
    if (separator <= 0 || !allowed.has(property)) throw rendererError("DOM_UNSAFE_MARKUP", "Unexpected renderer style property");
    const safe = property === "border-style"
      ? /^(?:solid|dashed|dotted)$/.test(value)
      : ["background", "color", "border-color", "--viz-node-color", "--viz-lane-color"].includes(property)
        ? /^#[0-9A-Fa-f]{6}$/.test(value)
        : ["--viz-node-tint", "--viz-node-soft"].includes(property)
          ? /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value)
          : /^-?[0-9]+(?:\.[0-9]+)?(?:px|%)$/.test(value);
    if (!safe) throw rendererError("DOM_UNSAFE_MARKUP", "Unsafe renderer style value");
    normalized.push(property + ":" + value);
  }
  return normalized.join(";");
}

function addDynamicRule(prefix, declaration, dynamicRules) {
  if (/url\s*\(|expression\s*\(|@import|javascript:|data:text\/html|[{}]/i.test(declaration)) {
    throw rendererError("DOM_UNSAFE_MARKUP", "Dynamic renderer rule is unsafe");
  }
  const className = "kp-dyn-" + safeDomId(prefix + "-" + (dynamicRules.length + 1));
  dynamicRules.push("." + className + "{" + declaration + "}");
  return className;
}

function renderReadinessScript() {
  return [
    "window.__KP_RENDER_READY__=(async function(){",
    "await document.fonts.ready;",
    "await Promise.all(Array.from(document.images).map(function(img){if(img.complete&&img.naturalWidth>0)return true;return img.decode().catch(function(){img.dataset.kpImageError='decode_failed';});}));",
    "var revision=0;var bump=function(){revision+=1;};",
    "var mutationObserver=new MutationObserver(bump);mutationObserver.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});",
    "var resizeObserver=new ResizeObserver(bump);document.querySelectorAll('.kp-page,.viz-node,.viz-canvas').forEach(function(node){resizeObserver.observe(node);});",
    "var previous='';var stable=0;var frames=0;",
    "while(stable<2&&frames<30){frames+=1;await new Promise(function(resolve){requestAnimationFrame(resolve);});",
    "var rects=Array.from(document.querySelectorAll('.kp-page,.viz-node,.viz-canvas')).map(function(node){var r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(function(v){return Math.round(v*100)/100;}).join(',');}).join('|');",
    "var signature=revision+':'+rects;if(signature===previous){stable+=1;}else{stable=0;previous=signature;}}",
    "mutationObserver.disconnect();resizeObserver.disconnect();return true;})();",
  ].join("");
}

function l(content, text) {
  return localizeKnown(text, content?.locale || "en");
}

function localizeKnown(value, locale) {
  return normalizeClientTerminology(localizeRendererText(value, locale), locale);
}

function normalizeClientTerminology(value, locale) {
  let text = String(value ?? "");
  const normalized = normalizeRendererLocale(locale);
  const replacements = normalized === "uz-Latn"
    ? [
        [/\bMVP\s+scope\b/gi, "boshlang‘ich mahsulot tarkibi"],
        [/\bscope\b/gi, "tarkib"],
        [/\bdiscovery\b/gi, "talablarni aniqlash"],
        [/\broadmap\b/gi, "yo‘l xaritasi"],
        [/\bcheckout\b/gi, "buyurtmani rasmiylashtirish"],
        [/\breconciliation\b/gi, "hisob-kitoblarni solishtirish"],
        [/\bbenchmark\b/gi, "taqqoslash namunasi"],
        [/\bmobile[- ]first\b/gi, "mobilga yo‘naltirilgan"],
        [/\bmobil[- ]first\b/gi, "mobilga yo‘naltirilgan"],
        [/\bpush(?:-based)?\b/gi, "tezkor bildirishnomalar"],
        [/\bdashboards?\b/gi, "boshqaruv panellari"],
        [/\badmin\b/gi, "boshqaruv"],
        [/\bAI\b/g, "sun’iy intellekt"],
        [/\bMarketplace\b/g, "Marketpleys"],
        [/\bMVP\b/g, "boshlang‘ich mahsulot"],
      ]
    : normalized === "ru-RU"
      ? [
          [/\bMVP\s+scope\b/gi, "состав первого выпуска"],
          [/\bscope\b/gi, "состав"],
          [/\bdiscovery\b/gi, "предпроектный анализ"],
          [/\broadmap\b/gi, "дорожная карта"],
          [/\bcheckout\b/gi, "оформление заказа"],
          [/\breconciliation\b/gi, "сверка расчётов"],
          [/\bbenchmark\b/gi, "аналог"],
          [/\bmobile[- ]first\b/gi, "ориентированный на мобильные устройства"],
          [/\bpush(?:-based)?\b/gi, "уведомления"],
          [/\bdashboards?\b/gi, "панели управления"],
          [/\badmin\b/gi, "администрирование"],
          [/\bMVP\b/g, "первый выпуск"],
        ]
      : [];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return text;
}

function localizeVisualizationSpec(spec, locale) {
  return {
    ...spec,
    nodes: array(spec?.nodes).map((node) => ({
      ...node,
      label: localizeKnown(node.label, locale),
      fullLabel: node.fullLabel ? localizeKnown(node.fullLabel, locale) : node.fullLabel,
    })),
    edges: array(spec?.edges).map((edge) => ({
      ...edge,
      label: edge.label ? localizeKnown(edge.label, locale) : edge.label,
    })),
    groups: array(spec?.groups).map((group) => ({
      ...group,
      label: group.label ? localizeKnown(group.label, locale) : group.label,
    })),
  };
}

const CONFIRMED_TRUTH_STATUSES = new Set(["explicit", "confirmed", "verified", "grounded", "provided", "client_provided"]);
const ENGLISH_FUNCTION_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "before", "by", "can", "for", "from", "has", "have", "in", "is", "it", "must", "not", "of", "on", "or", "should", "that", "the", "this", "to", "until", "was", "were", "when", "with",
]);

function normalizeTruthStatus(...values) {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null && String(candidate).trim());
  return value ? String(value).trim().toLowerCase() : "unknown";
}

function normalizeProjectAmountKind(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["budget_constraint", "confirmed_quote", "planning_total"].includes(normalized) ? normalized : "unknown";
}

function isConfirmedProjectAmount(content = {}) {
  return content.projectAmountKind === "confirmed_quote"
    && CONFIRMED_TRUTH_STATUSES.has(normalizeTruthStatus(content.projectAmountTruthStatus))
    && content.currencyStatus === "explicit"
    && content.currency !== "XXX";
}

function projectPriceTotalLabel(content = {}, copy = {}) {
  if (content.projectAmountKind === "budget_constraint" && content.hasClientBudget) return copy.budgetTotal;
  if (!content.hasProjectPrice) return copy.totalPending;
  if (isConfirmedProjectAmount(content)) return copy.confirmedTotal;
  return copy.planningTotal;
}

function projectPriceBadge(content = {}, copy = {}) {
  if (content.projectAmountKind === "budget_constraint" && content.hasClientBudget) return copy.budgetBadge;
  if (!content.hasProjectPrice) return l(content, "Amount to confirm");
  if (isConfirmedProjectAmount(content)) return copy.badge;
  return copy.planningBadge;
}

function findProvenanceRow(row, index, candidates, identityKey = "name") {
  const id = String(row?.id || "").trim();
  if (id) {
    const byId = candidates.find((candidate) => String(candidate?.id || "").trim() === id);
    if (byId) return byId;
  }
  const identity = String(row?.[identityKey] || row?.label || row?.role || "").trim().toLowerCase();
  if (identity) {
    const byIdentity = candidates.find((candidate) => String(candidate?.[identityKey] || candidate?.label || candidate?.role || "").trim().toLowerCase() === identity);
    if (byIdentity) return byIdentity;
  }
  return candidates[index] || null;
}

function requiresScenarioDisclosure(rows, aggregateStatus = "") {
  const statuses = [aggregateStatus, ...array(rows).map((row) => row?.truthStatus || row?.status)]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return !statuses.length || statuses.some((status) => !CONFIRMED_TRUTH_STATUSES.has(status));
}

function scenarioBanner(content, rows, aggregateStatus = "", { payment = false } = {}) {
  if (!requiresScenarioDisclosure(rows, aggregateStatus)) return "";
  return '<div class="scenario-banner" data-warning-status="scenario"' + (payment ? ' data-payment-scenario-disclosure="true"' : "") + '>' + e(l(content, "Planning scenario · confirmation required")) + "</div>";
}

function commercialCurrencyNote(content) {
  if (content.currencyStatus === "explicit" && content.currency !== "XXX") return "";
  const value = content.currencyStatus === "assumed" && content.currency !== "XXX"
    ? l(content, "Working currency") + " · " + content.currency
    : l(content, "Currency not supplied.");
  return '<div class="currency-note" data-warning-status="currency">' + e(value) + "</div>";
}

function assertRendererLocaleCoherence(content, visualizationSpecs) {
  if (localeId(content) === "en") return;
  const candidates = [];
  for (const [key, value] of Object.entries(content.narrative || {})) candidates.push(["narrative." + key, value]);
  for (const [index, row] of content.scope.entries()) {
    candidates.push(["scope[" + index + "].label", row.label], ["scope[" + index + "].detail", row.detail]);
  }
  for (const [index, row] of content.swot.entries()) candidates.push(["swot[" + index + "].label", row.label], ["swot[" + index + "].response", row.response]);
  for (const [index, row] of content.clientDependencies.entries()) {
    candidates.push(["clientDependencies[" + index + "].label", row.label], ["clientDependencies[" + index + "].detail", row.detail]);
  }
  if (content.presentationKinds.has("function_price")) {
    const scheduleRows = array(content.functionSchedule).length ? content.functionSchedule : content.functionPrice;
    for (const [index, row] of scheduleRows.entries()) {
      candidates.push(
        ["functionSchedule[" + index + "].name", row.name],
        ["functionSchedule[" + index + "].epic", row.epic],
        ["functionSchedule[" + index + "].detail", row.detail],
        ["functionSchedule[" + index + "].deadline", row.deadline],
      );
    }
  }
  for (const [specIndex, spec] of array(visualizationSpecs).entries()) {
    const localized = localizeVisualizationSpec(spec, content.locale);
    for (const [index, node] of array(localized.nodes).entries()) candidates.push(["visualizationSpecs[" + specIndex + "].nodes[" + index + "]", node.fullLabel || node.label]);
    for (const [index, edge] of array(localized.edges).entries()) candidates.push(["visualizationSpecs[" + specIndex + "].edges[" + index + "]", edge.label]);
    for (const [index, group] of array(localized.groups).entries()) candidates.push(["visualizationSpecs[" + specIndex + "].groups[" + index + "]", group.label]);
  }
  const mismatch = candidates.find(([, value]) => isHighConfidenceLocaleMismatch(value, content.locale));
  if (mismatch) {
    throw rendererError("CONTENT_LOCALE_MISMATCH", "Client-facing model text does not match the requested locale at " + mismatch[0]);
  }
}

function isHighConfidenceEnglishNarrative(value) {
  const text = String(value || "").replace(/https?:\/\/\S+/gi, " ").trim();
  if (text.length < 55) return false;
  const tokens = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  if (tokens.length < 9) return false;
  const hits = tokens.filter((token) => ENGLISH_FUNCTION_WORDS.has(token));
  return hits.length >= 5 && new Set(hits).size >= 4 && hits.length / tokens.length >= 0.1;
}

function isHighConfidenceLocaleMismatch(value, locale) {
  if (normalizeRendererLocale(locale) === "en") return false;
  if (isHighConfidenceEnglishNarrative(value)) return true;
  if (normalizeRendererLocale(locale) !== "uz-Latn") return false;
  const text = String(value || "").trim();
  if (text.length < 55) return false;
  const cyrillic = (text.match(/[А-Яа-яЁё]/g) || []).length;
  const letters = (text.match(/[A-Za-zА-Яа-яЁёʻʼ']/g) || []).length;
  return cyrillic >= 12 && letters > 0 && cyrillic / letters >= 0.18;
}

function localeId(content) {
  return normalizeRendererLocale(content?.locale || "en");
}

function scopeItemsLabel(content, count) {
  if (localeId(content) === "ru-RU") return count + " элементов состава";
  if (localeId(content) === "uz-Latn") return count + " ta tarkib elementi";
  return count + " scope items";
}

function partnerBoundariesLabel(content, count) {
  if (localeId(content) === "ru-RU") return "Партнёрских границ: " + count;
  if (localeId(content) === "uz-Latn") return "Hamkor chegaralari: " + count;
  return count + " partner boundaries identified";
}

function deferredCapabilitiesLabel(content, count) {
  if (localeId(content) === "ru-RU") return "Отложенных возможностей вне запуска: " + count;
  if (localeId(content) === "uz-Latn") return "Ishga tushirishdan tashqarida qoldirilgan imkoniyatlar: " + count;
  return count + " deferred capabilities kept outside launch";
}

function deliveryWindowLabel(content, count, unit) {
  const duration = formatRendererUnit(count, unit, content.locale);
  if (localeId(content) === "ru-RU") return "Срок реализации: " + duration;
  if (localeId(content) === "uz-Latn") return "Amalga oshirish muddati: " + duration;
  return duration + " delivery window";
}

function rolesIdentifiedLabel(content, count) {
  if (localeId(content) === "ru-RU") return "Ролей в плане: " + count;
  if (localeId(content) === "uz-Latn") return "Rejadagi rollar: " + count;
  return count + " delivery roles identified";
}

function paymentStagesLabel(content, count) {
  if (localeId(content) === "ru-RU") return "Этапов оплаты по приёмке: " + count;
  if (localeId(content) === "uz-Latn") return "Qabul natijasiga bog'langan to'lov bosqichlari: " + count;
  return count + " acceptance-linked payment stages";
}

function functionTraceLabel(content, functionCount, partnerCount) {
  if (localeId(content) === "ru-RU") return "Бюджетных функциональных групп: " + functionCount + " · партнёрских/внешних границ отдельно: " + partnerCount;
  if (localeId(content) === "uz-Latn") return "Budjetlangan funksional guruhlar: " + functionCount + " · alohida hamkor/tashqi chegaralar: " + partnerCount;
  return functionCount + " budgeted function groups · " + partnerCount + " partner/external boundaries tracked separately";
}

function functionGroupsLabel(content, count) {
  if (localeId(content) === "ru-RU") return "Функциональных групп: " + count;
  if (localeId(content) === "uz-Latn") return "Funksional guruhlar: " + count;
  return count + " functional groups";
}

function rolesLabel(content, count) {
  if (localeId(content) === "ru-RU") return "Ролей: " + count;
  if (localeId(content) === "uz-Latn") return "Rollar: " + count;
  return count + " roles";
}

function branchChildrenLabel(content, count) {
  const locale = normalizeRendererLocale(content?.locale);
  if (locale === "ru-RU") {
    const mod10 = count % 10;
    const mod100 = count % 100;
    const label = mod10 === 1 && mod100 !== 11 ? "роль" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "роли" : "ролей";
    return count + " " + label;
  }
  if (locale === "uz-Latn") return count + " ta rol";
  return count + " role" + (count === 1 ? "" : "s");
}

function paymentStagesShortLabel(content, count) {
  if (localeId(content) === "ru-RU") return "Этапов оплаты: " + count;
  if (localeId(content) === "uz-Latn") return "To'lov bosqichlari: " + count;
  return count + " payment stages";
}

function approveScopeLabel(content, count) {
  if (localeId(content) === "ru-RU") return "Согласовать " + count + " ключевых функций и границы ответственности.";
  if (localeId(content) === "uz-Latn") return count + " ta asosiy funksiya va mas'uliyat chegarasini tasdiqlash.";
  return "Approve " + count + " key functions and the ownership boundary.";
}

function sourceStatusLabel(status, content) {
  const labels = {
    read: "Source opened",
    provided: "Client provided",
    verified: "Verified source",
    grounded: "Supported source",
    unknown: "Status to confirm",
  };
  return l(content, labels[status] || labels.unknown);
}

function currencyDisplay(content) {
  if (content.currencyStatus === "explicit" && content.currency !== "XXX") return content.currency;
  if (content.currencyStatus === "assumed" && content.currency !== "XXX") return content.currency + " · " + l(content, "working assumption");
  return l(content, "Not supplied");
}

function quadrantLabel(quadrant, content) {
  const labels = { strength: "Strength", weakness: "Weakness", opportunity: "Opportunity", threat: "Threat" };
  return l(content, labels[quadrant] || labels.strength);
}

function chapter(index, statement, detail, drivers) {
  return '<div class="chapter-layout"><div class="chapter-index">' + e(index) + '</div><div class="chapter-copy"><strong>' + e(statement) + '</strong><p>' + e(detail) + '</p><div class="driver-grid">' + drivers.map((driver, position) => '<div class="driver"><span>0' + (position + 1) + '</span><strong>' + e(driver) + "</strong></div>").join("") + "</div></div></div>";
}

function missingState(content, title, detail, questions) {
  return '<div class="missing-state panel-soft"><div><span class="eyebrow">' + e(l(content, "INPUT REQUIRED")) + '</span><strong>' + e(title) + '</strong><p>' + e(detail) + '</p></div><div class="question-list">' + questions.map((question, index) => '<div class="question-row"><span>Q' + (index + 1) + '</span><strong>' + e(question) + "</strong></div>").join("") + "</div></div>";
}

function metric(label, value) {
  return '<div class="metric"><span>' + e(label) + '</span><strong>' + e(value) + "</strong></div>";
}

function metricFact(label, value, sourceIds, claimId, content) {
  return '<div class="metric" data-claim-container><span>' + e(label) + '</span><strong' + factualClaimAttributes(sourceIds, claimId, { container: false }) + '>' + e(value) + "</strong>" + inlineSources(sourceIds, content, { compact: true }) + "</div>";
}

function term(label, value) {
  return '<div class="term"><span>' + e(label) + '</span><strong>' + e(value) + "</strong></div>";
}

function strictLayoutFamily(value) {
  const family = String(value || "");
  if (!LAYOUT_FAMILIES.has(family)) {
    throw rendererError("CONTRACT_PRESENTATION_PLAN_INVALID", "Unsupported layout family: " + family);
  }
  return family;
}

function strictColor(value, fallback, path) {
  if (value === undefined || value === null || value === "") return fallback;
  if (!/^#[0-9A-Fa-f]{6}$/.test(String(value))) {
    throw rendererError("CONTRACT_STYLE_PROFILE_INVALID", "Invalid color token at " + path);
  }
  return String(value).toUpperCase();
}

function resolveFontStack(value) {
  const tokenMap = {
    sans_neo: "neo_grotesk_sans",
    sans_humanist: "humanist_sans",
    sans_geometric: "geometric_sans",
    serif_transitional: "transitional_serif",
    serif_display: "display_serif",
    mono_system: "monospace",
  };
  const key = tokenMap[value] || value || "unknown";
  return FONT_BY_CLASS[key] || FONT_BY_CLASS.unknown;
}

function safeCssFontStack(value, fallback) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  if (!raw || raw.length > 180 || /[;{}<>@\\\n\r]|(?:url|var)\s*\(/i.test(raw)) return fallback;
  const genericFamilies = new Set([
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
    "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  ]);
  const families = [];
  for (const part of raw.split(",").slice(0, 6)) {
    const unquoted = part.trim().replace(/^['"]|['"]$/g, "").trim();
    if (!unquoted || unquoted.length > 64 || !/^[\p{L}\p{N} ._\-]+$/u.test(unquoted)) continue;
    if (!families.some((item) => item.toLowerCase() === unquoted.toLowerCase())) families.push(unquoted);
  }
  if (!families.length) return fallback;
  if (!families.some((item) => genericFamilies.has(item.toLowerCase()))) {
    families.push(/\bmono/i.test(fallback) ? "monospace" : /\bserif\b/i.test(fallback) && !/sans-serif/i.test(fallback) ? "serif" : "sans-serif");
  }
  return families
    .map((family) => (genericFamilies.has(family.toLowerCase()) || /^[A-Za-z0-9_.-]+$/.test(family) ? family : `"${family}"`))
    .join(", ");
}

function alphaHex(hex, alpha) {
  const cssVariable = String(hex || "").trim();
  if (/^var\(--kp-page-[a-z0-9-]+\)$/.test(cssVariable)) {
    const percentage = Number((Math.max(0, Math.min(1, alpha)) * 100).toFixed(2));
    return "color-mix(in srgb," + cssVariable + " " + percentage + "%,transparent)";
  }
  const safe = strictColor(hex, "#000000", "internal");
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0").toUpperCase();
  return safe + value;
}

function readableTextColor(background, preferred, alternate) {
  const candidates = [preferred, alternate, "#000000", "#FFFFFF"].map((color) => strictColor(color, "#000000", "internal"));
  return candidates.reduce((best, candidate) => contrastRatioHex(candidate, background) > contrastRatioHex(best, background) ? candidate : best, candidates[0]);
}

function ensureTextContrast(foreground, backgrounds, fallback, minimum = 4.75) {
  const base = strictColor(foreground, "#000000", "internal");
  const safeFallback = strictColor(fallback, "#000000", "internal");
  const surfaces = array(backgrounds).map((color) => strictColor(color, "#FFFFFF", "internal"));
  const passes = (candidate) => surfaces.every((background) => contrastRatioHex(candidate, background) >= minimum);
  if (passes(base)) return base;

  // Preserve brand identity before falling back to neutral black/white.
  // Trying both luminance directions matters for vivid palettes: a green
  // background with a purple content color usually needs a darker purple,
  // even when the average background luminance would otherwise suggest white.
  const adjustedBase = closestContrastAdjustment(base, passes, surfaces);
  if (adjustedBase) return adjustedBase;
  if (passes(safeFallback)) return safeFallback;
  const adjustedFallback = closestContrastAdjustment(safeFallback, passes, surfaces);
  if (adjustedFallback) return adjustedFallback;

  const backgroundLuminance = surfaces.reduce((sum, color) => sum + relativeLuminanceHex(color), 0) / Math.max(1, surfaces.length);
  const neutral = backgroundLuminance >= .5 ? "#000000" : "#FFFFFF";
  return readableTextColor(surfaces[0] || "#FFFFFF", safeFallback, neutral);
}

function closestContrastAdjustment(base, passes, surfaces = []) {
  const candidates = [];
  for (const target of ["#000000", "#FFFFFF"]) {
    for (let step = 1; step <= 18; step += 1) {
      const weight = step / 20;
      const candidate = mixHex(base, target, weight);
      if (!passes(candidate)) continue;
      const minimumContrast = Math.min(...surfaces.map((surface) => contrastRatioHex(candidate, surface)));
      candidates.push({ candidate, weight, minimumContrast });
      break;
    }
  }
  candidates.sort((left, right) => left.weight - right.weight || right.minimumContrast - left.minimumContrast);
  return candidates[0]?.candidate || "";
}

function mixHex(left, right, rightWeight) {
  const a = strictColor(left, "#000000", "internal");
  const b = strictColor(right, "#000000", "internal");
  const weight = Math.max(0, Math.min(1, Number(rightWeight) || 0));
  const channels = [1, 3, 5].map((index) => {
    const value = Math.round(Number.parseInt(a.slice(index, index + 2), 16) * (1 - weight)
      + Number.parseInt(b.slice(index, index + 2), 16) * weight);
    return value.toString(16).padStart(2, "0").toUpperCase();
  });
  return "#" + channels.join("");
}

function contrastRatioHex(left, right) {
  const leftLuminance = relativeLuminanceHex(strictColor(left, "#000000", "internal"));
  const rightLuminance = relativeLuminanceHex(strictColor(right, "#000000", "internal"));
  return (Math.max(leftLuminance, rightLuminance) + .05) / (Math.min(leftLuminance, rightLuminance) + .05);
}

function relativeLuminanceHex(hex) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => value <= .03928 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4));
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

function boundedNumber(value, fallback, minimum, maximum) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw rendererError("CONTRACT_STYLE_PROFILE_INVALID", "Style geometry value is outside renderer limits");
  }
  return Number(number.toFixed(3));
}

function clientText(value, maximum = 400) {
  const text = String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!text) return "";
  assertSafeRendererText(text);
  if (PRIVATE_TEXT_PATTERN.test(text) || BIDI_OVERRIDE_PATTERN.test(text)) {
    throw rendererError("CONTENT_INTERNAL_IDENTIFIER_VISIBLE", "Client-visible content contains an internal identifier");
  }
  const chars = Array.from(text);
  return chars.length <= maximum ? text : chars.slice(0, maximum - 1).join("") + "…";
}

function meaningfulNarrative(value) {
  const text = clientText(value || "", 900);
  if (!text || /^(?:executive summary|problem statement|value proposition|timing rationale|delivery approach|next decisions?)\s+to confirm\.?$/i.test(text)) return "";
  return text;
}

function safeSourceLabel(value, locale = "en") {
  const text = String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!text || PRIVATE_TEXT_PATTERN.test(text) || /[/\\]{2,}/.test(text)) return localizeRendererText("Client-supplied evidence", locale);
  return clientText(localizeKnown(text, locale), 100);
}

function safeDisplayUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || PRIVATE_TEXT_PATTERN.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    const path = url.pathname === "/" ? "" : url.pathname;
    return clientText(url.hostname.replace(/^www\./i, "") + path, 120);
  } catch {
    return "";
  }
}

function safeSourceHref(value) {
  const raw = String(value || "").trim();
  if (!raw || PRIVATE_TEXT_PATTERN.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:gclid|fbclid|ref|token|access_token|api_?key|secret|session|auth|signature|sig)$/i.test(key)) url.searchParams.delete(key);
    }
    const href = url.toString();
    return href.length <= 600 ? href : "";
  } catch {
    return "";
  }
}

function normalizeEvidenceNature(value, text = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["observed", "reported", "estimate", "forecast", "scenario"].includes(normalized)) return normalized;
  const candidate = String(text || "").toLowerCase();
  if (/scenario|сценар|ssenari/iu.test(candidate)) return "scenario";
  if (/forecast|project(?:ed|ion)|прогноз|prognoz|kutil(?:moqda|adi)|ожида(?:ется|емый)/iu.test(candidate)) return "forecast";
  if (/estimate|estimated|approximately|taxmin|оценк|примерно|около/iu.test(candidate)) return "estimate";
  if (/report(?:ed|s)?|according|сообща|по данным|ma['’]?lumot/iu.test(candidate)) return "reported";
  return "observed";
}

function evidenceClaimLabel(row, content) {
  if (String(row?.truthStatus || "").toLowerCase() === "verified") return l(content, "Supported fact");
  if (String(row?.truthStatus || "").toLowerCase() === "single_source") {
    const nature = normalizeEvidenceNature(row?.claimNature, row?.text || row?.learning);
    return l(content, ["estimate", "forecast", "scenario"].includes(nature) ? "Single-source projection" : "Single-source observation");
  }
  return l(content, "Recommendation");
}

function isAnalogRendererSource(source = {}) {
  const type = String(source.rawType || "").toLowerCase();
  const topic = String(source.researchTopic || "").toLowerCase();
  return type === "analog_research"
    || ["analog_features", "analog_business_model", "product_analog"].includes(topic)
    || /^analog_(?:feature|business|product)/.test(topic);
}

function factualClaimAttributes(sourceIds, claimId, { container = true } = {}) {
  const ids = [...new Set(array(sourceIds).map(String).filter(Boolean))];
  if (!ids.length) return "";
  return (container ? ' data-claim-container="true"' : "")
    + ' data-factual-claim="true"'
    + ' data-claim-id="' + escapeHtmlAttribute(String(claimId || "factual-claim")) + '"'
    + ' data-source-ids="' + escapeHtmlAttribute(ids.join(",")) + '"';
}

function inlineSources(sourceIds, content, { compact = false } = {}) {
  const ids = [...new Set(array(sourceIds).map(String).filter(Boolean))];
  if (!ids.length || !content) return "";
  const byId = new Map(array(content.sources).map((source) => [String(source.id), source]));
  const sources = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!sources.length) return "";
  const chips = sources.slice(0, 3).map((source) => {
    const display = String(source.display || "").trim();
    const label = String(source.label || "").trim();
    const comparableLabel = label.toLowerCase().replace(/^www\./, "");
    const comparableDisplay = display.toLowerCase().replace(/^www\./, "");
    const chipText = display && comparableLabel !== comparableDisplay && !comparableLabel.includes(comparableDisplay)
      ? label + " · " + display
      : display || label;
    const attributes = ' class="source-chip" data-citation="true" data-content-role="citation" data-source-id="' + escapeHtmlAttribute(source.id) + '"';
    return source.href
      ? '<a' + attributes + ' href="' + escapeHtmlAttribute(source.href) + '">' + e(chipText) + "</a>"
      : '<span' + attributes + '>' + e(chipText) + "</span>";
  }).join("");
  return '<div class="inline-sources' + (compact ? " compact" : "") + '" data-citation="true" data-citation-ids="' + escapeHtmlAttribute(sources.map((source) => source.id).join(",")) + '"><span class="inline-source-label">' + e(l(content, "Source")) + "</span>" + chips + "</div>";
}

function normalizeStringRows(value, maximumRows, maximumText) {
  return array(value).map((row) => clientText(typeof row === "string" ? row : row.label || row.name || row.text, maximumText)).filter(Boolean).slice(0, maximumRows);
}

function e(value) {
  return escapeHtmlText(clientText(value, 1200));
}

function renderTitleMarkup(value) {
  const text = clientText(value, 1200);
  return text.split(/(\s+)/u).map((part) => {
    const safe = escapeHtmlText(part);
    return /[\p{L}\p{N}]-[\p{L}\p{N}]/u.test(part) ? '<span class="page-title-token">' + safe + "</span>" : safe;
  }).join("");
}

function extractVisibleText(html) {
  return normalizeVisible(String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"));
}

function normalizeVisible(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function array(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finitePositive(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function nullableNumber(value) {
  const number = finiteNumber(value);
  return number === null || number < 0 ? null : number;
}

function safeMinor(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw rendererError("CONTRACT_COMMERCIAL_LOCK_INVALID", field + " must be a non-negative safe integer");
  }
  return number;
}

function safeBasisPoints(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 10000) {
    throw rendererError("CONTRACT_COMMERCIAL_LOCK_INVALID", field + " must be an integer from 0 to 10000");
  }
  return number;
}

function majorToMinor(value, exponent) {
  const number = finiteNumber(value);
  if (number === null || number < 0) return null;
  const factor = 10 ** exponent;
  const minor = Math.round(number * factor);
  return Number.isSafeInteger(minor) ? minor : null;
}

function resolveCurrency(value) {
  const currency = String(value || "XXX").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw rendererError("COMMERCIAL_CURRENCY_UNSUPPORTED_V1", "Currency is invalid for renderer v1");
  }
  return currency;
}

function formatMinor(minor, currency, exponent, content = {}) {
  if (!Number.isSafeInteger(minor) || minor < 0) return l(content, "Amount to confirm");
  const factor = 10 ** exponent;
  const major = minor / factor;
  const fraction = minor % factor;
  const digits = fraction === 0 ? 0 : exponent;
  const formatted = new Intl.NumberFormat(content.intlLocale || rendererIntlLocale(content.locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
  // Familiar currency symbols read better for clients than ISO codes
  // ("$11 800" instead of "USD 11 800"); other currencies keep their code.
  const symbol = { USD: "$", EUR: "€", GBP: "£" }[currency];
  if (symbol) return symbol + formatted;
  return currency === "XXX" ? formatted : currency + " " + formatted;
}

function formatBasisPoints(value, content = {}) {
  const basis = Number(value);
  if (!Number.isSafeInteger(basis) || basis < 0) return l(content, "Share to confirm");
  return new Intl.NumberFormat(content.intlLocale || rendererIntlLocale(content.locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(basis / 100) + "%";
}

function formatNumber(value, content = {}) {
  const number = finiteNumber(value);
  return number === null ? l(content, "To confirm") : new Intl.NumberFormat(content.intlLocale || rendererIntlLocale(content.locale), { maximumFractionDigits: 2 }).format(number);
}

function padPage(value) {
  return String(value).padStart(2, "0");
}

function truthLabel(value, content = {}) {
  const labels = {
    explicit: "Confirmed",
    verified: "Verified",
    single_source: "Single source",
    recommended: "Proposed",
    inferred: "Inferred",
    assumed: "Assumption",
    unknown: "To confirm",
  };
  return l(content, labels[value] || "To confirm");
}

function ownershipLabel(value, content = {}) {
  const labels = {
    owned: "Owned",
    partner_integrated: "Partner-enabled",
    deferred: "Deferred",
    out_of_scope: "Out of scope",
    unknown: "Ownership to confirm",
  };
  return l(content, labels[value] || "Ownership to confirm");
}

function scopeEffectCopy(value, content = {}) {
  if (value === "validate") return l(content, "Validate the operating pattern before scope approval.");
  if (value === "do_not_copy") return l(content, "Do not copy the feature or brand expression.");
  return l(content, "Benchmark context only; no automatic scope commitment.");
}

function normalizeQuadrant(value) {
  const text = String(value || "").toLowerCase();
  if (/weak/.test(text)) return "weakness";
  if (/opportun/.test(text)) return "opportunity";
  if (/threat|risk/.test(text)) return "threat";
  return "strength";
}

function operatingResponse(quadrant, hasEvidence, content = {}) {
  const response = quadrant === "strength" ? "Protect the advantage in acceptance criteria."
    : quadrant === "weakness" ? "Assign an owner and close the missing input."
      : quadrant === "opportunity" ? "Test the signal early and define a measure."
        : "Define a fallback route before the dependency reaches the critical path.";
  return (hasEvidence ? "" : l(content, "After the input is confirmed: ")) + l(content, response);
}

function capitalize(value) {
  const text = String(value || "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function rendererError(code, message) {
  return Object.assign(new Error(message), { code });
}
