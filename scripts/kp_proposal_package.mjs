import { assertCommercialLock } from "./kp_commercial_lock.mjs";
import { canonicalJson, sha256Digest, validateKpContract } from "./kp_reference_contracts.mjs";

export const RENDER_CONTRACT_V5 = Object.freeze({
  rendererVersion: "v5",
  pageCount: 21,
  width: 1440,
  height: 960,
  aspectRatio: 1.5,
  forbidCoverPrice: true,
});

export function renderContractForPageCount(pageCount = RENDER_CONTRACT_V5.pageCount) {
  const count = Number(pageCount);
  if (!Number.isInteger(count) || count < 2 || count > 50) {
    throw Object.assign(new Error("Render contract page count must be between 2 and 50"), { code: "CONTRACT_PROPOSAL_MODEL_INVALID" });
  }
  return Object.freeze({ ...RENDER_CONTRACT_V5, pageCount: count });
}

const NARRATIVE_PATHS = Object.freeze([
  "/narrative/executiveSummary",
  "/narrative/problemStatement",
  "/narrative/valueProposition",
  "/narrative/whyNow",
  "/narrative/deliveryApproach",
  "/narrative/closingStatement",
]);
const NARRATIVE_COPY_KEYS = Object.freeze([
  "executiveSummary",
  "problemStatement",
  "valueProposition",
  "whyNow",
  "deliveryApproach",
  "closingStatement",
  "claimLedger",
]);

export async function buildProposalModelV3(base = {}, { requestId, visualReferences = {}, renderContract = RENDER_CONTRACT_V5 } = {}) {
  const model = deepFreeze({
    ...clone(base),
    schemaVersion: "3.0",
    requestId: requestId || base.requestId,
    title: base.title || base.brief?.projectName || "Commercial proposal",
    visualReferences: {
      manifestId: visualReferences.manifestId ?? null,
      manifestPath: visualReferences.manifestPath ?? null,
      styleProfileId: visualReferences.styleProfileId ?? null,
      styleProfilePath: visualReferences.styleProfilePath ?? null,
      mode: visualReferences.mode || "none",
      primaryStyleSourceId: visualReferences.primaryStyleSourceId ?? null,
      usableReferenceCount: Number(visualReferences.usableReferenceCount || 0),
      warnings: visualReferences.warnings || [],
    },
    commercialLockState: "unlocked",
    commercialLockHash: null,
    renderContract,
    narrative: normalizeNarrative(narrativeInputFromBase(base)),
    claimLedger: base.claimLedger || [],
  });
  await validateKpContract("proposalModel", model);
  return model;
}

export async function attachCommercialLockHash(proposalModel, commercialLock) {
  assertCommercialLock(commercialLock, proposalModel);
  const locked = deepFreeze({
    ...clone(proposalModel),
    commercialLockState: "locked",
    commercialLockHash: commercialLock.lockHash,
  });
  await validateKpContract("proposalModel", locked);
  return locked;
}

export async function withRenderContractPageCount(proposalModel, pageCount) {
  const updated = deepFreeze({
    ...clone(proposalModel),
    renderContract: renderContractForPageCount(pageCount),
  });
  await validateKpContract("proposalModel", updated);
  return updated;
}

export async function createProposalPackage({ requestContext, proposalModel, semanticModel, visualStyleProfile, presentationPlan, visualizationSpecs = [], commercialLockHash } = {}) {
  if (proposalModel?.commercialLockState !== "locked") {
    throw Object.assign(new Error("Proposal package requires a locked proposal model"), { code: "PROPOSAL_MODEL_UNLOCKED" });
  }
  const identityHash = sha256Digest(canonicalJson({
    requestId: requestContext?.requestId,
    proposalModelHash: sha256Digest(canonicalJson(proposalModel)),
    semanticModelHash: sha256Digest(canonicalJson(semanticModel)),
    planId: presentationPlan?.planId,
  })).slice("sha256:".length, "sha256:".length + 12).toUpperCase();
  return finalizeProposalPackage({
    schemaVersion: "1.0",
    packageId: `KPPKG-${identityHash}`,
    requestContext,
    proposalModel,
    semanticModel,
    visualStyleProfile,
    presentationPlan,
    visualizationSpecs,
    commercialLockHash: commercialLockHash || proposalModel.commercialLockHash,
    renderContract: renderContractForPageCount(presentationPlan?.pageCount || RENDER_CONTRACT_V5.pageCount),
  });
}

export async function finalizeProposalPackage(unhashedPackage) {
  const payload = clone(unhashedPackage);
  delete payload.packageHash;
  const pkg = deepFreeze({ ...payload, packageHash: computePackageHash(payload) });
  await validateProposalPackage(pkg);
  return pkg;
}

export async function validateProposalPackage(pkg, options = {}) {
  const result = await validateKpContract("proposalPackage", pkg, options);
  if (!result.ok) return result;
  const expected = computePackageHash(pkg);
  if (pkg.packageHash !== expected) {
    const error = {
      path: "/packageHash",
      keyword: "integrity",
      message: "must equal canonical SHA-256 of package excluding /packageHash",
      params: { expected },
    };
    if (options.throwOnError === false) return { ok: false, errors: [error] };
    throw Object.assign(new Error("Proposal package hash mismatch"), { code: "PROPOSAL_PACKAGE_HASH_MISMATCH", errors: [error] });
  }
  return result;
}

export async function attachNarrativeCopyOnly(lockedBaseContent, groundedNarrative = {}) {
  if (lockedBaseContent?.commercialLockState !== "locked") {
    throw Object.assign(new Error("Narrative copy can only attach to a locked proposal model"), { code: "PROPOSAL_MODEL_UNLOCKED" });
  }
  rejectUnexpectedNarrativeKeys(groundedNarrative);
  const before = immutableProjection(lockedBaseContent);
  const originalLedger = canonicalJson(lockedBaseContent.claimLedger || []);
  const next = clone(lockedBaseContent);
  for (const path of NARRATIVE_PATHS) {
    const key = path.split("/").at(-1);
    if (groundedNarrative[key] !== undefined) next.narrative[key] = sanitizeNarrativeString(groundedNarrative[key], key);
  }
  const existingLedgerIds = new Set((next.claimLedger || []).map((row) => row.id));
  for (const row of groundedNarrative.claimLedger || []) {
    const normalized = normalizeClaimLedgerRow(row);
    if (existingLedgerIds.has(normalized.id)) {
      throw Object.assign(new Error(`Claim ledger row overwrite forbidden: ${normalized.id}`), { code: "CONTENT_SYNTHESIS_MUTATION_FORBIDDEN" });
    }
    next.claimLedger.push(normalized);
  }
  if (canonicalJson((next.claimLedger || []).slice(0, (lockedBaseContent.claimLedger || []).length)) !== originalLedger) {
    throw Object.assign(new Error("Existing claim ledger rows are immutable"), { code: "CONTENT_SYNTHESIS_MUTATION_FORBIDDEN" });
  }
  const after = immutableProjection(next);
  if (before !== after) throw Object.assign(new Error("Narrative synthesis attempted to mutate protected proposal fields"), { code: "CONTENT_SYNTHESIS_MUTATION_FORBIDDEN" });
  await validateKpContract("proposalModel", next);
  return deepFreeze(next);
}

function rejectUnexpectedNarrativeKeys(groundedNarrative = {}) {
  const allowed = new Set(NARRATIVE_COPY_KEYS);
  const unexpected = Object.keys(groundedNarrative).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw Object.assign(new Error(`Narrative copy cannot mutate protected fields: ${unexpected.join(", ")}`), { code: "CONTENT_SYNTHESIS_MUTATION_FORBIDDEN" });
  }
}

function computePackageHash(pkg) {
  const payload = clone(pkg);
  delete payload.packageHash;
  return sha256Digest(canonicalJson(payload));
}

function immutableProjection(model) {
  const copy = clone(model);
  for (const path of NARRATIVE_PATHS) setByPointer(copy, path, "[narrative]");
  copy.claimLedger = "[claimLedger]";
  return canonicalJson(copy);
}

function normalizeNarrative(value) {
  return {
    executiveSummary: sanitizeNarrativeString(value.executiveSummary || "Executive summary to confirm.", "executiveSummary"),
    problemStatement: sanitizeNarrativeString(value.problemStatement || "Problem statement to confirm.", "problemStatement"),
    valueProposition: sanitizeNarrativeString(value.valueProposition || "Value proposition to confirm.", "valueProposition"),
    whyNow: sanitizeNarrativeString(value.whyNow || "Timing rationale to confirm.", "whyNow"),
    deliveryApproach: sanitizeNarrativeString(value.deliveryApproach || "Delivery approach to confirm.", "deliveryApproach"),
    closingStatement: sanitizeNarrativeString(value.closingStatement || "Next decisions to confirm.", "closingStatement"),
  };
}

function narrativeInputFromBase(base = {}) {
  const explicit = base.narrative || {};
  const grounded = base.groundedNarrative || {};
  return {
    executiveSummary: explicit.executiveSummary ?? grounded.executiveSummary ?? base.executiveSummary,
    problemStatement: explicit.problemStatement ?? grounded.problemStatement ?? base.problemStatement,
    valueProposition: explicit.valueProposition ?? grounded.valueProposition ?? grounded.solutionNarrative ?? base.valueProposition ?? base.solutionNarrative,
    whyNow: explicit.whyNow ?? grounded.whyNow ?? base.whyNow,
    deliveryApproach: explicit.deliveryApproach ?? grounded.deliveryApproach ?? stringValue(base.deliveryApproach) ?? stringValue(base.delivery),
    closingStatement: explicit.closingStatement ?? grounded.closingStatement ?? stringValue(base.closingStatement) ?? stringValue(base.close),
  };
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeClaimLedgerRow(row = {}) {
  const normalized = {
    id: String(row.id || "").trim(),
    text: sanitizeNarrativeString(row.text || "", "claimLedger.text", 600),
    truthStatus: row.truthStatus || "recommended",
    sourceIds: Array.isArray(row.sourceIds) ? row.sourceIds.map(String) : [],
    derivationRuleId: row.derivationRuleId ?? null,
  };
  if (!normalized.id) throw Object.assign(new Error("Claim ledger row requires id"), { code: "CONTENT_CLAIM_UNGROUNDED" });
  if (["explicit", "verified", "single_source"].includes(normalized.truthStatus) && !normalized.sourceIds.length) {
    throw Object.assign(new Error("Grounded claim requires source IDs"), { code: "CONTENT_CLAIM_UNGROUNDED" });
  }
  if (["recommended", "inferred", "assumed"].includes(normalized.truthStatus) && !normalized.sourceIds.length && !normalized.derivationRuleId) {
    throw Object.assign(new Error("Derived claim requires source or derivation rule"), { code: "CONTENT_CLAIM_UNGROUNDED" });
  }
  return normalized;
}

function sanitizeNarrativeString(value, field, maxLength = 1200) {
  const text = String(value || "").normalize("NFC");
  if (!text.trim() || text.length > maxLength || /[\u0000-\u001F\u007F\u202A-\u202E]/.test(text) || /!\[|https?:\/\/|\/Users\/|[A-Z_]{12,}=/.test(text)) {
    throw Object.assign(new Error(`Invalid narrative field: ${field}`), { code: "CONTENT_SYNTHESIS_MUTATION_FORBIDDEN" });
  }
  return text;
}

function setByPointer(object, pointer, value) {
  const keys = pointer.split("/").slice(1);
  let cursor = object;
  for (const key of keys.slice(0, -1)) cursor = cursor[key];
  cursor[keys.at(-1)] = value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
