import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { atomicWriteJson, sha256Digest, sha256Hex, validateKpContract } from "./kp_reference_contracts.mjs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8000;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_ASPECT_RATIO = 8;
const PYTHON = process.env.CODEX_PYTHON || "python3";

export function samplePdfPageIndexes(pageCount, maxPages = 12) {
  const total = Math.max(0, Math.floor(Number(pageCount) || 0));
  const limit = Math.max(1, Math.floor(Number(maxPages) || 12));
  if (total <= limit) return Array.from({ length: total }, (_, index) => index);
  const indexes = new Set([0, 1, 2, total - 3, total - 2, total - 1]);
  for (const fraction of [0.25, 0.5, 0.75]) indexes.add(Math.round((total - 1) * fraction));
  for (let index = 0; indexes.size < limit && index < limit * 3; index += 1) {
    indexes.add(Math.round((index * (total - 1)) / (limit - 1)));
  }
  return [...indexes].filter((index) => index >= 0 && index < total).sort((a, b) => a - b).slice(0, limit);
}

export function allocateReferenceFrameBudget(manifest, captures = [], maxFrames = 32) {
  const visualItems = (manifest.items || []).filter((item) => ["brand_system", "visual_style", "logo_asset"].includes(item.role));
  if (visualItems.length > maxFrames) throw codeError("KP_REF_INSUFFICIENT_COVERAGE", "Reference frame budget cannot cover every selected visual source");
  const budget = new Map();
  for (const item of visualItems) budget.set(item.id, 1);
  const primary = manifest.primaryVisualReferenceId;
  if (primary) budget.set(primary, Math.min(3, maxFrames));
  let remaining = maxFrames - [...budget.values()].reduce((sum, value) => sum + value, 0);
  const ordered = visualItems.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || a.id.localeCompare(b.id));
  while (remaining > 0 && ordered.length) {
    for (const item of ordered) {
      if (remaining <= 0) break;
      const capture = captures.find((entry) => entry.referenceId === item.id);
      const sampleCount = Math.max(1, capture?.samples?.length || 1);
      if ((budget.get(item.id) || 0) < sampleCount) {
        budget.set(item.id, (budget.get(item.id) || 0) + 1);
        remaining -= 1;
      }
    }
    if (ordered.every((item) => (budget.get(item.id) || 0) >= Math.max(1, captures.find((entry) => entry.referenceId === item.id)?.samples?.length || 1))) break;
  }
  return Object.fromEntries(budget);
}

export async function captureManifestReferences(manifest, options = {}) {
  const visualSources = (manifest.items || []).filter((item) => ["brand_system", "visual_style", "logo_asset"].includes(item.role));
  const captures = [];
  for (const source of visualSources.slice(0, Number(options.maxVisualSources || 8))) {
    const capture = await captureReferenceSource(source, options);
    captures.push(capture);
  }
  const explicitVisualCount = visualSources.filter((item) => ["brand_system", "visual_style"].includes(item.role)).length;
  const usableCount = captures.filter((capture) => ["complete", "partial"].includes(capture.status) && capture.samples.length).length;
  if (manifest.referenceMode === "explicit_full" && explicitVisualCount && !usableCount) {
    throw codeError("KP_REF_PRIMARY_UNAVAILABLE", "Explicit visual references could not be captured", true);
  }
  return captures;
}

export async function materializeSelectedEvidence(storedBundle, requestWorkspace, options = {}) {
  const now = new Date().toISOString();
  const items = [];
  for (const [index, item] of (storedBundle.items || []).entries()) {
    const asset = options.assetById?.[item.assetId] || item;
    const referenceId = `REF-${String(index + 1).padStart(3, "0")}`;
    const destinationDir = path.join(requestWorkspace, "evidence", "original", referenceId);
    await fs.mkdir(destinationDir, { recursive: true });
    const fileName = safeFileName(asset.fileName || item.storedPath || item.url || `reference-${index + 1}`);
    let localPath = null;
    let sha256 = item.sha256 || asset.sha256 || null;
    let sizeBytes = Number(asset.sizeBytes || 0);
    if (item.storedPath || asset.storedPath) {
      const sourcePath = path.resolve(item.storedPath || asset.storedPath);
      const stat = await fs.lstat(sourcePath);
      if (stat.isSymbolicLink()) throw codeError("KP_REF_CORRUPT", "Reference source is an unsafe symlink");
      if (stat.size > Number(options.maxFileBytes || MAX_FILE_BYTES)) throw codeError("KP_REF_OVERSIZE", "Reference source is too large");
      const temporary = path.join(destinationDir, `.${fileName}.${process.pid}.tmp`);
      const digest = await copyAndHashFile(sourcePath, temporary, Number(options.maxFileBytes || MAX_FILE_BYTES));
      if (sha256 && normalizeSha(sha256) !== digest) throw codeError("ARTIFACT_HASH_MISMATCH", "Reference hash mismatch during materialization");
      await fsyncFile(temporary);
      await fs.rename(temporary, path.join(destinationDir, fileName));
      await fsyncDirectory(destinationDir).catch(() => {});
      localPath = requestRelativePath(requestWorkspace, path.join(destinationDir, fileName));
      sha256 = digest;
      sizeBytes = stat.size;
    }
    items.push({
      id: referenceId,
      assetId: item.assetId,
      kind: asset.kind || (item.url ? "url" : "unknown"),
      role: asset.role || "unknown",
      secondaryRoles: asset.secondaryRoles || [],
      classificationConfidence: Number(asset.classificationConfidence || 0.35),
      classificationMethod: asset.classificationMethod || "stored_bundle",
      aspectAllow: asset.aspectAllow || [],
      aspectDeny: asset.aspectDeny || [],
      origins: asset.origins || [],
      replyDepth: 0,
      fileName,
      mimeType: asset.mimeType || null,
      localPath,
      url: item.url || asset.url || null,
      caption: asset.caption || null,
      instruction: asset.instruction || null,
      sha256: normalizeSha(sha256 || sha256Digest(item.url || fileName)),
      sizeBytes,
      explicit: true,
      priority: Number(asset.priority || 50),
      status: localPath ? "materialized" : "selected",
      warnings: [],
    });
  }
  const manifest = {
    schemaVersion: "2.0",
    manifestId: `EMAN-${sha256Hex(`${storedBundle.requestId}:${now}`).slice(0, 12).toUpperCase()}`,
    requestId: storedBundle.requestId,
    sessionKey: storedBundle.sessionKeyHash || "sha256:unknown",
    intakeFingerprint: storedBundle.intakeFingerprint || sha256Digest(JSON.stringify(storedBundle.items || [])),
    createdAt: now,
    referenceMode: storedBundle.selectionTrace?.mode || "none",
    primaryVisualReferenceId: null,
    userInstruction: null,
    selectionTrace: {
      includedReferenceIds: items.map((item) => item.id),
      excluded: storedBundle.selectionTrace?.excluded || [],
      primaryReferenceId: null,
      primaryReason: storedBundle.selectionTrace?.primaryReason || null,
      rulesApplied: storedBundle.selectionTrace?.rulesApplied || [],
    },
    items,
  };
  const primaryAssetId = storedBundle.selectionTrace?.primaryAssetId;
  manifest.primaryVisualReferenceId = items.find((item) => item.assetId === primaryAssetId)?.id || items.find((item) => ["brand_system", "visual_style"].includes(item.role))?.id || null;
  manifest.selectionTrace.primaryReferenceId = manifest.primaryVisualReferenceId;
  await atomicWriteJson(path.join(requestWorkspace, "contracts", "evidence-manifest.json"), manifest, { schemaName: "evidenceManifest" });
  return manifest;
}

export async function captureReferenceSource(source, options = {}) {
  if (source.localPath) {
    if (source.kind === "pdf" || /pdf/i.test(source.mimeType || source.fileName || "")) return capturePdfReference(source, options);
    return captureImageReference(source, options);
  }
  if (source.url) return captureWebsiteReference(source, options);
  throw codeError("KP_REF_UNSUPPORTED_FORMAT", "Reference has no local path or URL");
}

export async function capturePdfReference(source, options = {}) {
  const input = resolveReferenceLocalPath(source, options);
  const buffer = await fs.readFile(input);
  if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw codeError("KP_REF_CORRUPT", "PDF magic bytes are invalid");
  const pageCount = await pdfPageCount(input);
  const indexes = samplePdfPageIndexes(pageCount, options.maxPages || 12);
  const sampleDir = path.join(options.requestWorkspace || path.dirname(input), "evidence", "samples", source.id || "REF-PDF");
  await fs.mkdir(sampleDir, { recursive: true });
  const samples = [];
  for (const pageIndex of indexes) {
    const outputPrefix = path.join(sampleDir, `page-${String(pageIndex + 1).padStart(3, "0")}`);
    const rendered = spawnSync("pdftoppm", ["-png", "-f", String(pageIndex + 1), "-singlefile", "-scale-to-x", "1440", "-scale-to-y", "-1", input, outputPrefix], { encoding: "utf8" });
    const artifactPath = `${outputPrefix}.png`;
    if (rendered.status !== 0) throw codeError("KP_REF_CORRUPT", rendered.stderr || "PDF render failed");
    const dimensions = await imageMetadata(artifactPath);
    samples.push(await sampleRecord(source, artifactPath, "pdf_page", dimensions, { pageIndex, pageNumber: pageIndex + 1, requestWorkspace: options.requestWorkspace }));
  }
  const capture = captureContract(source, "pdf", pageCount, indexes, samples, { mimeTypeVerified: "application/pdf" });
  await validateReferenceCapture(capture);
  return capture;
}

export async function captureImageReference(source, options = {}) {
  const input = resolveReferenceLocalPath(source, options);
  const dimensions = await imageMetadata(input);
  assertImageWithinLimits(dimensions, options);
  const sampleDir = path.join(options.requestWorkspace || path.dirname(input), "evidence", "samples", source.id || "REF-IMAGE");
  await fs.mkdir(sampleDir, { recursive: true });
  const output = path.join(sampleDir, safeFileName(path.basename(input)));
  await fs.copyFile(input, output);
  const samples = [await sampleRecord(source, output, source.kind === "logo" ? "logo" : "image", dimensions, { requestWorkspace: options.requestWorkspace })];
  const capture = captureContract(source, source.kind === "logo" ? "logo" : "image", null, [], samples, { mimeTypeVerified: dimensions.format, alpha: dimensions.alpha });
  await validateReferenceCapture(capture);
  return capture;
}

export async function captureWebsiteReference(source, options = {}) {
  const url = validatePublicReferenceUrl(source.url, options);
  if (options.fetchHead) {
    const response = await options.fetchHead(url);
    const title = `${response.title || ""} ${response.bodyPreview || ""}`;
    if (isAntiBotText(title)) throw codeError("KP_REF_ANTIBOT", "Reference URL is protected by anti-bot checks", true);
  }
  if (!options.captureWebsite) {
    return {
      schemaVersion: "1.0",
      captureId: `RCAP-${source.id || "URL"}`,
      referenceId: source.id,
      captureVersion: "capture-v1",
      inputFingerprint: sha256Digest(url),
      status: "blocked",
      mediaKind: "url",
      pageCount: null,
      sampledPageIndexes: [],
      samples: [],
      metadata: { mimeTypeVerified: null, alpha: false, redirectCount: 0, finalUrl: url },
      warnings: [],
      failure: { code: "KP_REF_CAPTURE_TIMEOUT", message: "Website screenshot capture adapter is not configured" },
    };
  }
  return options.captureWebsite(source, { ...options, url });
}

export async function buildReferenceContactSheets(frames, options = {}) {
  const outputPath = options.outputPath || path.join(options.outputDir || process.cwd(), "reference-contact-sheet.png");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const script = `
from PIL import Image, ImageDraw
import sys, math
paths=sys.argv[1:-1]
out=sys.argv[-1]
thumbs=[]
for p in paths:
 im=Image.open(p).convert("RGB")
 im.thumbnail((360,240))
 thumbs.append((p,im.copy()))
w,h=720, max(260, math.ceil(len(thumbs)/2)*280)
sheet=Image.new("RGB",(w,h),"white")
d=ImageDraw.Draw(sheet)
for i,(p,im) in enumerate(thumbs):
 x=(i%2)*360
 y=(i//2)*280+24
 sheet.paste(im,(x,y))
 d.text((x+8,y-18),p[-40:],fill=(0,0,0))
sheet.save(out)
`;
  spawnSync(PYTHON, ["-c", script, ...frames.map((frame) => resolveFramePath(frame.artifactPath || frame, options)), outputPath], { encoding: "utf8" });
  return outputPath;
}

export async function validateReferenceCapture(value) {
  await validateKpContract("referenceCapture", value);
  if (value.status === "complete" && value.mediaKind === "pdf" && value.sampledPageIndexes.length !== value.samples.length) {
    throw codeError("KP_REF_INSUFFICIENT_COVERAGE", "PDF capture samples do not cover every sampled page");
  }
  return true;
}

export function validatePublicReferenceUrl(rawUrl, options = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw codeError("KP_REF_URL_UNSAFE", "Reference URL is invalid");
  }
  const allowHttpLoopback = Boolean(options.allowHttpLoopbackForTests);
  if (parsed.username || parsed.password) throw codeError("KP_REF_URL_UNSAFE", "Reference URL must not contain credentials");
  if (parsed.protocol !== "https:" && !(allowHttpLoopback && parsed.protocol === "http:" && isLoopbackHost(parsed.hostname))) {
    throw codeError("KP_REF_URL_UNSAFE", "Reference URL must use public HTTPS");
  }
  if (isUnsafeHost(parsed.hostname) && !(allowHttpLoopback && isLoopbackHost(parsed.hostname))) {
    throw codeError("KP_REF_URL_UNSAFE", "Reference URL host is private or unsafe");
  }
  parsed.hash = "";
  return parsed.toString();
}

export function isAntiBotText(value = "") {
  return /(just a moment|access denied|captcha|verify you are human|enable javascript|доступ запрещ|подтвердите|капча|inson ekanligingizni)/i.test(String(value || ""));
}

function captureContract(source, mediaKind, pageCount, indexes, samples, metadata) {
  return {
    schemaVersion: "1.0",
    captureId: `RCAP-${source.id || crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    referenceId: source.id,
    captureVersion: "capture-v1",
    inputFingerprint: normalizeSha(source.sha256 || sha256Digest(source.url || source.localPath || source.id)),
    status: "complete",
    mediaKind,
    pageCount,
    sampledPageIndexes: indexes,
    samples,
    metadata: { mimeTypeVerified: metadata.mimeTypeVerified || null, alpha: Boolean(metadata.alpha), redirectCount: 0, finalUrl: metadata.finalUrl || null },
    warnings: [],
    failure: null,
  };
}

async function sampleRecord(source, artifactPath, kind, dimensions, extra) {
  return {
    frameId: `FRAME-${source.id || "REF"}-${String((extra.pageNumber || 1)).padStart(3, "0")}`,
    kind,
    pageIndex: extra.pageIndex ?? null,
    pageNumber: extra.pageNumber ?? null,
    viewportLabel: null,
    artifactPath: extra.requestWorkspace ? requestRelativePath(extra.requestWorkspace, artifactPath) : artifactPath,
    sha256: await sha256FileDigest(artifactPath),
    width: dimensions.width,
    height: dimensions.height,
    quality: {
      blankRatio: Number(dimensions.blankRatio ?? 0),
      usefulContentRatio: Number(dimensions.usefulContentRatio ?? 0.7),
      isInterstitial: false,
    },
  };
}

async function pdfPageCount(pdfPath) {
  const script = "from pypdf import PdfReader; import sys; print(len(PdfReader(sys.argv[1]).pages))";
  const result = spawnSync(PYTHON, ["-c", script, pdfPath], { encoding: "utf8" });
  if (result.status !== 0) throw codeError("KP_REF_CORRUPT", result.stderr || "Unable to read PDF");
  return Number(result.stdout.trim());
}

async function imageMetadata(imagePath) {
  const script = `
from PIL import Image, ImageStat
import json, sys
im=Image.open(sys.argv[1])
rgba=im.convert("RGBA")
gray=rgba.convert("L")
hist=gray.histogram()
pixels=max(1,sum(hist))
blank=sum(hist[248:])/pixels
alpha = "A" in im.getbands()
print(json.dumps({"width": im.width, "height": im.height, "format": im.format or "image", "alpha": alpha, "blankRatio": blank, "usefulContentRatio": 1-blank}))
`;
  const result = spawnSync(PYTHON, ["-c", script, imagePath], { encoding: "utf8" });
  if (result.status !== 0) throw codeError("KP_REF_CORRUPT", result.stderr || "Unable to inspect image");
  return JSON.parse(result.stdout);
}

function assertImageWithinLimits(dimensions, options = {}) {
  const maxDimension = Number(options.maxImageDimension || MAX_IMAGE_DIMENSION);
  const maxPixels = Number(options.maxImagePixels || MAX_IMAGE_PIXELS);
  const maxAspect = Number(options.maxImageAspectRatio || MAX_IMAGE_ASPECT_RATIO);
  const width = Number(dimensions.width || 0);
  const height = Number(dimensions.height || 0);
  if (width <= 0 || height <= 0) throw codeError("KP_REF_CORRUPT", "Reference image dimensions are invalid");
  if (width > maxDimension || height > maxDimension) throw codeError("KP_REF_OVERSIZE", "Reference image dimensions exceed configured limit");
  if (width * height > maxPixels) throw codeError("KP_REF_OVERSIZE", "Reference image pixel count exceeds configured limit");
  if (Math.max(width, height) / Math.max(1, Math.min(width, height)) > maxAspect) throw codeError("KP_REF_UNSUPPORTED_FORMAT", "Reference image aspect ratio is too extreme");
}

async function copyAndHashFile(sourcePath, destinationPath, maxBytes) {
  const hash = crypto.createHash("sha256");
  let total = 0;
  try {
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        total += chunk.length;
        if (total > maxBytes) {
          callback(codeError("KP_REF_OVERSIZE", "Reference source is too large"));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      fsSync.createReadStream(sourcePath),
      meter,
      fsSync.createWriteStream(destinationPath, { flags: "wx" }),
    );
  } catch (error) {
    await fs.rm(destinationPath, { force: true }).catch(() => {});
    throw error;
  }
  return `sha256:${hash.digest("hex")}`;
}

async function sha256FileDigest(filePath) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close().catch(() => {});
  }
  return `sha256:${hash.digest("hex")}`;
}

async function fsyncFile(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(directory) {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function requestRelativePath(requestWorkspace, filePath) {
  const root = path.resolve(requestWorkspace);
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw codeError("KP_REF_CORRUPT", "Reference artifact escaped request workspace");
  }
  return path.relative(root, resolved).split(path.sep).join("/");
}

function resolveReferenceLocalPath(source, options = {}) {
  const localPath = String(source.localPath || "");
  if (!localPath) throw codeError("KP_REF_UNSUPPORTED_FORMAT", "Reference has no local path");
  if (path.isAbsolute(localPath)) return path.resolve(localPath);
  if (!options.requestWorkspace) throw codeError("KP_REF_CORRUPT", "Relative reference path requires request workspace");
  const root = path.resolve(options.requestWorkspace);
  const resolved = path.resolve(root, localPath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw codeError("KP_REF_CORRUPT", "Reference local path escaped request workspace");
  return resolved;
}

function resolveFramePath(framePath, options = {}) {
  const value = String(framePath || "");
  if (path.isAbsolute(value)) return value;
  if (options.requestWorkspace) return path.resolve(options.requestWorkspace, value);
  return value;
}

function isUnsafeHost(hostname = "") {
  const host = hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) return true;
  const ipVersion = net.isIP(host);
  if (!ipVersion) return false;
  if (ipVersion === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || a === 0;
  }
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
}

function isLoopbackHost(hostname = "") {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname.toLowerCase());
}

function safeFileName(value = "reference") {
  return path.basename(String(value || "reference")).replace(/[^a-z0-9._-]+/gi, "-").slice(0, 100) || "reference";
}

function normalizeSha(value) {
  return String(value || "").startsWith("sha256:") ? String(value) : `sha256:${value}`;
}

function codeError(code, message, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}
