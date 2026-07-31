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
  udevsFallbackTheme,
} from "../scripts/kpi_pdf_client.mjs";
import {
  referenceDrivenStyles,
  resolveStyleTokens,
} from "../scripts/kp_pdf_reference_renderer.mjs";
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
  assert.ok(css.includes(".team-month-cell.team-fte-level-4") && css.includes("color:var(--kp-page-text)"), `${name} heat-map text uses the page contrast token`);
  assert.ok(css.includes(".team-month-total.is-peak") && css.includes("color:var(--kp-page-text)"), `${name} peak total uses the page contrast token`);
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
