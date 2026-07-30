import path from "node:path";
import fs from "node:fs/promises";
import { validateKpContract } from "./kp_reference_contracts.mjs";
import { readContractJson, resolveWorkspacePath, writeContractJson } from "./kp_request_workspace.mjs";

export const KP_REQUEST_STATES = Object.freeze(["created", "collecting", "planning", "rendering", "qa", "promoting", "ready", "failed", "cancelled"]);

const ALLOWED = Object.freeze({
  created: ["collecting", "planning", "failed", "cancelled"],
  collecting: ["planning", "failed", "cancelled"],
  planning: ["rendering", "failed", "cancelled"],
  rendering: ["qa", "failed", "cancelled"],
  qa: ["promoting", "failed", "cancelled"],
  promoting: ["ready", "failed"],
  ready: [],
  failed: [],
  cancelled: [],
});

export function validateStatusTransition(previousState, nextState) {
  if (!KP_REQUEST_STATES.includes(previousState) || !KP_REQUEST_STATES.includes(nextState)) {
    throw Object.assign(new Error(`Unknown KP status transition: ${previousState} -> ${nextState}`), { code: "KP_STATUS_STATE_UNKNOWN" });
  }
  if (!ALLOWED[previousState].includes(nextState)) {
    throw Object.assign(new Error(`Invalid KP status transition: ${previousState} -> ${nextState}`), { code: "KP_STATUS_TRANSITION_INVALID" });
  }
}

export function createStatus(requestId, { now = new Date() } = {}) {
  return { schemaVersion: "1.0", requestId, state: "created", stage: "created", progress: 0, updatedAt: now.toISOString(), failure: null };
}

export async function setStatus(workspace, previous, nextState, { stage = nextState, progress = previous?.progress ?? 0, failure = null, now = new Date() } = {}) {
  validateStatusTransition(previous.state, nextState);
  const status = {
    ...previous,
    state: nextState,
    stage,
    progress: Math.max(0, Math.min(100, Math.round(Number(progress) || 0))),
    updatedAt: now.toISOString(),
    failure: failure ? sanitizeFailure(failure, stage) : null,
  };
  await validateKpContract("requestStatus", status);
  await writeContractJson(path.join(workspace, "status.json"), status, "requestStatus");
  return Object.freeze(status);
}

export async function reconcileRequestStatus(workspace) {
  const status = await readContractJson(path.join(workspace, "status.json"), "requestStatus");
  if (status.state === "ready") {
    const proposal = await readContractJson(path.join(workspace, "model", "proposal-record.json"), "proposalRecord").catch(() => null);
    if (!proposal || proposal.state !== "ready" || !proposal.artifact?.relativePath) {
      throw Object.assign(new Error("Ready status has no ready proposal record"), { code: "KP_STATUS_READY_RECORD_MISSING" });
    }
    const artifactPath = resolveWorkspacePath(workspace, proposal.artifact.relativePath);
    if (!(await fileExists(artifactPath))) throw Object.assign(new Error("Ready status artifact is missing"), { code: "KP_STATUS_READY_ARTIFACT_MISSING" });
  }
  if (status.state === "failed" && !status.failure?.code) {
    throw Object.assign(new Error("Failed status must include sanitized failure"), { code: "KP_STATUS_FAILURE_MISSING" });
  }
  return status;
}

function sanitizeFailure(failure, stage) {
  return {
    code: String(failure.code || "KP_REQUEST_FAILED").slice(0, 80),
    stage: String(failure.stage || stage || "unknown").slice(0, 80),
    message: String(failure.message || failure || "Unknown KP request failure").replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 800),
    retryable: Boolean(failure.retryable),
  };
}

async function fileExists(filePath) {
  return Boolean(await fs.stat(filePath).catch(() => null));
}
