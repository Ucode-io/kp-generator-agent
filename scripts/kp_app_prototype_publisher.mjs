import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, sha256Digest } from "./kp_reference_contracts.mjs";
import { APP_PROTOTYPE_RENDERER_VERSION } from "./kp_app_prototype_renderer.mjs";

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export async function publishAppPrototype({
  workspace,
  outputRoot,
  requestId,
  publicId,
  publicUrl,
  candidateHtmlPath,
  qaReport,
  screenCount,
} = {}) {
  assertPublicId(publicId);
  const finalRelativePath = "final/prototype/index.html";
  const finalPath = path.join(workspace, finalRelativePath);
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.copyFile(candidateHtmlPath, finalPath);
  const html = await fs.readFile(finalPath);
  const record = {
    schemaVersion: "1.0",
    requestId,
    publicId,
    publicUrl,
    rendererVersion: APP_PROTOTYPE_RENDERER_VERSION,
    relativePath: finalRelativePath,
    sha256: sha256Digest(html),
    sizeBytes: html.length,
    screenCount,
    qaStatus: qaReport?.status || "PASS",
    updatedAt: new Date().toISOString(),
  };
  await atomicWriteJson(path.join(workspace, "model", "app-prototype-record.json"), record, { schemaName: "appPrototypeRecord" });
  await writePrototypeRegistry({ outputRoot, publicId, workspace, record });
  return { record, finalPath };
}

export async function writePrototypeRegistry({ outputRoot, publicId, workspace, record } = {}) {
  assertPublicId(publicId);
  const registryPath = prototypeRegistryPath(outputRoot, publicId);
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify({
    schemaVersion: "1.0",
    publicId,
    workspace,
    recordPath: path.join(workspace, "model", "app-prototype-record.json"),
    htmlPath: path.join(workspace, record.relativePath),
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  return registryPath;
}

export async function resolvePublishedPrototype(publicId, { outputRoot } = {}) {
  assertPublicId(publicId);
  const registryPath = prototypeRegistryPath(outputRoot, publicId);
  const raw = await fs.readFile(registryPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      const notFound = new Error("Prototype not found");
      notFound.code = "APP_PROTOTYPE_NOT_FOUND";
      notFound.httpStatus = 404;
      throw notFound;
    }
    throw error;
  });
  const registry = JSON.parse(raw);
  const htmlPath = path.resolve(String(registry.htmlPath || ""));
  const recordPath = path.resolve(String(registry.recordPath || ""));
  const root = path.resolve(outputRoot || path.join(process.cwd(), "reports", "agent-kp"));
  if (!htmlPath.startsWith(`${root}${path.sep}`) || !recordPath.startsWith(`${root}${path.sep}`)) {
    const error = new Error("Published prototype path escaped output root");
    error.code = "APP_PROTOTYPE_PATH_TRAVERSAL";
    error.httpStatus = 404;
    throw error;
  }
  return {
    htmlPath,
    recordPath,
    record: JSON.parse(await fs.readFile(recordPath, "utf8")),
  };
}

export function createPrototypePublicUrl(publicId, { baseUrl = "" } = {}) {
  assertPublicId(publicId);
  const cleanBase = String(baseUrl || "https://kp.udevs.io/p/").trim().replace(/\/+$/g, "");
  if (!/^https?:\/\//i.test(cleanBase)) {
    const error = new Error("Prototype public base URL must be http(s)");
    error.code = "APP_PROTOTYPE_PUBLIC_URL_INVALID";
    throw error;
  }
  return `${cleanBase}/${publicId}/`;
}

export function assertPublicId(publicId) {
  if (!PUBLIC_ID_PATTERN.test(String(publicId || ""))) {
    const error = new Error("Invalid app prototype publicId");
    error.code = "APP_PROTOTYPE_PUBLIC_ID_INVALID";
    throw error;
  }
}

function prototypeRegistryPath(outputRoot, publicId) {
  const root = path.resolve(outputRoot || path.join(process.cwd(), "reports", "agent-kp"));
  const registryRoot = path.join(root, "public-prototypes");
  const registryPath = path.join(registryRoot, `${publicId}.json`);
  if (!registryPath.startsWith(`${registryRoot}${path.sep}`)) {
    const error = new Error("Prototype registry path traversal");
    error.code = "APP_PROTOTYPE_REGISTRY_TRAVERSAL";
    throw error;
  }
  return registryPath;
}
