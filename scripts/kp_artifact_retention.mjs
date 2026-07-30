import fs from "node:fs/promises";
import path from "node:path";
import { readContractJson, resolveWorkspacePath, writeContractJson } from "./kp_request_workspace.mjs";

const DEFAULT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export async function createRetentionRecord({ workspace, requestId, artifactRelativePaths = [], retainUntil = null, now = new Date() } = {}) {
  const record = {
    schemaVersion: "1.0",
    requestId,
    state: "active",
    artifactRelativePaths: uniqueStrings(artifactRelativePaths),
    retainUntil: (retainUntil ? new Date(retainUntil) : new Date(now.getTime() + DEFAULT_RETENTION_MS)).toISOString(),
    legalHold: false,
    retiredAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await writeContractJson(path.join(workspace, "model", "retention-record.json"), record, "proposalRetention");
  return Object.freeze(record);
}

export async function setLegalHold(workspace, enabled = true, { now = new Date() } = {}) {
  const record = await readRetentionRecord(workspace);
  const next = { ...record, legalHold: Boolean(enabled), updatedAt: now.toISOString() };
  await writeContractJson(path.join(workspace, "model", "retention-record.json"), next, "proposalRetention");
  return Object.freeze(next);
}

export async function releaseLegalHold(workspace, options = {}) {
  return setLegalHold(workspace, false, options);
}

export async function retireProposalArtifacts(workspace, { now = new Date(), force = false } = {}) {
  const record = await readRetentionRecord(workspace);
  if (record.legalHold && !force) return { retired: [], protected: ["legal_hold"], record };
  if (new Date(record.retainUntil).getTime() > now.getTime() && !force) return { retired: [], protected: ["retain_until"], record };
  const retired = [];
  for (const relativePath of record.artifactRelativePaths) {
    const target = resolveWorkspacePath(workspace, relativePath);
    if (await exists(target)) {
      await fs.rm(target, { recursive: true, force: true });
      retired.push(relativePath);
    }
  }
  const next = { ...record, state: "retired", retiredAt: now.toISOString(), updatedAt: now.toISOString() };
  await writeContractJson(path.join(workspace, "model", "retention-record.json"), next, "proposalRetention");
  return { retired, protected: [], record: Object.freeze(next) };
}

export async function cleanupExpiredArtifacts(workspace, options = {}) {
  return retireProposalArtifacts(workspace, options);
}

export async function cleanupTerminalArtifacts(workspace, { keepFailedCandidate = false } = {}) {
  const status = await readContractJson(path.join(workspace, "status.json"), "requestStatus").catch(() => null);
  const proposal = await readContractJson(path.join(workspace, "model", "proposal-record.json"), "proposalRecord").catch(() => null);
  if (status?.state === "ready" || proposal?.state === "ready") {
    return { cleaned: [], protected: ["ready_artifact"] };
  }
  if (!["failed", "cancelled"].includes(status?.state)) return { cleaned: [], protected: ["non_terminal"] };
  if (keepFailedCandidate) return { cleaned: [], protected: ["keep_failed_candidate"] };
  const cleaned = [];
  for (const dir of ["candidate", "logs/tmp"]) {
    const target = path.join(workspace, dir);
    if (await exists(target)) {
      await fs.rm(target, { recursive: true, force: true });
      cleaned.push(dir);
    }
  }
  return { cleaned, protected: [] };
}

async function exists(filePath) {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

async function readRetentionRecord(workspace) {
  return readContractJson(path.join(workspace, "model", "retention-record.json"), "proposalRetention");
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
