import { validateKpContract } from "./kp_reference_contracts.mjs";

const DEFAULT_FAMILIES = Object.freeze([
  "cover_asymmetric",
  "chapter_opener",
  "editorial_split",
  "connected_graph",
  "evidence_table",
  "timeline",
  "commercial_hero",
  "decision_close",
]);

const ROLE_ASPECT_WEIGHT = Object.freeze({
  theme_tokens: { palette: 1, typography: 0.9, composition: 0, density: 0, geometry: 0.3, diagramLanguage: 0, tone: 0.5, imagery: 0, logo: 0 },
  brand_system: { palette: 1, typography: 1, composition: 0.55, density: 0.55, geometry: 0.65, diagramLanguage: 0.5, tone: 0.85, imagery: 0.5, logo: 0.85 },
  visual_style: { palette: 0.75, typography: 0.75, composition: 1, density: 1, geometry: 1, diagramLanguage: 1, tone: 1, imagery: 1, logo: 0 },
  logo_asset: { palette: 0.65, typography: 0, composition: 0, density: 0, geometry: 0, diagramLanguage: 0, tone: 0.3, imagery: 0, logo: 1 },
  product_analog: { palette: 0, typography: 0, composition: 0, density: 0, geometry: 0, diagramLanguage: 0, tone: 0, imagery: 0, logo: 0 },
  unknown: { palette: 0, typography: 0, composition: 0, density: 0, geometry: 0, diagramLanguage: 0, tone: 0, imagery: 0, logo: 0 },
});

const ASPECT_AUTHORITY = Object.freeze({
  logo: ["logo_asset", "brand_system"],
  palette: ["theme_tokens", "brand_system", "visual_style", "logo_asset"],
  typography: ["brand_system", "visual_style", "theme_tokens"],
  composition: ["visual_style", "brand_system"],
  density: ["visual_style", "brand_system"],
  geometry: ["visual_style", "brand_system", "theme_tokens"],
  diagramLanguage: ["visual_style", "brand_system"],
  tone: ["visual_style", "brand_system", "theme_tokens", "logo_asset"],
  imagery: ["visual_style", "brand_system"],
});

export function mergeReferenceAnalyses(manifest, analyses = [], options = {}) {
  const usable = analyses.filter((analysis) => ["complete", "partial"].includes(analysis.status));
  const evidenceByReferenceId = new Map((manifest.items || []).map((item) => [item.id, item]));
  const candidates = usable.map((analysis) => ({
    analysis,
    item: evidenceByReferenceId.get(analysis.referenceId) || { id: analysis.referenceId, role: analysis.role || "unknown", aspectDeny: [], aspectAllow: [] },
    primary: analysis.referenceId === manifest.primaryVisualReferenceId,
  }));
  if (!candidates.length) return defaultProfile(manifest, ["no_usable_reference_analysis"]);

  const fallbackFields = [];
  const conflicts = [];
  const provenance = [];
  const warnings = [...(options.warnings || [])];
  const palette = selectAspect(candidates, "palette", (entry) => entry.analysis.palette, { fallbackFields, provenance, conflicts });
  const typography = selectAspect(candidates, "typography", (entry) => entry.analysis.typography, { fallbackFields, provenance, conflicts });
  const composition = selectAspect(candidates, "composition", (entry) => entry.analysis.layout, { fallbackFields, provenance, conflicts });
  const geometry = selectAspect(candidates, "geometry", (entry) => entry.analysis.components, { fallbackFields, provenance, conflicts });
  const diagram = selectAspect(candidates, "diagramLanguage", (entry) => entry.analysis.diagramGrammar, { fallbackFields, provenance, conflicts });
  const tone = selectAspect(candidates, "tone", (entry) => entry.analysis.layout, { fallbackFields, provenance, conflicts });

  const background = palette?.value?.background?.[0] || fallback("/canvas/background", fallbackFields, "#0A0A10");
  const foreground = palette?.value?.foreground?.[0] || fallback("/canvas/textPrimary", fallbackFields, "#F2EFE6");
  const accents = palette?.value?.accents || [];
  const primaryAccent = accents[0] || fallback("/accents/primary", fallbackFields, "#7C5CFF");
  if (palette?.value?.foreground?.[0]) mirrorProvenance(provenance, "/canvas/background", "/canvas/textPrimary");
  if (accents[0]) mirrorProvenance(provenance, "/canvas/background", "/accents/primary");
  const families = resolveLayoutFamilies(candidates, fallbackFields, provenance);
  const referenceFontStack = buildReferenceFontStack(typography?.value, "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif");
  const confidence = Math.min(1, Math.max(0.35, ...provenance.map((entry) => Number(entry.confidence || 0))));
  return {
    schemaVersion: "1.0",
    profileId: `VSP-${manifest.requestId.replace(/^KP-/, "")}`,
    status: manifest.referenceMode === "explicit_partial" ? "fallback_partial" : "reference_driven",
    referenceIds: unique(candidates.map((candidate) => candidate.analysis.referenceId)),
    confidence,
    canvas: {
      mode: luminanceMode(background),
      background,
      surface1: palette?.value?.background?.[1] || mixHex(background, foreground, luminanceMode(background) === "light" ? 0.035 : 0.08),
      surface2: palette?.value?.background?.[2] || mixHex(background, foreground, luminanceMode(background) === "light" ? 0.07 : 0.14),
      textPrimary: foreground,
      textSecondary: palette?.value?.foreground?.[1] || mixHex(foreground, background, 0.34),
      rule: mixHex(background, foreground, luminanceMode(background) === "light" ? 0.18 : 0.24),
    },
    accents: {
      primary: primaryAccent,
      secondary: accents[1] || mixHex(primaryAccent, background, 0.28),
      positive: palette?.value?.semanticRoles?.positive || primaryAccent,
      warning: palette?.value?.semanticRoles?.partner || accents[1] || mixHex(primaryAccent, foreground, 0.32),
      critical: palette?.value?.semanticRoles?.risk || accents[2] || mixHex(primaryAccent, foreground, 0.58),
    },
    typography: {
      displayStack: referenceFontStack,
      bodyStack: referenceFontStack,
      metadataStack: referenceFontStack,
      displayClass: typography?.value?.displayClass || fallback("/typography/displayClass", fallbackFields, "neo_grotesk_sans"),
      bodyClass: typography?.value?.bodyClass || fallback("/typography/bodyClass", fallbackFields, "humanist_sans"),
      scale: typography?.value?.scale || fallback("/typography/scale", fallbackFields, "balanced"),
    },
    layout: {
      families,
      density: tone?.value?.density || composition?.value?.density || fallback("/layout/density", fallbackFields, "balanced"),
      alignment: composition?.value?.alignment || fallback("/layout/alignment", fallbackFields, "left_editorial"),
      gridColumns: composition?.value?.gridColumns || fallback("/layout/gridColumns", fallbackFields, 12),
      whitespaceRatio: composition?.value?.whitespaceRatio ?? fallback("/layout/whitespaceRatio", fallbackFields, 0.4),
    },
    components: geometry?.value || fallback("/components", fallbackFields, {}),
    diagramGrammar: diagram?.value || fallback("/diagramGrammar", fallbackFields, {}),
    provenance,
    fallbackFields: unique(fallbackFields),
    conflicts,
    warnings,
  };
}

function buildReferenceFontStack(typography, fallback) {
  const supplied = unique([
    ...(Array.isArray(typography?.observedFamilies) ? typography.observedFamilies : []),
    ...(Array.isArray(typography?.safeFallbackFamilies) ? typography.safeFallbackFamilies : []),
  ])
    .map((family) => String(family || "").trim())
    .filter((family) => /^(?:[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}|-apple-system)$/.test(family))
    .slice(0, 8)
    .map((family) => /\s/.test(family) ? `"${family}"` : family);
  return supplied.length ? supplied.join(", ") : fallback;
}

export function resolveStyleField(candidates = [], authorityRule = () => 0) {
  return [...candidates].sort((a, b) => authorityRule(b) - authorityRule(a) || String(a.value).localeCompare(String(b.value)))[0] || null;
}

export async function validateVisualStyleProfile(profile, options = {}) {
  validateProfileLeafCoverage(profile);
  return validateKpContract("visualStyleProfile", profile, options);
}

export function validateProfileLeafCoverage(profile) {
  const covered = new Set([...(profile.provenance || []).map((entry) => entry.jsonPath), ...(profile.fallbackFields || [])]);
  for (const path of ["/canvas/background", "/canvas/textPrimary", "/accents/primary", "/typography/displayClass", "/layout/families", "/layout/density", "/components", "/diagramGrammar"]) {
    if (!covered.has(path) && !(path === "/layout/families" && (profile.provenance || []).some((entry) => entry.jsonPath === "/layout/families"))) {
      throw Object.assign(new Error(`Visual style profile leaf lacks provenance/fallback: ${path}`), { code: "KP_REF_PROFILE_INVALID", jsonPath: path });
    }
  }
  return true;
}

function selectAspect(candidates, aspect, getValue, context) {
  for (const role of ASPECT_AUTHORITY[aspect] || []) {
    const eligible = candidates
      .map((candidate) => scoreCandidate(candidate, aspect, getValue(candidate), role))
      .filter((candidate) => candidate && candidate.score >= 0.4);
    if (!eligible.length) continue;
    eligible.sort((a, b) => b.score - a.score || String(a.analysis.referenceId).localeCompare(String(b.analysis.referenceId)));
    const [winner, runnerUp] = eligible;
    if (runnerUp && Math.abs(winner.score - runnerUp.score) <= 0.15 * Math.max(winner.score, runnerUp.score)) {
      context.conflicts.push({ aspect, chosenReferenceId: winner.analysis.referenceId, rejectedReferenceId: runnerUp.analysis.referenceId, reason: "within_15_percent_authority_tiebreak" });
    }
    context.provenance.push({
      jsonPath: aspectToJsonPath(aspect),
      referenceId: winner.analysis.referenceId,
      analysisId: winner.analysis.analysisId,
      role: winner.item.role,
      confidence: round(winner.score),
      reason: winner.primary ? "primary_reference_aspect_authority" : "aspect_authority",
    });
    return winner;
  }
  context.fallbackFields.push(aspectToJsonPath(aspect));
  return null;
}

function scoreCandidate(candidate, aspect, value, requiredRole) {
  if (!value || candidate.item.role !== requiredRole) return null;
  if ((candidate.item.aspectDeny || []).includes(aspect)) return null;
  const roleWeight = ROLE_ASPECT_WEIGHT[candidate.item.role]?.[aspect] || 0;
  if (!roleWeight) return null;
  const reportedConfidence = Number(candidate.analysis.aspectConfidence?.[aspect] ?? candidate.analysis.confidence ?? 0);
  const analysisConfidence = aspect === "typography"
    && Array.isArray(candidate.analysis.typography?.observedFamilies)
    && candidate.analysis.typography.observedFamilies.length
    ? Math.max(reportedConfidence, 0.8)
    : reportedConfidence;
  const userMultiplier = candidate.primary && ["visual_style", "brand_system"].includes(candidate.item.role) ? 1.35 : 1;
  const score = roleWeight * Number(candidate.item.classificationConfidence || candidate.analysis.confidence || 0.35) * analysisConfidence * userMultiplier;
  return { ...candidate, value, score };
}

function resolveLayoutFamilies(candidates, fallbackFields, provenance) {
  const families = [];
  const eligible = candidates
    .map((candidate) => scoreCandidate(candidate, "composition", candidate.analysis.pageSilhouettes || [], "visual_style"))
    .filter((candidate) => candidate && candidate.score >= 0.4)
    .sort((a, b) => b.score - a.score || a.analysis.referenceId.localeCompare(b.analysis.referenceId));
  for (const candidate of eligible) {
    for (const family of (candidate.value || []).map((item) => item.family).filter(Boolean)) {
      if (!families.includes(family)) families.push(family);
      if (families.length >= 4) break;
    }
    if (families.length >= 4) break;
  }
  if (families.length) {
    provenance.push({ jsonPath: "/layout/families", referenceId: eligible[0].analysis.referenceId, analysisId: eligible[0].analysis.analysisId, confidence: round(eligible[0].score), reason: "reference_page_silhouettes" });
  } else {
    fallbackFields.push("/layout/families");
  }
  for (const family of DEFAULT_FAMILIES) {
    if (!families.includes(family)) families.push(family);
    if (families.length >= 5) break;
  }
  return families.slice(0, 8);
}

function defaultProfile(manifest, warnings = []) {
  return {
    schemaVersion: "1.0",
    profileId: `VSP-${manifest.requestId.replace(/^KP-/, "")}`,
    status: "fallback_default",
    referenceIds: [],
    confidence: 0.35,
    canvas: { mode: "dark", background: "#0A0A10", surface1: "#17141F", surface2: "#241B3D", textPrimary: "#F2EFE6", textSecondary: "#A39CAD", rule: "#342D42" },
    accents: { primary: "#7C5CFF", secondary: "#A78BFA", positive: "#4ED9A4", warning: "#D9A94E", critical: "#F0705A" },
    typography: { displayStack: "ui-sans-serif, Arial, sans-serif", bodyStack: "ui-sans-serif, Arial, sans-serif", metadataStack: "ui-monospace, monospace", displayClass: "neo_grotesk_sans", bodyClass: "humanist_sans", scale: "balanced" },
    layout: { families: DEFAULT_FAMILIES.slice(0, 5), density: "balanced", alignment: "left_editorial", gridColumns: 12, whitespaceRatio: 0.4 },
    components: {},
    diagramGrammar: {},
    provenance: [],
    fallbackFields: ["/canvas/background", "/canvas/textPrimary", "/accents/primary", "/typography/displayClass", "/layout/families", "/layout/density", "/components", "/diagramGrammar"],
    conflicts: [],
    warnings,
  };
}

function aspectToJsonPath(aspect) {
  return ({
    palette: "/canvas/background",
    typography: "/typography/displayClass",
    composition: "/layout/density",
    density: "/layout/density",
    geometry: "/components",
    diagramLanguage: "/diagramGrammar",
    tone: "/layout/density",
    imagery: "/imagery",
    logo: "/logo",
  })[aspect] || `/${aspect}`;
}

function fallback(path, fallbackFields, value) {
  fallbackFields.push(path);
  return value;
}

function mirrorProvenance(provenance, sourcePath, targetPath) {
  if (provenance.some((entry) => entry.jsonPath === targetPath)) return;
  const source = provenance.find((entry) => entry.jsonPath === sourcePath);
  if (source) provenance.push({ ...source, jsonPath: targetPath, reason: `${source.reason}:same_selected_aspect` });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function luminanceMode(hex) {
  const value = String(hex || "#000000").replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) || 0;
  const g = parseInt(value.slice(2, 4), 16) || 0;
  const b = parseInt(value.slice(4, 6), 16) || 0;
  return (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255 > 0.55 ? "light" : "dark";
}

function mixHex(first, second, secondWeight = 0.5) {
  const parse = (value) => {
    const hex = String(value || "").replace(/^#/, "");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return [0, 0, 0];
    return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  };
  const a = parse(first);
  const b = parse(second);
  const weight = Math.max(0, Math.min(1, Number(secondWeight) || 0));
  return `#${a.map((channel, index) => Math.round(channel * (1 - weight) + b[index] * weight).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
