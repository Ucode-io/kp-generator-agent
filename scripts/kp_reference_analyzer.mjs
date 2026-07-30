import { validateKpContract } from "./kp_reference_contracts.mjs";

const DEFAULT_ANALYSIS_VERSION = "analysis-v1";
const DEFAULT_PROMPT_VERSION = "reference-analysis-prompt-v1";
const DEFAULT_TIMEOUT_MS = 60_000;

export async function analyzeReferenceSource(source, capture, options = {}) {
  if (capture.status !== "complete" || !capture.samples?.length) {
    return failedAnalysis(source, capture, "KP_REF_PRIMARY_UNAVAILABLE", "Reference capture has no usable visual samples");
  }
  if (source.role === "logo_asset") {
    return analyzeAssetMetadata(source, capture);
  }
  const requiresVision = options.explicitFull !== false && ["visual_style", "brand_system"].includes(source.role);
  const providerConfig = resolveVisionProvider(options);
  if (options.provider || providerConfig.available) {
    const providerResult = await analyzeFramesWithProvider(capture.samples, source.instruction || "", options);
    if (providerResult.status !== "failed") return providerResult;
  }
  if (requiresVision && options.allowDeterministicForExplicitFull !== true) {
    return failedAnalysis(source, capture, "KP_REF_VISION_UNAVAILABLE", "Vision provider is unavailable for explicit composition reference");
  }
  return analyzeFramesDeterministically(capture.samples, { source, capture });
}

export async function analyzeReferenceCaptures(manifest, captures = [], options = {}) {
  const analyses = [];
  for (const capture of captures) {
    const source = (manifest.items || []).find((item) => item.id === capture.referenceId) || { id: capture.referenceId, role: "unknown" };
    const provider = options.providerFactory
      ? await options.providerFactory({ source, capture, manifest })
      : options.provider;
    const analysis = await analyzeReferenceSource(source, capture, {
      ...options,
      provider,
      explicitFull: manifest.referenceMode === "explicit_full",
    });
    analyses.push(analysis);
  }
  const primary = manifest.primaryVisualReferenceId;
  const primaryAnalysis = primary ? analyses.find((analysis) => analysis.referenceId === primary) : null;
  if (manifest.referenceMode === "explicit_full" && primary && (!primaryAnalysis || primaryAnalysis.status === "failed")) {
    const error = new Error("Primary visual reference analysis is unavailable");
    error.code = primaryAnalysis?.warnings?.[0]?.split(":")?.[0] || "KP_REF_PRIMARY_UNAVAILABLE";
    error.retryable = true;
    throw error;
  }
  if (manifest.referenceMode === "explicit_full" && !analyses.some((analysis) => ["complete", "partial"].includes(analysis.status))) {
    const error = new Error("No usable visual reference analysis was produced");
    error.code = "KP_REF_INSUFFICIENT_COVERAGE";
    error.retryable = true;
    throw error;
  }
  return analyses;
}

export async function analyzeFramesWithProvider(frames, instruction, options = {}) {
  const provider = options.provider || null;
  const providerConfig = resolveVisionProvider(options);
  if (!provider) return { status: "failed", failure: { code: "KP_REF_VISION_UNAVAILABLE", message: "No vision provider configured" } };
  let validationErrors = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const value = parseProviderValue(await provider({
      frames,
      instruction,
      attempt,
      validationErrors,
      provider: providerConfig.provider,
      model: providerConfig.model,
      promptVersion: options.promptVersion || DEFAULT_PROMPT_VERSION,
      timeoutMs: Number(options.timeoutMs || process.env.KP_REFERENCE_VISION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    }));
    if (!value.ok) {
      validationErrors = [{ path: "/", keyword: "json", message: value.error.message, params: {} }];
      continue;
    }
    const enriched = enrichAnalysisMetadata(value.value, providerConfig, options);
    const validation = await validateReferenceAnalysis(enriched, { throwOnError: false });
    if (validation.ok) return enriched;
    validationErrors = validation.errors;
  }
  return { status: "failed", failure: { code: "KP_REF_ANALYSIS_INVALID", message: "Vision provider returned invalid reference analysis" } };
}

export function analyzeFramesDeterministically(frames, options = {}) {
  const source = options.source || {};
  const capture = options.capture || {};
  const aspectRatio = median(frames.map((frame) => frame.width / Math.max(1, frame.height))) || 1.5;
  const rasterWhiteRatio = median(frames.map((frame) => frame.quality?.blankRatio ?? 0.3));
  const dark = frames.some((frame) => frame.kind === "logo") ? false : rasterWhiteRatio < 0.25;
  // Capture blankRatio is a near-white pixel ratio, not layout whitespace. On
  // a dark canvas it would otherwise report a dense 0% whitespace reference.
  const whitespace = dark ? 0.35 : rasterWhiteRatio;
  const analysis = {
    schemaVersion: "1.0",
    analysisId: `RAN-${source.id || capture.referenceId || "DET"}`,
    referenceId: source.id || capture.referenceId,
    captureId: capture.captureId || `RCAP-${source.id || "DET"}`,
    role: source.role || "visual_style",
    status: "partial",
    analyzerMode: "deterministic",
    provider: "deterministic",
    model: null,
    analyzerVersion: DEFAULT_ANALYSIS_VERSION,
    promptVersion: null,
    timeoutMs: null,
    sampledPages: frames.map((frame) => frame.pageNumber).filter(Boolean),
    frameIds: frames.map((frame) => frame.frameId),
    confidence: 0.58,
    aspectConfidence: {
      palette: 0.45,
      tone: 0.55,
      typography: 0.45,
      composition: 0.45,
      density: 0.5,
      geometry: 0.48,
      diagramLanguage: 0.45,
      imagery: 0.45,
    },
    palette: {
      background: [dark ? "#0A0A10" : "#FFFFFF"],
      foreground: [dark ? "#F2EFE6" : "#111827"],
      accents: ["#7C5CFF", "#D9A94E", "#F0705A"],
      semanticRoles: { control: "#7C5CFF", partner: "#D9A94E", risk: "#F0705A" },
    },
    typography: {
      displayClass: "neo_grotesk_sans",
      bodyClass: "humanist_sans",
      metadataClass: "monospace",
      displayWeight: 700,
      headingCase: "sentence",
      scale: whitespace > 0.55 ? "large_editorial" : "balanced",
      observedFamilies: [],
      safeFallbackFamilies: ["Arial", "sans-serif"],
    },
    layout: {
      aspectRatio,
      density: whitespace > 0.55 ? "sparse" : whitespace > 0.35 ? "restrained" : "balanced",
      alignment: "left_editorial",
      gridColumns: 12,
      outerMarginRatio: 0.05,
      whitespaceRatio: whitespace,
      dominantCompositions: ["editorial_split", "connected_graph"],
    },
    components: {
      cornerStyle: "soft_rounded",
      radiusRangePx: [8, 18],
      borderStyle: "thin_low_contrast",
      borderUsageRatio: 0.8,
      shadowStyle: "none",
      shadowUsageRatio: 0,
      tableStyle: "rules_not_boxes",
      canvasRelationshipRatio: 0.35,
      badgeStyle: "small_mono_pill",
    },
    diagramGrammar: {
      nodeStyle: "outlined_soft_rect",
      edgeStyle: "thin_orthogonal",
      coreStyle: "central_glow",
      groupStyle: "subtle_boundary",
      labelDensity: "low",
    },
    pageSilhouettes: frames.slice(0, 2).map((frame, index) => ({
      id: `SIL-${source.id || "DET"}-${String(index + 1).padStart(2, "0")}`,
      sourcePage: frame.pageNumber || 1,
      family: index === 0 ? "cover_asymmetric" : "editorial_split",
      regions: [
        { role: "headline", x: 0.044, y: 0.129, w: 0.50, h: 0.05 },
        { role: "content", x: 0.044, y: 0.244, w: 0.91, h: 0.70 },
      ],
      confidence: 0.5,
    })),
    imagery: { mode: "abstract_static", treatment: "low_contrast", photographyAllowed: false },
    doUse: ["deterministic spacing", "traceable frame evidence"],
    doNotUse: ["reference copy", "unlicensed artwork"],
    evidence: [{
      jsonPath: "/layout/whitespaceRatio",
      frameIds: frames.map((frame) => frame.frameId).slice(0, 3),
      confidence: 0.5,
      note: "Derived from rendered sample blank/useful-content ratios",
    }],
    warnings: ["deterministic_analysis_limited"],
  };
  return analysis;
}

export function analyzeAssetMetadata(source = {}, capture = {}) {
  const frames = capture.samples || [];
  const first = frames[0] || { width: 1, height: 1, frameId: "FRAME-LOGO-001" };
  return {
    schemaVersion: "1.0",
    analysisId: `RAN-${source.id || capture.referenceId || "ASSET"}`,
    referenceId: source.id || capture.referenceId,
    captureId: capture.captureId || `RCAP-${source.id || "ASSET"}`,
    role: source.role || "logo_asset",
    status: "partial",
    analyzerMode: "asset_metadata",
    provider: "asset_metadata",
    model: null,
    analyzerVersion: DEFAULT_ANALYSIS_VERSION,
    promptVersion: null,
    timeoutMs: null,
    sampledPages: frames.map((frame) => frame.pageNumber).filter(Boolean),
    frameIds: frames.map((frame) => frame.frameId),
    confidence: 0.62,
    aspectConfidence: { logo: 0.85, palette: 0.45, tone: 0.3 },
    palette: {
      background: ["#FFFFFF"],
      foreground: ["#111827"],
      accents: ["#7C5CFF"],
      semanticRoles: { control: "#7C5CFF" },
    },
    typography: {
      displayClass: "unknown",
      bodyClass: "unknown",
      metadataClass: "unknown",
      displayWeight: 400,
      headingCase: "mixed",
      scale: "balanced",
      observedFamilies: [],
      safeFallbackFamilies: ["Arial", "sans-serif"],
    },
    layout: {
      aspectRatio: first.width / Math.max(1, first.height),
      density: "restrained",
      alignment: "mixed",
      gridColumns: 12,
      outerMarginRatio: 0.05,
      whitespaceRatio: first.quality?.blankRatio ?? 0.4,
      dominantCompositions: [],
    },
    components: {},
    diagramGrammar: {},
    pageSilhouettes: [],
    imagery: { mode: "none", treatment: "none", photographyAllowed: false },
    doUse: ["logo placement", "logo contrast constraints"],
    doNotUse: ["logo as full composition reference"],
    evidence: [{
      jsonPath: "/aspectConfidence/logo",
      frameIds: frames.map((frame) => frame.frameId).slice(0, 1),
      confidence: 0.85,
      note: "Logo asset analyzed as metadata-only constraint",
    }],
    warnings: ["asset_metadata_analysis_limited"],
  };
}

export async function validateReferenceAnalysis(value, options = {}) {
  return validateKpContract("referenceAnalysis", value, options);
}

function failedAnalysis(source, capture, code, message) {
  return {
    schemaVersion: "1.0",
    analysisId: `RAN-${source.id || capture.referenceId || "FAILED"}`,
    referenceId: source.id || capture.referenceId,
    captureId: capture.captureId || `RCAP-${source.id || "FAILED"}`,
    role: source.role || "unknown",
    status: "failed",
    analyzerMode: "deterministic",
    provider: "none",
    model: null,
    analyzerVersion: DEFAULT_ANALYSIS_VERSION,
    promptVersion: null,
    timeoutMs: null,
    sampledPages: [],
    frameIds: [],
    confidence: 0,
    aspectConfidence: {},
    palette: { background: [], foreground: [], accents: [], semanticRoles: {} },
    typography: { displayClass: "unknown", bodyClass: "unknown", metadataClass: "unknown", displayWeight: 400, headingCase: "mixed", scale: "balanced", observedFamilies: [], safeFallbackFamilies: ["Arial", "sans-serif"] },
    layout: { aspectRatio: 1.5, density: "balanced", alignment: "mixed", gridColumns: 12, outerMarginRatio: 0.05, whitespaceRatio: 0.4, dominantCompositions: [] },
    components: {},
    diagramGrammar: {},
    pageSilhouettes: [],
    imagery: { mode: "none", treatment: "none", photographyAllowed: false },
    doUse: [],
    doNotUse: [],
    evidence: [],
    warnings: [`${code}: ${message}`],
  };
}

export function resolveVisionProvider(options = {}) {
  const provider = options.visionProvider || process.env.KP_REFERENCE_VISION_PROVIDER || "auto";
  const model = options.visionModel || process.env.KP_REFERENCE_VISION_MODEL || "";
  if (provider === "off") return { available: false, provider, model };
  if (options.provider) {
    return {
      available: true,
      provider: provider === "auto" ? "test" : provider,
      model: model || "fixture",
    };
  }
  if (!model) return { available: false, provider, model };
  if (provider === "openai" && process.env.OPENAI_API_KEY) return { available: true, provider, model };
  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) return { available: true, provider, model };
  return { available: false, provider, model };
}

function enrichAnalysisMetadata(value, providerConfig, options = {}) {
  return {
    ...value,
    provider: value.provider ?? providerConfig.provider,
    model: value.model ?? providerConfig.model,
    analyzerVersion: value.analyzerVersion ?? DEFAULT_ANALYSIS_VERSION,
    promptVersion: value.promptVersion ?? (options.promptVersion || DEFAULT_PROMPT_VERSION),
    timeoutMs: value.timeoutMs ?? Number(options.timeoutMs || process.env.KP_REFERENCE_VISION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

function parseProviderValue(value) {
  if (typeof value === "string") {
    try {
      return { ok: true, value: JSON.parse(value) };
    } catch (error) {
      return { ok: false, error };
    }
  }
  if (value && typeof value === "object") return { ok: true, value };
  return { ok: false, error: new Error("Provider response is not an object or JSON string") };
}

function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.floor(sorted.length / 2)];
}
