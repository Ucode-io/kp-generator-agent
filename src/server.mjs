import "dotenv/config";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { generateProposal } from "./agent.mjs";
import { checkBearerAuthorization, normalizeConfiguredApiKey } from "./auth.mjs";
import { AGENT_ROOT } from "./root.mjs";
import { resolvePublishedPrototype } from "../scripts/kp_app_prototype_publisher.mjs";

const host = process.env.KP_AGENT_HOST || "127.0.0.1";
const port = Number(process.env.KP_AGENT_PORT || 8787);
const maxBodyBytes = Number(process.env.KP_AGENT_MAX_BODY_BYTES || 25 * 1024 * 1024);
const apiKey = normalizeConfiguredApiKey(process.env.KP_AGENT_API_KEY);
const outputRoot = path.resolve(process.env.KP_AGENT_OUTPUT_ROOT || path.join(AGENT_ROOT, "reports", "agent-kp"));
const prototypeFrameAncestors = normalizeFrameAncestors(process.env.KP_PROTOTYPE_FRAME_ANCESTORS);
let queue = Promise.resolve();
const generatedPdfArtifacts = new Map();
const frontendPath = new URL("../public/index.html", import.meta.url);

const server = http.createServer(async (request, response) => {
  try {
    const parsedUrl = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
    if (request.method === "GET" && (request.url === "/" || request.url === "/index.html")) {
      const html = await fs.readFile(frontendPath);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(html);
      return;
    }
    const publicMatch = parsedUrl.pathname.match(/^\/p\/([A-Za-z0-9_-]{8,64})\/(?:index\.html)?$/);
    if (request.method === "GET" && publicMatch) {
      const published = await resolvePublishedPrototype(publicMatch[1], { outputRoot });
      const html = await fs.readFile(published.htmlPath);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors ${prototypeFrameAncestors}`,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow, noarchive",
      });
      response.end(html);
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, { ok: true, service: "kp-generator-agent", status: "ready" });
    }
    const pdfMatch = parsedUrl.pathname.match(/^\/v1\/proposals\/(KP-[A-Za-z0-9_-]+)\/pdf$/);
    if (request.method === "GET" && pdfMatch) {
      const authorization = checkBearerAuthorization(apiKey, request.headers.authorization);
      if (!authorization.ok) {
        const message = authorization.reason === "required"
          ? "Bearer token is required. Use KP_AGENT_API_KEY from the service environment."
          : "Bearer token is invalid. Use KP_AGENT_API_KEY, not an application user JWT.";
        return json(response, 401, { ok: false, error: { code: "UNAUTHORIZED", message } });
      }
      return serveGeneratedPdf(response, pdfMatch[1]);
    }
    if (request.method !== "POST" || request.url !== "/v1/proposals") {
      return json(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Route not found" } });
    }
    const authorization = checkBearerAuthorization(apiKey, request.headers.authorization);
    if (!authorization.ok) {
      const message = authorization.reason === "required"
        ? "Bearer token is required. Use KP_AGENT_API_KEY from the service environment."
        : "Bearer token is invalid. Use KP_AGENT_API_KEY, not an application user JWT.";
      return json(response, 401, { ok: false, error: { code: "UNAUTHORIZED", message } });
    }
    const input = JSON.parse(await readBody(request, maxBodyBytes));
    const task = () => generateProposal(input, {
      onProgress: async (message) => console.log(`[kp-agent] ${message}`),
    });
    const resultPromise = queue.then(task, task);
    queue = resultPromise.then(() => undefined, () => undefined);
    const result = await resultPromise;
    const downloadUrl = registerGeneratedPdf(result);
    return json(response, 200, { ...result, downloadUrl });
  } catch (error) {
    const status = Number(error.httpStatus || (error instanceof SyntaxError ? 400 : 500));
    return json(response, status, {
      ok: false,
      error: { code: error.code || "KP_AGENT_FAILED", message: String(error.message || error) },
    });
  }
});

server.listen(port, host, () => {
  console.log(`KP Generator Agent listening on http://${host}:${port}`);
});

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error(`Request body exceeds ${limit} bytes`), { code: "PAYLOAD_TOO_LARGE", httpStatus: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8") || "{}"));
    request.on("error", reject);
  });
}

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function serveGeneratedPdf(response, requestId) {
  const artifact = generatedPdfArtifacts.get(requestId);
  if (!artifact) {
    return json(response, 404, { ok: false, error: { code: "PDF_ARTIFACT_NOT_FOUND", message: "Generated PDF artifact is not available in this server process" } });
  }
  const stat = await fs.stat(artifact.path).catch(() => null);
  if (!stat?.isFile()) {
    generatedPdfArtifacts.delete(requestId);
    return json(response, 410, { ok: false, error: { code: "PDF_ARTIFACT_GONE", message: "Generated PDF artifact no longer exists on disk" } });
  }
  const filename = contentDispositionFilename(artifact.title || requestId);
  response.writeHead(200, {
    "content-type": "application/pdf",
    "content-length": String(stat.size),
    "content-disposition": `attachment; filename="${filename}.pdf"; filename*=UTF-8''${encodeRFC5987Value(`${artifact.title || requestId}.pdf`)}`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(await fs.readFile(artifact.path));
}

function registerGeneratedPdf(result = {}) {
  const requestId = String(result.requestId || "");
  const pdfPath = path.resolve(String(result.sourceDocumentPath || result.documentPath || ""));
  if (!/^KP-[A-Za-z0-9_-]+$/.test(requestId) || path.extname(pdfPath).toLowerCase() !== ".pdf") return null;
  generatedPdfArtifacts.set(requestId, {
    path: pdfPath,
    title: String(result.title || requestId).trim().slice(0, 120) || requestId,
  });
  return `/v1/proposals/${encodeURIComponent(requestId)}/pdf`;
}

function contentDispositionFilename(value) {
  const safe = String(value || "proposal")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]+/g, "")
    .replace(/["\\/:*?<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return safe || "proposal";
}

function encodeRFC5987Value(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeFrameAncestors(value) {
  const normalized = String(value || "'self' http://127.0.0.1:* http://localhost:* https://professio.ucode.co").trim();
  if (!normalized || /[\r\n;]/.test(normalized)) {
    throw new Error("KP_PROTOTYPE_FRAME_ANCESTORS contains invalid CSP characters");
  }
  return normalized;
}
