import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { chromium } from "playwright";
import { transcribeAudioFile } from "./audio_transcription.mjs";
import {
  PREMIUM_PROPOSAL_PAGE_COUNT,
  buildPremiumProposalHtml,
} from "./kp_pdf_premium_template.mjs";
import { atomicWriteJson, commercialLockHash, sha256Digest } from "./kp_reference_contracts.mjs";
import { resolveKpPdfConfig } from "./kp_pdf_config.mjs";
import { allocatePaymentPercentBasisPoints, createCommercialLock } from "./kp_commercial_lock.mjs";
import { createKpRequestContext, createRequestWorkspace, writeContractJson } from "./kp_request_workspace.mjs";
import { createStatus, setStatus } from "./kp_request_status.mjs";
import { attachCommercialLockHash, buildProposalModelV3, createProposalPackage, withRenderContractPageCount } from "./kp_proposal_package.mjs";
import { buildProposalSemanticModel, validateProposalSemanticModel } from "./kp_semantic_model.mjs";
import { buildPresentationPlan, persistPlanningArtifacts } from "./kp_presentation_planner.mjs";
import { buildVisualizationSpecs } from "./kp_visualization_planner.mjs";
import { validateVisualizationSpecs } from "./kp_visualization_validator.mjs";
import { buildReferenceDrivenProposalHtml } from "./kp_pdf_reference_renderer.mjs";
import { buildAndValidateAppPrototypeSpec } from "./kp_app_prototype_planner.mjs";
import { renderAppPrototypeToFile } from "./kp_app_prototype_renderer.mjs";
import { runAppPrototypeQa } from "./kp_app_prototype_qa.mjs";
import { publishAppPrototype } from "./kp_app_prototype_publisher.mjs";
import { inspectRenderedProposalDomV5 } from "./kp_pdf_semantic_qa.mjs";
import { canonicalizeTeamPlan } from "./kp_team_capacity.mjs";
import { buildReferenceFidelityTargets } from "./kp_pdf_fidelity_qa.mjs";
import {
  assertQualityGate,
  assertReadyForPromotion,
  recordDomGeometryGateG4,
  runPostRenderQualityGate,
  runPreRenderQualityGate,
  runPromotionGateG7,
} from "./kp_pdf_quality_gate.mjs";
import { createRetentionRecord } from "./kp_artifact_retention.mjs";
import {
  bindBriefSourceIds,
  buildDurationAwareRoadmap,
  buildKpResearchQueries,
  buildResearchStatus,
  buildUnknownMarketSizing,
  getDomainResearchPacks,
  isBlockedKpResearchContent,
  isRelevantHistoricalKpRecord,
  isSafeKpReferenceUrl,
  parseKpBrief,
  sanitizeAndDedupeSources,
  synthesizeGroundedNarrative,
} from "./kp_grounded_content.mjs";
import {
  DIRECT_SELLER_MANAGEMENT_EVIDENCE_PATTERN,
  assertsSellerManagement,
  hasDirectSellerManagementEvidence,
} from "./kp_seller_entailment.mjs";

const projectSources = [];

let cachedSummary;
const kpUrlTextCache = new Map();
const kpSiteProfileCache = new Map();
const kpSearchCache = new Map();
const kpSalesReferencePath = path.join(process.cwd(), "data", "kp_sales_references.jsonl");
const PREMIUM_PROPOSAL_TEMPLATE_VERSION = "marketplace-dark-premium-v4";
export const KP_PDF_V5_RENDERER_VERSION = "reference-driven-v5";

async function launchKpChromium(options = {}) {
  const configuredPath = String(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "").trim();
  if (configuredPath) return chromium.launch({ ...options, executablePath: configuredPath });
  try {
    return await chromium.launch(options);
  } catch (originalError) {
    const platformCandidates = process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : process.platform === "linux"
        ? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
        : [];
    for (const executablePath of platformCandidates) {
      const available = await fs.access(executablePath).then(() => true, () => false);
      if (available) return chromium.launch({ ...options, executablePath });
    }
    throw originalError;
  }
}

export function resolveKpPdfRendererMode(env = process.env) {
  const explicit = String(env.KP_PDF_RENDERER_MODE || "").trim().toLowerCase();
  const legacyVersion = String(env.KP_RENDERER_VERSION || "").trim().toLowerCase();
  if (!explicit && legacyVersion) {
    if (legacyVersion === "legacy" || legacyVersion === "marketplace-dark-premium-v4" || legacyVersion === "v4") return "legacy";
    if (legacyVersion === "reference-driven-v5" || legacyVersion === "v5") return "shadow";
    console.warn(`[kp-pdf] Deprecated KP_RENDERER_VERSION=${legacyVersion} is unknown; using legacy renderer.`);
    return "legacy";
  }
  if (!explicit || explicit === "legacy" || explicit === "v4" || explicit === "marketplace-dark-premium-v4") return "legacy";
  if (explicit === "shadow") return "shadow";
  if (explicit === "v5" || explicit === "reference-driven-v5") {
    if (env.KP_PDF_ENABLE_V5_PRODUCTION === "1") return "v5";
    console.warn("[kp-pdf] KP_PDF_RENDERER_MODE=v5 requested without KP_PDF_ENABLE_V5_PRODUCTION=1; using shadow mode.");
    return "shadow";
  }
  console.warn(`[kp-pdf] Unknown KP_PDF_RENDERER_MODE=${explicit}; using legacy renderer.`);
  return "legacy";
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value = "kpi-report") {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "kpi-report";
}

function fmtUsd(value) {
  const number = Number(value) || 0;
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number)}`;
}

function fmtNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function roundMoney(value) {
  return Math.round(Number(value) || 0);
}

function allocateTotal(total, weightedRows) {
  const safeTotal = roundMoney(total);
  const active = weightedRows.filter((row) => Number(row.weight) > 0);
  const weightSum = active.reduce((sum, row) => sum + Number(row.weight || 0), 0) || 1;
  let used = 0;
  return active.map((row, index) => {
    const amount = index === active.length - 1 ? safeTotal - used : roundMoney((safeTotal * Number(row.weight || 0)) / weightSum);
    used += amount;
    return { ...row, total: amount };
  });
}

function sumMoney(rows = [], field = "amount") {
  return rows.reduce((sum, row) => sum + roundMoney(row[field]), 0);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function extractReferenceUrl(text = "") {
  const source = String(text || "");
  const explicit = source.match(/\b(?:reference|ref|style|palette|color|rang)\s*[:=-]?\s*(https?:\/\/[^\s<>)"]+)/i)?.[1];
  const first = source.match(/https?:\/\/[^\s<>)"]+/i)?.[0];
  return (explicit || first || "").replace(/[.,;!?]+$/g, "");
}

function stripReferenceUrl(text = "") {
  return String(text || "")
    .replace(/\b(?:reference|ref|style|palette|color|rang)\s*[:=-]?\s*https?:\/\/[^\s<>)"]+/gi, "")
    .replace(/https?:\/\/[^\s<>)"]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAllUrls(text = "") {
  return [...String(text || "").matchAll(/https?:\/\/[^\s<>)"]+/gi)]
    .map((match) => match[0].replace(/[.,;!?]+$/g, ""))
    .filter(Boolean);
}

function uniqueUrls(urls = []) {
  const seen = new Set();
  const result = [];
  for (const url of urls.filter(Boolean)) {
    const clean = String(url).trim().replace(/[.,;!?]+$/g, "");
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function hostLabel(url = "") {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return String(url || "").slice(0, 70);
  }
}

function linkContext(question = "", url = "") {
  const index = String(question || "").indexOf(url);
  if (index < 0) return "";
  return question.slice(Math.max(0, index - 90), Math.min(question.length, index + url.length + 90));
}

function classifyKpLinks(question = "", evidenceBundle = null) {
  const evidenceLinks = Array.isArray(evidenceBundle?.links) ? evidenceBundle.links : [];
  const urls = uniqueUrls([
    ...extractAllUrls(question),
    ...evidenceLinks.map((item) => item?.url || item),
  ]);
  const evidenceContext = new Map();
  for (const item of evidenceLinks) {
    const url = String(item?.url || item || "").trim();
    if (!url) continue;
    evidenceContext.set(url.toLowerCase(), [
      item?.type,
      item?.kind,
      item?.label,
      item?.title,
      item?.caption,
      item?.source,
    ].filter(Boolean).join(" "));
  }
  const brandUrls = [];
  const analogUrls = [];
  const classifiedAnalogUrls = [];
  const pdfUrls = [];
  for (const url of urls) {
    const descriptor = `${linkContext(question, url)} ${evidenceContext.get(url.toLowerCase()) || ""}`.toLowerCase();
    const urlText = url.toLowerCase();
    const brandSignal = /brand|brend|brandbook|style[- ]?guide|guideline|current\s+site|hozirgi\s+site|\bweb\s*site\b|\bsite\b|rang|color|colour|logo|identity/i.test(descriptor)
      || /brandbook|brand[-_]?guide|style[-_]?guide|guideline|logo|identity|palette/i.test(urlText);
    const analogSignal = /analog|аналог|competitor|raqobatchi|benchmark|reference/i.test(descriptor)
      || /(?:\/|[-_])(?:analog|competitor|benchmark)(?:\/|[-_.?]|$)/i.test(urlText);
    if (/\.pdf(?:$|\?)/i.test(url)) pdfUrls.push(url);
    if (brandSignal) {
      brandUrls.push(url);
    } else if (analogSignal) {
      analogUrls.push(url);
      classifiedAnalogUrls.push(url);
    }
  }
  for (const url of urls) {
    if (!brandUrls.includes(url) && !analogUrls.includes(url)) analogUrls.push(url);
  }
  return {
    urls,
    brandUrls: uniqueUrls(brandUrls),
    analogUrls: uniqueUrls(analogUrls),
    classifiedAnalogUrls: uniqueUrls(classifiedAnalogUrls),
    pdfUrls: uniqueUrls(pdfUrls),
  };
}

function isAudioEvidenceFile(file = {}) {
  return /audio|voice/i.test(file.type || "") || /^audio\//i.test(file.mimeType || "") || /\.(mp3|m4a|ogg|oga|wav|webm|aac)$/i.test(file.path || file.fileName || "");
}

function isPdfEvidenceFile(file = {}) {
  return /pdf/i.test(file.mimeType || "") || /\.pdf$/i.test(file.path || file.fileName || "");
}

function isTextEvidenceFile(file = {}) {
  return /text|json|markdown/i.test(file.mimeType || "") || /\.(txt|md|json|csv)$/i.test(file.path || file.fileName || "");
}

function safeText(value = "", limit = 900) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

async function mapWithConcurrency(items = [], concurrency = 4, mapper = async (item) => item) {
  const rows = Array.from(items);
  const output = new Array(rows.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, rows.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(rows[index], index);
    }
  }));
  return output;
}

function extractPdfTextFromFile(filePath, maxPages = 8) {
  const python = process.env.CODEX_PYTHON ||
    "python3";
  const script = [
    "import sys",
    "from pypdf import PdfReader",
    "reader=PdfReader(sys.argv[1])",
    "max_pages=int(sys.argv[2])",
    "parts=[]",
    "for i,page in enumerate(reader.pages[:max_pages]):",
    "    text=page.extract_text() or ''",
    "    if text.strip(): parts.append(f'--- PDF page {i+1} ---\\n{text}')",
    "print('\\n\\n'.join(parts))",
  ].join("\n");
  const result = spawnSync(python, ["-c", script, filePath, String(maxPages)], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout.trim()) {
    const fallback = spawnSync("pdftotext", ["-f", "1", "-l", String(maxPages), filePath, "-"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if (fallback.status === 0 && fallback.stdout.trim()) return fallback.stdout.trim();
    throw new Error(result.stderr || fallback.stderr || "PDF text extraction failed");
  }
  return result.stdout.trim();
}

async function fetchUrlText(url = "", limit = 5000) {
  const cacheKey = `${url}::${limit}`;
  if (kpUrlTextCache.has(cacheKey)) return kpUrlTextCache.get(cacheKey);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(Number(process.env.KP_URL_FETCH_TIMEOUT_MS || 10_000)),
    headers: { "user-agent": "Mozilla/5.0 Udevs-KP-Research/1.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (/pdf/i.test(contentType) || /\.pdf(?:$|\?)/i.test(url)) {
    const dir = path.join(process.cwd(), "tmp", "kp-url-pdfs");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${slugify(hostLabel(url))}-${Date.now()}.pdf`);
    await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
    const pdfText = extractPdfTextFromFile(filePath, 8).slice(0, limit);
    kpUrlTextCache.set(cacheKey, pdfText);
    return pdfText;
  }
  const html = await response.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
  kpUrlTextCache.set(cacheKey, text);
  return text;
}

async function extractSiteProfile(url = "") {
  if (kpSiteProfileCache.has(url)) return kpSiteProfileCache.get(url);
  const browser = await launchKpChromium({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Number(process.env.KP_SITE_PROFILE_TIMEOUT_MS || 12_000) });
    await page.waitForTimeout(500);
    const profile = await page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const elements = [...document.querySelectorAll("h1,h2,p,a,button,[class*=brand],[class*=logo]")].slice(0, 80);
      const colors = [];
      const fonts = new Set();
      for (const element of elements) {
        const style = getComputedStyle(element);
        if (style.color) colors.push(style.color);
        if (style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)") colors.push(style.backgroundColor);
        if (style.fontFamily) fonts.add(style.fontFamily.split(",")[0].replace(/['"]/g, ""));
      }
      for (const prop of ["--brand", "--primary", "--accent", "--color-primary"]) {
        const value = rootStyle.getPropertyValue(prop);
        if (value) colors.push(value);
      }
      return {
        title: document.title || "",
        description: document.querySelector("meta[name='description']")?.getAttribute("content") || "",
        h1: [...document.querySelectorAll("h1")].map((item) => item.textContent.trim()).filter(Boolean).slice(0, 3),
        fonts: [...fonts].filter(Boolean).slice(0, 5),
        colors: colors.filter(Boolean).slice(0, 20),
      };
    });
    kpSiteProfileCache.set(url, profile);
    return profile;
  } finally {
    await browser.close();
  }
}

async function searchWeb(query = "", limit = 5) {
  const cacheKey = `${query}::${limit}`;
  if (kpSearchCache.has(cacheKey)) return kpSearchCache.get(cacheKey);
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(Number(process.env.KP_SEARCH_TIMEOUT_MS || 8_000)),
      headers: { "user-agent": "Mozilla/5.0 Udevs-KP-Research/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const links = [];
    const regex = /uddg=([^&\s]+)|href="(https?:\/\/[^"]+)"/gi;
    for (const match of html.matchAll(regex)) {
      const raw = match[1] ? decodeURIComponent(match[1]) : match[2];
      if (!raw || /duckduckgo|javascript|\.css|\.js/i.test(raw)) continue;
      links.push(raw);
      if (links.length >= limit) break;
    }
    const results = uniqueUrls(links).slice(0, limit).map((item) => ({ title: hostLabel(item), url: item }));
    kpSearchCache.set(cacheKey, results);
    return results;
  } catch {
    return [];
  }
}

async function readJsonlRecords(filePath, limit = 5000) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean).slice(-limit);
    const rows = [];
    for (const line of lines) {
      try {
        rows.push(JSON.parse(line));
      } catch {}
    }
    return rows;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function kpReferenceText(record = {}) {
  return [
    record.text,
    record.caption,
    record.reply_to_text,
    record.chat_title,
    record.from_username,
    record.from_name,
  ].filter(Boolean).join("\n");
}

function kpReferenceUrls(record = {}) {
  return uniqueUrls([
    ...(Array.isArray(record.urls) ? record.urls : []),
    ...extractAllUrls(kpReferenceText(record)),
  ]);
}

function tokenSet(value = "") {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .split(/[^a-zа-яё0-9']+/i)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4),
  );
}

function historicalKpReferenceScore(record = {}, project = {}, question = "") {
  if (!isRelevantHistoricalKpRecord(record, question)) return 0;
  const text = kpReferenceText(record);
  const urls = kpReferenceUrls(record);
  const hasKpSignal = /\bkp\b|\bкп\b|kompred|commercial proposal|коммерческ|предложен|proposal|project card|pdf/i.test(text);
  const hasProposalUrl = urls.some(isSafeKpReferenceUrl);
  if (!hasKpSignal && !hasProposalUrl) return 0;

  const configuredChatRe = process.env.KP_SALES_REFERENCE_CHAT_RE || "sales|sotuv|продаж|udevs_sales|xidoyatov|asadbek ai|asadbek bakhodirov";
  const salesContext = new RegExp(configuredChatRe, "i").test(text);
  const allowAll = /^(true|1|yes)$/i.test(String(process.env.KP_INCLUDE_ALL_HISTORICAL_KP_REFERENCES || ""));
  if (!salesContext && !allowAll && !hasProposalUrl) return 0;

  const projectTokens = tokenSet(`${project.title || ""} ${projectType(project)} ${question}`);
  const recordTokens = tokenSet(text);
  let score = salesContext ? 4 : 1;
  if (hasKpSignal) score += 3;
  if (hasProposalUrl) score += 3;
  if (urls.length) score += Math.min(3, urls.length);
  for (const token of projectTokens) {
    if (recordTokens.has(token)) score += 1;
  }
  return score;
}

async function loadHistoricalKpReferences(question = "", project = {}, options = {}) {
  const explicit = Array.isArray(options.evidenceBundle?.historicalKpReferences)
    ? options.evidenceBundle.historicalKpReferences
    : [];
  const files = [process.env.KP_SALES_REFERENCE_FILE || kpSalesReferencePath];
  if (/^(?:true|1|yes)$/i.test(String(process.env.KP_INCLUDE_TELEGRAM_HISTORY_REFERENCES || ""))) {
    files.push(
      path.join(process.cwd(), "data", "telegram_user_messages.jsonl"),
      path.join(process.cwd(), "data", "telegram_business_messages.jsonl"),
    );
  }
  const rows = [...explicit];
  for (const file of files) rows.push(...await readJsonlRecords(file, Number(process.env.KP_HISTORY_REFERENCE_SCAN_LINES || 8000)));

  const seen = new Set();
  return rows
    .map((record) => {
      const score = historicalKpReferenceScore(record, project, question);
      const urls = kpReferenceUrls(record);
      const source = record.source === "telegram_sales_kp_reference" ? "Sales Udevs KP reference sync" : "Telegram KP history";
      const date = record.message_date || record.local_date || record.ts || record.sync_date || "";
      const messageId = record.message_id || "";
      const chatId = record.chat_id || "";
      const telegramSource = chatId && messageId ? `telegram://${chatId}/${messageId}` : source;
      return {
        score,
        source,
        date,
        chatTitle: record.chat_title || record.chat || "",
        from: record.from_username || record.from_name || "",
        messageId,
        urls,
        text: safeText(kpReferenceText(record), 900),
        sourceRef: urls[0] || telegramSource,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)))
    .filter((item) => {
      const key = `${item.chatTitle}:${item.messageId}:${item.text.slice(0, 80)}:${item.urls.join("|")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Number(process.env.KP_HISTORY_REFERENCE_LIMIT || 8));
}

async function enrichHistoricalKpReferences(references = []) {
  if (!/^(true|1|yes)$/i.test(String(process.env.KP_FETCH_HISTORICAL_KP_LINKS ?? "false"))) return references;
  const limited = references.slice(0, Number(process.env.KP_HISTORY_ENRICH_LIMIT || 4));
  return mapWithConcurrency(limited, Number(process.env.KP_HISTORY_FETCH_CONCURRENCY || 3), async (item) => {
    const linkInsights = [];
    for (const url of item.urls.filter(isSafeKpReferenceUrl).slice(0, 1)) {
      try {
        linkInsights.push({ url, text: await fetchUrlText(url, 2200) });
      } catch (error) {
        linkInsights.push({ url, error: error.message });
      }
    }
    return { ...item, linkInsights };
  });
}

function transcriptSentences(transcript = "") {
  return String(transcript || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 18)
    .slice(0, 80);
}

function buildCallInsights(transcripts = []) {
  const combined = transcripts.map((item) => item.transcript).filter(Boolean).join("\n");
  const sentences = transcriptSentences(combined);
  const requirementPatterns = /(kerak|kere|нужно|хотим|qilish|qilamiz|надо|admin|mobile|web|integr|payment|to'lov|crm|erp|dashboard|hisobot|report|api|bot|ai)/i;
  const painPatterns = /(muammo|problem|og'riq|боль|сложно|qiyin|manual|qo'lda|tez|sekin|xato|risk|control|nazorat|analytics|hisob)/i;
  const budgetPatterns = /(budget|budjet|byudjet|narx|price|cost|\$|usd|oy|month|muddat|срок|месяц)/i;
  const requirements = sentences.filter((item) => requirementPatterns.test(item)).slice(0, 8);
  const pains = sentences.filter((item) => painPatterns.test(item)).slice(0, 5);
  const commercialSignals = sentences.filter((item) => budgetPatterns.test(item)).slice(0, 5);
  return {
    source: transcripts.length ? "Telegram call zapis transcript" : "Prompt only",
    transcriptChars: combined.length,
    summary: safeText(requirements[0] || pains[0] || combined || "Call zapis berilmagan; scope prompt va research asosida tuzildi.", 500),
    requirements,
    pains,
    commercialSignals,
    quality: combined.length >= 120 ? "medium" : transcripts.length ? "low" : "not_provided",
  };
}

function parseCssColor(value = "") {
  const text = String(value || "").trim();
  const rgba = text.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].replace("/", " ").split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
    const channel = (part) => String(part || "").endsWith("%")
      ? Number.parseFloat(part) * 2.55
      : Number.parseFloat(part);
    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    const a = parts[3] === undefined ? 1 : String(parts[3]).endsWith("%") ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
    if ([r, g, b, a].every(Number.isFinite) && a > 0.05) {
      return { r: clamp(Math.round(r), 0, 255), g: clamp(Math.round(g), 0, 255), b: clamp(Math.round(b), 0, 255), a };
    }
  }
  const hsla = text.match(/^hsla?\(([^)]+)\)$/i);
  if (hsla) {
    const parts = hsla[1].replace("/", " ").split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
    const hue = ((Number.parseFloat(parts[0]) % 360) + 360) % 360 / 360;
    const saturation = Number.parseFloat(parts[1]) / 100;
    const lightness = Number.parseFloat(parts[2]) / 100;
    const alpha = parts[3] === undefined ? 1 : String(parts[3]).endsWith("%") ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
    if ([hue, saturation, lightness, alpha].every(Number.isFinite) && alpha > 0.05) {
      const channel = (offset) => {
        const k = (offset + hue * 12) % 12;
        const chroma = saturation * Math.min(lightness, 1 - lightness);
        return Math.round(255 * (lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
      };
      return { r: channel(0), g: channel(8), b: channel(4), a: alpha };
    }
  }
  const hex = text.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? hex.split("").map((x) => `${x}${x}`).join("") : hex;
    const alpha = full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1;
    if (alpha <= 0.05) return null;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
      a: alpha,
    };
  }
  return null;
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => clamp(value, 0, 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function rgbToHsl({ r, g, b }) {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const lightness = (max + min) / 2;
  if (max === min) return { hue: 0, saturation: 0, lightness };
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  if (max === nr) hue = (ng - nb) / delta + (ng < nb ? 6 : 0);
  if (max === ng) hue = (nb - nr) / delta + 2;
  if (max === nb) hue = (nr - ng) / delta + 4;
  return { hue: hue / 6, saturation, lightness };
}

function mixRgb(a, b, weight = 0.5) {
  return {
    r: Math.round(a.r * (1 - weight) + b.r * weight),
    g: Math.round(a.g * (1 - weight) + b.g * weight),
    b: Math.round(a.b * (1 - weight) + b.b * weight),
  };
}

const KP_PREMIUM_CANVAS = "#0A0A10";
const KP_THEME_COLOR_KEYS = [
  "brand", "primary", "brandDeep", "brandDark", "brandTint", "brandSoft",
  "canvas", "surface1", "surface2", "textPrimary", "textSecondary", "rule",
  "secondary", "positive", "warning", "critical",
  "decorativePrimary", "decorativeSecondary", "decorativeTertiary",
];
const KP_THEME_FONT_KEYS = ["displayStack", "bodyStack", "metadataStack"];
const GENERIC_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
]);

function relativeRgbLuminance(color) {
  const channels = [color.r, color.g, color.b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function rgbContrastRatio(left, right) {
  const a = relativeRgbLuminance(left);
  const b = relativeRgbLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function accessibleAccentOnDark(accent, canvas = parseCssColor(KP_PREMIUM_CANVAS)) {
  if (rgbContrastRatio(accent, canvas) >= 4.5) return accent;
  for (const amount of [0.18, 0.3, 0.42, 0.54, 0.66, 0.78]) {
    const candidate = mixRgb(accent, { r: 255, g: 255, b: 255 }, amount);
    if (rgbContrastRatio(candidate, canvas) >= 4.5) return candidate;
  }
  return parseCssColor("#A78BFA");
}

function contrastSafeRgb(foreground, background, minimumRatio = 4.5, fallback = null) {
  if (foreground && background && rgbContrastRatio(foreground, background) >= minimumRatio) return foreground;
  if (!background) return foreground || fallback || parseCssColor("#7C5CFF");
  const target = relativeRgbLuminance(background) < 0.42
    ? { r: 255, g: 255, b: 255 }
    : { r: 0, g: 0, b: 0 };
  const base = foreground || fallback || target;
  for (const amount of [0.14, 0.24, 0.34, 0.44, 0.56, 0.68, 0.8, 0.9, 1]) {
    const candidate = mixRgb(base, target, amount);
    if (rgbContrastRatio(candidate, background) >= minimumRatio) return candidate;
  }
  return target;
}

function normalizedReferenceFontStack(value = "", fallback = "Arial, sans-serif") {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  if (!raw || raw.length > 180 || /[;{}<>@\\\n\r]|(?:url|var)\s*\(/i.test(raw)) return fallback;
  const families = [];
  for (const part of raw.split(",").slice(0, 6)) {
    const unquoted = part.trim().replace(/^['"]|['"]$/g, "").trim();
    if (!unquoted || unquoted.length > 64 || !/^[\p{L}\p{N} ._\-]+$/u.test(unquoted)) continue;
    if (!families.some((item) => item.toLowerCase() === unquoted.toLowerCase())) families.push(unquoted);
  }
  if (!families.length) return fallback;
  if (!families.some((item) => GENERIC_FONT_FAMILIES.has(item.toLowerCase()))) {
    const generic = /\bmono/i.test(fallback) ? "monospace" : /\bserif\b/i.test(fallback) && !/sans-serif/i.test(fallback) ? "serif" : "sans-serif";
    families.push(generic);
  }
  return families
    .map((family) => (GENERIC_FONT_FAMILIES.has(family.toLowerCase()) || /^[A-Za-z0-9_.-]+$/.test(family) ? family : `"${family}"`))
    .join(", ");
}

export function udevsFallbackTheme() {
  return {
    brand: "#1A54FE",
    primary: "#1A54FE",
    brandDeep: "#123FB0",
    brandDark: "#123FB0",
    brandTint: "#F7F8FC",
    brandSoft: "#EEF3FF",
    canvas: "#FFFFFF",
    surface1: "#FFFFFF",
    surface2: "#F7F8FC",
    textPrimary: "#0A0A0F",
    textSecondary: "#6B6B6B",
    rule: "#E4E9F7",
    secondary: "#0A0A0F",
    positive: "#1A54FE",
    warning: "#0A0A0F",
    critical: "#1A54FE",
    decorativePrimary: "#1A54FE",
    decorativeSecondary: "#0A0A0F",
    decorativeTertiary: "#E4E9F7",
    displayStack: "Sora, Arial, sans-serif",
    bodyStack: "Work Sans, Arial, sans-serif",
    metadataStack: "Work Sans, Arial, sans-serif",
  };
}

export function dynamicColorPalettesEnabled(env = process.env) {
  return ["1", "true", "on", "yes"].includes(
    String(env.KP_DYNAMIC_COLOR_PALETTES_ENABLED ?? "0").trim().toLowerCase(),
  );
}

function udevsStaticThemeResult() {
  return {
    themeTokens: udevsFallbackTheme(),
    themeSource: { kind: "udevs_static", reference: "screenshot_visual_system" },
    themeWarnings: ["Dynamic website palettes are disabled; the fixed Udevs screenshot palette and background system were applied."],
    referenceUrl: "",
  };
}

export function applyUdevsScreenshotVisualSystem(profile = {}) {
  const tokens = udevsFallbackTheme();
  const warnings = [
    ...(profile.warnings || []),
    "Dynamic website palettes are disabled; the fixed Udevs screenshot palette and background system were applied.",
  ];
  return {
    ...profile,
    canvas: {
      ...(profile.canvas || {}),
      mode: "light",
      background: tokens.canvas,
      surface1: tokens.surface1,
      surface2: tokens.surface2,
      textPrimary: tokens.textPrimary,
      textSecondary: tokens.textSecondary,
      rule: tokens.rule,
    },
    accents: {
      ...(profile.accents || {}),
      primary: tokens.primary,
      secondary: tokens.secondary,
      positive: tokens.positive,
      warning: tokens.warning,
      critical: tokens.critical,
      decorativePrimary: tokens.decorativePrimary,
      decorativeSecondary: tokens.decorativeSecondary,
      decorativeTertiary: tokens.decorativeTertiary,
    },
    layout: {
      ...(profile.layout || {}),
      backgroundStyle: "udevs_screenshot",
    },
    warnings: [...new Set(warnings)],
  };
}

function weightedSnapshotChoice(rows, valueKey, scoreForRow, predicate = () => true) {
  const scored = new Map();
  for (const row of rows) {
    const rgb = parseCssColor(row?.[valueKey]);
    if (!rgb || !predicate(rgb, row)) continue;
    const hex = rgbToHex(rgb);
    const score = Math.max(0.01, Number(scoreForRow(row, rgb)) || 0.01);
    scored.set(hex, { rgb, score: (scored.get(hex)?.score || 0) + score });
  }
  return [...scored.values()].sort((left, right) => right.score - left.score)[0]?.rgb || null;
}

function weightedSnapshotFont(rows, predicate, fallback) {
  const scored = new Map();
  for (const row of rows) {
    if (!predicate(row)) continue;
    const stack = normalizedReferenceFontStack(row?.fontFamily, "");
    if (!stack) continue;
    const score = Math.max(1, Number(row?.textLength || 0)) * Math.max(1, Number(row?.fontWeight || 400) / 400);
    scored.set(stack, (scored.get(stack) || 0) + score);
  }
  const selected = [...scored.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  return normalizedReferenceFontStack(selected, fallback);
}

function colorDistance(left, right) {
  if (!left || !right) return 1;
  const delta = Math.sqrt(
    ((left.r - right.r) ** 2)
    + ((left.g - right.g) ** 2)
    + ((left.b - right.b) ** 2),
  );
  return delta / Math.sqrt(3 * (255 ** 2));
}

function snapshotDescriptor(row = {}) {
  return [
    row.tag,
    row.role,
    row.id,
    row.className,
    row.ariaLabel,
    row.name,
    row.pseudo,
  ].filter(Boolean).join(" ").toLowerCase();
}

function extractCssColors(value = "") {
  return [...String(value || "").matchAll(/#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]+\)/gi)]
    .map((match) => parseCssColor(match[0]))
    .filter(Boolean);
}

function addSnapshotPaletteCandidate(candidates, color, {
  score = 1,
  descriptor = "",
  source = "element",
  textCandidate = false,
} = {}) {
  const rgb = typeof color === "string" ? parseCssColor(color) : color;
  if (!rgb || rgb.a <= 0.2) return;
  const hex = rgbToHex(rgb);
  const hsl = rgbToHsl(rgb);
  const brandSignal = /brand|logo|identity|theme/.test(descriptor);
  const secondarySignal = /secondary|alternate|contrast|dark|nav|header|footer|text/.test(descriptor);
  const tertiarySignal = /accent|promo|sale|discount|danger|error|critical|alert|warning|success|positive|badge/.test(descriptor);
  const primarySignal = /primary|main|maincolor|cta|button|btn/.test(descriptor)
    || (brandSignal && !secondarySignal && !tertiarySignal);
  const chromatic = hsl.saturation >= 0.12 && hsl.lightness >= 0.035 && hsl.lightness <= 0.965;
  if (!chromatic && !brandSignal && !primarySignal && !secondarySignal && !tertiarySignal && !textCandidate) return;
  const row = candidates.get(hex) || {
    rgb,
    hex,
    score: 0,
    primaryScore: 0,
    secondaryScore: 0,
    tertiaryScore: 0,
    textScore: 0,
    roleScore: 0,
    sources: new Set(),
  };
  const saturationWeight = 0.55 + hsl.saturation * 1.45;
  const safeScore = Math.max(0.01, Number(score) || 0.01);
  row.score += safeScore * saturationWeight;
  row.primaryScore += safeScore * saturationWeight * (primarySignal ? 5 : brandSignal ? 4 : 1);
  row.secondaryScore += safeScore * (secondarySignal ? 5 : 1) * (0.8 + hsl.saturation);
  row.tertiaryScore += safeScore * saturationWeight * (tertiarySignal ? 6 : 1);
  if (textCandidate) row.textScore += safeScore;
  if (brandSignal || primarySignal || secondarySignal || tertiarySignal) row.roleScore += safeScore;
  row.sources.add(source);
  candidates.set(hex, row);
}

function selectSnapshotPalette(snapshot, rows, { canvas, textPrimary } = {}) {
  const candidates = new Map();
  for (const row of rows) {
    const tag = String(row.tag || "").toLowerCase();
    const descriptor = snapshotDescriptor(row);
    const interactive = ["a", "button"].includes(tag) || /button|btn|primary|brand|accent|cta|logo|promo|sale/.test(descriptor);
    const areaFactor = 1 + Math.min(3, Math.log10(Math.max(10, Number(row.area || 10))) / 2);
    for (const [key, base] of [
      ["backgroundColor", interactive ? 8 : 1.2],
      ["color", interactive ? 5 : 0.65],
      ["borderColor", interactive ? 3.5 : 0.45],
      ["outlineColor", interactive ? 2.5 : 0.25],
      ["fill", /logo|svg|icon/.test(descriptor) ? 9 : 2.5],
      ["stroke", /logo|svg|icon/.test(descriptor) ? 7 : 1.8],
    ]) {
      const colorDescriptor = key === "color"
        ? descriptor.replace(/\b(?:primary|maincolor|main|cta|button|btn|brand|logo)\b/g, "")
        : descriptor;
      addSnapshotPaletteCandidate(candidates, row[key], {
        score: base * areaFactor,
        descriptor: colorDescriptor,
        source: `element:${key}`,
        textCandidate: key === "color" && Number(row.textLength || 0) > 0,
      });
    }
  }
  for (const variable of Array.isArray(snapshot.cssVariables) ? snapshot.cssVariables.slice(0, 240) : []) {
    const descriptor = String(variable?.name || "").toLowerCase();
    for (const color of extractCssColors(variable?.value || "")) {
      addSnapshotPaletteCandidate(candidates, color, {
        score: /primary|brand|main|accent|secondary|success|warning|danger|error/.test(descriptor) ? 22 : 4,
        descriptor,
        source: "css-variable",
      });
    }
  }
  for (const declaration of Array.isArray(snapshot.styleColors) ? snapshot.styleColors.slice(0, 320) : []) {
    const descriptor = String(declaration?.selector || "").toLowerCase();
    for (const color of extractCssColors(declaration?.value || "")) {
      addSnapshotPaletteCandidate(candidates, color, {
        score: /brand|logo|primary|accent|promo|sale|discount|danger|error|success|warning/.test(descriptor) ? 14 : 5,
        descriptor,
        source: "stylesheet-role",
      });
    }
  }
  for (const logoColor of Array.isArray(snapshot.logoColors) ? snapshot.logoColors.slice(0, 12) : []) {
    addSnapshotPaletteCandidate(candidates, logoColor?.color, {
      score: 28 + Math.min(30, Math.log10(Math.max(1, Number(logoColor?.count || 1))) * 12),
      descriptor: "primary brand logo",
      source: "logo-pixels",
    });
  }
  for (const color of extractCssColors(snapshot.themeColor || "")) {
    addSnapshotPaletteCandidate(candidates, color, {
      score: 34,
      descriptor: "primary brand theme-color",
      source: "theme-color",
    });
  }
  if (textPrimary) {
    addSnapshotPaletteCandidate(candidates, textPrimary, {
      score: 10,
      descriptor: "secondary text",
      source: "dominant-text",
      textCandidate: true,
    });
  }
  if (canvas && rgbToHsl(canvas).saturation >= 0.08) {
    addSnapshotPaletteCandidate(candidates, canvas, {
      score: 8,
      descriptor: "secondary background",
      source: "canvas",
    });
  }

  const all = [...candidates.values()].filter((candidate) => {
    if (!canvas) return true;
    const distance = colorDistance(candidate.rgb, canvas);
    return distance >= 0.035 || candidate.roleScore > 0 || candidate.textScore > 0;
  });
  if (!all.length) return { palette: [], candidates: [] };
  const chromatic = all.filter((candidate) => {
    const hsl = rgbToHsl(candidate.rgb);
    return hsl.saturation >= 0.12 && hsl.lightness >= 0.035 && hsl.lightness <= 0.965;
  });
  const primaryPool = chromatic.length ? chromatic : all;
  const declaredLogoColors = (Array.isArray(snapshot.logoColors) ? snapshot.logoColors : [])
    .map((row) => parseCssColor(row?.color))
    .filter(Boolean)
    .map((color) => candidates.get(rgbToHex(color)))
    .filter(Boolean);
  const declaredThemeColor = extractCssColors(snapshot.themeColor || "")
    .map((color) => rgbToHex(color))
    .map((hex) => candidates.get(hex))
    .find((candidate) => candidate && rgbToHsl(candidate.rgb).saturation >= 0.12);
  const primary = declaredThemeColor
    || declaredLogoColors[0]
    || [...primaryPool].sort((left, right) => right.primaryScore - left.primaryScore || right.score - left.score)[0];
  const remaining = all.filter((candidate) => candidate.hex !== primary?.hex);
  const hueDistance = (left, right) => {
    const delta = Math.abs(rgbToHsl(left).hue - rgbToHsl(right).hue);
    return Math.min(delta, 1 - delta);
  };
  const secondaryLogoColor = declaredLogoColors.find((candidate) => candidate.hex !== primary?.hex
    && hueDistance(candidate.rgb, primary?.rgb) >= 0.12);
  const secondary = secondaryLogoColor
    || [...remaining].sort((left, right) => {
    const leftRank = left.secondaryScore + left.textScore * 2 + left.score * 0.25 + colorDistance(left.rgb, primary?.rgb) * 28;
    const rightRank = right.secondaryScore + right.textScore * 2 + right.score * 0.25 + colorDistance(right.rgb, primary?.rgb) * 28;
    return rightRank - leftRank;
  })[0];
  const tertiaryCandidates = remaining.filter((candidate) => candidate.hex !== secondary?.hex);
  const chromaticTertiaryCandidates = tertiaryCandidates.filter((candidate) => {
    const hsl = rgbToHsl(candidate.rgb);
    return hsl.saturation >= 0.18 && colorDistance(candidate.rgb, primary?.rgb) >= 0.06;
  });
  const tertiaryLogoColor = declaredLogoColors.find((candidate) => candidate.hex !== primary?.hex
    && candidate.hex !== secondary?.hex
    && hueDistance(candidate.rgb, primary?.rgb) >= 0.12
    && hueDistance(candidate.rgb, secondary?.rgb) >= 0.1);
  const tertiary = tertiaryLogoColor
    || [...(chromaticTertiaryCandidates.length ? chromaticTertiaryCandidates : tertiaryCandidates)].sort((left, right) => {
    const leftDistance = Math.min(colorDistance(left.rgb, primary?.rgb), colorDistance(left.rgb, secondary?.rgb));
    const rightDistance = Math.min(colorDistance(right.rgb, primary?.rgb), colorDistance(right.rgb, secondary?.rgb));
    const leftRank = left.tertiaryScore + left.score * 0.3 + leftDistance * 32;
    const rightRank = right.tertiaryScore + right.score * 0.3 + rightDistance * 32;
    return rightRank - leftRank;
  })[0];
  const selected = [primary, secondary, tertiary].filter(Boolean);
  const selectedRank = new Map(selected.map((candidate, index) => [candidate.hex, index]));
  const rankedCandidates = [...all]
    .sort((left, right) => {
      const leftSelected = selectedRank.has(left.hex) ? selectedRank.get(left.hex) : 99;
      const rightSelected = selectedRank.has(right.hex) ? selectedRank.get(right.hex) : 99;
      if (leftSelected !== rightSelected) return leftSelected - rightSelected;
      const leftRank = Math.max(left.primaryScore, left.secondaryScore, left.tertiaryScore) + left.textScore + left.score * 0.35;
      const rightRank = Math.max(right.primaryScore, right.secondaryScore, right.tertiaryScore) + right.textScore + right.score * 0.35;
      return rightRank - leftRank;
    })
    .slice(0, 18)
    .map((candidate) => ({
      color: candidate.hex,
      sources: [...candidate.sources].sort(),
      primaryScore: Number(candidate.primaryScore.toFixed(2)),
      secondaryScore: Number(candidate.secondaryScore.toFixed(2)),
      textScore: Number(candidate.textScore.toFixed(2)),
    }));
  return {
    palette: selected.map((candidate) => candidate.rgb),
    candidates: rankedCandidates,
  };
}

function semanticPaletteColor(palette, predicate, fallback) {
  return palette.find((color) => predicate(rgbToHsl(color))) || fallback;
}

function tokensFromReferenceVisuals({ canvas, surfaces = [], palette = [], textPrimary, displayStack, bodyStack } = {}) {
  const safeCanvas = canvas || parseCssColor("#FFFFFF");
  const dark = relativeRgbLuminance(safeCanvas) < 0.42;
  const defaultText = parseCssColor(dark ? "#F5F5F2" : "#171717");
  const safeText = contrastSafeRgb(textPrimary, safeCanvas, 7, defaultText);
  const defaultAccent = parseCssColor("#0052FF");
  const observedPalette = palette.filter(Boolean);
  const rawPrimary = observedPalette[0] || defaultAccent;
  const rawSecondary = observedPalette[1] || safeText;
  const rawTertiary = observedPalette[2] || mixRgb(rawPrimary, rawSecondary, 0.5);
  // The brand accent is split in two: `vividAccent` keeps the site's real
  // saturation for decorative surfaces (borders, fills, tints, heat maps,
  // watermark numerals) and only needs to stay visible against the canvas;
  // `textAccent` is the darkened contrast-safe variant that colors text.
  // Forcing 4.5:1 onto the decorative accent is what turned a bright yellow
  // site (texnomart.uz) into a muddy olive deck.
  const vividAccent = contrastSafeRgb(rawPrimary, safeCanvas, 1.2, defaultAccent);
  const textAccent = contrastSafeRgb(rawPrimary, safeCanvas, 4.5, defaultAccent);
  const observedSurface = surfaces.find((surface) => colorDistance(surface, safeCanvas) >= 0.025);
  const surface1 = observedSurface || mixRgb(safeCanvas, safeText, dark ? 0.08 : 0.035);
  const surface2 = mixRgb(safeCanvas, vividAccent, dark ? 0.16 : 0.09);
  const rule = mixRgb(safeCanvas, safeText, dark ? 0.2 : 0.14);
  // Secondary text and accents also sit on tinted panels (surface2 and
  // brand-alpha fills), so they must clear the ratio against the strongest
  // tint the renderer produces, not just the bare canvas.
  const strongestTint = mixRgb(safeCanvas, vividAccent, dark ? 0.22 : 0.16);
  const secondaryText = contrastSafeRgb(mixRgb(safeText, safeCanvas, 0.32), strongestTint, 4.6, safeText);
  const secondaryAccent = contrastSafeRgb(rawSecondary, strongestTint, 4.6, textAccent);
  const green = semanticPaletteColor(observedPalette, ({ hue, saturation }) => saturation >= 0.2 && hue >= 0.2 && hue <= 0.5, rawSecondary);
  const yellow = semanticPaletteColor(observedPalette, ({ hue, saturation }) => saturation >= 0.2 && hue >= 0.05 && hue <= 0.2, rawTertiary);
  const red = semanticPaletteColor(observedPalette, ({ hue, saturation }) => saturation >= 0.2 && (hue <= 0.05 || hue >= 0.9), rawTertiary);
  const positive = contrastSafeRgb(green, strongestTint, 4.6, textAccent);
  const warning = contrastSafeRgb(yellow, strongestTint, 4.6, textAccent);
  const critical = contrastSafeRgb(red, strongestTint, 4.6, textAccent);
  return {
    brand: rgbToHex(vividAccent),
    primary: rgbToHex(vividAccent),
    brandDeep: rgbToHex(secondaryAccent),
    brandDark: rgbToHex(mixRgb(secondaryAccent, safeText, 0.22)),
    brandTint: rgbToHex(surface2),
    brandSoft: rgbToHex(mixRgb(safeCanvas, vividAccent, dark ? 0.08 : 0.045)),
    canvas: rgbToHex(safeCanvas),
    surface1: rgbToHex(surface1),
    surface2: rgbToHex(surface2),
    textPrimary: rgbToHex(safeText),
    textSecondary: rgbToHex(secondaryText),
    rule: rgbToHex(rule),
    secondary: rgbToHex(secondaryAccent),
    positive: rgbToHex(positive),
    warning: rgbToHex(warning),
    critical: rgbToHex(critical),
    decorativePrimary: rgbToHex(rawPrimary),
    decorativeSecondary: rgbToHex(rawSecondary),
    decorativeTertiary: rgbToHex(rawTertiary),
    displayStack: normalizedReferenceFontStack(displayStack, "Arial, sans-serif"),
    bodyStack: normalizedReferenceFontStack(bodyStack, "Arial, sans-serif"),
    metadataStack: "SFMono-Regular, Menlo, Consolas, monospace",
  };
}

function analyzeReferenceThemeSnapshot(snapshot = {}, { referenceUrl = "" } = {}) {
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows.filter((row) => row && typeof row === "object").slice(0, 640) : [];
  if (!rows.length) throw new Error("reference style snapshot did not contain usable visual data");
  const largeTags = new Set(["html", "body", "main", "section", "header", "footer"]);
  const canvas = weightedSnapshotChoice(
    rows,
    "backgroundColor",
    (row) => Math.max(1, Number(row.area || 0)) * (largeTags.has(String(row.tag || "").toLowerCase()) ? 5 : 1),
    (rgb) => rgb.a > 0.25,
  ) || parseCssColor(snapshot.themeColor) || parseCssColor("#FFFFFF");
  const textPrimary = weightedSnapshotChoice(
    rows,
    "color",
    (row) => Math.max(1, Number(row.textLength || 0)) * (/^h[1-3]$/.test(String(row.tag || "").toLowerCase()) ? 2.5 : 1),
    (rgb) => rgbContrastRatio(rgb, canvas) >= 4.5,
  );
  const surfaceRows = rows.filter((row) => largeTags.has(String(row.tag || "").toLowerCase()));
  const surfaces = [...new Map(surfaceRows
    .map((row) => parseCssColor(row.backgroundColor))
    .filter((color) => color && color.a > 0.25)
    .map((color) => [rgbToHex(color), color])).values()];
  const paletteSelection = selectSnapshotPalette(snapshot, rows, { canvas, textPrimary });
  const displayStack = weightedSnapshotFont(rows, (row) => /^h[1-3]$/.test(String(row.tag || "").toLowerCase()), "Arial, sans-serif");
  const bodyStack = weightedSnapshotFont(rows, (row) => /^(?:body|main|p|li|a|button|span)$/.test(String(row.tag || "").toLowerCase()), displayStack);
  const visualInputs = {
    canvas,
    surfaces,
    palette: paletteSelection.palette,
    textPrimary,
    displayStack,
    bodyStack,
  };
  return {
    themeTokens: tokensFromReferenceVisuals(visualInputs),
    candidates: paletteSelection.candidates,
    visualInputs,
    referenceUrl,
  };
}

export function deriveReferenceThemeFromSnapshot(snapshot = {}, { referenceUrl = "" } = {}) {
  return analyzeReferenceThemeSnapshot(snapshot, { referenceUrl }).themeTokens;
}

function darkThemeTokensFromAccent(value = "") {
  const accent = parseCssColor(value);
  if (!accent) throw new Error("accent is not a supported RGB/hex color");
  const canvas = parseCssColor(KP_PREMIUM_CANVAS);
  return {
    brand: rgbToHex(accent),
    // Legacy token names are retained for the renderer contract, but the
    // values are deliberately dark-theme-safe.
    brandDeep: rgbToHex(accessibleAccentOnDark(accent, canvas)),
    brandTint: rgbToHex(mixRgb(accent, canvas, 0.72)),
  };
}

function normalizedExplicitThemeTokens(value = null) {
  const supplied = Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
  const tokens = {};
  const warnings = [];
  if (!supplied) return { supplied: false, tokens, warnings };
  for (const key of KP_THEME_COLOR_KEYS) {
    if (value[key] === undefined || value[key] === null || value[key] === "") continue;
    const parsed = parseCssColor(value[key]);
    if (!parsed) {
      warnings.push(`Explicit theme token ${key} was ignored because it is not a supported RGB/hex color.`);
      continue;
    }
    tokens[key] = rgbToHex(parsed);
  }
  for (const key of KP_THEME_FONT_KEYS) {
    if (value[key] === undefined || value[key] === null || value[key] === "") continue;
    const normalized = normalizedReferenceFontStack(value[key], "");
    if (!normalized) {
      warnings.push(`Explicit theme token ${key} was ignored because it is not a safe font stack.`);
      continue;
    }
    tokens[key] = normalized;
  }
  if (!Object.keys(tokens).length) {
    warnings.push("Explicit themeTokens did not contain a usable color; brand evidence fallback was attempted.");
  }
  return { supplied, tokens, warnings };
}

function normalizedPublicBrandUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0")) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/i.test(url.protocol) || url.username || url.password) return "";
    const hostname = url.hostname.toLowerCase();
    if (
      /^(?:localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?)$/i.test(hostname)
      || hostname.endsWith(".local")
    ) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|session|auth|signature|sig|secret|access|^t$|^utm_|gclid|fbclid/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString().replace(/\?$/, "").replace(/\/$/, "");
  } catch {
    return "";
  }
}

function cssVariables(theme = {}) {
  const brand = theme.brand || "#3155FF";
  const brandTint = theme.brandTint || "#E9EFFF";
  const brandDeep = theme.brandDeep || "#1D4ED8";
  return `
      --page: #F3F6FA;
      --ink: #111827;
      --brand: ${brand};
      --brand-tint: ${brandTint};
      --brand-deep: ${brandDeep};
      --muted: #5F6F85;
      --faint: #94A0B3;
      --line: #DCE4EE;
      --good: #12A471;
      --good-tint: #EAF6F0;
      --warn: #E0A300;
      --warn-tint: #FBF2DF;
      --bad: #E04F4F;
      --bad-tint: #FBE9E9;
      --shadow-table-card: 0 14px 36px -26px rgba(16,24,40,0.3);
      --shadow-text-card: 0 10px 30px -22px rgba(16,24,40,0.25);
      --shadow-cover-hero: 0 1px 2px rgba(16,24,40,0.04), 0 20px 44px -28px rgba(16,24,40,0.3);`;
}

function paletteAiEnabled(env = process.env) {
  return String(env.KP_REFERENCE_PALETTE_AI_ENABLED ?? "1").trim() !== "0";
}

function normalizedPaletteCandidates(candidates = []) {
  const seen = new Set();
  const normalized = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const color = String(candidate?.color || candidate || "").trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(color) || seen.has(color)) continue;
    seen.add(color);
    normalized.push({
      color,
      sources: Array.isArray(candidate?.sources)
        ? candidate.sources.map((source) => safeText(source, 60)).filter(Boolean).slice(0, 6)
        : [],
      primaryScore: Number(candidate?.primaryScore || 0),
      secondaryScore: Number(candidate?.secondaryScore || 0),
      textScore: Number(candidate?.textScore || 0),
    });
    if (normalized.length >= 18) break;
  }
  return normalized;
}

function paletteAiErrorReason(error) {
  if (error?.name === "AbortError") return "timeout";
  const status = Number(error?.status || error?.response?.status || 0);
  const message = String(error?.message || "").toLowerCase();
  if (status === 401 || status === 403 || /api key|authentication|unauthorized|forbidden/.test(message)) return "authentication_failed";
  if (status === 408) return "timeout";
  if (status === 429 || /rate limit/.test(message)) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status >= 400) return "provider_request_rejected";
  return "provider_request_failed";
}

function resolvePaletteAiProvider(env = process.env, client = null) {
  if (client?.messages?.create) return "anthropic";
  if (client?.responses?.create) return "openai";
  const configured = String(env.KP_REFERENCE_PALETTE_AI_PROVIDER || "auto").trim().toLowerCase();
  if (configured === "anthropic" || configured === "openai") return configured;
  if (env.ANTHROPIC_API_KEY || String(env.OPENAI_API_KEY || "").startsWith("sk-ant-")) return "anthropic";
  return "openai";
}

function paletteAiApiKey(provider, env = process.env) {
  if (provider === "anthropic") {
    return String(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || "").trim();
  }
  return String(env.OPENAI_API_KEY || "").trim();
}

function paletteAiModel(provider, env = process.env) {
  const configured = String(env.KP_REFERENCE_PALETTE_AI_MODEL || "").trim();
  if (configured) return configured;
  if (provider === "anthropic") return String(env.CLAUDE_MODEL || "claude-sonnet-4-5").trim();
  return String(env.KP_REFERENCE_VISION_MODEL || "gpt-4.1-mini").trim();
}

export async function classifyBrandPaletteWithAi({
  screenshot = null,
  candidates = [],
  referenceUrl = "",
} = {}, {
  env = process.env,
  client = null,
} = {}) {
  const normalizedCandidates = normalizedPaletteCandidates(candidates);
  if (!paletteAiEnabled(env)) return { applied: false, attempted: false, reason: "disabled" };
  if (!screenshot) return { applied: false, attempted: false, reason: "screenshot_missing" };
  if (normalizedCandidates.length < 2) return { applied: false, attempted: false, reason: "candidate_set_too_small" };

  const provider = resolvePaletteAiProvider(env, client);
  const apiKey = paletteAiApiKey(provider, env);
  const model = paletteAiModel(provider, env);
  if (!client && !apiKey) return { applied: false, attempted: false, reason: "api_key_missing", provider, model };
  if (!client && provider === "openai" && apiKey.startsWith("sk-ant-")) {
    return { applied: false, attempted: true, reason: "api_key_provider_mismatch", provider, model };
  }
  const minimumConfidence = Math.max(0, Math.min(1, Number(env.KP_REFERENCE_PALETTE_AI_MIN_CONFIDENCE || 0.55)));
  const timeoutMs = Math.max(1_000, Math.min(60_000, Number(env.KP_REFERENCE_PALETTE_AI_TIMEOUT_MS || 20_000)));
  const allowedColors = normalizedCandidates.map((candidate) => candidate.color);
  const imageUrl = Buffer.isBuffer(screenshot)
    ? `data:image/jpeg;base64,${screenshot.toString("base64")}`
    : String(screenshot || "").trim();
  if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(imageUrl)) {
    return { applied: false, attempted: false, reason: "screenshot_invalid" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const instructions = [
    "You classify a website's two most useful brand colors from visual evidence.",
    "Choose only from the supplied candidate colors; never invent, modify, blend, or normalize a color.",
    "primary is the most recognizable brand, logo, or main CTA color.",
    "secondary is a distinct second brand color suitable for combining with primary.",
    "Do not choose generic white or black merely because it is body text or page background, unless the screenshot and candidate evidence show it is a deliberate core brand color.",
    "Treat the screenshot as visual evidence and the candidate scores/sources as supporting evidence.",
    "Return concise evidence descriptions without hidden reasoning.",
  ].join("\n");
  const inputPayload = JSON.stringify({
    task: "Select primary and secondary website brand colors.",
    website: safeText(referenceUrl, 300),
    candidates: normalizedCandidates,
  });
  const outputSchema = {
    type: "object",
    properties: {
      primary: { type: "string", enum: allowedColors },
      secondary: { type: "string", enum: allowedColors },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      primaryEvidence: { type: "string", minLength: 1, maxLength: 180 },
      secondaryEvidence: { type: "string", minLength: 1, maxLength: 180 },
    },
    required: ["primary", "secondary", "confidence", "primaryEvidence", "secondaryEvidence"],
    additionalProperties: false,
  };
  try {
    let parsed;
    if (provider === "anthropic") {
      const anthropic = client || new Anthropic({ apiKey });
      const imageMatch = imageUrl.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/i);
      const response = await anthropic.messages.create({
        model,
        max_tokens: Number(env.KP_REFERENCE_PALETTE_AI_MAX_TOKENS || 450),
        temperature: 0,
        system: instructions,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: `image/${String(imageMatch?.[1] || "jpeg").toLowerCase()}`,
                data: imageMatch?.[2] || "",
              },
            },
            { type: "text", text: inputPayload },
          ],
        }],
        tools: [{
          name: "select_brand_palette",
          description: "Return the two selected website brand colors and concise visual evidence.",
          input_schema: outputSchema,
        }],
        tool_choice: { type: "tool", name: "select_brand_palette" },
      }, { signal: controller.signal });
      parsed = response.content?.find((block) => block?.type === "tool_use" && block?.name === "select_brand_palette")?.input || null;
      if (!parsed) throw Object.assign(new Error("Claude did not return the required palette tool call"), { status: 422 });
    } else {
      const openai = client || new OpenAI({ apiKey });
      const response = await openai.responses.create({
        model,
        store: false,
        max_output_tokens: Number(env.KP_REFERENCE_PALETTE_AI_MAX_TOKENS || 450),
        instructions,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: inputPayload },
            {
              type: "input_image",
              image_url: imageUrl,
              detail: "low",
            },
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "website_brand_palette",
            strict: true,
            schema: outputSchema,
          },
        },
      }, { signal: controller.signal });
      parsed = JSON.parse(String(response.output_text || "{}"));
    }
    const primary = String(parsed.primary || "").toUpperCase();
    const secondary = String(parsed.secondary || "").toUpperCase();
    const confidence = Number(parsed.confidence);
    if (!allowedColors.includes(primary) || !allowedColors.includes(secondary)) {
      return { applied: false, attempted: true, reason: "candidate_constraint_failed", provider, model };
    }
    if (primary === secondary) {
      return { applied: false, attempted: true, reason: "colors_not_distinct", provider, model };
    }
    if (!Number.isFinite(confidence) || confidence < minimumConfidence) {
      return { applied: false, attempted: true, reason: "confidence_too_low", confidence, provider, model };
    }
    return {
      applied: true,
      attempted: true,
      mode: "ai_vision",
      provider,
      model,
      primary,
      secondary,
      confidence: Number(confidence.toFixed(3)),
      primaryEvidence: safeText(parsed.primaryEvidence, 180),
      secondaryEvidence: safeText(parsed.secondaryEvidence, 180),
    };
  } catch (error) {
    return { applied: false, attempted: true, reason: paletteAiErrorReason(error), provider, model };
  } finally {
    clearTimeout(timeout);
  }
}

export async function classifyBrandPaletteFromDomainWithAi({
  referenceUrl = "",
  captureFailure = "",
} = {}, {
  env = process.env,
  client = null,
} = {}) {
  if (!paletteAiEnabled(env)) return { applied: false, attempted: false, reason: "disabled" };
  const normalizedUrl = normalizedPublicBrandUrl(referenceUrl);
  if (!normalizedUrl) return { applied: false, attempted: false, reason: "reference_url_invalid" };

  const provider = resolvePaletteAiProvider(env, client);
  const apiKey = paletteAiApiKey(provider, env);
  const model = paletteAiModel(provider, env);
  if (!client && !apiKey) return { applied: false, attempted: false, reason: "api_key_missing", provider, model };
  if (!client && provider === "openai" && apiKey.startsWith("sk-ant-")) {
    return { applied: false, attempted: true, reason: "api_key_provider_mismatch", provider, model };
  }

  const minimumConfidence = Math.max(0, Math.min(1, Number(
    env.KP_REFERENCE_PALETTE_AI_DOMAIN_MIN_CONFIDENCE
      || env.KP_REFERENCE_PALETTE_AI_MIN_CONFIDENCE
      || 0.55,
  )));
  const timeoutMs = Math.max(1_000, Math.min(60_000, Number(
    env.KP_REFERENCE_PALETTE_AI_DOMAIN_TIMEOUT_MS
      || env.KP_REFERENCE_PALETTE_AI_TIMEOUT_MS
      || 20_000,
  )));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const instructions = [
    "You identify the two core brand colors of a public website when direct automated access to the site is unavailable.",
    "Use the website domain, recognizable company identity, and your reliable public knowledge of the brand.",
    "Return exact six-digit hexadecimal colors in #RRGGBB format.",
    "Prefer exact canonical or published digital brand tokens; never replace an uncertain token with a visually similar CSS framework, Material, or generic UI color.",
    "primary is the most recognizable logo, identity, or main CTA color.",
    "secondary is a distinct supporting brand color suitable for combining with primary.",
    "Do not choose generic white or black merely as a convenient background or text color unless it is deliberately central to the brand identity.",
    "Do not invent a plausible category palette. If the identity is uncertain, lower confidence instead.",
    "Evidence descriptions must state that they come from known brand identity or domain inference, not from a successful live-site inspection.",
    "Return concise evidence descriptions without hidden reasoning.",
  ].join("\n");
  const inputPayload = JSON.stringify({
    task: "Return the primary and secondary brand palette for this website.",
    website: normalizedUrl,
    domain: new URL(normalizedUrl).hostname,
    liveAccess: "unavailable",
    accessFailure: safeText(captureFailure, 180),
  });
  const colorSchema = { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" };
  const outputSchema = {
    type: "object",
    properties: {
      primary: colorSchema,
      secondary: colorSchema,
      confidence: { type: "number", minimum: 0, maximum: 1 },
      primaryEvidence: { type: "string", minLength: 1, maxLength: 180 },
      secondaryEvidence: { type: "string", minLength: 1, maxLength: 180 },
    },
    required: ["primary", "secondary", "confidence", "primaryEvidence", "secondaryEvidence"],
    additionalProperties: false,
  };

  try {
    let parsed;
    if (provider === "anthropic") {
      const anthropic = client || new Anthropic({ apiKey });
      const response = await anthropic.messages.create({
        model,
        max_tokens: Number(env.KP_REFERENCE_PALETTE_AI_MAX_TOKENS || 450),
        temperature: 0,
        system: instructions,
        messages: [{
          role: "user",
          content: [{ type: "text", text: inputPayload }],
        }],
        tools: [{
          name: "select_brand_palette",
          description: "Return two known website brand colors and concise provenance.",
          input_schema: outputSchema,
        }],
        tool_choice: { type: "tool", name: "select_brand_palette" },
      }, { signal: controller.signal });
      parsed = response.content?.find((block) => block?.type === "tool_use" && block?.name === "select_brand_palette")?.input || null;
      if (!parsed) throw Object.assign(new Error("Claude did not return the required palette tool call"), { status: 422 });
    } else {
      const openai = client || new OpenAI({ apiKey });
      const response = await openai.responses.create({
        model,
        store: false,
        max_output_tokens: Number(env.KP_REFERENCE_PALETTE_AI_MAX_TOKENS || 450),
        instructions,
        input: [{
          role: "user",
          content: [{ type: "input_text", text: inputPayload }],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "website_domain_brand_palette",
            strict: true,
            schema: outputSchema,
          },
        },
      }, { signal: controller.signal });
      parsed = JSON.parse(String(response.output_text || "{}"));
    }

    const primary = String(parsed.primary || "").toUpperCase();
    const secondary = String(parsed.secondary || "").toUpperCase();
    const confidence = Number(parsed.confidence);
    if (!/^#[0-9A-F]{6}$/.test(primary) || !/^#[0-9A-F]{6}$/.test(secondary)) {
      return { applied: false, attempted: true, reason: "invalid_color_format", provider, model };
    }
    if (primary === secondary) {
      return { applied: false, attempted: true, reason: "colors_not_distinct", provider, model };
    }
    if (!Number.isFinite(confidence) || confidence < minimumConfidence) {
      return { applied: false, attempted: true, reason: "confidence_too_low", confidence, provider, model };
    }
    return {
      applied: true,
      attempted: true,
      mode: "ai_domain_fallback",
      provider,
      model,
      primary,
      secondary,
      confidence: Number(confidence.toFixed(3)),
      primaryEvidence: safeText(parsed.primaryEvidence, 180),
      secondaryEvidence: safeText(parsed.secondaryEvidence, 180),
    };
  } catch (error) {
    return { applied: false, attempted: true, reason: paletteAiErrorReason(error), provider, model };
  } finally {
    clearTimeout(timeout);
  }
}

function themeWithPaletteSelection(analysis, decision) {
  if (!decision?.applied) {
    return {
      ...analysis.themeTokens,
      paletteSelection: {
        mode: "deterministic",
        aiAttempted: decision?.attempted === true,
        reason: decision?.reason || "not_attempted",
        provider: decision?.provider || "",
        model: decision?.model || "",
      },
    };
  }
  const primary = parseCssColor(decision.primary);
  const secondary = parseCssColor(decision.secondary);
  const tertiary = analysis.visualInputs.palette.find((color) => {
    const hex = rgbToHex(color);
    return hex !== decision.primary && hex !== decision.secondary;
  }) || mixRgb(primary, secondary, 0.5);
  const themeTokens = tokensFromReferenceVisuals({
    ...analysis.visualInputs,
    palette: [primary, secondary, tertiary],
  });
  return {
    ...themeTokens,
    paletteSelection: {
      mode: "ai_vision",
      aiAttempted: true,
      provider: decision.provider,
      model: decision.model,
      confidence: decision.confidence,
      primaryEvidence: decision.primaryEvidence,
      secondaryEvidence: decision.secondaryEvidence,
    },
  };
}

function themeFromDomainPaletteDecision(decision, { captureFailure = "" } = {}) {
  const primary = parseCssColor(decision.primary);
  const secondary = parseCssColor(decision.secondary);
  const generated = tokensFromReferenceVisuals({
    canvas: primary,
    surfaces: [mixRgb(primary, secondary, 0.07)],
    palette: [primary, secondary, secondary],
    textPrimary: secondary,
  });
  const {
    displayStack: _displayStack,
    bodyStack: _bodyStack,
    metadataStack: _metadataStack,
    ...themeTokens
  } = generated;
  return {
    ...themeTokens,
    brand: decision.primary,
    primary: decision.primary,
    brandDeep: decision.secondary,
    secondary: decision.secondary,
    canvas: decision.primary,
    decorativePrimary: decision.primary,
    decorativeSecondary: decision.secondary,
    decorativeTertiary: decision.secondary,
    paletteSelection: {
      mode: "ai_domain_fallback",
      aiAttempted: true,
      provider: decision.provider,
      model: decision.model,
      confidence: decision.confidence,
      primaryEvidence: decision.primaryEvidence,
      secondaryEvidence: decision.secondaryEvidence,
      captureFailure: safeText(captureFailure, 180),
    },
  };
}

export async function extractReferenceTheme(referenceUrl = "", options = {}) {
  if (!referenceUrl) return {};
  const env = options.env || process.env;
  const normalizedUrl = normalizedPublicBrandUrl(referenceUrl);
  if (!normalizedUrl) throw new Error("Brand palette URL is not a safe public HTTP(S) URL.");
  let browser;
  try {
    browser = await launchKpChromium({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const navigation = await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: Number(env.KP_REFERENCE_THEME_TIMEOUT_MS || 12_000) });
    if (navigation && navigation.status() >= 400) {
      throw new Error(`reference website returned HTTP ${navigation.status()}`);
    }
    await page.waitForTimeout(Number(env.KP_REFERENCE_THEME_SETTLE_MS || 1_500));
    const accessState = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      text: String(document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 700),
    }));
    const accessText = `${accessState.title} ${accessState.text} ${accessState.url}`.toLowerCase();
    if (/showcaptcha|captcha|not a robot|access to our service has been temporarily blocked|access denied|forbidden|too many requests|cf-chl-|challenge-platform|verify you are human/.test(accessText)) {
      throw new Error("reference website returned an anti-bot or access-denied page");
    }
    const snapshot = await page.evaluate(() => {
      const selectors = [
        "[class*=brand]", "[class*=logo]", "[class*=primary]", "[class*=secondary]", "[class*=accent]", "[class*=promo]",
        "[class*=sale]", "[class*=discount]", "[class*=success]", "[class*=danger]", "[class*=warning]", "[role=button]",
        "button", "svg", "svg path", "svg circle", "svg rect", "header", "nav", "main", "section", "footer", "h1", "h2", "h3",
        "a", "p", "li", "span", "html", "body",
        "[class*=btn]", "[class*=button]", "[class*=card]",
      ];
      const priorityNodes = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)).slice(0, 90));
      const generalNodes = Array.from(document.querySelectorAll("body *")).filter((node, index) => index < 900);
      const nodes = [...new Set([...priorityNodes, ...generalNodes])].slice(0, 640);
      const rows = [];
      const pushRow = (node, pseudo = "") => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.top > innerHeight * 2.5) return;
        const style = getComputedStyle(node, pseudo || null);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) < 0.05) return;
        if (pseudo && (!style.content || style.content === "none" || style.content === "normal")) return;
        rows.push({
          tag: node.tagName.toLowerCase(),
          role: node.getAttribute("role") || "",
          id: String(node.id || "").slice(0, 100),
          className: String(node.className?.baseVal || node.className || "").slice(0, 220),
          ariaLabel: String(node.getAttribute("aria-label") || "").slice(0, 140),
          pseudo,
          area: Math.round(Math.min(innerWidth * innerHeight, rect.width * rect.height)),
          textLength: String(node.textContent || "").trim().slice(0, 500).length,
          color: style.color,
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          outlineColor: style.outlineColor,
          fill: style.fill,
          stroke: style.stroke,
          fontFamily: style.fontFamily,
          fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
        });
      };
      for (const node of nodes) {
        pushRow(node);
        if (rows.length < 620) pushRow(node, "::before");
        if (rows.length < 630) pushRow(node, "::after");
        if (rows.length >= 640) break;
      }
      const cssVariables = [];
      const styleColors = [];
      const logoColors = [];
      const seenVariables = new Set();
      const seenStyleColors = new Set();
      const addVariable = (name, value) => {
        const safeName = String(name || "").trim();
        const safeValue = String(value || "").trim();
        const key = `${safeName}:${safeValue}`;
        if (!safeName.startsWith("--") || !safeValue || seenVariables.has(key)) return;
        if (!/brand|primary|secondary|accent|theme|main|success|positive|warning|danger|error|critical/i.test(safeName)) return;
        seenVariables.add(key);
        cssVariables.push({ name: safeName.slice(0, 140), value: safeValue.slice(0, 240) });
      };
      const rootStyle = getComputedStyle(document.documentElement);
      for (const property of rootStyle) addVariable(property, rootStyle.getPropertyValue(property));
      const inspectRules = (rules) => {
        for (const rule of Array.from(rules || []).slice(0, 500)) {
          if (rule.style) {
            for (const property of rule.style) addVariable(property, rule.style.getPropertyValue(property));
            const selector = String(rule.selectorText || "");
            if (/brand|logo|primary|secondary|accent|promo|sale|discount|danger|error|critical|success|positive|warning|badge|price|gold|yellow|red|green/i.test(selector)) {
              for (const property of ["color", "background", "background-color", "border-color", "outline-color", "fill", "stroke"]) {
                const value = rule.style.getPropertyValue(property);
                const key = `${selector}:${property}:${value}`;
                if (!value || seenStyleColors.has(key)) continue;
                seenStyleColors.add(key);
                styleColors.push({ selector: selector.slice(0, 220), property, value: value.slice(0, 260) });
              }
            }
          }
          if (rule.cssRules) inspectRules(rule.cssRules);
          if (cssVariables.length >= 240 && styleColors.length >= 320) return;
        }
      };
      for (const sheet of Array.from(document.styleSheets).slice(0, 40)) {
        try {
          inspectRules(sheet.cssRules);
        } catch {}
        if (cssVariables.length >= 240 && styleColors.length >= 320) break;
      }
      const logoBuckets = new Map();
      const logoImages = [...new Set([
        ...document.querySelectorAll("img[class*=logo],img[alt*=logo i],img[src*=logo i],header [class*=logo] img,nav [class*=logo] img"),
      ])].filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width >= 16 && rect.height >= 12 && rect.top >= -120 && rect.top <= innerHeight * 0.6;
      }).slice(0, 12);
      for (const image of logoImages) {
        if (!image.complete || !image.naturalWidth || !image.naturalHeight) continue;
        const scale = Math.min(1, 240 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) continue;
        try {
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const step = Math.max(4, Math.floor(pixels.length / 30_000 / 4) * 4);
          for (let index = 0; index < pixels.length; index += step) {
            const red = pixels[index];
            const green = pixels[index + 1];
            const blue = pixels[index + 2];
            const alpha = pixels[index + 3];
            const max = Math.max(red, green, blue);
            const min = Math.min(red, green, blue);
            if (alpha < 96 || max - min < 28 || max < 35 || min > 235) continue;
            const key = `${Math.round(red / 16) * 16},${Math.round(green / 16) * 16},${Math.round(blue / 16) * 16}`;
            const bucket = logoBuckets.get(key) || { red: 0, green: 0, blue: 0, count: 0 };
            bucket.red += red;
            bucket.green += green;
            bucket.blue += blue;
            bucket.count += 1;
            logoBuckets.set(key, bucket);
          }
        } catch {}
      }
      const rankedLogoColors = [...logoBuckets.values()]
        .filter((bucket) => bucket.count >= 2)
        .sort((left, right) => right.count - left.count);
      for (const bucket of rankedLogoColors) {
        const rgb = {
          red: Math.round(bucket.red / bucket.count),
          green: Math.round(bucket.green / bucket.count),
          blue: Math.round(bucket.blue / bucket.count),
        };
        const distanceFromExisting = logoColors.every((row) => {
          const match = row.color.match(/^#(..)(..)(..)$/);
          if (!match) return true;
          const existing = match.slice(1).map((value) => Number.parseInt(value, 16));
          const distance = Math.sqrt(
            ((rgb.red - existing[0]) ** 2)
            + ((rgb.green - existing[1]) ** 2)
            + ((rgb.blue - existing[2]) ** 2),
          ) / 441.7;
          return distance >= 0.12;
        });
        if (!distanceFromExisting) continue;
        const color = `#${[rgb.red, rgb.green, rgb.blue].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
        logoColors.push({ color, count: bucket.count });
        if (logoColors.length >= 6) break;
      }
      const themeColor = Array.from(document.querySelectorAll("meta[name='theme-color']"))
        .map((node) => node.getAttribute("content"))
        .find(Boolean);
      return { url: location.href, themeColor: themeColor || "", rows, cssVariables, styleColors, logoColors };
    });
    const screenshot = await page.screenshot({
      type: "jpeg",
      quality: 68,
      fullPage: false,
      animations: "disabled",
    });
    const analysis = analyzeReferenceThemeSnapshot(snapshot, { referenceUrl: normalizedUrl });
    const decision = await classifyBrandPaletteWithAi({
      screenshot,
      candidates: analysis.candidates,
      referenceUrl: normalizedUrl,
    }, {
      env,
      client: options.client || null,
    });
    return themeWithPaletteSelection(analysis, decision);
  } catch (error) {
    const captureFailure = safeText(error.message, 180);
    const domainDecision = await classifyBrandPaletteFromDomainWithAi({
      referenceUrl: normalizedUrl,
      captureFailure,
    }, {
      env,
      client: options.client || null,
    });
    if (domainDecision.applied) {
      return themeFromDomainPaletteDecision(domainDecision, { captureFailure });
    }
    const domainFallbackReason = domainDecision.reason
      ? `; AI domain fallback was not applied (${safeText(domainDecision.reason, 80)})`
      : "";
    throw new Error(`Brand URL palette extraction failed for ${hostLabel(normalizedUrl)}: ${captureFailure}${domainFallbackReason}`);
  } finally {
    if (browser) await browser.close();
  }
}

const BRAND_ATTACHMENT_PATTERN = /brand|brend|brandbook|brand[- ]?guide|style[- ]?guide|guideline|identity|logo|logotip|palette|color|colour|rang|брендбук|бренд|логотип|айдентик/i;
const RASTER_BRAND_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"]);

function brandAttachmentDisplayName(file = {}) {
  return safeText(path.basename(String(file.fileName || file.path || "brand-evidence")), 90)
    .replace(/[\u0000-\u001F\u007F]/g, "") || "brand-evidence";
}

function brandAttachmentContext(file = {}, evidenceBundle = null) {
  return [
    file.fileName,
    file.type,
    file.mimeType,
    file.caption,
    file.description,
    evidenceBundle?.caption,
  ].filter(Boolean).join(" ");
}

function isLikelyBrandAttachment(file = {}, evidenceBundle = null) {
  if (!file?.path || file.error) return false;
  return BRAND_ATTACHMENT_PATTERN.test(brandAttachmentContext(file, evidenceBundle));
}

function brandAttachmentKind(file = {}) {
  const extension = path.extname(String(file.fileName || file.path || "")).toLowerCase();
  const mimeType = String(file.mimeType || "").toLowerCase();
  if (mimeType.includes("pdf") || extension === ".pdf") return "pdf";
  if ((mimeType.startsWith("image/") && mimeType !== "image/svg+xml") || RASTER_BRAND_EXTENSIONS.has(extension)) return "image";
  return "";
}

function brandAttachmentPriority(file = {}, evidenceBundle = null) {
  const context = brandAttachmentContext(file, evidenceBundle);
  if (/brandbook|brand[- ]?guide|брендбук/i.test(context)) return 4;
  if (/style[- ]?guide|guideline|identity|айдентик/i.test(context)) return 3;
  if (/logo|logotip|логотип/i.test(context)) return 2;
  return 1;
}

async function safeBrandAttachmentPath(file = {}) {
  const rawPath = String(file.path || "");
  if (!rawPath || rawPath.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) {
    throw new Error("attachment path is not a local filesystem path");
  }
  const realPath = await fs.realpath(rawPath);
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) throw new Error("attachment is not a regular file");
  const maxBytes = Math.max(1, Number(process.env.KP_BRAND_ATTACHMENT_MAX_MB || 40)) * 1024 * 1024;
  if (stat.size <= 0) throw new Error("attachment is empty");
  if (stat.size > maxBytes) throw new Error(`attachment exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB palette limit`);
  return realPath;
}

const BRAND_ACCENT_PYTHON = String.raw`
import colorsys
import json
import sys

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 40_000_000

def consume(image, buckets, stats):
    image = ImageOps.exif_transpose(image).convert("RGBA")
    image.thumbnail((520, 520), Image.Resampling.LANCZOS)
    pixels = list(image.getdata())
    step = max(1, len(pixels) // 180000)
    for red, green, blue, alpha in pixels[::step]:
        stats["sampled"] += 1
        if alpha < 80:
            continue
        rf, gf, bf = red / 255.0, green / 255.0, blue / 255.0
        hue, saturation, value = colorsys.rgb_to_hsv(rf, gf, bf)
        lightness = (max(rf, gf, bf) + min(rf, gf, bf)) / 2.0
        if saturation < 0.40 or lightness < 0.22 or lightness > 0.88 or value < 0.24:
            continue
        stats["candidates"] += 1
        key = (red // 24, green // 24, blue // 24)
        row = buckets.setdefault(key, [0, 0, 0, 0, 0.0, 0.0])
        row[0] += 1
        row[1] += red
        row[2] += green
        row[3] += blue
        row[4] += saturation
        row[5] += lightness

def main(file_path, kind):
    buckets = {}
    stats = {"sampled": 0, "candidates": 0, "pages": 1}
    if kind == "pdf":
        import pypdfium2 as pdfium
        document = pdfium.PdfDocument(file_path)
        stats["pages"] = min(3, len(document))
        for index in range(stats["pages"]):
            page = document[index]
            width, height = page.get_size()
            scale = max(0.5, min(1.25, 720.0 / max(width, height, 1)))
            bitmap = page.render(scale=scale)
            try:
                consume(bitmap.to_pil(), buckets, stats)
            finally:
                bitmap.close()
                page.close()
        document.close()
    else:
        with Image.open(file_path) as image:
            consume(image, buckets, stats)

    if stats["candidates"] < 12 or not buckets:
        raise ValueError("no sufficiently saturated dominant color was found")

    def score(row):
        count, _, _, _, saturation_sum, lightness_sum = row
        saturation = saturation_sum / count
        lightness = lightness_sum / count
        balance = max(0.45, 1.0 - abs(lightness - 0.52) * 0.9)
        return count * (0.55 + saturation) * balance

    winner = max(buckets.values(), key=score)
    count, red_sum, green_sum, blue_sum, saturation_sum, _ = winner
    red = round(red_sum / count)
    green = round(green_sum / count)
    blue = round(blue_sum / count)
    accent = "#{:02X}{:02X}{:02X}".format(red, green, blue)
    print(json.dumps({
        "accent": accent,
        "sampledPixels": stats["sampled"],
        "candidatePixels": stats["candidates"],
        "winningPixels": count,
        "meanSaturation": round(saturation_sum / count, 4),
        "pagesSampled": stats["pages"],
    }))

try:
    main(sys.argv[1], sys.argv[2])
except Exception as error:
    print(json.dumps({"error": f"{type(error).__name__}: {str(error)[:180]}"}))
    sys.exit(3)
`;

function safeThemeWarningReason(error, paths = []) {
  let message = safeText(error?.message || error || "unknown palette error", 220);
  for (const item of paths.filter(Boolean)) message = message.replaceAll(String(item), "[attachment]");
  return message
    .replace(/(?:\/[A-Za-z0-9._ -]+){2,}/g, "[local path]")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, 220);
}

async function dominantAccentFromBrandAttachment(file = {}) {
  const kind = brandAttachmentKind(file);
  if (!kind) throw new Error("attachment format is not a supported raster image or PDF");
  const realPath = await safeBrandAttachmentPath(file);
  const python = process.env.CODEX_PYTHON
    || "python3";
  const result = spawnSync(python, ["-c", BRAND_ACCENT_PYTHON, realPath, kind], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: Number(process.env.KP_BRAND_ATTACHMENT_TIMEOUT_MS || 30_000),
  });
  if (result.error) {
    throw new Error(safeThemeWarningReason(result.error, [realPath, file.path]));
  }
  const output = String(result.stdout || "").trim().split("\n").filter(Boolean).at(-1) || "";
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new Error(`palette helper returned invalid output${result.status !== 0 ? ` (exit ${result.status})` : ""}`);
  }
  if (result.status !== 0 || payload.error || !parseCssColor(payload.accent)) {
    throw new Error(safeThemeWarningReason(payload.error || `palette helper failed (exit ${result.status})`, [realPath, file.path]));
  }
  return {
    accent: rgbToHex(parseCssColor(payload.accent)),
    sampledPixels: Number(payload.sampledPixels || 0),
    candidatePixels: Number(payload.candidatePixels || 0),
    winningPixels: Number(payload.winningPixels || 0),
    meanSaturation: Number(payload.meanSaturation || 0),
    pagesSampled: Number(payload.pagesSampled || 1),
  };
}

async function themeFromBrandAttachments(evidenceBundle = null) {
  const files = Array.isArray(evidenceBundle?.files) ? evidenceBundle.files : [];
  const candidates = files
    .filter((file) => isLikelyBrandAttachment(file, evidenceBundle))
    .sort((left, right) => brandAttachmentPriority(right, evidenceBundle) - brandAttachmentPriority(left, evidenceBundle))
    .slice(0, 3);
  const warnings = [];
  for (const file of candidates) {
    const displayName = brandAttachmentDisplayName(file);
    if (!brandAttachmentKind(file)) {
      warnings.push(`Brand evidence attachment ${displayName} could not be sampled: supported formats are raster images and PDF.`);
      continue;
    }
    try {
      const result = await dominantAccentFromBrandAttachment(file);
      return {
        themeTokens: darkThemeTokensFromAccent(result.accent),
        source: {
          kind: "brand_attachment",
          reference: displayName,
          accent: result.accent,
          pagesSampled: result.pagesSampled,
        },
        warnings,
      };
    } catch (error) {
      warnings.push(`Brand evidence attachment ${displayName} palette extraction failed: ${safeThemeWarningReason(error, [file.path])}`);
    }
  }
  return { themeTokens: {}, source: null, warnings };
}

function resolvedUrlTheme(kind, url, themeTokens, warnings = []) {
  const paletteSelection = themeTokens?.paletteSelection || { mode: "deterministic", aiAttempted: false };
  const nextWarnings = [...warnings];
  if (paletteSelection.mode === "ai_domain_fallback") {
    nextWarnings.push(`Direct website palette extraction was unavailable (${safeText(paletteSelection.captureFailure || "access blocked", 120)}); AI domain knowledge supplied the provisional colors.`);
  } else if (paletteSelection.aiAttempted && paletteSelection.mode !== "ai_vision") {
    nextWarnings.push(`AI palette classification was not accepted (${safeText(paletteSelection.reason || "unknown", 120)}); deterministic website colors were retained.`);
  }
  return {
    themeTokens,
    themeSource: {
      kind: paletteSelection.mode === "ai_domain_fallback" ? "ai_domain_fallback" : kind,
      reference: url,
      paletteSelection,
    },
    themeWarnings: nextWarnings,
    referenceUrl: url,
  };
}

async function resolveKpBrandTheme({ options = {}, groundedBrief = {}, preliminaryLinks = {}, progress = async () => {} } = {}) {
  const env = options.env || process.env;
  if (!dynamicColorPalettesEnabled(env)) {
    await progress("Dynamic website palettes are off; Udevs screenshot colors and background are applied.");
    return udevsStaticThemeResult();
  }
  const explicit = normalizedExplicitThemeTokens(options.themeTokens);
  const warnings = [...explicit.warnings];
  if (Object.keys(explicit.tokens).length) {
    return {
      themeTokens: explicit.tokens,
      themeSource: { kind: "explicit_tokens", reference: "options.themeTokens" },
      themeWarnings: warnings,
      referenceUrl: "",
    };
  }

  const rawBrandUrls = uniqueUrls([
    options.referenceUrl,
    groundedBrief.brandReference?.url?.value,
    ...(preliminaryLinks.brandUrls || []),
  ]);
  const brandUrls = [];
  for (const value of rawBrandUrls) {
    const normalized = normalizedPublicBrandUrl(value);
    if (normalized) brandUrls.push(normalized);
    else warnings.push("A classified brand URL was ignored because it was not a safe public HTTP(S) URL.");
  }

  for (const url of uniqueUrls(brandUrls)) {
    try {
      await progress(`Reference brand ranglari olinmoqda: ${hostLabel(url)}.`);
      const themeTokens = await extractReferenceTheme(url, { env, client: options.paletteAiClient || null });
      return resolvedUrlTheme("brand_url", url, themeTokens, warnings);
    } catch (error) {
      const warning = safeThemeWarningReason(error, [url]);
      warnings.push(`Brand URL ${hostLabel(url)} palette extraction failed; fallback continued. ${warning}`);
      await progress(`Brand palette warning: ${hostLabel(url)} ishlamadi, xavfsiz fallback qo'llanadi.`);
    }
  }

  const attachmentTheme = await themeFromBrandAttachments(options.evidenceBundle || null);
  warnings.push(...attachmentTheme.warnings);
  if (Object.keys(attachmentTheme.themeTokens).length) {
    await progress(`Brand attachment palitrasi qo'llandi: ${attachmentTheme.source.reference}.`);
    return {
      themeTokens: attachmentTheme.themeTokens,
      themeSource: attachmentTheme.source,
      themeWarnings: warnings,
      referenceUrl: brandUrls[0] || "",
    };
  }

  const rawAnalogUrls = uniqueUrls([
    groundedBrief.analog?.url?.value,
    ...(preliminaryLinks.classifiedAnalogUrls || []),
  ]);
  const analogUrls = [];
  for (const value of rawAnalogUrls) {
    const normalized = normalizedPublicBrandUrl(value);
    if (normalized) analogUrls.push(normalized);
    else warnings.push("A classified analog URL was ignored because it was not a safe public HTTP(S) URL.");
  }
  for (const url of uniqueUrls(analogUrls)) {
    try {
      await progress(`Brand evidence yo'q; analog ranglari olinmoqda: ${hostLabel(url)}.`);
      const themeTokens = await extractReferenceTheme(url, { env, client: options.paletteAiClient || null });
      warnings.push(`No explicit brand palette was available; ${hostLabel(url)} was used as a provisional analog palette.`);
      return resolvedUrlTheme("analog_url", url, themeTokens, warnings);
    } catch (error) {
      const warning = safeThemeWarningReason(error, [url]);
      warnings.push(`Analog URL ${hostLabel(url)} palette extraction failed; fallback continued. ${warning}`);
      await progress(`Analog palette warning: ${hostLabel(url)} ishlamadi, default tema qo'llanadi.`);
    }
  }

  // Any remaining request URL (for example "КП для https://client.example")
  // is still the best available palette/typography evidence. Only colors and
  // font families are consumed from it, so trying it is strictly better than
  // silently falling back to the static default theme.
  const triedUrls = new Set([...uniqueUrls(brandUrls), ...uniqueUrls(analogUrls)].map((url) => url.toLowerCase()));
  const remainingUrls = [];
  for (const value of uniqueUrls([
    groundedBrief.analog?.url?.value,
    ...(preliminaryLinks.urls || []),
  ])) {
    const normalized = normalizedPublicBrandUrl(value);
    if (normalized && !triedUrls.has(normalized.toLowerCase()) && !/\.pdf(?:$|\?)/i.test(normalized)) remainingUrls.push(normalized);
  }
  for (const url of uniqueUrls(remainingUrls)) {
    try {
      await progress(`Reference sayt ranglari olinmoqda: ${hostLabel(url)}.`);
      const themeTokens = await extractReferenceTheme(url, { env, client: options.paletteAiClient || null });
      warnings.push(`No explicit brand palette was available; ${hostLabel(url)} from the request was used as a provisional palette source.`);
      return resolvedUrlTheme("client_site_url", url, themeTokens, warnings);
    } catch (error) {
      const warning = safeThemeWarningReason(error, [url]);
      warnings.push(`Request URL ${hostLabel(url)} palette extraction failed; fallback continued. ${warning}`);
      await progress(`Palette warning: ${hostLabel(url)} ishlamadi, default tema qo'llanadi.`);
    }
  }

  if (rawBrandUrls.length || rawAnalogUrls.length || remainingUrls.length || (options.evidenceBundle?.files || []).some((file) => isLikelyBrandAttachment(file, options.evidenceBundle))) {
    warnings.push("No usable site palette could be derived; the Udevs palette was applied.");
  }
  return {
    themeTokens: udevsFallbackTheme(),
    themeSource: { kind: "udevs_fallback", reference: "https://udevs.io/" },
    themeWarnings: warnings,
    referenceUrl: brandUrls[0] || analogUrls[0] || remainingUrls[0] || "",
  };
}

function runPythonExtractor() {
  const payload = JSON.stringify(projectSources);
  const script = String.raw`
import json, os, re, math, html
from zipfile import ZipFile
from collections import Counter
import openpyxl

SOURCES = json.loads("""__SOURCES__""")

def clean(v):
    if v is None:
        return ""
    if isinstance(v, float) and math.isnan(v):
        return ""
    return str(v).replace("\n", " ").strip()

def num(v, default=0.0):
    try:
        if v in (None, ""):
            return default
        return float(v)
    except Exception:
        return default

def rows(ws):
    out = []
    for row in ws.iter_rows(values_only=True):
        vals = [v for v in row]
        if any(v not in (None, "") for v in vals):
            out.append(vals)
    return out

def find_sheet(wb, needles):
    for ws in wb.worksheets:
        title = ws.title.lower()
        if any(n.lower() in title for n in needles):
            return ws
    return None

def extract_ppt_text(path):
    if not os.path.exists(path):
        return []
    result = []
    with ZipFile(path) as z:
        slides = sorted(
            [n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)],
            key=lambda x: int(re.search(r"(\d+)", x).group(1))
        )
        for slide in slides:
            xml = z.read(slide).decode("utf-8", errors="ignore")
            texts = [html.unescape(t) for t in re.findall(r"<a:t>(.*?)</a:t>", xml)]
            texts = [re.sub(r"\s+", " ", t).strip() for t in texts if t.strip()]
            if texts:
                result.append({"slide": int(re.search(r"(\d+)", slide).group(1)), "text": " | ".join(texts[:30])})
    return result

def extract_project(src):
    wb = openpyxl.load_workbook(src["xlsx"], data_only=True, read_only=True)
    out = {
        "key": src["key"],
        "title": src["title"],
        "source": src["xlsx"],
        "pptx": src["pptx"],
        "sheets": wb.sheetnames,
        "guarantees": [],
        "blockers": [],
        "scope": [],
        "scope_by_epic": {},
        "estimate": [],
        "payments": [],
        "competitive": [],
        "market": [],
        "ppt_slides": extract_ppt_text(src["pptx"]),
    }

    guarantee = find_sheet(wb, ["гарантия", "garantiya"])
    if guarantee:
        for row in rows(guarantee)[2:]:
            name, desc, flag = clean(row[0] if len(row) > 0 else ""), clean(row[1] if len(row) > 1 else ""), clean(row[2] if len(row) > 2 else "")
            if name and desc and flag:
                out["guarantees"].append({"name": name, "description": desc})

    waiting = find_sheet(wb, ["ждем", "kutil", "dostup"])
    if waiting:
        for row in rows(waiting)[1:]:
            name, status = clean(row[0] if len(row) > 0 else ""), clean(row[1] if len(row) > 1 else "")
            if name and status and re.search(r"не сделано|qilinmagan|not done", status, re.I):
                out["blockers"].append({"name": name, "status": status})

    scope_ws = find_sheet(wb, ["список", "funksional", "function price"])
    if scope_ws:
        data = rows(scope_ws)
        headers = [clean(x).lower() for x in data[1]] if len(data) > 1 else []
        epic, task = "", ""
        for row in data[2:]:
            month = clean(row[0] if len(row) > 0 else "")
            new_epic = clean(row[1] if len(row) > 1 else "")
            new_task = clean(row[2] if len(row) > 2 else "")
            subtask = clean(row[3] if len(row) > 3 else "")
            status = clean(row[6] if len(row) > 6 else "")
            if new_epic:
                epic = new_epic
            if new_task:
                task = new_task
            if subtask and not re.match(r"subtask|task|epic", subtask, re.I):
                pm = num(row[7] if len(row) > 7 else 0, 0)
                backend = num(row[8] if len(row) > 8 else 0, 0)
                frontend = num(row[9] if len(row) > 9 else 0, 0)
                extra = sum(num(v, 0) for v in row[10:13])
                effort = pm + backend + frontend + extra
                item = {"month": month, "epic": epic or "General", "task": task, "subtask": subtask, "status": status, "effort": round(effort, 2)}
                out["scope"].append(item)
                out["scope_by_epic"][item["epic"]] = out["scope_by_epic"].get(item["epic"], 0) + 1

    comp_ws = find_sheet(wb, ["свод"])
    if comp_ws:
        data = rows(comp_ws)
        for row in data[1:]:
            feature = clean(row[0] if len(row) > 0 else "")
            ours = clean(row[1] if len(row) > 1 else "")
            competitor = clean(row[2] if len(row) > 2 else "")
            if feature and (ours or competitor):
                out["competitive"].append({"feature": feature, "ours": ours, "competitor": competitor})

    market_ws = find_sheet(wb, ["рын", "bozor", "объем"])
    if market_ws:
        for row in rows(market_ws):
            label = clean(row[1] if len(row) > 1 else row[0] if len(row) > 0 else "")
            value = clean(row[2] if len(row) > 2 else row[3] if len(row) > 3 else "")
            if label and value:
                out["market"].append({"label": label, "value": value})

    estimate_sheets = [ws for ws in wb.worksheets if re.search(r"оцен|bahosi|price", ws.title, re.I)]
    best_total = 0
    best_duration = 0
    for ws in estimate_sheets:
        data = rows(ws)
        roles = []
        payments = []
        for row in data:
            name = clean(row[0] if len(row) > 0 else "")
            qty = num(row[1] if len(row) > 1 else None, None)
            months = num(row[2] if len(row) > 2 else None, None)
            rate = num(row[3] if len(row) > 3 else None, None)
            total = num(row[4] if len(row) > 4 else None, None)
            looks_like_role = bool(re.search(r"[A-Za-zА-Яа-яЁё]", name)) and not re.search(r"предоплата|oldindan|сумма проекта|loyihaning|месяц|oy\b", name, re.I)
            if looks_like_role and qty is not None and months is not None and rate is not None and total is not None and total > 0:
                roles.append({"role": name, "qty": qty, "months": months, "rate": rate, "total": total})
            if name and re.search(r"предоплата|oldindan", name, re.I):
                labels = [clean(v) for v in row if clean(v)]
                # next row contains payment values in the original template
            if name and re.search(r"сумма проекта|loyihaning", name, re.I):
                candidate = num(row[1] if len(row) > 1 else 0, 0)
                if candidate > best_total:
                    best_total = candidate
        for i, row in enumerate(data):
            labels = [clean(v) for v in row if clean(v)]
            if labels and re.search(r"предоплата|oldindan", labels[0], re.I) and i + 1 < len(data):
                values = [num(v, None) for v in data[i + 1][:len(labels)]]
                for label, value in zip(labels, values):
                    if value is not None and value > 0:
                        payments.append({"period": label, "amount": value})
        if roles:
            out["estimate"].extend(roles)
            best_duration = max(best_duration, max([r["months"] for r in roles], default=0))
        if payments:
            out["payments"] = payments
    out["budget_usd"] = best_total or sum(x["total"] for x in out["estimate"])
    out["duration_months"] = best_duration
    out["scope_count"] = len(out["scope"])
    out["blocker_count"] = len(out["blockers"])
    out["competitive_count"] = len(out["competitive"])
    out["readiness_score"] = max(0, min(100, 100 - out["blocker_count"] * 4 - max(0, out["scope_count"] - 120) * 0.03))
    out["complexity_score"] = max(20, min(100, 25 + out["scope_count"] * 0.08 + len(out["scope_by_epic"]) * 3 + out["duration_months"] * 4))
    out["commercial_score"] = max(20, min(100, (out["budget_usd"] / 1000) + out["competitive_count"] * 2 + out["duration_months"] * 3))
    out["kpi_score"] = max(0, min(100, out["commercial_score"] * 0.4 + out["complexity_score"] * 0.35 + out["readiness_score"] * 0.25))
    return out

print(json.dumps([extract_project(src) for src in SOURCES], ensure_ascii=False))
`.replace("__SOURCES__", payload.replace(/\\/g, "\\\\").replace(/"/g, '\\"'));

  const result = spawnSync("python3", ["-c", script], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: Number(process.env.KP_PROJECT_CARD_EXTRACT_TIMEOUT_MS || 12_000),
  });
  if (result.status !== 0) {
    throw new Error(`KP extractor failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return JSON.parse(result.stdout);
}

function fallbackProjectFromSource(source) {
  const duration = /website|rise/i.test(source.title) ? 2 : /parking/i.test(source.title) ? 4 : 3;
  const budget = /ai declarant/i.test(source.title) ? 60_000 : /aloqa/i.test(source.title) ? 95_000 : /parking/i.test(source.title) ? 70_000 : /tiktok/i.test(source.title) ? 80_000 : 50_000;
  const baseScope = extractScopeItems(`${source.title} website admin panel mobile app analytics dashboard integration api payment`);
  const scopeByEpic = buildScopeByEpic(baseScope);
  const estimate = allocateTotal(budget, [
    { role: "PM / Product Manager", qty: 1, months: duration, weight: 12 },
    { role: "Team Lead / Solution Architect", qty: 0.5, months: duration, weight: 8 },
    { role: "Backend Engineer", qty: 1, months: duration, weight: 28 },
    { role: "Frontend Engineer", qty: 1, months: duration, weight: 18 },
    { role: "Mobile Engineer", qty: /tiktok|parking|ai/i.test(source.title) ? 1 : 0.5, months: duration, weight: 14 },
    { role: "UI/UX Designer", qty: 1, months: Math.min(2, duration), weight: 9 },
    { role: "QA Engineer", qty: 1, months: Math.max(1, duration - 0.5), weight: 7 },
    { role: "DevOps / Release Engineer", qty: 0.5, months: Math.max(1, duration / 2), weight: 4 },
  ]).map((row) => ({ ...row, rate: roundMoney(row.total / Math.max(1, row.qty * row.months)) }));
  const project = {
    key: source.key,
    title: source.title,
    analog: "Reference project",
    source: `Fallback summary: ${source.xlsx}`,
    pptx: source.pptx,
    sheets: ["Fallback"],
    guarantees: [
      { name: "Dedicated delivery team", description: "Scope, team and roadmap are controlled as one commercial package." },
      { name: "Weekly demo rhythm", description: "Progress is accepted through visible demos and feedback." },
      { name: "Transparent scope control", description: "Changes are estimated separately after MVP boundary approval." },
    ],
    blockers: [{ name: "Project-card extractor", status: "Fallback project summary used because source extractor was unavailable" }],
    infrastructure: buildInfrastructureRows(source.title),
    client_requirements: buildClientDataRows(source.title, []),
    assumptions: buildAssumptions(source.title, { budget, duration, scopeItems: baseScope }),
    risks: buildRiskRows(source.title, []),
    scope: baseScope.map((subtask, index) => ({
      month: `Month ${Math.min(duration, Math.floor(index / 4) + 1)}`,
      epic: scopeGroupForItem(subtask),
      task: taskForScopeItem(subtask),
      subtask,
      status: "In scope",
      effort: 1,
    })),
    scope_by_epic: scopeByEpic,
    estimate,
    payments: paymentScheduleRows({ budget_usd: budget, duration_months: duration, payments: [] }),
    competitive: [{ feature: "Reference", ours: source.title, competitor: "Fallback benchmark" }],
    market: [{ label: "Fallback", value: "Source project-card extraction unavailable" }],
    ppt_slides: [],
    status: "fallback",
  };
  project.budget_usd = budget;
  project.duration_months = duration;
  project.scope_count = baseScope.length;
  project.blocker_count = project.blockers.length;
  project.competitive_count = project.competitive.length;
  project.readiness_score = 72;
  project.complexity_score = 68;
  project.commercial_score = clamp(budget / 1200 + duration * 5, 20, 90);
  project.kpi_score = clamp(project.commercial_score * 0.4 + project.complexity_score * 0.35 + project.readiness_score * 0.25, 0, 100);
  return project;
}

async function loadKpiSummary() {
  if (!cachedSummary) {
    try {
      cachedSummary = runPythonExtractor();
    } catch {
      cachedSummary = projectSources.map(fallbackProjectFromSource);
    }
  }
  return cachedSummary;
}

function selectProjects(question, projects) {
  const lower = question.toLowerCase();
  if (isCustomProjectQuestion(question)) return [buildCustomProjectFromQuestion(question, projects)];
  const explicit = projectSources
    .filter((source) => source.aliases.some((alias) => lower.includes(alias)))
    .map((source) => source.key);
  if (explicit.length) {
    const selected = projects.filter((project) => explicit.includes(project.key));
    if (selected.length) return selected;
  }
  return projects;
}

function isCustomProjectQuestion(question = "") {
  const lower = question.toLowerCase();
  if (/(hamma|barcha|portfolio|all project|all projects|все проекты)/i.test(lower)) return false;
  const hasExistingAlias = projectSources.some((source) => source.aliases.some((alias) => lower.includes(alias)));
  const hasCustomSignal = /(yangi|новый|new|project name|project nomi|loyiha nomi|название|scope\s*:|budget|budjet|byudjet|бюджет|duration|timeline|muddat|срок)/i.test(question);
  const hasStrongCustomSignal = /(yangi|новый|new\s+project|project name|project nomi|loyiha nomi|название|scope\s*:|budget\s*[:=]|\bbudget\s*\$|\bbudget\s*\d|\bbudjet\s*\d|\bbyudjet\s*\d|бюджет\s*\d)/iu.test(question);
  if (hasExistingAlias && (!hasCustomSignal || !hasStrongCustomSignal)) return false;
  if (!hasExistingAlias && hasStrongCustomSignal) return true;
  const hasProposalToken = /(?<![\p{L}\p{N}_])(?:kp|кп)(?![\p{L}\p{N}_])/iu.test(lower);
  return /(yangi|новый|new|loyiha|loyixa|proekt|project|startup|app|platform|платформ|приложен|сайт|crm|erp|marketplace|маркетплейс|bot|бот|kompred|commercial proposal|kpi|pdf)/iu.test(lower)
    || hasProposalToken;
}

function matchBenchmark(question, projects) {
  const lower = question.toLowerCase();
  const source = projectSources.find((item) =>
    item.aliases.some((alias) => new RegExp(`(?:analog|аналог|o'xshash|uxshash|pohozhe|похоже|kak|как|like)\\s+.{0,20}${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(lower)),
  );
  return source ? projects.find((project) => project.key === source.key) : null;
}

function cleanCustomTitleCandidate(value = "") {
  const title = String(value)
    .replace(/\b(?:scope|funksional|functional|modules?|модул|функционал|analog|аналог|budget|budjet|byudjet|бюджет|duration|timeline|muddat|срок)\b[\s\S]*$/i, "")
    .replace(/\b(?:kp|кп|kpi|premium|pdf|proposal|report|generatsiya|generation|qil|qiber|ber|kerak|sistema|bosin|tezro|tezroq|iloji|boricha|manga|hop|сделай|генерируй)\b/gi, "")
    .replace(/\b(?:yangi|new|новый|loyiha|loyixa|project|proekt|startup)\b/gi, "")
    .replace(/\s+(?:uchun|bo.?yicha|for|для|pro)\s*$/i, "")
    .replace(/^[\s:.,;\-]+|[\s:.,;\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title || /^(?:pdf|kp|кп|kpi|premium|proposal|report|project|loyiha|loyixa|proekt|scope)$/i.test(title)) return "";
  return title.slice(0, 56).trim();
}

function extractCustomTitle(question = "") {
  const cleaned = question.replace(/\s+/g, " ").trim();
  const productName = extractNamedProduct(cleaned);
  if (productName) return productName;
  const patterns = [
    /(?:yangi\s+loyiha|yangi\s+loyixa|new\s+project|новый\s+проект|project\s+name|project\s+nomi|loyiha\s+nomi|название)\s*[:\-]\s*([^.;\n]{3,90})/i,
    /^(.{3,90}?)\s+(?:uchun|bo.?yicha)\s+(?:premium\s+)?(?:kp|кп|kpi|pdf)\b/i,
    /^(.{3,90}?)\s+(?:project|proekt|loyiha|loyixa)\s+(?:kp|кп|kpi|premium|proposal|pdf)\b/i,
    /(?:pro|для|uchun|bo.?yicha)\s+([^,.;\n]{3,70})\s+(?:kp|кп|kpi|pdf)/i,
    /(?:kp|кп|kpi|pdf)\s+(?:for|для|uchun)\s+([^,.;\n]{3,70})/i,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const title = cleanCustomTitleCandidate(match?.[1] || "");
    if (title) return title;
  }
  const withoutCommand = cleaned
    .replace(/\b(?:budget|budjet|byudjet|бюджет)\s*[\d\s.,]+(?:k|m|ming|mln|million|тыс|миллион)?\s*(?:\$|usd|dollar|доллар)?/gi, "");
  return cleanCustomTitleCandidate(withoutCommand) || "Custom Project";
}

function extractNamedProduct(question = "") {
  const cleaned = question.replace(/\s+/g, " ").trim();
  const patterns = [
    /\b(?:oti|nomi|name|called|named|название)\s+([A-Z][A-Za-z0-9._-]{2,40})\b/i,
    /\b([A-Z][A-Za-z0-9._-]{2,40})\s+(?:nomli|named|called)\b/i,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const name = match?.[1]?.trim();
    if (!name || /^(pdf|kp|кп|kpi|budget|budjet|premium|system|sistema)$/i.test(name)) continue;
    if (/\btms\b/i.test(cleaned) && !/\btms\b/i.test(name)) return `${name} TMS`;
    if (/\bcrm\b/i.test(cleaned) && !/\bcrm\b/i.test(name)) return `${name} CRM`;
    if (/\berp\b/i.test(cleaned) && !/\berp\b/i.test(name)) return `${name} ERP`;
    return name;
  }
  return "";
}

function extractBudgetUsd(question = "", benchmark = null) {
  const text = question.replace(/\s+/g, " ");
  const currencyThenScaleUsd = text.match(/(\d+(?:[.,]\d+)?)\s*(?:\$|usd|dollar|доллар)\s*(k|к|ming|тыс|m|mln|million|миллион)/iu);
  const compactUsd = text.match(/(\d+(?:[.,]\d+)?)\s*(k|к|ming|тыс|m|mln|million|миллион)\s*(?:\$|usd|dollar|доллар)/iu);
  const usd = currencyThenScaleUsd || compactUsd ||
    text.match(/(\d[\d\s.,]*)\s*(k|к|ming|тыс|m|mln|million|миллион)?\s*(?:\$|usd|dollar|доллар)/iu) ||
    text.match(/(?:\$|usd|dollar|доллар)\s*(\d[\d\s.,]*)\s*(k|к|ming|тыс|m|mln|million|миллион)?/iu);
  if (usd) {
    const raw = Number(String(usd[1]).replace(/[^\d.,]/g, "").replace(",", "."));
    const mult = /^(k|к|ming|тыс)$/iu.test(usd[2] || "") ? 1000 : /^(m|mln|million|миллион)$/iu.test(usd[2] || "") ? 1_000_000 : 1;
    if (raw > 0) return raw * mult;
  }
  const uzs = text.match(/([\d\s.,]+)\s*(mln|million|миллион|m)?\s*(?:uzs|sum|so'm|сум)/i);
  if (uzs) {
    const raw = Number(String(uzs[1]).replace(/[^\d.,]/g, "").replace(",", "."));
    const mult = /^(mln|million|миллион|m)$/i.test(uzs[2] || "") ? 1_000_000 : 1;
    if (raw > 0) return (raw * mult) / 12_600;
  }
  return benchmark?.budget_usd ? Math.round(benchmark.budget_usd * 0.75) : 50_000;
}

function extractDurationMonths(question = "", benchmark = null) {
  const match = question.match(/(\d+(?:[.,]\d+)?)\s*(?:oy|месяц|mesyats|month|mo\b)/i);
  if (match) return Number(match[1].replace(",", "."));
  return benchmark?.duration_months || 3;
}

function durationLabel(months) {
  const value = Number(months) || 0;
  const formatted = fmtNumber(value);
  return value === 1 ? `${formatted} month` : `${formatted} months`;
}

function extractScopeItems(question = "") {
  const normalized = stripReferenceUrl(question)
    .replace(/\s+/g, " ")
    .replace(/\b(?:manga|менга|мне|kp|кп|kpi|premium|pdf|qil|qiber|sdelay|сделай|kere|kerak|bolishi|bo'lishi|budjetim|budgetim)\b/gi, " ")
    .replace(/\b(?:oti|nomi|name|called|named|название)\s+[A-Za-z0-9._-]{2,50}\b/gi, " ")
    .replace(/\b(?:analog|аналог)\s+\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const afterScopeRaw = normalized.match(/(?:scope|funksional|functional|modules?|модул|функционал|ichida|есть)\s*[:\-]\s*(.+)/i)?.[1] || normalized;
  const afterScope = afterScopeRaw
    .replace(/\b(?:budget|byudjet|бюджет|duration|timeline|muddat|срок|price|cost)\b[\s\S]*$/i, "")
    .replace(/\b(?:kp|кп|kpi|premium|pdf)\b[\s\S]*$/i, "");
  const chunks = afterScope
    .split(/[,;|]+|\s+\+\s+|\s+va\s+|\s+и\s+/i)
    .map((item) => item.trim())
    .map((item) => item.replace(/\b(?:budget|duration|timeline|muddat|price|cost).*/i, "").trim())
    .filter((item) => item.length >= 3 && !/\b(kp|кп|kpi|pdf|premium|qil|ber|qiber|budget|duration)\b/i.test(item))
    .slice(0, 24);
  const keywordMap = [
    ["Marketplace", /marketplace|market|ecommerce|e-commerce|shop|store|магазин|маркет/i],
    ["Admin panel", /admin|админ/i],
    ["Mobile app", /mobile|mobil|mobilka|mobilkasi|ios|android|app|прилож/i],
    ["TMS core", /\btms\b|transport|logistic|shipment|dispatch/i],
    ["Website", /website|websitye|websayt|web\s*site|site|сайт/i],
    ["Web platform", /\b(?:web\s+platform|platform|portal)\b/i],
    ["CRM", /\bcrm\b|client|sales|lead/i],
    ["ERP", /\berp\b|finance|warehouse|inventory/i],
    ["Payment", /payment|payme|click|stripe|to'lov|оплат/i],
    ["Analytics", /analytics|dashboard|report|отчет|hisobot/i],
    ["Telegram bot", /telegram|bot/i],
    ["AI module", /\bai\b|gpt|claude|llm|neural|искус/i],
    ["Integration/API", /api|integrats|integration|интеграц/i],
  ];
  const keywordItems = [];
  for (const [name, pattern] of keywordMap) {
    if (pattern.test(normalized) && !keywordItems.some((item) => item.toLowerCase() === name.toLowerCase())) keywordItems.push(name);
  }
  const cleanedChunks = chunks.filter((item) => {
    const keywordHits = keywordMap.filter(([, pattern]) => pattern.test(item)).length;
    return keywordHits <= 1 && !/\b(marketplacega|mobilkasi|websitye|admin\s+paneli)\b.*\b(marketplacega|mobilkasi|websitye|admin\s+paneli)\b/i.test(item);
  });
  const mergedRaw = keywordItems.length >= 2 ? keywordItems : [...cleanedChunks, ...keywordItems];
  const merged = mergedRaw.filter((item) => !(item === "Web platform" && mergedRaw.includes("Website")));
  return merged.length ? [...new Set(merged)].slice(0, 24) : ["Discovery", "UX/UI", "Backend", "Frontend", "QA", "Deployment"];
}

function detectDomainPacks(question = "") {
  const lower = String(question || "").toLowerCase();
  const packs = getDomainResearchPacks(question);
  if (/(cashback|cash back|keshbek|кэшбек|кешбек|loyalty|bonus|reward|балл|бонус|wallet|hamyon)/i.test(lower)) {
    packs.push({
      key: "cashback-loyalty",
      industry: "Fintech / loyalty product",
      analog: "Cashback and loyalty apps",
      description:
        "Cashback product requires customer mobile flows, partner/merchant management, cashback rule engine, transaction tracking, wallet balance, payout/reversal logic, admin operations and anti-fraud controls.",
      scope: [
        "Customer onboarding and OTP login",
        "User profile and KYC-lite fields",
        "Merchant / partner catalog",
        "Cashback offer cards and campaign details",
        "QR / promo code cashback activation",
        "Transaction tracking and cashback accrual",
        "Wallet balance and cashback history",
        "Cashback withdrawal / payout request",
        "Referral and promo campaign mechanics",
        "Push notification and SMS alerts",
        "Partner / merchant web cabinet",
        "Admin panel for users, merchants and campaigns",
        "Cashback rule engine",
        "Manual adjustment and dispute handling",
        "Finance reconciliation and export reports",
        "Fraud and duplicate transaction checks",
        "Analytics dashboard for GMV, cashback cost and active users",
        "Payment / bank / receipt API integration",
        "Support tickets and FAQ content",
        "Production release, monitoring and backup",
      ],
      blockers: [
        { name: "Cashback business rules", status: "Client must confirm percent rules, limits, expiry, reversal and payout policy" },
        { name: "Merchant / partner list", status: "Merchant categories, legal data and contract conditions must be provided" },
        { name: "Transaction source API", status: "Bank, payment provider, POS or receipt data access must be confirmed" },
        { name: "Finance reconciliation owner", status: "Client-side finance owner must approve cashback accrual and payout reports" },
      ],
      infrastructure: [
        { component: "SMS / OTP gateway", type: "Third-party API", cost: "$0.02/SMS", period: "Usage based" },
        { component: "Push notification service", type: "Firebase / APNs", cost: "$0", period: "Monthly" },
        { component: "Payment / bank API", type: "Third-party API", cost: "Provider fee", period: "Per transaction" },
        { component: "Analytics / monitoring", type: "Observability", cost: "$20/month", period: "Monthly" },
      ],
    });
  }
  return packs;
}

function uniqueByLower(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items.map((value) => String(value || "").trim()).filter(Boolean)) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function uniqueBlockers(blockers = []) {
  const seen = new Set();
  const result = [];
  for (const blocker of blockers.filter(Boolean)) {
    const name = String(blocker.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name, status: String(blocker.status || "Not ready").trim() });
  }
  return result;
}

function mergeInfrastructureRows(...groups) {
  const seen = new Set();
  const result = [];
  for (const row of groups.flat().filter(Boolean)) {
    const component = String(row.component || "").trim();
    if (!component) continue;
    const key = component.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      component,
      type: String(row.type || "").trim(),
      cost: String(row.cost || "").trim(),
      period: String(row.period || "").trim(),
    });
  }
  return result;
}

function expandScopeWithDomainResearch(question = "", detectedScopeItems = [], options = {}) {
  const packs = detectDomainPacks(question);
  if (!packs.length) return { scopeItems: detectedScopeItems, domainPacks: packs };
  const requestedScopeItems = uniqueByLower(options.requestedScopeItems || []);
  const domainScope = packs.flatMap((pack) => pack.scope);
  const essential = [];
  if (!detectedScopeItems.some((item) => /mobile|app/i.test(item))) essential.push("Mobile app");
  if (!detectedScopeItems.some((item) => /admin/i.test(item))) essential.push("Admin panel");
  // With a sparse category-only brief, lead with the recommended product
  // journey (catalog -> checkout -> order) rather than UI surfaces. Explicitly
  // requested features still retain first position when they exist.
  const scopeItems = requestedScopeItems.length
    ? uniqueByLower([...requestedScopeItems, ...domainScope, ...detectedScopeItems, ...essential]).slice(0, 28)
    : uniqueByLower([...domainScope, ...detectedScopeItems, ...essential]).slice(0, 28);
  return { scopeItems, domainPacks: packs };
}

function scopeGroupForItem(item = "") {
  if (/restaurant|restoran|menu|order acceptance/i.test(item)) return "Restaurant operations";
  if (/courier|kuryer|pickup|delivery status|dispatch/i.test(item)) return "Courier operations";
  if (/order|checkout|cart|delivery zone/i.test(item)) return "Ordering & fulfilment";
  if (/cashback|cash back|loyalty|reward|wallet|cashback offer|cashback campaign/i.test(item)) return "Cashback product";
  if (/seller|vendor|commission|settlement|marketplace/i.test(item)) return "Marketplace operations";
  if (/onboarding|profile|verification|kyc|otp/i.test(item)) return "Identity & access";
  if (/fraud|duplicate|dispute|reversal|adjustment/i.test(item)) return "Risk & support";
  if (/reconciliation|finance|payout|withdrawal|export|gmv/i.test(item)) return "Finance & analytics";
  if (/\btms\b|transport|logistic|shipment|dispatch/i.test(item)) return "TMS core";
  if (/courier|kuryer|delivery/i.test(item)) return "Courier workflow";
  if (/payment|finance|billing|to'lov|payme|click|stripe/i.test(item)) return "Payments";
  if (/admin|dashboard|report|analytics/i.test(item)) return "Admin & analytics";
  if (/mobile|ios|android|app/i.test(item)) return "Mobile";
  if (/api|integration|integrats|telegram|bot|ai/i.test(item)) return "Integrations";
  if (/crm|client|lead|sales/i.test(item)) return "CRM workflow";
  return "Core product";
}

function taskForScopeItem(item = "") {
  if (/restaurant|restoran|menu|availability/i.test(item)) return "Restaurant operations";
  if (/\badmin/i.test(item)) return "Management workspace";
  if (/courier|kuryer|pickup|delivery status|dispatch/i.test(item)) return "Courier fulfilment";
  if (/catalog|categories|search|filters/i.test(item)) return "Catalog and search";
  if (/product cards?|variants?/i.test(item)) return "Product selection";
  if (/checkout|cart/i.test(item)) return "Cart and checkout";
  if (/order lifecycle|order status|notifications?/i.test(item)) return "Order confirmation and tracking";
  if (/order|delivery zone/i.test(item)) return "Order lifecycle";
  if (/seller.*(?:onboarding|verification)|(?:onboarding|verification).*seller/i.test(item)) return "Seller onboarding";
  if (/seller.*(?:product|inventory)|inventory\s+management/i.test(item)) return "Seller workspace";
  if (/commission|settlement/i.test(item)) return "Seller commercial model";
  if (/promo|campaign/i.test(item)) return "Promotion rules";
  if (/cashback|cash back|loyalty|reward/i.test(item)) return "Cashback campaign workflow";
  if (/wallet|balance|history|withdrawal|payout/i.test(item)) return "Wallet and payout flow";
  if (/merchant|partner/i.test(item)) return "Partner management";
  if (/fraud|duplicate|dispute|reversal|adjustment/i.test(item)) return "Risk and support operations";
  if (/reconciliation|gmv|finance|export/i.test(item)) return "Finance reporting";
  if (/onboarding|otp|kyc|profile/i.test(item)) return "User account flow";
  if (/marketplace|seller|vendor|buyer/i.test(item)) return "Marketplace flow";
  if (/admin|dashboard|analytics|report/i.test(item)) return "Management workspace";
  if (/mobile|ios|android|app/i.test(item)) return "Mobile experience";
  if (/website|websitye|websayt|site|frontend/i.test(item)) return "Public web experience";
  if (/payment|payme|click|stripe|to'lov/i.test(item)) return "Payment integration";
  if (/api|integration|crm|sms|telegram|ai/i.test(item)) return "Integration workflow";
  return "Product functionality";
}

function buildInfrastructureRows(question = "") {
  const hasPayment = /payment|payme|click|stripe|to'lov|оплат/i.test(question);
  const hasSms = /sms|otp|notification|уведом/i.test(question);
  const hasCashback = /(cashback|cash back|keshbek|кэшбек|loyalty|bonus|reward|wallet|hamyon)/i.test(question);
  const hasAi = /\bai\b|gpt|claude|llm|neural|искус/i.test(question);
  const hasCrm = /\bcrm\b|amo|bitrix/i.test(question);
  const rows = [
    { component: "Production server", type: "Cloud / VPS", cost: "Provider quote required", period: "Monthly" },
    { component: "Test / staging server", type: "Cloud / VPS", cost: "Provider quote required", period: "Monthly" },
    { component: ".uz domain", type: "Domain", cost: "Registrar quote required", period: "Yearly" },
    { component: "SSL certificate", type: "Security", cost: "Certificate policy to confirm", period: "Yearly / automated" },
  ];
  if (hasPayment) rows.push({ component: "Payment provider", type: "Third-party API", cost: "Provider fee", period: "Per transaction" });
  if (hasSms || hasCashback) rows.push({ component: "SMS / OTP gateway", type: "Third-party API", cost: "$0.02/SMS", period: "Usage based" });
  if (hasCashback) {
    rows.push({ component: "Push notification service", type: "Firebase / APNs", cost: "$0", period: "Monthly" });
    rows.push({ component: "Bank / transaction API", type: "Third-party API", cost: "Provider fee", period: "Per transaction" });
    rows.push({ component: "Analytics / monitoring", type: "Observability", cost: "Provider quote required", period: "Monthly" });
  }
  if (hasAi) rows.push({ component: "AI API", type: "Third-party API", cost: "Usage based", period: "Monthly" });
  if (hasCrm) rows.push({ component: "CRM integration", type: "Third-party API", cost: "License fee", period: "Monthly" });
  rows.push({ component: "Equipment", type: "Hardware", cost: "Not required", period: "One-time if needed" });
  return rows;
}

function buildClientDataRows(question = "", blockers = []) {
  const domainPacks = detectDomainPacks(question);
  const integrations = projectIntegrations({
    title: "",
    scope: expandScopeWithDomainResearch(question, extractScopeItems(question)).scopeItems.map((subtask) => ({ subtask, epic: scopeGroupForItem(subtask) })),
    blockers,
  });
  const integrationText = integrations.length ? `Integrations: ${integrations.join(", ")}` : "Required integrations list";
  const rows = [
    { name: "Production server access", status: "required", owner: "Client infrastructure owner" },
    { name: "Test / staging server access", status: "required", owner: "Client infrastructure owner" },
    { name: integrationText, status: "required", owner: "Client product owner" },
    ...domainPacks.flatMap((pack) => pack.blockers.map((item) => ({
      name: item.name,
      status: "required",
      owner: /payment|commercial|contract|act/i.test(item.name) ? "Client commercial owner" : "Client product owner",
    }))),
    { name: "Client-side Product Owner", status: "required", owner: "Client sponsor" },
    { name: "Client-side testing team / acceptance owner", status: "required", owner: "Client QA / UAT owner" },
    { name: "UI approval process", status: "required", owner: "Client product owner" },
    { name: "Monthly acts and payment process", status: "required", owner: "Client commercial owner" },
    { name: "Weekly demo schedule", status: "required", owner: "Client product owner" },
  ];
  return rows.slice(0, 12);
}

function buildAssumptions(question = "", context = {}) {
  const assumptions = [];
  if (!/(?:company|kompaniya|компан|client|клиент|email|@)/i.test(question)) {
    assumptions.push("[Assumption] Client company, contact person and email are not provided.");
  }
  if (!context.benchmark && /not specified/i.test(context.analog || "")) {
    assumptions.push("[Assumption] Similar benchmark is not specified; Udevs project cards are used as general reference.");
  }
  if (!/(?:duration|timeline|muddat|срок|oy|month|месяц|week|недел)/i.test(question)) {
    assumptions.push(`[Assumption] Delivery timeline is estimated as ${fmtNumber(context.duration || 3)} months.`);
  }
  if (!/(?:budget|budjet|byudjet|бюджет|\$|usd|dollar)/i.test(question)) {
    assumptions.push(`[Assumption] Development budget is estimated as ${fmtUsd(context.budget || 0)}.`);
  }
  if ((context.scopeItems || []).length <= 3) {
    assumptions.push("[Assumption] Functional scope requires discovery-level clarification before final contract.");
  }
  assumptions.push("[Assumption] Infrastructure, licenses and third-party API costs are separate from development cost.");
  return assumptions;
}

function buildRiskRows(question = "", blockers = []) {
  const rows = [
    { risk: "Scope changes after approval", mitigation: "Freeze MVP scope and estimate change requests separately." },
    { risk: "Delayed client accesses", mitigation: "Prepare server, API and payment credentials before active sprint starts." },
    { risk: "Slow acceptance feedback", mitigation: "Hold weekly demos and keep one responsible Product Owner." },
  ];
  if (/api|integration|payment|payme|click|stripe|sms|telegram|firebase|map|provider|gateway/i.test(question)) {
    rows.push({ risk: "Integration provider limitations", mitigation: "Run technical discovery and sandbox checks early." });
  }
  for (const blocker of blockers.slice(0, 3)) rows.push({ risk: blocker.name, mitigation: blocker.status });
  if (/payment|payme|click|stripe|to'lov|оплат/i.test(question)) rows.push({ risk: "Payment certification delay", mitigation: "Start merchant approval and callback testing in month 1." });
  return rows.slice(0, 7);
}

function buildScopeByEpic(items) {
  const groups = {};
  for (const item of items) {
    const key = scopeGroupForItem(item);
    groups[key] = (groups[key] || 0) + 1;
  }
  return groups;
}

function plannedPaymentRows(budget, duration, locale = "en") {
  const prepayment = roundMoney(budget * 0.3);
  const remaining = roundMoney(budget - prepayment);
  const second = roundMoney(remaining / 3);
  const third = roundMoney(remaining / 3);
  const finalPayment = roundMoney(budget - prepayment - second - third);
  const copy = locale === "uz-Latn"
    ? {
        prepayment: "Boshlang‘ich to‘lov",
        prepaymentDue: "Loyiha boshlanishidan oldin",
        secondMonth: "2-oy to‘lovi",
        thirdMonth: "3-oy to‘lovi",
        secondWeek: "2-hafta bosqichi",
        thirdWeek: "3-hafta bosqichi",
        secondMonthDue: "1-oy demosi qabul qilingandan so‘ng",
        thirdMonthDue: "2-oy demosi qabul qilingandan so‘ng",
        secondWeekDue: "1-hafta demosi qabul qilingandan so‘ng",
        thirdWeekDue: "2-hafta demosi qabul qilingandan so‘ng",
        final: "Yakuniy to‘lov",
        finalDue: "Ishga tushirish va topshirish qabul qilingandan so‘ng",
      }
    : locale === "ru"
      ? {
          prepayment: "Аванс", prepaymentDue: "До начала проекта", secondMonth: "Платёж за 2-й месяц", thirdMonth: "Платёж за 3-й месяц",
          secondWeek: "Этап 2-й недели", thirdWeek: "Этап 3-й недели", secondMonthDue: "После приёмки демо за 1-й месяц",
          thirdMonthDue: "После приёмки демо за 2-й месяц", secondWeekDue: "После приёмки демо за 1-ю неделю",
          thirdWeekDue: "После приёмки демо за 2-ю неделю", final: "Финальный платёж", finalDue: "После приёмки запуска и передачи результата",
        }
      : {
          prepayment: "Prepayment", prepaymentDue: "Before project start", secondMonth: "Month 2 payment", thirdMonth: "Month 3 payment",
          secondWeek: "Week 2 milestone", thirdWeek: "Week 3 milestone", secondMonthDue: "After accepted month 1 demo",
          thirdMonthDue: "After accepted month 2 demo", secondWeekDue: "After accepted week 1 demo",
          thirdWeekDue: "After accepted week 2 demo", final: "Final payment", finalDue: "After production release / handover",
        };
  const planning = { truthStatus: "assumed", sourceIds: [], derivationRuleId: "V5-PAYMENT-PLANNING-SCENARIO" };
  const rows = Number(duration) <= 1
    ? [
        { period: copy.prepayment, percent: 30, amount: prepayment, due: copy.prepaymentDue },
        { period: copy.secondWeek, percent: Math.round((second / budget) * 100), amount: second, due: copy.secondWeekDue },
        { period: copy.thirdWeek, percent: Math.round((third / budget) * 100), amount: third, due: copy.thirdWeekDue },
        { period: copy.final, percent: Math.round((finalPayment / budget) * 100), amount: finalPayment, due: copy.finalDue },
      ]
    : [
        { period: copy.prepayment, percent: 30, amount: prepayment, due: copy.prepaymentDue },
        { period: copy.secondMonth, percent: Math.round((second / budget) * 100), amount: second, due: copy.secondMonthDue },
        { period: copy.thirdMonth, percent: Math.round((third / budget) * 100), amount: third, due: copy.thirdMonthDue },
        { period: copy.final, percent: Math.round((finalPayment / budget) * 100), amount: finalPayment, due: copy.finalDue },
      ];
  const minorAmounts = rows.map((row, index) => ({ id: `PAY-${index + 1}`, order: index + 1, amountMinor: Math.round(row.amount * 100) }));
  const basisPoints = allocatePaymentPercentBasisPoints(minorAmounts, Math.round(budget * 100));
  return rows.map((row, index) => ({ ...row, percent: basisPoints[index] / 100, percentBasisPoints: basisPoints[index], ...planning }));
}

function localizedDeliveryRole(role = "", locale = "en") {
  const key = String(role);
  if (locale === "uz-Latn") {
    if (/^PM/.test(key)) return "PM / Mahsulot menejeri";
    if (/Team Lead/.test(key)) return "Team Lead / Yechim arxitektori";
    if (/UI\/UX/.test(key)) return "UI/UX dizayner";
    if (/Backend/.test(key)) return "Backend dasturchi";
    if (/Frontend/.test(key)) return "Frontend dasturchi";
    if (/Mobile/.test(key)) return "Mobil dasturchi";
    if (/QA/.test(key)) return "QA muhandisi";
    if (/DevOps/.test(key)) return "DevOps / Release muhandisi";
  }
  if (locale === "ru") {
    if (/^PM/.test(key)) return "PM / Менеджер продукта";
    if (/Team Lead/.test(key)) return "Team Lead / Архитектор решения";
    if (/UI\/UX/.test(key)) return "UI/UX-дизайнер";
    if (/Backend/.test(key)) return "Backend-разработчик";
    if (/Frontend/.test(key)) return "Frontend-разработчик";
    if (/Mobile/.test(key)) return "Мобильный разработчик";
    if (/QA/.test(key)) return "QA-инженер";
    if (/DevOps/.test(key)) return "DevOps / Release-инженер";
  }
  return key;
}

function buildCustomProjectFromQuestion(question, projects) {
  const groundedBrief = parseKpBrief(question, {
    defaultCurrency: process.env.KP_DEFAULT_CURRENCY || "USD",
    defaultGeography: process.env.KP_DEFAULT_GEOGRAPHY || null,
  });
  const benchmark = matchBenchmark(question, projects);
  const title = groundedBrief.projectName.value || groundedBrief.workingTitle.value || extractCustomTitle(question);
  const parsedScopeRows = groundedBrief.scope || [];
  const groundedScopeItems = parsedScopeRows.map((item) => item.value).filter(Boolean);
  const detectedScopeItems = groundedScopeItems.length ? groundedScopeItems : extractScopeItems(question);
  const requestedScopeItems = parsedScopeRows
    .filter((item) => item.status === "explicit" || item.inclusion === "requested")
    .map((item) => item.value)
    .filter(Boolean);
  const { scopeItems, domainPacks } = expandScopeWithDomainResearch(question, detectedScopeItems, { requestedScopeItems });
  const requestedScopeKeys = new Set(requestedScopeItems.map((item) => String(item).toLowerCase()));
  const primaryDomain = domainPacks[0] || null;
  const parsedAnalog = groundedBrief.analog.name.value || extractAnalogName(question, benchmark);
  const analog = primaryDomain && /not specified/i.test(parsedAnalog)
    ? primaryDomain.analog
    : parsedAnalog;
  const duration = groundedBrief.timeline.months.value || extractDurationMonths(question, benchmark);
  const budget = Number(groundedBrief.budget.amount.value || 0) || extractBudgetUsd(question, benchmark);
  const currencyStatus = groundedBrief.budget.currency.status || "unknown";
  const currency = groundedBrief.budget.currency.value || "XXX";
  const scopeByEpic = buildScopeByEpic(scopeItems);
  const budgetTight = budget <= 15_000;
  const rolePlan = allocateTotal(budget, [
    { role: "PM / Product Manager", qty: 1, months: duration, weight: 12 },
    { role: "Team Lead / Solution Architect", qty: 0.5, months: duration, weight: /integration|api|marketplace|erp|crm|highload|cashback|wallet/i.test(question) ? 10 : 7 },
    { role: "UI/UX Designer", qty: /design|mobile|mobil|web|site|websitye|app|прилож|marketplace|cashback|wallet/i.test(question) ? 1 : 0.5, months: Math.min(duration, 2), weight: 9 },
    { role: "Backend Engineer", qty: budgetTight ? 1 : Math.max(1, Math.ceil(scopeItems.length / 10)), months: duration, weight: /cashback|wallet|payment|api/i.test(question) ? 30 : 26 },
    { role: "Frontend Engineer", qty: /web|admin|dashboard|site|websitye|crm|erp|marketplace|cashback|wallet/i.test(question) ? 1 : 0.5, months: duration, weight: 17 },
    { role: "Mobile Engineer", qty: /mobile|mobil|mobilka|mobilkasi|ios|android|app|прилож/i.test(question) ? 1 : 0, months: duration, weight: 15 },
    { role: "QA Engineer", qty: 1, months: Math.max(1, duration - 0.5), weight: 8 },
    { role: "DevOps / Release Engineer", qty: /integration|api|highload|cloud|server|marketplace|cashback|wallet/i.test(question) ? 0.5 : 0.25, months: Math.max(1, duration / 2), weight: 5 },
  ].filter((row) => row.qty > 0));
  const blockers = [...domainPacks.flatMap((pack) => pack.blockers)];
  if (/api|integration|integrats|интеграц/i.test(question)) blockers.push({ name: "External API access", status: "Client/API owner must provide stable access and test credentials" });
  if (/payment|payme|click|stripe|to'lov|оплат/i.test(question)) blockers.push({ name: "Payment provider approval", status: "Merchant account, callback rules and test cards must be ready" });
  if (/design|figma|ui|ux/i.test(question)) blockers.push({ name: "Design approval", status: "Figma flow and acceptance criteria must be approved before sprint KP" });
  if (/data|migration|import|excel|база|данн/i.test(question)) blockers.push({ name: "Data migration", status: "Source data quality and import format must be confirmed" });
  if (!blockers.length) blockers.push({ name: "Requirements freeze", status: "Scope, MVP boundaries and acceptance rules must be confirmed" });

  // An explicitly stated budget with an explicit currency yields a planning
  // payment scenario (prepayment + acceptance-gated monthly stages) that
  // reconciles exactly to the budget. It is presented as a scenario, never as
  // a signed quote. Without an explicit currency the schedule stays empty.
  const payments = buildBudgetPaymentScenario({
    total: budget,
    currencyStatus,
    durationMonths: duration,
    locale: groundedBrief.sourceLanguage,
  });
  const competitive = benchmark
    ? [{ feature: "Benchmark", ours: title, competitor: benchmark.title }]
    : [{ feature: "Benchmark", ours: title, competitor: analog }];

  const out = {
    key: `custom-${slugify(title)}`,
    title,
    analog,
    source: "Telegram custom project description",
    pptx: "",
    sheets: ["Custom prompt"],
    guarantees: [
      { name: "Dedicated delivery team", description: "PM, design, engineering and QA roles are planned around one delivery roadmap." },
      { name: "Weekly demo rhythm", description: "Client sees working progress every week and approves milestones before payment steps." },
      { name: "Transparent scope control", description: "Scope, assumptions and client-side dependencies are visible before implementation starts." },
      { name: "Release readiness", description: "QA, monitoring and production handover are treated as part of delivery, not as afterthoughts." },
    ],
    blockers: uniqueBlockers(blockers),
    infrastructure: mergeInfrastructureRows(buildInfrastructureRows(question), domainPacks.flatMap((pack) => pack.infrastructure)),
    client_requirements: buildClientDataRows(question, blockers),
    assumptions: buildAssumptions(question, { analog, benchmark, budget, duration, scopeItems }),
    risks: buildRiskRows(question, blockers),
    scope: scopeItems.map((subtask, index) => ({
      month: `Month ${Math.min(duration, Math.floor(index / 6) + 1)}`,
      epic: scopeGroupForItem(subtask),
      task: taskForScopeItem(subtask),
      subtask,
      status: requestedScopeKeys.has(String(subtask).toLowerCase()) ? "Requested" : "Recommended",
      effort: 1,
    })),
    requested_scope: requestedScopeItems,
    recommended_scope: scopeItems.filter((item) => !requestedScopeKeys.has(String(item).toLowerCase())),
    scope_inference_mode: requestedScopeItems.length ? "mixed" : "recommendation",
    scope_by_epic: scopeByEpic,
    estimate: rolePlan.map(({ role, qty, months, total }) => ({
      role: localizedDeliveryRole(role, groundedBrief.sourceLanguage),
      qty,
      months,
      rate: Math.round(total / Math.max(1, qty * months)),
      total,
    })),
    payments,
    competitive,
    market: [
      { label: "Input source", value: "User prompt + domain research pack" },
      ...(primaryDomain ? [
        { label: "Domain research", value: primaryDomain.description },
        { label: "Product category", value: primaryDomain.industry },
      ] : []),
    ],
    ppt_slides: [],
    status: "draft",
    grounded_brief: groundedBrief,
    budget_original: groundedBrief.budget.amount.value ? {
      amount: groundedBrief.budget.amount.value,
      currency: groundedBrief.budget.currency.value,
      status: groundedBrief.budget.currency.status,
    } : null,
    currency,
    currency_status: currencyStatus,
  };
  if (groundedBrief.budget.currency.status === "assumed") {
    out.assumptions.unshift(`[Assumption] Budget currency was not explicit; ${groundedBrief.budget.currency.value} was applied from the KP default currency policy.`);
  }
  if (groundedBrief.budget.currency.status === "unknown") {
    out.assumptions.unshift("[Open question] Budget currency is not provided; the amount cannot become a signed commercial price until currency is confirmed.");
  }
  for (const questionText of groundedBrief.openQuestions || []) {
    if (!out.assumptions.some((item) => item.includes(questionText))) out.assumptions.push(`[Open question] ${questionText}`);
  }
  out.budget_usd = budget;
  out.duration_months = duration;
  out.scope_count = Math.max(scopeItems.length, Object.values(scopeByEpic).reduce((a, b) => a + b, 0));
  out.blocker_count = out.blockers.length;
  out.competitive_count = competitive.length;
  out.readiness_score = clamp(100 - out.blocker_count * 8 - (benchmark ? 0 : 8), 20, 95);
  out.complexity_score = clamp(30 + out.scope_count * 2.4 + Object.keys(scopeByEpic).length * 6 + duration * 5, 20, 100);
  out.commercial_score = clamp(budget / 1200 + duration * 5 + (benchmark ? 12 : 4), 20, 100);
  out.kpi_score = clamp(out.commercial_score * 0.4 + out.complexity_score * 0.35 + out.readiness_score * 0.25, 0, 100);
  return out;
}

function canonicalKpUrl(value = "") {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:gclid|fbclid|ref)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return "";
  }
}

function isRelevantKpMarketSource(item = {}, groundedBrief = {}, project = {}) {
  if (!item.text || item.error) return false;
  const haystack = `${item.title || ""} ${item.url || ""} ${item.text || ""}`.toLowerCase();
  const category = `${groundedBrief.productCategory?.value || ""} ${projectType(project)}`.toLowerCase();
  const analog = String(groundedBrief.analog?.name?.value || projectAnalog(project) || "").toLowerCase();
  if (["organization", "company_team", "technology_stack"].includes(String(item.topic || ""))) {
    const companyTarget = String(
      groundedBrief.analog?.name?.value
      || projectAnalog(project)
      || groundedBrief.projectName?.value
      || project.title
      || "",
    ).toLowerCase();
    const companyTokens = companyTarget
      .replace(/https?:\/\//g, " ")
      .replace(/\.[a-z]{2,}$/i, " ")
      .split(/[^a-z0-9\p{L}]+/u)
      .filter((token) => token.length >= 4 && !["company", "marketplace", "platform", "project"].includes(token));
    return companyTokens.length > 0 && companyTokens.some((token) => haystack.includes(token));
  }
  const scope = (groundedBrief.scope || []).map((entry) => entry.value || "").join(" ").toLowerCase();
  const domainPattern = /food|restaurant|courier|delivery/.test(`${category} ${scope}`)
    ? /food\s*delivery|restaurant|courier|order|menu|last[- ]mile/i
    : /marketplace|e-?commerce|seller|buyer|merchant|catalog/.test(`${category} ${scope}`)
      ? /marketplace|e-?commerce|seller|buyer|merchant|catalog|checkout/i
      : /\bcrm\b|lead|sales/.test(`${category} ${scope}`)
        ? /\bcrm\b|lead|pipeline|sales|customer relationship/i
        : /\btms\b|logistic|fleet|shipment/.test(`${category} ${scope}`)
          ? /\btms\b|logistic|fleet|shipment|dispatch|transport/i
          : /software|digital product|platform|application/i;
  const analogToken = analog.replace(/\.[a-z]{2,}$/i, "").split(/[^a-z0-9]+/).find((token) => token.length >= 4) || "";
  const analogMatch = analogToken ? haystack.includes(analogToken) : false;
  return analogMatch || domainPattern.test(haystack);
}

export function selectKpResearchCandidates(searchRuns = [], sourceLimit = 8) {
  const limit = Math.max(1, Number(sourceLimit) || 8);
  const seenUrls = new Set();
  const candidates = [];
  const maxResultsPerQuery = Math.max(0, ...searchRuns.map((run) => Math.min(3, run.results?.length || 0)));
  for (let resultIndex = 0; resultIndex < maxResultsPerQuery && candidates.length < limit; resultIndex += 1) {
    for (const run of searchRuns) {
      const result = run.results?.[resultIndex];
      const key = canonicalKpUrl(result?.url || "");
      if (!key || seenUrls.has(key)) continue;
      seenUrls.add(key);
      candidates.push({ ...result, queryId: run.query.id, topic: run.query.topic });
      if (candidates.length >= limit) break;
    }
  }
  return candidates;
}

async function prepareKpEvidence(question = "", project = {}, options = {}, progress = async () => {}) {
  const evidenceBundle = options.evidenceBundle || null;
  const groundedBrief = options.groundedBrief || project.grounded_brief || parseKpBrief(question, {
    defaultCurrency: process.env.KP_DEFAULT_CURRENCY || "USD",
    defaultGeography: process.env.KP_DEFAULT_GEOGRAPHY || null,
  });
  const classifiedLinks = classifyKpLinks(question, evidenceBundle);
  const analogUrl = groundedBrief.analog?.url?.value || "";
  const brandUrl = groundedBrief.brandReference?.url?.value || "";
  const links = {
    urls: uniqueUrls([...classifiedLinks.urls, analogUrl, brandUrl]),
    brandUrls: uniqueUrls([...classifiedLinks.brandUrls, brandUrl]),
    analogUrls: uniqueUrls([...classifiedLinks.analogUrls, analogUrl]),
    pdfUrls: classifiedLinks.pdfUrls,
  };
  const files = (evidenceBundle?.files || []).filter((file) => file?.path && !file.error);
  const failedFiles = (evidenceBundle?.files || []).filter((file) => file?.error);

  const transcripts = [];
  for (const file of files.filter(isAudioEvidenceFile).slice(0, 3)) {
    await progress(`KP research: call zapis transcript qilinyapti (${file.fileName || path.basename(file.path)}).`);
    const result = await transcribeAudioFile(file.path, `${project.title || ""} ${question}`);
    transcripts.push({ ...result, fileName: file.fileName || path.basename(file.path), path: file.path });
  }

  const documents = [];
  for (const file of files.filter((item) => isPdfEvidenceFile(item) || isTextEvidenceFile(item)).slice(0, 6)) {
    await progress(`KP research: document/PDF evidence o'qilyapti (${file.fileName || path.basename(file.path)}).`);
    try {
      const text = isPdfEvidenceFile(file)
        ? extractPdfTextFromFile(file.path, 10)
        : await fs.readFile(file.path, "utf8");
      documents.push({ fileName: file.fileName || path.basename(file.path), type: file.type || "document", text: safeText(text, 5000), path: file.path });
    } catch (error) {
      documents.push({ fileName: file.fileName || path.basename(file.path), type: file.type || "document", text: "", error: error.message, path: file.path });
    }
  }

  const brandTargets = links.brandUrls.slice(0, Number(process.env.KP_BRAND_PROFILE_LIMIT || 2));
  if (brandTargets.length) await progress(`KP research: ${brandTargets.length} brand/site profile parallel olinmoqda.`);
  const brandProfiles = await Promise.all(brandTargets.map(async (url) => {
    try {
      return { url, ...(await extractSiteProfile(url)) };
    } catch (error) {
      return { url, error: error.message };
    }
  }));

  const analogTargets = links.analogUrls.slice(0, Number(process.env.KP_ANALOG_SOURCE_LIMIT || 3));
  if (analogTargets.length) await progress(`KP research: ${analogTargets.length} analog/source parallel tekshirilmoqda.`);
  const analogResearch = await Promise.all(analogTargets.map(async (url) => {
    try {
      const text = await fetchUrlText(url, 4000);
      if (isBlockedKpResearchContent(text)) {
        return { url, title: hostLabel(url), text: "", blocked: true, error: "Anti-bot or interstitial response; no readable analogue evidence." };
      }
      return { url, title: hostLabel(url), text };
    } catch (error) {
      return { url, title: hostLabel(url), text: "", error: error.message };
    }
  }));

  const researchQueries = buildKpResearchQueries(groundedBrief, {
    title: project.title,
    type: projectType(project),
    analog: projectAnalog(project),
  });
  const skipWebResearch = options.skipWebResearch
    || /^(?:true|1|yes)$/i.test(String(process.env.KP_DISABLE_WEB_RESEARCH || ""));
  let marketSources = [];
  let queryRuns = [];
  if (!skipWebResearch) {
    await progress(`KP research: ${researchQueries.length} mavzu bo'yicha parallel qidiruv qilinyapti.`);
    const searchRuns = await mapWithConcurrency(
      researchQueries,
      Number(process.env.KP_SEARCH_CONCURRENCY || 3),
      async (query) => ({ query, results: await searchWeb(query.query, 5) }),
    );
    const sourceLimit = Number(process.env.KP_RESEARCH_SOURCE_LIMIT || 10);
    const candidates = selectKpResearchCandidates(searchRuns, sourceLimit);
    marketSources = await mapWithConcurrency(
      candidates,
      Number(process.env.KP_FETCH_CONCURRENCY || 4),
      async (result) => {
        try {
          const text = await fetchUrlText(result.url, 4200);
          if (isBlockedKpResearchContent(text)) {
            return { ...result, text: "", blocked: true, error: "Anti-bot or interstitial response; no readable research evidence." };
          }
          return { ...result, text };
        } catch (error) {
          return { ...result, text: "", error: error.message };
        }
      },
    );
    marketSources = marketSources.filter((item) => isRelevantKpMarketSource(item, groundedBrief, project));
    queryRuns = searchRuns.map(({ query, results }) => ({
      id: query.id,
      topic: query.topic,
      query: query.query,
      resultCount: results.length,
      readCount: marketSources.filter((item) => item.queryId === query.id && item.text && !item.error).length,
    }));
  }
  const researchStatus = buildResearchStatus(queryRuns, {
    offline: skipWebResearch,
    reason: skipWebResearch ? "Web research was disabled by the request or KP_DISABLE_WEB_RESEARCH." : "",
  });

  await progress("KP research: Sales Udevs historical KP references o'qilyapti.");
  const historicalKpReferences = await enrichHistoricalKpReferences(await loadHistoricalKpReferences(question, project, options));

  return {
    groundedBrief,
    links,
    files,
    failedFiles,
    transcripts,
    documents,
    callInsights: buildCallInsights(transcripts),
    brandProfiles,
    analogResearch,
    marketSources,
    researchQueries,
    researchStatus,
    historicalKpReferences,
    marketResearch: buildMarketResearch(project, marketSources, analogResearch, researchStatus),
    sources: buildKpSourceMap({ links, files, failedFiles, documents, transcripts, brandProfiles, analogResearch, marketSources, historicalKpReferences }),
  };
}

function buildKpSourceMap({ links, files, failedFiles, documents, transcripts, brandProfiles, analogResearch, marketSources, historicalKpReferences = [] }) {
  const rows = [{ type: "client_brief", label: "Client brief", source: "Client-provided request", status: "provided" }];
  const unreadableUrls = new Set([...analogResearch, ...marketSources]
    .filter((item) => item.error || isBlockedKpResearchContent(item.text))
    .map((item) => canonicalKpUrl(item.url))
    .filter(Boolean));
  for (const url of links.urls) {
    if (!unreadableUrls.has(canonicalKpUrl(url))) rows.push({ type: "link", label: hostLabel(url), source: url, status: "collected" });
  }
  for (const file of files) rows.push({ type: file.type || "file", label: file.fileName || path.basename(file.path), source: file.path, status: "downloaded" });
  for (const file of failedFiles) rows.push({ type: file.type || "file", label: file.fileName || "file", source: file.error, status: "failed" });
  for (const doc of documents) rows.push({ type: "document_extract", label: doc.fileName, source: doc.path, status: doc.text ? "extracted" : `failed: ${doc.error || "empty"}` });
  for (const tr of transcripts) rows.push({ type: "call_transcript", label: tr.fileName, source: tr.path, status: tr.transcript ? `transcribed (${tr.model})` : `failed: ${tr.error || "empty"}` });
  for (const item of brandProfiles) rows.push({ type: "brand_profile", label: hostLabel(item.url), source: item.url, status: item.error ? `failed: ${item.error}` : "profiled" });
  for (const item of analogResearch) rows.push({ type: "analog_research", label: item.title || hostLabel(item.url), source: item.url, status: item.error ? `failed: ${item.error}` : "read" });
  for (const item of marketSources) rows.push({
    type: item.topic === "organization" ? "company_organization" : item.topic === "company_team" ? "company_team_research" : "market_research",
    label: item.title || hostLabel(item.url),
    source: item.url,
    status: item.error ? `failed: ${item.error}` : "read",
    researchTopic: item.topic,
    queryId: item.queryId,
  });
  return sanitizeAndDedupeSources(rows);
}

function buildMarketResearch(project = {}, marketSources = [], analogResearch = [], researchStatus = {}) {
  const category = projectType(project);
  const locale = project.grounded_brief?.sourceLanguage || "en";
  const readableAnalog = analogResearch.filter((item) => item.text && !item.error && !isBlockedKpResearchContent(item.text));
  const readableMarket = marketSources.filter((item) => item.text && !item.error && !isBlockedKpResearchContent(item.text));
  const sourceText = [...readableMarket, ...readableAnalog].map((item) => item.text || "").join(" ").toLowerCase();
  const trendKeys = [
    /mobile|app|ios|android/.test(sourceText) || projectPlatforms(project).some((item) => /mobile/i.test(item)) ? "mobile" : "",
    /\bai\b|automation|\bllm\b|\bocr\b/.test(sourceText) ? "ai" : "",
    /payment|checkout|wallet|subscription/.test(sourceText) || projectIntegrations(project).some((item) => /payment/i.test(item)) ? "payments" : "",
    /marketplace|seller|vendor|catalog/.test(sourceText) ? "trust" : "",
    "operations",
  ].filter(Boolean).slice(0, 5);
  const trendCopy = locale === "uz-Latn"
    ? { mobile: "Mobil qurilmaga mos foydalanuvchi jarayoni va bildirishnomalar orqali qayta jalb qilish", ai: "Sun’iy intellekt yordamidagi operatsiyalar va avtomatlashtirish", payments: "Birlashtirilgan to‘lovlar va hisob-kitoblarni solishtirish", trust: "Marketpleys ishonchi, katalog sifati va sotuvchi operatsiyalari", operations: "Boshqaruv panellari va o‘lchanadigan yetkazib berish ko‘rsatkichlari" }
    : locale === "ru"
      ? { mobile: "Пользовательский путь для мобильных устройств и повторное вовлечение через уведомления", ai: "Операции и автоматизация с применением искусственного интеллекта", payments: "Объединённые платежи и сверка расчётов", trust: "Доверие к маркетплейсу, качество каталога и работа продавцов", operations: "Панели операционного контроля и измеримые показатели поставки" }
      : { mobile: "Mobile-first user journey and push-based retention", ai: "AI-assisted operations and automation", payments: "Integrated payments and reconciliation", trust: "Marketplace trust, catalog quality and seller operations", operations: "Operational dashboards and measurable delivery KPIs" };
  const trends = trendKeys.map((key) => trendCopy[key]);
  const competitors = [...new Set([
    ...readableAnalog.map((item) => item.title || hostLabel(item.url)),
    ...readableMarket
      .filter((item) => /competitor|analog/.test(item.topic || ""))
      .map((item) => item.title || hostLabel(item.url))
      .filter((item) => !/research|report|blog|medium|wikipedia|statista|industry/i.test(item)),
  ].filter(Boolean))].slice(0, 6);
  return {
    category,
    positioning: locale === "uz-Latn"
      ? "Boshlang‘ich mahsulotni ishga tushirish, boshqaruv nazorati va o‘lchanadigan qabul bosqichlariga qaratilgan marketpleys taklifi."
      : locale === "ru"
        ? "Предложение по маркетплейсу с фокусом на запуск первой версии продукта, операционный контроль и измеримые этапы приёмки."
        : `${category} proposal focused on MVP launch, operational control, and measurable acceptance milestones.`,
    trends,
    competitors,
    pricingSignals: locale === "uz-Latn"
      ? ["Funksional taqsimot bozor taxmini emas, ko‘rsatilgan budjet miqdoriga mos rejalashtirish ssenariysidir.", "Tashqi infratuzilma, litsenziya va uchinchi tomon xizmatlari xarajatlari ishlab chiqish summasidan alohida aniqlashtiriladi.", "Yakuniy tijorat modeli talablar aniqlanib, loyiha tarkibi tasdiqlangandan keyin kelishiladi."]
      : locale === "ru"
        ? ["Функциональное распределение — плановый сценарий в рамках указанной суммы, а не рыночная оценка.", "Внешняя инфраструктура, лицензии и сторонние сервисы уточняются отдельно от стоимости разработки.", "Финальная коммерческая модель согласуется после уточнения требований и подтверждения состава проекта."]
        : ["Functional allocation is a planning scenario within the stated budget amount, not a market quote.", "External infrastructure, license, and API fees are confirmed separately from development cost.", "The final commercial model should be validated after discovery and scope approval."],
    sourceCount: readableMarket.length + readableAnalog.length,
    researchStatus,
  };
}

export function buildSourcedMarketSizing(project = {}, research = {}) {
  const fallback = buildUnknownMarketSizing(
    research.researchStatus || research.marketResearch?.researchStatus || {},
    research.sources || [],
  );
  const brief = research.groundedBrief || project.grounded_brief || {};
  const sourceIdForUrl = (url = "") => {
    const canonical = canonicalKpUrl(url);
    return (research.sources || []).find((item) => canonicalKpUrl(item.source || "") === canonical)?.id || "";
  };
  const explicitGeography = String(brief.geography?.value || "").trim();
  const evidence = (research.marketSources || [])
    .filter((item) => item.topic === "market_size" && item.text && !item.error && !isBlockedKpResearchContent(item.text))
    .filter((item) => marketSourceAuthority(item.url) > 0)
    .flatMap((item) => extractMarketSizeEvidence(item).map((row) => ({
      ...row,
      sourceId: sourceIdForUrl(item.url),
      source: (research.sources || []).find((source) => canonicalKpUrl(source.source || "") === canonicalKpUrl(item.url)),
      authority: marketSourceAuthority(item.url),
    })))
    .filter((item) => item.sourceId && item.source)
    .filter((item) => !explicitGeography || marketEvidenceMatchesGeography(item.contextExcerpt || item.evidenceExcerpt, explicitGeography))
    .sort((left, right) => right.authority - left.authority
      || marketNatureRank(right.claimNature) - marketNatureRank(left.claimNature)
      || right.year - left.year);
  const baseline = evidence[0];
  if (!baseline) return fallback;

  const detectedGeography = explicitGeography || inferMarketEvidenceGeography(baseline.contextExcerpt || baseline.evidenceExcerpt);
  if (!detectedGeography) return fallback;
  const benchmarkOnly = !explicitGeography;
  const geography = benchmarkOnly ? `${detectedGeography} benchmark` : detectedGeography;
  const period = String(baseline.year);
  const samShare = 0.25;
  const samValue = roundMarketValue(baseline.value * samShare);
  const captureRates = [0.0025, 0.005, 0.01];
  const locale = brief.sourceLanguage || "en";
  const assumptions = locale === "uz-Latn"
    ? [
        benchmarkOnly ? `${detectedGeography} faqat bozor benchmarki sifatida ishlatilgan; loyiha geografiyasi mijoz bilan tasdiqlanadi.` : `${detectedGeography} mijoz brifidagi maqsadli geografiya sifatida ishlatilgan.`,
        "SAM — TAMning 25% ishga tushirish segmenti bo‘yicha rejalashtirish taxmini.",
        "SOM — SAMning 0,25%, 0,5% va 1% ulushini egallash ssenariylari.",
      ]
    : locale === "ru"
      ? [
          benchmarkOnly ? `${detectedGeography} используется только как рыночный ориентир; география проекта подтверждается клиентом.` : `${detectedGeography} используется как целевая география из брифа клиента.`,
          "SAM — плановое допущение: 25% TAM как доступный сегмент запуска.",
          "SOM — сценарии захвата 0,25%, 0,5% и 1% от SAM.",
        ]
      : [
          benchmarkOnly ? `${detectedGeography} is used only as a market benchmark; the project geography remains subject to client confirmation.` : `${detectedGeography} is the target geography stated in the client brief.`,
          "SAM is a planning assumption equal to 25% of TAM for the launch-serviceable segment.",
          "SOM uses 0.25%, 0.5%, and 1% capture scenarios within SAM.",
        ];
  return {
    status: "modeled",
    geography,
    geographyStatus: benchmarkOnly ? "assumed" : "explicit",
    period,
    currency: baseline.currency,
    tam: {
      value: baseline.value,
      currency: baseline.currency,
      geography,
      period,
      truthStatus: "single_source",
      claimNature: baseline.claimNature,
      sourceIds: [baseline.sourceId],
      evidenceExcerpt: baseline.evidenceExcerpt,
    },
    sam: {
      value: samValue,
      currency: baseline.currency,
      geography,
      period,
      shareOfParent: samShare,
      truthStatus: "assumed",
      claimNature: "scenario",
      sourceIds: [baseline.sourceId],
      derivationRuleId: "MARKET-SAM-LAUNCH-SHARE-V1",
    },
    somScenarios: captureRates.map((captureRate, index) => ({
      id: `MARKET-SOM-${index + 1}`,
      label: ["Conservative", "Base", "Upside"][index],
      value: roundMarketValue(samValue * captureRate),
      currency: baseline.currency,
      geography,
      period,
      shareOfParent: captureRate,
      truthStatus: "assumed",
      claimNature: "scenario",
      sourceIds: [baseline.sourceId],
      derivationRuleId: "MARKET-SOM-CAPTURE-SCENARIO-V1",
    })),
    methodology: [
      `TAM = ${baseline.currency} ${baseline.value} (${period}, ${geography}).`,
      "SAM = TAM × 25%.",
      "SOM = SAM × 0.25% / 0.5% / 1%.",
      ...assumptions,
    ],
    assumptions,
    sourceIds: [baseline.sourceId],
    sources: [baseline.source],
  };
}

function buildTamSamSom(project = {}, research = {}) {
  return buildSourcedMarketSizing(project, research);
}

function marketSourceAuthority(value = "") {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (/(?:^|\.)(?:gov|gob|gc)(?:\.|$)/.test(host) || /(?:^|\.)stat\./.test(host) || /(?:^|\.)siat\.stat\./.test(host)) return 3;
    if (/worldbank\.org$|oecd\.org$|imf\.org$|europa\.eu$|un\.org$/.test(host)) return 2;
    return 0;
  } catch {
    return 0;
  }
}

function extractMarketSizeEvidence(item = {}) {
  const text = String(item.text || "").replace(/\s+/g, " ").trim();
  const windows = text
    .split(/(?<=[.!?])\s+/u)
    .map((value) => value.trim())
    .filter((value) => value.length >= 30 && value.length <= 700)
    .filter((value) => /e-?commerce|electronic commerce|online retail|электронн\p{L}*\s+торгов|электрон\s+tijorat/iu.test(value))
    .filter((value) => /market|volume|turnover|revenue|sales|sector|рын|объ[её]м|оборот|bozor|hajm|savdo/iu.test(value));
  const rows = [];
  for (const window of windows) {
    const contextExcerpt = safeText(window, 360);
    for (const clause of splitMarketEvidenceClauses(window)) {
      const amounts = extractMarketAmountMatches(clause);
      const years = extractMarketYearMatches(clause);
      if (!amounts.length || !years.length) continue;
      const claimNature = marketClaimNature(clause);
      for (const amount of amounts) {
        const year = nearestMarketYear(amount, years);
        if (!year) continue;
        rows.push({
          value: amount.value,
          currency: amount.currency,
          year,
          claimNature,
          evidenceExcerpt: safeText(clause, 360),
          contextExcerpt,
        });
      }
    }
  }
  return rows;
}

function splitMarketEvidenceClauses(value = "") {
  const text = String(value || "").trim();
  const clauses = text
    .split(/\s*;\s*|\s+[—–]\s+|\s+(?=(?:while|whereas|but|however)\b)|\s+(?=and\s+(?:is\s+)?(?:expected|forecast|projected|estimated|will\s+reach)\b)/iu)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return clauses.length ? clauses : [text];
}

function marketAmountPattern(flags = "iu") {
  return new RegExp(String.raw`(?:\b(USD|UZS|EUR|GBP)\b|US\s*dollars?|\$|€|£)?\s*(\d+(?:[.,]\d+)?)\s*(trillion|billion|million|tn|bn|mn|trln|bln|mln|[tbm]|триллион\p{L}*|миллиард\p{L}*|миллион\p{L}*|трлн|млрд|млн)(?!\p{L})\s*(?:\b(USD|UZS|EUR|GBP)\b|US\s*dollars?|soums?|so['’ʻ]?m|сум|\$|€|£)?`, flags);
}

function extractMarketAmountMatches(value = "") {
  return [...String(value || "").matchAll(marketAmountPattern("giu"))]
    .map((match) => {
      const amount = marketAmountFromMatch(match);
      if (!amount) return null;
      const index = match.index || 0;
      return { ...amount, index, end: index + match[0].length };
    })
    .filter(Boolean);
}

function parseMarketAmount(value = "") {
  const match = String(value || "").match(marketAmountPattern("iu"));
  if (!match) return null;
  return marketAmountFromMatch(match);
}

function marketAmountFromMatch(match = []) {
  const context = match[0];
  const currency = /\bUSD\b|US\s*dollars?|\$/iu.test(context) ? "USD"
    : /\bUZS\b|soums?|so['’ʻ]?m|сум/iu.test(context) ? "UZS"
      : /\bEUR\b|€/iu.test(context) ? "EUR"
        : /\bGBP\b|£/iu.test(context) ? "GBP"
          : null;
  if (!currency) return null;
  const raw = match[2];
  const numeric = /^\d{1,3}(?:,\d{3})+$/.test(raw) ? Number(raw.replace(/,/g, "")) : Number(raw.replace(",", "."));
  const scale = match[3].toLowerCase();
  const multiplier = /trillion|tn|trln|триллион|трлн|^t$/u.test(scale) ? 1e12
    : /billion|bn|bln|миллиард|млрд|^b$/u.test(scale) ? 1e9
      : 1e6;
  const amount = numeric * multiplier;
  return Number.isFinite(amount) && amount > 0 ? { value: amount, currency } : null;
}

function extractMarketYearMatches(value = "") {
  return [...String(value || "").matchAll(/\b(20(?:1[6-9]|2\d))\b/gu)].map((match) => {
    const index = match.index || 0;
    return { value: Number(match[1]), index, end: index + match[0].length };
  });
}

function nearestMarketYear(amount = {}, years = []) {
  const amountCenter = (Number(amount.index) + Number(amount.end)) / 2;
  return [...years]
    .sort((left, right) => {
      const leftDistance = Math.abs(((left.index + left.end) / 2) - amountCenter);
      const rightDistance = Math.abs(((right.index + right.end) / 2) - amountCenter);
      return leftDistance - rightDistance
        || Number(left.index < amount.index) - Number(right.index < amount.index)
        || left.index - right.index;
    })[0]?.value || null;
}

function marketClaimNature(value = "") {
  return /forecast|project(?:ed|ion)|expected|will reach|прогноз|ожида|достигнет|prognoz|kutil/iu.test(value)
    ? "forecast"
    : /estimate|estimated|approximately|около|примерно|оцен|taxmin/iu.test(value)
      ? "estimate"
      : "observed";
}

function inferMarketEvidenceGeography(value = "") {
  const text = String(value || "");
  if (/uzbekistan|o['’ʻ]?zbekiston|узбекистан/iu.test(text)) return "Uzbekistan";
  return "";
}

function marketEvidenceMatchesGeography(evidenceExcerpt = "", explicitGeography = "") {
  const evidence = normalizeGeographyText(evidenceExcerpt);
  const target = normalizeGeographyText(explicitGeography);
  if (!evidence || !target) return false;
  if (/^(?:uzbekistan|ozbekiston|узбекистан)$/u.test(target)) {
    return /(?:^|\s)(?:uzbekistan|ozbekiston|узбекистан)(?:\s|$)/u.test(evidence);
  }
  if (evidence.includes(target)) return true;
  const meaningfulTokens = target.split(/\s+/u).filter((token) => token.length >= 4);
  return meaningfulTokens.length > 0 && meaningfulTokens.every((token) => evidence.includes(token));
}

function normalizeGeographyText(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘ʻ`']/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function marketNatureRank(value = "") {
  return ({ observed: 3, estimate: 2, forecast: 1 })[value] || 0;
}

function roundMarketValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(numeric)) - 5);
  return Math.round(numeric / magnitude) * magnitude;
}

function functionBudgetWeight(feature = "", detail = "") {
  const text = `${feature} ${detail}`;
  if (/catalog|search|katalog|каталог|поиск/iu.test(text)) return 12;
  if (/cart|checkout|savat|корзин|оформлени/iu.test(text)) return 12;
  if (/seller.*(?:workspace|cabinet)|kabinet|кабинет продавца|inventory|остатк/iu.test(text)) return 10;
  if (/order|заказ|buyurtma|tracking|отслеживан/iu.test(text)) return 9;
  if (/admin|management workspace|рабочее место|boshqaruv/iu.test(text)) return 9;
  if (/product (?:selection|card)|выбор товара|карточк/iu.test(text)) return 8;
  if (/seller.*onboarding|подключение продавца|verification/iu.test(text)) return 8;
  if (/commission|settlement|комисси|расчёт/iu.test(text)) return 7;
  if (/risk|support|dispute|возврат|спор|модерац/iu.test(text)) return 7;
  if (/account|auth|profile|учётн|регистрац|akkaunt/iu.test(text)) return 6;
  if (/analytics|report|finance|отчётност|аналитик/iu.test(text)) return 6;
  return 5;
}

function functionPriceRows(project = {}) {
  const tasks = taskListRows(project);
  const budget = roundMoney(project.budget_usd);
  const currencyStatus = String(project.grounded_brief?.budget?.currency?.status || project.currency_status || "unknown").toLowerCase();
  // An explicitly stated budget with an explicit currency yields a weighted
  // planning allocation: approximate per-function amounts (never uniform)
  // that reconcile exactly to the client's own figure. Without an explicit
  // currency the costs stay honestly unknown.
  const allocate = budget > 0 && currencyStatus === "explicit" && tasks.length >= 2;
  let amounts = [];
  if (allocate) {
    const weights = tasks.map((row) => functionBudgetWeight(row[1], row[2]));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    amounts = weights.map((weight) => Math.round((budget * weight) / totalWeight / 100) * 100);
    const drift = budget - amounts.reduce((sum, value) => sum + value, 0);
    amounts[amounts.length - 1] += drift;
    if (amounts.some((value) => value <= 0)) amounts = [];
  }
  return tasks.map((row, index) => ({
    epic: row[0],
    feature: row[1],
    detail: row[2],
    phase: row[3],
    priority: index < 4 ? "P0" : index < 8 ? "P1" : "P2",
    price: amounts.length ? amounts[index] : null,
    costModel: amounts.length
      ? { formula: "budget_share_by_weight", weight: functionBudgetWeight(row[1], row[2]), basisAmount: budget }
      : undefined,
    truthStatus: amounts.length ? "assumed" : "unknown",
    sourceIds: [],
    derivationRuleId: amounts.length ? "FUNCTION-BUDGET-ALLOCATION-SCENARIO-V1" : null,
  }));
}

function swotRows(project = {}, research = {}) {
  const topPlatform = projectPlatforms(project)[0] || projectType(project);
  const integrations = projectIntegrations(project);
  const locale = project.grounded_brief?.sourceLanguage || "en";
  if (locale === "uz-Latn") return [
    ["Strength", `${topPlatform} uchun tavsiya scope, jamoa ssenariysi, muddat va qabul bosqichlari bir hujjatda ko‘rsatilgan.`],
    ["Weakness", "Biznes qoidalari, katalog egasi va mijoz tomondagi qaror egalari hali tasdiqlanmagan."],
    ["Opportunity", research.marketResearch?.trends?.[0] || "Raqamli jarayonlar qo‘lda bajariladigan operatsiyalarni kamaytirishi mumkin."],
    ["Threat", integrations.length ? `Tashqi provayderga bog‘liqlik: ${integrations.slice(0, 3).join(", ")}.` : "Mijoz qarorlarining kechikishi, scope o‘zgarishi va sekin qabul jarayoni release muddatiga ta’sir qiladi."],
  ];
  if (locale === "ru") return [
    ["Strength", `Рекомендуемый scope, сценарий команды, срок и этапы приёмки для ${topPlatform} собраны в одном документе.`],
    ["Weakness", "Бизнес-правила, владелец каталога и ответственные за решения со стороны клиента ещё не подтверждены."],
    ["Opportunity", research.marketResearch?.trends?.[0] || "Цифровые процессы могут сократить объём ручных операций."],
    ["Threat", integrations.length ? `Зависимость от внешних провайдеров: ${integrations.slice(0, 3).join(", ")}.` : "Задержка клиентских решений, изменение scope и медленная приёмка могут повлиять на срок запуска."],
  ];
  return [
    ["Strength", `${topPlatform} recommended scope is packaged with a team scenario, timeline, and acceptance milestones.`],
    ["Weakness", "Business rules, catalog ownership, and client-side decision owners must be confirmed."],
    ["Opportunity", research.marketResearch?.trends?.[0] || "Digital workflow automation can reduce manual operations."],
    ["Threat", integrations.length ? `Third-party dependency risk: ${integrations.slice(0, 3).join(", ")}.` : "Delayed client decisions, scope change, and slow acceptance can delay release."],
  ];
}

function buildBrandProfile(research = {}, themeTokens = {}) {
  const first = research.brandProfiles?.find((item) => !item.error) || {};
  const colorLabels = [themeTokens.brand, themeTokens.brandDeep, ...(first.colors || [])].filter(Boolean).slice(0, 6);
  const fonts = first.fonts?.length ? first.fonts : ["Brand/site font not confirmed"];
  const text = `${first.title || ""} ${first.description || ""} ${(first.h1 || []).join(" ")}`;
  const tone = /premium|luxury|enterprise|bank|finance/i.test(text)
    ? "premium corporate"
    : /market|shop|commerce|delivery|mobile/i.test(text)
      ? "product-led commercial"
      : "clean corporate";
  return {
    url: first.url || research.links?.brandUrls?.[0] || "",
    title: first.title || hostLabel(first.url || research.links?.brandUrls?.[0] || ""),
    description: first.description || "",
    colors: colorLabels,
    fonts,
    tone,
    sourceStatus: first.error ? `Brand source failed: ${first.error}` : first.url ? "Brand/site profile collected" : "Brand source not provided",
  };
}

function buildProblemStatement(project = {}, research = {}) {
  const pain = research.callInsights?.pains?.[0] || "";
  if (pain) return safeText(pain, 260);
  const type = projectType(project).toLowerCase();
  return `${project.title} needs a ${type} that turns scattered manual operations into a controlled product flow with clear roles, analytics and launch milestones.`;
}

function buildHistoricalStyleGuide(references = []) {
  const combined = references
    .map((item) => `${item.text || item.insight || ""} ${(item.linkInsights || []).map((link) => link.text || "").join(" ")}`)
    .join(" ")
    .toLowerCase();
  const rules = [
    "Commercial proposal must sell the solution and delivery confidence, not show a raw research log.",
    "Udevs advantages, ownership, integrations, security, scalability and support should be folded into relevant pages.",
    "Scope, team cost, project price and payment stages must reconcile arithmetically.",
  ];
  if (/инфраструкт|infrastructure|server|api|license|лиценз/i.test(combined)) {
    rules.push("Infrastructure, licenses and third-party APIs stay separate from development price.");
  }
  if (/подпис|signature|заказчик|исполнитель/i.test(combined)) {
    rules.push("Acceptance and responsibility should be explicit; signatures can be added when contract-ready output is requested.");
  }
  if (/assumption|допущ|не выдум|unknown/i.test(combined)) {
    rules.push("Unknown facts are marked as assumptions instead of being invented.");
  }
  return {
    source: "Internal Udevs proposal guidance",
    referenceCount: 0,
    summary: references.length
      ? "Curated internal proposal guidance was applied without exposing historical/private source data."
      : "Default commercial proposal guidance was applied.",
    rules: rules.slice(0, 6),
  };
}

function buildOrganizationStructure(project = {}, research = {}) {
  const brief = research.groundedBrief || project.grounded_brief || {};
  const requested = new Set(brief.requestedSections || []).has("org_structure");
  const readableSources = (research.marketSources || [])
    .filter((item) => item.topic === "organization" && item.text && !item.error && !isBlockedKpResearchContent(item.text));
  const rootLabel = safeText(
    (readableSources.length ? brief.analog?.name?.value || projectAnalog(project) : null)
    || brief.projectName?.value
    || project.title
    || "Project",
    80,
  );
  const sourceIdForUrl = (url = "") => {
    const canonical = canonicalKpUrl(url);
    return (research.sources || []).find((item) => canonicalKpUrl(item.source || "") === canonical)?.id || "";
  };
  const branchDefinitions = [
    {
      id: "ORG-BRANCH-LEADERSHIP",
      label: "Leadership & governance",
      placeholder: "Leadership roles to confirm",
      signals: [
        ["Executive leadership", /\b(?:executive|leadership)\s+(?:team|group|committee)\b|\bchief executive\b|\bceo\b/i],
        ["Finance", /\bfinance\s+(?:team|function|organization|leadership)\b|\bchief financial officer\b|\bcfo\b/i],
        ["People & culture", /\bpeople\s+(?:team|operations|and culture)\b|\bhuman resources\b|\bchief people officer\b/i],
        ["Legal & governance", /\blegal\s+(?:team|function|department)\b|\bgeneral counsel\b|\bgovernance\b/i],
      ],
    },
    {
      id: "ORG-BRANCH-PRODUCT",
      label: "Product & technology",
      placeholder: "Product and technology roles to confirm",
      signals: [
        ["Product", /\bproduct\s+(?:team|organization|management|leadership)\b|\bchief product officer\b/i],
        ["Engineering", /\bengineering\s+(?:team|organization|leadership|function)\b|\bchief technology officer\b|\bcto\b/i],
        ["Design", /\bdesign\s+(?:team|organization|leadership|function)\b|\bproduct design\b/i],
        ["Data & security", /\bdata\s+(?:team|science|platform)\b|\bsecurity\s+(?:team|organization|function)\b|\bchief information security officer\b/i],
      ],
    },
    {
      id: "ORG-BRANCH-OPERATIONS",
      label: "Commercial & operations",
      placeholder: "Commercial and operations roles to confirm",
      signals: [
        ["Operations", /\boperations\s+(?:team|organization|leadership|function)\b|\bchief operating officer\b|\bcoo\b/i],
        ["Sales & partnerships", /\bsales\s+(?:team|organization|leadership|function)\b|\bpartnerships?\s+(?:team|organization|function)\b/i],
        ["Marketing", /\bmarketing\s+(?:team|organization|leadership|function)\b|\bchief marketing officer\b/i],
        ["Customer support", /\bcustomer\s+(?:support|success|service)\s+(?:team|organization|function)\b|\bsupport team\b/i],
      ],
    },
  ];
  const evidenceSentence = (text = "", pattern) => String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\s*[|•]\s*/)
    .map((sentence) => sentence.trim())
    .find((sentence) => sentence.length >= 24 && sentence.length <= 520 && pattern.test(sentence)) || "";
  const branches = branchDefinitions.map((branch) => {
    const children = [];
    for (const [label, pattern] of branch.signals) {
      const matches = readableSources
        .map((source) => ({ source, excerpt: evidenceSentence(source.text, pattern) }))
        .filter((row) => row.excerpt && sourceIdForUrl(row.source.url));
      if (!matches.length) continue;
      children.push({
        id: `${branch.id}-${children.length + 1}`,
        label,
        detail: "Public source mention; exact reporting line is not asserted.",
        truthStatus: matches.length > 1 ? "verified" : "single_source",
        sourceIds: [...new Set(matches.map((row) => sourceIdForUrl(row.source.url)).filter(Boolean))],
        evidenceExcerpt: safeText(matches[0].excerpt, 360),
      });
      if (children.length >= 3) break;
    }
    if (!children.length) {
      const proposedLabels = brief.sourceLanguage === "uz-Latn"
        ? branch.id === "ORG-BRANCH-LEADERSHIP"
          ? ["Rahbariyat", "Moliya"]
          : branch.id === "ORG-BRANCH-PRODUCT"
            ? ["Mahsulot", "Dasturiy ishlab chiqish", "Dizayn"]
            : ["Operatsiyalar", "Hamkorlik va savdo", "Mijozlar yordami"]
        : brief.sourceLanguage === "ru"
          ? branch.id === "ORG-BRANCH-LEADERSHIP"
            ? ["Руководство", "Финансы"]
            : branch.id === "ORG-BRANCH-PRODUCT"
              ? ["Продукт", "Разработка", "Дизайн"]
              : ["Операции", "Продажи и партнёрства", "Поддержка клиентов"]
          : branch.id === "ORG-BRANCH-LEADERSHIP"
            ? ["Leadership", "Finance"]
            : branch.id === "ORG-BRANCH-PRODUCT"
              ? ["Product", "Engineering", "Design"]
              : ["Operations", "Partnerships", "Customer support"];
      children.push(...proposedLabels.map((label, index) => ({
        id: `${branch.id}-PROPOSED-${index + 1}`,
        label,
        detail: brief.sourceLanguage === "uz-Latn"
          ? "Tavsiya etilgan loyiha funksiyasi; mas’ul va hisobot chizig‘i mijoz bilan tasdiqlanadi."
          : brief.sourceLanguage === "ru"
            ? "Рекомендуемая функция проекта; ответственный и линия подчинения согласуются с клиентом."
            : "Recommended project function; owner and reporting line are confirmed with the client.",
        truthStatus: "recommended",
        sourceIds: [],
        derivationRuleId: "ORG-PROJECT-OPERATING-MODEL-V1",
      })));
    }
    return {
      id: branch.id,
      label: branch.label,
      truthStatus: "recommended",
      sourceIds: [...new Set(children.flatMap((child) => child.sourceIds || []))],
      derivationRuleId: "ORG-PUBLIC-FUNCTION-GROUPING-V1",
      children,
    };
  });
  const groundedLeafCount = branches.flatMap((branch) => branch.children).filter((child) => child.sourceIds.length).length;
  // Without readable public evidence the page presents the client platform's
  // role structure (administration / partner roles / customer roles) derived
  // from the product domain, anchored to the client's own organization name.
  if (!groundedLeafCount) return buildPlatformRoleOrganization(project, research, { requested });
  const sourceIds = [...new Set(branches.flatMap((branch) => branch.sourceIds || []))];
  return {
    mode: "grounded_public_org",
    status: "partial",
    requested,
    rootLabel,
    truthStatus: "single_source",
    sourceIds,
    relationshipStatus: "grouping_recommended",
    disclosure: "Publicly mentioned functions are grouped for orientation; exact reporting lines remain unconfirmed.",
    branches,
  };
}

function clientOrganizationLabel(project = {}, brief = {}) {
  // Only the client's own site names the organization; a product analog
  // (e.g. Shopify) must never become the org-chart root.
  const url = brief.brandReference?.url?.value || "";
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    const name = host.split(".")[0];
    if (name && name.length >= 3) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch { /* no client URL in the brief */ }
  return safeText(brief.projectName?.value || project.title || "Organization", 80);
}

function buildPlatformRoleOrganization(project = {}, research = {}, { requested = false } = {}) {
  const brief = research.groundedBrief || project.grounded_brief || {};
  const locale = brief.sourceLanguage === "uz-Latn" ? "uz" : brief.sourceLanguage === "ru" ? "ru" : "en";
  const category = `${brief.productCategory?.value || ""} ${projectType(project)} ${project.title || ""}`;
  const domain = /food\s*delivery|restaurant|courier/i.test(category)
    ? "food_delivery"
    : /marketplace|e-?commerce|маркетплейс/iu.test(category)
      ? "marketplace"
      : "internal";
  const copyByLocale = {
    ru: {
      admin: "Администрация",
      adminRoles: [["Админ", "Управление платформой и каталогом"], ["Поддержка", "Обращения и инциденты пользователей"]],
      marketplace: [
        ["Продавцы", [["Юр. лица", "Магазины и официальные бренды"], ["Физ. лица", "Самозанятые продавцы"]]],
        ["Покупатели", [["Физ. лица", "Розничные покупатели"], ["Юр. лица", "Корпоративные заказы"]]],
      ],
      food_delivery: [
        ["Партнёры", [["Рестораны", "Меню, доступность и приём заказов"], ["Курьеры", "Доставка и статусы заказов"]]],
        ["Клиенты", [["Физ. лица", "Заказ и отслеживание доставки"]]],
      ],
      internal: [
        ["Сотрудники", [["Менеджеры", "Операционные процессы и отчётность"], ["Операторы", "Ежедневные рабочие задачи"]]],
        ["Клиенты", [["Физ. лица", "Клиентские запросы и сервис"], ["Юр. лица", "Корпоративные клиенты"]]],
      ],
      detail: "Роль пользователей платформы; состав согласуется с клиентом.",
      disclosure: "Показана рекомендуемая ролевая структура платформы клиента; это предложение проекта, а не утверждение о внутренней структуре компании.",
    },
    uz: {
      admin: "Administratsiya",
      adminRoles: [["Admin", "Platforma va katalog boshqaruvi"], ["Yordam xizmati", "Foydalanuvchi murojaatlari va insidentlar"]],
      marketplace: [
        ["Sotuvchilar", [["Yuridik shaxslar", "Do‘konlar va rasmiy brendlar"], ["Jismoniy shaxslar", "O‘zini o‘zi band qilgan sotuvchilar"]]],
        ["Xaridorlar", [["Jismoniy shaxslar", "Chakana xaridorlar"], ["Yuridik shaxslar", "Korporativ buyurtmalar"]]],
      ],
      food_delivery: [
        ["Hamkorlar", [["Restoranlar", "Menyu, mavjudlik va buyurtma qabul qilish"], ["Kuryerlar", "Yetkazib berish va buyurtma holatlari"]]],
        ["Mijozlar", [["Jismoniy shaxslar", "Buyurtma va yetkazib berishni kuzatish"]]],
      ],
      internal: [
        ["Xodimlar", [["Menejerlar", "Operatsion jarayonlar va hisobotlar"], ["Operatorlar", "Kundalik ish vazifalari"]]],
        ["Mijozlar", [["Jismoniy shaxslar", "Mijoz so‘rovlari va servis"], ["Yuridik shaxslar", "Korporativ mijozlar"]]],
      ],
      detail: "Platforma foydalanuvchilari roli; tarkibi mijoz bilan kelishiladi.",
      disclosure: "Mijoz platformasining tavsiya etilgan rol tuzilmasi ko‘rsatilgan; bu loyiha taklifi bo‘lib, kompaniyaning ichki tuzilmasi haqidagi da’vo emas.",
    },
    en: {
      admin: "Administration",
      adminRoles: [["Admin", "Platform and catalog management"], ["Support", "User requests and incidents"]],
      marketplace: [
        ["Sellers", [["Legal entities", "Stores and official brands"], ["Individuals", "Self-employed sellers"]]],
        ["Buyers", [["Individuals", "Retail buyers"], ["Legal entities", "Corporate orders"]]],
      ],
      food_delivery: [
        ["Partners", [["Restaurants", "Menu, availability and order acceptance"], ["Couriers", "Delivery and order statuses"]]],
        ["Customers", [["Individuals", "Ordering and delivery tracking"]]],
      ],
      internal: [
        ["Employees", [["Managers", "Operational processes and reporting"], ["Operators", "Daily working tasks"]]],
        ["Customers", [["Individuals", "Client requests and service"], ["Legal entities", "Corporate clients"]]],
      ],
      detail: "Platform user role; the exact set is confirmed with the client.",
      disclosure: "The chart shows the recommended role structure of the client's platform; it is a project proposal, not a claim about the company's internal structure.",
    },
  };
  const copy = copyByLocale[locale];
  const role = (branchId, index, [label, detail]) => ({
    id: `${branchId}-ROLE-${index + 1}`,
    label,
    detail: detail || copy.detail,
    truthStatus: "recommended",
    sourceIds: [],
    derivationRuleId: "ORG-PLATFORM-ROLE-MODEL-V1",
  });
  const branchRows = [
    [copy.admin, copy.adminRoles],
    ...copy[domain],
  ];
  const branches = branchRows.slice(0, 3).map(([label, roles], branchIndex) => {
    const id = `ORG-PLATFORM-BRANCH-${branchIndex + 1}`;
    return {
      id,
      label,
      truthStatus: "recommended",
      sourceIds: [],
      derivationRuleId: "ORG-PLATFORM-ROLE-MODEL-V1",
      children: roles.slice(0, 3).map((row, index) => role(id, index, row)),
    };
  });
  return {
    mode: "proposed_role_model",
    status: "proposed",
    requested,
    rootLabel: clientOrganizationLabel(project, brief),
    truthStatus: "recommended",
    sourceIds: [],
    relationshipStatus: "grouping_recommended",
    derivationRuleId: "ORG-PLATFORM-ROLE-MODEL-V1",
    disclosure: copy.disclosure,
    branches,
  };
}

function buildClientDependencies(project = {}) {
  return (project.client_requirements?.length ? project.client_requirements : buildClientDataRows(project.title || "", project.blockers || []))
    .slice(0, 10)
    .map((row, index) => {
      const label = safeText(row.name || row.label || row.dependency || `Client input ${index + 1}`, 140);
      const detail = safeText(row.detail || row.description || "", 220);
      const text = `${label} ${detail}`.toLowerCase();
      const category = /integration|api|credential|payment|provider|gateway/.test(text)
        ? "integrations"
        : /server|host|cloud|domain|dns|access|platform/.test(text)
          ? "access"
          : "ownership";
      const timing = category === "integrations"
        ? "before_integration"
        : /test|accept|uat|qabul|при[её]м/.test(text)
          ? "before_acceptance"
          : "before_kickoff";
      return {
        id: `CLIENT-DEPENDENCY-${String(index + 1).padStart(3, "0")}`,
        category,
        label,
        detail,
        status: row.status || row.readiness || row.state || "to_confirm",
        owner: safeText(row.owner || row.responsible || row.accountable || "", 100),
        timing,
        truthStatus: "recommended",
        sourceIds: [],
        derivationRuleId: "CLIENT-DEPENDENCY-READINESS-V1",
      };
    });
}

function buildKpProposalModel(project = {}, question = "", research = {}, themeTokens = {}) {
  const functionPrice = functionPriceRows(project);
  const teamPlan = normalizedEstimateRows(project);
  const payments = paymentScheduleRows(project);
  const developmentTotal = sumMoney(functionPrice, "price");
  const paymentTotal = sumMoney(payments, "amount");
  const brandProfile = buildBrandProfile(research, themeTokens);
  const marketSizing = buildTamSamSom(project, research);
  const groundedBrief = research.groundedBrief || project.grounded_brief || null;
  const groundedBudget = groundedBrief?.budget || {};
  const groundedBudgetAmount = Number(groundedBudget.amount?.value);
  const hasGroundedBudgetAmount = Number.isFinite(groundedBudgetAmount) && groundedBudgetAmount > 0;
  const groundedBudgetCurrency = String(groundedBudget.currency?.value || "").trim().toUpperCase();
  const groundedBudgetCurrencyStatus = String(groundedBudget.currency?.status || "unknown").toLowerCase();
  const hasExplicitGroundedCurrency = hasGroundedBudgetAmount
    && groundedBudgetCurrencyStatus === "explicit"
    && /^[A-Z]{3}$/.test(groundedBudgetCurrency)
    && groundedBudgetCurrency !== "XXX";
  // The client brief is the authority for a stated budget. This projection is
  // deliberately independent from project selection so a routing regression
  // cannot mix an explicit client currency with a historical project's values.
  // Assumed or missing currencies remain canonically unknown until confirmed.
  const projectedBudgetAmount = hasGroundedBudgetAmount
    ? roundMoney(groundedBudgetAmount)
    : roundMoney(project.budget_usd);
  const projectedBudgetCurrency = hasGroundedBudgetAmount
    ? hasExplicitGroundedCurrency ? groundedBudgetCurrency : "XXX"
    : project.currency || "XXX";
  const projectedBudgetCurrencyStatus = hasGroundedBudgetAmount
    ? hasExplicitGroundedCurrency ? "explicit" : "unknown"
    : project.currency_status || "unknown";
  const projectedBudgetAmountTruthStatus = hasGroundedBudgetAmount
    ? groundedBudget.amount?.status || "explicit"
    : project.budget_original?.amount ? "explicit" : "unknown";
  const model = {
    schemaVersion: "2.0",
    brief: {
      projectName: project.title,
      prompt: promptBrief(question),
      type: projectType(project),
      analog: projectAnalog(project),
      duration: durationLabel(project.duration_months),
      locale: research.groundedBrief?.sourceLanguage || "uz-Latn",
    },
    groundedBrief,
    callInsights: research.callInsights,
    brandProfile,
    marketResearch: research.marketResearch,
    organizationStructure: buildOrganizationStructure(project, research),
    researchStatus: research.researchStatus || research.marketResearch?.researchStatus || { status: "unavailable", evidenceLevel: "limited" },
    analogResearch: (research.analogResearch || []).map((item) => {
      const blocked = Boolean(item.error) || isBlockedKpResearchContent(item.text);
      return {
        title: item.title || hostLabel(item.url),
        url: item.url,
        insight: blocked
          ? "The requested analogue page was not readable; use it only as a named reference until a readable source is available."
          : safeText(item.text, 260),
        truthStatus: blocked ? "unknown" : "single_source",
        sourceIds: [],
        researchStatus: blocked ? "blocked" : "readable",
        scopeEffect: "validate",
      };
    }).slice(0, 6),
    historicalKpReferences: [],
    historicalStyleGuide: buildHistoricalStyleGuide(research.historicalKpReferences || []),
    problemStatement: buildProblemStatement(project, research),
    tamSamSom: marketSizing,
    market: marketSizing,
    scope: taskListRows(project),
    functionPrice,
    teamPlan,
    pricing: {
      developmentTotal,
      projectPrice: 0,
      budgetAmount: projectedBudgetAmount,
      budgetCurrency: projectedBudgetCurrency,
      budgetCurrencyStatus: projectedBudgetCurrencyStatus,
      currency: projectedBudgetCurrency,
      currencyStatus: projectedBudgetCurrencyStatus,
      // A client-stated budget is a factual constraint, not a project quote.
      amountKind: "unknown",
      amountTruthStatus: "unknown",
      budgetAmountTruthStatus: projectedBudgetAmountTruthStatus,
      commercialStatus: "budget_to_quote",
      infraExternal: infrastructureRows(project),
      exclusions: ["Third-party API fees", "Hosting usage growth", "Hardware if not listed", "Paid ad/media budget"],
    },
    payments,
    roadmap: developmentTimelineTable(project),
    swot: swotRows(project, research),
    clientDependencies: buildClientDependencies(project),
    sources: research.sources || [],
    validation: {
      // A weighted budget-allocation scenario reconciles the function subtotal
      // to the stated budget; the locked project price itself stays 0.
      functionPriceMatchesProject: developmentTotal === 0 || developmentTotal === projectedBudgetAmount,
      paymentsMatchProject: payments.length === 0
        ? true
        : paymentTotal === projectedBudgetAmount || paymentTotal === developmentTotal,
      budgetSeparatedFromProjectPrice: projectedBudgetAmount > 0 && (developmentTotal === 0 || developmentTotal === projectedBudgetAmount),
      sourceCount: (research.sources || []).length,
      readableResearchSourceCount: (research.sources || []).filter((item) => /research|profile|extract|transcript/i.test(item.type || "") && /read|profiled|extracted|transcribed/i.test(item.status || "")).length,
      blockedResearchSourceCount: [...(research.analogResearch || []), ...(research.marketSources || [])].filter((item) => item.error || isBlockedKpResearchContent(item.text)).length,
      sourceIdsUnique: new Set((research.sources || []).map((item) => item.id).filter(Boolean)).size === (research.sources || []).length,
    },
  };
  return model;
}

function topEntries(obj = {}, limit = 6) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function kpiRows(project) {
  const blockers = project.blocker_count;
  const scope = project.scope_count;
  const budget = Number(project.budget_usd) || 0;
  const duration = Number(project.duration_months) || 0;
  return [
    ["Readiness", `${Math.round(project.readiness_score)}%`, blockers ? `${blockers} client blockers` : "No critical blockers"],
    ["Scope", `${scope} items`, `${topEntries(project.scope_by_epic, 1)[0]?.name || "General"} is biggest block`],
    ["Budget", fmtUsd(budget), `${fmtNumber(duration)} months delivery window`],
    ["Complexity", `${Math.round(project.complexity_score)}%`, `${Object.keys(project.scope_by_epic || {}).length} epic groups`],
    ["KP priority", `${Math.round(project.kpi_score)}%`, project.kpi_score >= 75 ? "High commercial priority" : project.kpi_score >= 55 ? "Medium priority" : "Needs qualification"],
  ];
}

function buildKpiNarrative(project) {
  const topScope = topEntries(project.scope_by_epic, 5);
  const topRoles = [...project.estimate].sort((a, b) => b.total - a.total).slice(0, 6);
  return {
    title: project.title,
    summary: [
      ["Budget", fmtUsd(project.budget_usd)],
      ["Duration", durationLabel(project.duration_months)],
      ["Scope", `${project.scope_count} items`],
      ["Client blockers", `${project.blocker_count}`],
      ["KP score", `${Math.round(project.kpi_score)}%`],
    ],
    insight:
      project.blocker_count >= 12
        ? "Client-side dependencies are the main KP risk. Close access and integration blockers before fixing deadline KP."
        : project.complexity_score >= 75
          ? "Scope complexity is the main KP driver. Split delivery into demo milestones and protect acceptance criteria."
          : "Project is commercially clean enough for KP tracking. Focus on plan/fact, demo acceptance, and payment discipline.",
    kpis: kpiRows(project),
    scope: topScope,
    roles: topRoles,
    blockers: project.blockers.slice(0, 12),
    payments: project.payments.slice(0, 8),
    guarantees: project.guarantees.slice(0, 8),
    competitive: project.competitive.slice(0, 8),
  };
}

function makeTable(headers, rows, options = {}) {
  return `
    <table class="${options.compact ? "compact" : ""}">
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? "")}</td>`).join("")}</tr>`)
        .join("")}</tbody>
    </table>`;
}

function extractAnalogName(question = "", benchmark = null) {
  if (benchmark?.title) return benchmark.title;
  const url = extractReferenceUrl(question);
  const match = question.match(/(?:analog|аналог|o'xshash|uxshash|pohozhe|похоже|like|kak|как)\s+([^,.;\n]{3,80})/i);
  const raw = match?.[1]?.trim() || "";
  const candidate = raw || url;
  if (candidate) {
    try {
      const parsed = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
      const host = parsed.hostname.replace(/^www\./i, "").split(".")[0];
      if (host) return host.charAt(0).toUpperCase() + host.slice(1);
    } catch {
      const cleaned = stripReferenceUrl(candidate)
        .replace(/\b(?:budget|budjet|duration|timeline|scope)\b[\s\S]*$/i, "")
        .replace(/^[\s:.,;\-]+|[\s:.,;\-]+$/g, "")
        .trim();
      if (cleaned) return cleaned;
    }
  }
  return "Analog not specified";
}

function promptBrief(question = "") {
  return stripReferenceUrl(question)
    .replace(/\s+/g, " ")
    .replace(/\b(KP premium pdf qil)\s+\1\b/gi, "$1")
    .replace(/\b(KPI premium pdf qil)\s+\1\b/gi, "$1")
    .trim();
}

function projectAnalog(project) {
  return project.analog || project.competitive?.[0]?.competitor || "Analog not specified";
}

function richMetricCards(project) {
  return [
    ["Budget", fmtUsd(project.budget_usd), "commercial size"],
    ["Timeline", `${fmtNumber(project.duration_months)} mo`, "delivery window"],
    ["Scope", `${project.scope_count} items`, "MVP blocks"],
    ["Readiness", `${Math.round(project.readiness_score)}%`, "start quality"],
    ["KP score", `${Math.round(project.kpi_score)}%`, "priority"],
  ];
}

function scopeRows(project, limit = 12) {
  const rows = (project.scope || []).slice(0, limit).map((item, index) => [
    String(index + 1).padStart(2, "0"),
    item.subtask || item.task || item.epic || "Scope item",
    item.epic || "Core product",
    item.status || "planned",
  ]);
  if (rows.length) return rows;
  return topEntries(project.scope_by_epic, limit).map((item, index) => [
    String(index + 1).padStart(2, "0"),
    item.name,
    "Scope group",
    `${item.count} items`,
  ]);
}

function roadmapRows(project) {
  const duration = Math.max(1, Math.ceil(Number(project.duration_months) || 3));
  const items = (project.scope || []).map((item) => item.subtask || item.task || item.epic).filter(Boolean);
  const rows = [];
  for (let month = 1; month <= Math.min(duration, 6); month += 1) {
    const slice = items.filter((_, index) => index % duration === month - 1).slice(0, 3);
    rows.push([
      `M${month}`,
      month === 1 ? "Discovery + architecture" : month === duration ? "Release + stabilization" : "Build + demo",
      slice.length ? slice.join(", ") : "Core delivery stream",
      month === duration ? "Production ready" : "Accepted sprint demo",
    ]);
  }
  return rows;
}

function richKpiRows(project) {
  return [
    ["Commercial", `${Math.round(project.commercial_score)}%`, "Budget, benchmark and payment discipline", "Milestone invoice paid on time"],
    ["Delivery", `${Math.round(project.complexity_score)}%`, "Scope complexity, integrations and team load", "Weekly plan/fact >= 90%"],
    ["Readiness", `${Math.round(project.readiness_score)}%`, "Client blockers, access and approvals", "No critical blocker before sprint"],
    ["Quality", "Target", "Critical bugs, regression and release stability", "0 blocker bugs before release"],
    ["Acceptance", "Target", "Demo approval, signed scope and handover", "Client accepts each milestone"],
  ];
}

function acceptanceRows(project) {
  return [
    ["Scope freeze", "MVP boundary, modules and acceptance criteria approved"],
    ["Demo rhythm", "Weekly demo with signed feedback and next sprint scope"],
    ["Data/access", project.blocker_count ? "Close all listed client blockers before deadline KP starts" : "Keep credentials and production access under control"],
    ["Release quality", "QA checklist passed, production monitoring enabled, rollback plan ready"],
    ["Payment discipline", "Each payment milestone tied to visible delivery result"],
  ];
}

function richTable(headers, rows, className = "") {
  return `
    <div class="table-shell">
      <table class="${className}">
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function kpiTone(score) {
  const value = Number(score) || 0;
  if (value >= 78) return "good";
  if (value >= 60) return "warn";
  return "bad";
}

function scoreRing(label, score, hint) {
  const value = Math.round(Number(score) || 0);
  return `
    <div class="score-card ${kpiTone(value)}">
      <div class="ring" style="--p:${value}"><strong>${value}<small>%</small></strong></div>
      <div>
        <h3>${escapeHtml(label)}</h3>
        <p>${escapeHtml(hint)}</p>
      </div>
    </div>`;
}

function kpiThemeCss(theme = "flat") {
  const themes = {
    stripe: `
      body.theme-stripe .slide { background: #F8FAFC; border-left: 26px solid #2D5C5F; }
      body.theme-stripe .slide::after { content: ""; position: absolute; inset: 0 0 auto 0; height: 22px; background: #1F2A44; }
      body.theme-stripe .slide > * { position: relative; z-index: 1; }
    `,
    diagonal: `
      body.theme-diagonal .slide { background: #F7F8FA; }
      body.theme-diagonal .slide::after { content: ""; position: absolute; right: 0; top: 0; width: 46%; height: 100%; background: #E9EEF3; clip-path: polygon(20% 0, 100% 0, 100% 100%, 0 100%); z-index: 0; }
      body.theme-diagonal .slide > :not(.footer) { position: relative; z-index: 1; }
      body.theme-diagonal .footer { z-index: 1; }
      body.theme-diagonal h1, body.theme-diagonal h2, body.theme-diagonal h3 { color: #172033; }
      body.theme-diagonal .kicker, body.theme-diagonal .tag { color: #365C63; }
      body.theme-diagonal .lead, body.theme-diagonal .body-text, body.theme-diagonal .small-note, body.theme-diagonal .footer { color: #5C6675; }
      body.theme-diagonal .hero-panel, body.theme-diagonal .card, body.theme-diagonal table { border-color: #DDE4EA; }
      body.theme-diagonal .hero-panel, body.theme-diagonal .card { border-radius: 18px; }
      body.theme-diagonal .spec-list, body.theme-diagonal table { border-radius: 16px; }
      body.theme-diagonal .tag, body.theme-diagonal .pill { background: #FFFFFF; border-color: #DDE4EA; color: #172033; }
      body.theme-diagonal .card.blue, body.theme-diagonal .metric-card.hot, body.theme-diagonal .step:nth-child(1), body.theme-diagonal th { background: #172033; color: #FFFFFF; border-color: #172033; }
      body.theme-diagonal .card.green, body.theme-diagonal .metric-card.teal, body.theme-diagonal .step:nth-child(2) { background: #365C63; color: #FFFFFF; border-color: #365C63; }
      body.theme-diagonal .card.blue h3, body.theme-diagonal .card.green h3, body.theme-diagonal .card.darkcard h3, body.theme-diagonal .card.blue .body-text, body.theme-diagonal .card.green .body-text, body.theme-diagonal .card.darkcard .body-text, body.theme-diagonal .metric-card.hot .label, body.theme-diagonal .metric-card.hot .hint, body.theme-diagonal .metric-card.teal .label, body.theme-diagonal .metric-card.teal .hint, body.theme-diagonal .step:nth-child(1) .label, body.theme-diagonal .step:nth-child(1) .step-meta, body.theme-diagonal .step:nth-child(2) .label, body.theme-diagonal .step:nth-child(2) .step-meta { color: #FFFFFF; }
      body.theme-diagonal .card.warm, body.theme-diagonal .metric-card.amber, body.theme-diagonal .step:nth-child(3), body.theme-diagonal .step:nth-child(4), body.theme-diagonal .step:nth-child(5) { background: #FFFFFF; border-color: #DDE4EA; }
      body.theme-diagonal .spec-row:nth-child(1), body.theme-diagonal .spec-row:nth-child(2), body.theme-diagonal .spec-row:nth-child(3), body.theme-diagonal .spec-row:nth-child(4), body.theme-diagonal .spec-row:nth-child(5) { background: #F8FAFC; }
      body.theme-diagonal tr:nth-child(even) td, body.theme-diagonal tr:nth-child(3n) td { background: #F8FAFC; }
    `,
    "navy-band": `
      body.theme-navy-band .slide { background: #F8FAFC; }
      body.theme-navy-band .slide::after { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 158px; background: #1F2A44; }
      body.theme-navy-band .slide > * { position: relative; z-index: 1; }
      body.theme-navy-band .kicker { color: #FFFFFF; }
      body.theme-navy-band .section-head h2 { margin-top: 58px; }
      body.theme-navy-band .tag { background: #FFFFFF; }
    `,
    "warm-paper": `
      body.theme-warm-paper .slide { background: #FBF8F1; }
      body.theme-warm-paper .slide::after { content: ""; position: absolute; left: 112px; right: 112px; bottom: 92px; height: 10px; background: #D8C4B6; }
      body.theme-warm-paper .slide > * { position: relative; z-index: 1; }
      body.theme-warm-paper .kicker, body.theme-warm-paper .tag { color: #46615D; }
      body.theme-warm-paper .tag, body.theme-warm-paper .spec-row:nth-child(1), body.theme-warm-paper .step:nth-child(3) { background: #F2E9DC; }
      body.theme-warm-paper .card.warm, body.theme-warm-paper .metric-card.amber { background: #F2E9DC; border-color: #D8C4B6; }
    `,
    "mint-frame": `
      body.theme-mint-frame .slide { background: #F7FBFA; border: 18px solid #D7E9E7; }
      body.theme-mint-frame .slide::after { content: ""; position: absolute; left: 64px; right: 64px; top: 64px; bottom: 64px; border: 2px solid #D7E9E7; border-radius: 34px; pointer-events: none; }
      body.theme-mint-frame .slide > * { position: relative; z-index: 1; }
      body.theme-mint-frame .tag, body.theme-mint-frame .spec-row:nth-child(1), body.theme-mint-frame .step:nth-child(3) { background: #E9F5F3; }
    `,
    "oldmoney-green": `
      body.theme-oldmoney-green .slide { background: #12352F; color: #F7F1E5; }
      body.theme-oldmoney-green .slide::after { content: ""; position: absolute; left: 86px; right: 86px; top: 70px; bottom: 70px; border: 2px solid #C6A15B; pointer-events: none; }
      body.theme-oldmoney-green .slide > * { position: relative; z-index: 1; }
      body.theme-oldmoney-green h1, body.theme-oldmoney-green h2, body.theme-oldmoney-green h3 { color: #F7F1E5; }
      body.theme-oldmoney-green .lead, body.theme-oldmoney-green .body-text, body.theme-oldmoney-green .small-note, body.theme-oldmoney-green .footer { color: #DCD4C4; }
      body.theme-oldmoney-green .kicker, body.theme-oldmoney-green .tag { color: #D8B766; }
      body.theme-oldmoney-green .tag, body.theme-oldmoney-green .pill { background: #F7F1E5; color: #12352F; border-color: #C6A15B; }
      body.theme-oldmoney-green .hero-panel, body.theme-oldmoney-green .card, body.theme-oldmoney-green table { background: #F7F1E5; color: #17211F; border-color: #C6A15B; }
      body.theme-oldmoney-green .card h3, body.theme-oldmoney-green .card .body-text, body.theme-oldmoney-green td { color: #17211F; }
      body.theme-oldmoney-green th, body.theme-oldmoney-green .card.blue, body.theme-oldmoney-green .card.green, body.theme-oldmoney-green .card.darkcard, body.theme-oldmoney-green .metric-card.hot, body.theme-oldmoney-green .metric-card.teal, body.theme-oldmoney-green .step:nth-child(1), body.theme-oldmoney-green .step:nth-child(2) { background: #0C2925; color: #F7F1E5; border-color: #C6A15B; }
    `,
    "oldmoney-burgundy": `
      body.theme-oldmoney-burgundy .slide { background: #4A171E; color: #F8F0E3; }
      body.theme-oldmoney-burgundy .slide::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 26px; background: #B28B49; }
      body.theme-oldmoney-burgundy .slide > * { position: relative; z-index: 1; }
      body.theme-oldmoney-burgundy h1, body.theme-oldmoney-burgundy h2, body.theme-oldmoney-burgundy h3 { color: #F8F0E3; }
      body.theme-oldmoney-burgundy .lead, body.theme-oldmoney-burgundy .body-text, body.theme-oldmoney-burgundy .small-note, body.theme-oldmoney-burgundy .footer { color: #E5D6BF; }
      body.theme-oldmoney-burgundy .kicker, body.theme-oldmoney-burgundy .tag { color: #D8B766; }
      body.theme-oldmoney-burgundy .tag, body.theme-oldmoney-burgundy .pill { background: #F8F0E3; color: #4A171E; border-color: #B28B49; }
      body.theme-oldmoney-burgundy .hero-panel, body.theme-oldmoney-burgundy .card, body.theme-oldmoney-burgundy table { background: #F8F0E3; color: #261416; border-color: #B28B49; }
      body.theme-oldmoney-burgundy .card h3, body.theme-oldmoney-burgundy .card .body-text, body.theme-oldmoney-burgundy td { color: #261416; }
      body.theme-oldmoney-burgundy th, body.theme-oldmoney-burgundy .card.blue, body.theme-oldmoney-burgundy .card.green, body.theme-oldmoney-burgundy .card.darkcard, body.theme-oldmoney-burgundy .metric-card.hot, body.theme-oldmoney-burgundy .metric-card.teal, body.theme-oldmoney-burgundy .step:nth-child(1), body.theme-oldmoney-burgundy .step:nth-child(2) { background: #341016; color: #F8F0E3; border-color: #B28B49; }
    `,
    "oldmoney-navy": `
      body.theme-oldmoney-navy .slide { background: #101B2D; color: #F5EBDD; }
      body.theme-oldmoney-navy .slide::after { content: ""; position: absolute; left: 112px; right: 112px; top: 74px; height: 12px; background: #B99A5B; }
      body.theme-oldmoney-navy .slide > * { position: relative; z-index: 1; }
      body.theme-oldmoney-navy h1, body.theme-oldmoney-navy h2, body.theme-oldmoney-navy h3 { color: #F5EBDD; }
      body.theme-oldmoney-navy .lead, body.theme-oldmoney-navy .body-text, body.theme-oldmoney-navy .small-note, body.theme-oldmoney-navy .footer { color: #D9D0C0; }
      body.theme-oldmoney-navy .kicker, body.theme-oldmoney-navy .tag { color: #D8B766; }
      body.theme-oldmoney-navy .tag, body.theme-oldmoney-navy .pill { background: #F5EBDD; color: #101B2D; border-color: #B99A5B; }
      body.theme-oldmoney-navy .hero-panel, body.theme-oldmoney-navy .card, body.theme-oldmoney-navy table { background: #F5EBDD; color: #152033; border-color: #B99A5B; }
      body.theme-oldmoney-navy .card h3, body.theme-oldmoney-navy .card .body-text, body.theme-oldmoney-navy td { color: #152033; }
      body.theme-oldmoney-navy th, body.theme-oldmoney-navy .card.blue, body.theme-oldmoney-navy .card.green, body.theme-oldmoney-navy .card.darkcard, body.theme-oldmoney-navy .metric-card.hot, body.theme-oldmoney-navy .metric-card.teal, body.theme-oldmoney-navy .step:nth-child(1), body.theme-oldmoney-navy .step:nth-child(2) { background: #0B1424; color: #F5EBDD; border-color: #B99A5B; }
    `,
    "oldmoney-cream": `
      body.theme-oldmoney-cream .slide { background: #F4EBDD; color: #223026; border-top: 18px solid #203A2F; }
      body.theme-oldmoney-cream .slide::after { content: ""; position: absolute; left: 112px; right: 112px; bottom: 82px; height: 8px; background: #B99A5B; }
      body.theme-oldmoney-cream .slide > * { position: relative; z-index: 1; }
      body.theme-oldmoney-cream h1, body.theme-oldmoney-cream h2, body.theme-oldmoney-cream h3 { color: #223026; }
      body.theme-oldmoney-cream .lead, body.theme-oldmoney-cream .body-text, body.theme-oldmoney-cream .small-note, body.theme-oldmoney-cream .footer { color: #5F665D; }
      body.theme-oldmoney-cream .kicker, body.theme-oldmoney-cream .tag { color: #203A2F; }
      body.theme-oldmoney-cream .tag, body.theme-oldmoney-cream .pill { background: #FFFFFF; color: #203A2F; border-color: #B99A5B; }
      body.theme-oldmoney-cream .hero-panel, body.theme-oldmoney-cream .card, body.theme-oldmoney-cream table { background: #FFFDF8; color: #223026; border-color: #D4BE8D; }
      body.theme-oldmoney-cream th, body.theme-oldmoney-cream .card.blue, body.theme-oldmoney-cream .card.green, body.theme-oldmoney-cream .card.darkcard, body.theme-oldmoney-cream .metric-card.hot, body.theme-oldmoney-cream .metric-card.teal, body.theme-oldmoney-cream .step:nth-child(1), body.theme-oldmoney-cream .step:nth-child(2) { background: #203A2F; color: #FFFDF8; border-color: #B99A5B; }
    `,
    "coolors-steel": `
      body.theme-coolors-steel .slide { background: #E0E1DD; color: #0D1B2A; }
      body.theme-coolors-steel .slide::after { content: ""; position: absolute; right: 0; top: 0; width: 44%; height: 100%; background: #D7DBDE; clip-path: polygon(18% 0, 100% 0, 100% 100%, 0 100%); z-index: 0; }
      body.theme-coolors-steel .slide > :not(.footer) { position: relative; z-index: 1; }
      body.theme-coolors-steel .footer { z-index: 1; }
      body.theme-coolors-steel h1, body.theme-coolors-steel h2, body.theme-coolors-steel h3 { color: #0D1B2A; }
      body.theme-coolors-steel .kicker, body.theme-coolors-steel .tag { color: #415A77; }
      body.theme-coolors-steel .lead, body.theme-coolors-steel .body-text, body.theme-coolors-steel .small-note, body.theme-coolors-steel .footer { color: #415A77; }
      body.theme-coolors-steel .hero-panel, body.theme-coolors-steel .card, body.theme-coolors-steel table { background: #F8FAFC; border-color: #C8CED5; }
      body.theme-coolors-steel .tag, body.theme-coolors-steel .pill { background: #F8FAFC; color: #0D1B2A; border-color: #C8CED5; }
      body.theme-coolors-steel .card.blue, body.theme-coolors-steel .metric-card.hot, body.theme-coolors-steel .step:nth-child(1), body.theme-coolors-steel th { background: #0D1B2A; color: #FFFFFF; border-color: #0D1B2A; }
      body.theme-coolors-steel .card.green, body.theme-coolors-steel .metric-card.teal, body.theme-coolors-steel .step:nth-child(2) { background: #415A77; color: #FFFFFF; border-color: #415A77; }
      body.theme-coolors-steel .card.blue h3, body.theme-coolors-steel .card.green h3, body.theme-coolors-steel .card.blue .body-text, body.theme-coolors-steel .card.green .body-text, body.theme-coolors-steel .step:nth-child(1) .label, body.theme-coolors-steel .step:nth-child(1) .step-meta, body.theme-coolors-steel .step:nth-child(2) .label, body.theme-coolors-steel .step:nth-child(2) .step-meta { color: #FFFFFF; }
    `,
    "coolors-teal": `
      body.theme-coolors-teal .slide { background: #EDF6F9; color: #17333A; }
      body.theme-coolors-teal .slide::after { content: ""; position: absolute; right: 0; top: 0; width: 45%; height: 100%; background: #D7ECEE; clip-path: polygon(22% 0, 100% 0, 100% 100%, 0 100%); z-index: 0; }
      body.theme-coolors-teal .slide > :not(.footer) { position: relative; z-index: 1; }
      body.theme-coolors-teal .footer { z-index: 1; }
      body.theme-coolors-teal h1, body.theme-coolors-teal h2, body.theme-coolors-teal h3 { color: #17333A; }
      body.theme-coolors-teal .kicker, body.theme-coolors-teal .tag { color: #006D77; }
      body.theme-coolors-teal .lead, body.theme-coolors-teal .body-text, body.theme-coolors-teal .small-note, body.theme-coolors-teal .footer { color: #51656B; }
      body.theme-coolors-teal .hero-panel, body.theme-coolors-teal .card, body.theme-coolors-teal table { background: #FFFFFF; border-color: #C9DFE2; }
      body.theme-coolors-teal .tag, body.theme-coolors-teal .pill { background: #FFFFFF; color: #17333A; border-color: #C9DFE2; }
      body.theme-coolors-teal .card.blue, body.theme-coolors-teal .metric-card.hot, body.theme-coolors-teal .step:nth-child(1), body.theme-coolors-teal th { background: #006D77; color: #FFFFFF; border-color: #006D77; }
      body.theme-coolors-teal .card.green, body.theme-coolors-teal .metric-card.teal, body.theme-coolors-teal .step:nth-child(2) { background: #83C5BE; color: #17333A; border-color: #83C5BE; }
      body.theme-coolors-teal .card.blue h3, body.theme-coolors-teal .card.blue .body-text, body.theme-coolors-teal .step:nth-child(1) .label, body.theme-coolors-teal .step:nth-child(1) .step-meta { color: #FFFFFF; }
      body.theme-coolors-teal .card.green h3, body.theme-coolors-teal .card.green .body-text, body.theme-coolors-teal .step:nth-child(2) .label, body.theme-coolors-teal .step:nth-child(2) .step-meta { color: #17333A; }
    `,
    "coolors-mineral": `
      body.theme-coolors-mineral .slide { background: #F6F7F8; color: #1D2633; }
      body.theme-coolors-mineral .slide::after { content: ""; position: absolute; right: 0; top: 0; width: 40%; height: 100%; background: #DCE5E8; clip-path: polygon(16% 0, 100% 0, 100% 100%, 0 100%); z-index: 0; }
      body.theme-coolors-mineral .slide > :not(.footer) { position: relative; z-index: 1; }
      body.theme-coolors-mineral .footer { z-index: 1; }
      body.theme-coolors-mineral h1, body.theme-coolors-mineral h2, body.theme-coolors-mineral h3 { color: #1D2633; }
      body.theme-coolors-mineral .kicker, body.theme-coolors-mineral .tag { color: #52796F; }
      body.theme-coolors-mineral .lead, body.theme-coolors-mineral .body-text, body.theme-coolors-mineral .small-note, body.theme-coolors-mineral .footer { color: #5E6875; }
      body.theme-coolors-mineral .hero-panel, body.theme-coolors-mineral .card, body.theme-coolors-mineral table { background: #FFFFFF; border-color: #D6DEE3; }
      body.theme-coolors-mineral .tag, body.theme-coolors-mineral .pill { background: #FFFFFF; color: #1D2633; border-color: #D6DEE3; }
      body.theme-coolors-mineral .card.blue, body.theme-coolors-mineral .metric-card.hot, body.theme-coolors-mineral .step:nth-child(1), body.theme-coolors-mineral th { background: #2F3E46; color: #FFFFFF; border-color: #2F3E46; }
      body.theme-coolors-mineral .card.green, body.theme-coolors-mineral .metric-card.teal, body.theme-coolors-mineral .step:nth-child(2) { background: #52796F; color: #FFFFFF; border-color: #52796F; }
      body.theme-coolors-mineral .card.blue h3, body.theme-coolors-mineral .card.green h3, body.theme-coolors-mineral .card.blue .body-text, body.theme-coolors-mineral .card.green .body-text, body.theme-coolors-mineral .step:nth-child(1) .label, body.theme-coolors-mineral .step:nth-child(1) .step-meta, body.theme-coolors-mineral .step:nth-child(2) .label, body.theme-coolors-mineral .step:nth-child(2) .step-meta { color: #FFFFFF; }
    `,
    "coolors-graphite": `
      body.theme-coolors-graphite .slide { background: #F8F9FA; color: #212529; }
      body.theme-coolors-graphite .slide::after { content: ""; position: absolute; right: 0; top: 0; width: 44%; height: 100%; background: #E9ECEF; clip-path: polygon(20% 0, 100% 0, 100% 100%, 0 100%); z-index: 0; }
      body.theme-coolors-graphite .slide > :not(.footer) { position: relative; z-index: 1; }
      body.theme-coolors-graphite .footer { z-index: 1; }
      body.theme-coolors-graphite h1, body.theme-coolors-graphite h2, body.theme-coolors-graphite h3 { color: #212529; }
      body.theme-coolors-graphite .kicker, body.theme-coolors-graphite .tag { color: #495057; }
      body.theme-coolors-graphite .lead, body.theme-coolors-graphite .body-text, body.theme-coolors-graphite .small-note, body.theme-coolors-graphite .footer { color: #6C757D; }
      body.theme-coolors-graphite .hero-panel, body.theme-coolors-graphite .card, body.theme-coolors-graphite table { background: #FFFFFF; border-color: #DEE2E6; }
      body.theme-coolors-graphite .tag, body.theme-coolors-graphite .pill { background: #FFFFFF; color: #212529; border-color: #DEE2E6; }
      body.theme-coolors-graphite .card.blue, body.theme-coolors-graphite .metric-card.hot, body.theme-coolors-graphite .step:nth-child(1), body.theme-coolors-graphite th { background: #212529; color: #FFFFFF; border-color: #212529; }
      body.theme-coolors-graphite .card.green, body.theme-coolors-graphite .metric-card.teal, body.theme-coolors-graphite .step:nth-child(2) { background: #495057; color: #FFFFFF; border-color: #495057; }
      body.theme-coolors-graphite .card.blue h3, body.theme-coolors-graphite .card.green h3, body.theme-coolors-graphite .card.blue .body-text, body.theme-coolors-graphite .card.green .body-text, body.theme-coolors-graphite .step:nth-child(1) .label, body.theme-coolors-graphite .step:nth-child(1) .step-meta, body.theme-coolors-graphite .step:nth-child(2) .label, body.theme-coolors-graphite .step:nth-child(2) .step-meta { color: #FFFFFF; }
    `,
  };
  return themes[theme] || "";
}

function svgRing(value, label = "SCORE", size = "lg", toneOverride = "") {
  const score = clamp(Math.round(Number(value) || 0), 0, 100);
  const large = size === "lg";
  const box = large ? 220 : 160;
  const radius = large ? 86 : 64;
  const stroke = large ? 16 : 13;
  const center = box / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  return `
    <div class="svg-ring ${toneOverride || kpiTone(score)} ${large ? "ring-lg" : "ring-sm"}">
      <svg viewBox="0 0 ${box} ${box}" aria-hidden="true">
        <circle class="ring-track" cx="${center}" cy="${center}" r="${radius}" fill="none" stroke-width="${stroke}" />
        <circle class="ring-value" cx="${center}" cy="${center}" r="${radius}" fill="none" stroke-width="${stroke}"
          stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
          transform="rotate(-90 ${center} ${center})" />
      </svg>
      <div class="ring-center"><strong>${score}<small>%</small></strong><span>${escapeHtml(label)}</span></div>
    </div>`;
}

function brandBar(percent, extraClass = "") {
  const width = clamp(Math.round(Number(percent) || 0), 0, 100);
  return `<span class="bar ${extraClass}"><i style="width:${width}%"></i></span>`;
}

function pageHeader(section, pageNumber, badge, totalPages = 9) {
  return `
    <header class="slide-head ${slugify(section)}">
      <div>
        <div class="kicker"><span></span>${escapeHtml(section)}</div>
        <h2>${escapeHtml(pageTitles[section] || section)}</h2>
      </div>
      <div class="head-side">
        <div class="page-num">${String(pageNumber).padStart(2, "0")} / ${String(totalPages).padStart(2, "0")}</div>
        <div class="badge">${escapeHtml(badge)}</div>
      </div>
    </header>`;
}

function pageFooter(text) {
  return `<footer class="slide-foot"><span>${escapeHtml(text)}</span><span>ASADBEK AI · UDEVS KP</span></footer>`;
}

const pageTitles = {
  "COVER": "Commercial proposal.",
  "PROJECT OVERVIEW": "What we understood and what we propose.",
  "UDEVS ADVANTAGES": "Why this delivery model is reliable.",
  "PROJECT TASKS": "Main epics and tasks for delivery.",
  "CLIENT REQUIREMENTS": "Data and approvals expected from client.",
  "FUNCTIONAL SCOPE": "Functional blocks that define MVP delivery.",
  "INFRASTRUCTURE": "Infrastructure and third-party cost assumptions.",
  "TEAM ESTIMATE": "Role plan and cost structure.",
  "PAYMENT SCHEDULE": "Payment terms tied to delivery milestones.",
  "DEVELOPMENT STAGES": "Delivery plan by milestone.",
  "RISKS AND ASSUMPTIONS": "What must be controlled before delivery starts.",
  "SIGNATURES": "Commercial acceptance block.",
  "BENCHMARK CONTEXT": "Commercial and benchmark context for decision making.",
};

function projectType(project = {}) {
  const declaredCategory = String(
    project.grounded_brief?.productCategory?.value
    || project.groundedBrief?.productCategory?.value
    || project.category
    || project.type
    || "",
  );
  if (/\berp\b|enterprise\s+resource\s+planning/i.test(declaredCategory)) return "ERP / operations platform";
  if (/e-?commerce|online\s+store|internet\s+shop/i.test(declaredCategory)) return "E-commerce product";
  if (/marketplace/i.test(declaredCategory)) return "Marketplace product";
  if (/\bcrm\b|customer\s+relationship/i.test(declaredCategory)) return "CRM / operations platform";
  if (/fintech|bnpl|finance|bank/i.test(declaredCategory)) return "Fintech product";
  const text = `${project.title || ""} ${(project.scope || []).map((item) => item.subtask || item.epic || "").join(" ")}`;
  if (/restaurant|restoran|courier|kuryer|food\s*delivery|yandex\s*eats|express24|wolt/i.test(text)) return "Food delivery marketplace";
  if (/cashback|cash back|loyalty|bonus|reward|wallet|merchant|partner|payout|reconciliation/i.test(text)) return "Cashback / loyalty product";
  if (/\berp\b|enterprise\s+resource\s+planning|procurement|inventory|warehouse/i.test(text)) return "ERP / operations platform";
  if (/e-?commerce|online\s+store|internet\s+shop|интернет[- ]?магазин/i.test(text)) return "E-commerce product";
  if (/marketplace|buyer|vendor|seller/i.test(text)) return "Marketplace product";
  if (/\bcrm\b|sales\s+pipeline|lead\s+management|customer\s+relationship/i.test(text)) return "CRM / operations platform";
  if (/\btms\b|transport\s+management|fleet|shipment|dispatch|logistic/i.test(text)) return "TMS / logistics platform";
  if (/mobile|ios|android|app/i.test(text)) return "Mobile product";
  if (/website|site|web/i.test(text)) return "Web product";
  return "Custom software product";
}

function guaranteeRows(project = {}) {
  const source = (project.guarantees || [])
    .map((item) => [item.name, item.description])
    .filter((row) => row[0] && row[1]);
  const fallback = [
    ["Dedicated delivery team", "PM, UX/UI, engineering and QA work as one delivery stream."],
    ["Weekly demo rhythm", "Client receives visible progress and accepts each milestone before moving forward."],
    ["Transparent commercial control", "Scope, budget and payment milestones stay visible during delivery."],
    ["Release readiness", "QA, monitoring and handover are included in the delivery model."],
  ];
  return (source.length ? source : fallback).slice(0, 4);
}

function clientRequirementRows(project = {}) {
  const blockerRows = (project.blockers || []).slice(0, 3).map((item) => [item.name, item.status]);
  return [
    ["Project owner", "One responsible decision maker for scope, demos and acceptance."],
    ["Access and integrations", "Server, API, payment, SMS, CRM and other third-party access before implementation sprint."],
    ["Design and content approval", "Brand materials, texts and UX flow feedback should be confirmed on schedule."],
    ...blockerRows,
    ["Payment discipline", "Each payment milestone is connected to a visible delivery result."],
  ].slice(0, 6);
}

function overviewCards(project = {}) {
  const topScope = topEntries(project.scope_by_epic, 3);
  return [
    ["Product type", projectType(project), "The proposal is shaped around the product category and delivery risk."],
    ["MVP boundary", `${project.scope_count} scope items`, `${topScope.map((item) => item.name).join(", ") || "Core product"} define the first delivery boundary.`],
    ["Delivery window", durationLabel(project.duration_months), "Roadmap is split into discovery, build/demo and release readiness."],
  ];
}

function riskAssumptionRows(project = {}) {
  const blockers = (project.blockers || []).slice(0, 3).map((item) => [item.name, item.status]);
  return [
    ["Scope freeze", "MVP boundary, modules and acceptance criteria must be approved before active development."],
    ["Integration dependency", "Third-party API limitations or delayed credentials can move delivery dates."],
    ["Acceptance rhythm", "Weekly demos require signed feedback and clear next sprint scope."],
    ...blockers,
    ["Change requests", "Out-of-scope requests are estimated separately after discovery or sprint review."],
  ].slice(0, 6);
}

function benchmarkRows(project = {}, portfolioProjects = []) {
  const rows = [];
  if (projectAnalog(project) && !/not specified/i.test(projectAnalog(project))) {
    rows.push(["Analog / benchmark", projectAnalog(project), "Used as context for product expectations and scope density."]);
  }
  rows.push(
    ["This proposal", fmtUsd(project.budget_usd), `${durationLabel(project.duration_months)} / ${project.scope_count} scope items`],
    ["Commercial position", `${Math.round(project.kpi_score)}% fit`, "Internal helper score based on budget, readiness and complexity."],
  );
  for (const item of portfolioProjects.filter((p) => p.key !== project.key).slice(0, 5)) {
    rows.push([item.title, fmtUsd(item.budget_usd), `${durationLabel(item.duration_months)} / ${item.scope_count} scope items`]);
  }
  return rows.slice(0, 8);
}

function projectPlatforms(project = {}) {
  const text = `${project.title || ""} ${(project.scope || []).map((item) => `${item.subtask || ""} ${item.epic || ""}`).join(" ")}`;
  const platforms = [];
  if (/admin|cabinet|dashboard|crm|erp/i.test(text)) platforms.push("Admin web");
  if (/mobile|ios|android|app|patient|courier|student/i.test(text)) platforms.push("Mobile app");
  if (/website|websitye|websayt|web\s*site|site|сайт/i.test(text)) platforms.push("Website");
  else if (/\b(?:web\s+platform|platform|portal|cabinet)\b/i.test(text)) platforms.push("Web platform");
  if (/telegram|bot/i.test(text)) platforms.push("Telegram bot");
  if (/api|integration/i.test(text)) platforms.push("API layer");
  return [...new Set(platforms)].slice(0, 5).length ? [...new Set(platforms)].slice(0, 5) : ["Web platform", "Admin panel", "API layer"];
}

function projectIntegrations(project = {}) {
  const items = (project.scope || [])
    .map((item) => item.subtask || item.task || item.epic || "")
    .filter((item) => /api|integration|payment|payme|click|stripe|sms|telegram|bot|firebase|smtp|map|calendar|ai|crm/i.test(item));
  const blockers = (project.blockers || [])
    .map((item) => item.name)
    .filter((item) => /api|integration|provider|gateway|payment|sms|telegram|firebase|smtp|map|calendar|bank/i.test(item))
    .filter((item) => !/rules|ownership|policy|commercial model|catalog ownership/i.test(item));
  const merged = [...items, ...blockers]
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return [...new Set(merged)].slice(0, 6);
}

function valueCards(project = {}) {
  const type = projectType(project);
  const values = [
    ["Control", "Single source of truth for project operations, users and reports.", project.readiness_score || 75],
    ["Automation", "Manual actions move into clear product workflows and notifications.", project.complexity_score || 70],
    ["Launch speed", `${durationLabel(project.duration_months)} roadmap keeps MVP delivery visible.`, clamp(100 - (Number(project.duration_months) || 3) * 6, 45, 90)],
  ];
  if (/CRM/i.test(type)) values[0] = ["Sales control", "Leads, clients, tasks and reporting move into one operating flow.", project.readiness_score || 75];
  if (/Mobile/i.test(type)) values[1] = ["Mobile access", "Core scenarios become available for field users and customers.", project.complexity_score || 70];
  if (/Marketplace/i.test(type)) values[1] = ["Two-sided flow", "Buyer, seller and moderation scenarios are split into controllable modules.", project.complexity_score || 70];
  return values;
}

function moduleGroups(project = {}, limit = 6) {
  const grouped = new Map();
  for (const item of project.scope || []) {
    const key = item.epic || scopeGroupForItem(item.subtask || item.task || "");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item.subtask || item.task || key);
  }
  if (!grouped.size) {
    for (const item of topEntries(project.scope_by_epic, limit)) grouped.set(item.name, [`${item.count} functions`]);
  }
  return [...grouped.entries()]
    .map(([name, items]) => ({ name, items: [...new Set(items)].slice(0, 3), count: items.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function moduleCards(project) {
  const modules = moduleGroups(project, 6);
  return `
    <div class="scope-list-shell card">
      <div class="scope-list-head">
        <div>
          <div class="micro">MVP scope</div>
          <h3>${escapeHtml(String(project.scope_count || modules.reduce((sum, item) => sum + item.count, 0)))} functional items</h3>
        </div>
        <div class="scope-total mono">${escapeHtml(durationLabel(project.duration_months))}</div>
      </div>
      <div class="scope-list">
      ${modules.map((module, index) => `
        <div class="scope-list-row">
          <div class="scope-index mono">${String(index + 1).padStart(2, "0")}</div>
          <div>
            <h3>${escapeHtml(module.name)}</h3>
            <p>${module.items.map((item) => escapeHtml(item)).join(" · ")}</p>
          </div>
          <div class="scope-list-count mono">${escapeHtml(String(module.count))} items</div>
        </div>`).join("")}
      </div>
    </div>`;
}

function platformCode(label = "") {
  if (/admin/i.test(label)) return "ADM";
  if (/mobile|app/i.test(label)) return "APP";
  if (/website|web/i.test(label)) return "WEB";
  if (/api/i.test(label)) return "API";
  if (/telegram|bot/i.test(label)) return "BOT";
  return "SYS";
}

function platformIconSvg(label = "") {
  const type = platformCode(label);
  const paths = {
    ADM: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M7 9h4M7 13h7M16 9h1"/>',
    APP: '<rect x="7" y="2.75" width="10" height="18.5" rx="2.4"/><path d="M10 18h4"/>',
    WEB: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.4 3.2 5.2 3.2 8.5s-1 6.1-3.2 8.5M12 3.5C9.8 5.9 8.8 8.7 8.8 12s1 6.1 3.2 8.5"/>',
    API: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
    BOT: '<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 7V4M9 12h.01M15 12h.01M9 16h6"/>',
    SYS: '<path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3z"/><path d="M12 8v8M8 10.5l4 2.5 4-2.5"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[type] || paths.SYS}</svg>`;
}

function overviewPlatformGrid(project) {
  const platforms = projectPlatforms(project);
  const facts = [
    ["Budget", fmtUsd(project.budget_usd), "development total"],
    ["Timeline", durationLabel(project.duration_months), "delivery window"],
    ["Scope", `${project.scope_count} items`, "MVP boundary"],
  ];
  return `
    <div class="overview-platform-grid">
      <div class="card platform-panel">
        <div class="micro">Platforms</div>
        <div class="platform-icon-list">
          ${platforms.map((item) => `
            <div class="platform-icon-row">
              <span class="platform-icon">${platformIconSvg(item)}</span>
              <div><h3>${escapeHtml(item)}</h3><p>${escapeHtml(platformHint(item))}</p></div>
            </div>`).join("")}
        </div>
      </div>
      <div class="card overview-facts-panel">
        <div class="micro">Commercial facts</div>
        <div class="overview-facts">
          ${facts.map((item) => `
            <div class="overview-fact-row">
              <span>${escapeHtml(item[0])}</span>
              <strong class="mono">${escapeHtml(item[1])}</strong>
              <small>${escapeHtml(item[2])}</small>
            </div>`).join("")}
        </div>
      </div>
      <div class="card dark-panel overview-decision-panel">
        <div class="micro">Delivery decision</div>
        <h3>${escapeHtml(projectType(project))}</h3>
        <p class="body">${escapeHtml(deliveryDecisionText(project))}</p>
      </div>
    </div>`;
}

function deliveryDecisionText(project = {}) {
  const type = projectType(project);
  if (/Cashback/i.test(type)) {
    return `Build customer mobile app, admin panel, partner cabinet, cashback rules and finance reconciliation as one ${durationLabel(project.duration_months)} MVP package.`;
  }
  if (/Marketplace/i.test(type)) {
    return `Build marketplace, admin, mobile and website as one MVP package with a ${durationLabel(project.duration_months)} release plan.`;
  }
  if (/Mobile/i.test(type)) {
    return `Build mobile product, backend API, admin workspace and release pipeline as one ${durationLabel(project.duration_months)} MVP package.`;
  }
  return `Build the core product, admin workspace, backend services and acceptance roadmap as one ${durationLabel(project.duration_months)} MVP package.`;
}

function platformHint(label = "") {
  if (/admin/i.test(label)) return "management and moderation workspace";
  if (/mobile|app/i.test(label)) return "customer-facing mobile scenarios";
  if (/website|web/i.test(label)) return "public storefront and product pages";
  if (/api/i.test(label)) return "backend service and integrations";
  if (/telegram|bot/i.test(label)) return "messaging automation";
  return "project system component";
}

function projectGoalRows(project = {}) {
  const modules = moduleGroups(project, 8);
  const fallback = [
    ["1", "Launch MVP product", "Working MVP with core user, admin and reporting flows"],
    ["2", "Automate operations", "Reduce manual work and centralize product management"],
    ["3", "Prepare for scale", "Architecture ready for new modules and integrations"],
  ];
  const rows = modules.flatMap((module, index) =>
    module.items.map((item) => [
      String(index + 1),
      item,
      goalResultForItem(item, module.name),
    ]),
  );
  return (rows.length ? rows : fallback).slice(0, 6);
}

function goalResultForItem(item = "", epic = "") {
  const text = `${item} ${epic}`;
  if (/cashback|campaign|offer|rule/i.test(text)) return "Cashback campaigns can be created, limited, activated and monitored";
  if (/merchant|partner/i.test(text)) return "Partner operations can be managed from cabinet/admin workflows";
  if (/wallet|balance|payout|withdrawal/i.test(text)) return "User balance, payout requests and history are visible and controllable";
  if (/fraud|duplicate|dispute|reversal|adjustment/i.test(text)) return "Risk cases and manual corrections are controlled by operations team";
  if (/reconciliation|finance|gmv|export/i.test(text)) return "Finance team can compare transactions, cashback accrual and payouts";
  if (/marketplace/i.test(text)) return "Buyer and seller flow ready for MVP launch";
  if (/admin|analytics|dashboard/i.test(text)) return "Management, moderation and reporting available in admin workspace";
  if (/mobile|app/i.test(text)) return "Mobile user scenarios available for iOS/Android scope";
  if (/website|site|web/i.test(text)) return "Public web presence and storefront flow available";
  if (/payment|payme|click/i.test(text)) return "Payment flow integrated and ready for test transactions";
  return "Functional block delivered and accepted in sprint demo";
}

function techStackRows(project = {}) {
  const platforms = projectPlatforms(project).join(" ");
  const integrations = projectIntegrations(project).join(", ");
  return [
    ["Frontend", /website|web|admin/i.test(platforms) ? "React, Next.js, TypeScript, Tailwind CSS [Assumption]" : "Frontend stack to be confirmed [Assumption]"],
    ["Backend", "Node.js / NestJS, PostgreSQL, REST/GraphQL API [Assumption]"],
    ["Mobile", /mobile/i.test(platforms) ? "Flutter or React Native for iOS/Android [Assumption]" : "Not required unless mobile scope is confirmed"],
    ["DevOps", "Docker, CI/CD, monitoring, staging and production environments [Assumption]"],
    ["Integrations", integrations || "Payment, SMS, maps or CRM providers to be confirmed [Assumption]"],
  ];
}

function projectDocumentPage(project = {}, prompt = "") {
  return `
    <main class="document-page">
      <div class="doc-section">
        <div class="micro">Short description</div>
        <p class="doc-text">${escapeHtml(project.title)} is proposed as a ${escapeHtml(projectType(project).toLowerCase())}. ${escapeHtml(prompt || "Scope is based on client input and will be clarified during discovery.")}</p>
      </div>
      <div class="doc-section">
        <div class="micro">Project goals</div>
        ${richTable(["#", "Goal", "Expected result"], projectGoalRows(project), "document-table")}
      </div>
      <div class="doc-section split-doc">
        <div>
          <div class="micro">Context and industry</div>
          <p class="doc-text">Industry: ${escapeHtml(projectType(project))}. Reference: ${escapeHtml(projectAnalog(project))}. Market context and final business KPIs must be confirmed with the client.</p>
        </div>
        <div>
          <div class="micro">Technology stack</div>
          ${richTable(["Level", "Technologies"], techStackRows(project), "document-table")}
        </div>
      </div>
    </main>`;
}

function snapshotBlock(project) {
  const integrations = projectIntegrations(project);
  return `
    <div class="snapshot-grid">
      <div class="card snapshot-card dark-panel">
        <div class="micro">Project snapshot</div>
        <div class="snapshot-title">${escapeHtml(projectType(project))}</div>
        <p class="body">MVP scope is converted into a commercial proposal with delivery stages, estimate and acceptance rules.</p>
      </div>
      <div class="card snapshot-card">
        <div class="micro">Key integrations</div>
        <div class="chip-list">${integrations.slice(0, 4).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      </div>
    </div>`;
}

function requirementBlocks(project) {
  const rows = clientRequirementRows(project).slice(0, 4);
  return `
    <div class="client-compact-grid">
      <div class="card dark-panel client-focus">
        <div class="micro">Before start</div>
        <div class="blocker-count mono">${escapeHtml(String(project.blocker_count || 0))}</div>
        <p class="body">Critical client-side item must be closed before active sprint delivery.</p>
      </div>
      <div class="card requirement-list-card">
        <div class="micro">Required from client</div>
        <div class="requirement-list">
          ${rows.map((row, index) => `
            <div class="requirement-row">
              <span class="num-chip mono">${String(index + 1).padStart(2, "0")}</span>
              <div><h3>${escapeHtml(row[0])}</h3><p>${escapeHtml(row[1])}</p></div>
            </div>`).join("")}
        </div>
      </div>
    </div>`;
}

function roleCards(project) {
  const rows = normalizedEstimateRows(project).sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0)).slice(0, 6);
  const maxTotal = Math.max(1, ...rows.map((row) => Number(row.total) || 0));
  return `
    <div class="estimate-list-card card">
      <div class="estimate-list-head">
        <div><div class="micro">Role estimate</div><h3>Team structure and budget split</h3></div>
        <strong class="mono">${escapeHtml(fmtUsd(project.budget_usd))}</strong>
      </div>
      <div class="estimate-list">
      ${rows.map((row, index) => `
        <div class="estimate-row">
          <div class="estimate-index mono">${String(index + 1).padStart(2, "0")}</div>
          <div class="estimate-main">
            <h3>${escapeHtml(row.role)}</h3>
            <p>${escapeHtml(fmtNumber(row.qty))} x ${escapeHtml(fmtNumber(row.months))} months</p>
          </div>
          <div class="estimate-indicator">${brandBar(((Number(row.total) || 0) / maxTotal) * 100)}</div>
          <strong class="mono">${escapeHtml(fmtUsd(row.total))}</strong>
        </div>`).join("")}
      </div>
    </div>`;
}

function normalizedEstimateRows(project = {}) {
  const budget = roundMoney(project.budget_usd);
  let rows = [...(project.estimate || [])].filter((row) => row.role && Number(row.total) > 0).map((row) => ({
    role: row.role,
    qty: Number(row.qty) || 1,
    months: Number(row.months) || Number(project.duration_months) || 1,
    rate: roundMoney(row.rate),
    total: roundMoney(row.total),
  }));
  if (!rows.length) {
    rows = allocateTotal(budget || 50_000, [
      { role: "PM / Product Manager", qty: 1, months: Number(project.duration_months) || 3, weight: 12 },
      { role: "Backend Engineer", qty: 1, months: Number(project.duration_months) || 3, weight: 30 },
      { role: "Frontend Engineer", qty: 1, months: Number(project.duration_months) || 3, weight: 20 },
      { role: "QA Engineer", qty: 1, months: Math.max(1, (Number(project.duration_months) || 3) - 0.5), weight: 10 },
      { role: "DevOps / Release Engineer", qty: 0.25, months: Math.max(1, (Number(project.duration_months) || 3) / 2), weight: 5 },
    ]).map((row) => ({ ...row, rate: roundMoney(row.total / Math.max(1, row.qty * row.months)) }));
  }
  const current = sumMoney(rows, "total");
  if (budget > 0 && current !== budget) {
    const diff = budget - current;
    const last = rows[rows.length - 1];
    last.total = Math.max(0, roundMoney(last.total + diff));
    last.rate = roundMoney(last.total / Math.max(1, last.qty * last.months));
  }
  return rows;
}

function paymentScheduleRows(project = {}) {
  const total = roundMoney(project.budget_usd);
  const source = (project.payments || []).filter((item) => Number(item.amount) > 0);
  if (source.length >= 2 && source.length <= 6 && sumMoney(source, "amount") === total) return source;
  return [];
}

function buildBudgetPaymentScenario({ total = 0, currencyStatus = "unknown", durationMonths = 0, locale = "en" } = {}) {
  const amount = roundMoney(total);
  const months = Math.max(1, Math.min(6, Math.round(Number(durationMonths) || 0) || 1));
  if (!(amount > 0) || currencyStatus !== "explicit") return [];
  const ru = locale === "ru";
  const uz = locale === "uz-Latn";
  const prepayment = Math.round((amount * 0.3) / 100) * 100 || Math.round(amount * 0.3);
  const remaining = amount - prepayment;
  if (remaining <= 0) return [];
  // Stages: prepayment, one payment per accepted month (starting with month
  // 2), and a final payment on production release. A 3-month budget therefore
  // splits as 30% + 3 stage payments, mirroring the approved KP skeleton.
  const stageCount = Math.max(1, months);
  const stageBase = Math.floor(remaining / stageCount / 100) * 100;
  const amounts = Array.from({ length: stageCount }, () => stageBase);
  amounts[amounts.length - 1] = remaining - stageBase * (stageCount - 1);
  const stageName = (index) => {
    const monthNumber = index + 2;
    const isFinal = index === stageCount - 1;
    if (isFinal) return uz ? "Yakuniy to‘lov" : ru ? "Финальный платёж" : "Final payment";
    return uz ? `${monthNumber}-oy to‘lovi` : ru ? `Оплата за ${monthNumber}-й месяц` : `Month ${monthNumber} payment`;
  };
  const stageAcceptance = (index) => {
    const demoMonth = index + 1;
    const isFinal = index === stageCount - 1;
    if (isFinal) return uz ? "Ishlab chiqarish relizi va loyihani topshirishdan keyin" : ru ? "После продакшн-релиза и передачи проекта" : "After production release and handover";
    return uz ? `${demoMonth}-oy demosi qabul qilingandan keyin` : ru ? `После принятого демо ${demoMonth}-го месяца` : `After accepted month ${demoMonth} demo`;
  };
  const rows = [
    {
      name: uz ? "Oldindan to‘lov" : ru ? "Предоплата" : "Prepayment",
      amount: prepayment,
      acceptance: uz ? "Loyiha boshlanishidan oldin" : ru ? "До старта проекта" : "Before project start",
    },
    ...amounts.map((value, index) => ({
      name: stageName(index),
      amount: value,
      acceptance: stageAcceptance(index),
    })),
  ].filter((row) => row.amount > 0);
  if (rows.length < 2 || sumMoney(rows, "amount") !== amount) return [];
  const percentBasisPoints = allocatePaymentPercentBasisPoints(
    rows.map((row, index) => ({ id: `PAY-${String(index + 1).padStart(3, "0")}`, amountMinor: row.amount * 100, order: index + 1 })),
    amount * 100,
  );
  return rows.map((row, index) => ({
    id: `PAY-${String(index + 1).padStart(3, "0")}`,
    name: row.name,
    label: row.name,
    amount: row.amount,
    percent: percentBasisPoints[index] / 100,
    percentBasisPoints: percentBasisPoints[index],
    order: index + 1,
    acceptance: row.acceptance,
    due: row.acceptance,
    truthStatus: "assumed",
    sourceIds: [],
    derivationRuleId: "PAYMENT-BUDGET-SCENARIO-V1",
  }));
}

function infrastructureRows(project = {}) {
  return (project.infrastructure?.length ? project.infrastructure : buildInfrastructureRows(project.title || "")).slice(0, 8);
}

function clientDataRows(project = {}) {
  return (project.client_requirements?.length ? project.client_requirements : buildClientDataRows(project.title || "", project.blockers || [])).slice(0, 8);
}

function assumptionsForProject(project = {}) {
  return (project.assumptions?.length ? project.assumptions : [
    "[Assumption] Client company, contact person and email are not provided.",
    "[Assumption] Infrastructure, licenses and third-party API costs are separate from development cost.",
  ]).slice(0, 7);
}

function risksForProject(project = {}) {
  return (project.risks?.length ? project.risks : buildRiskRows(project.title || "", project.blockers || [])).slice(0, 7);
}

function pricingBlock(project) {
  const development = Number(project.budget_usd) || 0;
  const reserve = Math.round(development * 0.08);
  return `
    <div class="pricing-strip">
      <div><span class="micro">Project total</span><strong class="mono">${escapeHtml(fmtUsd(development))}</strong></div>
      <div><span class="micro">Development</span><strong class="mono">${escapeHtml(fmtUsd(development))}</strong></div>
      <div><span class="micro">Change reserve</span><strong class="mono">${escapeHtml(fmtUsd(reserve))}</strong></div>
    </div>`;
}

function comparisonRows(project = {}) {
  const analog = projectAnalog(project);
  const modules = moduleGroups(project, 4).map((item) => item.name);
  const base = [
    ["MVP scope", "included", /not specified/i.test(analog) ? "not defined" : "benchmark"],
    ["Admin / management", modules.some((item) => /admin|crm|analytics/i.test(item)) ? "included" : "partial", "varies"],
    ["Mobile scenario", modules.some((item) => /mobile/i.test(item)) ? "included" : "partial", "varies"],
    ["Payment / integrations", projectIntegrations(project).length ? "included" : "partial", "varies"],
    ["Analytics / reports", modules.some((item) => /analytics|report/i.test(item)) ? "included" : "partial", "varies"],
  ];
  return base;
}

function marker(value = "") {
  const normalized = String(value).toLowerCase();
  if (/included|yes|full/.test(normalized)) return `<span class="marker yes">yes</span>`;
  if (/partial|varies|benchmark/.test(normalized)) return `<span class="marker partial">partial</span>`;
  return `<span class="marker no">no</span>`;
}

function comparisonTable(project) {
  return `
    <div class="table-shell">
      <table class="comparison-table">
        <thead><tr><th>Feature</th><th>Our proposal</th><th>Analog / market</th></tr></thead>
        <tbody>
          ${comparisonRows(project).map((row) => `
            <tr>
              <td>${escapeHtml(row[0])}</td>
              <td>${marker(row[1])}</td>
              <td>${marker(row[2])}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function strictGuaranteeGrid(project) {
  const rows = guaranteeRows(project);
  return `
    <main class="slide-body">
      <div class="advantage-layout">
        <div class="card dark-panel advantage-hero">
          <div class="micro">Delivery promise</div>
          <h3>Scope, team, roadmap and payment discipline stay visible during the whole project.</h3>
          <p class="body">The proposal is built around accepted milestones, not abstract feature lists.</p>
        </div>
        <div class="card advantage-list-card">
          <div class="micro">Udevs delivery checks</div>
          <div class="advantage-list">
            ${rows.slice(0, 4).map((row, index) => `
              <div class="advantage-row">
                <span class="num-chip mono">${String(index + 1).padStart(2, "0")}</span>
                <div><h3>${escapeHtml(row[0])}</h3><p>${escapeHtml(row[1])}</p></div>
              </div>`).join("")}
          </div>
        </div>
      </div>
    </main>`;
}

function strictTwoColumnTable(leftTitle, leftRows, rightTitle, rightRows) {
  return `
    <main class="payment-grid">
      <div>
        <div class="card payment-card">
          <div class="micro">${escapeHtml(leftTitle)}</div>
          <div class="pay-list">
            ${leftRows.map((row, index) => `
              <div class="pay-row">
                <span><i style="opacity:${index === 0 ? 1 : index === 1 ? .7 : .45}"></i>${escapeHtml(row[0])}</span>
                <b class="mono">${escapeHtml(row[1])}</b>
              </div>`).join("")}
          </div>
        </div>
      </div>
      ${richTable(["Block", "Rule"], rightRows, "risk-table")}
    </main>`;
}

function strictScopeTable(project) {
  const rows = scopeRows(project, 12);
  return `
    <div class="scope-card card">
      <table class="scope-table">
        <thead><tr><th>#</th><th>Scope item</th><th>Block</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td class="mono">${escapeHtml(row[0])}</td>
              <td>${escapeHtml(row[1])}</td>
              <td>${escapeHtml(row[2])}</td>
              <td><span class="status-pill"><i></i>${escapeHtml(row[3])}</span></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function strictKpiTable(project) {
  return `
    <div class="table-shell">
      <table>
        <thead><tr><th>KP area</th><th>Score</th><th>Pass condition</th></tr></thead>
        <tbody>
          ${richKpiRows(project).map((row) => {
            const numeric = Number.parseFloat(String(row[1]));
            const tone = Number.isFinite(numeric) ? kpiTone(numeric) : "target";
            return `
              <tr>
                <td>${escapeHtml(row[0])}</td>
                <td class="mono score-text ${tone}">${escapeHtml(row[1])}</td>
                <td>${escapeHtml(row[3])}</td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function strictCostTable(project) {
  const rows = (project.estimate || []).slice(0, 5);
  const maxTotal = Math.max(1, ...rows.map((row) => Number(row.total) || 0));
  return `
    <div class="table-shell">
      <table class="cost-table">
        <thead><tr><th>Role</th><th>Qty</th><th>Months</th><th>Rate</th><th>Cost</th></tr></thead>
        <tbody>
          ${rows.map((row) => {
            const percent = ((Number(row.total) || 0) / maxTotal) * 100;
            return `
              <tr>
                <td>${escapeHtml(row.role)}</td>
                <td class="mono center">${escapeHtml(fmtNumber(row.qty))}</td>
                <td class="mono center">${escapeHtml(fmtNumber(row.months))}</td>
                <td class="mono">${escapeHtml(fmtUsd(row.rate))}</td>
                <td class="bar-cell">${brandBar(percent)}<span class="mono">${escapeHtml(fmtUsd(row.total))}</span></td>
              </tr>`;
          }).join("")}
          <tr class="total-row"><td colspan="4">Total budget</td><td class="mono">${escapeHtml(fmtUsd(project.budget_usd))}</td></tr>
        </tbody>
      </table>
    </div>`;
}

function strictPortfolioTable(portfolioProjects, main) {
  const rows = portfolioProjects
    .map((project) => ({
      project,
      score: Math.round(project.kpi_score),
      values: [
        project.title,
        fmtUsd(project.budget_usd),
        `${fmtNumber(project.duration_months)} mo`,
        `${project.scope_count}`,
        `${project.blocker_count}`,
      ],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return `
    <div class="table-shell">
      <table class="portfolio-table">
        <thead><tr><th>Project</th><th>Budget</th><th>Dur.</th><th>Scope</th><th>Block.</th><th>KP</th></tr></thead>
        <tbody>
          ${rows.map((row) => {
            const isMain = row.project.key === main.key;
            const tone = kpiTone(row.score);
            return `
              <tr class="${isMain ? "highlight" : ""}">
                <td>${escapeHtml(row.values[0])}${isMain ? `<span class="this-chip">THIS</span>` : ""}</td>
                <td class="mono">${escapeHtml(row.values[1])}</td>
                <td class="mono">${escapeHtml(row.values[2])}</td>
                <td class="mono center">${escapeHtml(row.values[3])}</td>
                <td class="mono center">${escapeHtml(row.values[4])}</td>
                <td class="heat-cell">${brandBar(row.score, tone)}<span class="mono score-text ${tone}">${row.score}%</span></td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function strictPaymentBlock(project) {
  const payments = paymentScheduleRows(project);
  const total = sumMoney(payments, "amount");
  return `
    <div class="card payment-card payment-indicator-card">
      <div class="micro">Payment schedule</div>
      <div class="stacked-bar">
        ${payments.map((item, index) => `<i style="width:${(item.amount / Math.max(1, total)) * 100}%;opacity:${1 - index * .16}"></i>`).join("")}
      </div>
      <div class="pay-list">
        ${payments.map((item, index) => `
          <div class="pay-row">
            <span><i style="background: color-mix(in srgb, var(--brand) ${100 - index * 18}%, #FFFFFF);"></i>${escapeHtml(item.period)}</span>
            <strong class="mono">${escapeHtml(fmtUsd(item.amount))}</strong>
          </div>`).join("")}
      </div>
    </div>`;
}

function fixedAdvantageTable() {
  const rows = [
    ["Full control and ownership", "Full independence from vendor", "YES"],
    ["License restrictions", "No license restrictions", "YES"],
    ["Total cost of ownership", "More efficient in the long run", "YES"],
    ["Customization and unique features", "Flexible product logic for client needs", "YES"],
    ["Technical support dependency", "Flexible and fast support process", "YES"],
    ["Integration issues", "Experience with 20+ integrations in the local market", "YES"],
    ["Security and confidentiality", "High level of data protection", "YES"],
    ["Scalability", "Microservice-ready architecture", "YES"],
    ["99% uptime guarantee", "Stable system operation target", "YES"],
    ["Portfolio", "100+ projects in the local market", "YES"],
    ["Support", "Online support 24/7 as an additional service", "YES"],
  ];
  return richTable(["Parameter", "Description", "Udevs"], rows, "advantage-table");
}

function scopeRequirementTable(project = {}) {
  const rows = (project.scope || []).slice(0, 8).map((item) => [
    item.epic || scopeGroupForItem(item.subtask || ""),
    item.task || taskForScopeItem(item.subtask || ""),
    item.subtask || item.task || "Scope item",
    "Yes",
    item.status || "In scope",
  ]);
  return richTable(["EPIC", "Task", "Subtask", "In scope", "Status"], rows, "scope-detail-table");
}

function infrastructureTable(project = {}) {
  return richTable(
    ["Component", "Type", "Cost", "Periodicity"],
    infrastructureRows(project).map((row) => [row.component, row.type, row.cost, row.period]),
    "infrastructure-table",
  );
}

function clientDataTable(project = {}) {
  return richTable(["Name", "Status"], clientDataRows(project).map((row) => [row.name, `Not ready`]), "client-data-table");
}

function detailedClientDataRows(project = {}) {
  const integrations = projectIntegrations(project);
  return [
    ["Server access", "prod, staging or cloud provider selection", "Not ready"],
    ["Domain and DNS", ".uz / .com domain and DNS settings", "Not ready"],
    ["SMS integration", integrations.find((item) => /sms/i.test(item)) || "Eskiz / PlayMobile [Assumption]", "Not ready"],
    ["Payment integration", integrations.find((item) => /payment|payme|click/i.test(item)) || "Click / Payme [Assumption]", "Not ready"],
    ["Maps / geoservice", "Yandex Maps / Google Maps API key [Assumption]", "Not ready"],
    ["AI / API provider", "OpenAI / Anthropic key if AI scope is confirmed [Assumption]", "Not ready"],
    ["Product Owner", "responsible decision maker and task owner", "Asadbek Bakhodirov"],
    ["Client testing team", "UAT participation and acceptance feedback", "Not ready"],
    ["Design references", "brandbook, logo, UI references and content", "Not ready"],
    ["Weekly demo", "client feedback rhythm by sprint", "Not ready"],
    ["Prepayment 30%", `before development start (${fmtUsd(roundMoney((project.budget_usd || 0) * 0.3))})`, "Not ready"],
  ].slice(0, 11);
}

function clientRequirementsPage(project = {}) {
  return `
    <main class="slide-body">
      <div class="table-shell">
        <table class="client-data-table document-table">
          <thead><tr><th>Name</th><th>Details</th><th>Status</th></tr></thead>
          <tbody>
            ${detailedClientDataRows(project).map((row) => `
              <tr>
                <td>${escapeHtml(row[0])}</td>
                <td>${escapeHtml(row[1])}</td>
                <td>${escapeHtml(row[2])}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </main>`;
}

function teamCostTable(project = {}) {
  const rows = normalizedEstimateRows(project);
  const total = sumMoney(rows, "total");
  return `
    <div class="table-shell">
      <table class="team-cost-table">
        <thead><tr><th>Role</th><th>Qty</th><th>Months</th><th>Rate (USD)</th><th>Amount (USD)</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.role)}</td>
              <td class="mono center">${escapeHtml(fmtNumber(row.qty))}</td>
              <td class="mono center">${escapeHtml(fmtNumber(row.months))}</td>
              <td class="mono money">${escapeHtml(fmtUsd(row.rate))}</td>
              <td class="mono money">${escapeHtml(fmtUsd(row.total))}</td>
            </tr>`).join("")}
          <tr class="total-row"><td>TOTAL</td><td></td><td></td><td></td><td class="mono">${escapeHtml(fmtUsd(total))}</td></tr>
        </tbody>
      </table>
    </div>`;
}

function paymentTable(project = {}) {
  const rows = paymentScheduleRows(project);
  const total = sumMoney(rows, "amount");
  let cumulative = 0;
  return `
    <div class="table-shell payment-detail-shell">
      <table class="payment-detail-table">
        <thead><tr><th>Stage</th><th>Percent</th><th>Amount (USD)</th><th>Due</th></tr></thead>
        <tbody>
          ${rows.map((row, index) => {
            cumulative += Number(row.amount) || 0;
            const progress = Math.min(100, (cumulative / Math.max(1, total)) * 100);
            return `
            <tr>
              <td>${escapeHtml(row.period)}</td>
              <td class="mono center">${escapeHtml(`${row.percent || Math.round((row.amount / total) * 100)}%`)}</td>
              <td class="mono money">
                <span class="payment-amount-wrap">
                  <span class="row-mini-bar"><i style="width:${progress}%;opacity:${1 - index * .1}"></i></span>
                  <b>${escapeHtml(fmtUsd(row.amount))}</b>
                </span>
              </td>
              <td>${escapeHtml(row.due || "By milestone acceptance")}</td>
            </tr>`;
          }).join("")}
          <tr class="total-row"><td colspan="3">Total project amount (USD)</td><td class="mono">${escapeHtml(fmtUsd(total))}</td></tr>
        </tbody>
      </table>
    </div>`;
}

function roleMoneyFocus(project = {}) {
  const rows = normalizedEstimateRows(project);
  const total = sumMoney(rows, "total");
  const maxTotal = Math.max(1, ...rows.map((row) => Number(row.total) || 0));
  const topRoles = rows
    .map((row) => ({ ...row, percent: Math.round((row.total / Math.max(1, total)) * 100) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  return `
    <main class="money-focus-grid">
      <div class="card dark-panel money-hero">
        <div class="micro">Development total</div>
        <strong class="mono">${escapeHtml(fmtUsd(total))}</strong>
        <p class="body">Team rows are balanced to the exact proposal total. Infrastructure and third-party services are not included here.</p>
        <div class="money-line">
          ${rows.map((row, index) => `<i style="width:${(row.total / Math.max(1, total)) * 100}%;opacity:${index === 0 ? 1 : .42 + index * .06}"></i>`).join("")}
        </div>
      </div>
      <div class="card role-money-card">
        <div class="micro">Role budget split</div>
        <div class="money-role-list">
          ${topRoles.map((row) => `
            <div class="money-role-row">
              <div>
                <h3>${escapeHtml(row.role)}</h3>
                <p>${escapeHtml(fmtNumber(row.qty))} x ${escapeHtml(fmtNumber(row.months))} months · ${escapeHtml(fmtUsd(row.rate))}/mo</p>
              </div>
              <div class="money-role-amount">
                <strong class="mono">${escapeHtml(fmtUsd(row.total))}</strong>
                ${brandBar((row.total / maxTotal) * 100)}
              </div>
            </div>`).join("")}
        </div>
      </div>
    </main>`;
}

function infrastructureMoneyFocus(project = {}) {
  const rows = infrastructureRows(project);
  const monthly = rows.reduce((sum, row) => {
    const match = String(row.cost || "").match(/~?\$(\d+(?:[.,]\d+)?)/);
    return /month|monthly/i.test(`${row.cost} ${row.period}`) && match ? sum + Number(match[1].replace(",", ".")) : sum;
  }, 0);
  return `
    <main class="infra-money-grid">
      <div class="card dark-panel infra-hero">
        <div class="micro">Estimated external spend</div>
        <strong class="mono">${escapeHtml(monthly ? `~${fmtUsd(monthly)}/mo` : "[Assumption]")}</strong>
        <p class="body">Infrastructure is separate from the development budget and depends on final traffic, providers and API usage.</p>
      </div>
      <div class="infra-cost-cards">
        ${rows.slice(0, 6).map((row, index) => `
          <div class="card infra-cost-card ${index === 0 ? "highlight" : ""}">
            <div class="micro">${escapeHtml(row.type)}</div>
            <h3>${escapeHtml(row.component)}</h3>
            <strong class="mono">${escapeHtml(row.cost)}</strong>
            <p>${escapeHtml(row.period)}</p>
          </div>`).join("")}
      </div>
    </main>`;
}

function infrastructureEstimateTable(project = {}) {
  const rows = infrastructureRows(project);
  const monthlyTotal = rows.reduce((sum, row) => {
    const match = String(row.cost || "").match(/\$(\d+(?:[.,]\d+)?)/);
    return /month|monthly/i.test(`${row.cost} ${row.period}`) && match ? sum + Number(match[1].replace(",", ".")) : sum;
  }, 0);
  const yearlyTotal = rows.reduce((sum, row) => {
    const match = String(row.cost || "").match(/\$(\d+(?:[.,]\d+)?)/);
    return /year|yearly/i.test(`${row.cost} ${row.period}`) && match ? sum + Number(match[1].replace(",", ".")) : sum;
  }, 0);
  const totalLabel = [
    monthlyTotal ? `${fmtUsd(monthlyTotal)}/month` : "",
    yearlyTotal ? `${fmtUsd(yearlyTotal)}/year` : "",
  ].filter(Boolean).join(" + ") || "$0";
  return `
    <main class="slide-body">
      <div class="table-shell">
        <table class="team-cost-table infra-cost-table">
          <thead><tr><th>Component</th><th>Type</th><th>Periodicity</th><th>Cost</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.component)}</td>
                <td>${escapeHtml(row.type)}</td>
                <td>${escapeHtml(row.period)}</td>
                <td class="mono money infra-cost-value">${escapeHtml(row.cost)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="infra-total-strip">
        <span>Total infrastructure estimate</span>
        <strong class="mono">${escapeHtml(totalLabel)}</strong>
      </div>
    </main>`;
}

function expandedTaskRows(project = {}) {
  const scopeItems = (project.scope || []).map((item) => ({
    epic: item.epic || scopeGroupForItem(item.subtask || item.task || ""),
    task: item.task || taskForScopeItem(item.subtask || item.epic || ""),
    subtask: item.subtask || item.task || item.epic || "Implementation task",
  }));
  const templates = [];
  const has = (pattern) => scopeItems.some((item) => pattern.test(`${item.epic} ${item.task} ${item.subtask}`));
  const isCashbackProduct = has(/cashback|loyalty|bonus|reward|wallet|merchant|partner|payout|reconciliation|fraud|duplicate/i);
  if (isCashbackProduct) {
    templates.push(
      ["Cashback product", "Customer onboarding", "OTP login, profile and KYC-lite fields"],
      ["Cashback product", "Merchant catalog", "Partner categories, offer list and merchant cards"],
      ["Cashback product", "Cashback offer flow", "Campaign details, terms and activation"],
      ["Cashback product", "QR / promo activation", "QR scan or promo code cashback trigger"],
      ["Cashback product", "Transaction tracking", "Purchase event capture and cashback accrual"],
      ["Cashback product", "Wallet balance", "Cashback history, pending and approved balances"],
      ["Admin & analytics", "Admin panel", "Users, merchants, campaigns and permissions"],
      ["Admin & analytics", "Partner cabinet", "Merchant offer management and basic reporting"],
      ["Admin & analytics", "Cashback rule engine", "Percent, limits, expiry, reversal and payout policy"],
      ["Integrations", "Payment / bank API", "Transaction source, callbacks and sandbox checks"],
      ["Finance & analytics", "Reconciliation reports", "GMV, cashback cost, exports and finance matching"],
      ["Risk & support", "Fraud checks", "Duplicate transaction and suspicious activity checks"],
      ["Finance & analytics", "Payout request", "Withdrawal request, status and finance approval"],
      ["Cashback product", "Referral campaigns", "Referral code, bonus rules and promo mechanics"],
      ["Risk & support", "Dispute handling", "Manual adjustment and support ticket workflow"],
      ["Integrations", "Notifications", "SMS OTP, push alerts and campaign messages"],
    );
  }
  if (has(/marketplace|core product|shop|store/i)) {
    templates.push(
      ["Core product", "Marketplace catalog", "Categories, listings and product cards"],
      ["Core product", "Buyer flow", "Browse, select and request/order flow"],
      ["Core product", "Seller flow", "Seller workspace and item publishing"],
    );
  }
  if (has(/website|web/i)) {
    templates.push(
      ["Core product", "Public web experience", "Landing, catalog and SEO pages"],
      ["Core product", "Responsive layout", "Desktop and mobile web states"],
    );
  }
  if (has(/admin|analytics|dashboard/i)) {
    templates.push(
      ["Admin & analytics", "Management workspace", "Admin panel navigation and permissions"],
      ["Admin & analytics", "Moderation tools", "Users, listings and content control"],
      ["Admin & analytics", "Reporting dashboard", "Operational metrics and exports"],
    );
  }
  if (has(/mobile|app|ios|android/i)) {
    templates.push(
      ["Mobile", "Mobile onboarding", "Auth, profile and first-run flow"],
      ["Mobile", "Mobile marketplace", "Browse, search and item details"],
      ["Mobile", "Mobile notifications", "Push/events and status updates"],
    );
  }
  if (has(/payment|payme|click|stripe/i)) templates.push(["Payments", "Payment integration", "Provider callbacks and payment statuses"]);
  if (has(/api|integration|telegram|bot|sms/i)) templates.push(["Integrations", "External integrations", "API credentials, webhooks and sandbox checks"]);
  const fallback = scopeItems.map((item) => [item.epic, item.task, item.subtask]);
  const rows = [];
  const seen = new Set();
  const addRow = (row) => {
    const key = row.map((item) => String(item || "").toLowerCase()).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  fallback.forEach(addRow);
  // Preserve every real scope item. Generic templates only fill a sparse
  // brief; they must not inflate an already complete client inventory.
  for (const row of templates) {
    if (rows.length >= 12) break;
    addRow(row);
  }
  const baselineRows = [
    ["Discovery", "Product architecture", "System structure, entities and delivery backlog"],
    ["Design", "UX/UI flows", "Core screens, states and approval-ready layouts"],
    ["Core product", "Authentication", "Login, roles, profile and access control"],
    ["Core product", "Main user flow", "Primary client-facing scenario and validation"],
    ["Admin & analytics", "Admin workspace", "Management pages, permissions and controls"],
    ["Backend", "API services", "Business logic, database and service endpoints"],
    ["Integrations", "External integrations", "Credentials, callbacks and sandbox checks"],
    ["Reports", "Operational reporting", "Dashboard metrics, filters and export basics"],
    ["Delivery", "Requirements freeze", "MVP boundary and acceptance rules"],
    ["Quality", "QA regression", "Critical flow testing and bug fixing"],
    ["Delivery", "Release preparation", "Production checklist, monitoring and handover"],
    ["Operations", "Client training", "Admin/user handover and basic documentation"],
  ];
  for (const row of baselineRows) {
    if (rows.length >= 12) break;
    addRow(row);
  }
  return rows;
}

function traditionalTaskEffortWeeks(row = []) {
  const text = row.join(" ").toLowerCase();
  if (/product selection|product card|variant|выбор товара|карточк|вариант|mahsulotni tanlash/iu.test(text)) return 3;
  if (/auth|login|profile|registration|kyc|otp|авторизац|аутентиф|регистрац|профил|kirish|ro['’]?yxat/iu.test(text)) return 3;
  if (/seller.*onboarding|onboarding.*seller|подключени[ея] продав|проверка продав|sotuvchini ulash/iu.test(text)) return 4;
  if (/catalog|search|filter|каталог|поиск|фильтр|katalog|qidiruv/iu.test(text)) return 4;
  if (/cart|checkout|order confirmation|order tracking|корзин|оформлен|подтверждени[ея] заказ|отслеживан|savat|buyurtmani tasdiqlash/iu.test(text)) return 4;
  if (/commission|settlement|campaign|promotion|комисси|расч[её]т|кампан|промо|aksiya/iu.test(text)) return 4;
  if (/discovery|architect|requirements?|backlog|analysis|исследован|архитект|требован|анализ|tahlil|arxitektur|talab/iu.test(text)) return 4;
  if (/\b(?:ux|ui)\b|design|prototype|wireframe|дизайн|интерфейс|прототип|dizayn/iu.test(text)) return 4;
  if (/\bqa\b|test|acceptance|release|deploy|training|monitoring|handover|регресс|тест|при[её]м|релиз|запуск|обуч|монитор|sinov|ishga tush|topshirish/iu.test(text)) return 4;
  if (/report|analytics|reconciliation|risk|support|dispute|return|отч[её]т|аналит|сверк|риск|поддерж|спор|возврат|hisobot|analitik|xavf|yordam/iu.test(text)) return 5;
  if (/seller|merchant|vendor|inventory|marketplace|продав|мерчант|остатк|маркетплейс|sotuvch|zaxira|marketpleys/iu.test(text)) return 6;
  if (/admin|backend|api service|rule engine|management workspace|админ|бэкенд|серверн|правил|boshqaruv/iu.test(text)) return 6;
  if (/payment|integration|callback|webhook|bank|оплат|плат[её]ж|интеграц|банк|to['’]?lov|integrats/iu.test(text)) return 7;
  if (/fraud|antifraud|anti-fraud|фрод|антифрод/iu.test(text)) return 7;
  if (/mobile|frontend|public web|core product|main user flow|мобильн|фронтенд|основн(?:ой|ые) продукт|mobil|asosiy mahsulot/iu.test(text)) return 7;
  if (/notification|уведом|bildirish/iu.test(text)) return 3;
  return 4;
}

function formatTaskEffort(weeks, locale = "en") {
  const value = Math.max(1, Math.round(Number(weeks) || 1));
  if (locale === "uz-Latn") return `${value} hafta`;
  if (locale === "ru" || locale === "ru-RU") return `${value} нед.`;
  return `${value} wk`;
}

function matchingScopeEffortWeeks(project = {}, row = []) {
  const task = String(row[1] || "").toLowerCase().trim();
  const detail = String(row[2] || "").toLowerCase().trim();
  const candidates = (project.scope || []).filter((item) => {
    const itemTask = String(item.task || "").toLowerCase().trim();
    const itemDetail = String(item.subtask || item.detail || "").toLowerCase().trim();
    return (detail && itemDetail === detail) || (task && itemTask === task);
  });
  const source = candidates[0];
  if (!source) return null;
  const suppliedWeeks = Number(source.durationWeeks || source.estimatedWeeks || source.effortWeeks || source.weeks);
  if (Number.isFinite(suppliedWeeks) && suppliedWeeks > 0) return Math.max(1, Math.round(suppliedWeeks));
  if (Number(source.startWeek) > 0 || Number(source.endWeek) > 0) {
    const start = Math.max(1, Math.round(Number(source.startWeek) || Number(source.endWeek)));
    const end = Math.max(start, Math.round(Number(source.endWeek) || start));
    return end - start + 1;
  }
  const durationText = String(source.duration || source.effortDuration || source.deadline || source.period || "");
  const durationMatch = durationText.match(/(\d+(?:[.,]\d+)?)\s*(?:weeks?|wks?|недел\p{L}*|нед\.?|hafta)/iu);
  if (durationMatch) return Math.max(1, Math.round(Number(durationMatch[1].replace(",", "."))));
  return null;
}

export function taskDeadlineLabel(row, _index, _totalRows, project = {}, locale = "en") {
  const suppliedWeeks = matchingScopeEffortWeeks(project, row);
  if (suppliedWeeks !== null) return formatTaskEffort(suppliedWeeks, locale);
  // AI-assisted implementation is the default for generated proposals. The
  // 0.65 factor models coding, test generation, refactoring, and documentation
  // acceleration while keeping architecture and acceptance work explicit.
  const aiFactor = project.ai_assisted_delivery === false ? 1 : 0.65;
  const estimatedWeeks = Math.max(1, Math.ceil(traditionalTaskEffortWeeks(row) * aiFactor));
  return formatTaskEffort(estimatedWeeks, locale);
}

function localizeMarketplaceScope(value = "", locale = "en") {
  if (!value || locale === "en") return value;
  const uz = {
    "Identity & access": "Identifikatsiya va kirish", "Core product": "Asosiy mahsulot", "Ordering & fulfilment": "Buyurtma va bajarish", "Marketplace operations": "Marketpleys operatsiyalari", "Risk & support": "Xavf va yordam", "Admin & analytics": "Boshqaruv va analitika",
    "User account flow": "Foydalanuvchi akkaunti jarayoni", "Product functionality": "Mahsulot funksiyalari", "Catalog and search": "Katalog va qidiruv", "Product selection": "Mahsulotni tanlash", "Cart and checkout": "Savat va buyurtmani rasmiylashtirish", "Order confirmation and tracking": "Buyurtmani tasdiqlash va kuzatish", "Order lifecycle": "Buyurtma hayot sikli", "Seller onboarding": "Sotuvchini ulash", "Seller workspace": "Sotuvchi kabineti", "Marketplace flow": "Marketpleys jarayoni", "Seller commercial model": "Sotuvchi tijorat modeli", "Risk and support operations": "Xavf va yordam operatsiyalari", "Management workspace": "Boshqaruv ish maydoni", "Finance reporting": "Moliyaviy hisobotlar",
    "Buyer registration and profile": "Xaridorni ro‘yxatdan o‘tkazish va profil", "Catalog, categories, search and filters": "Katalog, toifalar, qidiruv va filtrlar", "Product cards and variants": "Mahsulot kartalari va variantlari", "Cart and checkout": "Savat va buyurtmani rasmiylashtirish", "Order lifecycle and notifications": "Buyurtma holatlari va bildirishnomalar", "Seller onboarding and verification": "Sotuvchini ulash va tekshirish", "Seller product and inventory management": "Sotuvchi mahsulotlari va zaxiralarini boshqarish", "Commission and settlement rules": "Komissiya va hisob-kitob qoidalari", "Returns, disputes and moderation": "Qaytarish, nizolar va moderatsiya", "Admin catalog and user operations": "Katalog va foydalanuvchilar bo‘yicha admin operatsiyalari", "Marketplace analytics and exports": "Marketpleys analitikasi va eksportlar", "Marketplace": "Marketpleys",
  };
  const ru = {
    "Identity & access": "Идентификация и доступ", "Core product": "Основной продукт", "Ordering & fulfilment": "Заказ и исполнение", "Marketplace operations": "Операции маркетплейса", "Risk & support": "Риски и поддержка", "Admin & analytics": "Администрирование и аналитика",
    "User account flow": "Путь учётной записи", "Product functionality": "Функции продукта", "Catalog and search": "Каталог и поиск", "Product selection": "Выбор товара", "Cart and checkout": "Корзина и оформление заказа", "Order confirmation and tracking": "Подтверждение и отслеживание заказа", "Order lifecycle": "Жизненный цикл заказа", "Seller onboarding": "Подключение продавца", "Seller workspace": "Кабинет продавца", "Marketplace flow": "Путь маркетплейса", "Seller commercial model": "Коммерческая модель продавца", "Risk and support operations": "Операции рисков и поддержки", "Management workspace": "Рабочее место управления", "Finance reporting": "Финансовая отчётность",
    "Buyer registration and profile": "Регистрация и профиль покупателя", "Catalog, categories, search and filters": "Каталог, категории, поиск и фильтры", "Product cards and variants": "Карточки и варианты товаров", "Cart and checkout": "Корзина и оформление заказа", "Order lifecycle and notifications": "Статусы заказа и уведомления", "Seller onboarding and verification": "Подключение и проверка продавца", "Seller product and inventory management": "Управление товарами и остатками продавца", "Commission and settlement rules": "Правила комиссии и расчётов", "Returns, disputes and moderation": "Возвраты, споры и модерация", "Admin catalog and user operations": "Администрирование каталога и пользователей", "Marketplace analytics and exports": "Аналитика и выгрузки маркетплейса", "Marketplace": "Маркетплейс",
  };
  return (locale === "uz-Latn" ? uz : ru)[value] || value;
}

export function taskListRows(project = {}) {
  // Client-facing scope is a decision surface: preserve the complete input
  // inventory instead of silently truncating it at an arbitrary row count.
  const rows = expandedTaskRows(project);
  const locale = project.grounded_brief?.sourceLanguage || "en";
  const requested = (project.requested_scope || [])
    .map((item) => String(item || "").toLowerCase().trim())
    .filter(Boolean);
  return rows.map((row, index) => {
    const mainTask = String(row[1] || "").toLowerCase().trim();
    const subtask = String(row[2] || "").toLowerCase().trim();
    const status = requested.length && requested.some((item) => (
      item === mainTask
      || item === subtask
      || (item.length >= 5 && subtask.includes(item))
      || (subtask.length >= 5 && item.includes(subtask))
    ))
      ? "Requested"
      : requested.length
        ? "Recommended"
        : project.scope_inference_mode === "recommendation"
          ? "Recommended"
          : "In scope";
    return [
      ...row.slice(0, 3).map((value) => localizeMarketplaceScope(value, locale)),
      taskDeadlineLabel(row, index, rows.length, project, locale),
      status,
    ];
  });
}

function projectTaskListTable(project = {}) {
  const rows = taskListRows(project);
  return `
    <main class="slide-body">
      <div class="table-shell">
        <table class="scope-detail-table">
          <thead><tr><th>EPIC</th><th>Main task</th><th>Subtask</th><th>Phase</th><th>Status</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row[0])}</td>
                <td>${escapeHtml(row[1])}</td>
                <td>${escapeHtml(row[2])}</td>
                <td class="mono">${escapeHtml(row[3])}</td>
                <td><span class="status-pill"><i></i>${escapeHtml(row[4])}</span></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </main>`;
}

function scopeBoard(project = {}) {
  const rows = taskListRows(project);
  return `
    <main class="slide-body">
      <div class="table-shell scope-deadline-shell">
        <table class="scope-detail-table scope-deadline-table">
          <thead><tr><th>#</th><th>EPIC</th><th>Main task</th><th>Subtask</th><th>Deadline</th><th>Status</th></tr></thead>
          <tbody>
            ${rows.map((row, index) => `
              <tr>
                <td class="mono center">${escapeHtml(String(index + 1).padStart(2, "0"))}</td>
                <td>${escapeHtml(row[0])}</td>
                <td>${escapeHtml(row[1])}</td>
                <td>${escapeHtml(row[2])}</td>
                <td class="mono deadline-cell">${escapeHtml(row[3])}</td>
                <td><span class="status-pill"><i></i>${escapeHtml(row[4])}</span></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </main>`;
}

function developmentStagesThreeMonths(project = {}) {
  const stages = [
    ["Month 1", "Start, planning, design", "Discovery, architecture, UX/UI, backlog, core setup", "Approved plan"],
    ["Month 2", "Development and integration", "Backend, frontend/mobile, admin flows, integrations", "Accepted demo"],
    ["Month 3", "Testing, launch, training", "QA, bug fixing, production release, handover", "Production ready"],
  ];
  return `
    <main class="slide-body">
      <div class="timeline-viz three">${stages.map(() => "<div></div>").join("")}</div>
      <div class="road-track three">
        ${stages.map((row, index) => `
          <div class="card road-card ${index === 2 ? "dark-panel" : ""}">
            <div>
              <div class="micro">${escapeHtml(row[0])}</div>
              <div class="road-m">${escapeHtml(row[0])}</div>
              <h3>${escapeHtml(row[1])}</h3>
              <p class="body">${escapeHtml(row[2])}</p>
            </div>
            <div><div class="micro">Exit</div><p class="body">${escapeHtml(row[3])}</p></div>
          </div>`).join("")}
      </div>
    </main>`;
}

function developmentTimelineTable(project = {}) {
  const scopeText = [
    projectType(project),
    project.title,
    ...(project.scope || []).flatMap((item) => [item.epic, item.task, item.subtask]),
  ].filter(Boolean).join(" ");
  return buildDurationAwareRoadmap({
    durationMonths: project.duration_months,
    category: projectType(project),
    scope: [scopeText],
    locale: project.grounded_brief?.sourceLanguage || "en",
  });
}

function developmentStagesWithTable(project = {}) {
  const scopeText = [
    projectType(project),
    project.title,
    ...(project.scope || []).flatMap((item) => [item.epic, item.task, item.subtask]),
  ].filter(Boolean).join(" ");
  const duration = Math.max(1, Math.ceil(Number(project.duration_months) || 3));
  const isCashback = /cashback|loyalty|bonus|reward|wallet|merchant|partner|payout|reconciliation|fraud/i.test(scopeText);
  const stageCards = duration <= 1 && isCashback
    ? [
        ["Week 1", "Start and design", "Architecture, UX/UI, auth/OTP"],
        ["Week 2-3", "Cashback core delivery", "Mobile app, admin panel, merchant cabinet, wallet"],
        ["Week 4", "Integrations and launch", "Payment/bank API, reconciliation, fraud checks, QA"],
      ]
    : duration <= 1
      ? [
          ["Week 1", "Start and design", "Architecture, UX/UI, backlog"],
          ["Week 2-3", "Core delivery", "Product flows, admin workspace, integrations"],
          ["Week 4", "Testing and launch", "QA, UAT, production release"],
        ]
      : isCashback
    ? [
        ["Month 1", "Start, planning, design", "Discovery, architecture, UX/UI, auth/OTP"],
        ["Month 2", "Cashback core delivery", "Mobile app, admin panel, merchant cabinet, wallet"],
        ["Month 3", "Integrations and launch", "Payment/bank API, reconciliation, fraud checks, QA"],
      ]
    : [
        ["Month 1", "Start, planning, design", "Discovery, architecture, UX/UI, backlog"],
        ["Month 2", "Development and integration", "Backend, frontend/mobile, admin flows"],
        ["Month 3", "Testing, launch, training", "QA, UAT, production release"],
      ];
  return `
    <main class="slide-body">
      <div class="timeline-viz three"><div></div><div></div><div></div></div>
      <div class="road-track three compact-road">
        ${stageCards.map((row, index) => `
          <div class="card road-card ${index === 2 ? "dark-panel" : ""}">
            <div>
              <div class="micro">${escapeHtml(row[0])}</div>
              <div class="road-m">${escapeHtml(row[0])}</div>
              <h3>${escapeHtml(row[1])}</h3>
              <p class="body">${escapeHtml(row[2])}</p>
            </div>
          </div>`).join("")}
      </div>
      ${richTable(["Period", "Phase", "Key deliverables", "Active team"], developmentTimelineTable(project), "timeline-table document-table")}
    </main>`;
}

function riskAssumptionBlock(project = {}) {
  const risks = risksForProject(project);
  const assumptions = assumptionsForProject(project);
  return `
    <main class="risk-grid">
      ${richTable(["Risk", "Mitigation"], risks.map((row) => [row.risk, row.mitigation]), "risk-table")}
      <div class="card requirement-list-card">
        <div class="micro">Assumptions used in this proposal</div>
        <div class="requirement-list">
          ${assumptions.map((item, index) => `
            <div class="requirement-row">
              <span class="num-chip mono">${String(index + 1).padStart(2, "0")}</span>
              <div><h3>${escapeHtml(item.replace(/^\[Assumption\]\s*/i, "[Assumption] "))}</h3></div>
            </div>`).join("")}
        </div>
      </div>
    </main>`;
}

function signatureBlock(project = {}) {
  return `
    <main class="signature-grid">
      <div class="card signature-card dark-panel">
        <div class="micro">Contractor</div>
        <h3>Udevs</h3>
        <div class="signature-lines">
          <span>Full name</span><span>Position</span><span>Signature</span><span>Date</span>
        </div>
      </div>
      <div class="card signature-card">
        <div class="micro">Client</div>
        <h3>${escapeHtml(project.client_company || "[Assumption] Client company")}</h3>
        <div class="signature-lines">
          <span>Full name</span><span>Position</span><span>Signature</span><span>Date</span>
        </div>
      </div>
    </main>`;
}

function bullets(items = [], limit = 5) {
  const rows = items.filter(Boolean).slice(0, limit);
  if (!rows.length) return "<li>[Assumption] Detail will be confirmed during discovery.</li>";
  return rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function commercialSummaryPage(model = {}) {
  const requirements = model.callInsights?.requirements?.length
    ? model.callInsights.requirements
    : [`Build ${model.brief.type} with ${model.scope.length} delivery blocks`, `Launch in ${model.brief.duration}`, `Keep budget, scope and acceptance milestones visible`];
  const styleGuide = model.historicalStyleGuide?.rules?.length
    ? model.historicalStyleGuide.rules.slice(0, 2)
    : ["Udevs commercial proposal structure applied."];
  return `
    <main class="commercial-grid">
      <div class="card dark-panel research-card">
        <div class="micro">Executive commercial summary</div>
        <h3>${escapeHtml(model.brief.projectName)} is proposed as a sales-ready product delivery package.</h3>
        <p>We combine scope, design, engineering, infrastructure, pricing and payment stages into one controlled commercial proposal.</p>
      </div>
      <div class="card research-card">
        <div class="micro">Client Requirements / evidence</div>
        <h3>${escapeHtml(model.callInsights?.source || "Prompt evidence")}</h3>
        <ul>${bullets([...requirements.slice(0, 3), ...styleGuide], 5)}</ul>
      </div>
    </main>`;
}

function problemSolutionPage(model = {}) {
  return `
    <main class="problem-solution-grid">
      <div class="card research-card">
        <div class="micro">Problem statement</div>
        <h3>Nima muammoni hal qivommiza</h3>
        <p>${escapeHtml(model.problemStatement)}</p>
      </div>
      <div class="card dark-panel research-card">
        <div class="micro">Solution concept</div>
        <h3>${escapeHtml(model.brief.type)} with measurable delivery control.</h3>
        <p>Core scope, UX/UI, backend, integrations, QA, launch and acceptance rules are planned as one MVP roadmap.</p>
      </div>
    </main>`;
}

function tamSamSomPage(model = {}) {
  const tam = model.tamSamSom || {};
  return `
    <main class="slide-body">
      <div class="metric-triplet">
        <div class="card"><div class="micro">TAM</div><strong class="mono">${escapeHtml(fmtUsd(tam.tam))}</strong><p class="body">Total reachable market model.</p></div>
        <div class="card"><div class="micro">SAM</div><strong class="mono">${escapeHtml(fmtUsd(tam.sam))}</strong><p class="body">Serviceable segment for this offer.</p></div>
        <div class="card dark-panel"><div class="micro">SOM</div><strong class="mono" style="color:#fff">${escapeHtml(fmtUsd(tam.som))}</strong><p class="body">Realistic obtainable first target.</p></div>
      </div>
      <div class="card research-card" style="margin-top:20px">
        <div class="micro">Formula and assumptions</div>
        <h3>${escapeHtml(tam.formula || "TAM/SAM/SOM formula pending source confirmation.")}</h3>
        <ul>${bullets(tam.assumptions || [], 3)}</ul>
      </div>
    </main>`;
}

function mindMapPage(model = {}) {
  const modules = moduleGroups({
    scope: model.scope.map((row) => ({ epic: row[0], task: row[1], subtask: row[2] })),
    scope_by_epic: {},
  }, 8);
  const left = modules.slice(0, 4);
  const right = modules.slice(4, 8);
  const chipList = (items) => `<div class="module-chip-list">${items.map((item) => `<div class="module-chip">${escapeHtml(item.name)} · ${escapeHtml(String(item.count || 1))}</div>`).join("")}</div>`;
  return `
    <main class="mindmap-grid">
      <div class="card dark-panel mindmap-root">
        <div class="micro">Product Mind Map</div>
        <strong>${escapeHtml(model.brief.projectName)}</strong>
        <p class="body" style="margin-top:18px">Product blocks generated from prompt, call transcript and research model.</p>
      </div>
      ${chipList(left)}
      ${chipList(right)}
    </main>`;
}

function bpmnPage(model = {}) {
  const rows = [
    ["Start", "Client opens product / request"],
    ["Validate", "Auth, required data and role checks"],
    ["Process", "Core workflow, admin control and integrations"],
    ["Notify", "Status update, reporting and user feedback"],
    ["Done", "Accepted result and analytics event"],
  ];
  return `<main class="flow-row">${rows.map((row, index) => `
    <div class="card flow-node ${index === rows.length - 1 ? "dark-panel" : ""}">
      <div class="micro">${String(index + 1).padStart(2, "0")}</div>
      <h3>${escapeHtml(row[0])}</h3>
      <p>${escapeHtml(row[1])}</p>
    </div>`).join("")}</main>`;
}

function infrastructureDiagramPage(model = {}) {
  const integrations = model.pricing?.infraExternal?.slice(0, 5) || [];
  const nodes = [
    ["Users", "Web / mobile clients"],
    ["Frontend", "Website, admin, mobile UI"],
    ["Backend API", "Business logic and permissions"],
    ["Database", "Core data and audit trail"],
    ["External", integrations.map((row) => row.component).join(", ") || "Payment, SMS, analytics"],
  ];
  return `<main class="flow-row">${nodes.map((row, index) => `
    <div class="card flow-node ${index === 2 ? "dark-panel" : ""}">
      <div class="micro">INFRA</div>
      <h3>${escapeHtml(row[0])}</h3>
      <p>${escapeHtml(row[1])}</p>
    </div>`).join("")}</main>`;
}

function swotPage(model = {}) {
  return `<main class="swot-grid">${(model.swot || []).map((row, index) => `
    <div class="card swot-card ${index === 0 ? "dark-panel" : ""}">
      <div class="micro">SWOT</div>
      <h3>${escapeHtml(row[0])}</h3>
      <p class="body">${escapeHtml(row[1])}</p>
    </div>`).join("")}</main>`;
}

function functionPricePage(model = {}) {
  const rows = (model.functionPrice || []).map((row) => [
    row.priority,
    row.feature,
    row.phase,
    fmtUsd(row.price),
  ]);
  return `<main class="slide-body">${richTable(["Priority", "Function", "Phase", "Price"], rows, "scope-detail-table document-table")}</main>`;
}

function designProjectPage(model = {}) {
  return `
    <main class="commercial-grid">
      <div class="card dark-panel research-card">
        <div class="micro">Design project</div>
        <h3>${escapeHtml(model.brandProfile?.tone || "Clean corporate")} visual direction.</h3>
        <p>Brandbook/site style is applied before PDF rendering; layout, hierarchy, spacing and readability are verified before delivery.</p>
      </div>
      ${richTable(["Stage", "Output"], model.designProject || [], "document-table")}
    </main>`;
}

function teamSizePage(model = {}) {
  const rows = (model.teamPlan || []).slice(0, 7).map((row) => [
    row.role,
    fmtNumber(row.qty),
    fmtNumber(row.months),
    fmtUsd(row.total),
  ]);
  return `<main class="slide-body">${richTable(["Role", "FTE", "Months", "Cost"], rows, "team-cost-table document-table")}</main>`;
}

function projectPricePage(model = {}) {
  const infraRows = (model.pricing?.infraExternal || []).slice(0, 5).map((row) => [row.component, row.type, row.cost]);
  return `
    <main class="price-grid">
      <div class="card dark-panel research-card">
        <div class="micro">Project price</div>
        <h3 class="mono">${escapeHtml(fmtUsd(model.pricing?.projectPrice))}</h3>
        <p>Development total. Infrastructure, licenses, API and hardware are shown separately.</p>
      </div>
      ${richTable(["External item", "Type", "Cost"], infraRows, "document-table")}
    </main>`;
}

function paymentStagesPage(model = {}) {
  const rows = (model.payments || []).map((row) => [row.period, `${row.percent || Math.round((row.amount / Math.max(1, model.pricing.projectPrice)) * 100)}%`, fmtUsd(row.amount), row.due || "By acceptance"]);
  return `<main class="slide-body">${richTable(["Milestone", "%", "Amount", "Acceptance condition"], rows, "payment-detail-table document-table")}</main>`;
}

function roadmapPage(model = {}) {
  return `<main class="slide-body">${richTable(["Period", "Phase", "Key deliverables", "Active team"], model.roadmap || [], "timeline-table document-table")}</main>`;
}

function sourcesPage(model = {}) {
  const rows = (model.sources || []).slice(0, 14);
  return `
    <main class="source-grid">
      <div class="card dark-panel research-card">
        <div class="micro">Appendix / Sources</div>
        <h3>Compact source map, not a raw research dump.</h3>
        <p>Sources were used before generation to build the commercial model, brand direction and assumptions.</p>
      </div>
      <div class="card research-card source-list">
        ${rows.map((row) => `
          <div class="source-row">
            <strong>${escapeHtml(row.type || "source")}</strong>
            <span>${escapeHtml(`${row.label || "-"} · ${row.status || "-"} · ${row.source || ""}`.slice(0, 190))}</span>
          </div>`).join("") || "<p>No external source provided.</p>"}
      </div>
    </main>`;
}

function proposalRecordFromProject(project = {}, question = "", status = "draft", pdfPath = "") {
  const estimateRows = normalizedEstimateRows(project);
  const services = projectPlatforms(project);
  return {
    id: `${slugify(project.title || "commercial-proposal")}-${Date.now()}`,
    status,
    project_name: project.title || "Custom Project",
    client_email: project.client_email || "[Assumption] Client email not provided",
    industry: projectType(project),
    scope_description: (project.scope || []).map((item) => item.subtask || item.task || item.epic).filter(Boolean).slice(0, 28).join("; "),
    selected_services: services,
    min_budget_usd: roundMoney(project.budget_usd),
    max_budget_usd: roundMoney(project.budget_usd),
    duration_weeks: Math.round((Number(project.duration_months) || 0) * 4.345),
    team_composition: estimateRows.map((row) => `${row.role}: ${fmtNumber(row.qty)} x ${fmtNumber(row.months)} months = ${fmtUsd(row.total)}`).join("; "),
    risk_factors: risksForProject(project).map((row) => `${row.risk}: ${row.mitigation}`).join("; "),
    ai_summary: `${project.title} proposal: ${projectType(project)}, ${fmtUsd(project.budget_usd)}, ${durationLabel(project.duration_months)}, ${project.scope_count} scope items. Source prompt: ${promptBrief(question)}`,
    pdf_path: pdfPath,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function saveProposalRecord(record) {
  const dir = path.join(process.cwd(), "data", "commercial_proposals");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${record.id}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await fs.appendFile(path.join(dir, "commercial_proposals.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  return filePath;
}

function buildStrictLodifyPdfHtml({ question, selected, allProjects, themeTokens = {}, proposalModel = null }) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const mainProject = selected.length === 1 ? selected[0] : null;
  const portfolioProjects = [...selected, ...allProjects.filter((project) => !selected.some((item) => item.key === project.key))];
  const main = mainProject || portfolioProjects[0];
  const isPortfolioMode = selected.length > 1;
  const title = mainProject ? `${mainProject.title} commercial proposal` : "Project KP Portfolio";
  const prompt = promptBrief(question);
  const accentScope = topEntries(main.scope_by_epic, 6);
  const brandTitle = main.title.toUpperCase().replace(/\s+TMS\b/, " · TMS");
  const totalPages = 15;
  const model = proposalModel || buildKpProposalModel(main, question, {
    links: { urls: [], brandUrls: [], analogUrls: [], pdfUrls: [] },
    callInsights: buildCallInsights([]),
    brandProfiles: [],
    analogResearch: [],
    marketResearch: buildMarketResearch(main, [], []),
    sources: [],
  }, themeTokens);
  const paymentRows = paymentScheduleRows(main).map((item) => [item.period, `${item.percent || Math.round((item.amount / Math.max(1, main.budget_usd)) * 100)}%`, fmtUsd(item.amount), item.due || "By milestone acceptance"]);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700;800&family=Manrope:wght@500;600;700;800&display=swap");
    @page { size: 1440px 810px; margin: 0; }
    * { box-sizing: border-box; }
    :root {
${cssVariables(themeTokens)}
    }
    body {
      margin: 0;
      background: var(--page);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, Manrope, Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1, h2, h3, p { margin: 0; }
    .slide {
      width: 1440px;
      height: 810px;
      padding: 56px 72px;
      page-break-after: always;
      background: var(--page);
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: 20px;
      overflow: hidden;
    }
    .slide:last-child { page-break-after: auto; }
    .cover { grid-template-rows: auto 1fr auto auto; gap: 28px; }
    .cover-top,
    .slide-head,
    .slide-foot,
    .head-side {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
    }
    .head-side {
      min-width: 220px;
      flex-direction: column;
      align-items: flex-end;
      gap: 16px;
      padding-top: 2px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 13px;
      font-size: 17px;
      font-weight: 800;
      letter-spacing: .03em;
    }
    .brand i { width: 11px; height: 11px; background: var(--brand); border-radius: 3px; }
    .brand span:last-child,
    .page-num,
    .slide-foot span:last-child,
    .micro,
    .kicker,
    .badge,
    .cover-kicker,
    th,
    .status-pill,
    .this-chip {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .brand span:last-child {
      color: var(--faint);
      font-size: 13px;
      letter-spacing: .33em;
      font-weight: 500;
    }
    .page-num,
    .slide-foot span:last-child {
      color: var(--faint);
      font-size: 12px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .kicker {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--brand);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 2.5px;
      text-transform: uppercase;
    }
    .kicker span {
      width: 26px;
      height: 3px;
      border-radius: 3px;
      background: var(--brand);
      display: inline-block;
    }
    h1 {
      max-width: 560px;
      margin-top: 26px;
      font-size: 60px;
      line-height: 1.04;
      font-weight: 900;
      letter-spacing: -2.7px;
    }
    h2 {
      max-width: 820px;
      margin-top: 17px;
      font-size: 40px;
      line-height: 1.06;
      font-weight: 900;
      letter-spacing: -1.6px;
    }
    .slide-head.scope-map h2 { max-width: 760px; }
    h3 {
      font-size: 19px;
      line-height: 1.18;
      font-weight: 700;
    }
    .lead {
      max-width: 650px;
      margin-top: 26px;
      color: var(--muted);
      font-size: 24px;
      line-height: 1.35;
      font-weight: 500;
    }
    .cover-kicker,
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding: 9px 16px;
      border-radius: 999px;
      background: var(--brand-tint);
      color: var(--brand);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .cover-kicker { letter-spacing: 3.8px; }
    .cover-body {
      display: grid;
      grid-template-columns: 1.15fr .85fr;
      gap: 46px;
      align-items: center;
    }
    .cover-meta {
      margin-top: 24px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.5;
    }
    .card {
      position: relative;
      isolation: isolate;
      background: transparent;
      border: 0;
      border-radius: 20px;
      box-shadow: none;
      padding: 28px;
    }
    .card::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: -1;
      border: 1px solid var(--line);
      border-radius: inherit;
      background: #FFFFFF;
      box-shadow: none;
      filter: opacity(1);
    }
    .card > * {
      position: relative;
      z-index: 1;
    }
    .summary-card,
    .summary-bottom > .card,
    .stat-tile,
    .brief,
    .score-card,
    .road-card,
    .risk-grid > .card {
      box-shadow: none;
    }
    .summary-card::before,
    .summary-bottom > .card::before,
    .stat-tile::before,
    .brief::before,
    .score-card::before,
    .road-card::before,
    .risk-grid > .card::before {
      box-shadow: var(--shadow-text-card);
    }
    .dark-panel {
      color: rgba(255,255,255,.92);
    }
    .dark-panel::before {
      background: var(--ink);
      border-color: rgba(255,255,255,.14);
    }
    .dark-panel p,
    .dark-panel .body,
    .dark-panel .micro { color: rgba(255,255,255,.72); }
    .cover-score {
      min-height: 320px;
      display: grid;
      grid-template-rows: auto 1fr auto;
      align-items: center;
      box-shadow: none;
    }
    .cover-score::before {
      box-shadow: var(--shadow-cover-hero);
    }
    .metric-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1.6fr;
      gap: 16px;
      align-items: stretch;
    }
    .stat-tile {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 106px;
      padding: 24px 26px;
    }
    .stat-tile strong {
      margin-top: 16px;
      font-size: 30px;
      line-height: 1;
      font-weight: 800;
      letter-spacing: -1px;
    }
    .stat-tile strong.mono { color: var(--ink); }
    .brief { min-height: 106px; padding: 24px 26px; }
    .brief p { margin-top: 12px; color: rgba(255,255,255,.86); font-size: 16px; line-height: 1.45; }
    .micro {
      color: var(--faint);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .body {
      margin-top: 14px;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.5;
      font-weight: 500;
    }
    .svg-ring {
      position: relative;
      display: grid;
      place-items: center;
      margin: 0 auto;
    }
    .ring-lg { width: 220px; height: 220px; }
    .ring-sm { width: 160px; height: 160px; }
    .svg-ring svg { width: 100%; height: 100%; display: block; }
    .ring-track { stroke: var(--line); }
    .ring-value { stroke: var(--brand); stroke-linecap: round; }
    .svg-ring.brand .ring-value { stroke: var(--brand); }
    .svg-ring.good .ring-value { stroke: var(--good); }
    .svg-ring.warn .ring-value { stroke: var(--warn); }
    .svg-ring.bad .ring-value { stroke: var(--bad); }
    .ring-center {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      text-align: center;
    }
    .ring-center strong {
      font-size: 46px;
      line-height: .9;
      font-weight: 800;
      letter-spacing: -1.5px;
    }
    .ring-sm .ring-center strong { font-size: 30px; }
    .ring-center small {
      color: var(--muted);
      font-size: .52em;
      letter-spacing: 0;
    }
    .ring-center span {
      margin-top: 10px;
      color: var(--faint);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      letter-spacing: 2.8px;
      text-transform: uppercase;
    }
    .bench {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      padding-top: 20px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 15px;
      font-weight: 700;
    }
    .slide-body {
      min-height: 0;
      display: grid;
      gap: 20px;
      align-content: start;
    }
    .summary-grid,
    .score-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 18px;
      align-items: stretch;
    }
    .summary-card {
      min-height: 180px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .num-chip {
      width: 30px;
      height: 30px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-right: 10px;
      border-radius: 9px;
      background: var(--brand-tint);
      color: var(--brand);
      font-weight: 800;
    }
    .summary-bottom {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      align-items: stretch;
    }
    .snapshot-grid {
      display: grid;
      grid-template-columns: 1.35fr 1fr;
      gap: 18px;
      align-items: stretch;
    }
    .pricing-grid {
      display: grid;
      grid-template-columns: 1.15fr .9fr .9fr;
      gap: 18px;
      align-items: stretch;
    }
    .snapshot-card,
    .module-card,
    .scope-list-shell,
    .advantage-hero,
    .advantage-list-card,
    .client-focus,
    .requirement-list-card,
    .estimate-list-card,
    .value-card,
    .requirement-card,
    .role-card,
    .pricing-item,
    .pricing-total {
      box-shadow: none;
    }
    .snapshot-card::before,
    .module-card::before,
    .scope-list-shell::before,
    .advantage-hero::before,
    .advantage-list-card::before,
    .client-focus::before,
    .requirement-list-card::before,
    .estimate-list-card::before,
    .value-card::before,
    .requirement-card::before,
    .role-card::before,
    .pricing-item::before,
    .pricing-total::before {
      box-shadow: var(--shadow-text-card);
    }
    .snapshot-title {
      margin-top: 18px;
      color: #FFFFFF;
      font-size: 26px;
      line-height: 1.08;
      font-weight: 900;
      letter-spacing: -1px;
    }
    .chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 20px;
    }
    .chip-list span {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 8px 12px;
      border-radius: 999px;
      background: var(--brand-tint);
      color: var(--brand-deep);
      font-size: 13px;
      font-weight: 700;
    }
    .overview-platform-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 18px;
      align-items: stretch;
    }
    .platform-panel,
    .overview-facts-panel,
    .overview-decision-panel {
      min-height: 220px;
      padding: 26px;
    }
    .platform-icon-list,
    .overview-facts {
      display: grid;
      gap: 14px;
      margin-top: 22px;
    }
    .platform-icon-row {
      display: grid;
      grid-template-columns: 54px 1fr;
      gap: 14px;
      align-items: center;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--line);
    }
    .platform-icon-row:last-child { border-bottom: 0; padding-bottom: 0; }
    .platform-icon {
      width: 48px;
      height: 48px;
      display: inline-grid;
      place-items: center;
      border-radius: 14px;
      background: var(--brand-tint);
      color: var(--brand);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .6px;
    }
    .platform-icon svg,
    .platform-chip-list svg {
      width: 22px;
      height: 22px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .platform-chip-list span {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding-left: 13px;
    }
    .platform-chip-list svg {
      width: 16px;
      height: 16px;
    }
    .platform-icon-row h3 { font-size: 18px; }
    .platform-icon-row p {
      margin-top: 5px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.3;
      font-weight: 700;
    }
    .overview-fact-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: baseline;
      padding-bottom: 17px;
      border-bottom: 1px solid var(--line);
    }
    .overview-fact-row:last-child { border-bottom: 0; padding-bottom: 0; }
    .overview-fact-row span {
      color: var(--ink);
      font-size: 18px;
      font-weight: 800;
    }
    .overview-fact-row strong {
      color: var(--brand);
      font-size: 24px;
      line-height: 1;
      font-weight: 900;
    }
    .overview-fact-row small {
      grid-column: 1 / -1;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }
    .overview-decision-panel h3 {
      margin-top: 20px;
      color: #FFFFFF;
      font-size: 29px;
      line-height: 1.1;
      letter-spacing: -.7px;
    }
    .document-page {
      display: grid;
      gap: 18px;
      align-content: start;
    }
    .doc-section {
      display: grid;
      gap: 10px;
    }
    .doc-text {
      color: var(--muted);
      font-size: 15px;
      line-height: 1.45;
      font-weight: 600;
    }
    .split-doc {
      grid-template-columns: .95fr 1.05fr;
      gap: 18px;
      align-items: start;
    }
    .document-table th,
    .timeline-table th { padding: 8px 14px; font-size: 10px; }
    .document-table td,
    .timeline-table td { height: 36px; padding: 7px 14px; font-size: 12px; line-height: 1.16; }
    .document-table td:first-child,
    .timeline-table td:first-child { font-size: 13px; }
    .cover-money {
      min-height: 320px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 36px;
    }
    .cover-money strong {
      display: block;
      margin-top: 20px;
      color: #FFFFFF;
      font-size: 70px;
      line-height: .92;
      letter-spacing: -3px;
      font-weight: 900;
    }
    .cover-money-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 30px;
    }
    .cover-money-grid div {
      min-height: 78px;
      padding: 16px;
      border-radius: 16px;
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.12);
    }
    .cover-money-grid span {
      display: block;
      color: rgba(255,255,255,.62);
      font-size: 11px;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      font-weight: 800;
    }
    .cover-money-grid b {
      display: block;
      margin-top: 10px;
      color: #FFFFFF;
      font-size: 24px;
      line-height: 1;
      font-weight: 900;
    }
    .compact-road { gap: 16px; }
    .compact-road .road-card {
      min-height: 210px;
      padding: 20px;
    }
    .compact-road .road-m { font-size: 28px; }
    .compact-road .road-card h3 { font-size: 18px; }
    .compact-road .road-card .body { font-size: 14px; line-height: 1.35; }
    .value-grid,
    .role-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 18px;
      align-items: stretch;
    }
    .role-grid { grid-template-columns: repeat(4, 1fr); }
    .value-card {
      min-height: 150px;
      display: grid;
      grid-template-columns: 118px 1fr;
      gap: 16px;
      align-items: center;
      padding: 18px;
    }
    .value-card .ring-sm { width: 118px; height: 118px; }
    .value-card .ring-sm .ring-center strong { font-size: 24px; }
    .value-card p,
    .requirement-card p,
    .role-card p,
    .pricing-item p {
      margin-top: 9px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.35;
      font-weight: 600;
    }
    .module-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 18px;
      align-items: stretch;
    }
    .module-card {
      min-height: 205px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 22px;
    }
    .module-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .module-count {
      color: var(--faint);
      font-size: 12px;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .module-card h3 { margin-top: 18px; font-size: 23px; }
    .module-card ul {
      display: grid;
      gap: 7px;
      margin: 16px 0 0;
      padding: 0;
      list-style: none;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.28;
      font-weight: 600;
    }
    .module-card li::before {
      content: "";
      width: 6px;
      height: 6px;
      display: inline-block;
      margin-right: 8px;
      border-radius: 50%;
      background: var(--brand);
      vertical-align: 2px;
    }
    .dark-panel .module-count,
    .dark-panel ul,
    .dark-panel p { color: rgba(255,255,255,.72); }
    .mini-bar { margin-top: 16px; }
    .advantage-layout {
      display: grid;
      grid-template-columns: .92fr 1.35fr;
      gap: 18px;
      align-items: stretch;
    }
    .advantage-hero {
      min-height: 360px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 34px;
    }
    .advantage-hero h3 {
      margin-top: 24px;
      color: #FFFFFF;
      font-size: 31px;
      line-height: 1.12;
      letter-spacing: -1px;
    }
    .advantage-hero .body { margin-top: 22px; font-size: 17px; line-height: 1.45; }
    .advantage-list-card { padding: 24px 28px; }
    .advantage-list,
    .requirement-list,
    .estimate-list,
    .scope-list {
      display: grid;
      gap: 0;
      margin-top: 18px;
    }
    .advantage-row,
    .requirement-row {
      display: grid;
      grid-template-columns: 46px 1fr;
      gap: 16px;
      padding: 18px 0;
      border-bottom: 1px solid var(--line);
      align-items: start;
    }
    .advantage-row:first-child,
    .requirement-row:first-child { padding-top: 4px; }
    .advantage-row:last-child,
    .requirement-row:last-child { border-bottom: 0; padding-bottom: 2px; }
    .advantage-row h3,
    .requirement-row h3 {
      font-size: 20px;
      line-height: 1.12;
      letter-spacing: -.3px;
    }
    .advantage-row p,
    .requirement-row p {
      margin-top: 7px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.35;
      font-weight: 600;
    }
    .client-compact-grid {
      display: grid;
      grid-template-columns: .62fr 1.38fr;
      gap: 18px;
      align-items: stretch;
    }
    .client-focus {
      min-height: 350px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 34px;
    }
    .client-focus .blocker-count { margin-top: 20px; }
    .requirement-list-card { padding: 26px 30px; }
    .scope-list-shell {
      width: 1040px;
      margin: 0 auto;
      padding: 30px 34px;
    }
    .scope-list-head,
    .estimate-list-head {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--line);
    }
    .scope-list-head h3,
    .estimate-list-head h3 {
      margin-top: 8px;
      font-size: 27px;
      line-height: 1.12;
      letter-spacing: -.5px;
    }
    .scope-total {
      min-width: 118px;
      padding: 10px 14px;
      border-radius: 999px;
      background: var(--brand-tint);
      color: var(--brand-deep);
      font-size: 13px;
      font-weight: 800;
      text-align: center;
    }
    .scope-list-row {
      display: grid;
      grid-template-columns: 50px 1fr 100px;
      gap: 18px;
      align-items: center;
      min-height: 78px;
      border-bottom: 1px solid var(--line);
    }
    .scope-list-row:last-child { border-bottom: 0; }
    .scope-index,
    .estimate-index {
      width: 34px;
      height: 34px;
      display: inline-grid;
      place-items: center;
      border-radius: 10px;
      background: var(--brand-tint);
      color: var(--brand-deep);
      font-size: 13px;
      font-weight: 800;
    }
    .scope-list-row h3 {
      font-size: 20px;
      line-height: 1.1;
    }
    .scope-list-row p {
      margin-top: 7px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.28;
      font-weight: 600;
    }
    .scope-list-count {
      color: var(--faint);
      font-size: 12px;
      text-transform: uppercase;
      text-align: right;
    }
    .estimate-list-card {
      padding: 28px 32px;
    }
    .estimate-list-head strong {
      color: var(--brand);
      font-size: 28px;
      line-height: 1;
    }
    .estimate-row {
      display: grid;
      grid-template-columns: 44px 1fr 360px 110px;
      gap: 18px;
      align-items: center;
      min-height: 74px;
      border-bottom: 1px solid var(--line);
    }
    .estimate-row:last-child { border-bottom: 0; }
    .estimate-main h3 { font-size: 19px; line-height: 1.12; }
    .estimate-main p {
      margin-top: 5px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }
    .estimate-row strong {
      color: var(--ink);
      font-size: 20px;
      line-height: 1;
      text-align: right;
    }
    .estimate-indicator .bar { height: 10px; }
    .pricing-strip {
      display: grid;
      grid-template-columns: 1.25fr 1fr 1fr;
      gap: 18px;
      margin-top: 18px;
    }
    .pricing-strip > div {
      position: relative;
      min-height: 96px;
      padding: 22px 26px;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: #FFFFFF;
      box-shadow: var(--shadow-text-card);
    }
    .pricing-strip strong {
      display: block;
      margin-top: 13px;
      color: var(--ink);
      font-size: 27px;
      line-height: 1;
      font-weight: 900;
    }
    .requirement-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 18px;
      align-items: stretch;
    }
    .requirement-card {
      min-height: 150px;
      padding: 22px;
    }
    .requirement-card h3 { margin-top: 18px; font-size: 22px; }
    .role-card {
      min-height: 142px;
      padding: 20px;
    }
    .role-card strong,
    .pricing-total strong,
    .pricing-item strong {
      display: block;
      margin-top: 18px;
      color: var(--ink);
      font-size: 27px;
      line-height: 1;
      font-weight: 900;
      letter-spacing: -1px;
    }
    .role-card.dark-panel strong,
    .pricing-total.dark-panel strong { color: #FFFFFF; }
    .role-card .bar { margin-top: 18px; }
    .pricing-grid { grid-template-columns: 1.2fr .9fr .9fr; }
    .pricing-total,
    .pricing-item { min-height: 178px; }
    .pricing-item .bar { margin-top: 24px; }
    .comparison-table th { padding: 10px 16px; }
    .comparison-table td { height: 54px; }
    .marker {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 76px;
      padding: 7px 10px;
      border-radius: 999px;
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .marker.yes { background: var(--good-tint); color: var(--good); }
    .marker.partial { background: var(--warn-tint); color: var(--warn); }
    .marker.no { background: var(--bad-tint); color: var(--bad); }
    .scope-pills {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 22px;
    }
    .scope-pill {
      min-height: 82px;
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 18px;
      background: #FFFFFF;
    }
    .scope-pill b {
      display: block;
      color: var(--brand);
      font-size: 30px;
      line-height: 1;
      font-weight: 800;
    }
    .scope-pill span { display: block; margin-top: 10px; color: var(--muted); font-size: 15px; line-height: 1.25; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #FFFFFF;
      border: 0;
      border-radius: 18px;
      box-shadow: none;
      overflow: hidden;
      position: relative;
      z-index: 1;
    }
    .table-shell {
      position: relative;
      isolation: isolate;
      border-radius: 18px;
    }
    .table-shell::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: -1;
      border: 1px solid var(--line);
      border-radius: inherit;
      background: #FFFFFF;
      box-shadow: var(--shadow-table-card);
      filter: opacity(1);
    }
    th {
      padding: 11px 18px;
      color: var(--faint);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1.2px;
      line-height: 1.1;
      text-align: left;
      text-transform: uppercase;
      border-bottom: 1.5px solid var(--line);
    }
    td {
      height: 50px;
      padding: 9px 18px;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.25;
      font-weight: 600;
      border-bottom: 1px solid var(--line);
      vertical-align: middle;
    }
    td:first-child {
      color: var(--ink);
      font-size: 17px;
      font-weight: 700;
    }
    tr:last-child td { border-bottom: 0; }
    .scope-card {
      min-height: 487px;
      padding: 104px 34px 34px;
      box-shadow: none;
    }
    .scope-card::before {
      box-shadow: var(--shadow-table-card);
    }
    .scope-card table {
      border: 0;
      border-radius: 0;
      box-shadow: none;
      background: transparent;
    }
    .scope-table th {
      padding: 0 16px 18px;
      font-size: 12px;
      letter-spacing: 2.8px;
    }
    .scope-table td {
      height: 85px;
      padding: 20px 16px;
      font-size: 22px;
      color: var(--muted);
    }
    .scope-table td:first-child {
      color: var(--brand);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 22px;
      font-weight: 800;
    }
    .scope-table td:nth-child(2) {
      color: var(--ink);
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -.5px;
    }
    .scope-table td:nth-child(3) {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, Manrope, Arial, sans-serif;
      font-size: 22px;
      font-weight: 500;
    }
    .mono {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, Manrope, Arial, sans-serif;
      font-weight: 800;
      color: var(--muted);
      letter-spacing: 0;
    }
    .center { text-align: center; }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-radius: 999px;
      background: var(--brand-tint);
      color: var(--brand);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1.2px;
      text-transform: uppercase;
    }
    .status-pill i,
    .pay-row i {
      width: 8px;
      height: 8px;
      display: inline-block;
      border-radius: 50%;
      background: var(--brand);
    }
    .score-card {
      display: grid;
      grid-template-columns: 132px 1fr;
      gap: 18px;
      align-items: center;
      min-height: 140px;
      padding: 20px;
    }
    .score-card p { margin-top: 8px; color: var(--muted); font-size: 15px; line-height: 1.38; }
    .score-card .ring-sm { width: 132px; height: 132px; }
    .score-card .ring-sm .ring-center strong { font-size: 27px; }
    .score-text.good { color: var(--good); }
    .score-text.warn { color: var(--warn); }
    .score-text.bad { color: var(--bad); }
    .score-text.target { color: var(--faint); }
    .road-track {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 18px;
      align-items: stretch;
    }
    .timeline-viz {
      position: relative;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      margin: 0 38px 8px;
    }
    .timeline-viz::before {
      content: "";
      position: absolute;
      left: 9px;
      right: 9px;
      top: 8px;
      height: 3px;
      border-radius: 999px;
      background: var(--brand);
    }
    .timeline-viz div {
      position: relative;
      z-index: 1;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--brand);
      box-shadow: 0 0 0 5px var(--brand-tint);
    }
    .timeline-viz div:nth-child(2) { justify-self: center; }
    .timeline-viz div:nth-child(3) { justify-self: center; }
    .timeline-viz div:nth-child(4) { justify-self: end; }
    .road-card {
      min-height: 320px;
      padding: 22px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .road-node {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--brand);
      box-shadow: 0 0 0 5px var(--brand-tint);
      margin-bottom: 22px;
    }
    .road-m {
      color: var(--brand);
      font-size: 34px;
      line-height: 1;
      font-weight: 800;
      letter-spacing: -1.5px;
    }
    .road-card h3 { margin-top: 18px; font-size: 20px; }
    .road-card .body { margin-top: 16px; }
    .road-card.dark-panel .road-m,
    .road-card.dark-panel h3 { color: #FFFFFF; }
    .bar-cell,
    .heat-cell {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: center;
      min-width: 170px;
    }
    .bar {
      display: block;
      height: 9px;
      border-radius: 999px;
      background: var(--brand-tint);
      overflow: hidden;
    }
    .bar i {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--brand);
    }
    .bar.good { background: var(--good-tint); }
    .bar.good i { background: var(--good); }
    .bar.warn { background: var(--warn-tint); }
    .bar.warn i { background: var(--warn); }
    .bar.bad { background: var(--bad-tint); }
    .bar.bad i { background: var(--bad); }
    .total-row td {
      border-top: 1.5px solid var(--ink);
      height: 58px;
    }
    .total-row td:first-child {
      color: var(--muted);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      letter-spacing: 1.4px;
      text-transform: uppercase;
    }
    .total-row td:last-child {
      color: var(--ink);
      font-size: 26px;
      font-weight: 800;
      text-align: right;
    }
    .risk-grid,
    .payment-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      align-items: start;
    }
    .blocker-count {
      color: var(--bad);
      font-size: 64px;
      line-height: 1;
      font-weight: 800;
      letter-spacing: -2px;
    }
    .payment-card { min-height: 250px; }
    .payment-card { box-shadow: none; }
    .payment-card::before { box-shadow: var(--shadow-table-card); }
    .stacked-bar {
      display: flex;
      height: 14px;
      margin-top: 24px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--brand-tint);
    }
    .stacked-bar i { display: block; background: var(--brand); }
    .pay-list { margin-top: 36px; }
    .pay-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      padding: 15px 0;
      border-bottom: 1px solid var(--line);
      color: var(--ink);
      font-size: 17px;
      font-weight: 700;
    }
    .pay-row:last-child { border-bottom: 0; }
    .pay-row span {
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }
    .pay-row span i {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
      flex: 0 0 auto;
    }
    .payment-indicator-card {
      min-height: 360px;
      padding: 32px;
    }
    .payment-indicator-card .stacked-bar {
      height: 16px;
      margin-top: 28px;
    }
    .payment-indicator-card .pay-list {
      margin-top: 34px;
    }
    .payment-indicator-card .pay-row {
      min-height: 54px;
      font-size: 18px;
      align-items: center;
    }
    .payment-indicator-card .pay-row strong {
      font-size: 19px;
      color: var(--muted);
    }
    .payment-detail-shell { overflow: hidden; }
    .payment-detail-table { table-layout: fixed; }
    .payment-detail-table th:first-child,
    .payment-detail-table td:first-child {
      width: 190px;
      white-space: nowrap;
    }
    .payment-detail-table th:nth-child(2),
    .payment-detail-table td:nth-child(2) {
      width: 82px;
      text-align: center;
    }
    .payment-detail-table th:nth-child(3),
    .payment-detail-table td:nth-child(3) {
      width: 224px;
    }
    .payment-detail-table th:nth-child(4),
    .payment-detail-table td:nth-child(4) {
      width: auto;
    }
    .payment-amount-wrap {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
    }
    .payment-amount-wrap b {
      font: inherit;
      min-width: 86px;
      text-align: right;
    }
    .row-mini-bar {
      display: block;
      width: 72px;
      height: 8px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--brand-tint);
    }
    .row-mini-bar i {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--brand);
    }
    .portfolio-table tr.highlight td {
      background: var(--brand-tint);
      color: var(--brand-deep);
    }
    .portfolio-table tr.highlight td:first-child { box-shadow: inset 4px 0 0 var(--brand); }
    .portfolio-table th { padding: 10px 12px; font-size: 11px; }
    .portfolio-table td { height: 54px; padding: 8px 12px; font-size: 15px; line-height: 1.18; }
    .portfolio-table td:first-child { font-size: 16px; line-height: 1.15; }
    .portfolio-table .heat-cell { min-width: 145px; }
    .benchmark-table th { padding: 8px 12px; font-size: 10px; }
    .benchmark-table td { height: 38px; padding: 6px 12px; font-size: 14px; line-height: 1.12; }
    .benchmark-table td:first-child { font-size: 15px; }
    .advantage-table th,
    .scope-detail-table th,
    .infrastructure-table th,
    .client-data-table th,
    .team-cost-table th,
    .payment-detail-table th,
    .risk-table th { padding: 9px 14px; font-size: 10px; }
    .advantage-table td,
    .scope-detail-table td,
    .infrastructure-table td,
    .client-data-table td,
    .team-cost-table td,
    .payment-detail-table td,
    .risk-table td { height: 43px; padding: 7px 14px; font-size: 13px; line-height: 1.18; }
    .advantage-table td:first-child,
    .scope-detail-table td:first-child,
    .infrastructure-table td:first-child,
    .client-data-table td:first-child,
    .team-cost-table td:first-child,
    .payment-detail-table td:first-child,
    .risk-table td:first-child { font-size: 14px; }
    .money { text-align: right; }
    .infra-focus-line {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      margin-bottom: 18px;
    }
    .infra-focus-line .card {
      min-height: 108px;
      padding: 24px 28px;
    }
    .infra-focus-line strong {
      display: block;
      margin-top: 14px;
      color: var(--brand);
      font-size: 34px;
      line-height: 1;
      font-weight: 900;
    }
    .infra-focus-line .dark-panel strong { color: #FFFFFF; }
    .infra-cost-table td {
      height: 50px;
      font-size: 15px;
    }
    .infra-cost-table .infra-cost-value {
      color: var(--brand);
      font-size: 17px;
      font-weight: 900;
    }
    .infra-total-strip {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 24px;
      width: 100%;
      margin: 18px 0 0;
      padding: 15px 4px 0;
      border-top: 1px solid var(--line);
      background: transparent;
      box-shadow: none;
    }
    .infra-total-strip span {
      color: var(--faint);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 1.4px;
      text-transform: uppercase;
    }
    .infra-total-strip strong {
      color: var(--brand);
      font-size: 26px;
      line-height: 1;
      font-weight: 900;
    }
    .scope-deadline-shell {
      margin-top: 2px;
    }
    .scope-deadline-table th { font-size: 10px; }
    .scope-deadline-table td {
      height: 33px;
      padding-top: 4px;
      padding-bottom: 4px;
      font-size: 11px;
    }
    .scope-deadline-table td:first-child {
      color: var(--brand);
      font-size: 12px;
      font-weight: 900;
    }
    .scope-deadline-table td:nth-child(2) {
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
    }
    .scope-deadline-table td:nth-child(3) {
      color: var(--ink);
      font-size: 12px;
      font-weight: 900;
    }
    .deadline-cell {
      color: var(--brand-deep);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .team-cost-table .total-row td,
    .payment-detail-table .total-row td { height: 50px; }
    .signature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      align-items: stretch;
    }
    .signature-card {
      min-height: 420px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 34px;
    }
    .signature-card h3 {
      margin-top: 24px;
      font-size: 34px;
      line-height: 1.1;
      letter-spacing: -1px;
    }
    .signature-lines {
      display: grid;
      gap: 28px;
      margin-top: 80px;
    }
    .signature-lines span {
      display: block;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 15px;
      font-weight: 700;
    }
    .dark-panel .signature-lines span { border-color: rgba(255,255,255,.22); color: rgba(255,255,255,.72); }
    .money-focus-grid {
      display: grid;
      grid-template-columns: .82fr 1.18fr;
      gap: 18px;
      align-items: stretch;
    }
    .money-hero {
      min-height: 430px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 40px;
    }
    .money-hero strong,
    .infra-hero strong,
    .scope-board-hero strong {
      display: block;
      margin-top: 22px;
      color: #FFFFFF;
      font-size: 74px;
      line-height: .95;
      letter-spacing: -3px;
      font-weight: 900;
    }
    .money-line {
      display: flex;
      height: 18px;
      margin-top: 34px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(255,255,255,.14);
    }
    .money-line i {
      display: block;
      height: 100%;
      background: var(--brand);
    }
    .role-money-card { min-height: 430px; padding: 28px 32px; }
    .money-role-list { display: grid; gap: 0; margin-top: 18px; }
    .money-role-row {
      display: grid;
      grid-template-columns: 1fr 210px;
      gap: 20px;
      align-items: center;
      min-height: 76px;
      border-bottom: 1px solid var(--line);
    }
    .money-role-row:last-child { border-bottom: 0; }
    .money-role-row h3 { font-size: 19px; }
    .money-role-row p {
      margin-top: 6px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }
    .money-role-amount strong {
      display: block;
      color: var(--ink);
      font-size: 22px;
      text-align: right;
    }
    .money-role-amount .bar { margin-top: 12px; height: 10px; }
    .infra-money-grid,
    .scope-board-grid,
    .advantage-story-grid {
      display: grid;
      grid-template-columns: .78fr 1.22fr;
      gap: 18px;
      align-items: stretch;
    }
    .infra-hero,
    .scope-board-hero,
    .advantage-money-hero {
      min-height: 430px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 38px;
    }
    .infra-cost-cards,
    .scope-board-cards,
    .advantage-story-list {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
      align-content: stretch;
    }
    .infra-cost-card,
    .scope-board-card,
    .advantage-story-card {
      min-height: 132px;
      padding: 20px;
    }
    .infra-cost-card.highlight::before {
      box-shadow: inset 4px 0 0 var(--brand), var(--shadow-text-card);
    }
    .infra-cost-card h3,
    .scope-board-card h3,
    .advantage-story-card h3 {
      margin-top: 12px;
      font-size: 20px;
      line-height: 1.12;
    }
    .infra-cost-card strong {
      display: block;
      margin-top: 14px;
      color: var(--brand);
      font-size: 23px;
      line-height: 1;
      font-weight: 900;
    }
    .infra-cost-card p,
    .advantage-story-card p {
      margin-top: 10px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.3;
      font-weight: 700;
    }
    .scope-board-hero h3,
    .advantage-money-hero h3 {
      margin-top: 20px;
      color: #FFFFFF;
      font-size: 30px;
      line-height: 1.08;
      letter-spacing: -1px;
    }
    .scope-board-card ul {
      display: grid;
      gap: 8px;
      margin: 16px 0 0;
      padding: 0;
      list-style: none;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.28;
      font-weight: 700;
    }
    .scope-board-card li::before {
      content: "";
      display: inline-block;
      width: 6px;
      height: 6px;
      margin-right: 8px;
      border-radius: 999px;
      background: var(--brand);
      vertical-align: 2px;
    }
    .road-track.three,
    .timeline-viz.three { grid-template-columns: repeat(3, 1fr); }
    .timeline-viz.three div:nth-child(2) { justify-self: center; }
    .timeline-viz.three div:nth-child(3) { justify-self: end; }
    .benchmark-score-grid { gap: 16px; }
    .benchmark-score-grid .score-card {
      min-height: 112px;
      grid-template-columns: 104px 1fr;
      padding: 14px;
    }
    .benchmark-score-grid .score-card .ring-sm { width: 104px; height: 104px; }
    .benchmark-score-grid .score-card .ring-sm .ring-center strong { font-size: 22px; }
    .benchmark-score-grid .score-card h3 { font-size: 18px; }
    .benchmark-score-grid .score-card p { font-size: 13px; line-height: 1.25; }
    .this-chip {
      margin-left: 8px;
      padding: 4px 7px;
      border-radius: 6px;
      background: var(--brand);
      color: #FFFFFF;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1px;
    }
    .slide-foot {
      align-items: center;
      padding-top: 14px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 15px;
      font-weight: 500;
    }
    .commercial-grid,
    .problem-solution-grid,
    .diagram-grid,
    .price-grid,
    .source-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      align-items: stretch;
    }
    .research-card {
      padding: 28px;
      min-height: 180px;
    }
    .research-card h3 {
      font-size: 24px;
      line-height: 1.08;
      letter-spacing: 0;
      margin: 12px 0 14px;
    }
    .research-card p,
    .research-card li {
      color: var(--muted);
      font-size: 16px;
      line-height: 1.35;
    }
    .research-card ul {
      margin: 14px 0 0;
      padding-left: 18px;
    }
    .metric-triplet {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-top: 18px;
    }
    .metric-triplet .card {
      min-height: 150px;
      padding: 24px;
    }
    .metric-triplet strong {
      display: block;
      margin-top: 12px;
      font-size: 30px;
      letter-spacing: 0;
      color: var(--ink);
    }
    .flow-row {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 14px;
      align-items: center;
    }
    .flow-node {
      min-height: 132px;
      padding: 20px;
      text-align: center;
    }
    .flow-node h3 {
      font-size: 18px;
      line-height: 1.12;
      margin-top: 10px;
    }
    .flow-node p {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.28;
      margin-top: 10px;
    }
    .mindmap-grid {
      display: grid;
      grid-template-columns: 1.15fr 1fr 1fr;
      gap: 18px;
      align-items: stretch;
    }
    .mindmap-root {
      min-height: 360px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 34px;
    }
    .mindmap-root strong {
      color: #FFFFFF;
      font-size: 38px;
      line-height: 1.05;
      letter-spacing: 0;
    }
    .module-chip-list {
      display: grid;
      gap: 12px;
    }
    .module-chip {
      padding: 15px 18px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: #FFFFFF;
      font-size: 16px;
      font-weight: 800;
      color: var(--ink);
    }
    .swot-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .swot-card {
      min-height: 170px;
      padding: 26px;
    }
    .swot-card h3 {
      font-size: 22px;
      margin: 12px 0;
    }
    .source-list {
      display: grid;
      gap: 10px;
      max-height: 520px;
      overflow: hidden;
    }
    .source-row {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 14px;
      padding: 13px 0;
      border-bottom: 1px solid var(--line);
      font-size: 14px;
      color: var(--muted);
    }
    .source-row strong {
      color: var(--ink);
      font-size: 13px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <section class="slide cover">
    <div class="cover-top">
      <div class="brand"><i></i><span>${escapeHtml(brandTitle)}</span><span>SAI · COMMERCIAL KP</span></div>
      <div class="page-num">${escapeHtml(today)} · 01 / ${String(totalPages).padStart(2, "0")}</div>
    </div>
    <div class="cover-body">
      <div>
        <div class="cover-kicker">COMMERCIAL · KP</div>
        <h1>${escapeHtml(title)}</h1>
        <p class="lead">Commercial proposal generated from project scope, budget, client requirements and Udevs delivery examples.</p>
        <p class="cover-meta"><span class="mono">Analog:</span> ${escapeHtml(projectAnalog(main))} · <span class="mono">Source:</span> ${escapeHtml(main.source || "Project card")}${isPortfolioMode ? ` · <span class="mono">Portfolio:</span> ${escapeHtml(portfolioProjects.map((project) => project.title).join(", "))}` : ""}</p>
      </div>
      <div class="card cover-score">
        <div class="micro">Proposal fit</div>
        ${svgRing(main.readiness_score, "READY", "lg", "brand")}
        <div class="bench"><span class="micro">Benchmark</span><b>${escapeHtml(projectAnalog(main))}</b></div>
      </div>
    </div>
    <div class="metric-row">
      <div class="card stat-tile"><div class="micro">Budget</div><strong class="mono">${escapeHtml(fmtUsd(main.budget_usd))}</strong></div>
      <div class="card stat-tile"><div class="micro">Timeline</div><strong class="mono">${escapeHtml(durationLabel(main.duration_months))}</strong></div>
      <div class="card stat-tile"><div class="micro">Scope</div><strong class="mono">${escapeHtml(String(main.scope_count))} modules</strong></div>
      <div class="card dark-panel brief"><div class="micro">Project brief · original</div><p>${escapeHtml(prompt)}</p></div>
    </div>
    ${pageFooter("Generated by Asadbek AI")}
  </section>

  <section class="slide">
    ${pageHeader("EXECUTIVE SUMMARY", 2, model.brief.type, totalPages)}
    ${commercialSummaryPage(model)}
    ${pageFooter("Commercial summary is generated after call, brand, market and analog evidence collection.")}
  </section>

  <section class="slide">
    ${pageHeader("PROBLEM & SOLUTION", 3, "why now", totalPages)}
    ${problemSolutionPage(model)}
    ${pageFooter("The proposal focuses on the business problem, not a raw research log.")}
  </section>

  <section class="slide">
    ${pageHeader("TAM / SAM / SOM", 4, "market model", totalPages)}
    ${tamSamSomPage(model)}
    ${pageFooter("Market sizing uses source-backed assumptions and formula, not hidden magic numbers.")}
  </section>

  <section class="slide">
    ${pageHeader("PRODUCT MIND MAP", 5, `${model.scope.length} blocks`, totalPages)}
    ${mindMapPage(model)}
    ${pageFooter("Mind map is derived from scope, transcript requirements and analog research.")}
  </section>

  <section class="slide">
    ${pageHeader("BPMN / USER FLOW", 6, "core process", totalPages)}
    ${bpmnPage(model)}
    ${pageFooter("Core business flow shown as an implementation-ready process outline.")}
  </section>

  <section class="slide">
    ${pageHeader("INFRASTRUCTURE DIAGRAM", 7, "system architecture", totalPages)}
    ${infrastructureDiagramPage(model)}
    ${pageFooter("Infrastructure and third-party services are separated from development price.")}
  </section>

  <section class="slide">
    ${pageHeader("SWOT ANALYSIS", 8, "commercial risk", totalPages)}
    ${swotPage(model)}
    ${pageFooter("SWOT is produced from product scope, integrations, research and assumptions.")}
  </section>

  <section class="slide">
    ${pageHeader("FUNCTION PRICE", 9, fmtUsd(model.pricing.projectPrice), totalPages)}
    ${functionPricePage(model)}
    ${pageFooter(`Function price total equals project price: ${model.validation.functionPriceMatchesProject ? "OK" : "CHECK"}.`)}
  </section>

  <section class="slide">
    ${pageHeader("DESIGN PROJECT", 10, model.brandProfile.tone, totalPages)}
    ${designProjectPage(model)}
    ${pageFooter("Brandbook/current-site interpretation is applied to visual direction before rendering.")}
  </section>

  <section class="slide">
    ${pageHeader("TEAM SIZE", 11, fmtUsd(model.pricing.projectPrice), totalPages)}
    ${teamSizePage(model)}
    ${pageFooter(`Development team total is tied to the proposal price: ${fmtUsd(sumMoney(model.teamPlan, "total"))}.`)}
  </section>

  <section class="slide">
    ${pageHeader("PROJECT PRICE", 12, "development + external", totalPages)}
    ${projectPricePage(model)}
    ${pageFooter("External costs and exclusions are explicit; they are not hidden in development budget.")}
  </section>

  <section class="slide">
    ${pageHeader("PAYMENT STAGES / SCHEDULE", 13, "milestones", totalPages)}
    ${paymentStagesPage(model)}
    ${pageFooter(`Payment stages total equals project price: ${model.validation.paymentsMatchProject ? "OK" : "CHECK"}.`)}
  </section>

  <section class="slide">
    ${pageHeader("ROADMAP", 14, model.brief.duration, totalPages)}
    ${roadmapPage(model)}
    ${pageFooter("Roadmap connects scope, active team and acceptance rhythm.")}
  </section>

  <section class="slide">
    ${pageHeader("APPENDIX / SOURCES", 15, `${model.validation.sourceCount} sources`, totalPages)}
    ${sourcesPage(model)}
    ${pageFooter("Compact source list only; research pages are not dumped into the proposal.")}
  </section>
</body>
</html>`;
}

function buildRichPdfHtml({ question, selected, allProjects, theme = "flat", themeTokens = {}, proposalModel = null }) {
  return buildStrictLodifyPdfHtml({ question, selected, allProjects, theme, themeTokens, proposalModel });

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const mainProject = selected.length === 1 ? selected[0] : null;
  const title = mainProject ? `${mainProject.title} KP proposal` : "Project KP Portfolio";
  const portfolioProjects = [...selected, ...allProjects.filter((project) => !selected.some((item) => item.key === project.key))];
  const portfolioRows = portfolioProjects
    .map((project) => [
      project.title,
      fmtUsd(project.budget_usd),
      `${fmtNumber(project.duration_months)} mo`,
      `${project.scope_count}`,
      `${project.blocker_count}`,
      `${Math.round(project.kpi_score)}%`,
    ])
    .sort((a, b) => Number(String(b[5]).replace("%", "")) - Number(String(a[5]).replace("%", "")));
  const details = mainProject ? [mainProject] : selected;
  const main = mainProject || portfolioProjects[0];
  const cards = richMetricCards(main);
  const prompt = promptBrief(question);
  const accentScope = topEntries(main.scope_by_epic, 6);
  const roadmap = roadmapRows(main).slice(0, 5);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700;800&family=Manrope:wght@500;600;700;800&display=swap");
    @page { size: 1440px 810px; margin: 0; }
    * { box-sizing: border-box; }
    :root {
      --page: #F3F6FA;
      --ink: #111827;
      --brand: #3155FF;
      --brand-tint: #E9EFFF;
      --brand-deep: #1D4ED8;
      --muted: #5F6F85;
      --faint: #94A0B3;
      --line: #DCE4EE;
      --good: #12A471;
      --good-tint: #EAF6F0;
      --warn: #E0A300;
      --warn-tint: #FBF2DF;
      --bad: #E04F4F;
      --bad-tint: #FBE9E9;
      --shadow-table-card: 0 14px 36px -26px rgba(16,24,40,0.3);
      --shadow-text-card: 0 10px 30px -22px rgba(16,24,40,0.25);
      --shadow-cover-hero: 0 1px 2px rgba(16,24,40,0.04), 0 20px 44px -28px rgba(16,24,40,0.3);
    }
    body {
      margin: 0;
      font-family: Manrope, -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Arial, sans-serif;
      color: var(--ink);
      background: var(--page);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .slide {
      width: 1440px;
      height: 810px;
      padding: 56px 72px 64px;
      page-break-after: always;
      position: relative;
      overflow: hidden;
      background: var(--page);
    }
    .slide:last-child { page-break-after: auto; }
    .dark { color: var(--ink); background: var(--page); }
    .dark::before {
      content: "";
      position: absolute;
      inset: 0;
      display: none;
      pointer-events: none;
    }
    .cream { background: var(--page); }
    .grid {
      display: grid;
      gap: 18px;
    }
    .cols-2 { grid-template-columns: 1fr 1fr; }
    .cols-3 { grid-template-columns: repeat(3, 1fr); }
    .cols-5 { grid-template-columns: repeat(5, 1fr); }
    .kicker {
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      color: var(--brand);
    }
    .kicker::before {
      content: "";
      display: inline-block;
      width: 26px;
      height: 3px;
      border-radius: 3px;
      background: var(--brand);
    }
    .dark .kicker { color: var(--brand); }
    h1, h2, h3, p { margin: 0; }
    h1 {
      max-width: 760px;
      margin-top: 24px;
      font-size: 62px;
      line-height: 1.02;
      font-weight: 800;
      letter-spacing: -1.8px;
    }
    h2 {
      max-width: 860px;
      margin-top: 16px;
      font-size: 40px;
      line-height: 1.08;
      font-weight: 800;
      letter-spacing: -.8px;
    }
    h3 {
      font-size: 19px;
      line-height: 1.18;
      font-weight: 700;
    }
    .lead {
      max-width: 660px;
      margin-top: 26px;
      font-size: 23px;
      line-height: 1.5;
      color: var(--muted);
      font-weight: 500;
    }
    .dark .lead { color: var(--muted); }
    .hero-layout {
      height: 100%;
      display: grid;
      grid-template-columns: 1.08fr .92fr;
      gap: 52px;
      align-items: center;
      position: relative;
      z-index: 1;
    }
    .hero-panel {
      border: 1px solid var(--line);
      background: #FFFFFF;
      border-radius: 20px;
      padding: 28px;
      box-shadow: var(--shadow-cover-hero);
      position: relative;
      overflow: hidden;
    }
    .spec-list {
      border: 1px solid var(--line);
      border-radius: 16px;
      overflow: hidden;
      background: #FFFFFF;
    }
    .spec-row {
      display: grid;
      grid-template-columns: 145px 1fr;
      gap: 18px;
      min-height: 60px;
      padding: 15px 18px;
      border-bottom: 1px solid var(--line);
      align-items: center;
    }
    .spec-row:nth-child(1),
    .spec-row:nth-child(4) { background: var(--brand-tint); }
    .spec-row:last-child { border-bottom: 0; }
    .spec-label {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1.1;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.4px;
      color: var(--faint);
    }
    .spec-value {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 20px;
      line-height: 1.08;
      font-weight: 700;
      color: var(--ink);
    }
    .metric-card {
      min-height: 128px;
      border-radius: 18px;
      padding: 22px;
      background: #FFFFFF;
      border: 1px solid var(--line);
      box-shadow: var(--shadow-text-card);
    }
    .dark .metric-card {
      color: var(--ink);
      background: #FFFFFF;
      border-color: var(--line);
    }
    .metric-card.hot {
      background: var(--ink);
      color: #FFFFFF;
      border-color: var(--ink);
    }
    .metric-card.teal {
      background: var(--brand);
      color: #FFFFFF;
      border-color: var(--brand);
    }
    .metric-card.amber {
      background: #FFFFFF;
      border-color: var(--line);
      color: var(--ink);
    }
    .label {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.15;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--faint);
    }
    .metric-card.hot .label { color: rgba(255,255,255,.68); }
    .metric-card.teal .label { color: rgba(255,255,255,.70); }
    .dark .label { color: var(--faint); }
    .metric-card.amber .label { color: var(--faint); }
    .value {
      margin-top: 14px;
      font-size: 30px;
      line-height: 1.04;
      font-weight: 800;
      letter-spacing: -1px;
    }
    .hint {
      margin-top: 10px;
      font-size: 15px;
      line-height: 1.25;
      color: var(--muted);
    }
    .metric-card.hot .hint { color: rgba(255,255,255,.70); }
    .metric-card.teal .hint { color: rgba(255,255,255,.74); }
    .dark .hint, .metric-card.amber .hint { color: var(--muted); }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 32px;
      margin-bottom: 28px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 9px 16px;
      border-radius: 999px;
      background: var(--brand-tint);
      color: var(--brand);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      white-space: nowrap;
    }
    .card {
      border-radius: 18px;
      padding: 26px;
      background: #FFFFFF;
      border: 1px solid var(--line);
      box-shadow: var(--shadow-text-card);
      position: relative;
      overflow: hidden;
    }
    .card.blue {
      background: var(--ink);
      color: #FFFFFF;
      border-color: var(--ink);
    }
    .card.green {
      background: var(--brand);
      color: #FFFFFF;
      border-color: var(--brand);
    }
    .card.darkcard {
      background: var(--ink);
      color: #FFFFFF;
    }
    .card.warm {
      background: #FFFFFF;
      border-color: var(--line);
    }
    .body-text {
      margin-top: 14px;
      font-size: 17px;
      line-height: 1.52;
      color: var(--muted);
      font-weight: 500;
    }
    .blue .body-text, .darkcard .body-text { color: rgba(255,255,255,.78); }
    .green .body-text { color: rgba(255,255,255,.78); }
    table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 18px;
      background: #FFFFFF;
      border: 1px solid var(--line);
      box-shadow: var(--shadow-table-card);
    }
    th, td {
      text-align: left;
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
      font-size: 17px;
      line-height: 1.24;
      vertical-align: top;
      color: var(--muted);
      font-weight: 600;
    }
    th {
      background: #FFFFFF;
      color: var(--faint);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      border-bottom: 1.5px solid var(--line);
    }
    td:first-child {
      color: var(--ink);
      font-weight: 700;
    }
    td:not(:first-child) {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 15px;
    }
    tr:last-child td { border-bottom: 0; }
    table.dense th, table.dense td { font-size: 14px; padding: 12px 14px; }
    table.dense th { font-size: 11px; }
    .pill-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 20px;
    }
    .pill {
      padding: 9px 13px;
      border-radius: 999px;
      background: var(--brand-tint);
      border: 1px solid transparent;
      color: var(--brand);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.15;
      font-weight: 700;
      letter-spacing: .4px;
    }
    .timeline {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 18px;
      align-items: stretch;
    }
    .timeline.steps-1 { grid-template-columns: 1fr; }
    .timeline.steps-2 { grid-template-columns: repeat(2, 1fr); }
    .timeline.steps-3 { grid-template-columns: repeat(3, 1fr); }
    .timeline.steps-4 { grid-template-columns: repeat(4, 1fr); }
    .step {
      min-height: 402px;
      border-radius: 18px;
      padding: 28px;
      background: #FFFFFF;
      border: 1px solid var(--line);
    }
    .timeline.steps-3 .step { min-height: 430px; }
    .step:nth-child(1) {
      background: var(--ink);
      color: #FFFFFF;
      border-color: var(--ink);
    }
    .step:nth-child(2) {
      background: var(--brand);
      color: #FFFFFF;
      border-color: var(--brand);
    }
    .step:nth-child(3) {
      background: var(--brand-tint);
      border-color: var(--line);
    }
    .step:nth-child(4) {
      background: #FFFFFF;
      border-color: var(--line);
    }
    .step:nth-child(5) {
      background: #FFFFFF;
      border-color: var(--line);
    }
    .step-title {
      margin-top: 22px;
      font-size: 30px;
      font-weight: 800;
      letter-spacing: -1px;
    }
    .step-meta {
      margin-top: 18px;
      font-size: 16px;
      line-height: 1.5;
      color: var(--muted);
    }
    .step:nth-child(1) .label,
    .step:nth-child(1) .step-meta { color: rgba(255,255,255,.72); }
    .step:nth-child(2) .label,
    .step:nth-child(2) .step-meta { color: rgba(255,255,255,.74); }
    .footer {
      position: absolute;
      left: 72px;
      right: 72px;
      bottom: 34px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 14px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 15px;
      font-weight: 500;
    }
    .footer span:last-child {
      color: var(--faint);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .dark .footer { color: var(--muted); }
    .small-note {
      font-size: 15px;
      line-height: 1.52;
      color: var(--muted);
      font-weight: 500;
    }
    .dark .small-note { color: var(--muted); }
    .brand-head {
      position: absolute;
      top: 60px;
      left: 72px;
      display: flex;
      align-items: center;
      gap: 13px;
      font-size: 17px;
      font-weight: 800;
      letter-spacing: .03em;
    }
    .brand-dot { width: 11px; height: 11px; background: var(--brand); border-radius: 3px; }
    .brand-sub {
      margin-left: 8px;
      color: var(--faint);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      letter-spacing: .33em;
      font-weight: 500;
    }
    .cover-main { position: absolute; left: 72px; top: 164px; }
    .cover-kicker {
      display: inline-flex;
      padding: 10px 14px;
      border-radius: 999px;
      background: var(--brand-tint);
      color: var(--brand);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .32em;
      text-transform: uppercase;
    }
    .cover-title { margin-top: 26px; max-width: 560px; }
    .cover-meta {
      margin-top: 26px;
      color: var(--muted);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      letter-spacing: .16em;
    }
    .cover-score {
      position: absolute;
      right: 86px;
      top: 154px;
      width: 506px;
      height: 360px;
      padding: 36px 33px;
    }
    .cover-score .donut { margin: 22px auto 24px; }
    .bench-row {
      display: flex;
      justify-content: space-between;
      border-top: 1px solid var(--line);
      padding-top: 22px;
      color: var(--muted);
      font-size: 14px;
    }
    .stat-row {
      position: absolute;
      left: 72px;
      right: 72px;
      bottom: 118px;
      display: grid;
      grid-template-columns: 255px 255px 255px 1fr;
      gap: 16px;
    }
    .stat {
      height: 106px;
      padding: 23px;
      background: #FFFFFF;
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow-text-card);
    }
    .stat strong {
      display: block;
      margin-top: 14px;
      font-size: 30px;
      letter-spacing: -.04em;
    }
    .brief {
      height: 106px;
      padding: 22px 24px;
      background: var(--ink);
      color: rgba(255,255,255,.86);
      border-radius: 18px;
      font-size: 14px;
      line-height: 1.45;
    }
    .micro {
      color: var(--faint);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      letter-spacing: .28em;
      text-transform: uppercase;
    }
    .brief .micro { color: rgba(255,255,255,.45); margin-bottom: 11px; }
    .donut {
      width: 160px;
      height: 160px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: conic-gradient(var(--brand) calc(var(--p) * 1%), #E5EBF4 0);
      position: relative;
    }
    .donut::after {
      content: "";
      position: absolute;
      inset: 18px;
      border-radius: 50%;
      background: #FFFFFF;
    }
    .donut > div { position: relative; z-index: 1; text-align: center; }
    .donut strong { display: block; font-size: 48px; line-height: .9; letter-spacing: -.04em; }
    .donut small { font-size: 22px; color: var(--muted); }
    .donut span {
      display: block;
      margin-top: 9px;
      color: var(--faint);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      letter-spacing: .28em;
    }
    .score-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 18px;
      margin-top: 24px;
    }
    .score-card {
      display: grid;
      grid-template-columns: 118px 1fr;
      gap: 20px;
      align-items: center;
      min-height: 142px;
      padding: 22px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: #FFFFFF;
      box-shadow: var(--shadow-text-card);
    }
    .score-card p {
      margin-top: 8px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.45;
    }
    .ring {
      width: 104px;
      height: 104px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      position: relative;
      background: conic-gradient(var(--brand) calc(var(--p) * 1%), var(--line) 0);
    }
    .score-card.good .ring { background: conic-gradient(var(--good) calc(var(--p) * 1%), var(--line) 0); }
    .score-card.warn .ring { background: conic-gradient(var(--warn) calc(var(--p) * 1%), var(--line) 0); }
    .score-card.bad .ring { background: conic-gradient(var(--bad) calc(var(--p) * 1%), var(--line) 0); }
    .ring::after {
      content: "";
      position: absolute;
      inset: 12px;
      border-radius: 50%;
      background: #FFFFFF;
    }
    .ring strong {
      position: relative;
      z-index: 1;
      font-size: 30px;
      font-weight: 800;
      letter-spacing: -1px;
    }
    .ring small { font-size: 15px; color: var(--muted); }
    ${kpiThemeCss(theme)}
  </style>
</head>
<body class="theme-${escapeHtml(theme)}">
  <section class="slide dark">
    <div class="brand-head"><span class="brand-dot"></span><span>${escapeHtml(main.title.toUpperCase())}</span><span class="brand-sub">SAI · COMMERCIAL KP</span></div>
    <div class="footer" style="top:62px;bottom:auto;border-top:0;padding-top:0;justify-content:flex-end"><span></span><span>${escapeHtml(today)} · 01 / 08</span></div>
    <div class="cover-main">
      <div class="cover-kicker">COMMERCIAL · KP</div>
      <h1 class="cover-title">${escapeHtml(title)}</h1>
      <p class="lead">Commercial proposal generated from project scope, budget, client requirements and Udevs delivery examples.</p>
      <div class="cover-meta">Analog: ${escapeHtml(projectAnalog(main))} &nbsp; · &nbsp; Source: ${escapeHtml(main.source || "Project card")}</div>
    </div>
    <div class="cover-score hero-panel">
      <div class="micro">PROPOSAL FIT</div>
      <div class="donut" style="--p:${Math.round(main.readiness_score)}"><div><strong>${Math.round(main.readiness_score)}<small>%</small></strong><span>READY</span></div></div>
      <div class="bench-row"><span class="micro">BENCHMARK</span><b>${escapeHtml(projectAnalog(main))}</b></div>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="micro">BUDGET</div><strong>${escapeHtml(fmtUsd(main.budget_usd))}</strong></div>
      <div class="stat"><div class="micro">TIMELINE</div><strong>${escapeHtml(durationLabel(main.duration_months))}</strong></div>
      <div class="stat"><div class="micro">SCOPE</div><strong>${escapeHtml(String(main.scope_count))} modules</strong></div>
      <div class="brief"><div class="micro">PROJECT BRIEF · ORIGINAL</div>${escapeHtml(prompt)}</div>
    </div>
    <div class="footer"><span>Generated by Asadbek AI</span><span>01 / Proposal KP</span></div>
  </section>

  <section class="slide cream">
    <div class="section-head">
      <div>
        <div class="kicker">PROJECT OVERVIEW · 02</div>
        <h2>What we understood and what we propose.</h2>
      </div>
      <div class="tag">${escapeHtml(projectAnalog(main))}</div>
    </div>
    <div class="grid cols-3">
      <div class="card blue"><h3>Product thesis</h3><p class="body-text">${escapeHtml(main.title)} is packaged as a commercial proposal with clear MVP scope, delivery stages and acceptance checkpoints.</p></div>
      <div class="card green"><h3>Delivery model</h3><p class="body-text">${escapeHtml(durationLabel(main.duration_months))} delivery window with weekly demos, acceptance checkpoints and release-readiness gates.</p></div>
      <div class="card warm"><h3>Commercial control</h3><p class="body-text">Budget ${escapeHtml(fmtUsd(main.budget_usd))}, payment milestones and client-side blockers must be tracked together to avoid hidden delivery risk.</p></div>
    </div>
    <div class="grid cols-2" style="margin-top:28px">
      <div class="card"><h3>Main scope groups</h3><div class="pill-list">${accentScope.map((item) => `<div class="pill">${escapeHtml(item.name)} · ${escapeHtml(item.count)}</div>`).join("")}</div></div>
      <div class="card"><h3>Proposal logic</h3><p class="body-text">Scope, team, payment stages and client approvals are shown together before development starts.</p></div>
    </div>
    <div class="footer"><span>Same project data, richer presentation layer</span><span>02</span></div>
  </section>

  <section class="slide">
    <div class="section-head">
      <div>
        <div class="kicker">SCOPE MAP · 03</div>
        <h2>Functional blocks that define MVP delivery.</h2>
      </div>
      <div class="tag">${escapeHtml(main.scope_count)} scope items</div>
    </div>
    ${richTable(["#", "Scope item", "Block", "Status"], scopeRows(main, 14), "dense")}
    <div class="footer"><span>Scope is parsed from prompt or project card and grouped by delivery block.</span><span>03</span></div>
  </section>

  <section class="slide cream">
    <div class="section-head">
      <div>
        <div class="kicker">PROPOSAL STRUCTURE · 04</div>
        <h2>Commercial proposal connects scope, team, payment and acceptance.</h2>
      </div>
      <div class="tag">${Math.round(main.readiness_score)}% ready</div>
    </div>
    ${richTable(["KP area", "Score / Target", "What it controls", "Pass condition"], richKpiRows(main))}
    <div class="score-grid">
      ${scoreRing("Commercial", main.commercial_score, "budget, analog, payment value")}
      ${scoreRing("Complexity", main.complexity_score, "scope, team, integrations")}
      ${scoreRing("Readiness", main.readiness_score, "client blockers and approvals")}
    </div>
    <div class="footer"><span>KP is not raw text. It is operating control for sales, delivery and client acceptance.</span><span>04</span></div>
  </section>

  <section class="slide">
    <div class="section-head">
      <div>
        <div class="kicker">ROADMAP · 05</div>
        <h2>Delivery plan by milestone.</h2>
      </div>
      <div class="tag">${escapeHtml(durationLabel(main.duration_months))}</div>
    </div>
    <div class="timeline steps-${roadmap.length}">
      ${roadmap.map((row) => `<div class="step"><div class="label">${escapeHtml(row[0])}</div><div class="step-title">${escapeHtml(row[1])}</div><div class="step-meta">${escapeHtml(row[2])}</div><div class="step-meta"><b>Exit:</b> ${escapeHtml(row[3])}</div></div>`).join("")}
    </div>
    <div class="footer"><span>Timeline is generated from project duration and scope density.</span><span>05</span></div>
  </section>

  <section class="slide cream">
    <div class="section-head">
      <div>
        <div class="kicker">TEAM AND COST · 06</div>
        <h2>Role plan and cost structure.</h2>
      </div>
      <div class="tag">${escapeHtml(fmtUsd(main.budget_usd))}</div>
    </div>
    ${richTable(["Role", "Qty", "Months", "Rate", "Cost"], main.estimate.slice(0, 9).map((row) => [row.role, fmtNumber(row.qty), fmtNumber(row.months), fmtUsd(row.rate), fmtUsd(row.total)]))}
    <div class="footer"><span>Cost split is generated from project scope, timeline and delivery roles.</span><span>06</span></div>
  </section>

  <section class="slide">
    <div class="section-head">
      <div>
        <div class="kicker">RISKS AND ACCEPTANCE · 07</div>
        <h2>What must be controlled before KP starts.</h2>
      </div>
      <div class="tag">${escapeHtml(main.blocker_count)} blockers</div>
    </div>
    <div class="grid cols-2">
      <div class="card darkcard">
        <h3>Client blockers</h3>
        <div class="grid" style="margin-top:22px; gap:16px">
          ${(main.blockers || []).slice(0, 8).map((item) => `<div class="body-text">- ${escapeHtml(item.name)}: ${escapeHtml(item.status)}</div>`).join("") || `<div class="body-text">- No critical blocker found.</div>`}
        </div>
      </div>
      <div>
        ${richTable(["Gate", "Acceptance rule"], acceptanceRows(main), "dense")}
      </div>
    </div>
    <div class="footer"><span>Risk KP starts after acceptance rules are explicit.</span><span>07</span></div>
  </section>

  <section class="slide cream">
    <div class="section-head">
      <div>
        <div class="kicker">PAYMENT AND PORTFOLIO · 08</div>
        <h2>Payment schedule and benchmark context.</h2>
      </div>
      <div class="tag">Commercial view</div>
    </div>
    <div class="grid cols-2">
      <div>${richTable(["Milestone", "Amount"], (main.payments || []).map((row) => [row.period, fmtUsd(row.amount)]))}</div>
      <div>${richTable(["Project", "Budget", "Duration", "Scope", "Blockers", "KP"], portfolioRows.slice(0, 6), "dense")}</div>
    </div>
    <div class="footer"><span>Payment, delivery and KP score are shown together so management can decide faster.</span><span>08</span></div>
  </section>

  ${details.filter((project) => !mainProject || project.key !== mainProject.key).map((project, index) => `
    <section class="slide">
      <div class="section-head">
        <div>
          <div class="kicker">PROJECT DETAIL · ${String(index + 9).padStart(2, "0")}</div>
          <h2>${escapeHtml(project.title)}</h2>
        </div>
        <div class="tag">${Math.round(project.kpi_score)}% KP</div>
      </div>
      ${richTable(["Metric", "Value", "Meaning"], kpiRows(project))}
      <div class="footer"><span>Portfolio detail page</span><span>${String(index + 9).padStart(2, "0")}</span></div>
    </section>
  `).join("")}
</body>
</html>`;
}

function buildPdfHtml({ question, selected, allProjects, theme = "flat", themeTokens = {}, proposalModel = null }) {
  return buildPremiumProposalHtml({ question, selected, allProjects, themeTokens, proposalModel });

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const main = selected.length === 1 ? buildKpiNarrative(selected[0]) : null;
  const title = main ? `${main.title} KP` : "Project KP Portfolio";
  const subtitle = main
    ? "Project card logic, commercial proposal and delivery risk converted into KP plan."
    : "Cross-project KP comparison from Udevs project cards and commercial proposal examples.";
  const portfolioProjects = [...selected, ...allProjects.filter((project) => !selected.some((item) => item.key === project.key))];
  const portfolioRows = portfolioProjects
    .map((project) => [
      project.title,
      fmtUsd(project.budget_usd),
      `${fmtNumber(project.duration_months)} mo`,
      `${project.scope_count}`,
      `${project.blocker_count}`,
      `${Math.round(project.kpi_score)}%`,
    ])
    .sort((a, b) => Number(String(b[5]).replace("%", "")) - Number(String(a[5]).replace("%", "")));

  const details = main ? [main] : selected.map(buildKpiNarrative);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: 1920px 1080px; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, "Helvetica Neue", Arial, sans-serif;
      color: #1F2A44;
      background: #F8FAFC;
    }
    .slide {
      width: 1920px;
      height: 1080px;
      padding: 120px 144px;
      page-break-after: always;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 56px;
      position: relative;
      overflow: hidden;
    }
    .slide:last-child { page-break-after: auto; }
    .kicker {
      color: #687281;
      font-size: 24px;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: .1em;
      text-transform: uppercase;
    }
    .accent { color: #2D5C5F; }
    h1 {
      margin: 0;
      max-width: 1350px;
      font-size: 104px;
      line-height: 1.04;
      letter-spacing: -0.028em;
      font-weight: 760;
    }
    h2 {
      margin: 0;
      font-size: 74px;
      line-height: 1.08;
      letter-spacing: -0.022em;
      font-weight: 720;
    }
    .subtitle {
      margin: 24px 0 0;
      max-width: 1220px;
      font-size: 38px;
      line-height: 1.22;
      color: #5B6472;
      font-weight: 400;
    }
    .meta {
      position: absolute;
      left: 144px;
      right: 144px;
      bottom: 80px;
      display: flex;
      justify-content: space-between;
      color: #687281;
      font-size: 22px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 24px;
      max-width: 1580px;
    }
    .card {
      min-height: 170px;
      border-radius: 28px;
      padding: 34px;
      background: #F1F5F9;
    }
    .card.primary {
      background: #1F2A44;
      color: #FFFFFF;
    }
    .label {
      color: #687281;
      font-size: 20px;
      line-height: 1.2;
      text-transform: uppercase;
      letter-spacing: .09em;
      font-weight: 760;
    }
    .primary .label { color: rgba(255,255,255,.75); }
    .value {
      margin-top: 18px;
      font-size: 38px;
      line-height: 1.08;
      font-weight: 720;
      letter-spacing: -0.015em;
    }
    .insight {
      max-width: 1320px;
      font-size: 52px;
      line-height: 1.13;
      letter-spacing: -0.018em;
      font-weight: 650;
    }
    .split {
      display: grid;
      grid-template-columns: 0.88fr 1.12fr;
      gap: 72px;
      align-items: start;
    }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      border: 1px solid #C9DADC;
      border-radius: 20px;
      overflow: hidden;
      background: #FFFFFF;
    }
    th, td {
      text-align: left;
      padding: 20px 24px;
      border-right: 1px solid #C9DADC;
      border-bottom: 1px solid #C9DADC;
      font-size: 27px;
      line-height: 1.18;
      vertical-align: top;
    }
    th {
      background: #EEF6F5;
      font-weight: 700;
    }
    tr:last-child td { border-bottom: 0; }
    th:last-child, td:last-child { border-right: 0; }
    table.compact th, table.compact td { font-size: 23px; padding: 16px 18px; }
    .note {
      color: #5B6472;
      font-size: 22px;
      line-height: 1.35;
      max-width: 980px;
      margin-top: 24px;
    }
    .list {
      display: grid;
      gap: 18px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .list li {
      background: #F1F5F9;
      border-radius: 22px;
      padding: 24px 30px;
      font-size: 27px;
      line-height: 1.22;
    }
  </style>
</head>
<body>
  <section class="slide">
    <div>
      <div class="kicker accent">UDEVS KP REPORT · ${escapeHtml(today)}</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
    </div>
    ${main ? `<div class="cards">${main.summary
      .map((item, index) => `<div class="card ${index === 0 ? "primary" : ""}"><div class="label">${escapeHtml(item[0])}</div><div class="value">${escapeHtml(item[1])}</div></div>`)
      .join("")}</div>` : ""}
    <div class="meta">
      <span>${escapeHtml(question)}</span>
      <span>Generated by Asadbek AI</span>
    </div>
  </section>

  <section class="slide">
    <div>
      <div class="kicker">PORTFOLIO KP · 01</div>
      <h2>Which project deserves focus first.</h2>
    </div>
    ${makeTable(["Project", "Budget", "Duration", "Scope", "Blockers", "KP"], portfolioRows, { compact: true })}
    <div class="note">KP score combines commercial value, scope complexity, and readiness risk from project cards or your custom project description.</div>
  </section>

  ${details.map((item, index) => `
    <section class="slide">
      <div>
        <div class="kicker">KP LOGIC · ${String(index + 2).padStart(2, "0")}</div>
        <h2>${escapeHtml(item.title)}</h2>
      </div>
      <div class="split">
        <div class="insight">${escapeHtml(item.insight)}</div>
        <div>
          ${makeTable(["Metric", "Value", "Meaning"], item.kpis, { compact: true })}
          <div class="note">This is a KP generation layer, not a raw copy of the commercial proposal.</div>
        </div>
      </div>
    </section>

    <section class="slide">
      <div>
        <div class="kicker">SCOPE AND COST · ${String(index + 3).padStart(2, "0")}</div>
        <h2>Scope, effort and payment signals.</h2>
      </div>
      <div class="split">
        <div>
          ${makeTable(["Epic", "Items"], item.scope.map((row) => [row.name, row.count]), { compact: true })}
        </div>
        <div>
          ${makeTable(["Role", "Qty", "Months", "Cost"], item.roles.map((row) => [row.role, fmtNumber(row.qty), fmtNumber(row.months), fmtUsd(row.total)]), { compact: true })}
        </div>
      </div>
    </section>

    <section class="slide">
      <div>
        <div class="kicker">CLIENT REQUIREMENTS · ${String(index + 4).padStart(2, "0")}</div>
        <h2>What must be confirmed before delivery starts.</h2>
      </div>
      <div class="split">
        <ul class="list">
          ${item.blockers.slice(0, 7).map((blocker) => `<li>${escapeHtml(blocker.name)} - ${escapeHtml(blocker.status)}</li>`).join("") || "<li>No open client-side blocker found.</li>"}
        </ul>
        <div>
          ${makeTable(["Payment", "Amount"], item.payments.map((row) => [row.period, fmtUsd(row.amount)]), { compact: true })}
          <div class="note">The proposal should be tied to acceptance, access readiness, monthly demo approval, and payment discipline.</div>
        </div>
      </div>
    </section>
  `).join("")}
</body>
</html>`;
}

function runPdfVisualQa(pdfPath, outputDir) {
  const qaScript = path.join(process.cwd(), "scripts", "kp_pdf_visual_qa.mjs");
  const qaDir = path.join(
    outputDir,
    "qa",
    path.basename(pdfPath, path.extname(pdfPath)),
  );
  const result = spawnSync(process.execPath, [qaScript, pdfPath, qaDir], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
    env: {
      ...process.env,
      KP_PDF_EXPECTED_RATIO: "1.5",
      KP_PDF_EXPECTED_PAGES: String(PREMIUM_PROPOSAL_PAGE_COUNT),
      KP_PDF_ALLOW_COVER_PRICE: "0",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`KP PDF visual QA failed${details ? `: ${details}` : ""}`);
  }
  return {
    outputDir: qaDir,
    summary: String(result.stdout || "").trim(),
  };
}

async function inspectRenderedProposalDom(page) {
  return page.evaluate(() => {
    const pages = [...document.querySelectorAll(".page")];
    const pageNumbers = pages.map((node) => Number(node.dataset.page));
    const invalidPageSequence = pageNumbers.some((value, index) => value !== index + 1);
    const requiredSelectors = {
      1: ".cover-truth",
      2: ".trust-thread",
      3: ".chapter-layout",
      4: ".handoff-flow",
      5: ".market-research-layout",
      6: ".market-layout",
      7: ".analog-table",
      8: ".boundary-flow",
      9: ".product-spine",
      10: ".domain-map",
      11: ".design-layout",
      12: ".bpmn-shell",
      13: ".architecture-stack",
      14: ".swot-matrix",
      15: ".delivery-metrics",
      16: ".function-price-list",
      17: ".team-table",
      18: ".gantt-chart",
      19: ".commercial-layout",
      20: ".payment-table",
      21: ".decision-table",
    };
    const missingStructure = pages
      .map((node, index) => ({ page: index + 1, selector: requiredSelectors[index + 1] }))
      .filter((item) => !item.selector || !pages[item.page - 1].querySelector(item.selector));
    const overflowPages = pages
      .map((node, index) => ({
        page: index + 1,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      }))
      .filter((item) => item.scrollWidth > item.clientWidth + 2 || item.scrollHeight > item.clientHeight + 2);
    const allowedMicro = ".page-footer,.eyebrow,.section-label,.header-badge,.source-entry,.external-note,.cover-date,.cover-kicker";
    const tinyText = [...document.querySelectorAll(".page *")]
      .filter((node) => node.children.length === 0 && String(node.textContent || "").trim().length >= 24)
      .filter((node) => !node.closest(allowedMicro))
      .map((node) => ({
        text: String(node.textContent || "").trim().slice(0, 80),
        size: Number.parseFloat(getComputedStyle(node).fontSize || "0"),
      }))
      .filter((item) => item.size > 0 && item.size < 10);
    return { pageCount: pages.length, pageNumbers, invalidPageSequence, missingStructure, overflowPages, tinyText };
  });
}

export function isKpiQuestion(text = "", intent = null) {
  if (intent?.system === "kp" || intent?.system === "kpi") return true;
  const source = String(text || "");
  const hasPdfProposalSignal = /(pdf|project card|proyekt card|generation|generats|генерац|premium|proposal|commercial|коммерческ|предложен|презентац|deck|presentation)/i.test(source);
  if (/\bhrms\b/i.test(source) && !hasPdfProposalSignal) return false;
  if (/(cpo|chapter|hrms|salary|maosh|bonus|penalty|plan\/fact|plan fact|progress)/i.test(source) && !hasPdfProposalSignal) return false;
  return /\bkp\b|\bкп\b|kompred|commercial proposal|коммерческ(?:ое|ого)?\s+предложен|proposal\s*pdf|pdf\s*proposal|project card|proyekt card|project\s+(?:kp|kpi)|(?:kp|kpi).*pdf|pdf.*(?:kp|kpi)|proposal.*(?:kp|kpi)|commercial.*(?:kp|kpi)/i.test(source);
}

async function buildKpiPdfReportLegacy(question = "KP PDF generation", progress = async () => {}, options = {}) {
  await progress("KP project card examples o'qilyapti.");
  const allProjects = await loadKpiSummary();
  await progress(`KP project card examples tayyor: ${allProjects.length} project.`);
  const selected = selectProjects(question, allProjects);
  await progress(`KP proposal modeli uchun project tanlandi: ${selected.map((item) => item.title).join(", ") || "custom"}.`);
  const groundedBrief = selected[0]?.grounded_brief || parseKpBrief(question, {
    defaultCurrency: process.env.KP_DEFAULT_CURRENCY || "USD",
    defaultGeography: process.env.KP_DEFAULT_GEOGRAPHY || null,
  });
  const preliminaryLinks = classifyKpLinks(question, options.evidenceBundle || null);
  const brandTheme = await resolveKpBrandTheme({ options, groundedBrief, preliminaryLinks, progress });
  const { themeTokens, themeSource, themeWarnings, referenceUrl } = brandTheme;
  const mainForModel = selected.length === 1 ? selected[0] : selected[0] || allProjects[0];
  const research = await prepareKpEvidence(question, mainForModel, { ...options, groundedBrief }, progress);
  const clientBriefSourceId = research.sources.find((item) => item.type === "client_brief")?.id || "SRC-PROMPT";
  const boundGroundedBrief = bindBriefSourceIds(groundedBrief, clientBriefSourceId);
  research.groundedBrief = boundGroundedBrief;
  const proposalModel = buildKpProposalModel(mainForModel, question, research, themeTokens);
  proposalModel.brandProfile.themeSource = themeSource;
  proposalModel.brandProfile.themeWarnings = themeWarnings;
  proposalModel.validation.brandThemeSource = themeSource.kind;
  proposalModel.validation.brandThemeWarnings = themeWarnings;
  const sourceIdForUrl = (url = "") => {
    const canonical = canonicalKpUrl(url);
    return research.sources.find((item) => canonicalKpUrl(item.source || "") === canonical)?.id || "";
  };
  const sourceIdForFile = (fileName = "") => research.sources.find((item) => item.label === fileName || item.source === `attachment:${fileName}`)?.id || "";
  const evidenceSnippets = [
    ...(research.analogResearch || []).map((item) => ({ sourceId: sourceIdForUrl(item.url), text: item.text || "" })),
    ...(research.marketSources || []).map((item) => ({ sourceId: sourceIdForUrl(item.url), text: item.text || "" })),
    ...(research.documents || []).map((item) => ({ sourceId: sourceIdForFile(item.fileName), text: item.text || "" })),
    ...(research.transcripts || []).map((item) => ({ sourceId: sourceIdForFile(item.fileName), text: item.transcript || "" })),
  ]
    .filter((item) => item.sourceId && item.text)
    .slice(0, 12);
  const commercialLock = commercialLockHash(proposalModel);
  await progress("KP content: grounded narrative va claim ledger tayyorlanyapti.");
  const groundedNarrative = await synthesizeGroundedNarrative({
    brief: boundGroundedBrief,
    project: mainForModel,
    sources: proposalModel.sources,
    evidenceSnippets,
  }, {
    enabled: options.enableLlmSynthesis,
    timeoutMs: options.synthesisTimeoutMs,
  });
  proposalModel.groundedNarrative = groundedNarrative;
  proposalModel.claimLedger = groundedNarrative.claimLedger || [];
  proposalModel.problemStatement = groundedNarrative.problemStatement || proposalModel.problemStatement;
  proposalModel.validation.groundingStatus = groundedNarrative.status;
  proposalModel.validation.claimCount = proposalModel.claimLedger.length;
  proposalModel.validation.rejectedClaimCount = Number(groundedNarrative.rejectedClaimCount || 0);
  proposalModel.validation.researchStatus = research.researchStatus.status;
  proposalModel.validation.synthesisMode = groundedNarrative.mode;
  proposalModel.validation.synthesisModel = groundedNarrative.model || "";
  if (commercialLock !== commercialLockHash(proposalModel)) {
    throw new Error("Grounded synthesis attempted to alter locked commercial totals");
  }
  const outputDir = options.outputDir || path.join(process.cwd(), "reports");
  await fs.mkdir(outputDir, { recursive: true });
  const title = selected.length === 1 ? `${selected[0].title} KP` : "Project KP Portfolio";
  const outputPath = path.join(outputDir, `${slugify(title)}-${Date.now()}.pdf`);
  const mainForRecord = selected.length === 1 ? selected[0] : selected[0] || allProjects[0];
  const proposalRecord = proposalRecordFromProject(mainForRecord, question, "draft");
  const proposalRecordPath = await saveProposalRecord(proposalRecord);
  const proposalModelPath = path.join(outputDir, `${slugify(title)}-${Date.now()}-model.json`);
  await fs.writeFile(proposalModelPath, JSON.stringify(proposalModel, null, 2), "utf8");
  let renderedPageCount = 0;
  let visualQa;
  let failureStage = "template";
  try {
    const html = buildPdfHtml({
      question,
      selected,
      allProjects,
      theme: options.theme || process.env.KP_PDF_THEME || process.env.KPI_PDF_THEME || "flat",
      themeTokens,
      proposalModel,
    });
    await progress("KP commercial proposal PDF render qilinyapti.");
    failureStage = "browser_launch";
    const browser = await launchKpChromium({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
      failureStage = "dom_render";
      await page.setContent(html, { waitUntil: "networkidle" });
      const domQa = await inspectRenderedProposalDom(page);
      renderedPageCount = domQa.pageCount;
      if (domQa.pageCount !== PREMIUM_PROPOSAL_PAGE_COUNT) {
        throw new Error(`KP PDF DOM page count mismatch: expected ${PREMIUM_PROPOSAL_PAGE_COUNT}, found ${domQa.pageCount}`);
      }
      if (domQa.invalidPageSequence) {
        throw new Error(`KP PDF DOM page sequence is invalid: ${domQa.pageNumbers.join(", ")}`);
      }
      if (domQa.missingStructure.length) {
        throw new Error(`KP PDF DOM missing required page structures: ${domQa.missingStructure.map((item) => `${item.page}:${item.selector}`).join(", ")}`);
      }
      if (domQa.overflowPages.length) {
        throw new Error(`KP PDF DOM overflow on pages: ${domQa.overflowPages.map((item) => item.page).join(", ")}`);
      }
      if (domQa.tinyText.length) {
        throw new Error(`KP PDF DOM contains unreadably small text: ${domQa.tinyText.slice(0, 5).map((item) => `${item.size}px ${item.text}`).join(" | ")}`);
      }
      failureStage = "pdf_render";
      await page.pdf({
        path: outputPath,
        width: "1440px",
        height: "960px",
        printBackground: true,
        preferCSSPageSize: true,
      });
    } finally {
      await browser.close();
    }
    await progress("KP PDF visual QA: barcha sahifalar render va tekshiruvdan o'tyapti.");
    failureStage = "visual_qa";
    visualQa = runPdfVisualQa(outputPath, outputDir);
  } catch (error) {
    const failedAt = new Date().toISOString();
    proposalRecord.status = "failed";
    proposalRecord.pdf_path = "";
    proposalRecord.error = {
      stage: failureStage,
      message: String(error?.message || error || "Unknown KP PDF generation error").slice(0, 2_000),
    };
    proposalRecord.failed_at = failedAt;
    proposalRecord.updated_at = failedAt;
    proposalModel.validation.visualQa = "failed";
    proposalModel.validation.failureStage = failureStage;
    proposalModel.validation.failureMessage = proposalRecord.error.message;
    await fs.rm(outputPath, { force: true }).catch(() => {});
    await fs.writeFile(proposalModelPath, JSON.stringify(proposalModel, null, 2), "utf8").catch(() => {});
    await saveProposalRecord(proposalRecord).catch(() => {});
    throw error;
  }
  proposalModel.validation.visualQa = "pass";
  proposalModel.validation.visualQaOutputDir = visualQa.outputDir;
  proposalModel.validation.templateVersion = PREMIUM_PROPOSAL_TEMPLATE_VERSION;
  proposalModel.validation.pageCount = renderedPageCount;
  await fs.writeFile(proposalModelPath, JSON.stringify(proposalModel, null, 2), "utf8");
  proposalRecord.status = "ready";
  proposalRecord.pdf_path = outputPath;
  proposalRecord.updated_at = new Date().toISOString();
  await saveProposalRecord(proposalRecord);
  return {
    text: "",
    documentPath: outputPath,
    caption: "",
    meta: {
      title,
      selected: selected.map((item) => item.title),
      projects: allProjects.length,
      referenceUrl,
      themeTokens,
      themeSource,
      themeWarnings,
      proposalRecordPath,
      proposalModelPath,
      sourceCount: proposalModel.validation.sourceCount,
      functionPriceMatchesProject: proposalModel.validation.functionPriceMatchesProject,
      paymentsMatchProject: proposalModel.validation.paymentsMatchProject,
      researchStatus: proposalModel.validation.researchStatus,
      groundingStatus: proposalModel.validation.groundingStatus,
      claimCount: proposalModel.validation.claimCount,
      rejectedClaimCount: proposalModel.validation.rejectedClaimCount,
      synthesisMode: proposalModel.validation.synthesisMode,
      synthesisProvider: groundedNarrative.provider || "offline",
      synthesisModel: proposalModel.validation.synthesisModel,
      clientSourceCount: proposalModel.sources.length,
      researchSourceCount: proposalModel.sources.filter((item) => /market|analog|brand/i.test(item.type || "")).length,
      visualQa: proposalModel.validation.visualQa,
      visualQaOutputDir: proposalModel.validation.visualQaOutputDir,
      rendererMode: "legacy",
      rendererVersion: PREMIUM_PROPOSAL_TEMPLATE_VERSION,
      templateVersion: PREMIUM_PROPOSAL_TEMPLATE_VERSION,
      pageCount: renderedPageCount,
    },
  };
}

export async function buildKpiPdfReport(question = "KP PDF generation", progress = async () => {}, options = {}) {
  const env = options.env || process.env;
  const config = resolveKpPdfConfig(env);
  const referenceMode = options.storedEvidenceBundle?.selectionTrace?.mode || "none";
  const hasExplicitReference = ["explicit_full", "explicit_partial"].includes(referenceMode);
  if (config.disableReferencedGeneration && hasExplicitReference) {
    const error = new Error("Referenced KP generation is temporarily disabled");
    error.code = "KP_REF_GENERATION_DISABLED";
    error.retryable = true;
    throw error;
  }
  const rendererMode = config.rendererMode === "canary" ? "legacy" : resolveKpPdfRendererMode(env);
  if (hasExplicitReference && ["legacy", "shadow"].includes(rendererMode) && !authorizedReferenceShadowComparison(options)) {
    const error = new Error("Referenced KP generation cannot be delivered by legacy renderer");
    error.code = "KP_REF_GENERATION_DISABLED";
    error.retryable = true;
    throw error;
  }
  if (rendererMode === "legacy" || rendererMode === "shadow") {
    const result = await buildKpiPdfReportLegacy(question, progress, options);
    result.meta = {
      ...(result.meta || {}),
      requestId: options.requestContext?.requestId || "",
      rendererMode,
      rendererVersion: PREMIUM_PROPOSAL_TEMPLATE_VERSION,
      config: { rendererMode: config.rendererMode, qualityGateMode: config.qualityGateMode },
      v5ShadowEligible: rendererMode === "shadow",
    };
    return result;
  }
  return buildKpiPdfReportV5(question, progress, { ...options, config });
}

async function buildKpiPdfReportV5(question = "KP PDF generation", progress = async () => {}, options = {}) {
  const config = options.config || resolveKpPdfConfig(options.env || process.env);
  const dynamicPalettes = dynamicColorPalettesEnabled(options.env || process.env);
  await progress("KP v5: request workspace tayyorlanyapti.");
  const requestContext = normalizeV5RequestContext(options.requestContext, { question, config });
  const referenceMode = options.storedEvidenceBundle?.selectionTrace?.mode || requestContext.routing?.referenceModeHint || "none";
  const suppliedStyleProfile = options.visualStyleProfile || options.styleProfile || null;
  assertExplicitV5ReferenceInputs({
    referenceMode,
    requestContext,
    manifest: options.manifest,
    styleProfile: suppliedStyleProfile,
  });
  const workspace = await createRequestWorkspace(requestContext, { outputRoot: options.outputDir || config.outputRoot });
  let status = createStatus(requestContext.requestId);
  await writeContractJson(path.join(workspace, "status.json"), status, "requestStatus");

  const selected = await buildV5BaseSelection(question, options, progress);
  const legacyModel = selected.proposalModel;
  const groundedBriefForTheme = legacyModel.groundedBrief || legacyModel.grounded_brief || parseKpBrief(question);
  let analogTheme = null;
  const preliminaryThemeLinks = classifyKpLinks(question, options.evidenceBundle || null);
  const hasUrlThemeReference = Boolean(
    (groundedBriefForTheme.visualStyleReferences || []).length
    || groundedBriefForTheme.brandReference?.url?.value
    || groundedBriefForTheme.analog?.url?.value
    || (preliminaryThemeLinks.urls || []).length,
  );
  if (!dynamicPalettes) {
    analogTheme = udevsStaticThemeResult();
  } else if (!suppliedStyleProfile && referenceMode === "none" && hasUrlThemeReference) {
    analogTheme = await resolveKpBrandTheme({
      options,
      groundedBrief: groundedBriefForTheme,
      preliminaryLinks: preliminaryThemeLinks,
      progress,
    });
  }
  const normalizedStyleProfile = normalizeV5StyleProfile(suppliedStyleProfile, { referenceMode, analogTheme });
  const styleProfile = dynamicPalettes
    ? normalizedStyleProfile
    : applyUdevsScreenshotVisualSystem(normalizedStyleProfile);
  const visualReferences = {
    manifestId: options.manifest?.manifestId || null,
    manifestPath: options.manifest ? "contracts/evidence-manifest.json" : null,
    styleProfileId: styleProfile.profileId,
    styleProfilePath: "contracts/visual-style-profile.json",
    mode: referenceMode,
    primaryStyleSourceId: options.manifest?.primaryVisualReferenceId || styleProfile.referenceIds[0] || null,
    usableReferenceCount: styleProfile.referenceIds.length,
    warnings: styleProfile.warnings || [],
  };

  status = await setStatus(workspace, status, "planning", { progress: 20 });
  const v3Base = normalizeLegacyModelForV5(legacyModel, requestContext.requestId);
  if (["analog_url", "brand_url", "client_site_url", "ai_domain_fallback"].includes(analogTheme?.themeSource?.kind)) {
    const domainFallback = analogTheme.themeSource.kind === "ai_domain_fallback";
    v3Base.brandProfile = {
      ...(v3Base.brandProfile || {}),
      themeSource: analogTheme.themeSource,
      themeWarnings: analogTheme.themeWarnings || [],
      sourceStatus: domainFallback
        ? "provisional_ai_domain_palette"
        : "provisional_reference_palette_and_typography",
    };
  }
  v3Base.documentMetadata = {
    issueDate: requestContext.receivedAt,
    version: "Draft 1",
    vendor: "Udevs",
    clientName: null,
  };
  v3Base.commercialAssumptions = {
    quoteValidity: null,
    taxTreatment: null,
    warrantySupport: null,
    ipTerms: null,
  };
  const unlockedProposalModel = await buildProposalModelV3(v3Base, { requestId: requestContext.requestId, visualReferences });
  const commercialLock = await createCommercialLock(v3Base, { requestId: requestContext.requestId });
  let proposalModel = await attachCommercialLockHash(unlockedProposalModel, commercialLock);
  const semanticModel = buildProposalSemanticModel(proposalModel, { requestId: requestContext.requestId });
  await validateProposalSemanticModel(semanticModel);
  const presentationPlan = buildPresentationPlan({ requestId: requestContext.requestId, proposalModel, visualStyleProfile: styleProfile, semanticModel });
  proposalModel = await withRenderContractPageCount(proposalModel, presentationPlan.pageCount);
  const defaultPresentationPlan = referenceMode === "none"
    ? null
    : options.defaultPresentationPlan || buildPresentationPlan({
        requestId: requestContext.requestId,
        proposalModel,
        visualStyleProfile: normalizeV5StyleProfile(null, { referenceMode: "none" }),
        semanticModel,
      });
  const fidelityTargets = referenceMode === "none"
    ? null
    : options.fidelityTargets || buildReferenceFidelityTargets({
        manifest: options.manifest,
        captures: options.captures || [],
        analyses: options.analyses || [],
        styleProfile,
        baseDir: options.referenceBaseDir || process.cwd(),
      });
  const visualizationSpecs = buildVisualizationSpecs({ semanticModel, presentationPlan });
  const visualizationSourceRegistry = [
    ...(Array.isArray(proposalModel.sources) ? proposalModel.sources : []),
    ...(Array.isArray(semanticModel.sources) ? semanticModel.sources : []),
  ];
  const visualizationValidation = await validateVisualizationSpecs({
    specs: visualizationSpecs,
    proposalModel,
    semanticModel,
    presentationPlan,
    sourceRegistry: visualizationSourceRegistry,
  });
  const proposalPackage = await createProposalPackage({ requestContext, proposalModel, semanticModel, visualStyleProfile: styleProfile, presentationPlan, visualizationSpecs });

  await atomicWriteJson(path.join(workspace, "contracts", "request.json"), requestContext, { schemaName: "requestContext" });
  if (options.manifest) await atomicWriteJson(path.join(workspace, "contracts", "evidence-manifest.json"), options.manifest, { schemaName: "evidenceManifest" });
  await atomicWriteJson(path.join(workspace, "contracts", "visual-style-profile.json"), styleProfile, { schemaName: "visualStyleProfile" });
  if (defaultPresentationPlan) {
    await atomicWriteJson(path.join(workspace, "contracts", "default-presentation-plan.json"), defaultPresentationPlan, { schemaName: "presentationPlan" });
  }
  if (fidelityTargets) {
    await atomicWriteJson(path.join(workspace, "reference", "fidelity-targets.json"), fidelityTargets, { schemaName: "referenceFidelityTargets" });
  }
  await atomicWriteJson(path.join(workspace, "model", "proposal-model.json"), proposalModel, { schemaName: "proposalModel" });
  await atomicWriteJson(path.join(workspace, "model", "commercial-lock.json"), commercialLock, { schemaName: "commercialLock" });
  await atomicWriteJson(path.join(workspace, "model", "proposal-package.json"), proposalPackage, { schemaName: "proposalPackage" });
  await persistPlanningArtifacts(workspace, { semanticModel, presentationPlan, visualizationSpecs });

  let appPrototype = null;
  if (options.appPrototype?.publicId && options.appPrototype?.publicUrl) {
    const appPrototypeSpec = await buildAndValidateAppPrototypeSpec({
      requestId: requestContext.requestId,
      publicId: options.appPrototype.publicId,
      locale: requestContext.locale,
      proposalModel,
      semanticModel,
      proposalPackage,
      visualStyleProfile: styleProfile,
    });
    await atomicWriteJson(path.join(workspace, "contracts", "app-prototype-spec.json"), appPrototypeSpec, { schemaName: "appPrototypeSpec" });
    const candidatePrototypePath = path.join(workspace, "candidate", "prototype", "index.html");
    await renderAppPrototypeToFile(appPrototypeSpec, candidatePrototypePath);
    const appPrototypeQa = await runAppPrototypeQa({
      spec: appPrototypeSpec,
      htmlPath: candidatePrototypePath,
      outputPath: path.join(workspace, "qa", "app-prototype-qa.json"),
    });
    const published = await publishAppPrototype({
      workspace,
      outputRoot: options.outputDir || config.outputRoot,
      requestId: requestContext.requestId,
      publicId: options.appPrototype.publicId,
      publicUrl: options.appPrototype.publicUrl,
      candidateHtmlPath: candidatePrototypePath,
      qaReport: appPrototypeQa,
      screenCount: appPrototypeSpec.screens.length,
    });
    appPrototype = {
      spec: appPrototypeSpec,
      qa: appPrototypeQa,
      record: published.record,
      candidatePath: candidatePrototypePath,
      finalPath: published.finalPath,
    };
  }

  const qualityPolicy = {
    mode: config.qualityGateMode === "shadow" ? "shadow" : "enforce",
    referenceMode,
    requireReferenceFidelity: referenceMode !== "none",
    requireSemanticVisualizations: true,
    expectedPageCount: presentationPlan.pageCount,
    expectedAspectRatio: 1.5,
    expectedWidthPx: 1440,
    expectedHeightPx: 960,
    maxPdfBytes: config.maxPdfBytes,
    warningBudget: 5,
    sameCodeWarningBudget: 2,
    perPageWarningBudget: 2,
  };
  let qaReport = await runPreRenderQualityGate({
    requestContext,
    referenceMode,
    manifest: options.manifest || null,
    captures: options.captures || [],
    analyses: options.analyses || [],
    styleProfile,
    fidelityTargets,
    proposalModel,
    commercialLock,
    semanticModel,
    presentationPlan,
    visualizationSpecs,
    visualizationValidation,
    proposalPackage,
  }, {
    ctx: { requestId: requestContext.requestId, executionId: `${requestContext.requestId}:v5-delivery`, executionVariant: "v5-delivery" },
    policy: qualityPolicy,
  });
  const preRenderQaPath = path.join(workspace, "qa", "qa-report.pre-render.json");
  await fs.writeFile(preRenderQaPath, `${JSON.stringify(qaReport, null, 2)}\n`, "utf8");
  assertQualityGate(qaReport, qualityPolicy);

  status = await setStatus(workspace, status, "rendering", { progress: 55 });
  await progress("KP v5: reference-driven HTML render qilinyapti.");
  const html = buildReferenceDrivenProposalHtml({
    proposalModel,
    semanticModel,
    commercialLock,
    visualStyleProfile: styleProfile,
    presentationPlan,
    visualizationSpecs,
    prototypeUrl: appPrototype?.record?.publicUrl || "",
  });
  const htmlPath = path.join(workspace, "candidate", "proposal.html");
  const candidatePdfPath = path.join(workspace, "candidate", "proposal.candidate.pdf");
  await fs.writeFile(htmlPath, html, "utf8");
  const browser = await launchKpChromium({ headless: true });
  let domQa;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    await page.emulateMedia({ media: "print" });
    await page.setContent(html, { waitUntil: "load" });
    domQa = await inspectRenderedProposalDomV5(page, presentationPlan);
    qaReport = await recordDomGeometryGateG4(qaReport, domQa, qualityPolicy);
    await fs.writeFile(path.join(workspace, "qa", "qa-report.dom.json"), `${JSON.stringify(qaReport, null, 2)}\n`, "utf8");
    assertQualityGate(qaReport, qualityPolicy);
    await page.pdf({
      path: candidatePdfPath,
      width: "1440px",
      height: "960px",
      scale: 1,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }

  status = await setStatus(workspace, status, "qa", { progress: 80 });
  await progress("KP v5: PDF sahifalari va bosma geometriyasi tekshirilyapti.");
  const qaReportPath = path.join(workspace, "qa", "qa-report.json");
  qaReport = await runPostRenderQualityGate({
    report: qaReport,
    candidatePdf: candidatePdfPath,
    outputDir: path.join(workspace, "qa", "pdf-render"),
    presentationPlan,
    proposalModel,
    semanticModel,
    commercialLock,
    domReport: domQa,
    manifest: options.manifest || null,
    captures: options.captures || [],
    analyses: options.analyses || [],
    styleProfile,
    defaultPresentationPlan,
    fidelityTargets,
    baseDir: options.referenceBaseDir || process.cwd(),
    policy: qualityPolicy,
  }, { policy: qualityPolicy });
  await fs.writeFile(qaReportPath, `${JSON.stringify(qaReport, null, 2)}\n`, "utf8");
  assertReadyForPromotion(qaReport, qualityPolicy);

  status = await setStatus(workspace, status, "promoting", { progress: 95 });
  await progress("KP v5: tekshirilgan PDF yuklab olish uchun tayyorlanyapti.");
  const finalRelativePath = "final/proposal.pdf";
  const promotionResult = await runPromotionGateG7({
    report: qaReport,
    workspace,
    candidateRelativePath: path.relative(workspace, candidatePdfPath),
    finalRelativePath,
    qaReportPath,
  }, { policy: qualityPolicy });
  qaReport = promotionResult.report;
  const finalPdfPath = path.join(workspace, finalRelativePath);
  await writeContractJson(path.join(workspace, "model", "proposal-record.json"), {
    schemaVersion: "1.0",
    requestId: requestContext.requestId,
    state: "ready",
    rendererVersion: "v5",
    packageRelativePath: "model/proposal-package.json",
    qaReportRelativePath: path.relative(workspace, qaReportPath),
    artifact: {
      relativePath: finalRelativePath,
      sha256: promotionResult.promotion.finalSha256,
      sizeBytes: promotionResult.promotion.sizeBytes,
      pageCount: presentationPlan.pageCount,
    },
    failure: null,
    updatedAt: new Date().toISOString(),
  }, "proposalRecord");
  await createRetentionRecord({
    workspace,
    requestId: requestContext.requestId,
    artifactRelativePaths: [
      finalRelativePath,
      path.relative(workspace, htmlPath),
      ...(appPrototype?.record?.relativePath ? [appPrototype.record.relativePath] : []),
    ],
  });
  status = await setStatus(workspace, status, "ready", { progress: 100 });

  return {
    text: "",
    documentPath: finalPdfPath,
    html,
    caption: "",
    meta: {
      requestId: requestContext.requestId,
      title: proposalModel.title,
      selected: selected.selectedTitles,
      rendererMode: "v5",
      rendererVersion: KP_PDF_V5_RENDERER_VERSION,
      workspace,
      proposalPackagePath: path.join(workspace, "model", "proposal-package.json"),
      qaReportPath,
      qaStatus: qaReport.status,
      visualQa: qaReport.gates.find((gate) => gate.id === "G5")?.status || "NOT_RUN",
      pageCount: presentationPlan.pageCount,
      policyGeneration: config.policyGeneration,
      rolloutEpoch: config.rolloutEpoch,
      htmlPath,
      pdfPath: finalPdfPath,
      outputMode: "pdf",
      themeSource: analogTheme?.themeSource || { kind: "udevs_fallback", reference: "https://udevs.io/" },
      referenceUrl: analogTheme?.referenceUrl || "",
      themeWarnings: analogTheme?.themeWarnings || styleProfile.warnings || [],
      themeTokens: {
        primary: styleProfile.accents.decorativePrimary || styleProfile.accents.primary,
        secondary: styleProfile.accents.decorativeSecondary || styleProfile.accents.secondary,
        // The active renderer is intentionally two-color: secondary replaces
        // the previously exposed accent role.
        accent: styleProfile.accents.decorativeSecondary || styleProfile.accents.secondary,
        background: styleProfile.canvas.background,
        surface: styleProfile.canvas.surface1,
      },
      prototype: appPrototype ? {
        url: appPrototype.record.publicUrl,
        path: appPrototype.finalPath,
        qaStatus: appPrototype.record.qaStatus,
        screenCount: appPrototype.record.screenCount,
        rendererVersion: appPrototype.record.rendererVersion,
        recordPath: path.join(workspace, "model", "app-prototype-record.json"),
      } : null,
    },
  };
}

async function buildV5BaseSelection(question, options, progress) {
  await progress("KP v5: grounded commercial model tayyorlanyapti.");
  const allProjects = await loadKpiSummary();
  const selected = selectProjects(question, allProjects);
  const groundedBrief = selected[0]?.grounded_brief || parseKpBrief(question, {
    defaultCurrency: process.env.KP_DEFAULT_CURRENCY || "USD",
    defaultGeography: process.env.KP_DEFAULT_GEOGRAPHY || null,
  });
  const mainForModel = selected.length === 1 ? selected[0] : selected[0] || allProjects[0];
  const research = await prepareKpEvidence(question, mainForModel, { ...options, groundedBrief }, progress);
  const clientBriefSourceId = research.sources.find((item) => item.type === "client_brief")?.id || "SRC-PROMPT";
  research.groundedBrief = bindBriefSourceIds(groundedBrief, clientBriefSourceId);
  const proposalModel = buildKpProposalModel(mainForModel, question, research, {});
  const groundedNarrative = await synthesizeGroundedNarrative({
    brief: research.groundedBrief,
    project: mainForModel,
    sources: proposalModel.sources,
    evidenceSnippets: buildV5EvidenceSnippets(research),
  }, {
    enabled: options.enableLlmSynthesis,
    timeoutMs: options.synthesisTimeoutMs,
  });
  proposalModel.groundedNarrative = groundedNarrative;
  proposalModel.claimLedger = normalizeV5ClaimLedger(groundedNarrative.claimLedger || []);
  proposalModel.analogs = buildV5AnalogEvidence({
    brief: research.groundedBrief,
    research,
    narrativeClaims: groundedNarrative.claimLedger || [],
  });
  proposalModel.problemStatement = groundedNarrative.problemStatement || proposalModel.problemStatement;
  proposalModel.validation = {
    ...(proposalModel.validation || {}),
    groundingStatus: groundedNarrative.status,
    claimCount: proposalModel.claimLedger.length,
    rejectedClaimCount: Number(groundedNarrative.rejectedClaimCount || 0),
    synthesisMode: groundedNarrative.mode,
    synthesisModel: groundedNarrative.model || "",
  };
  return {
    proposalModel,
    selectedTitles: selected.map((item) => item.title),
  };
}

export function buildV5AnalogEvidence({ brief = {}, research = {}, narrativeClaims = [] } = {}) {
  const analogName = String(brief.analog?.name?.value || "").trim();
  if (!analogName) return [];
  const locale = brief.sourceLanguage || "en";
  const sources = research.sources || [];
  const sourceById = new Map(sources.map((row) => [row.id, row]));
  const sourceIdForUrl = (url = "") => {
    const canonical = canonicalKpUrl(url);
    return sources.find((row) => canonicalKpUrl(row.source || "") === canonical)?.id || "";
  };
  const rows = [];
  const seen = new Set();
  const add = (row) => {
    const learning = safeText(row.learning || "", 260).trim();
    const key = learning.toLowerCase();
    if (!learning || seen.has(key) || isBlockedKpResearchContent(learning)) return;
    seen.add(key);
    rows.push({
      id: `ANALOG-${String(rows.length + 1).padStart(3, "0")}`,
      label: row.label || analogName,
      url: row.url || null,
      learning,
      scopeEffect: "validate",
      truthStatus: ["verified", "single_source"].includes(row.truthStatus) ? row.truthStatus : "single_source",
      claimNature: ["observed", "reported", "estimate", "forecast", "scenario"].includes(row.claimNature) ? row.claimNature : "observed",
      sourceIds: (row.sourceIds || []).filter(Boolean),
      derivationRuleId: null,
    });
  };

  for (const claim of narrativeClaims) {
    if (rows.length >= 5 || !["research", "mixed"].includes(claim.kind) || !["verified", "single_source"].includes(claim.status)) continue;
    const externalSources = (claim.sourceIds || []).map((id) => sourceById.get(id)).filter(isAnalogEvidenceSource);
    if (!externalSources.length) continue;
    if (assertsSellerManagement(claim.claim) && !hasDirectSellerManagementEvidence(claim.evidenceExcerpt)) continue;
    const source = externalSources[0];
    add({
      label: `${analogName} · ${source.label || hostLabel(source.source)}`,
      url: /^https?:/i.test(source.source || "") ? source.source : null,
      learning: claim.claim,
      truthStatus: claim.status,
      claimNature: claim.claimNature,
      sourceIds: externalSources.map((row) => row.id),
    });
  }

  const readableCandidates = [
    ...(research.analogResearch || []).filter((item) => item.text && !item.error && !isBlockedKpResearchContent(item.text)),
    ...(research.marketSources || []).filter((item) => /^analog_/i.test(item.topic || "") && item.text && !item.error && !isBlockedKpResearchContent(item.text)),
  ];
  for (const item of readableCandidates) {
    if (rows.length >= 5) break;
    const sourceId = sourceIdForUrl(item.url);
    if (!sourceId) continue;
    add({
      label: `${analogName} · ${item.title || hostLabel(item.url)}`,
      url: item.url,
      learning: pickLocalizedGroundedAnalogObservation(item.text, analogName, locale),
      truthStatus: "single_source",
      sourceIds: [sourceId],
    });
  }

  const blockedDirect = (research.analogResearch || []).some((item) => item.error || isBlockedKpResearchContent(item.text));
  if (blockedDirect && rows.length === 0) {
    const learning = locale === "uz-Latn"
      ? "So‘ralgan analog sahifasi avtomatik so‘rovlardan himoya sabab o‘qilmadi; faqat o‘qiladigan ikkilamchi manbalardagi kuzatuvlar ishlatildi."
      : locale === "ru"
        ? "Страница запрошенного аналога не прочитана из-за защиты от автоматических запросов; используются только наблюдения из читаемых вторичных источников."
        : "The requested analogue page was blocked by anti-bot protection; only observations from readable secondary sources are used.";
    rows.push({
      id: `ANALOG-${String(rows.length + 1).padStart(3, "0")}`,
      label: analogName,
      url: brief.analog?.url?.value || null,
      learning,
      scopeEffect: "validate",
      truthStatus: "unknown",
      sourceIds: [],
      derivationRuleId: null,
    });
  }
  if (!rows.length) {
    rows.push({
      id: "ANALOG-001",
      label: analogName,
      url: brief.analog?.url?.value || null,
      learning: locale === "uz-Latn"
        ? "Analog mijoz tomonidan yo‘nalish sifatida ko‘rsatilgan, ammo uning mahsulot mexanikasi o‘qiladigan manba bilan tasdiqlanmagan."
        : locale === "ru"
          ? "Аналог указан клиентом как ориентир, но его продуктовые механики не подтверждены читаемым источником."
          : "The analogue is a client-provided direction, but its product mechanics are not supported by a readable source.",
      scopeEffect: "validate",
      truthStatus: "unknown",
      sourceIds: [],
      derivationRuleId: null,
    });
  }
  return rows.slice(0, 5);
}

function isAnalogEvidenceSource(source = {}) {
  const type = String(source.type || "").trim().toLowerCase();
  const topic = String(source.researchTopic || source.topic || "").trim().toLowerCase();
  if (type === "analog_research") return true;
  return ["analog_features", "analog_business_model", "product_analog"].includes(topic)
    || /^analog_(?:feature|business|product)/.test(topic);
}

const GROUNDED_ANALOG_OBSERVATION_SIGNALS = Object.freeze([
  {
    pattern: /(?:all[- ]in[- ]one\s+commerce|commerce platform|e-?commerce|online store|sell(?:ing)? online|online retail|электронн\p{L}*\s+торгов\p{L}*|онлайн-магазин\p{L}*|onlayn savdo|internet do['’]?kon)/iu,
    uz: "onlayn savdo va do‘konni boshqarishni qo‘llab-quvvatlaydi",
    ru: "поддерживает онлайн-продажи и управление магазином",
  },
  {
    pattern: DIRECT_SELLER_MANAGEMENT_EVIDENCE_PATTERN,
    uz: "uchinchi tomon sotuvchilarini ulash va boshqarishni qo‘llab-quvvatlaydi",
    ru: "поддерживает подключение и управление сторонними продавцами",
  },
  {
    pattern: /(?:sales channels?|sell everywhere|online and in[- ]person|point of sale|\bpos\b|social commerce|канал\p{L}*\s+продаж|онлайн\p{L}*\s+и\s+офлайн|savdo kanal\p{L}*)/iu,
    uz: "onlayn va jismoniy savdo kanallarini birlashtiradi",
    ru: "связывает онлайн- и офлайн-каналы продаж",
  },
  {
    pattern: /(?:checkout|payment processing|accept payments?|shop pay|digital wallet|плат[её]ж\p{L}*|при[её]м\s+оплат\p{L}*|оформлени\p{L}*\s+заказ\p{L}*|to['’]?lov\p{L}*|buyurtma\p{L}*\s+rasmiylashtirish)/iu,
    uz: "buyurtmani rasmiylashtirish va to‘lovlarni qabul qilishni qamrab oladi",
    ru: "охватывает оформление заказа и приём платежей",
  },
  {
    pattern: /(?:inventory|catalog(?:ue)?|product management|manage products?|stock management|управлени\p{L}*\s+(?:товар|каталог|запас)|товарн\p{L}*\s+каталог|mahsulot\p{L}*|katalog\p{L}*|zaxira\p{L}*)/iu,
    uz: "mahsulotlar va zaxiralarni boshqaradi",
    ru: "помогает управлять товарами и запасами",
  },
  {
    pattern: /(?:fulfilment|fulfillment|shipping|order tracking|last[- ]mile|logistics|доставк\p{L}*|исполнени\p{L}*\s+заказ\p{L}*|логистик\p{L}*|yetkazib berish|buyurtma\p{L}*\s+kuzatish)/iu,
    uz: "yetkazib berish va buyurtma bajarilishini boshqaradi",
    ru: "поддерживает доставку и управление исполнением заказа",
  },
  {
    pattern: /(?:customer acquisition|customer engagement|email campaigns?|marketing tools?|loyalty|retention|привлечени\p{L}*\s+клиент\p{L}*|маркетинг\p{L}*|лояльност\p{L}*|mijoz\p{L}*\s+jalb|marketing)/iu,
    uz: "mijozlarni jalb qilish va savdoni rivojlantirish vositalarini taqdim etadi",
    ru: "предоставляет инструменты привлечения клиентов и развития продаж",
  },
  {
    pattern: /(?:analytics|reporting|business insights|performance metrics|аналитик\p{L}*|отч[её]т\p{L}*|ko['’]?rsatkich\p{L}*|tahlil\p{L}*)/iu,
    uz: "savdo natijalarini tahlil qilish imkonini beradi",
    ru: "позволяет анализировать результаты продаж",
  },
  {
    pattern: /(?:artificial intelligence|\bai[- ](?:powered|assisted|driven)|automation|automated workflows?|искусственн\p{L}*\s+интеллект|автоматизац\p{L}*|sun['’]?iy intellekt|avtomatlashtirish)/iu,
    uz: "sun’iy intellekt va avtomatlashtirish vositalaridan foydalanadi",
    ru: "использует инструменты искусственного интеллекта и автоматизации",
  },
]);

const GENERIC_ANALOG_PLATFORM_SIGNAL = Object.freeze({
  pattern: /(?:digital platform|software platform|cloud platform|application platform|цифров\p{L}*\s+платформ\p{L}*|программн\p{L}*\s+платформ\p{L}*|raqamli platforma|dasturiy platforma)/iu,
  uz: "raqamli xizmatlarni yagona platformada taqdim etadi",
  ru: "предоставляет цифровые возможности на единой платформе",
});

function pickLocalizedGroundedAnalogObservation(value = "", analogName = "", locale = "en") {
  if (!String(value || "").trim()) return "";
  if (!["uz-Latn", "ru"].includes(locale)) return pickGroundedResearchSentence(value, analogName);
  const sourceText = String(value).replace(/\s+/g, " ").trim();
  const evidenceWindows = sourceText
    .split(/(?<=[.!?])\s+|\s*[|•]\s*/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 20);
  const matched = GROUNDED_ANALOG_OBSERVATION_SIGNALS.filter((signal) => evidenceWindows.some((window) => signal.pattern.test(window)));
  const selected = (matched.length ? matched : GENERIC_ANALOG_PLATFORM_SIGNAL.pattern.test(sourceText) ? [GENERIC_ANALOG_PLATFORM_SIGNAL] : []).slice(0, 2);
  if (!selected.length) return "";
  const product = safeText(analogName, 80) || (locale === "uz-Latn" ? "Analog mahsulot" : "Продукт-аналог");
  if (locale === "uz-Latn") {
    const clauses = selected.map((signal) => signal.uz);
    return safeText(`${product} manbasiga ko‘ra, platforma ${clauses[0]}${clauses[1] ? `; shuningdek, ${clauses[1]}` : ""}.`, 260);
  }
  const clauses = selected.map((signal) => signal.ru);
  return safeText(`По данным источника ${product}, платформа ${clauses[0]}${clauses[1] ? `; кроме того, ${clauses[1]}` : ""}.`, 260);
}

function pickGroundedResearchSentence(value = "", analogName = "") {
  const sentences = String(value || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\s*[|•]\s*/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 45 && item.length <= 500)
    .filter((item) => !isBlockedKpResearchContent(item) && !/cookie|privacy policy|terms of use|subscribe|sign in|log in/i.test(item));
  const token = String(analogName || "").toLowerCase();
  const scored = sentences.map((sentence) => ({
    sentence,
    score: (token && sentence.toLowerCase().includes(token) ? 4 : 0)
      + (/marketplace|e-?commerce|seller|catalog|checkout|delivery|payment|bank|bnpl|merchant/i.test(sentence) ? 3 : 0)
      + (sentence.length <= 260 ? 1 : 0),
  })).sort((left, right) => right.score - left.score || left.sentence.length - right.sentence.length);
  return safeText(scored[0]?.sentence || "", 260);
}

function buildV5EvidenceSnippets(research = {}) {
  const sourceIdForUrl = (url = "") => {
    const canonical = canonicalKpUrl(url);
    return (research.sources || []).find((item) => canonicalKpUrl(item.source || "") === canonical)?.id || "";
  };
  const sourceIdForFile = (fileName = "") => (research.sources || [])
    .find((item) => item.label === fileName || item.source === `attachment:${fileName}`)?.id || "";
  return [
    ...(research.analogResearch || []).filter((item) => !item.error && !isBlockedKpResearchContent(item.text)).map((item) => ({ sourceId: sourceIdForUrl(item.url), text: item.text || "" })),
    ...(research.marketSources || []).filter((item) => !item.error && !isBlockedKpResearchContent(item.text)).map((item) => ({ sourceId: sourceIdForUrl(item.url), text: item.text || "" })),
    ...(research.documents || []).filter((item) => !item.error && !isBlockedKpResearchContent(item.text)).map((item) => ({ sourceId: sourceIdForFile(item.fileName), text: item.text || "" })),
    ...(research.transcripts || []).filter((item) => !item.error && !isBlockedKpResearchContent(item.transcript)).map((item) => ({ sourceId: sourceIdForFile(item.fileName), text: item.transcript || "" })),
  ].filter((item) => item.sourceId && item.text).slice(0, 12);
}

function normalizeV5ClaimLedger(rows = []) {
  return rows.slice(0, 24).map((row, index) => {
    const truthStatus = ["explicit", "verified", "single_source", "recommended", "inferred", "assumed", "unknown"].includes(row.truthStatus || row.status)
      ? row.truthStatus || row.status
      : row.kind === "recommendation"
        ? "recommended"
        : "single_source";
    const sourceIds = Array.isArray(row.sourceIds) ? row.sourceIds.map(String).filter(Boolean) : [];
    const derived = ["recommended", "inferred", "assumed"].includes(truthStatus) && !sourceIds.length;
    return {
      id: row.id || `CLM-${String(index + 1).padStart(3, "0")}`,
      text: String(row.text || row.claim || "").replace(/\s+/g, " ").trim().slice(0, 600),
      truthStatus,
      sourceIds,
      evidenceExcerpt: String(row.evidenceExcerpt || "").replace(/\s+/g, " ").trim().slice(0, 360),
      claimNature: ["observed", "reported", "estimate", "forecast", "scenario"].includes(row.claimNature) ? row.claimNature : null,
      derivationRuleId: row.derivationRuleId || (derived ? `GROUNDED-${String(row.kind || truthStatus).toUpperCase().replace(/[^A-Z0-9]+/g, "-")}` : null),
    };
  }).filter((row) => row.text && (row.sourceIds.length || row.derivationRuleId || row.truthStatus === "unknown"));
}

function normalizeLegacyModelForV5(model = {}, requestId) {
  const rawFunctionPrice = (model.functionPrice || []).map((row, index) => {
    const scopeRow = Array.isArray(model.scope?.[index])
      ? { detail: model.scope[index][2], phase: model.scope[index][3] }
      : model.scope?.[index] || {};
    const total = Number(row.total ?? row.amount ?? row.price ?? 0);
    const truthStatus = row.truthStatus || (total > 0 ? "assumed" : "unknown");
    return {
      id: row.id || `FP-${String(index + 1).padStart(3, "0")}`,
      baseName: row.name || row.title || row.feature || row.role || `Function ${index + 1}`,
      detail: row.detail || scopeRow.detail || "",
      phase: row.phase || scopeRow.phase || "",
      total,
      costModel: row.costModel || null,
      truthStatus,
      sourceIds: row.sourceIds || [],
      derivationRuleId: row.derivationRuleId || (total > 0 && ["assumed", "inferred", "recommended"].includes(truthStatus) ? "V5-FUNCTION-ALLOCATION-SCENARIO" : null),
    };
  });
  const duplicateFunctionNames = new Map();
  for (const row of rawFunctionPrice) {
    const key = String(row.baseName).trim().toLocaleLowerCase("en-US");
    duplicateFunctionNames.set(key, (duplicateFunctionNames.get(key) || 0) + 1);
  }
  const usedFunctionNames = new Set();
  const functionPrice = rawFunctionPrice.map((row, index) => {
    const key = String(row.baseName).trim().toLocaleLowerCase("en-US");
    const descriptive = duplicateFunctionNames.get(key) > 1 && row.detail
      ? `${row.baseName}: ${row.detail}`
      : String(row.baseName);
    const normalizedKey = descriptive.toLocaleLowerCase("en-US");
    const name = usedFunctionNames.has(normalizedKey) ? `${descriptive} (${index + 1})` : descriptive;
    usedFunctionNames.add(name.toLocaleLowerCase("en-US"));
    return { id: row.id, name, detail: row.detail, phase: row.phase, total: row.total, costModel: row.costModel, truthStatus: row.truthStatus, sourceIds: row.sourceIds, derivationRuleId: row.derivationRuleId };
  });
  const functionTotal = functionPrice.reduce((sum, row) => sum + Math.round(Number(row.total || 0)), 0);
  const projectPrice = Number(model.pricing?.projectPrice ?? model.pricing?.total ?? functionTotal);
  const payments = (model.payments || []).map((row, index) => ({
    id: row.id || `PAY-${String(index + 1).padStart(3, "0")}`,
    label: row.label || row.name || row.period || row.milestone || `Payment ${index + 1}`,
    amount: Number(row.amount ?? row.total ?? 0),
    percent: Number(row.percent ?? row.percentage ?? 0),
    percentBasisPoints: Number(row.percentBasisPoints ?? Math.round(Number(row.percent ?? row.percentage ?? 0) * 100)),
    order: Number(row.order ?? index + 1),
    acceptance: row.acceptance || row.due || "Acceptance trigger to confirm",
    due: row.due || row.acceptance || null,
    truthStatus: row.truthStatus || "assumed",
    sourceIds: row.sourceIds || [],
    derivationRuleId: row.derivationRuleId || "V5-PAYMENT-PLANNING-SCENARIO",
  }));
  const initialDurationMonths = Number(model.durationMonths || model.brief?.durationMonths || model.timeline?.durationMonths || 3);
  const roadmap = normalizeV5Roadmap(model.roadmap || [], initialDurationMonths);
  const durationMonths = Math.max(initialDurationMonths, ...roadmap.map((phase) => Number(phase.endMonth || phase.end || 1)));
  const clientBriefSourceIds = [...new Set((model.sources || [])
    .filter((source) => source?.id && /client[_ -]?brief|client[_ -]?request|prompt/i.test(`${source.type || ""} ${source.label || ""}`))
    .map((source) => String(source.id)))];
  const scope = normalizeV5Scope(model.scope || functionPrice, { clientBriefSourceIds });
  return {
    ...model,
    schemaVersion: undefined,
    requestId,
    title: model.title || model.brief?.projectName || "Commercial proposal",
    pricing: { ...(model.pricing || {}), projectPrice, currency: model.pricing?.currency || "XXX", currencyStatus: model.pricing?.currencyStatus || "unknown" },
    functionPrice: functionPrice.length ? functionPrice : [{ id: "FP-001", name: "Delivery", total: projectPrice, truthStatus: "assumed", sourceIds: [], derivationRuleId: "V5-FUNCTION-ALLOCATION-SCENARIO" }],
    payments,
    teamPlan: normalizeV5TeamPlan(model.teamPlan, { durationMonths }),
    durationMonths,
    durationWeeks: Math.max(Number(model.durationWeeks || model.brief?.durationWeeks || model.timeline?.durationWeeks || 0), Math.round(durationMonths * 4)),
    roadmap,
    scope,
    claimLedger: model.claimLedger || [],
  };
}

function normalizeV5Scope(scopeRows = [], { clientBriefSourceIds = [] } = {}) {
  return scopeRows.map((row, index) => {
    const source = Array.isArray(row)
      ? { epic: row[0], feature: row[1], detail: row[2], phase: row[3], priority: row[4] }
      : row || {};
    const statusText = String(source.priority || source.inclusion || source.truthStatus || "").toLowerCase();
    const recommended = /recommended|tavsiya|рекоменду/.test(statusText);
    const truthStatus = source.truthStatus || (recommended ? "recommended" : "explicit");
    const derivedTruth = ["recommended", "inferred", "assumed"].includes(truthStatus);
    const providedSourceIds = Array.isArray(source.sourceIds) ? source.sourceIds.map(String).filter(Boolean) : [];
    const sourceIds = providedSourceIds.length ? providedSourceIds : derivedTruth ? [] : clientBriefSourceIds;
    return {
      id: source.id || `SCOPE-${String(index + 1).padStart(3, "0")}`,
      epic: source.epic || source.name || source.title || "Delivery",
      feature: source.feature || source.name || source.title || `Scope ${index + 1}`,
      detail: source.detail || source.description || "",
      phase: source.phase || null,
      priority: source.priority || "",
      inclusion: source.inclusion || (derivedTruth ? "recommended" : /requested|so['’]?ralgan|запрош/.test(statusText) ? "requested" : "in_scope"),
      ownership: source.ownership || (/partner|provider|integration|api/i.test(`${source.epic} ${source.feature} ${source.detail}`) ? "partner_integrated" : "owned"),
      truthStatus,
      sourceIds,
      derivationRuleId: source.derivationRuleId || (derivedTruth ? "V5-RECOMMENDED-SCOPE" : null),
    };
  });
}

function normalizeV5Roadmap(rows = [], durationMonths = 3) {
  if (!rows.length) {
    return [{ id: "PHASE-1", label: "Delivery", startMonth: 1, endMonth: Math.max(1, durationMonths), truthStatus: "assumed", sourceIds: [], derivationRuleId: "V5-ROADMAP-PLANNING-SCENARIO" }];
  }
  return rows.map((row, index) => {
    const source = Array.isArray(row)
      ? { phase: row[0], label: row[1] || row[0], detail: row[2], team: row[3] }
      : row || {};
    const monthMatch = String(source.phase || source.label || "").match(/(?:month|месяц|oy)\s*(\d+)/i);
    const startMonth = Number(source.startMonth || source.month || monthMatch?.[1] || index + 1);
    const endMonth = Number(source.endMonth || source.end || startMonth);
    return {
      ...source,
      id: source.id || `PHASE-${index + 1}`,
      label: source.label || source.title || source.phase || `Phase ${index + 1}`,
      startMonth,
      endMonth: Math.max(startMonth, endMonth),
      truthStatus: source.truthStatus || "assumed",
      sourceIds: source.sourceIds || [],
      derivationRuleId: source.derivationRuleId || "V5-ROADMAP-PLANNING-SCENARIO",
    };
  });
}

function normalizeV5TeamPlan(teamPlan = {}, { durationMonths = null } = {}) {
  return canonicalizeTeamPlan(teamPlan, { durationMonths });
}

export function normalizeV5StyleProfile(profile = null, { referenceMode = "none", analogTheme = null } = {}) {
  if (profile?.schemaVersion === "1.0") return profile;
  const hasReference = referenceMode !== "none";
  if (hasReference) {
    const error = new Error("Explicit reference mode requires a real validated VisualStyleProfile");
    error.code = "KP_REF_PROFILE_INVALID";
    error.retryable = false;
    throw error;
  }
  const tokens = analogTheme?.themeTokens || udevsFallbackTheme();
  const sourceKind = analogTheme?.themeSource?.kind || "udevs_fallback";
  const urlDriven = Boolean(["analog_url", "brand_url", "client_site_url", "ai_domain_fallback"].includes(sourceKind) && parseCssColor(tokens.brand || tokens.primary));
  const canvasColor = parseCssColor(tokens.canvas || "#0D1117");
  const canvasMode = relativeRgbLuminance(canvasColor) < 0.42 ? "dark" : "light";
  const hasReferenceTypography = Boolean(tokens.displayStack || tokens.bodyStack);
  const fallbackFields = urlDriven
    ? [
        ...(!hasReferenceTypography ? ["/typography"] : []),
        "/layout",
        "/components",
        "/diagramGrammar",
      ]
    : ["/canvas", "/accents", "/typography", "/layout", "/components", "/diagramGrammar"];
  const fallback = {
    schemaVersion: "1.0",
    profileId: urlDriven ? `VSP-LIVE-URL-${sha256Digest(analogTheme.referenceUrl || analogTheme.themeSource?.reference || "reference").slice(7, 19).toUpperCase()}` : "VSP-LIVE-DEFAULT",
    status: urlDriven ? "fallback_partial" : "fallback_default",
    referenceIds: [],
    confidence: urlDriven ? (hasReferenceTypography ? 0.82 : 0.7) : 0.35,
    canvas: {
      mode: canvasMode,
      background: tokens.canvas || "#0D1117",
      surface1: tokens.surface1 || "#151B24",
      surface2: tokens.surface2 || tokens.brandTint || "#10295A",
      textPrimary: tokens.textPrimary || "#FFFFFF",
      textSecondary: tokens.textSecondary || "#B7C2D0",
      rule: tokens.rule || "#2B3542",
    },
    accents: {
      primary: tokens.brand || tokens.primary || "#0052FF",
      secondary: tokens.secondary || tokens.brandDeep || "#FFFFFF",
      positive: tokens.positive || tokens.brandDeep || "#8AB0FF",
      warning: tokens.warning || tokens.textPrimary || "#FFFFFF",
      critical: tokens.critical || tokens.brandDeep || "#8AB0FF",
      decorativePrimary: tokens.decorativePrimary || tokens.brand || tokens.primary || "#0052FF",
      decorativeSecondary: tokens.decorativeSecondary || tokens.secondary || tokens.textPrimary || "#0D1117",
      decorativeTertiary: tokens.decorativeTertiary || tokens.critical || tokens.brandDeep || "#FFFFFF",
    },
    typography: {
      displayStack: normalizedReferenceFontStack(tokens.displayStack, "Arial, Helvetica, sans-serif"),
      bodyStack: normalizedReferenceFontStack(tokens.bodyStack, "Trebuchet MS, Arial, sans-serif"),
      metadataStack: normalizedReferenceFontStack(tokens.metadataStack, "SFMono-Regular, Menlo, Consolas, monospace"),
      displayClass: "neo_grotesk_sans",
      bodyClass: "humanist_sans",
      metadataClass: "monospace",
      scale: "balanced",
    },
    // The URL controls brand expression only. Layout, spacing, borders,
    // radii and page composition remain renderer-owned design decisions.
    layout: {
      families: ["cover_asymmetric", "editorial_split", "connected_graph", "evidence_table", "timeline", "commercial_hero", "decision_close"],
      density: "balanced",
      alignment: "left_editorial",
      gridColumns: 12,
      whitespaceRatio: 0.4,
      backgroundStyle: ["udevs_static", "udevs_fallback"].includes(sourceKind) ? "udevs_screenshot" : "dynamic_brand",
    },
    components: {},
    diagramGrammar: {},
    provenance: urlDriven ? [{ sourceKind, source: analogTheme.themeSource.reference, aspects: hasReferenceTypography ? ["palette", "typography"] : ["palette"] }] : [],
    fallbackFields,
    conflicts: [],
    warnings: urlDriven
      ? [
          ...(analogTheme.themeWarnings || []),
          hasReferenceTypography
            ? "Reference URL colors and typography are provisional; layout and component geometry remain the proposal renderer's own system."
            : "Reference URL colors are provisional; typography, layout, and component geometry remain the proposal renderer's own system.",
        ]
      : [
          ...(analogTheme?.themeWarnings || []),
          analogTheme?.referenceUrl
            ? "The client website palette was unavailable; the Udevs palette was applied."
            : "No client website was supplied; the Udevs palette was applied.",
        ],
  };
  return fallback;
}

function assertExplicitV5ReferenceInputs({ referenceMode, requestContext, manifest, styleProfile }) {
  if (!["explicit_full", "explicit_partial"].includes(referenceMode)) return true;
  if (!manifest || manifest.schemaVersion !== "2.0" || manifest.requestId !== requestContext.requestId || manifest.referenceMode !== referenceMode) {
    throw Object.assign(new Error("Explicit reference request has no matching immutable EvidenceManifest"), {
      code: "REF_EXPECTED_BUT_MISSING",
      retryable: false,
    });
  }
  if (referenceMode === "explicit_full") {
    const primary = manifest.primaryVisualReferenceId;
    const item = (manifest.items || []).find((row) => row.id === primary);
    if (!primary || !item || !["brand_system", "visual_style"].includes(item.role)) {
      throw Object.assign(new Error("Explicit full reference has no valid primary visual source"), {
        code: "KP_REF_PRIMARY_UNAVAILABLE",
        retryable: false,
      });
    }
  }
  if (!styleProfile || styleProfile.schemaVersion !== "1.0" || !(styleProfile.referenceIds || []).length) {
    throw Object.assign(new Error("Explicit reference request has no real VisualStyleProfile"), {
      code: "KP_REF_PROFILE_INVALID",
      retryable: false,
    });
  }
  if (referenceMode === "explicit_full" && !styleProfile.referenceIds.includes(manifest.primaryVisualReferenceId)) {
    throw Object.assign(new Error("VisualStyleProfile is not traceable to the primary reference"), {
      code: "KP_REF_PROFILE_INVALID",
      retryable: false,
    });
  }
  return true;
}

export function normalizeV5RequestContext(input = null, { question = "", config = {} } = {}) {
  const promptLanguage = parseKpBrief(question).sourceLanguage;
  const promptLocale = promptLanguage === "uz-Latn" ? "uz-Latn" : promptLanguage === "ru" ? "ru-RU" : "en-US";
  const explicitReference = ["explicit_full", "explicit_partial"].includes(input?.routing?.referenceModeHint);
  const resolvedLocale = explicitReference
    ? input?.locale || promptLocale
    : input?.channel === "telegram" || !input?.locale
      ? promptLocale
      : input.locale;
  if (input?.schemaVersion === "1.0" && input.requestId && input.receivedAt && input.transport?.chatId && input.routing?.chatIdHash) {
    return Object.freeze({ ...input, locale: resolvedLocale });
  }
  const requestId = input?.requestId && /^KP-[0-9]{8}-[A-Z0-9]{6,32}$/.test(input.requestId)
    ? input.requestId
    : `KP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${sha256Digest(`${question}:${Date.now()}`).slice(7, 19).toUpperCase()}`;
  return createKpRequestContext({
    requestId,
    channel: input?.channel || "test",
    locale: resolvedLocale,
    timezone: input?.timezone || "Asia/Tashkent",
    chatIdHash: input?.routing?.chatIdHash || sha256Digest("kp-v5-live-chat"),
    idempotencyKeyHash: input?.routing?.idempotencyKeyHash || sha256Digest(`kp-v5:${requestId}`),
    canaryBucket: Number(input?.routing?.canaryBucket ?? 0),
    rendererSelectionReason: input?.routing?.rendererSelectionReason || `v5_policy_${config.policyGeneration || 1}`,
    transport: {
      chatType: input?.transport?.chatType || "private",
      chatId: input?.transport?.chatId || "test-chat",
      userId: input?.transport?.userId || "test-user",
      messageId: Number(input?.transport?.messageId ?? 0),
      messageThreadId: Number(input?.transport?.messageThreadId ?? 0),
      mediaGroupId: input?.transport?.mediaGroupId ?? null,
      replyToMessageId: input?.transport?.replyToMessageId ?? null,
      referenceModeHint: input?.routing?.referenceModeHint || "none",
    },
  });
}

function authorizedReferenceShadowComparison(options = {}) {
  const channel = options.requestContext?.channel || "";
  return ["test", "internal"].includes(channel)
    && options.authorizedReferenceShadowComparison === true;
}

export async function buildKpiSelfTestReport(progress = async () => {}) {
  const questions = [
    "AI Declarant KP premium pdf",
    "Aloqa Bank project card bo'yicha KP pdf generatsiya qil",
    "Parking System KP commercial proposal bo'yicha pdf",
    "Rise Group website KP va payment schedule premium pdf",
    "TikTok Analog bo'yicha project KP pdf",
    "Hamma project cardlar bo'yicha KP portfolio pdf",
  ];
  const lines = ["KP PDF self-test"];
  let pass = 0;
  for (const [index, question] of questions.entries()) {
    await progress(`KP test ${index + 1}/${questions.length}: ${question}`);
    const result = await buildKpiPdfReport(question, progress, { outputDir: path.join(process.cwd(), "reports", "kpi-self-test") });
    const stat = await fs.stat(result.documentPath);
    const ok = stat.size > 80_000 && result.documentPath.endsWith(".pdf");
    if (ok) pass += 1;
    lines.push(`${index + 1}. ${ok ? "PASS" : "FAIL"} | ${question} | ${path.basename(result.documentPath)} | ${stat.size} bytes`);
  }
  lines.splice(1, 0, `Total: ${questions.length} | PASS: ${pass} | FAIL: ${questions.length - pass}`);
  return lines.join("\n");
}
