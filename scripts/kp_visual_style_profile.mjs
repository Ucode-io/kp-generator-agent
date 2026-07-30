import path from "node:path";
import { atomicWriteJson } from "./kp_reference_contracts.mjs";

export async function persistReferenceArtifacts(requestWorkspace, { captures = [], analyses = [], profile = null } = {}) {
  const written = { captures: [], analyses: [], profile: null };
  for (const capture of captures) {
    written.captures.push(await atomicWriteJson(
      path.join(requestWorkspace, "contracts", "captures", `${capture.referenceId}.json`),
      capture,
      { schemaName: "referenceCapture" },
    ));
  }
  for (const analysis of analyses) {
    written.analyses.push(await atomicWriteJson(
      path.join(requestWorkspace, "contracts", "analyses", `${analysis.referenceId}.json`),
      analysis,
      { schemaName: "referenceAnalysis" },
    ));
  }
  if (profile) {
    written.profile = await atomicWriteJson(
      path.join(requestWorkspace, "contracts", "visual-style-profile.json"),
      profile,
      { schemaName: "visualStyleProfile" },
    );
  }
  return written;
}
