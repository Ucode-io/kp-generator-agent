import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalJson, sha256Digest } from "./kp_reference_contracts.mjs";

const DIMENSIONS = Object.freeze(["palette", "layout", "typography", "tone", "density", "geometry", "imagery"]);
const REFERENCE_STYLE_DIMENSIONS = Object.freeze(["palette", "typography"]);

export const REFERENCE_FIDELITY_POLICY_V1 = deepFreeze({
  version: "1.0",
  weights: {
    palette: 0.55,
    layout: 0,
    typography: 0.45,
    tone: 0,
    density: 0,
    geometry: 0,
    imagery: 0,
  },
  explicitFull: {
    totalMin: 0.72,
    minPassingDimensions: 2,
    dimensionMin: {
      palette: 0.60,
      layout: 0,
      typography: 0.55,
      tone: 0,
      density: 0,
      geometry: 0,
      imagery: 0,
    },
    criticalDimensions: ["palette", "typography"],
  },
  brandSystem: {
    totalMin: 0.78,
    dimensionMinOverrides: { palette: 0.80, typography: 0.65 },
  },
  explicitPartial: {
    logoConstraintMin: 0.80,
    logoAssetIntegrityRequired: 1,
    tokenAdherenceMin: 0.95,
    fallbackTypographyMin: 0.65,
  },
  accentOnly: { paletteMin: 0.55, nonPalettePassingMax: 1, defaultLayoutMatchRatioMin: 0.75, minimumComparablePages: 2 },
  unexpectedImageryCoverageWarning: 0.01,
  unexpectedImageryCoverageZeroScore: 0.05,
  judgeDisagreementThreshold: 0.25,
});

validatePolicy(REFERENCE_FIDELITY_POLICY_V1);

/**
 * Extract generated evidence from the actual rendered page rasters plus the
 * renderer's DOM report. Passing only a style profile or presentation plan is
 * deliberately insufficient: those describe intent, not the serialized PDF.
 */
export function measureGeneratedVisualFeatures({ renderedPages, domReport, presentationPlan } = {}) {
  const pageRows = normalizeRenderedPages(renderedPages);
  const raster = extractRasterFeatures(pageRows.map((page) => page.image).filter(Boolean));
  const pages = Array.isArray(presentationPlan?.pages) ? presentationPlan.pages : [];
  const familyHistogram = histogram(pages.map((page) => normalizeFamily(page.layoutFamily)).filter(Boolean));
  const blockCounts = pages.map((page) => (page.contentBlocks || []).length + (page.visualizationSpecId ? 1 : 0));
  const dom = domReport && typeof domReport === "object" ? domReport : {};
  const actualTypography = normalizeTypographyFeatures(dom.typography || dom.visualFeatures?.typography);
  const actualGeometry = normalizeGeometryFeatures(dom.geometry || dom.visualFeatures?.geometry);
  const actualImagery = normalizeImageryFeatures(dom.imagery || dom.visualFeatures?.imagery);
  const regionIoUSim = finiteOrNull(dom.regionIoUSim ?? dom.visualFeatures?.layout?.regionIoUSim);
  const occupiedAreaRatio = finiteOrNull(
    dom.occupiedAreaRatio
      ?? dom.visualFeatures?.density?.occupiedAreaRatio
      ?? (raster.available ? 1 - raster.backgroundAreaRatio : null),
  );
  const whitespaceRatio = finiteOrNull(
    dom.whitespaceRatio
      ?? dom.visualFeatures?.layout?.whitespaceRatio
      ?? (raster.available ? raster.backgroundAreaRatio : null),
  );
  return {
    schemaVersion: "1.0",
    evidenceKind: "rendered_pdf_pages",
    renderedPageCount: pageRows.length,
    rasterEvidenceCount: raster.imageCount,
    rasterErrors: raster.errors,
    dimensions: {
      palette: raster.available ? {
        colors: raster.dominantColors,
        backgroundAreaRatio: raster.backgroundAreaRatio,
        accentAreaRatio: raster.accentAreaRatio,
        textAreaRatio: raster.textAreaRatio,
        semanticPlacementSim: finiteOrNull(dom.semanticPlacementSim ?? dom.visualFeatures?.palette?.semanticPlacementSim),
      } : null,
      layout: pages.length && raster.available ? {
        familyHistogram,
        regionIoUSim,
        regions: dom.visualFeatures?.layout?.regions || dom.regions || null,
        whitespaceRatio,
      } : null,
      typography: actualTypography,
      tone: raster.available ? {
        medianLuminance: raster.medianLuminance,
        medianContrast: raster.medianContrast,
        medianSaturation: raster.medianSaturation,
        warmBias: raster.warmBias,
        decorationAreaRatio: finiteOrNull(dom.decorationAreaRatio ?? raster.accentAreaRatio),
        enums: normalizeToneEnums(dom.tone || dom.visualFeatures?.tone, raster),
      } : null,
      density: raster.available ? {
        occupiedAreaRatio,
        medianGutterToPageWidth: finiteOrNull(dom.medianGutterToPageWidth ?? dom.visualFeatures?.density?.medianGutterToPageWidth),
        blocksPerPage: finiteOrNull(dom.visualFeatures?.density?.blocksPerPage ?? (blockCounts.length ? mean(blockCounts) : null)),
        verticalRhythmToPageHeight: finiteOrNull(dom.verticalRhythmToPageHeight ?? dom.visualFeatures?.density?.verticalRhythmToPageHeight),
        pageClasses: dom.pageClasses || dom.visualFeatures?.density?.pageClasses || null,
      } : null,
      geometry: actualGeometry,
      imagery: actualImagery,
    },
  };
}

/**
 * Compile an immutable target vector from captured reference frames and their
 * analyses. The target hash excludes its own targetHash field.
 */
export function buildReferenceFidelityTargets({ manifest, captures, analyses, styleProfile, baseDir = process.cwd() } = {}) {
  const referenceMode = manifest?.referenceMode;
  if (!["explicit_full", "explicit_partial"].includes(referenceMode)) {
    throw fidelityInputError("manifest.referenceMode", "Reference targets require explicit_full or explicit_partial mode");
  }
  if (!Array.isArray(captures) || !captures.length) throw fidelityInputError("captures", "Reference targets require captured frames");
  if (!Array.isArray(analyses) || !analyses.length) throw fidelityInputError("analyses", "Reference targets require reference analyses");
  if (!styleProfile || typeof styleProfile !== "object") throw fidelityInputError("styleProfile", "Reference targets require a visual style profile");

  const primaryReferenceId = manifest.primaryVisualReferenceId || styleProfile.referenceIds?.[0] || null;
  const usableAnalyses = analyses.filter((entry) => ["complete", "partial"].includes(entry?.status));
  const primaryAnalysis = usableAnalyses.find((entry) => entry.referenceId === primaryReferenceId) || usableAnalyses[0];
  if (!primaryAnalysis) throw fidelityInputError("analyses", "No renderer-usable reference analysis exists");
  const samples = captures
    .filter((capture) => ["complete", "partial"].includes(capture?.status))
    .flatMap((capture) => (capture.samples || []).map((sample) => ({ ...sample, referenceId: capture.referenceId })))
    .filter((sample) => primaryReferenceId ? sample.referenceId === primaryReferenceId : true);
  if (!samples.length) throw fidelityInputError("captures.samples", "No usable captured reference frames exist");
  const sourceFrameIds = samples.map((sample) => String(sample.frameId)).filter(Boolean).sort();
  const raster = extractRasterFeatures(samples.map((sample) => resolveArtifactPath(sample.artifactPath, baseDir)).filter(Boolean));
  const dimensions = buildTargetDimensions({ analysis: primaryAnalysis, styleProfile, raster, sourceFrameIds });
  const requestId = String(manifest.requestId || manifest.proposalRequestId || styleProfile.requestId || "UNKNOWN");
  const target = {
    schemaVersion: "1.0",
    targetId: `RFT-${safeId(requestId)}`,
    requestId,
    referenceMode,
    primaryReferenceId,
    primaryReferenceRole: primaryAnalysis.role || null,
    thresholds: {
      overall: primaryAnalysis.role === "brand_system"
        ? REFERENCE_FIDELITY_POLICY_V1.brandSystem.totalMin
        : REFERENCE_FIDELITY_POLICY_V1.explicitFull.totalMin,
    },
    requiredLayoutFamilies: unique((primaryAnalysis.layout?.dominantCompositions || []).map(normalizeFamily).filter(Boolean)),
    requiredTokens: styleTokens(styleProfile),
    sourceFrameIds,
    dimensions,
    ...(referenceMode === "explicit_partial" ? {
      applicableDimensions: REFERENCE_STYLE_DIMENSIONS.filter((name) => Boolean(dimensions[name])),
    } : {}),
    warnings: [...(primaryAnalysis.warnings || []), ...(raster.errors || [])],
  };
  return { ...target, targetHash: sha256Digest(canonicalJson(target)) };
}

/** Score already-measured evidence. This function never estimates from profile metadata. */
export function scoreReferenceFidelity(input = {}) {
  const referenceMode = input.policy?.referenceMode
    || input.fidelityTargets?.referenceMode
    || input.manifest?.referenceMode
    || "none";
  if (referenceMode === "none") return skipReport();
  if (!["explicit_full", "explicit_partial"].includes(referenceMode)) {
    return failedInputReport(["referenceMode"], referenceMode);
  }
  const generated = input.generatedFeatures;
  const targets = input.fidelityTargets;
  const missing = [];
  if (!generated?.dimensions) missing.push("generatedFeatures.dimensions");
  if (!targets?.dimensions) missing.push("fidelityTargets.dimensions");
  if (!input.styleProfile) missing.push("styleProfile");
  if (missing.length) return failedInputReport(missing, referenceMode);

  const policy = input.policy?.referenceFidelity || REFERENCE_FIDELITY_POLICY_V1;
  const dimensionScores = {
    palette: scorePalette(generated.dimensions.palette, targets.dimensions.palette),
    layout: scoreLayout(generated.dimensions.layout, targets.dimensions.layout),
    typography: scoreTypography(generated.dimensions.typography, targets.dimensions.typography),
    tone: scoreTone(generated.dimensions.tone, targets.dimensions.tone),
    density: scoreDensity(generated.dimensions.density, targets.dimensions.density),
    geometry: scoreGeometry(generated.dimensions.geometry, targets.dimensions.geometry),
    imagery: scoreImagery(generated.dimensions.imagery, targets.dimensions.imagery, policy),
  };
  const findings = [];
  const primaryRole = targets.primaryReferenceRole || primaryReferenceRole(input.manifest, targets.primaryReferenceId);
  const dimensionThresholds = {
    ...policy.explicitFull.dimensionMin,
    ...(primaryRole === "brand_system" ? policy.brandSystem.dimensionMinOverrides : {}),
  };
  const weights = policy.weights;
  const rawTotal = DIMENSIONS.reduce((sum, name) => sum + (weights[name] * dimensionScores[name].score), 0);
  const totalThreshold = Number(targets.thresholds?.overall
    ?? (primaryRole === "brand_system" ? policy.brandSystem.totalMin : policy.explicitFull.totalMin));
  const applicableDimensions = referenceMode === "explicit_full"
    ? [...REFERENCE_STYLE_DIMENSIONS]
    : partialApplicableDimensions(targets).filter((name) => REFERENCE_STYLE_DIMENSIONS.includes(name) || (primaryRole === "logo_asset" && name === "imagery"));
  const passingDimensions = applicableDimensions.filter((name) => dimensionScores[name].score >= dimensionThresholds[name]);

  for (const name of applicableDimensions) {
    const result = dimensionScores[name];
    if (!result.measurable) {
      findings.push(finding("REF_FIDELITY_DIMENSION_LOW", "ERROR", `Reference fidelity dimension is not measurable: ${name}`, {
        dimension: name, reason: result.reason || "missing_required_measurement", score: 0,
      }));
    } else if (result.score < dimensionThresholds[name]) {
      const critical = policy.explicitFull.criticalDimensions.includes(name);
      findings.push(finding(
        critical ? "REF_FIDELITY_CRITICAL_DIMENSION_LOW" : "REF_FIDELITY_DIMENSION_LOW",
        "ERROR",
        `Reference fidelity ${name} score ${round3(result.score)} is below ${round3(dimensionThresholds[name])}`,
        { dimension: name, score: result.score, threshold: dimensionThresholds[name], measurements: result.measurements },
      ));
    }
  }
  if (referenceMode === "explicit_full" && rawTotal < totalThreshold) {
    findings.push(finding("REF_FIDELITY_TOTAL_LOW", "ERROR", `Reference fidelity score ${round3(rawTotal)} is below ${round3(totalThreshold)}`, {
      score: rawTotal, threshold: totalThreshold,
    }));
  }
  if (referenceMode === "explicit_full" && passingDimensions.length < policy.explicitFull.minPassingDimensions) {
    findings.push(finding("REF_FIDELITY_DIMENSION_LOW", "ERROR", "Too few fidelity dimensions meet their thresholds", {
      passingDimensions, required: policy.explicitFull.minPassingDimensions,
    }));
  }
  const partialScores = referenceMode === "explicit_partial"
    ? applyPartialReferencePolicy(findings, { generated, targets, dimensionScores, policy, applicableDimensions })
    : [];

  // Layout, density, geometry, borders and spacing are intentionally owned by
  // the proposal renderer. G6 therefore validates only reference palette and
  // typography (plus an explicitly supplied logo asset in partial mode).
  const accentOnly = { matched: false, skipped: true, reason: "renderer_owned_layout" };
  const metrics = {
    referenceMode,
    fidelityScore: referenceMode === "explicit_full" ? rawTotal : null,
    fidelityScoreDisplay: referenceMode === "explicit_full" ? round3(rawTotal) : null,
    weightedUnrenormalizedScore: rawTotal,
    referenceConstraintScore: referenceMode === "explicit_partial" ? (partialScores.length ? Math.min(...partialScores) : 0) : null,
    threshold: referenceMode === "explicit_full" ? totalThreshold : null,
    primaryVisualReferenceId: targets.primaryReferenceId || null,
    primaryReferenceRole: primaryRole || null,
    passingDimensionCount: passingDimensions.length,
    passingDimensions,
    applicableDimensions,
    compositionFidelity: "SKIP_RENDERER_OWNED",
    dimensions: Object.fromEntries(DIMENSIONS.map((name) => [name, {
      score: dimensionScores[name].score,
      displayScore: round3(dimensionScores[name].score),
      weight: weights[name],
      threshold: dimensionThresholds[name],
      applicable: applicableDimensions.includes(name),
      measurable: dimensionScores[name].measurable,
      measurements: dimensionScores[name].measurements,
    }])),
    defaultLayoutMatchCount: accentOnly.defaultLayoutMatchCount,
    targetHash: targets.targetHash || targetHash(targets),
  };
  return { status: findings.some((row) => ["BLOCKER", "ERROR"].includes(row.severity)) ? "FAIL" : "PASS", findings, metrics };
}

export function detectAccentOnlyMatch(scoreReport, presentationPlan, defaultPresentationPlan, policy = REFERENCE_FIDELITY_POLICY_V1) {
  const actualPages = Array.isArray(presentationPlan?.pages) ? presentationPlan.pages : [];
  const baselinePages = Array.isArray(defaultPresentationPlan?.pages) ? defaultPresentationPlan.pages : [];
  const baselineByPage = new Map(baselinePages.map((page) => [Number(page.pageNumber), normalizeFamily(page.layoutFamily)]));
  const defaultLayoutMatchCount = actualPages.reduce((count, page) => {
    const expected = baselineByPage.get(Number(page.pageNumber));
    return count + (expected && normalizeFamily(page.layoutFamily) === expected ? 1 : 0);
  }, 0);
  const scores = scoreReport?.dimensions || {};
  const thresholds = scoreReport?.dimensionThresholds || policy.explicitFull.dimensionMin;
  const paletteScore = Number(scores.palette ?? 0);
  const nonPalettePassing = DIMENSIONS.filter((name) => name !== "palette" && Number(scores[name] ?? 0) >= Number(thresholds[name] ?? 1)).length;
  const comparablePageCount = Math.min(actualPages.length, baselinePages.length);
  const requiredDefaultMatches = Math.max(
    Number(policy.accentOnly.minimumComparablePages || 2),
    Math.ceil(comparablePageCount * Number(policy.accentOnly.defaultLayoutMatchRatioMin || 0.75)),
  );
  const matched = paletteScore >= policy.accentOnly.paletteMin
    && nonPalettePassing <= policy.accentOnly.nonPalettePassingMax
    && actualPages.length === baselinePages.length
    && comparablePageCount >= Number(policy.accentOnly.minimumComparablePages || 2)
    && defaultLayoutMatchCount >= requiredDefaultMatches;
  return { matched, paletteScore, nonPalettePassing, defaultLayoutMatchCount, requiredDefaultMatches, comparablePageCount };
}

/**
 * End-to-end G6 inspection. Explicit-reference mode is fail-closed on every
 * required evidence input. No-reference mode alone may return SKIP.
 */
export async function inspectReferenceFidelity(input = {}, options = {}) {
  const referenceMode = input.manifest?.referenceMode || input.policy?.referenceMode || input.fidelityTargets?.referenceMode || "none";
  if (referenceMode === "none") return skipReport();
  const required = {
    manifest: input.manifest,
    captures: Array.isArray(input.captures) && input.captures.length ? input.captures : null,
    analyses: Array.isArray(input.analyses) && input.analyses.length ? input.analyses : null,
    styleProfile: input.styleProfile,
    presentationPlan: input.presentationPlan,
    defaultPresentationPlan: input.defaultPresentationPlan,
    domReport: input.domReport,
    renderedPages: Array.isArray(input.renderedPages) && input.renderedPages.length ? input.renderedPages : null,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) return failedInputReport(missing, referenceMode);
  try {
    const fidelityTargets = input.fidelityTargets?.dimensions
      ? input.fidelityTargets
      : buildReferenceFidelityTargets({
          manifest: input.manifest,
          captures: input.captures,
          analyses: input.analyses,
          styleProfile: input.styleProfile,
          baseDir: options.baseDir || input.baseDir || process.cwd(),
        });
    const expectedHash = targetHash(fidelityTargets);
    if (fidelityTargets.targetHash && fidelityTargets.targetHash !== expectedHash) {
      return {
        status: "FAIL",
        findings: [finding("CONTRACT_FIDELITY_TARGETS_INVALID", "ERROR", "Reference fidelity target hash does not match its canonical payload", {
          expectedHash, actualHash: fidelityTargets.targetHash,
        })],
        metrics: { referenceMode, targetHash: fidelityTargets.targetHash, expectedTargetHash: expectedHash },
      };
    }
    const generatedFeatures = input.generatedFeatures || measureGeneratedVisualFeatures({
      renderedPages: input.renderedPages,
      domReport: input.domReport,
      presentationPlan: input.presentationPlan,
    });
    const report = scoreReferenceFidelity({
      ...input,
      generatedFeatures,
      fidelityTargets: { ...fidelityTargets, targetHash: fidelityTargets.targetHash || expectedHash },
      policy: { ...(input.policy || {}), referenceMode },
    });
    report.metrics = {
      ...report.metrics,
      targetHash: fidelityTargets.targetHash || expectedHash,
      targetVector: options.targetRelativePath || "reference/fidelity-targets.json",
      renderedPageCount: generatedFeatures.renderedPageCount,
      rasterEvidenceCount: generatedFeatures.rasterEvidenceCount,
    };
    if (options.outputDir) {
      const targetPath = path.join(options.outputDir, options.targetFileName || "fidelity-targets.json");
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, `${canonicalJson({ ...fidelityTargets, targetHash: fidelityTargets.targetHash || expectedHash })}\n`, "utf8");
      report.metrics.targetVectorPath = targetPath;
    }
    return report;
  } catch (error) {
    return {
      status: "FAIL",
      findings: [finding("CONTRACT_FIDELITY_TARGETS_INVALID", "ERROR", error?.message || "Reference fidelity inspection failed", {
        code: error?.code || "CONTRACT_FIDELITY_TARGETS_INVALID",
      })],
      metrics: { referenceMode },
    };
  }
}

function buildTargetDimensions({ analysis, styleProfile, raster, sourceFrameIds }) {
  const paletteTokens = styleTokens(styleProfile).filter((row) => row.bucket === "canvas" || row.bucket === "accents");
  const layout = analysis.layout || {};
  const typography = analysis.typography || {};
  const components = analysis.components || {};
  const imagery = analysis.imagery || null;
  const families = (styleProfile.layout?.families?.length ? styleProfile.layout.families : layout.dominantCompositions || []).map(normalizeFamily).filter(Boolean);
  const targetRegions = summarizeTargetRegions(analysis.pageSilhouettes || []);
  const radiusValues = arrayOfNumbers(components.cornerRadii || components.radiusScale || components.radii || components.radiusRangePx);
  return {
    palette: raster.available || paletteTokens.length ? {
      colors: paletteTokens.map((row) => ({ hex: row.value, weight: paletteTokenWeight(row.name) })),
      referenceColors: raster.dominantColors,
      backgroundAreaRatio: raster.available ? raster.backgroundAreaRatio : null,
      accentAreaRatio: raster.available ? raster.accentAreaRatio : null,
      textAreaRatio: raster.available ? raster.textAreaRatio : null,
      semanticPlacementSim: 1,
      sourceFrameIds,
    } : null,
    layout: families.length && Number.isFinite(Number(layout.whitespaceRatio)) ? {
      familyHistogram: histogram(families),
      regionIoUSim: finiteOrNull(analysis.layout?.regionIoUSim),
      regions: targetRegions,
      whitespaceRatioRange: boundedRange(Number(layout.whitespaceRatio), 0.08),
      sourceFrameIds,
    } : null,
    typography: typography.displayClass ? {
      displayClass: typography.displayClass,
      bodyClass: typography.bodyClass,
      metadataClass: typography.metadataClass,
      displayFamilies: normalizedFontFamilies(styleProfile?.typography?.displayStack || typography.observedFamilies),
      bodyFamilies: normalizedFontFamilies(styleProfile?.typography?.bodyStack || typography.observedFamilies),
      metadataFamilies: normalizedFontFamilies(styleProfile?.typography?.metadataStack || typography.safeFallbackFamilies),
      observedFamilies: normalizedFontFamilies(typography.observedFamilies),
      displayWeight: finiteOrNull(typography.displayWeight),
      bodyWeight: finiteOrNull(typography.bodyWeight ?? 400),
      titleBodySizeRatio: scaleRatio(typography.scale),
      bodyLineHeightRatio: finiteOrNull(typography.bodyLineHeightRatio ?? 1.45),
      metadataTrackingEm: finiteOrNull(typography.metadataTrackingEm ?? 0.08),
      headingCase: typography.headingCase,
      sourceFrameIds,
    } : null,
    tone: raster.available ? {
      medianLuminance: raster.medianLuminance,
      medianContrast: raster.medianContrast,
      medianSaturation: raster.medianSaturation,
      warmBias: raster.warmBias,
      decorationAreaRatio: raster.accentAreaRatio,
      enums: targetToneEnums(styleProfile, raster),
      sourceFrameIds,
    } : null,
    density: Number.isFinite(Number(layout.whitespaceRatio)) ? {
      occupiedAreaRatio: clamp01(1 - Number(layout.whitespaceRatio)),
      medianGutterToPageWidth: finiteOrNull(layout.outerMarginRatio),
      blocksPerPage: finiteOrNull(densityBlocks(layout.density)),
      verticalRhythmToPageHeight: finiteOrNull(densityRhythm(layout.density)),
      sourceFrameIds,
    } : null,
    geometry: radiusValues.length || Object.keys(components).length ? {
      radiusHistogram: radiusHistogram(radiusValues),
      borderUsageRatio: finiteOrNull(components.borderUsageRatio ?? styleRatio(components.borderStyle, { none: 0, rules_not_boxes: 0.35, thin_low_contrast: 0.6 }, 0.5)),
      shadowUsageRatio: finiteOrNull(components.shadowUsageRatio ?? styleRatio(components.shadowStyle, { none: 0, subtle: 0.25, soft: 0.4 }, 0.3)),
      canvasRelationshipRatio: finiteOrNull(components.canvasRelationshipRatio ?? styleRatio(components.tableStyle, { rules_not_boxes: 0.65, borderless: 0.8 }, 0.35)),
      sourceFrameIds,
    } : null,
    imagery: imagery?.mode ? {
      mode: imagery.mode,
      coverageRatioRange: imagery.mode === "none" ? [0, 0] : (imagery.coverageRatioRange || [0.05, 0.45]),
      cropMode: imagery.cropMode || (imagery.mode === "photography" ? "cover" : "none"),
      maskShape: imagery.maskShape || "none",
      overlay: imagery.overlay || imagery.treatment || "none",
      sourceFrameIds,
    } : null,
  };
}

function scorePalette(actual, target) {
  if (!actual || !target || !Array.isArray(actual.colors) || !actual.colors.length) return unmeasurable("palette_raster_or_targets_missing");
  const targetColors = [...(target.colors || []), ...(target.referenceColors || [])]
    .map((row) => typeof row === "string" ? { hex: row, weight: 1 } : row)
    .filter((row) => isHex(row.hex));
  if (!targetColors.length) return unmeasurable("palette_targets_missing");
  const generatedColors = actual.colors.map((row) => typeof row === "string" ? { hex: row } : row).filter((row) => isHex(row.hex));
  if (!generatedColors.length) return unmeasurable("generated_palette_missing");
  const targetCoverageRows = targetColors.map((row) => ({
    weight: Number(row.weight || row.ratio || 1),
    score: Math.max(...generatedColors.map((candidate) => deltaESim(row.hex, candidate.hex))),
  }));
  const generatedPrecisionRows = generatedColors.map((row) => ({
    weight: Number(row.ratio || row.weight || 1 / generatedColors.length),
    score: Math.max(...targetColors.map((candidate) => deltaESim(row.hex, candidate.hex))),
  }));
  const targetColorCoverage = weightedMean(targetCoverageRows);
  const generatedColorPrecision = weightedMean(generatedPrecisionRows);
  const tokenColorSim = Math.min(targetColorCoverage, generatedColorPrecision);
  const areaValues = [
    numSimRequired(actual.backgroundAreaRatio, target.backgroundAreaRatio, 0.20),
    numSimRequired(actual.accentAreaRatio, target.accentAreaRatio, 0.12),
    numSimRequired(actual.textAreaRatio, target.textAreaRatio, 0.10),
  ];
  const areaSim = meanRequired(areaValues);
  const semanticPlacementSim = bothNumber(actual.semanticPlacementSim, target.semanticPlacementSim)
    ? clamp01(Number(actual.semanticPlacementSim))
    : 0;
  // Palette fidelity means the colors themselves. Their occupied area and
  // placement are composition/density signals owned by the renderer and are
  // retained only as diagnostics.
  return measured(tokenColorSim, { tokenColorSim, targetColorCoverage, generatedColorPrecision, areaSim, semanticPlacementSim, rendererOwnedDiagnostics: ["areaSim", "semanticPlacementSim"] });
}

function scoreLayout(actual, target) {
  if (!actual || !target) return unmeasurable("layout_measurements_missing");
  const histogramSim = histSim(actual.familyHistogram, target.familyHistogram);
  const regionIoUSim = bothNumber(actual.regionIoUSim, target.regionIoUSim)
    ? clamp01(Number(actual.regionIoUSim))
    : scoreRegionIoU(actual.regions, target.regions);
  const whitespaceSim = rangeSimRequired(actual.whitespaceRatio, target.whitespaceRatioRange, 0.20);
  if (![histogramSim, whitespaceSim].every(Number.isFinite)) return unmeasurable("layout_histogram_or_whitespace_missing");
  return measured((0.35 * histogramSim) + (0.35 * regionIoUSim) + (0.30 * whitespaceSim), { histogramSim, regionIoUSim, whitespaceSim });
}

function scoreTypography(actual, target) {
  if (!actual || !target) return unmeasurable("typography_computed_styles_missing");
  const exactFamilyPairs = [
    {
      role: "display",
      generated: actual.displayFamilies,
      expected: target.displayFamilies,
      resolved: actual.displayResolvedFamily,
      primaryAvailable: actual.displayPrimaryAvailable,
    },
    {
      role: "body",
      generated: actual.bodyFamilies,
      expected: target.bodyFamilies,
      resolved: actual.bodyResolvedFamily,
      primaryAvailable: actual.bodyPrimaryAvailable,
    },
    {
      role: "metadata",
      generated: actual.metadataFamilies,
      expected: target.metadataFamilies,
      resolved: actual.metadataResolvedFamily,
      primaryAvailable: actual.metadataPrimaryAvailable,
    },
  ].filter((row) => Array.isArray(row.expected) && row.expected.length);
  const familyResolution = exactFamilyPairs.map((row) => ({
    role: row.role,
    ...resolvedFontFamilySim(row.generated, row.expected, row.resolved, row.primaryAvailable),
  }));
  const exactFamilyScores = familyResolution.map((row) => row.score);
  const requiredClasses = ["displayClass", "bodyClass", "metadataClass"];
  if (!exactFamilyScores.length && requiredClasses.some((key) => !actual[key] || !target[key])) return unmeasurable("typography_family_measurement_missing");
  const classSim = mean([catSim(actual.displayClass, target.displayClass), catSim(actual.bodyClass, target.bodyClass), catSim(actual.metadataClass, target.metadataClass)]);
  const familySim = exactFamilyScores.length ? mean(exactFamilyScores) : classSim;
  const diagnostics = {
    weightSim: bothNumber(actual.displayWeight, target.displayWeight) && bothNumber(actual.bodyWeight, target.bodyWeight)
      ? mean([numSim(actual.displayWeight, target.displayWeight, 400), numSim(actual.bodyWeight, target.bodyWeight, 300)]) : null,
    scaleSim: bothNumber(actual.titleBodySizeRatio, target.titleBodySizeRatio) ? numSim(actual.titleBodySizeRatio, target.titleBodySizeRatio, 1.5) : null,
    lineHeightSim: bothNumber(actual.bodyLineHeightRatio, target.bodyLineHeightRatio) ? numSim(actual.bodyLineHeightRatio, target.bodyLineHeightRatio, 0.5) : null,
    trackingSim: bothNumber(actual.metadataTrackingEm, target.metadataTrackingEm) ? numSim(actual.metadataTrackingEm, target.metadataTrackingEm, 0.2) : null,
    caseSim: actual.headingCase && target.headingCase ? catSim(actual.headingCase, target.headingCase) : null,
  };
  // Typography fidelity is deliberately family-only. Font size, weight,
  // tracking, case and line-height are renderer-owned presentation geometry.
  return measured(familySim, {
    familySim, exactFamilyScores, familyResolution, classSim, ...diagnostics,
    rendererOwnedDiagnostics: ["weightSim", "scaleSim", "lineHeightSim", "trackingSim", "caseSim"],
  });
}

function scoreTone(actual, target) {
  if (!actual || !target) return unmeasurable("tone_raster_metrics_missing");
  const scalarKeys = ["medianLuminance", "medianContrast", "medianSaturation", "warmBias", "decorationAreaRatio"];
  if (scalarKeys.some((key) => !bothNumber(actual[key], target[key]))) return unmeasurable("tone_required_metric_missing");
  const enums = ["formality", "energy", "temperature", "contrast", "decoration"];
  if (enums.some((key) => !actual.enums?.[key] || !target.enums?.[key])) return unmeasurable("tone_enum_missing");
  const enumSim = mean(enums.map((key) => catSim(actual.enums[key], target.enums[key])));
  const luminance = numSim(actual.medianLuminance, target.medianLuminance, 0.25);
  const contrast = numSim(actual.medianContrast, target.medianContrast, 0.30);
  const saturation = numSim(actual.medianSaturation, target.medianSaturation, 0.35);
  const warm = numSim(actual.warmBias, target.warmBias, 0.50);
  const decoration = numSim(actual.decorationAreaRatio, target.decorationAreaRatio, 0.20);
  return measured((0.15 * luminance) + (0.20 * contrast) + (0.15 * saturation) + (0.15 * warm) + (0.15 * decoration) + (0.20 * enumSim), {
    luminance, contrast, saturation, warm, decoration, enumSim,
  });
}

function scoreDensity(actual, target) {
  if (!actual || !target) return unmeasurable("density_measurements_missing");
  const keys = ["occupiedAreaRatio", "medianGutterToPageWidth", "blocksPerPage", "verticalRhythmToPageHeight"];
  if (keys.some((key) => !bothNumber(actual[key], target[key]))) return unmeasurable("density_required_metric_missing");
  const occupied = numSim(actual.occupiedAreaRatio, target.occupiedAreaRatio, 0.25);
  const gutter = numSim(actual.medianGutterToPageWidth, target.medianGutterToPageWidth, 0.08);
  const blocks = numSim(actual.blocksPerPage, target.blocksPerPage, 8);
  const rhythm = numSim(actual.verticalRhythmToPageHeight, target.verticalRhythmToPageHeight, 0.12);
  return measured((0.40 * occupied) + (0.25 * gutter) + (0.15 * blocks) + (0.20 * rhythm), { occupied, gutter, blocks, rhythm });
}

function scoreGeometry(actual, target) {
  if (!actual || !target) return unmeasurable("geometry_dom_measurements_missing");
  const ratios = ["borderUsageRatio", "shadowUsageRatio", "canvasRelationshipRatio"];
  if (!actual.radiusHistogram || !target.radiusHistogram || ratios.some((key) => !bothNumber(actual[key], target[key]))) return unmeasurable("geometry_required_metric_missing");
  const radii = histSim(actual.radiusHistogram, target.radiusHistogram);
  const border = numSim(actual.borderUsageRatio, target.borderUsageRatio, 0.50);
  const shadow = numSim(actual.shadowUsageRatio, target.shadowUsageRatio, 0.50);
  const canvas = numSim(actual.canvasRelationshipRatio, target.canvasRelationshipRatio, 0.50);
  return measured((0.40 * radii) + (0.20 * border) + (0.20 * shadow) + (0.20 * canvas), { radii, border, shadow, canvas });
}

function scoreImagery(actual, target, policy) {
  if (!actual || !target || !target.mode) return unmeasurable("imagery_dom_measurements_missing");
  if (target.mode === "none") {
    if (!bothNumber(actual.coverageRatio, 0)) return unmeasurable("imagery_coverage_missing");
    const score = 1 - Math.min(1, Number(actual.coverageRatio) / policy.unexpectedImageryCoverageZeroScore);
    return measured(score, { unexpectedImageryCoverageRatio: Number(actual.coverageRatio) });
  }
  const required = ["mode", "coverageRatio", "cropMode", "maskShape", "overlay"];
  if (required.some((key) => actual[key] === undefined || actual[key] === null)) return unmeasurable("imagery_required_metric_missing");
  const mode = catSim(actual.mode, target.mode);
  const coverage = rangeSimRequired(actual.coverageRatio, target.coverageRatioRange, 0.20);
  const crop = catSim(actual.cropMode, target.cropMode);
  const mask = catSim(actual.maskShape, target.maskShape);
  const overlay = catSim(actual.overlay, target.overlay);
  return measured((0.30 * mode) + (0.30 * coverage) + (0.15 * crop) + (0.10 * mask) + (0.15 * overlay), { mode, coverage, crop, mask, overlay });
}

function applyPartialReferencePolicy(findings, { generated, targets, dimensionScores, policy, applicableDimensions }) {
  const constraints = targets.constraints || {};
  const applicable = applicableDimensions || [];
  const constraintScores = applicable.map((name) => dimensionScores[name].score);
  if (!Object.keys(constraints).length && !applicable.length) {
    findings.push(finding("REF_REFERENCE_MODE_INVALID", "BLOCKER", "Explicit partial reference has no declared constraints", { referenceMode: "explicit_partial" }));
    return [];
  }
  if (constraints.logo) {
    const score = Number(generated.constraints?.logo?.score ?? 0);
    const integrity = Number(generated.constraints?.logo?.assetIntegrity ?? 0);
    constraintScores.push(Math.min(clamp01(score), integrity === policy.explicitPartial.logoAssetIntegrityRequired ? 1 : 0));
    if (integrity !== policy.explicitPartial.logoAssetIntegrityRequired || score < policy.explicitPartial.logoConstraintMin) {
      findings.push(finding("REF_FIDELITY_DIMENSION_LOW", "ERROR", "Logo integrity or placement constraint failed", { score, integrity }));
    }
  }
  if (constraints.tokens) {
    const adherence = Number(generated.constraints?.tokens?.adherence ?? 0);
    const maxDeltaE = Number(generated.constraints?.tokens?.maxDeltaE ?? Number.POSITIVE_INFINITY);
    constraintScores.push(maxDeltaE <= 10 ? clamp01(adherence) : 0);
    if (adherence < policy.explicitPartial.tokenAdherenceMin || maxDeltaE > 10) {
      findings.push(finding("REF_FIDELITY_DIMENSION_LOW", "ERROR", "Explicit theme-token constraint failed", { adherence, maxDeltaE }));
    }
  }
  if (constraints.font) {
    constraintScores.push(dimensionScores.typography.score);
    if (dimensionScores.typography.score < policy.explicitPartial.fallbackTypographyMin) {
      findings.push(finding("REF_FIDELITY_DIMENSION_LOW", "ERROR", "Explicit font/fallback typography constraint failed", { score: dimensionScores.typography.score }));
    }
  }
  return constraintScores;
}

function partialApplicableDimensions(targets) {
  const declared = Array.isArray(targets?.applicableDimensions)
    ? targets.applicableDimensions.filter((name) => DIMENSIONS.includes(name))
    : [];
  if (declared.length) return unique(declared);
  const constraints = targets?.constraints || {};
  const derived = [];
  if (constraints.tokens || constraints.palette) derived.push("palette");
  if (constraints.font || constraints.typography) derived.push("typography");
  if (constraints.composition || constraints.layout) derived.push("layout");
  if (constraints.tone) derived.push("tone");
  if (constraints.density) derived.push("density");
  if (constraints.geometry) derived.push("geometry");
  if (constraints.imagery) derived.push("imagery");
  return unique(derived);
}

function normalizeRenderedPages(renderedPages) {
  if (!Array.isArray(renderedPages)) return [];
  return renderedPages.map((row, index) => typeof row === "string"
    ? { page: index + 1, image: row }
    : { page: Number(row?.page || index + 1), image: row?.image || row?.path || row?.pngPath || null });
}

function extractRasterFeatures(paths) {
  const existing = paths.map((value) => String(value || "")).filter(Boolean);
  if (!existing.length) return emptyRaster("no_image_paths");
  const script = String.raw`
import json, math, os, statistics, sys
from collections import Counter
try:
    from PIL import Image, ImageStat
except Exception as exc:
    print(json.dumps({"error": "PIL unavailable: " + str(exc)})); sys.exit(0)
paths = json.load(sys.stdin)
colors = Counter(); luminance=[]; saturation=[]; warm=[]; bg=accent=text=total=0; errors=[]
for p in paths:
    try:
        with Image.open(p) as im:
            im = im.convert("RGB"); im.thumbnail((360, 240), Image.Resampling.LANCZOS)
            pixels = list(im.getdata())
            if not pixels: continue
            total += len(pixels)
            for r,g,b in pixels:
                mx=max(r,g,b); mn=min(r,g,b); delta=mx-mn
                lum=(0.2126*r+0.7152*g+0.0722*b)/255.0
                sat=0 if mx == 0 else delta/mx
                luminance.append(lum); saturation.append(sat); warm.append((r-b)/255.0)
                if (r>242 and g>242 and b>242) or (r<16 and g<16 and b<16): bg += 1
                if sat>0.35 and 0.12<lum<0.88: accent += 1
                if lum<0.30 and sat<0.35: text += 1
                q=(int(round(r/32)*32),int(round(g/32)*32),int(round(b/32)*32))
                q=tuple(min(255,max(0,x)) for x in q); colors[q]+=1
    except Exception as exc: errors.append(os.path.basename(p)+": "+str(exc))
if total == 0:
    print(json.dumps({"error":"no_readable_pixels","errors":errors})); sys.exit(0)
dominant=[]
for (r,g,b), count in colors.most_common(12):
    dominant.append({"hex":"#%02X%02X%02X"%(r,g,b),"ratio":count/total})
mean_l=sum(luminance)/len(luminance); var=sum((x-mean_l)**2 for x in luminance)/len(luminance)
print(json.dumps({
 "imageCount": len(paths)-len(errors), "dominantColors":dominant,
 "backgroundAreaRatio":bg/total, "accentAreaRatio":accent/total, "textAreaRatio":text/total,
 "medianLuminance":statistics.median(luminance), "medianContrast":min(1.0, math.sqrt(var)*4),
 "medianSaturation":statistics.median(saturation), "warmBias":sum(warm)/len(warm), "errors":errors
}))
`;
  const result = spawnSync(process.env.KP_PDF_PYTHON || "python3", ["-c", script], {
    input: JSON.stringify(existing), encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
  });
  if (result.error || result.status !== 0) return emptyRaster(result.error?.message || result.stderr || `python_exit_${result.status}`);
  try {
    const parsed = JSON.parse(result.stdout || "{}");
    if (parsed.error) return emptyRaster(parsed.error, parsed.errors);
    return { available: true, ...parsed, errors: parsed.errors || [] };
  } catch (error) {
    return emptyRaster(`invalid_raster_feature_json:${error.message}`);
  }
}

function emptyRaster(reason, errors = []) {
  return {
    available: false, imageCount: 0, dominantColors: [], backgroundAreaRatio: null, accentAreaRatio: null,
    textAreaRatio: null, medianLuminance: null, medianContrast: null, medianSaturation: null, warmBias: null,
    errors: [reason, ...(errors || [])].filter(Boolean),
  };
}

function normalizeTypographyFeatures(value) {
  if (!value || typeof value !== "object") return null;
  return {
    displayClass: value.displayClass ?? null,
    bodyClass: value.bodyClass ?? null,
    metadataClass: value.metadataClass ?? null,
    displayFamilies: normalizedFontFamilies(value.displayFamilies || value.displayStack),
    bodyFamilies: normalizedFontFamilies(value.bodyFamilies || value.bodyStack),
    metadataFamilies: normalizedFontFamilies(value.metadataFamilies || value.metadataStack),
    displayResolvedFamily: normalizeFontFamily(value.displayResolvedFamily),
    bodyResolvedFamily: normalizeFontFamily(value.bodyResolvedFamily),
    metadataResolvedFamily: normalizeFontFamily(value.metadataResolvedFamily),
    displayPrimaryAvailable: booleanOrNull(value.displayPrimaryAvailable),
    bodyPrimaryAvailable: booleanOrNull(value.bodyPrimaryAvailable),
    metadataPrimaryAvailable: booleanOrNull(value.metadataPrimaryAvailable),
    displayWeight: finiteOrNull(value.displayWeight),
    bodyWeight: finiteOrNull(value.bodyWeight),
    titleBodySizeRatio: finiteOrNull(value.titleBodySizeRatio),
    bodyLineHeightRatio: finiteOrNull(value.bodyLineHeightRatio),
    metadataTrackingEm: finiteOrNull(value.metadataTrackingEm),
    headingCase: value.headingCase ?? null,
  };
}

function normalizeFontFamily(value) {
  const [family] = normalizedFontFamilies(value);
  return family || null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizedFontFamilies(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return unique(values
    .map((family) => String(family || "").trim().replace(/^['\"]|['\"]$/g, ""))
    .filter(Boolean)
    .map((family) => family.replace(/\s+/g, " ")))
    .slice(0, 8);
}

function primaryFontFamilySim(actual, target) {
  const actualFamilies = normalizedFontFamilies(actual).map((family) => family.toLowerCase());
  const targetFamilies = normalizedFontFamilies(target).map((family) => family.toLowerCase());
  if (!actualFamilies.length || !targetFamilies.length) return 0;
  return actualFamilies[0] === targetFamilies[0] ? 1 : 0;
}

function resolvedFontFamilySim(actual, target, resolved, primaryAvailable) {
  const actualFamilies = normalizedFontFamilies(actual).map((family) => family.toLowerCase());
  const targetFamilies = normalizedFontFamilies(target).map((family) => family.toLowerCase());
  if (!actualFamilies.length || !targetFamilies.length) return { score: 0, mode: "family_stack_missing", requestedPrimary: actualFamilies[0] || null, targetPrimary: targetFamilies[0] || null, resolvedFamily: resolved || null };

  const requestedPrimary = actualFamilies[0];
  const targetPrimary = targetFamilies[0];
  const resolvedFamily = normalizeFontFamily(resolved)?.toLowerCase() || null;
  if (requestedPrimary !== targetPrimary) {
    return { score: 0, mode: "requested_primary_mismatch", requestedPrimary, targetPrimary, resolvedFamily };
  }

  // Older/manual fixtures do not carry renderer resolution evidence. Preserve
  // their exact-family behaviour, but use the explicit availability evidence
  // whenever Chromium supplied it.
  if (primaryAvailable !== false) {
    return { score: 1, mode: primaryAvailable === true ? "primary_rendered" : "primary_exact_unresolved", requestedPrimary, targetPrimary, resolvedFamily: resolvedFamily || requestedPrimary };
  }

  const fallbackIndex = resolvedFamily ? targetFamilies.indexOf(resolvedFamily) : -1;
  if (fallbackIndex > 0) {
    return { score: 0.75, mode: "approved_reference_stack_fallback", requestedPrimary, targetPrimary, resolvedFamily, fallbackIndex };
  }
  return { score: 0, mode: resolvedFamily ? "unapproved_rendered_fallback" : "rendered_family_unresolved", requestedPrimary, targetPrimary, resolvedFamily };
}

function normalizeGeometryFeatures(value) {
  if (!value || typeof value !== "object") return null;
  return {
    radiusHistogram: value.radiusHistogram || (Array.isArray(value.cornerRadii) ? radiusHistogram(value.cornerRadii) : null),
    borderUsageRatio: finiteOrNull(value.borderUsageRatio),
    shadowUsageRatio: finiteOrNull(value.shadowUsageRatio),
    canvasRelationshipRatio: finiteOrNull(value.canvasRelationshipRatio),
  };
}

function normalizeImageryFeatures(value) {
  if (!value || typeof value !== "object") return null;
  return {
    mode: value.mode ?? null,
    coverageRatio: finiteOrNull(value.coverageRatio),
    cropMode: value.cropMode ?? "unknown",
    maskShape: value.maskShape ?? "none",
    overlay: value.overlay ?? "none",
    unapprovedMediaCount: Number(value.unapprovedMediaCount || 0),
  };
}

function normalizeToneEnums(value, raster) {
  if (value && typeof value === "object" && value.enums) return value.enums;
  if (value && typeof value === "object" && ["formality", "energy", "temperature", "contrast", "decoration"].every((key) => value[key])) return value;
  return {
    formality: "professional",
    energy: raster.accentAreaRatio > 0.12 ? "energetic" : "restrained",
    temperature: raster.warmBias > 0.04 ? "warm" : raster.warmBias < -0.04 ? "cool" : "neutral",
    contrast: raster.medianContrast > 0.45 ? "high" : "moderate",
    decoration: raster.accentAreaRatio > 0.15 ? "decorative" : "restrained",
  };
}

function targetToneEnums(styleProfile, raster) {
  const tone = styleProfile.tone || {};
  return {
    formality: tone.formality || "professional",
    energy: tone.energy || (raster.accentAreaRatio > 0.12 ? "energetic" : "restrained"),
    temperature: tone.temperature || (raster.warmBias > 0.04 ? "warm" : raster.warmBias < -0.04 ? "cool" : "neutral"),
    contrast: tone.contrast || (raster.medianContrast > 0.45 ? "high" : "moderate"),
    decoration: tone.decoration || (raster.accentAreaRatio > 0.15 ? "decorative" : "restrained"),
  };
}

function styleTokens(profile) {
  const rows = [];
  for (const bucket of ["canvas", "accents"]) {
    for (const [name, value] of Object.entries(profile?.[bucket] || {})) {
      if (isHex(value)) rows.push({ bucket, name, value: value.toUpperCase() });
    }
  }
  return rows;
}

function paletteTokenWeight(name) {
  const map = { background: 0.20, surface1: 0.10, textPrimary: 0.10, primary: 0.25, secondary: 0.10, positive: 0.0833, warning: 0.0833, critical: 0.0834 };
  return map[name] || 0.05;
}

function primaryReferenceRole(manifest, primaryReferenceId) {
  return (manifest?.items || []).find((item) => (item.id || item.referenceId) === primaryReferenceId)?.role || null;
}

function targetHash(targets) {
  const { targetHash: _ignored, ...payload } = targets || {};
  return sha256Digest(canonicalJson(payload));
}

function skipReport() {
  return { status: "SKIP", findings: [], metrics: { referenceMode: "none", fidelityScore: null, threshold: null, reason: "no_visual_reference_requested" } };
}

function failedInputReport(missing, referenceMode) {
  return {
    status: "FAIL",
    findings: [finding("CONTRACT_FIDELITY_TARGETS_INVALID", "ERROR", "Reference fidelity inspection is missing required evidence inputs", { missing })],
    metrics: { referenceMode, fidelityScore: null, threshold: null, missingInputs: missing },
  };
}

function finding(code, severity, message, evidence) {
  return {
    code, severity, message, evidence,
    remediation: "Regenerate the request with complete captured reference evidence and re-run deterministic G6 inspection.",
  };
}

function fidelityInputError(field, message) {
  return Object.assign(new Error(message), { code: "CONTRACT_FIDELITY_TARGETS_INVALID", evidence: { field } });
}

function measured(score, measurements) {
  return { score: clamp01(score), measurable: true, measurements };
}

function unmeasurable(reason) {
  return { score: 0, measurable: false, reason, measurements: {} };
}

function mapScores(results) {
  return Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.score]));
}

function histogram(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return result;
}

function summarizeTargetRegions(silhouettes) {
  const rows = (silhouettes || []).flatMap((silhouette) => (silhouette.regions || []).map((region, index) => ({
    id: region.id || `${silhouette.id || "silhouette"}-${index + 1}`,
    role: String(region.role || "unknown"),
    x: finiteOrNull(region.x), y: finiteOrNull(region.y), w: finiteOrNull(region.w), h: finiteOrNull(region.h),
  }))).filter((row) => [row.x, row.y, row.w, row.h].every(isNumericValue));
  return unique(rows.map((row) => row.role)).map((role) => {
    const matches = rows.filter((row) => row.role === role);
    return {
      id: `target-${role}`,
      role,
      x: medianNumber(matches.map((row) => row.x)),
      y: medianNumber(matches.map((row) => row.y)),
      w: medianNumber(matches.map((row) => row.w)),
      h: medianNumber(matches.map((row) => row.h)),
    };
  });
}

function scoreRegionIoU(actualRows, targetRows) {
  const actual = Array.isArray(actualRows) ? actualRows.filter(validRegion) : [];
  const target = Array.isArray(targetRows) ? targetRows.filter(validRegion) : [];
  if (!actual.length && !target.length) return 1;
  if (!actual.length || !target.length) return 0;
  const candidates = [];
  for (const targetRegion of target) {
    for (const actualRegion of actual) {
      if (targetRegion.role !== actualRegion.role) continue;
      candidates.push({ targetRegion, actualRegion, iou: regionIoU(targetRegion, actualRegion) });
    }
  }
  candidates.sort((left, right) => right.iou - left.iou
    || String(left.targetRegion.id).localeCompare(String(right.targetRegion.id))
    || String(left.actualRegion.id).localeCompare(String(right.actualRegion.id)));
  const usedTarget = new Set(); const usedActual = new Set(); let sum = 0;
  for (const candidate of candidates) {
    if (usedTarget.has(candidate.targetRegion.id) || usedActual.has(candidate.actualRegion.id)) continue;
    usedTarget.add(candidate.targetRegion.id); usedActual.add(candidate.actualRegion.id); sum += candidate.iou;
  }
  return clamp01((2 * sum) / (target.length + actual.length));
}

function validRegion(row) {
  return row && row.role && [row.x, row.y, row.w, row.h].every(isNumericValue) && Number(row.w) >= 0 && Number(row.h) >= 0;
}

function regionIoU(left, right) {
  const x1 = Math.max(Number(left.x), Number(right.x));
  const y1 = Math.max(Number(left.y), Number(right.y));
  const x2 = Math.min(Number(left.x) + Number(left.w), Number(right.x) + Number(right.w));
  const y2 = Math.min(Number(left.y) + Number(left.h), Number(right.y) + Number(right.h));
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = Number(left.w) * Number(left.h) + Number(right.w) * Number(right.h) - intersection;
  return union > 0 ? intersection / union : 0;
}

function medianNumber(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function histSim(a, b) {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return Number.NaN;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const sumA = Object.values(a).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const sumB = Object.values(b).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  if (!sumA && !sumB) return 1;
  if (!sumA || !sumB) return 0;
  let distance = 0;
  for (const key of keys) distance += Math.abs((Number(a[key]) || 0) / sumA - (Number(b[key]) || 0) / sumB);
  return clamp01(1 - (0.5 * distance));
}

function numSim(actual, target, tolerance) {
  if (!bothNumber(actual, target) || !Number.isFinite(Number(tolerance)) || Number(tolerance) <= 0) return 0;
  return clamp01(1 - Math.min(1, Math.abs(Number(actual) - Number(target)) / Number(tolerance)));
}

function numSimRequired(actual, target, tolerance) {
  return bothNumber(actual, target) ? numSim(actual, target, tolerance) : 0;
}

function rangeSimRequired(actual, range, tolerance) {
  if (!isNumericValue(actual) || !Array.isArray(range) || range.length !== 2 || range.some((value) => !isNumericValue(value))) return 0;
  const value = Number(actual); const low = Number(range[0]); const high = Number(range[1]);
  return value >= low && value <= high ? 1 : numSim(value, value < low ? low : high, tolerance);
}

function catSim(actual, target) {
  return String(actual ?? "") === String(target ?? "") ? 1 : 0;
}

function meanRequired(values) {
  return values.length ? mean(values) : 0;
}

function weightedMean(rows) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.weight) || 0), 0);
  return total ? rows.reduce((sum, row) => sum + (Math.max(0, Number(row.weight) || 0) * clamp01(Number(row.score) || 0)), 0) / total : 0;
}

function mean(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function bothNumber(a, b) {
  return isNumericValue(a) && isNumericValue(b);
}

function finiteOrNull(value) {
  return isNumericValue(value) ? Number(value) : null;
}

function isNumericValue(value) {
  return value !== null && value !== undefined && value !== "" && typeof value !== "boolean" && Number.isFinite(Number(value));
}

function boundedRange(center, radius) {
  return [clamp01(center - radius), clamp01(center + radius)];
}

function densityBlocks(value) {
  return ({ sparse: 4, restrained: 6, balanced: 8, dense: 12 })[value] ?? null;
}

function densityRhythm(value) {
  return ({ sparse: 0.12, restrained: 0.09, balanced: 0.07, dense: 0.05 })[value] ?? null;
}

function scaleRatio(value) {
  return ({ compact: 1.6, balanced: 2.1, large_editorial: 2.8, oversized: 3.6 })[value] ?? null;
}

function radiusHistogram(values) {
  const result = { "0_2": 0, "3_7": 0, "8_15": 0, "16_plus": 0 };
  for (const raw of values || []) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (value <= 2) result["0_2"] += 1;
    else if (value <= 7) result["3_7"] += 1;
    else if (value <= 15) result["8_15"] += 1;
    else result["16_plus"] += 1;
  }
  return result;
}

function arrayOfNumbers(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (value && typeof value === "object") return Object.values(value).map(Number).filter(Number.isFinite);
  return [];
}

function styleRatio(value, mapping, fallback) {
  const key = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : fallback;
}

function normalizeFamily(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    graph: "connected_graph", connected: "connected_graph", flow: "connected_graph", architecture: "connected_graph",
    editorial: "editorial_split", split: "editorial_split", table: "evidence_table", matrix: "evidence_table",
    gantt: "timeline", roadmap: "timeline", commercial: "commercial_hero", cover: "cover_asymmetric", close: "decision_close",
  };
  return aliases[normalized] || normalized || null;
}

function resolveArtifactPath(value, baseDir) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function safeId(value) {
  return String(value || "UNKNOWN").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || "UNKNOWN";
}

function unique(values) {
  return [...new Set(values)];
}

function isHex(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value || ""));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function validatePolicy(policy) {
  const keys = Object.keys(policy.weights).sort();
  if (canonicalJson(keys) !== canonicalJson([...DIMENSIONS].sort())) throw new Error("Reference fidelity policy dimension keys are invalid");
  const sum = Object.values(policy.weights).reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 1e-12) throw new Error("Reference fidelity policy weights must sum to 1");
  const thresholds = [
    ...Object.values(policy.explicitFull.dimensionMin), policy.explicitFull.totalMin, policy.brandSystem.totalMin,
    ...Object.values(policy.brandSystem.dimensionMinOverrides), ...Object.values(policy.explicitPartial),
    policy.accentOnly.paletteMin, policy.accentOnly.defaultLayoutMatchRatioMin, policy.unexpectedImageryCoverageWarning, policy.unexpectedImageryCoverageZeroScore,
    policy.judgeDisagreementThreshold,
  ];
  if (thresholds.some((value) => typeof value === "number" && (value < 0 || value > 1))) throw new Error("Reference fidelity policy threshold is outside [0,1]");
  if (!Number.isInteger(policy.accentOnly.minimumComparablePages) || policy.accentOnly.minimumComparablePages < 2) throw new Error("Reference fidelity accent-only minimum page count is invalid");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

// CIE Lab and Delta-E 2000. Fidelity comparisons use this rather than RGB
// channel distance so perceptually similar colors are treated consistently.
function deltaESim(a, b) {
  const delta = deltaE2000(rgbToLab(hexToRgb(a)), rgbToLab(hexToRgb(b)));
  return clamp01(1 - Math.min(1, delta / 50));
}

function hexToRgb(hex) {
  const value = String(hex).replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function rgbToLab([r, g, b]) {
  const linear = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const x = ((linear[0] * 0.4124) + (linear[1] * 0.3576) + (linear[2] * 0.1805)) / 0.95047;
  const y = ((linear[0] * 0.2126) + (linear[1] * 0.7152) + (linear[2] * 0.0722));
  const z = ((linear[0] * 0.0193) + (linear[1] * 0.1192) + (linear[2] * 0.9505)) / 1.08883;
  const f = (value) => value > 0.008856 ? value ** (1 / 3) : (7.787 * value) + (16 / 116);
  const fx = f(x); const fy = f(y); const fz = f(z);
  return [(116 * fy) - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE2000([l1, a1, b1], [l2, a2, b2]) {
  const rad = Math.PI / 180; const deg = 180 / Math.PI;
  const c1 = Math.hypot(a1, b1); const c2 = Math.hypot(a2, b2); const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt((cBar ** 7) / ((cBar ** 7) + (25 ** 7))));
  const ap1 = (1 + g) * a1; const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1); const cp2 = Math.hypot(ap2, b2);
  const hp = (a, b) => { const angle = Math.atan2(b, a) * deg; return angle >= 0 ? angle : angle + 360; };
  const hp1 = hp(ap1, b1); const hp2 = hp(ap2, b2);
  const dL = l2 - l1; const dC = cp2 - cp1;
  let dh = hp2 - hp1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad);
  const lBar = (l1 + l2) / 2; const cpBar = (cp1 + cp2) / 2;
  let hBar = hp1 + hp2;
  if (cp1 * cp2 === 0) hBar = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hBar /= 2;
  else if (hBar < 360) hBar = (hBar + 360) / 2;
  else hBar = (hBar - 360) / 2;
  const t = 1 - (0.17 * Math.cos((hBar - 30) * rad)) + (0.24 * Math.cos(2 * hBar * rad)) + (0.32 * Math.cos((3 * hBar + 6) * rad)) - (0.20 * Math.cos((4 * hBar - 63) * rad));
  const sl = 1 + ((0.015 * ((lBar - 50) ** 2)) / Math.sqrt(20 + ((lBar - 50) ** 2)));
  const sc = 1 + (0.045 * cpBar); const sh = 1 + (0.015 * cpBar * t);
  const rt = -2 * Math.sqrt((cpBar ** 7) / ((cpBar ** 7) + (25 ** 7))) * Math.sin(60 * Math.exp(-(((hBar - 275) / 25) ** 2)) * rad);
  const dl = dL / sl; const dc = dC / sc; const dHn = dH / sh;
  return Math.sqrt((dl ** 2) + (dc ** 2) + (dHn ** 2) + (rt * dc * dHn));
}
