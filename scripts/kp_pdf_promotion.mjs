import { constants as fsConstants } from "node:fs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fsyncDirectory, resolveWorkspacePath } from "./kp_request_workspace.mjs";
import { validateKpContract } from "./kp_reference_contracts.mjs";

const QA_GATE_IDS = Object.freeze(["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7"]);

export async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return `sha256:${hash.digest("hex")}`;
}

export async function promoteCandidateAtomically({ workspace = process.cwd(), candidateRelativePath, finalRelativePath = "final/proposal.pdf", qaReportPath = null, noReplace = true } = {}) {
  const legacyCandidatePdf = arguments[0]?.candidatePdf;
  const legacyFinalPdf = arguments[0]?.finalPdf;
  const candidatePath = legacyCandidatePdf ? path.resolve(legacyCandidatePdf) : resolveWorkspacePath(workspace, candidateRelativePath);
  const finalPath = legacyFinalPdf ? path.resolve(legacyFinalPdf) : resolveWorkspacePath(workspace, finalRelativePath);
  await assertPromotionPreflight({ workspace, candidatePath, finalPath, qaReportPath, ...arguments[0] });
  const candidateLabel = candidateRelativePath || path.basename(candidatePath);
  const finalLabel = finalRelativePath || path.basename(finalPath);
  const candidateSha256 = await sha256File(candidatePath);
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  const existing = await sha256File(finalPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    if (existing === candidateSha256) return promotionResult(candidateLabel, finalLabel, candidateSha256, existing, finalPath, false, qaReportPath);
    if (noReplace) throw Object.assign(new Error("Final KP artifact already exists with a different hash"), { code: "ARTIFACT_FINAL_EXISTS" });
  }
  const tempPath = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`);
  await fs.copyFile(candidatePath, tempPath, noReplace ? fsConstants.COPYFILE_EXCL : 0);
  const finalSha256 = await sha256File(tempPath);
  if (finalSha256 !== candidateSha256) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw Object.assign(new Error("Candidate/final hash mismatch before promotion"), { code: "ARTIFACT_HASH_MISMATCH" });
  }
  if (noReplace) {
    try {
      // link(2) is an atomic no-replace publication primitive when the temp
      // file lives in the destination directory. Unlike rename(2), it cannot
      // overwrite a winner created by a concurrent promotion.
      await fs.link(tempPath, finalPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      if (error?.code === "EEXIST") {
        const winnerSha256 = await sha256File(finalPath).catch(() => null);
        if (winnerSha256 === candidateSha256) return promotionResult(candidateLabel, finalLabel, candidateSha256, winnerSha256, finalPath, false, qaReportPath);
        throw Object.assign(new Error("Final KP artifact already exists with a different hash"), { code: "ARTIFACT_FINAL_EXISTS" });
      }
      throw error;
    }
    await fs.rm(tempPath, { force: true });
  } else {
    await fs.rename(tempPath, finalPath);
  }
  await fsyncDirectory(path.dirname(finalPath)).catch(() => {});
  return promotionResult(candidateLabel, finalLabel, candidateSha256, finalSha256, finalPath, true, qaReportPath);
}

export async function assertPromotionPreflight({
  workspace = process.cwd(),
  candidatePath,
  finalPath,
  candidateRelativePath = null,
  finalRelativePath = "final/proposal.pdf",
  qaReportPath = null,
  expectedCandidateSha256 = null,
  requireQaReady = false,
} = {}) {
  const resolvedCandidate = candidatePath ? path.resolve(candidatePath) : resolveWorkspacePath(workspace, candidateRelativePath);
  const resolvedFinal = finalPath ? path.resolve(finalPath) : resolveWorkspacePath(workspace, finalRelativePath);
  if (resolvedCandidate === resolvedFinal) throw Object.assign(new Error("Candidate and final artifact paths must differ"), { code: "ARTIFACT_PATH_CONFLICT" });
  const candidateStat = await fs.stat(resolvedCandidate);
  if (!candidateStat.isFile() || candidateStat.size < 1) throw Object.assign(new Error("Candidate artifact is missing or empty"), { code: "ARTIFACT_CANDIDATE_INVALID" });
  const candidateSha256 = await sha256File(resolvedCandidate);
  if (expectedCandidateSha256 && candidateSha256 !== expectedCandidateSha256) throw Object.assign(new Error("Candidate artifact hash does not match QA record"), { code: "ARTIFACT_HASH_MISMATCH" });
  if (requireQaReady) {
    if (!qaReportPath) throw Object.assign(new Error("QA report path is required before promotion"), { code: "ARTIFACT_QA_REPORT_INVALID" });
    let qa;
    try {
      qa = JSON.parse(await fs.readFile(qaReportPath, "utf8"));
    } catch (error) {
      throw Object.assign(new Error("QA report is unreadable or invalid JSON"), { code: "ARTIFACT_QA_REPORT_INVALID", cause: error });
    }
    const contract = await validateKpContract("qaReport", qa, { throwOnError: false });
    const gates = Array.isArray(qa?.gates) ? qa.gates : [];
    const gateIds = gates.map((gate) => String(gate?.id || ""));
    const exactGateSet = gates.length === QA_GATE_IDS.length
      && new Set(gateIds).size === QA_GATE_IDS.length
      && QA_GATE_IDS.every((id) => gateIds.includes(id));
    const byId = new Map(gates.map((gate) => [gate.id, gate]));
    const g0ToG5Pass = QA_GATE_IDS.slice(0, 6).every((id) => byId.get(id)?.status === "PASS");
    const g6Ready = ["PASS", "SKIP"].includes(byId.get("G6")?.status);
    const g6SkipValid = byId.get("G6")?.status !== "SKIP" || byId.get("G6")?.metrics?.referenceMode === "none";
    const g7Ready = byId.get("G7")?.status === "NOT_RUN";
    const allEnforced = gates.every((gate) => gate?.enforced === true);
    const gateFindings = gates.flatMap((gate) => Array.isArray(gate?.findings) ? gate.findings : []);
    const noBlockingFindings = !gateFindings.some((finding) => ["BLOCKER", "ERROR"].includes(String(finding?.severity || "ERROR")));
    const topLevelFindings = Array.isArray(qa?.findings) ? qa.findings : [];
    const findingSummaryConsistent = topLevelFindings.length === gateFindings.length
      && Number(qa?.summary?.blocker || 0) === 0
      && Number(qa?.summary?.error || 0) === 0
      && Number(qa?.summary?.failedGateCount || 0) === 0;
    const qaCandidateSha256 = String(byId.get("G5")?.metrics?.candidateSha256 || "");
    const hashBound = qaCandidateSha256 === candidateSha256
      && (!expectedCandidateSha256 || qaCandidateSha256 === expectedCandidateSha256);
    const prePromotionReady = contract.ok
      && qa.rendererVersion === "v5"
      && qa.status === "PASS_PENDING_PROMOTION"
      && exactGateSet
      && g0ToG5Pass
      && g6Ready
      && g6SkipValid
      && g7Ready
      && allEnforced
      && noBlockingFindings
      && findingSummaryConsistent
      && hashBound;
    if (!prePromotionReady) {
      throw Object.assign(new Error("QA report is not ready for promotion"), {
        code: "ARTIFACT_QA_REPORT_INVALID",
        evidence: {
          contractValid: contract.ok,
          exactGateSet,
          g0ToG5Pass,
          g6Ready,
          g6SkipValid,
          g7Ready,
          allEnforced,
          noBlockingFindings,
          findingSummaryConsistent,
          hashBound,
          qaCandidateSha256: qaCandidateSha256 || null,
        },
      });
    }
  }
  return Object.freeze({ candidatePath: resolvedCandidate, finalPath: resolvedFinal, candidateSha256 });
}

export async function rollbackPromotedArtifact({ workspace = process.cwd(), finalRelativePath, expectedSha256 }) {
  const finalPath = resolveWorkspacePath(workspace, finalRelativePath);
  const currentSha256 = await sha256File(finalPath).catch(() => null);
  if (!currentSha256) return false;
  if (expectedSha256 && currentSha256 !== expectedSha256) throw Object.assign(new Error("Rollback refused: final hash changed"), { code: "ARTIFACT_ROLLBACK_HASH_CHANGED" });
  await fs.rm(finalPath, { force: true });
  await fsyncDirectory(path.dirname(finalPath)).catch(() => {});
  return true;
}

async function promotionResult(candidateRelativePath, finalRelativePath, candidateSha256, finalSha256, finalPath, createdFinalByThisAttempt, qaReportPath) {
  const stat = await fs.stat(finalPath);
  const identity = { dev: String(stat.dev), ino: String(stat.ino) };
  return Object.freeze({
    candidateRelativePath,
    finalRelativePath,
    candidateSha256,
    finalSha256,
    finalFileIdentity: identity,
    createdFinalByThisAttempt,
    qaReportSha256: qaReportPath ? await sha256File(qaReportPath).catch(() => null) : null,
    sizeBytes: stat.size,
  });
}
