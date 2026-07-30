import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { captureManifestReferences, materializeSelectedEvidence } from "./kp_reference_capture.mjs";
import { analyzeReferenceCaptures } from "./kp_reference_analyzer.mjs";
import { mergeReferenceAnalyses, validateVisualStyleProfile } from "./kp_reference_merge.mjs";
import { loadActiveReferenceSet } from "./kp_reference_store.mjs";
import { persistReferenceArtifacts } from "./kp_visual_style_profile.mjs";

const DEFAULT_RUNTIME_ROOT = path.join(process.cwd(), "tmp", "kp-reference-runtime");
const DEFAULT_VISION_MODEL = "gpt-4.1-mini";

export async function prepareKpReferenceArtifacts({
  question = "",
  requestContext,
  storedEvidenceBundle,
  sessionKey,
  progress = async () => {},
  runtimeRoot = DEFAULT_RUNTIME_ROOT,
  storeRoot,
  providerFactory = null,
  env = process.env,
} = {}) {
  const mode = storedEvidenceBundle?.selectionTrace?.mode || "none";
  if (!["explicit_full", "explicit_partial"].includes(mode) || !storedEvidenceBundle?.items?.length) {
    return {
      requestContext,
      storedEvidenceBundle,
      manifest: null,
      captures: [],
      analyses: [],
      visualStyleProfile: null,
      referenceBaseDir: null,
      runtimeWorkspace: null,
    };
  }
  if (!requestContext?.requestId || storedEvidenceBundle.requestId !== requestContext.requestId) {
    throw codeError("CONTRACT_REQUEST_CONTEXT_INVALID", "KP reference request IDs do not match");
  }

  const referenceRequestContext = Object.freeze({
    ...requestContext,
    routing: {
      ...(requestContext.routing || {}),
      referenceModeHint: mode,
    },
  });
  const runtimeWorkspace = path.join(runtimeRoot, requestContext.requestId);
  await fs.rm(runtimeWorkspace, { recursive: true, force: true });
  await fs.mkdir(runtimeWorkspace, { recursive: true });

  await progress("KP reference: rasm immutable nusxaga olinmoqda.");
  const activeSet = sessionKey
    ? await loadActiveReferenceSet(sessionKey, storeRoot ? { storeRoot } : {})
    : { session: { assets: [] } };
  const assetById = Object.fromEntries(
    (activeSet.session?.assets || [])
      .filter((asset) => storedEvidenceBundle.items.some((item) => item.assetId === asset.assetId))
      .map((asset) => [asset.assetId, asset]),
  );
  const manifest = await materializeSelectedEvidence(storedEvidenceBundle, runtimeWorkspace, {
    assetById,
  });
  manifest.userInstruction = String(question || "").slice(0, 2000) || null;
  await fs.writeFile(
    path.join(runtimeWorkspace, "contracts", "evidence-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  await progress("KP reference: UI kompozitsiya va ranglar o‘qilyapti.");
  const captures = await captureManifestReferences(manifest, {
    requestWorkspace: runtimeWorkspace,
    maxVisualSources: Number(env.KP_REFERENCE_MAX_VISUAL_SOURCES || 8),
  });
  const effectiveProviderFactory = providerFactory || (({ source, capture }) => createOpenAiReferenceVisionProvider({
    source,
    capture,
    requestWorkspace: runtimeWorkspace,
    env,
  }));
  const analyses = await analyzeReferenceCaptures(manifest, captures, {
    providerFactory: effectiveProviderFactory,
    visionProvider: env.KP_REFERENCE_VISION_PROVIDER || "openai",
    visionModel: env.KP_REFERENCE_VISION_MODEL || DEFAULT_VISION_MODEL,
    timeoutMs: Number(env.KP_REFERENCE_VISION_TIMEOUT_MS || 60_000),
  });
  const visualStyleProfile = mergeReferenceAnalyses(manifest, analyses);
  await validateVisualStyleProfile(visualStyleProfile);
  await persistReferenceArtifacts(runtimeWorkspace, {
    captures,
    analyses,
    profile: visualStyleProfile,
  });

  return {
    requestContext: referenceRequestContext,
    storedEvidenceBundle,
    manifest,
    captures,
    analyses,
    visualStyleProfile,
    referenceBaseDir: runtimeWorkspace,
    runtimeWorkspace,
  };
}

export function createOpenAiReferenceVisionProvider({
  source,
  capture,
  requestWorkspace,
  env = process.env,
  client = null,
} = {}) {
  const model = env.KP_REFERENCE_VISION_MODEL || DEFAULT_VISION_MODEL;
  const apiKey = env.OPENAI_API_KEY;
  if (!client && !apiKey) {
    throw codeError("KP_REF_VISION_UNAVAILABLE", "OpenAI vision provider is not configured", true);
  }
  const openai = client || new OpenAI({ apiKey });

  return async function analyzeWithOpenAi({ frames = [], instruction = "", validationErrors = [] } = {}) {
    const sampledFrames = frames.slice(0, Number(env.KP_REFERENCE_VISION_MAX_FRAMES || 8));
    if (!sampledFrames.length) throw codeError("KP_REF_PRIMARY_UNAVAILABLE", "Reference has no captured frames", true);
    const imageParts = [];
    for (const frame of sampledFrames) {
      const imagePath = path.isAbsolute(frame.artifactPath)
        ? frame.artifactPath
        : path.join(requestWorkspace, frame.artifactPath);
      const buffer = await fs.readFile(imagePath);
      imageParts.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeForImage(imagePath)};base64,${buffer.toString("base64")}`,
          detail: "high",
        },
      });
    }
    const response = await openai.chat.completions.create({
      model,
      temperature: 0,
      max_completion_tokens: Number(env.KP_REFERENCE_VISION_MAX_TOKENS || 6000),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are a senior presentation design-system analyst.",
            "Return one JSON object only. Analyze visible design properties, never the source copy or business facts.",
            "If the image is a screenshot of Pinterest, a gallery, a phone, browser, or another app containing the real design reference, ignore the surrounding app chrome and analyze the embedded presentation/UI reference.",
            "Do not guess an exact font family from appearance. observedFamilies must be empty unless the family name is visibly written in the source.",
            "Use only these typography classes: neo_grotesk_sans, humanist_sans, geometric_sans, transitional_serif, display_serif, monospace, mixed, unknown.",
            "Use only these density values: sparse, restrained, balanced, dense.",
            "Use only these alignment values: left_editorial, centered, symmetric_grid, asymmetric_grid, mixed.",
            "Use only these scale values: compact, balanced, large_editorial, oversized.",
            "Use only these imagery modes: none, photography, illustration, abstract_static, texture, mixed.",
            "Use reusable page families where applicable: cover_asymmetric, chapter_opener, editorial_split, connected_graph, evidence_table, timeline, commercial_hero, decision_close.",
            "All colors must be six-digit hex values. Confidence values must be between 0 and 1.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: referenceAnalysisPrompt({
                source,
                capture,
                frames: sampledFrames,
                instruction,
                validationErrors,
              }),
            },
            ...imageParts,
          ],
        },
      ],
    });
    const raw = response.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      schemaVersion: "1.0",
      analysisId: `RAN-${source.id}`,
      referenceId: source.id,
      captureId: capture.captureId,
      role: source.role,
      status: "complete",
      analyzerMode: "vision_plus_deterministic",
      provider: "openai",
      model,
      sampledPages: sampledFrames.map((frame) => frame.pageNumber).filter(Number.isFinite),
      frameIds: sampledFrames.map((frame) => frame.frameId),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  };
}

function referenceAnalysisPrompt({ source = {}, capture = {}, frames = [], instruction = "", validationErrors = [] } = {}) {
  return [
    `Reference ID: ${source.id}`,
    `Reference role: ${source.role}`,
    `Capture ID: ${capture.captureId}`,
    `User instruction: ${instruction || source.instruction || "Use as visual style reference"}`,
    `Frame IDs: ${frames.map((frame) => frame.frameId).join(", ")}`,
    validationErrors.length
      ? `Previous JSON validation errors to fix: ${JSON.stringify(validationErrors).slice(0, 6000)}`
      : "",
    "",
    "Return every field below:",
    "{",
    '  "confidence": number,',
    '  "aspectConfidence": {"palette": number, "tone": number, "typography": number, "composition": number, "density": number, "geometry": number, "diagramLanguage": number, "imagery": number},',
    '  "palette": {"background": ["#RRGGBB"], "foreground": ["#RRGGBB"], "accents": ["#RRGGBB"], "semanticRoles": {"control": "#RRGGBB", "positive": "#RRGGBB", "warning": "#RRGGBB", "risk": "#RRGGBB"}},',
    '  "typography": {"displayClass": enum, "bodyClass": enum, "metadataClass": enum, "displayWeight": integer 100..950, "headingCase": "sentence|title|upper|lower|mixed", "scale": enum, "observedFamilies": [], "safeFallbackFamilies": ["Arial", "sans-serif"]},',
    '  "layout": {"aspectRatio": number 0.5..3, "density": enum, "alignment": enum, "gridColumns": integer 1..24, "outerMarginRatio": number 0..0.25, "whitespaceRatio": number 0..1, "dominantCompositions": ["family"]},',
    '  "components": {"cornerStyle": string, "radiusRangePx": [number, number], "borderStyle": string, "borderUsageRatio": number, "shadowStyle": string, "shadowUsageRatio": number, "tableStyle": string, "canvasRelationshipRatio": number, "badgeStyle": string},',
    '  "diagramGrammar": {"nodeStyle": string, "edgeStyle": string, "coreStyle": string, "groupStyle": string, "labelDensity": string},',
    '  "pageSilhouettes": [{"id": string, "sourcePage": 1, "family": string, "regions": [{"role": string, "x": number 0..1, "y": number 0..1, "w": number 0..1, "h": number 0..1}], "confidence": number}],',
    '  "imagery": {"mode": enum, "treatment": string, "photographyAllowed": boolean},',
    '  "doUse": [string],',
    '  "doNotUse": [string],',
    '  "evidence": [{"jsonPath": string, "frameIds": [string], "confidence": number, "note": string}],',
    '  "warnings": [string]',
    "}",
    "",
    "Focus on palette, typography class, whitespace, composition, component geometry, imagery treatment, and repeatable slide/page patterns.",
  ].filter(Boolean).join("\n");
}

function mimeForImage(filePath = "") {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

function codeError(code, message, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}
