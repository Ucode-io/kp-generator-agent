import { validateKpContract } from "./kp_reference_contracts.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { inspectPdfVisualIntegrity } from "./kp_pdf_visual_qa.mjs";
import { inspectReferenceFidelity } from "./kp_pdf_fidelity_qa.mjs";
import { promoteCandidateAtomically, rollbackPromotedArtifact } from "./kp_pdf_promotion.mjs";
import { allocatePaymentPercentBasisPoints, assertCommercialLock, commercialPaymentBasisMinor, normalizeCommercialTeamPlan, toMinor } from "./kp_commercial_lock.mjs";
import {
  inspectCommercialPricingProvenance,
  inspectSemanticContentIntegrity,
  resolveExpectedClientLanguage,
} from "./kp_pdf_content_qa.mjs";

const GATE_NAMES = Object.freeze({
  G0: "contract_validation",
  G1: "reference_coverage",
  G2: "commercial_grounding",
  G3: "semantic_plan",
  G4: "dom_geometry",
  G5: "pdf_visual_integrity",
  G6: "reference_fidelity",
  G7: "atomic_promotion",
});

export function createQaReport(context = {}) {
  const now = context.startedAt || new Date().toISOString();
  return {
    schemaVersion: "2.0",
    requestId: context.requestId || "KP-20260713-LOCAL01",
    executionId: context.executionId || `${context.requestId || "KP-20260713-LOCAL01"}:v5-delivery`,
    executionVariant: context.executionVariant || "v5-delivery",
    rendererVersion: context.rendererVersion || "v5",
    mode: context.mode || "enforce",
    startedAt: now,
    finishedAt: null,
    status: "RUNNING",
    gates: Object.keys(GATE_NAMES).map((id) => ({ id, name: GATE_NAMES[id], status: "PENDING", enforced: true, durationMs: 0, metrics: {}, findings: [] })),
    summary: emptySummary({ pendingGateCount: Object.keys(GATE_NAMES).length }),
    findings: [],
    artifacts: {
      candidatePdf: null,
      renderDirectory: null,
      contactSheet: null,
      referenceProfile: null,
      referenceFidelity: null,
    },
  };
}

export function addQaFinding(report, finding) {
  const gate = report.gates.find((item) => item.id === finding.gateId);
  const normalized = normalizeFinding(finding);
  if (gate) gate.findings.push(normalized);
  report.findings.push(normalized);
  return report;
}

export function summarizeQaReport(report, policy = {}) {
  const findings = report.gates.flatMap((gate) => gate.findings || []);
  const summary = emptySummary();
  for (const gate of report.gates) {
    if (gate.enforced) summary.enforcedGateCount += 1;
    if (gate.status === "PASS") summary.passedGateCount += 1;
    else if (["FAIL", "ERROR"].includes(gate.status)) summary.failedGateCount += 1;
    else if (gate.status === "SKIP") summary.skippedGateCount += 1;
    else if (gate.status === "NOT_RUN") summary.notRunGateCount += 1;
    else if (gate.status === "PENDING") summary.pendingGateCount = (summary.pendingGateCount || 0) + 1;
  }
  for (const finding of findings) {
    const key = String(finding.severity || "ERROR").toLowerCase();
    if (summary[key] !== undefined) summary[key] += 1;
  }
  report.summary = summary;
  report.findings = findings;
  report.status = terminalStatus(report, policy);
  if (["PASS", "FAIL", "ERROR"].includes(report.status)) report.finishedAt ||= new Date().toISOString();
  return report;
}

export function assertQualityGate(report, policy = {}) {
  const finalized = summarizeQaReport(report, policy);
  const bad = finalized.findings.find((finding) => ["BLOCKER", "ERROR"].includes(finding.severity || "ERROR"));
  if (bad) throw Object.assign(new Error(bad.message || bad.code), { code: bad.code || "QA_GATE_FAILED" });
  const badGate = finalized.gates.find((gate) => ["FAIL", "ERROR"].includes(gate.status));
  if (badGate) throw Object.assign(new Error(`${badGate.id} quality gate failed without a blocking finding`), { code: "CONTRACT_QA_REPORT_INVALID", gateId: badGate.id });
  assertWarningBudgets(finalized, policy);
  return finalized;
}

export function assertReadyForPromotion(report, policy = {}) {
  const finalized = assertQualityGate(report, policy);
  const referenceMode = policy.referenceMode || "none";
  const requiredPassIds = ["G0", "G1", "G2", "G3", "G4", "G5"];
  const requiredPass = requiredPassIds.every((id) => finalized.gates.find((gate) => gate.id === id)?.status === "PASS");
  const g6Status = finalized.gates.find((gate) => gate.id === "G6")?.status;
  const fidelityReady = referenceMode === "none" ? ["PASS", "SKIP"].includes(g6Status) : g6Status === "PASS";
  const g7 = finalized.gates.find((gate) => gate.id === "G7");
  const g7AwaitingPromotion = g7?.status === "NOT_RUN" && g7.enforced === true && !(g7.findings || []).length;
  if (finalized.status !== "PASS_PENDING_PROMOTION" || !requiredPass || !fidelityReady || !g7AwaitingPromotion) {
    throw Object.assign(new Error("QA report is not ready for promotion"), {
      code: "QA_NOT_READY_FOR_PROMOTION",
      evidence: { referenceMode, requiredPass, g6Status, g7Status: g7?.status || null },
    });
  }
  return finalized;
}

export async function runContractGateG0(contracts = {}, { required = [] } = {}) {
  const findings = [];
  for (const requiredKey of required) {
    const value = contracts[requiredKey];
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
      const schemaName = schemaNameForContractKey(requiredKey);
      findings.push({
        code: contractCodeFor(schemaName),
        severity: "ERROR",
        schemaName,
        message: `Required ${schemaName} contract was not produced before rendering`,
        evidence: { contractKey: requiredKey, reason: "missing_required_contract" },
      });
    }
  }
  for (const [contractKey, value] of Object.entries(contracts)) {
    if (value === undefined || value === null) continue;
    const schemaName = schemaNameForContractKey(contractKey);
    const values = Array.isArray(value) && MULTI_CONTRACT_KEYS.has(contractKey) ? value : [value];
    for (const [index, contractValue] of values.entries()) {
      const result = await validateKpContract(schemaName, contractValue, { throwOnError: false });
      if (!result.ok) {
        findings.push(...result.errors.slice(0, 30).map((error) => ({
          code: contractCodeFor(schemaName),
          severity: "ERROR",
          schemaName,
          message: error.message,
          evidence: { ...error, contractKey, index: values.length > 1 ? index : null, totalErrorCount: result.errors.length },
        })));
      }
    }
  }
  return gate("G0", findings);
}

export function runReferenceCoverageGateG1({ manifest, captures = [], analyses = [], profile = null, referenceMode = null } = {}) {
  const findings = [];
  const mode = manifest?.referenceMode || referenceMode || "none";
  if (["explicit_full", "explicit_partial"].includes(mode) && !manifest) {
    findings.push({ code: "REF_EXPECTED_BUT_MISSING", severity: "BLOCKER", message: "Explicit reference mode requires an immutable EvidenceManifest" });
  }
  const visualItems = (manifest?.items || []).filter((item) => ["brand_system", "visual_style", "logo_asset"].includes(item.role));
  if (mode === "explicit_full" && !visualItems.some((item) => ["brand_system", "visual_style"].includes(item.role))) {
    findings.push({ code: "REF_EXPECTED_BUT_MISSING", severity: "BLOCKER", message: "Explicit full reference mode has no brand/style reference" });
  }
  if (mode === "explicit_full" && !manifest?.primaryVisualReferenceId) {
    findings.push({ code: "REF_PRIMARY_NOT_ANALYZED", severity: "BLOCKER", message: "Explicit full reference has no primary visual reference" });
  }
  for (const item of visualItems) {
    const capture = captures.find((entry) => entry.referenceId === item.id);
    if (!capture || !["complete", "partial"].includes(capture.status)) findings.push({ code: "REF_PRIMARY_NOT_ANALYZED", severity: "BLOCKER", referenceId: item.id, message: "Selected visual reference has no usable capture" });
    const analysis = analyses.find((entry) => entry.referenceId === item.id);
    if (!analysis || !["complete", "partial"].includes(analysis.status)) findings.push({ code: "REF_PRIMARY_NOT_ANALYZED", severity: "BLOCKER", referenceId: item.id, message: "Selected visual reference has no usable analysis" });
  }
  if (["explicit_full", "explicit_partial"].includes(mode) && !(profile?.referenceIds || []).length) {
    findings.push({ code: "REF_STYLE_DIMENSION_UNTRACED", severity: "BLOCKER", message: "Explicit reference profile has no traceable reference IDs" });
  }
  if (mode === "explicit_full" && ["fallback_default", "fallback_partial", "failed"].includes(profile?.status)) {
    findings.push({ code: "REF_ACCENT_ONLY", severity: "BLOCKER", message: "Explicit full reference resolved to fallback/accent-only style" });
  }
  if (mode === "explicit_partial" && !["fallback_partial", "reference_driven"].includes(profile?.status)) {
    findings.push({ code: "REF_REFERENCE_MODE_INVALID", severity: "BLOCKER", message: "Explicit partial reference did not produce a partial/reference-driven profile" });
  }
  return gate("G1", findings);
}

export function buildQaReportV2(requestId, gates = []) {
  const report = createQaReport({ requestId });
  for (const gateResult of gates) setGate(report, gateResult);
  return summarizeQaReport(report);
}

export async function runPreRenderQualityGate(input = {}, options = {}) {
  const requestContext = input.requestContext || options.ctx?.requestContext || options.ctx;
  const referenceMode = input.manifest?.referenceMode || input.referenceMode || requestContext?.routing?.referenceModeHint || "none";
  const report = createQaReport({
    requestId: requestContext?.requestId || input.presentationPlan?.requestId || input.semanticModel?.requestId,
    executionId: input.executionId || options.ctx?.executionId,
    executionVariant: input.executionVariant || options.ctx?.executionVariant,
    mode: options.policy?.mode || options.ctx?.mode || "enforce",
  });
  const contracts = {
    requestContext,
    ...(input.manifest ? { evidenceManifest: input.manifest } : {}),
    ...(input.captures?.length ? { referenceCaptures: input.captures } : {}),
    ...(input.analyses?.length ? { referenceAnalyses: input.analyses } : {}),
    visualStyleProfile: input.styleProfile,
    proposalModel: input.proposalModel,
    commercialLock: input.commercialLock,
    proposalSemanticModel: input.semanticModel,
    presentationPlan: input.presentationPlan,
    visualizationSpecs: input.visualizationSpecs,
    proposalPackage: input.proposalPackage,
    ...(input.fidelityTargets ? { referenceFidelityTargets: input.fidelityTargets } : {}),
  };
  setGate(report, await runContractGateG0(contracts, {
    required: ["requestContext", "visualStyleProfile", "proposalModel", "commercialLock", "proposalSemanticModel", "presentationPlan", "visualizationSpecs", "proposalPackage"],
  }));
  setGate(report, runReferenceCoverageGateG1({
    manifest: input.manifest,
    captures: input.captures || [],
    analyses: input.analyses || [],
    profile: input.styleProfile,
    referenceMode,
  }));
  setGate(report, runCommercialGroundingGateG2({
    proposalModel: input.proposalModel,
    semanticModel: input.semanticModel,
    commercialLock: input.commercialLock,
  }));
  setGate(report, runSemanticPlanGateG3({
    visualizationValidation: input.visualizationValidation,
    visualizationSpecs: input.visualizationSpecs,
    presentationPlan: input.presentationPlan,
    requestContext,
    proposalModel: input.proposalModel,
    semanticModel: input.semanticModel,
    commercialLock: input.commercialLock,
  }));
  return validateQaReport(await validateQaReportContract(summarizeQaReport(report, options.policy)));
}

export async function recordDomGeometryGateG4(report, domReport, policy = {}) {
  if (!report) throw Object.assign(new Error("G4 requires the pre-render QA report"), { code: "CONTRACT_QA_REPORT_INVALID" });
  const findings = Array.isArray(domReport?.findings)
    ? [...domReport.findings]
    : [{ code: "DOM_RENDER_NOT_READY", severity: "BLOCKER", message: "DOM inspection did not return a report" }];
  const pageCount = Number(domReport?.pageCount || 0);
  const uiHardcheck = domReport?.uiHardcheck || {};
  const clientContentPolicy = domReport?.clientContentPolicy || {};
  if (uiHardcheck.enabled !== true) {
    findings.push({
      code: "DOM_UI_HARDCHECK_NOT_RUN",
      severity: "BLOCKER",
      message: "The reference-driven UI hard-check did not run",
      evidence: { enabled: uiHardcheck.enabled ?? null, pageCount },
    });
  } else if (
    pageCount < 1
    || Number(uiHardcheck.checkedPageCount || 0) !== pageCount
    || Number(uiHardcheck.passedPageCount || 0) !== pageCount
    || Number(uiHardcheck.failedPageCount || 0) !== 0
    || !Array.isArray(uiHardcheck.perPage)
    || uiHardcheck.perPage.length !== pageCount
  ) {
    findings.push({
      code: "DOM_UI_HARDCHECK_INCOMPLETE",
      severity: "BLOCKER",
      message: "The UI hard-check did not pass every rendered page",
      evidence: {
        pageCount,
        checkedPageCount: Number(uiHardcheck.checkedPageCount || 0),
        passedPageCount: Number(uiHardcheck.passedPageCount || 0),
        failedPageCount: Number(uiHardcheck.failedPageCount || 0),
        perPageCount: Array.isArray(uiHardcheck.perPage) ? uiHardcheck.perPage.length : 0,
      },
    });
  }
  if (clientContentPolicy.enabled !== true) {
    findings.push({
      code: "DOM_CLIENT_CONTENT_POLICY_NOT_RUN",
      severity: "BLOCKER",
      message: "The client-content policy did not run for the rendered proposal",
      evidence: { enabled: clientContentPolicy.enabled ?? null },
    });
  } else if (
    clientContentPolicy.policyVersion !== "1.0"
    || pageCount < 1
    || Number(clientContentPolicy.plannedPageCount || 0) !== pageCount
    || Number(clientContentPolicy.checkedPageCount || 0) !== pageCount
    || Number(clientContentPolicy.passedPageCount || 0) !== pageCount
    || Number(clientContentPolicy.failedPageCount || 0) !== 0
    || !Array.isArray(clientContentPolicy.perPage)
    || clientContentPolicy.perPage.length !== pageCount
    || Number(clientContentPolicy.factualOriginMissingPageCount || 0) !== 0
  ) {
    findings.push({
      code: "DOM_CLIENT_CONTENT_POLICY_INCOMPLETE",
      severity: "BLOCKER",
      message: "The client-content policy did not inspect and pass every rendered page",
      evidence: {
        policyVersion: clientContentPolicy.policyVersion || null,
        pageCount,
        plannedPageCount: Number(clientContentPolicy.plannedPageCount || 0),
        checkedPageCount: Number(clientContentPolicy.checkedPageCount || 0),
        passedPageCount: Number(clientContentPolicy.passedPageCount || 0),
        failedPageCount: Number(clientContentPolicy.failedPageCount || 0),
        perPageCount: Array.isArray(clientContentPolicy.perPage) ? clientContentPolicy.perPage.length : 0,
        factualOriginMissingPageCount: Number(clientContentPolicy.factualOriginMissingPageCount || 0),
      },
    });
  }
  const expectedClientLanguage = report.gates.find((item) => item.id === "G3")?.metrics?.expectedClientLanguage || null;
  const declaredClientLanguage = domReport?.clientLanguage?.declaredLanguage || null;
  if (expectedClientLanguage && declaredClientLanguage && !clientLocalesMatch(expectedClientLanguage, declaredClientLanguage)) {
    findings.push({
      code: "DOM_CLIENT_LANGUAGE_DECLARATION_MISMATCH",
      severity: "BLOCKER",
      message: "Rendered HTML language declaration differs from the brief source language",
      evidence: { expectedClientLanguage, declaredClientLanguage },
      remediation: "Set the HTML lang value from groundedBrief.sourceLanguage or brief.locale and render the same language in visible client copy.",
    });
  }
  setGate(report, gate("G4", findings, {
    pageCount,
    visualizationCount: Number(domReport?.visualizationCount || 0),
    nodeCount: Number(domReport?.nodeCount || 0),
    edgeCount: Number(domReport?.edgeCount || 0),
    uiHardcheckEnabled: domReport?.uiHardcheck?.enabled === true,
    uiHardcheckCheckedPageCount: Number(domReport?.uiHardcheck?.checkedPageCount || 0),
    uiHardcheckPassedPageCount: Number(domReport?.uiHardcheck?.passedPageCount || 0),
    uiHardcheckFailedPageCount: Number(domReport?.uiHardcheck?.failedPageCount || 0),
    uiHardcheckPages: Array.isArray(domReport?.uiHardcheck?.perPage) ? domReport.uiHardcheck.perPage : [],
    expectedClientLanguage,
    declaredClientLanguage,
    detectedClientLanguage: domReport?.clientLanguage?.detectedLanguage || null,
  }));
  return validateQaReport(await validateQaReportContract(summarizeQaReport(report, policy)));
}

export async function runPostRenderQualityGate(input = {}, options = {}) {
  if (!input.report) throw Object.assign(new Error("Post-render QA requires the pre-render/G4 report"), { code: "CONTRACT_QA_REPORT_INVALID" });
  const report = input.report;
  const incompletePrePdfGate = ["G0", "G1", "G2", "G3", "G4"].find((id) => report.gates.find((gate) => gate.id === id)?.status !== "PASS");
  if (incompletePrePdfGate) {
    throw Object.assign(new Error(`${incompletePrePdfGate} did not pass before PDF inspection`), {
      code: "QA_NOT_READY_FOR_POST_RENDER",
      gateId: incompletePrePdfGate,
    });
  }
  if (input.candidatePdf) report.artifacts.candidatePdf = relativeArtifact(input.candidatePdf);
  if (input.outputDir) report.artifacts.renderDirectory = relativeArtifact(input.outputDir);
  const expectedPageCount = Number(options.policy?.expectedPageCount || input.presentationPlan?.pageCount || 0);
  if (!Number.isInteger(expectedPageCount) || expectedPageCount < 1) {
    throw Object.assign(new Error("G5 requires an explicit page count from the validated presentation plan"), {
      code: "PDF_QA_CONTEXT_MISSING",
      gateId: "G5",
    });
  }
  const pdfQa = await inspectPdfVisualIntegrity(input.candidatePdf, input.outputDir || path.join(path.dirname(input.candidatePdf), "qa-render"), {
    expectedPageCount,
    expectedAspectRatio: options.policy?.expectedAspectRatio ?? 1.5,
    maxFileSizeBytes: options.policy?.maxPdfBytes,
    mode: "v5",
    requireFullContext: true,
    presentationPlan: input.presentationPlan,
    proposalModel: input.proposalModel,
    commercialLock: input.commercialLock,
    domReport: input.domReport,
  });
  if (pdfQa.contactSheet) report.artifacts.contactSheet = relativeArtifact(pdfQa.contactSheet);
  const g5 = gate("G5", pdfQa.findings || [], {
    pageCount: pdfQa.pdfPageCount,
    renderedPageCount: pdfQa.renderedPageCount,
    candidateSha256: pdfQa.pdfSha256,
    candidateSizeBytes: pdfQa.pdfSizeBytes,
    visualIntegrityJson: relativeArtifact(pdfQa.visualIntegrityJson),
  });
  setGate(report, g5);
  if (g5.status !== "PASS") {
    setGate(report, causalSkipGate("G6", "G5"));
    setGate(report, causalSkipGate("G7", "G5"));
    await validateQaArtifacts(report, { cwd: process.cwd() });
    return validateQaReport(await validateQaReportContract(summarizeQaReport(report, options.policy)));
  }
  const fidelity = await inspectReferenceFidelity({
    ...input,
    visualIntegrity: pdfQa,
    renderedPages: pdfQa.pages,
    domReport: input.domReport,
  }, {
    outputDir: input.outputDir,
    targetRelativePath: "reference/fidelity-targets.json",
  });
  const fidelityPath = path.join(input.outputDir || path.join(path.dirname(input.candidatePdf), "qa-render"), "reference-fidelity.json");
  await fs.mkdir(path.dirname(fidelityPath), { recursive: true });
  await fs.writeFile(fidelityPath, `${JSON.stringify(fidelity, null, 2)}\n`, "utf8");
  report.artifacts.referenceFidelity = relativeArtifact(fidelityPath);
  const g6 = {
    ...gate("G6", fidelity.findings || [], {
      ...(fidelity.metrics || {}),
      referenceFidelityJson: relativeArtifact(fidelityPath),
    }),
    status: fidelity.status === "SKIP" ? "SKIP" : (fidelity.status === "PASS" ? "PASS" : "FAIL"),
  };
  setGate(report, g6);
  if (!["PASS", "SKIP"].includes(g6.status)) setGate(report, causalSkipGate("G7", "G6"));
  else setGate(report, { id: "G7", status: "NOT_RUN", enforced: true, findings: [], metrics: { reason: "awaiting_atomic_promotion" } });
  await validateQaArtifacts(report, { cwd: process.cwd() });
  return validateQaReport(await validateQaReportContract(summarizeQaReport(report, options.policy)));
}

export async function runPromotionGateG7(input = {}, options = {}) {
  const report = assertReadyForPromotion(input.report, options.policy);
  const g5 = report.gates.find((gate) => gate.id === "G5");
  const expectedCandidateSha256 = g5?.metrics?.candidateSha256;
  if (!/^sha256:[0-9a-f]{64}$/.test(String(expectedCandidateSha256 || ""))) {
    throw Object.assign(new Error("G5 did not record the candidate PDF hash"), { code: "ARTIFACT_QA_REPORT_INVALID" });
  }
  if (!input.qaReportPath) throw Object.assign(new Error("Canonical QA report path is required for G7"), { code: "ARTIFACT_QA_REPORT_INVALID" });
  await fs.mkdir(path.dirname(input.qaReportPath), { recursive: true });
  await fs.writeFile(input.qaReportPath, `${JSON.stringify(await validateQaReportContract(report), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  let result = null;
  try {
    result = await promoteCandidateAtomically({
      ...input,
      expectedCandidateSha256,
      requireQaReady: true,
    });
    if (result.candidateSha256 !== expectedCandidateSha256 || result.finalSha256 !== expectedCandidateSha256) {
      throw Object.assign(new Error("Promoted PDF hash does not match G5"), { code: "ARTIFACT_HASH_MISMATCH" });
    }
    setGate(report, gate("G7", [], {
      ...result,
      verifiedCandidateSha256: expectedCandidateSha256,
    }));
    report.status = "PASS";
    report.finishedAt = new Date().toISOString();
    const finalReport = validateQaReport(await validateQaReportContract(summarizeQaReport(report, options.policy)));
    if (finalReport.status !== "PASS" || finalReport.gates.find((gate) => gate.id === "G7")?.status !== "PASS") {
      throw Object.assign(new Error("G7 could not finalize a canonical PASS report"), { code: "ARTIFACT_QA_REPORT_INVALID" });
    }
    await fs.writeFile(input.qaReportPath, `${JSON.stringify(finalReport, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return { report: finalReport, promotion: result };
  } catch (error) {
    if (result?.createdFinalByThisAttempt && input.workspace && input.finalRelativePath) {
      await rollbackPromotedArtifact({
        workspace: input.workspace,
        finalRelativePath: input.finalRelativePath,
        expectedSha256: result.finalSha256,
      }).catch((rollbackError) => {
        error.rollbackErrorCode = String(rollbackError?.code || "ARTIFACT_ROLLBACK_FAILED");
      });
    }
    const findingCode = /^ARTIFACT_[A-Z0-9_]+$/.test(String(error?.code || "")) ? error.code : "ARTIFACT_PROMOTION_FAILED";
    setGate(report, gate("G7", [{
      code: findingCode,
      severity: "BLOCKER",
      message: "Atomic PDF promotion did not complete",
      evidence: { causeCode: String(error?.code || "ARTIFACT_PROMOTION_FAILED") },
      remediation: "Keep the candidate quarantined and retry only through recovery.",
    }]));
    const failedReport = validateQaReport(await validateQaReportContract(summarizeQaReport(report, options.policy)));
    await fs.writeFile(input.qaReportPath, `${JSON.stringify(failedReport, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }).catch(() => {});
    error.qaReport = failedReport;
    throw error;
  }
}

export function runCommercialGroundingGateG2({ proposalModel = {}, semanticModel = {}, commercialLock = null } = {}) {
  const findings = [];
  if (!commercialLock) {
    findings.push({ code: "COMMERCIAL_LOCK_CHANGED", severity: "BLOCKER", message: "CommercialLock is required before G2" });
    return gate("G2", findings);
  }
  try {
    assertCommercialLock(commercialLock, proposalModel);
  } catch (error) {
    findings.push({
      code: "COMMERCIAL_LOCK_CHANGED",
      severity: "BLOCKER",
      message: "Commercial lock hash/equation no longer matches the proposal model",
      evidence: { causeCode: String(error?.code || "COMMERCIAL_LOCK_CHANGED") },
    });
  }
  const lockHashCopies = [
    proposalModel?.commercialLockHash,
    semanticModel?.commercialLockHash,
    semanticModel?.commercial?.commercialLockHash,
  ].filter((value) => value !== undefined && value !== null);
  if (!lockHashCopies.length || lockHashCopies.some((value) => value !== commercialLock.lockHash)) {
    findings.push({
      code: "COMMERCIAL_LOCK_CHANGED",
      severity: "BLOCKER",
      message: "Proposal/semantic contracts do not carry the exact persisted commercial lock hash",
      evidence: { copyCount: lockHashCopies.length, mismatchCount: lockHashCopies.filter((value) => value !== commercialLock.lockHash).length },
    });
  }
  const includedExternalMinor = (commercialLock.pricing?.externalRows || [])
    .filter((row) => row.includedInProjectPrice === true)
    .reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
  // With no locked price, a positive development subtotal is only valid as a
  // budget-allocation scenario reconciled to the recorded allocation basis.
  const allocationBasisMinor = Number(commercialLock.pricing?.allocationBasisMinor) > 0 ? Number(commercialLock.pricing.allocationBasisMinor) : 0;
  const developmentMinor = Number(commercialLock.pricing?.developmentSubtotalMinor || 0);
  const equationReconciles = commercialLock.projectPriceMinor > 0 || !allocationBasisMinor
    ? commercialLock.projectPriceMinor === developmentMinor + includedExternalMinor
    : developmentMinor + includedExternalMinor === allocationBasisMinor;
  if (!equationReconciles) {
    findings.push({ code: "COMMERCIAL_PROJECT_EQUATION_MISMATCH", severity: "BLOCKER", message: "Locked project price equation does not reconcile" });
  }
  const functionMinor = (commercialLock.functionPrice || []).reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
  if (functionMinor !== commercialLock.functionPriceSubtotalMinor) {
    findings.push({ code: "COMMERCIAL_FUNCTION_SUM_MISMATCH", severity: "BLOCKER", message: "Locked function rows do not reconcile to their subtotal" });
  }
  const paymentMinor = (commercialLock.payments || []).reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
  if ((commercialLock.payments || []).length && paymentMinor !== commercialPaymentBasisMinor(commercialLock)) {
    findings.push({ code: "COMMERCIAL_PAYMENT_SUM_MISMATCH", severity: "BLOCKER", message: "Locked payment rows do not reconcile to the project price or stated budget basis" });
  }
  const paymentBasisPoints = (commercialLock.payments || []).reduce((sum, row) => sum + Number(row.percentBasisPoints || 0), 0);
  if ((commercialLock.payments || []).length && paymentBasisPoints !== 10_000) {
    findings.push({ code: "COMMERCIAL_PERCENT_SUM_MISMATCH", severity: "BLOCKER", message: "Locked payment percentages do not sum to exactly 100.00%", evidence: { actualBasisPoints: paymentBasisPoints } });
  }
  findings.push(...inspectCommercialPricingProvenance({ proposalModel, semanticModel, commercialLock }));
  findings.push(...inspectUnknownCurrencyLock({ proposalModel, semanticModel, commercialLock }));
  findings.push(...inspectPaymentRounding({ proposalModel, semanticModel, commercialLock }));
  try {
    const modelFunctionRows = proposalModel.functionPrice || [];
    if (modelFunctionRows.length !== (commercialLock.functionPrice || []).length) throw new Error("function row count");
    modelFunctionRows.forEach((row, index) => {
      const locked = commercialLock.functionPrice[index];
      const modelId = row.id || `FP-${String(index + 1).padStart(3, "0")}`;
      const modelName = String(row.name || row.title || row.feature || `Function ${index + 1}`);
      const amountMinor = toMinor(row.total ?? row.amount ?? 0, commercialLock.currencyExponent);
      if (modelId !== locked.id || modelName !== locked.name || amountMinor !== locked.amountMinor) throw new Error(`function row ${index + 1}`);
    });
    const modelPaymentRows = proposalModel.payments || [];
    if (modelPaymentRows.length !== (commercialLock.payments || []).length) throw new Error("payment row count");
    modelPaymentRows.forEach((row, index) => {
      const locked = commercialLock.payments[index];
      const modelId = row.id || `PAY-${String(index + 1).padStart(3, "0")}`;
      const modelName = String(row.name || row.label || `Payment ${index + 1}`);
      const amountMinor = toMinor(row.amount ?? 0, commercialLock.currencyExponent);
      const acceptance = String(row.acceptance || row.due || "Acceptance trigger to confirm");
      if (modelId !== locked.id || modelName !== locked.name || amountMinor !== locked.amountMinor || Number(row.order ?? index + 1) !== locked.order || acceptance !== locked.acceptance) throw new Error(`payment row ${index + 1}`);
    });
    const modelScopeRows = (proposalModel.scope || []).filter((row) => isCommerciallyExplicitScopeRow(row, proposalModel.sources));
    if (modelScopeRows.length !== (commercialLock.explicitScopeRows || []).length) throw new Error("scope row count");
    modelScopeRows.forEach((row, index) => {
      const locked = commercialLock.explicitScopeRows[index];
      const expected = {
        id: row.id || `SCOPE-${String(index + 1).padStart(3, "0")}`,
        label: String(row.label || row.feature || row.epic || `Scope ${index + 1}`),
        ownership: String(row.ownership || "owned"),
        inclusion: String(row.inclusion || (row.ownership === "deferred" ? "deferred" : "in_scope")),
        truthStatus: String(row.truthStatus || "explicit"),
        sourceIds: row.sourceIds || [],
      };
      if (JSON.stringify(expected) !== JSON.stringify(locked)) throw new Error(`scope row ${index + 1}`);
    });
    const modelTeam = proposalModel.teamPlan || {};
    const expectedTeam = normalizeCommercialTeamPlan(modelTeam, {
      durationMonths: Number(proposalModel.durationMonths || proposalModel.duration?.months || 0),
    });
    if (JSON.stringify(expectedTeam) !== JSON.stringify(commercialLock.teamPlan)) throw new Error("team plan");
    if (Number(proposalModel.durationMonths || proposalModel.duration?.months || 0) !== commercialLock.durationMonths) throw new Error("duration months");
    if (Number(proposalModel.durationWeeks || proposalModel.duration?.weeks || 0) !== commercialLock.durationWeeks) throw new Error("duration weeks");
    const modelCurrency = String(proposalModel.pricing?.currency || "USD").toUpperCase();
    if (modelCurrency !== commercialLock.currency) throw new Error("currency");
  } catch (error) {
    findings.push({ code: "COMMERCIAL_LOCK_CHANGED", severity: "BLOCKER", message: "Proposal commercial rows differ from the persisted minor-unit lock", evidence: { mismatch: String(error.message || "row mismatch") } });
  }
  const semanticPrice = semanticModel?.commercial?.projectPrice;
  if (semanticPrice !== undefined && semanticPrice !== null) {
    try {
      if (toMinor(semanticPrice, commercialLock.currencyExponent) !== commercialLock.projectPriceMinor) throw new Error("semantic project price");
    } catch {
      findings.push({ code: "COMMERCIAL_LOCK_CHANGED", severity: "BLOCKER", message: "Semantic commercial total differs from the persisted lock" });
    }
  }
  return gate("G2", findings);
}

function isCommerciallyExplicitScopeRow(row = {}, sources = []) {
  const truthStatus = String(row.truthStatus || "").toLowerCase();
  const inclusion = String(row.inclusion || "").toLowerCase();
  const priority = String(row.priority || "").toLowerCase();
  if (inclusion === "requested" || /requested|confirmed|committed/.test(priority)) return true;
  if (truthStatus !== "explicit") return false;
  const clientBriefIds = new Set((sources || [])
    .filter((source) => String(source?.type || "").toLowerCase() === "client_brief")
    .map((source) => String(source?.id || ""))
    .filter(Boolean));
  return (row.sourceIds || []).some((sourceId) => {
    const id = String(sourceId || "");
    return id === "SRC-PROMPT" || clientBriefIds.has(id);
  });
}

export function runSemanticPlanGateG3({
  visualizationValidation,
  visualizationSpecs = [],
  presentationPlan = null,
  requestContext = {},
  proposalModel = {},
  semanticModel = {},
  commercialLock = null,
} = {}) {
  const findings = [...(visualizationValidation?.findings || [])];
  if (!visualizationValidation || visualizationValidation.ok !== true) {
    if (!findings.length) findings.push({ code: "CONTRACT_VISUALIZATION_SPEC_INVALID", severity: "ERROR", message: "Visualization validation did not return an explicit success" });
  }
  const requiredPages = (presentationPlan?.pages || []).filter((page) => page.visualizationSpecId || page.visualizationId);
  for (const page of requiredPages) {
    const pageNumber = Number(page.pageNumber);
    const specId = page?.visualizationSpecId || page?.visualizationId;
    const spec = visualizationSpecs.find((row) => (row.visualizationSpecId || row.id) === specId && Number(row.pageNumber) === pageNumber);
    if (!page || !specId || !spec) findings.push({ code: "CONTRACT_VISUALIZATION_SPEC_INVALID", severity: "ERROR", page: pageNumber, message: `Page ${pageNumber} is missing its validated semantic visualization` });
    if (page && page.layoutFamily !== "connected_graph" && !["market_sizing", "roadmap"].includes(page.kind)) {
      findings.push({ code: "VIZ_GENERIC_GRID_FORBIDDEN", severity: "BLOCKER", page: pageNumber, message: `Page ${pageNumber} cannot use ${page.layoutFamily} for a semantic diagram` });
    }
  }
  findings.push(...inspectSemanticContentIntegrity({
    requestContext,
    proposalModel,
    semanticModel,
    commercialLock,
    presentationPlan,
  }));
  return gate("G3", findings, {
    expectedClientLanguage: resolveExpectedClientLanguage({ requestContext, proposalModel }),
  });
}

function inspectUnknownCurrencyLock({ proposalModel, semanticModel, commercialLock }) {
  const groundedCurrency = proposalModel.groundedBrief?.budget?.currency || {};
  const groundingStatus = String(
    groundedCurrency.status
      || proposalModel.pricing?.currencyTruthStatus
      || proposalModel.pricing?.currencyStatus
      || "",
  ).toLowerCase();
  const currencies = {
    grounded: String(groundedCurrency.value || "XXX").toUpperCase(),
    proposal: String(proposalModel.pricing?.currency || "").toUpperCase(),
    semantic: String(semanticModel.commercial?.currency || "").toUpperCase(),
    lock: String(commercialLock.currency || "").toUpperCase(),
  };
  const pricingStatus = String(proposalModel.pricing?.currencyStatus || "").toLowerCase();
  if (groundingStatus === "explicit") {
    const values = Object.values(currencies);
    const concreteGroundedCurrency = /^[A-Z]{3}$/.test(currencies.grounded) && currencies.grounded !== "XXX";
    const exactProjection = concreteGroundedCurrency
      && values.every((currency) => currency === currencies.grounded)
      && pricingStatus === "explicit";
    if (exactProjection) return [];
    return [{
      code: "COMMERCIAL_CURRENCY_PROJECTION_MISMATCH",
      severity: "BLOCKER",
      message: "An explicitly supplied currency changed between the grounded brief, proposal, semantic model, or commercial lock",
      evidence: { groundingStatus, pricingStatus: pricingStatus || null, currencies },
      remediation: "Copy the exact explicit currency through every contract and reject the proposal if any projection differs.",
    }];
  }
  if (!["assumed", "unknown"].includes(groundingStatus)) return [];
  const canonicalUnknown = currencies.proposal === "XXX"
    && currencies.semantic === "XXX"
    && currencies.lock === "XXX"
    && pricingStatus === "unknown";
  if (canonicalUnknown) return [];
  return [{
    code: "COMMERCIAL_CURRENCY_UNGROUNDED",
    severity: "BLOCKER",
    message: "An assumed or unknown currency was hard-locked as a concrete commercial currency",
    evidence: { groundingStatus, pricingStatus: pricingStatus || null, currencies },
    remediation: "Persist currency=XXX and pricing.currencyStatus=unknown until the client explicitly confirms USD, EUR, UZS, or another concrete currency.",
  }];
}

function inspectPaymentRounding({ proposalModel, semanticModel, commercialLock }) {
  const payments = commercialLock.payments || [];
  const mismatches = [];
  try {
    const allocated = allocatePaymentPercentBasisPoints(payments, commercialPaymentBasisMinor(commercialLock));
    payments.forEach((row, index) => {
      if (Number(row.percentBasisPoints) !== allocated[index]) {
        mismatches.push({ source: "commercialLock", paymentId: row.id || null, expectedBasisPoints: allocated[index], actualBasisPoints: Number(row.percentBasisPoints) });
      }
    });
  } catch (error) {
    mismatches.push({ source: "commercialLock", paymentId: null, reason: String(error?.code || "allocation_failed") });
  }
  comparePaymentProjection(proposalModel.payments, payments, "proposalModel", commercialLock.currencyExponent, mismatches);
  comparePaymentProjection(semanticModel.commercial?.payments, payments, "semanticModel", commercialLock.currencyExponent, mismatches);
  if (!mismatches.length) return [];
  return [{
    code: "COMMERCIAL_PERCENT_ROUNDING_MISMATCH",
    severity: "BLOCKER",
    message: "Payment amounts and displayed percentages do not share the persisted exact basis-point allocation",
    evidence: { mismatches: mismatches.slice(0, 16), mismatchCount: mismatches.length },
    remediation: "Allocate 10,000 basis points from minor-unit amounts once, persist the result, and reuse it in model, semantic model, renderer, and QA.",
  }];
}

function comparePaymentProjection(rowsValue, lockedRows, source, currencyExponent, output) {
  if (rowsValue === undefined || rowsValue === null) return;
  const rows = Array.isArray(rowsValue) ? rowsValue : [];
  if (!rows.length && !lockedRows.length) return;
  if (rows.length !== lockedRows.length) {
    output.push({ source, paymentId: null, reason: "row_count_mismatch", expectedCount: lockedRows.length, actualCount: rows.length });
    return;
  }
  rows.forEach((row, index) => {
    const locked = lockedRows[index];
    const rowId = String(row.id || "");
    if (rowId && rowId !== String(locked.id || "")) {
      output.push({ source, paymentId: rowId, reason: "id_mismatch", expectedId: locked.id || null });
    }
    const rawAmount = row.amountMinor !== undefined ? Number(row.amountMinor) : safeProjectionMinor(row.amount ?? row.total, currencyExponent);
    if (rawAmount !== null && rawAmount !== Number(locked.amountMinor)) {
      output.push({ source, paymentId: locked.id || rowId || null, reason: "amount_mismatch", expectedMinor: Number(locked.amountMinor), actualMinor: rawAmount });
    }
    const rawBasisPoints = row.percentBasisPoints !== undefined
      ? Number(row.percentBasisPoints)
      : row.percent !== undefined || row.percentage !== undefined
        ? Math.round(Number(row.percent ?? row.percentage) * 100)
        : null;
    if (rawBasisPoints !== null && Number.isFinite(rawBasisPoints) && rawBasisPoints !== Number(locked.percentBasisPoints)) {
      output.push({ source, paymentId: locked.id || rowId || null, reason: "percent_mismatch", expectedBasisPoints: Number(locked.percentBasisPoints), actualBasisPoints: rawBasisPoints });
    }
  });
}

function safeProjectionMinor(value, exponent) {
  if (value === undefined || value === null || value === "") return null;
  try {
    return toMinor(value, exponent);
  } catch {
    return Number.NaN;
  }
}

function clientLocalesMatch(expectedValue, declaredValue) {
  const expected = normalizeClientLocale(expectedValue);
  const declared = normalizeClientLocale(declaredValue);
  if (!expected || !declared || expected.code !== declared.code) return false;
  if (expected.code !== "uz") return true;
  return expected.script === declared.script;
}

function normalizeClientLocale(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("uz")) return { code: "uz", script: /cyrl/.test(normalized) ? "Cyrl" : "Latn" };
  if (normalized.startsWith("ru")) return { code: "ru", script: "Cyrl" };
  if (normalized.startsWith("en")) return { code: "en", script: "Latn" };
  return null;
}

export async function validateQaArtifacts(report, { cwd = process.cwd() } = {}) {
  const artifactPaths = [
    report.artifacts?.candidatePdf,
    report.artifacts?.contactSheet,
    report.artifacts?.referenceFidelity,
    ...report.gates.flatMap((gate) => [
      gate.metrics?.visualIntegrityJson,
      gate.metrics?.referenceFidelityJson,
    ]),
  ].filter(Boolean);
  for (const artifact of artifactPaths) {
    const filePath = path.isAbsolute(artifact) ? artifact : path.join(cwd, artifact);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size < 1) {
      throw Object.assign(new Error(`QA artifact is missing or empty: ${artifact}`), { code: "QA_ARTIFACT_MISSING", artifact });
    }
  }
  return true;
}

function gate(id, findings = [], metrics = {}) {
  const normalizedFindings = findings.map(normalizeFinding);
  return {
    id,
    name: GATE_NAMES[id] || id,
    status: normalizedFindings.some((finding) => ["BLOCKER", "ERROR"].includes(finding.severity)) ? "FAIL" : "PASS",
    enforced: true,
    durationMs: 0,
    metrics,
    findings: normalizedFindings,
  };
}

function causalSkipGate(id, causedBy) {
  return {
    id,
    name: GATE_NAMES[id] || id,
    status: "SKIP",
    enforced: true,
    durationMs: 0,
    metrics: { reason: "blocked_by_prior_gate", causedBy },
    findings: [{
      code: "QA_DEPENDENT_GATE_SKIPPED",
      severity: "INFO",
      message: `${id} was not run because ${causedBy} failed`,
      evidence: { causedBy },
    }],
  };
}

function setGate(report, gateResult) {
  const index = report.gates.findIndex((item) => item.id === gateResult.id);
  if (index >= 0) report.gates[index] = { ...report.gates[index], ...gateResult };
  else report.gates.push(gateResult);
}

function terminalStatus(report, policy = {}) {
  const gates = report.gates || [];
  if (gates.some((gate) => ["FAIL", "ERROR"].includes(gate.status))) return "FAIL";
  if (gates.find((gate) => gate.id === "G7")?.status === "NOT_RUN" && gates.filter((gate) => gate.id !== "G7").every((gate) => ["PASS", "SKIP"].includes(gate.status))) return "PASS_PENDING_PROMOTION";
  if (gates.every((gate) => ["PASS", "SKIP"].includes(gate.status))) return "PASS";
  return "RUNNING";
}

function emptySummary(extra = {}) {
  return { blocker: 0, error: 0, warning: 0, info: 0, enforcedGateCount: 0, passedGateCount: 0, failedGateCount: 0, skippedGateCount: 0, notRunGateCount: 0, ...extra };
}

function normalizeFinding(finding = {}) {
  return {
    code: finding.code || "QA_FINDING",
    severity: finding.severity || "ERROR",
    message: finding.message || finding.code || "QA finding",
    ...finding,
  };
}

function assertWarningBudgets(report, policy = {}) {
  const warningBudget = Number(policy.warningBudget ?? 5);
  const sameCodeWarningBudget = Number(policy.sameCodeWarningBudget ?? 2);
  const perPageWarningBudget = Number(policy.perPageWarningBudget ?? 2);
  const warnings = (report.findings || []).filter((finding) => finding.severity === "WARNING");
  if (warnings.length > warningBudget) throw Object.assign(new Error("QA warning budget exceeded"), { code: "QA_WARNING_BUDGET_EXCEEDED" });
  const byCode = countBy(warnings, (finding) => finding.code);
  if ([...byCode.values()].some((count) => count > sameCodeWarningBudget)) throw Object.assign(new Error("QA same-code warning budget exceeded"), { code: "QA_WARNING_CODE_BUDGET_EXCEEDED" });
  const byPage = countBy(warnings.filter((finding) => finding.page), (finding) => finding.page);
  if ([...byPage.values()].some((count) => count > perPageWarningBudget)) throw Object.assign(new Error("QA per-page warning budget exceeded"), { code: "QA_WARNING_PAGE_BUDGET_EXCEEDED" });
}

function countBy(values, fn) {
  const counts = new Map();
  for (const value of values) counts.set(fn(value), (counts.get(fn(value)) || 0) + 1);
  return counts;
}

function contractCodeFor(schemaName) {
  const map = {
    evidenceManifest: "CONTRACT_MANIFEST_INVALID",
    requestContext: "CONTRACT_REQUEST_CONTEXT_INVALID",
    visualStyleProfile: "CONTRACT_STYLE_PROFILE_INVALID",
    referenceCapture: "CONTRACT_REFERENCE_CAPTURE_INVALID",
    referenceAnalysis: "CONTRACT_REFERENCE_ANALYSIS_INVALID",
    referenceFidelityTargets: "CONTRACT_FIDELITY_TARGETS_INVALID",
    proposalModel: "CONTRACT_PROPOSAL_MODEL_INVALID",
    commercialLock: "CONTRACT_COMMERCIAL_LOCK_INVALID",
    proposalSemanticModel: "CONTRACT_SEMANTIC_MODEL_INVALID",
    presentationPlan: "CONTRACT_PRESENTATION_PLAN_INVALID",
    visualizationSpec: "CONTRACT_VISUALIZATION_SPEC_INVALID",
    proposalPackage: "CONTRACT_PROPOSAL_PACKAGE_INVALID",
    qaReport: "CONTRACT_QA_REPORT_INVALID",
  };
  return map[schemaName] || "CONTRACT_INVALID";
}

const MULTI_CONTRACT_KEYS = new Set(["referenceCaptures", "referenceAnalyses", "visualizationSpecs"]);

function schemaNameForContractKey(contractKey) {
  const map = {
    referenceCaptures: "referenceCapture",
    referenceAnalyses: "referenceAnalysis",
    visualizationSpecs: "visualizationSpec",
  };
  return map[contractKey] || contractKey;
}

function relativeArtifact(filePath = "") {
  const value = String(filePath || "");
  return value.startsWith(process.cwd()) ? path.relative(process.cwd(), value) : value;
}

function validateQaReport(report) {
  return report;
}

async function validateQaReportContract(report) {
  await validateKpContract("qaReport", report);
  return report;
}
