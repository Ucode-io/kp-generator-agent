import "dotenv/config";
import http from "node:http";
import { generateProposal } from "./agent.mjs";

const host = process.env.KP_AGENT_HOST || "127.0.0.1";
const port = Number(process.env.KP_AGENT_PORT || 8787);
const maxBodyBytes = Number(process.env.KP_AGENT_MAX_BODY_BYTES || 25 * 1024 * 1024);
const apiKey = String(process.env.KP_AGENT_API_KEY || "");
let queue = Promise.resolve();

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, { ok: true, service: "kp-generator-agent", status: "ready" });
    }
    if (request.method !== "POST" || request.url !== "/v1/proposals") {
      return json(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Route not found" } });
    }
    if (apiKey && request.headers.authorization !== `Bearer ${apiKey}`) {
      return json(response, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "Bearer token is required" } });
    }
    const input = JSON.parse(await readBody(request, maxBodyBytes));
    const task = () => generateProposal(input, {
      onProgress: async (message) => console.log(`[kp-agent] ${message}`),
    });
    const resultPromise = queue.then(task, task);
    queue = resultPromise.then(() => undefined, () => undefined);
    return json(response, 200, await resultPromise);
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
