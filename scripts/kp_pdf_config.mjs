import path from "node:path";

const PROJECT_ROOT = process.cwd();

export function resolveKpPdfConfig(env = process.env) {
  const config = {
    rendererMode: enumValue(env.KP_PDF_RENDERER_MODE || legacyRendererMode(env.KP_RENDERER_VERSION), ["legacy", "shadow", "canary", "v5"], "legacy", "KP_PDF_RENDERER_MODE"),
    canaryPercent: intRange(env.KP_PDF_CANARY_PERCENT, 0, 100, 0, "KP_PDF_CANARY_PERCENT"),
    referencedCanaryPercent: intRange(env.KP_PDF_REFERENCED_CANARY_PERCENT, 0, 100, 0, "KP_PDF_REFERENCED_CANARY_PERCENT"),
    disableReferencedGeneration: booleanFlag(env.KP_PDF_DISABLE_REFERENCED_GENERATION, "KP_PDF_DISABLE_REFERENCED_GENERATION"),
    outputRoot: safeOutputRoot(env.KP_PDF_OUTPUT_ROOT || "reports/agent-kp"),
    maxConcurrentGenerations: intRange(env.KP_PDF_MAX_CONCURRENT_GENERATIONS, 1, 4, 1, "KP_PDF_MAX_CONCURRENT_GENERATIONS"),
    maxQueuedGenerations: intRange(env.KP_PDF_MAX_QUEUED_GENERATIONS, 0, 100, 20, "KP_PDF_MAX_QUEUED_GENERATIONS"),
    maxWorkspaceBytes: intRange(env.KP_PDF_MAX_WORKSPACE_BYTES, 67_108_864, 1_073_741_824, 268_435_456, "KP_PDF_MAX_WORKSPACE_BYTES"),
    qualityGateMode: enumValue(env.KP_PDF_QUALITY_GATE_MODE, ["shadow", "enforce"], "shadow", "KP_PDF_QUALITY_GATE_MODE"),
    policyGeneration: intRange(env.KP_PDF_POLICY_GENERATION, 1, 2_147_483_647, 1, "KP_PDF_POLICY_GENERATION"),
    rolloutEpoch: tokenValue(env.KP_PDF_ROLLOUT_EPOCH, "LOCAL-DEV", "KP_PDF_ROLLOUT_EPOCH"),
    // 0 means that V5 derives the exact count from its presentation plan.
    expectedPageCount: intRange(env.KP_PDF_EXPECTED_PAGES, 0, 50, 0, "KP_PDF_EXPECTED_PAGES"),
    expectedAspectRatio: exactNumber(env.KP_PDF_EXPECTED_RATIO, 1.5, "KP_PDF_EXPECTED_RATIO"),
    maxPdfBytes: intRange(env.KP_PDF_MAX_BYTES, 1_048_576, 45_000_000, 45_000_000, "KP_PDF_MAX_BYTES"),
    keepFailedCandidate: booleanFlag(env.KP_PDF_KEEP_FAILED_CANDIDATE, "KP_PDF_KEEP_FAILED_CANDIDATE"),
    domReadyTimeoutMs: intRange(env.KP_PDF_DOM_READY_TIMEOUT_MS, 1_000, 120_000, 30_000, "KP_PDF_DOM_READY_TIMEOUT_MS"),
    renderTimeoutMs: intRange(env.KP_PDF_RENDER_TIMEOUT_MS, 1_000, 180_000, 60_000, "KP_PDF_RENDER_TIMEOUT_MS"),
    qaTimeoutMs: intRange(env.KP_PDF_QA_TIMEOUT_MS, 1_000, 180_000, 60_000, "KP_PDF_QA_TIMEOUT_MS"),
    totalTimeoutMs: intRange(env.KP_PDF_TOTAL_TIMEOUT_MS, 60_000, 600_000, 275_000, "KP_PDF_TOTAL_TIMEOUT_MS"),
    logLevel: enumValue(env.KP_PDF_LOG_LEVEL, ["debug", "info", "warn", "error"], "info", "KP_PDF_LOG_LEVEL"),
  };
  assertKpPdfPolicy(config);
  return Object.freeze(config);
}

export function redactedKpPdfConfig(config) {
  return Object.freeze({ ...config });
}

export function resolveKpPdfRendererMode(env = process.env) {
  return resolveKpPdfConfig(env).rendererMode;
}

export function resolveQualityPolicy(env = process.env) {
  const config = resolveKpPdfConfig(env);
  return Object.freeze({
    mode: config.qualityGateMode,
    expectedPageCount: config.expectedPageCount,
    expectedAspectRatio: config.expectedAspectRatio,
    maxPdfBytes: config.maxPdfBytes,
    keepFailedCandidate: config.keepFailedCandidate,
    policyGeneration: config.policyGeneration,
    rolloutEpoch: config.rolloutEpoch,
  });
}

export function assertKpPdfPolicy(config) {
  if (["shadow", "canary", "v5"].includes(config.rendererMode) && config.policyGeneration <= 1 && config.rolloutEpoch === "LOCAL-DEV") {
    throw configError("KP_PDF_POLICY_GENERATION", "must be explicitly incremented with KP_PDF_ROLLOUT_EPOCH for non-legacy renderer modes");
  }
  if (config.rendererMode === "legacy" && config.referencedCanaryPercent > 0) {
    throw configError("KP_PDF_REFERENCED_CANARY_PERCENT", "must be 0 in legacy renderer mode");
  }
  if (config.disableReferencedGeneration && config.referencedCanaryPercent > 0) {
    throw configError("KP_PDF_DISABLE_REFERENCED_GENERATION", "cannot be 1 while referenced canary percent is positive");
  }
  if (config.domReadyTimeoutMs >= config.totalTimeoutMs || config.renderTimeoutMs >= config.totalTimeoutMs || config.qaTimeoutMs >= config.totalTimeoutMs) {
    throw configError("KP_PDF_TOTAL_TIMEOUT_MS", "must be greater than individual DOM/render/QA timeouts");
  }
  return true;
}

function legacyRendererMode(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) return "";
  if (["v4", "legacy", "marketplace-dark-premium-v4"].includes(normalized)) return "legacy";
  if (["v5", "reference-driven-v5"].includes(normalized)) return "v5";
  return normalized;
}

function enumValue(value, allowed, fallback, name) {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!allowed.includes(normalized)) throw configError(name, `must be one of ${allowed.join(", ")}`);
  return normalized;
}

function intRange(value, min, max, fallback, name) {
  const number = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw configError(name, `must be integer ${min}..${max}`);
  return number;
}

function exactNumber(value, expected, name) {
  const number = value === undefined || value === "" ? expected : Number(value);
  if (!Number.isFinite(number) || Math.abs(number - expected) > 1e-12) throw configError(name, `must be exactly ${expected}`);
  return number;
}

function booleanFlag(value, name) {
  const normalized = String(value ?? "0").trim();
  if (!["0", "1"].includes(normalized)) throw configError(name, "must be 0 or 1");
  return normalized === "1";
}

function tokenValue(value, fallback, name) {
  const normalized = String(value || fallback).trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(normalized)) throw configError(name, "must match [A-Za-z0-9._-]{1,64}");
  return normalized;
}

function safeOutputRoot(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0")) throw configError("KP_PDF_OUTPUT_ROOT", "must be a non-empty path");
  const resolved = path.resolve(PROJECT_ROOT, raw);
  if (raw.split(/[\\/]+/).includes("..")) throw configError("KP_PDF_OUTPUT_ROOT", "must not contain .. components");
  return resolved;
}

function configError(name, message) {
  const error = new Error(`${name} ${message}`);
  error.code = "KP_CONFIG_INVALID";
  error.configKey = name;
  return error;
}
