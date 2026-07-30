import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, createRequestId, sha256Digest, validateKpContract } from "./kp_reference_contracts.mjs";

export function createKpRequestContext({
  channel = "direct_api",
  requestId = createRequestId(),
  locale = "ru-RU",
  timezone = "Asia/Tashkent",
  tenantScopeHash = sha256Digest("kp:tenant:default"),
  idempotencyKeyHash = sha256Digest(`kp:idempotency:${requestId}`),
  chatIdHash = tenantScopeHash,
  canaryBucket = 0,
  rendererSelectionReason = "default_legacy",
  now = new Date(),
  transport = {},
} = {}) {
  return Object.freeze({
    schemaVersion: "1.0",
    requestId,
    channel,
    receivedAt: now.toISOString(),
    locale,
    timezone,
    transport: {
      chatType: transport.chatType || null,
      chatId: transport.chatId || null,
      userId: transport.userId || null,
      messageId: transport.messageId ?? null,
      messageThreadId: transport.messageThreadId ?? null,
      mediaGroupId: transport.mediaGroupId ?? null,
      replyToMessageId: transport.replyToMessageId ?? null,
    },
    routing: {
      chatIdHash,
      idempotencyKeyHash,
      referenceModeHint: transport.referenceModeHint || "none",
      canaryBucket,
      rendererSelectionReason,
    },
  });
}

export async function createRequestWorkspace(requestContext, { outputRoot = path.join(process.cwd(), "reports", "kp-v5-requests") } = {}) {
  await validateKpContract("requestContext", requestContext);
  const root = path.resolve(outputRoot);
  const workspace = resolveInside(root, requestContext.requestId);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.mkdir(workspace, { recursive: false }).catch((error) => {
    if (error?.code === "EEXIST") throw Object.assign(new Error(`KP request workspace already exists: ${requestContext.requestId}`), { code: "KP_WORKSPACE_COLLISION" });
    throw error;
  });
  for (const dir of ["contracts", "evidence/original", "evidence/samples", "candidate", "final", "model", "qa", "logs"]) {
    await fs.mkdir(path.join(workspace, dir), { recursive: true });
  }
  await fsyncDirectory(root).catch(() => {});
  return workspace;
}

export async function writeContractJson(filePath, value, schemaName) {
  return atomicWriteJson(filePath, value, { schemaName });
}

export async function readContractJson(filePath, schemaName) {
  const value = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (schemaName) await validateKpContract(schemaName, value);
  return value;
}

export async function workspaceByteUsage(workspace) {
  let total = 0;
  for await (const filePath of walkFiles(workspace)) total += (await fs.stat(filePath)).size;
  return total;
}

export async function assertWorkspaceByteLimit(workspace, maxBytes) {
  const used = await workspaceByteUsage(workspace);
  if (used > maxBytes) throw Object.assign(new Error(`KP workspace byte limit exceeded: ${used} > ${maxBytes}`), { code: "KP_WORKSPACE_LIMIT_EXCEEDED", used, maxBytes });
  return used;
}

export function resolveWorkspacePath(workspace, relativePath) {
  return resolveInside(workspace, relativePath);
}

export async function fsyncDirectory(directory) {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, String(relativePath || ""));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw Object.assign(new Error("KP path escaped workspace root"), { code: "KP_WORKSPACE_TRAVERSAL" });
  }
  return resolved;
}

async function* walkFiles(root) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(filePath);
    else if (entry.isFile()) yield filePath;
  }
}
