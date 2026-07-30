import Ajv2020 from "ajv/dist/2020.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SCHEMA_ROOT = path.join(PROJECT_ROOT, "schemas", "kp");
const REQUEST_ID_PATTERN = /^KP-[0-9]{8}-[A-Z0-9]{6,32}$/;

export const KP_SCHEMA_FILES = Object.freeze({
  requestContext: "request-context-v1.schema.json",
  idempotencyRecord: "idempotency-record-v1.schema.json",
  candidateEvidenceBundle: "candidate-evidence-bundle-v1.schema.json",
  storedEvidenceBundle: "stored-evidence-bundle-v1.schema.json",
  evidenceManifest: "evidence-manifest-v2.schema.json",
  referenceCapture: "reference-capture-v1.schema.json",
  referenceAnalysis: "reference-analysis-v1.schema.json",
  visualStyleProfile: "visual-style-profile-v1.schema.json",
  referenceFidelityTargets: "reference-fidelity-targets-v1.schema.json",
  proposalModel: "proposal-model-v3.schema.json",
  proposalSemanticModel: "proposal-semantic-model-v1.schema.json",
  proposalPackage: "proposal-package-v1.schema.json",
  presentationPlan: "presentation-plan-v1.schema.json",
  visualizationSpec: "visualization-spec-v1.schema.json",
  qaReport: "qa-report-v2.schema.json",
  referenceSessionStore: "reference-session-store-v1.schema.json",
  commercialLock: "commercial-lock-v1.schema.json",
  requestStatus: "request-status-v1.schema.json",
  proposalRecord: "proposal-record-v1.schema.json",
  proposalRetention: "proposal-retention-v1.schema.json",
  promotionJournal: "promotion-journal-v1.schema.json",
});

let cachedAjv;
let cachedSchemas;

function createAjv() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: true,
  });
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value) => !Number.isNaN(Date.parse(value)),
  });
  ajv.addFormat("uri", {
    type: "string",
    validate: (value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
  });
  return ajv;
}

async function loadSchema(fileName) {
  const raw = await fs.readFile(path.join(SCHEMA_ROOT, fileName), "utf8");
  return JSON.parse(raw);
}

export async function loadKpContractSchemas() {
  if (cachedSchemas) return cachedSchemas;
  const entries = await Promise.all(
    Object.entries(KP_SCHEMA_FILES).map(async ([name, fileName]) => [name, await loadSchema(fileName)]),
  );
  cachedSchemas = Object.fromEntries(entries);
  return cachedSchemas;
}

export async function getKpContractsAjv() {
  if (cachedAjv) return cachedAjv;
  const ajv = createAjv();
  const schemas = await loadKpContractSchemas();
  for (const schema of Object.values(schemas)) {
    ajv.addSchema(schema);
  }
  cachedAjv = ajv;
  return cachedAjv;
}

export async function validateKpContract(schemaName, value, { throwOnError = true } = {}) {
  const schemas = await loadKpContractSchemas();
  const schema = schemas[schemaName];
  if (!schema) throw new Error(`Unknown KP contract schema: ${schemaName}`);
  const ajv = await getKpContractsAjv();
  const validate = ajv.getSchema(schema.$id) || ajv.compile(schema);
  const valid = validate(value);
  if (valid) return { ok: true, errors: [] };
  const errors = (validate.errors || []).map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message || "invalid",
    params: error.params || {},
  }));
  if (throwOnError) {
    const details = errors.map((error) => `${error.path} ${error.message}`).join("; ");
    const validationError = new Error(`KP contract validation failed for ${schemaName}: ${details}`);
    validationError.code = "KP_CONTRACT_INVALID";
    validationError.schemaName = schemaName;
    validationError.errors = errors;
    throw validationError;
  }
  return { ok: false, errors };
}

export function canonicalJson(value) {
  return JSON.stringify(sortForCanonicalJson(value));
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256Digest(value) {
  return `sha256:${sha256Hex(value)}`;
}

export function commercialLockPayload(proposalModel = {}) {
  return {
    functionPrice: proposalModel.functionPrice || null,
    payments: proposalModel.payments || null,
    pricing: proposalModel.pricing || null,
    teamPlan: proposalModel.teamPlan || null,
  };
}

export function commercialLockHash(proposalModel = {}) {
  return sha256Digest(canonicalJson(commercialLockPayload(proposalModel)));
}

export function createRequestId(date = new Date(), entropy = crypto.randomBytes(6).toString("hex").toUpperCase()) {
  const yyyymmdd = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `KP-${yyyymmdd}-${String(entropy).replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 24)}`;
}

export function assertValidRequestId(requestId) {
  if (!REQUEST_ID_PATTERN.test(String(requestId || ""))) {
    const error = new Error(`Invalid KP requestId: ${requestId || "<empty>"}`);
    error.code = "KP_REQUEST_ID_INVALID";
    throw error;
  }
}

export async function createRequestWorkspace(requestContext, { outputRoot = path.join(PROJECT_ROOT, "reports", "kp-v5-requests") } = {}) {
  assertValidRequestId(requestContext?.requestId);
  const root = path.resolve(outputRoot);
  const workspace = path.resolve(root, requestContext.requestId);
  if (!workspace.startsWith(`${root}${path.sep}`)) {
    const error = new Error("KP request workspace escaped output root");
    error.code = "KP_WORKSPACE_TRAVERSAL";
    throw error;
  }
  await fs.mkdir(workspace, { recursive: false }).catch((error) => {
    if (error?.code === "EEXIST") {
      const collision = new Error(`KP request workspace already exists: ${requestContext.requestId}`);
      collision.code = "KP_WORKSPACE_COLLISION";
      throw collision;
    }
    throw error;
  });
  await fs.mkdir(path.join(workspace, "contracts"), { recursive: true });
  await fs.mkdir(path.join(workspace, "evidence"), { recursive: true });
  await fs.mkdir(path.join(workspace, "qa"), { recursive: true });
  return workspace;
}

export async function atomicWriteJson(filePath, value, { schemaName = null } = {}) {
  const target = path.resolve(filePath);
  if (schemaName) await validateKpContract(schemaName, value);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await fs.open(temporary, "wx");
  try {
    await handle.writeFile(json, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, target);
  const directoryHandle = await fs.open(path.dirname(target), "r").catch(() => null);
  if (directoryHandle) {
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  }
  return target;
}

function sortForCanonicalJson(value) {
  if (Array.isArray(value)) return value.map((item) => sortForCanonicalJson(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortForCanonicalJson(value[key])]),
  );
}
