import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AGENT_ROOT, enterAgentRoot } from "./root.mjs";

enterAgentRoot();

let enginePromise;

async function engine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import("../scripts/kp_reference_contracts.mjs"),
      import("../scripts/kp_reference_runtime.mjs"),
      import("../scripts/kp_reference_store.mjs"),
      import("../scripts/kpi_pdf_client.mjs"),
    ]).then(([contracts, runtime, store, pdf]) => ({ contracts, runtime, store, pdf }));
  }
  return enginePromise;
}

export function agentConfig(env = process.env) {
  return {
    ...env,
    KP_PDF_RENDERER_MODE: env.KP_PDF_RENDERER_MODE || "v5",
    KP_PDF_ENABLE_V5_PRODUCTION: env.KP_PDF_ENABLE_V5_PRODUCTION || "1",
    KP_PDF_POLICY_GENERATION: env.KP_PDF_POLICY_GENERATION || "2",
    KP_PDF_ROLLOUT_EPOCH: env.KP_PDF_ROLLOUT_EPOCH || "STANDALONE-KP-AGENT",
    KP_PDF_EXPECTED_PAGES: env.KP_PDF_EXPECTED_PAGES || "0",
    KP_PDF_EXPECTED_RATIO: env.KP_PDF_EXPECTED_RATIO || "1.5",
    KP_PDF_QUALITY_GATE_MODE: env.KP_PDF_QUALITY_GATE_MODE || "enforce",
    KP_PDF_DISABLE_REFERENCED_GENERATION: env.KP_PDF_DISABLE_REFERENCED_GENERATION || "0",
    KP_DISABLE_WEB_RESEARCH: env.KP_DISABLE_WEB_RESEARCH || "1",
    KP_REFERENCE_VISION_PROVIDER: env.KP_REFERENCE_VISION_PROVIDER || "openai",
    KP_REFERENCE_VISION_MODEL: env.KP_REFERENCE_VISION_MODEL || "gpt-4.1-mini",
    KP_DYNAMIC_COLOR_PALETTES_ENABLED: env.KP_DYNAMIC_COLOR_PALETTES_ENABLED || "0",
    KP_REFERENCE_PALETTE_AI_ENABLED: env.KP_REFERENCE_PALETTE_AI_ENABLED || "1",
    KP_REFERENCE_PALETTE_AI_PROVIDER: env.KP_REFERENCE_PALETTE_AI_PROVIDER || "auto",
    KP_REFERENCE_PALETTE_AI_MODEL: env.KP_REFERENCE_PALETTE_AI_MODEL || "",
    KP_REFERENCE_PALETTE_AI_MIN_CONFIDENCE: env.KP_REFERENCE_PALETTE_AI_MIN_CONFIDENCE || "0.55",
    KP_REFERENCE_PALETTE_AI_TIMEOUT_MS: env.KP_REFERENCE_PALETTE_AI_TIMEOUT_MS || "20000",
  };
}

export async function generateProposal(input = {}, hooks = {}) {
  enterAgentRoot();
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw codeError("KP_AGENT_PROMPT_REQUIRED", "prompt is required", 400);
  const locale = normalizeLocale(input.locale);
  const { contracts, runtime, store, pdf } = await engine();
  const requestId = contracts.createRequestId(new Date(), crypto.randomBytes(6).toString("hex"));
  const paletteOverride = typeof input.dynamicColorPalettesEnabled === "boolean"
    ? { KP_DYNAMIC_COLOR_PALETTES_ENABLED: input.dynamicColorPalettesEnabled ? "1" : "0" }
    : {};
  const env = agentConfig({ ...process.env, ...(input.env || {}), ...paletteOverride });
  const requestTemp = path.join(AGENT_ROOT, "tmp", "requests", requestId);
  const outputRoot = path.resolve(input.outputRoot || path.join(AGENT_ROOT, "reports", "agent-kp"));
  await fs.mkdir(requestTemp, { recursive: true });
  const referencePaths = await materializeReferences(input, requestTemp);
  if (referencePaths.length && !env.OPENAI_API_KEY && env.KP_REFERENCE_VISION_PROVIDER === "openai") {
    throw codeError("KP_AGENT_VISION_KEY_REQUIRED", "OPENAI_API_KEY is required when visual references are supplied", 400);
  }

  const sessionKey = store.buildReferenceSessionKey({ chatId: `api-${requestId}`, userId: "standalone", threadId: 0 });
  const storeRoot = path.join(requestTemp, "reference-sessions");
  const requestContext = {
    schemaVersion: "1.0",
    requestId,
    channel: "direct_api",
    receivedAt: new Date().toISOString(),
    locale,
    timezone: String(input.timezone || "Asia/Tashkent"),
    transport: {
      chatType: "direct_api",
      chatId: `api-${requestId}`,
      userId: String(input.userId || "standalone"),
      messageId: 0,
      messageThreadId: 0,
      mediaGroupId: null,
      replyToMessageId: null,
    },
    routing: {
      chatIdHash: contracts.sha256Digest(`api-${requestId}`),
      canaryBucket: 1,
      rendererSelectionReason: "standalone_agent",
      referenceModeHint: referencePaths.length ? "explicit_full" : "none",
    },
  };

  let storedEvidenceBundle = {
    schemaVersion: "1.0",
    requestId,
    items: [],
    selectionTrace: { mode: "none", rulesApplied: ["no_reference_supplied"] },
  };
  let prepared = {
    requestContext,
    storedEvidenceBundle,
    manifest: null,
    captures: [],
    analyses: [],
    visualStyleProfile: null,
    referenceBaseDir: null,
  };

  if (referencePaths.length) {
    const ingested = await store.ingestReferenceItems(
      sessionKey,
      referencePaths.map((filePath, index) => ({
        storedPath: filePath,
        fileName: path.basename(filePath),
        mimeType: mimeForPath(filePath),
        text: prompt,
        caption: prompt,
        instruction: prompt,
        messageId: index + 1,
        uploaderUserId: "standalone",
      })),
      { storeRoot },
    );
    storedEvidenceBundle = await store.selectStoredEvidenceBundle(sessionKey, requestContext, {
      storeRoot,
      currentAssetIds: ingested.added.map((asset) => asset.assetId),
      instruction: prompt,
      assumeImageVisualStyle: true,
    });
    prepared = await runtime.prepareKpReferenceArtifacts({
      question: prompt,
      requestContext,
      storedEvidenceBundle,
      sessionKey,
      storeRoot,
      runtimeRoot: path.join(requestTemp, "reference-runtime"),
      env,
      progress: hooks.onProgress || (async () => {}),
    });
  }

  const renderStyleProfile = normalizeProfileContrast(prepared.visualStyleProfile);

  const result = await pdf.buildKpiPdfReport(prompt, hooks.onProgress || (async () => {}), {
    outputDir: outputRoot,
    env,
    requestContext: prepared.requestContext,
    storedEvidenceBundle,
    manifest: prepared.manifest,
    captures: prepared.captures,
    analyses: prepared.analyses,
    visualStyleProfile: renderStyleProfile,
    referenceBaseDir: prepared.referenceBaseDir,
    skipWebResearch: input.skipWebResearch !== false,
    enableLlmSynthesis: input.enableLlmSynthesis === true,
  });

  const requestedOutput = input.outputPath ? path.resolve(String(input.outputPath)) : "";
  const documentPath = requestedOutput || result.documentPath;
  if (requestedOutput) {
    await fs.mkdir(path.dirname(requestedOutput), { recursive: true });
    await fs.copyFile(result.documentPath, requestedOutput);
  }
  return {
    ok: true,
    requestId,
    title: result.meta?.title || null,
    html: result.html || null,
    documentPath,
    sourceDocumentPath: result.documentPath,
    qaStatus: result.meta?.qaStatus || null,
    pageCount: result.meta?.pageCount || null,
    rendererVersion: result.meta?.rendererVersion || null,
    workspace: result.meta?.workspace || null,
    qaReportPath: result.meta?.qaReportPath || null,
    referenceMode: storedEvidenceBundle.selectionTrace?.mode || "none",
    theme: {
      source: result.meta?.themeSource || null,
      referenceUrl: result.meta?.referenceUrl || "",
      palette: result.meta?.themeTokens || null,
      warnings: result.meta?.themeWarnings || [],
    },
  };
}

export function normalizeProfileContrast(profile) {
  if (!profile) return null;
  const normalized = JSON.parse(JSON.stringify(profile));
  const canvas = normalized.canvas || (normalized.canvas = {});
  const background = validHex(canvas.background) || "#FFFFFF";
  const lightCanvas = luminance(background) >= 0.5;
  const safeText = lightCanvas ? "#111827" : "#F8FAFC";
  const textPrimary = readableAgainst(validHex(canvas.textPrimary) || safeText, background, safeText, 4.75);
  const safeSurface1 = lightCanvas ? "#F5F7FA" : "#182033";
  const safeSurface2 = lightCanvas ? "#EEF2F8" : "#222B3D";
  const surface1 = readableSurface(validHex(canvas.surface1), textPrimary, safeSurface1);
  const surface2 = readableSurface(validHex(canvas.surface2), textPrimary, safeSurface2);
  canvas.background = background;
  canvas.surface1 = surface1;
  canvas.surface2 = surface2;
  canvas.textPrimary = textPrimary;
  canvas.textSecondary = [background, surface1, surface2].every((surface) => contrast(validHex(canvas.textSecondary) || safeText, surface) >= 4.5)
    ? validHex(canvas.textSecondary)
    : textPrimary;
  return normalized;
}

function readableSurface(candidate, text, fallback) {
  const surface = candidate || fallback;
  return contrast(text, surface) >= 4.75 ? surface : fallback;
}

function readableAgainst(candidate, background, fallback, minimum) {
  return contrast(candidate, background) >= minimum ? candidate : fallback;
}

function validHex(value) {
  const text = String(value || "").toUpperCase();
  return /^#[0-9A-F]{6}$/.test(text) ? text : "";
}

function contrast(left, right) {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function luminance(hex) {
  const safe = validHex(hex) || "#000000";
  const channels = [1, 3, 5].map((index) => Number.parseInt(safe.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

async function materializeReferences(input, requestTemp) {
  const paths = [];
  for (const rawPath of Array.isArray(input.referencePaths) ? input.referencePaths : []) {
    const absolute = path.resolve(String(rawPath));
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat?.isFile()) throw codeError("KP_AGENT_REFERENCE_NOT_FOUND", `Reference file not found: ${absolute}`, 400);
    paths.push(absolute);
  }
  const uploads = Array.isArray(input.references) ? input.references : [];
  if (uploads.length) await fs.mkdir(path.join(requestTemp, "uploads"), { recursive: true });
  for (const [index, reference] of uploads.entries()) {
    const data = String(reference?.dataBase64 || "");
    if (!data) throw codeError("KP_AGENT_REFERENCE_INVALID", `references[${index}].dataBase64 is required`, 400);
    const buffer = Buffer.from(data, "base64");
    if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw codeError("KP_AGENT_REFERENCE_INVALID", `references[${index}] must be 1 byte to 20 MB`, 400);
    const safeName = safeFileName(reference.fileName || `reference-${index + 1}${extensionForMime(reference.mimeType)}`);
    const filePath = path.join(requestTemp, "uploads", `${index + 1}-${safeName}`);
    await fs.writeFile(filePath, buffer);
    paths.push(filePath);
  }
  return [...new Set(paths)];
}

function normalizeLocale(value) {
  const locale = String(value || "uz-Latn");
  if (["uz-Latn", "ru-RU", "en"].includes(locale)) return locale;
  throw codeError("KP_AGENT_LOCALE_INVALID", "locale must be uz-Latn, ru-RU, or en", 400);
}

function mimeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".pdf") return "application/pdf";
  throw codeError("KP_AGENT_REFERENCE_TYPE_UNSUPPORTED", `Unsupported reference type: ${extension || "unknown"}`, 400);
}

function extensionForMime(mime = "") {
  return ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "application/pdf": ".pdf" })[String(mime).toLowerCase()] || ".bin";
}

function safeFileName(value) {
  return String(value || "reference.bin").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "reference.bin";
}

function codeError(code, message, httpStatus = 500) {
  return Object.assign(new Error(message), { code, httpStatus });
}
