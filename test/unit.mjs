import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { agentConfig, normalizeProfileContrast } from "../src/agent.mjs";
import { AGENT_ROOT } from "../src/root.mjs";
import {
  applyUdevsScreenshotVisualSystem,
  classifyBrandPaletteFromDomainWithAi,
  classifyBrandPaletteWithAi,
  deriveReferenceThemeFromSnapshot,
  dynamicColorPalettesEnabled,
  normalizeV5StyleProfile,
  taskListRows,
  udevsFallbackTheme,
} from "../scripts/kpi_pdf_client.mjs";
import {
  referenceDrivenStyles,
  resolveStyleTokens,
  teamCostPlan,
} from "../scripts/kp_pdf_reference_renderer.mjs";
import { buildProductDeliveryInventory, buildProductMapModel, buildProductMapSegments } from "../scripts/kp_product_map_model.mjs";
import { buildPresentationPlan, selectDynamicPageDecisions } from "../scripts/kp_presentation_planner.mjs";
import { localizeRendererText } from "../scripts/kp_pdf_reference_locale.mjs";
import { buildProposalSemanticModel, normalizeScopeItems, validateProposalSemanticModel } from "../scripts/kp_semantic_model.mjs";
import { getDomainResearchPacks, parseKpBrief } from "../scripts/kp_grounded_content.mjs";
import { buildAndValidateAppPrototypeSpec } from "../scripts/kp_app_prototype_planner.mjs";
import { renderAppPrototypeHtml } from "../scripts/kp_app_prototype_renderer.mjs";
import {
  buildPrimaryFlowSpec,
  buildProductMapSpec,
  buildRoadmapSpec,
  buildRoadmapWorkstreamSegments,
  primaryFlowSegmentCount,
  ROADMAP_WORKSTREAM_PAGE_LIMIT,
} from "../scripts/kp_visualization_planner.mjs";
import { layoutVisualization, validateLayoutGeometry } from "../scripts/kp_diagram_layout.mjs";
import { validateVisualizationSpecs } from "../scripts/kp_visualization_validator.mjs";
import {
  checkBearerAuthorization,
  normalizeConfiguredApiKey,
  parseBearerToken,
} from "../src/auth.mjs";

const config = agentConfig({});
assert.equal(config.KP_PDF_RENDERER_MODE, "v5");
assert.equal(config.KP_PDF_QUALITY_GATE_MODE, "enforce");
assert.equal(config.KP_DISABLE_WEB_RESEARCH, "1");
assert.equal(config.KP_DYNAMIC_COLOR_PALETTES_ENABLED, "0");
assert.equal(dynamicColorPalettesEnabled({}), false);
assert.equal(dynamicColorPalettesEnabled({ KP_DYNAMIC_COLOR_PALETTES_ENABLED: "off" }), false);
assert.equal(dynamicColorPalettesEnabled({ KP_DYNAMIC_COLOR_PALETTES_ENABLED: "1" }), true);
assert.equal(dynamicColorPalettesEnabled({ KP_DYNAMIC_COLOR_PALETTES_ENABLED: "on" }), true);
assert.ok((await fs.stat(path.join(AGENT_ROOT, "scripts", "kpi_pdf_client.mjs"))).isFile());
assert.ok((await fs.stat(path.join(AGENT_ROOT, "schemas", "kp", "request-context-v1.schema.json"))).isFile());
const dockerfile = await fs.readFile(path.join(AGENT_ROOT, "Dockerfile"), "utf8");
assert.ok(dockerfile.includes("poppler-utils"));
assert.ok(dockerfile.includes("requirements-pdf-qa.txt"));
assert.ok(dockerfile.includes("PDFTOPPM=/usr/bin/pdftoppm"));
const manifest = JSON.parse(await fs.readFile(path.join(AGENT_ROOT, "engine-manifest.json"), "utf8"));
assert.ok(manifest.files.length >= 50);
const normalizedProfile = normalizeProfileContrast({
  canvas: {
    mode: "light",
    background: "#FFFFFF",
    surface1: "#0D47A1",
    surface2: "#EEF2F8",
    textPrimary: "#0D47A1",
    textSecondary: "#000000",
  },
});
assert.equal(normalizedProfile.canvas.surface1, "#F5F7FA");
assert.equal(normalizedProfile.canvas.textPrimary, "#0D47A1");
assert.equal(normalizeConfiguredApiKey(" Bearer service-secret "), "service-secret");
assert.equal(parseBearerToken("Bearer service-secret"), "service-secret");
assert.equal(parseBearerToken("Bearer Bearer service-secret"), "service-secret");
assert.deepEqual(checkBearerAuthorization("", ""), { ok: true, reason: "disabled" });
assert.deepEqual(checkBearerAuthorization("service-secret", ""), { ok: false, reason: "required" });
assert.deepEqual(checkBearerAuthorization("service-secret", "Bearer wrong"), { ok: false, reason: "invalid" });
assert.deepEqual(checkBearerAuthorization("service-secret", "Bearer service-secret"), { ok: true, reason: "accepted" });
assert.deepEqual(checkBearerAuthorization("service-secret", "Bearer Bearer service-secret"), { ok: true, reason: "accepted" });

let paletteAiRequest = null;
const paletteAiResult = await classifyBrandPaletteWithAi({
  screenshot: Buffer.from("synthetic-jpeg"),
  referenceUrl: "https://brand.example/",
  candidates: [
    { color: "#7000FF", sources: ["theme-color"], primaryScore: 100, secondaryScore: 5 },
    { color: "#00FF66", sources: ["css-variable"], primaryScore: 8, secondaryScore: 90 },
    { color: "#F2F4F7", sources: ["element:backgroundColor"], primaryScore: 2, secondaryScore: 4 },
  ],
}, {
  env: {
    KP_REFERENCE_PALETTE_AI_ENABLED: "1",
    KP_REFERENCE_PALETTE_AI_MODEL: "test-vision-model",
    KP_REFERENCE_PALETTE_AI_MIN_CONFIDENCE: "0.55",
  },
  client: {
    responses: {
      create: async (request) => {
        paletteAiRequest = request;
        return {
          output_text: JSON.stringify({
            primary: "#7000FF",
            secondary: "#00FF66",
            confidence: 0.94,
            primaryEvidence: "Main logo and CTA color.",
            secondaryEvidence: "Distinct supporting brand color.",
          }),
        };
      },
    },
  },
});
assert.equal(paletteAiResult.applied, true);
assert.equal(paletteAiResult.provider, "openai");
assert.equal(paletteAiResult.primary, "#7000FF");
assert.equal(paletteAiResult.secondary, "#00FF66");
assert.equal(paletteAiRequest.model, "test-vision-model");
assert.deepEqual(
  paletteAiRequest.text.format.schema.properties.primary.enum,
  ["#7000FF", "#00FF66", "#F2F4F7"],
);
assert.equal(
  paletteAiRequest.input[0].content[1].image_url.startsWith("data:image/jpeg;base64,"),
  true,
);

const rejectedPaletteAiResult = await classifyBrandPaletteWithAi({
  screenshot: Buffer.from("synthetic-jpeg"),
  candidates: ["#7000FF", "#00FF66"],
}, {
  env: { KP_REFERENCE_PALETTE_AI_ENABLED: "1" },
  client: {
    responses: {
      create: async () => ({
        output_text: JSON.stringify({
          primary: "#123456",
          secondary: "#00FF66",
          confidence: 0.99,
          primaryEvidence: "Invented.",
          secondaryEvidence: "Candidate.",
        }),
      }),
    },
  },
});
assert.equal(rejectedPaletteAiResult.applied, false);
assert.equal(rejectedPaletteAiResult.reason, "candidate_constraint_failed");

let anthropicPaletteRequest = null;
const anthropicPaletteAiResult = await classifyBrandPaletteWithAi({
  screenshot: Buffer.from("synthetic-jpeg"),
  referenceUrl: "https://brand.example/",
  candidates: ["#7000FF", "#00FF66", "#F2F4F7"],
}, {
  env: {
    KP_REFERENCE_PALETTE_AI_ENABLED: "1",
    KP_REFERENCE_PALETTE_AI_MODEL: "test-claude-model",
    OPENAI_API_KEY: "sk-ant-test-placeholder",
  },
  client: {
    messages: {
      create: async (request) => {
        anthropicPaletteRequest = request;
        return {
          content: [{
            type: "tool_use",
            name: "select_brand_palette",
            input: {
              primary: "#7000FF",
              secondary: "#00FF66",
              confidence: 0.92,
              primaryEvidence: "Main logo color.",
              secondaryEvidence: "Supporting interface color.",
            },
          }],
        };
      },
    },
  },
});
assert.equal(anthropicPaletteAiResult.applied, true);
assert.equal(anthropicPaletteAiResult.provider, "anthropic");
assert.equal(anthropicPaletteAiResult.model, "test-claude-model");
assert.equal(anthropicPaletteRequest.messages[0].content[0].type, "image");
assert.equal(anthropicPaletteRequest.messages[0].content[0].source.type, "base64");
assert.deepEqual(
  anthropicPaletteRequest.tools[0].input_schema.properties.secondary.enum,
  ["#7000FF", "#00FF66", "#F2F4F7"],
);

let anthropicDomainPaletteRequest = null;
const anthropicDomainPaletteResult = await classifyBrandPaletteFromDomainWithAi({
  referenceUrl: "https://uzum.uz/",
  captureFailure: "reference website returned an anti-bot or access-denied page",
}, {
  env: {
    KP_REFERENCE_PALETTE_AI_ENABLED: "1",
    KP_REFERENCE_PALETTE_AI_MODEL: "test-claude-model",
    KP_REFERENCE_PALETTE_AI_DOMAIN_MIN_CONFIDENCE: "0.55",
  },
  client: {
    messages: {
      create: async (request) => {
        anthropicDomainPaletteRequest = request;
        return {
          content: [{
            type: "tool_use",
            name: "select_brand_palette",
            input: {
              primary: "#7000FF",
              secondary: "#00FF66",
              confidence: 0.91,
              primaryEvidence: "Known Uzum brand identity.",
              secondaryEvidence: "Known supporting brand color.",
            },
          }],
        };
      },
    },
  },
});
assert.equal(anthropicDomainPaletteResult.applied, true);
assert.equal(anthropicDomainPaletteResult.mode, "ai_domain_fallback");
assert.equal(anthropicDomainPaletteResult.provider, "anthropic");
assert.equal(anthropicDomainPaletteResult.primary, "#7000FF");
assert.equal(anthropicDomainPaletteResult.secondary, "#00FF66");
assert.equal(anthropicDomainPaletteRequest.messages[0].content.length, 1);
assert.equal(anthropicDomainPaletteRequest.messages[0].content[0].type, "text");
assert.equal(
  JSON.parse(anthropicDomainPaletteRequest.messages[0].content[0].text).domain,
  "uzum.uz",
);
assert.equal(
  anthropicDomainPaletteRequest.tools[0].input_schema.properties.primary.pattern,
  "^#[0-9A-Fa-f]{6}$",
);

const lowConfidenceDomainPaletteResult = await classifyBrandPaletteFromDomainWithAi({
  referenceUrl: "https://unknown-brand.example/",
  captureFailure: "access denied",
}, {
  env: {
    KP_REFERENCE_PALETTE_AI_ENABLED: "1",
    KP_REFERENCE_PALETTE_AI_DOMAIN_MIN_CONFIDENCE: "0.7",
  },
  client: {
    messages: {
      create: async () => ({
        content: [{
          type: "tool_use",
          name: "select_brand_palette",
          input: {
            primary: "#123456",
            secondary: "#ABCDEF",
            confidence: 0.31,
            primaryEvidence: "Domain inference only.",
            secondaryEvidence: "Domain inference only.",
          },
        }],
      }),
    },
  },
});
assert.equal(lowConfidenceDomainPaletteResult.applied, false);
assert.equal(lowConfidenceDomainPaletteResult.reason, "confidence_too_low");

const mismatchedPaletteAiKey = await classifyBrandPaletteWithAi({
  screenshot: Buffer.from("synthetic-jpeg"),
  candidates: ["#7000FF", "#00FF66"],
}, {
  env: {
    KP_REFERENCE_PALETTE_AI_ENABLED: "1",
    KP_REFERENCE_PALETTE_AI_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-ant-test-placeholder",
  },
});
assert.equal(mismatchedPaletteAiKey.applied, false);
assert.equal(mismatchedPaletteAiKey.attempted, true);
assert.equal(mismatchedPaletteAiKey.reason, "api_key_provider_mismatch");

const paletteCases = [
  ["Texnomart", "#FDB813", "#272727", "#E31E24", "#FFFFFF"],
  ["Uzum Market", "#7000FF", "#00FF66", "#F2F4F7", "#F2F4F7"],
  ["Yandex Market Uzbekistan", "#FCE000", "#000000", "#E93E16", "#FFFFFF"],
  ["Olcha", "#FF2D55", "#1A1A1A", "#28A745", "#FFFFFF"],
  ["Korzinka", "#E31E24", "#009640", "#FDB813", "#FFFFFF"],
  ["Safia Cafe & Bakery", "#7A5C43", "#F3E5D8", "#E6A15C", "#F3E5D8"],
  ["Udevs", "#0052FF", "#0D1117", "#FFFFFF", "#0D1117"],
  ["Ucode", "#6366F1", "#0B0F19", "#10B981", "#0B0F19"],
];

for (const [name, primary, secondary, accent, background] of paletteCases) {
  const theme = deriveReferenceThemeFromSnapshot({
    themeColor: primary,
    cssVariables: [
      { name: "--brand-primary", value: primary },
      { name: "--brand-secondary", value: secondary },
      { name: "--brand-accent", value: accent },
    ],
    rows: [
      { tag: "body", className: "site", area: 1_296_000, textLength: 1_000, backgroundColor: background, color: secondary, fontFamily: "Inter" },
      { tag: "header", className: "brand header secondary", area: 160_000, textLength: 30, backgroundColor: secondary, color: background, fontFamily: "Inter" },
      { tag: "button", className: "primary brand cta", area: 12_000, textLength: 12, backgroundColor: primary, color: secondary, fontFamily: "Inter" },
      { tag: "span", className: "promo accent sale", area: 5_000, textLength: 8, backgroundColor: accent, color: background, fontFamily: "Inter" },
      { tag: "h1", className: "title", area: 30_000, textLength: 50, backgroundColor: "rgba(0,0,0,0)", color: secondary, fontFamily: "Inter" },
    ],
  }, { referenceUrl: `https://${name.toLowerCase().replaceAll(/[^a-z]+/g, "-")}.example` });
  assert.equal(theme.decorativePrimary, primary, `${name} primary color`);
  assert.equal(theme.decorativeSecondary, secondary, `${name} secondary color`);
  assert.equal(theme.decorativeTertiary, accent, `${name} accent color`);
  assert.equal(theme.canvas, background, `${name} background color`);

  const styleProfile = normalizeV5StyleProfile(null, {
    referenceMode: "none",
    analogTheme: {
      themeTokens: theme,
      themeSource: { kind: "client_site_url", reference: "https://brand.example" },
      referenceUrl: "https://brand.example",
      themeWarnings: [],
    },
  });
  const tokens = resolveStyleTokens(styleProfile);
  assert.equal(tokens.decorativePrimary, primary, `${name} keeps the extracted primary`);
  assert.equal(tokens.decorativeSecondary, secondary, `${name} keeps the extracted secondary`);
  assert.equal(tokens.decorativeTertiary, secondary, `${name} extracted accent is replaced by secondary`);
  assert.equal(tokens.compositions.light.primary, primary, `${name} uses primary for light-page accents`);
  assert.equal(tokens.compositions.light.background, tokens.background, `${name} defaults to the light composition`);
  assert.equal(tokens.compositions.dark.text, "#FFFFFF", `${name} uses white text on dark feature pages`);
  assert.equal(tokens.compositions.split.text, tokens.compositions.dark.text, `${name} split cover inherits the dark content system`);
  assert.ok(
    testContrastRatio(tokens.compositions.light.text, tokens.compositions.light.background) >= 4.75,
    `${name} light-page text remains accessible`,
  );
  assert.ok(
    testContrastRatio(tokens.compositions.dark.text, tokens.compositions.dark.background) >= 4.75,
    `${name} dark-page text remains accessible`,
  );
  const css = referenceDrivenStyles(styleProfile);
  assert.ok(css.includes(`--kp-brand-primary:${primary}`), `${name} primary CSS token`);
  assert.ok(css.includes(`--kp-brand-secondary:${secondary}`), `${name} secondary CSS token`);
  assert.ok(css.includes(`--kp-brand-accent:${secondary}`), `${name} secondary replaces accent CSS token`);
  assert.ok(css.includes('.page[data-page-composition="light"],.kp-page[data-page-composition="light"]{'), `${name} light composition CSS`);
  assert.ok(css.includes('.page[data-page-composition="dark"],.kp-page[data-page-composition="dark"]{'), `${name} dark composition CSS`);
  assert.ok(css.includes('.page[data-page-composition="split"],.kp-page[data-page-composition="split"]{'), `${name} split composition CSS`);
  assert.ok(!css.includes(".page:nth-child(even),.kp-page:nth-child(even)"), `${name} page colors are not selected by parity`);
  assert.ok(css.includes("background:var(--kp-page-background);color:var(--kp-page-text);break-after:page"), `${name} page resolves its own text color`);
  assert.ok(css.includes(".team-amount{font-weight:700}"), `${name} role amounts retain numeric emphasis`);
  assert.ok(css.includes(".team-cost-total{grid-column:5;text-align:right}"), `${name} team total aligns with the amount column`);
  assert.ok(css.includes(".viz-mindmap .viz-node-domain") && css.includes("background:var(--kp-page-surface)"), `${name} diagram labels use an opaque contrast-tested surface`);
}

const uzumContrastTokens = resolveStyleTokens({
  canvas: {},
  accents: {
    decorativePrimary: "#7000FF",
    decorativeSecondary: "#00C853",
  },
  typography: {},
});
assert.equal(uzumContrastTokens.compositions.light.background, "#FFFFFF");
assert.equal(uzumContrastTokens.compositions.light.primary, "#7000FF");
assert.equal(uzumContrastTokens.compositions.light.text, "#7000FF");
assert.equal(uzumContrastTokens.compositions.dark.background, "#7000FF");
assert.equal(uzumContrastTokens.compositions.dark.primary, "#00C853");
for (const surface of [
  uzumContrastTokens.compositions.light.background,
  uzumContrastTokens.compositions.light.surface,
  uzumContrastTokens.compositions.light.surface2,
]) {
  assert.ok(
    testContrastRatio(uzumContrastTokens.compositions.light.text, surface) >= 4.75,
    `Uzum purple text remains accessible on white-page surface ${surface}`,
  );
}

const texnomartCompositionTokens = resolveStyleTokens({
  canvas: {
    background: "#FFFFFF",
    surface1: "#F7F7F7",
    surface2: "#FFF9E8",
    textPrimary: "#333333",
    textSecondary: "#646464",
    rule: "#E2E2E2",
  },
  accents: {
    decorativePrimary: "#FBC100",
    decorativeSecondary: "#000000",
  },
  typography: {},
});
assert.equal(texnomartCompositionTokens.compositions.light.text, "#000000");
assert.equal(texnomartCompositionTokens.compositions.light.rule, "#E2E2E2");
assert.equal(texnomartCompositionTokens.compositions.light.primary, "#FBC100");
assert.equal(texnomartCompositionTokens.compositions.dark.background, "#000000");
assert.equal(texnomartCompositionTokens.compositions.dark.text, "#FFFFFF");
assert.equal(texnomartCompositionTokens.compositions.dark.primary, "#FBC100");
assert.equal(texnomartCompositionTokens.compositions.dark.secondary, "#FBC100");

const fallback = udevsFallbackTheme();
const fallbackProfile = normalizeV5StyleProfile(null, { referenceMode: "none" });
assert.equal(fallbackProfile.accents.decorativePrimary, fallback.decorativePrimary);
assert.equal(fallbackProfile.accents.decorativeSecondary, fallback.decorativeSecondary);
assert.equal(fallbackProfile.accents.decorativeTertiary, fallback.decorativeTertiary);
assert.equal(fallbackProfile.canvas.background, "#FFFFFF");
assert.equal(fallbackProfile.canvas.textPrimary, "#0A0A0F");
assert.equal(fallbackProfile.canvas.mode, "light");
assert.equal(fallbackProfile.layout.backgroundStyle, "udevs_screenshot");

const screenshotProfile = applyUdevsScreenshotVisualSystem({
  schemaVersion: "1.0",
  profileId: "VSP-EXPLICIT",
  canvas: { background: "#7000FF", textPrimary: "#FFFFFF" },
  accents: { decorativePrimary: "#7000FF", decorativeSecondary: "#00FF66" },
  typography: { displayStack: "Arial, sans-serif" },
  layout: { families: ["cover_asymmetric"], density: "balanced" },
  warnings: [],
});
assert.equal(screenshotProfile.profileId, "VSP-EXPLICIT");
assert.equal(screenshotProfile.typography.displayStack, "Arial, sans-serif");
assert.equal(screenshotProfile.accents.decorativePrimary, "#1A54FE");
assert.equal(screenshotProfile.accents.decorativeSecondary, "#0A0A0F");
assert.equal(screenshotProfile.canvas.background, "#FFFFFF");
assert.equal(screenshotProfile.layout.backgroundStyle, "udevs_screenshot");
const screenshotTokens = resolveStyleTokens(screenshotProfile);
assert.equal(screenshotTokens.backgroundStyle, "udevs_screenshot");
assert.equal(screenshotTokens.compositions.light.text, "#0A0A0F");
assert.equal(screenshotTokens.compositions.light.primary, "#1A54FE");
const screenshotCss = referenceDrivenStyles(screenshotProfile);
assert.ok(screenshotCss.includes(".page.background-udevs-screenshot"));
assert.ok(screenshotCss.includes("data:image/png;base64,"));
assert.ok(screenshotCss.includes('[data-page-kind="cover"]'));
assert.ok(screenshotCss.includes("@page{size:15in 10in;margin:0}"));
assert.ok(screenshotCss.includes("-webkit-print-color-adjust:exact;print-color-adjust:exact"));
assert.ok(screenshotCss.includes("@media print{html,body{width:15in!important;min-width:15in!important"));
assert.ok(screenshotCss.includes("height:10in!important;min-height:10in!important;max-height:10in!important"));
const printShadowResetIndex = screenshotCss.lastIndexOf("@media print{.proposal>.page");
assert.ok(printShadowResetIndex > screenshotCss.lastIndexOf("box-shadow:0 6px"));
assert.ok(screenshotCss.slice(printShadowResetIndex).includes("{box-shadow:none!important}"));
assert.ok(screenshotCss.includes(".payment-head,.payment-row{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(150px,.7fr) minmax(170px,.8fr)"));
assert.ok(screenshotCss.includes(".payment-head>span:not(:first-child){text-align:right}"));
assert.ok(screenshotCss.includes(".roadmap-stage-layout{width:100%;height:100%;min-height:0"));
assert.ok(screenshotCss.includes(".roadmap-workstream-label{display:grid;grid-template-columns:22px minmax(0,1fr) 42px"));
assert.ok(screenshotCss.includes(".roadmap-workstream-label>strong{min-width:0;margin:0;font-size:9px;line-height:1.05;white-space:normal;overflow-wrap:anywhere}"));
assert.ok(screenshotCss.includes(".roadmap-workstream-bar{position:absolute;z-index:2;top:50%;height:18px"));

const teamCostAllocation = teamCostPlan({
  hasProjectPrice: false,
  hasClientBudget: true,
  clientBudgetMinor: 10_000_001,
}, {
  rows: [
    { role: "PM", peakFte: 1, fteMonths: 1 },
    { role: "Engineering", peakFte: 1, fteMonths: 2 },
    { role: "QA", peakFte: 2, fteMonths: 4 },
  ],
});
assert.equal(teamCostAllocation.totalMinor, 10_000_001);
assert.equal(teamCostAllocation.rows.reduce((sum, row) => sum + row.amountMinor, 0), 10_000_001);
assert.deepEqual(teamCostAllocation.rows.map((row) => row.activeMonths), [1, 2, 2]);
assert.ok(teamCostAllocation.rows.every((row) => Number.isSafeInteger(row.rateMinor) && row.rateMinor > 0));

const fullFunctionInventory = Array.from({ length: 15 }, (_, index) => ({
  epic: index < 5 ? "Core product" : index < 10 ? "Operations" : "Delivery",
  task: `Function ${index + 1}`,
  subtask: index === 0
    ? "Product architecture and backlog"
    : index === 1
      ? "Catalog, categories and search"
      : index === 14
        ? "QA, release and handover"
        : `Implementation scope ${index + 1}`,
}));
const unlimitedFunctionRows = taskListRows({
  duration_months: 3,
  grounded_brief: { sourceLanguage: "ru" },
  scope: fullFunctionInventory,
});
assert.equal(unlimitedFunctionRows.length, 15);
assert.equal(unlimitedFunctionRows[0][3], "3 нед.");
assert.equal(unlimitedFunctionRows[1][3], "3 нед.");
assert.equal(unlimitedFunctionRows[14][3], "3 нед.");
const explicitScheduleRows = taskListRows({
  duration_months: 4,
  grounded_brief: { sourceLanguage: "ru" },
  scope: [{ epic: "Core", task: "Catalog", subtask: "Catalog delivery", durationWeeks: 8 }],
});
assert.equal(explicitScheduleRows[0][3], "8 нед.");
const aiAssistedIntegrationRows = taskListRows({
  duration_months: 3,
  grounded_brief: { sourceLanguage: "ru" },
  scope: [{ epic: "Integrations", task: "Bank integration", subtask: "API callbacks and webhooks" }],
});
const traditionalIntegrationRows = taskListRows({
  duration_months: 3,
  ai_assisted_delivery: false,
  grounded_brief: { sourceLanguage: "ru" },
  scope: [{ epic: "Integrations", task: "Bank integration", subtask: "API callbacks and webhooks" }],
});
assert.equal(aiAssistedIntegrationRows[0][3], "5 нед.");
assert.equal(traditionalIntegrationRows[0][3], "7 нед.");

const productMapScope = Array.from({ length: 14 }, (_, index) => ({
  id: `SCOPE-${index + 1}`,
  epic: `Domain ${Math.floor(index / 2) + 1}`,
  feature: `Function ${index + 1}`,
  detail: `Function ${index + 1} detail`,
  truthStatus: "recommended",
}));
assert.equal(buildProductMapSegments({ project: { name: "Product" }, scopeItems: productMapScope }).length, 1);

function productMapSegmentTerminalRows(segment) {
  return segment.branches.reduce((total, branch) => total + branch.functions.reduce(
    (branchTotal, item) => branchTotal + Math.max(1, Array.isArray(item.details) ? item.details.length : 0),
    0,
  ), 0);
}

function productMapSegmentNodeCount(segment) {
  return 1 + segment.branches.length + segment.branches.reduce((total, branch) => total + branch.functions.reduce(
    (branchTotal, item) => branchTotal + 1 + (Array.isArray(item.details) ? item.details.length : 0),
    0,
  ), 0);
}

function assertProductMapSegmentContract(segments) {
  assert.ok(segments.length >= 1);
  for (const [index, segment] of segments.entries()) {
    assert.equal(segment.segmentIndex, index + 1);
    assert.equal(segment.segmentCount, segments.length);
    assert.ok(segment.branches.length <= 8, `product-map segment ${index + 1} exceeds 8 branches`);
    assert.ok(productMapSegmentTerminalRows(segment) <= 16, `product-map segment ${index + 1} exceeds 16 terminal rows`);
    assert.ok(productMapSegmentNodeCount(segment) <= 42, `product-map segment ${index + 1} exceeds 42 visible nodes`);
  }
}

const compoundDetailSemanticModel = {
  project: { name: "Compound-detail product" },
  scopeItems: [{
    id: "SCOPE-COMPOUND-1",
    epic: "Catalog",
    feature: "Catalog discovery",
    detail: "Search, filters and saved views",
    phase: "3 weeks",
    truthStatus: "recommended",
  }],
};
const compoundDetailProductMap = buildProductMapModel(compoundDetailSemanticModel);
assert.equal(compoundDetailProductMap.branches.length, 1);
assert.equal(compoundDetailProductMap.branches[0].functions.length, 1);
assert.deepEqual(
  compoundDetailProductMap.branches[0].functions[0].details.map((item) => item.label),
  ["Search", "filters", "saved views"],
);
const compoundDeliveryInventory = buildProductDeliveryInventory(compoundDetailSemanticModel);
assert.equal(compoundDeliveryInventory.length, 3);
assert.deepEqual(
  compoundDeliveryInventory.map((row) => row.subfunctionLabel),
  ["Search", "filters", "saved views"],
);
assert.ok(compoundDeliveryInventory.every((row) => row.epic === "Catalog"));
assert.ok(compoundDeliveryInventory.every((row) => row.functionLabel === "Catalog discovery"));
assert.ok(compoundDeliveryInventory.every((row) => row.deadline === "3 weeks" && row.phase === "3 weeks"));
assert.equal(new Set(compoundDeliveryInventory.map((row) => row.id)).size, compoundDeliveryInventory.length);
assert.deepEqual(
  compoundDeliveryInventory.map((row) => row.id),
  ["SUB-SCOPE-COMPOUND-1-DETAIL-1", "SUB-SCOPE-COMPOUND-1-DETAIL-2", "SUB-SCOPE-COMPOUND-1-DETAIL-3"],
);
assert.deepEqual(
  compoundDeliveryInventory.map((row) => row.subfunctionId),
  ["SCOPE-COMPOUND-1-DETAIL-1", "SCOPE-COMPOUND-1-DETAIL-2", "SCOPE-COMPOUND-1-DETAIL-3"],
);
assert.equal(localizeRendererText("Categories", "ru-RU"), "Категории");
assert.equal(localizeRendererText("listings", "ru-RU"), "объявления");
assert.equal(localizeRendererText("product cards", "uz-Latn"), "mahsulot kartalari");
assert.equal(localizeRendererText("Business logic", "ru-RU"), "Бизнес-логика");
assert.equal(localizeRendererText("service endpoints", "uz-Latn"), "servis nuqtalari");
assertProductMapSegmentContract(buildProductMapSegments(compoundDetailSemanticModel));

const normalizedDeliveryScope = normalizeScopeItems([{
  id: "SCOPE-NORMALIZED-DEADLINE",
  epic: "Catalog",
  feature: "Catalog discovery",
  detail: "Search, filters",
  deadline: "4 weeks",
  truthStatus: "recommended",
}]);
assert.equal(normalizedDeliveryScope[0].phase, "4 weeks");
assert.ok(buildProductDeliveryInventory({ scopeItems: normalizedDeliveryScope }).every((row) => row.deadline === "4 weeks"));

const terminalFunctionInventory = buildProductDeliveryInventory({
  project: { name: "Terminal function product" },
  scopeItems: [{
    id: "SCOPE-TERMINAL-1",
    epic: "Operations",
    feature: "Operations workspace",
    phase: "Month 2",
    truthStatus: "recommended",
    sourceIds: ["SRC-BRIEF"],
    derivationRuleId: "SCOPE-MODEL-V1",
  }],
});
assert.deepEqual(terminalFunctionInventory, [{
  id: "CAP-SCOPE-TERMINAL-1",
  epic: "Operations",
  functionId: "SCOPE-TERMINAL-1",
  functionLabel: "Operations workspace",
  subfunctionId: null,
  subfunctionLabel: "Operations workspace",
  deadline: "Month 2",
  phase: "Month 2",
  truthStatus: "recommended",
  inclusion: undefined,
  sourceIds: ["SRC-BRIEF"],
  derivationRuleId: "SCOPE-MODEL-V1",
  dataRef: "/scopeItems/0",
  sourceEntityIds: ["SCOPE-TERMINAL-1"],
}]);

const nineDomainSemanticModel = {
  project: { name: "Nine-domain product" },
  scopeItems: Array.from({ length: 9 }, (_, index) => ({
    id: `SCOPE-DOMAIN-${index + 1}`,
    epic: `Domain ${index + 1}`,
    feature: `Domain function ${index + 1}`,
    truthStatus: "recommended",
  })),
};
const nineDomainSegments = buildProductMapSegments(nineDomainSemanticModel);
assert.equal(nineDomainSegments.length, 2);
assertProductMapSegmentContract(nineDomainSegments);
assert.deepEqual(
  nineDomainSegments.flatMap((segment) => segment.branches.map((branch) => branch.label)),
  nineDomainSemanticModel.scopeItems.map((item) => item.epic),
);

const balancedProductMapScope = Array.from({ length: 17 }, (_, index) => ({
  id: `SCOPE-BALANCED-${index + 1}`,
  epic: "Core capabilities",
  feature: `Balanced function ${index + 1}`,
  truthStatus: "recommended",
}));
const balancedProductMapSegments = buildProductMapSegments({ project: { name: "Balanced product" }, scopeItems: balancedProductMapScope });
assert.equal(balancedProductMapSegments.length, 2);
assert.deepEqual(
  balancedProductMapSegments.map(productMapSegmentTerminalRows).sort((left, right) => left - right),
  [8, 9],
);
assertProductMapSegmentContract(balancedProductMapSegments);
assert.deepEqual(
  balancedProductMapSegments.flatMap((segment) => segment.branches.flatMap((branch) => branch.functions.map((item) => item.label))),
  balancedProductMapScope.map((item) => item.feature),
);

const structuredDetailLabels = Array.from({ length: 20 }, (_, index) => `Structured detail ${index + 1}`);
const structuredDetailSemanticModel = {
  project: { name: "Structured-detail product" },
  scopeItems: [{
    id: "SCOPE-STRUCTURED-1",
    epic: "Operations",
    feature: "Operations workspace",
    details: structuredDetailLabels.map((label, index) => index % 2
      ? { id: `DETAIL-${index + 1}`, label }
      : label),
    truthStatus: "recommended",
  }],
};
const structuredDetailSegments = buildProductMapSegments(structuredDetailSemanticModel);
assert.equal(structuredDetailSegments.length, 2);
assertProductMapSegmentContract(structuredDetailSegments);
const renderedStructuredDetailLabels = structuredDetailSegments.flatMap((segment) => segment.branches.flatMap(
  (branch) => branch.functions.flatMap((item) => item.details.map((detail) => detail.label)),
));
assert.deepEqual(renderedStructuredDetailLabels, structuredDetailLabels);
assert.deepEqual(
  [...new Set(renderedStructuredDetailLabels)],
  structuredDetailLabels,
);
const structuredDetailSpecs = structuredDetailSegments.map((_, index) => buildProductMapSpec({
  semanticModel: structuredDetailSemanticModel,
  requestId: "UNIT-PRODUCT-MAP",
  pageNumber: index + 2,
  segmentIndex: index + 1,
  segmentCount: structuredDetailSegments.length,
}));
for (const [index, spec] of structuredDetailSpecs.entries()) {
  assert.equal(spec.variant, "left_to_right_tree");
  assert.equal(spec.segmentIndex, index + 1);
  assert.equal(spec.segmentCount, structuredDetailSpecs.length);
  assert.equal(spec.nodes.filter((node) => node.type === "core").length, 1);
  assert.equal(spec.nodes.filter((node) => node.type === "domain").length, 1);
  assert.equal(spec.nodes.filter((node) => node.type === "capability").length, 1);
  assert.ok(spec.nodes.length <= 42);
  assert.ok(spec.edges.length <= 41);
}
const structuredDetailSpecValidation = await validateVisualizationSpecs({
  specs: structuredDetailSpecs,
  semanticModel: structuredDetailSemanticModel,
  presentationPlan: {
    pages: structuredDetailSpecs.map((spec) => ({
      pageNumber: spec.pageNumber,
      kind: "product_map",
      visualizationSpecId: spec.visualizationSpecId,
    })),
  },
});
assert.equal(
  structuredDetailSpecValidation.ok,
  true,
  JSON.stringify(structuredDetailSpecValidation.findings, null, 2),
);
assert.deepEqual(
  structuredDetailSpecs.flatMap((spec) => spec.nodes.filter((node) => node.type === "subfunction").map((node) => node.fullLabel)),
  structuredDetailLabels,
);
assert.throws(
  () => buildProductMapSpec({
    semanticModel: structuredDetailSemanticModel,
    requestId: "UNIT-PRODUCT-MAP",
    pageNumber: 2,
    segmentIndex: 1,
    segmentCount: structuredDetailSegments.length + 1,
  }),
  (error) => error?.code === "CONTRACT_VISUALIZATION_SPEC_INVALID",
);

const detailedDeliverySemanticModel = {
  ...structuredDetailSemanticModel,
  scopeItems: structuredDetailSemanticModel.scopeItems.map((row) => ({ ...row, phase: "4 weeks" })),
  roadmap: {
    timeScale: { unit: "week", start: 1, end: 12 },
    phases: [
      { id: "PHASE-1", label: "Foundation", time: { unit: "week", start: 1, end: 4 }, inclusion: "recommended", truthStatus: "assumed", derivationRuleId: "UNIT-ROADMAP-V1" },
      { id: "PHASE-2", label: "Implementation", time: { unit: "week", start: 5, end: 8 }, inclusion: "recommended", truthStatus: "assumed", derivationRuleId: "UNIT-ROADMAP-V1" },
      { id: "PHASE-3", label: "Stabilization", time: { unit: "week", start: 9, end: 12 }, inclusion: "recommended", truthStatus: "assumed", derivationRuleId: "UNIT-ROADMAP-V1" },
    ],
    dependencies: [],
  },
};
const detailedDeliveryInventory = buildProductDeliveryInventory(detailedDeliverySemanticModel);
const roadmapSegments = buildRoadmapWorkstreamSegments(detailedDeliverySemanticModel);
assert.deepEqual(roadmapSegments.map((rows) => rows.length), [10, 10]);
const roadmapSpecs = roadmapSegments.map((_, index) => buildRoadmapSpec({
  semanticModel: detailedDeliverySemanticModel,
  requestId: "UNIT-ROADMAP",
  pageNumber: index + 20,
  segmentIndex: index + 1,
  segmentCount: roadmapSegments.length,
}));
assert.deepEqual(
  roadmapSpecs.flatMap((spec) => spec.nodes.filter((node) => node.type === "task").map((node) => node.id)),
  detailedDeliveryInventory.map((row) => row.id),
);
assert.ok(roadmapSpecs.every((spec) => spec.nodes.filter((node) => node.type === "phase").length === 3));
assert.ok(roadmapSpecs.every((spec) => spec.nodes.filter((node) => node.type === "task").length <= ROADMAP_WORKSTREAM_PAGE_LIMIT));
const detailedTaskStarts = roadmapSpecs.flatMap((spec) => spec.nodes.filter((node) => node.type === "task").map((node) => node.time.start));
assert.ok(new Set(detailedTaskStarts).size >= 3, "Roadmap tasks should be staggered across implementation waves");
assert.ok(Math.max(...detailedTaskStarts) > Math.min(...detailedTaskStarts));
const roadmapSpecValidation = await validateVisualizationSpecs({
  specs: roadmapSpecs,
  semanticModel: detailedDeliverySemanticModel,
  presentationPlan: {
    pages: roadmapSpecs.map((spec) => ({
      pageNumber: spec.pageNumber,
      kind: "roadmap",
      visualizationSpecId: spec.visualizationSpecId,
    })),
  },
});
assert.equal(roadmapSpecValidation.ok, true, JSON.stringify(roadmapSpecValidation.findings, null, 2));

const explicitlyScheduledRoadmap = {
  project: { name: "Scheduled product" },
  scopeItems: [
    { id: "SCOPE-M1", epic: "Foundation", feature: "Discovery", phase: "Month 1", truthStatus: "recommended" },
    { id: "SCOPE-M23", epic: "Core", feature: "Implementation", phase: "2–3 месяца", truthStatus: "recommended" },
    { id: "SCOPE-M3", epic: "Delivery", feature: "Release", phase: "3-й месяц", truthStatus: "recommended" },
  ],
  roadmap: detailedDeliverySemanticModel.roadmap,
};
const explicitlyScheduledSpec = buildRoadmapSpec({
  semanticModel: explicitlyScheduledRoadmap,
  requestId: "UNIT-ROADMAP-EXPLICIT",
  pageNumber: 30,
});
assert.deepEqual(
  explicitlyScheduledSpec.nodes.filter((node) => node.type === "task").map((node) => node.time),
  [
    { unit: "week", start: 1, end: 4, derived: true },
    { unit: "week", start: 5, end: 12, derived: true },
    { unit: "week", start: 9, end: 12, derived: true },
  ],
);

const detailedMarketplaceProposal = {
  requestId: "KP-BPMN-DENSE",
  title: "Платформа маркетплейса",
  brief: {
    projectName: "Платформа маркетплейса",
    type: "маркетплейс",
    prompt: "Подготовить BPMN основного пользовательского процесса",
    locale: "ru-RU",
  },
  scope: [
    { id: "SCOPE-BPMN-1", epic: "Каталог", feature: "Каталог и карточка товара", detail: "Поиск и выбор товара", truthStatus: "recommended" },
    { id: "SCOPE-BPMN-2", epic: "Заказы", feature: "Оформление и исполнение заказа", detail: "Корзина, оплата, доставка и возврат", truthStatus: "recommended" },
  ],
};
const detailedMarketplaceSemanticModel = buildProposalSemanticModel(detailedMarketplaceProposal, {
  requestId: detailedMarketplaceProposal.requestId,
  locale: "ru-RU",
});
await validateProposalSemanticModel(detailedMarketplaceSemanticModel);
assert.equal(detailedMarketplaceSemanticModel.actors.length, 4);
assert.equal(detailedMarketplaceSemanticModel.tasks.length, 18);
assert.equal(detailedMarketplaceSemanticModel.decisions.length, 4);
assert.equal(detailedMarketplaceSemanticModel.events.length, 11);
assert.equal(detailedMarketplaceSemanticModel.processRelations.length, 33);
assert.equal(primaryFlowSegmentCount(detailedMarketplaceSemanticModel), 4);
assert.deepEqual(detailedMarketplaceSemanticModel.processes.map((process) => process.nodeRefs.length), [10, 8, 9, 8]);
assert.deepEqual(detailedMarketplaceSemanticModel.processes.map((process) => process.relationIds.length), [9, 7, 8, 9]);
const marketplacePrototypeSpec = await buildAndValidateAppPrototypeSpec({
  requestId: detailedMarketplaceProposal.requestId,
  publicId: "AbCdEf1234",
  locale: "ru-RU",
  proposalModel: detailedMarketplaceProposal,
  semanticModel: detailedMarketplaceSemanticModel,
  visualStyleProfile: {
    accents: { primary: "#1A54FE", secondary: "#0A0A0F" },
    canvas: { background: "#F6F7F8", surface1: "#FFFFFF" },
  },
});
assert.equal(marketplacePrototypeSpec.project.type, "marketplace");
assert.equal(marketplacePrototypeSpec.screens.length, 55);
assert.equal(marketplacePrototypeSpec.navigation.length, 6);
assert.ok(marketplacePrototypeSpec.screens.some((screen) => screen.id === "catalog"));
assert.ok(marketplacePrototypeSpec.screens.some((screen) => screen.id === "checkout"));
assert.equal(
  new Set(marketplacePrototypeSpec.navigation.flatMap((group) => group.screenIds)).size,
  marketplacePrototypeSpec.screens.length,
);
const marketplacePrototypeHtml = renderAppPrototypeHtml(marketplacePrototypeSpec);
assert.ok(marketplacePrototypeHtml.includes("data-screen=\"catalog\""));
assert.ok(marketplacePrototypeHtml.includes("grid-template-columns:repeat(5,1fr)"));
assert.ok(marketplacePrototypeHtml.includes("#4C3FA8 0%,#2A2570 55%,#221E5E 100%"));
assert.ok(marketplacePrototypeHtml.includes("class=\"ui-button primary\""));
assert.equal(/(?:file:\/\/|\/Users\/|\/tmp\/)/.test(marketplacePrototypeHtml), false);

const ecommerceDealPrompt = `Составь коммерческое предложение (КП) для клиента на основе данных сделки.
Сделка: Сайфулло
Компания: Udevs
Сайт компании: https://udevs.io/
Бюджет: 123 USD
Тип проекта: E-commerce`;
const ecommerceBrief = parseKpBrief(ecommerceDealPrompt);
assert.equal(ecommerceBrief.productCategory.value, "E-commerce product");
assert.deepEqual(getDomainResearchPacks(ecommerceDealPrompt).map((pack) => pack.key), ["ecommerce"]);
const ecommercePrototypeSpec = await buildAndValidateAppPrototypeSpec({
  requestId: "KP-ECOMMERCE-EXPLICIT",
  publicId: "Ecommerce123",
  locale: "ru-RU",
  proposalModel: {
    title: "Сайфулло",
    brief: { projectName: "Сайфулло", type: ecommerceBrief.productCategory.value, prompt: ecommerceDealPrompt },
  },
  semanticModel: {
    project: { name: "Сайфулло", category: ecommerceBrief.productCategory.value },
    scopeItems: [{ id: "ECOM-1", feature: "Каталог и оформление заказа", detail: "Интернет-магазин" }],
    actors: [],
  },
});
assert.equal(ecommercePrototypeSpec.project.type, "ecommerce");
assert.ok(ecommercePrototypeSpec.screens.some((screen) => screen.id === "admin_catalog"));
assert.ok(ecommercePrototypeSpec.screens.some((screen) => screen.id === "checkout"));
assert.equal(ecommercePrototypeSpec.screens.some((screen) => screen.id === "seller_workspace"), false);
assert.equal(ecommercePrototypeSpec.screens.some((screen) => screen.id === "pipeline"), false);

const erpDealPrompt = `Составь коммерческое предложение (КП) для клиента на основе данных сделки.
Сделка: Сайфулло
Компания: Udevs
Сайт компании: https://udevs.io/
Бюджет: 123 USD
Тип проекта: ERP`;
const erpBrief = parseKpBrief(erpDealPrompt);
assert.equal(erpBrief.productCategory.value, "ERP / operations platform");
assert.deepEqual(getDomainResearchPacks(erpDealPrompt).map((pack) => pack.key), ["erp"]);
const erpPrototypeSpec = await buildAndValidateAppPrototypeSpec({
  requestId: "KP-ERP-EXPLICIT",
  publicId: "ErpSystem123",
  locale: "ru-RU",
  proposalModel: {
    title: "Сайфулло",
    brief: { projectName: "Сайфулло", type: "CRM / operations platform", prompt: erpDealPrompt },
  },
  semanticModel: {
    project: { name: "Сайфулло", category: "CRM / operations platform" },
    scopeItems: [{ id: "ERP-1", feature: "Сделки и данные клиента", detail: "Управление операциями" }],
    actors: [],
  },
});
assert.equal(erpPrototypeSpec.project.type, "erp");
assert.ok(erpPrototypeSpec.screens.some((screen) => screen.id === "purchase_orders"));
assert.ok(erpPrototypeSpec.screens.some((screen) => screen.id === "inventory"));
assert.ok(erpPrototypeSpec.screens.some((screen) => screen.id === "finance_dashboard"));
assert.equal(erpPrototypeSpec.screens.some((screen) => screen.id === "pipeline"), false);

const explicitProjectTypeCases = [
  { declaredType: "CRM", category: "CRM / operations platform", family: "crm", pack: "crm", screen: "pipeline", forbidden: "purchase_orders" },
  { declaredType: "ERP", category: "ERP / operations platform", family: "erp", pack: "erp", screen: "purchase_orders", forbidden: "pipeline" },
  { declaredType: "Marketplace", category: "Marketplace product", family: "marketplace", pack: "marketplace", screen: "seller_workspace", forbidden: "admin_catalog" },
  { declaredType: "SaaS", category: "SaaS product", family: "saas", pack: "saas", screen: "subscription_checkout", forbidden: "pipeline" },
  { declaredType: "E-commerce", category: "E-commerce product", family: "ecommerce", pack: "ecommerce", screen: "admin_catalog", forbidden: "seller_workspace" },
  { declaredType: "Mobile App", category: "Mobile product", family: "mobile-app", pack: "mobile-app", screen: "app_permissions", forbidden: "pipeline" },
  { declaredType: "Website", category: "Web product", family: "website", pack: "website", screen: "cms_pages", forbidden: "pipeline" },
  { declaredType: "Other", category: "Custom software product", family: "business-app", pack: null, screen: "workspace", forbidden: "pipeline" },
  { declaredType: "TMS", category: "TMS / logistics platform", family: "tms", pack: "tms", screen: "dispatch_board", forbidden: "pipeline" },
];

for (const [index, projectTypeCase] of explicitProjectTypeCases.entries()) {
  const prompt = `Составь коммерческое предложение (КП) для клиента на основе данных сделки.
Сделка: Сайфулло
Компания: Udevs
Сайт компании: https://udevs.io/
Бюджет: 123 USD
Тип проекта: ${projectTypeCase.declaredType}`;
  const brief = parseKpBrief(prompt);
  assert.equal(brief.productCategory.value, projectTypeCase.category, projectTypeCase.declaredType);
  assert.deepEqual(
    getDomainResearchPacks(prompt).map((pack) => pack.key),
    projectTypeCase.pack ? [projectTypeCase.pack] : [],
    projectTypeCase.declaredType,
  );
  const spec = await buildAndValidateAppPrototypeSpec({
    requestId: `KP-TYPE-MATRIX-${index + 1}`,
    publicId: `TypeMatrix${index + 1}X`,
    locale: "ru-RU",
    proposalModel: {
      title: "Сайфулло",
      brief: { projectName: "Сайфулло", type: projectTypeCase.category, prompt: prompt.replace(/\s+/g, " ") },
    },
    semanticModel: {
      project: { name: "Сайфулло", category: "CRM / operations platform" },
      scopeItems: [{ id: `TYPE-${index + 1}`, feature: "Сделки и клиенты", detail: "Управление процессом" }],
      actors: [],
    },
  });
  assert.equal(spec.project.type, projectTypeCase.family, projectTypeCase.declaredType);
  assert.ok(spec.screens.length >= 48 && spec.screens.length <= 60, projectTypeCase.declaredType);
  assert.ok(spec.screens.some((screen) => screen.id === projectTypeCase.screen), projectTypeCase.declaredType);
  assert.equal(spec.screens.some((screen) => screen.id === projectTypeCase.forbidden), false, projectTypeCase.declaredType);
  assert.equal(
    new Set(spec.navigation.flatMap((group) => group.screenIds)).size,
    spec.screens.length,
    projectTypeCase.declaredType,
  );
  assert.ok(renderAppPrototypeHtml(spec).includes(`data-screen="${projectTypeCase.screen}"`), projectTypeCase.declaredType);
}

const crmPrototypeSpec = await buildAndValidateAppPrototypeSpec({
  requestId: "KP-CRM-PAYMENT-TERMS",
  publicId: "CrmType1234",
  locale: "ru-RU",
  proposalModel: {
    title: "CRM-платформа для отдела продаж",
    brief: { projectName: "CRM", type: "CRM", prompt: "CRM с оплатой счетов и клиентской базой" },
  },
  semanticModel: {
    project: { name: "CRM-платформа" },
    scopeItems: [{ id: "CRM-PAY", feature: "Оплата счета", detail: "Платеж клиента" }],
    actors: [],
  },
});
assert.equal(crmPrototypeSpec.project.type, "crm");
assert.equal(crmPrototypeSpec.screens.length, 55);
assert.ok(crmPrototypeSpec.screens.some((screen) => screen.id === "pipeline"));
assert.equal(crmPrototypeSpec.screens.find((screen) => screen.id === "onboarding")?.content.layout, "onboarding");
assert.equal(crmPrototypeSpec.screens.find((screen) => screen.id === "pipeline")?.content.layout, "kanban");
assert.equal(crmPrototypeSpec.screens.find((screen) => screen.id === "calendar")?.content.layout, "calendar");
assert.equal(crmPrototypeSpec.screens.find((screen) => screen.id === "permissions")?.content.layout, "permission-matrix");
assert.equal(crmPrototypeSpec.screens.find((screen) => screen.id === "integrations")?.content.layout, "integration-grid");
assert.equal(crmPrototypeSpec.screens.find((screen) => screen.id === "leads")?.content.items[0].title, "Азиза Каримова");
const crmContentSignatures = crmPrototypeSpec.screens.map((screen) => JSON.stringify({
  layout: screen.content.layout,
  metrics: screen.content.metrics,
  items: screen.content.items,
  fields: screen.content.fields,
  steps: screen.content.steps,
  tabs: screen.content.tabs,
  chart: screen.content.chart,
}));
assert.ok(new Set(crmContentSignatures).size / crmPrototypeSpec.screens.length >= 0.8);
const crmPrototypeHtml = renderAppPrototypeHtml(crmPrototypeSpec);
assert.ok(crmPrototypeHtml.includes("class=\"kanban-board\""));
assert.ok(crmPrototypeHtml.includes("class=\"calendar-card\""));
assert.ok(crmPrototypeHtml.includes("class=\"permission-list\""));

const nonMarketplaceOrderModel = buildProposalSemanticModel({
  requestId: "KP-BPMN-NON-MARKETPLACE",
  title: "CRM для отдела продаж",
  brief: { projectName: "CRM", type: "CRM", prompt: "Управление заказами клиентов", locale: "ru-RU" },
  scope: [{ id: "CRM-1", epic: "Продажи", feature: "Управление заказами клиентов", detail: "Внутренний реестр", truthStatus: "recommended" }],
}, { requestId: "KP-BPMN-NON-MARKETPLACE", locale: "ru-RU" });
assert.equal(nonMarketplaceOrderModel.actors.length, 0);
assert.equal(nonMarketplaceOrderModel.processes.length, 0);

const detailedMarketplacePlan = buildPresentationPlan({
  requestId: detailedMarketplaceProposal.requestId,
  proposalModel: detailedMarketplaceProposal,
  semanticModel: detailedMarketplaceSemanticModel,
  visualStyleProfile: {},
});
const detailedFlowPages = detailedMarketplacePlan.pages.filter((page) => page.kind === "primary_flow");
assert.equal(detailedFlowPages.length, 4);
assert.deepEqual(detailedFlowPages.map((page) => page.segmentIndex), [1, 2, 3, 4]);
assert.ok(detailedFlowPages.every((page) => page.segmentCount === 4));
const detailedFlowSpecs = detailedFlowPages.map((page) => buildPrimaryFlowSpec({
  semanticModel: detailedMarketplaceSemanticModel,
  requestId: detailedMarketplaceProposal.requestId,
  pageNumber: page.pageNumber,
  segmentIndex: page.segmentIndex,
  segmentCount: page.segmentCount,
}));
const incompleteMarketplaceModel = JSON.parse(JSON.stringify(detailedMarketplaceSemanticModel));
incompleteMarketplaceModel.processRelations = incompleteMarketplaceModel.processRelations.filter((row) => row.id !== "REL-MP-33");
const segmentedQuestionsFallback = buildPrimaryFlowSpec({
  semanticModel: incompleteMarketplaceModel,
  requestId: detailedMarketplaceProposal.requestId,
  pageNumber: detailedFlowPages[3].pageNumber,
  segmentIndex: 4,
  segmentCount: 4,
});
assert.equal(segmentedQuestionsFallback.variant, "questions");
assert.equal(segmentedQuestionsFallback.segmentIndex, 4);
assert.equal(segmentedQuestionsFallback.segmentCount, 4);
assert.deepEqual(detailedFlowSpecs.map((spec) => spec.nodes.length), [10, 8, 9, 8]);
assert.deepEqual(detailedFlowSpecs.map((spec) => spec.edges.length), [9, 7, 8, 9]);
assert.ok(detailedFlowSpecs.every((spec) => spec.variant === "swimlane"));
assert.deepEqual(detailedFlowSpecs.map((spec) => spec.nodes.filter((node) => node.type === "gateway").length), [1, 1, 0, 2]);
assert.ok(detailedFlowSpecs.every((spec) => spec.nodes.filter((node) => node.type === "task").length >= 4));
assert.deepEqual(detailedFlowSpecs.map((spec) => spec.groups.length), [2, 3, 4, 3]);
for (const spec of detailedFlowSpecs) {
  const geometry = validateLayoutGeometry(layoutVisualization(spec, { width: 1296, height: 646 }));
  assert.equal(geometry.ok, true, JSON.stringify(geometry.findings, null, 2));
}
const detailedFlowValidation = await validateVisualizationSpecs({
  specs: detailedFlowSpecs,
  proposalModel: detailedMarketplaceProposal,
  semanticModel: detailedMarketplaceSemanticModel,
  presentationPlan: {
    pages: detailedFlowPages.map((page, index) => ({
      pageNumber: page.pageNumber,
      kind: "primary_flow",
      visualizationSpecId: detailedFlowSpecs[index].visualizationSpecId,
      segmentIndex: page.segmentIndex,
      segmentCount: page.segmentCount,
    })),
  },
});
assert.equal(detailedFlowValidation.ok, true, JSON.stringify(detailedFlowValidation.findings, null, 2));
assert.ok(screenshotCss.includes(".semantic-layout-bpmn{justify-content:flex-start;gap:8px}"));
assert.ok(screenshotCss.includes(".viz-bpmn-node{padding:8px 9px"));
assert.ok(screenshotCss.includes("font-size:12.5px"));

const pendingCommercialDecisions = selectDynamicPageDecisions({
  groundedBrief: {
    budget: {
      amount: { status: "unknown", truthStatus: "unknown", value: null },
      currency: { status: "unknown", truthStatus: "unknown", value: null },
    },
  },
  functionPrice: [{
    id: "FP-PENDING-1",
    epic: "Catalog",
    name: "Product catalog",
    detail: "Categories and product cards",
    deadline: "Month 1",
    total: 0,
    truthStatus: "recommended",
  }],
  payments: [],
}, {
  scopeItems: [{
    id: "SCOPE-PENDING-1",
    epic: "Catalog",
    feature: "Product catalog",
    inclusion: "recommended",
    truthStatus: "recommended",
  }],
});
const pendingFunctionPriceDecision = pendingCommercialDecisions.find((row) => row.kind === "function_price");
const pendingPaymentsDecision = pendingCommercialDecisions.find((row) => row.kind === "payments");
assert.equal(pendingFunctionPriceDecision.include, true);
assert.equal(pendingFunctionPriceDecision.fallbackMode, "transparent_model");
assert.ok(pendingFunctionPriceDecision.reasons.includes("functional_schedule_available_cost_inputs_pending"));
assert.equal(pendingPaymentsDecision.include, true);
assert.equal(pendingPaymentsDecision.fallbackMode, "transparent_model");
assert.ok(pendingPaymentsDecision.reasons.includes("payment_schedule_inputs_pending"));

const budgetCommercialDecisions = selectDynamicPageDecisions({
  groundedBrief: {
    budget: {
      amount: { status: "explicit", truthStatus: "explicit", value: 100_000 },
      currency: { status: "explicit", truthStatus: "explicit", value: "USD" },
    },
  },
  functionPrice: [
    { id: "FP-BUDGET-1", name: "Catalog", total: 60_000, truthStatus: "assumed" },
    { id: "FP-BUDGET-2", name: "Checkout", total: 40_000, truthStatus: "assumed" },
  ],
  payments: [
    { id: "PAY-BUDGET-1", name: "Kickoff", amount: 50_000, truthStatus: "assumed" },
    { id: "PAY-BUDGET-2", name: "Acceptance", amount: 50_000, truthStatus: "assumed" },
  ],
}, {
  scopeItems: [
    { id: "SCOPE-BUDGET-1", feature: "Catalog", truthStatus: "recommended" },
    { id: "SCOPE-BUDGET-2", feature: "Checkout", truthStatus: "recommended" },
  ],
});
const budgetFunctionPriceDecision = budgetCommercialDecisions.find((row) => row.kind === "function_price");
const budgetPaymentsDecision = budgetCommercialDecisions.find((row) => row.kind === "payments");
assert.ok(budgetFunctionPriceDecision.reasons.includes("reconciled_function_planning_scenario_available"));
assert.ok(!budgetFunctionPriceDecision.reasons.includes("functional_schedule_available_cost_inputs_pending"));
assert.ok(budgetPaymentsDecision.reasons.includes("budget_based_payment_scenario_available"));
assert.ok(!budgetPaymentsDecision.reasons.includes("payment_schedule_inputs_pending"));

const aiDomainProfile = normalizeV5StyleProfile(null, {
  referenceMode: "none",
  analogTheme: {
    themeTokens: {
      brand: "#7000FF",
      primary: "#7000FF",
      secondary: "#00FF66",
      canvas: "#7000FF",
      surface1: "#7712F4",
      surface2: "#6431CC",
      textPrimary: "#FFFFFF",
      textSecondary: "#FFFFFF",
      rule: "#00FF66",
      decorativePrimary: "#7000FF",
      decorativeSecondary: "#00FF66",
      decorativeTertiary: "#00FF66",
    },
    themeSource: {
      kind: "ai_domain_fallback",
      reference: "https://uzum.uz",
      paletteSelection: { mode: "ai_domain_fallback", confidence: 0.91 },
    },
    referenceUrl: "https://uzum.uz",
    themeWarnings: ["Direct site access was blocked."],
  },
});
assert.equal(aiDomainProfile.status, "fallback_partial");
assert.equal(aiDomainProfile.accents.decorativePrimary, "#7000FF");
assert.equal(aiDomainProfile.accents.decorativeSecondary, "#00FF66");
assert.equal(aiDomainProfile.provenance[0].sourceKind, "ai_domain_fallback");
console.log("Standalone KP agent unit checks PASS");

function testContrastRatio(left, right) {
  const luminance = (hex) => {
    const channels = [1, 3, 5]
      .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05);
}
